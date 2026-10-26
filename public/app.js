'use strict';
const $=id=>document.getElementById(id);let tab='rooms',cursor='',busy=false,sequence=0;
function notice(text,error=false){$('notice').textContent=text;$('notice').classList.toggle('error',error);}
async function api(path,body){const res=await fetch('/admin/'+path,{method:body?'POST':'GET',credentials:'same-origin',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const data=await res.json();if(!res.ok){if(res.status===401)showLogin();throw Error(data.error?.message||'تعذر الاتصال بالخادم');}return data.result;}
function showLogin(){sequence++;$('login').hidden=false;$('dashboard').hidden=true;$('logout').hidden=true;$('rows').replaceChildren();}
function showDashboard(){$('login').hidden=true;$('dashboard').hidden=false;$('logout').hidden=false;}
function loginBusy(value){$('login-button').disabled=value;$('google-login').disabled=value||!googleAuth;}
let googleAuth;
async function prepareGoogle(){
  try{
    const response=await fetch('/admin/config');if(!response.ok)throw Error();
    const config=await response.json();if(!config.authDomain||!config.projectId)throw Error();
    const app=firebase.initializeApp(config,'admin-login');
    googleAuth=app.auth();googleAuth.languageCode='ar';
    await googleAuth.setPersistence(firebase.auth.Auth.Persistence.NONE);
    $('google-login').disabled=false;$('google-status').textContent='اختر حساب Google المعتمد للإدارة؛ لا تحتاج كلمة مرور هنا.';
  }catch{googleAuth=null;$('google-status').textContent='تعذر تجهيز Google؛ أعد تحميل الصفحة وتحقق من الاتصال.';}
}
$('google-login').onclick=async()=>{
  if(!googleAuth)return;
  loginBusy(true);notice('اختر حسابك في نافذة Google…');
  try{
    const provider=new firebase.auth.GoogleAuthProvider();provider.setCustomParameters({prompt:'select_account'});
    const result=await googleAuth.signInWithPopup(provider);
    await api('session',{idToken:await result.user.getIdToken()});showDashboard();await load();
  }catch(e){
    const messages={'auth/popup-closed-by-user':'أُغلقت نافذة Google؛ يمكنك المحاولة مجددًا.','auth/popup-blocked':'اسمح بالنوافذ المنبثقة لهذا الموقع ثم حاول مجددًا.','auth/unauthorized-domain':'أضف نطاق هذه الخدمة إلى Authorized domains في Firebase Authentication.','auth/operation-not-allowed':'فعّل مزود Google في Firebase Authentication.','auth/account-exists-with-different-credential':'هذا البريد مرتبط بطريقة دخول أخرى؛ استخدمها أولًا لربط Google.'};
    notice(messages[e.code]||e.message||'تعذر الدخول عبر Google',true);
  }finally{try{await googleAuth.signOut();}catch{}loginBusy(false);}
};
function cell(row,text){const td=document.createElement('td');td.textContent=String(text??'—');row.append(td);return td;}
function confirmAction(text){$('confirm-text').textContent=text;$('confirm').returnValue='';$('confirm').showModal();return new Promise(resolve=>$('confirm').addEventListener('close',()=>resolve($('confirm').returnValue==='confirm'),{once:true}));}
function actionButton(td,title,message,action,payload){const btn=document.createElement('button');btn.textContent=title;btn.className='danger';td.append(btn);btn.onclick=async()=>{if(busy||!await confirmAction(message))return;busy=true;btn.disabled=true;try{await api('api/'+action,payload);notice('تم تنفيذ الإجراء وحفظه في السجل');await load();}catch(e){notice(e.message,true);}finally{busy=false;btn.disabled=false;}};}
async function load(next=false){
  const current=++sequence,kind=tab;notice('جارٍ التحديث…');
  try{
    const [data,status]=await Promise.all([api('api/'+kind+(kind==='users'?'?cursor='+encodeURIComponent(next?cursor:''):'')),api('api/status')]);
    if(current!==sequence)return;
    $('metrics').replaceChildren();for(const [label,value] of [['مدة التشغيل',Math.floor(status.uptimeSeconds/60)+' دقيقة'],['ذاكرة الخادم',status.memoryMB+' MB'],['طلبات هذه الجلسة',status.requests]]){const box=document.createElement('div');box.className='metric';const strong=document.createElement('strong');strong.textContent=value;box.append(label,strong);$('metrics').append(box);}
    const titles={rooms:'آخر 30 غرفة',users:'المستخدمون · 25 حسابًا في الصفحة',audit:'آخر 30 إجراء إداري'};
    const columns={rooms:['الرمز','المضيف','الحالة','اللاعبون','الإجراء'],users:['البريد','UID','آخر دخول','الحالة','الإجراء'],audit:['المسؤول','الإجراء','الهدف','الوقت','النتيجة']};
    $('title').textContent=titles[kind];$('hint').textContent=kind==='rooms'?'إغلاق الغرفة ينهيها للجميع. لا تُعرض الأوراق الخاصة.':kind==='users'?'حظر الحساب يمنع طلباته التالية إلى الخادم. لا يمكن حظر المسؤولين هنا.':'الإجراءات المعلّقة تحتاج مراجعة قبل إعادة التنفيذ.';
    const heading=document.createElement('tr');for(const text of columns[kind]){const th=document.createElement('th');th.textContent=text;heading.append(th);}$('head').replaceChildren(heading);$('rows').replaceChildren();
    for(const item of data.items){const row=document.createElement('tr');
      if(kind==='rooms'){cell(row,item.code);cell(row,item.hostName);cell(row,{waiting:'انتظار',playing:'يلعب',finished:'انتهت'}[item.status]||item.status);cell(row,item.players.map(p=>p.name).join('، '));const td=cell(row,'');if(item.status!=='finished')actionButton(td,'إغلاق','إنهاء الغرفة '+item.code+' وإخراج جميع لاعبيها؟','closeRoom',{roomId:item.id});}
      if(kind==='users'){cell(row,item.email);cell(row,item.uid);cell(row,item.lastSignIn?new Date(item.lastSignIn).toLocaleString('ar'):'—');cell(row,item.disabled?'محظور':'نشط');actionButton(cell(row,''),item.disabled?'رفع الحظر':'حظر',(item.disabled?'رفع الحظر عن ':'حظر ')+item.email+'؟','userStatus',{uid:item.uid,disabled:!item.disabled});}
      if(kind==='audit'){cell(row,item.actor);cell(row,item.action);cell(row,item.target);cell(row,new Date(item.createdAt).toLocaleString('ar'));cell(row,item.state);}
      $('rows').append(row);
    }
    if(!data.items.length){const row=document.createElement('tr'),td=cell(row,'لا توجد بيانات لعرضها');td.colSpan=5;$('rows').append(row);}
    cursor=data.cursor||'';$('more').hidden=kind!=='users'||!cursor;notice('آخر تحديث: '+new Date().toLocaleTimeString('ar'));
  }catch(e){if(current===sequence)notice(e.message,true);}
}
$('login-form').onsubmit=async event=>{event.preventDefault();loginBusy(true);notice('جارٍ تسجيل الدخول…');try{
  const config=await fetch('/admin/config').then(r=>r.json());
  const res=await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key='+encodeURIComponent(config.apiKey),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:$('email').value.trim(),password:$('password').value,returnSecureToken:true})});
  const data=await res.json();if(!res.ok)throw Error('تعذر الدخول؛ تحقق من الحساب وكلمة المرور وتفعيل Email/Password');
  await api('session',{idToken:data.idToken});showDashboard();await load();
}catch(e){notice(e.message,true);}finally{$('password').value='';loginBusy(false);}};
$('logout').onclick=async()=>{try{await api('logout',{});showLogin();notice('تم تسجيل الخروج');}catch(e){notice(e.message,true);}};
document.querySelectorAll('[data-tab]').forEach(button=>button.onclick=()=>{tab=button.dataset.tab;document.querySelectorAll('[data-tab]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));load();});
$('refresh').onclick=()=>load();$('more').onclick=()=>load(true);
api('api/status').then(()=>{showDashboard();load();}).catch(()=>showLogin());
prepareGoogle();
