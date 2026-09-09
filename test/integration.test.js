const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { once } = require("node:events");

const execFileAsync = promisify(execFile);

async function waitForServer(url, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Test server did not start in time");
}

test("project and asset lifecycle persists through the HTTP API", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "material-canvas-test-"));
  const port = 34000 + Math.floor(Math.random() * 1000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ["server.js"], {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, CANVAS_LOAD_ENV: "0", TOS_STORAGE_ENABLED: "0", VIDEO_GENERATION_PROVIDER: "gateway", PORT: String(port), HOST: "127.0.0.1", DATA_DIR: dataDir },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await waitForServer(baseUrl);
    const result = await execFileAsync(process.execPath, ["scripts/smoke.js"], {
      cwd: path.resolve(__dirname, ".."),
      env: { ...process.env, CANVAS_LOAD_ENV: "0", TOS_STORAGE_ENABLED: "0", VIDEO_GENERATION_PROVIDER: "gateway", BASE_URL: baseUrl },
      timeout: 10_000,
    });
    assert.match(result.stdout, /Smoke test passed/);
    const projects = await (await fetch(`${baseUrl}/api/projects`)).json();
    assert.deepEqual(projects, []);
  } finally {
    server.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("text and image production persist results and pass selected outputs downstream", async () => {
  const payloads = [];
  const gateway = http.createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const payload = JSON.parse(body);
    payloads.push({ ...payload, authorization: request.headers.authorization });
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(payload.type === "text"
      ? { outputText: "一只纸船在雨中前行。" }
      : { outputUrl: "https://example.test/generated.png", status: "complete" }));
  });
  gateway.listen(0, "127.0.0.1");
  await once(gateway, "listening");
  const gatewayUrl = `http://127.0.0.1:${gateway.address().port}`;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "canvas-generation-test-"));
  const baseUrl = `http://127.0.0.1:${35000 + Math.floor(Math.random() * 1000)}`;
  const server = spawn(process.execPath, ["server.js"], {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, CANVAS_LOAD_ENV: "0", TOS_STORAGE_ENABLED: "0", VIDEO_GENERATION_PROVIDER: "gateway", PORT: new URL(baseUrl).port, HOST: "127.0.0.1", DATA_DIR: dataDir,
      TEXT_GENERATION_API_URL: gatewayUrl, TEXT_GENERATION_API_KEY: "text-test-key",
      IMAGE_GENERATION_API_URL: gatewayUrl, IMAGE_GENERATION_API_KEY: "image-test-key" },
    stdio: "ignore",
  });
  const request = async (url, method = "GET", body) => {
    const response = await fetch(`${baseUrl}${url}`, { method,
      headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    assert.ok(response.ok, `${method} ${url}: ${response.status}`);
    return response.status === 204 ? null : response.json();
  };
  try {
    await waitForServer(baseUrl);
    const project = await request("/api/projects", "POST", { name: "制作流程验证" });
    const create = (type) => request(`/api/projects/${project.id}/generator-nodes`, "POST", { type, x: 50, y: 60 });
    const textNode = await create("text");
    const imageNode = await create("image");
    assert.equal(textNode.kind, "generator");
    assert.equal(imageNode.generation.outputType, "image");
    let empty = await request(`/api/projects/${project.id}`);
    assert.equal(empty.coverUrl, null);
    const noPrompt = await fetch(`${baseUrl}/api/nodes/${textNode.id}/generate`, { method: "POST" });
    assert.equal(noPrompt.status, 400);
    await request(`/api/nodes/${textNode.id}`, "PATCH", { generation: { prompt: "写一个短镜头", model: "writer-test", style: "creative", length: "short" } });
    const textResult = await request(`/api/nodes/${textNode.id}/generate`, "POST");
    assert.equal(textResult.content, "一只纸船在雨中前行。");
    assert.equal(textResult.generation.status, "complete");
    assert.equal(payloads[0].settings.style, "creative");
    assert.equal(payloads[0].authorization, "Bearer text-test-key");
    await request(`/api/projects/${project.id}/edges`, "POST", { sourceNodeId: textNode.id, targetNodeId: imageNode.id });
    await request(`/api/nodes/${imageNode.id}`, "PATCH", { generation: { selectedReferenceNodeIds: [textNode.id], ratio: "16:9", resolution: "2048" } });
    const imageResult = await request(`/api/nodes/${imageNode.id}/generate`, "POST");
    assert.equal(imageResult.url, "https://example.test/generated.png");
    assert.equal(payloads[1].prompt, textResult.content);
    assert.equal(payloads[1].settings.resolution, "2048");
    assert.equal(payloads[1].authorization, "Bearer image-test-key");
    const downstream = await create("image");
    await request(`/api/projects/${project.id}/edges`, "POST", { sourceNodeId: imageNode.id, targetNodeId: downstream.id });
    await request(`/api/nodes/${downstream.id}`, "PATCH", { generation: { prompt: "调整为夜景", selectedReferenceNodeIds: [imageNode.id] } });
    await request(`/api/nodes/${downstream.id}/generate`, "POST");
    assert.equal(payloads[2].references[0].url, imageResult.url);
    assert.equal(payloads[2].references[0].path, undefined);
    const saved = await request(`/api/projects/${project.id}`);
    assert.equal(saved.coverUrl, imageResult.url);
    const onDisk = JSON.parse(fs.readFileSync(path.join(dataDir, "canvas-data.json"), "utf8"));
    assert.equal(onDisk.nodes.find((node) => node.id === textNode.id).content, textResult.content);
    const clones = await request(`/api/projects/${project.id}/clone-nodes`, "POST", { nodeIds: [textNode.id, imageNode.id] });
    const clonedText = clones.nodes.find((node) => node.type === "text");
    assert.equal(clonedText.content, textResult.content);
    assert.deepEqual(clones.nodes.find((node) => node.type === "image").generation.selectedReferenceNodeIds, [clonedText.id]);
    const restored = await request(`/api/projects/${project.id}/state`, "PUT", { nodes: saved.nodes, edges: saved.edges });
    assert.equal(restored.nodes.length, 3);
    assert.equal(restored.nodes.find((node) => node.id === textNode.id).generation.model, "writer-test");
  } finally {
    server.kill();
    await once(server, "exit");
    gateway.close();
    await once(gateway, "close");
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
