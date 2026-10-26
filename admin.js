'use strict';
const {Timestamp}=require('firebase-admin/firestore');
const {AppError}=require('./errors');
const validId=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(x);
function createAdmin(db,auth,adminUids){
  return async function admin(actor,action,data={}){
    if(!adminUids.has(actor))throw new AppError('permission-denied','غير مصرح لك بالإدارة');
    if(action==='users'){
      if(typeof data.cursor!=='string'||data.cursor.length>2000)throw new AppError('invalid-argument','صفحة غير صالحة');
      const page=await auth.listUsers(25,data.cursor||undefined);
      return {items:page.users.map(u=>({uid:u.uid,email:u.email||'',name:u.displayName||'',disabled:u.disabled,createdAt:u.metadata.creationTime,lastSignIn:u.metadata.lastSignInTime||''})),cursor:page.pageToken||''};
    }
    if(action==='rooms'){
      const docs=await db.collection('rooms').where('protocolVersion','==',2).orderBy('updatedAt','desc').limit(30).get();
      return {items:docs.docs.map(doc=>{const r=doc.data();return {id:doc.id,code:r.code,status:r.status,hostName:r.hostName,players:r.players.map(p=>({name:p.name,index:p.index,status:p.status})),updatedAt:r.updatedAt.toMillis()};})};
    }
    if(action==='audit'){
      const docs=await db.collection('adminAudit').orderBy('createdAt','desc').limit(30).get();
      return {items:docs.docs.map(doc=>({...doc.data(),createdAt:doc.data().createdAt.toMillis()}))};
    }
    if(action==='userStatus'){
      if(!validId(data.uid)||typeof data.disabled!=='boolean'||Object.keys(data).some(k=>!['uid','disabled'].includes(k)))throw new AppError('invalid-argument','طلب غير صالح');
      if(adminUids.has(data.uid))throw new AppError('permission-denied','لا يمكن تغيير حالة حساب إداري هنا');
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
        const doc=await tx.get(roomRef);if(!doc.exists||doc.data().protocolVersion!==2)throw new AppError('not-found','الغرفة غير موجودة');
        const room=doc.data(),refs=room.memberUids.map(uid=>db.doc(`activeRooms/${uid}`));
        const active=refs.length?await tx.getAll(...refs):[];
        const now=Timestamp.now(),expiresAt=Timestamp.fromMillis(now.toMillis()+3600000);
        tx.update(roomRef,{status:'finished',players:[],memberUids:[],hostId:'',hostName:'',revision:room.revision+1,updatedAt:now,expiresAt});
        tx.set(db.doc(`roomSecrets/${data.roomId}`),{state:'',presence:{},expiresAt});
        for(const ref of active)if(ref.data()?.roomId===data.roomId)tx.delete(ref.ref);
        tx.create(auditRef,{actor,action,target:data.roomId,state:'completed',createdAt:now});
        return {closed:true};
      });
    }
    throw new AppError('not-found','عملية غير موجودة');
  };
}
module.exports={createAdmin};
