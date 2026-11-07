const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {randomBytes}=require('node:crypto');
const {initializeApp,deleteApp}=require('firebase-admin/app');
const {getFirestore,Timestamp,FieldValue}=require('firebase-admin/firestore');
const {getAuth}=require('firebase-admin/auth');
const {createService,removeExpired}=require('../service');
const engine=require('../engine');
const {createAdmin}=require('../admin');
const {processDeletion}=require('../account-deletion');
const {createMaintenance}=require('../maintenance');
const {createNotifications}=require('../notifications');
const enabled=process.env.FIRESTORE_EMULATOR_HOST==='127.0.0.1:18881';
const authEnabled=enabled&&process.env.FIREBASE_AUTH_EMULATOR_HOST==='127.0.0.1:18882';
let app,db,api,now=Date.now();
const rid=()=>randomBytes(16).toString('hex');
const contact=async(uid,other)=>(await db.doc(`users/${uid}`).get()).data().contacts.some(friend=>friend.uid===other);
const call=(uid,op,payload={},requestId=rid())=>api(uid,{op,payload,requestId,protocolVersion:3});
const reject=(p,code)=>assert.rejects(p,e=>e.code===code);
const notifications=createNotifications();
before(async()=>{if(!enabled)return;app=initializeApp({projectId:'demo-tarneeb-secure'},'integration');db=getFirestore(app);api=createService(db,()=>now,notifications);});
after(async()=>{if(db)await db.terminate();if(app)await deleteApp(app);});
test('atomic profiles, social graph, invitations, room seats, server turns, retries and privacy',{skip:!enabled},async()=>{
  for(const uid of ['host','guest','third','fourth','fifth'])await call(uid,'profile',{name:uid,age:25,gender:'male',country:'LY',avatar:'avatar_1',complete:true});
  const profiles=await db.collection('users').get();assert.equal(new Set(profiles.docs.map(d=>d.data().searchId)).size,5);
  await reject(call('guest','profile',{uid:'host',name:'fake'}),'invalid-argument');
  await db.doc('users/host').set({legacyField:'preserved'},{merge:true});await call('host','profile',{name:'Changed'});assert.equal((await db.doc('users/host').get()).data().legacyField,'preserved');
  const search=(await db.doc('users/host').get()).data().searchId;assert.equal((await call('guest','search',{searchId:search})).profile.uid,'host');
  const signal=new AbortController().signal;
  const initial=notifications.wait('guest','',signal);
  const incoming=notifications.wait('guest',initial.cursor,signal);
  await call('host','requestFriend',{toUid:'guest'});
  assert.deepEqual((await incoming).events.map(({kind,name})=>({kind,name})),[{kind:'requests',name:'Changed'}]);
  assert.equal(notifications.wait('third','',signal).events.length,0);
  const requests=await call('guest','requests');assert.equal(requests.items.length,1);
  await reject(call('third','answerFriend',{requestId:requests.items[0]._id,accept:true}),'permission-denied');
  const acceptId=rid();await Promise.all([call('guest','answerFriend',{requestId:requests.items[0]._id,accept:true},acceptId),call('guest','answerFriend',{requestId:requests.items[0]._id,accept:true},acceptId)]);
  assert(await contact('host','guest'));assert(await contact('guest','host'));
  assert(!(await db.doc('friendRequests/'+requests.items[0]._id).get()).exists);
  assert.deepEqual(notifications.wait('host','',signal).events.map(event=>event.kind),['friends']);
  const createId=rid(),params={mode:'FFA',target:31,difficulty:1,isPublic:false,password:'fixture-password'};
  await reject(call('host','createRoom',{...params,mode:'Teams'}),'invalid-argument');
  await reject(api('host',{op:'activeRoom',payload:{},protocolVersion:2}),'failed-precondition');
  const created=await call('host','createRoom',params,createId),roomId=created.room._id,code=created.room.code;
  assert.deepEqual(await call('host','createRoom',params,createId),created);assert.equal((await db.collection('rooms').get()).size,1);
  await reject(call('host','createRoom',{...params,target:61},createId),'invalid-argument');
  await reject(call('guest','joinRoom',{code,password:'wrong'}),'permission-denied');
  await reject(call('third','invite',{roomId,toUid:'guest'}),'permission-denied');
  await call('host','invite',{roomId,toUid:'guest'});const invite=(await call('guest','invites')).items[0];assert.equal(invite.roomId,roomId);
  assert.deepEqual(notifications.wait('guest','',signal).events.map(event=>event.kind),['requests','invites']);
  await call('guest','answerInvite',{inviteId:invite._id,accept:true});
  assert(!(await db.doc('roomInvites/'+invite._id).get()).exists);
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
  await call('host','removeFriend',{toUid:'guest'});assert(!await contact('host','guest'));assert(!await contact('guest','host'));
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
  const userRef=db.doc('users/registration-user'),before=(await userRef.get()).updateTime;
  const own=await call('registration-user','ownProfile');
  assert.equal(own.profile.age,27);assert.equal(own.profile.searchId,initial.profile.searchId);
  assert((await userRef.get()).updateTime.isEqual(before),'returning sign-in does not rewrite the profile');
  await reject(call('uninitialized','ownProfile'),'not-found');
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
  assert(!(await db.doc(`rooms/${roomId}`).get()).exists);
  assert(!(await db.doc(`roomSecrets/${roomId}`).get()).exists);
  assert(!(await db.doc('activeRooms/admin-room-player').get()).exists);
  await reject(call('admin-room-player','poll',{roomId}),'not-found');
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
  const {room}=await call('bot-host','createRoom',{mode:'FFA',target:31,difficulty:1,isPublic:true,password:''}),roomId=room._id;
  assert.deepEqual(room.botSeats,[]);
  await reject(call('bot-host','start',{roomId}),'failed-precondition');
  const requestId=rid(),filled=await call('bot-host','fillBots',{roomId},requestId);
  assert.deepEqual(filled.room.botSeats,[1,2,3]);
  assert.deepEqual(await call('bot-host','fillBots',{roomId},requestId),filled);
  const joined=await call('bot-guest','joinRoom',{code:room.code,password:''});
  assert.deepEqual(joined.room.botSeats,[2,3]);assert.equal(joined.room.players.length,2);
  await reject(call('bot-guest','fillBots',{roomId}),'permission-denied');
  const started=await call('bot-host','start',{roomId});assert.equal(started.room.status,'playing');
  const humanSeats=started.room.players.map(p=>p.index);
  assert.deepEqual([...humanSeats,...started.room.botSeats].sort(),[0,1,2,3]);
  assert.deepEqual(started.view.humans,[0,1,2,3].map(i=>humanSeats.includes(i)));
  assert.equal(started.view.names[started.view.seat],'bot-host');
  await reject(call('bot-host','fillBots',{roomId}),'failed-precondition');
  const secret=db.doc(`roomSecrets/${roomId}`);
  async function endRound(){
    const state=JSON.parse((await secret.get()).data().state);
    Object.assign(state,{phase:'round_end',presentation:'',turnDueAt:now+15000});
    state.revision++;
    await secret.update({state:JSON.stringify(state)});
    return state.round;
  }
  const round=await endRound();
  const guest=await call('bot-guest','readyRound',{roomId,round});
  assert.equal(guest.view.phase,'round_end');
  assert.equal(guest.view.ready_seats[guest.view.seat],true);
  assert.equal(guest.view.ready_seats[started.view.seat],false);
  assert.equal(guest.view.ready_seats.filter(Boolean).length,3);
  assert(!('readyUids' in guest.view));
  const duplicate=await call('bot-guest','readyRound',{roomId,round});
  assert.equal(duplicate.view.revision,guest.view.revision);
  const next=await call('bot-host','readyRound',{roomId,round});
  assert.equal(next.view.round,round+1);assert.equal(next.view.presentation,'reveal');
  assert.deepEqual(next.room.players.map(p=>p.index),humanSeats);
  const second=await endRound();
  const stale=await call('bot-guest','readyRound',{roomId,round});
  assert.equal(stale.view.ready_seats.filter(Boolean).length,2);
  now+=14999;assert.equal((await call('bot-host','poll',{roomId})).view.round,second);
  now++;assert.equal((await call('bot-guest','poll',{roomId})).view.round,second+1);
 });

