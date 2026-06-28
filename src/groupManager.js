var memberManager = require('./memberManager');
var config = require('./config');

async function welcomeMember(sock, groupId, participant) {
  var name = participant.split('@')[0];
  var welcomeMsg = '🎩 *Bienvenue ' + name + ' !*\n\n' +
    'Ravi de t\'accueillir dans le groupe *Chapeau Noir* !\n\n' +
    '*Tu peux :*\n' +
    '🤖 Parler avec ChapeauNoir sur le hacking ethique\n' +
    '📚 Apprendre la cybersecurite\n' +
    '💬 Partager tes connaissances\n\n' +
    '*Commandes :*\n' +
    '• !aide — Voir les commandes\n' +
    '• !regles — Regles du groupe\n' +
    '• !topics — Sujets disponibles\n\n' +
    '🔗 Lien du groupe : ' + (config.groupLink || 'Bientot disponible') + '\n\n' +
    'Pose ta premiere question sur le hacking ethique ! 🔐';

  await sock.sendMessage(groupId, { text: welcomeMsg });
  await memberManager.registerMember(participant, name, false);
}

async function farewellMember(sock, groupId, participant) {
  var name = participant.split('@')[0];
  await sock.sendMessage(groupId, {
    text: '👋 *' + name + '* a quitte le groupe.\nA bientot ! 🎩',
  });
}

async function checkForLinks(sock, msg, groupId, senderId, isAdminUser) {
  if (isAdminUser) return false;
  var text = '';
  if (msg.message && msg.message.conversation) {
    text = msg.message.conversation;
  } else if (msg.message && msg.message.extendedTextMessage) {
    text = msg.message.extendedTextMessage.text || '';
  }
  var linkRegex = /(https?:\/\/[^\s]+|chat\.whatsapp\.com\/[^\s]+)/gi;
  if (linkRegex.test(text)) {
    await sock.sendMessage(groupId, {
      text: '🚫 @' + senderId.split('@')[0] + ' Les liens ne sont pas autorises.\nSeuls les admins peuvent partager des liens.',
      mentions: [senderId],
    });
    await sock.sendMessage(groupId, { delete: msg.key }).catch(function() {});
    return true;
  }
  return false;
}

module.exports = { welcomeMember, farewellMember, checkForLinks };
