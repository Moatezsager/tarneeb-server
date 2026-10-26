'use strict';
function parseOrigin(value,production){
  const message='PUBLIC_ORIGIN must be your service URL (https://your-service.onrender.com), without a path, query, fragment or credentials';
  let url;
  try{url=new URL((value||'').trim());}catch{throw Error(message);}
  if(!['http:','https:'].includes(url.protocol)||(production&&url.protocol!=='https:')||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error(message);
  return url.origin;
}
module.exports={parseOrigin};
