'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {completeProfile,validateProfileEdit}=require('../profile');
test('required profile fields and Arabic names are validated without trusting UI',()=>{
  const profile={name:'معتز_1999',age:27,country:'LY',gender:'male',avatar:'avatar_12'};
  validateProfileEdit(profile);assert(completeProfile(profile));
  for(const change of [{name:'ab'},{name:'a'.repeat(25)},{name:'abc<script>'},{name:'abc\nxyz'},{age:0},{age:121},{age:12.5},{age:'25'},{gender:'other'},{country:'ZZ'},{avatar:'https://example.com/track.svg'},{avatar:'avatar_13'}]){
    assert.throws(()=>validateProfileEdit({...profile,...change}),e=>e.code==='invalid-argument');
    assert.equal(completeProfile({...profile,...change}),false);
  }
  assert.equal(completeProfile({...profile,age:undefined}),false);
});
