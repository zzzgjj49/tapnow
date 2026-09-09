const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { once } = require("node:events");
const createStorage = require("../cloud-storage");

test("private storage deduplicates uploads, persists keys, signs on demand, retries and archives results", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "canvas-storage-"));
  const uploadDir = path.join(dataDir, "uploads");
  fs.mkdirSync(path.join(uploadDir, "project"), { recursive: true });
  const media = Buffer.from("fixture-media");
  const file = path.join(uploadDir, "project", "movie.mp4");
  fs.writeFileSync(file, media);
  let fail = false;
  let puts = 0;
  let signatures = 0;
  const client = {
    async putObject(input) { puts++; const parts = []; for await (const c of input.body) parts.push(c); if (fail) throw { code: "AccessDenied" }; assert.ok(Buffer.concat(parts).length); return { data: { ETag: "fixture" } }; },
    getPreSignedUrl(input) { assert.equal(input.bucket, "test-bucket"); return `https://storage.example/${input.key}?expires=${input.expires}&signature=${++signatures}`; },
  };
  const config = { TOS_BUCKET: "test-bucket", TOS_REGION: "test", TOS_ENDPOINT: "https://storage.example" };
  const store = createStorage({ dataDir, uploadDir, client, config });
  const url = "/uploads/project/movie.mp4";
  const server = http.createServer((_req, res) => res.end(media));
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  try {
    await Promise.all([store.backup(url), store.backup(url)]);
    assert.equal(puts, 1); assert.equal(store.state(url).status, "ready");
    assert.notEqual(store.signedUrl(url), store.signedUrl(url));
    const reloaded = createStorage({ dataDir, uploadDir, client, config });
    await reloaded.backup(url); assert.equal(puts, 1);
    const payload = await store.preparePayload({ references: [{ type: "video", path: file }] });
    assert.ok(!payload.references[0].path); assert.match(payload.references[0].url, /^https:/);
    assert.match(payload.references[0].url, /expires=86400/);
    await assert.rejects(store.backup("/uploads/../../outside.mp4"), /路径/);
    fs.writeFileSync(path.join(uploadDir, "project", "retry.png"), media);
    fail = true;
    await assert.rejects(store.backup("/uploads/project/retry.png"), /AccessDenied/);
    assert.equal(store.summary().failed, 1);
    fail = false; store.retry();
    await store.backup("/uploads/project/retry.png"); assert.equal(store.summary().failed, 0);
    const job = { index: 0, status: "complete", jobId: "native-job", outputUrl: `http://127.0.0.1:${server.address().port}/video.mp4` };
    const node = { id: "node", projectId: "project", type: "video", generation: { runId: "run" } };
    await store.archiveJob(node, job);
    assert.equal(job.storageStatus, "ready"); assert.match(job.outputUrl, /^\/uploads\/project\/generated-/);
    assert.deepEqual(fs.readFileSync(store.localFile(job.outputUrl)), media);
    const oldPuts = puts; await store.archiveJob(node, job); assert.equal(puts, oldPuts);
    assert.ok(!fs.readFileSync(path.join(dataDir, "cloud-storage.json"), "utf8").includes("signature="));
    fs.unlinkSync(file);
    assert.match(reloaded.signedUrl(url), /^https:/);
  } finally { server.close(); fs.rmSync(dataDir, { recursive: true, force: true }); }
});
