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
  const server=createHttpServer({auth,execute:async(uid,data)=>{executed++;if(data.fail)throw Error('private credential');return {uid};},admin:async()=>({items:[]}),adminUids:new Set(['owner']),origin:'https://fixture.invalid',webApiKey:'public-fixture'});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=(path,data,headers={})=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(data)});
  assert.equal((await fetch(base+'/health')).status,200);assert.equal(verified,0);assert.equal(executed,0);
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
