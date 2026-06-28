var axios = require('axios');
var FormData = require('form-data');
var config = require('./config');

var conversationHistory = new Map();

async function askAI(userId, message, memberName) {
  memberName = memberName || 'Membre';
  try {
    if (!conversationHistory.has(userId)) {
      conversationHistory.set(userId, []);
    }
    var history = conversationHistory.get(userId);

    var fullMessage = config.systemPrompt + '\n\nMembre: ' + memberName +
      '\nHistorique: ' + history.slice(-4).map(function(h) {
        return h.role + ': ' + h.content;
      }).join(' | ') +
      '\nQuestion: ' + message;

    history.push({ role: 'user', content: message });
    if (history.length > 20) history.splice(0, history.length - 20);

    var fd = new FormData();
    fd.append('text', fullMessage);

    var response = await axios.post(config.apiUrl, fd, {
      headers: fd.getHeaders(),
      timeout: 15000,
    });

    var aiReply =
      response.data && response.data.result ? response.data.result :
      response.data && response.data.reply ? response.data.reply :
      response.data && response.data.message ? response.data.message :
      'Reponds bientot. Reessaie.';

    history.push({ role: 'assistant', content: aiReply });
    return aiReply;

  } catch (error) {
    console.error('[AI Error]', error.message);
    if (error.code === 'ECONNABORTED') return 'Timeout — reessaie.';
    if (error.response && error.response.status === 429) return 'Trop de requetes — attends.';
    return 'Probleme technique — reessaie bientot. 🎩';
  }
}

function resetConversation(userId) {
  conversationHistory.delete(userId);
}

function getHistoryCount(userId) {
  var h = conversationHistory.get(userId);
  return h ? h.length : 0;
}

module.exports = { askAI, resetConversation, getHistoryCount };
