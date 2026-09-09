// Reads an existing real test task; never submits another paid generation.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const { CdpClient, waitFor, click } = require("./browser_smoke");
async function main() {
  const { projectId, nodeId } = JSON.parse(fs.readFileSync(path.join(__dirname, "../.run/byteplus-live.json")));
  const base = "http://127.0.0.1:3000";
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "ark-browser-"));
  const browser = spawn(process.env.BROWSER_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--autoplay-policy=no-user-gesture-required", "--remote-debugging-port=9341", `--user-data-dir=${profile}`, "--window-size=1600,1100", `${base}/canvas/${projectId}`], { windowsHide: true, stdio: "ignore" });
  let client;
  try {
    let page;
    await waitFor(async () => { try { page = (await (await fetch("http://127.0.0.1:9341/json/list")).json()).find((p) => p.url.includes(projectId)); return !!page; } catch { return false; } }, "Browser start failed", 15000);
    client = new CdpClient(page.webSocketDebuggerUrl); await client.open();
    await waitFor(() => client.evaluate("typeof activeCanvas !== 'undefined' && !!activeCanvas"), "Canvas load failed");
    assert.equal(await client.evaluate("getComputedStyle(document.querySelector('.generator-composer')).display"), "none");
    await click(client, ".generator-preview");
    await click(client, "[data-generator-model]");
    const names = await client.evaluate("[...document.querySelectorAll('[data-model]')].map(e => e.dataset.model)");
    assert.deepEqual([...names].sort(), ["Seedance 2.0", "Seedance 2.0 Fast", "Seedance 2.0 Mini"].sort());
    await client.evaluate("activeCanvas.closeGeneratorPanel()");
    await waitFor(() => client.evaluate("document.querySelector('.video-production-node video')?.readyState >= 2"), "Real video did not load", 30000);
    const media = await client.evaluate("(() => { const v = document.querySelector('.video-production-node video'); v.muted = true; return v.play().then(() => ({duration:v.duration,width:v.videoWidth,height:v.videoHeight})); })()");
    await waitFor(() => client.evaluate("document.querySelector('.video-production-node video').currentTime > 0.2"), "Video playback did not advance");
    assert.ok(media.duration >= 3 && media.width > 0);
    const originalWidth = await client.evaluate("document.querySelector('.generator-preview').getBoundingClientRect().width");
    await client.evaluate("window.zoomTestVideo = document.querySelector('.video-production-node video'); window.zoomTestTime = zoomTestVideo.currentTime");
    await click(client, "[data-video-preview-zoom]");
    assert.equal(await client.evaluate("document.querySelector('[data-video-preview-zoom]').getAttribute('aria-pressed')"), "true");
    await client.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    const expandedWidth = await client.evaluate("document.querySelector('.generator-preview').getBoundingClientRect().width");
    assert.ok(expandedWidth > originalWidth * 1.5, `Preview widths: ${originalWidth} -> ${expandedWidth}`);
    assert.equal(await client.evaluate("zoomTestVideo === document.querySelector('.video-production-node video') && zoomTestVideo.currentTime >= zoomTestTime"), true);
    await click(client, "[data-video-preview-zoom]");
    assert.equal(await client.evaluate("document.querySelector('[data-video-preview-zoom]').getAttribute('aria-pressed')"), "false");
    await client.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    assert.ok(Math.abs(await client.evaluate("document.querySelector('.generator-preview').getBoundingClientRect().width") - originalWidth) < 1);
    const screenshot = await client.send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(__dirname, "../.run/byteplus-live.png"), Buffer.from(screenshot.data, "base64"));
    const download = await fetch(`${base}/api/nodes/${nodeId}/download`);
    assert.equal(download.status, 200);
    const bytes = Buffer.from(await download.arrayBuffer());
    assert.ok(bytes.length > 10000); assert.equal(bytes.subarray(4, 8).toString(), "ftyp");
    fs.writeFileSync(path.join(__dirname, "../.run/byteplus-live.mp4"), bytes);
    console.log(JSON.stringify({ playback: "passed", ...media, downloadBytes: bytes.length, modelMenu: names }));
  } finally {
    if (client) { await client.send("Browser.close").catch(() => {}); client.close(); }
    if (browser.exitCode === null) { browser.kill(); await once(browser, "exit"); }
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
