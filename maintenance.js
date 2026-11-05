'use strict';

const {Timestamp} = require('firebase-admin/firestore');
const {removeExpired, VERSION} = require('./service');
const {removeRoom} = require('./room-lifecycle');
const {processDeletion} = require('./account-deletion');

const INTERVAL_MS = 120000;
const ABANDONED_MS = 180000;
const EXPIRY_INTERVAL_MS = 15*60000;
const EXPIRING = ['rooms','roomSecrets','roomResults','operations','friendRequests','roomInvites','rateLimits','accountDeletions'];

function createMaintenance(db, auth, invalidateRoom) {
  const state = {running:false, lastRun:0, removed:0, accounts:0, errors:0, intervalSeconds:INTERVAL_MS/1000};
  let pointerCursor, nextPointerScan = 0, nextExpirySweep = 0, rerun = false;
  const snapshot = () => ({...state});

  function failure(error) {
    state.errors++;
    console.error(JSON.stringify({event:'cleanup_failed',code:String(error.code||'internal').slice(0,80)}));
  }
  async function sweep(query, remove) {
    try {
      const docs = (await query.limit(80).get()).docs;
      for (let i = 0; i < docs.length; i += 8) {
        const results = await Promise.allSettled(docs.slice(i,i+8).map(remove));
        for (const result of results) {
          if (result.status === 'rejected') failure(result.reason);
          else if (result.value) state.removed++;
        }
      }
      return docs.length;
    } catch (error) { failure(error); }
  }
  async function run() {
    if (state.running) return snapshot();
    state.running = true;
    state.removed = state.accounts = state.errors = 0;
    const now = Timestamp.now();
    try {
      const jobs = await db.collection('accountDeletions').where('nextAttemptAt','<=',now).limit(4).get();
      for (const job of jobs.docs) {
        try { if (await processDeletion(db,auth,job.ref,invalidateRoom)) state.accounts++; }
        catch (error) {
          failure(error);
          try {
            await db.runTransaction(async tx => {
              const current=await tx.get(job.ref);
              if(current.data()?.state==='pending')tx.update(job.ref,{nextAttemptAt:Timestamp.fromMillis(Date.now()+INTERVAL_MS)});
            });
          } catch (retryError) { failure(retryError); }
        }
      }
      if(now.toMillis()>=nextExpirySweep){
        let backlog=false;
        for (const name of EXPIRING) {
          const count=await sweep(db.collection(name).where('expiresAt','<=',now),async doc=>{
            const removed=await removeExpired(db,doc.ref,now);
            if(removed&&['rooms','roomSecrets','roomResults'].includes(name))invalidateRoom?.(doc.id);
            return removed;
          });
          backlog=backlog||count===80;
        }
        nextExpirySweep=now.toMillis()+(backlog?INTERVAL_MS:EXPIRY_INTERVAL_MS);
      }
      const cutoff = Timestamp.fromMillis(now.toMillis()-ABANDONED_MS);
      const stale = db.collection('rooms').where('protocolVersion','in',[2,VERSION])
        .where('updatedAt','<=',cutoff).orderBy('updatedAt','desc');
      await sweep(stale, async doc => {
        const removed=await db.runTransaction(async tx => {
          const room = (await tx.get(doc.ref)).data();
          if (!room || room.updatedAt.toMillis()>cutoff.toMillis()) return false;
          await removeRoom(tx,db,doc.id,room.memberUids);
          return true;
        });
        if(removed)invalidateRoom?.(doc.id);
        return removed;
      });

      if (now.toMillis() >= nextPointerScan) {
        nextPointerScan = now.toMillis()+15*60000;
        let query = db.collection('activeRooms').orderBy('__name__');
        if (pointerCursor) query=query.startAfter(pointerCursor);
        const page = await query.limit(40).get();
        pointerCursor = page.size===40 ? page.docs.at(-1).id : undefined;
        for (const doc of page.docs) {
          try {
            const removed = await db.runTransaction(async tx => {
              const pointer = (await tx.get(doc.ref)).data();
              if (!pointer) return false;
              const room = (await tx.get(db.doc(`rooms/${pointer.roomId}`))).data();
              if (room?.memberUids?.includes(doc.id)) return false;
              tx.delete(doc.ref);
              return true;
            });
            if (removed) state.removed++;
          } catch (error) { failure(error); }
        }
      }
    } catch (error) { failure(error); }
    finally {
      state.running = false;
      state.lastRun = Date.now();
      if (rerun) { rerun=false; setImmediate(run); }
    }
    return snapshot();
  }
  function request(forceExpiry=false) {
    if(forceExpiry)nextExpirySweep=0;
    if (state.running) rerun=true;
    else void run();
  }
  return {run,request,snapshot};
}

module.exports = {createMaintenance, INTERVAL_MS};
