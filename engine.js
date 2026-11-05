'use strict';
// Server implementation of scripts/tarneeb_rules.gd. Card IDs and scoring are identical.
const {randomInt} = require('node:crypto');
const BIDS = Array.from({length:14},(_,i)=>i);
const QUEEN = 10, ACE = 12;
const suit = c => Math.floor(c / 13);
const rank = c => c % 13 + 2;
const cardName = c => ['2','3','4','5','6','7','8','9','10','الكوال','المجيرة','الري','A'][c % 13] + ' ' + ['♥','♠','♦','♣'][suit(c)];
const clone = x => structuredClone(x);
const sortHand = h => h.sort((a,b) => suit(a)-suit(b) || rank(b)-rank(a));
const beats = (a,b) => (suit(a)===0 && suit(b)!==0) || (suit(a)===suit(b) && rank(a)>rank(b));
function start(names, target, difficulty=1) {
  const s = {names,mode:'FFA',target,difficulty,count:4,scores:[0,0,0,0],round:0,dealer:randomInt(4),winner:-1,history:[],revision:0,message:''};
  nextRound(s); return s;
}
function nextRound(s) {
  s.round++; s.dealer=(s.dealer+1)%4; s.current=(s.dealer+1)%4; s.lead=s.current;
  Object.assign(s,{hands:[[],[],[],[]],bids:[-1,-1,-1,-1],taken:[0,0,0,0],trick:[-1,-1,-1,-1],last_trick:[-1,-1,-1,-1],last_winner:-1,played:[],exposed:[-1,-1,-1,-1],broken:false,tricks:0,trap:[-1,-1],round_start_scores:[...s.scores],results:[]});
  const deck=Array.from({length:52},(_,i)=>i);
  for(let i=51;i>0;i--){const j=randomInt(i+1);[deck[i],deck[j]]=[deck[j],deck[i]];}
  deck.forEach((c,i)=>s.hands[(s.dealer+1+i)%4].push(c));
  s.hands.forEach((h,p)=>{sortHand(h);s.exposed[p]=h[randomInt(13)];});
  s.phase=s.round===1?'playing':'swapping'; s.king=0;
  for(let p=1;p<4;p++) if(s.scores[p]>s.scores[s.king]) s.king=p;
  if(s.phase==='swapping') s.current=s.king;
  s.message=s.round===1?'الجولة الأولى • النقاط تبدأ من لمّتين':'الكنق يختار تبديل ورقته المكشوفة'; s.revision++;
}
function bids(s,p){
  const score=s.scores[p],minimum=score>=41?5:score>=31?4:score>=21?3:0;
  const others=s.bids.filter((_,i)=>i!==p), hasZero=others.includes(0);
  const total=others.reduce((n,b)=>n+Math.max(0,b),0);
  return BIDS.filter(b=>b>=minimum&&(b!==6||hasZero)
    &&(p!==s.dealer||hasZero||b===0||(total+b>=11&&total+b!==13)));
}
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
    if(s.bids.every(b=>b>=0)){s.phase='playing';s.current=(s.dealer+1)%4;s.lead=s.current;}
  }else if(action==='play'){
    if(s.phase!=='playing'||!legal(s,p).includes(value))return false;
    s.hands[p].splice(s.hands[p].indexOf(value),1);s.trick[p]=value;
    if(s.exposed[p]===value)s.exposed[p]=-1;if(suit(value)===0)s.broken=true;
    s.message=`${s.names[p]} لعب ${cardName(value)}`;
    if(s.trick.every(c=>c>=0)){s.phase='collecting';s.last_winner=trickWinner(s);s.message=`اللمّة لـ ${s.names[s.last_winner]}`;}else s.current=(p+1)%4;
  }else return false;
  s.revision++;return true;
}
function scoreBid(b,t,first){
  if(first)return t>=2?t:0;
  if(b===0)return t===0?5:-5;
  const points=b>=7&&b!==10?b*2:b;
  return t>=b?points:-points;
}
function matchWinner(s){
  if(!s.scores.some(score=>Math.abs(score)>=s.target))return -1;
  const highest=Math.max(...s.scores);
  return s.scores.indexOf(highest)===s.scores.lastIndexOf(highest)?s.scores.indexOf(highest):-1;
}
function finish(s,instant=-1){
  s.phase='round_end';s.results=[];
  for(let p=0;p<4;p++){
    const change=instant>=0&&instant!==p&&s.tricks<13?0:scoreBid(s.bids[p],s.taken[p],s.round===1);
    s.scores[p]+=change;s.results.push({player:p,bid:s.bids[p],taken:s.taken[p],change,score:s.scores[p]});
  }
  s.history.push({round:s.round,results:clone(s.results)});s.history=s.history.slice(-30);
  s.winner=instant>=0?instant:matchWinner(s);
  s.message=instant>=0?`${s.names[instant]} حسم المباراة بطلب ${s.bids[instant]}`:s.winner>=0?'انتهت المباراة':'اكتملت الجولة • راجع النتائج';
}
function collect(s){
  if(s.phase!=='collecting')return false;
  const w=trickWinner(s),q=s.trick.indexOf(QUEEN),a=s.trick.indexOf(ACE);
  if(s.round>1&&q>=0&&a>=0){s.trap=[a,q];s.scores[a]+=5;s.scores[q]-=5;s.message=`ورطة! ${s.names[a]} اصطاد مجيرة ${s.names[q]} • +5 / −5`;}
  s.taken[w]++;s.tricks++;s.last_trick=[...s.trick];s.played.push(...s.trick.filter(c=>c>=0));s.trick=[-1,-1,-1,-1];s.current=w;s.lead=w;s.phase='playing';
  if(s.bids[w]>=11&&s.taken[w]>=s.bids[w])finish(s,w);
  else if(s.tricks===13)finish(s);
  s.revision++;return true;
}
const strength=c=>rank(c)+(suit(c)===0?20:0);
const swapValue=c=>c===QUEEN?-50:strength(c);
function playValue(s,p,card,winner,leader,hand){
  const wins=winner<0||beats(card,s.trick[winner]);
  let next=wins?p:winner, best=wins?card:s.trick[winner];
  const lead=winner<0?card:s.trick[s.lead];
  // A revealed card in the led suit is a possible reply. Never inspect a rival hand.
  for(let seat=(p+1)%4;seat!==s.lead;seat=(seat+1)%4){
    const exposed=s.exposed[seat];
    if(exposed>=0&&suit(exposed)===suit(lead)&&beats(exposed,best)){next=seat;best=exposed;}
  }
  const nil=s.bids[p]===0&&s.taken[p]===0;
  const needsTricks=s.round===1||s.taken[p]<s.bids[p];
  let value=-strength(card)/20;
  if(next===p)value+=nil?-240:needsTricks?24:6;
  else if(s.round>1&&s.bids[next]===0&&s.taken[next]===0)value+=80;
  else if(s.bids[next]>=7&&s.taken[next]<s.bids[next])value-=40;
  else if(s.bids[next]>0&&s.taken[next]<s.bids[next])value-=8;
  if(next===leader&&leader!==p)value-=125;
  if(s.round>1&&card===ACE&&!s.played.includes(QUEEN)&&!hand.includes(QUEEN))
    value+=s.trick.includes(QUEEN)?(nil?120:260):-55;
  if(s.round>1&&card===QUEEN){
    if(s.trick.includes(ACE))value-=300;
    else if(s.played.includes(ACE)||hand.includes(ACE)||(p+1)%4===s.lead)value+=72;
    else value+=10;
  }
  return value;
}
function ai(s,p){
  if(s.phase==='swapping'){let best=-1,v=swapValue(s.exposed[p]);for(let i=0;i<4;i++)if(i!==p&&swapValue(s.exposed[i])>v){best=i;v=swapValue(s.exposed[i]);}return {action:'swap',value:best};}
  if(s.phase==='bidding'){let estimate=0;const hearts=s.hands[p].filter(c=>suit(c)===0).length;for(const c of s.hands[p])estimate+=rank(c)===14?1.2:rank(c)===13?0.7:suit(c)===0&&rank(c)>=11?0.6:0;estimate+=Math.max(0,hearts-3)*0.8+(s.difficulty-1)*0.7;return {action:'bid',value:bids(s,p).reduce((a,b)=>Math.abs(b-estimate)<Math.abs(a-estimate)?b:a)};}
  const hand=s.hands[p],cards=legal(s,p),winner=trickWinner(s);
  const leader=s.scores.indexOf(Math.max(...s.scores));
  const target=s.scores[leader]>s.scores[p]?leader:-1;
  let best=cards[0],bestValue=-Infinity;
  for(const card of cards){
    const value=playValue(s,p,card,winner,target,hand)+(s.difficulty===0?randomInt(8):0);
    if(value>bestValue){best=card;bestValue=value;}
  }
  return {action:'play',value:best};
}
function view(s,p){const v=clone(s);delete v.hands;v.hand=[...s.hands[p]];v.hand_counts=s.hands.map(h=>h.length);v.seat=p;v.legal=s.phase==='playing'&&s.current===p?legal(s,p):[];v.available_bids=s.phase==='bidding'&&s.current===p?bids(s,p):[];return v;}
module.exports={start,nextRound,act,collect,ai,view,legal,bids,scoreBid,matchWinner,trickWinner};
