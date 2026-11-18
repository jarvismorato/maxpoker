const {test} = require('node:test');
const assert = require('node:assert/strict');
const {chooseBotAction, estimateEquity} = require('../lib/bot-strategy');
const base = {difficulty:'easy',cards:[{value:2,suit:'♠'},{value:7,suit:'♥'}],board:[],
  pot:300,toCall:200,currentBet:200,myBet:0,chips:10000,minRaise:200,bigBlind:200,opponents:1};
test('easy bot pays a small preflop bet most of the time, even without a pair',()=>{
  const decisions=Array.from({length:100},(_,i)=>chooseBotAction(base,()=>[1],()=>i/100));
  assert.equal(decisions.filter(d=>d.action==='call').length,80);
  assert.equal(chooseBotAction({...base,toCall:3000,currentBet:3000,pot:3300},()=>[1],()=>0).action,'fold');
});
test('easy bot values pocket pairs before community cards appear',()=>{
  assert.equal(chooseBotAction({...base,cards:[{value:9,suit:'♥'},{value:9,suit:'♠'}]},()=>[1],()=>0.99).action,'call');
});
test('equity sampler excludes known cards and deals valid unique seven-card hands',()=>{
  let count=0;
  const cards=[{value:14,suit:'♠'},{value:13,suit:'♠'}];
  const board=[{value:12,suit:'♠'},{value:11,suit:'♠'},{value:10,suit:'♠'}];
  const equity=estimateEquity(cards,board,5,hand=>{
    count++;
    assert.equal(hand.length,7);
    assert.equal(new Set(hand.map(c=>c.value+c.suit)).size,7);
    return [1];
  },()=>0.4,5);
  assert.equal(count,30);
  assert.ok(Math.abs(equity-1/6)<0.00001);
});
