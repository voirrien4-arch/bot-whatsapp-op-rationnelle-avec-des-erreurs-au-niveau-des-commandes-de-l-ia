var config = require('./config');

var spamTracker = new Map();
var tempBanned = new Map();

function checkSpam(userId) {
  var now = Date.now();

  if (tempBanned.has(userId)) {
    var banEnd = tempBanned.get(userId);
    if (now < banEnd) {
      return { isSpam: true, isBanned: true, remaining: Math.ceil((banEnd - now) / 1000) };
    }
    tempBanned.delete(userId);
  }

  if (!spamTracker.has(userId)) {
    spamTracker.set(userId, { count: 0, firstMessage: now });
  }

  var tracker = spamTracker.get(userId);

  if (now - tracker.firstMessage > config.spamWindow) {
    tracker.count = 1;
    tracker.firstMessage = now;
    return { isSpam: false, count: 1 };
  }

  tracker.count++;

  if (tracker.count > config.spamLimit) {
    tempBanned.set(userId, now + 5 * 60 * 1000);
    spamTracker.delete(userId);
    return { isSpam: true, isBanned: true, remaining: 300 };
  }

  return { isSpam: false, count: tracker.count };
}

function unbanUser(userId) {
  tempBanned.delete(userId);
  spamTracker.delete(userId);
}

function isBanned(userId) {
  return tempBanned.has(userId);
}

module.exports = { checkSpam, unbanUser, isBanned };
