import * as api from './api.mjs';
import {emptyState, advanceCards} from './core.mjs';
import {bracketPreview} from './bracket.mjs';
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let state = emptyState(), editor = false, busy = false, loaded = false, total = 0, page = 0, historySerial = 0, toastTimer;
let currentTab = 'board', modalVersion = 0;
let historyRows = new Map();
const displayRound = () => state.roundLabel ?? state.round;
const noteField = (value='') => `<label>Note / comment <span class="muted">(optional)</span><textarea name="note" rows="4" maxlength="10000" placeholder="Add any context, story, or comment…">${esc(value)}</textarea></label>`;
const name = id => state.players[id]?.name || 'Unknown player';
const initials = str => [...str.trim()].slice(0,2).join('').toUpperCase();
const activeOptions = () => state.cards.flat().map(id=>`<option value="${esc(id)}">${esc(name(id))}</option>`).join('');
const options = () => Object.values(state.players).map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
function toast(message, failure=false) { clearTimeout(toastTimer); $('toast').textContent=message; $('toast').classList.toggle('failure',failure); $('toast').hidden=false; toastTimer=setTimeout(()=>$('toast').hidden=true,6000); }
function render() {
  const openMenu=$('cards').querySelector('details[open]')?.dataset.menuCard;
  $('round-number').textContent=String(displayRound()).padStart(2,'0');
  const paired=state.cards.filter(c=>c.length===2).length, completed=Object.keys(state.results).length+Object.keys(state.skipped||{}).length;
  $('round-status').textContent=paired && completed===paired ? 'Ready for the next round' : 'In play · always ongoing';
  $('player-count').textContent=state.cards.flat().length;
  $('card-count').textContent=state.cards.length;
  $('match-count').textContent=total;
  $('completed-count').textContent=`${completed} / ${paired}`;
  $('progress').style.width=`${paired ? completed/paired*100 : 0}%`;
  $('auth').textContent=api.demo ? 'Local demo' : editor ? 'Log out' : 'Organizer login';
  $('auth').disabled=api.demo || busy;
  $('add-player').hidden=!editor; $('extra-match').hidden=!editor; $('round-tools').hidden=!editor;$('round-tools').disabled=busy;
  $('advance').hidden=!editor; $('advance').disabled=busy || !paired || completed!==paired;
  $('add-player').disabled=busy; $('extra-match').disabled=busy || Object.keys(state.players).length<2;
  $('board-hint').textContent=editor ? 'Record a winner or skip each card. Edit or delete a mistaken pairing using its controls.' : 'Results are public. Organizers can sign in to record a winner.';
  const currentCards=state.cards.map((card,i)=>{
    const selected=state.results[i], solo=card.length===1, skipped=!!state.skipped?.[i], top=i===0, bottom=i===state.cards.length-1, holdsUp=top||state.skipped?.[i-1], holdsDown=bottom||state.skipped?.[i+1];
    return `<article class="card ${top?'top':''}" data-current-card="${i}"><div class="card-header"><strong>CARD ${String(i+1).padStart(2,'0')}${top?' · TOP CARD':''}</strong><span class="pill ${selected?'green':''}">${skipped?'SKIPPED THIS ROUND':solo?'BYE':selected?'RESULT SAVED':'IN PLAY'}</span></div>${card.map((id,seat)=>{
      const p=state.players[id], won=selected===id;
      return `<button class="match-player ${won?'winner':''}" data-card="${i}" data-player="${esc(id)}" ${!editor||busy||solo||skipped?'disabled':''} aria-label="${esc(solo?p.name+' has a bye':p.name+(won?' selected as winner':' wins card '+(i+1)))}" aria-pressed="${won}" title="${p.wins} W / ${p.losses} L"><span class="avatar">${i*2+seat+1}</span><span class="player-info"><span class="player-name">${esc(p.name)}</span><span class="record">${p.wins} W &nbsp; / &nbsp; ${p.losses} L</span></span><span class="result-label">${skipped?'SKIP':solo?'BYE':won?'W':selected?'L':editor?'Set':'—'}</span></button>`;
    }).join('')}${solo?'<div class="bye-slot">No opponent · no win or loss counted</div>':''}<div class="card-footer"><span>${skipped?'BOTH PLAYERS STAY':solo?(holdsUp?'BYE STAYS':'BYE ↑ ONE CARD'):holdsUp?'WINNER STAYS':'WINNER ↑ ONE CARD'}</span><span>${skipped?'ROUND BOUNDARY':solo?'NO SCORE COUNTED':holdsDown?'LOSER STAYS':'LOSER ↓ ONE CARD'}</span></div>${editor?`<details class="card-menu" data-menu-card="${i}"><summary aria-label="Manage Card ${i+1}" title="Manage card">⋯</summary><div class="card-controls"><button class="button small" data-card="${i}" data-action="edit_card" ${busy?'disabled':''}>Edit card</button><button class="button small danger" data-card="${i}" data-action="delete_card" ${busy?'disabled':''}>Delete card</button>${!solo?`<button class="button small" data-card="${i}" data-action="${skipped?'unskip':'skip'}" ${busy?'disabled':''}>${skipped?'Restore card':'Skip round'}</button>`:''}${selected?`<button class="button small" data-card="${i}" data-action="clear_result" ${busy?'disabled':''}>Undo result</button>`:''}</div></details>`:''}</article>`;
  });
  const preview=bracketPreview(state.cards,state.results,state.skipped||{});
  $('cards').innerHTML=currentCards.length ? `
    <div class="bracket-legend"><span><i class="legend-line up"></i> Winner moves up</span><span><i class="legend-line down"></i> Loser moves down</span><span><i class="legend-line stay"></i> Hold / boundary</span><span class="bracket-scroll-hint">Scroll sideways to explore →</span></div>
    <div class="bracket-scroller" tabindex="0" role="region" aria-label="Tournament bracket: current and next round. Scroll horizontally on narrow screens.">
      <div class="bracket-canvas">
        <svg id="bracket-lines" class="bracket-lines" aria-hidden="true"></svg>
        <div class="bracket-headings"><div><span class="round-kicker">ON THE TABLE</span><h3>Round ${displayRound()} <span class="round-label">CURRENT</span></h3></div><div class="flow-heading">THE NEXT DEAL →</div><div><span class="round-kicker">WHERE EVERYONE GOES</span><h3>Round ${displayRound()+1} <span class="round-label preview-label">PREVIEW</span></h3></div></div>
        ${currentCards.map((html,i)=>`<div class="bracket-row">${html}<article class="next-card"><div class="next-card-header"><span>CARD ${String(i+1).padStart(2,'0')}</span><span>${state.skipped?.[i]?'ON HOLD':i===0?'TOP CARD':'NEXT MATCHUP'}</span></div>${preview[i].map(slot=>{
          const known=!!slot.playerId;
          const source=`Card ${String(slot.sourceCard+1).padStart(2,'0')}`;
          const outcome=slot.role==='winner'?'Winner':slot.role==='loser'?'Loser':slot.role==='bye'?'Bye':'Skipped';
          const label=known?name(slot.playerId):`${outcome} of ${source}`;
          return `<div class="next-slot ${known?'known':'pending'} ${slot.movement}" data-source-card="${slot.sourceCard}" data-source-seat="${slot.sourceSeat??''}" data-source-role="${slot.role}" data-known="${known}" title="${outcome} · ${source}"><span class="slot-icon">${slot.role==='hold'?'Ⅱ':slot.movement==='up'?'↗':slot.movement==='down'?'↘':'→'}</span><span class="slot-info"><strong>${esc(label)}</strong><small>${outcome} · ${source}${slot.movement==='stay'?' · stays here':''}</small></span>${!known?'<span class="pending-dot" title="Awaiting result"></span>':''}</div>`;
        }).join('')}${preview[i].length===1?'<div class="preview-bye">Solo card · bye next round</div>':''}</article></div>`).join('')}
        <div class="bracket-bottom-note">Next-round seats fill in as results are recorded. Players move when the organizer starts the next round.</div>
      </div>
    </div>` : `<div class="empty"><span class="empty-bracket">↗</span><strong>The bracket starts here.</strong>${editor?'Add players in their starting order to deal the first cards.':'The tournament is waiting for its first players.'}</div>`;
  if(openMenu!==undefined){const menu=$('cards').querySelector(`[data-menu-card="${openMenu}"]`);if(menu)menu.open=true;}
  requestAnimationFrame(drawConnections);
  renderPlayers();
  const old=$('history-player').value;
  $('history-player').innerHTML='<option value="">All players</option>'+options();
  $('history-player').value=old;
}
function drawConnections(){
  const svg=$('bracket-lines');
  if(!svg || currentTab!=='board')return;
  const canvas=svg.parentElement,origin=canvas.getBoundingClientRect();
  if(!origin.width)return;
  svg.setAttribute('viewBox',`0 0 ${canvas.scrollWidth} ${canvas.scrollHeight}`);
  svg.setAttribute('width',canvas.scrollWidth);svg.setAttribute('height',canvas.scrollHeight);
  let paths='';
  canvas.querySelectorAll('.next-slot').forEach(slot=>{
    const source=canvas.querySelector(`[data-current-card="${slot.dataset.sourceCard}"]`);
    if(!source)return;
    const role=slot.dataset.sourceRole,seat=slot.dataset.sourceSeat;
    const sourcePlayer=seat!==''?source.querySelectorAll('.match-player')[Number(seat)]:null;
    const a=(sourcePlayer||source).getBoundingClientRect(),b=slot.getBoundingClientRect();
    const x1=a.right-origin.left+1,x2=b.left-origin.left-7;
    const y1=a.top-origin.top+a.height/2+(sourcePlayer?0:role==='winner'?-13:13),y2=b.top-origin.top+b.height/2;
    const movement=slot.classList.contains('up')?'up':slot.classList.contains('down')?'down':'stay';
    const lane=x1+(x2-x1)*(movement==='up'?.34:movement==='down'?.66:.5);
    const d=Math.abs(y1-y2)<2?`M ${x1} ${y1} H ${x2}`:`M ${x1} ${y1} H ${lane} V ${y2} H ${x2}`;
    paths+=`<path class="flow ${movement} ${slot.dataset.known==='true'?'confirmed':'unconfirmed'}" d="${d}" marker-end="url(#arrow-${movement})"/><circle class="flow-dot ${movement}" cx="${x1}" cy="${y1}" r="2.5"/>`;
  });
  svg.innerHTML=`<defs>${['up','down','stay'].map(type=>`<marker id="arrow-${type}" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto"><path class="arrow-${type}" d="M 0 0 L 8 4 L 0 8 Z"/></marker>`).join('')}</defs>${paths}`;
}
window.addEventListener('resize',()=>requestAnimationFrame(drawConnections));
if(typeof ResizeObserver!=='undefined')new ResizeObserver(()=>requestAnimationFrame(drawConnections)).observe($('cards'));
if(document.fonts)document.fonts.ready.then(()=>requestAnimationFrame(drawConnections));
function renderPlayers() {
  const query=$('player-search').value.trim().toLowerCase();
  const rows=state.cards.flatMap((card,i)=>card.map((id,j)=>({id,position:`Card ${i+1} · ${j+1}`})));
  const active=new Set(state.cards.flat());
  rows.push(...Object.keys(state.players).filter(id=>!active.has(id)).map(id=>({id,position:'Off ladder'})));
  $('players-body').innerHTML=rows.map(({id,position})=>{
    const p=state.players[id], matches=p.wins+p.losses;
    if(!p.name.toLowerCase().includes(query)) return '';
    return `<tr><td><span class="muted">${position}</span></td><td><span>${esc(p.name)}</span>${editor?` <button class="rename-button" data-rename="${esc(id)}" ${busy?'disabled':''} aria-label="Edit ${esc(p.name)} name">Edit name</button>`:''}</td><td class="wins">${p.wins}</td><td class="losses">${p.losses}</td><td>${matches?Math.round(p.wins/matches*100)+'%':'—'}</td></tr>`;
  }).join('') || '<tr><td colspan="5" class="muted">No players found.</td></tr>';
}
async function refresh({silent=false}={}) {
  if(busy) return;
  try {
    const [next,count,allowed]=await Promise.all([api.board(),api.matchCount(),api.canEdit()]);
    if(busy) return; // A write started while these reads were in flight.
    if(!loaded || next.version>=state.version) {state=next;total=count;editor=allowed;loaded=true;render();}
    if(!api.demo){$('mode-banner').hidden=true;$('mode-banner').classList.remove('error');}
    $('connection').textContent=api.demo?'Local demo':'● Connected';
    $('last-sync').textContent=api.demo?'Local demo · saved in this browser only':`Updated ${new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})} · refreshes every 15s`;
    if(!silent && currentTab==='history') await renderHistory();
  } catch(e) { $('connection').textContent='Offline · retrying'; if(!api.demo){$('mode-banner').hidden=false;$('mode-banner').classList.add('error');$('mode-banner').textContent='Could not refresh the tournament: '+e.message+' Displayed results may be out of date. Retrying every 15 seconds.';} if(!silent) toast(e.message,true); }
}
async function write(action,payload) {
  if(busy) throw Error('A change is already being saved.');
  busy=true;render();
  try {
    state=await api.mutate({...state, version:modalVersion},action,payload,crypto.randomUUID());
    // A successful mutation is never reported as failed due to a subsequent read failure.
    try{total=await api.matchCount();}catch{}
    render(); if(currentTab==='history') await renderHistory();
  } catch(e) { setTimeout(()=>refresh({silent:true}),0); throw e; }
  finally {busy=false;render();}
}
let submitAction;
function modal(title,content,label,handler) {
  $('modal-title').textContent=title; $('modal-content').innerHTML=content;
  $('modal-error').textContent=''; $('modal-submit').textContent=label; $('modal-submit').disabled=false;
  modalVersion=state.version; submitAction=handler; $('modal').showModal();
  setTimeout(()=>$('modal-content').querySelector('input, select, textarea')?.focus(),0);
}
function closeModal(){if(!$('modal-submit').disabled)$('modal').close();}
$('close-modal').onclick=closeModal; $('cancel-modal').onclick=closeModal;
$('modal').addEventListener('cancel',e=>{if($('modal-submit').disabled)e.preventDefault();});
$('modal-form').onsubmit=async e=>{
  e.preventDefault(); $('modal-submit').disabled=true; $('modal-error').textContent='';
  try {await submitAction(new FormData(e.target));$('modal').close();}
  catch(error){$('modal-error').textContent=error.message;}
  finally{$('modal-submit').disabled=false;}
};
$('auth').onclick=()=>{
  if(editor){api.logout().then(()=>{editor=false;render();toast('Logged out.');}).catch(e=>{editor=false;render();toast(e.message,true);});return;}
  modal('Organizer login','<p class="modal-copy">Sign in to add players and record results.</p><label>Email<input name="email" type="email" autocomplete="username" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label>','Sign in',async f=>{await api.login(f.get('email'),f.get('password'));editor=true;await refresh();toast('You can now edit the tournament.');});
};
$('add-player').onclick=()=>modal('A new challenger','<p class="modal-copy">The player joins the bottom card. Enter an off-ladder player’s existing name to bring them back with their record. Every active player keeps their position.</p><label>Player name<input name="name" maxlength="40" autocomplete="off" required placeholder="Enter a name"></label>','Add player',async f=>{await write('add',{name:f.get('name')});toast('Player added at the bottom.');});
$('cards').onclick=event=>{
  const button=event.target.closest('[data-card]'); if(!button || button.disabled) return;
  const card=Number(button.dataset.card);
  if(button.dataset.action){button.closest('details')?.removeAttribute('open');manageCard(button.dataset.action,card);return;}
  const winner=button.dataset.player;
  if(state.results[card]===winner)return;
  const correction=!!state.results[card];
  modal(correction?'Correct this result?':'Record card result',`<p class="confirm-match"><span class="wins">${esc(name(winner))}</span> wins</p><p class="modal-copy">${correction?'This replaces the current result, reverses its win and loss, and updates the same match in history.':'Save the winner to history. Counted matches add one win and one loss; ignored matches remain excluded. Players move when the round advances.'}</p>${correction?'<p class="modal-copy">Any existing note is kept. Edit it from match history.</p>':noteField()}`,'Save result',async f=>{await write('result',{card,winner,...(!correction?{note:f.get('note')}: {})});toast(correction?'Result corrected.':'Result saved.');});
};

