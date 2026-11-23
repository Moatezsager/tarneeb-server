'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createService}=require('../service');

const base={age:27,country:'LY',gender:'male',avatar:'avatar_1',profileComplete:true};
function fakeDb(users){
  let reads=0;
  const db={
    doc:path=>({path,id:path.split('/').at(-1)}),
    collection:()=>{
      const query={limit(count){query.count=count;return query;},
        orderBy(field,direction){query.field=field;query.direction=direction;return query;},
        async get(){
          reads++;
          const rows=Object.entries(users)
            .filter(([,user])=>Number.isFinite(user.economy?.points))
            .sort((a,b)=>b[1].economy.points-a[1].economy.points)
            .slice(0,query.count??20);
          return {docs:rows.map(([id,user])=>({id,data:()=>user}))};
        }};
      return query;
    },
    runTransaction:async fn=>fn({get:async()=>null,getAll:async()=>[]}),
  };
  return {db,reads:()=>reads};
}

const call=(service,op,payload={})=>service('player',{op,payload,protocolVersion:3});

test('leaderboard ranks complete profiles by experience and hides deleted or unfinished accounts',async()=>{
  let now=1_000_000;
  const fake=fakeDb({
    'u-low':{...base,name:'سالم',economy:{points:12,wins:1,games:3}},
    'u-top':{...base,name:'عمر',frame:'royal',economy:{points:840,wins:12,games:20}},
    'u-mid':{...base,name:'خالد',economy:{points:120,wins:4,games:7}},
    'u-deleted':{...base,name:'محذوف',deleting:true,economy:{points:9999,wins:99,games:99}},
    'u-partial':{...base,name:'ناقص',age:undefined,economy:{points:5000,wins:1,games:1}},
    'u-legacy':{...base,name:'قديم'},
  });
  const service=createService(fake.db,()=>now);
  const board=await call(service,'leaderboard');
  assert.deepEqual(board.items.map(item=>item.uid),['u-top','u-mid','u-low']);
  assert.deepEqual(board.items[0],{uid:'u-top',name:'عمر',avatar:'avatar_1',country:'LY',frame:'royal',effect:'',
    points:840,wins:12,games:20});
  assert.equal(board.updatedAt,now);
  assert.equal(fake.reads(),1);
});

test('leaderboard is cached for a minute and rejects unknown payload fields',async()=>{
  let now=2_000_000;
  const fake=fakeDb({'u-a':{...base,name:'أحمد',economy:{points:30,wins:2,games:4}}});
  const service=createService(fake.db,()=>now);
  await call(service,'leaderboard');
  await call(service,'leaderboard');
  assert.equal(fake.reads(),1);
  now+=61_000;
  const refreshed=await call(service,'leaderboard');
  assert.equal(fake.reads(),2);
  assert.equal(refreshed.updatedAt,now);
  await assert.rejects(call(service,'leaderboard',{scope:'friends'}),e=>e.code==='invalid-argument');
});
