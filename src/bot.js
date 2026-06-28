var baileys = require('baileys');
var makeWASocket = baileys.default;
var useMultiFileAuthState = baileys.useMultiFileAuthState;
var DisconnectReason = baileys.DisconnectReason;
var fetchLatestBaileysVersion = baileys.fetchLatestBaileysVersion;
var jidNormalizedUser = baileys.jidNormalizedUser;
var Browsers = baileys.Browsers;

var pino = require('pino');
var http = require('http');
var path = require('path');
var fs = require('fs');
var config = require('./config');
var ai = require('./ai');
var antiSpam = require('./antiSpam');
var memberManager = require('./memberManager');
var commands = require('./commands');
var groupManager = require('./groupManager');

// ── Dossier de stockage des sessions (persistant) ──
// Sur Render/Katabump, configure un disque persistant monte sur ce chemin
// via la variable DATA_DIR (ex: /data). Sinon, fallback local.
var DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
var AUTH_DIR = path.join(DATA_DIR, 'sessions');
try { fs.mkdirSync(AUTH_DIR, { recursive: true }); } catch (e) {}

// ── Sessions multi-connexion ──
// Format: { id, phone, pairingCode, isConnected, sock, status, retries }
var sessions = [];
var nextSessionId = 1;

// ── Serveur web ──
function startWebServer(port) {
  http.createServer(function (req, res) {
    // ── API : ajouter une session ──
    if (req.url === '/add-session' && req.method === 'POST') {
      var body = '';
      req.on('data', function (chunk) { body += chunk; });
      req.on('end', async function () {
        try {
          var data = JSON.parse(body || '{}');
          var phone = (data.phone || '').replace(/[^0-9]/g, '');
          if (!phone || phone.length < 10) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Numero invalide (format international, ex: 224XXXXXXXXX)' }));
            return;
          }

          // Eviter les doublons : si une session existe deja pour ce numero, on la reutilise
          var existing = null;
          for (var k = 0; k < sessions.length; k++) {
            if (sessions[k].phone === phone) { existing = sessions[k]; break; }
          }
          if (existing) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, sessionId: existing.id, existing: true }));
            return;
          }

          var sessionId = nextSessionId++;
          var session = {
            id: sessionId,
            phone: phone,
            pairingCode: null,
            isConnected: false,
            sock: null,
            status: 'starting',
            retries: 0,
          };
          sessions.push(session);
          console.log('Nouvelle session #' + sessionId + ' pour: +' + phone);
          startSession(session).catch(function (e) {
            session.status = 'error';
            console.error('Erreur session #' + sessionId + ':', e.message);
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, sessionId: sessionId }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // ── API : supprimer / deconnecter une session ──
    if (req.url === '/remove-session' && req.method === 'POST') {
      var rbody = '';
      req.on('data', function (chunk) { rbody += chunk; });
      req.on('end', async function () {
        try {
          var rdata = JSON.parse(rbody || '{}');
          var id = parseInt(rdata.id, 10);
          await removeSession(id);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // ── API : statut de toutes les sessions ──
    if (req.url === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        sessions: sessions.map(function (s) {
          return {
            id: s.id,
            phone: s.phone,
            pairingCode: s.pairingCode,
            isConnected: s.isConnected,
            status: s.status,
          };
        }),
      }));
      return;
    }

    // ── Health check (keep-alive) ──
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'online',
        sessions: sessions.length,
        connected: sessions.filter(function (s) { return s.isConnected; }).length,
        uptime: Math.floor(process.uptime()),
      }));
      return;
    }

    // ── Page principale ──
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(getHTML());
  }).listen(port, function () {
    console.log('Serveur web demarre sur le port ' + port);
  });
}

