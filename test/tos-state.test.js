const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const createStore = require('../tos-state-store');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function fakeTos() {
  let object, version, writes = 0, rejectWrite = false;
  const failure = statusCode => Object.assign(new Error('TOS test response'), { statusCode });
  return {
    async getObjectV2() { if (!object) throw failure(404); return { headers: { etag: version }, data: { content: Buffer.from(object) } }; },
    async putObject({ body, ifMatch, forbidOverwrite }) {
      if (rejectWrite) throw failure(503);
      if (forbidOverwrite && object) throw failure(409);
      if (ifMatch && ifMatch !== version) throw failure(412);
      object = body; version = crypto.createHash('sha256').update(body).digest('hex'); writes++;
      return { headers: { etag: version } };
    },
    get document() { return JSON.parse(object); }, get version() { return version; }, get writes() { return writes; },
    failWrites(value) { rejectWrite = value; },
  };
}
test('TOS cloud state serializes concurrent servers, rolls back failures, persists users and fences stale writers', async () => {
  const client = fakeTos(), a = createStore({ client }), b = createStore({ client });
  await Promise.all([a.init(), b.init()]);
  await Promise.all(Array.from({ length: 12 }, (_, i) => {
    const store = i % 2 ? a : b;
    return store.transaction(async () => {
      const count = store.state.projects.length;
      await sleep(5);
      store.state.projects.push({ id: 'project-' + i, previous: count }); store.save();
    });
  }));
  assert.equal(client.document.data.projects.length, 12);
  assert.equal(new Set(client.document.data.projects.map(p => p.previous)).size, 12);
  await assert.rejects(a.transaction(() => { a.state.projects.length = 0; a.save(); throw new Error('rollback'); }), /rollback/);
  assert.equal(client.document.data.projects.length, 12);
  assert.equal(client.document.lease, null);
  await a.transaction(() => { a.state.users.push({ id: 'owner', role: 'admin', passwordHash: 'test-hash' }); a.save(); });
  const restarted = createStore({ client });
  await restarted.transaction(() => assert.equal(restarted.state.users[0].id, 'owner'), { readOnly: true });
  const writes = client.writes;
  await assert.rejects(a.transaction(() => a.save(), { readOnly: true }), /Read-only/);
  assert.equal(client.writes, writes);
  await assert.rejects(a.transaction(async () => {
    a.state.projects.push({ id: 'stale' }); a.save();
    // Simulate a frozen Vercel instance whose lease expired and a second owner.
    const document = client.document;
    document.lease.until = 0;
    await client.putObject({ body: JSON.stringify(document), ifMatch: client.version });
    await b.transaction(() => { b.state.projects.push({ id: 'new-owner' }); b.save(); });
  }), e => e.statusCode === 412);
  assert.equal(client.document.data.projects.some(p => p.id === 'stale'), false);
  assert.equal(client.document.data.projects.some(p => p.id === 'new-owner'), true);
  assert.equal(client.document.lease, null);
  await assert.rejects(a.transaction(() => { a.state.projects.push({ id: 'failed-write' }); a.save(); client.failWrites(true); }), e => e.statusCode === 503);
  client.failWrites(false);
  assert.equal(client.document.data.projects.some(p => p.id === 'failed-write'), false);
});
test('TOS lease renewals keep ownership while a slow callback completes', async () => {
  const client = fakeTos(), store = createStore({ client, leaseMs: 150 });
  await store.transaction(async () => {
    store.state.projects.push({ id: 'slow' }); store.save();
    await sleep(400);
    assert.ok(client.document.lease.until > Date.now());
  });
  assert.equal(client.document.data.projects[0].id, 'slow');
  assert.equal(client.document.lease, null);
});
