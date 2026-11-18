const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function engine(saved = {}) {
  const timers = new Map();
  let nextTimer = 0;
  let stored = JSON.stringify(saved);
  const context = vm.createContext({
    require: name => name === 'ws' ? { WebSocketServer: class { on() {} } }
      : name === 'http' ? { createServer: () => ({ listen() {} }) }
      : name === 'fs' ? {
        existsSync: () => true, readFileSync: () => stored,
        writeFileSync: (_, data) => { stored = data; }, renameSync() {}
      } : name.startsWith('./') ? require(path.resolve(__dirname, '..', name)) : require(name),
    __dirname: path.resolve(__dirname, '..'), process: { env: {} }, console,
    setTimeout: (fn, ms) => { const id = ++nextTimer; timers.set(id, { fn, ms }); return id; },
    clearTimeout: id => timers.delete(id)
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8'), context);
  vm.runInContext(`
    function makeSeat(id, chips, cards = [{value:14,suit:'s'}, {value:13,suit:'s'}]) {
      return {id, name:id, isBot:true, chips, cards, currentBet:0, totalBet:0,
        folded:false, isAllIn:chips===0, lastAction:'', actedAtBet:null};
    }
    function makeRoom(stacks) {
      const r = createRoom({autoFillBots:false});
      stacks.forEach((chips,i) => r.seats[i] = makeSeat('p'+i, chips));
      return r;
    }
  `, context);
  return {
    run: code => vm.runInContext(code, context),
    saved: () => JSON.parse(stored),
    tick: id => { const task = timers.get(id); assert.ok(task, 'timer exists'); timers.delete(id); task.fn(); }
  };
}

test('invalid raises cannot change stacks, pot or turn; legal raises work', () => {
  const e = engine();
  e.run('var r=makeRoom([5000,5000]);startNewHand(r);var i=r.currentTurnSeat;');
  const before = e.run('JSON.stringify([r.seats,r.pot,r.currentTurnSeat])');
  for (const value of ['-100', 'NaN', 'Infinity', '0', '200', '250', '400.5', "'400'"]) {
    assert.equal(e.run(`handlePlayerAction(r,i,'raise',${value})`), false);
    assert.equal(e.run('JSON.stringify([r.seats,r.pot,r.currentTurnSeat])'), before);
  }
  assert.equal(e.run("handlePlayerAction(r,i,'raise',400)"), true);
  assert.equal(e.run('r.currentBet'), 400);
});

test('small blind call preserves big blind option', () => {
  const e = engine();
  e.run("var r=makeRoom([5000,5000]);startNewHand(r);var sb=r.currentTurnSeat;handlePlayerAction(r,sb,'call');");
  assert.notEqual(e.run('r.currentTurnSeat'), e.run('sb'));
  assert.equal(e.run('r.stage'), 'preflop');
  assert.equal(e.run('r.pendingActions.size'), 1);
});

test('all-in runout reaches showdown without a player action', () => {
  const e = engine();
  e.run("var r=makeRoom([200,200]);startNewHand(r);handlePlayerAction(r,r.currentTurnSeat,'call');");
  for (let i = 0; i < 4; i++) e.tick(e.run('r.streetTimer'));
  assert.equal(e.run('r.stage'), 'showdown');
  assert.equal(e.run('r.seats.filter(Boolean).reduce((n,s)=>n+s.chips,0)'), 400);
});

test('short all-in leaves an outstanding call and does not reopen a prior raise', () => {
  const e = engine();
  e.run(`var r=makeRoom([5000,5000,500]);startNewHand(r);
    r.currentTurnSeat=0;r.pendingActions=new Set([0,1,2]);
    handlePlayerAction(r,0,'raise',400);
    handlePlayerAction(r,1,'call');
    handlePlayerAction(r,2,'raise',500);`);
  assert.equal(e.run('r.currentTurnSeat'), 0);
  assert.equal(e.run("handlePlayerAction(r,0,'raise',700)"), false);
  assert.equal(e.run("handlePlayerAction(r,0,'call')"), true);
  assert.equal(e.run('r.currentTurnSeat'), 1);
});

test('side pots cap a short stack win and conserve all chips', () => {
  const e = engine();
  e.run(`var r=makeRoom([0,0,0]);r.handInProgress=true;r.stage='river';
    r.communityCards=[2,4,7,9,11].map((value,i)=>({value,suit:i%2?'h':'s'}));
    r.seats[0].cards=[{value:14,suit:'h'},{value:14,suit:'d'}];
    r.seats[1].cards=[{value:13,suit:'h'},{value:13,suit:'d'}];
    r.seats[2].cards=[{value:12,suit:'h'},{value:12,suit:'d'}];
    [100,300,300].forEach((v,i)=>r.seats[i].totalBet=v);r.pot=700;resolveShowdown(r);`);
  assert.equal(e.run('r.seats[0].chips'), 300);
  assert.equal(e.run('r.seats[1].chips'), 400);
  assert.equal(e.run('r.seats[2].chips'), 0);
});

test('odd chips are assigned, never discarded', () => {
  const e = engine();
  e.run(`var r=makeRoom([0,0,0]);r.handInProgress=true;r.stage='river';r.dealerSeat=0;
    r.communityCards=[10,11,12,13,14].map(value=>({value,suit:'s'}));
    r.seats.forEach(s=>{if(s)s.totalBet=1;});r.seats[2].folded=true;r.pot=3;resolveShowdown(r);`);
  assert.equal(e.run('r.seats[0].chips+r.seats[1].chips'), 3);
  assert.equal(e.run('r.seats[1].chips'), 2);
});

test('buy-in rejects NaN; active hands reject entry without removing a bot', () => {
  const e = engine();
  e.run(`accounts.tester={username:'tester',bankroll:50000};var r=makeRoom([5000,5000]);
    var c={id:'human',username:'tester',seatIndex:-1};`);
  assert.equal(e.run('sitPlayerInRoom(r,c,-1,NaN).success'), false);
  e.run('startNewHand(r)');
  assert.equal(e.run('sitPlayerInRoom(r,c,-1,5000).success'), false);
  assert.equal(e.run('accounts.tester.bankroll'), 50000);
  assert.equal(e.run('r.seats[0].id'), 'p0');
});

test('buy-in has no table cap but still requires an integer within the wallet', () => {
  const e = engine();
  e.run(`accounts.tester={username:'tester',bankroll:1000000};var r=createRoom({autoFillBots:false,maxBuyIn:5000});
    var c={id:'human',username:'tester',seatIndex:-1};`);
  for (const amount of ['1000001', '5000.5', 'Infinity', '-1']) {
    assert.equal(e.run(`sitPlayerInRoom(r,c,-1,${amount}).success`), false);
  }
  assert.equal(e.run('sitPlayerInRoom(r,c,-1,1000000).success'), true);
  assert.equal(e.run('r.seats[0].chips'), 1000000);
  assert.equal(e.run('accounts.tester.bankroll'), 0);
});

test('Google linking preserves the wallet and rejects linking an identity owned elsewhere', () => {
  const e = engine();
  e.run(`accounts.tester={username:'tester',bankroll:98765};accounts.other={username:'other',bankroll:2000,googleSub:'taken'};
    var messages=[];var ws={OPEN:1,readyState:1,send:m=>messages.push(JSON.parse(m))};
    clients.set(ws,{id:'human',username:'tester',seatIndex:-1,roomId:null});
    applyGoogleIdentity(ws,{sub:'taken',name:'Tester'},true);`);
  assert.equal(e.run('accounts.tester.googleSub'), undefined);
  e.run("applyGoogleIdentity(ws,{sub:'mine',name:'Tester'},true)");
  assert.equal(e.run('accounts.tester.googleSub'), 'mine');
  assert.equal(e.run('accounts.tester.bankroll'), 98765);
});

test('Google name never matches or takes over an existing privileged account', () => {
  const e = engine();
  e.run(`accounts.gabriel={username:'Gabriel',bankroll:100000000000};
    var messages=[];var ws={OPEN:1,readyState:1,send:m=>messages.push(JSON.parse(m))};
    clients.set(ws,{id:'human',username:null,seatIndex:-1,roomId:null});
    applyGoogleIdentity(ws,{sub:'new-subject',name:'Gabriel'},false);
    var newKey=clients.get(ws).username.toLowerCase();`);
  assert.notEqual(e.run('newKey'), 'gabriel');
  assert.equal(e.run('accounts[newKey].bankroll'), 50000);
  assert.equal(e.run('accounts.gabriel.googleSub'), undefined);
  assert.equal(e.run('sanitizeAccount(accounts[newKey]).unlimitedChips'), false);
});

test('restart refunds escrow once and preserves a regular bankroll', () => {
  const original = { regular: { username:'Regular',salt:'salt',passwordHash:'hash',bankroll:1000,tableEscrow:2345 } };
  const e = engine(original);
  assert.equal(e.saved().regular.bankroll, 3345);
  assert.equal(e.saved().regular.tableEscrow, 0);
  assert.equal(engine(e.saved()).saved().regular.bankroll, 3345);
});

test('invalid stored balances abort startup instead of overwriting accounts', () => {
  assert.throws(() => engine({ tester: { salt:'s',passwordHash:'h',bankroll:null } }), /Contas inválidas/);
});

test('bonus cooldown still applies when the wallet is nearly empty', () => {
  const e = engine();
  e.run(`accounts.tester={username:'tester',bankroll:100,lastBonusClaim:Date.now()};
    var ws={OPEN:1,readyState:1,send(){}};clients.set(ws,{username:'tester'});
    handleClientMessage(ws,{type:'claimBonus'});`);
  assert.equal(e.run('accounts.tester.bankroll'), 100);
});

test('Gabriel wallet replenishes after buy-in and restart without changing ordinary accounts', () => {
  const e = engine({
    gabriel: {username:'Gabriel',salt:'salt',passwordHash:'hash',bankroll:1000},
    regular: {username:'Regular',salt:'salt',passwordHash:'hash',bankroll:50000}
  });
  assert.equal(e.saved().gabriel.bankroll, 100000000000);
  e.run(`var r=createRoom({autoFillBots:false});
    var c={id:'human',username:'Gabriel',seatIndex:-1};sitPlayerInRoom(r,c,-1,5000);`);
  assert.equal(e.saved().gabriel.bankroll, 100000000000);
  assert.equal(e.run('r.seats[0].chips'), 5000);
  assert.equal(e.run('sanitizeAccount(accounts.gabriel).unlimitedChips'), true);
  assert.equal(e.run('sanitizeAccount(accounts.regular).unlimitedChips'), false);
  assert.equal(e.saved().regular.bankroll, 50000);
  assert.equal(Number.isSafeInteger(e.saved().gabriel.bankroll), true);
  assert.ok(engine(e.saved()).saved().gabriel.bankroll >= 100000000000);
});

test('pending table chips are included in the atomic account snapshot', () => {
  const e = engine();
  e.run(`accounts.tester={username:'tester',bankroll:50000};var r=createRoom({autoFillBots:false});
    var c={id:'human',username:'tester',seatIndex:-1};sitPlayerInRoom(r,c,-1,5000);
    postBet(r,0,200,'Bet');saveAccounts();`);
  assert.equal(e.saved().tester.bankroll, 45000);
  assert.equal(e.saved().tester.tableEscrow, 5000);
});

test('folded cards stay hidden and blind values do not follow raises', () => {
  const e = engine();
  e.run("var r=makeRoom([5000,5000]);startNewHand(r);handlePlayerAction(r,r.currentTurnSeat,'raise',1000);");
  assert.equal(e.run("getSanitizedTable(r,'observer').seats[0].cards[0].hidden"), true);
  assert.equal(e.run("getSanitizedTable(r,'observer').bigBlind"), 200);
});

test('short-stack bots fall back to call when their chosen raise is impossible', () => {
  const e = engine();
  e.run(`var r=makeRoom([5000,5000,300]);startNewHand(r);
    r.currentTurnSeat=0;handlePlayerAction(r,0,'raise',1000);
    handlePlayerAction(r,1,'call');performBotAction(r,2,'raise',2000);`);
  assert.equal(e.run('r.seats[2].isAllIn'), true);
  assert.equal(e.run('r.currentTurnSeat'), null);
  assert.ok(e.run('r.streetTimer'));
});

test('malformed room enums do not enter the shared lobby', () => {
  const e = engine();
  e.run(`var messages=[];var ws={OPEN:1,readyState:1,send:m=>messages.push(JSON.parse(m))};
    clients.set(ws,{username:'tester',seatIndex:-1});var before=rooms.size;
    handleClientMessage(ws,{type:'createRoom',minBuyIn:2000,maxBuyIn:10000,defaultBuyIn:5000,
      botDifficulty:{toString:null},botSpeed:'normal'});`);
  assert.equal(e.run('rooms.size'), e.run('before'));
  assert.equal(e.run('messages[0].type'), 'alert');
});

test('disconnect recovery transfers identity and seat; second active session is denied', () => {
  const e = engine();
  e.run(`accounts.tester={username:'tester',bankroll:1000};
    var oldWs={};var newWs={OPEN:1,readyState:1,send(){}};
    clients.set(oldWs,{id:'old',username:'tester',roomId:'room',seatIndex:2,disconnected:true});
    clients.set(newWs,{id:'new',username:null,roomId:null,seatIndex:-1});`);
  assert.equal(e.run("attachAccount(newWs,'tester')"), true);
  assert.equal(e.run('clients.get(newWs).id'), 'old');
  assert.equal(e.run('clients.get(newWs).seatIndex'), 2);
  e.run('var third={OPEN:1,readyState:1,send(){}};clients.set(third,{username:null});');
  assert.equal(e.run("attachAccount(third,'tester')"), false);
});

test('leaving does not skip another player or eliminate an all-in contender', () => {
  const e = engine();
  e.run(`var r=makeRoom([0,5000,5000]);r.handInProgress=true;r.stage='flop';
    r.pendingActions=new Set([1,2]);r.currentTurnSeat=1;r.pot=100;
    r.seats[0].totalBet=100;r.seats[2].isBot=false;r.seats[2].username='tester';
    accounts.tester={username:'tester',bankroll:1000};
    var ws={OPEN:1,readyState:1,send(){}};
    clients.set(ws,{id:'p2',username:'tester',roomId:r.id,seatIndex:2});leaveCurrentRoom(ws);`);
  assert.equal(e.run('r.currentTurnSeat'), 1);
  assert.equal(e.run('r.stage'), 'flop');
  assert.equal(e.run('contenders(r).length'), 2);
  assert.equal(e.saved().tester.bankroll, 6000);
});

test('bots complete many hands with conservation across short stacks', () => {
  const e = engine();
  for (const stacks of [[200,200], [300,500,900], [100,200,300,400,500,600]]) {
    e.run(`var r=makeRoom(${JSON.stringify(stacks)});r.botDifficulty='hard';startNewHand(r);`);
    for (let step = 0; e.run("r.stage !== 'showdown'") && step < 500; step++) {
      const timer = e.run('r.currentTurnSeat === null ? r.streetTimer : r.botTimer');
      e.tick(timer);
    }
    assert.equal(e.run('r.stage'), 'showdown');
    assert.equal(e.run('r.seats.filter(Boolean).reduce((n,s)=>n+s.chips,0)'), stacks.reduce((a,b)=>a+b));
  }
});

test('join during a hand reserves a seat without touching chips or active bot cards', () => {
  const e = engine();
  e.run(`var r=makeRoom([5000,5000]);startNewHand(r);
    accounts.newplayer={username:'NewPlayer',bankroll:50000};
    var messages=[];var ws={OPEN:1,readyState:1,send:m=>messages.push(JSON.parse(m))};
    var c={id:'human',username:'NewPlayer',roomId:null,seatIndex:-1};clients.set(ws,c);
    var oldId=r.seats[0].id;joinRoom(ws,r.id,5000);`);
  assert.equal(e.run('accounts.newplayer.bankroll'), 50000);
  assert.equal(e.run('r.seats[0].id'), e.run('oldId'));
  assert.equal(e.run('r.seats[0].cards.length'), 2);
  assert.equal(e.run("getSanitizedTable(r,'human').waitingForSeat"), true);
  e.run('awardPot(r,r.seats[0]);');
  e.tick(e.run('r.timer'));
  assert.equal(e.run('c.seatIndex'), 0);
  assert.equal(e.run('r.seats[0].chips'), 5000);
  assert.equal(e.run('accounts.newplayer.bankroll'), 45000);
  assert.equal(e.run('r.pendingJoins.length'), 0);
});

test('leaving the waiting list cancels the reservation without charging a buy-in', () => {
  const e = engine();
  e.run(`var r=makeRoom([5000,5000]);startNewHand(r);
    accounts.tester={username:'tester',bankroll:50000};
    var ws={OPEN:1,readyState:1,send(){}};
    clients.set(ws,{id:'waiting',username:'tester',roomId:null,seatIndex:-1});
    joinRoom(ws,r.id,5000);leaveCurrentRoom(ws);`);
  assert.equal(e.run('r.pendingJoins.length'), 0);
  assert.equal(e.run('accounts.tester.bankroll'), 50000);
});

test('human table accepts two people and never fills remaining seats with bots', () => {
  const e = engine();
  e.run(`var r=rooms.get('mesa-humanos');
    for (let i=0;i<2;i++) {
      accounts['u'+i]={username:'u'+i,bankroll:50000};
      const ws={OPEN:1,readyState:1,send(){}};
      clients.set(ws,{id:'u'+i,username:'u'+i,roomId:null,seatIndex:-1});joinRoom(ws,r.id,5000);
    }`);
  e.tick(e.run('r.timer'));
  assert.equal(e.run('r.seats.filter(Boolean).length'), 2);
  assert.equal(e.run('r.seats.filter(s=>s?.isBot).length'), 0);
  assert.equal(e.run('r.handInProgress'), true);
});

test('impossible bots finish a hand with legal actions and preserve chips', () => {
  const e = engine();
  e.run(`var r=makeRoom([500,500]);r.botDifficulty='impossible';startNewHand(r);`);
  for (let step=0;e.run("r.stage !== 'showdown'") && step<100;step++) {
    e.tick(e.run('r.currentTurnSeat === null ? r.streetTimer : r.botTimer'));
  }
  assert.equal(e.run('r.stage'), 'showdown');
  assert.equal(e.run('r.seats.filter(Boolean).reduce((sum,s)=>sum+s.chips,0)'),1000);
});
