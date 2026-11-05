const {test}=require('node:test');
const assert=require('node:assert/strict');
const e=require('../engine');
const {advance,reply}=require('../service');
test('server plays complete individual matches without losing or duplicating cards',()=>{
  for(let run=0;run<20;run++){
    const s=e.start(['a','b','c','d'],31,run%3);
    let actions=0;
    while(s.winner<0&&actions++<20000){
      const cards=[...s.hands.flat(),...s.played,...s.trick.filter(c=>c>=0)];
      assert.equal(cards.length,52);assert.equal(new Set(cards).size,52);
      if(s.phase==='collecting'){assert(e.collect(s));continue;}
      if(s.phase==='round_end'){e.nextRound(s);continue;}
      const p=s.current,a=e.ai(s,p),before=structuredClone(s);
      assert.equal(e.act(s,(p+1)%4,a.action,a.value),false);assert.deepEqual(s,before);
      assert(e.act(s,p,a.action,a.value));
      assert.equal(e.act(s,s.current,'play',99),false);
    }
    assert(s.winner>=0,'match must finish');
  }
});
test('scoring boundaries and hearts queen/ace trap match the Godot rules',()=>{
  assert.equal(e.scoreBid(0,0,false),5);assert.equal(e.scoreBid(0,1,false),-5);
  assert.equal(e.scoreBid(-1,1,true),0);assert.equal(e.scoreBid(-1,2,true),2);
  for(const [bid,points] of [[5,5],[7,14],[8,16],[9,18],[10,10],[11,22],[12,24],[13,26]]){
    assert.equal(e.scoreBid(bid,bid,false),points);
    assert.equal(e.scoreBid(bid,bid-1,false),-points);
  }
  const s=e.start(['a','b','c','d'],61);Object.assign(s,{round:2,phase:'collecting',trick:[12,10,25,38],lead:0});
  assert(e.collect(s));assert.deepEqual(s.trap,[0,1]);assert.deepEqual(s.scores,[5,-5,0,0]);
});
test('zero is a real bid and lifts the total limit while score floors remain enforced',()=>{
  const s=e.start(['a','b','c','d'],61);e.nextRound(s);
  Object.assign(s,{phase:'bidding',dealer:3,current:0});
  assert(!e.act(s,0,'bid',1));assert(!e.act(s,0,'bid',6));
  assert(e.act(s,0,'bid',0));assert.equal(s.phase,'bidding');
  assert(!e.act(s,1,'bid',1));assert(!e.act(s,1,'bid',6));
  assert(e.act(s,1,'bid',2));assert(e.act(s,2,'bid',2));
  assert.deepEqual(e.bids(s,3),[0,2,3,4,5,7,8,9,10,11,12,13]);
  for(const [score,floor] of [[20,0],[21,3],[30,3],[31,4],[40,4],[41,5]]){
    s.scores[3]=score;assert.equal(e.bids(s,3)[0],floor);
  }
  assert.equal(e.act(s,3,'bid',0),false);
  assert(e.act(s,3,'bid',5));assert.equal(s.phase,'playing');
  Object.assign(s,{phase:'bidding',current:3,bids:[2,2,2,-1],scores:[0,0,0,0]});
  assert.deepEqual(e.bids(s,3),[0,5,8,9,10,11,12,13]);
});
test('successful 11–13 bids end the match on the deciding trick',()=>{
  for(const bid of [11,12,13]){
    const s=e.start(['a','b','c','d'],61);
    Object.assign(s,{round:2,phase:'collecting',bids:[bid,0,2,3],taken:[bid-1,0,0,0],
      tricks:bid-1,lead:0,trick:[25,13,14,15],scores:[0,55,0,0]});
    assert(e.collect(s));assert.equal(s.phase,'round_end');assert.equal(s.winner,0);
    assert.equal(s.tricks,bid);assert.equal(s.results[1].change,bid<13?0:5);
    assert.equal(e.collect(s),false);
  }
});
test('bots can spoil nil, block the leader and manage the queen from public information',()=>{
  const s=e.start(['a','b','c','d'],61,2);
  Object.assign(s,{round:2,phase:'playing',lead:0,current:3,bids:[0,2,2,3],taken:[0,0,0,0],
    trick:[21,16,17,-1],exposed:[-1,-1,-1,-1],hands:[[],[],[],[13,25]]});
  assert.equal(e.ai(s,3).value,13);
  s.scores[0]=55;assert.equal(e.ai(s,3).value,25);
  s.scores[0]=0;s.trick=[23,10,17,-1];s.hands[3]=[12,0];
  assert.equal(e.ai(s,3).value,12);
  s.trick=[23,1,17,-1];assert.equal(e.ai(s,3).value,0);
  s.trick=[23,12,17,-1];s.hands[3]=[10,13];
  // When following suit is mandatory the queen is unavailable.
  assert.equal(e.ai(s,3).value,13);
  s.hands[3]=[10,26];assert.equal(e.ai(s,3).value,26);
  s.trick=[23,1,17,-1];assert.equal(e.ai(s,3).value,10);
  s.hands[0]=[12,50];assert.equal(e.ai(s,3).value,10,'hidden rival cards cannot change the choice');
});
test('private view contains only its hand; presentation ending changes the wire revision',()=>{
  const s=e.start(['a','b','c','d'],61);s.presentation='reveal';s.presentationUntil=4500;s.turnDueAt=4500;
  const r={players:[{uid:'alice',index:0,status:'connected'}],createdAt:{toMillis:()=>0},updatedAt:{toMillis:()=>0},expiresAt:{toMillis:()=>10000}};
  const v=reply(r,s,'alice',1000).view;assert(!('hands'in v));assert.deepEqual(v.hand,s.hands[0]);assert.deepEqual(v.legal,[]);
  const revision=s.revision;assert.equal(advance(s,r,4499),false);assert(advance(s,r,4500));assert.equal(s.revision,revision+1);assert.equal(s.presentation,'');
});
