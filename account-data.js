'use strict';

const MAX_CONTACTS = 250;

async function economy(tx, db, uid, user) {
  if (user.economy) return {value:user.economy, legacy:[]};
  const [wallet, stats] = await tx.getAll(db.doc(`wallets/${uid}`), db.doc(`rankedStats/${uid}`));
  return {
    value:{
      gold:wallet.data()?.gold??0, owned:wallet.data()?.owned??[],
      points:stats.data()?.points??0, wins:stats.data()?.wins??0, games:stats.data()?.games??0,
    },
    legacy:[wallet,stats].filter(doc=>doc.exists),
  };
}

function saveEconomy(tx, ref, account) {
  tx.set(ref,{economy:account.value},{merge:true});
  for (const doc of account.legacy) tx.delete(doc.ref);
}

async function contacts(tx, db, uid, user) {
  if (Array.isArray(user.contacts)) return {items:user.contacts, legacy:[]};
  const legacy = (await tx.get(db.collection(`users/${uid}/friends`).limit(MAX_CONTACTS+1))).docs;
  // shortcut: oversized legacy lists stay in their subcollection to avoid truncation.
  if (legacy.length > MAX_CONTACTS) return null;
  const items = legacy.map(doc => {
    const {name,avatar,searchId,country,createdAt}=doc.data();
    return {uid:doc.id,name:name||'لاعب',avatar:avatar||'avatar_1',searchId:searchId||'',country:country||'',createdAt:createdAt?.toMillis()||0};
  });
  return {items, legacy};
}

function saveContacts(tx, db, uid, state) {
  tx.update(db.doc(`users/${uid}`),{contacts:state.items});
  for (const doc of state.legacy) tx.delete(doc.ref);
}

async function hasFriend(tx, db, uid, user, other) {
  if (Array.isArray(user.contacts)) return user.contacts.some(friend=>friend.uid===other);
  return (await tx.get(db.doc(`users/${uid}/friends/${other}`))).exists;
}

module.exports = {economy, saveEconomy, contacts, saveContacts, hasFriend, MAX_CONTACTS};
