'use strict';
const {Timestamp}=require('firebase-admin/firestore');
const {createHash}=require('node:crypto');
const {AppError}=require('./errors');
const {VERSION}=require('./service');
const {removeRoom}=require('./room-lifecycle');
const {queueDeletion}=require('./account-deletion');
const validId=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(x);
function createAdmin(db,auth,adminUids,maintenance){
  return async function admin(actor,action,data={}){
    if(!adminUids.has(actor))throw new AppError('permission-denied','غير مصرح لك بالإدارة');
    if(action==='users'){
      if(typeof data.cursor!=='string'||data.cursor.length>2000)throw new AppError('invalid-argument','صفحة غير صالحة');
      const page=await auth.listUsers(25,data.cursor||undefined);
      const refs=page.users.flatMap(u=>['users','wallets','accountDeletions'].map(name=>db.doc(`${name}/${u.uid}`)));
      const docs=refs.length?await db.getAll(...refs):[];
      return {items:page.users.map((u,index)=>{
        const [profile,wallet,deletion]=docs.slice(index*3,index*3+3);
        return {uid:u.uid,email:u.email||'',name:profile.data()?.name||u.displayName||'',disabled:u.disabled,
          gold:wallet.data()?.gold||0,hasProfile:profile.exists,deleting:deletion.exists,protected:adminUids.has(u.uid),
          createdAt:u.metadata.creationTime,lastSignIn:u.metadata.lastSignInTime||''};
      }),cursor:page.pageToken||''};
    }
    if(action==='rooms'){
      const docs=await db.collection('rooms').where('protocolVersion','in',[2,VERSION]).orderBy('updatedAt','desc').limit(30).get();
      return {items:docs.docs.map(doc=>{const r=doc.data();return {id:doc.id,code:r.code,status:r.status,hostName:r.hostName,mode:r.mode,locked:r.locked,players:r.players.map(p=>({name:p.name,index:p.index,status:p.status})),updatedAt:r.updatedAt.toMillis()};})};
    }
    if(action==='audit'){
      const docs=await db.collection('adminAudit').orderBy('createdAt','desc').limit(30).get();
      return {items:docs.docs.map(doc=>{const {finishedAt,...entry}=doc.data();return {...entry,createdAt:entry.createdAt.toMillis(),finishedAt:finishedAt?.toMillis()||null};})};
    }
    if(action==='cleanup'){
      if(Object.keys(data).length)throw new AppError('invalid-argument','طلب غير صالح');
      if(!maintenance)throw new AppError('unavailable','خدمة التنظيف غير متاحة');
      if(!maintenance.snapshot().running)maintenance.request();
      return maintenance.snapshot();
    }
    if(action==='deleteUser'){
      if(!validId(data.uid)||data.confirm!==data.uid||Object.keys(data).some(k=>!['uid','confirm'].includes(k)))throw new AppError('invalid-argument','اكتب معرّف الحساب لتأكيد الحذف');
      if(adminUids.has(data.uid))throw new AppError('permission-denied','لا يمكن حذف حساب إداري هنا');
      const job=await queueDeletion(db,data.uid,actor);
      if(job.state==='pending')maintenance?.request();
      return job;
    }
    if(action==='creditGold'){
      const {uid,amount,requestId}=data;
      if(!validId(uid)||!Number.isSafeInteger(amount)||amount<1||amount>1000000||!validId(requestId)||requestId.length<16||
          Object.keys(data).some(k=>!['uid','amount','requestId'].includes(k)))throw new AppError('invalid-argument','أدخل كمية صحيحة من 1 إلى مليون ذهب');
      const key=createHash('sha256').update(`${actor}:${requestId}`).digest('hex');
      const audit=db.doc(`adminAudit/${key}`),wallet=db.doc(`wallets/${uid}`);
      return db.runTransaction(async tx=>{
        const [prior,balance,profile,deletion]=await tx.getAll(audit,wallet,db.doc(`users/${uid}`),db.doc(`accountDeletions/${uid}`));
        if(prior.exists){
          const entry=prior.data();
          if(entry.action!==action||entry.target!==uid||entry.amount!==amount)throw new AppError('invalid-argument','معرّف إجراء مستخدم');
          return {gold:entry.after};
        }
        if(deletion.exists)throw new AppError('failed-precondition','الحساب قيد الحذف');
        if(!profile.exists)throw new AppError('not-found','ملف اللاعب غير موجود');
        const before=balance.data()?.gold??0,after=before+amount;
        if(!Number.isSafeInteger(before)||before<0||!Number.isSafeInteger(after))throw new AppError('failed-precondition','رصيد الحساب يحتاج مراجعة');
        const now=Timestamp.now();
        tx.set(wallet,{gold:after,updatedAt:now},{merge:true});
        tx.create(audit,{actor,action,target:uid,amount,before,after,state:'completed',createdAt:now});
        return {gold:after};
      });
    }
    if(action==='userStatus'){
      if(!validId(data.uid)||typeof data.disabled!=='boolean'||Object.keys(data).some(k=>!['uid','disabled'].includes(k)))throw new AppError('invalid-argument','طلب غير صالح');
      if(adminUids.has(data.uid))throw new AppError('permission-denied','لا يمكن تغيير حالة حساب إداري هنا');
      if((await db.doc(`accountDeletions/${data.uid}`).get()).exists)throw new AppError('failed-precondition','الحساب قيد الحذف');
      // Write the intent before changing Auth; a failed final log remains visibly pending.
      const record=await db.collection('adminAudit').add({actor,action,target:data.uid,disabled:data.disabled,state:'pending',createdAt:Timestamp.now()});
      await auth.updateUser(data.uid,{disabled:data.disabled});
      if(data.disabled)await auth.revokeRefreshTokens(data.uid);
      await record.update({state:'completed'});
      return {updated:true};
    }
    if(action==='closeRoom'){
      if(!validId(data.roomId)||Object.keys(data).some(k=>k!=='roomId'))throw new AppError('invalid-argument','غرفة غير صالحة');
      const roomRef=db.doc(`rooms/${data.roomId}`),auditRef=db.collection('adminAudit').doc();
      return db.runTransaction(async tx=>{
        const doc=await tx.get(roomRef);if(!doc.exists||![2,VERSION].includes(doc.data().protocolVersion))throw new AppError('not-found','الغرفة غير موجودة');
        await removeRoom(tx,db,data.roomId,doc.data().memberUids);
        tx.create(auditRef,{actor,action,target:data.roomId,state:'completed',createdAt:Timestamp.now()});
        return {closed:true};
      });
    }
    throw new AppError('not-found','عملية غير موجودة');
  };
}
module.exports={createAdmin};
