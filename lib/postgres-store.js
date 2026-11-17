const { Pool } = require('pg');

// One atomic snapshot preserves transfers between wallets, table stacks and pots.
// Revision checks fence an older process during Render's overlapping deployments.
function createPostgresStore(connectionString, options = {}) {
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Invalid database URL');
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  // Always verify certificates for external providers, including Neon.
  if (!local) url.searchParams.set('sslmode', 'verify-full');
  const pool = options.pool || new Pool({
    connectionString: url.toString(), max: 1,
    connectionTimeoutMillis: 15000, query_timeout: 20000,
    idleTimeoutMillis: 30000
  });
  pool.on('error', options.onError || (() => {}));
  let revision;
  return {
    async load(seed = {}) {
      await pool.query(`CREATE TABLE IF NOT EXISTS maxpoker_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        accounts JSONB NOT NULL CHECK (jsonb_typeof(accounts) = 'object'),
        revision BIGINT NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      // A seed is imported only once. Subsequent starts never overwrite the database.
      await pool.query(`INSERT INTO maxpoker_state (id, accounts) VALUES (1, $1::jsonb)
        ON CONFLICT (id) DO NOTHING`, [JSON.stringify(seed)]);
      const result = await pool.query('SELECT accounts, revision FROM maxpoker_state WHERE id = 1');
      revision = result.rows[0].revision;
      return result.rows[0].accounts;
    },
    async save(accounts) {
      const result = await pool.query(`UPDATE maxpoker_state SET accounts = $1::jsonb,
        revision = revision + 1, updated_at = NOW()
        WHERE id = 1 AND revision = $2 RETURNING revision`, [JSON.stringify(accounts), revision]);
      if (result.rowCount !== 1) throw new Error('Another server owns the account state');
      revision = result.rows[0].revision;
    },
    close: () => pool.end()
  };
}

// No success messages are delivered until the database has acknowledged the write.
function createDurableQueue({ commit, begin, publish, fail }) {
  let tail = Promise.resolve();
  let stopped = false;
  return {
    run(action) {
      const result = tail.then(async () => {
        if (stopped) return;
        begin();
        try {
          await action();
          await commit();
          publish();
        } catch (error) {
          stopped = true;
          fail(error);
        }
      });
      tail = result;
      return result;
    }
  };
}

module.exports = { createPostgresStore, createDurableQueue };