function manageCard(action,card){
  const participants=state.cards[card];
  if(!participants)return;
  const number=String(card+1).padStart(2,'0');
  const pairing=participants.map(id=>esc(name(id))).join(' &amp; ');
  if(action==='edit_card'){
    modal(`Edit Card ${number}`,`<p class="modal-copy">Select the active players for this card. They swap places with its current players. Results and skips are cleared on every changed card; their recorded wins and losses are reversed. Past rounds and extra matches stay intact.</p>${participants.map((id,j)=>`<label>Seat ${j+1}<select name="seat${j}" id="edit-seat-${j}" required>${activeOptions()}</select></label>`).join('')}`,'Save pairing',async f=>{
      const players=participants.map((_,j)=>f.get('seat'+j));
      if(new Set(players).size!==players.length)throw Error('Choose a different player for each seat.');
      await write('edit_card',{card,players});toast('Pairing updated. Results on changed cards were cleared.');
    });
    participants.forEach((id,j)=>$('edit-seat-'+j).value=id);return;
  }
  const messages={
    delete_card:{title:`Delete Card ${number}?`,copy:`<strong>${pairing}</strong> will leave the active ladder. Their earlier records and past matches remain under Player records and Match history. Any result on this card in the current round is undone. Lower cards move up to close the gap.`,button:'Delete card',toast:'Card deleted. Player records retained off the ladder.'},
    clear_result:{title:`Undo Card ${number} result?`,copy:'Remove this round’s result and history entry, and reverse its win and loss. Both players stay on the card. You can record another result or skip it.',button:'Undo result',toast:'Result undone. Records updated.'},
    skip:{title:`Skip Card ${number} this round?`,copy:`<strong>${pairing}</strong> will stay on this card when the round advances, without a win or loss. Other cards cannot cross this card. Any result already saved for this card in this round is undone.`,button:'Skip this round',toast:'Card skipped. The rest of the round can continue.'},
    unskip:{title:`Restore Card ${number}?`,copy:'This card will need a winner again before the round advances. No wins or losses are added by restoring it.',button:'Restore card',toast:'Card restored. Pick a winner when ready.'},
  };
  const m=messages[action];if(!m)return;
  modal(m.title,`<p class="modal-copy">${m.copy}</p>`,m.button,async()=>{await write(action,{card});toast(m.toast);});
}