test('profile visibility, last seen and cancelling requests preserve relationship state',{skip:!enabled},async()=>{
  for(const uid of ['profile-a','profile-b','profile-c'])await call(uid,'profile',{name:uid,age:27,gender:'female',country:'LY',avatar:'avatar_2',complete:true});
  let view=await call('profile-a','publicProfile',{uid:'profile-b'});
  assert(!('age' in view.profile));assert.equal(view.profile.gender,'female');assert.equal(typeof view.profile.lastSeenAt,'number');
  await reject(call('profile-b','profile',{showAge:'true'}),'invalid-argument');
  await call('profile-b','profile',{showAge:true});
  assert.equal((await call('profile-a','publicProfile',{uid:'profile-b'})).profile.age,27);
  await call('profile-b','profile',{initialize:true});
  assert.equal((await call('profile-a','publicProfile',{uid:'profile-b'})).profile.age,27);
  await call('profile-b','profile',{showAge:false});
  assert(!('age' in (await call('profile-a','publicProfile',{uid:'profile-b'})).profile));
  assert.equal((await call('profile-b','publicProfile',{uid:'profile-b'})).profile.age,27);
  await call('profile-b','presence',{online:false});
  view=await call('profile-a','publicProfile',{uid:'profile-b'});
  assert.equal(view.profile.status,'offline');assert.equal(view.profile.lastSeenAt,now);
  await call('profile-a','requestFriend',{toUid:'profile-b'});
  await call('profile-c','cancelFriend',{toUid:'profile-b'});
  assert.equal((await call('profile-a','publicProfile',{uid:'profile-b'})).relationship,'pending');
  const cancelId=rid();await call('profile-a','cancelFriend',{toUid:'profile-b'},cancelId);
  await call('profile-a','cancelFriend',{toUid:'profile-b'},cancelId);
  assert.equal((await call('profile-b','requests')).items.length,0);
  now+=60001;await call('profile-a','requestFriend',{toUid:'profile-b'});
  const request=(await call('profile-b','requests')).items[0];
  await call('profile-b','answerFriend',{requestId:request._id,accept:true});
  await reject(call('profile-a','cancelFriend',{toUid:'profile-b'}),'failed-precondition');
  assert.equal((await call('profile-a','publicProfile',{uid:'profile-b'})).relationship,'friends');
  await call('profile-a','requestFriend',{toUid:'profile-c'});
  const racing=(await call('profile-c','requests')).items[0];
  await Promise.allSettled([call('profile-a','cancelFriend',{toUid:'profile-c'}),call('profile-c','answerFriend',{requestId:racing._id,accept:true})]);
  const a=await contact('profile-a','profile-c');
  const c=await contact('profile-c','profile-a');
  assert.equal(a,c);
  assert(!(await db.doc('friendRequests/'+racing._id).get()).exists);
  await call('profile-a','removeFriend',{toUid:'profile-b'});
  now+=60001;await call('profile-a','requestFriend',{toUid:'profile-b'});
  now+=7*24*3600000+1;
  assert.equal((await call('profile-b','publicProfile',{uid:'profile-a'})).relationship,'none');
  await call('profile-b','requestFriend',{toUid:'profile-a'});
  assert.equal((await call('profile-a','publicProfile',{uid:'profile-b'})).relationship,'incoming');
});

