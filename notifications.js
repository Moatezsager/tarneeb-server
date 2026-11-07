'use strict';
const {randomBytes} = require('node:crypto');

function createNotifications() {
  const epoch = randomBytes(8).toString('hex');
  const inboxes = new Map();
  const waiting = new Map();
  let sequence = 0;

  function snapshot(uid, cursor) {
    const prefix = epoch + ':';
    const known = cursor.startsWith(prefix);
    const after = known ? Number(cursor.slice(prefix.length)) : 0;
    const events = (inboxes.get(uid) || []).filter(event => event.sequence > after && event.until > Date.now());
    return {cursor: prefix + sequence, reset: !!cursor && !known, events};
  }

  function publish(uid, event) {
    const inbox = inboxes.get(uid) || [];
    inboxes.delete(uid);
    if (inboxes.size >= 512) inboxes.delete(inboxes.keys().next().value);
    inboxes.set(uid, [...inbox.slice(-15), {...event, sequence: ++sequence, until: Date.now() + 300000}]);
    waiting.get(uid)?.finish();
  }

  function wait(uid, cursor, signal) {
    const current = snapshot(uid, cursor);
    if (!cursor || current.reset || current.events.length || signal.aborted) return current;
    const previous = waiting.get(uid);
    if (previous || waiting.size >= 128) return {...current, retry: 8};
    return new Promise(resolve => {
      const finish = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', finish);
        waiting.delete(uid);
        resolve(snapshot(uid, cursor));
      };
      const timer = setTimeout(finish, 22000);
      waiting.set(uid, {finish});
      signal.addEventListener('abort', finish, {once:true});
    });
  }

  return {publish, wait};
}

module.exports = {createNotifications};
