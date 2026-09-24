const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { once } = require("node:events");
const { spawn } = require("node:child_process");
const BytePlus = require("../byteplus");

test("BytePlus converts local references and rejects unsupported requests before submission", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ark-media-"));
  const input = { model: "Seedance 2.0 Fast", prompt: "Landscape", settings: { method: "first-last", resolution: "480p", duration: 4, ratio: "16:9", audio: false }, references: [] };
  const previousEndpoint = process.env.ARK_SEEDANCE_20_FAST_ENDPOINT_ID;
  try {
    delete process.env.ARK_SEEDANCE_20_FAST_ENDPOINT_ID;
    fs.writeFileSync(path.join(dir, "first.png"), "fixture");
    input.references = [{ type: "image", path: path.join(dir, "first.png"), role: "first-frame" }, { type: "image", url: "https://example.com/last.png", role: "last-frame" }];
    const body = await BytePlus.payload(input, dir);
    assert.equal(body.model, "dreamina-seedance-2-0-fast-260128");
    assert.equal(body.content[1].role, "first_frame");
    assert.match(body.content[1].image_url.url, /^data:image\/png;base64,/);
    assert.equal(body.content[2].role, "last_frame");
    assert.equal(body.generate_audio, false);
    assert.equal(body.duration, 4);
    assert.ok(!JSON.stringify(body).includes(dir));
    process.env.ARK_SEEDANCE_20_FAST_ENDPOINT_ID = " ep-20260924191533-556d4 ";
    assert.equal((await BytePlus.payload(input, dir)).model, "ep-20260924191533-556d4");
    process.env.ARK_SEEDANCE_20_FAST_ENDPOINT_ID = "invalid-endpoint";
    await assert.rejects(BytePlus.payload(input, dir), /ARK_SEEDANCE_20_FAST_ENDPOINT_ID/);
    delete process.env.ARK_SEEDANCE_20_FAST_ENDPOINT_ID;
    await assert.rejects(BytePlus.payload({ ...input, model: "Kling 3.0" }, dir), /未接入/);
    await assert.rejects(BytePlus.payload({ ...input, settings: { ...input.settings, resolution: "1080p" } }, dir), /清晰度/);
    await assert.rejects(BytePlus.payload({ ...input, references: [{ type: "audio", url: "https://example.com/ref.mp3" }] }, dir), /同时提供/);
    const omni = await BytePlus.payload({ ...input, settings: { ...input.settings, method: "omni" }, references: [{ type: "video", url: "https://example.com/ref.mp4" }, { type: "audio", url: "https://example.com/ref.mp3" }] }, dir);
    assert.equal(omni.content[1].role, "reference_video");
    assert.equal(omni.content[2].role, "reference_audio");
    assert.equal(BytePlus.result({ status: "expired" }).status, "failed");
  } finally {
    if (previousEndpoint === undefined) delete process.env.ARK_SEEDANCE_20_FAST_ENDPOINT_ID;
    else process.env.ARK_SEEDANCE_20_FAST_ENDPOINT_ID = previousEndpoint;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("BytePlus native HTTP contract authenticates, polls, persists usage, downloads and reports provider errors", async () => {
  let scenario = "success";
  const submissions = [];
  const provider = http.createServer(async (req, res) => {
    if (req.url === "/result.mp4") { res.setHeader("Content-Type", "video/mp4"); return res.end("fixture-video"); }
    assert.equal(req.headers.authorization, "Bearer test-only-key");
    res.setHeader("Content-Type", "application/json");
    if (req.method === "POST") {
      let body = ""; for await (const chunk of req) body += chunk;
      submissions.push(JSON.parse(body));
      if (scenario === "denied") { res.statusCode = 403; return res.end(JSON.stringify({ error: { code: "AccessDenied", message: "Model not enabled" } })); }
      return res.end(JSON.stringify({ id: `cgt-${submissions.length}` }));
    }
    if (scenario === "expired") return res.end(JSON.stringify({ id: "cgt-expired", status: "expired" }));
    res.end(JSON.stringify({ id: req.url.split("/").at(-1), status: "succeeded", content: { video_url: `${providerUrl}/result.mp4` }, usage: { completion_tokens: 100 } }));
  });
  provider.listen(0, "127.0.0.1"); await once(provider, "listening");
  const providerUrl = `http://127.0.0.1:${provider.address().port}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ark-http-"));
  const port = 39000 + Math.floor(Math.random() * 1000);
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["server.js"], { stdio: "ignore", cwd: path.resolve(__dirname, ".."), env: { ...process.env, CANVAS_LOAD_ENV: "0", TOS_STORAGE_ENABLED: "0", VIDEO_GENERATION_PROVIDER: "byteplus", ARK_API_KEY: "test-only-key", ARK_BASE_URL: providerUrl, ARK_SEEDANCE_20_FAST_ENDPOINT_ID: "ep-20260924191533-556d4", PORT: String(port), HOST: "127.0.0.1", DATA_DIR: dir } });
  const api = async (url, method = "GET", body) => {
    const res = await fetch(base + url, { method, headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    assert.ok(res.ok); return res.json();
  };
  try {
    for (let i = 0; i < 80; i++) { try { if ((await fetch(base + "/api/health")).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
    const config = await api("/api/config");
    assert.equal(config.videoModels.length, 3); assert.ok(!JSON.stringify(config).includes("test-only-key"));
    const project = await api("/api/projects", "POST", { name: "Native adapter test" });
    const node = await api(`/api/projects/${project.id}/video-nodes`, "POST", {});
    assert.equal(node.generation.model, "Seedance 2.0 Fast");
    const endpoint = `/api/nodes/${node.id}`;
    await api(endpoint, "PATCH", { generation: { prompt: "Mountain lake", count: 2, duration: 4, audio: false } });
    const submitted = await api(endpoint + "/generate", "POST");
    assert.equal(submitted.generation.status, "generating");
    assert.equal(submissions.length, 2);
    assert.equal(submissions[0].model, "ep-20260924191533-556d4");
    assert.deepEqual(Object.keys(submissions[0]).sort(), ["model", "content", "ratio", "resolution", "duration", "generate_audio", "watermark"].sort());
    const done = await api(endpoint + "/generation");
    assert.equal(done.generation.status, "complete");
    assert.equal(done.generation.outputs.length, 2);
    assert.equal(done.generation.jobs[0].usage.completion_tokens, 100);
    assert.equal(await (await fetch(base + endpoint + "/download")).text(), "fixture-video");
    scenario = "expired";
    await api(endpoint + "/generate", "POST");
    assert.equal((await api(endpoint + "/generation")).generation.status, "failed");
    scenario = "denied";
    const denied = await api(endpoint + "/generate", "POST");
    assert.match(denied.generation.error, /AccessDenied: Model not enabled/);
    assert.ok(!fs.readFileSync(path.join(dir, "canvas-data.json"), "utf8").includes("test-only-key"));
  } finally { child.kill(); await once(child, "exit"); provider.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
