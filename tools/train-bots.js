'use strict';
// Offline only: synthetic deals, no Firebase, network, player data or runtime imports.
const fs=require('node:fs');
const path=require('node:path');
const e=require('../engine');
const baseline=require('../bot-policy.json');
const fixtures=require('../test/fixtures/bot-strategy.json');

function seededRound(seed){
  let state=seed>>>0;
  const draw=n=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return Math.floor(state/4294967296*n);};
  const s=e.start(['A','B','C','D'],61,2),deck=Array.from({length:52},(_,i)=>i);
  for(let i=51;i>0;i--){const j=draw(i+1);[deck[i],deck[j]]=[deck[j],deck[i]];}
  s.dealer=draw(4);s.round=2;s.phase='swapping';s.scores=[0,0,0,0].map(()=>draw(6)*10);
  if(seed%4===0)s.scores=[20,20,20,20];
  s.round_start_scores=[...s.scores];s.king=e.selectKing(s.scores,s.dealer);s.current=s.king;s.lead=(s.dealer+1)%4;
  s.hands=Array.from({length:4},()=>[]);
  deck.forEach((c,i)=>s.hands[(s.dealer+1+i)%4].push(c));
  s.hands.forEach(h=>h.sort((a,b)=>Math.floor(a/13)-Math.floor(b/13)||b%13-a%13));
  s.exposed=s.hands.map(h=>h[draw(13)]);
  return s;
}

function evaluate(policy,seeds,limitMs=30000){
  const began=performance.now(),blocks=[];
  let decisions=0,totalMs=0,maxMs=0,denied=0,defences=0,gain=0;
  for(const seed of seeds){
    let block=0;
    for(let focal=0;focal<4;focal++){
      if(performance.now()-began>limitMs)throw Error('Training time budget exceeded; no policy promoted');
      const s=seededRound(seed),initial=[...s.scores],king=s.king;
      const opponent={...baseline,kingPressure:[120,180,240][seed%3]};
      let steps=0;
      while(s.phase!=='round_end'){
        if(++steps>80)throw Error('Round exceeded legal action bound');
        if(s.phase==='collecting'){if(!e.collect(s))throw Error('Collection failed');continue;}
        const p=s.current,t=performance.now();
        const action=e.ai({...s,bot_policy:p===focal?policy:opponent},p);
        const ms=performance.now()-t;totalMs+=ms;maxMs=Math.max(maxMs,ms);decisions++;
        if(!e.act(s,p,action.action,action.value))throw Error('Illegal bot action');
      }
      const delta=s.scores[focal]-initial[focal];gain+=delta;
      // Do not label an interrupted, unsettled king contract as a successful denial.
      const failed=s.bids[king]===0?s.taken[king]>0:s.bids[king]>0&&s.taken[king]<s.bids[king]&&s.tricks===13;
      if(focal!==king){defences++;denied+=Number(failed);}
      block+=delta+(focal!==king&&failed?2:0);
    }
    blocks.push(block/4);
  }
  return {blocks,meanGain:gain/(seeds.length*4),kingFailureRate:denied/Math.max(1,defences),decisions,meanDecisionMs:totalMs/decisions,maxDecisionMs:maxMs};
}

function compare(candidate,reference){
  const deltas=candidate.blocks.map((x,i)=>x-reference.blocks[i]),n=deltas.length;
  const mean=deltas.reduce((a,b)=>a+b,0)/n;
  const variance=deltas.reduce((sum,x)=>sum+(x-mean)**2,0)/Math.max(1,n-1);
  return {pairedMean:mean,lower95:mean-1.96*Math.sqrt(variance/n),upper95:mean+1.96*Math.sqrt(variance/n)};
}

function passesFixtures(policy){
  return fixtures.every(f=>JSON.stringify(e.ai({...f.before,bot_policy:policy},f.before.current))===JSON.stringify(f.expected));
}

function train(count=128){
  if(!Number.isInteger(count)||count<32||count>1000)throw Error('Use 32–1000 seeds to bound this offline job');
  const training=Array.from({length:count},(_,i)=>i+1),heldOut=training.map(i=>i+1000000);
  const reference=evaluate(baseline,training);
  let selected=baseline,best=0;
  const trials=[];
  for(const [pressure,master] of [[140,12],[220,12],[260,12],[180,18],[220,18]]){
    const policy={...baseline,version:`candidate-${pressure}-${master}`,kingPressure:pressure,preserveMaster:master};
    if(!passesFixtures(policy)){trials.push({policy,rejected:'strategic regression'});continue;}
    const result=evaluate(policy,training),comparison=compare(result,reference);
    trials.push({policy,comparison,kingFailureRate:result.kingFailureRate});
    if(comparison.pairedMean>best){best=comparison.pairedMean;selected=policy;}
  }
  const control=evaluate(baseline,heldOut),candidate=evaluate(selected,heldOut),comparison=compare(candidate,control);
  const approved=selected!==baseline&&comparison.lower95>0&&candidate.meanGain>=control.meanGain&&candidate.kingFailureRate>=control.kingFailureRate&&candidate.meanDecisionMs<1;
  return {schema:1,baseline,seedCount:count,trainingTrials:trials,selected,heldOut:{control,candidate,comparison},approved,
    note:'Synthetic independent rounds, four focal seats and three opponent pressure styles. Not a human win-rate. Never auto-deploy.'};
}

if(require.main===module){
  const count=Number(process.argv[2]||128),destination=process.argv[3];
  if(!destination)throw Error('Usage: node tools/train-bots.js [32..1000] /path/to/new-report.json');
  const report=train(count);
  fs.writeFileSync(path.resolve(destination),JSON.stringify(report,null,2),{flag:'wx'});
  console.log(JSON.stringify({approved:report.approved,selected:report.selected,validation:report.heldOut.comparison,output:path.resolve(destination)}));
}
module.exports={seededRound,evaluate,compare,passesFixtures,train};
