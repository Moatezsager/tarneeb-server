'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {react}=require('../bot-reactions');
const room=()=>({players:[{index:0,uid:'human'}],botSeats:[1,2,3],chat:[]});
const state=()=>({round:2,tricks:3,last_trick:[10,12,13,14],lead:1,phase:'playing',names:['H','B','C','D'],bids:[2,2,2,2],taken:[0,1,0,0]});
test('bot reacts to public queen capture once with bounded room and target cooldowns',()=>{
  const r=room(),s=state();
  s.hands=new Proxy([],{get(){throw Error('Reactions must not inspect private cards');}});
  react(r,s,1000);assert.equal(r.chat.length,1);assert.equal(r.chat[0].text,'🥊 0');assert.equal(r.chat[0].seat,1);assert.equal(r.chat[0].round,2);assert.equal(r.chat[0].phase,'playing');
  react(r,s,1000);assert.equal(r.chat.length,1);
  react(r,{...s,tricks:4},47000);assert.equal(r.chat.length,1,'same target protected for 90 seconds');
  react(r,{...s,tricks:5},92000);assert.equal(r.chat.length,2);
  react(r,{...s,tricks:6},200000);assert.equal(r.chat.length,2,'two reactions per round maximum');
  react(r,{...s,round:3},201000);assert.equal(r.chat.length,3);
});
test('ordinary tricks stay quiet and disconnected humans are never impersonated',()=>{
  const r=room(),s=state();react(r,{...s,last_trick:[0,1,2,3]},1000);assert.equal(r.chat.length,0);
  r.players.push({index:1,uid:'away',status:'disconnected'});react(r,s,2000);assert.equal(r.chat.length,0);
  react(r,{...s,round:1},3000);assert.equal(r.chat.length,0);
});
test('failed king receives a comic blast and bot successes can receive applause',()=>{
  const r=room(),s={...state(),phase:'round_end',king:0,last_trick:[0,1,2,3],results:[{player:0,change:-5}]};
  react(r,s,1000);assert.equal(r.chat[0].text,'💥 0');
  const fresh=room();react(fresh,{...s,results:[{player:1,change:2}]},1000);assert.equal(fresh.chat[0].text,'👏');
  assert.equal(fresh.chat[0].bot,true);
});


test('old bot reactions expire from replies while human chat remains',()=>{
  const {reply}=require('../service'),r=room();
  r.createdAt=r.updatedAt=r.expiresAt={toMillis:()=>0};
  r.chat=[{bot:true,at:1000,text:'👏'},{at:1000,text:'hello',uid:'human'}];
  assert.equal(reply(r,null,'human',11000).room.chat.length,2);
  assert.equal(reply(r,null,'human',11001).room.chat.length,1);
});
