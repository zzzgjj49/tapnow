const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { Readable, Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { TosClient } = require("@volcengine/tos-sdk");

module.exports = function createCloudStorage({ dataDir, uploadDir, client: providedClient, config = process.env }) {
  const configured = ["TOS_BUCKET", "TOS_REGION", "TOS_ENDPOINT", "TOS_ACCESS_KEY", "TOS_SECRET_KEY"].every((key) => config[key]?.trim());
  const enabled = config.TOS_STORAGE_ENABLED !== "0" && Boolean(providedClient || configured);
  const bucket = config.TOS_BUCKET;
  const endpoint = config.TOS_ENDPOINT ? new URL(config.TOS_ENDPOINT.includes("://") ? config.TOS_ENDPOINT : `https://${config.TOS_ENDPOINT}`).host : "";
  const client = enabled ? providedClient || new TosClient({ accessKeyId: config.TOS_ACCESS_KEY, accessKeySecret: config.TOS_SECRET_KEY,
    region: config.TOS_REGION, endpoint, secure: true, connectionTimeout: 15000, requestTimeout: 120000, maxRetryCount: 2 }) : null;
  const indexFile = path.join(dataDir, "cloud-storage.json");
  const records = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, "utf8")) : {};
  const tasks = new Map();
  const downloads = new Map();
  const archiveErrors = new Map();
  const mimeTypes = { ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".aac": "audio/aac", ".txt": "text/plain; charset=utf-8" };
  function save() {
    fs.writeFileSync(indexFile + ".tmp", JSON.stringify(records, null, 2));
    fs.renameSync(indexFile + ".tmp", indexFile);
  }
  function safeError(error) {
    let message = String(error.code || error.statusCode || error.message || "未知错误");
    for (const key of [config.TOS_ACCESS_KEY, config.TOS_SECRET_KEY]) if (key) message = message.split(key).join("[已隐藏]");
    return `云端保存失败：${message.slice(0, 200)}`;
  }
  function localFile(url) {
    if (!url?.startsWith("/uploads/")) return null;
    const relative = decodeURIComponent(url.slice(9));
    const resolved = path.resolve(uploadDir, relative);
    if (!resolved.startsWith(path.resolve(uploadDir) + path.sep)) throw new Error("无效素材路径");
    return resolved;
  }
  function urlFor(projectId, filename) { return `/uploads/${encodeURIComponent(projectId)}/${encodeURIComponent(filename)}`; }
  function currentRecord(url) {
    const record = records[url];
    return record?.bucket === bucket && record?.endpoint === endpoint ? record : null;
  }
  function state(url) {
    const record = currentRecord(url);
    return { status: enabled ? record?.status || "pending" : "local", ...(record?.error ? { error: record.error } : {}) };
  }
  function signedUrl(url, expires = 3600, downloadName) {
    const record = currentRecord(url);
    if (!enabled || record?.status !== "ready") return null;
    return client.getPreSignedUrl({ bucket, key: record.key, expires,
      ...(downloadName ? { response: { contentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}` } } : {}) });
  }
  async function backup(url, { force = false } = {}) {
    if (!enabled) return null;
    const file = localFile(url);
    if (!file) throw new Error("只能保存本站素材");
    if (tasks.has(url)) return tasks.get(url);
    const record = currentRecord(url);
    if (record?.status === "ready") return record;
    if (!force && record?.retryAt > Date.now()) throw new Error(record.error);
    const promise = (async () => {
      const key = `canvas/uploads/${path.relative(uploadDir, file).split(path.sep).join("/")}`;
      records[url] = { key, bucket, endpoint, status: "uploading", updatedAt: new Date().toISOString() };
      save();
      try {
        const resolved = await fs.promises.realpath(file);
        const root = await fs.promises.realpath(uploadDir);
        if (!resolved.startsWith(root + path.sep)) throw new Error("无效素材路径");
        const stat = await fs.promises.stat(resolved);
        const contentType = mimeTypes[path.extname(file).toLowerCase()] || "application/octet-stream";
        const result = stat.size > 20 * 1024 * 1024
          ? await client.uploadFile({ bucket, key, file: resolved, partSize: 10 * 1024 * 1024, taskNum: 2, contentType })
          : await client.putObject({ bucket, key, body: fs.createReadStream(resolved), contentLength: stat.size, contentType });
        records[url] = { key, bucket, endpoint, status: "ready", size: stat.size, etag: result.data?.ETag, updatedAt: new Date().toISOString() };
        save();
        return records[url];
      } catch (error) {
        records[url] = { ...records[url], status: "failed", error: safeError(error), retryAt: Date.now() + 60000 };
        save();
        throw new Error(records[url].error);
      }
    })();
    tasks.set(url, promise);
    try { return await promise; } finally { tasks.delete(url); }
  }
  async function archiveJob(node, job) {
    if (!enabled || job.status !== "complete" || (!job.outputUrl && !job.outputText)) return;
    const identity = `${node.projectId}/${node.id}/${job.jobId || node.generation.runId}/${job.index}`;
    if (downloads.has(identity)) return downloads.get(identity);
    if (job.storageRetryAt > Date.now()) return;
    const task = (async () => {
      try {
        if (!job.outputUrl?.startsWith("/uploads/")) {
          const source = job.outputUrl;
          const ext = node.type === "text" ? ".txt" : source && path.extname(new URL(source).pathname).match(/^\.(mp4|mov|webm|png|jpg|jpeg|webp|gif)$/i)?.[0] || (node.type === "video" ? ".mp4" : ".png");
          const filename = `generated-${crypto.createHash("sha256").update(identity).digest("hex").slice(0, 32)}${ext}`;
          const url = urlFor(node.projectId, filename);
          const file = localFile(url);
          fs.mkdirSync(path.dirname(file), { recursive: true });
          if (!fs.existsSync(file) && currentRecord(url)?.status !== "ready") {
            if (node.type === "text") await fs.promises.writeFile(file, job.outputText, "utf8");
            else {
              if (!/^https?:\/\//i.test(source || "")) throw new Error("生成结果地址无效");
              const response = await fetch(source, { signal: AbortSignal.timeout(180000) });
              if (!response.ok || !response.body) throw new Error(`生成结果下载失败（${response.status}）`);
              let size = 0;
              const limiter = new Transform({ transform(chunk, encoding, callback) { size += chunk.length; callback(size > 1024 ** 3 ? new Error("生成结果超过 1 GB") : null, chunk); } });
              try {
                await pipeline(Readable.fromWeb(response.body), limiter, fs.createWriteStream(file + ".part"));
                await fs.promises.rename(file + ".part", file);
              } finally { await fs.promises.unlink(file + ".part").catch(() => {}); }
            }
          }
          job.providerOutputUrl = source || null;
          job.outputUrl = url;
        }
        await backup(job.outputUrl);
        job.storageStatus = "ready";
        job.storageError = null;
        delete job.storageRetryAt;
        archiveErrors.delete(identity);
      } catch (error) {
        job.storageStatus = "failed";
        job.storageError = safeError(error);
        job.storageRetryAt = Date.now() + 60000;
        archiveErrors.set(identity, job.storageError);
      }
    })();
    downloads.set(identity, task);
    try { await task; } finally { downloads.delete(identity); }
  }
  async function preparePayload(payload) {
    if (!enabled) return payload;
    const references = [];
    for (const ref of payload.references) {
      let url = ref.url;
      if (ref.path) {
        const relative = path.relative(uploadDir, path.resolve(ref.path));
        url = `/uploads/${relative.split(path.sep).map(encodeURIComponent).join("/")}`;
      }
      if (url?.startsWith("/uploads/")) {
        await backup(url);
        const { path: _localPath, ...rest } = ref;
        references.push({ ...rest, url: signedUrl(url, 86400) });
      } else references.push(ref);
    }
    return { ...payload, references };
  }
  function summary() {
    const list = Object.keys(records).map(currentRecord).filter(Boolean);
    const failures = list.filter((r) => r.status === "failed");
    return { enabled, bucket: enabled ? bucket : null, region: enabled ? config.TOS_REGION : null,
      ready: list.filter((r) => r.status === "ready").length, pending: tasks.size + downloads.size,
      failed: failures.length + archiveErrors.size, error: failures[0]?.error || [...archiveErrors.values()][0] || null };
  }
  return { enabled, backup, archiveJob, preparePayload, signedUrl, localFile, urlFor, state, summary,
    verify: () => client.headBucket(bucket), retry: () => { for (const r of Object.values(records)) delete r.retryAt; save(); } };
};
