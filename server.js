'use strict';
const {initializeApp,applicationDefault}=require('firebase-admin/app');
const {getAuth}=require('firebase-admin/auth');
const {getFirestore,Timestamp}=require('firebase-admin/firestore');
const {createService,removeExpired}=require('./service');
const {createAdmin}=require('./admin');
const {createHttpServer}=require('./http');
const {parseOrigin}=require('./config');
const projectId=process.env.FIREBASE_PROJECT_ID,databaseId=process.env.FIRESTORE_DATABASE_ID;
const production=process.env.NODE_ENV==='production';
const missing=['FIREBASE_PROJECT_ID','FIRESTORE_DATABASE_ID','PUBLIC_ORIGIN','FIREBASE_WEB_API_KEY'].filter(key=>!process.env[key]?.trim());
if(missing.length)throw Error('Missing environment variables: '+missing.join(', '));
const origin=parseOrigin(process.env.PUBLIC_ORIGIN,production);
if(production&&(process.env.FIRESTORE_EMULATOR_HOST||process.env.FIREBASE_AUTH_EMULATOR_HOST))throw Error('Emulators are forbidden in production');
const adminUids=new Set((process.env.ADMIN_UIDS||'').split(',').map(s=>s.trim()).filter(Boolean));
if(!adminUids.size)throw Error('ADMIN_UIDS must contain at least one Firebase Authentication UID');
initializeApp({credential:applicationDefault(),projectId});
const db=getFirestore(databaseId),auth=getAuth(),execute=createService(db);
const server=createHttpServer({auth,execute,admin:createAdmin(db,auth,adminUids),adminUids,origin,projectId,webApiKey:process.env.FIREBASE_WEB_API_KEY,production});
let cleaning=false;
const cleanup=setInterval(async()=>{
  if(cleaning)return;cleaning=true;
  try{
    const now=Timestamp.now();
    for(const name of ['rooms','roomSecrets','operations','friendRequests','roomInvites','rateLimits']){
      const docs=await db.collection(name).where('expiresAt','<=',now).limit(100).get();
      for(const doc of docs.docs)await removeExpired(db,doc.ref,now);
    }
  }catch(err){console.error(JSON.stringify({event:'cleanup_failed',code:String(err.code||'internal')}));}finally{cleaning=false;}
},3600000);cleanup.unref();
server.listen(Number(process.env.PORT||10000),'0.0.0.0',()=>console.log('Tarneeb server listening; protocol 2'));
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{
  clearInterval(cleanup);server.close(async()=>{await db.terminate();process.exit(0);});
  setTimeout(()=>process.exit(1),15000).unref();
});
