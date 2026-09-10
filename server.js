const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const VideoModels = require("./public/video-models");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
if (process.env.CANVAS_LOAD_ENV !== "0" && fs.existsSync(path.join(__dirname, ".env"))) process.loadEnvFile(path.join(__dirname, ".env"));
const BytePlus = require("./byteplus");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = __dirname;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, "data"));
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const DB_FILE = path.join(DATA_DIR, "canvas-data.json");
const MAX_FILE_SIZE = Number(process.env.MAX_FILE_SIZE || 1024 * 1024 * 1024);

const TYPES = {
  image: new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]),
  video: new Set([".mp4", ".mov", ".webm"]),
  audio: new Set([".mp3", ".wav", ".m4a", ".aac"]),
};

const tosState = process.env.STATE_STORAGE === 'tos';
const cloudMode = tosState || Boolean(process.env.DATABASE_URL);
const authEnabled = cloudMode || process.env.AUTH_ENABLED === "1" || Boolean(process.env.VERCEL);
if (process.env.VERCEL && !cloudMode) throw new Error("Vercel 部署需要配置 STATE_STORAGE=tos 或 DATABASE_URL");
if (!cloudMode) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const store = require("./state-store")({ file: DB_FILE, databaseUrl: process.env.DATABASE_URL, tos: tosState });
const db = store.state;
const saveDatabase = store.save;
const cloudStorage = cloudMode
  ? require("./cloud-media")({ records: () => db.cloudRecords, uploadDir: UPLOAD_DIR })
  : require("./cloud-storage")({ dataDir: DATA_DIR, uploadDir: UPLOAD_DIR });
if (!cloudMode) {
  db.nodes.filter(node => node.kind === "generator" && node.type === "video").forEach(node => { node.generation = VideoModels.normalize(node.generation); });
  if (!fs.existsSync(DB_FILE)) saveDatabase();
}
function now() {
  return new Date().toISOString();
}

function id() {
  return crypto.randomUUID();
}

