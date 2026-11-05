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
const number = new Intl.NumberFormat('ar-LY');
const date = value => value ? new Date(value).toLocaleString('ar-LY') : '—';
const creditDrafts = new Map();
let actorId = '';
function cell(row, title, value) {
  const td = document.createElement('td');
  td.dataset.label = title;
  td.textContent = String(value ?? '—');
  row.append(td);
  return td;
}
function confirmAction({title, message, field}) {
  const dialog = $('confirm'), input = $('confirm-input'), submit = $('confirm-submit');
  $('confirm-title').textContent = title;
  $('confirm-text').textContent = message;
  $('confirm-field').hidden = !field;
  $('confirm-label').textContent = field?.label || '';
  input.type = field?.type || 'text';
  input.value = '';
  input.required = !!field;
  input.min = '1';
  input.max = '1000000';
  input.step = '1';
  input.maxLength = 128;
  input.setCustomValidity('');
  input.oninput = () => input.setCustomValidity('');
  submit.textContent = title;
  submit.className = field?.type === 'number' ? 'primary' : 'danger';
  submit.onclick = event => {
    if (field?.expected && input.value.trim() !== field.expected) {
      event.preventDefault();
      input.setCustomValidity('المعرّف المكتوب غير مطابق.');
      input.reportValidity();
    }
  };
  dialog.returnValue = '';
  dialog.showModal();
  return new Promise(resolve => dialog.addEventListener('close', () =>
    resolve(dialog.returnValue === 'confirm' ? input.value.trim() : null), {once:true}));
}
function actionButton(parent, title, run, className = '') {
  const btn = document.createElement('button');
  btn.textContent = title;
  btn.className = className;
  parent.append(btn);
  btn.onclick = async () => {
    if (busy) return;
    busy = btn.disabled = true;
    try { await run(); }
    catch (error) { notice(error.message, true); }
    finally { busy = btn.disabled = false; }
  };
}
function creditRequest(uid, amount) {
  const key = ['tarneeb-credit',actorId,uid,amount].join(':');
  let id = creditDrafts.get(key);
  try { id ||= sessionStorage.getItem(key); } catch {}
  id ||= crypto.randomUUID();
  creditDrafts.set(key,id);
  try { sessionStorage.setItem(key,id); } catch {}
  return {id, clear() {
    creditDrafts.delete(key);
    try { sessionStorage.removeItem(key); } catch {}
  }};
}
function userActions(td, user) {
  if (user.deleting) {
    td.textContent = 'الحذف قيد المعالجة';
    return;
  }
  const name = user.name || user.email || user.uid;
  if (user.hasProfile) actionButton(td, 'إضافة ذهب', async () => {
    const amountText = await confirmAction({
      title:'إضافة ذهب', message:name+' · الرصيد الحالي '+number.format(user.gold),
      field:{type:'number',label:'كمية الذهب'},
    });
    if (amountText === null) return;
    const amount = Number(amountText), request = creditRequest(user.uid,amount);
    const result = await api('api/creditGold',{uid:user.uid,amount,requestId:request.id});
    request.clear();
    await load(false,true);
    notice('تمت إضافة '+number.format(amount)+' ذهب. الرصيد '+number.format(result.gold)+'.');
  }, 'gold');
  if (user.protected) {
    const note = document.createElement('small');
    note.textContent = 'حساب إداري محمي';
    td.append(note);
    return;
  }
  actionButton(td, user.disabled ? 'رفع الحظر' : 'حظر', async () => {
    const title = user.disabled ? 'رفع الحظر' : 'حظر الحساب';
    if (await confirmAction({title,message:title+' عن '+name+'؟'}) === null) return;
    await api('api/userStatus',{uid:user.uid,disabled:!user.disabled});
    await load(false,true);
    notice('تم حفظ حالة الحساب.');
  });
  actionButton(td, 'حذف نهائي', async () => {
    const confirmed = await confirmAction({
      title:'حذف نهائي',
      message:'سيُحذف حساب '+name+' وملفه ورصيده وعلاقاته. اكتب المعرّف '+user.uid+' للتأكيد.',
      field:{type:'text',label:'معرّف الحساب',expected:user.uid},
    });
    if (confirmed === null) return;
    await api('api/deleteUser',{uid:user.uid,confirm:confirmed});
    await load(false,true);
    notice('طُلب حذف الحساب. تابع اكتمال العملية في سجل الإدارة.');
    void watchCleanup();
  }, 'danger');
}
function renderCleanup(cleanup) {
  const button = $('cleanup-button');
  button.disabled = !cleanup || cleanup.running;
  const detail = $('cleanup-status');
  if (!cleanup) { detail.textContent = 'حالة التنظيف غير متاحة'; return; }
  if (cleanup.running) { detail.textContent = 'جارٍ تنظيف البيانات ومعالجة طلبات الحذف…'; return; }
  if (!cleanup.lastRun) { detail.textContent = 'بانتظار أول دورة تنظيف'; return; }
  detail.textContent = 'آخر دورة '+date(cleanup.lastRun)+' · '+number.format(cleanup.removed)+' سجلًا منتهيًا · '
    +number.format(cleanup.accounts)+' حسابًا حُذف'+(cleanup.errors ? ' · عمليات متعثرة '+number.format(cleanup.errors) : '');
}
let cleanupWatch = 0;
async function watchCleanup() {
  const monitor = ++cleanupWatch;
  for (let i = 0; i < 12 && monitor === cleanupWatch; i++) {
    try {
      const status = await api('api/status');
      if (monitor !== cleanupWatch || $('dashboard').hidden) return;
      renderCleanup(status.cleanup);
      if (!status.cleanup?.running) return;
      await new Promise(resolve => setTimeout(resolve, 2500));
    } catch { return; }
  }
}
function renderMetrics(status) {
  $('metrics').replaceChildren();
  for (const [label,value] of [
    ['مدة التشغيل',number.format(Math.floor(status.uptimeSeconds/60))+' دقيقة'],
    ['ذاكرة الخادم',status.memoryMB+' MB'],
    ['الطلبات الجارية',number.format(status.inFlight ?? 0)],
  ]) {
    const box = document.createElement('div');
    box.className = 'metric';
    const strong = document.createElement('strong');
    strong.textContent = value;
    box.append(label,strong);
    $('metrics').append(box);
  }
  renderCleanup(status.cleanup);
}
function filterRows() {
  const query = ($('filter').value || '').trim().toLocaleLowerCase('ar');
  let visible = 0;
  for (const row of $('rows').children || []) {
    row.hidden = !row.textContent.toLocaleLowerCase('ar').includes(query);
    if (!row.hidden && !row.classList.contains('empty-row')) visible++;
  }
  $('result-count').textContent = number.format(visible)+' نتيجة في الصفحة';
}
let pageCursor = '';
async function load(next = false, keepPage = false) {
  const current = ++sequence, kind = tab;
  const requestedPage = next ? cursor : (keepPage ? pageCursor : '');
  notice('جارٍ التحديث…');
  try {
    const [data,status] = await Promise.all([
      api('api/'+kind+(kind==='users'?'?cursor='+encodeURIComponent(requestedPage):'')),
      api('api/status'),
    ]);
    if (current !== sequence) return;
    actorId = status.uid || '';
    renderMetrics(status);
    const titles = {rooms:'الغرف',users:'المستخدمون والذهب',audit:'سجل الإدارة'};
    const columns = {
      rooms:['الغرفة','المضيف','الحالة','المقاعد','آخر نشاط','الإجراء'],
      users:['اللاعب','المعرّف','آخر دخول','الحالة','الذهب','الإجراء'],
      audit:['المسؤول','الإجراء','الهدف','الوقت','الحالة','التفاصيل'],
    };
    $('title').textContent = titles[kind];
    $('hint').textContent = {
      rooms:'آخر 30 غرفة · تُحذف الغرفة عند الفوز أو مغادرة آخر لاعب.',
      users:'25 حسابًا في الصفحة · يظهر الرصيد الحالي بجوار كل لاعب.',
      audit:'آخر 30 إجراء · تُعرض إضافات الذهب وطلبات الحذف هنا.',
    }[kind];
    const heading = document.createElement('tr');
    for (const title of columns[kind]) {
      const th = document.createElement('th');
      th.scope = 'col'; th.textContent = title; heading.append(th);
    }
    $('head').replaceChildren(heading);
    $('rows').replaceChildren();
    const actions = {userStatus:'حالة الحساب',closeRoom:'إغلاق غرفة',creditGold:'إضافة ذهب',deleteUser:'حذف حساب'};
    for (const item of data.items) {
      const row = document.createElement('tr');
      const add = (index,value) => cell(row,columns[kind][index],value);
      if (kind === 'rooms') {
        add(0,item.code+' · '+(item.mode==='Teams'?'فرق':'فردي')+(item.locked?' · خاصة':''));
        add(1,item.hostName);
        add(2,{waiting:'انتظار',playing:'يلعب',finished:'انتهت'}[item.status]||item.status);
        add(3,number.format(item.players.length)+' / ٤ · '+item.players.map(player=>player.name).join('، '));
        add(4,date(item.updatedAt));
        actionButton(add(5,''),'إغلاق وحذف',async()=>{
          if (await confirmAction({title:'إغلاق الغرفة',message:'سيخرج جميع اللاعبين من الغرفة '+item.code+' وتُحذف بياناتها.'})===null) return;
          await api('api/closeRoom',{roomId:item.id});
          await load(false,true);
          notice('أُغلقت الغرفة وحُذفت.');
        },'danger');
      } else if (kind === 'users') {
        const player = add(0,item.name || item.email || 'لاعب');
        if (item.name && item.email) {
          const email = document.createElement('small');
          email.textContent = item.email;
          player.append(email);
        }
        add(1,item.uid);
        add(2,date(item.lastSignIn));
        add(3,item.deleting?'قيد الحذف':(item.disabled?'محظور':'نشط'));
        add(4,number.format(item.gold)+' ذهب').className='gold-value';
        userActions(add(5,''),item);
      } else {
        add(0,item.actor);
        add(1,actions[item.action] || item.action);
        add(2,item.target);
        add(3,date(item.createdAt));
        add(4,item.state==='completed'?'اكتمل':'قيد المعالجة');
        add(5,item.action==='creditGold' ? '+'+number.format(item.amount)+' · من '+number.format(item.before)+' إلى '+number.format(item.after) : '—');
      }
      $('rows').append(row);
    }
    if (!data.items.length) {
      const row = document.createElement('tr');
      row.className='empty-row';
      const td=cell(row,'','لا توجد بيانات لعرضها');
      td.colSpan=columns[kind].length;
      $('rows').append(row);
    }
    pageCursor=requestedPage;
    cursor=data.cursor||'';
    $('more').hidden=kind!=='users'||!cursor;
    filterRows();
    notice('آخر تحديث '+new Date().toLocaleTimeString('ar-LY'));
  } catch (error) {
    if (current === sequence) notice(error.message,true);
  }
}
$('filter').oninput=filterRows;
$('cleanup-button').onclick=async()=>{
  $('cleanup-button').disabled=true;
  try {
    renderCleanup(await api('api/cleanup',{}));
    await watchCleanup();
  } catch (error) {
    notice(error.message,true);
    $('cleanup-button').disabled=false;
  }
};
$('login-form').onsubmit=async event=>{event.preventDefault();loginBusy(true);notice('جارٍ تسجيل الدخول…');try{
  const config=await fetch('/admin/config').then(r=>r.json());
  const res=await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key='+encodeURIComponent(config.apiKey),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:$('email').value.trim(),password:$('password').value,returnSecureToken:true})});
  const data=await res.json();if(!res.ok)throw Error('تعذر الدخول؛ تحقق من الحساب وكلمة المرور وتفعيل Email/Password');
  await api('session',{idToken:data.idToken});showDashboard();await load();
}catch(e){notice(e.message,true);}finally{$('password').value='';loginBusy(false);}};
$('logout').onclick=async()=>{try{await api('logout',{});showLogin();notice('تم تسجيل الخروج');}catch(e){notice(e.message,true);}};
document.querySelectorAll('[data-tab]').forEach(button=>button.onclick=()=>{tab=button.dataset.tab;$('filter').value='';document.querySelectorAll('[data-tab]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));load();});
$('refresh').onclick=()=>load(false,true);$('more').onclick=()=>load(true);
api('api/status').then(()=>{showDashboard();load();}).catch(()=>showLogin());
prepareGoogle();
