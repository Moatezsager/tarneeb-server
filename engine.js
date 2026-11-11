'use strict';
// Server implementation of scripts/tarneeb_rules.gd. Card IDs and scoring are identical.
const {randomInt} = require('node:crypto');
const BIDS = [0,2,3,4,5,7,8,9,10,11,12,13];
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
  const score=s.scores[p],scoreFloor=score>=41?5:score>=31?4:score>=21?3:0;
  const others=s.bids.filter((_,i)=>i!==p);
  const total=others.reduce((n,b)=>n+Math.max(0,b),0);
  const dealerFloor=p===s.dealer&&!others.includes(0)?11-total:0;
  return BIDS.filter(b=>b>=Math.max(scoreFloor,dealerFloor));
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
  const extended=instant<0&&s.scores.filter(score=>score>=s.target).length>1;
  if(extended)s.target+=10;
  s.winner=instant>=0?instant:extended?-1:matchWinner(s);
  s.message=extended?`دخلوا في الشوط • الهدف الجديد ${s.target}`:instant>=0?`${s.names[instant]} حسم المباراة بطلب ${s.bids[instant]}`:s.winner>=0?'انتهت المباراة':'اكتملت الجولة • راجع النتائج';
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
function publicKnowledge(s,p){
  const voids=Array.from({length:4},()=>[false,false,false,false]);
  const counts=[13,13,13,13];
  let lead=(s.dealer+1)%4;
  for(let i=0;i+3<s.played.length;i+=4){
    let winner=lead;
    const led=suit(s.played[i+lead]);
    for(let seat=0;seat<4;seat++){
      const card=s.played[i+seat];
      counts[seat]--;
      if(suit(card)!==led)voids[seat][led]=true;
      if(beats(card,s.played[i+winner]))winner=seat;
    }
    lead=winner;
  }
  if(s.trick[s.lead]>=0){
    const led=suit(s.trick[s.lead]);
    for(let seat=0;seat<4;seat++)if(s.trick[seat]>=0&&suit(s.trick[seat])!==led)voids[seat][led]=true;
  }
  const known=new Set([...s.hands[p],...s.played,...s.trick,...s.exposed]);
  const unseen=Array.from({length:52},(_,i)=>i).filter(c=>!known.has(c));
  return {voids,counts,unseen,outstanding:[...unseen,...s.exposed.filter((c,seat)=>seat!==p&&c>=0)]};
}
function noneOf(total,matches,draws){
  let probability=1;
  for(let i=0;i<Math.min(draws,total);i++)probability*=Math.max(0,total-matches-i)/(total-i);
  return probability;
}
function overtake(s,seat,card,led,info){
  const exposed=s.exposed[seat];
  const pool=info.unseen.filter(c=>!info.voids[seat][suit(c)]);
  const draws=Math.max(0,info.counts[seat]-(s.trick[seat]>=0?1:0)-(exposed>=0?1:0));
  const higher=pool.filter(c=>suit(c)===led&&beats(c,card)).length;
  const follows=exposed>=0&&suit(exposed)===led;
  const knownHigher=follows&&beats(exposed,card);
  const noSuit=info.voids[seat][led]?1:follows?0:noneOf(pool.length,pool.filter(c=>suit(c)===led).length,draws);
  const trumpCount=pool.filter(c=>suit(c)===0&&beats(c,card)).length;
  const knownTrump=exposed>=0&&suit(exposed)===0&&beats(exposed,card);
  const higherChance=knownHigher?1:1-noneOf(pool.length,higher,draws);
  const trumpChance=knownTrump?1:1-noneOf(pool.length,trumpCount,draws);
  return Math.min(1,higherChance+(led===0?0:noSuit*trumpChance));
}
function bidEstimate(hand,difficulty){
  let estimate=0;
  const hearts=hand.filter(c=>suit(c)===0).length;
  for(let type=0;type<4;type++){
    const cards=hand.filter(c=>suit(c)===type);
    const hasAce=cards.some(c=>rank(c)===14);
    for(const card of cards){
      const r=rank(card);
      if(type===0){
        if(r===14)estimate+=1;
        else if(r===13)estimate+=hasAce?0.9:0.65;
        else if(r>=11)estimate+=0.45;
      }else if(r===14)estimate+=0.85;
      else if(r===13)estimate+=hasAce?0.65:cards.length>1?0.3:0.1;
    }
    if(type!==0&&cards.length===0&&hearts>=3)estimate+=0.4;
  }
  return estimate+Math.max(0,hearts-3)*0.6+(difficulty===2?0.2:difficulty===0?-0.4:0);
}
function trickValue(s,p,seat,leader){
  if(s.round===1)return seat===p?(s.taken[p]===1?50:24):seat===leader?-60:-4;
  const bid=s.bids[seat],need=bid-s.taken[seat],remaining=13-s.tricks;
  if(bid===0&&s.taken[seat]===0)return seat===p?-260:seat===leader?160:80;
  if(need<=0||need>remaining)return seat===p?2:0;
  if(bid>=11&&need===1)return seat===p?500:-500;
  if(seat===p)return 30+60*need/remaining+(need===1?30:0);
  return -(need===1?35:8)-(bid>=7?20:0)-(seat===leader?100:0);
}
function playValue(s,p,card,winner,leader,hand,info){
  const wins=winner<0||beats(card,s.trick[winner]);
  let next=wins?p:winner, best=wins?card:s.trick[winner];
  const lead=winner<0?card:s.trick[s.lead];
  let survival=1,expected=trickValue(s,p,next,leader);
  // shortcut: independent reply estimates, use joint search only if measured play warrants its cost.
  for(let seat=(p+1)%4;seat!==s.lead;seat=(seat+1)%4){
    const threat=overtake(s,seat,best,suit(lead),info);
    survival*=1-threat;
    expected=expected*(1-threat)+trickValue(s,p,seat,leader)*threat;
  }
  const nil=s.bids[p]===0&&s.taken[p]===0;
  const needsTricks=s.round===1||s.taken[p]<s.bids[p];
  let value=expected-strength(card)/20;
  const remaining=13-s.tricks;
  const hearts=hand.filter(c=>suit(c)===0).length;
  const queenLive=!s.played.includes(QUEEN)&&!hand.includes(QUEEN)&&!s.trick.includes(QUEEN);
  // Save trumps when another player already denies the leader, but spend them to secure a contract.
  if(winner>=0&&suit(lead)!==0&&suit(card)===0&&card!==QUEEN)value-=10+rank(card)/2;
  if(!wins&&suit(card)!==0){
    value+=rank(card)/4;
    if(suit(card)!==suit(lead)&&hand.filter(c=>suit(c)===suit(card)).length===1)value+=6;
  }
  if(winner<0){
    const masters=info.outstanding.filter(c=>suit(c)===suit(card)&&beats(c,card)).length;
    if(masters===0&&card!==ACE)value+=needsTricks?14*survival:0;
    if(suit(card)===0&&hearts<=2&&masters>0)value-=12;
    if(s.round>1&&suit(card)===0&&hearts>=3&&hand.includes(ACE)&&queenLive&&card!==ACE&&!nil)value+=24;
    if(suit(card)===0&&hearts>=4&&masters===0&&needsTricks)value+=12;
  }
  if(s.round>1&&card===ACE&&!s.played.includes(QUEEN)&&!hand.includes(QUEEN)){
    const queenOwner=s.exposed.indexOf(QUEEN);
    const queenAhead=queenOwner>=0?s.trick[queenOwner]<0:winner<0;
    const forced=queenLive&&((queenAhead&&suit(lead)===0&&info.outstanding.filter(c=>suit(c)===0&&c!==QUEEN).length===0)||
      (queenOwner>=0&&s.trick[queenOwner]<0&&info.counts[queenOwner]===1));
    value+=s.trick.includes(QUEEN)||forced?(nil?120:260):remaining<=Math.max(2,s.bids[p]-s.taken[p])?0:-55;
  }
  if(s.round>1&&card===QUEEN){
    if(s.trick.includes(ACE))value-=300;
    else if(s.played.includes(ACE)||hand.includes(ACE)||(p+1)%4===s.lead)value+=72;
    else {
      const aceOwner=s.exposed.indexOf(ACE);
      let risk=0;
      for(let seat=(p+1)%4;seat!==s.lead;seat=(seat+1)%4){
        if(seat===aceOwner)risk=overtake(s,seat,QUEEN,suit(lead),info);
        else if(aceOwner<0&&!(s.exposed[seat]>=0&&suit(lead)!==0&&suit(s.exposed[seat])===suit(lead)))risk+=info.counts[seat]/Math.max(1,info.unseen.length);
      }
      value+=18-100*Math.min(1,risk);
    }
  }
  return value;
}
function ai(s,p){
  if(s.phase==='swapping'){
    let best=-1,value=swapValue(s.exposed[p]);
    for(let seat=0;seat<4;seat++){
      if(seat===p||s.exposed[seat]<0)continue;
      const estimate=swapValue(s.exposed[seat]);
      if(estimate>value){best=seat;value=estimate;}
    }
    return {action:'swap',value:best};
  }
  if(s.phase==='bidding'){
    const hand=s.hands[p],estimate=bidEstimate(hand,s.difficulty),available=bids(s,p);
    const safeNil=estimate<1.2&&hand.every(c=>rank(c)<12&&(suit(c)!==0||rank(c)<=7));
    const desired=safeNil?0:Math.max(2,Math.floor(estimate));
    return {action:'bid',value:available.reduce((a,b)=>b<=desired?b:a,available[0])};
  }
  const hand=s.hands[p],cards=legal(s,p),winner=trickWinner(s);
  const leader=s.scores.indexOf(Math.max(...s.scores));
  const target=s.scores[leader]>s.scores[p]?leader:-1;
  const info=publicKnowledge(s,p);
  let best=cards[0],bestValue=-Infinity;
  for(const card of cards){
    const value=playValue(s,p,card,winner,target,hand,info)+(s.difficulty===0?randomInt(8):0);
    if(value>bestValue){best=card;bestValue=value;}
  }
  return {action:'play',value:best};
}
function view(s,p){
  const v=clone(s);
  delete v.hands;
  v.hand_concealed=s.round>1&&p===s.king&&(s.phase==='swapping'||Boolean(s.presentation));
  v.hand=v.hand_concealed?[s.exposed[p]]:[...s.hands[p]];
  v.hand_counts=s.hands.map(h=>h.length);
  v.seat=p;
  v.legal=s.phase==='playing'&&s.current===p?legal(s,p):[];
  v.available_bids=s.phase==='bidding'&&s.current===p?bids(s,p):[];
  return v;
}
module.exports={start,nextRound,act,collect,ai,view,legal,bids,scoreBid,matchWinner,trickWinner};
