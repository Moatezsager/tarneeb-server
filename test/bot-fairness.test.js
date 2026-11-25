'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const e=require('../engine');
const policy=require('../bot-policy.json');

function rotate(s,shift){
  const r=structuredClone(s);
  for(const field of ['names','hands','scores','bids','taken','trick','exposed'])r[field]=Array.from({length:4},(_,seat)=>s[field][(seat-shift+4)%4]);
  for(const field of ['dealer','lead','current','king'])r[field]=(s[field]+shift)%4;
  for(let i=0;i<s.played.length;i+=4)for(let seat=0;seat<4;seat++)r.played[i+seat]=s.played[i+(seat-shift+4)%4];
  return r;
}

test('king ties rotate with dealer and have no fixed-seat preference',()=>{
  for(let dealer=0;dealer<4;dealer++){
    assert.equal(e.selectKing([0,0,0,0],dealer),(dealer+1)%4);
    const scores=[10,10,3,0],king=e.selectKing(scores,dealer);
    for(let shift=0;shift<4;shift++)assert.equal(e.selectKing(Array.from({length:4},(_,s)=>scores[(s-shift+4)%4]),(dealer+shift)%4),(king+shift)%4);
  }
  const s=e.start(['a','b','c','d'],61,2);
  Object.assign(s,{phase:'swapping',current:2,king:2,exposed:[25,38,13,51]});
  assert.deepEqual(e.ai(s,2),{action:'swap',value:3},'equally valued exposed cards follow relative play order');
});

test('bot observations omit identities and hidden hands, and are isolated copies',()=>{
  const s=e.start(['host','guest','bot','bot'],61,2),p=s.current;
  s.hostId='host';s.password='private';s.wallet={gold:999};
  const before=structuredClone(s),o=e.botObservation(s,p);
  assert.deepEqual(Object.keys(o).sort(),['phase','round','dealer','lead','current','king','difficulty','tricks','broken','scores','bids','taken','trick','played','exposed','hands','bot_policy'].sort());
  for(let seat=0;seat<4;seat++)assert.deepEqual(o.hands[seat],seat===p?s.hands[p]:[]);
  o.hands[p].pop();o.scores[0]=999;o.bot_policy.kingPressure=999;
  assert.deepEqual(s,before);
  s.phase='swapping';s.hands=new Proxy([],{get(){throw Error('No hand is visible to a swapping king');}});
  assert.doesNotThrow(()=>e.ai(s,p));
});

test('decisions rotate with seats across complete public histories including tied scores',()=>{
  for(let game=0;game<8;game++){
    const s=e.start(['a','b','c','d'],61,2);
    for(let step=0;step<400&&s.winner<0;step++){
      if(s.phase==='collecting'){e.collect(s);continue;}
      if(s.phase==='round_end'){e.nextRound(s);continue;}
      const p=s.current,a=e.ai(s,p);
      for(let shift=1;shift<4;shift++){
        const r=rotate(s,shift),expected={...a};
        if(a.action==='swap'&&a.value>=0)expected.value=(a.value+shift)%4;
        assert.deepEqual(e.ai(r,r.current),expected);
      }
      assert(e.act(s,p,a.action,a.value));
    }
  }
});

test('policy is pinned to match state and both engines ship identical weights',()=>{
  const s=e.start(['a','b','c','d'],61,2);
  assert.deepEqual(s.bot_policy,policy);
  s.bot_policy.version='fixture-old';s.bot_policy.kingPressure=123;
  e.nextRound(s);
  assert.equal(s.bot_policy.kingPressure,123);
  assert.equal(e.botObservation(s,s.current).bot_policy.version,'fixture-old');
  assert.equal(e.view(s,0).bot_policy,undefined);
  assert.deepEqual(JSON.parse(fs.readFileSync(require('node:path').join(__dirname,'fixtures/bot-policy.json'),'utf8')),policy);
});

