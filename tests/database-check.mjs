import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {reduce,emptyState} from '../core.mjs';
const {PGlite} = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const editor='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const outsider='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
await db.exec(`
  create role anon; create role authenticated;
  create schema auth;
  create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
  $$;
  insert into auth.users values('${editor}'),('${outsider}');
`);
const schema=await readFile(new URL('../supabase/setup.sql',import.meta.url),'utf8');
await db.exec(schema);
await db.exec(schema); // Re-run must preserve an existing initialized board.
await db.exec(`insert into ladder_private.editors values('${editor}');`);
const current=async()=> (await db.query('select state from public.ladder_board')).rows[0].state;
async function act(action,payload,version,id=crypto.randomUUID()){
  return (await db.query('select public.ladder_action($1,$2::jsonb,$3,$4::uuid) as state',[action,JSON.stringify(payload),version,id])).rows[0].state;
}
async function asUser(id){await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');}
async function reset(){await db.exec('reset role');}
await db.exec('set role anon');
assert.equal((await current()).round,1);
assert.equal((await db.query('select public.ladder_match_count() as n')).rows[0].n,0);
await assert.rejects(()=>act('add',{name:'Attack'},0),/permission denied/);
await assert.rejects(()=>db.exec("update public.ladder_board set state='{}'"),/permission denied/);
await assert.rejects(()=>db.exec('select * from ladder_private.editors'),/permission denied/);
await assert.rejects(()=>db.exec('select * from ladder_private.checkpoints'),/permission denied/);
await reset();await asUser(outsider);
assert.equal((await db.query('select public.ladder_is_editor() as allowed')).rows[0].allowed,false);
await assert.rejects(()=>act('add',{name:'Attack'},0),/Organizer access required/);
await assert.rejects(()=>db.exec("insert into public.ladder_matches(kind,round,winner_id,loser_id) values('extra',1,'x','y')"),/permission denied/);
await reset();await asUser(editor);
assert.equal((await db.query('select public.ladder_is_editor() as allowed')).rows[0].allowed,true);
let s=await current();let demo={state:emptyState(),history:[]};
async function parity(action,payload,requestId=crypto.randomUUID()){
  const previous=s;s=await act(action,payload,s.version,requestId);
  const id=action==='add'?(Object.keys(s.players).find(id=>!previous.players[id])||Object.values(previous.players).find(p=>p.name.toLowerCase()===payload.name.toLowerCase()).id):crypto.randomUUID();
  demo=reduce(demo.state,demo.history,action,payload,id,undefined,demo.checkpoints||[]);
  assert.deepEqual(s,demo.state,`Demo and PostgreSQL differ after ${action}`);
  const rows=(await db.query('select * from public.ladder_matches')).rows;
  const clean=m=>({kind:m.kind,round:m.round,round_label:m.round_label,ignored:!!m.ignored,note:m.note||'',card:m.card,winner_id:m.winner_id,loser_id:m.loser_id});
  const sort=(a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b));
  assert.deepEqual(rows.map(clean).sort(sort),demo.history.map(clean).sort(sort));
  const available=[...rows];
  for(const m of demo.history){let i=available.findIndex(r=>r.id===m.id&&JSON.stringify(clean(r))===JSON.stringify(clean(m)));if(i<0)i=available.findIndex(r=>JSON.stringify(clean(r))===JSON.stringify(clean(m)));assert.ok(i>=0);m.id=available.splice(i,1)[0].id;}

}
await assert.rejects(()=>act('advance',{},s.version),/at least two/);
await assert.rejects(()=>act('rollback',{},s.version),/No saved round/);
for(let i=0;i<9;i++)await parity('add',{name:`Player ${i}`});
await assert.rejects(()=>act('add',{name:'player 0'},s.version),/already/);
await assert.rejects(()=>act('result',{card:0,winner:'fake'},s.version),/Invalid/);
await assert.rejects(()=>act('result',{card:4,winner:s.cards[4][0]},s.version),/Invalid/);
await assert.rejects(()=>act('advance',{},s.version),/Pick a winner/);
await parity('result',{card:0,winner:s.cards[0][0]});
await parity('result',{card:0,winner:s.cards[0][1]});
await parity('result',{card:0,winner:s.cards[0][1]}); // Same result must not recount.
await parity('add',{name:'Midround newcomer'});

