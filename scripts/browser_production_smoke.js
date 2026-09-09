const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const http = require("node:http");
const { CdpClient, waitFor, click } = require("./browser_smoke");

async function main() {
  const root = path.resolve(__dirname, "..");
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "canvas-browser-test-"));
  const baseUrl = "http://127.0.0.1:36317";
  const cdpUrl = "http://127.0.0.1:9337";
  let jobCount = 0;
  const gateway = http.createServer(async (request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.method === "POST") {
      for await (const _chunk of request) {}
      response.end(JSON.stringify({ status: "generating", jobId: `browser-job-${++jobCount}` }));
    } else response.end(JSON.stringify({ status: "complete", outputUrl: `${baseUrl}/fixture.mp4` }));
  });
  gateway.listen(0, "127.0.0.1");
  await once(gateway, "listening");
  const server = spawn(process.execPath, ["server.js"], {
    cwd: root, windowsHide: true, stdio: "ignore",
    env: { ...process.env, CANVAS_LOAD_ENV: "0", TOS_STORAGE_ENABLED: "0", VIDEO_GENERATION_PROVIDER: "gateway", PORT: "36317", HOST: "127.0.0.1", DATA_DIR: dataDir,
      TEXT_GENERATION_API_URL: "", IMAGE_GENERATION_API_URL: "", VIDEO_GENERATION_API_URL: `http://127.0.0.1:${gateway.address().port}/jobs` },
  });
  let browser;
  let client;
  try {
    await waitFor(async () => {
      try { return (await fetch(`${baseUrl}/api/health`)).ok; } catch { return false; }
    }, "Isolated server did not start");
    const project = await (await fetch(`${baseUrl}/api/projects`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "文字与图片制作验证" }),
    })).json();
    browser = spawn(process.env.BROWSER_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", [
      "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
      "--remote-debugging-port=9337", `--user-data-dir=${path.join(dataDir, "browser")}`,
      "--window-size=1600,1100", `${baseUrl}/canvas/${project.id}`,
    ], { windowsHide: true, stdio: "ignore" });
    let page;
    await waitFor(async () => {
      try {
        page = (await (await fetch(`${cdpUrl}/json/list`)).json()).find((item) => item.type === "page" && item.url.includes(project.id));
        return Boolean(page);
      } catch { return false; }
    }, "Headless browser did not start", 15000);
    client = new CdpClient(page.webSocketDebuggerUrl);
    await client.open();
    await client.send("Runtime.enable");
    await client.send("Page.enable");
    await waitFor(() => client.evaluate("Boolean(typeof activeCanvas !== 'undefined' && activeCanvas)"), "Canvas did not load");
    await client.evaluate("window.browserUnhandledErrors = []; window.addEventListener('unhandledrejection', event => window.browserUnhandledErrors.push(String(event.reason))); window.addEventListener('error', event => window.browserUnhandledErrors.push(event.message));");
    for (const type of ["text", "image", "video"]) {
      await client.evaluate("activeCanvas.openAddMenu(300, 240, { x: 420, y: 330 })");
      await click(client, `.add-menu [data-type='${type}']`);
      await waitFor(() => client.evaluate(`Boolean(activeCanvas.nodes.find(n => n.type === '${type}' && n.kind === 'generator'))`), `${type} did not create a production node`);
      const selector = `.${type}-production-node`;
      assert.equal(await client.evaluate(`Boolean(document.querySelector('${selector} [data-generator-prompt]'))`), true);
      if (type === "video") continue;
      await click(client, `${selector} [data-generator-settings]`);
      await client.evaluate("Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {})))");
      await click(client, type === "text" ? "[data-setting-key='style'][data-setting-value='creative']" : "[data-setting-key='ratio'][data-setting-value='16:9']");
      assert.equal(await client.evaluate(`activeCanvas.nodes.find(n => n.type === '${type}').generation.${type === "text" ? "style" : "ratio"}`), type === "text" ? "creative" : "16:9", "Setting did not update in the UI");
      await client.evaluate("activeCanvas.closeGeneratorPanel()");
      await click(client, `${selector} [data-generator-model]`);
      await client.evaluate("document.querySelector('.custom-model-panel input').value = 'test-model'; document.querySelector('.custom-model-panel').requestSubmit()");
      await client.evaluate(`(() => { const prompt = document.querySelector('${selector} [data-generator-prompt]'); prompt.value = '测试制作提示词'; prompt.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await click(client, `${selector} [data-generate-video]`);
      await waitFor(() => client.evaluate(`document.querySelector('${selector} [data-generate-video]').disabled === false && document.querySelector('#toast-root').textContent.includes('尚未配置')`), "Missing-service feedback was not shown");
      const projectState = await (await fetch(`${baseUrl}/api/projects/${project.id}`)).json();
      const saved = projectState.nodes.find((node) => node.type === type);
      assert.equal(saved.generation.prompt, "测试制作提示词");
      assert.equal(saved.generation.model, "test-model");
      assert.equal(type === "text" ? saved.generation.style : saved.generation.ratio, type === "text" ? "creative" : "16:9");
    }
    const videoSelector = ".video-production-node";
    for (const type of ["text", "image", "video"]) {
      await client.evaluate("activeCanvas.selectNode(null)");
      assert.equal(await client.evaluate("[...document.querySelectorAll('.generator-composer')].every(e => getComputedStyle(e).display === 'none')"), true);
      // The fixture nodes overlap; expose the tested node for a real pointer click.
      await client.evaluate(`activeCanvas.nodes.forEach(n => { activeCanvas.world.querySelector('[data-node-id="' + n.id + '"]').style.display = n.type === '${type}' ? '' : 'none'; })`);
      await click(client, `.${type}-production-node .generator-preview`);
      assert.equal(await client.evaluate(`getComputedStyle(document.querySelector('.${type}-production-node .generator-composer')).display`), "flex", type);
      const anchors = await client.evaluate(`(() => { const n = activeCanvas.nodes.find(n => n.type === '${type}'); const p = activeCanvas.world.querySelector('[data-node-id="' + n.id + '"] .generator-preview').getBoundingClientRect(); const a = activeCanvas.nodeAnchor(n, 'input'); const r = activeCanvas.surface.getBoundingClientRect(); return { actualY: (p.top + p.bottom) / 2, expectedY: r.top + activeCanvas.viewport.y + a.y * activeCanvas.viewport.zoom }; })()`);
      assert.ok(Math.abs(anchors.actualY - anchors.expectedY) < 2);
      await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: 1500, y: 950, button: "left", buttons: 1, clickCount: 1 });
      await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 1500, y: 950, button: "left", buttons: 0, clickCount: 1 });
      assert.equal(await client.evaluate(`getComputedStyle(document.querySelector('.${type}-production-node .generator-composer')).display`), "none");
    }
    await client.evaluate(`activeCanvas.world.querySelectorAll('.material-node').forEach(e => e.style.display = '')`);
    await click(client, `${videoSelector} .generator-preview`);
    await client.evaluate("activeCanvas.nodes.filter(n => n.type !== 'video').forEach(n => { activeCanvas.world.querySelector('[data-node-id=\"' + n.id + '\"]').style.visibility = 'hidden'; })");
    for (const [model, resolution, duration] of [["Seedance 2.0 Fast", "720p", 15], ["Seedance 2.0", "4k", 15], ["Seedance 2.5", "720p", 30]]) {
      await click(client, `${videoSelector} [data-generator-model]`);
      await client.evaluate("Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {})))");
      await click(client, `[data-model='${model}']`);
      await click(client, `${videoSelector} [data-generator-settings]`);
      await client.evaluate("Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {})))");
      await click(client, `[data-setting-key='resolution'][data-setting-value='${resolution}']`);
      await client.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
      const panelBounds = await client.evaluate("({ panel: document.querySelector('.video-settings-popover').getBoundingClientRect().toJSON(), trigger: document.querySelector('.video-production-node [data-generator-settings]').getBoundingClientRect().toJSON(), style: document.querySelector('.video-settings-popover').getAttribute('style'), layout: document.querySelector('.video-settings-popover').dataset.layout })");
      assert.ok(panelBounds.panel.bottom < panelBounds.trigger.top, `Settings popup overlaps its trigger: ${JSON.stringify(panelBounds)}`);
      if (model === "Seedance 2.5") {
        await client.evaluate("document.querySelector('[data-duration-input]').value = '30'; document.querySelector('[data-duration-input]').dispatchEvent(new Event('change', { bubbles: true }))");
        await click(client, "[data-setting-key='method'][data-setting-value='edit']");
        await click(client, "[data-setting-key='method'][data-setting-value='omni']");
        assert.equal(await client.evaluate("activeCanvas.nodes.find(n => n.type === 'video').generation.ratio"), "adaptive");
      }
      await click(client, "[data-setting-key='audio'][data-setting-value='false']");
      await click(client, "[data-setting-key='audio'][data-setting-value='true']");
      await waitFor(async () => {
        const state = await (await fetch(`${baseUrl}/api/projects/${project.id}`)).json();
        const generation = state.nodes.find((node) => node.type === "video").generation;
        return generation.model === model && generation.resolution === resolution && generation.duration === duration && generation.audio;
      }, `Settings did not persist for ${model}`);
      const screenshot = await client.send("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(path.join(root, ".run", `${model.replaceAll(" ", "-")}-settings.png`), Buffer.from(screenshot.data, "base64"));
      await client.evaluate("activeCanvas.closeGeneratorPanel()");
    }
    await click(client, `${videoSelector} [data-generator-count]`);
    await client.evaluate("Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {})))");
    await click(client, "[data-count='4']");
    assert.equal(await client.evaluate("activeCanvas.nodes.find(n => n.type === 'video').generation.count"), 4);
    // Speech callbacks are simulated; actual microphone and recognition service require user permission.
    await client.evaluate(`window.SpeechRecognition = class {
      start() { this.onstart(); this.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: '语音输入测试' }], { isFinal: true })] }); }
      stop() { this.onend(); }
      abort() { this.onend(); }
    }`);
    await click(client, `${videoSelector} [data-dictate]`);
    assert.match(await client.evaluate("activeCanvas.nodes.find(n => n.type === 'video').generation.prompt"), /语音输入测试/);
    await click(client, `${videoSelector} [data-dictate]`);
    await click(client, `${videoSelector} [data-generate-video]`);
    await waitFor(() => client.evaluate("activeCanvas.nodes.find(n => n.type === 'video').generation.outputs?.length === 4"), "Async generated results did not reach the UI", 12000);
    await click(client, `${videoSelector} [data-output-id='3']`);
    await waitFor(() => client.evaluate("activeCanvas.nodes.find(n => n.type === 'video').generation.selectedOutputId === '3'"), "Result selection did not persist");
    await click(client, `${videoSelector} [data-reference-library]`);
    await client.evaluate("Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {})))");
    await click(client, "[data-library-node]");
    await waitFor(() => client.evaluate("activeCanvas.edges.length === 1 && activeCanvas.nodes.find(n => n.type === 'video').generation.selectedReferenceNodeIds.length === 1"), "Reference library did not connect and select the source");
    // Exercise right-button pan through real pointer events, including on top of a node.
    for (const point of [{ x: 1100, y: 850 }, { x: 300, y: 350 }]) {
      const before = await client.evaluate("({ viewport: { ...activeCanvas.viewport }, positions: activeCanvas.nodes.map(n => [n.x,n.y]) })");
      await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "right", buttons: 2, clickCount: 1 });
      await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x + 70, y: point.y + 40, button: "right", buttons: 2 });
      await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x + 70, y: point.y + 40, button: "right", buttons: 0, clickCount: 1 });
      const after = await client.evaluate("({ viewport: { ...activeCanvas.viewport }, positions: activeCanvas.nodes.map(n => [n.x,n.y]), panning: activeCanvas.surface.classList.contains('panning') })");
      assert.equal(after.viewport.x - before.viewport.x, 70);
      assert.equal(after.viewport.y - before.viewport.y, 40);
      assert.deepEqual(after.positions, before.positions);
      assert.equal(after.panning, false);
    }
    // Arrange all three types for a visual inspection without touching user data.
    await client.evaluate(`(() => {
      activeCanvas.world.querySelectorAll('.material-node').forEach(element => element.style.visibility = '');
      activeCanvas.nodes.forEach((node, index) => { node.x = 80 + index * 820; node.y = 160; activeCanvas.applyNodeStyle(activeCanvas.world.querySelector('[data-node-id="' + node.id + '"]'), node); });
      activeCanvas.viewport = { x: 0, y: 0, zoom: 0.6 }; activeCanvas.applyViewport(); activeCanvas.selectNode(null);
    })()`);
    const screenshot = await client.send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(root, ".run", "production-nodes.png"), Buffer.from(screenshot.data, "base64"));
    assert.deepEqual(await client.evaluate("window.browserUnhandledErrors"), []);
    await client.send("Page.reload", { ignoreCache: true });
    await waitFor(() => client.evaluate("Boolean(typeof activeCanvas !== 'undefined' && activeCanvas?.nodes.length === 3)"), "Reload lost production nodes");
    console.log("Browser production smoke passed: model panels, settings persistence, references, batch results, result selection, simulated dictation callbacks, right-button pan, and reload.");
  } catch (error) {
    if (client) {
      const screenshot = await client.send("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(path.join(root, ".run", "production-failure.png"), Buffer.from(screenshot.data, "base64"));
    }
    throw error;
  } finally {
    if (client) {
      await client.send("Browser.close").catch(() => {});
      client.close();
    }
    if (browser && browser.exitCode === null) {
      browser.kill();
      await once(browser, "exit");
    }
    server.kill();
    await once(server, "exit");
    gateway.close(); await once(gateway, "close");
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
