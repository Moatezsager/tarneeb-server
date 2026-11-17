'use strict';
const $=id=>document.getElementById(id);let tab='rooms',cursor='',pageCursor='',busy=false,sequence=0;
let searchItem=null,searchLabel='';
function notice(text,error=false){$('notice').textContent=text;$('notice').classList.toggle('error',error);}
async function api(path,body){const res=await fetch('/admin/'+path,{method:body?'POST':'GET',credentials:'same-origin',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const data=await res.json();if(!res.ok){if(res.status===401)showLogin();throw Error(data.error?.message||'تعذر الاتصال بالخادم');}return data.result;}
function showLogin(){sequence++;$('login').hidden=false;$('dashboard').hidden=true;$('logout').hidden=true;$('actor').hidden=true;$('rows').replaceChildren();}
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
const number=new Intl.NumberFormat('ar-LY');
const date=value=>value?new Date(value).toLocaleString('ar-LY'):'—';
const unit=(n,one,two,few,many)=>n===1?one:n===2?two:n>=3&&n<=10?n+' '+few:n+' '+many;
function relative(ms){
  if(!ms)return '—';
  const diff=Date.now()-ms;
  if(diff<60000)return 'الآن';
  const minutes=Math.floor(diff/60000);
  if(minutes<60)return 'قبل '+unit(minutes,'دقيقة','دقيقتين','دقائق','دقيقة');
  const hours=Math.floor(minutes/60);
  if(hours<24)return 'قبل '+unit(hours,'ساعة','ساعتين','ساعات','ساعة');
  const days=Math.floor(hours/24);
  if(days<7)return 'قبل '+unit(days,'يوم','يومين','أيام','يوم');
  return date(ms);
}
function ahead(ms){
  if(!ms)return '—';
  const diff=ms-Date.now();
  if(diff<=0)return 'الآن';
  const minutes=Math.ceil(diff/60000);
  if(minutes<60)return 'خلال '+unit(minutes,'دقيقة','دقيقتين','دقائق','دقيقة');
  return 'خلال '+unit(Math.ceil(minutes/60),'ساعة','ساعتين','ساعات','ساعة');
}
function duration(seconds){
  const minutes=Math.floor((seconds||0)/60);
  if(minutes<60)return number.format(minutes)+' دقيقة';
  return number.format(Math.floor(minutes/60))+' ساعة و'+number.format(minutes%60)+' دقيقة';
}
function stamp(ms,prefix){
  const small=document.createElement('small');
  small.className='rel';
  if(!ms){small.textContent=(prefix?prefix+' ':'')+'—';return small;}
  small.dataset.time=String(ms);small.dataset.prefix=prefix||'';
  small.textContent=(prefix?prefix+' ':'')+relative(ms);
  return small;
}
function pill(text,kind){
  const span=document.createElement('span');
  span.className='pill '+kind;span.textContent=text;return span;
}
function presence(online,target){
  const wrap=document.createElement('span');
  wrap.className='presence '+(online?'online':'offline');
  const dot=document.createElement('i');dot.setAttribute('aria-hidden','true');
  const label=document.createElement('span');label.textContent=online?'متصل الآن':'غير متصل';
  wrap.append(dot,label);
  if(target)target.append(wrap);else target=wrap;
  return target;
}
const creditDrafts=new Map();
let actorId='';
function cell(row,title,value){
  const td=document.createElement('td');
  td.dataset.label=title;
  td.textContent=String(value??'—');
  row.append(td);
  return td;
}
function cellNode(row,title,node){
  const td=document.createElement('td');
  td.dataset.label=title;
  td.append(node);
  row.append(td);
  return td;
}
function confirmAction({title,message,field}){
  const dialog=$('confirm'),input=$('confirm-input'),submit=$('confirm-submit');
  $('confirm-title').textContent=title;
  $('confirm-text').textContent=message;
  $('confirm-field').hidden=!field;
  $('confirm-label').textContent=field?.label||'';
  input.type=field?.type||'text';
  input.value='';
  input.required=!!field;
  input.min='1';
  input.max='1000000';
  input.step='1';
  input.maxLength=128;
  input.setCustomValidity('');
  input.oninput=()=>input.setCustomValidity('');
  submit.textContent=title;
  submit.className=field?.type==='number'?'primary':'danger';
  submit.onclick=event=>{
    if(field?.expected&&input.value.trim()!==field.expected){
      event.preventDefault();
      input.setCustomValidity('المعرّف المكتوب غير مطابق.');
      input.reportValidity();
    }
  };
  dialog.returnValue='';
  dialog.showModal();
  return new Promise(resolve=>dialog.addEventListener('close',()=>
    resolve(dialog.returnValue==='confirm'?input.value.trim():null),{once:true}));
}
function actionButton(parent,title,run,className=''){
  const btn=document.createElement('button');
  btn.textContent=title;
  btn.className=className;
  parent.append(btn);
  btn.onclick=async()=>{
    if(busy)return;
    busy=btn.disabled=true;
    try{await run();}
    catch(error){notice(error.message,true);}
    finally{busy=btn.disabled=false;}
  };
  return btn;
}
function creditRequest(uid,amount){
  const key=['tarneeb-credit',actorId,uid,amount].join(':');
  let id=creditDrafts.get(key);
  try{id||=sessionStorage.getItem(key);}catch{}
  id||=crypto.randomUUID();
  creditDrafts.set(key,id);
  try{sessionStorage.setItem(key,id);}catch{}
  return {id,clear(){
    creditDrafts.delete(key);
    try{sessionStorage.removeItem(key);}catch{}
  }};
}
function userActions(td,user){
  if(user.deleting){td.textContent='الحذف قيد المعالجة';return;}
  const name=user.name||user.email||user.uid;
  if(user.hasProfile)actionButton(td,'إضافة ذهب',async()=>{
    const amountText=await confirmAction({
      title:'إضافة ذهب',message:name+' · الرصيد الحالي '+number.format(user.gold),
      field:{type:'number',label:'كمية الذهب'},
    });
    if(amountText===null)return;
    const amount=Number(amountText),request=creditRequest(user.uid,amount);
    const result=await api('api/creditGold',{uid:user.uid,amount,requestId:request.id});
    request.clear();
    await load(false,true);
    notice('تمت إضافة '+number.format(amount)+' ذهب. الرصيد '+number.format(result.gold)+'.');
  },'gold');
  if(user.protected){
    const note=document.createElement('small');
    note.textContent='حساب إداري محمي';
    td.append(note);
    return;
  }
  actionButton(td,user.disabled?'رفع الحظر':'حظر',async()=>{
    const title=user.disabled?'رفع الحظر':'حظر الحساب';
    if(await confirmAction({title,message:title+' عن '+name+'؟'})===null)return;
    await api('api/userStatus',{uid:user.uid,disabled:!user.disabled});
    await load(false,true);
    notice('تم حفظ حالة الحساب.');
  });
  actionButton(td,'إنهاء الجلسات',async()=>{
    if(await confirmAction({title:'إنهاء الجلسات',message:'سيُطلب من '+name+' تسجيل الدخول من جديد على كل أجهزته.'})===null)return;
    await api('api/revokeSessions',{uid:user.uid});
    notice('أُنهيت جلسات الحساب؛ سيدخل من جديد.');
  });
  actionButton(td,'حذف نهائي',async()=>{
    const confirmed=await confirmAction({
      title:'حذف نهائي',
      message:'سيُحذف حساب '+name+' وملفه ورصيده وعلاقاته. اكتب المعرّف '+user.uid+' للتأكيد.',
      field:{type:'text',label:'معرّف الحساب',expected:user.uid},
    });
    if(confirmed===null)return;
    await api('api/deleteUser',{uid:user.uid,confirm:confirmed});
    await load(false,true);
    notice('طُلب حذف الحساب. تابع اكتمال العملية في سجل الإدارة.');
    void watchCleanup();
  },'danger');
}
function renderCleanup(cleanup){
  const button=$('cleanup-button');
  button.disabled=!cleanup||cleanup.running;
  const detail=$('cleanup-status');
  if(!cleanup){detail.textContent='حالة التنظيف غير متاحة';return;}
  if(cleanup.running){detail.textContent='جارٍ تنظيف البيانات ومعالجة طلبات الحذف…';return;}
  if(!cleanup.lastRun){detail.textContent='بانتظار أول دورة تنظيف';return;}
  let text='آخر دورة '+relative(cleanup.lastRun)+' · '+number.format(cleanup.removed)+' سجلًا منتهيًا';
  if(cleanup.audit)text+=' · '+number.format(cleanup.audit)+' من السجل الإداري';
  text+=' · '+number.format(cleanup.accounts)+' حسابًا حُذف';
  if(cleanup.errors)text+=' · عمليات متعثرة '+number.format(cleanup.errors);
  if(cleanup.nextRunAt)text+=' · الدورة القادمة '+ahead(cleanup.nextRunAt);
  if(cleanup.auditRetentionDays)text+=' · سجل الإدارة '+number.format(cleanup.auditRetentionDays)+' يومًا';
  detail.textContent=text;
}
let cleanupWatch=0;
async function watchCleanup(){
  const monitor=++cleanupWatch;
  for(let i=0;i<12&&monitor===cleanupWatch;i++){
    try{
      const status=await api('api/status');
      if(monitor!==cleanupWatch||$('dashboard').hidden)return;
      renderCleanup(status.cleanup);
      if(!status.cleanup?.running)return;
      await new Promise(resolve=>setTimeout(resolve,2500));
    }catch{return;}
  }
}
function renderMetrics(status){
  const stats=status.diagnostics?.stats||status.usage||{};
  const hits=stats.pollHits||0,snapshots=stats.pollSnapshots||0,polls=hits+snapshots;
  const cards=[
    ['مدة التشغيل',duration(status.uptimeSeconds)],
    ['ذاكرة الخادم',status.memoryMB+' MB'],
    ['الطلبات الجارية',number.format(status.inFlight??0)],
    ['كفاءة الاستطلاع',polls?Math.round(hits*100/polls)+'%':'—'],
    ['كتابات الغرف',number.format(stats.roomWrites||0)],
    ['طلبات / أخطاء',number.format(status.requests||0)+' / '+number.format(status.errors||0)],
  ];
  const grid=$('metrics');
  grid.replaceChildren();
  for(const [label,value] of cards){
    const box=document.createElement('div');
    box.className='metric';
    const strong=document.createElement('strong');
    strong.textContent=value;
    box.append(label,strong);
    grid.append(box);
  }
  const cache=status.diagnostics||{};
  $('resource-status').textContent=[
    'ذاكرة استطلاع '+number.format(cache.pollCache||0)+' غرفة',
    'مفاتيح حد '+number.format(cache.rateLimits||0),
    'عمليات '+number.format(stats.mutations||0),
    'لقطات '+number.format(snapshots),
    'Node '+(status.node||'—'),
  ].join(' · ');
  if(status.uid){actorId=status.uid;$('actor').hidden=false;$('actor').textContent='المسؤول '+status.uid.slice(0,12);$('actor').title=status.uid;}
  renderCleanup(status.cleanup);
}
function filterRows(){
  const query=($('filter').value||'').trim().toLocaleLowerCase('ar');
  let visible=0;
  for(const row of $('rows').children||[]){
    row.hidden=!row.textContent.toLocaleLowerCase('ar').includes(query);
    if(!row.hidden&&!row.classList.contains('empty-row'))visible++;
  }
  $('result-count').textContent=number.format(visible)+' نتيجة في الصفحة';
}
const columns={
  rooms:['الغرفة','المضيف','الحالة','المقاعد','آخر نشاط','الإجراء'],
  users:['اللاعب','المعرّف','آخر اتصال','الحالة','الذهب','الإجراء'],
  audit:['المسؤول','الإجراء','الهدف','الوقت','الحالة','التفاصيل'],
};
const titles={rooms:'الغرف',users:'المستخدمون',audit:'سجل الإدارة'};
const hints={
  rooms:'آخر 30 غرفة · نقطة خضراء متصل، باهتة منقطع، صفراء بوت · تُحذف الغرفة عند الفوز أو مغادرة آخر لاعب.',
  users:'25 حسابًا في الصفحة · «آخر اتصال» من نبضات اللاعب، وبريد الدخول يظهر تحته.',
  audit:'آخر 30 إجراء · تُعرض إضافات الذهب وطلبات الحذف وإنهاء الجلسات هنا.',
};
const auditActions={userStatus:'حالة الحساب',closeRoom:'إغلاق غرفة',creditGold:'إضافة ذهب',deleteUser:'حذف حساب',revokeSessions:'إنهاء جلسات'};
const roomStates={waiting:['انتظار','warn'],playing:['يلعب','ok'],finished:['انتهت','muted']};
function seatMap(item){
  const wrap=document.createElement('span');
  wrap.className='seats';
  const bots=item.botSeats||[];
  for(let index=0;index<4;index++){
    const player=item.players.find(p=>p.index===index);
    const dot=document.createElement('i');
    dot.className='seat '+(player?(player.status==='connected'?'live':'away'):bots.includes(index)?'bot':'empty');
    dot.title=player
      ?player.name+(player.status==='connected'?' · '+(player.latencyMs||0)+'ms':' · منقطع')
      :bots.includes(index)?'بوت':'مقعد فارغ';
    wrap.append(dot);
  }
  const names=document.createElement('small');
  names.textContent=item.players.map(p=>p.name).join('، ')||'لا لاعبين';
  wrap.append(names);
  return wrap;
}
function renderRoom(row,item){
  const ident=cell(row,columns.rooms[0],item.code);
  ident.className='mono';
  const meta=document.createElement('small');
  meta.textContent=(item.mode==='Teams'?'فرق':'فردي')+(item.locked?' · خاصة':'');
  ident.append(meta);
  cell(row,columns.rooms[1],item.hostName||'—');
  const [label,kind]=roomStates[item.status]||[item.status,'muted'];
  cellNode(row,columns.rooms[2],pill(label,kind));
  cellNode(row,columns.rooms[3],seatMap(item));
  cellNode(row,columns.rooms[4],stamp(item.updatedAt,'آخر نشاط'));
  actionButton(cell(row,columns.rooms[5],''),'إغلاق وحذف',async()=>{
    if(await confirmAction({title:'إغلاق الغرفة',message:'سيخرج جميع اللاعبين من الغرفة '+item.code+' وتُحذف بياناتها.'})===null)return;
    await api('api/closeRoom',{roomId:item.id});
    await load(false,true);
    notice('أُغلقت الغرفة وحُذفت.');
  },'danger');
}
function renderUser(row,item){
  const player=cell(row,columns.users[0],item.name||item.email||'لاعب');
  if(item.name&&item.email){const email=document.createElement('small');email.textContent=item.email;player.append(email);}
  const ident=cell(row,columns.users[1],item.searchId||'—');
  ident.className='mono';
  const uid=document.createElement('small');uid.textContent=item.uid;ident.append(uid);
  const seen=document.createElement('div');
  seen.className='seen';
  presence(item.online,seen);
  if(!item.online)seen.append(stamp(item.lastSeen,'آخر ظهور'));
  if(item.lastSignIn){const signed=document.createElement('small');signed.textContent='دخول '+date(item.lastSignIn);seen.append(signed);}
  cellNode(row,columns.users[2],seen);
  const state=document.createElement('div');
  state.className='state';
  state.append(item.deleting?pill('قيد الحذف','danger'):item.disabled?pill('محظور','warn'):pill('نشط','ok'));
  if(item.room){const room=document.createElement('small');room.textContent='غرفة '+item.room.code+' · '+(roomStates[item.room.status]?.[0]||item.room.status);state.append(room);}
  cellNode(row,columns.users[3],state);
  addGold(row,item);
  userActions(cell(row,columns.users[5],''),item);
}
function addGold(row,item){cell(row,columns.users[4],number.format(item.gold)+' ذهب').className='gold-value';}
function renderAudit(row,item){
  cell(row,columns.audit[0],item.actor);
  cell(row,columns.audit[1],auditActions[item.action]||item.action);
  cell(row,columns.audit[2],item.target);
  cellNode(row,columns.audit[3],stamp(item.createdAt,''));
  cellNode(row,columns.audit[4],item.state==='completed'?pill('اكتمل','ok'):pill('قيد المعالجة','warn'));
  cell(row,columns.audit[5],item.action==='creditGold'?'+'+number.format(item.amount)+' · من '+number.format(item.before)+' إلى '+number.format(item.after):'—');
}
function emptyRow(){
  const row=document.createElement('tr');
  row.className='empty-row';
  const td=cell(row,'','لا توجد بيانات لعرضها');
  td.colSpan=6;
  return row;
}
async function load(next=false,keepPage=false){
  const current=++sequence,kind=tab;
  const requestedPage=next?cursor:(keepPage?pageCursor:'');
  const listing=searchItem&&kind==='users'
    ?Promise.resolve({items:[searchItem],cursor:''})
    :api('api/'+kind+(kind==='users'?'?cursor='+encodeURIComponent(requestedPage):''));
  notice('جارٍ التحديث…');
  try{
    const [data,status]=await Promise.all([listing,api('api/status')]);
    if(current!==sequence)return;
    renderMetrics(status);
    $('title').textContent=titles[kind];
    $('hint').textContent=hints[kind];
    $('user-search').hidden=kind!=='users';
    const heading=document.createElement('tr');
    for(const title of columns[kind]){
      const th=document.createElement('th');
      th.scope='col';th.textContent=title;heading.append(th);
    }
    $('head').replaceChildren(heading);
    $('rows').replaceChildren();
    for(const item of data.items){
      const row=document.createElement('tr');
      if(kind==='rooms')renderRoom(row,item);
      else if(kind==='users')renderUser(row,item);
      else renderAudit(row,item);
      $('rows').append(row);
    }
    if(!data.items.length)$('rows').append(emptyRow());
    const note=$('search-note');
    note.replaceChildren();
    note.hidden=kind!=='users'||(!searchItem&&!searchLabel);
    if(!note.hidden){
      const text=document.createElement('span');
      text.textContent=searchItem?'نتيجة البحث عن «'+searchLabel+'»':'لا يوجد حساب مطابق لـ«'+searchLabel+'»';
      const clear=document.createElement('button');
      clear.type='button';clear.className='link';clear.textContent='عرض كل المستخدمين';
      clear.onclick=()=>{searchItem=null;searchLabel='';$('query').value='';load();};
      note.append(text,clear);
    }
    pageCursor=requestedPage;
    cursor=data.cursor||'';
    $('more').hidden=kind!=='users'||!cursor||!!searchItem;
    filterRows();
    notice('آخر تحديث '+new Date().toLocaleTimeString('ar-LY'));
  }catch(error){
    if(current===sequence)notice(error.message,true);
  }
}
$('filter').oninput=filterRows;
$('cleanup-button').onclick=async()=>{
  $('cleanup-button').disabled=true;
  try{
    renderCleanup(await api('api/cleanup',{}));
    await watchCleanup();
  }catch(error){
    notice(error.message,true);
    $('cleanup-button').disabled=false;
  }
};
$('user-search').onsubmit=async event=>{
  event.preventDefault();
  const query=$('query').value.trim();
  if(!query){searchItem=null;searchLabel='';await load();return;}
  const current=++sequence;
  notice('جارٍ البحث…');
  try{
    const {item}=await api('api/findUser?q='+encodeURIComponent(query));
    if(current!==sequence)return;
    searchItem=item;searchLabel=query;
    await load();
    if(item)notice('تم العثور على الحساب.');
  }catch(error){
    if(current===sequence)notice(error.message,true);
  }
};
$('login-form').onsubmit=async event=>{event.preventDefault();loginBusy(true);notice('جارٍ تسجيل الدخول…');try{
  const config=await fetch('/admin/config').then(r=>r.json());
  const res=await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key='+encodeURIComponent(config.apiKey),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:$('email').value.trim(),password:$('password').value,returnSecureToken:true})});
  const data=await res.json();if(!res.ok)throw Error('تعذر الدخول؛ تحقق من الحساب وكلمة المرور وتفعيل Email/Password');
  await api('session',{idToken:data.idToken});showDashboard();await load();
}catch(e){notice(e.message,true);}finally{$('password').value='';loginBusy(false);}};
$('logout').onclick=async()=>{try{await api('logout',{});showLogin();notice('تم تسجيل الخروج');}catch(e){notice(e.message,true);}};
document.querySelectorAll('[data-tab]').forEach(button=>button.onclick=()=>{
  tab=button.dataset.tab;
  searchItem=null;searchLabel='';
  $('filter').value='';$('query').value='';
  document.querySelectorAll('[data-tab]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
  load();
});
$('refresh').onclick=()=>load(false,true);$('more').onclick=()=>load(true);
setInterval(()=>{
  for(const el of document.querySelectorAll('[data-time]')){
    el.textContent=(el.dataset.prefix?el.dataset.prefix+' ':'')+relative(Number(el.dataset.time));
  }
},30000);
api('api/status').then(()=>{showDashboard();load();}).catch(()=>showLogin());
prepareGoogle();
