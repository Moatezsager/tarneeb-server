'use strict';

const {Timestamp} = require('firebase-admin/firestore');
const {removeMember, removeRoom} = require('./room-lifecycle');

async function queueDeletion(db, uid, actor) {
  const job = db.doc(`accountDeletions/${uid}`);
  const profile = db.doc(`users/${uid}`);
  const audit = db.collection('adminAudit').doc();
  return db.runTransaction(async tx => {
    const [existing, user] = await tx.getAll(job, profile);
    if (existing.exists) return {state:existing.data().state};
    const createdAt = Timestamp.now();
    if (user.exists) tx.update(profile, {deleting:true});
    tx.create(job, {state:'pending', auditId:audit.id, createdAt, nextAttemptAt:createdAt});
    tx.create(audit, {actor, action:'deleteUser', target:uid, state:'pending', createdAt});
    return {state:'pending'};
  });
}

async function deleteMatching(db, query) {
  for (;;) {
    const page = await query.limit(100).get();
    if (page.empty) return;
    const batch = db.batch();
    for (const doc of page.docs) batch.delete(doc.ref);
    await batch.commit();
  }
}

async function detachRooms(db, uid, invalidateRoom) {
  const query = db.collection('rooms').where('memberUids','array-contains',uid);
  for (;;) {
    const page = await query.limit(25).get();
    if (page.empty) return;
    for (const doc of page.docs) {
      await db.runTransaction(async tx => {
        const secretRef = db.doc(`roomSecrets/${doc.id}`);
        const [current, secretDoc] = await tx.getAll(doc.ref, secretRef);
        const room = current.data();
        if (!room?.memberUids.includes(uid)) return;
        const members = room.memberUids;
        if (![2,3].includes(room.protocolVersion) || members.length === 1 || !secretDoc.exists || room.status === 'finished') {
          await removeRoom(tx, db, doc.id, members);
          return;
        }
        const secret = secretDoc.data();
        const seat = room.players.find(player => player.uid === uid)?.index;
        removeMember(room, secret, uid);
        room.chat = (room.chat || []).filter(message => message.uid !== uid);
        if (room.chatCooldown) delete room.chatCooldown[uid];
        if (secret.state && Number.isInteger(seat)) {
          const state = JSON.parse(secret.state);
          state.names[seat] = 'لاعب غادر';
          state.message = '';
          state.revision++;
          secret.state = JSON.stringify(state);
        }
        room.revision++;
        tx.set(doc.ref, room);
        tx.set(secretRef, secret);
      });
      invalidateRoom?.(doc.id);
    }
  }
}

async function processDeletion(db, auth, job, invalidateRoom) {
  const current = await job.get();
  if (current.data()?.state !== 'pending') return false;
  const uid = job.id;
  try { await auth.deleteUser(uid); }
  catch (error) { if (error.code !== 'auth/user-not-found') throw error; }

  await detachRooms(db, uid, invalidateRoom);
  const profile = db.doc(`users/${uid}`);
  // Remove reciprocal friendships while each original friend ID is still available for retries.
  for (;;) {
    const friends = await profile.collection('friends').limit(100).get();
    if (friends.empty) break;
    const batch = db.batch();
    for (const friend of friends.docs) {
      batch.delete(db.doc(`users/${friend.id}/friends/${uid}`));
      batch.delete(friend.ref);
    }
    await batch.commit();
  }
  for (const collection of ['friendRequests','roomInvites']) {
    for (const field of ['fromUid','toUid']) await deleteMatching(db,db.collection(collection).where(field,'==',uid));
  }
  for (const collection of ['searchIds','operations']) await deleteMatching(db,db.collection(collection).where('uid','==',uid));
  await deleteMatching(db,db.collection('roomResults').where('memberUids','array-contains',uid));
  await db.recursiveDelete(profile);

  const finishedAt = Timestamp.now();
  const batch = db.batch();
  for (const collection of ['wallets','rankedStats','activeRooms']) batch.delete(db.doc(`${collection}/${uid}`));
  batch.set(job, {state:'completed', finishedAt, expiresAt:Timestamp.fromMillis(finishedAt.toMillis()+86400000)});
  batch.update(db.doc(`adminAudit/${current.data().auditId}`),{state:'completed',finishedAt});
  await batch.commit();
  return true;
}

module.exports = {queueDeletion, processDeletion};
