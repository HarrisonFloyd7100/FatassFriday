import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyState,reduce,advanceCards} from '../core.mjs';
function fixture(count){let data={state:emptyState(),history:[]};for(let i=0;i<count;i++)data=reduce(data.state,data.history,'add',{name:`Player ${i}`},String(i));return data;}
const apply=(d,a,p,id)=>reduce(d.state,d.history,a,p,id,undefined,d.checkpoints||[]);
test('new players append, fill a solo card, and preserve order',()=>{const d=fixture(5);assert.deepEqual(d.state.cards,[['0','1'],['2','3'],['4']]);assert.equal(Object.keys(d.state.players).length,5);});
test('simultaneous movement respects both boundaries',()=>{assert.deepEqual(advanceCards([['A','B'],['C','D'],['E','F'],['G','H']],{0:'A',1:'D',2:'E',3:'H'}),[['A','D'],['B','E'],['C','H'],['F','G']]);});
test('one paired card keeps winner and loser on that card',()=>assert.deepEqual(advanceCards([['A','B']],{0:'B'}),[['B','A']]));
test('solo bottom bye moves up with no opponent',()=>assert.deepEqual(advanceCards([['A','B'],['C','D'],['E']],{0:'B',1:'C'}),[['B','C'],['A','E'],['D']]));
test('results immediately affect history and records; corrections reverse counts',()=>{let d=fixture(4);d=apply(d,'result',{card:0,winner:'0'},'m1');assert.equal(d.state.players['0'].wins,1);assert.equal(d.state.players['1'].losses,1);assert.equal(d.history.length,1);d=apply(d,'result',{card:0,winner:'1'},'m2');assert.equal(d.history[0].id,'m1');assert.equal(d.history.length,1);assert.equal(d.state.players['0'].wins,0);assert.equal(d.state.players['0'].losses,1);assert.equal(d.state.players['1'].wins,1);assert.equal(d.state.players['1'].losses,0);const again=apply(d,'result',{card:0,winner:'1'},'m3');assert.deepEqual(again,d);});
test('extra matches change stats and history but preserve positions',()=>{const d=fixture(4);const e=apply(d,'extra',{winner:'3',loser:'0'},'e1');assert.deepEqual(e.state.cards,d.state.cards);assert.equal(e.state.players['3'].wins,1);assert.equal(e.state.players['0'].losses,1);assert.equal(e.history[0].kind,'extra');assert.deepEqual(e.state.results,{});});
test('round advance does not count results twice; bye has no stats',()=>{let d=fixture(3);d=apply(d,'result',{card:0,winner:'0'},'m');d=apply(d,'advance',{},'advance');assert.equal(d.state.round,2);assert.deepEqual(d.state.results,{});assert.equal(d.history.length,1);assert.equal(d.state.players['0'].wins,1);assert.equal(d.state.players['2'].wins,0);assert.equal(d.state.players['2'].losses,0);});
test('midround addition preserves existing matches',()=>{let d=fixture(4);d=apply(d,'result',{card:0,winner:'1'},'m');const e=apply(d,'add',{name:'New'},'4');assert.deepEqual(e.state.cards,[['0','1'],['2','3'],['4']]);assert.deepEqual(e.state.results,{0:'1'});assert.equal(e.history.length,1);});
test('invalid actions cannot alter input',()=>{const d=fixture(3),copy=structuredClone(d);for(const [a,p] of [['add',{name:'player 0'}],['add',{name:' '}],['extra',{winner:'0',loser:'0'}],['extra',{winner:'fake',loser:'0'}],['result',{card:1,winner:'2'}],['result',{card:0,winner:'2'}],['advance',{}]])assert.throws(()=>apply(d,a,p,'x'));assert.deepEqual(d,copy);});
test('cannot advance zero or one player',()=>{assert.throws(()=>advanceCards([],{}));assert.throws(()=>advanceCards([['A']],{}));});
test('many player counts and 12 rounds conserve every player and two-seat cards',()=>{for(let count=2;count<=25;count++){let d=fixture(count);for(let round=0;round<12;round++){const oldStats=Object.values(d.state.players).reduce((n,p)=>n+p.wins,0);const pairs=d.state.cards.filter(c=>c.length===2).length;for(let i=0;i<d.state.cards.length;i++){const c=d.state.cards[i];if(c.length===2)d=apply(d,'result',{card:i,winner:c[(round+i)%2]},`m-${round}-${i}`);}d=apply(d,'advance',{},`a-${round}`);const ids=d.state.cards.flat();assert.equal(ids.length,count);assert.equal(new Set(ids).size,count);assert.ok(d.state.cards.every((c,i)=>c.length===2||(i===d.state.cards.length-1&&c.length===1)));const ps=Object.values(d.state.players);assert.equal(ps.reduce((n,p)=>n+p.wins,0),oldStats+pairs);assert.equal(ps.reduce((n,p)=>n+p.wins,0),ps.reduce((n,p)=>n+p.losses,0));}}});

