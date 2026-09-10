// Writes only small, uniquely named verification objects. Never prints credentials.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { TosClient } = require('@volcengine/tos-sdk');
const root = path.resolve(__dirname, '..');
if (process.env.CANVAS_LOAD_ENV !== '0') process.loadEnvFile(path.join(root, '.env'));
async function main() {
  const config = process.env;
  const client = new TosClient({ accessKeyId: config.TOS_ACCESS_KEY, accessKeySecret: config.TOS_SECRET_KEY, bucket: config.TOS_BUCKET,
    endpoint: new URL(config.TOS_ENDPOINT).host, region: config.TOS_REGION, secure: true, maxRetryCount: 0, requestTimeout: 15000 });
  const key = 'canvas/deployment-verification/state-' + crypto.randomUUID() + '.json';
  const put = (value, options = {}) => client.putObject({ key, body: JSON.stringify(value), contentType: 'application/json', ...options });
  await put({ revision: 0 }, { forbidOverwrite: true });
  await assert.rejects(put({ revision: 99 }, { forbidOverwrite: true }), e => e.statusCode === 409 || e.statusCode === 412);
  const initial = await client.getObjectV2({ key, dataType: 'buffer' });
  const etag = initial.headers.etag;
  assert.ok(etag, 'TOS must return an ETag');
  await assert.rejects(put({ revision: 99 }, { ifMatch: '00000000000000000000000000000000' }), e => e.statusCode === 412);
  const outcomes = await Promise.allSettled([put({ revision: 1 }, { ifMatch: etag }), put({ revision: 2 }, { ifMatch: etag })]);
  assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1, 'Only one concurrent update may succeed');
  assert.equal(outcomes.find(r => r.status === 'rejected')?.reason.statusCode, 412);
  const current = await client.getObjectV2({ key, dataType: 'buffer' });
  assert.ok([1, 2].includes(JSON.parse(current.data.content.toString()).revision));
  const result = { key, createOnly: 'passed', staleVersion: 'passed', concurrentUpdate: 'passed', checkedAt: new Date().toISOString() };
  fs.mkdirSync(path.join(root, '.run'), { recursive: true });
  fs.writeFileSync(path.join(root, '.run/tos-state-verification.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
}
main().catch(error => { console.error(JSON.stringify({ check: 'failed', code: error.code || error.name, status: error.statusCode || null })); process.exitCode = 1; });
