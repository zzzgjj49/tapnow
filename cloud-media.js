const crypto = require('node:crypto');
const path = require('node:path');
const { TosClient } = require('@volcengine/tos-sdk');
const PART_SIZE = 8 * 1024 * 1024;
const mime = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.aac': 'audio/aac', '.m4a': 'audio/mp4', '.txt': 'text/plain; charset=utf-8' };
module.exports = function cloudMedia({ records, uploadDir, client: providedClient, config = process.env }) {
  const bucket = config.TOS_BUCKET;
  const endpoint = config.TOS_ENDPOINT ? new URL(config.TOS_ENDPOINT.includes('://') ? config.TOS_ENDPOINT : 'https://' + config.TOS_ENDPOINT).host : '';
  const enabled = Boolean(providedClient || (bucket && endpoint && config.TOS_REGION && config.TOS_ACCESS_KEY && config.TOS_SECRET_KEY));
  const client = providedClient || (enabled ? new TosClient({ accessKeyId: config.TOS_ACCESS_KEY, accessKeySecret: config.TOS_SECRET_KEY, endpoint, region: config.TOS_REGION, secure: true, connectionTimeout: 15000, requestTimeout: 60000, maxRetryCount: 1 }) : null);
  function requireClient() { if (!enabled) throw new Error('请先配置 TOS 云存储'); }
  const urlFor = (projectId, filename) => `/uploads/${encodeURIComponent(projectId)}/${encodeURIComponent(filename)}`;
  function keyFor(url) {
    if (!/^\/uploads\/[^/]+\/[^/]+$/.test(url)) throw new Error('无效素材路径');
    const parts = url.slice(9).split('/').map(decodeURIComponent);
    if (parts.some(p => !p || p === '.' || p === '..' || /[\\/\x00]/.test(p))) throw new Error('无效素材路径');
    return 'canvas/uploads/' + parts.join('/');
  }
  const current = url => { const r = records()[url]; return r?.bucket === bucket && r?.endpoint === endpoint ? r : null; };
  function signedUrl(url, expires = 3600, downloadName) {
    requireClient();
    const r = current(url);
    if (r?.status !== 'ready') return null;
    return client.getPreSignedUrl({ bucket, key: r.key, expires, ...(downloadName ? { response: { contentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}` } } : {}) });
  }
  async function backup(url) { if (!current(url) || current(url).status !== 'ready') throw new Error('文件尚未上传到云端，请重新上传'); return current(url); }
  async function preparePayload(payload) {
    const refs = [];
    for (const ref of payload.references || []) {
      let url = ref.url;
      if (ref.path) url = '/uploads/' + path.relative(uploadDir, ref.path).split(path.sep).map(encodeURIComponent).join('/');
      const { path: _path, ...rest } = ref;
      if (url?.startsWith('/uploads/')) {
        const record = await backup(url);
        const ext = path.extname(record.key).toLowerCase();
        const limit = ref.type === 'video' ? 200 : ref.type === 'audio' ? 15 : 30;
        if (!mime[ext]?.startsWith(ref.type + '/') || record.size > limit * 1024 * 1024) throw new Error(`参考素材格式不支持或超过 ${limit} MB`);
        url = signedUrl(url, 86400);
      }
      refs.push({ ...rest, url });
    }
    return { ...payload, references: refs };
  }
  async function initiate(projectId, file) {
    requireClient();
    const ext = path.extname(file.name || '').toLowerCase();
    if (!mime[ext] || ext === '.txt' || !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > 1024 ** 3) throw new Error('请选择 1 GB 以内的图片、视频或音频');
    const filename = crypto.randomUUID() + ext;
    const url = urlFor(projectId, filename);
    const key = keyFor(url);
    const created = await client.createMultipartUpload({ bucket, key, contentType: mime[ext] });
    const uploadId = created.data.UploadId;
    const count = Math.ceil(file.size / PART_SIZE);
    return { filename, url, key, uploadId, size: file.size, mimeType: mime[ext], originalname: String(file.name).slice(0, 160),
      partSize: PART_SIZE, urls: Array.from({ length: count }, (_, i) => client.getPreSignedUrl({ bucket, key, method: 'PUT', expires: 7200, query: { uploadId, partNumber: String(i + 1) } })) };
  }
  async function complete(ticket) {
    const head = await headOrNull(ticket.key);
    if (head && Number(head['content-length']) === ticket.size) return record(ticket.key, ticket.size, head.etag);
    const listed = await client.listParts({ bucket, key: ticket.key, uploadId: ticket.uploadId, maxParts: 1000 });
    const parts = listed.data.Parts || [];
    const expected = Math.ceil(ticket.size / PART_SIZE);
    if (listed.data.IsTruncated || parts.length !== expected || parts.some((p, i) => p.PartNumber !== i + 1 || Number(p.Size) !== Math.min(PART_SIZE, ticket.size - i * PART_SIZE))) throw new Error('上传内容不完整或大小不符，请重新上传');
    const result = await client.completeMultipartUpload({ bucket, key: ticket.key, uploadId: ticket.uploadId, parts: parts.map(p => ({ partNumber: p.PartNumber, eTag: p.ETag })) });
    return record(ticket.key, ticket.size, result.data.ETag);
  }
  async function headOrNull(key) {
    try { return (await client.headObject({ bucket, key })).data; }
    catch (e) { if (e.statusCode === 404) return null; throw new Error('云端文件检查失败'); }
  }
  const record = (key, size, etag) => ({ key, size, etag, bucket, endpoint, status: 'ready', updatedAt: new Date().toISOString() });
  // Stream remote outputs into multipart TOS uploads. No Vercel disk or response-body transfer.
  async function archiveOutput(job) {
    requireClient();
    const ext = job.type === 'text' ? '.txt' : path.extname(new URL(job.outputUrl).pathname).match(/^\.(mp4|mov|webm|png|jpg|jpeg|webp|gif)$/i)?.[0] || (job.type === 'video' ? '.mp4' : '.png');
    const url = urlFor(job.projectId, 'generated-' + crypto.createHash('sha256').update(job.id).digest('hex').slice(0, 32) + ext);
    const key = keyFor(url);
    const head = await headOrNull(key);
    if (head) return { url, record: record(key, Number(head['content-length']), head.etag) };
    if (job.type === 'text') {
      const body = Buffer.from(job.outputText, 'utf8');
      const result = await client.putObject({ bucket, key, body, contentLength: body.length, contentType: mime[ext] });
      return { url, record: record(key, body.length, result.data.ETag) };
    }
    const response = await fetch(job.outputUrl, { signal: AbortSignal.timeout(180000) });
    if (!response.ok || !response.body) throw new Error(`生成结果下载失败（${response.status}）`);
    const uploadId = (await client.createMultipartUpload({ bucket, key, contentType: mime[ext] })).data.UploadId;
    let buffer = Buffer.alloc(0), size = 0;
    const parts = [];
    async function part(body) {
      const partNumber = parts.length + 1;
      const result = await client.uploadPart({ bucket, key, uploadId, partNumber, body });
      parts.push({ partNumber, eTag: result.data.ETag });
    }
    try {
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 1024 ** 3) throw new Error('生成结果超过 1 GB');
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length >= PART_SIZE) { await part(buffer.subarray(0, PART_SIZE)); buffer = buffer.subarray(PART_SIZE); }
      }
      if (buffer.length) await part(buffer);
      if (!size) throw new Error('生成结果为空');
      const result = await client.completeMultipartUpload({ bucket, key, uploadId, parts });
      return { url, record: record(key, size, result.data.ETag) };
    } catch (e) { await client.abortMultipartUpload({ bucket, key, uploadId }).catch(() => {}); throw e; }
  }
  return { enabled, direct: true, urlFor, keyFor, signedUrl, backup, preparePayload, initiate, complete, archiveOutput,
    abort: ticket => client.abortMultipartUpload({ bucket, key: ticket.key, uploadId: ticket.uploadId }),
    state: url => ({ status: current(url)?.status || 'pending' }), retry() {},
    summary: () => ({ enabled, bucket, region: config.TOS_REGION, ready: Object.values(records()).filter(r => r.bucket === bucket && r.endpoint === endpoint && r.status === 'ready').length, pending: 0, failed: 0 }),
  };
};