function numberOr(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function cleanName(value, fallback = "未命名项目") {
  const name = String(value || "").trim().replace(/[\u0000-\u001f]/g, "");
  return name.slice(0, 80) || fallback;
}

function projectById(projectId) {
  return db.projects.find((project) => project.id === projectId);
}

function nodeById(nodeId) {
  return db.nodes.find((node) => node.id === nodeId);
}

function edgeById(edgeId) {
  return db.edges.find((edge) => edge.id === edgeId);
}

function assetType(file) {
  const extension = path.extname(file.originalname).toLowerCase();
  return Object.entries(TYPES).find(([, extensions]) => extensions.has(extension))?.[0] || null;
}

function assetUrl(node) {
  return `/uploads/${encodeURIComponent(node.projectId)}/${encodeURIComponent(node.storedName)}`;
}

const REFERENCE_SLOTS = ["first-frame", "last-frame"];

function linkedReferences(node) {
  return db.edges
    .filter((edge) => edge.targetNodeId === node.id)
    .map((edge) => {
      const source = nodeById(edge.sourceNodeId);
      if (!source || source.projectId !== node.projectId || edge.projectId !== node.projectId) return null;
      return {
        id: `edge:${edge.id}`,
        edgeId: edge.id,
        nodeId: source.id,
        type: source.type,
        kind: source.kind || "asset",
        filename: source.filename,
        mimeType: source.mimeType,
        size: source.size,
        content: source.type === "text" ? source.content || "" : undefined,
        role: edge.role ?? edge.targetSlot ?? null,
        storedName: source.storedName || null,
        linked: true,
        url: source.storedName ? assetUrl(source) : (source.generation?.outputUrl || null),
        createdAt: edge.createdAt,
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
}

function uploadedReferences(node) {
  return (node.generation?.references || []).map((reference, index) => ({
    ...reference,
    targetSlot: REFERENCE_SLOTS.includes(reference.targetSlot) ? reference.targetSlot : (node.type === "video" && !["omni", "edit"].includes(node.generation.method) ? REFERENCE_SLOTS[index] : null),
    url: `/uploads/${encodeURIComponent(node.projectId)}/${encodeURIComponent(reference.storedName)}`,
  }));
}

function occupiedReferenceSlots(node) {
  return new Set(uploadedReferences(node).map((reference) => reference.targetSlot).filter(Boolean));
}

function generationReferences(node) {
  const connectedMedia = selectedLinkedReferences(node).filter((reference) => (reference.storedName || reference.url) && ["image", "video", "audio"].includes(reference.type));
  return [...uploadedReferences(node), ...connectedMedia];
}

function selectedReferenceNodeIds(node) {
  const linkedIds = linkedReferences(node).map((reference) => reference.nodeId);
  const configured = node.generation?.selectedReferenceNodeIds;
  if (!Array.isArray(configured)) return linkedIds;
  const linked = new Set(linkedIds);
  return [...new Set(configured.filter((nodeId) => linked.has(nodeId)))];
}

function selectedLinkedReferences(node) {
  const selected = new Set(selectedReferenceNodeIds(node));
  return linkedReferences(node).filter((reference) => selected.has(reference.nodeId));
}

function publicEdge(edge) {
  return {
    id: edge.id,
    projectId: edge.projectId,
    sourceNodeId: edge.sourceNodeId,
    targetNodeId: edge.targetNodeId,
    relation: edge.relation || edge.kind || "reference",
    role: edge.role ?? edge.targetSlot ?? null,
    createdAt: edge.createdAt,
  };
}

function wouldCreateCycle(sourceNodeId, targetNodeId) {
  const pending = [targetNodeId];
  const visited = new Set();
  while (pending.length) {
    const current = pending.pop();
    if (current === sourceNodeId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    db.edges.filter((edge) => edge.sourceNodeId === current).forEach((edge) => pending.push(edge.targetNodeId));
  }
  return false;
}

function publicNode(node) {
  const generation = node.generation ? {
    ...node.generation,
    selectedReferenceNodeIds: selectedReferenceNodeIds(node),
    references: uploadedReferences(node),
    linkedReferences: linkedReferences(node),
  } : undefined;
  return {
    ...node,
    ...(node.storedName ? { cloudStorage: cloudStorage.state(assetUrl(node)) } : {}),
    url: node.storedName ? assetUrl(node) : (node.generation?.outputUrl || null),
    ...(generation ? { generation } : {}),
  };
}

function publicProject(project, includeNodes = false, user) {
  const nodes = db.nodes.filter((node) => node.projectId === project.id);
  const edges = db.edges.filter((edge) => edge.projectId === project.id).map(publicEdge);
  const coverNode = [...nodes].reverse().find((node) => node.type === "image" && (node.storedName || node.generation?.outputUrl));
  return {
    ...project,
    visibility: projectAccess.visibility(project),
    canManageVisibility: projectAccess.manageable(project, user),
    coverUrl: coverNode ? publicNode(coverNode).url : null,
    assetCount: nodes.length,
    ...(includeNodes ? { nodes: nodes.map(publicNode), edges } : {}),
  };
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function snapshotNode(rawNode, projectId) {
  if (!rawNode || typeof rawNode.id !== "string" || !rawNode.id || !["text", "image", "video", "audio"].includes(rawNode.type)) return null;
  const node = cloneValue(rawNode);
  node.projectId = projectId;
  delete node.url;
  if (node.storedName && path.basename(node.storedName) !== node.storedName) return null;
  if (node.generation) {
    if (cloudMode) {
      const saved = nodeById(node.id)?.generation;
      for (const key of ['jobs','jobId','outputs','outputUrl','runId','status','error','pollError','storageStatus','storageError']) {
        if (saved && saved[key] !== undefined) node.generation[key] = cloneValue(saved[key]);
        else delete node.generation[key];
      }
      if (!node.generation.status) node.generation.status = 'draft';
      if (node.type === 'text' && saved) node.content = nodeById(node.id).content;
    }
    delete node.generation.linkedReferences;
    node.generation.references = (node.generation.references || []).filter((reference) => {
      return reference?.storedName && path.basename(reference.storedName) === reference.storedName;
    }).map((reference) => {
      const clean = { ...reference };
      delete clean.url;
      return clean;
    });
    if (Array.isArray(node.generation.selectedReferenceNodeIds)) {
      node.generation.selectedReferenceNodeIds = [...new Set(node.generation.selectedReferenceNodeIds.filter((nodeId) => typeof nodeId === "string"))];
    }
  }
  return node;
}

function snapshotEdgesAreAcyclic(edges) {
  const adjacency = new Map();
  edges.forEach((edge) => {
    if (!adjacency.has(edge.sourceNodeId)) adjacency.set(edge.sourceNodeId, []);
    adjacency.get(edge.sourceNodeId).push(edge.targetNodeId);
  });
  const visiting = new Set();
  const visited = new Set();
  const visit = (nodeId) => {
    if (visiting.has(nodeId)) return false;
    if (visited.has(nodeId)) return true;
    visiting.add(nodeId);
    for (const targetId of adjacency.get(nodeId) || []) {
      if (!visit(targetId)) return false;
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
    return true;
  };
  return [...adjacency.keys()].every(visit);
}

function touchProject(projectId) {
  const project = projectById(projectId);
  if (project) project.updatedAt = now();
}

function deleteStoredFile(node) {
  if (cloudMode) return;
  const storedNames = [node.storedName, ...(node.generation?.references || []).map((reference) => reference.storedName)].filter(Boolean);
  for (const storedName of storedNames) {
    const filePath = path.join(UPLOAD_DIR, node.projectId, storedName);
    try {
      fs.unlinkSync(filePath);
    } catch (error) {
      if (error.code !== "ENOENT") console.error("Could not remove asset:", error);
    }
  }
}

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb", verify(req, _res, buf) { req.rawBody = buf.toString('utf8'); } }));
// Worker manages short transactions itself; public assets never hold a DB transaction.
app.use((req, res, next) => {
  if (req.path === '/api/internal/jobs' || req.path === '/api/health' || (!req.path.startsWith('/api/') && !req.path.startsWith('/uploads/'))) return next();
  store.middleware(req, res, next);
});
require('./members')({ app, db, save: saveDatabase, enabled: authEnabled });
const projectAccess = require('./project-access')({ app, db, enabled: authEnabled });
app.get("/uploads/:projectId/:filename", (request, response, next) => {
  const url = cloudStorage.urlFor(request.params.projectId, request.params.filename);
  try {
    if (!cloudMode && fs.existsSync(cloudStorage.localFile(url))) return next();
    const signed = cloudStorage.signedUrl(url);
    if (!signed) return next();
    response.setHeader("Cache-Control", "no-store");
    response.redirect(302, signed);
  } catch { response.status(400).json({ error: "无效素材路径" }); }
});
app.use("/uploads", express.static(UPLOAD_DIR, {
  fallthrough: false,
  setHeaders(response) {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
  },
}));

app.get("/api/health", (_request, response) => {
  response.json({ ok: true });
});

app.get("/api/config", (_request, response) => {
  response.json({ videoProvider: BytePlus.enabled() ? "byteplus" : "gateway", videoModels: BytePlus.enabled() ? Object.keys(BytePlus.models) : null, cloudStorage: cloudStorage.enabled, directUpload: cloudMode, authEnabled });
});

app.get("/api/projects", (request, response) => {
  const projects = db.projects.filter(project => projectAccess.readable(project, request.user))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((project) => publicProject(project, false, request.user));
  response.json(projects);
});

app.post("/api/projects", (request, response) => {
  const visibility = request.body?.visibility ?? "team";
  if (!["personal", "team"].includes(visibility)) return response.status(400).json({ error: "请选择个人项目或团队项目" });
  const timestamp = now();
  const project = {
    id: id(),
    name: cleanName(request.body?.name),
    visibility,
    ownerId: request.user?.id || null,
    createdAt: timestamp,
    updatedAt: timestamp,
    viewport: { x: 0, y: 0, zoom: 1 },
  };
  db.projects.push(project);
  saveDatabase();
  response.status(201).json(publicProject(project, true, request.user));
});

app.get("/api/projects/:projectId", (request, response) => {
  const project = projectById(request.params.projectId);
  if (!project) return response.status(404).json({ error: "项目不存在" });
  response.json(publicProject(project, true, request.user));
});

app.patch("/api/projects/:projectId", (request, response) => {
  const project = projectById(request.params.projectId);
  if (!project) return response.status(404).json({ error: "项目不存在" });

  if (Object.hasOwn(request.body || {}, "visibility")) {
    if (!["personal", "team"].includes(request.body.visibility)) return response.status(400).json({ error: "项目分类无效" });
    if (!projectAccess.manageable(project, request.user)) return response.status(403).json({ error: "只有项目创建者可以修改分类；旧项目由管理员管理" });
    project.visibility = request.body.visibility;
    if (!project.ownerId) project.ownerId = request.user?.id || null;
    project.updatedAt = now();
  }

  if (Object.prototype.hasOwnProperty.call(request.body || {}, "name")) {
    project.name = cleanName(request.body.name, project.name);
    project.updatedAt = now();
  }

  if (request.body?.viewport) {
    project.viewport = {
      x: numberOr(request.body.viewport.x, project.viewport?.x || 0),
      y: numberOr(request.body.viewport.y, project.viewport?.y || 0),
      zoom: Math.min(2.5, Math.max(0.2, numberOr(request.body.viewport.zoom, project.viewport?.zoom || 1))),
    };
  }

  saveDatabase();
  response.json(publicProject(project, false, request.user));
});

app.put("/api/projects/:projectId/state", (request, response) => {
  const project = projectById(request.params.projectId);
  if (!project) return response.status(404).json({ error: "项目不存在" });
  const rawNodes = Array.isArray(request.body?.nodes) ? request.body.nodes.slice(0, 500) : null;
  const rawEdges = Array.isArray(request.body?.edges) ? request.body.edges.slice(0, 2000) : null;
  if (!rawNodes || !rawEdges) return response.status(400).json({ error: "画布状态格式不正确" });

  // A snapshot must not reuse another project's node/job IDs or steal its results.
  if (rawNodes.some(n => db.nodes.some(saved => saved.id === n?.id && saved.projectId !== project.id)
    || db.jobs.some(job => job.nodeId === n?.id && job.projectId !== project.id))
    || rawEdges.some(e => db.edges.some(saved => saved.id === e?.id && saved.projectId !== project.id))) {
    return response.status(400).json({ error: "画布状态包含其他项目的节点或连线" });
  }
  const nodes = rawNodes.map((node) => snapshotNode(node, project.id));
  if (nodes.some((node) => !node)) return response.status(400).json({ error: "画布中包含无效节点" });
  const nodeIds = new Set(nodes.map((node) => node.id));
  if (nodeIds.size !== nodes.length) return response.status(400).json({ error: "画布中包含重复节点" });

  const edgeIds = new Set();
  const edges = [];
  for (const rawEdge of rawEdges) {
    if (!rawEdge || typeof rawEdge.id !== "string" || edgeIds.has(rawEdge.id)) return response.status(400).json({ error: "画布中包含无效连线" });
    if (!nodeIds.has(rawEdge.sourceNodeId) || !nodeIds.has(rawEdge.targetNodeId) || rawEdge.sourceNodeId === rawEdge.targetNodeId) {
      return response.status(400).json({ error: "连线端点无效" });
    }
    edgeIds.add(rawEdge.id);
    edges.push({
      id: rawEdge.id,
      projectId: project.id,
      sourceNodeId: rawEdge.sourceNodeId,
      targetNodeId: rawEdge.targetNodeId,
      relation: rawEdge.relation || "reference",
      role: typeof rawEdge.role === "string" ? rawEdge.role.slice(0, 40) : null,
      createdAt: rawEdge.createdAt || now(),
    });
  }
  if (!snapshotEdgesAreAcyclic(edges)) return response.status(400).json({ error: "画布状态不能包含循环连线" });

  const incomingByTarget = new Map();
  edges.forEach((edge) => {
    if (!incomingByTarget.has(edge.targetNodeId)) incomingByTarget.set(edge.targetNodeId, new Set());
    incomingByTarget.get(edge.targetNodeId).add(edge.sourceNodeId);
  });
  nodes.forEach((node) => {
    if (!Array.isArray(node.generation?.selectedReferenceNodeIds)) return;
    const incoming = incomingByTarget.get(node.id) || new Set();
    node.generation.selectedReferenceNodeIds = node.generation.selectedReferenceNodeIds.filter((nodeId) => incoming.has(nodeId));
  });

  db.nodes = [...db.nodes.filter((node) => node.projectId !== project.id), ...nodes];
  db.edges = [...db.edges.filter((edge) => edge.projectId !== project.id), ...edges];
  if (cloudMode) for (const node of nodes) cloudJobs.restoreNode(node);
  touchProject(project.id);
  saveDatabase();
  response.json(publicProject(project, true, request.user));
});

app.patch("/api/projects/:projectId/nodes", (request, response) => {
  const project = projectById(request.params.projectId);
  if (!project) return response.status(404).json({ error: "项目不存在" });
  const changes = Array.isArray(request.body?.nodes) ? request.body.nodes.slice(0, 200) : [];
  const updated = [];
  for (const change of changes) {
    const node = nodeById(change?.id);
    if (!node || node.projectId !== project.id) continue;
    node.x = numberOr(change.x, node.x);
    node.y = numberOr(change.y, node.y);
    node.width = Math.max(120, numberOr(change.width, node.width));
    const minimumHeight = node.type === "audio" ? 88 : node.type === "text" ? 150 : 90;
    node.height = Math.max(minimumHeight, numberOr(change.height, node.height));
    node.updatedAt = now();
    updated.push(publicNode(node));
  }
  if (updated.length) {
    touchProject(project.id);
    saveDatabase();
  }
  response.json({ nodes: updated });
});

app.delete("/api/projects/:projectId", (request, response) => {
  const project = projectById(request.params.projectId);
  if (!project) return response.status(404).json({ error: "项目不存在" });

  db.nodes.filter((node) => node.projectId === project.id).forEach(deleteStoredFile);
  db.nodes = db.nodes.filter((node) => node.projectId !== project.id);
  db.edges = db.edges.filter((edge) => edge.projectId !== project.id);
  db.projects = db.projects.filter((item) => item.id !== project.id);
  saveDatabase();

  const projectFolder = path.join(UPLOAD_DIR, project.id);
  if (!cloudMode) fs.rmSync(projectFolder, { recursive: true, force: true });
  response.status(204).end();
});

app.post("/api/projects/:projectId/video-nodes", (request, response) => {
  const project = projectById(request.params.projectId);
  if (!project) return response.status(404).json({ error: "项目不存在" });
  const timestamp = now();
  const node = {
    id: id(),
    projectId: project.id,
    type: "video",
    kind: "generator",
    filename: "视频制作",
    storedName: null,
    mimeType: null,
    size: 0,
    x: numberOr(request.body?.x, 0),
    y: numberOr(request.body?.y, 0),
    width: 760,
    height: 640,
    generation: {
      prompt: "",
      model: BytePlus.enabled() ? "Seedance 2.0 Fast" : "Kling 3.0",
      mode: "professional",
      method: BytePlus.enabled() ? "omni" : "first-last",
      ratio: "16:9",
      resolution: BytePlus.enabled() ? "720p" : "adaptive",
      duration: 15,
      audio: true,
      multiShot: false,
      count: 1,
      status: "draft",
      references: [],
      selectedReferenceNodeIds: [],
      outputUrl: null,
      jobId: null,
      error: null
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  db.nodes.push(node);
  touchProject(project.id);
  saveDatabase();
  response.status(201).json(publicNode(node));
});

app.post("/api/projects/:projectId/generator-nodes", (request, response) => {
  const project = projectById(request.params.projectId);
  if (!project) return response.status(404).json({ error: "项目不存在" });
  const type = request.body?.type;
  if (!["text", "image"].includes(type)) return response.status(400).json({ error: "不支持的制作类型" });
  const timestamp = now();
  const node = {
    id: id(), projectId: project.id, type, kind: "generator",
    filename: type === "text" ? "文字制作" : "图片制作",
    storedName: null, mimeType: null, size: 0,
    ...(type === "text" ? { content: "" } : {}),
    x: numberOr(request.body?.x, 0), y: numberOr(request.body?.y, 0),
    width: 760, height: 640,
    generation: {
      outputType: type, prompt: "", model: "default",
      ...(type === "text" ? { style: "natural", length: "medium" } : { ratio: "1:1", resolution: "1024" }),
      count: 1, status: "draft", references: [], selectedReferenceNodeIds: [],
      outputUrl: null, jobId: null, error: null,
    },
    createdAt: timestamp, updatedAt: timestamp,
  };
  db.nodes.push(node);
  touchProject(project.id);
  saveDatabase();
  response.status(201).json(publicNode(node));
});

app.post("/api/projects/:projectId/text-nodes", (request, response) => {
  const project = projectById(request.params.projectId);
  if (!project) return response.status(404).json({ error: "项目不存在" });
  const timestamp = now();
  const node = {
    id: id(),
    projectId: project.id,
    type: "text",
    kind: "note",
    filename: cleanName(request.body?.filename, "文字"),
    content: String(request.body?.content || "").slice(0, 20_000),
    storedName: null,
    mimeType: "text/plain",
    size: 0,
    x: numberOr(request.body?.x, 0),
    y: numberOr(request.body?.y, 0),
    width: Math.max(240, numberOr(request.body?.width, 360)),
    height: Math.max(150, numberOr(request.body?.height, 220)),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  db.nodes.push(node);
  touchProject(project.id);
  saveDatabase();
  response.status(201).json(publicNode(node));
});

app.post("/api/projects/:projectId/clone-nodes", (request, response) => {
  const project = projectById(request.params.projectId);
  if (!project) return response.status(404).json({ error: "项目不存在" });
  const requestedIds = [...new Set((Array.isArray(request.body?.nodeIds) ? request.body.nodeIds : []).filter((nodeId) => typeof nodeId === "string"))].slice(0, 100);
  const originals = requestedIds.map(nodeById).filter((node) => node?.projectId === project.id);
  if (!originals.length) return response.status(400).json({ error: "请选择要复制的节点" });
  const offsetX = numberOr(request.body?.offsetX, 36);
  const offsetY = numberOr(request.body?.offsetY, 36);
  const timestamp = now();
  const idMap = new Map(originals.map((node) => [node.id, id()]));
  const clones = originals.map((original) => {
    const clone = cloneValue(original);
    clone.id = idMap.get(original.id);
    clone.projectId = project.id;
    clone.x = original.x + offsetX;
    clone.y = original.y + offsetY;
    clone.createdAt = timestamp;
    clone.updatedAt = timestamp;
    if (clone.generation) {
      delete clone.generation.linkedReferences;
      clone.generation.references = (clone.generation.references || []).map((reference) => ({ ...reference, id: id(), createdAt: timestamp }));
      const selected = selectedReferenceNodeIds(original);
      clone.generation.selectedReferenceNodeIds = selected.map((nodeId) => idMap.get(nodeId)).filter(Boolean);
    }
    return clone;
  });
  const originalIds = new Set(originals.map((node) => node.id));
  const clonedEdges = db.edges.filter((edge) => edge.projectId === project.id && originalIds.has(edge.sourceNodeId) && originalIds.has(edge.targetNodeId)).map((edge) => ({
    ...edge,
    id: id(),
    sourceNodeId: idMap.get(edge.sourceNodeId),
    targetNodeId: idMap.get(edge.targetNodeId),
    createdAt: timestamp,
  }));
  db.nodes.push(...clones);
  db.edges.push(...clonedEdges);
  touchProject(project.id);
  saveDatabase();
  response.status(201).json({ nodes: clones.map(publicNode), edges: clonedEdges.map(publicEdge) });
});

app.post("/api/projects/:projectId/edges", (request, response) => {
  const project = projectById(request.params.projectId);
  if (!project) return response.status(404).json({ error: "项目不存在" });

  const source = nodeById(request.body?.sourceNodeId);
  const target = nodeById(request.body?.targetNodeId);
  if (!source || !target || source.projectId !== project.id || target.projectId !== project.id) {
    return response.status(404).json({ error: "连线节点不存在" });
  }
  if (source.id === target.id) return response.status(400).json({ error: "节点不能连接到自身" });

  const duplicate = db.edges.find((edge) => edge.sourceNodeId === source.id && edge.targetNodeId === target.id);
  if (duplicate) return response.status(409).json({ error: "这两个节点已经连接" });
  if (wouldCreateCycle(source.id, target.id)) return response.status(400).json({ error: "连线不能形成循环" });

  const timestamp = now();
  const edge = {
    id: id(),
    projectId: project.id,
    sourceNodeId: source.id,
    targetNodeId: target.id,
    relation: "reference",
    role: typeof request.body?.role === "string" ? request.body.role.slice(0, 40) : null,
    createdAt: timestamp,
  };
  db.edges.push(edge);
  target.updatedAt = timestamp;
  touchProject(project.id);
  saveDatabase();
  response.status(201).json({ edge: publicEdge(edge), targetNode: publicNode(target) });
});

app.delete("/api/edges/:edgeId", (request, response) => {
  const edge = edgeById(request.params.edgeId);
  if (!edge) return response.status(404).json({ error: "连线不存在" });
  db.edges = db.edges.filter((item) => item.id !== edge.id);
  const target = nodeById(edge.targetNodeId);
  if (target) {
    if (Array.isArray(target.generation?.selectedReferenceNodeIds)) {
      target.generation.selectedReferenceNodeIds = target.generation.selectedReferenceNodeIds.filter((nodeId) => nodeId !== edge.sourceNodeId);
    }
    target.updatedAt = now();
  }
  touchProject(edge.projectId);
  saveDatabase();
  response.status(204).end();
});

const storage = multer.diskStorage({
  destination(request, _file, callback) {
    const project = projectById(request.params.projectId);
    if (!project) return callback(new Error("项目不存在"));
    const folder = path.join(UPLOAD_DIR, project.id);
    fs.mkdirSync(folder, { recursive: true });
    callback(null, folder);
  },
  filename(_request, file, callback) {
    const extension = path.extname(file.originalname).toLowerCase();
    callback(null, `${id()}${extension}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE, files: 30 },
  fileFilter(_request, file, callback) {
    if (!assetType(file)) return callback(new multer.MulterError("LIMIT_UNEXPECTED_FILE", file.fieldname));
    callback(null, true);
  },
});

app.post("/api/projects/:projectId/assets", (req, res, next) => cloudMode ? res.status(400).json({ error: '请使用云端直传上传文件' }) : next(), upload.array("files", 30), async (request, response) => {
  const project = projectById(request.params.projectId);
  if (!project) {
    request.files?.forEach((file) => {
      try { fs.unlinkSync(file.path); } catch {}
    });
    return response.status(404).json({ error: "项目不存在" });
  }
  if (!request.files?.length) return response.status(400).json({ error: "请选择素材文件" });

  const baseX = numberOr(request.body.x, 0);
  const baseY = numberOr(request.body.y, 0);
  const requestedWidth = numberOr(request.body.width, 0);
  const requestedHeight = numberOr(request.body.height, 0);
  const timestamp = now();

  const nodes = request.files.map((file, index) => {
    const type = assetType(file);
    const defaults = type === "audio" ? { width: 360, height: 104 } : { width: 320, height: 220 };
    const offset = index * 34;
    const node = {
      id: id(),
      projectId: project.id,
      type,
      filename: cleanName(file.originalname, `未命名${type}`),
      storedName: file.filename,
      mimeType: file.mimetype || "application/octet-stream",
      size: file.size,
      x: baseX + offset,
      y: baseY + offset,
      width: Math.max(120, requestedWidth || defaults.width),
      height: Math.max(type === "audio" ? 88 : 90, requestedHeight || defaults.height),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    db.nodes.push(node);
    return publicNode(node);
  });

  touchProject(project.id);
  saveDatabase();
  for (const node of nodes) await cloudStorage.backup(assetUrl(node)).catch(() => {});
  response.status(201).json(nodes.map((node) => publicNode(nodeById(node.id))));
});

app.post("/api/projects/:projectId/nodes/:nodeId/references", (req, res, next) => cloudMode ? res.status(400).json({ error: '请使用云端直传上传参考文件' }) : next(), upload.array("files", 12), async (request, response) => {
  const project = projectById(request.params.projectId);
  const node = nodeById(request.params.nodeId);
  if (!project || !node || node.projectId !== project.id || node.kind !== "generator") {
    request.files?.forEach((file) => { try { fs.unlinkSync(file.path); } catch {} });
    return response.status(404).json({ error: "制作节点不存在" });
  }
  if (!request.files?.length) return response.status(400).json({ error: "请选择参考图片" });
  const policy = node.type === "video" ? VideoModels.referencePolicy(node.generation) : { limit: 2, types: ["image"] };
  const invalid = request.files.find((file) => !policy.types.includes(assetType(file)));
  if (invalid) {
    request.files.forEach((file) => { try { fs.unlinkSync(file.path); } catch {} });
    return response.status(400).json({ error: "当前生成方式不支持此素材，请切换到全能参考或选择图片" });
  }
  const current = node.generation.references || [];
  const occupied = occupiedReferenceSlots(node);
  const available = Math.max(0, policy.limit - current.length);
  const accepted = request.files.slice(0, available);
  request.files.slice(available).forEach((file) => { try { fs.unlinkSync(file.path); } catch {} });
  if (!accepted.length) return response.status(400).json({ error: `当前生成方式最多添加 ${policy.limit} 个参考素材` });
  const timestamp = now();
  accepted.forEach((file) => {
    const targetSlot = policy.limit <= 2 ? REFERENCE_SLOTS.find((slot) => !occupied.has(slot)) : null;
    occupied.add(targetSlot);
    current.push({
      id: id(),
      filename: cleanName(file.originalname, "参考图片"),
      storedName: file.filename,
      mimeType: file.mimetype || "application/octet-stream",
      type: assetType(file),
      size: file.size,
      targetSlot,
      createdAt: timestamp,
    });
  });
  node.generation.references = current;
  node.updatedAt = timestamp;
  touchProject(project.id);
  saveDatabase();
  for (const file of accepted) await cloudStorage.backup(cloudStorage.urlFor(node.projectId, file.filename)).catch(() => {});
  response.status(201).json(publicNode(node));
});

app.delete("/api/nodes/:nodeId/references/:referenceId", (request, response) => {
  const node = nodeById(request.params.nodeId);
  if (!node?.generation) return response.status(404).json({ error: "制作节点不存在" });
  const reference = (node.generation.references || []).find((item) => item.id === request.params.referenceId);
  if (!reference) return response.status(404).json({ error: "参考图片不存在" });
  node.generation.references = node.generation.references.filter((item) => item.id !== reference.id);
  node.updatedAt = now();
  touchProject(node.projectId);
  saveDatabase();
  response.status(204).end();
});

app.patch("/api/nodes/:nodeId", (request, response) => {
  const node = nodeById(request.params.nodeId);
  if (!node) return response.status(404).json({ error: "素材不存在" });

  const next = request.body || {};
  node.x = numberOr(next.x, node.x);
  node.y = numberOr(next.y, node.y);
  node.width = Math.max(120, numberOr(next.width, node.width));
  const minimumHeight = node.type === "audio" ? 88 : node.type === "text" ? 150 : 90;
  node.height = Math.max(minimumHeight, numberOr(next.height, node.height));
  if (node.type === "text") {
    if (Object.prototype.hasOwnProperty.call(next, "content")) node.content = String(next.content || "").slice(0, 20_000);
    if (Object.prototype.hasOwnProperty.call(next, "filename")) node.filename = cleanName(next.filename, node.filename || "文字");
  }
  if (node.kind === "generator" && next.generation) {
    const generation = next.generation;
    const allowedModels = ["Kling 3.0", "Seedance 2.0", "Seedance 2.0 Mini", "Seedance 2.0 Fast", "Seedance 2.5", "MiniMax H3", "Wan 3.0"];
    const allowedModes = ["standard", "professional", "4k"];
    const allowedMethods = ["text", "first-frame", "first-last"];
    const allowedRatios = ["16:9", "9:16", "1:1"];
    const allowedResolutions = node.type === "image" ? ["1024", "2048"] : ["adaptive", "720p", "1080p"];
    node.generation.prompt = String(generation.prompt ?? node.generation.prompt).slice(0, 5000);
    if (node.type !== "video" && typeof generation.model === "string") node.generation.model = cleanName(generation.model, "default");
    else if (allowedModels.includes(generation.model)) node.generation.model = generation.model;
    if (node.type === "text") {
      if (["natural", "creative", "professional"].includes(generation.style)) node.generation.style = generation.style;
      if (["short", "medium", "long"].includes(generation.length)) node.generation.length = generation.length;
    }
    if (allowedModes.includes(generation.mode)) node.generation.mode = generation.mode;
    if (allowedMethods.includes(generation.method)) node.generation.method = generation.method;
    if (allowedRatios.includes(generation.ratio)) node.generation.ratio = generation.ratio;
    if (allowedResolutions.includes(generation.resolution)) node.generation.resolution = generation.resolution;
    if ([5, 10, 15].includes(Number(generation.duration))) node.generation.duration = Number(generation.duration);
    if (typeof generation.audio === "boolean") node.generation.audio = generation.audio;
    if (typeof generation.multiShot === "boolean") node.generation.multiShot = generation.multiShot;
    if ([1, 2, 4].includes(Number(generation.count))) node.generation.count = Number(generation.count);
    if (Array.isArray(generation.selectedReferenceNodeIds)) {
      const incoming = new Set(db.edges.filter((edge) => edge.targetNodeId === node.id).map((edge) => edge.sourceNodeId));
      node.generation.selectedReferenceNodeIds = [...new Set(generation.selectedReferenceNodeIds.filter((nodeId) => incoming.has(nodeId)))];
    }
    if (node.type === "video") {
      const editable = ["model", "mode", "method", "ratio", "resolution", "duration", "audio", "multiShot", "count"];
      const changes = Object.fromEntries(editable.filter((key) => Object.hasOwn(generation, key)).map((key) => [key, generation[key]]));
      node.generation = VideoModels.normalize(changes, node.generation);
    }
    if (typeof generation.selectedOutputId === "string") {
      const output = node.generation.outputs?.find((item) => item.id === generation.selectedOutputId);
      if (output) {
        node.generation.selectedOutputId = output.id;
        node.generation.outputUrl = output.url || null;
        if (node.type === "text") node.content = output.text || "";
      }
    }
  }
  node.updatedAt = now();
  touchProject(node.projectId);
  saveDatabase();
  response.json(publicNode(node));
});

const generationHandlers = require("./generation")({
  nodeById, publicNode, saveDatabase, touchProject, selectedLinkedReferences, generationReferences, uploadDir: UPLOAD_DIR, cloudStorage,
});
const cloudJobs = cloudMode ? require('./cloud-jobs')({ app, store, media: cloudStorage, handlers: generationHandlers, nodeById, publicNode, touchProject }) : null;
if (cloudMode) require('./direct-uploads')({ app, db, save: saveDatabase, media: cloudStorage, nodeById, projectById, publicNode, touchProject });
app.post("/api/nodes/:nodeId/generate", cloudJobs ? cloudJobs.generate : generationHandlers.generate);
app.get("/api/nodes/:nodeId/generation", cloudJobs ? cloudJobs.status : generationHandlers.status);

let cloudSyncRunning = false;
async function syncCloud() {
  if (cloudMode || !cloudStorage.enabled || cloudSyncRunning) return;
  cloudSyncRunning = true;
  try {
    for (const node of [...db.nodes]) {
      if (nodeById(node.id) !== node) continue;
      if (node.storedName) await cloudStorage.backup(assetUrl(node)).catch(() => {});
      for (const ref of node.generation?.references || []) await cloudStorage.backup(cloudStorage.urlFor(node.projectId, ref.storedName)).catch(() => {});
      if (node.generation) await generationHandlers.reconcile(node).catch(() => {});
    }
  } finally { cloudSyncRunning = false; }
}
app.get("/api/storage", (request, response) => {
  const state = cloudStorage.summary();
  if (cloudMode) {
    const jobs = db.jobs.filter(j => projectAccess.readable(projectById(j.projectId), request.user));
    state.ready = Object.entries(db.cloudRecords).filter(([url, record]) => record.status === 'ready' && projectAccess.readable(projectById(url.split('/')[2]), request.user)).length;
    state.pending = jobs.filter(j => j.status === 'archiving').length;
    const failures = jobs.filter(j => ['archive_failed','poll_failed'].includes(j.status));
    state.failed = failures.length; state.error = failures[0]?.error || null;
  }
  response.json({ ...state, syncing: cloudSyncRunning });
});
app.post("/api/storage/sync", async (request, response) => {
  if (cloudMode) { await cloudJobs.retryPaused(job => projectAccess.readable(projectById(job.projectId), request.user)); return response.status(202).json({ enabled: cloudStorage.enabled, syncing: false }); }
  cloudStorage.retry();
  for (const node of db.nodes) for (const job of node.generation?.jobs || []) delete job.storageRetryAt;
  void syncCloud();
  response.status(202).json({ ...cloudStorage.summary(), syncing: cloudSyncRunning });
});

app.get("/api/nodes/:nodeId/download", async (request, response) => {
  const node = nodeById(request.params.nodeId);
  if (!node) return response.status(404).json({ error: "节点不存在" });
  let url = publicNode(node).url;
  if (!url) return response.status(404).json({ error: "还没有可下载的结果" });
  if (cloudMode) {
    const signed = url.startsWith('/uploads/') ? cloudStorage.signedUrl(url, 3600, node.filename + path.extname(url)) : url;
    if (!signed) return response.status(404).json({ error: '结果尚未保存到云端' });
    response.setHeader('Cache-Control', 'no-store');
    if (request.query.link === '1') return response.json({ url: signed });
    return response.redirect(302, signed);
  }
  if (url.startsWith("/uploads/")) {
    const relative = decodeURIComponent(url.slice("/uploads/".length));
    const file = path.resolve(UPLOAD_DIR, relative);
    if (!file.startsWith(`${UPLOAD_DIR}${path.sep}`)) return response.status(400).json({ error: "无效文件路径" });
    if (fs.existsSync(file)) return response.download(file);
    const signed = cloudStorage.signedUrl(url, 3600, node.filename + path.extname(file));
    if (!signed) return response.status(404).json({ error: "本地文件不存在且尚无云端副本" });
    response.setHeader("Cache-Control", "no-store");
    url = signed;
  }
  if (!/^https?:\/\//i.test(url)) return response.status(400).json({ error: "结果地址不支持下载" });
  try {
    const result = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!result.ok || !result.body) throw new Error(`下载服务返回 ${result.status}`);
    response.setHeader("Content-Type", result.headers.get("content-type") || "application/octet-stream");
    const extension = path.extname(new URL(url).pathname).match(/^\.[a-z0-9]{1,6}$/i)?.[0] || (node.type === "video" ? ".mp4" : ".png");
    response.setHeader("Content-Disposition", `attachment; filename="result${extension}"; filename*=UTF-8''${encodeURIComponent(node.filename + extension)}`);
    await pipeline(Readable.fromWeb(result.body), response);
  } catch (error) {
    if (response.headersSent) response.destroy();
    else response.status(502).json({ error: error.message });
  }
});

app.delete("/api/nodes/:nodeId", (request, response) => {
  const node = nodeById(request.params.nodeId);
  if (!node) return response.status(404).json({ error: "素材不存在" });
  db.nodes.forEach((target) => {
    if (Array.isArray(target.generation?.selectedReferenceNodeIds)) {
      target.generation.selectedReferenceNodeIds = target.generation.selectedReferenceNodeIds.filter((nodeId) => nodeId !== node.id);
    }
  });
  db.nodes = db.nodes.filter((item) => item.id !== node.id);
  db.edges = db.edges.filter((edge) => edge.sourceNodeId !== node.id && edge.targetNodeId !== node.id);
  touchProject(node.projectId);
  saveDatabase();
  response.status(204).end();
});

app.use(express.static(path.join(ROOT, "public")));
app.get("/{*path}", (_request, response) => {
  response.sendFile(path.join(ROOT, "public", "index.html"));
});

app.use((error, request, response, _next) => {
  console.error('Request failed:', error.code || error.name || 'Error');
  if (error instanceof multer.MulterError) {
    request.files?.forEach((file) => {
      try { fs.unlinkSync(file.path); } catch {}
    });
    if (error.code === "LIMIT_FILE_SIZE") return response.status(413).json({ error: "文件过大，上传上限为 1 GB" });
    return response.status(400).json({ error: "文件格式不支持或一次选择的文件过多" });
  }
  response.status(error.message === "项目不存在" ? 404 : 500).json({ error: error.message || "服务器处理失败" });
});

if (!process.env.VERCEL && require.main === module) app.listen(PORT, HOST, () => {
  console.log(`Material Canvas is running at http://localhost:${PORT}`);
  if (cloudStorage.enabled && !cloudMode) {
    void syncCloud();
    setInterval(() => { void syncCloud(); }, 15000).unref();
  }
});
module.exports = app;
