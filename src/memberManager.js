var fs = require('fs-extra');
var path = require('path');

// Stockage persistant : utilise DATA_DIR (ex: disque monte /data sur Render/Katabump),
// sinon fallback dans le dossier data/ local du projet.
var DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
var membersFile = path.join(DATA_DIR, 'members.json');
var bannedFile = path.join(DATA_DIR, 'banned.json');

async function loadData(file) {
  try { return await fs.readJson(file); }
  catch(e) { return {}; }
}

async function saveData(file, data) {
  await fs.outputJson(file, data, { spaces: 2 });
}

async function registerMember(userId, name, isAdmin) {
  isAdmin = isAdmin || false;
  var members = await loadData(membersFile);
  if (!members[userId]) {
    members[userId] = {
      id: userId, name: name, isAdmin: isAdmin,
      joinedAt: new Date().toISOString(),
      messageCount: 0,
      lastSeen: new Date().toISOString(),
    };
  } else {
    members[userId].name = name;
    members[userId].lastSeen = new Date().toISOString();
    members[userId].messageCount = (members[userId].messageCount || 0) + 1;
    if (isAdmin) members[userId].isAdmin = true;
  }
  await saveData(membersFile, members);
  return members[userId];
}

async function getMember(userId) {
  var members = await loadData(membersFile);
  return members[userId] || null;
}

async function getAllMembers() {
  return await loadData(membersFile);
}

async function banMember(userId, reason) {
  reason = reason || 'Non specifie';
  var banned = await loadData(bannedFile);
  var members = await loadData(membersFile);
  banned[userId] = {
    id: userId,
    name: members[userId] ? members[userId].name : 'Inconnu',
    reason: reason,
    bannedAt: new Date().toISOString(),
  };
  await saveData(bannedFile, banned);
}

async function unbanMember(userId) {
  var banned = await loadData(bannedFile);
  delete banned[userId];
  await saveData(bannedFile, banned);
}

async function isPermanentlyBanned(userId) {
  var banned = await loadData(bannedFile);
  return !!banned[userId];
}

async function setAdmin(userId, status) {
  if (status === undefined) status = true;
  var members = await loadData(membersFile);
  if (members[userId]) {
    members[userId].isAdmin = status;
    await saveData(membersFile, members);
  }
}

async function isAdmin(userId) {
  var members = await loadData(membersFile);
  return members[userId] && members[userId].isAdmin === true;
}

module.exports = {
  registerMember, getMember, getAllMembers,
  banMember, unbanMember, isPermanentlyBanned,
  setAdmin, isAdmin,
};