test('public profiles hide private data and wallets remain server-owned',{skip:!enabled},async()=>{
  for(const uid of ['social-a','social-b'])await call(uid,'profile',{name:uid,age:25,gender:'male',country:'LY',avatar:'avatar_1',complete:true});
  await db.doc('users/social-b').set({email:'private@example.test',gold:999,points:999},{merge:true});
  await db.doc('users/social-b').update({'economy.points':24,'economy.games':5,'economy.wins':2});
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
  assert.equal((await call('social-a','store')).gold,0);assert.equal((await call('social-a','store')).items.length,9);
  await reject(call('social-a','store',{uid:'social-b'}),'invalid-argument');
  await reject(call('social-a','profile',{gold:9999}),'invalid-argument');
  await db.doc('users/social-a').update({economy:FieldValue.delete(),contacts:FieldValue.delete()});
  await db.doc('wallets/social-a').set({gold:17,owned:['emerald']});
  await db.doc('rankedStats/social-a').set({points:8,games:2,wins:1});
  await db.doc('users/social-a/friends/social-b').set({uid:'social-b',name:'social-b'});
  await call('social-a','profile',{initialize:true});
  assert.equal((await call('social-a','store')).gold,17);
  assert(!(await db.doc('wallets/social-a').get()).exists);
  assert(!(await db.doc('rankedStats/social-a').get()).exists);
  assert.equal((await call('social-a','store')).points,8);
  assert.deepEqual((await call('social-a','store')).owned,['emerald']);
  assert.equal((await call('social-a','friends')).items[0].uid,'social-b');
  assert(!(await db.doc('users/social-a/friends/social-b').get()).exists);
  await Promise.all([call('social-a','profile',{initialize:true}),call('social-a','profile',{initialize:true})]);
  assert.equal((await call('social-a','store')).gold,17);
});

