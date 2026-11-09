'use strict';
const {randomBytes,randomInt,scryptSync,timingSafeEqual,createHash} = require('node:crypto');
const {Timestamp} = require('firebase-admin/firestore');
const {AppError:HttpsError} = require('./errors');
const engine = require('./engine');
const {completeProfile,validateProfileEdit}=require('./profile');
const {removeMember,removeRoom}=require('./room-lifecycle');
const {economy,saveEconomy,contacts,saveContacts,hasFriend,MAX_CONTACTS}=require('./account-data');
const VERSION=3, HOUR=3600000;
const CATALOG=[
  {id:'emerald',kind:'frame',name:'إطار الزمرد',price:100},
  {id:'royal',kind:'frame',name:'الإطار الملكي',price:250},
  {id:'ruby',kind:'frame',name:'إطار الياقوت',price:500},
  {id:'falcon',kind:'frame',name:'جناح الصقر',price:180},
  {id:'lunar',kind:'frame',name:'هلال الفضة',price:320},
  {id:'sunforge',kind:'frame',name:'تاج الشمس',price:650},
  {id:'phoenix_gold',kind:'frame',name:'أجنحة العنقاء',price:1800},
  {id:'scarlet_court',kind:'frame',name:'عرش الياقوت',price:2600},
  {id:'sovereign_laurel',kind:'frame',name:'إكليل الملوك',price:3500},
  {id:'inferno_dragon',kind:'frame',name:'تنّين اللهب',price:4200},
  {id:'comet',kind:'effect',name:'شرارة العنبر',price:120},
  {id:'orbit',kind:'effect',name:'مدار اللؤلؤ',price:220},
  {id:'pulse',kind:'effect',name:'نبض الياقوت',price:380},
  {id:'aurora',kind:'effect',name:'شفق الزمرد',price:620},
  {id:'royal_sweep',kind:'effect',name:'لمعة التاج',price:780},
  {id:'ember_ring',kind:'effect',name:'جمر التنين',price:980},
];
const validCosmetic=(value,kind)=>CATALOG.some(item=>item.id===value&&item.kind===kind)?value:'';
const cosmetics=p=>({frame:validCosmetic(p.frame,'frame'),effect:validCosmetic(p.effect,'effect')});
const storeView=(wallet,p)=>({gold:wallet?.gold||0,owned:wallet?.owned||[],equipped:validCosmetic(p.frame,'frame'),equippedEffect:validCosmetic(p.effect,'effect'),items:CATALOG});
const fail=(code,message)=>{throw new HttpsError(code,message);};
const id=(x)=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(x);
function str(x,min,max){if(typeof x!=='string'||x.trim().length<min||x.length>max)fail('invalid-argument','بيانات غير صالحة');return x.trim();}
function keys(d,allowed){if(!d||typeof d!=='object'||Array.isArray(d)||Object.keys(d).some(k=>!allowed.includes(k)))fail('invalid-argument','حقول غير مسموحة');}
const stamp=n=>Timestamp.fromMillis(n);
const hash=x=>createHash('sha256').update(x).digest('hex');
function pendingRequest(snapshot,now){const request=snapshot.data();return request?.status==='pending'&&request.createdAt?.toMillis()>now-7*24*HOUR&&(!request.expiresAt||request.expiresAt.toMillis()>now);}
function safeProfile(p){return {uid:p.uid,name:p.name,searchId:p.searchId,country:p.country,gender:p.gender,avatar:p.avatar,...cosmetics(p),points:p.points||0,...(p.showAge===true&&Number.isInteger(p.age)&&p.age>=1&&p.age<=120?{age:p.age}:{}),status:p.status==='online'&&p.lastSeen?.toMillis()>Date.now()-150000?'online':'offline'};}
function player(p,index){return {uid:p.uid,name:p.name,avatar:p.avatar,...cosmetics(p),country:p.country,index,status:'connected'};}
function publicRoom(r){const {secret,gameState,chatCooldown,chat,...data}=r;return {...data,createdAt:r.createdAt.toMillis(),updatedAt:r.updatedAt.toMillis(),expiresAt:r.expiresAt.toMillis()};}
function passwordHash(password,salt){return scryptSync(password,salt,32).toString('hex');}
function gate(state,kind,ms,now){state.presentation=kind;state.presentationUntil=now+ms;state.turnDueAt=now+ms;}
function shuffleSeats(room){
  const seats=[0,1,2,3];
  for(let i=3;i>0;i--){const j=randomInt(i+1);[seats[i],seats[j]]=[seats[j],seats[i]];}
  for(const player of room.players)player.index=seats[player.index];
  room.botSeats=(room.botSeats||[]).map(index=>seats[index]).sort((a,b)=>a-b);
}
function readySeats(state,room){
  return Array.from({length:4},(_,index)=>{
    const player=room.players.find(p=>p.index===index);
    return !player||player.status!=='connected'||(state.readyUids||[]).includes(player.uid);
  });
}
function nextDeadline(state,room,now){
  const human=room.players.some(p=>p.index===state.current&&p.status==='connected');
  state.turn_seconds=human?25:state.phase==='swapping'?3:1.6;
  state.turnDueAt=now+(state.phase==='collecting'?2200:state.phase==='round_end'?15000:state.turn_seconds*1000);
}
function advance(state,room,now){
  if(!state)return false;
  if(state.presentation){if(now<state.presentationUntil)return false;state.presentation='';state.swap_preview={};state.revision++;nextDeadline(state,room,now);return true;}
  if(state.winner>=0)return false;
  if(state.phase==='round_end'){
    if(now<state.turnDueAt&&!readySeats(state,room).every(Boolean))return false;
    delete state.readyUids;
    engine.nextRound(state);state.swap_preview={};gate(state,'reveal',4500,now);return true;
  }
  if(now<state.turnDueAt)return false;
  if(state.phase==='collecting')engine.collect(state);
  else {const a=engine.ai(state,state.current),before=[...state.exposed],p=state.current;engine.act(state,p,a.action,a.value);if(a.action==='swap'){state.swap_preview={king:p,target:a.value,before};gate(state,'swap_result',3200,now);return true;}}
  nextDeadline(state,room,now);return true;
}
function reply(room,state,uid,now){
  const p=room.players.find(p=>p.uid===uid);if(!p)fail('permission-denied','لست عضوًا في الغرفة');
  let view={};
  if(state){view=engine.view(state,p.index);view.presentation_remaining=Math.max(0,(state.presentationUntil-now)/1000);view.turn_remaining=Math.max(0,(state.turnDueAt-now)/1000);view.humans=Array.from({length:4},(_,i)=>room.players.some(p=>p.index===i&&p.status==='connected'));if(state.presentation){view.legal=[];view.available_bids=[];}}
  if(state?.phase==='round_end'&&state.winner<0){view.ready_seats=readySeats(state,room);delete view.readyUids;}
  return {room:{...publicRoom(room),chat:room.chat||[]},view,serverTime:now};
}
function createService(db, clock=Date.now, notifications){
  // shortcut: single-instance memory limits reset on restart; share counters before scaling out.
  const rateLimits=new Map();
  // shortcut: five-second snapshots bound cross-instance staleness; use shared invalidation before scaling out.
  const pollCache=new Map();
  const ref=p=>db.doc(p);
  function pollSnapshot(roomId,now){
    const cached=pollCache.get(roomId);
    if(cached&&now<cached.until)return cached.promise;
    const entry={until:now+5000,promise:db.runTransaction(async tx=>{
      const docs=await tx.getAll(ref(`rooms/${roomId}`),ref(`roomSecrets/${roomId}`));
      if(!docs[0].exists)docs.push(await tx.get(ref(`roomResults/${roomId}`)));
      return docs;
    },{readOnly:true})};
    pollCache.delete(roomId);
    if(pollCache.size>=256)pollCache.delete(pollCache.keys().next().value);
    pollCache.set(roomId,entry);
    entry.promise.catch(()=>{if(pollCache.get(roomId)===entry)pollCache.delete(roomId);});
    return entry.promise;
  }
  const profile=async(tx,uid)=>{const s=await tx.get(ref(`users/${uid}`));if(!s.exists)fail('failed-precondition','أكمل ملفك الشخصي أولًا');const p=s.data();if(p.deleting)fail('permission-denied','الحساب قيد الحذف');if(p.uid!==uid)fail('failed-precondition','أعد مزامنة ملفك الشخصي');return p;};
  async function roomData(tx,roomId,allowMissing=false,snapshot){if(!id(roomId))fail('invalid-argument','رمز غرفة غير صالح');const [r,s]=snapshot??await tx.getAll(ref(`rooms/${roomId}`),ref(`roomSecrets/${roomId}`));if(!r.exists&&allowMissing)return null;if(!r.exists||r.data().protocolVersion!==VERSION||!s.exists)fail('not-found','الغرفة غير موجودة أو تحتاج إصدارًا أحدث');if(r.data().expiresAt.toMillis()<=clock())fail('not-found','انتهت صلاحية الغرفة');return [r.data(),s.data(),s.data().state?JSON.parse(s.data().state):null];}
  async function saveRoom(tx,r,secret,state,now){
    r.updatedAt=stamp(now);r.expiresAt=stamp(now+(r.status==='finished'?HOUR:6*HOUR));r.revision=(r.revision||0)+1;
    if(state?.winner>=0&&r.status!=='finished'){
      r.status='finished';r.expiresAt=stamp(now+5*60000);
      const result=reply(r,state,r.players[0].uid,now);
      result.room.chat=[];
      result.view.hand=[];
      result.view.legal=[];
      result.view.available_bids=[];
      const players=await tx.getAll(...r.players.map(p=>ref(`users/${p.uid}`)));
      const accounts=await Promise.all(players.map(doc=>economy(tx,db,doc.id,doc.data()||{})));
      await removeRoom(tx,db,r._id,r.memberUids);
      tx.set(ref(`roomResults/${r._id}`),{memberUids:r.memberUids,room:result.room,view:result.view,expiresAt:r.expiresAt});
      // Award once in the same transaction as the terminal state; legacy profile points are not trusted.
      for(let i=0;i<players.length;i++){
        const doc=players[i],p=r.players[i],account=accounts[i],won=p.index===state.winner;
        if(!doc.exists||doc.data().deleting)continue;
        account.value.games+=1;account.value.wins+=won?1:0;account.value.points+=won?10:2;
        if(r.players.length>=2&&p.status==='connected')account.value.gold+=won?20:5;
        saveEconomy(tx,doc.ref,account);
      }
      return;
    }
    tx.set(ref(`rooms/${r._id}`),r);tx.set(ref(`roomSecrets/${r._id}`),{...secret,state:state?JSON.stringify(state):'',expiresAt:r.expiresAt});
  }
  async function operate(tx,uid,op,d,now,pollDocs,notify){
    if(op==='presence'){
      keys(d,['online']);if(typeof d.online!=='boolean')fail('invalid-argument','حالة غير صالحة');await profile(tx,uid);
      tx.update(ref(`users/${uid}`),{status:d.online?'online':'offline',lastSeen:stamp(now),updatedAt:stamp(now)});return {status:'ok'};
    }
    if(op==='ownProfile'){
      keys(d,[]);
      const user=(await tx.get(ref(`users/${uid}`))).data();
      if(user?.deleting)fail('permission-denied','الحساب قيد الحذف');
      if(user?.uid!==uid||typeof user.profileComplete!=='boolean'||!/^[A-Z0-9-]{3,32}$/.test(user.searchId??''))fail('not-found','ملف اللاعب يحتاج تهيئة');
      const account=await economy(tx,db,uid,user);
      if(!user.economy)saveEconomy(tx,ref(`users/${uid}`),account);
      return {profile:{...safeProfile(user),age:user.age||0,showAge:user.showAge===true,
        profileComplete:completeProfile(user),points:account.value.points,gold:account.value.gold}};
    }
    if(op==='profile'){
      keys(d,['name','age','country','gender','avatar','initialize','complete','showAge']);
      if(d.showAge!==undefined&&typeof d.showAge!=='boolean')fail('invalid-argument','إعداد ظهور العمر غير صالح');
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
      const account=await economy(tx,db,uid,old);
      const age=d.initialize?(old.age||0):(d.age??old.age??0);
      const p={uid,name,age,showAge:d.initialize?old.showAge===true:(d.showAge??(old.showAge===true)),searchId,country,gender,avatar,...cosmetics(old),status:'online',lastSeen:stamp(now),updatedAt:stamp(now)};
      p.profileComplete=completeProfile(p);
      if(d.complete&&!p.profileComplete)fail('invalid-argument','أكمل الاسم والعمر والجنس والبلد والصورة أولًا');
      tx.set(ref(`searchIds/${searchId}`),{uid,createdAt:stamp(now)});
      tx.set(doc.ref,{...p,...(!doc.exists?{contacts:[]}:{}),economy:account.value},{merge:true});
      for(const legacy of account.legacy)tx.delete(legacy.ref);
      return {profile:{...safeProfile(p),age:p.age,showAge:p.showAge,profileComplete:p.profileComplete,points:account.value.points,gold:account.value.gold}};
    }
    if(op==='publicProfile'){
      keys(d,['uid']);if(!id(d.uid))fail('invalid-argument','معرّف لاعب غير صالح');
      const p=await profile(tx,d.uid),account=await economy(tx,db,d.uid,p);
      let relationship='self',requestId;
      if(d.uid!==uid){
        const own=(await tx.get(ref(`users/${uid}`))).data()||{};
        relationship=await hasFriend(tx,db,uid,own,d.uid)?'friends':'none';
        if(relationship==='none'){
          const incomingId=hash(`${d.uid}:${uid}`);
          const [sent,incoming]=await tx.getAll(ref(`friendRequests/${hash(`${uid}:${d.uid}`)}`),ref(`friendRequests/${incomingId}`));
          if(pendingRequest(incoming,now)){relationship='incoming';requestId=incomingId;}
          else if(pendingRequest(sent,now))relationship='pending';
        }
      }
      const {points,games,wins}=account.value;
      return {profile:{...safeProfile(p),...(d.uid===uid?{age:p.age}:{}),lastSeenAt:p.lastSeen?.toMillis()||0,points,games,wins},relationship,requestId};
    }
    if(['store','buyItem','equipItem'].includes(op)){
      keys(d,op==='store'?[]:op==='equipItem'?['itemId','slot']:['itemId']);const p=await profile(tx,uid);
      const account=await economy(tx,db,uid,p),wallet=account.value;
      if(op!=='store'){
        const item=CATALOG.find(item=>item.id===d.itemId);
        if(!item&&!(op==='equipItem'&&d.itemId===''))fail('invalid-argument','عنصر غير متاح');
        if(op==='buyItem'&&!wallet.owned.includes(item.id)){
          if(!Number.isSafeInteger(wallet.gold)||wallet.gold<item.price)fail('failed-precondition','رصيد الذهب غير كافٍ');
          wallet.gold-=item.price;wallet.owned.push(item.id);
          saveEconomy(tx,ref(`users/${uid}`),account);
        }
        if(op==='equipItem'){
          const slot=item?.kind??d.slot??'frame';
          if(!['frame','effect'].includes(slot)||(d.slot!==undefined&&d.slot!==slot))fail('invalid-argument','خانة تجهيز غير صالحة');
          if(item&&!wallet.owned.includes(item.id))fail('permission-denied','اشترِ القطعة أولًا');
          const active=await tx.get(ref(`activeRooms/${uid}`));
          if(active.exists){
            const roomRef=ref(`rooms/${active.data().roomId}`);
            const room=(await tx.get(roomRef)).data();
            const current=room?.protocolVersion===VERSION&&room.players.find(player=>player.uid===uid);
            if(current&&room.status!=='finished'&&room.expiresAt.toMillis()>now&&current[slot]!==d.itemId){
              current[slot]=d.itemId;
              tx.update(roomRef,{players:room.players,revision:room.revision+1,updatedAt:stamp(now)});
            }
          }
          p[slot]=d.itemId;
          tx.update(ref(`users/${uid}`),{[slot]:p[slot],updatedAt:stamp(now)});
        }
      }
      return {...storeView(wallet,p),points:wallet.points};
    }
    if(op==='search'){
      keys(d,['searchId']);const searchId=str(d.searchId,3,32).toUpperCase();if(!/^[A-Z0-9-]+$/.test(searchId))fail('invalid-argument','معرّف غير صالح');
      const reservation=await tx.get(ref(`searchIds/${searchId}`));let userId=reservation.data()?.uid;
      if(!userId){const found=await tx.get(db.collection('users').where('searchId','==',searchId).limit(2));if(found.size!==1)return {profile:null};userId=found.docs[0].id;}
      if(userId===uid)return {profile:null};const p=await tx.get(ref(`users/${userId}`));return {profile:p.exists&&!p.data().deleting?{...safeProfile(p.data()),uid:userId}:null};
    }
    if(op==='friends'||op==='requests'||op==='invites'){
      keys(d,['cursor']);
      if(d.cursor&&!id(d.cursor))fail('invalid-argument','صفحة غير صالحة');
      if(op==='friends'){
        const user=await profile(tx,uid),state=await contacts(tx,db,uid,user);
        if(state){
          if(!Array.isArray(user.contacts))saveContacts(tx,db,uid,state);
          const page=state.items.filter(friend=>!d.cursor||friend.uid>d.cursor).sort((a,b)=>a.uid<b.uid?-1:1).slice(0,31);
          return {items:page.slice(0,30).map(friend=>({...friend,_id:friend.uid})),cursor:page.length>30?page[29].uid:''};
        }
      }
      const collection=op==='friends'?db.collection(`users/${uid}/friends`):db.collection(op==='requests'?'friendRequests':'roomInvites');
      let q=op==='friends'?collection:collection.where('toUid','==',uid).where('status','==','pending');q=q.orderBy('__name__');
      if(d.cursor)q=q.startAfter(d.cursor);const docs=await tx.get(q.limit(30));
      let items=docs.docs.map(x=>({...x.data(),_id:x.id}));
      if(op==='friends'&&items.length){const profiles=await tx.getAll(...items.map(x=>ref(`users/${x.uid}`)));items=items.map((f,i)=>profiles[i].exists?{...safeProfile(profiles[i].data()),uid:f.uid,_id:f._id}:f);}
      if(op==='requests')items=items.filter(x=>x.createdAt?.toMillis()>now-7*24*HOUR&&(!x.expiresAt||x.expiresAt.toMillis()>now));
      if(op==='invites')items=items.filter(x=>x.expiresAt?.toMillis()>now);
      return {items:items.map(x=>({...x,createdAt:x.createdAt?.toMillis()||0,updatedAt:x.updatedAt?.toMillis()||0,expiresAt:x.expiresAt?.toMillis()||0})),cursor:docs.size===30?docs.docs.at(-1).id:''};
    }
    if(op==='requestFriend'){
      keys(d,['toUid']);if(!id(d.toUid)||d.toUid===uid)fail('invalid-argument','اختر لاعبًا آخر');
      const [me,to]=await Promise.all([profile(tx,uid),profile(tx,d.toUid)]),reqId=hash(`${uid}:${d.toUid}`);
      if(await hasFriend(tx,db,uid,me,d.toUid))return {status:'friends'};
      const [req,reverse]=await tx.getAll(ref(`friendRequests/${reqId}`),ref(`friendRequests/${hash(`${d.toUid}:${uid}`)}`));
      if(pendingRequest(reverse,now))fail('already-exists','لديك طلب وارد من هذا اللاعب؛ اقبله من الطلبات');if(pendingRequest(req,now))return {status:'pending'};
      if(req.exists&&now-req.data().createdAt.toMillis()<60000)fail('resource-exhausted','انتظر قليلًا قبل إعادة إرسال الطلب');
      tx.set(ref(`friendRequests/${reqId}`),{fromUid:uid,toUid:d.toUid,fromName:me.name,fromAvatar:me.avatar,fromSearchId:me.searchId,fromCountry:me.country,toName:to.name,status:'pending',createdAt:stamp(now),expiresAt:stamp(now+7*24*HOUR)});
      notify(d.toUid,{kind:'requests',name:me.name});return {status:'pending'};
    }
    if(op==='answerFriend'){
      keys(d,['requestId','accept','fromUid']);const reqId=id(d.requestId)?d.requestId:(id(d.fromUid)?hash(`${d.fromUid}:${uid}`):null);if(!reqId||typeof d.accept!=='boolean')fail('invalid-argument','طلب غير صالح');const r=await tx.get(ref(`friendRequests/${reqId}`)),q=r.data();
      if(!q||q.toUid!==uid)fail('permission-denied','الطلب غير متاح');
      if(q.status!=='pending')return {status:q.status};if(q.fromUid===uid||!id(q.fromUid))fail('failed-precondition','طلب غير صالح');if(!q.createdAt?.toMillis||q.createdAt.toMillis()+7*24*HOUR<now||(q.expiresAt&&q.expiresAt.toMillis()<now))fail('failed-precondition','انتهت صلاحية الطلب');
      const [a,b]=await Promise.all([profile(tx,q.fromUid),profile(tx,uid)]);
      tx.delete(r.ref);
      if(d.accept){
        for(const [own,other] of [[a,b],[b,a]]){
          const entry={uid:other.uid,name:other.name,avatar:other.avatar,searchId:other.searchId||'',country:other.country||'',createdAt:now};
          if(Array.isArray(own.contacts)){
            const items=own.contacts.filter(friend=>friend.uid!==other.uid);
            if(items.length>=MAX_CONTACTS)fail('resource-exhausted','قائمة الأصدقاء ممتلئة');
            tx.update(ref(`users/${own.uid}`),{contacts:[...items,entry]});
          }else tx.set(ref(`users/${own.uid}/friends/${other.uid}`),{...entry,createdAt:stamp(now)});
        }
        notify(q.fromUid,{kind:'friends',name:b.name});
      }
      return {status:d.accept?'accepted':'rejected'};
    }
    if(op==='cancelFriend'){
      keys(d,['toUid']);if(!id(d.toUid)||d.toUid===uid)fail('invalid-argument','مستخدم غير صالح');
      const request=ref(`friendRequests/${hash(`${uid}:${d.toUid}`)}`);
      const own=await profile(tx,uid),sent=await tx.get(request);
      if(await hasFriend(tx,db,uid,own,d.toUid)||sent.data()?.status==='accepted')fail('failed-precondition','تم قبول الطلب؛ حدّث البروفايل لإدارة الصداقة');
      if(!sent.exists||sent.data().status!=='pending')return {status:'cancelled'};
      if(sent.data().fromUid!==uid||sent.data().toUid!==d.toUid)fail('permission-denied','الطلب غير متاح');
      tx.delete(request);notify(d.toUid,{kind:'requests'});return {status:'cancelled'};
    }
    if(op==='removeFriend'){
      keys(d,['toUid']);if(!id(d.toUid)||d.toUid===uid)fail('invalid-argument','مستخدم غير صالح');
      const ids=[hash(`${uid}:${d.toUid}`),hash(`${d.toUid}:${uid}`)];const requests=await tx.getAll(...ids.map(x=>ref(`friendRequests/${x}`)));
      const users=await tx.getAll(ref(`users/${uid}`),ref(`users/${d.toUid}`));
      for(const [i,other] of [[0,d.toUid],[1,uid]]){
        const list=users[i].data()?.contacts;
        if(Array.isArray(list)){
          if(list.some(friend=>friend.uid===other))tx.update(users[i].ref,{contacts:list.filter(friend=>friend.uid!==other)});
        }else tx.delete(ref(`users/${users[i].id}/friends/${other}`));
      }
      for(const r of requests)if(r.exists)tx.delete(r.ref);notify(d.toUid,{kind:'friends'});return {status:'removed'};
    }
    if(op==='listRooms'){
      keys(d,['cursor']);let q=db.collection('rooms').where('protocolVersion','==',VERSION).where('status','==','waiting').where('isPublic','==',true).orderBy('__name__');if(d.cursor){if(!id(d.cursor))fail('invalid-argument','صفحة غير صالحة');q=q.startAfter(d.cursor);}const rooms=await tx.get(q.limit(20));return {items:rooms.docs.filter(x=>x.data().expiresAt.toMillis()>now).map(x=>publicRoom(x.data())),cursor:rooms.size===20?rooms.docs.at(-1).id:''};
    }
    if(op==='activeRoom'){
      keys(d,[]);const a=await tx.get(ref(`activeRooms/${uid}`));if(!a.exists)return {roomId:''};const r=await tx.get(ref(`rooms/${a.data().roomId}`));return {roomId:r.exists&&r.data().protocolVersion===VERSION&&r.data().memberUids.includes(uid)&&r.data().expiresAt.toMillis()>now?r.id:''};
    }
    if(op==='createRoom'){
      keys(d,['mode','target','difficulty','isPublic','password']);if(d.mode!=='FFA'||![31,61,101].includes(d.target)||![0,1,2].includes(d.difficulty)||typeof d.isPublic!=='boolean')fail('invalid-argument','إعدادات غرفة غير صالحة');const password=str(d.password??'',0,64);
      const me=await profile(tx,uid),active=await tx.get(ref(`activeRooms/${uid}`));if(!completeProfile(me))fail('failed-precondition','أكمل ملف اللاعب أولًا');if(active.exists){const old=await tx.get(ref(`rooms/${active.data().roomId}`));if(old.exists&&old.data().protocolVersion===VERSION&&old.data().memberUids.includes(uid)&&old.data().expiresAt.toMillis()>now)fail('failed-precondition','غادر غرفتك الحالية أولًا');}
      const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789',bytes=randomBytes(6),code=Array.from(bytes,x=>alphabet[x%alphabet.length]).join(''),roomId=`v${VERSION}_${code}`;
      const collision=await tx.getAll(ref(`rooms/${roomId}`),ref(`roomResults/${roomId}`));
      if(collision.some(doc=>doc.exists))fail('aborted','أعد إنشاء الغرفة');
      const r={_id:roomId,protocolVersion:VERSION,code,hostId:uid,hostName:me.name,status:'waiting',isPublic:d.isPublic,locked:!!password,mode:d.mode,target:d.target,difficulty:d.difficulty,players:[player(me,0)],botSeats:[],memberUids:[uid],revision:0,createdAt:stamp(now),updatedAt:stamp(now),expiresAt:stamp(now+6*HOUR)};
      const salt=randomBytes(16).toString('hex'),secret={salt,passwordHash:password?passwordHash(password,salt):'',presence:{[uid]:now}};
      await saveRoom(tx,r,secret,null,now);tx.set(ref(`activeRooms/${uid}`),{roomId});return reply(r,null,uid,now);
    }
    if(op==='invite'){
      keys(d,['roomId','toUid']);if(!id(d.toUid)||d.toUid===uid)fail('invalid-argument','مستلم غير صالح');const [r]=await roomData(tx,d.roomId),me=await profile(tx,uid);await profile(tx,d.toUid);
      if(!r.memberUids.includes(uid)||r.status!=='waiting'||!await hasFriend(tx,db,uid,me,d.toUid))fail('permission-denied','الدعوة متاحة لأصدقاء أعضاء غرفة الانتظار');
      const inviteId=hash(`${d.roomId}:${uid}:${d.toUid}`);
      const existing=await tx.get(ref(`roomInvites/${inviteId}`));
      if(existing.data()?.status==='pending'&&existing.data().expiresAt?.toMillis()>now)return {status:'pending'};
      tx.set(existing.ref,{fromUid:uid,toUid:d.toUid,fromName:me.name,fromAvatar:me.avatar,roomId:d.roomId,roomCode:r.code,status:'pending',createdAt:stamp(now),expiresAt:stamp(now+10*60000)});
      notify(d.toUid,{kind:'invites',name:me.name});return {status:'pending'};
    }
    if(op==='joinRoom'||op==='answerInvite'){
      keys(d,op==='joinRoom'?['code','password']:['inviteId','accept']);let invitation=null;
      let roomId;
      if(op==='answerInvite'){
        if(!id(d.inviteId)||typeof d.accept!=='boolean')fail('invalid-argument','دعوة غير صالحة');const i=await tx.get(ref(`roomInvites/${d.inviteId}`));invitation=i.data();if(!invitation||invitation.toUid!==uid||invitation.status!=='pending'||invitation.expiresAt.toMillis()<=now)fail('failed-precondition','الدعوة غير متاحة أو انتهت');
        if(!d.accept){tx.delete(i.ref);return {status:'rejected'};}roomId=invitation.roomId;
      }else {const code=str(d.code,6,6).toUpperCase();if(!/^[A-Z2-9]{6}$/.test(code))fail('invalid-argument','رمز غير صالح');roomId=`v${VERSION}_${code}`;}
      const [r,secret,state]=await roomData(tx,roomId),me=await profile(tx,uid),active=await tx.get(ref(`activeRooms/${uid}`));
      if(r.status==='finished'||state?.winner>=0)fail('failed-precondition','انتهت المباراة');
      if(active.exists&&active.data().roomId!==roomId){const old=await tx.get(ref(`rooms/${active.data().roomId}`));if(old.exists&&old.data().protocolVersion===VERSION&&old.data().memberUids.includes(uid)&&old.data().expiresAt.toMillis()>now)fail('failed-precondition','غادر غرفتك الحالية أولًا');}
      if(invitation&&!r.memberUids.includes(invitation.fromUid))fail('failed-precondition','غادر صاحب الدعوة الغرفة');
      if(!r.memberUids.includes(uid)){
        if(!completeProfile(me))fail('failed-precondition','أكمل ملف اللاعب أولًا');
        if(r.status!=='waiting'||r.players.length>=4)fail('failed-precondition','الغرفة ممتلئة أو بدأت المباراة');
        if(!invitation&&secret.passwordHash){const password=str(d.password??'',0,64),attempt=passwordHash(password,secret.salt);if(!timingSafeEqual(Buffer.from(attempt,'hex'),Buffer.from(secret.passwordHash,'hex')))fail('permission-denied','رمز الغرفة أو كلمة المرور غير صحيحة');}
        const seat=[0,1,2,3].find(i=>!r.players.some(p=>p.index===i));r.players.push(player(me,seat));r.botSeats=(r.botSeats||[]).filter(i=>i!==seat);r.memberUids.push(uid);
      }
      secret.presence[uid]=now;await saveRoom(tx,r,secret,state,now);tx.set(ref(`activeRooms/${uid}`),{roomId});if(invitation)tx.delete(ref(`roomInvites/${d.inviteId}`));return reply(r,state,uid,now);
    }
    if(op==='chat'){
      keys(d,['roomId','text']);const text=str(d.text,1,160);
      if(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(text))fail('invalid-argument','اكتب رسالة قصيرة في سطر واحد');
      const [r,secret,state]=await roomData(tx,d.roomId);
      const sender=r.players.find(p=>p.uid===uid);
      if(!sender||!r.memberUids.includes(uid))fail('permission-denied','الدردشة لأعضاء الغرفة فقط');
      if(r.status==='finished')fail('failed-precondition','انتهت الغرفة');
      const cooldown=r.chatCooldown||{};
      if(now-(cooldown[uid]??0)<3000)fail('resource-exhausted','انتظر ثلاث ثوانٍ بين الرسائل');
      r.chatCooldown=Object.fromEntries(r.memberUids.map(member=>[member,member===uid?now:(cooldown[member]||0)]));
      r.chat=[...(r.chat||[]),{id:randomBytes(12).toString('hex'),uid,name:sender.name,text,at:now}].slice(-12);
      r.revision++;r.updatedAt=stamp(now);
      // Chat shares the existing poll response and never rewrites cards or turn deadlines.
      tx.update(ref(`rooms/${r._id}`),{chat:r.chat,chatCooldown:r.chatCooldown,revision:r.revision,updatedAt:r.updatedAt});
      return reply(r,state,uid,now);
    }
    if(['poll','fillBots','start','move','nextRound','readyRound','leave'].includes(op)){
      if(op!=='poll')keys(d,op==='move'?['roomId','action','value','expectedRevision']:op==='readyRound'?['roomId','round']:['roomId']);
      const entry=await roomData(tx,d.roomId,op==='poll'||op==='leave',pollDocs);
      if(!entry){
        if(op==='leave')return {status:'left'};
        const result=(pollDocs?.[2]??await tx.get(ref(`roomResults/${d.roomId}`))).data();
        const player=result?.room?.players?.find(player=>player.uid===uid);
        if(!player||!result.expiresAt||result.expiresAt.toMillis()<=now)fail('not-found','الغرفة غير موجودة');
        return {room:result.room,view:{...result.view,seat:player.index},serverTime:now};
      }
      const [r,secret,state0]=entry;if(!r.memberUids.includes(uid))fail('permission-denied','لم تعد عضوًا في الغرفة');let state=state0;
      if(op==='leave'){
        removeMember(r,secret,uid);
        if(r.players.length===0)await removeRoom(tx,db,d.roomId,[uid]);
        else {
          const active=await tx.get(ref(`activeRooms/${uid}`));
          await saveRoom(tx,r,secret,state,now);
          if(active.data()?.roomId===d.roomId)tx.delete(active.ref);
        }
        return {status:'left'};
      }
      if(op==='poll'&&r.status==='finished')return reply(r,state,uid,now);
      let changed=state?.winner>=0;
      if(now-(secret.presence[uid]||0)>15000){secret.presence[uid]=now;if(op==='poll'&&d.latencyMs>0){const self=r.players.find(p=>p.uid===uid);self.latencyMs=d.latencyMs;self.latencyAt=now;}changed=true;}
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
        shuffleSeats(r);
        const names=Array.from({length:4},(_,i)=>r.players.find(p=>p.index===i)?.name||['سالم','عمر','خالد','علي'][i]);state=engine.start(names,r.target,r.difficulty);state.swap_preview={};gate(state,'reveal',4500,now);r.status='playing';changed=true;
      }else if(op==='move'){
        if(!state||r.status!=='playing'||state.presentation||!Number.isInteger(d.expectedRevision)||d.expectedRevision!==state.revision||now>=state.turnDueAt)fail('failed-precondition','تغيّر الدور؛ انتظر تحديث الطاولة');
        const p=r.players.find(p=>p.uid===uid).index,before=[...state.exposed];if(!engine.act(state,p,d.action,d.value))fail('invalid-argument','هذه الحركة غير مسموحة في دورك');
        if(d.action==='swap'){state.swap_preview={king:p,target:d.value,before};gate(state,'swap_result',3200,now);}else nextDeadline(state,r,now);changed=true;
      }else if(op==='readyRound'||op==='nextRound'){
        if(!state||r.status!=='playing'||state.winner>=0)fail('failed-precondition','انتهت المباراة');
        if(state.phase!=='round_end'||(op==='readyRound'&&d.round!==state.round))return reply(r,state,uid,now);
        state.readyUids??=[];
        if(!state.readyUids.includes(uid)){state.readyUids.push(uid);state.revision++;changed=true;}
        changed=advance(state,r,now)||changed;
      }else changed=advance(state,r,now)||changed;
      if(changed&&pollDocs)return null;
      if(changed)await saveRoom(tx,r,secret,state,now);return reply(r,state,uid,now);
    }
    fail('invalid-argument','عملية غير معروفة');
  }
  const readOps=new Set(['poll','search','friends','requests','invites','listRooms','activeRoom','presence','ownProfile','publicProfile','store']);
  async function execute(uid,input){
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
    if(op==='poll'){
      keys(d,['roomId','latencyMs']);
      if(!id(d.roomId))fail('invalid-argument','رمز غرفة غير صالح');
      if(d.latencyMs!==undefined&&(!Number.isInteger(d.latencyMs)||d.latencyMs<0||d.latencyMs>60000))fail('invalid-argument','قياس اتصال غير صالح');
      const docs=await pollSnapshot(d.roomId,now);
      const result=await operate(null,uid,op,d,clock(),docs);
      if(result!==null)return result;
    }
    let events=[];
    const result=await db.runTransaction(async tx=>{
      events=[];
      const receipt=mutation?ref(`operations/${hash(`${uid}:${input.requestId}`)}`):null;
      const fingerprint=hash(JSON.stringify({op,d}));
      if(receipt){
        const [previous,deletion]=await tx.getAll(receipt,ref(`accountDeletions/${uid}`));
        if(deletion.exists)fail('permission-denied','الحساب قيد الحذف');
        if(previous.exists){if(previous.data().fingerprint!==fingerprint)fail('invalid-argument','معرّف عملية مستخدم');return JSON.parse(previous.data().result);}
      }
      const result=await operate(tx,uid,op,d,clock(),undefined,(recipient,event)=>events.push([recipient,event]));
      if(receipt)tx.create(receipt,{uid,fingerprint,result:JSON.stringify(result),expiresAt:stamp(now+24*HOUR)});
      return result;
    });
    if(mutation||op==='poll')pollCache.delete(result?.room?._id??d.roomId);
    if(op==='equipItem')pollCache.clear();
    for(const [recipient,event] of events)notifications?.publish(recipient,event);
    return result;
  }
  execute.invalidateRoom=roomId=>pollCache.delete(roomId);
  return execute;
}
async function removeExpired(db,ref,cutoff){
  return db.runTransaction(async tx=>{
    const current=await tx.get(ref),expiry=current.data()?.expiresAt;
    if(!expiry||expiry.toMillis()>cutoff.toMillis())return false;
    if(ref.parent.id==='rooms')await removeRoom(tx,db,ref.id,current.data().memberUids||[]);
    else tx.delete(ref);
    return true;
  });
}
module.exports={createService,VERSION,advance,reply,removeExpired};
