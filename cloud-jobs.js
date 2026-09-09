const crypto = require('node:crypto');
const BytePlus = require('./byteplus');
const { Client, Receiver } = require('@upstash/qstash');
module.exports = function cloudJobs({ app, store, media, handlers, nodeById, publicNode, touchProject, queue: suppliedQueue }) {
  const db = store.state;
  const configured = Boolean(suppliedQueue || (process.env.APP_URL?.startsWith('https://') && process.env.QSTASH_TOKEN && process.env.QSTASH_CURRENT_SIGNING_KEY && process.env.QSTASH_NEXT_SIGNING_KEY));
  const queue = suppliedQueue || (configured ? new Client({ token: process.env.QSTASH_TOKEN }) : null);
  const receiver = configured && process.env.QSTASH_CURRENT_SIGNING_KEY ? new Receiver({ currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY, nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY }) : null;
  const pending = j => ['queued', 'submitting', 'generating', 'archiving'].includes(j.status);
  async function schedule() {
    if (!configured) throw new Error('请先配置后台任务队列 QStash 和 APP_URL');
    if (!db.jobs.some(pending)) return;
    if (db.wake?.at > Date.now()) return;
    const wakeId = crypto.randomUUID();
    await queue.publishJSON({ url: `${process.env.APP_URL}/api/internal/jobs`, body: { wakeId }, delay: '60s', retries: 3 });
    db.wake = { id: wakeId, at: Date.now() + 60000 }; store.save();
  }
  async function retryPaused() {
    for (const j of db.jobs) {
      if (j.status === 'archive_failed') j.status = 'archiving';
      else if (j.status === 'poll_failed') j.status = 'generating';
      else continue;
      j.failures = 0; j.nextAt = 0; j.error = null; sync(j);
    }
    store.save(); await schedule();
  }
  function sync(job) {
    const usage = db.usage.find(u => u.id === job.id);
    if (usage) Object.assign(usage, { status: job.status, jobId: job.jobId || null, usage: job.usage || null, updatedAt: new Date().toISOString() });
    const node = nodeById(job.nodeId);
    if (!node || node.generation?.runId !== job.runId) return;
    const status = ['queued', 'submitting', 'generating'].includes(job.status) ? 'generating' : ['complete', 'archiving', 'archive_failed'].includes(job.status) ? 'complete' : 'failed';
    node.generation.jobs[job.index] = { index: job.index, status, jobId: job.jobId, outputUrl: job.archivedUrl || job.outputUrl || null, outputText: job.outputText || null, usage: job.usage || null,
      error: ['failed', 'unknown', 'poll_failed'].includes(job.status) ? job.error : null, storageStatus: job.status === 'complete' ? 'ready' : job.status === 'archive_failed' ? 'failed' : job.status === 'archiving' ? 'pending' : null, storageError: ['archiving','archive_failed'].includes(job.status) ? job.error || null : null };
    handlers.summarize(node);
  }
  async function generate(req, res) {
    const node = nodeById(req.params.nodeId);
    if (!node || node.kind !== 'generator') return res.status(404).json({ error: '制作节点不存在' });
    if (!configured || !media.enabled) return res.status(503).json({ error: '云端生成还需要配置 TOS 和 QStash 后台任务队列' });
    if (db.jobs.some(j => j.nodeId === node.id && pending(j))) return res.status(409).json({ error: '生成或归档仍在进行中，请等待完成' });
    const config = handlers.service(node);
    if (!config.url || !config.key) return res.status(503).json({ error: '请先配置对应模型服务和密钥' });
    let payload;
    try {
      payload = handlers.buildPayload(node);
      const resolved = await media.preparePayload(payload);
      if (config.provider === 'byteplus') await BytePlus.payload(resolved, '');
    } catch (e) { return res.status(400).json({ error: e.message }); }
    const runId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const jobs = Array.from({ length: node.generation.count || 1 }, (_, index) => ({ id: crypto.randomUUID(), runId, nodeId: node.id, projectId: node.projectId, index, type: node.type, model: node.generation.model,
      userId: req.user.id, createdAt, status: 'queued', payload, provider: config.provider || 'gateway', generation: { model: node.generation.model }, filename: node.filename, nextAt: 0 }));
    db.jobs.push(...jobs);
    db.usage.push(...jobs.map(j => ({ id: j.id, userId: j.userId, nodeId: j.nodeId, projectId: j.projectId, model: j.model, type: j.type, createdAt, status: 'queued', requestedSeconds: payload.settings.duration || null, resolution: payload.settings.resolution || null, hasVideoInput: payload.references.some(r => r.type === 'video'), usage: null })));
    node.generation.runId = runId;
    node.generation.jobs = jobs.map(j => ({ index: j.index, status: 'generating', jobId: null }));
    node.generation.pollError = null;
    handlers.summarize(node);
    try { await schedule(); }
    catch {
      jobs.forEach(j => { j.status = 'failed'; j.error = '后台队列未能启动，没有提交模型任务，请稍后重试'; sync(j); });
      store.save(); return res.status(503).json({ error: '后台队列暂时不可用，没有提交模型任务' });
    }
    res.json(publicNode(node));
  }
  async function claim() {
    return store.transaction(async () => {
      for (const j of db.jobs) {
        if (j.status === 'submitting' && j.leaseUntil < Date.now()) { j.status = 'unknown'; j.error = '提交中断，未取得任务编号，可能已产生费用；请先在模型控制台核对后再生成'; sync(j); }
      }
      const job = db.jobs.find(j => pending(j) && j.status !== 'submitting' && (j.leaseUntil || 0) < Date.now() && (j.nextAt || 0) <= Date.now());
      if (!job) { await schedule(); store.save(); return null; }
      const phase = job.status;
      job.lease = crypto.randomUUID(); job.leaseUntil = Date.now() + 240000;
      if (phase === 'queued') job.status = 'submitting';
      sync(job); store.save();
      // Persist a follow-up before external work, so a terminated function can recover safely.
      await schedule();
      const config = handlers.service({ type: job.type });
      const raw = phase === 'queued' ? await media.preparePayload(job.payload) : null;
      const payload = raw && (config.provider === 'byteplus' ? await BytePlus.payload(raw, '') : { ...raw, requestId: job.id, batchIndex: job.index, batchCount: db.jobs.filter(j => j.runId === job.runId).length });
      return { job: structuredClone(job), phase, config, payload };
    });
  }
  async function work() {
    const started = Date.now();
    for (let attempt = 0; attempt < 4 && Date.now() - started < 90000; attempt++) {
      const claimed = await claim();
      if (!claimed) break;
      const { job, phase, config, payload } = claimed;
      let update;
      try {
        if (phase === 'archiving') {
          const archived = await media.archiveOutput(job);
          update = { status: 'complete', archivedUrl: archived.url, archiveRecord: archived.record, error: null };
        } else {
          const url = phase === 'queued' ? config.url : config.statusUrl ? config.statusUrl.replaceAll('{jobId}', encodeURIComponent(job.jobId)) : config.url.replace(/\/$/, '') + '/' + encodeURIComponent(job.jobId);
          const result = await handlers.gateway(url, config, phase === 'queued' ? payload : undefined);
          update = handlers.parseResult(result, job, job.type);
          delete update.nextAt;
          if (update.status === 'complete') update.status = 'archiving';
        }
        update.failures = 0;
      } catch (e) {
        // Never auto-retry a non-idempotent paid POST with an unknown outcome.
        update = { status: phase === 'queued' ? 'unknown' : phase, error: phase === 'queued' ? '提交结果未知，请在模型控制台核对后再生成' : '查询或归档暂时失败，后台将重试', nextAt: Date.now() + 60000 };
        update.failures = (job.failures || 0) + 1;
        if (phase !== 'queued' && update.failures >= 20) {
          update.status = phase === 'archiving' ? 'archive_failed' : 'poll_failed';
          update.error = '查询或归档连续失败，已暂停；恢复服务后点击画板顶部云端状态重试';
        }
      }
      await store.transaction(async () => {
        const current = db.jobs.find(j => j.id === job.id);
        if (!current || current.lease !== job.lease) return;
        const archiveRecord = update.archiveRecord; delete update.archiveRecord;
        Object.assign(current, update, { lease: null, leaseUntil: 0, nextAt: update.nextAt || (update.status === 'generating' ? Date.now() + 15000 : 0) });
        if (archiveRecord) db.cloudRecords[current.archivedUrl] = archiveRecord;
        sync(current); store.save();
      });
    }
  }
  app.post('/api/internal/jobs', async (req, res) => {
    if (!receiver) return res.status(503).json({ error: '后台队列尚未配置' });
    try { if (!await receiver.verify({ signature: req.get('upstash-signature') || '', body: req.rawBody || '', url: `${process.env.APP_URL}/api/internal/jobs` })) throw new Error('Invalid signature'); }
    catch { return res.status(401).json({ error: '无效任务签名' }); }
    try {
      const accepted = await store.transaction(() => {
        if (db.wake?.id !== req.body.wakeId) return false;
        db.wake.at = 0; store.save(); return true;
      });
      if (accepted) await work();
      res.json({ ok: true });
    } catch { res.status(503).json({ error: '后台任务暂时不可用，请重试' }); }
  });
  function status(req, res) {
    const node = nodeById(req.params.nodeId);
    if (!node?.generation) return res.status(404).json({ error: '制作节点不存在' });
    res.json(publicNode(node));
  }
  function restoreNode(node) {
    if (!node.generation) return;
    const jobs = db.jobs.filter(j => j.nodeId === node.id);
    if (!jobs.length) return;
    const latest = jobs.at(-1).runId;
    node.generation.runId = latest;
    node.generation.jobs = [];
    jobs.filter(j => j.runId === latest).forEach(sync);
  }
  return { generate, status, schedule, retryPaused, work, restoreNode };
};