// ── Restaurer les sessions existantes au demarrage (apres redeploiement) ──
async function restoreSessions() {
  var dirs;
  try {
    dirs = fs.readdirSync(AUTH_DIR);
  } catch (e) {
    return;
  }
  for (var i = 0; i < dirs.length; i++) {
    var name = dirs[i];
    // Format du dossier: session_<phone>
    if (name.indexOf('session_') !== 0) continue;
    var phone = name.replace('session_', '');
    var credsPath = path.join(AUTH_DIR, name, 'creds.json');
    if (!fs.existsSync(credsPath)) continue;

    var sessionId = nextSessionId++;
    var session = {
      id: sessionId,
      phone: phone,
      pairingCode: null,
      isConnected: false,
      sock: null,
      status: 'restoring',
      retries: 0,
    };
    sessions.push(session);
    console.log('Restauration session #' + sessionId + ' (+' + phone + ')');
    startSession(session).catch(function (e) {
      console.error('Erreur restauration:', e.message);
    });
  }
}

// ── Supprimer une session ──
async function removeSession(id) {
  var idx = -1;
  for (var i = 0; i < sessions.length; i++) {
    if (sessions[i].id === id) { idx = i; break; }
  }
  if (idx === -1) return;
  var session = sessions[idx];
  try {
    if (session.sock) {
      await session.sock.logout().catch(function () {});
    }
  } catch (e) {}
  // Supprimer le dossier d'auth
  var dir = path.join(AUTH_DIR, 'session_' + session.phone);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
  sessions.splice(idx, 1);
  console.log('Session #' + id + ' supprimee.');
}

// ── Démarrer une session WhatsApp ──
async function startSession(session) {
  var authDir = path.join(AUTH_DIR, 'session_' + session.phone);
  try { fs.mkdirSync(authDir, { recursive: true }); } catch (e) {}

  var stateResult = await useMultiFileAuthState(authDir);
  var state = stateResult.state;
  var saveCreds = stateResult.saveCreds;

  var versionResult = await fetchLatestBaileysVersion();
  var version = versionResult.version;

  var usePairingCode = !state.creds.registered;

  var sock = makeWASocket({
    version: version,
    auth: state,
    // IMPORTANT : navigateur canonique sinon WhatsApp rejette l'appairage.
    browser: Browsers.macOS('Safari'),
    printQRInTerminal: false,
    syncFullHistory: false,
    markOnlineOnConnect: true,
    logger: pino({ level: 'silent' }),
    keepAliveIntervalMs: 25000,
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 60000,
    retryRequestDelayMs: 2000,
  });

  session.sock = sock;
  session.status = usePairingCode ? 'pairing' : 'connecting';
  sock.ev.on('creds.update', saveCreds);

  // ── Demande du code d'appairage AU BON MOMENT ──
  // On attend un court instant que le socket initialise sa connexion WebSocket,
  // PUIS on demande le code. Demander trop tot genere un "code mort".
  if (usePairingCode) {
    var requested = false;
    var requestCode = async function () {
      if (requested) return;
      if (state.creds.registered) return;
      requested = true;
      try {
        // Petit delai pour laisser le socket s'ouvrir proprement
        await new Promise(function (r) { setTimeout(r, 3000); });
        var code = await sock.requestPairingCode(session.phone);
        // Format lisible : XXXX-XXXX
        var grouped = (code || '').match(/.{1,4}/g);
        session.pairingCode = grouped ? grouped.join('-') : code;
        session.status = 'pairing';
        console.log('Session #' + session.id + ' (+' + session.phone + ') code: ' + session.pairingCode);
      } catch (e) {
        requested = false;
        console.error('Erreur pairage session #' + session.id + ':', e.message);
      }
    };
    // Declenche la demande peu apres la creation du socket
    setTimeout(requestCode, 1000);
  }

  // ── Connexion update ──
  sock.ev.on('connection.update', async function (update) {
    var connection = update.connection;
    var lastDisconnect = update.lastDisconnect;

    if (connection === 'connecting') {
      if (session.status === 'starting') session.status = 'connecting';
    }

    if (connection === 'close') {
      var statusCode =
        lastDisconnect &&
        lastDisconnect.error &&
        lastDisconnect.error.output &&
        lastDisconnect.error.output.statusCode;

      session.isConnected = false;

      // 401 / loggedOut : session invalide, on nettoie tout
      if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
        console.log('Session #' + session.id + ' deconnectee definitivement (logout).');
        session.status = 'logged_out';
        session.pairingCode = null;
        var dir = path.join(AUTH_DIR, 'session_' + session.phone);
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
        return;
      }

      // 515 (restart required) : NORMAL juste apres l'appairage.
      // Il faut simplement relancer la connexion.
      if (statusCode === DisconnectReason.restartRequired || statusCode === 515) {
        console.log('Session #' + session.id + ' restart requis (515) — reconnexion immediate...');
        startSession(session).catch(function (e) {
          console.error('Reconnexion 515 echouee #' + session.id + ':', e.message);
        });
        return;
      }

      // Autres deconnexions : reconnexion avec backoff
      session.retries = (session.retries || 0) + 1;
      if (session.retries > 8) {
        console.log('Session #' + session.id + ' trop de tentatives — arret.');
        session.status = 'error';
        return;
      }
      var delay = Math.min(3000 * session.retries, 30000);
      session.status = 'reconnecting';
      console.log('Session #' + session.id + ' reconnexion dans ' + (delay / 1000) + 's (tentative ' + session.retries + ')');
      setTimeout(function () {
        startSession(session).catch(function (e) {
          console.error('Reconnexion echouee #' + session.id + ':', e.message);
        });
      }, delay);
    }

    if (connection === 'open') {
      session.isConnected = true;
      session.pairingCode = null;
      session.status = 'connected';
      session.retries = 0;
      console.log('Session #' + session.id + ' (+' + session.phone + ') connectee !');
    }
  });

  // ── Membres groupe ──
  sock.ev.on('group-participants.update', async function (event) {
    var groupId = event.id;
    var participants = event.participants;
    var action = event.action;
    for (var i = 0; i < participants.length; i++) {
      if (action === 'add') {
        await groupManager.welcomeMember(sock, groupId, participants[i]).catch(console.error);
      } else if (action === 'remove' || action === 'leave') {
        await groupManager.farewellMember(sock, groupId, participants[i]).catch(console.error);
      }
    }
  });

  // ── Messages ──
  sock.ev.on('messages.upsert', async function (upsert) {
    if (upsert.type !== 'notify') return;
    var msgs = upsert.messages;
    for (var i = 0; i < msgs.length; i++) {
      await handleMessage(sock, msgs[i], session);
    }
  });

  return sock;
}

