'use strict';
// Server implementation of scripts/tarneeb_rules.gd. Card IDs and scoring are identical.
const {randomInt} = require('node:crypto');
const BIDS = [2,3,4,5,7,8,9,10];
const suit = c => Math.floor(c / 13);
const rank = c => c % 13 + 2;
const cardName = c => ['2','3','4','5','6','7','8','9','10','J','Q','K','A'][c % 13] + ['♥','♠','♦','♣'][suit(c)];
const clone = x => structuredClone(x);
const sortHand = h => h.sort((a,b) => suit(a)-suit(b) || rank(b)-rank(a));
const beats = (a,b) => (suit(a)===0 && suit(b)!==0) || (suit(a)===suit(b) && rank(a)>rank(b));
function start(names, mode, target, difficulty=1) {
  const s = {names,mode,target,difficulty,count:4,scores:[0,0,0,0],team_scores:[0,0],round:0,dealer:randomInt(4),winner:-1,history:[],revision:0,message:''};
  nextRound(s); return s;
}
function nextRound(s) {
  s.round++; s.dealer=(s.dealer+1)%4; s.current=(s.dealer+1)%4; s.lead=s.current;
  Object.assign(s,{hands:[[],[],[],[]],bids:[0,0,0,0],taken:[0,0,0,0],trick:[-1,-1,-1,-1],last_trick:[-1,-1,-1,-1],last_winner:-1,played:[],exposed:[-1,-1,-1,-1],broken:false,tricks:0,trap:[-1,-1],round_start_scores:[...s.scores],results:[]});
  const deck=Array.from({length:52},(_,i)=>i);
  for(let i=51;i>0;i--){const j=randomInt(i+1);[deck[i],deck[j]]=[deck[j],deck[i]];}
  deck.forEach((c,i)=>s.hands[(s.dealer+1+i)%4].push(c));
  s.hands.forEach((h,p)=>{sortHand(h);s.exposed[p]=h[randomInt(13)];});
  s.phase=s.round===1?'playing':'swapping'; s.king=0;
  for(let p=1;p<4;p++) if(s.scores[p]>s.scores[s.king]) s.king=p;
  if(s.phase==='swapping') s.current=s.king;
  s.message=s.round===1?'الجولة الأولى • كل لمّة بنقطة':'الكنق يختار تبديل ورقته المكشوفة'; s.revision++;
}
function bids(s,p){const total=s.bids.reduce((n,b,i)=>n+(i===s.dealer?0:b),0);return BIDS.filter(b=>p!==s.dealer || (total+b>=11 && total+b!==13));}
function legal(s,p){
  if(!Number.isInteger(p)||p<0||p>3) return [];
  const hand=s.hands[p];
  if(s.trick[s.lead]===-1){const other=hand.filter(c=>suit(c)!==0);return !s.broken&&other.length?other:[...hand];}
  const following=hand.filter(c=>suit(c)===suit(s.trick[s.lead]));return following.length?following:[...hand];
}
function trickWinner(s){let w=s.lead;if(s.trick[w]===-1)return -1;for(let p=0;p<4;p++)if(s.trick[p]>=0&&beats(s.trick[p],s.trick[w]))w=p;return w;}
function act(s,p,action,value){
  if(!Number.isInteger(p)||p<0||p>3||p!==s.current||s.winner>=0||!Number.isInteger(value))return false;
  if(action==='swap'){
    if(s.phase!=='swapping'||value< -1||value>3||value===p)return false;
    if(value>=0){const a=s.exposed[p],b=s.exposed[value];s.hands[p][s.hands[p].indexOf(a)]=b;s.hands[value][s.hands[value].indexOf(b)]=a;s.exposed[p]=b;s.exposed[value]=a;sortHand(s.hands[p]);sortHand(s.hands[value]);s.message=`${s.names[p]} بدّل ${cardName(a)} مع ${s.names[value]}`;}
    else s.message=`${s.names[p]} احتفظ بورقته`;
    s.phase='bidding';s.current=(s.dealer+1)%4;
  }else if(action==='bid'){
    if(s.phase!=='bidding'||!bids(s,p).includes(value))return false;
    s.bids[p]=value;s.current=(p+1)%4;s.message=`${s.names[p]} طلب ${value}`;
    if(s.bids.every(b=>b>0)){s.phase='playing';s.current=(s.dealer+1)%4;s.lead=s.current;}
  }else if(action==='play'){
    if(s.phase!=='playing'||!legal(s,p).includes(value))return false;
    s.hands[p].splice(s.hands[p].indexOf(value),1);s.trick[p]=value;
    if(s.exposed[p]===value)s.exposed[p]=-1;if(suit(value)===0)s.broken=true;
    s.message=`${s.names[p]} لعب ${cardName(value)}`;
    if(s.trick.every(c=>c>=0)){s.phase='collecting';s.last_winner=trickWinner(s);s.message=`اللمّة لـ ${s.names[s.last_winner]}`;}else s.current=(p+1)%4;
  }else return false;
  s.revision++;return true;
}
function scoreBid(b,t,first,teams){if(first)return t;if(t<b)return -b;if(b>=(teams?11:7))return b*3;if(b>=(teams?9:5))return b*2;return b;}
function matchWinner(s){
  if(s.mode==='Teams'){
    if(s.team_scores[0]>=s.target)return s.team_scores[0]>s.team_scores[1]?0:1;
    if(s.team_scores[1]>=s.target||s.team_scores[0]<=-s.target)return 1;
    if(s.team_scores[1]<=-s.target)return 0;
  }else for(let p=0;p<4;p++)if(Math.abs(s.scores[p])>=s.target){let best=s.scores[p]>=s.target?p:(p===0?1:0);for(let i=0;i<4;i++)if(s.scores[i]>s.scores[best])best=i;return best;}
  return -1;
}
function finish(s){
  s.phase='round_end';s.results=[];
  if(s.mode==='Teams'){
    for(let p=0;p<2;p++){const b=s.bids[p]+s.bids[p+2],t=s.taken[p]+s.taken[p+2],c=scoreBid(b,t,s.round===1,true);s.team_scores[p]+=c;s.results.push({player:p,bid:b,taken:t,change:c,score:s.team_scores[p]});}
    for(let p=0;p<4;p++)s.scores[p]=s.team_scores[p%2];
  }else for(let p=0;p<4;p++){const c=scoreBid(s.bids[p],s.taken[p],s.round===1,false);s.scores[p]+=c;s.results.push({player:p,bid:s.bids[p],taken:s.taken[p],change:c,score:s.scores[p]});}
  s.history.push({round:s.round,results:clone(s.results)});s.history=s.history.slice(-30);s.winner=matchWinner(s);s.message=s.winner>=0?'انتهت المباراة':'اكتملت الجولة • راجع النتائج';
}
function collect(s){
  if(s.phase!=='collecting')return false;
  const w=trickWinner(s),q=s.trick.indexOf(10),a=s.trick.indexOf(12);
  if(s.round>1&&q>=0&&a>=0){s.trap=[a,q];s.scores[a]+=5;s.scores[q]-=5;if(s.mode==='Teams'){s.team_scores[a%2]+=5;s.team_scores[q%2]-=5;}s.message=`ورطة! ${s.names[a]} اصطاد بنت ${s.names[q]} • +5 / −5`;}
  s.taken[w]++;s.tricks++;s.last_trick=[...s.trick];s.played.push(...s.trick.filter(c=>c>=0));s.trick=[-1,-1,-1,-1];s.current=w;s.lead=w;s.phase='playing';if(s.tricks===13)finish(s);s.revision++;return true;
}
const swapValue=c=>c===10?-50:rank(c)+(suit(c)===0?20:0);
function ai(s,p){
  if(s.phase==='swapping'){let best=-1,v=swapValue(s.exposed[p]);for(let i=0;i<4;i++)if(i!==p&&swapValue(s.exposed[i])>v){best=i;v=swapValue(s.exposed[i]);}return {action:'swap',value:best};}
  if(s.phase==='bidding'){let estimate=0;const hearts=s.hands[p].filter(c=>suit(c)===0).length;for(const c of s.hands[p])estimate+=rank(c)===14?1.2:rank(c)===13?0.7:suit(c)===0&&rank(c)>=11?0.6:0;estimate+=Math.max(0,hearts-3)*0.8+(s.difficulty-1)*0.7;return {action:'bid',value:bids(s,p).reduce((a,b)=>Math.abs(b-estimate)<Math.abs(a-estimate)?b:a)};}
  let cards=legal(s,p);if(s.difficulty===0)return {action:'play',value:cards[randomInt(cards.length)]};cards.sort((a,b)=>swapValue(a)-swapValue(b));const w=trickWinner(s);
  if(s.difficulty===2){if(s.trick.includes(10)&&cards.includes(12))return {action:'play',value:12};if(cards.includes(10)&&!s.played.includes(12)&&cards.length>1)cards=cards.filter(c=>c!==10);}
  const better=w===-1?cards.find(c=>suit(c)!==0&&rank(c)===14):(s.mode!=='Teams'||w%2!==p%2)?cards.find(c=>beats(c,s.trick[w])):undefined;
  return {action:'play',value:better??cards[0]};
}
function view(s,p){const v=clone(s);delete v.hands;v.hand=[...s.hands[p]];v.hand_counts=s.hands.map(h=>h.length);v.seat=p;v.legal=s.phase==='playing'&&s.current===p?legal(s,p):[];v.available_bids=s.phase==='bidding'&&s.current===p?bids(s,p):[];return v;}
module.exports={start,nextRound,act,collect,ai,view,legal,bids,scoreBid,matchWinner,trickWinner};
