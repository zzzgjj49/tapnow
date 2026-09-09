const assert = require("node:assert/strict");

const cdpPort = Number(process.env.CDP_PORT || 9227);
const projectId = process.env.PROJECT_ID;
const baseUrl = process.env.BASE_URL || "http://127.0.0.1:3000";

class CdpClient {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  async open() {
    if (this.socket.readyState === WebSocket.OPEN) return;
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const response = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || "Runtime evaluation failed");
    return response.result.value;
  }

  close() {
    this.socket.close();
  }
}

async function waitFor(check, message, timeout = 7000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error(message);
}

async function rect(client, selector) {
  const value = await client.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    const box = element.getBoundingClientRect();
    return { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height };
  })()`);
  assert.ok(value, `Missing element: ${selector}`);
  return value;
}

async function mouse(client, type, x, y, modifiers = 0) {
  await client.send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1, modifiers });
}

async function click(client, selector, modifiers = 0) {
  const box = await rect(client, selector);
  const x = Math.min(1580, box.left + Math.min(box.width / 2, 120));
  const y = box.top + box.height / 2;
  await mouse(client, "mousePressed", x, y, modifiers);
  await mouse(client, "mouseReleased", x, y, modifiers);
}

async function drag(client, start, end, modifiers = 0) {
  await mouse(client, "mousePressed", start.x, start.y, modifiers);
  for (let step = 1; step <= 6; step += 1) {
    const x = start.x + ((end.x - start.x) * step) / 6;
    const y = start.y + ((end.y - start.y) * step) / 6;
    await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "left", buttons: 1, modifiers });
  }
  await mouse(client, "mouseReleased", end.x, end.y, modifiers);
}

async function shortcut(client, key, code, shift = false) {
  const modifiers = 2 | (shift ? 8 : 0);
  await client.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, modifiers });
  await client.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, modifiers });
}

async function getProject() {
  const response = await fetch(`${baseUrl}/api/projects/${projectId}`);
  if (!response.ok) throw new Error(`Project request failed: ${response.status}`);
  return response.json();
}

async function main() {
  if (!projectId) throw new Error("PROJECT_ID is required");
  const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
  const page = targets.find((target) => target.type === "page" && target.url.includes(projectId));
  assert.ok(page, "Canvas page was not found in the debugging target list");
  const client = new CdpClient(page.webSocketDebuggerUrl);
  await client.open();
  try {
    await client.send("Runtime.enable");
    await client.send("Page.enable");
    await client.send("Page.reload", { ignoreCache: true });
    await waitFor(() => client.evaluate("Boolean(typeof activeCanvas !== 'undefined' && activeCanvas && activeCanvas.nodes.length === 2)"), "Canvas did not load");

    await drag(client, { x: 120, y: 220 }, { x: 1040, y: 570 });
    assert.equal(await client.evaluate("document.querySelectorAll('.material-node.selected').length"), 2);
    assert.equal(await client.evaluate("Boolean(document.querySelector('[data-multi-selection]'))"), true);

    const firstLabel = await rect(client, ".text-node .text-node-label");
    const beforeMove = await getProject();
    const beforeTexts = beforeMove.nodes.filter((node) => node.type === "text").sort((a, b) => a.x - b.x);
    await drag(client, { x: firstLabel.left + 24, y: firstLabel.top + 18 }, { x: firstLabel.left + 104, y: firstLabel.top + 63 });
    await new Promise((resolve) => setTimeout(resolve, 650));
    const afterMove = await getProject();
    const afterTexts = afterMove.nodes.filter((node) => node.type === "text").sort((a, b) => a.x - b.x);
    assert.equal(Math.round(afterTexts[0].x - beforeTexts[0].x), 80);
    assert.equal(Math.round(afterTexts[1].x - beforeTexts[1].x), 80);
    assert.equal(Math.round(afterTexts[0].y - beforeTexts[0].y), 45);
    assert.equal(Math.round(afterTexts[1].y - beforeTexts[1].y), 45);

    await click(client, "[data-multi-port='output']");
    await waitFor(() => client.evaluate("Boolean(document.querySelector('.add-menu [data-type=video]'))"), "Downstream menu did not open");
    await click(client, ".add-menu [data-type=video]");
    await waitFor(() => client.evaluate("activeCanvas.nodes.length === 3 && activeCanvas.edges.length === 2"), "Multi-input downstream node was not created");
    let project = await getProject();
    let generator = project.nodes.find((node) => node.kind === "generator");
    assert.ok(generator);
    assert.equal(project.edges.filter((edge) => edge.targetNodeId === generator.id).length, 2);
    assert.deepEqual(generator.generation.selectedReferenceNodeIds, []);

    await client.evaluate(`(() => {
      const prompt = document.querySelector('[data-node-id="${generator.id}"] [data-generator-prompt]');
      prompt.focus();
      prompt.setSelectionRange(prompt.value.length, prompt.value.length);
    })()`);
    await client.send("Input.insertText", { text: "@" });
    await waitFor(() => client.evaluate("Boolean(document.querySelector('.mention-menu.visible [data-mention-node]'))"), "Mention menu did not open");
    await click(client, ".mention-menu.visible [data-mention-node]");
    await new Promise((resolve) => setTimeout(resolve, 650));
    project = await getProject();
    generator = project.nodes.find((node) => node.id === generator.id);
    assert.equal(generator.generation.selectedReferenceNodeIds.length, 1);
    assert.match(generator.generation.prompt, /^@/);

    const textIds = project.nodes.filter((node) => node.type === "text").map((node) => node.id);
    await click(client, `[data-node-id="${textIds[0]}"] .text-node-label`);
    await click(client, `[data-node-id="${textIds[1]}"] .text-node-label`, 8);
    assert.equal(await client.evaluate("activeCanvas.selectedIds.size"), 2);
    await shortcut(client, "c", "KeyC");
    await shortcut(client, "v", "KeyV");
    await waitFor(() => client.evaluate("activeCanvas.nodes.length === 5"), "Paste did not create cloned nodes");
    await shortcut(client, "z", "KeyZ");
    await waitFor(() => client.evaluate("activeCanvas.nodes.length === 3"), "Undo did not restore the previous graph");
    await shortcut(client, "z", "KeyZ", true);
    await waitFor(() => client.evaluate("activeCanvas.nodes.length === 5"), "Redo did not restore the pasted graph");

    console.log("Browser smoke passed: marquee selection, group move, multi-input creation, @ mention, copy/paste, undo, and redo.");
  } finally {
    client.close();
  }
}

module.exports = { CdpClient, waitFor, click };

if (require.main === module) main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
