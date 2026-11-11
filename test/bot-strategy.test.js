const {test}=require('node:test');
const assert=require('node:assert/strict');
const fixtures=require('./fixtures/bot-strategy.json');
const e=require('../engine');

for(const fixture of fixtures)test(fixture.name,()=>{
  for(let shift=0;shift<4;shift++){
    const s=structuredClone(fixture.before);
    for(const field of ['names','hands','scores','bids','taken','trick','exposed']){
      const original=s[field];
      s[field]=Array.from({length:4},(_,seat)=>original[(seat-shift+4)%4]);
    }
    for(const field of ['dealer','lead','current','king'])s[field]=(s[field]+shift)%4;
    for(let i=0;i<s.played.length;i+=4){
      const trick=s.played.slice(i,i+4);
      for(let seat=0;seat<4;seat++)s.played[i+seat]=trick[(seat-shift+4)%4];
    }
    const before=structuredClone(s),p=s.current;
    assert(e.legal(s,p).includes(fixture.expected.value));
    assert.deepEqual(e.ai(s,p),fixture.expected,`seat rotation ${shift}`);
    assert.deepEqual(s,before,'strategy mutated the state');
    s.hands=new Proxy(s.hands,{get(target,key){
      if(/^[0-3]$/.test(String(key)))assert.equal(Number(key),p,'read a hidden hand');
      return Reflect.get(target,key);
    }});
    assert.deepEqual(e.ai(s,p),fixture.expected);
  }
});
