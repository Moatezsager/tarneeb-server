'use strict';

// Public outcomes only; one shared room budget prevents a chorus of bot taunts.
function react(room,state,now){
  const previous=room.botReaction||{},sameRound=previous.round===state.round;
  if(now-(previous.at??-Infinity)<45000||(sameRound&&previous.count>=2))return;
  const bots=(room.botSeats||[]).filter(seat=>!room.players.some(p=>p.index===seat));
  if(!bots.length)return;
  const trick=state.last_trick||[],ace=trick.indexOf(12),queen=trick.indexOf(10);
  let sender=-1,target=-1,text='';
  if(state.round>1&&ace>=0&&queen>=0&&bots.includes(ace)){
    sender=ace;target=queen;text=`🥊 ${target}`;
  }else if(state.round>1&&state.bids[state.lead]===0&&state.taken[state.lead]===1){
    target=state.lead;sender=bots.find(seat=>seat!==target)??-1;text='😏';
  }else if(state.phase==='round_end'){
    const failed=state.results?.find(r=>r.player===state.king&&r.change<0);
    if(failed){target=failed.player;sender=bots.find(seat=>seat!==target)??-1;text=`💥 ${target}`;}
    else if(bots.includes(state.lead)&&state.results?.some(r=>r.player===state.lead&&r.change>0)){sender=state.lead;text='👏';}
  }
  if(sender<0||target===sender)return;
  if(target>=0&&previous.target===target&&now-(previous.targetAt??-Infinity)<90000)return;
  room.botReaction={round:state.round,count:(sameRound?previous.count:0)+1,at:now,
    target:target>=0?target:(previous.target??-1),targetAt:target>=0?now:(previous.targetAt??0)};
  room.chat=[...(room.chat||[]),{id:`bot-${state.round}-${state.tricks}`,uid:`bot:${sender}`,
    bot:true,seat:sender,name:state.names[sender],text,at:now}].slice(-12);
}
module.exports={react};
