// Verifies stored objects without generating videos or printing credentials/URLs.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { TosClient } = require("@volcengine/tos-sdk");
process.loadEnvFile(path.join(__dirname, "../.env"));
async function main() {
  const root = path.resolve(__dirname, "..");
  const index = JSON.parse(fs.readFileSync(path.join(root, "data/cloud-storage.json")));
  const client = new TosClient({ accessKeyId: process.env.TOS_ACCESS_KEY, accessKeySecret: process.env.TOS_SECRET_KEY,
    region: process.env.TOS_REGION, endpoint: new URL(process.env.TOS_ENDPOINT).host, secure: true, maxRetryCount: 0 });
  const results = [];
  for (const [url, record] of Object.entries(index)) {
    if (record.status !== "ready") continue;
    const local = path.resolve(root, "data/uploads", decodeURIComponent(url.slice(9)));
    if (!local.startsWith(path.join(root, "data/uploads") + path.sep) || !fs.existsSync(local)) continue;
    if (process.argv.includes("--multipart") && fs.statSync(local).size > 5 * 1024 * 1024) {
      await client.uploadFile({ bucket: record.bucket, key: record.key, file: local, partSize: 5 * 1024 * 1024, taskNum: 2, contentType: "video/mp4" });
    }
    const signed = client.getPreSignedUrl({ bucket: record.bucket, key: record.key, expires: 120 });
    const response = await fetch(signed, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Cloud read failed (${response.status})`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const hash = value => crypto.createHash("sha256").update(value).digest("hex");
    if (hash(bytes) !== hash(fs.readFileSync(local))) throw new Error("Cloud/local checksum mismatch");
    results.push({ file: path.basename(local), bytes: bytes.length, checksum: "matched" });
  }
  if (!results.length) throw new Error("No archived files to verify");
  if (process.argv.includes("--fallback")) {
    const ref = JSON.parse(fs.readFileSync(path.join(root, ".run/byteplus-live.json")));
    const db = JSON.parse(fs.readFileSync(path.join(root, "data/canvas-data.json")));
    const node = db.nodes.find(n => n.id === ref.nodeId);
    const url = node.generation.outputUrl;
    const file = path.resolve(root, "data/uploads", decodeURIComponent(url.slice(9)));
    if (!url.startsWith("/uploads/") || !file.startsWith(path.join(root, "data/uploads") + path.sep)) throw new Error("Invalid fallback test file");
    const backup = file + ".cloud-check";
    if (fs.existsSync(backup)) throw new Error("Fallback check backup already exists");
    const original = fs.readFileSync(file);
    fs.renameSync(file, backup);
    try {
      const preview = await fetch("http://127.0.0.1:3000" + url, { redirect: "manual" });
      if (preview.status !== 302 || !preview.headers.get("location")?.startsWith("https://")) throw new Error("Private cloud preview fallback failed");
      const download = await fetch(`http://127.0.0.1:3000/api/nodes/${node.id}/download`);
      if (!download.ok || !Buffer.from(await download.arrayBuffer()).equals(original)) throw new Error("Private cloud download fallback failed");
    } finally { fs.renameSync(backup, file); }
  }
  console.log(JSON.stringify({ verified: results.length, files: results }));
}
main().then(() => process.exit(0)).catch(e => { console.error(e.message); process.exit(1); });
