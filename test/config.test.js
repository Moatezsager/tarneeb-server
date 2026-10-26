'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {parseOrigin}=require('../config');
test('origin accepts harmless URL formatting while preserving the admin origin boundary',()=>{
  for(const value of ['https://example.com','https://example.com/',' https://EXAMPLE.com:443/\n'])assert.equal(parseOrigin(value,true),'https://example.com');
  assert.equal(parseOrigin('http://localhost:10000/',false),'http://localhost:10000');
  for(const value of ['',undefined,'example.com','http://example.com','https://example.com/admin','https://example.com/online','https://example.com//','https://example.com/?key=value','https://example.com/#fragment','https://user:pass@example.com','file:///tmp'])assert.throws(()=>parseOrigin(value,true),/PUBLIC_ORIGIN/);
});