test('concurrent polls share a read-only snapshot and room writes invalidate it',{skip:!enabled},async()=>{
  const modes=[];
  const observed=createService({doc:p=>db.doc(p),collection:p=>db.collection(p),runTransaction:(fn,options)=>{modes.push(options?.readOnly===true);return db.runTransaction(fn,options);}},()=>now);
  const query=(uid,op,payload={})=>observed(uid,{op,payload,requestId:rid(),protocolVersion:3});
  await query('poll-reader','profile',{name:'reader',age:25,gender:'male',country:'LY',avatar:'avatar_1',complete:true});
  const {room}=await query('poll-reader','createRoom',{mode:'FFA',target:31,difficulty:1,isPublic:true,password:''});
  const before=await db.doc(`rooms/${room._id}`).get();modes.length=0;
  const results=await Promise.all(Array.from({length:8},(_,i)=>query('poll-reader','poll',{roomId:room._id,latencyMs:200+i})));
  assert.deepEqual(modes,[true]);assert(results.every(r=>r.room.revision===room.revision));
  await reject(query('outsider','poll',{roomId:room._id}),'permission-denied');
  assert.deepEqual(modes,[true]);
  assert((await db.doc(`rooms/${room._id}`).get()).updateTime.isEqual(before.updateTime));
  now+=16000;modes.length=0;
  const heartbeat=await query('poll-reader','poll',{roomId:room._id,latencyMs:300});
  assert.deepEqual(modes,[true,false]);assert(heartbeat.room.revision>room.revision);
  assert.equal(heartbeat.room.players[0].latencyMs,300);assert.equal(heartbeat.room.players[0].latencyAt,now);
  await query('poll-reader','poll',{roomId:room._id});
  const filled=await query('poll-reader','fillBots',{roomId:room._id});
  const updated=await query('poll-reader','poll',{roomId:room._id});
  assert.equal(updated.room.revision,filled.room.revision);
  assert.deepEqual(updated.room.botSeats,filled.room.botSeats);
  modes.length=0;
  for(const latencyMs of [-1,60001,1.2,'300',null])await reject(query('poll-reader','poll',{roomId:room._id,latencyMs}),'invalid-argument');
  assert.deepEqual(modes,[]);
  await query('poll-reader','leave',{roomId:room._id});
  await reject(query('poll-reader','poll',{roomId:room._id}),'not-found');
});