for(let i=0;i<s.cards.length;i++)await parity('result',{card:i,winner:s.cards[i][0]});
await parity('clear_result',{card:0});
await parity('result',{card:0,winner:s.cards[0][1]});
await parity('skip',{card:1});
await assert.rejects(()=>act('result',{card:1,winner:s.cards[1][0]},s.version),/Restore/);
const boundary=[...s.cards[1]];
await parity('advance',{});assert.deepEqual(s.cards[1],boundary);
for(let i=0;i<s.cards.length;i++)await parity('skip',{card:i});
await parity('unskip',{card:0});
await parity('result',{card:0,winner:s.cards[0][0]});
await parity('skip',{card:0});
await parity('advance',{});
await parity('result',{card:0,winner:s.cards[0][0]});
await parity('result',{card:2,winner:s.cards[2][0]});
await parity('edit_card',{card:0,players:[s.cards[2][0],s.cards[0][1]]});
await assert.rejects(()=>act('edit_card',{card:0,players:[s.cards[0][0],s.cards[0][0]]},s.version),/different active/);
for(let i=0;i<s.cards.length;i++)await parity('result',{card:i,winner:s.cards[i][0]});
const returning=s.players[s.cards[1][0]].name;
await parity('delete_card',{card:1});
await parity('add',{name:returning});
await parity('delete_card',{card:s.cards.length-1});
await parity('add',{name:'Solo to delete'});
await parity('delete_card',{card:s.cards.length-1});
await parity('skip',{card:2});
await parity('delete_card',{card:1});
await parity('advance',{});
for(let round=0;round<12;round++){
  for(let i=0;i<s.cards.length;i++)if(s.cards[i].length===2){if((round+i)%4===0)await parity('skip',{card:i});else await parity('result',{card:i,winner:s.cards[i][(round+i)%2]});}
  await parity('extra',{winner:s.cards[0][0],loser:s.cards.at(-1).at(-1)});
  await parity('advance',{});
  if(round%3===0)await parity('add',{name:`Late player ${round}`});
}
await parity('set_round_number',{number:1});
await parity('result',{card:0,winner:s.cards[0][0]});
await parity('extra',{winner:s.cards[0][0],loser:s.cards[0][1]});
await parity('clear_round',{});
for(let i=0;i<s.cards.length;i++)if(s.cards[i].length===2)await parity('skip',{card:i});
await parity('advance',{});
await parity('add',{name:'Discard on rollback'});
await parity('extra',{winner:s.cards[0][0],loser:s.cards[0][1]});
await parity('set_round_number',{number:75});
await parity('rollback',{});
await parity('clear_round',{});
for(let i=0;i<s.cards.length;i++)if(s.cards[i].length===2)await parity('result',{card:i,winner:s.cards[i][0]});
await parity('advance',{});
await parity('rollback',{});
await parity('rollback',{});
for(const number of [0,-1,1.5,1000001,'2',null])await assert.rejects(()=>act('set_round_number',{number},s.version),/round number/);
await parity('rename_player',{player:s.cards[0][0],name:'Corrected spelling'});
await assert.rejects(()=>act('rename_player',{player:s.cards[0][1],name:'Corrected spelling'},s.version),/already/);
let historyMatch=demo.history.find(m=>m.kind==='card'&&m.round===1);
await parity('history_note',{match:historyMatch.id,note:"Open-ended note: \ud83c\udfb2\nAny context, \"quotes\" & <tags>."});
await parity('history_edit',{match:historyMatch.id,winner:historyMatch.loser_id});
await parity('history_ignore',{match:historyMatch.id,ignored:true});
await parity('history_ignore',{match:historyMatch.id,ignored:true});
await parity('history_ignore',{match:historyMatch.id,ignored:false});
await parity('history_ignore',{match:historyMatch.id,ignored:true});
await parity('history_delete',{match:demo.history.find(m=>m.kind==='card'&&m.id!==historyMatch.id&&m.round<s.round).id});
await parity('extra',{winner:s.cards[0][0],loser:s.cards[0][1]});
let extraId=demo.history[0].id;
await parity('history_note',{match:extraId,note:'Any story you want to keep.'});
await parity('history_note',{match:extraId,note:''});
await parity('history_ignore',{match:extraId,ignored:true});
await parity('history_edit',{match:extraId,winner:demo.history[0].loser_id});
await parity('history_ignore',{match:extraId,ignored:false});
await parity('history_delete',{match:extraId});
await parity('result',{card:0,winner:s.cards[0][0],note:'Initial card note'});
await parity('result',{card:0,winner:s.cards[0][0],note:'Expanded context'});
let currentId=demo.history.find(m=>m.kind==='card'&&m.round===s.round&&m.card===0).id;
await parity('history_ignore',{match:currentId,ignored:true});
await parity('result',{card:0,winner:s.cards[0][1]});
await parity('clear_result',{card:0});
await parity('result',{card:0,winner:s.cards[0][0]});
currentId=demo.history.find(m=>m.kind==='card'&&m.round===s.round&&m.card===0).id;
await parity('history_edit',{match:currentId,winner:s.cards[0][1]});
await parity('history_delete',{match:currentId});
await assert.rejects(()=>act('history_edit',{match:historyMatch.id,winner:'fake'},s.version),/original two/);
await assert.rejects(()=>act('history_note',{match:historyMatch.id,note:{bad:true}},s.version),/text note/);
await assert.rejects(()=>act('history_note',{match:historyMatch.id,note:'x'.repeat(10001)},s.version),/text note/);
const rollbackVersion=s.version,rollbackRequest=crypto.randomUUID();
await parity('rollback',{},rollbackRequest);
assert.deepEqual(await act('rollback',{},rollbackVersion,rollbackRequest),s);
const version=s.version;
await assert.rejects(()=>act('add',{name:'Stale edit'},version-1),/board changed/);
assert.deepEqual(await current(),s);
const request=crypto.randomUUID();
const one=await act('extra',{winner:s.cards[0][0],loser:s.cards[0][1]},version,request);
const replay=await act('extra',{winner:s.cards[0][0],loser:s.cards[0][1]},version,request);
assert.deepEqual(one,replay);
await assert.rejects(()=>db.exec("delete from public.ladder_matches"),/permission denied/);
await reset();
// Simulate upgrading a version-1 board with existing scores and match history.
const beforeUpgrade=await current();
const historyBefore=(await db.query('select * from public.ladder_matches order by id')).rows;
await db.exec("update public.ladder_board set state=state-'skipped'-'roundLabel'-'canRollback'");
await db.exec(schema);
const upgraded=await current();
assert.deepEqual(upgraded,{...beforeUpgrade,version:beforeUpgrade.version+2,skipped:{},roundLabel:beforeUpgrade.round,canRollback:beforeUpgrade.canRollback});
assert.deepEqual((await db.query('select * from public.ladder_matches order by id')).rows,historyBefore);
await db.exec(schema);assert.deepEqual(await current(),upgraded);
await db.query('delete from ladder_private.editors where user_id=$1::uuid',[editor]);
await asUser(editor);
await assert.rejects(()=>act('add',{name:'Revoked'},one.version),/Organizer access required/);
await reset();await db.exec('set role anon');
assert.equal((await current()).version,upgraded.version);
assert.ok((await db.query('select count(*) as n from public.ladder_matches')).rows[0].n>0);
await db.close();
console.log('Database checks passed: SQL execution, public reads, denied anonymous/outsider writes, editor revocation, stale versions, idempotency, result corrections, undo, edits, deletions, skips, archived-player return, counter resets, clearing results, rollback, history edits/deletions/ignore/restore, checkpoint consistency, optional free-text notes, a data-preserving upgrade, and 12 rounds of demo/server parity.');
