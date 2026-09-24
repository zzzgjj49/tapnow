const fs = require("node:fs/promises");
const path = require("node:path");

const models = {
  "Seedance 2.0": "dreamina-seedance-2-0-260128",
  "Seedance 2.0 Fast": "dreamina-seedance-2-0-fast-260128",
  "Seedance 2.0 Mini": "dreamina-seedance-2-0-mini-260615",
};
const endpointEnvironment = {
  "Seedance 2.0 Fast": "ARK_SEEDANCE_20_FAST_ENDPOINT_ID",
};
function modelFor(name) {
  const model = models[name];
  if (!model) throw new Error("当前 BytePlus 服务未接入此模型，请选择 Seedance 2.0、Fast 或 Mini");
  const variable = endpointEnvironment[name];
  const endpoint = variable ? process.env[variable]?.trim() : "";
  if (!endpoint) return model;
  if (!/^ep-[A-Za-z0-9-]+$/.test(endpoint)) throw new Error(`服务端 ${variable} 不是有效的 BytePlus 接入点 ID`);
  return endpoint;
}
function enabled() { return process.env.VIDEO_GENERATION_PROVIDER === "byteplus"; }
function config() {
  return { provider: "byteplus", prefix: "ARK", key: process.env.ARK_API_KEY,
    url: `${(process.env.ARK_BASE_URL || "https://ark.ap-southeast.bytepluses.com/api/v3").replace(/\/$/, "")}/contents/generations/tasks` };
}
const mimeTypes = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".mp4": "video/mp4", ".mov": "video/quicktime" };
async function payload(input, uploadDir) {
  const model = modelFor(input.model);
  const s = input.settings;
  if (!["text", "first-frame", "first-last", "omni"].includes(s.method)) throw new Error("此模型暂不支持该生成方式");
  const resolutions = input.model === "Seedance 2.0" ? ["480p", "720p", "1080p", "4k"] : ["480p", "720p"];
  if (!resolutions.includes(s.resolution)) throw new Error("该模型不支持所选清晰度");
  if (!Number.isInteger(s.duration) || s.duration < 4 || s.duration > 15) throw new Error("当前模型时长需为 4–15 秒整数");
  const refs = input.references;
  for (const [type, limit] of [["image", 9], ["video", 3], ["audio", 3]]) {
    if (refs.filter((r) => r.type === type).length > limit) throw new Error(`最多使用 ${limit} 个 ${type} 参考素材`);
  }
  if (refs.some((r) => r.type === "audio") && !refs.some((r) => ["image", "video"].includes(r.type))) throw new Error("音频参考需要同时提供图片或视频参考");
  const content = [{ type: "text", text: input.prompt }];
  let encodedBytes = 0;
  for (const ref of refs) {
    const type = ref.type;
    if (!["image", "video", "audio"].includes(type)) throw new Error("不支持的参考素材类型");
    let localPath = ref.path;
    if (!localPath && ref.url?.startsWith("/uploads/")) localPath = path.join(uploadDir, decodeURIComponent(ref.url.slice(9)));
    let url = ref.url;
    if (localPath) {
      const root = await fs.realpath(uploadDir);
      const resolved = await fs.realpath(localPath);
      if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error("参考素材路径无效");
      const ext = path.extname(resolved).toLowerCase();
      const mime = mimeTypes[ext];
      if (!mime || !mime.startsWith(`${type}/`)) throw new Error("模型不支持此素材格式，请使用 JPG/PNG/WebP/GIF、MP4/MOV 或 MP3/WAV");
      const stat = await fs.stat(resolved);
      const limit = type === "image" ? 30 : type === "audio" ? 15 : 200;
      if (stat.size > limit * 1024 * 1024) throw new Error(`单个 ${type} 参考文件不能超过 ${limit} MB`);
      if (type === "video") {
        if (!/^https?:\/\//i.test(url || "") && process.env.PUBLIC_BASE_URL) url = `${process.env.PUBLIC_BASE_URL.replace(/\/$/, "")}/uploads/${path.relative(root, resolved).split(path.sep).map(encodeURIComponent).join("/")}`;
        if (!/^https?:\/\//i.test(url || "")) throw new Error("本地参考视频需要公网访问地址：请配置 PUBLIC_BASE_URL 后使用（图片和音频无需此配置）");
      } else {
        encodedBytes += Math.ceil(stat.size / 3) * 4;
        if (encodedBytes > 60 * 1024 * 1024) throw new Error("参考素材编码后过大，请压缩至总计 45 MB 以内");
        url = `data:${mime};base64,${(await fs.readFile(resolved)).toString("base64")}`;
      }
    } else if (!/^https?:\/\//i.test(url || "")) throw new Error("参考素材缺少有效的公开 URL");
    const role = ref.role === "first-frame" ? "first_frame" : ref.role === "last-frame" ? "last_frame" : `reference_${type}`;
    content.push({ type: `${type}_url`, [`${type}_url`]: { url }, role });
  }
  return { model, content, ratio: s.ratio === "adaptive" ? "adaptive" : s.ratio,
    resolution: s.resolution, duration: s.duration, generate_audio: s.audio, watermark: false };
}
function result(value) {
  return { jobId: value.id, status: value.status === "expired" ? "failed" : value.status || "queued",
    outputUrl: value.content?.video_url, usage: value.usage,
    error: typeof value.error === "object" && value.error ? `${value.error.code || "BytePlus"}: ${value.error.message || "任务失败"}` : value.error || (value.status === "expired" ? "任务已过期，请重新生成" : null) };
}
module.exports = { models, enabled, config, payload, result };
