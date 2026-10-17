// Local-demo rules. Supabase enforces the same actions independently in SQL.
export const emptyState = () => ({version:0,round:1,roundLabel:1,canRollback:false,players:{},cards:[],results:{},skipped:{}});
export function advanceCards(cards, results, skipped={}) {
  if (!cards.some(c=>c.length===2)) throw Error('Add at least two players before advancing.');
  const next=cards.map(()=>[]);
  cards.forEach((card,i)=>{
    if(skipped[i]){next[i]=[...card];return;}
    const winner=card.length===1?card[0]:results[i];
    if(!card.includes(winner))throw Error('Pick a winner or skip every paired card first.');
    const up=i===0||skipped[i-1]?i:i-1;
    const down=i===cards.length-1||skipped[i+1]?i:i+1;
    next[up].push(winner);
    if(card.length===2)next[down].push(card.find(p=>p!==winner));
  });
  return next.filter(c=>c.length);
}
export function reduce(state,history,action,data,id=crypto.randomUUID(),now=new Date().toISOString(),checkpoints=[]){
  let s=structuredClone(state);const h=structuredClone(history),saved=structuredClone(checkpoints);
  const currentVersion=s.version;
  s.skipped ??= {};s.roundLabel ??= s.round;
  const note=value=>{const text=value??'';if(typeof text!=='string'||[...text].length>10000)throw Error('Use a text note of up to 10,000 characters.');return text;};
  const player=p=>{if(!s.players[p])throw Error('Player not found.');return s.players[p];};
  const score=(w,l,delta)=>{player(w).wins+=delta;player(l).losses+=delta;};
  const requireCard=()=>{
    if(!Number.isInteger(data.card)||data.card<0||!s.cards[data.card])throw Error('Invalid card.');
    return s.cards[data.card];
  };
  const clearCard=i=>{
    const old=h.find(m=>m.kind==='card'&&m.round===s.round&&m.card===i);
    if(old){if(!old.ignored)score(old.winner_id,old.loser_id,-1);h.splice(h.indexOf(old),1);}
    delete s.results[i];delete s.skipped[i];
  };
  if(action==='history_note'){
    const m=h.find(m=>m.id===data.match);if(!m)throw Error('Match not found. Refresh history and try again.');
    m.note=note(data.note);m.updated_at=now;
  }else if(['history_edit','history_delete','history_ignore'].includes(action)){
    const index=h.findIndex(m=>m.id===data.match);
    if(index<0)throw Error('Match not found. Refresh history and try again.');
    const old=h[index];let next=null;
    if(action==='history_edit'){
      if(![old.winner_id,old.loser_id].includes(data.winner))throw Error('Choose one of the original two players as winner.');
      next={...old,winner_id:data.winner,loser_id:data.winner===old.winner_id?old.loser_id:old.winner_id,updated_at:now};
    }else if(action==='history_ignore'){
      if(typeof data.ignored!=='boolean')throw Error('Choose whether the match should count.');
      next={...old,ignored:data.ignored,updated_at:now};
    }
    const update=target=>{
      const change=(m,delta)=>{if(m&&!m.ignored){target.players[m.winner_id].wins+=delta;target.players[m.loser_id].losses+=delta;}};
      change(old,-1);change(next,1);
      if(old.kind==='card'&&target.round===old.round){
        if(next)target.results[old.card]=next.winner_id;else delete target.results[old.card];
      }
    };
    update(s);
    saved.forEach(c=>{if(c.state.round>=old.round)update(c.state);});
    if(next)h[index]=next;else h.splice(index,1);
  }else if(action==='rename_player'){
    const name=String(data.name||'').trim();player(data.player);
    if(!name||[...name].length>40)throw Error('Use a player name between 1 and 40 characters.');
    if(Object.values(s.players).some(p=>p.id!==data.player&&p.name.toLowerCase()===name.toLowerCase()))throw Error('That name is already in the tournament.');
    s.players[data.player].name=name;
  }else if(action==='add'){
    const name=String(data.name||'').trim();
    if(!name||[...name].length>40)throw Error('Use a player name between 1 and 40 characters.');
    const existing=Object.values(s.players).find(p=>p.name.toLowerCase()===name.toLowerCase());
    if(existing&&s.cards.flat().includes(existing.id))throw Error('That name is already in the tournament.');
    const joiningId=existing?.id||id;
    if(!existing)s.players[joiningId]={id:joiningId,name,wins:0,losses:0};
    if(s.cards.at(-1)?.length===1){delete s.skipped[s.cards.length-1];s.cards.at(-1).push(joiningId);}else s.cards.push([joiningId]);
  }else if(action==='result'){
    const card=requireCard();
    if(card.length!==2||!card.includes(data.winner))throw Error('Invalid card result.');
    if(s.skipped[data.card])throw Error('Restore this skipped card before recording a winner.');
    if(s.results[data.card]===data.winner&&!Object.hasOwn(data,'note'))return {state,history,checkpoints};
    const old=h.find(m=>m.kind==='card'&&m.round===s.round&&m.card===data.card);
    if(old){if(!old.ignored)score(old.winner_id,old.loser_id,-1);h.splice(h.indexOf(old),1);}
    const loser=card.find(p=>p!==data.winner);if(!old?.ignored)score(data.winner,loser,1);s.results[data.card]=data.winner;
    h.unshift({id:old?.id||id,note:Object.hasOwn(data,'note')?note(data.note):(old?.note||''),ignored:old?.ignored||false,kind:'card',round:s.round,round_label:s.roundLabel,card:data.card,winner_id:data.winner,loser_id:loser,played_at:old?.played_at||now,updated_at:now});
  }else if(action==='clear_result'){
    requireCard();clearCard(data.card);
  }else if(action==='skip'){
    const card=requireCard();if(card.length!==2)throw Error('Solo cards already have a bye.');
    clearCard(data.card);s.skipped[data.card]=true;
  }else if(action==='unskip'){
    requireCard();delete s.skipped[data.card];
  }else if(action==='edit_card'){
    const card=requireCard(),desired=data.players;
    if(!Array.isArray(desired)||desired.length!==card.length||new Set(desired).size!==desired.length||desired.some(p=>!s.cards.flat().includes(p)))throw Error('Choose different active players for each seat.');
    const original=structuredClone(s.cards);
    desired.forEach((p,j)=>{
      const source=s.cards.findIndex(c=>c.includes(p)),seat=s.cards[source].indexOf(p);
      [s.cards[data.card][j],s.cards[source][seat]]=[s.cards[source][seat],s.cards[data.card][j]];
    });
    s.cards.forEach((c,i)=>{if(JSON.stringify(c)!==JSON.stringify(original[i]))clearCard(i);});
  }else if(action==='delete_card'){
    requireCard();clearCard(data.card);s.cards.splice(data.card,1);
    for(const key of ['results','skipped'])s[key]=Object.fromEntries(Object.entries(s[key]).map(([i,v])=>[Number(i)>data.card?Number(i)-1:Number(i),v]));
    h.forEach(m=>{if(m.kind==='card'&&m.round===s.round&&m.card>data.card)m.card--;});
    // Player identities, earlier records, and earlier history remain available off the ladder.
  }else if(action==='extra'){
    player(data.winner);player(data.loser);
    if(data.winner===data.loser)throw Error('Choose two different players.');
    score(data.winner,data.loser,1);
    h.unshift({id,note:note(data.note),ignored:false,kind:'extra',round:s.round,round_label:s.roundLabel,card:null,winner_id:data.winner,loser_id:data.loser,played_at:now,updated_at:now});
  }else if(action==='set_round_number'){
    if(!Number.isInteger(data.number)||data.number<1||data.number>1000000)throw Error('Use a round number from 1 to 1,000,000.');
    s.roundLabel=data.number;
    h.forEach(m=>{if(m.round===s.round)m.round_label=data.number;});
  }else if(action==='clear_round'){
    s.cards.forEach((_,i)=>clearCard(i));
  }else if(action==='rollback'){
    if(!saved.length)throw Error('No saved round is available to roll back. Checkpoints start with the next round you advance.');
    s=saved.pop().state;
    for(let i=h.length-1;i>=0;i--)if(h[i].round>s.round)h.splice(i,1);
  }else if(action==='advance'){
    const next=advanceCards(s.cards,s.results,s.skipped);
    saved.push({state:structuredClone(s)});
    s.cards=next;s.results={};s.skipped={};s.round++;s.roundLabel++;
  }else throw Error('Unknown action.');
  s.version=currentVersion+1;s.canRollback=saved.length>0;return {state:s,history:h,checkpoints:saved};
}
