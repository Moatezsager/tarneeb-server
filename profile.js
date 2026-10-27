'use strict';
const {AppError}=require('./errors');
const countries=new Set('LY SA EG TN DZ MA JO SY LB IQ KW AE QA OM BH YE SD PS TR US GB'.split(' '));
const validName=value=>typeof value==='string'&&value.trim().length>=3&&value.trim().length<=24&&/^[\p{L}\p{N}][\p{L}\p{M}\p{N} _-]*$/u.test(value.trim());
const validAvatar=value=>typeof value==='string'&&/^avatar_([1-9]|1[0-2])$/.test(value);
function completeProfile(p){return validName(p.name)&&Number.isInteger(p.age)&&p.age>=1&&p.age<=120&&['male','female'].includes(p.gender)&&countries.has(p.country)&&validAvatar(p.avatar);}
function validateProfileEdit(d){
  const bad=message=>{throw new AppError('invalid-argument',message);};
  if(d.name!==undefined&&!validName(d.name))bad('الاسم من 3 إلى 24 حرفًا: حروف وأرقام ومسافات و _ أو - فقط');
  if(d.age!==undefined&&(!Number.isInteger(d.age)||d.age<1||d.age>120))bad('أدخل عمرًا صحيحًا من 1 إلى 120');
  if(d.gender!==undefined&&!['male','female'].includes(d.gender))bad('اختر ذكر أو أنثى');
  if(d.country!==undefined&&!countries.has(d.country))bad('اختر بلدًا من القائمة');
  if(d.avatar!==undefined&&!validAvatar(d.avatar))bad('اختر صورة من المكتبة');
}
module.exports={completeProfile,validateProfileEdit};
