const fs = require('node:fs');
const path = require('node:path');
const { AsyncLocalStorage } = require('node:async_hooks');

function normalize(value = {}) {
  return { version: 5, projects: [], nodes: [], edges: [], users: [], sessions: [], invites: [], usage: [], jobs: [], bills: {}, cloudRecords: {}, uploadTickets: {}, loginAttempts: {}, ...value };
}

module.exports = function createStore({ file, databaseUrl, pool: suppliedPool, tos = false }) {
  if (tos) return require('./tos-state-store')();
  const remote = Boolean(databaseUrl || suppliedPool);
  const pool = suppliedPool || (remote ? new (require('pg').Pool)({ connectionString: databaseUrl, max: 4, connectionTimeoutMillis: 15000, idleTimeoutMillis: 10000, allowExitOnIdle: true }) : null);
  const context = new AsyncLocalStorage();
  let local = !remote && fs.existsSync(file) ? normalize(JSON.parse(fs.readFileSync(file, 'utf8'))) : normalize();
  let initialized;
  const current = () => context.getStore()?.data || (remote ? (() => { throw new Error('Database context is required'); })() : local);
  const state = new Proxy({}, { get: (_, key) => current()[key], set: (_, key, value) => { current()[key] = value; return true; }, ownKeys: () => Reflect.ownKeys(current()), getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }) });
  function save() {
    const ctx = context.getStore();
    if (ctx) { ctx.dirty = true; return; }
    if (remote) throw new Error('Database context is required');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(local, null, 2)); fs.renameSync(tmp, file);
  }
  async function init() {
    if (!remote) return;
    if (!initialized) initialized = (async () => {
      await pool.query('CREATE TABLE IF NOT EXISTS canvas_workspace (id integer PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())');
      await pool.query('INSERT INTO canvas_workspace (id, data) VALUES (1, $1::jsonb) ON CONFLICT (id) DO NOTHING', [JSON.stringify(normalize())]);
    })().catch(e => { initialized = null; throw e; });
    return initialized;
  }
  // One private shared workspace. Row locking prevents lost updates across Vercel instances.
  async function transaction(fn, { readOnly = false } = {}) {
    if (context.getStore()) return fn();
    await init();
    const client = remote ? await pool.connect() : null;
    try {
      if (client) await client.query('BEGIN');
      const data = client ? normalize((await client.query('SELECT data FROM canvas_workspace WHERE id = 1' + (readOnly ? '' : ' FOR UPDATE'))).rows[0].data) : structuredClone(local);
      const ctx = { data, dirty: false };
      const result = await context.run(ctx, fn);
      if (ctx.dirty) {
        if (readOnly) throw new Error('Read-only request attempted to write');
        if (client) await client.query('UPDATE canvas_workspace SET data = $1::jsonb, updated_at = now() WHERE id = 1', [JSON.stringify(data)]);
        else { local = data; save(); }
      }
      if (client) await client.query('COMMIT');
      return result;
    } catch (error) { if (client) await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client?.release(); }
  }
  function middleware(request, response, next) {
    if (!remote) return next();
    const originalEnd = response.end;
    let endArgs;
    let finished;
    const completion = new Promise(resolve => { finished = resolve; });
    response.end = function (...args) { endArgs = args; finished(); return this; };
    transaction(async () => { next(); await completion; }).then(() => {
      response.end = originalEnd;
      if (endArgs && !response.destroyed) originalEnd.apply(response, endArgs);
    }).catch(() => {
      response.end = originalEnd;
      if (!response.headersSent && !response.destroyed) {
        response.removeHeader('Content-Length'); response.status(503).json({ error: '云数据库暂时不可用，请稍后重试' });
      } else response.destroy();
    });
  }
  return { state, save, transaction, middleware, remote, init, close: () => pool?.end() };
};
module.exports.normalize = normalize;
