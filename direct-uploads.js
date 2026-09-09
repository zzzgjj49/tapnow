const crypto = require('node:crypto');
const VideoModels = require('./public/video-models');
module.exports = function directUploads({ app, db, save, media, nodeById, projectById, publicNode, touchProject }) {
  const ownTicket = (req, res) => {
    const t = db.uploadTickets[req.params.id];
    if (!t || t.userId !== req.user.id || t.expires < Date.now()) { res.status(404).json({ error: '上传凭证已失效，请重新上传' }); return null; }
    return t;
  };
  app.post('/api/uploads/init', async (req, res) => {
    if (!projectById(req.body.projectId)) return res.status(404).json({ error: '项目不存在' });
    const pending = Object.values(db.uploadTickets).filter(t => t.userId === req.user.id && !t.attached && t.expires > Date.now());
    if (pending.length >= 30) return res.status(429).json({ error: '同时上传的文件过多，请等待完成' });
    try {
      const created = await media.initiate(req.body.projectId, req.body.file || {});
      const id = crypto.randomUUID();
      const { urls, ...ticket } = created;
      db.uploadTickets[id] = { ...ticket, id, userId: req.user.id, projectId: req.body.projectId, expires: Date.now() + 7200000 };
      save(); res.status(201).json({ id, partSize: created.partSize, urls });
    } catch { res.status(400).json({ error: '无法开始上传，请检查文件格式、大小和 TOS 配置' }); }
  });
  app.post('/api/uploads/:id/complete', async (req, res) => {
    const t = ownTicket(req, res); if (!t) return;
    try {
      if (!t.complete) { db.cloudRecords[t.url] = await media.complete(t); t.complete = true; save(); }
      res.json({ ok: true });
    } catch { res.status(400).json({ error: '分片未上传完整或大小不符，请重试' }); }
  });
  app.delete('/api/uploads/:id', async (req, res) => {
    const t = ownTicket(req, res); if (!t) return;
    if (!t.complete) await media.abort(t).catch(() => {});
    delete db.uploadTickets[t.id]; save(); res.json({ ok: true });
  });
  app.post('/api/uploads/:id/attach', (req, res) => {
    const t = ownTicket(req, res); if (!t) return;
    if (!t.complete || !projectById(t.projectId)) return res.status(400).json({ error: '上传尚未完成或项目已删除' });
    if (t.attached) { const existing = nodeById(t.attached); return existing ? res.json(publicNode(existing)) : res.status(410).json({ error: '已添加的节点已被删除' }); }
    const type = t.mimeType.split('/')[0];
    const timestamp = new Date().toISOString();
    const file = { filename: t.originalname, storedName: t.filename, mimeType: t.mimeType, size: t.size, type };
    let node;
    if (req.body.referenceNodeId) {
      node = nodeById(req.body.referenceNodeId);
      if (!node || node.projectId !== t.projectId || node.kind !== 'generator') return res.status(404).json({ error: '制作节点不存在' });
      const policy = type && node.type === 'video' ? VideoModels.referencePolicy(node.generation) : { limit: 2, types: ['image'] };
      const refs = node.generation.references || [];
      if (!policy.types.includes(type) || refs.length >= policy.limit) return res.status(400).json({ error: '当前生成方式不支持该素材或参考素材数量已满' });
      const targetSlot = policy.limit <= 2 ? ['first-frame', 'last-frame'].find(s => !refs.some(r => r.targetSlot === s)) : null;
      refs.push({ ...file, id: crypto.randomUUID(), targetSlot, createdAt: timestamp });
      node.generation.references = refs; node.updatedAt = timestamp;
    } else {
      const n = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
      node = { ...file, id: crypto.randomUUID(), projectId: t.projectId, x: n(req.body.x, 0), y: n(req.body.y, 0), width: Math.max(120, n(req.body.width, 320)), height: Math.max(type === 'audio' ? 88 : 90, n(req.body.height, type === 'audio' ? 104 : 220)), createdAt: timestamp, updatedAt: timestamp };
      db.nodes.push(node);
    }
    t.attached = node.id; touchProject(t.projectId); save(); res.status(201).json(publicNode(node));
  });
};
