const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDurableQueue, createPostgresStore } = require('../lib/postgres-store');

test('success is delivered only after the durable write and actions stay ordered', async () => {
  const events = [];
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  let commits = 0;
  const queue = createDurableQueue({
    begin: () => events.push('begin'),
    commit: async () => { if (++commits === 1) await barrier; events.push('saved'); },
    publish: () => events.push('sent'), fail: error => { throw error; }
  });
  const first = queue.run(() => events.push('register'));
  const second = queue.run(() => events.push('bonus'));
  await new Promise(setImmediate);
  assert.deepEqual(events, ['begin', 'register']);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(events, ['begin', 'register', 'saved', 'sent', 'begin', 'bonus', 'saved', 'sent']);
});

test('database failure sends no success and stops subsequent mutations', async () => {
  let published = false, failed = false, laterRan = false;
  const queue = createDurableQueue({ begin() {}, commit: async () => { throw Error('offline'); },
    publish: () => { published = true; }, fail: () => { failed = true; } });
  await queue.run(() => {});
  await queue.run(() => { laterRan = true; });
  assert.equal(failed, true);
  assert.equal(published, false);
  assert.equal(laterRan, false);
});

test('database conflict rejects an obsolete writer instead of overwriting newer balances', async () => {
  const pool = { on() {}, end() {}, async query(sql, args) {
    if (sql.startsWith('SELECT')) return {rows:[{accounts:{},revision:'3'}]};
    if (sql.startsWith('UPDATE')) {
      assert.equal(args[1], '3');
      assert.deepEqual(JSON.parse(args[0]), {tester:{bankroll:50000}});
      return {rowCount:0,rows:[]};
    }
    return {rows:[]};
  } };
  const store = createPostgresStore('postgres://localhost/test', {pool});
  await store.load();
  await assert.rejects(store.save({tester:{bankroll:50000}}), /Another server/);
});