test('room chat is member-only, bounded, idempotent and independent of game turns',{skip:!enabled},async()=>{
  for(const uid of ['chatHost','chatGuest','chatOutsider'])await call(uid,'profile',{name:uid,age:25,gender:'male',country:'LY',avatar:'avatar_1',complete:true});
  const created=await call('chatHost','createRoom',{mode:'FFA',target:31,difficulty:1,isPublic:true,password:''});
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
  await db.doc('users/shopper').update({'economy.gold':300});
  const requestId=rid();
  await Promise.all([call('shopper','buyItem',{itemId:'emerald'},requestId),call('shopper','buyItem',{itemId:'emerald'},requestId),call('shopper','buyItem',{itemId:'emerald'})]);
  let store=await call('shopper','store');assert.equal(store.gold,200);assert.deepEqual(store.owned,['emerald']);
  await call('shopper','equipItem',{itemId:'emerald'});
  await reject(call('shopper','equipItem',{itemId:'comet'}),'permission-denied');
  await reject(call('shopper','equipItem',{itemId:'emerald',slot:'effect'}),'invalid-argument');
  await Promise.all([call('shopper','buyItem',{itemId:'comet'}),call('shopper','buyItem',{itemId:'comet'})]);
  store=await call('shopper','equipItem',{itemId:'comet'});
  assert.equal(store.gold,80);
  assert.equal(store.equipped,'emerald');
  assert.equal(store.equippedEffect,'comet');
  assert.equal((await call('shopper','publicProfile',{uid:'shopper'})).profile.frame,'emerald');
  assert.equal((await call('shopper','publicProfile',{uid:'shopper'})).profile.effect,'comet');
  const restored=(await call('shopper','profile',{initialize:true})).profile;
  assert.equal(restored.frame,'emerald');
  assert.equal(restored.effect,'comet');
  const room=(await call('shopper','createRoom',{mode:'FFA',target:31,difficulty:1,isPublic:true,password:''})).room;
  const seated=room.players[0];
  assert.equal(seated.frame,'emerald');
  assert.equal(seated.effect,'comet');
  store=await call('shopper','equipItem',{itemId:''});
  assert.equal(store.equipped,'');
  assert.equal(store.equippedEffect,'comet');
  store=await call('shopper','equipItem',{itemId:'',slot:'effect'});
  assert.equal(store.equippedEffect,'');
  const updated=(await call('shopper','poll',{roomId:room._id})).room;
  assert.equal(updated.players[0].frame,'');
  assert.equal(updated.players[0].effect,'');
  assert.equal(updated.status,'waiting');
  assert(updated.revision>room.revision);
});