$('players-body').onclick=event=>{
  const button=event.target.closest('[data-rename]');if(!button||button.disabled)return;
  const player=button.dataset.rename;
  modal('Edit player name',`<p class="modal-copy">Update the name without changing their card, record, or match history. Existing history will display the corrected name.</p><label>Player name<input name="name" value="${esc(name(player))}" maxlength="40" required autocomplete="off"></label>`,'Save name',async f=>{await write('rename_player',{player,name:f.get('name')});toast('Player name updated.');});
};

$('round-tools').onclick=()=>{
  const count=Object.keys(state.results).length,skips=Object.keys(state.skipped||{}).length;
  modal('Manage round',`<label>Action<select name="tool" id="round-tool"><option value="set_round_number">Set round number</option><option value="clear_round">Clear this round’s card results</option><option value="rollback" ${state.canRollback?'':'disabled'}>Roll back one round${state.canRollback?'':' — no checkpoint yet'}</option></select></label><label id="round-number-field">Current round number<input name="number" type="number" id="new-round-number" min="1" max="1000000" step="1" value="${displayRound()}"></label><div id="round-tool-description" class="round-tool-description"></div>`,'Set round number',async f=>{
    const action=f.get('tool');
    const number=Number(f.get('number'));
    await write(action,action==='set_round_number'?{number}:{});
    toast(action==='rollback'?`Restored round ${displayRound()}.`:action==='clear_round'?'Card results and skips cleared. Extra matches retained.':`Round number set to ${displayRound()}.`);
  });
  const update=()=>{
    const action=$('round-tool').value,isNumber=action==='set_round_number';
    $('round-number-field').hidden=!isNumber;$('new-round-number').disabled=!isNumber;$('new-round-number').required=isNumber;
    const copy={
      set_round_number:'Change the current round’s displayed number (use 1 to restart the count). Pairings and scores stay the same. Current-round history labels update; earlier rounds remain intact, even if their numbers repeat.',
      clear_round:`Undo ${count} card result${count===1?'':'s'} and clear ${skips} skip${skips===1?'':'s'} in this round. Reverse those card wins/losses and remove their match entries. Keep current pairings, round number, earlier rounds, and all extra matches.`,
      rollback:'Restore the previous round exactly as it was before advancing, including its pairings, results, skips, and player records. Discard all changes made since that advance, including matches, added players, and pairing edits in the current round. You can then correct the restored round and advance again.',
    };
    $('round-tool-description').textContent=copy[action];
    $('modal-submit').textContent=action==='rollback'?'Roll back round':action==='clear_round'?'Clear card results':'Set round number';
  };
  $('round-tool').onchange=update;update();
};

