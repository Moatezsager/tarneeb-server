const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {randomBytes}=require('node:crypto');
const {initializeApp,deleteApp}=require('firebase-admin/app');
const {getFirestore,Timestamp}=require('firebase-admin/firestore');
const {createService,removeExpired}=require('../service');
const engine=require('../engine');
const {createAdmin}=require('../admin');
const enabled=process.env.FIRESTORE_EMULATOR_HOST==='127.0.0.1:18881';
let app,db,api,now=Date.now();
const rid=()=>randomBytes(16).toString('hex');
const call=(uid,op,payload={},requestId=rid())=>api(uid,{op,payload,requestId,protocolVersion:2});
const reject=(p,code)=>assert.rejects(p,e=>e.code===code);
before(async()=>{if(!enabled)return;app=initializeApp({projectId:'demo-tarneeb-secure'},'integration');db=getFirestore(app);api=createService(db,()=>now);});
after(async()=>{if(db)await db.terminate();if(app)await deleteApp(app);});
test('atomic profiles, social graph, invitations, room seats, server turns, retries and privacy',{skip:!enabled},async()=>{
  for(const uid of ['host','guest','third','fourth','fifth'])await call(uid,'profile',{name:uid,age:25,gender:'male',country:'LY',avatar:'avatar_1',complete:true});
  const profiles=await db.collection('users').get();assert.equal(new Set(profiles.docs.map(d=>d.data().searchId)).size,5);
  await reject(call('guest','profile',{uid:'host',name:'fake'}),'invalid-argument');
  await db.doc('users/host').set({legacyField:'preserved'},{merge:true});await call('host','profile',{name:'Changed'});assert.equal((await db.doc('users/host').get()).data().legacyField,'preserved');
  const search=(await db.doc('users/host').get()).data().searchId;assert.equal((await call('guest','search',{searchId:search})).profile.uid,'host');
  await call('host','requestFriend',{toUid:'guest'});const requests=await call('guest','requests');assert.equal(requests.items.length,1);
  await reject(call('third','answerFriend',{requestId:requests.items[0]._id,accept:true}),'permission-denied');
  const acceptId=rid();await Promise.all([call('guest','answerFriend',{requestId:requests.items[0]._id,accept:true},acceptId),call('guest','answerFriend',{requestId:requests.items[0]._id,accept:true},acceptId)]);
  assert((await db.doc('users/host/friends/guest').get()).exists);assert((await db.doc('users/guest/friends/host').get()).exists);
  const createId=rid(),params={mode:'Teams',target:31,difficulty:1,isPublic:false,password:'fixture-password'};
  const created=await call('host','createRoom',params,createId),roomId=created.room._id,code=created.room.code;
  assert.deepEqual(await call('host','createRoom',params,createId),created);assert.equal((await db.collection('rooms').get()).size,1);
  await reject(call('host','createRoom',{...params,target:61},createId),'invalid-argument');
  await reject(call('guest','joinRoom',{code,password:'wrong'}),'permission-denied');
  await reject(call('third','invite',{roomId,toUid:'guest'}),'permission-denied');
  await call('host','invite',{roomId,toUid:'guest'});const invite=(await call('guest','invites')).items[0];assert.equal(invite.roomId,roomId);
  await call('guest','answerInvite',{inviteId:invite._id,accept:true});
  const joins=await Promise.allSettled(['third','fourth','fifth'].map(uid=>call(uid,'joinRoom',{code,password:'fixture-password'})));
  assert.equal(joins.filter(x=>x.status==='fulfilled').length,2);
  let room=(await db.doc(`rooms/${roomId}`).get()).data();assert.equal(room.players.length,4);assert.equal(new Set(room.players.map(p=>p.index)).size,4);assert.equal(new Set(room.memberUids).size,4);
  const left=room.players.find(p=>p.index===2).uid,waiting=['third','fourth','fifth'].find(uid=>!room.memberUids.includes(uid));
  await call(left,'leave',{roomId});await call(waiting,'joinRoom',{code,password:'fixture-password'});
  room=(await db.doc(`rooms/${roomId}`).get()).data();assert.equal(room.players.find(p=>p.uid===waiting).index,2);
  await reject(call('guest','start',{roomId}),'permission-denied');await call('host','start',{roomId});
  const snapshot=await call('guest','poll',{roomId});assert.equal(snapshot.view.hand.length,13);assert(!('hands'in snapshot.view));assert(!('gameState'in snapshot.room));assert(!('password'in snapshot.room));assert(!('passwordHash'in snapshot.room));
  await reject(call(left,'poll',{roomId}),'permission-denied');
  let secret=(await db.doc(`roomSecrets/${roomId}`).get()).data(),state=JSON.parse(secret.state);
  assert.equal(snapshot.view.presentation,'reveal');assert.equal(await db.doc(`rooms/${roomId}`).get().then(d=>'gameState'in d.data()),false);
  now+=5000;const next=await call('guest','poll',{roomId});assert.equal(next.view.presentation,'');assert(next.view.revision>snapshot.view.revision);
  state=JSON.parse((await db.doc(`roomSecrets/${roomId}`).get()).data().state);
  room=(await db.doc(`rooms/${roomId}`).get()).data();const actor=room.players.find(p=>p.index===state.current).uid,other=room.players.find(p=>p.uid!==actor).uid;
  const card=engine.legal(state,state.current)[0],move={roomId,action:'play',value:card,expectedRevision:state.revision};
  await reject(call(other,'move',move),'invalid-argument');await reject(call(actor,'move',{...move,playerIdx:state.current}),'invalid-argument');await reject(call(actor,'move',{...move,expectedRevision:-1}),'failed-precondition');
  const moveId=rid();const concurrent=await Promise.all([call(actor,'move',move,moveId),call(actor,'move',move,moveId),...room.players.map(p=>call(p.uid,'poll',{roomId}))]);const moved=concurrent[0];assert.deepEqual(concurrent[1],moved);assert.deepEqual(await call(actor,'move',move,moveId),moved);
  const saved=JSON.parse((await db.doc(`roomSecrets/${roomId}`).get()).data().state);assert.equal(saved.revision,state.revision+1);
  await reject(call(actor,'move',move),'failed-precondition');
  await call('host','leave',{roomId});room=(await db.doc(`rooms/${roomId}`).get()).data();assert.notEqual(room.hostId,'host');assert.equal(room.status,'playing');
  now+=50000;const advanced=await call('guest','poll',{roomId});assert(advanced.view.revision>saved.revision,'server timeout advances even after host leaves');
  await call('host','removeFriend',{toUid:'guest'});assert(!(await db.doc('users/host/friends/guest').get()).exists);assert(!(await db.doc('users/guest/friends/host').get()).exists);
  assert.equal((await call('guest','activeRoom')).roomId,roomId);
});
function jwt(uid){const n=Math.floor(Date.now()/1000),enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url');return `${enc({alg:'none',typ:'JWT'})}.${enc({iss:'https://securetoken.google.com/demo-tarneeb-secure',aud:'demo-tarneeb-secure',iat:n,exp:n+3600,sub:uid,user_id:uid,firebase:{sign_in_provider:'custom',identities:{}}})}.`;}
test('disconnected host migrates, inactive waiting seats expire and can reconnect',{skip:!enabled},async()=>{
  for(const uid of ['leader','member'])await call(uid,'profile',{name:uid,age:25,gender:'male',country:'LY',avatar:'avatar_1',complete:true});
  const created=await call('leader','createRoom',{mode:'FFA',target:31,difficulty:1,isPublic:true,password:''});
  const roomId=created.room._id,code=created.room.code;
  await call('member','joinRoom',{code,password:''});
  now+=46000;let reply=await call('member','poll',{roomId});
  assert.equal(reply.room.hostId,'member');assert.equal(reply.room.players.find(p=>p.uid==='leader').status,'disconnected');
  now+=75000;reply=await call('member','poll',{roomId});
  assert.deepEqual(reply.room.memberUids,['member']);assert.equal((await call('leader','activeRoom')).roomId,'');
  await call('leader','joinRoom',{code,password:''});reply=await call('member','poll',{roomId});
  assert.equal(reply.room.players.length,2);assert.equal(new Set(reply.room.players.map(p=>p.index)).size,2);
  await call('member','fillBots',{roomId});
  await call('member','start',{roomId});
});
test('registration completion persists required details, preserves ID and keeps age private',{skip:!enabled},async()=>{
  const initial=await call('registration-user','profile',{initialize:true,name:'لاعب'});
  assert.equal(initial.profile.profileComplete,false);
  await reject(call('registration-user','createRoom',{mode:'FFA',target:31,difficulty:1,isPublic:true,password:''}),'failed-precondition');
  await reject(call('registration-user','profile',{name:'معتز',complete:true}),'invalid-argument');
  const saved=await call('registration-user','profile',{name:'معتز_1999',age:27,gender:'male',country:'LY',avatar:'avatar_12',complete:true});
  assert.equal(saved.profile.profileComplete,true);assert.equal(saved.profile.age,27);
  assert.equal(saved.profile.searchId,initial.profile.searchId);
  const restored=await call('registration-user','profile',{initialize:true,name:'Google name',gender:'other'});
  assert.equal(restored.profile.age,27);assert.equal(restored.profile.name,'معتز_1999');
  const found=await call('guest','search',{searchId:initial.profile.searchId});
  assert.equal(found.profile.avatar,'avatar_12');assert(!('age' in found.profile));
  assert.equal((await db.doc('users/registration-user').get()).data().age,27);
});
test('administrator closes rooms atomically and records account suspension',{skip:!enabled},async()=>{
  const changes=[];
  const admin=createAdmin(db,{updateUser:async(uid,data)=>changes.push([uid,data.disabled]),revokeRefreshTokens:async uid=>changes.push([uid,'revoked'])},new Set(['owner']));
  await call('admin-room-player','profile',{name:'Fixture',age:25,gender:'male',country:'LY',avatar:'avatar_1',complete:true});
  const created=await call('admin-room-player','createRoom',{mode:'FFA',target:31,difficulty:1,isPublic:true,password:''});
  const roomId=created.room._id;
  await admin('owner','closeRoom',{roomId});
  const room=(await db.doc(`rooms/${roomId}`).get()).data();
  assert.equal(room.status,'finished');assert.deepEqual(room.memberUids,[]);
  assert.equal((await db.doc(`roomSecrets/${roomId}`).get()).data().state,'');
  assert(!(await db.doc('activeRooms/admin-room-player').get()).exists);
  await reject(call('admin-room-player','poll',{roomId}),'permission-denied');
  await admin('owner','userStatus',{uid:'admin-room-player',disabled:true});
  assert.deepEqual(changes,[['admin-room-player',true],['admin-room-player','revoked']]);
  const log=await db.collection('adminAudit').get();assert.equal(log.size,2);assert(log.docs.every(d=>d.data().state==='completed'));
});
test('cleanup rechecks expiry after a concurrent renewal',{skip:!enabled},async()=>{
  const ref=db.doc('operations/cleanup-fixture'),cutoff=Timestamp.fromMillis(now);
  await ref.set({expiresAt:Timestamp.fromMillis(now-1)});
  const selected=await ref.get();
  await ref.update({expiresAt:Timestamp.fromMillis(now+1000)});
  assert.equal(await removeExpired(db,selected.ref,cutoff),false);assert((await ref.get()).exists);
  assert.equal(await removeExpired(db,ref,Timestamp.fromMillis(now+1001)),true);assert(!(await ref.get()).exists);
});
test('deployed-rule candidate denies direct mutations, private state and legacy rooms',{skip:!enabled},async()=>{
  const base='http://127.0.0.1:18881/v1/projects/demo-tarneeb-secure/databases/(default)/documents';
  await db.doc('rooms/legacy').set({hostId:'host',password:'fixture',memberUids:['guest'],gameState:{secret:'fixture'}});
  for(const [uid,path,method] of [['guest','wallets/guest','PATCH'],['guest','wallets/host','GET'],['guest','rooms/legacy','GET'],['guest','users/host','GET'],['guest','roomSecrets/anything','GET'],['guest','operations/anything','GET'],['guest','searchIds/anything','PATCH'],['guest','users/guest','PATCH'],['guest','rooms/new','PATCH'],['guest','users/host/friends/guest','PATCH'],['guest','friendRequests/forged','PATCH'],['guest','roomInvites/forged','PATCH'],['guest','rooms/legacy','DELETE']]){
    const res=await fetch(`${base}/${path}`,{method,headers:{Authorization:`Bearer ${jwt(uid)}`,'Content-Type':'application/json'},body:method==='PATCH'?JSON.stringify({fields:{uid:{stringValue:'guest'}}}):undefined});assert.equal(res.status,403,`${method} ${path}`);
  }
  const own=await fetch(`${base}/users/guest`,{headers:{Authorization:`Bearer ${jwt('guest')}`}});assert.equal(own.status,200);
  const noAuth=await fetch(`${base}/users/guest`);assert.equal(noAuth.status,403);
});

 test('explicit bot seats are host-only, idempotent and replaced by joining humans',{skip:!enabled},async()=>{
  for(const uid of ['bot-host','bot-guest'])await call(uid,'profile',{name:uid,age:25,gender:'male',country:'LY',avatar:'avatar_1',complete:true});
  const {room}=await call('bot-host','createRoom',{mode:'Teams',target:31,difficulty:1,isPublic:true,password:''}),roomId=room._id;
  assert.deepEqual(room.botSeats,[]);
  await reject(call('bot-host','start',{roomId}),'failed-precondition');
  const requestId=rid(),filled=await call('bot-host','fillBots',{roomId},requestId);
  assert.deepEqual(filled.room.botSeats,[1,2,3]);
  assert.deepEqual(await call('bot-host','fillBots',{roomId},requestId),filled);
  const joined=await call('bot-guest','joinRoom',{code:room.code,password:''});
  assert.deepEqual(joined.room.botSeats,[2,3]);assert.equal(joined.room.players.length,2);
  await reject(call('bot-guest','fillBots',{roomId}),'permission-denied');
  const started=await call('bot-host','start',{roomId});assert.equal(started.room.status,'playing');assert.deepEqual(started.view.humans,[true,true,false,false]);
  await reject(call('bot-host','fillBots',{roomId}),'failed-precondition');
 });

test('public profiles hide private data and wallets remain server-owned',{skip:!enabled},async()=>{
  for(const uid of ['social-a','social-b'])await call(uid,'profile',{name:uid,age:25,gender:'male',country:'LY',avatar:'avatar_1',complete:true});
  await db.doc('users/social-b').set({email:'private@example.test',gold:999,points:999},{merge:true});
  await db.doc('rankedStats/social-b').set({points:24,games:5,wins:2});
  let result=await call('social-a','publicProfile',{uid:'social-b'});
  assert.equal(result.relationship,'none');assert.equal(result.profile.points,24);
  assert.equal(result.profile.games,5);assert.equal(result.profile.wins,2);
  for(const field of ['email','age','gold','lastSeen'])assert(!(field in result.profile));
  await call('social-a','requestFriend',{toUid:'social-b'});
  assert.equal((await call('social-a','publicProfile',{uid:'social-b'})).relationship,'pending');
  assert.equal((await call('social-b','publicProfile',{uid:'social-a'})).relationship,'incoming');
  const req=(await call('social-b','requests')).items[0];
  await call('social-b','answerFriend',{requestId:req._id,accept:true});
  assert.equal((await call('social-a','publicProfile',{uid:'social-b'})).relationship,'friends');
  assert.equal((await call('social-a','publicProfile',{uid:'social-a'})).relationship,'self');
  await reject(call('social-a','publicProfile',{uid:'../secret'}),'invalid-argument');
  assert.equal((await call('social-a','store')).gold,0);assert.equal((await call('social-a','store')).items.length,3);
  await reject(call('social-a','store',{uid:'social-b'}),'invalid-argument');
  await reject(call('social-a','profile',{gold:9999}),'invalid-argument');
  await db.doc('wallets/social-a').update({gold:17});
  await call('social-a','profile',{initialize:true});
  assert.equal((await call('social-a','store')).gold,17);
  await db.doc('wallets/social-a').delete();
  await Promise.all([call('social-a','profile',{initialize:true}),call('social-a','profile',{initialize:true})]);
  assert.equal((await call('social-a','store')).gold,0);
});

test('unchanged polls use read-only snapshots without room writes',{skip:!enabled},async()=>{
  const modes=[];
  const observed=createService({doc:p=>db.doc(p),collection:p=>db.collection(p),runTransaction:(fn,options)=>{modes.push(options?.readOnly===true);return db.runTransaction(fn,options);}},()=>now);
  const query=(uid,op,payload={})=>observed(uid,{op,payload,requestId:rid(),protocolVersion:2});
  await query('poll-reader','profile',{name:'reader',age:25,gender:'male',country:'LY',avatar:'avatar_1',complete:true});
  const {room}=await query('poll-reader','createRoom',{mode:'Teams',target:31,difficulty:1,isPublic:true,password:''});
  const before=await db.doc(`rooms/${room._id}`).get();modes.length=0;
  const results=await Promise.all(Array.from({length:8},()=>query('poll-reader','poll',{roomId:room._id})));
  assert.deepEqual(modes,Array(8).fill(true));assert(results.every(r=>r.room.revision===room.revision));
  assert((await db.doc(`rooms/${room._id}`).get()).updateTime.isEqual(before.updateTime));
  now+=16000;modes.length=0;
  const heartbeat=await query('poll-reader','poll',{roomId:room._id});
  assert.deepEqual(modes,[true,false]);assert(heartbeat.room.revision>room.revision);
});


test('room chat is member-only, bounded, idempotent and independent of game turns',{skip:!enabled},async()=>{
  for(const uid of ['chatHost','chatGuest','chatOutsider'])await call(uid,'profile',{name:uid,age:25,gender:'male',country:'LY',avatar:'avatar_1',complete:true});
  const created=await call('chatHost','createRoom',{mode:'Teams',target:31,difficulty:1,isPublic:true,password:''});
  const roomId=created.room._id;
  await call('chatGuest','joinRoom',{code:created.room.code,password:''});
  await reject(call('chatOutsider','chat',{roomId,text:'hello'}),'permission-denied');
  for(const text of ['', 'x'.repeat(161), 'bad\nmessage'])await reject(call('chatHost','chat',{roomId,text}),'invalid-argument');
  await reject(call('chatHost','chat',{roomId,text:'hello',name:'forged'}),'invalid-argument');
  await call('chatGuest','chat',{roomId,text:'waiting-room message'});
  const listed=await call('chatOutsider','listRooms');
  assert(!('chat' in listed.items.find(r=>r._id===roomId)),'public listings must not leak chat');
  await call('chatHost','fillBots',{roomId});await call('chatHost','start',{roomId});
  const secretBefore=await db.doc(`roomSecrets/${roomId}`).get();
  const requestId=rid(),payload={roomId,text:'Good game!'};
  const responses=await Promise.all([call('chatHost','chat',payload,requestId),call('chatHost','chat',payload,requestId)]);
  assert.deepEqual(responses[0],responses[1]);assert.equal(responses[0].room.chat.length,2);
  assert.equal(responses[0].room.chat[1].name,'chatHost');assert(!('chatCooldown' in responses[0].room));
  await reject(call('chatHost','chat',{roomId,text:'too soon'}),'resource-exhausted');
  for(let i=0;i<13;i++){now+=3100;await call('chatHost','chat',{roomId,text:`message ${i}`});}
  const secretAfter=await db.doc(`roomSecrets/${roomId}`).get();
  assert(secretBefore.updateTime.isEqual(secretAfter.updateTime),'chat must never write game state');
  const room=(await db.doc(`rooms/${roomId}`).get()).data();assert.equal(room.chat.length,12);
  assert.equal(new Set(room.chat.map(m=>m.id)).size,12);
  await call('chatGuest','leave',{roomId});
  await reject(call('chatGuest','chat',{roomId,text:'left'}),'permission-denied');
});


test('cosmetic purchases are atomic, owned once, priced by server and equipped only by owner',{skip:!enabled},async()=>{
  await call('shopper','profile',{name:'shopper',age:25,gender:'male',country:'LY',avatar:'avatar_1',complete:true});
  await reject(call('shopper','buyItem',{itemId:'emerald'}),'failed-precondition');
  await reject(call('shopper','equipItem',{itemId:'emerald'}),'permission-denied');
  await reject(call('shopper','profile',{frame:'royal'}),'invalid-argument');
  await reject(call('shopper','buyItem',{itemId:'emerald',price:0}),'invalid-argument');
  await reject(call('shopper','buyItem',{itemId:'unknown'}),'invalid-argument');
  await db.doc('wallets/shopper').update({gold:300});
  const requestId=rid();
  await Promise.all([call('shopper','buyItem',{itemId:'emerald'},requestId),call('shopper','buyItem',{itemId:'emerald'},requestId),call('shopper','buyItem',{itemId:'emerald'})]);
  let store=await call('shopper','store');assert.equal(store.gold,200);assert.deepEqual(store.owned,['emerald']);
  await call('shopper','equipItem',{itemId:'emerald'});
  assert.equal((await call('shopper','publicProfile',{uid:'shopper'})).profile.frame,'emerald');
  assert.equal((await call('shopper','profile',{initialize:true})).profile.frame,'emerald');
  assert.equal((await call('shopper','createRoom',{mode:'Teams',target:31,difficulty:1,isPublic:true,password:''})).room.players[0].frame,'emerald');
  await call('shopper','equipItem',{itemId:''});assert.equal((await call('shopper','store')).equipped,'');
});

test('gold rewards are awarded once at completed match and excluded from solo bot rooms',{skip:!enabled},async()=>{
  for(const uid of ['goldHost','goldGuest','goldSolo'])await call(uid,'profile',{name:uid,age:25,gender:'male',country:'LY',avatar:'avatar_1',complete:true});
  for(const host of ['goldHost','goldSolo']){
    const created=await call(host,'createRoom',{mode:'Teams',target:31,difficulty:1,isPublic:true,password:''});const roomId=created.room._id;
    if(host==='goldHost')await call('goldGuest','joinRoom',{code:created.room.code,password:''});
    await call(host,'fillBots',{roomId});await call(host,'start',{roomId});
    const secretRef=db.doc(`roomSecrets/${roomId}`),secret=(await secretRef.get()).data(),state=JSON.parse(secret.state);
    state.winner=0;state.presentation='';await secretRef.update({state:JSON.stringify(state)});now+=16000;
    await Promise.all([call(host,'poll',{roomId}),call(host,'poll',{roomId})]);
    await call(host,'poll',{roomId});
    assert.equal((await call(host,'store')).gold,host==='goldHost'?20:0);
  }
  assert.equal((await call('goldGuest','store')).gold,5);
});
