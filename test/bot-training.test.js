const {test}=require('node:test');
const assert=require('node:assert/strict');
const {seededRound,evaluate,compare,passesFixtures}=require('../tools/train-bots');
const policy=require('../bot-policy.json');
test('offline arena is deterministic, paired and excludes production identifiers',()=>{
  const a=seededRound(17),b=seededRound(17);assert.deepEqual(a,b);
  assert.equal(new Set(a.hands.flat()).size,52);
  assert(a.hands.every(h=>h.length===13));
  assert.notDeepEqual(a.hands,seededRound(18).hands);
  const first=evaluate(policy,[1,2,3,4]),second=evaluate(policy,[1,2,3,4]);
  assert.deepEqual(first.blocks,second.blocks);
  assert.deepEqual(compare(first,second),{pairedMean:0,lower95:0,upper95:0});
  assert(passesFixtures(policy));
  assert.throws(()=>evaluate(policy,[1],-1),/budget/);
});
