const crypto = require("node:crypto");
const path = require("node:path");
const VideoModels = require("./public/video-models");
const BytePlus = require("./byteplus");

// Gateway boundary: provider-specific authentication and payload translation belong here.
module.exports = function generationHandlers(context) {
  const { nodeById, publicNode, saveDatabase, touchProject, selectedLinkedReferences, generationReferences, uploadDir, cloudStorage } = context;
  const polling = new Map();
  const activeRuns = new Set();
  const running = (status) => ["queued", "pending", "processing", "running", "generating", "submitted"].includes(status);
  const settingsKeys = ["mode", "method", "ratio", "resolution", "duration", "audio", "multiShot", "style", "length"];
  function service(node) {
    if (node.type === "video" && BytePlus.enabled()) return BytePlus.config();
    const prefix = { video: "VIDEO", image: "IMAGE", text: "TEXT" }[node.type];
    return {
      url: process.env[`${prefix}_GENERATION_API_URL`],
      statusUrl: process.env[`${prefix}_GENERATION_STATUS_URL`],
      key: process.env[`${prefix}_GENERATION_API_KEY`], prefix,
    };
  }
  async function gateway(url, config, body) {
    const response = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json", ...(config.key ? { Authorization: `Bearer ${config.key}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(60_000),
    });
    const result = await response.json().catch(() => { throw new Error("生成服务未返回有效 JSON"); });
    if (!response.ok) {
      const message = typeof result.error === "string" ? result.error : result.error?.message || `生成服务返回 ${response.status}`;
      throw new Error(`${result.error?.code ? `${result.error.code}: ` : ""}${config.key ? message.split(config.key).join("[已隐藏]") : message}`);
    }
    return config.provider === "byteplus" ? BytePlus.result(result) : result;
  }
  function parseResult(result, job, type) {
    job = { ...job, ...(result.usage ? { usage: result.usage } : {}) };
    const outputText = result.outputText ?? result.text;
    const outputUrl = result.outputUrl;
    if (outputUrl && !/^https?:\/\//i.test(outputUrl) && !/^\/(?!\/)/.test(outputUrl)) throw new Error("生成结果 URL 必须是 HTTP(S) 或本站路径");
    const hasOutput = type === "text" ? typeof outputText === "string" && outputText.length > 0 : Boolean(outputUrl);
    const status = String(result.status || (hasOutput ? "complete" : "generating")).toLowerCase();
    if (["failed", "error", "cancelled", "canceled"].includes(status)) return { ...job, status: "failed", error: String(result.error || "生成任务失败") };
    if (hasOutput && !running(status)) return { ...job, status: "complete", outputUrl: outputUrl || null, outputText: typeof outputText === "string" ? outputText.slice(0, 20_000) : null, jobId: result.jobId || job.jobId, error: null };
    const jobId = result.jobId || job.jobId;
    if (!jobId) throw new Error("生成服务没有返回结果或任务编号");
    if (!["complete", "completed", "succeeded", "success", ...["queued", "pending", "processing", "running", "generating", "submitted"]].includes(status)) throw new Error(`未知任务状态：${status}`);
    if (["complete", "completed", "succeeded", "success"].includes(status) && !hasOutput) throw new Error("任务已完成，但生成服务没有返回结果");
    return { ...job, jobId: String(jobId), status: "generating", error: null };
  }
  function summarize(node) {
    const generation = node.generation;
    const jobs = generation.jobs || [];
    generation.outputs = jobs.filter((job) => job.status === "complete").map((job) => ({ id: String(job.index), url: job.outputUrl, text: job.outputText }));
    generation.status = jobs.some((job) => running(job.status)) ? "generating" : jobs.some((job) => job.status === "failed") ? "failed" : "complete";
    generation.error = jobs.filter((job) => job.error).map((job) => `第 ${job.index + 1} 个结果：${job.error}`).join("；") || null;
    generation.storageError = jobs.find((job) => job.storageError)?.storageError || null;
    generation.storageStatus = jobs.some((job) => job.storageStatus === "failed") ? "failed" : jobs.length && jobs.every((job) => job.storageStatus === "ready") ? "ready" : null;
    const selected = generation.outputs.find((output) => output.id === generation.selectedOutputId) || generation.outputs[0];
    generation.outputUrl = selected?.url || null;
    if (node.type === "text") node.content = selected?.text || "";
    generation.selectedOutputId = selected?.id || null;
    generation.jobId = jobs.find((job) => job.jobId)?.jobId || null;
    node.updatedAt = new Date().toISOString();
    touchProject(node.projectId);
    saveDatabase();
  }
  function buildPayload(node) {
    const inputs = selectedLinkedReferences(node);
    if (inputs.some((input) => input.kind === "generator" && (input.type === "text" ? !input.content?.trim() : !input.url))) {
      throw new Error("选中的上游制作节点尚未生成结果，请先生成或取消该引用");
    }
    const upstreamText = inputs.filter((input) => input.type === "text" && input.content?.trim()).map((input) => input.content.trim());
    const prompt = [...upstreamText, node.generation.prompt.trim()].filter(Boolean).join("\n\n");
    if (!prompt) throw new Error("请先描述内容，或引用一个已生成的文字节点");
    let references = generationReferences(node);
    if (node.type === "video") {
      const policy = VideoModels.referencePolicy(node.generation);
      if (references.length > policy.limit) throw new Error(`当前方式最多使用 ${policy.limit} 个媒体参考，请移除多余引用`);
      if (references.some((ref) => !policy.types.includes(ref.type || "image"))) throw new Error("当前生成方式不支持已选媒体，请切换全能参考或移除不兼容引用");
      const method = node.generation.method;
      if (["first-frame", "first-last"].includes(method) && !references.length) throw new Error("请添加首帧参考图片，或切换文生视频/全能参考");
      if (method === "edit" && !references.some((ref) => ref.type === "video")) throw new Error("视频编辑需要至少一个参考视频");
      if (["first-frame", "first-last"].includes(method)) {
        // Upload order and selected incoming edge order determine first/last frame.
        references = references.map((ref, index) => ({ ...ref, role: index === 0 ? "first-frame" : "last-frame" }));
      }
    }
    return {
      projectId: node.projectId, nodeId: node.id, type: node.type, prompt, model: node.generation.model,
      settings: { ...Object.fromEntries(settingsKeys.filter((key) => node.generation[key] !== undefined).map((key) => [key, node.generation[key]])), count: 1 },
      references: references.map((reference) => ({
        filename: reference.filename, type: reference.type || "image",
        ...(reference.storedName ? { path: path.join(uploadDir, node.projectId, reference.storedName), ...(process.env.PUBLIC_BASE_URL ? { url: `${process.env.PUBLIC_BASE_URL.replace(/\/$/, "")}${reference.url}` } : {}) } : { url: reference.url }),
        role: ["omni", "edit"].includes(node.generation.method) ? (reference.type === "video" && node.generation.method === "edit" ? "source-video" : "reference") : reference.role || reference.targetSlot || null,
        sourceNodeId: reference.linked ? reference.nodeId : null,
      })),
      inputs: inputs.map((input) => ({ nodeId: input.nodeId, type: input.type, filename: input.filename, role: input.role, ...(input.type === "text" ? { content: input.content } : {}) })),
    };
  }
  async function generate(request, response) {
    const node = nodeById(request.params.nodeId);
    if (!node || node.kind !== "generator") return response.status(404).json({ error: "制作节点不存在" });
    if (running(node.generation.status)) return response.status(409).json({ error: "生成任务仍在进行，请等待完成" });
    const config = service(node);
    if (!config.url) return response.status(503).json({ error: `尚未配置生成服务（${config.prefix}_GENERATION_API_URL）` });
    if (config.provider === "byteplus" && !config.key) return response.status(503).json({ error: "请在服务端 .env 配置 ARK_API_KEY" });
    let payload;
    try {
      payload = buildPayload(node);
      if (cloudStorage?.enabled) payload = await cloudStorage.preparePayload(payload);
      if (config.provider === "byteplus") payload = await BytePlus.payload(payload, uploadDir);
    } catch (error) { return response.status(400).json({ error: error.message }); }
    const runId = crypto.randomUUID();
    activeRuns.add(runId);
    node.generation.runId = runId;
    node.generation.jobs = Array.from({ length: node.generation.count || 1 }, (_, index) => ({ index, status: "generating", jobId: null }));
    node.generation.pollError = null;
    summarize(node);
    await Promise.all(node.generation.jobs.map(async (job) => {
      let updated;
      try {
        const result = await gateway(config.url, config, config.provider === "byteplus" ? payload : { ...payload, requestId: `${runId}:${job.index}`, batchIndex: job.index, batchCount: node.generation.jobs.length });
        updated = parseResult(result, job, node.type);
        if (cloudStorage?.enabled) await cloudStorage.archiveJob(node, updated);
      } catch (error) { updated = { ...job, status: "failed", error: error.message }; }
      if (nodeById(node.id) !== node || node.generation.runId !== runId) return;
      node.generation.jobs[job.index] = updated;
      summarize(node);
    }));
    activeRuns.delete(runId);
    response.json(publicNode(node));
  }
  async function refresh(node) {
    const config = service(node);
    if (!config.url) throw new Error("生成服务尚未配置，无法查询任务");
    // Recover jobs written by older versions of the app.
    if (!node.generation.jobs?.length && node.generation.jobId) node.generation.jobs = [{ index: 0, status: "generating", jobId: node.generation.jobId }];
    if (!node.generation.jobs?.length) node.generation.jobs = [{ index: 0, status: "failed", error: "旧任务缺少任务编号，无法查询；重新生成会新建任务" }];
    const jobs = node.generation.jobs;
    if (!activeRuns.has(node.generation.runId)) {
      jobs.forEach((job) => {
        if (running(job.status) && !job.jobId) Object.assign(job, { status: "failed", error: "提交中断且未取得任务编号，结果未知；重新生成会新建任务" });
      });
    }
    const runId = node.generation.runId;
    const failures = [];
    await Promise.all(jobs.filter((job) => running(job.status) && job.jobId).map(async (job) => {
      try {
        const url = config.statusUrl ? config.statusUrl.replaceAll("{jobId}", encodeURIComponent(job.jobId)) : `${config.url.replace(/\/$/, "")}/${encodeURIComponent(job.jobId)}`;
        const result = await gateway(url, config);
        if (nodeById(node.id) !== node || node.generation.runId !== runId) return;
        const updated = parseResult(result, job, node.type);
        if (cloudStorage?.enabled) await cloudStorage.archiveJob(node, updated);
        if (nodeById(node.id) === node && node.generation.runId === runId) jobs[job.index] = updated;
      } catch (error) { failures.push(error.message); }
    }));
    if (nodeById(node.id) !== node || node.generation.runId !== runId) return;
    node.generation.pollError = failures.join("；") || null;
    summarize(node);
  }
  async function reconcile(node) {
    if (!polling.has(node.id)) polling.set(node.id, (async () => {
      if (running(node.generation.status)) return refresh(node);
      if (!cloudStorage?.enabled) return;
      if (!node.generation.jobs?.length && node.generation.outputs?.length) node.generation.jobs = node.generation.outputs.map((output, index) => ({ index, status: "complete", outputUrl: output.url, outputText: output.text }));
      const jobs = node.generation.jobs || [];
      if (!jobs.length) return;
      const before = JSON.stringify(jobs);
      for (const job of jobs) await cloudStorage.archiveJob(node, job);
      if (nodeById(node.id) === node && node.generation.jobs === jobs && before !== JSON.stringify(jobs)) summarize(node);
    })().finally(() => polling.delete(node.id)));
    return polling.get(node.id);
  }
  async function status(request, response) {
    const node = nodeById(request.params.nodeId);
    if (!node?.generation) return response.status(404).json({ error: "制作节点不存在" });
    if (running(node.generation.status)) {
      try { await reconcile(node); } catch (error) { node.generation.pollError = error.message; saveDatabase(); }
    }
    response.json(publicNode(node));
  }
  return { generate, status, reconcile, buildPayload, service, gateway, parseResult, summarize };
};
