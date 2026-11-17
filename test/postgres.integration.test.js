const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');
const WebSocket = require('ws');
const { createPostgresStore } = require('../lib/postgres-store');

test('real PostgreSQL: atomic snapshots, stale writers and account recovery after process loss',
  { skip: !process.env.TEST_DATABASE_URL, timeout: 60000 }, async t => {
  const admin = new Pool({connectionString:process.env.TEST_DATABASE_URL});
  const name = 'maxpoker_test_' + Date.now();
  await admin.query(`CREATE DATABASE ${name}`);
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.pathname = '/' + name;
  let child;
  const stores = [];
  const sockets = [];
  t.after(async () => {
    for (const ws of sockets) ws.terminate();
    if (child && child.exitCode === null) { child.kill(); await once(child, 'exit'); }
    for (const store of stores) await store.close();
    await admin.query(`DROP DATABASE ${name}`);
    await admin.end();
  });
  const first = createPostgresStore(url.toString()); stores.push(first);
  assert.deepEqual(await first.load(), {});
  await first.save({legacy:{username:'legacy',salt:'test',passwordHash:'test',bankroll:1200,tableEscrow:300}});
  const second = createPostgresStore(url.toString()); stores.push(second);
  const loaded = await second.load({shouldNotBeImported:{bankroll:999}});
  assert.equal(loaded.legacy.bankroll, 1200);
  assert.equal(loaded.shouldNotBeImported, undefined);
  await second.save(loaded);
  await assert.rejects(first.save({}), /Another server/);
  for (const store of stores.splice(0)) await store.close();

  async function start() {
    child = spawn(process.execPath, ['server.js'], {
      cwd:path.resolve(__dirname,'..'), windowsHide:true,
      env:{...process.env, DATABASE_URL:url.toString(),PORT:'3109',RENDER:'true',IMPORT_ACCOUNTS_FILE:''},
      stdio:['ignore','pipe','pipe']
    });
    await new Promise((resolve,reject) => {
      const timer=setTimeout(()=>reject(Error('server startup timeout')),15000);
      child.once('exit',()=>{clearTimeout(timer);reject(Error('server exited before ready'));});
      child.stdout.on('data',data=>{if(data.toString().includes('MAXpoker online')){clearTimeout(timer);resolve();}});
    });
    const health=await fetch('http://127.0.0.1:3109/healthz').then(r=>r.json());
    assert.equal(health.storage,'postgres');
  }
  async function connect() {
    const ws=new WebSocket('ws://127.0.0.1:3109');sockets.push(ws);
    ws.inbox=[];
    ws.on('message',data=>ws.inbox.push(JSON.parse(data)));
    await once(ws,'open');
    return ws;
  }
  async function request(ws,message,type) {
    ws.inbox=[];ws.send(JSON.stringify(message));
    const deadline=Date.now()+10000;
    while(Date.now()<deadline){
      const result=ws.inbox.find(m=>m.type===type);
      if(result)return result;
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    throw Error('Missing response: '+type);
  }
  await start();
  let ws=await connect();
  const auth=await request(ws,{type:'register',username:'Persistente',password:'Test-only-123'},'authSuccess');
  assert.equal(auth.account.bankroll,50000);
  const bonus=await request(ws,{type:'claimBonus'},'accountUpdate');
  assert.equal(bonus.account.bankroll,60000);
  const joined=await request(ws,{type:'joinRoom',roomId:'mesa-iniciante',buyInAmount:5000},'joinedRoom');
  assert.ok(joined.table.seats.some(s=>s?.name==='Persistente'&&s.chips===5000));
  // Terminate without a logout: confirmed money must survive a lost server process.
  child.kill();await once(child,'exit');
  await start();ws=await connect();
  const restored=await request(ws,{type:'login',username:'Persistente',password:'Test-only-123'},'authSuccess');
  assert.equal(restored.account.bankroll,60000);
  child.kill();await once(child,'exit');
  await start();ws=await connect();
  const again=await request(ws,{type:'login',username:'Persistente',password:'Test-only-123'},'authSuccess');
  assert.equal(again.account.bankroll,60000,'escrow must not be refunded twice');
});
