'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createHttpServer}=require('../http');
const {createAdmin}=require('../admin');
test('HTTP boundary verifies identity, revocation, admin cookies, origin and private errors',async t=>{
  let verified=0,executed=0;
  const auth={
    async verifyIdToken(token,revoked){verified++;assert.equal(revoked,true);if(token==='revoked')throw Error('private credential');return {uid:token,auth_time:Date.now()/1000};},
    async createSessionCookie(){return 'fixture-session';},
    async verifySessionCookie(cookie,revoked){assert.equal(revoked,true);assert.equal(cookie,'fixture-session');return {uid:'owner'};}
  };
  const server=createHttpServer({auth,execute:async(uid,data)=>{executed++;if(data.fail)throw Error('private credential');return {uid};},admin:async()=>({items:[]}),adminUids:new Set(['owner']),origin:'https://fixture.invalid',webOrigins:['https://game.fixture.invalid'],webApiKey:'public-fixture',projectId:'demo-tarneeb'});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=(path,data,headers={})=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(data)});
  assert.equal((await fetch(base+'/health')).status,200);assert.equal(verified,0);assert.equal(executed,0);
  const preflight=await fetch(base+'/online',{method:'OPTIONS',headers:{Origin:'https://game.fixture.invalid','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,content-type'}});
  assert.equal(preflight.status,204);assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),'https://game.fixture.invalid');assert.equal(verified,0);
  assert.equal((await post('/online',{data:{}},{Origin:'https://evil.invalid',Authorization:'Bearer player'})).status,403);
  const cors=await post('/online',{data:{}},{Origin:'https://game.fixture.invalid',Authorization:'Bearer player'});
  assert.equal(cors.status,200);assert.equal(cors.headers.get('Access-Control-Allow-Origin'),'https://game.fixture.invalid');assert.equal(cors.headers.get('Access-Control-Allow-Credentials'),null);
  const missingToken=await post('/online',{data:{}},{Origin:'https://game.fixture.invalid'});assert.equal(missingToken.status,401);assert.equal(missingToken.headers.get('Access-Control-Allow-Origin'),'https://game.fixture.invalid');

  assert.deepEqual(await fetch(base+'/admin/config').then(r=>r.json()),{apiKey:'public-fixture',projectId:'demo-tarneeb',authDomain:'demo-tarneeb.firebaseapp.com'});
  const page=await fetch(base+'/admin');assert((await page.text()).includes('id="google-login"'));
  assert(page.headers.get('content-security-policy').includes('frame-src https://demo-tarneeb.firebaseapp.com'));
  assert.equal((await post('/online',{data:{}})).status,401);
  assert.equal((await post('/online',{data:{}},{Authorization:'Bearer revoked'})).status,401);
  const identity=await post('/online',{data:{uid:'victim'}},{Authorization:'Bearer player'});
  assert.deepEqual(await identity.json(),{result:{uid:'player'}});
  assert.equal((await post('/online',{data:{},uid:'victim'},{Authorization:'Bearer player'})).status,400);
  assert.equal((await post('/online',{data:{text:'x'.repeat(9000)}},{Authorization:'Bearer player'})).status,400);
  assert.equal((await post('/admin/session',{idToken:'owner'})).status,403);
  assert.equal((await post('/admin/session',{idToken:'player'},{Origin:'https://fixture.invalid'})).status,403);
  const login=await post('/admin/session',{idToken:'owner'},{Origin:'https://fixture.invalid'});
  assert.equal(login.status,200);const cookie=login.headers.get('set-cookie');
  for(const flag of ['HttpOnly','SameSite=Strict','Secure','Path=/admin'])assert(cookie.includes(flag));
  assert.equal((await fetch(base+'/admin/api/users')).status,401);
  assert.equal((await fetch(base+'/admin/api/users',{headers:{Cookie:'tarneeb_admin=fixture-session'}})).status,200);
  assert.equal((await post('/admin/api/closeRoom',{roomId:'room'},{Cookie:'tarneeb_admin=fixture-session',Origin:'https://evil.invalid'})).status,403);
  const error=await post('/online',{data:{fail:true}},{Authorization:'Bearer player'});
  assert.equal(error.status,503);assert(!(await error.text()).includes('private credential'));
});
test('administrator service rejects outsiders and protects administrator accounts',async()=>{
  const admin=createAdmin({}, {}, new Set(['owner']));
  await assert.rejects(admin('player','users',{}),e=>e.code==='permission-denied');
  await assert.rejects(admin('owner','userStatus',{uid:'owner',disabled:true}),e=>e.code==='permission-denied');
  await assert.rejects(admin('owner','userStatus',{uid:'player',disabled:true,role:'admin'}),e=>e.code==='invalid-argument');
});
