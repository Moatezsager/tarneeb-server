const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const e=require('../engine');
const fixture=path.resolve(__dirname,'fixtures/rules-parity.json');
test('server engine matches recorded Godot decisions and individual rule transitions',()=>{
  const cases=JSON.parse(fs.readFileSync(fixture,'utf8'));assert(cases.length>300);
  for(const {before,operation:o,after} of cases){
    if(o.kind==='act')assert.deepEqual(e.ai(before,o.player),{action:o.action,value:o.value});
    assert(o.kind==='collect'?e.collect(before):e.act(before,o.player,o.action,o.value));
    assert.deepEqual(before,after,`${before.mode} round ${before.round} revision ${before.revision}`);
  }
});
