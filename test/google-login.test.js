'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {readFileSync}=require('node:fs');
test('Google popup uses memory persistence, exchanges only Firebase token and clears SDK auth on success or denial',async()=>{
  for(const allowed of [true,false]){
    const elements=new Map(),events=[];
    const element=id=>{if(!elements.has(id))elements.set(id,{hidden:false,disabled:true,textContent:'',classList:{toggle(){}},replaceChildren(){},append(){}});return elements.get(id);};
    let session=false;
    const auth={setPersistence:async value=>events.push(['persistence',value]),signInWithPopup:async()=>{events.push(['popup']);return {user:{getIdToken:async()=>'firebase-id-token'}};},signOut:async()=>events.push(['signOut'])};
    const firebase={initializeApp:()=>({auth:()=>auth}),auth:{Auth:{Persistence:{NONE:'memory'}},GoogleAuthProvider:class{setCustomParameters(value){assert.equal(value.prompt,'select_account');}}}};
    const fetch=async(path,options)=>{
      let ok=true,result={};
      if(path==='/admin/config')return {ok:true,json:async()=>({projectId:'demo',authDomain:'demo.firebaseapp.com',apiKey:'public'})};
      if(path==='/admin/session'){events.push(['session',JSON.parse(options.body)]);ok=allowed;session=allowed;result={};}
      if(path==='/admin/api/status'){ok=session;result={uptimeSeconds:0,memoryMB:10,requests:1};}
      if(path==='/admin/api/rooms')result={items:[]};
      return {ok,status:ok?200:403,json:async()=>ok?{result}:{error:{message:'الحساب غير مسجل كمسؤول'}}};
    };
    vm.runInNewContext(readFileSync(require.resolve('../public/app.js'),'utf8'),{firebase,fetch,document:{getElementById:element,querySelectorAll:()=>[],createElement:()=>({append(){},textContent:''})},Date,console});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(element('google-login').disabled,false);
    await element('google-login').onclick();
    assert.deepEqual(events,[['persistence','memory'],['popup'],['session',{idToken:'firebase-id-token'}],['signOut']]);
    assert.equal(element('google-login').disabled,false);
    if(allowed)assert.equal(element('dashboard').hidden,false);
    else assert.equal(element('notice').textContent,'الحساب غير مسجل كمسؤول');
  }
});
