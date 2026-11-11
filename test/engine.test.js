const {test}=require('node:test');
const assert=require('node:assert/strict');
const e=require('../engine');
const {advance,reply}=require('../service');

test('multiple players reaching the target extend the shoot by ten repeatedly',()=>{
  const s=e.start(['a','b','c','d'],31);
  for(const [scores,target] of [[[28,30,0,0],41],[[38,40,0,0],51]]){
    Object.assign(s,{round:2,phase:'collecting',scores,tricks:12,bids:[3,3,2,2],taken:[2,3,0,0],trick:[25,24,23,22],lead:0});
    assert(e.collect(s));
    assert.equal(s.target,target);
    assert.equal(s.winner,-1);
    assert.equal(s.phase,'round_end');
  }
});
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
});
test('dealer covers the gap to eleven without a ban on totals of thirteen',()=>{
  const s=e.start(['a','b','c','d'],61);
  Object.assign(s,{round:2,phase:'bidding',dealer:3,current:3,bids:[2,2,2,-1]});
  assert.deepEqual(e.view(s,3).available_bids,[5,7,8,9,10,11,12,13]);
  assert(!e.act(s,3,'bid',0));
  assert(!e.act(s,3,'bid',4));
  assert(e.act(s,3,'bid',7));
  assert.equal(s.phase,'playing');
  s.bids=[2,4,2,-1];
  assert.deepEqual(e.bids(s,3),[3,4,5,7,8,9,10,11,12,13]);
  s.scores[3]=41;
  assert.equal(e.bids(s,3)[0],5);
  s.scores[3]=0;
  s.bids=[3,4,4,-1];
  assert.equal(e.bids(s,3)[0],0);
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
  s.scores[0]=55;assert.equal(e.ai(s,3).value,13,'give the nil-bidding leader a trick to break their contract');
  s.bids[0]=5;assert.equal(e.ai(s,3).value,25,'deny a trick when the leader needs a positive bid');
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

test('professional bot decisions never read another hand, even when swapping or bidding',()=>{
  const s=e.start(['a','b','c','d'],61,2);
  for(let step=0;step<700;step++){
    if(s.winner>=0)break;
    if(s.phase==='collecting'){e.collect(s);continue;}
    if(s.phase==='round_end'){e.nextRound(s);continue;}
    const p=s.current,expected=e.ai(s,p),hands=s.hands;
    s.hands=new Proxy(hands,{
      get(target,key){
        if(/^[0-3]$/.test(String(key)))assert.equal(Number(key),p,'opponent hand was inspected');
        return Reflect.get(target,key);
      }
    });
    assert.deepEqual(e.ai(s,p),expected);
    s.hands=hands;
    assert(e.act(s,p,expected.action,expected.value));
  }
});

test('public void inference and probability respect actual cards already shown',()=>{
  const s=e.start(['a','b','c','d'],61,2);
  Object.assign(s,{round:2,phase:'playing',dealer:3,lead:0,current:0,
    scores:[0,29,0,0],bids:[2,3,2,3],taken:[0,1,0,0],tricks:1,
    played:[13,0,14,15],trick:[-1,-1,-1,-1],exposed:[-1,12,-1,-1]});
  s.hands[0]=[25,38];
  assert.equal(e.ai(s,0).value,38,'avoid the suit the leading player has shown they can trump');
  Object.assign(s,{played:[],tricks:0,lead:0,current:3,trick:[39,40,41,-1],exposed:[-1,-1,-1,-1],hands:[[],[],[],[10,26]]});
  assert.equal(e.ai(s,3).value,10,'discard the queen when acting last with no ace in the trick');
  s.trick[1]=12;
  assert.equal(e.ai(s,3).value,26,'do not discard the queen onto the ace when a legal escape exists');
});

test('the king sees only the exposed card until the swap presentation closes',()=>{
  const s=e.start(['a','b','c','d'],61,2);
  e.nextRound(s);
  const king=s.king,room={players:[{uid:'king',index:king,status:'connected'}],createdAt:{toMillis:()=>0},updatedAt:{toMillis:()=>0},expiresAt:{toMillis:()=>10000}};
  for(const presentation of ['reveal','']){
    s.presentation=presentation;
    const v=reply(room,s,'king',0).view;
    assert.equal(v.hand_concealed,true);
    assert.deepEqual(v.hand,[s.exposed[king]]);
    assert.equal(v.hand_counts[king],13);
  }
  const before=e.ai(s,king);
  const hand=s.hands[king];
  s.hands[king]=new Proxy(hand,{get(){throw new Error('king inspected the hidden hand');}});
  assert.deepEqual(e.ai(s,king),before);
  s.hands[king]=hand;
  assert(e.act(s,king,'swap',-1));
  s.presentation='swap_result';
  assert.deepEqual(e.view(s,king).hand,[s.exposed[king]]);
  assert.equal(e.view(s,(king+1)%4).hand.length,13,'other players retain their own hands');
  s.presentation='';
  assert.deepEqual(e.view(s,king).hand,hand);
  assert.equal(e.view(s,king).hand_concealed,false);
});
test('private view contains only its hand; presentation ending changes the wire revision',()=>{
  const s=e.start(['a','b','c','d'],61);s.presentation='reveal';s.presentationUntil=4500;s.turnDueAt=4500;
  const r={players:[{uid:'alice',index:0,status:'connected'}],createdAt:{toMillis:()=>0},updatedAt:{toMillis:()=>0},expiresAt:{toMillis:()=>10000}};
  const v=reply(r,s,'alice',1000).view;assert(!('hands'in v));assert.deepEqual(v.hand,s.hands[0]);assert.deepEqual(v.legal,[]);
  const revision=s.revision;assert.equal(advance(s,r,4499),false);assert(advance(s,r,4500));assert.equal(s.revision,revision+1);assert.equal(s.presentation,'');
});