// ── Traitement message ──
async function handleMessage(sock, msg, session) {
  try {
    if (!msg.message) return;
    if (msg.key.fromMe) return;

    var groupId = msg.key.remoteJid;
    if (!groupId) return;
    if (!groupId.endsWith('@g.us')) return;

    var senderId = msg.key.participant || msg.key.remoteJid;
    var senderName = msg.pushName || senderId.split('@')[0];

    var text = '';
    if (msg.message.conversation) {
      text = msg.message.conversation;
    } else if (msg.message.extendedTextMessage) {
      text = msg.message.extendedTextMessage.text || '';
    } else if (msg.message.imageMessage) {
      text = msg.message.imageMessage.caption || '';
    }
    text = text.trim();
    if (!text) return;

    var permBanned = await memberManager.isPermanentlyBanned(senderId);
    if (permBanned) return;

    var groupMetadata = await sock.groupMetadata(groupId).catch(function () { return null; });

    var isAdminInGroup = false;
    if (groupMetadata && groupMetadata.participants) {
      for (var j = 0; j < groupMetadata.participants.length; j++) {
        var p = groupMetadata.participants[j];
        if (jidNormalizedUser(p.id) === jidNormalizedUser(senderId)) {
          if (p.admin) isAdminInGroup = true;
          break;
        }
      }
    }

    var isAdminDB = await memberManager.isAdmin(senderId);
    var isAdminUser =
      isAdminInGroup ||
      isAdminDB ||
      senderId === (session.phone + '@s.whatsapp.net');

    await memberManager.registerMember(senderId, senderName, isAdminUser);

    if (!isAdminUser) {
      var spamResult = antiSpam.checkSpam(senderId);
      if (spamResult.isSpam) {
        if (spamResult.isBanned) {
          await sock.sendMessage(groupId, {
            text: '⛔ @' + senderId.split('@')[0] + ' Banni temporairement pour spam. ' + spamResult.remaining + 's',
            mentions: [senderId],
          });
        }
        return;
      }
    }

    var linkBlocked = await groupManager.checkForLinks(sock, msg, groupId, senderId, isAdminUser);
    if (linkBlocked) return;

    var isCommand = text.startsWith('!');
    var parts = text.toLowerCase().split(' ');
    var command = parts[0];
    var args = parts.slice(1);

    if (isCommand) {
      if (isAdminUser) {
        var handledAdmin = await commands.handleAdminCommand(sock, msg, command, args, senderId, groupId);
        if (handledAdmin) return;
      }
      var handledMember = await commands.handleMemberCommand(sock, msg, command, args, senderId, groupId);
      if (handledMember) return;
    }

    if (!commands.isBotActive()) return;

    await sock.sendPresenceUpdate('composing', groupId);
    await new Promise(function (resolve) { setTimeout(resolve, config.aiDelay); });

    var aiResponse = await ai.askAI(senderId, text, senderName);

    await sock.sendMessage(groupId, {
      text: '🎩 @' + senderId.split('@')[0] + '\n\n' + aiResponse + '\n\n— ChapeauNoir | Mcamara',
      mentions: [senderId],
    });

    await sock.sendPresenceUpdate('paused', groupId);
  } catch (error) {
    console.error('Handler Error:', error.message);
  }
}