test('gold rewards are awarded once at completed match and excluded from solo bot rooms',{skip:!enabled},async()=>{
  for(const uid of ['goldHost','goldGuest','goldSolo'])await call(uid,'profile',{name:uid,age:25,gender:'male',country:'LY',avatar:'avatar_1',complete:true});
  for(const host of ['goldHost','goldSolo']){
    const created=await call(host,'createRoom',{mode:'FFA',target:31,difficulty:1,isPublic:true,password:''});const roomId=created.room._id;
    if(host==='goldHost')await call('goldGuest','joinRoom',{code:created.room.code,password:''});
    await call(host,'fillBots',{roomId});const started=await call(host,'start',{roomId});
    const seat=started.view.seat;
    const secretRef=db.doc(`roomSecrets/${roomId}`),secret=(await secretRef.get()).data(),state=JSON.parse(secret.state);
    Object.assign(state,{round:2,phase:'collecting',presentation:'',bids:[11,0,2,3],
      taken:[0,0,0,0],tricks:10,lead:seat,trick:[13,14,15,16]});
    [state.bids[0],state.bids[seat]]=[state.bids[seat],state.bids[0]];
    state.taken[seat]=10;state.trick[seat]=25;
    await secretRef.update({state:JSON.stringify(state)});now+=16000;
    const outcomes=await Promise.all([call(host,'poll',{roomId}),call(host,'poll',{roomId})]);
    assert(outcomes.every(outcome=>outcome.view.winner===seat&&outcome.room.status==='finished'));
    assert(outcomes.every(outcome=>outcome.view.tricks===11));
    for(const collection of ['rooms','roomSecrets'])assert(!(await db.doc(`${collection}/${roomId}`).get()).exists);
    assert(!(await db.doc(`activeRooms/${host}`).get()).exists);
    assert.deepEqual((await call(host,'poll',{roomId})).view.hand,[]);
    await reject(call('outsider','poll',{roomId}),'not-found');
    if(host==='goldHost'){
      assert(!(await db.doc('activeRooms/goldGuest').get()).exists);
      assert.equal((await call('goldGuest','poll',{roomId})).view.seat,started.room.players.find(p=>p.uid==='goldGuest').index);
    }
    assert.equal((await call(host,'store')).gold,host==='goldHost'?20:0);
  }
  assert.equal((await call('goldGuest','store')).gold,5);
});

test('leaving the last seat removes the room, its secret and invitations immediately',{skip:!enabled},async()=>{
  const uid='empty-room-host';
  await call(uid,'profile',{name:'Empty room',age:25,gender:'male',country:'LY',avatar:'avatar_1',complete:true});
  const {room}=await call(uid,'createRoom',{mode:'FFA',target:31,difficulty:1,isPublic:true,password:''});
  const invite=db.doc('roomInvites/empty-room-fixture');
  await invite.set({roomId:room._id});
  const payload={roomId:room._id};
  const leaveId=rid();
  assert.deepEqual(await call(uid,'leave',payload,leaveId),{status:'left'});
  assert.deepEqual(await call(uid,'leave',payload,leaveId),{status:'left'});
  for(const ref of [db.doc(`rooms/${room._id}`),db.doc(`roomSecrets/${room._id}`),db.doc(`activeRooms/${uid}`),invite]){
    assert(!(await ref.get()).exists,ref.path);
  }
});

test('administrator gold credits are displayed, auditable and idempotent under retries',{skip:!enabled},async()=>{
  const uid='gold-credit-player';
  await call(uid,'profile',{name:'Gold player',age:25,gender:'male',country:'LY',avatar:'avatar_1',complete:true});
  await db.doc(`users/${uid}`).update({'economy.gold':7});
  const admin=createAdmin(db,{listUsers:async()=>({users:[{uid,metadata:{},disabled:false}]})},new Set(['owner']));
  const payload={uid,amount:40,requestId:rid()};
  await reject(admin('outsider','creditGold',payload),'permission-denied');
  await reject(admin('owner','creditGold',{...payload,amount:-1}),'invalid-argument');
  assert.deepEqual(await Promise.all([admin('owner','creditGold',payload),admin('owner','creditGold',payload)]),[{gold:47},{gold:47}]);
  await reject(admin('owner','creditGold',{...payload,amount:41}),'invalid-argument');
  assert.equal((await call(uid,'store')).gold,47);
  assert.equal((await admin('owner','users',{cursor:''})).items[0].gold,47);
  const audit=await db.collection('adminAudit').where('target','==',uid).get();
  assert.equal(audit.size,1);
  assert.equal(audit.docs[0].data().before,7);
  assert.equal(audit.docs[0].data().after,47);
});

