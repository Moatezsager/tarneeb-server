'use strict';
const http=require('node:http');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const {AppError}=require('./errors');
const statusCodes={'invalid-argument':400,'unauthenticated':401,'permission-denied':403,'not-found':404,'already-exists':409,'failed-precondition':409,'aborted':409,'resource-exhausted':429,'unavailable':503};
async function body(req){
  if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))throw new AppError('invalid-argument','JSON مطلوب');
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>8192)throw new AppError('invalid-argument','الطلب أكبر من المسموح');chunks.push(chunk);}
  try{const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value;}catch{throw new AppError('invalid-argument','JSON غير صالح');}
}
function createHttpServer({auth,execute,admin,adminUids,origin,webApiKey,projectId,production=true,webOrigins=[]}){
  const authDomain=projectId?`${projectId}.firebaseapp.com`:'';
  const start=Date.now(),metrics={requests:0,errors:0,inFlight:0};let window=0,attempts=0;
  const files=new Map([['/admin',['index.html','text/html']],['/admin/app.js',['app.js','text/javascript']],['/admin/style.css',['style.css','text/css']]].map(([url,[file,type]])=>[url,{content:readFileSync(path.join(__dirname,'public',file)),type}]));
  function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));}
  async function adminSession(req){
    const cookie=(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('tarneeb_admin='))?.slice(14);
    if(!cookie)throw new AppError('unauthenticated','سجل الدخول');
    let claims;try{claims=await auth.verifySessionCookie(cookie,true);}catch{throw new AppError('unauthenticated','انتهت جلسة الإدارة');}
    if(!adminUids.has(claims.uid))throw new AppError('permission-denied','غير مصرح لك بالإدارة');return claims;
  }
  const server=http.createServer({maxHeaderSize:16384},async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Content-Security-Policy',`default-src 'none'; script-src 'self' https://www.gstatic.com/firebasejs/12.4.0/ https://apis.google.com; style-src 'self'; img-src 'self'; connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com; frame-src ${authDomain?'https://'+authDomain:"'none'"}; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`);
    if(production)res.setHeader('Strict-Transport-Security','max-age=31536000');
    let route;try{route=new URL(req.url,'http://localhost');}catch{json(res,400,{error:{status:'INVALID_ARGUMENT',message:'طلب غير صالح'}});return;}
    // Cron/Render health checks never authenticate, read Firestore, or keep a room alive.
    if(req.method==='GET'&&route.pathname==='/health'){json(res,200,{status:'ok',protocolVersion:2});return;}
    if(route.pathname==='/online'&&req.headers.origin){
      if(!webOrigins.includes(req.headers.origin)){json(res,403,{error:{status:'PERMISSION_DENIED',message:'نطاق اللعبة غير مسموح'}});return;}
      res.setHeader('Access-Control-Allow-Origin',req.headers.origin);res.setHeader('Vary','Origin');
      if(req.method==='OPTIONS'){
        const requested=(req.headers['access-control-request-headers']||'').toLowerCase().split(',').map(x=>x.trim()).filter(Boolean);
        if(req.headers['access-control-request-method']!=='POST'||requested.some(x=>!['authorization','content-type'].includes(x))){json(res,403,{error:{status:'PERMISSION_DENIED'}});return;}
        res.setHeader('Access-Control-Allow-Methods','POST');res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');res.setHeader('Access-Control-Max-Age','3600');res.writeHead(204);res.end();return;
      }
    }
    metrics.requests++;
    if(metrics.inFlight>=32){json(res,503,{error:{status:'UNAVAILABLE',message:'الخادم مشغول؛ أعد المحاولة'}});return;}
    metrics.inFlight++;
    try{
      const minute=Math.floor(Date.now()/60000);if(window!==minute){window=minute;attempts=0;}
      if(++attempts>6000)throw new AppError('resource-exhausted','طلبات كثيرة');
      if(req.method==='GET'&&files.has(route.pathname)){const file=files.get(route.pathname);res.writeHead(200,{'Content-Type':file.type+'; charset=utf-8'});res.end(file.content);return;}
      if(req.method==='GET'&&route.pathname==='/admin/config'){json(res,200,{apiKey:webApiKey,projectId,authDomain});return;}
      if(req.method==='POST'&&route.pathname.startsWith('/admin/')){
        if(req.headers.origin!==origin)throw new AppError('permission-denied','مصدر الطلب غير مسموح');
      }
      if(req.method==='POST'&&route.pathname==='/admin/session'){
        const input=await body(req);if(typeof input.idToken!=='string'||input.idToken.length>7000)throw new AppError('invalid-argument','جلسة غير صالحة');
        let claims;try{claims=await auth.verifyIdToken(input.idToken,true);}catch{throw new AppError('unauthenticated','الدخول غير صالح');}
        if(!adminUids.has(claims.uid))throw new AppError('permission-denied','الحساب غير مسجل كمسؤول');
        if(!Number.isFinite(claims.auth_time)||Date.now()/1000-claims.auth_time>300)throw new AppError('unauthenticated','سجل الدخول مجددًا');
        const cookie=await auth.createSessionCookie(input.idToken,{expiresIn:8*3600000});
        res.setHeader('Set-Cookie',`tarneeb_admin=${cookie}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=28800${production?'; Secure':''}`);
        json(res,200,{result:{uid:claims.uid}});return;
      }
      if(req.method==='POST'&&route.pathname==='/admin/logout'){
        res.setHeader('Set-Cookie',`tarneeb_admin=; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=0${production?'; Secure':''}`);json(res,200,{result:{signedOut:true}});return;
      }
      if(route.pathname.startsWith('/admin/api/')){
        const claims=await adminSession(req),action=route.pathname.slice(11);
        if(req.method==='GET'&&action==='status'){json(res,200,{result:{uptimeSeconds:Math.floor((Date.now()-start)/1000),memoryMB:Math.round(process.memoryUsage().rss/1048576),...metrics}});return;}
        if(req.method==='GET'&&['users','rooms','audit'].includes(action)){json(res,200,{result:await admin(claims.uid,action,{cursor:route.searchParams.get('cursor')||''})});return;}
        if(req.method==='POST'&&['userStatus','closeRoom'].includes(action)){json(res,200,{result:await admin(claims.uid,action,await body(req))});return;}
        throw new AppError('not-found','مسار غير موجود');
      }
      if(req.method==='POST'&&route.pathname==='/online'){
        const token=/^Bearer ([^\s]{1,7000})$/.exec(req.headers.authorization||'')?.[1];if(!token)throw new AppError('unauthenticated','سجل الدخول');
        let claims;try{claims=await auth.verifyIdToken(token,true);}catch{throw new AppError('unauthenticated','الجلسة غير صالحة أو الحساب محظور');}
        const input=await body(req);if(Object.keys(input).length!==1||!input.data)throw new AppError('invalid-argument','طلب غير صالح');
        json(res,200,{result:await execute(claims.uid,input.data)});return;
      }
      throw new AppError('not-found','مسار غير موجود');
    }catch(err){
      metrics.errors++;const known=err instanceof AppError;
      // Never return SDK internals, credentials, hands or request bodies to the caller.
      const code=known?err.code:'unavailable';json(res,statusCodes[code]||503,{error:{status:code.replaceAll('-','_').toUpperCase(),message:known?err.message:'الخدمة غير متاحة مؤقتًا؛ حاول مجددًا'}});
      if(!known)console.error(JSON.stringify({event:'request_failed',code:String(err.code||'internal').slice(0,80)}));
    }finally{metrics.inFlight--;}
  });
  server.requestTimeout=20000;server.headersTimeout=10000;server.keepAliveTimeout=5000;
  return server;
}
module.exports={createHttpServer};
