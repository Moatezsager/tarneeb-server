'use strict';
const {randomBytes,scryptSync,timingSafeEqual,createHash} = require('node:crypto');
const {Timestamp,FieldValue} = require('firebase-admin/firestore');
const {AppError:HttpsError} = require('./errors');
const engine = require('./engine');
const {completeProfile,validateProfileEdit}=require('./profile');
const VERSION=2, HOUR=3600000;
const fail=(code,message)=>{throw new HttpsError(code,message);};
const id=(x)=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(x);
function str(x,min,max){if(typeof x!=='string'||x.trim().length<min||x.length>max)fail('invalid-argument','بيانات غير صالحة');return x.trim();}
function keys(d,allowed){if(!d||typeof d!=='object'||Array.isArray(d)||Object.keys(d).some(k=>!allowed.includes(k)))fail('invalid-argument','حقول غير مسموحة');}
const stamp=n=>Timestamp.fromMillis(n);
const hash=x=>createHash('sha256').update(x).digest('hex');
function safeProfile(p){return {uid:p.uid,name:p.name,searchId:p.searchId,country:p.country,gender:p.gender,avatar:p.avatar,points:p.points||0,status:p.status==='online'&&p.lastSeen?.toMillis()>Date.now()-60000?'online':'offline'};}
function player(p,index){return {uid:p.uid,name:p.name,avatar:p.avatar,country:p.country,index,status:'connected'};}
function publicRoom(r){const {secret,gameState,...data}=r;return {...data,createdAt:r.createdAt.toMillis(),updatedAt:r.updatedAt.toMillis(),expiresAt:r.expiresAt.toMillis()};}
function passwordHash(password,salt){return scryptSync(password,salt,32).toString('hex');}
function gate(state,kind,ms,now){state.presentation=kind;state.presentationUntil=now+ms;state.turnDueAt=now+ms;}
function nextDeadline(state,room,now){
  const human=room.players.some(p=>p.index===state.current&&p.status==='connected');
  state.turn_seconds=human?25:state.phase==='swapping'?3:1.6;
  state.turnDueAt=now+(state.phase==='collecting'?2200:state.phase==='round_end'?15000:state.turn_seconds*1000);
}
function advance(state,room,now){
  if(!state)return false;
  if(state.presentation){if(now<state.presentationUntil)return false;state.presentation='';state.swap_preview={};state.revision++;nextDeadline(state,room,now);return true;}
  if(now<state.turnDueAt||state.winner>=0)return false;
  if(state.phase==='collecting')engine.collect(state);
  else if(state.phase==='round_end'){engine.nextRound(state);gate(state,'reveal',4500,now);return true;}
  else {const a=engine.ai(state,state.current),before=[...state.exposed],p=state.current;engine.act(state,p,a.action,a.value);if(a.action==='swap'){state.swap_preview={king:p,target:a.value,before};gate(state,'swap_result',3200,now);return true;}}
  nextDeadline(state,room,now);return true;
}
function reply(room,state,uid,now){
  const p=room.players.find(p=>p.uid===uid);if(!p)fail('permission-denied','لست عضوًا في الغرفة');
  let view={};
  if(state){view=engine.view(state,p.index);view.presentation_remaining=Math.max(0,(state.presentationUntil-now)/1000);view.turn_remaining=Math.max(0,(state.turnDueAt-now)/1000);view.humans=Array.from({length:4},(_,i)=>room.players.some(p=>p.index===i&&p.status==='connected'));if(state.presentation){view.legal=[];view.available_bids=[];}}
  return {room:publicRoom(room),view,serverTime:now};
}
function createService(db, clock=Date.now){
  // shortcut: single-instance memory limits reset on restart; share counters before scaling out.
  const rateLimits=new Map();
  const ref=p=>db.doc(p);
  const profile=async(tx,uid)=>{const s=await tx.get(ref(`users/${uid}`));if(!s.exists)fail('failed-precondition','أكمل ملفك الشخصي أولًا');const p=s.data();if(p.uid!==uid)fail('failed-precondition','أعد مزامنة ملفك الشخصي');return p;};
  async function roomData(tx,roomId){if(!id(roomId))fail('invalid-argument','رمز غرفة غير صالح');const [r,s]=await tx.getAll(ref(`rooms/${roomId}`),ref(`roomSecrets/${roomId}`));if(!r.exists||r.data().protocolVersion!==VERSION||!s.exists)fail('not-found','الغرفة غير موجودة أو تحتاج إصدارًا أحدث');if(r.data().expiresAt.toMillis()<=clock())fail('not-found','انتهت صلاحية الغرفة');return [r.data(),s.data(),s.data().state?JSON.parse(s.data().state):null];}
  function saveRoom(tx,r,secret,state,now){
    r.updatedAt=stamp(now);r.expiresAt=stamp(now+(r.status==='finished'?HOUR:6*HOUR));r.revision=(r.revision||0)+1;
    if(state?.winner>=0&&r.status!=='finished'){
      r.status='finished';r.expiresAt=stamp(now+HOUR);
      // Award once in the same transaction as the terminal state; legacy profile points are not trusted.
      for(const p of r.players){const won=state.mode==='Teams'?p.index%2===state.winner:p.index===state.winner;tx.set(ref(`rankedStats/${p.uid}`),{games:FieldValue.increment(1),wins:FieldValue.increment(won?1:0),points:FieldValue.increment(won?10:2),updatedAt:stamp(now)},{merge:true});}
    }
    tx.set(ref(`rooms/${r._id}`),r);tx.set(ref(`roomSecrets/${r._id}`),{...secret,state:state?JSON.stringify(state):'',expiresAt:r.expiresAt});
  }
  async function operate(tx,uid,op,d,now,readOnly=false){
    if(op==='presence'){
      keys(d,['online']);if(typeof d.online!=='boolean')fail('invalid-argument','حالة غير صالحة');await profile(tx,uid);
      tx.update(ref(`users/${uid}`),{status:d.online?'online':'offline',lastSeen:stamp(now),updatedAt:stamp(now)});return {status:'ok'};
    }
    if(op==='profile'){
      keys(d,['name','age','country','gender','avatar','initialize','complete']);
      if(d.initialize!==undefined&&typeof d.initialize!=='boolean')fail('invalid-argument','طلب غير صالح');
      if(d.complete!==undefined&&typeof d.complete!=='boolean')fail('invalid-argument','طلب غير صالح');
      if(!d.initialize)validateProfileEdit(d);
      const doc=await tx.get(ref(`users/${uid}`)),old=doc.exists?doc.data():{};
      let name=d.initialize&&old.name?old.name:str(d.name??old.name??'لاعب',1,64);
      const country=d.initialize&&old.country?old.country:(d.country??old.country??'LY'),gender=d.initialize&&old.gender?old.gender:(d.gender??old.gender??'other'),avatar=d.initialize&&old.avatar?old.avatar:(d.avatar??old.avatar??'avatar_1');
      if(typeof country!=='string'||!/^[A-Z]{2}$/.test(country)||!['male','female','other'].includes(gender))fail('invalid-argument','الدولة أو الجنس غير صالح');str(avatar,1,512);name=str(name,1,64);
      let searchId=typeof old.searchId==='string'&&/^[A-Z0-9-]{3,32}$/.test(old.searchId)?old.searchId:`${country}-${randomBytes(5).toString('hex').toUpperCase()}`;
      let reservation=await tx.get(ref(`searchIds/${searchId}`));
      if(old.searchId===searchId&&!reservation.exists){const dup=await tx.get(db.collection('users').where('searchId','==',searchId).limit(2));if(dup.docs.some(x=>x.id!==uid))searchId=`${country}-${randomBytes(5).toString('hex').toUpperCase()}`;}
      if(reservation.exists&&reservation.data().uid!==uid)searchId=`${country}-${randomBytes(5).toString('hex').toUpperCase()}`;
      if(searchId!==old.searchId){reservation=await tx.get(ref(`searchIds/${searchId}`));if(reservation.exists&&reservation.data().uid!==uid)fail('aborted','أعد المحاولة لحجز المعرف');}
      const [stats,wallet]=await tx.getAll(ref(`rankedStats/${uid}`),ref(`wallets/${uid}`));
      const age=d.initialize?(old.age||0):(d.age??old.age??0);
      const p={uid,name,age,searchId,country,gender,avatar,status:'online',lastSeen:stamp(now),updatedAt:stamp(now)};
      p.profileComplete=completeProfile(p);
      if(d.complete&&!p.profileComplete)fail('invalid-argument','أكمل الاسم والعمر والجنس والبلد والصورة أولًا');
      tx.set(ref(`searchIds/${searchId}`),{uid,createdAt:stamp(now)});tx.set(ref(`users/${uid}`),p,{merge:true});
      if(!wallet.exists)tx.create(ref(`wallets/${uid}`),{gold:0,createdAt:stamp(now)});
      return {profile:{...safeProfile(p),age:p.age,profileComplete:p.profileComplete,points:stats.data()?.points||0,gold:wallet.data()?.gold||0}};
    }
    if(op==='publicProfile'){
      keys(d,['uid']);if(!id(d.uid))fail('invalid-argument','معرّف لاعب غير صالح');
      const p=await profile(tx,d.uid);
      const [stats,friend,sent,incoming]=await tx.getAll(ref(`rankedStats/${d.uid}`),ref(`users/${uid}/friends/${d.uid}`),ref(`friendRequests/${hash(`${uid}:${d.uid}`)}`),ref(`friendRequests/${hash(`${d.uid}:${uid}`)}`));
      return {profile:{...safeProfile(p),points:stats.data()?.points||0,games:stats.data()?.games||0,wins:stats.data()?.wins||0},relationship:d.uid===uid?'self':friend.exists?'friends':incoming.data()?.status==='pending'?'incoming':sent.data()?.status==='pending'?'pending':'none'};
    }
    if(op==='store'){
      keys(d,[]);await profile(tx,uid);
      const wallet=await tx.get(ref(`wallets/${uid}`));
      return {gold:wallet.data()?.gold||0,items:[]};
    }
    if(op==='search'){
      keys(d,['searchId']);const searchId=str(d.searchId,3,32).toUpperCase();if(!/^[A-Z0-9-]+$/.test(searchId))fail('invalid-argument','معرّف غير صالح');
      const reservation=await tx.get(ref(`searchIds/${searchId}`));let userId=reservation.data()?.uid;
      if(!userId){const found=await tx.get(db.collection('users').where('searchId','==',searchId).limit(2));if(found.size!==1)return {profile:null};userId=found.docs[0].id;}
      if(userId===uid)return {profile:null};const p=await tx.get(ref(`users/${userId}`));return {profile:p.exists?{...safeProfile(p.data()),uid:userId}:null};
    }
    if(op==='friends'||op==='requests'||op==='invites'){
      keys(d,['cursor']);const collection=op==='friends'?db.collection(`users/${uid}/friends`):db.collection(op==='requests'?'friendRequests':'roomInvites');
      let q=op==='friends'?collection:collection.where('toUid','==',uid).where('status','==','pending');q=q.orderBy('__name__');
      if(d.cursor){if(!id(d.cursor))fail('invalid-argument','صفحة غير صالحة');q=q.startAfter(d.cursor);}const docs=await tx.get(q.limit(30));
      let items=docs.docs.map(x=>({...x.data(),_id:x.id}));
      if(op==='friends'&&items.length){const profiles=await tx.getAll(...items.map(x=>ref(`users/${x.uid}`)));items=items.map((f,i)=>profiles[i].exists?{...safeProfile(profiles[i].data()),uid:f.uid,_id:f._id}:f);}
      if(op==='invites')items=items.filter(x=>x.expiresAt?.toMillis()>now);
      return {items:items.map(x=>({...x,createdAt:x.createdAt?.toMillis()||0,updatedAt:x.updatedAt?.toMillis()||0,expiresAt:x.expiresAt?.toMillis()||0})),cursor:docs.size===30?docs.docs.at(-1).id:''};
    }
    if(op==='requestFriend'){
      keys(d,['toUid']);if(!id(d.toUid)||d.toUid===uid)fail('invalid-argument','اختر لاعبًا آخر');
      const [me,to]=await Promise.all([profile(tx,uid),profile(tx,d.toUid)]),reqId=hash(`${uid}:${d.toUid}`);
      const [friend,req,reverse]=await tx.getAll(ref(`users/${uid}/friends/${d.toUid}`),ref(`friendRequests/${reqId}`),ref(`friendRequests/${hash(`${d.toUid}:${uid}`)}`));
      if(friend.exists)return {status:'friends'};if(reverse.data()?.status==='pending')fail('already-exists','لديك طلب وارد من هذا اللاعب؛ اقبله من الطلبات');if(req.data()?.status==='pending')return {status:'pending'};
      if(req.exists&&now-req.data().createdAt.toMillis()<60000)fail('resource-exhausted','انتظر قليلًا قبل إعادة إرسال الطلب');
      tx.set(ref(`friendRequests/${reqId}`),{fromUid:uid,toUid:d.toUid,fromName:me.name,fromAvatar:me.avatar,toName:to.name,status:'pending',createdAt:stamp(now),expiresAt:stamp(now+7*24*HOUR)});return {status:'pending'};
    }
    if(op==='answerFriend'){
      keys(d,['requestId','accept']);if(!id(d.requestId)||typeof d.accept!=='boolean')fail('invalid-argument','طلب غير صالح');const r=await tx.get(ref(`friendRequests/${d.requestId}`)),q=r.data();
      if(!q||q.toUid!==uid)fail('permission-denied','الطلب غير متاح');
      if(q.status!=='pending')return {status:q.status};if(q.fromUid===uid||!id(q.fromUid))fail('failed-precondition','طلب غير صالح');if(!q.createdAt?.toMillis||q.createdAt.toMillis()+7*24*HOUR<now||(q.expiresAt&&q.expiresAt.toMillis()<now))fail('failed-precondition','انتهت صلاحية الطلب');
      const [a,b]=await Promise.all([profile(tx,q.fromUid),profile(tx,uid)]);
      tx.update(r.ref,{status:d.accept?'accepted':'rejected',updatedAt:stamp(now)});
      if(d.accept){tx.set(ref(`users/${uid}/friends/${q.fromUid}`),{uid:q.fromUid,name:a.name,avatar:a.avatar,searchId:a.searchId,createdAt:stamp(now)});tx.set(ref(`users/${q.fromUid}/friends/${uid}`),{uid,name:b.name,avatar:b.avatar,searchId:b.searchId,createdAt:stamp(now)});}return {status:d.accept?'accepted':'rejected'};
    }
    if(op==='removeFriend'){
      keys(d,['toUid']);if(!id(d.toUid)||d.toUid===uid)fail('invalid-argument','مستخدم غير صالح');
      const ids=[hash(`${uid}:${d.toUid}`),hash(`${d.toUid}:${uid}`)];const requests=await tx.getAll(...ids.map(x=>ref(`friendRequests/${x}`)));
      tx.delete(ref(`users/${uid}/friends/${d.toUid}`));tx.delete(ref(`users/${d.toUid}/friends/${uid}`));for(const r of requests)if(r.exists)tx.update(r.ref,{status:'rejected',updatedAt:stamp(now)});return {status:'removed'};
    }
    if(op==='listRooms'){
      keys(d,['cursor']);let q=db.collection('rooms').where('protocolVersion','==',VERSION).where('status','==','waiting').where('isPublic','==',true).orderBy('__name__');if(d.cursor){if(!id(d.cursor))fail('invalid-argument','صفحة غير صالحة');q=q.startAfter(d.cursor);}const rooms=await tx.get(q.limit(20));return {items:rooms.docs.filter(x=>x.data().expiresAt.toMillis()>now).map(x=>publicRoom(x.data())),cursor:rooms.size===20?rooms.docs.at(-1).id:''};
    }
    if(op==='activeRoom'){
      keys(d,[]);const a=await tx.get(ref(`activeRooms/${uid}`));if(!a.exists)return {roomId:''};const r=await tx.get(ref(`rooms/${a.data().roomId}`));return {roomId:r.exists&&r.data().memberUids.includes(uid)&&r.data().expiresAt.toMillis()>now?r.id:''};
    }
    if(op==='createRoom'){
      keys(d,['mode','target','difficulty','isPublic','password']);if(!['Teams','FFA'].includes(d.mode)||![31,61,101].includes(d.target)||![0,1,2].includes(d.difficulty)||typeof d.isPublic!=='boolean')fail('invalid-argument','إعدادات غرفة غير صالحة');const password=str(d.password??'',0,64);
      const me=await profile(tx,uid),active=await tx.get(ref(`activeRooms/${uid}`));if(!completeProfile(me))fail('failed-precondition','أكمل ملف اللاعب أولًا');if(active.exists){const old=await tx.get(ref(`rooms/${active.data().roomId}`));if(old.exists&&old.data().memberUids.includes(uid)&&old.data().expiresAt.toMillis()>now)fail('failed-precondition','غادر غرفتك الحالية أولًا');}
      const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789',bytes=randomBytes(6),code=Array.from(bytes,x=>alphabet[x%alphabet.length]).join(''),roomId=`v2_${code}`;
      const exists=await tx.get(ref(`rooms/${roomId}`));if(exists.exists)fail('aborted','أعد إنشاء الغرفة');
      const r={_id:roomId,protocolVersion:VERSION,code,hostId:uid,hostName:me.name,status:'waiting',isPublic:d.isPublic,locked:!!password,mode:d.mode,target:d.target,difficulty:d.difficulty,players:[player(me,0)],botSeats:[],memberUids:[uid],revision:0,createdAt:stamp(now),updatedAt:stamp(now),expiresAt:stamp(now+6*HOUR)};
      const salt=randomBytes(16).toString('hex'),secret={salt,passwordHash:password?passwordHash(password,salt):'',presence:{[uid]:now}};
      saveRoom(tx,r,secret,null,now);tx.set(ref(`activeRooms/${uid}`),{roomId});return reply(r,null,uid,now);
    }
    if(op==='invite'){
      keys(d,['roomId','toUid']);if(!id(d.toUid)||d.toUid===uid)fail('invalid-argument','مستلم غير صالح');const [r]=await roomData(tx,d.roomId),me=await profile(tx,uid);await profile(tx,d.toUid);
      const friend=await tx.get(ref(`users/${uid}/friends/${d.toUid}`));if(!r.memberUids.includes(uid)||r.status!=='waiting'||!friend.exists)fail('permission-denied','الدعوة متاحة لأصدقاء أعضاء غرفة الانتظار');
      const inviteId=hash(`${d.roomId}:${uid}:${d.toUid}`);tx.set(ref(`roomInvites/${inviteId}`),{fromUid:uid,toUid:d.toUid,fromName:me.name,fromAvatar:me.avatar,roomId:d.roomId,roomCode:r.code,status:'pending',createdAt:stamp(now),expiresAt:stamp(now+10*60000)});return {status:'pending'};
    }
    if(op==='joinRoom'||op==='answerInvite'){
      keys(d,op==='joinRoom'?['code','password']:['inviteId','accept']);let invitation=null;
      let roomId;
      if(op==='answerInvite'){
        if(!id(d.inviteId)||typeof d.accept!=='boolean')fail('invalid-argument','دعوة غير صالحة');const i=await tx.get(ref(`roomInvites/${d.inviteId}`));invitation=i.data();if(!invitation||invitation.toUid!==uid||invitation.status!=='pending'||invitation.expiresAt.toMillis()<=now)fail('failed-precondition','الدعوة غير متاحة أو انتهت');
        if(!d.accept){tx.update(i.ref,{status:'rejected'});return {status:'rejected'};}roomId=invitation.roomId;
      }else {const code=str(d.code,6,6).toUpperCase();if(!/^[A-Z2-9]{6}$/.test(code))fail('invalid-argument','رمز غير صالح');roomId=`v2_${code}`;}
      const [r,secret,state]=await roomData(tx,roomId),me=await profile(tx,uid),active=await tx.get(ref(`activeRooms/${uid}`));
      if(active.exists&&active.data().roomId!==roomId){const old=await tx.get(ref(`rooms/${active.data().roomId}`));if(old.exists&&old.data().memberUids.includes(uid)&&old.data().expiresAt.toMillis()>now)fail('failed-precondition','غادر غرفتك الحالية أولًا');}
      if(invitation&&!r.memberUids.includes(invitation.fromUid))fail('failed-precondition','غادر صاحب الدعوة الغرفة');
      if(!r.memberUids.includes(uid)){
        if(!completeProfile(me))fail('failed-precondition','أكمل ملف اللاعب أولًا');
        if(r.status!=='waiting'||r.players.length>=4)fail('failed-precondition','الغرفة ممتلئة أو بدأت المباراة');
        if(!invitation&&secret.passwordHash){const password=str(d.password??'',0,64),attempt=passwordHash(password,secret.salt);if(!timingSafeEqual(Buffer.from(attempt,'hex'),Buffer.from(secret.passwordHash,'hex')))fail('permission-denied','رمز الغرفة أو كلمة المرور غير صحيحة');}
        const seat=[0,1,2,3].find(i=>!r.players.some(p=>p.index===i));r.players.push(player(me,seat));r.botSeats=(r.botSeats||[]).filter(i=>i!==seat);r.memberUids.push(uid);
      }
      secret.presence[uid]=now;saveRoom(tx,r,secret,state,now);tx.set(ref(`activeRooms/${uid}`),{roomId});if(invitation)tx.update(ref(`roomInvites/${d.inviteId}`),{status:'accepted'});return reply(r,state,uid,now);
    }
    if(['poll','fillBots','start','move','nextRound','leave'].includes(op)){
      keys(d,op==='move'?['roomId','action','value','expectedRevision']:['roomId']);
      const [r,secret,state0]=await roomData(tx,d.roomId);if(!r.memberUids.includes(uid))fail('permission-denied','لم تعد عضوًا في الغرفة');let state=state0;
      if(op==='leave'){
        const active=await tx.get(ref(`activeRooms/${uid}`));r.players=r.players.filter(p=>p.uid!==uid);r.memberUids=r.memberUids.filter(x=>x!==uid);delete secret.presence[uid];
        if(r.hostId===uid){r.hostId=r.players[0]?.uid||'';r.hostName=r.players[0]?.name||'';}
        if(r.players.length===0){r.status='finished';secret.state='';state=null;}saveRoom(tx,r,secret,state,now);if(active.data()?.roomId===d.roomId)tx.delete(active.ref);return {status:'left'};
      }
      let changed=false;
      if(now-(secret.presence[uid]||0)>15000){secret.presence[uid]=now;changed=true;}
      for(const p of r.players){const status=now-(secret.presence[p.uid]||0)>45000?'disconnected':'connected';if(p.status!==status){p.status=status;changed=true;}}
      if(r.status==='waiting'){
        const remaining=r.players.filter(p=>p.uid===uid||now-(secret.presence[p.uid]||0)<120000);
        if(remaining.length!==r.players.length){r.players=remaining;r.memberUids=remaining.map(p=>p.uid);changed=true;}
      }
      if(!r.players.some(p=>p.uid===r.hostId&&p.status==='connected')){
        const leader=r.players.find(p=>p.status==='connected');
        if(leader){r.hostId=leader.uid;r.hostName=leader.name;changed=true;}
      }
      if(op==='fillBots'){
        if(uid!==r.hostId)fail('permission-denied','المضيف فقط يضيف البوتات');if(r.status!=='waiting')fail('failed-precondition','بدأت المباراة بالفعل');
        r.botSeats=[0,1,2,3].filter(i=>!r.players.some(p=>p.index===i));changed=true;
      }else if(op==='start'){
        if(uid!==r.hostId)fail('permission-denied','المضيف فقط يبدأ المباراة');if(r.status!=='waiting')fail('failed-precondition','بدأت المباراة بالفعل');
        if([0,1,2,3].some(i=>!r.players.some(p=>p.index===i)&&!(r.botSeats||[]).includes(i)))fail('failed-precondition','انتظر اكتمال اللاعبين أو استكمل المقاعد ببوتات أولًا');
        const names=Array.from({length:4},(_,i)=>r.players.find(p=>p.index===i)?.name||['سالم','عمر','خالد','علي'][i]);state=engine.start(names,r.mode,r.target,r.difficulty);state.swap_preview={};gate(state,'reveal',4500,now);r.status='playing';changed=true;
      }else if(op==='move'){
        if(!state||r.status!=='playing'||state.presentation||!Number.isInteger(d.expectedRevision)||d.expectedRevision!==state.revision||now>=state.turnDueAt)fail('failed-precondition','تغيّر الدور؛ انتظر تحديث الطاولة');
        const p=r.players.find(p=>p.uid===uid).index,before=[...state.exposed];if(!engine.act(state,p,d.action,d.value))fail('invalid-argument','هذه الحركة غير مسموحة في دورك');
        if(d.action==='swap'){state.swap_preview={king:p,target:d.value,before};gate(state,'swap_result',3200,now);}else nextDeadline(state,r,now);changed=true;
      }else if(op==='nextRound'){
        if(!state||state.phase!=='round_end'||state.winner>=0||uid!==r.hostId)fail('failed-precondition','لا يمكن بدء الجولة الآن');engine.nextRound(state);gate(state,'reveal',4500,now);state.swap_preview={};changed=true;
      }else changed=advance(state,r,now)||changed;
      if(changed&&readOnly)return null;
      if(changed)saveRoom(tx,r,secret,state,now);return reply(r,state,uid,now);
    }
    fail('invalid-argument','عملية غير معروفة');
  }
  const readOps=new Set(['poll','search','friends','requests','invites','listRooms','activeRoom','presence','publicProfile','store']);
  return async function execute(uid,input){
    if(!id(uid))fail('unauthenticated','سجل دخولك أولًا');keys(input,['op','payload','requestId','protocolVersion']);if(input.protocolVersion!==VERSION)fail('failed-precondition','حدّث اللعبة إلى الإصدار الجديد');
    const op=str(input.op,1,32),d=input.payload??{},mutation=!readOps.has(op);if(mutation&&(!id(input.requestId)||input.requestId.length<16))fail('invalid-argument','معرّف عملية مطلوب');
    // Limit attempts, including failed passwords, separately from the operation transaction.
    const now=clock(),sensitive=['joinRoom','createRoom','invite','requestFriend'].includes(op),window=Math.floor(now/60000);
    // One Render instance: throttle in memory instead of billing a Firestore write per poll.
    if(rateLimits.size>=10000)for(const [key,value] of rateLimits)if(value.window!==window)rateLimits.delete(key);
    if(!rateLimits.has(uid)&&rateLimits.size>=10000)fail('resource-exhausted','الخادم مشغول؛ حاول لاحقًا');
    const prior=rateLimits.get(uid),rate=prior?.window===window?prior:{window,count:0,sensitive:0};
    if(rate.count>=180||(sensitive&&rate.sensitive>=12))fail('resource-exhausted','طلبات كثيرة؛ انتظر دقيقة');
    rate.count++;if(sensitive)rate.sensitive++;rateLimits.set(uid,rate);
    // Unchanged polls use a consistent snapshot without locking out player moves.
    if(op==='poll'){
      const snapshot=await db.runTransaction(tx=>operate(tx,uid,op,d,clock(),true),{readOnly:true});
      if(snapshot!==null)return snapshot;
    }
    return db.runTransaction(async tx=>{
      const receipt=mutation?ref(`operations/${hash(`${uid}:${input.requestId}`)}`):null;
      const fingerprint=hash(JSON.stringify({op,d}));
      if(receipt){const previous=await tx.get(receipt);if(previous.exists){if(previous.data().fingerprint!==fingerprint)fail('invalid-argument','معرّف عملية مستخدم');return JSON.parse(previous.data().result);}}
      const result=await operate(tx,uid,op,d,clock());
      if(receipt)tx.create(receipt,{uid,fingerprint,result:JSON.stringify(result),expiresAt:stamp(now+24*HOUR)});
      return result;
    });
  };
}
async function removeExpired(db,ref,cutoff){
  return db.runTransaction(async tx=>{
    const current=await tx.get(ref),expiry=current.data()?.expiresAt;
    if(!expiry||expiry.toMillis()>cutoff.toMillis())return false;
    tx.delete(ref);return true;
  });
}
module.exports={createService,VERSION,advance,reply,removeExpired};
