// Every next-round seat and its source. Unplayed matches use outcome placeholders.
// Unlike an elimination bracket, this ladder routes BOTH outcomes into another card.
export function bracketPreview(cards,results={},skipped={}){
  const next=cards.map(()=>[]);
  cards.forEach((card,i)=>{
    const send=(target,role,playerId,sourceSeat=null)=>next[target].push({
      sourceCard:i,sourceSeat,role,playerId:playerId||null,
      movement:target<i?'up':target>i?'down':'stay',
    });
    if(skipped[i]){card.forEach((id,seat)=>send(i,'hold',id,seat));return;}
    const winner=card.length===1?card[0]:results[i];
    const up=i===0||skipped[i-1]?i:i-1;
    const down=i===cards.length-1||skipped[i+1]?i:i+1;
    send(up,card.length===1?'bye':'winner',winner,winner?card.indexOf(winner):null);
    if(card.length===2){const loser=winner?card.find(id=>id!==winner):null;send(down,'loser',loser,loser?card.indexOf(loser):null);}
  });
  return next;
}
