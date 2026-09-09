const { PGlite } = require('@electric-sql/pglite');
const express = require('express');
const crypto = require('node:crypto');
const createStore = require('../state-store');
const createMedia = require('../cloud-media');
const createJobs = require('../cloud-jobs');
module.exports = async function fixture() {
  const pg = new PGlite();
  let gate = Promise.resolve();
  const pool = {
    async connect() { const previous = gate; let release; gate = new Promise(r => release = r); await previous; return { query: (sql, args) => pg.query(sql, args), release }; },
    async query(sql, args) { const c = await pool.connect(); try { return await c.query(sql, args); } finally { c.release(); } },
    end: () => pg.close(),
  };
  const objects = new Map(), parts = new Map(), messages = [], requests = [];
  let counter = 0, queueFails = false, submitFails = false, pollFails = false;
  const network = express();
  network.use((req, res, next) => { res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Methods', 'PUT,GET,HEAD,OPTIONS'); res.setHeader('Access-Control-Allow-Headers', '*'); if (req.method === 'OPTIONS') return res.end(); next(); });
  network.put('/part/:uploadId/:number', express.raw({ type: () => true, limit: '12mb' }), (req, res) => {
    const upload = parts.get(req.params.uploadId); if (!upload) return res.sendStatus(404);
    upload.parts.set(Number(req.params.number), req.body); res.setHeader('ETag', 'part-' + req.params.number); res.sendStatus(200);
  });
  network.get('/object/:key', (req, res) => { const bytes = objects.get(req.params.key); if (!bytes) return res.sendStatus(404); res.type('video/mp4').send(bytes); });
  network.get('/result.mp4', (_req, res) => res.type('video/mp4').send(Buffer.from('test-generated-video')));
  network.use(express.json());
  network.post('/jobs', (req, res) => { requests.push(req.body); if (submitFails) return res.status(500).json({ error: 'submission unknown' }); res.json({ jobId: 'provider-' + (++counter), status: 'generating' }); });
  network.get('/jobs/:id', (_req, res) => pollFails ? res.status(503).json({ error:'poll unavailable' }) : res.json({ status: 'complete', outputUrl: networkUrl + '/result.mp4', usage: { completion_tokens: 123, total_tokens: 123 } }));
  const networkServer = network.listen(0, '127.0.0.1'); await new Promise(r => networkServer.once('listening', r));
  const networkUrl = 'http://127.0.0.1:' + networkServer.address().port;
  const tos = {
    async createMultipartUpload({ key }) { const UploadId = crypto.randomUUID(); parts.set(UploadId, { key, parts: new Map() }); return { data: { UploadId } }; },
    getPreSignedUrl({ key, query }) { return query ? `${networkUrl}/part/${query.uploadId}/${query.partNumber}` : `${networkUrl}/object/${encodeURIComponent(key)}`; },
    async listParts({ uploadId }) { const p = parts.get(uploadId); if (!p) throw new Error('missing upload'); return { data: { Parts: [...p.parts.entries()].sort((a,b) => a[0]-b[0]).map(([n,b]) => ({ PartNumber: n, ETag: 'part-' + n, Size: b.length })), IsTruncated: false } }; },
    async completeMultipartUpload({ uploadId, key }) { const p = parts.get(uploadId); objects.set(key, Buffer.concat([...p.parts.entries()].sort((a,b) => a[0]-b[0]).map(x => x[1]))); parts.delete(uploadId); return { data: { ETag: 'completed' } }; },
    async headObject({ key }) { if (!objects.has(key)) throw { statusCode: 404 }; return { data: { 'content-length': String(objects.get(key).length), etag: 'completed' } }; },
    async uploadPart({ uploadId, partNumber, body }) { parts.get(uploadId).parts.set(partNumber, Buffer.from(body)); return { data: { ETag: 'part-' + partNumber } }; },
    async putObject({ key, body }) { objects.set(key, Buffer.from(body)); return { data: { ETag: 'completed' } }; },
    async abortMultipartUpload({ uploadId }) { parts.delete(uploadId); },
  };
  Object.assign(process.env, { CANVAS_LOAD_ENV: '0', DATABASE_URL: 'postgres://test-only', ADMIN_EMAIL: 'owner@example.com', ADMIN_PASSWORD: 'owner-test-password', APP_URL: 'https://canvas.test', TOS_BUCKET: 'test-bucket', TOS_ENDPOINT: networkUrl,
    TOS_REGION: 'test', VIDEO_GENERATION_PROVIDER: 'gateway', VIDEO_GENERATION_API_URL: networkUrl + '/jobs', VIDEO_GENERATION_API_KEY: 'test-model-key', QSTASH_CURRENT_SIGNING_KEY: 'test-signing-key', QSTASH_NEXT_SIGNING_KEY: 'next-test-key' });
  let store, jobs;
  require.cache[require.resolve('../state-store')].exports = options => { store = createStore({ ...options, pool }); return store; };
  require.cache[require.resolve('../cloud-media')].exports = options => createMedia({ ...options, client: tos });
  require.cache[require.resolve('../cloud-jobs')].exports = options => { jobs = createJobs({ ...options, queue: { async publishJSON(message) { if (queueFails) throw new Error('queue down'); messages.push(message); return { messageId: String(messages.length) }; } } }); return jobs; };
  const app = require('../server');
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  async function api(url, body, cookie, method = body ? 'POST' : 'GET', headers = {}) {
    const response = await fetch(base + url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'manual' });
    const data = await response.json().catch(() => null); return { status: response.status, data, cookie: response.headers.get('set-cookie')?.split(';')[0], headers: response.headers };
  }
  return { app, base, api, store, jobs, pool, pg, objects, parts, messages, requests, setQueueFailure: value => queueFails = value, setSubmitFailure: value => submitFails = value, setPollFailure: value => pollFails = value,
    async close() { await new Promise(r => server.close(r)); await new Promise(r => networkServer.close(r)); await pg.close(); } };
};