test('skip reverses a saved result, creates no match, and can be restored',()=>{
  let d=fixture(6);d=apply(d,'result',{card:1,winner:'2'},'m');
  d=apply(d,'skip',{card:1});assert.equal(d.state.players['2'].wins,0);assert.equal(d.state.players['3'].losses,0);assert.equal(d.history.length,0);assert.equal(d.state.skipped[1],true);
  assert.throws(()=>apply(d,'result',{card:1,winner:'2'}),/Restore/);
  d=apply(d,'unskip',{card:1});assert.deepEqual(d.state.skipped,{});
  assert.throws(()=>apply(d,'advance',{}),/winner or skip/);
});
test('undo result reverses only its own score and history entry',()=>{
  let d=fixture(4);d=apply(d,'extra',{winner:'0',loser:'1'},'extra');d=apply(d,'result',{card:0,winner:'0'},'m');
  d=apply(d,'clear_result',{card:0});assert.deepEqual(d.state.results,{});assert.equal(d.state.players['0'].wins,1);assert.equal(d.state.players['1'].losses,1);assert.equal(d.history.length,1);assert.equal(d.history[0].kind,'extra');
});
test('skipped card is a boundary; singleton on its own stays',()=>{
  assert.deepEqual(advanceCards([['A','B'],['C','D'],['E','F'],['G','H'],['I']],{0:'B',2:'F',3:'G'},{1:true}),[['B','A'],['C','D'],['F','G'],['E','I'],['H']]);
  assert.deepEqual(advanceCards([['A','B'],['C']],{},{0:true}),[['A','B'],['C']]);
});
test('all cards may skip, next round clears skips without changing stats',()=>{
  let d=fixture(4);d=apply(d,'skip',{card:0});d=apply(d,'skip',{card:1});const before=structuredClone(d);d=apply(d,'advance',{});assert.deepEqual(d.state.cards,before.state.cards);assert.equal(d.state.round,2);assert.deepEqual(d.state.skipped,{});assert.equal(d.history.length,0);
});
test('every skip pattern preserves boundaries, player identities, and card capacity',()=>{
  for(let n=1;n<=6;n++)for(const odd of [false,true]){
    const d=fixture(n*2-(odd?1:0));if(d.state.cards.every(c=>c.length===1))continue;
    for(let mask=0;mask<(1<<n);mask++){
      const skips={},results={};d.state.cards.forEach((c,i)=>{if(c.length===2&&(mask&(1<<i)))skips[i]=true;else if(c.length===2)results[i]=c[(i+mask)%2];});
      const next=advanceCards(d.state.cards,results,skips);assert.equal(next.length,n);assert.deepEqual([...next.flat()].sort(),[...d.state.cards.flat()].sort());
      next.forEach((c,i)=>{assert.equal(c.length,d.state.cards[i].length);if(skips[i])assert.deepEqual(c,d.state.cards[i]);});
    }
  }
});
test('edit card swaps active players and invalidates only changed cards',()=>{
  let d=fixture(6);for(let i=0;i<3;i++)d=apply(d,'result',{card:i,winner:String(i*2)},'m'+i);
  d=apply(d,'edit_card',{card:0,players:['4','1']});assert.deepEqual(d.state.cards,[['4','1'],['2','3'],['0','5']]);assert.deepEqual(d.state.results,{1:'2'});assert.equal(d.history.length,1);assert.equal(d.state.players['4'].wins,0);assert.equal(d.state.players['5'].losses,0);assert.equal(d.state.players['2'].wins,1);
  const copy=structuredClone(d);assert.throws(()=>apply(d,'edit_card',{card:0,players:['4','4']}));assert.deepEqual(d,copy);
});
test('edit can reverse the seats on a card and clears its skip',()=>{let d=fixture(2);d=apply(d,'skip',{card:0});d=apply(d,'edit_card',{card:0,players:['1','0']});assert.deepEqual(d.state.cards,[['1','0']]);assert.deepEqual(d.state.skipped,{});});
test('delete archives players, reverses current result, and renumbers later results',()=>{
  let d=fixture(6);d=apply(d,'extra',{winner:'2',loser:'3'},'e');for(let i=0;i<3;i++)d=apply(d,'result',{card:i,winner:String(i*2)},'m'+i);
  d=apply(d,'delete_card',{card:1});assert.deepEqual(d.state.cards,[['0','1'],['4','5']]);assert.deepEqual(d.state.results,{0:'0',1:'4'});assert.equal(Object.keys(d.state.players).length,6);assert.equal(d.state.players['2'].wins,1);assert.equal(d.state.players['3'].losses,1);assert.equal(d.history.length,3);assert.equal(d.history.find(m=>m.id==='m2').card,1);
  d=apply(d,'advance',{});assert.equal(d.state.round,2);
});
test('delete preserves past rounds and renumbers later skips; deleting a solo is allowed',()=>{
  let d=fixture(5);d=apply(d,'result',{card:0,winner:'0'},'past0');d=apply(d,'result',{card:1,winner:'2'},'past1');d=apply(d,'advance',{});
  d=apply(d,'skip',{card:1});d=apply(d,'delete_card',{card:0});assert.deepEqual(d.state.skipped,{0:true});assert.equal(d.history.length,2);assert.equal(d.history.find(m=>m.id==='past1').card,1);
  d=apply(d,'delete_card',{card:1});assert.equal(d.state.cards.length,1);assert.equal(Object.keys(d.state.players).length,5);d=apply(d,'delete_card',{card:0});assert.deepEqual(d.state.cards,[]);assert.deepEqual(d.state.skipped,{});
});

test('off-ladder players can return by name without losing their record',()=>{let d=fixture(4);d=apply(d,'extra',{winner:'0',loser:'1'},'e');d=apply(d,'delete_card',{card:0});d=apply(d,'add',{name:'player 0'},'new-id');assert.equal(Object.keys(d.state.players).length,4);assert.deepEqual(d.state.cards,[['2','3'],['0']]);assert.equal(d.state.players['0'].wins,1);});