$('advance').onclick=()=>{
  const next=advanceCards(state.cards,state.results,state.skipped||{});
  modal('Deal the next round',`<p class="modal-copy">Every paired card is resolved or skipped. Skipped players stay, and nobody crosses their card. Move the remaining winners up and losers down to start round ${displayRound()+1}. This saves a rollback checkpoint for the current round.</p><p class="modal-copy">Next top card: <strong>${next[0].map(id=>esc(name(id))).join(' &amp; ')}</strong></p>`,'Start next round',async()=>{await write('advance',{});toast(`Round ${displayRound()} is ready.`);});
};
$('extra-match').onclick=()=>{
  modal('Record an extra match',`<p class="modal-copy">Adds one win and one loss. Card positions stay the same.</p><label>Player one<select name="one" id="extra-one" required>${options()}</select></label><label>Player two<select name="two" id="extra-two" required>${options()}</select></label><label>Who won?<select name="winner" id="extra-winner" required></select></label>${noteField()}`,'Record match',async f=>{
    const one=f.get('one'),two=f.get('two'),winner=f.get('winner');
    if(one===two)throw Error('Choose two different players.');
    if(![one,two].includes(winner))throw Error('Choose the winner.');
    await write('extra',{winner,loser:winner===one?two:one,note:f.get('note')});toast('Extra match recorded.');
  });
  $('extra-two').selectedIndex=1;
  const update=()=>{$('extra-winner').innerHTML='<option value="">Choose winner…</option>'+[$('extra-one').value,$('extra-two').value].map(id=>`<option value="${esc(id)}">${esc(name(id))}</option>`).join('');};
  $('extra-one').onchange=update;$('extra-two').onchange=update;update();
};
async function renderHistory() {
  const serial=++historySerial;
  $('history-list').innerHTML='<p class="muted">Loading matches…</p>';
  try {
    const rows=await api.matches({page,player:$('history-player').value,kind:$('history-kind').value,status:$('history-status').value,limit:50});
    if(serial!==historySerial)return;
    historyRows=new Map(rows.map(m=>[m.id,m]));
    $('history-list').innerHTML=rows.map(m=>`<article class="history-row ${m.ignored?'ignored-match':''}"><span class="match-icon">${m.ignored?'–':'↗'}</span><div class="history-main"><p><b class="wins">${esc(name(m.winner_id))}</b><em>defeated</em><b>${esc(name(m.loser_id))}</b>${m.ignored?'<span class="ignored-badge">Ignored · no W/L</span>':''}</p><small>${m.kind==='card'?`Round ${m.round_label??m.round} · Card ${m.card+1}`:`Extra match · during round ${m.round_label??m.round}`}${m.updated_at!==m.played_at?' · updated':''}</small>${m.note?`<p class="match-note">${esc(m.note)}</p>`:''}</div><time class="history-time" datetime="${esc(m.played_at)}">${esc(new Date(m.played_at).toLocaleString([], {dateStyle:'medium',timeStyle:'short'}))}</time>${editor?`<details class="history-menu"><summary aria-label="Manage match: ${esc(name(m.winner_id))} vs ${esc(name(m.loser_id))}" title="Manage match">⋯</summary><div><button data-match="${esc(m.id)}" data-history-action="history_note">${m.note?'Edit note':'Add note'}</button><button data-match="${esc(m.id)}" data-history-action="history_edit">Edit result</button><button data-match="${esc(m.id)}" data-history-action="history_ignore">${m.ignored?'Restore to records':'Ignore for records'}</button><button class="danger" data-match="${esc(m.id)}" data-history-action="history_delete">Delete match</button></div></details>`:''}</article>`).join('') || '<div class="empty"><strong>No matches here yet.</strong>Recorded results will appear here.</div>';
    $('previous').disabled=page===0; $('next').disabled=rows.length<50; $('page-label').textContent=`Page ${page+1}`;
  }catch(e){if(serial!==historySerial)return;$('history-list').innerHTML=`<p class="error">${esc(e.message)}</p>`;}
}
$('history-list').onclick=event=>{
  const button=event.target.closest('[data-history-action]');if(!button||!editor||busy)return;
  button.closest('details')?.removeAttribute('open');
  const m=historyRows.get(button.dataset.match);if(!m){toast('Refresh history and try again.',true);return;}
  const action=button.dataset.historyAction;
  const pair=`${esc(name(m.winner_id))} vs ${esc(name(m.loser_id))}`;
  const isCurrent=m.kind==='card'&&m.round===state.round;
  if(action==='history_note'){
    modal(m.note?'Edit match note':'Add match note',`<p class="confirm-match">${pair}</p><p class="modal-copy">Write anything you want to remember about this match. Notes are public. Leave it empty to remove it; scores and outcomes stay the same.</p>${noteField(m.note||'')}`,'Save note',async f=>{await write(action,{match:m.id,note:f.get('note')});toast('Match note saved.');});
  }else if(action==='history_edit'){
    modal('Edit match result',`<p class="confirm-match">${pair}</p><p class="modal-copy">Choose the corrected winner from these two players. ${m.ignored?'This match stays ignored and will not affect wins or losses.':'The old win/loss will be reversed and the corrected result counted.'} ${isCurrent?'The current card winner and next-round preview will update.':'Current ladder positions will stay as they are.'} If the participants were wrong, delete this entry and record the correct match.</p><label>Winner<select name="winner" required>${[m.winner_id,m.loser_id].map(id=>`<option value="${esc(id)}">${esc(name(id))}</option>`).join('')}</select></label>`,'Save result',async f=>{await write(action,{match:m.id,winner:f.get('winner')});toast('Match result corrected.');});
  }else if(action==='history_ignore'){
    const ignored=!m.ignored;
    modal(ignored?'Ignore this match?':'Restore this match to records?',`<p class="confirm-match">${pair}</p><p class="modal-copy">${ignored?'Keep the match visible in history, but remove its win and loss from player records.':'Count the recorded winner’s win and opponent’s loss again.'} Card outcomes and ladder positions stay intact. Saved round checkpoints will also reflect this change.</p>`,ignored?'Ignore match':'Restore to records',async()=>{await write(action,{match:m.id,ignored});toast(ignored?'Match ignored. Removed from W/L totals.':'Match restored to W/L totals.');});
  }else if(action==='history_delete'){
    modal('Delete this match?',`<p class="confirm-match">${pair}</p><p class="modal-copy">Permanently remove this history entry.${m.ignored?' It is ignored, so no additional score adjustment is needed.':' Its win and loss will be reversed.'} ${isCurrent?'This clears the current card’s result; record a new winner or skip it before advancing.':'Today’s card positions will stay as they are.'} Saved rollback checkpoints will be corrected too. This deletion cannot be undone.</p>`,'Delete match',async()=>{await write(action,{match:m.id});toast('Match deleted. Records updated.');});
  }
};
$('previous').onclick=()=>{if(page>0){page--;renderHistory();}};$('next').onclick=()=>{page++;renderHistory();};
for(const id of ['history-player','history-kind','history-status'])$(id).onchange=()=>{page=0;renderHistory();};
$('refresh-history').onclick=()=>refresh();$('player-search').oninput=renderPlayers;
$('export').onclick=async()=>{
  const btn=$('export');btn.disabled=true;
  try{
    const rows=[];for(let p=0;;p++){const batch=await api.matches({page:p,limit:500,player:$('history-player').value,kind:$('history-kind').value,status:$('history-status').value});rows.push(...batch);if(batch.length<500)break;}
    const cell=x=>'"'+String(x??'').replace(/^[=+\-@\t\r]/,"'$&").replace(/"/g,'""')+'"';
    const csv=[['Match ID','Type','Note','Counts toward record','Round','Round sequence','Card','Winner','Loser','Played at','Updated at'],...rows.map(m=>[m.id,m.kind,m.note||'',m.ignored?'No':'Yes',m.round_label??m.round,m.round,m.card===null?'':m.card+1,name(m.winner_id),name(m.loser_id),m.played_at,m.updated_at])].map(row=>row.map(cell).join(',')).join('\r\n');
    const url=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='fatass-friday-match-history.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast(`Exported ${rows.length} matches.`);
  }catch(e){toast(e.message,true);}finally{btn.disabled=false;}
};
function tab(){currentTab=['board','players','history','guide'].includes(location.hash.slice(1))?location.hash.slice(1):'board';document.querySelectorAll('.view').forEach(v=>v.hidden=v.id!==currentTab);document.querySelectorAll('[data-tab]').forEach(a=>{const active=a.dataset.tab===currentTab;a.classList.toggle('active',active);if(active)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});if(currentTab==='history'&&loaded)renderHistory();if(currentTab==='board')requestAnimationFrame(drawConnections);}
window.addEventListener('hashchange',tab);
window.addEventListener('storage',e=>{if(api.demo&&e.key==='endless-ladder-demo-v1')refresh();});
window.addEventListener('online',()=>refresh());
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
const title=window.LADDER_CONFIG?.title || 'FatASS Friday';$('brand-title').textContent=title;document.title=title;
if(api.demo){$('mode-banner').hidden=false;$('mode-banner').textContent='LOCAL DEMO · Changes are saved only in this browser. Connect Supabase in config.js to share a public tournament with password-protected editing.';}
tab();await refresh();setInterval(()=>{if(!document.hidden)refresh({silent:currentTab!=='history'});},15000);
