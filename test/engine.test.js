const {test}=require('node:test');
const assert=require('node:assert/strict');
const e=require('../engine');
const {advance,reply}=require('../service');
test('server plays complete legal matches in both modes without losing or duplicating cards',()=>{
  for(const mode of ['Teams','FFA'])for(let run=0;run<20;run++){
    const s=e.start(['a','b','c','d'],mode,31,run%3);
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
  assert.equal(e.scoreBid(5,4,false,false),-5);assert.equal(e.scoreBid(5,5,false,false),10);
  assert.equal(e.scoreBid(7,8,false,false),21);assert.equal(e.scoreBid(11,11,false,true),33);
  assert.equal(e.scoreBid(9,9,false,true),18);assert.equal(e.scoreBid(0,6,true,true),6);
  const s=e.start(['a','b','c','d'],'FFA',61);Object.assign(s,{round:2,phase:'collecting',trick:[12,10,25,38],lead:0});
  assert(e.collect(s));assert.deepEqual(s.trap,[0,1]);assert.deepEqual(s.scores,[5,-5,0,0]);
});
test('private view contains only its hand; presentation ending changes the wire revision',()=>{
  const s=e.start(['a','b','c','d'],'Teams',61);s.presentation='reveal';s.presentationUntil=4500;s.turnDueAt=4500;
  const r={players:[{uid:'alice',index:0,status:'connected'}],createdAt:{toMillis:()=>0},updatedAt:{toMillis:()=>0},expiresAt:{toMillis:()=>10000}};
  const v=reply(r,s,'alice',1000).view;assert(!('hands'in v));assert.deepEqual(v.hand,s.hands[0]);assert.deepEqual(v.legal,[]);
  const revision=s.revision;assert.equal(advance(s,r,4499),false);assert(advance(s,r,4500));assert.equal(s.revision,revision+1);assert.equal(s.presentation,'');
});
