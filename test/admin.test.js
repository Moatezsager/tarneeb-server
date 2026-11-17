'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {presenceView,ONLINE_MS}=require('../service');
const {createAdmin}=require('../admin');

function fakeDb(seed={}){
  const state=new Map(Object.entries(seed));
  const snapshot=ref=>({id:ref.id,ref,exists:state.has(ref.path),data:()=>state.get(ref.path)});
  const doc=path=>{
    const id=path.split('/').at(-1);
    return {path,id,get:async()=>snapshot({path,id})};
  };
  function collection(name){
    const filters=[];
    const builder={
      where(field,op,value){filters.push([field,op,value]);return builder;},
      limit(){return builder;},
      orderBy(){return builder;},
      async get(){
        const matched=[...state.entries()].filter(([path,data])=>
          path.split('/').length===2&&path.split('/')[0]===name&&
          filters.every(([field,op,value])=>op!=='=='||data[field]===value));
        const docs=matched.map(([path,data])=>({id:path.split('/').at(-1),data:()=>data,
          ref:{path,delete:async()=>{state.delete(path);}}}));
        return {size:docs.length,docs};
      },
      async add(data){
        const path=`${name}/audit-${state.size}`;
        state.set(path,data);
        return {path,id:path.split('/').at(-1),async update(patch){state.set(path,{...state.get(path),...patch});}};
      }
    };
    return builder;
  }
  return {state,doc,collection,async getAll(...refs){return refs.map(snapshot);}};
}

const clock=1794700000000;
const at=ms=>({toMillis:()=>ms});

test('presence stays online across the three-minute hub heartbeat',()=>{
  assert.equal(ONLINE_MS,200000);
  assert.equal(presenceView({status:'online',lastSeen:at(clock-199000)},clock).online,true);
  assert.equal(presenceView({status:'online',lastSeen:at(clock-201000)},clock).status,'offline');
  assert.equal(presenceView({status:'offline',lastSeen:at(clock)},clock).online,false);
  assert.deepEqual(presenceView({},clock),{online:false,status:'offline',lastSeenAt:0});
});

test('administrator user listing reports real presence and profile identifiers',async()=>{
  const now=Date.now();
  const db=fakeDb({
    'users/player':{name:'لاعب',searchId:'LY-ABC123',country:'LY',status:'online',lastSeen:at(now-5000),economy:{gold:12,points:4}},
  });
  const auth={async listUsers(){return {users:[{uid:'player',email:'p@example.test',metadata:{lastSignInTime:'2026-11-16T10:00:00Z'}}],pageToken:''};}};
  const admin=createAdmin(db,auth,new Set(['owner']));
  const {items}=await admin('owner','users',{cursor:''});
  assert.equal(items.length,1);
  assert.equal(items[0].online,true);
  assert.equal(items[0].lastSeen,now-5000);
  assert.equal(items[0].searchId,'LY-ABC123');
  assert.equal(items[0].gold,12);
  assert.equal(items[0].lastSignIn,'2026-11-16T10:00:00Z');
  assert.equal(items[0].protected,false);
});

test('administrator user search resolves uid, email and player id without leaking others',async()=>{
  const db=fakeDb({'users/player':{name:'لاعب',searchId:'LY-ABC123',status:'online',lastSeen:at(clock),economy:{gold:3}}});
  const auth={
    async getUser(uid){if(uid==='player')return {uid,metadata:{}};throw Object.assign(Error('missing'),{code:'auth/user-not-found'});},
    async getUserByEmail(email){if(email==='p@example.test')return {uid:'player',metadata:{}};throw Object.assign(Error('missing'),{code:'auth/user-not-found'});},
    async listUsers(){return {users:[]};}
  };
  const admin=createAdmin(db,auth,new Set(['owner']));
  assert.equal((await admin('owner','findUser',{query:'player'})).item.uid,'player');
  assert.equal((await admin('owner','findUser',{query:'LY-ABC123'})).item.uid,'player');
  assert.equal((await admin('owner','findUser',{query:'p@example.test'})).item.uid,'player');
  assert.equal((await admin('owner','findUser',{query:'ghost'})).item,null);
  await assert.rejects(admin('owner','findUser',{query:'   '}),e=>e.code==='invalid-argument');
  await assert.rejects(admin('player','findUser',{query:'player'}),e=>e.code==='permission-denied');
});

test('administrator can revoke sessions but not for protected or deleting accounts',async()=>{
  const revoked=[];
  const audit=[];
  const db=fakeDb({'accountDeletions/ghost':{state:'pending'}});
  db.collection=((original)=>name=>{
    if(name!=='adminAudit')return original(name);
    return {...original(name),async add(data){audit.push({...data,state:data.state});return {async update(patch){Object.assign(audit.at(-1),patch);}};}};
  })(db.collection);
  const auth={async revokeRefreshTokens(uid){revoked.push(uid);}};
  const admin=createAdmin(db,auth,new Set(['owner']));
  await assert.rejects(admin('owner','revokeSessions',{uid:'owner'}),e=>e.code==='permission-denied');
  await assert.rejects(admin('owner','revokeSessions',{uid:'ghost'}),e=>e.code==='failed-precondition');
  assert.deepEqual(await admin('owner','revokeSessions',{uid:'player'}),{updated:true});
  assert.deepEqual(revoked,['player']);
  assert.equal(audit.length,1);
  assert.equal(audit[0].action,'revokeSessions');
  assert.equal(audit[0].state,'completed');
});

test('administrator room listing exposes seat status, latency and bots',async()=>{
  const db=fakeDb({'rooms/r1':{code:'ABC123',status:'playing',hostName:'سالم',mode:'FFA',locked:false,
    players:[{name:'سالم',index:0,status:'connected',latencyMs:180},{name:'عمر',index:1,status:'disconnected'}],
    botSeats:[2,3],createdAt:at(clock-60000),updatedAt:at(clock),expiresAt:at(clock+3600000)}});
  const admin=createAdmin(db,{},new Set(['owner']));
  const {items}=await admin('owner','rooms',{});
  assert.equal(items[0].players[0].latencyMs,180);
  assert.equal(items[0].players[1].status,'disconnected');
  assert.deepEqual(items[0].botSeats,[2,3]);
  assert.equal(items[0].updatedAt,clock);
});
