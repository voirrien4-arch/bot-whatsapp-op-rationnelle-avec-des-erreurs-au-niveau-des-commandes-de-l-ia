var config = require('./config');
var memberManager = require('./memberManager');
var ai = require('./ai');
var antiSpam = require('./antiSpam');

var botActive = true;

function isBotActive() { return botActive; }
function setBotActive(state) { botActive = state; }

async function handleAdminCommand(sock, msg, command, args, senderId, groupId) {
  switch (command) {
    case '!on':
      botActive = true;
      await sock.sendMessage(groupId, { text: '✅ *ChapeauNoir active !* 🎩' });
      break;

    case '!off':
      botActive = false;
      await sock.sendMessage(groupId, { text: '🔴 *ChapeauNoir desactive.*' });
      break;

    case '!ban':
      if (msg.message && msg.message.extendedTextMessage &&
          msg.message.extendedTextMessage.contextInfo &&
          msg.message.extendedTextMessage.contextInfo.participant) {
        var target = msg.message.extendedTextMessage.contextInfo.participant;
        var reason = args.join(' ') || 'Violation des regles';
        await memberManager.banMember(target, reason);
        await sock.groupParticipantsUpdate(groupId, [target], 'remove').catch(function() {});
        await sock.sendMessage(groupId, { text: '🚫 *Membre banni*\nRaison: ' + reason });
      }
      break;

    case '!unban':
      if (args[0]) {
        await memberManager.unbanMember(args[0] + '@s.whatsapp.net');
        antiSpam.unbanUser(args[0] + '@s.whatsapp.net');
        await sock.sendMessage(groupId, { text: '✅ ' + args[0] + ' debanni.' });
      }
      break;

    case '!admin':
      if (msg.message && msg.message.extendedTextMessage &&
          msg.message.extendedTextMessage.contextInfo &&
          msg.message.extendedTextMessage.contextInfo.participant) {
        var t = msg.message.extendedTextMessage.contextInfo.participant;
        await memberManager.setAdmin(t, true);
        await sock.groupParticipantsUpdate(groupId, [t], 'promote').catch(function() {});
        await sock.sendMessage(groupId, { text: '⭐ Nouveau admin promu !' });
      }
      break;

    case '!deadmin':
      if (msg.message && msg.message.extendedTextMessage &&
          msg.message.extendedTextMessage.contextInfo &&
          msg.message.extendedTextMessage.contextInfo.participant) {
        var t2 = msg.message.extendedTextMessage.contextInfo.participant;
        await memberManager.setAdmin(t2, false);
        await sock.groupParticipantsUpdate(groupId, [t2], 'demote').catch(function() {});
        await sock.sendMessage(groupId, { text: '🔽 Admin retrograde.' });
      }
      break;

    case '!annonce':
      var annonce = args.join(' ');
      if (annonce) {
        await sock.sendMessage(groupId, {
          text: '📢 *ANNONCE OFFICIELLE*\n\n' + annonce + '\n\n🎩 *— Mcamara | Chapeau Noir*',
        });
      }
      break;

    case '!setlink':
      if (args[0]) {
        config.groupLink = args[0];
        await sock.sendMessage(groupId, { text: '✅ Lien du groupe mis a jour !' });
      }
      break;

    case '!stats':
      var members = await memberManager.getAllMembers();
      var total = Object.keys(members).length;
      var admins = Object.values(members).filter(function(m) { return m.isAdmin; }).length;
      await sock.sendMessage(groupId, {
        text: '📊 *Statistiques*\n\n👥 Membres: ' + total + '\n⭐ Admins: ' + admins + '\n🤖 Bot: ' + (botActive ? '✅ Actif' : '🔴 Inactif') + '\n\n🎩 ChapeauNoir',
      });
      break;

    case '!reset':
      if (args[0]) {
        ai.resetConversation(args[0] + '@s.whatsapp.net');
        await sock.sendMessage(groupId, { text: '🔄 Historique reinitialise pour ' + args[0] });
      } else {
        ai.resetConversation(senderId);
        await sock.sendMessage(groupId, { text: '🔄 Votre historique reinitialise.' });
      }
      break;

    case '!annoncetous':
      var msg2 = args.join(' ');
      if (msg2) {
        var allMembers = await memberManager.getAllMembers();
        var ids = Object.keys(allMembers);
        for (var i = 0; i < ids.length; i++) {
          await sock.sendMessage(ids[i], {
            text: '📢 *Message de Mcamara*\n\n' + msg2 + '\n\n🎩 Chapeau Noir',
          }).catch(function() {});
        }
        await sock.sendMessage(groupId, { text: '✅ Message envoye a tous.' });
      }
      break;

    default:
      return false;
  }
  return true;
}