// ── Démarrage principal ──
async function startBot() {
  startWebServer(process.env.PORT || 3000);
  await restoreSessions();
  console.log('Bot demarre. Ouvre la page web pour connecter un numero.');
}

module.exports = { startBot };

// ── Page HTML multi-connexion ──
function getHTML() {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>ChapeauNoir — Multi Connexion</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{
      background:#000;
      background-image:
        radial-gradient(circle at 20% 50%,rgba(0,255,136,0.04) 0%,transparent 50%),
        radial-gradient(circle at 80% 20%,rgba(255,170,0,0.04) 0%,transparent 50%);
      font-family:Arial,sans-serif;
      min-height:100vh;
      padding:20px;
      color:#fff;
    }
    .header{text-align:center;margin-bottom:30px}
    .logo{font-size:50px}
    h1{color:#00ff88;font-size:26px;margin:10px 0 5px}
    .sub{color:#888;font-size:13px}
    .add-card{
      background:rgba(255,255,255,0.05);
      border:1px solid rgba(0,255,136,0.3);
      border-radius:16px;padding:25px;max-width:480px;margin:0 auto 30px;
    }
    .add-card h2{color:#00ff88;font-size:16px;margin-bottom:8px}
    .add-card .hint{color:#777;font-size:12px;margin-bottom:15px;line-height:1.5}
    .input-row{display:flex;gap:10px;align-items:center}
    input[type=tel]{
      flex:1;background:#111;border:1px solid rgba(0,255,136,0.4);border-radius:10px;
      padding:12px 14px;color:#fff;font-size:15px;outline:none;
    }
    input[type=tel]::placeholder{color:#444}
    .btn-add{
      padding:12px 20px;background:linear-gradient(135deg,#00ff88,#00cc6a);border:none;
      border-radius:10px;color:#000;font-weight:bold;font-size:14px;cursor:pointer;white-space:nowrap;
    }
    .btn-add:disabled{opacity:0.5;cursor:not-allowed}
    .sessions-title{color:#aaa;font-size:14px;text-align:center;margin-bottom:15px}
    .sessions-grid{
      display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));
      gap:15px;max-width:900px;margin:0 auto;
    }
    .session-card{background:rgba(255,255,255,0.05);border-radius:14px;padding:20px;position:relative}
    .session-card.connected{border:1px solid rgba(0,255,136,0.5)}
    .session-card.waiting{border:1px solid rgba(255,170,0,0.4)}
    .session-card.pending{border:1px solid rgba(100,100,100,0.3)}
    .session-card.errored{border:1px solid rgba(255,68,68,0.4)}
    .session-num{font-size:11px;color:#555;margin-bottom:8px}
    .session-phone{font-size:16px;font-weight:bold;color:#fff;margin-bottom:12px}
    .badge{display:inline-block;padding:4px 10px;border-radius:20px;font-size:11px;font-weight:bold;margin-bottom:12px}
    .badge.ok{background:rgba(0,255,136,0.15);color:#00ff88}
    .badge.code{background:rgba(255,170,0,0.15);color:#ffaa00}
    .badge.wait{background:rgba(100,100,100,0.15);color:#888}
    .badge.err{background:rgba(255,68,68,0.15);color:#ff4444}
    .code-display{
      font-size:26px;font-weight:bold;color:#ffaa00;letter-spacing:4px;background:#111;
      border:1px solid #ffaa00;border-radius:10px;padding:12px;text-align:center;margin:10px 0;cursor:pointer;
    }
    .steps{background:rgba(0,0,0,0.3);border-radius:8px;padding:10px 14px;margin-top:8px}
    .steps p{color:#888;font-size:11px;margin:3px 0;line-height:1.5}
    .steps b{color:#00ff88}
    .btn-remove{
      position:absolute;top:12px;right:12px;background:rgba(255,68,68,0.15);border:none;
      color:#ff4444;border-radius:6px;padding:4px 8px;font-size:11px;cursor:pointer;
    }
    .empty{text-align:center;color:#555;padding:40px;grid-column:1/-1}
    .msg{
      background:rgba(0,255,136,0.1);border:1px solid rgba(0,255,136,0.3);border-radius:8px;
      padding:10px 15px;color:#00ff88;font-size:13px;margin-top:12px;display:none;
    }
    .msg.error{background:rgba(255,68,68,0.1);border-color:rgba(255,68,68,0.3);color:#ff4444}
  </style>
</head>
<body>
<div class="header">
  <div class="logo">🎩</div>
  <h1>ChapeauNoir — Multi Connexion</h1>
  <div class="sub">by Mcamara | Connecte plusieurs numéros WhatsApp</div>
</div>

<div class="add-card">
  <h2>➕ Connecter un numéro</h2>
  <div class="hint">Entre ton numéro complet au format international, SANS le +, SANS espaces ni zéro initial.<br>Exemple Guinée : <b style="color:#00ff88">224661817807</b></div>
  <div class="input-row">
    <input type="tel" id="phoneInput" placeholder="224661817807" maxlength="15"/>
    <button class="btn-add" onclick="addSession()" id="btnAdd">Connecter</button>
  </div>
  <div class="msg" id="addMsg"></div>
</div>

<div class="sessions-title">Sessions actives — <span id="sessionCount">0</span></div>
<div class="sessions-grid" id="sessionsGrid">
  <div class="empty">Aucune session — ajoute un numéro ci-dessus</div>
</div>

<script>
  loadSessions();
  setInterval(loadSessions, 3000);

  async function loadSessions() {
    try {
      var res = await fetch('/status');
      var data = await res.json();
      renderSessions(data.sessions || []);
    } catch(e) {}
  }

  function renderSessions(sessions) {
    var grid = document.getElementById('sessionsGrid');
    document.getElementById('sessionCount').textContent = sessions.length;
    if (sessions.length === 0) {
      grid.innerHTML = '<div class="empty">Aucune session — ajoute un numéro ci-dessus</div>';
      return;
    }
    grid.innerHTML = sessions.map(function(s) {
      var removeBtn = '<button class="btn-remove" onclick="removeSession(' + s.id + ')">✕</button>';
      if (s.isConnected) {
        return '<div class="session-card connected">' + removeBtn +
          '<div class="session-num">Session #' + s.id + '</div>' +
          '<div class="session-phone">+' + s.phone + '</div>' +
          '<span class="badge ok">✅ Connecté</span>' +
          '<div style="color:#888;font-size:12px">ChapeauNoir actif 🎩</div></div>';
      } else if (s.pairingCode) {
        return '<div class="session-card waiting">' + removeBtn +
          '<div class="session-num">Session #' + s.id + '</div>' +
          '<div class="session-phone">+' + s.phone + '</div>' +
          '<span class="badge code">⏳ Entre le code dans WhatsApp</span>' +
          '<div class="code-display" onclick="copyCode(this)">' + s.pairingCode + '</div>' +
          '<div class="steps">' +
          '<p><b>Comment entrer le code :</b></p>' +
          '<p>1. Ouvre WhatsApp sur le téléphone du numéro</p>' +
          '<p>2. Réglages → Appareils connectés</p>' +
          '<p>3. Connecter un appareil</p>' +
          '<p>4. "Connecter avec numéro de téléphone"</p>' +
          '<p>5. Entre : <b>' + s.pairingCode + '</b></p>' +
          '</div></div>';
      } else if (s.status === 'error' || s.status === 'logged_out') {
        return '<div class="session-card errored">' + removeBtn +
          '<div class="session-num">Session #' + s.id + '</div>' +
          '<div class="session-phone">+' + s.phone + '</div>' +
          '<span class="badge err">❌ ' + (s.status === 'logged_out' ? 'Déconnecté' : 'Erreur') + '</span>' +
          '<div style="color:#777;font-size:12px;margin-top:8px">Supprime et reconnecte</div></div>';
      } else {
        return '<div class="session-card pending">' + removeBtn +
          '<div class="session-num">Session #' + s.id + '</div>' +
          '<div class="session-phone">+' + s.phone + '</div>' +
          '<span class="badge wait">⏳ Génération du code...</span>' +
          '<div style="color:#555;font-size:12px;margin-top:8px">Patiente quelques secondes</div></div>';
      }
    }).join('');
  }

  function copyCode(el) {
    var code = el.textContent.replace(/-/g, '');
    navigator.clipboard.writeText(code).catch(function(){});
    var old = el.textContent;
    el.textContent = 'Copié !';
    setTimeout(function(){ el.textContent = old; }, 1000);
  }

  async function addSession() {
    var input = document.getElementById('phoneInput').value.replace(/[^0-9]/g, '');
    var btn = document.getElementById('btnAdd');
    if (!input || input.length < 10) {
      showMsg('❌ Entre un numéro complet au format international (ex: 224661817807)', true);
      return;
    }
    btn.disabled = true;
    showMsg('⏳ Connexion en cours...', false);
    try {
      var res = await fetch('/add-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: input }),
      });
      var data = await res.json();
      if (data.success) {
        showMsg('✅ Session créée ! Le code apparaît dans quelques secondes.', false);
        document.getElementById('phoneInput').value = '';
      } else {
        showMsg('❌ Erreur: ' + (data.error || 'Inconnue'), true);
      }
    } catch(e) {
      showMsg('❌ Erreur réseau', true);
    }
    btn.disabled = false;
  }

  async function removeSession(id) {
    if (!confirm('Supprimer cette session ?')) return;
    try {
      await fetch('/remove-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: id }),
      });
      loadSessions();
    } catch(e) {}
  }

  function showMsg(text, isError) {
    var el = document.getElementById('addMsg');
    el.textContent = text;
    el.className = 'msg' + (isError ? ' error' : '');
    el.style.display = 'block';
    setTimeout(function() { el.style.display = 'none'; }, 5000);
  }
</script>
</body>
</html>`;
}
