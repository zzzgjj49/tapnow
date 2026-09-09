const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const VideoModels = require("../public/video-models");

test("reference screenshot presets normalize incompatible settings and estimate total cost", () => {
  const fast = VideoModels.normalize({ model: "Seedance 2.0 Fast", resolution: "4k", duration: 30, method: "edit", ratio: "adaptive", count: 2 });
  assert.equal(fast.resolution, "720p");
  assert.equal(fast.duration, 15);
  assert.equal(fast.method, "omni");
  assert.equal(fast.ratio, "16:9");
  assert.equal(VideoModels.estimate(fast), 600);
  assert.equal(VideoModels.estimate({ model: "Seedance 2.0", resolution: "4k", duration: 15, count: 1 }), 1815);
  assert.equal(VideoModels.estimate({ model: "Seedance 2.5", resolution: "720p", duration: 30, count: 1 }), 1200);
  assert.equal(VideoModels.normalize({ model: "Seedance 2.5", duration: 29, method: "edit" }).duration, 29);
});

test("video settings, media references, async batches, failure recovery and downloads work through HTTP", async () => {
  const submissions = [];
  let scenario = "async";
  let statusFailure = false;
  const gateway = http.createServer(async (request, response) => {
    if (request.url.startsWith("/result")) { response.setHeader("Content-Type", "video/mp4"); return response.end("test-media-bytes"); }
    response.setHeader("Content-Type", "application/json");
    if (request.method === "GET") {
      if (statusFailure) { response.statusCode = 503; return response.end(JSON.stringify({ error: "查询暂时不可用" })); }
      return response.end(JSON.stringify({ status: "complete", outputUrl: `${gatewayUrl}/result-${request.url.split("/").at(-1)}.mp4` }));
    }
    let body = "";
    for await (const chunk of request) body += chunk;
    const payload = JSON.parse(body);
    submissions.push(payload);
    if (scenario === "failure") { response.statusCode = 500; return response.end(JSON.stringify({ error: "测试生成失败" })); }
    if (scenario === "malformed") return response.end(JSON.stringify({ status: "complete" }));
    response.end(JSON.stringify({ status: "queued", jobId: `job-${submissions.length}` }));
  });
  gateway.listen(0, "127.0.0.1");
  await once(gateway, "listening");
  const gatewayUrl = `http://127.0.0.1:${gateway.address().port}`;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "video-workflow-"));
  const port = 37000 + Math.floor(Math.random() * 1000);
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ["server.js"], { cwd: path.resolve(__dirname, ".."), stdio: "ignore", env: { ...process.env, CANVAS_LOAD_ENV: "0", TOS_STORAGE_ENABLED: "0", VIDEO_GENERATION_PROVIDER: "gateway", PORT: String(port), HOST: "127.0.0.1", DATA_DIR: dataDir, VIDEO_GENERATION_API_URL: `${gatewayUrl}/jobs` } });
  async function request(url, method = "GET", body, expected = 200) {
    const response = await fetch(base + url, { method, ...(body !== undefined ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
    const value = await response.json();
    assert.equal(response.status, expected, JSON.stringify(value));
    return value;
  }
  try {
    for (let i = 0; i < 80; i++) {
      try { if ((await fetch(base + "/api/health")).ok) break; } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const project = await request("/api/projects", "POST", { name: "异步流程测试" }, 201);
    const node = await request(`/api/projects/${project.id}/video-nodes`, "POST", {}, 201);
    const endpoint = `/api/nodes/${node.id}`;
    let updated = await request(endpoint, "PATCH", { generation: { model: "Seedance 2.5", method: "omni", ratio: "adaptive", resolution: "720p", duration: 30, audio: false, count: 4, prompt: "参考素材制作视频" } });
    assert.equal(updated.generation.duration, 30);
    assert.equal(updated.generation.ratio, "adaptive");
    assert.equal(updated.generation.method, "omni");
    const form = new FormData();
    form.append("files", new Blob(["image"], { type: "image/png" }), "ref.png");
    form.append("files", new Blob(["video"], { type: "video/mp4" }), "ref.mp4");
    form.append("files", new Blob(["audio"], { type: "audio/wav" }), "ref.wav");
    const uploaded = await (await fetch(`${base}/api/projects/${project.id}/nodes/${node.id}/references`, { method: "POST", body: form })).json();
    assert.deepEqual(uploaded.generation.references.map((ref) => ref.type), ["image", "video", "audio"]);
    updated = await request(endpoint + "/generate", "POST");
    assert.equal(updated.generation.jobs.length, 4);
    assert.equal(updated.generation.status, "generating");
    assert.equal(submissions.length, 4);
    assert.equal(submissions[0].settings.duration, 30);
    assert.equal(submissions[0].settings.audio, false);
    assert.equal(submissions[0].settings.count, 1);
    assert.equal(submissions[0].batchCount, 4);
    assert.equal(submissions[0].references.length, 3);
    await request(endpoint + "/generate", "POST", undefined, 409);
    statusFailure = true;
    updated = await request(endpoint + "/generation");
    assert.equal(updated.generation.status, "generating");
    assert.match(updated.generation.pollError, /查询暂时不可用/);
    statusFailure = false;
    updated = await request(endpoint + "/generation");
    assert.equal(updated.generation.status, "complete");
    assert.equal(updated.generation.outputs.length, 4);
    const picked = await request(endpoint, "PATCH", { generation: { selectedOutputId: "3" } });
    assert.equal(picked.url, updated.generation.outputs[3].url);
    const download = await fetch(base + endpoint + "/download");
    assert.equal(download.status, 200);
    assert.match(download.headers.get("content-disposition"), /attachment/);
    assert.equal(await download.text(), "test-media-bytes");
    const disk = JSON.parse(fs.readFileSync(path.join(dataDir, "canvas-data.json"), "utf8"));
    assert.equal(disk.nodes[0].generation.outputs.length, 4);
    await request(endpoint, "PATCH", { generation: { method: "edit", count: 1 } });
    await request(endpoint + "/generate", "POST");
    assert.equal(submissions.at(-1).references.find((ref) => ref.type === "video").role, "source-video");
    await request(endpoint + "/generation");
    await request(endpoint, "PATCH", { generation: { model: "Seedance 2.0 Fast", method: "omni", duration: 30, resolution: "4k" } });
    const saved = await request(`/api/projects/${project.id}`);
    assert.equal(saved.nodes[0].generation.duration, 15);
    assert.equal(saved.nodes[0].generation.resolution, "720p");
    scenario = "failure";
    updated = await request(endpoint + "/generate", "POST");
    assert.equal(updated.generation.status, "failed");
    assert.match(updated.generation.error, /测试生成失败/);
    scenario = "async";
    updated = await request(endpoint + "/generate", "POST");
    assert.equal(updated.generation.status, "generating");
    await request(endpoint + "/generation");
    scenario = "malformed";
    updated = await request(endpoint + "/generate", "POST");
    assert.equal(updated.generation.status, "failed");
    const empty = await request(`/api/projects/${project.id}/video-nodes`, "POST", {}, 201);
    await request(`/api/nodes/${empty.id}`, "PATCH", { generation: { model: "Seedance 2.5", method: "edit", prompt: "编辑" } });
    const invalid = await request(`/api/nodes/${empty.id}/generate`, "POST", undefined, 400);
    assert.match(invalid.error, /参考视频/);
    scenario = "async";
    await request(`/api/nodes/${empty.id}`, "PATCH", { generation: { model: "Kling 3.0", method: "text", multiShot: true } });
    await request(`/api/nodes/${empty.id}/generate`, "POST");
    assert.equal(submissions.at(-1).settings.multiShot, true);
    await request(`/api/nodes/${empty.id}/generation`);
    await request(`/api/nodes/${empty.id}`, "PATCH", { generation: { method: "first-last" } });
    const frames = new FormData();
    frames.append("files", new Blob(["first"], { type: "image/png" }), "first.png");
    frames.append("files", new Blob(["last"], { type: "image/png" }), "last.png");
    const frameResponse = await fetch(`${base}/api/projects/${project.id}/nodes/${empty.id}/references`, { method: "POST", body: frames });
    assert.equal(frameResponse.status, 201);
    await request(`/api/nodes/${empty.id}/generate`, "POST");
    assert.deepEqual(submissions.at(-1).references.map((ref) => ref.role), ["first-frame", "last-frame"]);
  } finally {
    server.kill(); await once(server, "exit");
    gateway.close(); await once(gateway, "close");
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
