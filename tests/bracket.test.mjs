import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bracketPreview} from '../bracket.mjs';
import {advanceCards} from '../core.mjs';
test('pending preview shows correct source outcomes rather than inventing winners',()=>{
  const next=bracketPreview([['A','B'],['C','D'],['E','F']]);
  assert.deepEqual(next.map(c=>c.map(s=>[s.sourceCard,s.role])),[[[0,'winner'],[1,'winner']],[[0,'loser'],[2,'winner']],[[1,'loser'],[2,'loser']]]);
  assert.ok(next.flat().every(s=>s.playerId===null&&s.sourceSeat===null));
});
test('recorded winners and losers flow into the exact next-round seats',()=>{
  const cards=[['A','B'],['C','D'],['E','F']],results={0:'B',1:'C',2:'F'};
  assert.deepEqual(bracketPreview(cards,results).map(c=>c.map(s=>s.playerId)),advanceCards(cards,results));
});
test('skips stay fixed, have two known seats, and block crossing routes',()=>{
  const cards=[['A','B'],['C','D'],['E','F'],['G']];
  const preview=bracketPreview(cards,{0:'A',2:'F'},{1:true});
  assert.deepEqual(preview.map(c=>c.map(s=>s.playerId)),advanceCards(cards,{0:'A',2:'F'},{1:true}));
  assert.ok(preview[1].every(s=>s.role==='hold'&&s.movement==='stay'));
});
test('preview agrees with movement for every skip mask, all small ladder sizes',()=>{
  for(let n=2;n<=20;n++){
    const ids=Array.from({length:n},(_,i)=>String(i));const cards=[];for(let i=0;i<n;i+=2)cards.push(ids.slice(i,i+2));
    for(let mask=0;mask<(1<<Math.min(cards.length,6));mask++){
      const skipped={},results={};cards.forEach((c,i)=>{if(c.length===2&&(mask&(1<<i)))skipped[i]=true;else if(c.length===2)results[i]=c[(i+mask)%2];});
      const preview=bracketPreview(cards,results,skipped);
      assert.deepEqual(preview.map(c=>c.map(s=>s.playerId)),advanceCards(cards,results,skipped));
      preview.forEach((c,target)=>c.forEach(s=>{assert.equal(cards[s.sourceCard][s.sourceSeat],s.playerId);assert.equal(s.movement,target<s.sourceCard?'up':target>s.sourceCard?'down':'stay');}));
    }
  }
});
