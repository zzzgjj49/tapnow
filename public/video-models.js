// UI presets transcribed from the supplied reference screenshots, not provider API capabilities.
(function (root, factory) {
  const value = factory();
  if (typeof module === "object" && module.exports) module.exports = value;
  else root.VideoModels = value;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const ratios = ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9"];
  const seconds = (max) => Array.from({ length: max - 3 }, (_, i) => i + 4);
  const seed = { methods: ["first-last", "omni"], ratios, durations: seconds(15), audio: true, multiShot: false };
  const models = {
    "Kling 3.0": { methods: ["text", "first-frame", "first-last"], modes: ["standard", "professional", "4k"], ratios: ["16:9", "9:16", "1:1"], resolutions: ["adaptive", "720p", "1080p"], durations: [5, 10, 15], audio: true, multiShot: true, defaults: { method: "first-last", mode: "professional", ratio: "16:9", resolution: "adaptive", duration: 15 }, rates: { adaptive: 22, "720p": 22, "1080p": 22 } },
    "Seedance 2.0 Fast": { ...seed, resolutions: ["480p", "720p"], defaults: { method: "omni", ratio: "16:9", resolution: "720p", duration: 15 }, rates: { "720p": 20 } },
    "Seedance 2.0": { ...seed, resolutions: ["480p", "720p", "1080p", "4k"], defaults: { method: "omni", ratio: "16:9", resolution: "720p", duration: 15 }, rates: { "4k": 121 } },
    "Seedance 2.5": { ...seed, methods: ["first-last", "omni", "edit"], ratios: ["adaptive", ...ratios], resolutions: ["480p", "720p", "1080p"], durations: seconds(30), defaults: { method: "omni", ratio: "adaptive", resolution: "720p", duration: 15 }, rates: { "720p": 40 } },
  };
  const labels = { text: "文生视频", "first-frame": "首帧", "first-last": "首尾帧", omni: "全能参考", edit: "视频编辑", adaptive: "自适应", standard: "标准", professional: "专业", "4k": "4K" };
  // Preserve existing projects; only the four supplied model screenshots define new presets.
  models["Seedance 2.0 Mini"] = { ...models["Seedance 2.0 Fast"], rates: {} };
  for (const name of ["MiniMax H3", "Wan 3.0"]) {
    models[name] = { ...models["Kling 3.0"], legacy: true, rates: {} };
  }
  function get(model) { return models[model] || models["Kling 3.0"]; }
  function normalize(value, previous = {}) {
    const result = { ...previous, ...value };
    if (!models[result.model]) result.model = "Kling 3.0";
    const spec = get(result.model);
    for (const [key, list] of Object.entries({ method: spec.methods, mode: spec.modes, ratio: spec.ratios, resolution: spec.resolutions, duration: spec.durations })) {
      if (!list) { delete result[key]; continue; }
      if (key === "duration") result[key] = Number(result[key]);
      if (!list.includes(result[key])) result[key] = spec.defaults[key] ?? list[0];
    }
    result.count = [1, 2, 4].includes(Number(result.count)) ? Number(result.count) : 1;
    result.audio = typeof result.audio === "boolean" ? result.audio : true;
    result.multiShot = spec.multiShot ? Boolean(result.multiShot) : false;
    return result;
  }
  function estimate(generation) {
    const rate = get(generation.model).rates?.[generation.resolution];
    return rate ? Math.ceil(rate * generation.duration * generation.count) : null;
  }
  function referencePolicy(generation) {
    if (["omni", "edit"].includes(generation.method)) return { limit: 12, types: ["image", "video", "audio"] };
    if (generation.method === "text") return { limit: 0, types: [] };
    return { limit: generation.method === "first-frame" ? 1 : 2, types: ["image"] };
  }
  return { models, get, normalize, estimate, referencePolicy, labels };
});