async function handleMemberCommand(sock, msg, command, args, senderId, groupId) {
  var member = await memberManager.getMember(senderId);
  var memberName = member ? member.name : (msg.pushName || 'Membre');

  switch (command) {
    case '!aide':
    case '!help':
      await sock.sendMessage(groupId, {
        text: '🎩 *ChapeauNoir — Commandes*\n\n' +
          '!aide — Cette aide\n' +
          '!lien — Lien du groupe\n' +
          '!regles — Regles\n' +
          '!apropos — A propos\n' +
          '!profil — Ton profil\n' +
          '!topics — Sujets IA\n' +
          '!reset — Reset historique IA\n\n' +
          '🤖 Pose ta question sur le hacking ethique !',
      });
      break;

    case '!lien':
      await sock.sendMessage(groupId, {
        text: '🔗 *Lien du groupe*\n\n' + (config.groupLink || 'Non configure') + '\n\nPartage avec tes amis ! 🎩',
      });
      break;

    case '!regles':
      await sock.sendMessage(groupId, {
        text: '📋 *Regles — Chapeau Noir*\n\n' +
          '1️⃣ Respect mutuel\n' +
          '2️⃣ Hacking ethique uniquement\n' +
          '3️⃣ Pas de spam\n' +
          '4️⃣ Pas de contenu illegal\n' +
          '5️⃣ Questions liees a la cybersecurite\n' +
          '6️⃣ Partage tes connaissances\n' +
          '7️⃣ Admins = dernier mot\n\n' +
          '⚠️ Violation = ban\n🎩 Mcamara',
      });
      break;

    case '!apropos':
      await sock.sendMessage(groupId, {
        text: '🎩 *ChapeauNoir Assistant*\n\n' +
          'Assistant IA specialise en hacking ethique.\n\n' +
          '👨‍💻 Createur: Mcamara — Chapeau Noir\n' +
          '🔒 Specialite: Cybersecurite & CTF\n' +
          '⚡ Delai: ~2.9 secondes\n\n' +
          'Pose-moi une question !',
      });
      break;

    case '!profil':
      var histCount = ai.getHistoryCount(senderId);
      await sock.sendMessage(groupId, {
        text: '👤 *Ton profil*\n\n' +
          '📛 Nom: ' + memberName + '\n' +
          '📨 Messages: ' + (member ? member.messageCount : 0) + '\n' +
          '💬 Messages IA: ' + histCount + '\n' +
          '⭐ Statut: ' + (member && member.isAdmin ? 'Admin' : 'Membre') + '\n' +
          '📅 Depuis: ' + (member && member.joinedAt ? new Date(member.joinedAt).toLocaleDateString('fr-FR') : 'Inconnu'),
      });
      break;

    case '!topics':
      await sock.sendMessage(groupId, {
        text: '📚 *Sujets disponibles*\n\n' +
          '🔓 Ethical Hacking\n' +
          '🛡️ Cybersecurite defensive\n' +
          '🏴 CTF\n' +
          '🌐 Web Hacking (SQLi, XSS...)\n' +
          '🔑 Cryptographie\n' +
          '📡 Reseau & Protocoles\n' +
          '🐧 Kali Linux\n' +
          '🔧 Metasploit, Burp Suite, Nmap\n' +
          '🐍 Python securite\n' +
          '🔍 OSINT\n' +
          '☁️ Cloud Security\n\n' +
          'Pose ta question ! 🎩',
      });
      break;

    case '!reset':
      ai.resetConversation(senderId);
      await sock.sendMessage(groupId, {
        text: '🔄 Historique reinitialise ! Comment puis-je t\'aider ? 🎩',
      });
      break;

    default:
      return false;
  }
  return true;
}

module.exports = { handleAdminCommand, handleMemberCommand, isBotActive, setBotActive };
