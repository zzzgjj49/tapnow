const { AsyncLocalStorage } = require('node:async_hooks');
const crypto = require('node:crypto');
const { TosClient } = require('@volcengine/tos-sdk');
const { normalize } = require('./state-store');

// A conditional-write lease serializes a small private workspace across servers.
// ETags fence expired writers; application callbacks are never blindly replayed.
module.exports = function tosStateStore({ client: suppliedClient, config = process.env, leaseMs = 120000, waitMs = 20000 } = {}) {
  const key = config.TOS_STATE_KEY || 'canvas/private/workspace.json';
  if (!key.startsWith('canvas/private/')) throw new Error('账号数据必须存放在 canvas/private/ 下');
  const client = suppliedClient || new TosClient({ accessKeyId: config.TOS_ACCESS_KEY, accessKeySecret: config.TOS_SECRET_KEY,
    bucket: config.TOS_BUCKET, endpoint: new URL(config.TOS_ENDPOINT).host, region: config.TOS_REGION,
    secure: true, maxRetryCount: 0, requestTimeout: 15000, connectionTimeout: 10000 });
  const context = new AsyncLocalStorage();
  const conflict = error => [409, 412].includes(error.statusCode);
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const current = () => { const ctx = context.getStore(); if (!ctx) throw new Error('Cloud state context is required'); return ctx; };
  const state = new Proxy({}, { get: (_, name) => current().data[name], set: (_, name, value) => { current().data[name] = value; return true; },
    ownKeys: () => Reflect.ownKeys(current().data), getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }) });
  async function write(document, condition) {
    const response = await client.putObject({ key, body: JSON.stringify(document), contentType: 'application/json', cacheControl: 'no-store', ...condition });
    if (!response.headers.etag) throw new Error('云存储未返回版本号');
    return response.headers.etag;
  }
  async function read() {
    try {
      const response = await client.getObjectV2({ key, dataType: 'buffer' });
      const document = JSON.parse(response.data.content.toString());
      if (document.format !== 'canvas-state-v1' || !document.data || !response.headers.etag) throw new Error('无效的云端项目数据');
      return { document, etag: response.headers.etag };
    } catch (error) {
      if (error.statusCode !== 404) throw error;
      const document = { format: 'canvas-state-v1', revision: 0, data: normalize(), lease: null };
      try { await write(document, { forbidOverwrite: true }); } catch (e) { if (!conflict(e)) throw e; }
      return read();
    }
  }
  async function transaction(fn, { readOnly = false } = {}) {
    if (context.getStore()) return fn();
    if (readOnly) {
      const { document } = await read();
      return context.run({ data: normalize(document.data), dirty: false, readOnly: true }, fn);
    }
    const owner = crypto.randomUUID(), deadline = Date.now() + waitMs;
    let locked;
    do {
      const snapshot = await read();
      if (!snapshot.document.lease || snapshot.document.lease.until < Date.now()) {
        const document = { ...snapshot.document, lease: { owner, until: Date.now() + leaseMs } };
        try { locked = { document, etag: await write(document, { ifMatch: snapshot.etag }) }; break; }
        catch (e) { if (!conflict(e)) throw e; }
      }
      await pause(60 + Math.random() * 160);
    } while (Date.now() < deadline);
    if (!locked) throw new Error('其他成员正在保存，请稍后重试');
    const ctx = { data: normalize(structuredClone(locked.document.data)), dirty: false };
    let renewing = Promise.resolve(), leaseError, finished = false;
    const timer = setInterval(() => {
      renewing = renewing.then(async () => {
        if (leaseError) return;
        if (locked.document.lease.until <= Date.now()) throw new Error('保存超时，请刷新后重试');
        const renewed = { ...locked.document, lease: { owner, until: Date.now() + leaseMs } };
        locked.etag = await write(renewed, { ifMatch: locked.etag }); locked.document = renewed;
      }).catch(e => { leaseError = e; });
    }, Math.max(10, Math.floor(leaseMs / 3)));
    timer.unref?.();
    try {
      const result = await context.run(ctx, fn);
      clearInterval(timer); await renewing;
      if (leaseError) throw leaseError;
      if (locked.document.lease.until <= Date.now()) throw new Error('保存超时，请刷新后重试');
      await write({ ...locked.document, revision: locked.document.revision + (ctx.dirty ? 1 : 0),
        data: ctx.dirty ? ctx.data : locked.document.data, lease: null }, { ifMatch: locked.etag });
      finished = true;
      return result;
    } finally {
      clearInterval(timer); await renewing;
      if (!finished && !leaseError) await write({ ...locked.document, lease: null }, { ifMatch: locked.etag }).catch(() => {});
    }
  }
  function save() { const ctx = current(); if (ctx.readOnly) throw new Error('Read-only request attempted to write'); ctx.dirty = true; }
  function middleware(req, res, next) {
    const originalEnd = res.end;
    let endArgs, finish;
    const completion = new Promise(resolve => { finish = resolve; });
    res.end = function (...args) { endArgs = args; finish(); return this; };
    const onClose = () => finish();
    res.once('close', onClose);
    transaction(async () => { next(); await completion; }).then(() => {
      res.end = originalEnd;
      if (endArgs && !res.destroyed) originalEnd.apply(res, endArgs);
    }).catch(() => {
      res.end = originalEnd;
      if (!res.headersSent && !res.destroyed) {
        res.removeHeader('Content-Length'); res.removeHeader('Set-Cookie');
        res.status(503).json({ error: '云端数据保存暂时失败，请稍后重试' });
      } else res.destroy();
    }).finally(() => res.removeListener('close', onClose));
  }
  return { state, save, transaction, middleware, remote: true, backend: 'tos', init: () => read(), close: async () => {} };
};