test('permanent deletion resumes safely and removes the Auth account and linked Firestore data',{skip:!authEnabled},async()=>{
  const uid='delete-target',peer='delete-peer',auth=getAuth(app);
  await auth.createUser({uid,email:'fixture-delete@example.test'});
  for(const player of [uid,peer])await call(player,'profile',{name:player,age:25,gender:'male',country:'LY',avatar:'avatar_1',complete:true});
  const profile=db.doc(`users/${uid}`);
  const searchId=(await profile.get()).data().searchId;
  const refs=[
    profile,db.doc(`wallets/${uid}`),db.doc(`rankedStats/${uid}`),db.doc(`activeRooms/${uid}`),
    db.doc(`searchIds/${searchId}`),profile.collection('archive').doc('private'),
    profile.collection('friends').doc(peer),db.doc(`users/${peer}/friends/${uid}`),
    db.doc('friendRequests/delete-link'),db.doc('roomInvites/delete-link'),db.doc('roomResults/delete-link'),
  ];
  await refs[2].set({points:3});
  await refs[5].set({note:'fixture'});
  await refs[6].set({uid:peer});
  await db.doc(`users/${peer}`).update({contacts:[{uid}]});
  await refs[8].set({fromUid:uid,toUid:peer});
  await refs[9].set({fromUid:peer,toUid:uid});
  await refs[10].set({memberUids:[uid,peer]});
  const {room}=await call(uid,'createRoom',{mode:'FFA',target:31,difficulty:1,isPublic:true,password:''});
  await call(peer,'joinRoom',{code:room.code,password:''});
  const admin=createAdmin(db,auth,new Set(['owner']));
  await reject(admin('owner','deleteUser',{uid:'owner',confirm:'owner'}),'permission-denied');
  await reject(admin('owner','deleteUser',{uid,confirm:peer}),'invalid-argument');
  assert.deepEqual(await admin('owner','deleteUser',{uid,confirm:uid}),{state:'pending'});
  await reject(call(uid,'profile',{initialize:true}),'permission-denied');
  const job=db.doc(`accountDeletions/${uid}`);
  const interrupted={collection(){throw Error('transient Firestore outage');}};
  await assert.rejects(processDeletion(interrupted,auth,job),/transient Firestore outage/);
  await assert.rejects(auth.getUser(uid),e=>e.code==='auth/user-not-found');
  assert((await profile.get()).exists);
  assert.equal((await job.get()).data().state,'pending');
  assert.equal(await processDeletion(db,auth,job),true);
  await assert.rejects(auth.getUser(uid),e=>e.code==='auth/user-not-found');
  for(const ref of refs)assert(!(await ref.get()).exists,ref.path);
  const remaining=(await call(peer,'poll',{roomId:room._id})).room;
  assert.deepEqual(remaining.memberUids,[peer]);
  assert.equal(remaining.hostId,peer);
  assert(!await contact(peer,uid));
  assert.deepEqual(await admin('owner','deleteUser',{uid,confirm:uid}),{state:'completed'});
});

test('maintenance clears expired results, abandoned rooms and orphaned seat pointers',{skip:!enabled},async()=>{
  const uid='maintenance-host';
  await call(uid,'profile',{name:'Maintenance',age:25,gender:'male',country:'LY',avatar:'avatar_1',complete:true});
  const {room}=await call(uid,'createRoom',{mode:'FFA',target:31,difficulty:1,isPublic:true,password:''});
  const roomRef=db.doc(`rooms/${room._id}`);
  await roomRef.update({updatedAt:Timestamp.fromMillis(Date.now()-200000)});
  const result=db.doc('roomResults/expired-fixture'),pointer=db.doc('activeRooms/aaa-orphan');
  await result.set({expiresAt:Timestamp.fromMillis(Date.now()-1000)});
  await pointer.set({roomId:'v3_MISSING'});
  const maintenance=createMaintenance(db,{});
  const report=await maintenance.run();
  assert.equal(report.errors,0);
  assert(report.lastRun>0&&report.removed>=3);
  for(const ref of [roomRef,db.doc(`roomSecrets/${room._id}`),db.doc(`activeRooms/${uid}`),result,pointer]){
    assert(!(await ref.get()).exists,ref.path);
  }
});
