import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyState,reduce} from '../core.mjs';
const apply=(d,a,p={})=>reduce(d.state,d.history,a,p,crypto.randomUUID(),undefined,d.checkpoints||[]);
function fixture(){let d={state:emptyState(),history:[],checkpoints:[]};for(let i=0;i<6;i++)d=reduce(d.state,d.history,'add',{name:`P${i}`},String(i),undefined,d.checkpoints);return d;}
function finish(d){for(let i=0;i<d.state.cards.length;i++)if(d.state.cards[i].length===2)d=apply(d,'result',{card:i,winner:d.state.cards[i][0]});return d;}
function verifyStats(d){for(const p of Object.values(d.state.players)){assert.equal(p.wins,d.history.filter(m=>m.winner_id===p.id).length);assert.equal(p.losses,d.history.filter(m=>m.loser_id===p.id).length);}}
test('round numbering changes labels while preserving internal history identity',()=>{
  let d=fixture();d=apply(finish(d),'advance');d=apply(d,'result',{card:0,winner:d.state.cards[0][0]});
  const before=structuredClone(d);d=apply(d,'set_round_number',{number:1});
  assert.equal(d.state.round,2);assert.equal(d.state.roundLabel,1);assert.deepEqual(d.state.cards,before.state.cards);assert.deepEqual(d.state.players,before.state.players);
  assert.ok(d.history.filter(m=>m.round===1).every(m=>m.round_label===1));assert.ok(d.history.filter(m=>m.round===2).every(m=>m.round_label===1));
  d=apply(finish(d),'advance');assert.equal(d.state.round,3);assert.equal(d.state.roundLabel,2);verifyStats(d);
});
test('clear round removes card scores and skips but preserves extras and earlier rounds',()=>{
  let d=fixture();d=apply(finish(d),'advance');d=apply(d,'extra',{winner:'0',loser:'1'});d=apply(d,'result',{card:0,winner:d.state.cards[0][0]});d=apply(d,'skip',{card:1});
  const cards=structuredClone(d.state.cards);d=apply(d,'clear_round');
  assert.deepEqual(d.state.cards,cards);assert.deepEqual(d.state.results,{});assert.deepEqual(d.state.skipped,{});assert.equal(d.history.length,4);assert.equal(d.history.filter(m=>m.round===2&&m.kind==='extra').length,1);verifyStats(d);
});
test('rollback restores completed round, deletes subsequent matches and added players, and keeps versions monotonic',()=>{
  let d=finish(fixture());const checkpoint=structuredClone(d);
  d=apply(d,'advance');assert.equal(d.state.canRollback,true);d=apply(d,'add',{name:'New player'});d=apply(d,'extra',{winner:'0',loser:'1'});d=apply(d,'result',{card:0,winner:d.state.cards[0][1]});d=apply(d,'set_round_number',{number:88});const currentVersion=d.state.version;
  d=apply(d,'rollback');assert.deepEqual(d.state,{...checkpoint.state,version:currentVersion+1,canRollback:false});assert.deepEqual(d.history,checkpoint.history);assert.deepEqual(d.checkpoints,[]);verifyStats(d);
});
test('rollback can traverse multiple checkpoints and re-advance without duplicate results',()=>{
  let d=fixture();for(let i=0;i<3;i++)d=apply(finish(d),'advance');assert.equal(d.state.round,4);
  d=apply(d,'rollback');assert.equal(d.state.round,3);assert.equal(d.state.canRollback,true);verifyStats(d);
  d=apply(d,'clear_round');d=apply(finish(d),'advance');assert.equal(d.state.round,4);assert.equal(d.history.length,9);verifyStats(d);
  d=apply(d,'rollback');d=apply(d,'rollback');d=apply(d,'rollback');assert.equal(d.state.round,1);assert.equal(d.state.canRollback,false);verifyStats(d);
  assert.throws(()=>apply(d,'rollback'),/No saved round/);
});
test('skips and edits are restored exactly by rollback',()=>{
  let d=fixture();d=apply(d,'skip',{card:1});d=apply(d,'result',{card:0,winner:'0'});d=apply(d,'result',{card:2,winner:'5'});const old=structuredClone(d);d=apply(d,'advance');d=apply(d,'edit_card',{card:0,players:[d.state.cards[2][0],d.state.cards[0][1]]});d=apply(d,'delete_card',{card:1});d=apply(d,'rollback');assert.deepEqual(d.state.cards,old.state.cards);assert.deepEqual(d.state.skipped,old.state.skipped);assert.deepEqual(d.state.results,old.state.results);verifyStats(d);
});
test('legacy board can reset label but cannot invent a past checkpoint',()=>{
  let d=fixture();delete d.state.roundLabel;delete d.state.canRollback;d.state.round=42;
  assert.throws(()=>apply(d,'rollback'),/No saved round/);d=apply(d,'set_round_number',{number:1});assert.equal(d.state.roundLabel,1);assert.equal(d.state.round,42);d=apply(finish(d),'advance');assert.equal(d.state.canRollback,true);d=apply(d,'rollback');assert.equal(d.state.round,42);assert.equal(d.state.roundLabel,1);
});
test('invalid round numbers and failed actions leave all state/checkpoints untouched',()=>{
  const d=apply(finish(fixture()),'advance'),copy=structuredClone(d);
  for(const number of [0,-1,1.5,1000001,'2',null,NaN])assert.throws(()=>apply(d,'set_round_number',{number}),/round number/);
  assert.deepEqual(d,copy);
});
test('repeated counter resets do not collide with earlier card matches',()=>{
  let d=fixture();for(let i=0;i<5;i++){d=apply(d,'set_round_number',{number:1});d=apply(finish(d),'advance');}assert.equal(d.state.round,6);assert.equal(d.state.roundLabel,2);assert.equal(d.history.length,15);assert.ok(d.history.every(m=>m.round_label===1));assert.equal(new Set(d.history.map(m=>`${m.round}:${m.card}`)).size,15);verifyStats(d);
});

test('rename fixes names without changing identity, records, positions, or history',()=>{let d=finish(fixture());const before=structuredClone(d);d=apply(d,'rename_player',{player:'0',name:'Corrected name'});assert.equal(d.state.players['0'].name,'Corrected name');assert.equal(d.state.players['0'].wins,1);assert.deepEqual(d.state.cards,before.state.cards);assert.deepEqual(d.history,before.history);assert.throws(()=>apply(d,'rename_player',{player:'0',name:'P1'}),/already/);assert.throws(()=>apply(d,'rename_player',{player:'missing',name:'Name'}),/not found/);});
