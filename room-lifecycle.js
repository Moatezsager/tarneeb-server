'use strict';

function removeMember(room, secret, uid) {
  room.players = room.players.filter(player => player.uid !== uid);
  room.memberUids = room.memberUids.filter(member => member !== uid);
  if (secret?.presence) delete secret.presence[uid];
  if (room.hostId === uid) {
    const host = room.players.find(player => player.status === 'connected') || room.players[0];
    room.hostId = host?.uid || '';
    room.hostName = host?.name || '';
  }
}

async function removeRoom(tx, db, roomId, members = []) {
  const pointers = members.map(uid => db.doc(`activeRooms/${uid}`));
  const [active, invites] = await Promise.all([
    pointers.length ? tx.getAll(...pointers) : [],
    tx.get(db.collection('roomInvites').where('roomId', '==', roomId).limit(200)),
  ]);
  for (const pointer of active) {
    if (pointer.data()?.roomId === roomId) tx.delete(pointer.ref);
  }
  for (const invite of invites.docs) tx.delete(invite.ref);
  tx.delete(db.doc(`rooms/${roomId}`));
  tx.delete(db.doc(`roomSecrets/${roomId}`));
}

module.exports = {removeMember, removeRoom};
