const app = document.querySelector("#app");
const modalRoot = document.querySelector("#modal-root");
const toastRoot = document.querySelector("#toast-root");
const filePicker = document.querySelector("#file-picker");

let activeCanvas = null;
let pickerContext = null;
let projectCategory = new URLSearchParams(location.search).get("category") === "personal" ? "personal" : "team";

const ACCEPT = {
  image: ".jpg,.jpeg,.png,.webp,.gif,image/jpeg,image/png,image/webp,image/gif",
  video: ".mp4,.mov,.webm,video/mp4,video/quicktime,video/webm",
  audio: ".mp3,.wav,.m4a,.aac,audio/mpeg,audio/wav,audio/mp4,audio/aac",
};

const EXTENSIONS = {
  image: new Set(["jpg", "jpeg", "png", "webp", "gif"]),
  video: new Set(["mp4", "mov", "webm"]),
  audio: new Set(["mp3", "wav", "m4a", "aac"]),
};

const icons = {
  expand: '<svg class="icon" viewBox="0 0 24 24"><path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"/></svg>',
  collapse: '<svg class="icon" viewBox="0 0 24 24"><path d="M3 8h5V3M21 8h-5V3M8 21v-5H3M16 21v-5h5"/></svg>',
  plus: '<svg class="icon" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  back: '<svg class="icon" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>',
  dots: '<svg class="icon" viewBox="0 0 24 24"><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none"/></svg>',
  edit: '<svg class="icon" viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg>',
  trash: '<svg class="icon" viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7"/><path d="M10 11v5M14 11v5"/></svg>',
  image: '<svg class="icon" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="9" r="1.5"/><path d="m4 17 5-5 4 4 2-2 5 4"/></svg>',
  video: '<svg class="icon" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m10 9 5 3-5 3Z"/></svg>',
  audio: '<svg class="icon" viewBox="0 0 24 24"><path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 10v4"/></svg>',
  text: '<svg class="icon" viewBox="0 0 24 24"><path d="M5 6h14M12 6v13M8 19h8"/></svg>',
  eye: '<svg class="icon" viewBox="0 0 24 24"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/></svg>',
  close: '<svg class="icon" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg>',
  upload: '<svg class="icon" viewBox="0 0 24 24"><path d="M12 16V4m0 0L7 9m5-5 5 5"/><path d="M5 14v5h14v-5"/></svg>',
  check: '<svg class="icon" viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg>',
  alert: '<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 4h.01"/></svg>',
  play: '<svg class="icon" viewBox="0 0 24 24"><path d="m8 5 11 7-11 7Z" fill="currentColor" stroke="none"/></svg>',
  pause: '<svg class="icon" viewBox="0 0 24 24"><path d="M8 5v14M16 5v14" stroke-width="2.5"/></svg>',
  folder: '<svg class="icon" viewBox="0 0 24 24"><path d="M3 7h7l2 2h9v10H3Z"/><path d="M3 7V5h7l2 2"/></svg>',
  magic: '<svg class="icon" viewBox="0 0 24 24"><path d="m4 20 10-10M13 5l1-3 1 3 3 1-3 1-1 3-1-3-3-1ZM6 12l.7-2 .8 2 2 .8-2 .7-.8 2-.7-2-2-.7Z"/><path d="m12 12 4 4"/></svg>',
  sliders: '<svg class="icon" viewBox="0 0 24 24"><path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></svg>',
  frames: '<svg class="icon" viewBox="0 0 24 24"><rect x="3" y="5" width="7" height="14" rx="1.5"/><rect x="14" y="5" width="7" height="14" rx="1.5"/><path d="m11 12 2-1.5v3Z"/></svg>',
  microphone: '<svg class="icon" viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  arrowUp: '<svg class="icon" viewBox="0 0 24 24"><path d="M12 19V5m0 0L7 10m5-5 5 5"/></svg>',
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function api(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !(options.body instanceof FormData)) headers["Content-Type"] = "application/json";
  const response = await fetch(url, { ...options, headers });
  if (response.status === 401) { location.href = '/account.html'; throw new Error('请先登录'); }
  if (!response.ok) {
    let message = "请求失败";
    try {
      message = (await response.json()).error || message;
    } catch {}
    throw new Error(message);
  }
  if (response.status === 204) return null;
  return response.json();
}

function navigate(pathname) {
  history.pushState({}, "", pathname);
  route();
}

function projectPath(id) {
  return `/canvas/${encodeURIComponent(id)}`;
}

function toast(message) {
  const element = document.createElement("div");
  element.className = "toast";
  element.textContent = message;
  toastRoot.append(element);
  window.setTimeout(() => element.remove(), 2400);
}

function closeModal() {
  modalRoot.replaceChildren();
}

function modalBackdrop(content, className = "") {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `<div class="${className}">${content}</div>`;
  backdrop.addEventListener("pointerdown", (event) => {
    if (event.target === backdrop) closeModal();
  });
  modalRoot.replaceChildren(backdrop);
  const escapeHandler = (event) => {
    if (event.key === "Escape") {
      closeModal();
      window.removeEventListener("keydown", escapeHandler);
    }
  };
  window.addEventListener("keydown", escapeHandler);
  return backdrop;
}

function showRenameDialog(project, onSaved) {
  const backdrop = modalBackdrop(`
    <form class="dialog" data-dialog-form>
      <h2>修改项目名称</h2>
      <p>名称会显示在工作空间和 Canvas 左上角。</p>
      <input name="name" maxlength="80" autocomplete="off" value="${escapeHtml(project.name)}" aria-label="项目名称" />
      <div class="dialog-actions">
        <button type="button" class="secondary-button" data-cancel>取消</button>
        <button type="submit" class="primary-button">保存</button>
      </div>
    </form>
  `);
  const input = backdrop.querySelector("input");
  backdrop.querySelector("[data-cancel]").addEventListener("click", closeModal);
  backdrop.querySelector("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = input.value.trim();
    if (!name) return input.focus();
    const submit = event.submitter;
    submit.disabled = true;
    try {
      const updated = await api(`/api/projects/${project.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
      closeModal();
      onSaved(updated);
    } catch (error) {
      submit.disabled = false;
      toast(error.message);
    }
  });
  requestAnimationFrame(() => {
    input.focus();
    input.select();
  });
}

function showDeleteProjectDialog(project, onDeleted) {
  const backdrop = modalBackdrop(`
    <div class="dialog">
      <h2>删除“${escapeHtml(project.name)}”？</h2>
      <p>项目会从画板中删除。云端文件和已有用量记录保留，此操作无法撤销。</p>
      <div class="dialog-actions">
        <button type="button" class="secondary-button" data-cancel>取消</button>
        <button type="button" class="danger-button" data-confirm>删除项目</button>
      </div>
    </div>
  `);
  backdrop.querySelector("[data-cancel]").addEventListener("click", closeModal);
  backdrop.querySelector("[data-confirm]").addEventListener("click", async (event) => {
    event.currentTarget.disabled = true;
    try {
      await api(`/api/projects/${project.id}`, { method: "DELETE" });
      closeModal();
      onDeleted();
    } catch (error) {
      event.currentTarget.disabled = false;
      toast(error.message);
    }
  });
}

function relativeTime(timestamp) {
  const elapsed = Math.max(0, Date.now() - new Date(timestamp).getTime());
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (elapsed < minute) return "刚刚编辑";
  if (elapsed < hour) return `${Math.floor(elapsed / minute)} 分钟前编辑`;
  if (elapsed < day) return `${Math.floor(elapsed / hour)} 小时前编辑`;
  if (elapsed < day * 7) return `${Math.floor(elapsed / day)} 天前编辑`;
  return `${new Date(timestamp).toLocaleDateString("zh-CN")} 编辑`;
}

function hueFromId(value) {
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return 210 + (hash % 90);
}

async function renderWorkspace() {
  activeCanvas?.destroy();
  activeCanvas = null;
  closeModal();
  app.innerHTML = '<div class="loading-screen"><div><span class="loading-dot"></span>正在打开工作空间</div></div>';
  try {
    const allProjects = await api("/api/projects");
    const projects = allProjects.filter(project => project.visibility === projectCategory);
    const categoryName = projectCategory === "personal" ? "个人项目" : "团队项目";
    const cards = projects.map((project) => `
      <article class="project-card" data-project-id="${project.id}" tabindex="0" aria-label="打开项目 ${escapeHtml(project.name)}">
        <div class="project-cover" style="--cover-hue:${hueFromId(project.id)}">
          <div class="project-cover-empty"><div class="brand-mark"><span></span></div></div>
          ${project.coverUrl ? `<img src="${project.coverUrl}" alt="" loading="lazy" />` : ""}
        </div>
        <div class="project-info">
          <h2 class="project-name">${escapeHtml(project.name)}</h2>
          <div class="project-time">${project.visibility === "personal" ? "仅自己可见" : "团队共享"} · ${relativeTime(project.updatedAt)}</div>
        </div>
        <button class="card-menu-button" aria-label="项目操作" aria-expanded="false" data-project-menu>${icons.dots}</button>
      </article>
    `).join("");

    app.innerHTML = `
      <div class="workspace">
        <header class="workspace-header">
          <div class="brand"><div class="brand-mark"><span></span></div><span>素材 Canvas</span></div>
          <a class="secondary-button" href="/account.html">管理中心</a>
          <button class="new-project-button" data-new-project>${icons.plus}<span>新建${categoryName}</span></button>
        </header>
        <main class="workspace-main">
          <div class="workspace-heading">
            <div class="eyebrow">Internal workspace</div>
            <h1>${categoryName}</h1>
            <p>${projectCategory === "personal" ? "仅自己可见，保存你的创作与灵感。" : "与受邀成员共同使用，整理团队的创作素材。"}</p>
          </div>
          <nav class="project-categories" aria-label="项目分类">
            ${["personal", "team"].map(category => `<button type="button" data-category="${category}" aria-pressed="${projectCategory === category}">${category === "personal" ? "个人项目" : "团队项目"}<span>${allProjects.filter(p => p.visibility === category).length}</span></button>`).join("")}
          </nav>
          ${projects.length ? `<section class="project-grid">${cards}</section>` : `
            <section class="empty-workspace">
              <div><div class="empty-icon">${icons.folder}</div><strong>还没有${categoryName}</strong><span>点击右上角新建${categoryName}</span></div>
            </section>
          `}
        </main>
      </div>
    `;

    app.querySelectorAll("[data-category]").forEach(button => button.addEventListener("click", () => {
      projectCategory = button.dataset.category;
      history.replaceState(null, "", "/?category=" + projectCategory);
      renderWorkspace();
    }));

    app.querySelector("[data-new-project]").addEventListener("click", async (event) => {
      event.currentTarget.disabled = true;
      try {
        const project = await api("/api/projects", { method: "POST", body: JSON.stringify({ name: "未命名项目", visibility: projectCategory }) });
        navigate(projectPath(project.id));
      } catch (error) {
        event.currentTarget.disabled = false;
        toast(error.message);
      }
    });

    app.querySelectorAll(".project-card").forEach((card) => {
      const project = projects.find((item) => item.id === card.dataset.projectId);
      const open = () => navigate(projectPath(project.id));
      card.addEventListener("click", (event) => {
        if (!event.target.closest("button")) open();
      });
      card.addEventListener("keydown", (event) => {
        if ((event.key === "Enter" || event.key === " ") && !event.target.closest("button")) open();
      });
      card.querySelector("img")?.addEventListener("error", (event) => event.currentTarget.remove());
      card.querySelector("[data-project-menu]").addEventListener("click", (event) => {
        event.stopPropagation();
        openProjectMenu(event.currentTarget, project);
      });
    });
  } catch (error) {
    app.innerHTML = `<div class="loading-screen">无法载入工作空间：${escapeHtml(error.message)}</div>`;
  }
}

function openProjectMenu(button, project) {
  document.querySelector(".card-menu")?.remove();
  document.querySelectorAll("[data-project-menu]").forEach((item) => item.setAttribute("aria-expanded", "false"));
  const rect = button.getBoundingClientRect();
  const menu = document.createElement("div");
  menu.className = "card-menu";
  menu.style.left = `${Math.min(window.innerWidth - 160, rect.right - 148)}px`;
  menu.style.top = `${Math.min(window.innerHeight - 150, rect.bottom + 5)}px`;
  menu.innerHTML = `
    <button data-rename>${icons.edit}修改名称</button>
    ${project.canManageVisibility ? `<button data-visibility>${icons.folder}${project.visibility === "personal" ? "移到团队项目" : "移到个人项目"}</button>` : ""}
    <button class="danger" data-delete>${icons.trash}删除项目</button>
  `;
  button.setAttribute("aria-expanded", "true");
  document.body.append(menu);
  const close = () => {
    menu.remove();
    button.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", outside);
  };
  const outside = (event) => {
    if (!menu.contains(event.target) && event.target !== button) close();
  };
  setTimeout(() => document.addEventListener("pointerdown", outside), 0);
  menu.querySelector("[data-rename]").addEventListener("click", () => {
    close();
    showRenameDialog(project, renderWorkspace);
  });
  menu.querySelector("[data-visibility]")?.addEventListener("click", () => {
    close();
    showProjectVisibilityDialog(project);
  });
  menu.querySelector("[data-delete]").addEventListener("click", () => {
    close();
    showDeleteProjectDialog(project, renderWorkspace);
  });
}

function showProjectVisibilityDialog(project) {
  const visibility = project.visibility === "personal" ? "team" : "personal";
  const label = visibility === "personal" ? "个人项目" : "团队项目";
  const backdrop = modalBackdrop(`
    <div class="dialog">
      <h2>移到${label}？</h2>
      <p>${visibility === "personal" ? "移动后仅你可以打开该项目，其他成员将无法继续访问。" : "移动后所有受邀成员都可以查看和编辑项目及其中的素材。"}</p>
      <div class="dialog-actions"><button class="secondary-button" data-cancel>取消</button><button class="primary-button" data-confirm>确认移动</button></div>
    </div>
  `);
  backdrop.querySelector("[data-cancel]").addEventListener("click", closeModal);
  backdrop.querySelector("[data-confirm]").addEventListener("click", async event => {
    event.currentTarget.disabled = true;
    try {
      await api("/api/projects/" + project.id, {method: "PATCH", body: JSON.stringify({visibility})});
      projectCategory = visibility;
      history.replaceState(null, "", "/?category=" + visibility);
      closeModal();
      await renderWorkspace();
      toast("已移到" + label);
    } catch (error) {
      event.currentTarget.disabled = false;
      toast(error.message);
    }
  });
}

function fileType(file) {
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  return Object.entries(EXTENSIONS).find(([, values]) => values.has(extension))?.[0] || null;
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return "0:00";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

class MaterialCanvas {
  constructor(project) {
    this.project = project;
    this.nodes = project.nodes || [];
    this.edges = project.edges || [];
    this.viewport = { x: 0, y: 0, zoom: 1, ...(project.viewport || {}) };
    this.selectedIds = new Set();
    this.expandedVideoIds = new Set();
    this.videoAspectRatios = new Map();
    this.selectedId = null;
    this.selectedEdgeId = null;
    this.addMenu = null;
    this.dragDepth = 0;
    this.saveCount = 0;
    this.viewportTimer = null;
    this.viewportDirty = false;
    this.generationTimers = new Map();
    this.textTimers = new Map();
    this.editSnapshots = new Map();
    this.generatorPanel = null;
    this.connectionCleanup = null;
    this.spacePressed = false;
    this.suppressSurfaceClick = false;
    this.historyStack = [];
    this.redoStack = [];
    this.clipboardNodeIds = [];
    this.pasteOffset = 0;
    this.restoringHistory = false;
    this.abort = new AbortController();
    this.render();
    this.generationPollTimer = setInterval(() => this.pollGenerationJobs(), 3000);
    this.pollGenerationJobs();
    this.storagePollTimer = setInterval(() => this.refreshStorageStatus(), 8000);
    this.refreshStorageStatus();
  }

  render() {
    app.innerHTML = `
      <main class="canvas-page">
        <div class="canvas-topbar">
          <button class="topbar-button" data-back aria-label="返回工作空间">${icons.back}</button>
          <span class="topbar-divider"></span>
          <button class="canvas-title-button" data-rename title="修改项目名称">${escapeHtml(this.project.name)}</button>
          <span class="topbar-divider"></span>
          <div class="save-state saved" data-save-state>已保存</div>
          <button type="button" class="cloud-storage-state" data-cloud-storage hidden></button>
          <a class="topbar-button" href="/account.html">管理中心</a>
        </div>
        <div class="canvas-surface" data-canvas>
          <div class="canvas-world" data-world>
            <svg class="edge-layer" data-edge-layer width="1" height="1" aria-hidden="true">
              <g data-edge-group></g>
              <path class="edge-preview" data-edge-preview></path>
            </svg>
          </div>
          <div class="selection-marquee" data-selection-marquee></div>
        </div>
        <div class="drop-overlay" data-drop-overlay>松开即可上传素材</div>
        <div class="upload-stack" data-upload-stack></div>
        <div class="canvas-help-hud"><span>左键框选</span><span>右键拖动平移</span><span><kbd>Space</kbd> 平移</span><span><kbd>Shift</kbd> 多选</span><span><kbd>Ctrl C/V</kbd> 复制粘贴</span><span><kbd>Ctrl Z</kbd> 撤销</span></div>
        <div class="zoom-hud" data-zoom>${Math.round(this.viewport.zoom * 100)}%</div>
      </main>
    `;
    this.surface = app.querySelector("[data-canvas]");
    this.world = app.querySelector("[data-world]");
    this.edgeLayer = app.querySelector("[data-edge-layer]");
    this.edgeGroup = app.querySelector("[data-edge-group]");
    this.edgePreview = app.querySelector("[data-edge-preview]");
    this.selectionMarquee = app.querySelector("[data-selection-marquee]");
    this.uploadStack = app.querySelector("[data-upload-stack]");
    this.dropOverlay = app.querySelector("[data-drop-overlay]");
    this.zoomHud = app.querySelector("[data-zoom]");
    this.saveState = app.querySelector("[data-save-state]");
    this.applyViewport();
    this.nodes.forEach((node) => this.mountNode(node));
    this.renderEdges();
    this.bindCanvasEvents();
  }

  bindCanvasEvents() {
    const signal = this.abort.signal;
    app.querySelector("[data-cloud-storage]").addEventListener("click", async () => {
      try { await api("/api/storage/sync", { method: "POST" }); await this.refreshStorageStatus(); toast("已开始检查并重试云端保存"); }
      catch (error) { toast(error.message); }
    }, { signal });
    app.querySelector("[data-back]").addEventListener("click", () => navigate("/"), { signal });
    app.querySelector("[data-rename]").addEventListener("click", () => {
      showRenameDialog(this.project, (updated) => {
        this.project = { ...this.project, ...updated };
        app.querySelector("[data-rename]").textContent = updated.name;
        toast("项目名称已更新");
      });
    }, { signal });

    this.surface.addEventListener("pointerdown", (event) => {
      if (event.button !== 2) return;
      event.stopPropagation();
      this.startPan(event);
    }, { capture: true, signal });
    this.surface.addEventListener("contextmenu", (event) => event.preventDefault(), { signal });
    this.surface.addEventListener("pointerdown", (event) => this.handleSurfacePointerDown(event), { signal });
    this.surface.addEventListener("wheel", (event) => this.onWheel(event), { passive: false, signal });
    this.surface.addEventListener("dblclick", (event) => this.onCanvasDoubleClick(event), { signal });
    this.surface.addEventListener("click", (event) => {
      if (event.target === this.surface || event.target === this.world) {
        if (this.suppressSurfaceClick) {
          this.suppressSurfaceClick = false;
          return;
        }
        this.closeAddMenu();
        this.selectNode(null);
      }
    }, { signal });

    window.addEventListener("keydown", (event) => this.handleCanvasKeydown(event), { signal });
    window.addEventListener("keyup", (event) => {
      if (event.code === "Space") {
        this.spacePressed = false;
        this.surface.classList.remove("space-pan-ready");
      }
    }, { signal });

    this.surface.addEventListener("dragenter", (event) => {
      event.preventDefault();
      this.dragDepth += 1;
      this.dropOverlay.classList.add("visible");
    }, { signal });
    this.surface.addEventListener("dragover", (event) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    }, { signal });
    this.surface.addEventListener("dragleave", () => {
      this.dragDepth = Math.max(0, this.dragDepth - 1);
      if (!this.dragDepth) this.dropOverlay.classList.remove("visible");
    }, { signal });
    this.surface.addEventListener("drop", (event) => {
      event.preventDefault();
      this.dragDepth = 0;
      this.dropOverlay.classList.remove("visible");
      const files = [...(event.dataTransfer?.files || [])];
      if (files.length) this.uploadFiles(files, this.screenToWorld(event.clientX, event.clientY));
    }, { signal });
  }

  destroy() {
    clearInterval(this.generationPollTimer);
    clearInterval(this.storagePollTimer);
    this.speechRecognition?.abort();
    this.abort.abort();
    clearTimeout(this.viewportTimer);
    if (this.viewportDirty) {
      fetch(`/api/projects/${this.project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ viewport: this.viewport }),
        keepalive: true,
      }).catch(() => {});
    }
    for (const [nodeId, timer] of this.generationTimers) {
      clearTimeout(timer);
      const node = this.nodes.find((item) => item.id === nodeId);
      if (node?.generation) {
        fetch(`/api/nodes/${node.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ generation: node.generation }),
          keepalive: true,
        }).catch(() => {});
      }
    }
    this.generationTimers.clear();
    for (const [nodeId, timer] of this.textTimers) {
      clearTimeout(timer);
      const node = this.nodes.find((item) => item.id === nodeId);
      if (node?.type === "text") {
        fetch(`/api/nodes/${node.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: node.content }),
          keepalive: true,
        }).catch(() => {});
      }
    }
    this.textTimers.clear();
    this.editSnapshots.clear();
    this.connectionCleanup?.();
    this.connectionCleanup = null;
    this.closeGeneratorPanel();
    this.closeAddMenu();
    if (pickerContext?.canvas === this) pickerContext = null;
  }

  applyViewport() {
    const { x, y, zoom } = this.viewport;
    this.world.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`;
    this.surface.style.setProperty("--grid-size", `${26 * zoom}px`);
    this.surface.style.setProperty("--grid-x", `${x}px`);
    this.surface.style.setProperty("--grid-y", `${y}px`);
    this.zoomHud.textContent = `${Math.round(zoom * 100)}%`;
  }

  screenToWorld(clientX, clientY) {
    const rect = this.surface.getBoundingClientRect();
    return {
      x: (clientX - rect.left - this.viewport.x) / this.viewport.zoom,
      y: (clientY - rect.top - this.viewport.y) / this.viewport.zoom,
    };
  }

  handleSurfacePointerDown(event) {
    const onBlank = event.target === this.surface || event.target === this.world;
    if (!onBlank) return;
    if (event.button === 1 || (event.button === 0 && this.spacePressed)) {
      this.startPan(event);
      return;
    }
    if (event.button === 0) this.startMarquee(event);
  }

  startMarquee(event) {
    event.preventDefault();
    this.closeAddMenu();
    this.closeGeneratorPanel();
    const surfaceRect = this.surface.getBoundingClientRect();
    const start = { x: event.clientX - surfaceRect.left, y: event.clientY - surfaceRect.top };
    const initialIds = event.shiftKey ? new Set(this.selectedIds) : new Set();
    let moved = false;
    this.surface.setPointerCapture?.(event.pointerId);

    const move = (moveEvent) => {
      const current = { x: moveEvent.clientX - surfaceRect.left, y: moveEvent.clientY - surfaceRect.top };
      if (!moved && Math.abs(current.x - start.x) + Math.abs(current.y - start.y) < 4) return;
      moved = true;
      moveEvent.preventDefault();
      const left = Math.min(start.x, current.x);
      const top = Math.min(start.y, current.y);
      const right = Math.max(start.x, current.x);
      const bottom = Math.max(start.y, current.y);
      Object.assign(this.selectionMarquee.style, {
        display: "block",
        left: `${left}px`,
        top: `${top}px`,
        width: `${right - left}px`,
        height: `${bottom - top}px`,
      });
      const ids = new Set(initialIds);
      this.world.querySelectorAll(".material-node").forEach((element) => {
        const rect = element.getBoundingClientRect();
        const intersects = rect.right >= surfaceRect.left + left && rect.left <= surfaceRect.left + right
          && rect.bottom >= surfaceRect.top + top && rect.top <= surfaceRect.top + bottom;
        if (intersects) ids.add(element.dataset.nodeId);
      });
      this.setSelectedIds(ids);
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", cancel);
      this.selectionMarquee.removeAttribute("style");
      if (moved) {
        this.suppressSurfaceClick = true;
        this.renderSelectionBox();
      }
    };
    const cancel = () => {
      this.selectionMarquee.removeAttribute("style");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", cancel);
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", cancel);
  }

  startPan(event) {
    if (![0, 1, 2].includes(event.button)) return;
    if (event.button !== 2 && event.target !== this.surface && event.target !== this.world) return;
    event.preventDefault();
    this.closeAddMenu();
    this.closeGeneratorPanel();
    const start = { clientX: event.clientX, clientY: event.clientY, x: this.viewport.x, y: this.viewport.y };
    let moved = false;
    this.surface.setPointerCapture(event.pointerId);
    this.surface.classList.add("panning");
    const move = (moveEvent) => {
      const dx = moveEvent.clientX - start.clientX;
      const dy = moveEvent.clientY - start.clientY;
      if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
      this.viewport.x = start.x + dx;
      this.viewport.y = start.y + dy;
      this.applyViewport();
    };
    const end = () => {
      this.surface.classList.remove("panning");
      this.surface.removeEventListener("pointermove", move);
      this.surface.removeEventListener("pointerup", end);
      this.surface.removeEventListener("pointercancel", end);
      if (this.surface.hasPointerCapture(event.pointerId)) this.surface.releasePointerCapture(event.pointerId);
      if (moved) {
        this.suppressSurfaceClick = event.button === 0;
        this.saveViewport();
      }
    };
    this.surface.addEventListener("pointermove", move);
    this.surface.addEventListener("pointerup", end);
    this.surface.addEventListener("pointercancel", end);
  }

  onWheel(event) {
    event.preventDefault();
    this.closeAddMenu();
    this.closeGeneratorPanel();
    const rect = this.surface.getBoundingClientRect();
    const cursorX = event.clientX - rect.left;
    const cursorY = event.clientY - rect.top;
    const worldX = (cursorX - this.viewport.x) / this.viewport.zoom;
    const worldY = (cursorY - this.viewport.y) / this.viewport.zoom;
    const factor = Math.exp(-event.deltaY * 0.0012);
    const nextZoom = Math.min(2.5, Math.max(0.2, this.viewport.zoom * factor));
    this.viewport.x = cursorX - worldX * nextZoom;
    this.viewport.y = cursorY - worldY * nextZoom;
    this.viewport.zoom = nextZoom;
    this.applyViewport();
    this.saveViewport();
  }

  saveViewport() {
    this.viewportDirty = true;
    clearTimeout(this.viewportTimer);
    this.viewportTimer = setTimeout(async () => {
      this.setSaving(true);
      try {
        await api(`/api/projects/${this.project.id}`, {
          method: "PATCH",
          body: JSON.stringify({ viewport: this.viewport }),
        });
        this.viewportDirty = false;
      } catch (error) {
        toast(`画布状态保存失败：${error.message}`);
      } finally {
        this.setSaving(false);
      }
    }, 450);
  }

  async refreshStorageStatus() {
    if (this.checkingStorage || this.abort.signal.aborted) return;
    this.checkingStorage = true;
    try {
      const state = await api("/api/storage");
      if (this.abort.signal.aborted) return;
      const button = app.querySelector("[data-cloud-storage]");
      if (!button) return;
      button.hidden = !state.enabled;
      button.classList.toggle("failed", state.failed > 0);
      button.textContent = state.failed ? `云端待重试 ${state.failed}` : state.pending || state.syncing ? "云端保存中…" : "素材已存云端";
      button.title = state.error || `已有 ${state.ready} 个文件保存到云端；点击检查并重试。${serviceConfig.directUpload ? '项目布局已保存在云数据库。' : '项目布局仍保存在本机。'}`;
    } catch {
      const button = app.querySelector("[data-cloud-storage]");
      if (button && !button.hidden) button.textContent = "云端状态暂不可用";
    } finally { this.checkingStorage = false; }
  }

  setSaving(active) {
    this.saveCount = Math.max(0, this.saveCount + (active ? 1 : -1));
    const saving = this.saveCount > 0;
    this.saveState.textContent = saving ? "保存中…" : "已保存";
    this.saveState.classList.toggle("saved", !saving);
  }

  onCanvasDoubleClick(event) {
    if (event.target !== this.surface && event.target !== this.world) return;
    event.preventDefault();
    const point = this.screenToWorld(event.clientX, event.clientY);
    this.openAddMenu(event.clientX, event.clientY, point);
  }

  openAddMenu(clientX, clientY, point, connection = null) {
    this.closeAddMenu();
    const menu = document.createElement("div");
    menu.className = "add-menu";
    menu.style.left = `${Math.max(8, Math.min(window.innerWidth - 220, clientX))}px`;
    menu.style.top = `${Math.max(8, Math.min(window.innerHeight - 232, clientY))}px`;
    menu.innerHTML = `
      <div class="add-menu-label">${connection ? (connection.direction === "output" ? "创建下游节点" : "创建上游节点") : "添加制作节点"}</div>
      <button data-type="text"><span class="add-menu-icon">${icons.text}</span><span>文字制作</span></button>
      <button data-type="image"><span class="add-menu-icon">${icons.image}</span><span>图片制作</span></button>
      <button data-type="video"><span class="add-menu-icon">${icons.video}</span><span>视频制作</span></button>
      <button data-type="file" title="支持批量上传图片、视频和音频"><span class="add-menu-icon">${icons.upload}</span><span>上传文件</span></button>
      <button data-type="audio"><span class="add-menu-icon">${icons.audio}</span><span>上传音频</span></button>
    `;
    menu.addEventListener("pointerdown", (event) => event.stopPropagation());
    menu.querySelectorAll("[data-type]").forEach((button) => {
      button.addEventListener("click", () => {
        const type = button.dataset.type;
        if (["text", "image", "video"].includes(type)) {
          this.createVideoGenerator(point, connection, type);
          this.closeAddMenu();
          return;
        }
        pickerContext = { canvas: this, type: type === "file" ? null : type, point, connection };
        filePicker.accept = type === "file" ? Object.values(ACCEPT).join(",") : ACCEPT[type];
        filePicker.value = "";
        filePicker.click();
        this.closeAddMenu();
      });
    });
    document.body.append(menu);
    menu.style.left = `${Math.max(8, Math.min(window.innerWidth - menu.offsetWidth - 8, clientX))}px`;
    menu.style.top = `${Math.max(8, Math.min(window.innerHeight - menu.offsetHeight - 8, clientY))}px`;
    this.addMenu = menu;
  }

  closeAddMenu() {
    this.addMenu?.remove();
    this.addMenu = null;
  }

  async createVideoGenerator(point, connection = null, type = "video") {
    const historySnapshot = this.captureHistorySnapshot();
    this.pushHistorySnapshot(historySnapshot);
    this.setSaving(true);
    try {
      const x = connection?.direction === "output" ? point.x + 120
        : connection?.direction === "input" ? point.x - 880
          : point.x - 380;
      const node = await api(`/api/projects/${this.project.id}/${type === "video" ? "video-nodes" : "generator-nodes"}`, {
        method: "POST",
        body: JSON.stringify({ type, x, y: point.y - 196 }),
      });
      this.nodes.push(node);
      this.mountNode(node);
      this.selectNode(node.id);
      if (connection) await this.connectCreatedNode(node, connection);
    } catch (error) {
      this.historyStack.pop();
      toast(error.message);
    } finally {
      this.setSaving(false);
    }
  }

  async createTextNode(point, connection = null) {
    const historySnapshot = this.captureHistorySnapshot();
    this.pushHistorySnapshot(historySnapshot);
    this.setSaving(true);
    try {
      const x = connection?.direction === "output" ? point.x + 100
        : connection?.direction === "input" ? point.x - 460
          : point.x - 180;
      const node = await api(`/api/projects/${this.project.id}/text-nodes`, {
        method: "POST",
        body: JSON.stringify({ x, y: point.y - 110 }),
      });
      this.nodes.push(node);
      this.mountNode(node);
      this.selectNode(node.id);
      if (connection) await this.connectCreatedNode(node, connection);
      requestAnimationFrame(() => this.world.querySelector(`[data-node-id="${node.id}"] textarea`)?.focus());
    } catch (error) {
      this.historyStack.pop();
      toast(error.message);
    } finally {
      this.setSaving(false);
    }
  }

  async connectCreatedNode(node, connection) {
    const anchorIds = connection.anchorNodeIds || (connection.anchorNodeId ? [connection.anchorNodeId] : []);
    const anchors = anchorIds.map((nodeId) => this.nodes.find((item) => item.id === nodeId)).filter(Boolean);
    if (!anchors.length) return;
    const pairs = connection.direction === "output"
      ? anchors.map((anchor) => ({ source: anchor, target: node }))
      : anchors.map((anchor) => ({ source: node, target: anchor }));
    await this.createEdges(pairs, { recordHistory: false, selectTarget: false });
    this.selectNode(node.id);
  }

  selectedNodes() {
    return this.nodes.filter((node) => this.selectedIds.has(node.id));
  }

  setSelectedIds(ids, primaryId = null) {
    const previousId = this.selectedId;
    this.selectedIds = new Set([...ids].filter((id) => this.nodes.some((node) => node.id === id)));
    this.selectedId = primaryId && this.selectedIds.has(primaryId)
      ? primaryId
      : (this.selectedIds.size ? [...this.selectedIds].at(-1) : null);
    this.selectedEdgeId = null;
    if (previousId !== this.selectedId) this.closeGeneratorPanel();
    this.world.querySelectorAll(".material-node").forEach((element) => {
      element.classList.toggle("selected", this.selectedIds.has(element.dataset.nodeId));
    });
    this.edgeGroup.querySelectorAll(".canvas-edge").forEach((element) => element.classList.remove("selected"));
    this.world.querySelector("[data-edge-toolbar]")?.remove();
    this.renderSelectionBox();
  }

  selectNode(id, options = {}) {
    if (!id) {
      this.setSelectedIds([]);
      return;
    }
    const next = options.additive || options.toggle ? new Set(this.selectedIds) : new Set();
    if (options.toggle && next.has(id)) next.delete(id);
    else next.add(id);
    this.setSelectedIds(next, id);
  }

  renderSelectionBox() {
    this.world.querySelector("[data-multi-selection]")?.remove();
    const selected = this.selectedNodes();
    this.world.classList.toggle("has-multi-selection", selected.length > 1);
    if (selected.length < 2) return;
    const left = Math.min(...selected.map((node) => node.x));
    const top = Math.min(...selected.map((node) => node.y));
    const right = Math.max(...selected.map((node) => node.x + node.width));
    const bottom = Math.max(...selected.map((node) => node.y + (this.world.querySelector(`[data-node-id="${node.id}"]`)?.offsetHeight || node.height)));
    const box = document.createElement("div");
    box.className = "multi-selection-box";
    box.dataset.multiSelection = "";
    box.style.left = `${left - 12}px`;
    box.style.top = `${top - 12}px`;
    box.style.width = `${right - left + 24}px`;
    box.style.height = `${bottom - top + 24}px`;
    box.innerHTML = `
      <span class="multi-selection-count">已选 ${selected.length} 个节点</span>
      <button type="button" class="multi-selection-port input" data-multi-port="input" title="连接或创建共同上游">${icons.plus}</button>
      <button type="button" class="multi-selection-port output" data-multi-port="output" title="连接或创建共同下游">${icons.plus}</button>`;
    box.querySelectorAll("[data-multi-port]").forEach((button) => {
      button.addEventListener("pointerdown", (event) => this.startMultiConnection(event, button.dataset.multiPort));
    });
    this.world.append(box);
  }

  nodeAnchor(node, side) {
    const inset = node.kind === "generator" && node.type === "video" && !this.expandedVideoIds.has(node.id) ? node.width * 0.18 : 0;
    const generatorPreviewY = node.kind === "generator"
      ? node.y + 24 + this.generatorPreviewHeight(node) / 2
      : node.y + node.height / 2;
    return {
      x: side === "output" ? node.x + node.width - inset : node.x + inset,
      y: generatorPreviewY,
    };
  }

  edgeGeometry(edge) {
    const source = this.nodes.find((node) => node.id === edge.sourceNodeId);
    const target = this.nodes.find((node) => node.id === edge.targetNodeId);
    if (!source || !target) return null;
    const start = this.nodeAnchor(source, "output");
    const end = this.nodeAnchor(target, "input");
    return { start, end, path: this.connectionPath(start, end) };
  }

  connectionPath(start, end) {
    const handle = Math.max(86, Math.abs(end.x - start.x) * 0.42);
    return `M ${start.x} ${start.y} C ${start.x + handle} ${start.y}, ${end.x - handle} ${end.y}, ${end.x} ${end.y}`;
  }

  renderEdges() {
    const selectedEdgeId = this.selectedEdgeId;
    this.world.querySelector("[data-edge-toolbar]")?.remove();
    this.edgeGroup.replaceChildren();
    for (const edge of this.edges) {
      const geometry = this.edgeGeometry(edge);
      if (!geometry) continue;
      const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
      group.classList.add("canvas-edge");
      group.dataset.edgeId = edge.id;
      const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
      line.classList.add("edge-line");
      line.setAttribute("d", geometry.path);
      const hit = document.createElementNS("http://www.w3.org/2000/svg", "path");
      hit.classList.add("edge-hit");
      hit.setAttribute("d", geometry.path);
      hit.addEventListener("pointerdown", (event) => event.stopPropagation());
      hit.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.selectEdge(edge.id);
      });
      group.append(line, hit);
      this.edgeGroup.append(group);
    }
    if (selectedEdgeId && this.edges.some((edge) => edge.id === selectedEdgeId)) this.selectEdge(selectedEdgeId);
    else if (selectedEdgeId) this.selectedEdgeId = null;
  }

  updateEdgesForNode(nodeId) {
    for (const edge of this.edges.filter((item) => item.sourceNodeId === nodeId || item.targetNodeId === nodeId)) {
      const geometry = this.edgeGeometry(edge);
      const group = [...this.edgeGroup.querySelectorAll(".canvas-edge")].find((item) => item.dataset.edgeId === edge.id);
      if (!geometry || !group) continue;
      group.querySelectorAll("path").forEach((path) => path.setAttribute("d", geometry.path));
    }
    if (this.selectedEdgeId) this.renderEdgeToolbar();
  }

  selectEdge(id) {
    this.closeGeneratorPanel();
    this.selectedEdgeId = id;
    this.selectedIds.clear();
    this.selectedId = null;
    this.world.querySelectorAll(".material-node").forEach((element) => element.classList.remove("selected"));
    this.world.querySelector("[data-multi-selection]")?.remove();
    this.world.classList.remove("has-multi-selection");
    this.edgeGroup.querySelectorAll(".canvas-edge").forEach((element) => {
      element.classList.toggle("selected", element.dataset.edgeId === id);
    });
    this.renderEdgeToolbar();
  }

  renderEdgeToolbar() {
    this.world.querySelector("[data-edge-toolbar]")?.remove();
    const edge = this.edges.find((item) => item.id === this.selectedEdgeId);
    const geometry = edge && this.edgeGeometry(edge);
    if (!edge || !geometry) return;
    const toolbar = document.createElement("div");
    toolbar.className = "edge-toolbar";
    toolbar.dataset.edgeToolbar = "";
    toolbar.style.left = `${(geometry.start.x + geometry.end.x) / 2}px`;
    toolbar.style.top = `${(geometry.start.y + geometry.end.y) / 2}px`;
    const roleLabels = { "first-frame": "首帧", "last-frame": "尾帧", audio: "音频", style: "风格", character: "角色" };
    toolbar.innerHTML = `<span>${escapeHtml(roleLabels[edge.role] || "引用")}</span><button type="button" aria-label="删除连线">${icons.trash}</button>`;
    toolbar.addEventListener("pointerdown", (event) => event.stopPropagation());
    toolbar.querySelector("button").addEventListener("click", () => this.deleteEdge(edge.id));
    this.world.append(toolbar);
  }

  appendNodePorts(element, node) {
    element.insertAdjacentHTML("beforeend", `
      <button type="button" class="node-port input" data-port="input" data-port-node-id="${node.id}" aria-label="连接上游节点" title="连接或创建上游节点">${icons.plus}</button>
      <button type="button" class="node-port output" data-port="output" data-port-node-id="${node.id}" aria-label="连接下游节点" title="连接或创建下游节点">${icons.plus}</button>
    `);
    element.querySelector('[data-port="output"]').addEventListener("pointerdown", (event) => this.startConnection(event, node, "output"));
    element.querySelector('[data-port="input"]').addEventListener("pointerdown", (event) => this.startConnection(event, node, "input"));
  }

  startConnection(event, anchorNode, direction) {
    const anchorNodes = this.selectedIds.has(anchorNode.id) && this.selectedIds.size > 1 ? this.selectedNodes() : [anchorNode];
    if (anchorNodes.length === 1) this.selectNode(anchorNode.id);
    this.startConnectionFromNodes(event, anchorNodes, direction);
  }

  startMultiConnection(event, direction) {
    this.startConnectionFromNodes(event, this.selectedNodes(), direction);
  }

  selectionAnchor(nodes, direction) {
    const anchors = nodes.map((node) => this.nodeAnchor(node, direction));
    return {
      x: direction === "output" ? Math.max(...anchors.map((point) => point.x)) : Math.min(...anchors.map((point) => point.x)),
      y: anchors.reduce((sum, point) => sum + point.y, 0) / anchors.length,
    };
  }

  startConnectionFromNodes(event, anchorNodes, direction) {
    if (event.button !== 0) return;
    if (!anchorNodes.length) return;
    event.preventDefault();
    event.stopPropagation();
    this.connectionCleanup?.();
    this.surface.classList.add("connecting", `from-${direction}`);
    const anchor = this.selectionAnchor(anchorNodes, direction);
    const anchorIds = new Set(anchorNodes.map((node) => node.id));
    const oppositePort = direction === "output" ? "input" : "output";
    let candidatePort = null;
    let candidateNode = null;
    let lastPointer = { clientX: event.clientX, clientY: event.clientY };

    const move = (moveEvent) => {
      moveEvent.preventDefault();
      lastPointer = { clientX: moveEvent.clientX, clientY: moveEvent.clientY };
      const point = this.screenToWorld(moveEvent.clientX, moveEvent.clientY);
      const start = direction === "output" ? anchor : point;
      const end = direction === "output" ? point : anchor;
      this.edgePreview.setAttribute("d", this.connectionPath(start, end));
      const hit = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
      const hitNode = hit?.closest?.(".material-node");
      const port = hit?.closest?.(`[data-port="${oppositePort}"]`) || hitNode?.querySelector(`[data-port="${oppositePort}"]`);
      const candidate = port ? this.nodes.find((node) => node.id === port.dataset.portNodeId) : null;
      candidatePort?.classList.remove("connection-target");
      candidatePort = candidate && !anchorIds.has(candidate.id) ? port : null;
      candidateNode = candidatePort ? candidate : null;
      candidatePort?.classList.add("connection-target");
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", cancel);
      candidatePort?.classList.remove("connection-target");
      this.surface.classList.remove("connecting", "from-output", "from-input");
      this.edgePreview.removeAttribute("d");
      if (this.connectionCleanup === cleanup) this.connectionCleanup = null;
    };
    const end = () => {
      const candidate = candidateNode;
      const pointer = lastPointer;
      cleanup();
      if (candidate) {
        const pairs = direction === "output"
          ? anchorNodes.map((source) => ({ source, target: candidate }))
          : anchorNodes.map((target) => ({ source: candidate, target }));
        this.createEdges(pairs);
        return;
      }
      const point = this.screenToWorld(pointer.clientX, pointer.clientY);
      this.openAddMenu(pointer.clientX, pointer.clientY, point, { direction, anchorNodeIds: [...anchorIds] });
    };
    const cancel = () => cleanup();
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", cancel);
    this.connectionCleanup = cleanup;
    this.edgePreview.setAttribute("d", this.connectionPath(anchor, anchor));
  }

  async createEdge(source, target, options = {}) {
    return this.createEdges([{ source, target }], options);
  }

  async createEdges(pairs, options = {}) {
    const uniquePairs = pairs.filter(({ source, target }, index, list) => source && target && source.id !== target.id
      && list.findIndex((pair) => pair.source?.id === source.id && pair.target?.id === target.id) === index);
    if (!uniquePairs.length) return null;
    if (options.recordHistory !== false) this.pushHistorySnapshot(this.captureHistorySnapshot());
    this.setSaving(true);
    const created = [];
    const failures = [];
    try {
      for (const { source, target } of uniquePairs) {
        try {
          const result = await api(`/api/projects/${this.project.id}/edges`, {
            method: "POST",
            body: JSON.stringify({ sourceNodeId: source.id, targetNodeId: target.id }),
          });
          this.edges.push(result.edge);
          Object.assign(target, result.targetNode);
          created.push(result);
        } catch (error) {
          failures.push(error.message);
        }
      }
      const generatorTargets = new Set(uniquePairs.map((pair) => pair.target).filter((target) => target.generation));
      generatorTargets.forEach((target) => this.replaceNodeElement(target, false));
      this.renderEdges();
      const lastTarget = uniquePairs.at(-1)?.target;
      if (lastTarget && options.selectTarget !== false) this.selectNode(lastTarget.id);
      if (created.length) toast(created.length > 1 ? `已连接 ${created.length} 个输入节点` : "节点已连接");
      if (failures.length) toast(failures[0]);
      if (!created.length && options.recordHistory !== false) this.historyStack.pop();
      return created.length === 1 ? created[0] : created;
    } finally {
      this.setSaving(false);
    }
  }

  async deleteEdge(edgeId, options = {}) {
    const edge = this.edges.find((item) => item.id === edgeId);
    if (!edge) return;
    const selectedNodeIds = new Set(this.selectedIds);
    if (options.recordHistory !== false) this.pushHistorySnapshot(this.captureHistorySnapshot());
    this.setSaving(true);
    try {
      await api(`/api/edges/${edge.id}`, { method: "DELETE" });
      this.edges = this.edges.filter((item) => item.id !== edge.id);
      const target = this.nodes.find((node) => node.id === edge.targetNodeId);
      if (target?.generation) {
        target.generation.linkedReferences = (target.generation.linkedReferences || []).filter((reference) => reference.edgeId !== edge.id);
        target.generation.selectedReferenceNodeIds = (target.generation.selectedReferenceNodeIds || []).filter((nodeId) => nodeId !== edge.sourceNodeId);
        this.replaceNodeElement(target, false);
      }
      this.selectedEdgeId = null;
      this.renderEdges();
      if (selectedNodeIds.size) this.setSelectedIds(selectedNodeIds);
      toast("连线已删除");
    } catch (error) {
      if (options.recordHistory !== false) this.historyStack.pop();
      toast(error.message);
    } finally {
      this.setSaving(false);
    }
  }

  captureHistorySnapshot() {
    return JSON.parse(JSON.stringify({ nodes: this.nodes, edges: this.edges }));
  }

  beginEditHistory(key) {
    if (!this.editSnapshots.has(key)) this.editSnapshots.set(key, this.captureHistorySnapshot());
  }

  finishEditHistory(key) {
    const snapshot = this.editSnapshots.get(key);
    this.editSnapshots.delete(key);
    if (!snapshot) return;
    if (JSON.stringify(snapshot) !== JSON.stringify(this.captureHistorySnapshot())) this.pushHistorySnapshot(snapshot);
  }

  pushHistorySnapshot(snapshot) {
    if (this.restoringHistory || !snapshot) return;
    this.historyStack.push(snapshot);
    if (this.historyStack.length > 50) this.historyStack.shift();
    this.redoStack = [];
  }

  async restoreHistorySnapshot(snapshot) {
    this.restoringHistory = true;
    this.setSaving(true);
    try {
      const project = await api(`/api/projects/${this.project.id}/state`, {
        method: "PUT",
        body: JSON.stringify(snapshot),
      });
      this.applyProjectState(project);
    } finally {
      this.setSaving(false);
      this.restoringHistory = false;
    }
  }

  async undo() {
    if (!this.historyStack.length || this.restoringHistory) return toast("没有可撤销的操作");
    const target = this.historyStack.pop();
    const current = this.captureHistorySnapshot();
    try {
      await this.restoreHistorySnapshot(target);
      this.redoStack.push(current);
      toast("已撤销");
    } catch (error) {
      this.historyStack.push(target);
      toast(`撤销失败：${error.message}`);
    }
  }

  async redo() {
    if (!this.redoStack.length || this.restoringHistory) return toast("没有可重做的操作");
    const target = this.redoStack.pop();
    const current = this.captureHistorySnapshot();
    try {
      await this.restoreHistorySnapshot(target);
      this.historyStack.push(current);
      toast("已重做");
    } catch (error) {
      this.redoStack.push(target);
      toast(`重做失败：${error.message}`);
    }
  }

  applyProjectState(project) {
    this.generationTimers.forEach((timer) => clearTimeout(timer));
    this.textTimers.forEach((timer) => clearTimeout(timer));
    this.generationTimers.clear();
    this.textTimers.clear();
    this.editSnapshots.clear();
    this.closeGeneratorPanel();
    this.closeAddMenu();
    this.project = { ...this.project, ...project };
    this.nodes = project.nodes || [];
    this.edges = project.edges || [];
    this.selectedIds.clear();
    this.selectedId = null;
    this.selectedEdgeId = null;
    this.world.querySelectorAll(".material-node, [data-multi-selection], [data-edge-toolbar]").forEach((element) => element.remove());
    this.world.classList.remove("has-multi-selection");
    this.nodes.forEach((node) => this.mountNode(node));
    this.renderEdges();
  }

  async deleteNodes(nodeIds) {
    const ids = [...new Set(nodeIds)].filter((nodeId) => this.nodes.some((node) => node.id === nodeId));
    if (!ids.length) return;
    this.pushHistorySnapshot(this.captureHistorySnapshot());
    this.setSaving(true);
    const removed = new Set();
    let failure = null;
    try {
      for (const nodeId of ids) {
        try {
          await api(`/api/nodes/${nodeId}`, { method: "DELETE" });
          removed.add(nodeId);
        } catch (error) {
          failure ||= error;
        }
      }
      if (!removed.size) {
        this.historyStack.pop();
        if (failure) throw failure;
        return;
      }
      const removedEdges = this.edges.filter((edge) => removed.has(edge.sourceNodeId) || removed.has(edge.targetNodeId));
      this.nodes = this.nodes.filter((node) => !removed.has(node.id));
      this.edges = this.edges.filter((edge) => !removed.has(edge.sourceNodeId) && !removed.has(edge.targetNodeId));
      removed.forEach((nodeId) => {
        clearTimeout(this.textTimers.get(nodeId));
        clearTimeout(this.generationTimers.get(nodeId));
        this.textTimers.delete(nodeId);
        this.generationTimers.delete(nodeId);
        this.world.querySelector(`[data-node-id="${nodeId}"]`)?.remove();
      });
      for (const edge of removedEdges) {
        const target = this.nodes.find((node) => node.id === edge.targetNodeId);
        if (!target?.generation) continue;
        target.generation.linkedReferences = (target.generation.linkedReferences || []).filter((reference) => reference.edgeId !== edge.id);
        target.generation.selectedReferenceNodeIds = (target.generation.selectedReferenceNodeIds || []).filter((nodeId) => nodeId !== edge.sourceNodeId);
        this.replaceNodeElement(target, false);
      }
      this.setSelectedIds([]);
      this.renderEdges();
      toast(removed.size > 1 ? `已删除 ${removed.size} 个节点` : "节点已删除");
      if (failure) toast(failure.message);
    } catch (error) {
      toast(error.message);
    } finally {
      this.setSaving(false);
    }
  }

  copySelection() {
    this.clipboardNodeIds = [...this.selectedIds];
    this.pasteOffset = 0;
    if (this.clipboardNodeIds.length) toast(`已复制 ${this.clipboardNodeIds.length} 个节点`);
  }

  async pasteSelection() {
    const availableIds = this.clipboardNodeIds.filter((nodeId) => this.nodes.some((node) => node.id === nodeId));
    if (!availableIds.length) return toast("没有可粘贴的节点");
    this.pushHistorySnapshot(this.captureHistorySnapshot());
    this.pasteOffset += 36;
    this.setSaving(true);
    try {
      const result = await api(`/api/projects/${this.project.id}/clone-nodes`, {
        method: "POST",
        body: JSON.stringify({ nodeIds: availableIds, offsetX: this.pasteOffset, offsetY: this.pasteOffset }),
      });
      this.nodes.push(...result.nodes);
      this.edges.push(...result.edges);
      result.nodes.forEach((node) => this.mountNode(node));
      this.renderEdges();
      this.setSelectedIds(new Set(result.nodes.map((node) => node.id)));
      toast(`已粘贴 ${result.nodes.length} 个节点`);
    } catch (error) {
      this.historyStack.pop();
      toast(error.message);
    } finally {
      this.setSaving(false);
    }
  }

  handleCanvasKeydown(event) {
    const editing = event.target.closest?.("input, textarea, select, [contenteditable='true']");
    const command = event.ctrlKey || event.metaKey;
    if (event.code === "Space" && !editing) {
      event.preventDefault();
      this.spacePressed = true;
      this.surface.classList.add("space-pan-ready");
      return;
    }
    if (editing) return;
    if (command && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if (command && event.key.toLowerCase() === "y") {
      event.preventDefault();
      this.redo();
      return;
    }
    if (command && event.key.toLowerCase() === "c") {
      if (this.selectedIds.size) {
        event.preventDefault();
        this.copySelection();
      }
      return;
    }
    if (command && event.key.toLowerCase() === "v") {
      event.preventDefault();
      this.pasteSelection();
      return;
    }
    if (["Delete", "Backspace"].includes(event.key)) {
      event.preventDefault();
      if (this.selectedEdgeId) this.deleteEdge(this.selectedEdgeId);
      else if (this.selectedIds.size) this.deleteNodes([...this.selectedIds]);
      return;
    }
    if (event.key === "Escape") {
      this.closeAddMenu();
      this.closeGeneratorPanel();
      this.selectNode(null);
    }
  }

  mountNode(node) {
    const element = document.createElement("article");
    element.className = `material-node ${node.kind === "generator" ? `video-generator-node ${node.type}-production-node` : `${node.type}-node`}`;
    if (node.generation?.model?.startsWith("Seedance")) element.classList.add("seedance-node");
    element.dataset.nodeId = node.id;
    this.applyNodeStyle(element, node);

    const toolbar = `
      <div class="node-toolbar">
        ${node.type !== "text" && (node.kind !== "generator" || node.url) ? `<button type="button" data-view>${icons.eye}<span>查看</span></button>` : ""}
        <button type="button" class="delete-node" data-delete aria-label="删除素材">${icons.trash}</button>
      </div>
    `;

    if (node.kind === "generator") {
      this.mountVideoGenerator(node, element, toolbar);
    } else if (node.type === "text") {
      element.innerHTML = `${toolbar}
        <div class="text-node-shell">
          <div class="text-node-label">${icons.text}<span>${escapeHtml(node.filename || "文字")}</span></div>
          <textarea data-text-content maxlength="20000" spellcheck="true" placeholder="写下脚本、提示词或制作要求…">${escapeHtml(node.content || "")}</textarea>
        </div>
        <span class="resize-handle" data-resize></span>`;
      const textarea = element.querySelector("[data-text-content]");
      textarea.addEventListener("pointerdown", () => {
        if (!this.selectedIds.has(node.id)) this.selectNode(node.id);
      });
      textarea.addEventListener("focus", () => this.beginEditHistory(`text:${node.id}`));
      textarea.addEventListener("blur", () => this.finishEditHistory(`text:${node.id}`));
      textarea.addEventListener("input", () => {
        node.content = textarea.value;
        this.queueTextSave(node);
      });
    } else if (node.type === "image") {
      element.innerHTML = `${toolbar}<div class="node-frame"><img src="${node.url}" alt="${escapeHtml(node.filename)}" draggable="false" /></div><span class="resize-handle" data-resize></span>`;
    } else if (node.type === "video") {
      element.innerHTML = `${toolbar}<div class="node-frame"><video src="${node.url}" controls preload="metadata" playsinline></video><div class="video-fallback">${icons.video}<span>当前浏览器无法预览此视频<br />双击可尝试打开播放器</span></div></div><span class="resize-handle" data-resize></span>`;
      const video = element.querySelector("video");
      video.addEventListener("error", () => {
        element.querySelector(".video-fallback").style.display = "flex";
      });
    } else {
      element.innerHTML = `${toolbar}
        <div class="audio-inner">
          <button class="audio-play" type="button" aria-label="播放">${icons.play}</button>
          <div class="audio-main">
            <div class="audio-title" title="${escapeHtml(node.filename)}">${escapeHtml(node.filename)}</div>
            <div class="audio-row">
              <input class="audio-seek" type="range" min="0" max="100" value="0" step="0.1" aria-label="音频进度" />
              <span class="audio-time">0:00 / 0:00</span>
            </div>
          </div>
          <audio src="${node.url}" preload="metadata"></audio>
        </div>`;
      this.bindAudio(element);
    }

    this.appendNodePorts(element, node);

    element.addEventListener("pointerdown", (event) => this.startNodeDrag(event, node, element));
    element.addEventListener("dblclick", (event) => {
      if (event.target.closest("button, input, textarea, .generator-popover")) return;
      if (node.type === "text") return;
      if (node.kind === "generator" && !node.url) return;
      event.preventDefault();
      event.stopPropagation();
      this.openViewer(node);
    });
    element.querySelector("[data-view]")?.addEventListener("click", (event) => {
      event.stopPropagation();
      this.openViewer(node);
    });
    element.querySelector("[data-delete]").addEventListener("click", (event) => {
      event.stopPropagation();
      const ids = this.selectedIds.has(node.id) && this.selectedIds.size > 1 ? [...this.selectedIds] : [node.id];
      this.deleteNodes(ids);
    });
    element.querySelector("[data-resize]")?.addEventListener("pointerdown", (event) => this.startResize(event, node, element));

    if (this.selectedIds.has(node.id)) element.classList.add("selected");
    this.world.append(element);
  }

  mountVideoGenerator(node, element, toolbar) {
    const generation = node.generation;
    const isVideo = node.type === "video";
    const typeLabel = { text: "文字", image: "图片", video: "视频" }[node.type];
    const references = [...(generation.references || []), ...(generation.linkedReferences || [])];
    const selectedReferenceIds = new Set(generation.selectedReferenceNodeIds || []);
    const typeLabels = { image: "图片", video: "视频", audio: "音频", text: "文字" };
    const referenceMarkup = references.map((reference, index) => {
      const type = reference.type || "image";
      const label = isVideo && reference.targetSlot === "first-frame" ? "首帧" : isVideo && reference.targetSlot === "last-frame" ? "尾帧" : (typeLabels[type] || "引用");
      let content;
      if (type === "text") content = `<div class="reference-text">${icons.text}<small>${escapeHtml(reference.content || reference.filename || "文字")}</small></div>`;
      else if (type === "video" && reference.url) content = `<video src="${reference.url}" muted preload="metadata"></video>`;
      else if (type === "audio") content = `<div class="reference-type-icon">${icons.audio}</div>`;
      else if (reference.url) content = `<img src="${reference.url}" alt="参考素材 ${index + 1}" draggable="false" />`;
      else content = `<div class="reference-type-icon">${icons[type] || icons.image}</div>`;
      const isReferenced = !reference.linked || selectedReferenceIds.has(reference.nodeId);
      return `
        <div class="generator-reference ${reference.linked ? "linked" : "direct"} ${isReferenced ? "referenced" : ""} ${type}-reference" ${reference.linked ? `data-reference-node="${reference.nodeId}"` : ""} title="${escapeHtml(reference.linked ? `${isReferenced ? "已引用" : "点击引用"}：${reference.filename}` : reference.filename)}">
          ${content}
          <span>${label}</span>
          <button type="button" ${reference.linked ? `data-remove-edge="${reference.edgeId}"` : `data-remove-reference="${reference.id}"`} aria-label="移除参考素材">${icons.close}</button>
        </div>`;
    }).join("");
    const statusText = generation.storageError || generation.pollError || (generation.status === "generating" ? "正在生成…" : generation.status === "failed" ? (generation.error || "生成失败") : generation.status === "complete" ? (generation.storageStatus === "ready" ? "生成完成 · 已存云端" : "生成完成") : "");
    const preview = node.type === "text" && node.content
      ? `<div class="generator-text-result" tabindex="0">${escapeHtml(node.content)}</div>`
      : node.url && node.type === "image"
        ? `<img src="${escapeHtml(node.url)}" alt="生成图片" draggable="false" />`
        : node.url && isVideo
          ? `<video src="${escapeHtml(node.url)}" controls preload="metadata" playsinline></video>`
          : `<div class="generator-empty-preview">${icons[node.type]}<span>${typeLabel}生成结果将在这里出现</span></div>`;

    element.innerHTML = `${toolbar}
      <div class="video-generator-shell">
        <div class="generator-label">${icons[node.type]}<span>${typeLabel}制作</span></div>
        <section class="generator-preview ${references.length ? "has-references" : ""}">
          ${isVideo && node.url ? `<button type="button" class="video-preview-zoom" data-video-preview-zoom aria-label="放大视频" title="放大视频" aria-pressed="false">${icons.expand}</button>` : ""}
          <button type="button" class="generator-upload-reference" data-add-reference>${icons.upload}<span>${isVideo && ["omni", "edit"].includes(generation.method) ? "上传参考素材" : "上传参考图"}</span></button>
          <div class="generator-reference-strip">${referenceMarkup}</div>
          ${preview}
          ${generation.outputs?.length ? `<div class="generation-results">${generation.outputs.map((output, index) => `<button type="button" data-output-id="${escapeHtml(output.id)}" class="${generation.selectedOutputId === output.id ? "active" : ""}" title="选择结果并供下游引用">结果 ${index + 1}</button>`).join("")}<button type="button" data-download-result>${node.type === "text" ? "复制文字" : "下载"}</button></div>` : ""}
        </section>
        <section class="generator-composer">
          <div class="generator-tools">
            <button type="button" class="generator-tool active" data-reference-library title="引用画布素材" aria-label="引用画布素材">${icons.frames}</button>
            <span></span>
            <button type="button" class="generator-tool" data-add-reference aria-label="添加参考图">${icons.plus}</button>
          </div>
          <textarea data-generator-prompt maxlength="5000" placeholder="描述你想生成的内容，或输入 @ 引用素材">${escapeHtml(generation.prompt)}</textarea>
          <div class="mention-menu" data-mention-menu></div>
          <div class="generator-status ${generation.status}" data-generator-status>${escapeHtml(statusText)}</div>
          ${generation.status === "generating" ? '<button type="button" class="generation-refresh" data-refresh-generation>刷新进度</button>' : ""}
          <div class="generator-footer">
            <button type="button" class="generator-control model-control" data-generator-model><span class="model-mark">${isVideo && generation.model.startsWith("Seedance") ? "▥" : "◯"}</span><strong>${generation.model === "default" ? "默认模型" : escapeHtml(generation.model)}</strong></button>
            <span class="generator-divider"></span>
            <button type="button" class="generator-control settings-control" data-generator-settings><strong data-settings-summary>${escapeHtml(this.generatorSettingsSummary(generation))}</strong></button>
            <span class="generator-divider"></span>
            ${isVideo && VideoModels.get(generation.model).multiShot ? `<button type="button" class="generator-control ${generation.multiShot ? "active" : ""}" data-multishot title="启用多镜头生成，请在提示词中描述镜头顺序">${icons.frames}<strong>多镜头</strong></button>` : ""}
            <span class="generator-footer-spacer"></span>
            <button type="button" class="generator-tool generator-mic" data-dictate title="语音输入提示词" aria-label="语音输入提示词">${icons.microphone}</button>
            <span class="generator-divider"></span>
            ${isVideo ? `<button type="button" class="generator-count" data-generator-count>${generation.count}×</button>` : ""}
            <button type="button" class="generator-submit" data-generate-video ${generation.status === "generating" ? "disabled" : ""} title="${isVideo ? "按截图费率估算积分，仅作参考，实际费用以生成服务为准" : "生成"}"><span data-generator-cost>${this.generatorCost(generation)}</span><i>${icons.arrowUp}</i></button>
          </div>
        </section>
      </div>
      <span class="resize-handle" data-resize></span>`;

    const previewVideo = element.querySelector(".generator-preview > video");
    if (previewVideo) {
      const fitVideo = () => {
        if (!previewVideo.videoWidth || !previewVideo.videoHeight || !element.isConnected) return;
        this.videoAspectRatios.set(node.url, previewVideo.videoWidth / previewVideo.videoHeight);
        this.applyNodeStyle(element, node);
        this.updateEdgesForNode(node.id);
        this.renderSelectionBox();
      };
      previewVideo.addEventListener("loadedmetadata", fitVideo);
      previewVideo.addEventListener("resize", fitVideo);
    }
    const zoomButton = element.querySelector("[data-video-preview-zoom]");
    const syncZoomButton = () => {
      if (!zoomButton) return;
      const expanded = this.expandedVideoIds.has(node.id);
      const label = expanded ? "缩小视频" : "放大视频";
      zoomButton.innerHTML = expanded ? icons.collapse : icons.expand;
      zoomButton.title = label;
      zoomButton.setAttribute("aria-label", label);
      zoomButton.setAttribute("aria-pressed", String(expanded));
    };
    syncZoomButton();
    zoomButton?.addEventListener("click", (event) => {
      event.stopPropagation();
      if (this.expandedVideoIds.has(node.id)) this.expandedVideoIds.delete(node.id);
      else this.expandedVideoIds.add(node.id);
      this.closeGeneratorPanel();
      this.applyNodeStyle(element, node);
      syncZoomButton();
      this.updateEdgesForNode(node.id);
      this.renderSelectionBox();
    });
    element.querySelector(".generator-preview").addEventListener("pointerdown", (event) => {
      if (event.button === 0 && !event.shiftKey && !this.selectedIds.has(node.id)) this.selectNode(node.id);
    });
    const prompt = element.querySelector("[data-generator-prompt]");
    prompt.addEventListener("pointerdown", () => {
      if (!this.selectedIds.has(node.id)) this.selectNode(node.id);
    });
    prompt.addEventListener("input", () => {
      generation.prompt = prompt.value;
      if (generation.status === "failed") {
        generation.status = "draft";
        generation.error = null;
        this.updateGeneratorStatus(element, generation);
      }
      this.queueGenerationSave(node);
      this.updateMentionMenu(node, element, prompt);
    });
    prompt.addEventListener("focus", () => this.beginEditHistory(`prompt:${node.id}`));
    prompt.addEventListener("keydown", (event) => this.handleMentionKeydown(event, node, element, prompt));
    prompt.addEventListener("blur", () => {
      this.finishEditHistory(`prompt:${node.id}`);
      setTimeout(() => element.querySelector("[data-mention-menu]")?.classList.remove("visible"), 120);
    });
    element.querySelectorAll("[data-add-reference]").forEach((button) => button.addEventListener("click", (event) => {
      event.stopPropagation();
      const policy = isVideo ? VideoModels.referencePolicy(generation) : { limit: 2, types: ["image"] };
      if ((generation.references || []).length >= policy.limit) return toast(policy.limit ? `当前方式最多添加 ${policy.limit} 个参考素材` : "文生视频不使用媒体参考，请先切换生成方式");
      pickerContext = { canvas: this, kind: "video-reference", node };
      filePicker.accept = policy.types.map((type) => ACCEPT[type]).join(",");
      filePicker.value = "";
      filePicker.click();
    }));
    element.querySelectorAll("[data-remove-reference]").forEach((button) => button.addEventListener("click", async (event) => {
      event.stopPropagation();
      this.pushHistorySnapshot(this.captureHistorySnapshot());
      try {
        await api(`/api/nodes/${node.id}/references/${button.dataset.removeReference}`, { method: "DELETE" });
        generation.references = generation.references.filter((item) => item.id !== button.dataset.removeReference);
        this.replaceNodeElement(node);
      } catch (error) {
        this.historyStack.pop();
        toast(error.message);
      }
    }));
    element.querySelectorAll("[data-remove-edge]").forEach((button) => button.addEventListener("click", (event) => {
      event.stopPropagation();
      this.deleteEdge(button.dataset.removeEdge);
    }));
    element.querySelectorAll("[data-reference-node]").forEach((card) => card.addEventListener("click", (event) => {
      if (event.target.closest("button")) return;
      event.stopPropagation();
      this.toggleGeneratorReference(node, card.dataset.referenceNode, element);
    }));
    element.querySelector("[data-generator-model]").addEventListener("click", (event) => {
      event.stopPropagation();
      this.openModelPanel(event.currentTarget, element, node);
    });
    element.querySelector("[data-generator-settings]").addEventListener("click", (event) => {
      event.stopPropagation();
      this.openSettingsPanel(event.currentTarget, element, node);
    });
    element.querySelector("[data-multishot]")?.addEventListener("click", (event) => {
      this.pushHistorySnapshot(this.captureHistorySnapshot());
      generation.multiShot = !generation.multiShot;
      event.currentTarget.classList.toggle("active", generation.multiShot);
      this.queueGenerationSave(node);
    });
    element.querySelector("[data-generator-count]")?.addEventListener("click", (event) => {
      this.openCountPanel(event.currentTarget, element, node);
    });
    element.querySelector("[data-reference-library]").addEventListener("click", (event) => this.openReferenceLibrary(event.currentTarget, element, node));
    element.querySelector("[data-dictate]").addEventListener("click", (event) => this.startDictation(node, element, event.currentTarget));
    element.querySelector("[data-refresh-generation]")?.addEventListener("click", () => this.pollGenerationJobs(true));
    element.querySelectorAll("[data-output-id]").forEach((button) => button.addEventListener("click", async () => {
      try {
        const updated = await api(`/api/nodes/${node.id}`, { method: "PATCH", body: JSON.stringify({ generation: { selectedOutputId: button.dataset.outputId } }) });
        Object.assign(node, updated);
        this.replaceNodeElement(node);
        await this.refreshLinkedPreviews();
      } catch (error) { toast(error.message); }
    }));
    element.querySelector("[data-download-result]")?.addEventListener("click", async () => {
      try {
        if (node.type === "text") { await navigator.clipboard.writeText(node.content); return toast("文字已复制"); }
        if (serviceConfig.directUpload) {
          const result = await api(`/api/nodes/${node.id}/download?link=1`);
          const anchor = document.createElement('a'); anchor.href = result.url; anchor.rel = 'noopener'; anchor.click(); return;
        }
        const response = await fetch(`/api/nodes/${node.id}/download`);
        if (!response.ok) throw new Error("下载失败");
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url; anchor.download = `${node.filename}-${node.generation.selectedOutputId || "1"}.${node.type === "video" ? "mp4" : "png"}`;
        anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (error) { toast(`无法直接下载：${error.message}，可在查看窗口打开原始结果`); }
    });
    element.querySelector("[data-generate-video]").addEventListener("click", (event) => this.generateVideo(node, element, event.currentTarget));
  }

  toggleGeneratorReference(node, referenceNodeId, element, forceSelected = null, recordHistory = true) {
    if (recordHistory) this.pushHistorySnapshot(this.captureHistorySnapshot());
    const selected = new Set(node.generation.selectedReferenceNodeIds || []);
    const shouldSelect = forceSelected ?? !selected.has(referenceNodeId);
    if (shouldSelect) selected.add(referenceNodeId);
    else selected.delete(referenceNodeId);
    node.generation.selectedReferenceNodeIds = [...selected];
    const card = element.querySelector(`[data-reference-node="${referenceNodeId}"]`);
    card?.classList.toggle("referenced", shouldSelect);
    if (card) card.title = `${shouldSelect ? "已引用" : "点击引用"}：${this.nodes.find((item) => item.id === referenceNodeId)?.filename || "上游节点"}`;
    this.queueGenerationSave(node);
  }

  mentionQuery(prompt) {
    const before = prompt.value.slice(0, prompt.selectionStart ?? prompt.value.length);
    const match = before.match(/(?:^|\s)@([^\s@]*)$/u);
    return match ? { query: match[1].toLowerCase(), start: before.length - match[1].length - 1 } : null;
  }

  updateMentionMenu(node, element, prompt) {
    const menu = element.querySelector("[data-mention-menu]");
    const mention = this.mentionQuery(prompt);
    if (!mention) {
      menu.classList.remove("visible");
      return;
    }
    const references = (node.generation.linkedReferences || []).filter((reference) => {
      const haystack = `${reference.filename || ""} ${reference.type || ""}`.toLowerCase();
      return !mention.query || haystack.includes(mention.query);
    });
    if (!references.length) {
      menu.innerHTML = '<div class="mention-empty">先连接一个上游节点</div>';
      menu.classList.add("visible");
      return;
    }
    const selected = new Set(node.generation.selectedReferenceNodeIds || []);
    const labels = { text: "文字", image: "图片", video: "视频", audio: "音频" };
    menu.innerHTML = references.map((reference, index) => `
      <button type="button" class="mention-option ${index === 0 ? "focused" : ""}" data-mention-node="${reference.nodeId}">
        <span>${icons[reference.type] || icons.image}</span>
        <strong>${escapeHtml(reference.filename || labels[reference.type] || "上游节点")}</strong>
        <small>${selected.has(reference.nodeId) ? "已引用" : labels[reference.type] || "引用"}</small>
      </button>`).join("");
    menu.querySelectorAll("[data-mention-node]").forEach((button) => button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      this.applyMention(node, element, prompt, button.dataset.mentionNode);
    }));
    menu.classList.add("visible");
  }

  handleMentionKeydown(event, node, element, prompt) {
    const menu = element.querySelector("[data-mention-menu]");
    if (!menu.classList.contains("visible")) return;
    const options = [...menu.querySelectorAll("[data-mention-node]")];
    if (!options.length) return;
    const current = Math.max(0, options.findIndex((button) => button.classList.contains("focused")));
    if (["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      const next = (current + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
      options.forEach((button, index) => button.classList.toggle("focused", index === next));
    } else if (["Enter", "Tab"].includes(event.key)) {
      event.preventDefault();
      this.applyMention(node, element, prompt, options[current].dataset.mentionNode);
    } else if (event.key === "Escape") {
      event.preventDefault();
      menu.classList.remove("visible");
    }
  }

  applyMention(node, element, prompt, referenceNodeId) {
    const mention = this.mentionQuery(prompt);
    const reference = (node.generation.linkedReferences || []).find((item) => item.nodeId === referenceNodeId);
    if (!mention || !reference) return;
    const cursor = prompt.selectionStart ?? prompt.value.length;
    const name = String(reference.filename || reference.type || "引用").replace(/\s+/g, "_");
    prompt.value = `${prompt.value.slice(0, mention.start)}@${name} ${prompt.value.slice(cursor)}`;
    const nextCursor = mention.start + name.length + 2;
    prompt.setSelectionRange(nextCursor, nextCursor);
    node.generation.prompt = prompt.value;
    this.toggleGeneratorReference(node, referenceNodeId, element, true, false);
    element.querySelector("[data-mention-menu]").classList.remove("visible");
    prompt.focus();
  }

  generatorSettingsSummary(generation) {
    if (generation.outputType === "text") {
      return `${{ natural: "自然", creative: "创意", professional: "专业" }[generation.style]} · ${{ short: "简短", medium: "适中", long: "详细" }[generation.length]}`;
    }
    if (generation.outputType === "image") return `${generation.ratio} · ${generation.resolution}px`;
    const label = (value) => VideoModels.labels[value] || value;
    return [VideoModels.get(generation.model).modes ? label(generation.mode) : null, label(generation.method), label(generation.ratio), label(generation.resolution), `${generation.duration}s`, generation.audio ? "♫" : "静音"].filter(Boolean).join(" · ");
  }

  generatorCost(generation) {
    if (serviceConfig.videoProvider === "byteplus") return "生成";
    if (["text", "image"].includes(generation.outputType)) return "生成";
    const estimate = VideoModels.estimate(generation);
    return estimate === null ? "生成" : `≈${estimate}`;
  }

  openModelPanel(trigger, element, node) {
    this.closeGeneratorPanel();
    if (node.type !== "video") {
      const panel = document.createElement("form");
      panel.className = "generator-popover model-popover custom-model-panel";
      panel.innerHTML = `<label class="popover-title" for="model-${node.id}">生成模型</label>
        <input id="model-${node.id}" name="model" maxlength="80" value="${escapeHtml(node.generation.model)}" placeholder="default" />
        <p>使用默认模型，或填写生成服务支持的模型名称。</p>
        <button type="submit" class="secondary-button">应用</button>`;
      panel.addEventListener("submit", (event) => {
        event.preventDefault();
        this.pushHistorySnapshot(this.captureHistorySnapshot());
        node.generation.model = panel.elements.model.value.trim() || "default";
        element.querySelector("[data-generator-model] strong").textContent = node.generation.model === "default" ? "默认模型" : node.generation.model;
        this.queueGenerationSave(node);
        this.closeGeneratorPanel();
      });
      element.querySelector(".generator-composer").append(panel);
      this.trackGeneratorPanel(panel, trigger);
      return;
    }
    const models = Object.entries(VideoModels.models).filter(([name, spec]) => serviceConfig.videoModels ? serviceConfig.videoModels.includes(name) : !spec.legacy || name === node.generation.model).map(([name, spec]) => [name, `${spec.resolutions.join(" / ")} · ${spec.durations[0]}–${spec.durations.at(-1)}s`]);
    const panel = document.createElement("div");
    panel.className = "generator-popover model-popover";
    panel.innerHTML = `<div class="popover-title">选择视频模型</div>${models.map(([name, detail], index) => `
      <button type="button" class="model-option ${node.generation.model === name ? "active" : ""}" data-model="${name}">
        <span class="model-mark">${name.startsWith("Seedance") ? "▥" : "◯"}</span><span><strong>${name}</strong><small>${detail}</small></span>
      </button>`).join("")}`;
    element.querySelector(".generator-composer").append(panel);
    panel.querySelectorAll("[data-model]").forEach((button) => button.addEventListener("click", () => {
      this.pushHistorySnapshot(this.captureHistorySnapshot());
      const model = button.dataset.model;
      const spec = VideoModels.get(model);
      Object.assign(node.generation, VideoModels.normalize({ model, ...spec.defaults }, node.generation));
      if (!spec.modes) delete node.generation.mode;
      this.queueGenerationSave(node);
      this.closeGeneratorPanel();
      this.replaceNodeElement(node);
    }));
    this.trackGeneratorPanel(panel, trigger);
  }

  openSettingsPanel(trigger, element, node) {
    this.closeGeneratorPanel();
    if (node.type === "video") return this.openVideoSettingsPanel(trigger, element, node);
    const generation = node.generation;
    const group = (label, key, options) => `
      <div class="setting-group"><label>${label}</label><div class="setting-options">${options.map(([value, text]) => `
        <button type="button" class="${String(generation[key]) === String(value) ? "active" : ""}" data-setting-key="${key}" data-setting-value="${value}">${text}</button>`).join("")}</div></div>`;
    const panel = document.createElement("div");
    panel.className = "generator-popover settings-popover";
    panel.innerHTML = `
      <div class="popover-title">生成参数</div>
      ${node.type === "text" ? `${group("文字风格", "style", [["natural", "自然"], ["creative", "创意"], ["professional", "专业"]])}
      ${group("篇幅", "length", [["short", "简短"], ["medium", "适中"], ["long", "详细"]])}`
      : node.type === "image" ? `${group("比例", "ratio", [["1:1", "1:1"], ["16:9", "16:9"], ["9:16", "9:16"]])}
      ${group("尺寸", "resolution", [["1024", "1024px"], ["2048", "2048px"]])}`
      : `${group("生成模式", "mode", [["standard", "标准"], ["professional", "专业"], ["4k", "4K"]])}
      ${group("生成方式", "method", [["text", "文生视频"], ["first-frame", "首帧"], ["first-last", "首尾帧"]])}
      ${group("比例", "ratio", [["16:9", "▭ 16:9"], ["9:16", "▯ 9:16"], ["1:1", "□ 1:1"]])}
      ${group("清晰度", "resolution", [["adaptive", "自适应"], ["720p", "720P"], ["1080p", "1080P"]])}
      ${group("生成时长", "duration", [[5, "5s"], [10, "10s"], [15, "15s"]])}
      ${group("生成音频", "audio", [[true, "开启"], [false, "关闭"]])}`}`;
    element.querySelector(".generator-composer").append(panel);
    panel.querySelectorAll("[data-setting-key]").forEach((button) => button.addEventListener("click", () => {
      this.pushHistorySnapshot(this.captureHistorySnapshot());
      const key = button.dataset.settingKey;
      let value = button.dataset.settingValue;
      if (key === "duration") value = Number(value);
      if (key === "audio") value = value === "true";
      generation[key] = value;
      button.parentElement.querySelectorAll("button").forEach((item) => item.classList.toggle("active", item === button));
      element.querySelector("[data-settings-summary]").textContent = this.generatorSettingsSummary(generation);
      this.queueGenerationSave(node);
    }));
    this.trackGeneratorPanel(panel, trigger);
  }

  openVideoSettingsPanel(trigger, element, node) {
    const generation = node.generation;
    const spec = VideoModels.get(generation.model);
    const panel = document.createElement("div");
    panel.className = "generator-popover settings-popover video-settings-popover";
    const label = (value) => VideoModels.labels[value] || value;
    const ratioIcon = (value) => {
      if (value === "adaptive") return '<span class="ratio-adaptive">⌗</span>';
      const [w, h] = value.split(":").map(Number);
      return `<span class="ratio-symbol" style="width:${Math.round(20 * Math.min(1, w / h))}px;height:${Math.round(20 * Math.min(1, h / w))}px"></span>`;
    };
    const group = (title, key, values, ratios = false) => `<div class="setting-group"><label>${title}</label><div class="setting-options ${ratios ? "ratio-options" : ""}">${values.map((value) => `<button type="button" aria-pressed="${String(generation[key]) === String(value)}" class="${String(generation[key]) === String(value) ? "active" : ""}" data-setting-key="${key}" data-setting-value="${value}" ${key === "method" ? `title="${value === "omni" ? "将图片、视频、音频作为生成参考" : value === "edit" ? "根据提示词修改参考视频，至少需要一个视频" : "按添加顺序使用图片作为首帧和尾帧"}"` : ""}>${ratios ? ratioIcon(value) : ""}<span>${typeof value === "boolean" ? value ? "开启" : "关闭" : label(value)}</span></button>`).join("")}</div></div>`;
    panel.innerHTML = `${spec.modes ? group("生成模式", "mode", spec.modes) : ""}
      ${group("生成方式", "method", spec.methods)}
      ${group("比例", "ratio", spec.ratios, true)}
      ${group("清晰度", "resolution", spec.resolutions)}
      <div class="setting-group"><label>生成时长</label><div class="duration-controls"><div class="duration-options">${spec.durations.map((value) => `<button type="button" class="${generation.duration === value ? "active" : ""}" data-setting-key="duration" data-setting-value="${value}">${value}s</button>`).join("")}</div>${node.generation.model === "Seedance 2.5" ? `<label class="duration-input"><input type="number" aria-label="生成时长（秒）" min="${spec.durations[0]}" max="${spec.durations.at(-1)}" step="1" value="${generation.duration}" data-duration-input /><span>s</span></label>` : ""}</div></div>
      ${group("生成音频", "audio", [true, false])}`;
    const update = (key, value) => {
      this.pushHistorySnapshot(this.captureHistorySnapshot());
      Object.assign(generation, VideoModels.normalize({ [key]: value }, generation));
      panel.querySelectorAll(`[data-setting-key="${key}"]`).forEach((button) => {
        const selected = String(generation[key]) === button.dataset.settingValue;
        button.classList.toggle("active", selected); button.setAttribute("aria-pressed", String(selected));
      });
      if (key === "duration" && panel.querySelector("[data-duration-input]")) panel.querySelector("[data-duration-input]").value = generation.duration;
      element.querySelector("[data-settings-summary]").textContent = this.generatorSettingsSummary(generation);
      element.querySelector("[data-generator-cost]").textContent = this.generatorCost(generation);
      this.queueGenerationSave(node);
    };
    panel.querySelectorAll("[data-setting-key]").forEach((button) => button.addEventListener("click", () => {
      const key = button.dataset.settingKey;
      update(key, key === "audio" ? button.dataset.settingValue === "true" : key === "duration" ? Number(button.dataset.settingValue) : button.dataset.settingValue);
    }));
    panel.querySelector("[data-duration-input]")?.addEventListener("change", (event) => {
      const value = Number(event.target.value);
      if (!spec.durations.includes(value)) {
        event.target.value = generation.duration;
        return toast(`请输入 ${spec.durations[0]}–${spec.durations.at(-1)} 之间的整数秒数`);
      }
      update("duration", value);
      this.scrollDurationOptions(panel);
    });
    panel.querySelector(".duration-options").addEventListener("wheel", (event) => { event.preventDefault(); event.currentTarget.scrollLeft += event.deltaY || event.deltaX; }, { passive: false });
    this.trackGeneratorPanel(panel, trigger);
    this.scrollDurationOptions(panel);
  }

  scrollDurationOptions(panel) {
    const strip = panel.querySelector(".duration-options");
    const active = strip?.querySelector(".active");
    if (active) strip.scrollLeft = Math.max(0, active.offsetLeft + active.offsetWidth - strip.clientWidth);
  }

  openCountPanel(trigger, element, node) {
    this.closeGeneratorPanel();
    const panel = document.createElement("div");
    panel.className = "generator-popover count-popover";
    panel.innerHTML = `<div class="popover-title">生成数量</div><div class="setting-options">${[1, 2, 4].map((count) => `<button type="button" data-count="${count}" class="${node.generation.count === count ? "active" : ""}">${count}×</button>`).join("")}</div>`;
    panel.querySelectorAll("[data-count]").forEach((button) => button.addEventListener("click", () => {
      this.pushHistorySnapshot(this.captureHistorySnapshot());
      node.generation.count = Number(button.dataset.count);
      trigger.textContent = `${node.generation.count}×`;
      element.querySelector("[data-generator-cost]").textContent = this.generatorCost(node.generation);
      this.queueGenerationSave(node);
      this.closeGeneratorPanel();
    }));
    this.trackGeneratorPanel(panel, trigger);
  }

  openReferenceLibrary(trigger, element, node) {
    this.closeGeneratorPanel();
    const panel = document.createElement("div");
    panel.className = "generator-popover reference-library";
    const candidates = this.nodes.filter((item) => item.id !== node.id);
    const selected = new Set(node.generation.selectedReferenceNodeIds || []);
    panel.innerHTML = `<div class="popover-title">引用画布素材</div><p>选择后自动连接并加入引用。首尾帧模式按添加顺序使用图片。</p>${candidates.length ? candidates.map((item) => `<button type="button" class="model-option ${selected.has(item.id) ? "active" : ""}" data-library-node="${item.id}">${icons[item.type]}<span><strong>${escapeHtml(item.filename)}</strong><small>${selected.has(item.id) ? "已引用，点击取消" : item.kind === "generator" && !item.url && !item.content ? "尚未生成结果" : "添加引用"}</small></span></button>`).join("") : '<p>先在画布中添加素材或文字节点，也可用 + 上传参考素材。</p>'}`;
    panel.querySelectorAll("[data-library-node]").forEach((button) => button.addEventListener("click", async () => {
      button.disabled = true;
      const source = this.nodes.find((item) => item.id === button.dataset.libraryNode);
      try {
        if (!this.edges.some((edge) => edge.sourceNodeId === source.id && edge.targetNodeId === node.id)) {
          const result = await this.createEdge(source, node, { selectTarget: false });
          if (!result || !this.edges.some((edge) => edge.sourceNodeId === source.id && edge.targetNodeId === node.id)) return;
        }
        this.toggleGeneratorReference(node, source.id, this.world.querySelector(`[data-node-id="${node.id}"]`), !selected.has(source.id));
        await this.saveGeneration(node);
        this.closeGeneratorPanel();
        this.replaceNodeElement(node);
      } catch (error) { toast(error.message); } finally { button.disabled = false; }
    }));
    this.trackGeneratorPanel(panel, trigger);
  }

  startDictation(node, element, button) {
    if (this.speechRecognition) { this.speechRecognition.stop(); return; }
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) return toast("当前浏览器不支持语音识别，请使用支持语音输入的 Chrome 或 Edge");
    const recognition = new Recognition();
    recognition.lang = "zh-CN";
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.onstart = () => { button.classList.add("recording"); button.title = "正在听写，点击停止"; toast("开始语音输入，点击麦克风停止"); };
    recognition.onresult = (event) => {
      if (this.abort.signal.aborted || !this.nodes.includes(node)) return;
      const words = Array.from(event.results).slice(event.resultIndex).filter((result) => result.isFinal).map((result) => result[0].transcript).join("");
      if (!words) return;
      this.pushHistorySnapshot(this.captureHistorySnapshot());
      node.generation.prompt = `${node.generation.prompt}${words}`.slice(0, 5000);
      const currentPrompt = this.world.querySelector(`[data-node-id="${node.id}"] [data-generator-prompt]`);
      if (currentPrompt) currentPrompt.value = node.generation.prompt;
      this.queueGenerationSave(node);
    };
    recognition.onerror = (event) => toast(event.error === "not-allowed" ? "请允许麦克风权限后重试" : `语音识别失败：${event.error}，请检查麦克风及浏览器语音服务`);
    recognition.onend = () => { button.classList.remove("recording"); button.title = "语音输入提示词"; this.speechRecognition = null; };
    this.speechRecognition = recognition;
    try { recognition.start(); } catch (error) { this.speechRecognition = null; toast(error.message); }
  }

  async refreshLinkedPreviews() {
    const project = await api(`/api/projects/${this.project.id}`);
    if (this.abort.signal.aborted) return;
    for (const target of this.nodes.filter((item) => item.generation)) {
      const saved = project.nodes.find((item) => item.id === target.id);
      if (!saved?.generation) continue;
      const changed = JSON.stringify(target.generation.linkedReferences) !== JSON.stringify(saved.generation.linkedReferences);
      target.generation.linkedReferences = saved.generation.linkedReferences;
      if (changed && !this.world.querySelector(`[data-node-id="${target.id}"]`)?.contains(document.activeElement)) this.replaceNodeElement(target, false);
    }
  }

  async pollGenerationJobs(manual = false) {
    if (this.pollingGeneration || this.abort.signal.aborted) return;
    const nodes = this.nodes.filter((node) => node.generation?.status === "generating" || (serviceConfig.cloudStorage && node.generation?.status === "complete" && node.generation.storageStatus !== "ready"));
    if (!nodes.length) return;
    this.pollingGeneration = true;
    let finished = false;
    try {
      await Promise.all(nodes.map(async (node) => {
        try {
          const updated = await api(`/api/nodes/${node.id}/generation`);
          if (this.abort.signal.aborted || !this.nodes.includes(node)) return;
          const keys = ["status", "error", "pollError", "jobs", "outputs", "outputUrl", "jobId", "selectedOutputId", "storageStatus", "storageError"];
          const changed = keys.some((key) => JSON.stringify(node.generation[key]) !== JSON.stringify(updated.generation[key]));
          keys.forEach((key) => { node.generation[key] = updated.generation[key]; });
          node.url = updated.url;
          if (node.type === "text") node.content = updated.content;
          if (changed) this.replaceNodeElement(node, false);
          if (updated.generation.status !== "generating") finished = true;
          if (manual && updated.generation.pollError) toast(updated.generation.pollError);
        } catch (error) { if (manual) toast(error.message); }
      }));
      if (finished) await this.refreshLinkedPreviews().catch((error) => { if (manual) toast(error.message); });
    } finally { this.pollingGeneration = false; }
  }

  trackGeneratorPanel(panel, trigger) {
    this.generatorPanel = panel;
    document.body.append(panel);
    panel.style.position = "fixed";
    panel.style.maxHeight = `${Math.max(180, window.innerHeight - 24)}px`;
    panel.style.maxWidth = `${window.innerWidth - 24}px`;
    panel.style.bottom = "auto";
    panel.style.top = "0px";
    panel.style.left = "0px";
    const position = () => {
      const currentAnchor = trigger.getBoundingClientRect();
      const box = { width: panel.offsetWidth, height: panel.offsetHeight };
      panel.style.left = `${Math.max(12, Math.min(window.innerWidth - box.width - 12, currentAnchor.left))}px`;
      panel.style.top = `${Math.max(12, Math.min(window.innerHeight - box.height - 12, currentAnchor.top - box.height - 12))}px`;
    };
    position();
    const resizeObserver = new ResizeObserver(position);
    resizeObserver.observe(panel);
    panel.addEventListener("wheel", (event) => event.stopPropagation());
    const outside = (event) => {
      if (!panel.contains(event.target) && !trigger.contains(event.target)) this.closeGeneratorPanel();
    };
    const listenerTimer = setTimeout(() => document.addEventListener("pointerdown", outside), 0);
    this.generatorPanelCleanup = () => {
      resizeObserver.disconnect();
      clearTimeout(listenerTimer);
      document.removeEventListener("pointerdown", outside);
    };
  }

  closeGeneratorPanel() {
    this.generatorPanelCleanup?.();
    this.generatorPanelCleanup = null;
    this.generatorPanel?.remove();
    this.generatorPanel = null;
  }

  queueTextSave(node) {
    clearTimeout(this.textTimers.get(node.id));
    this.textTimers.set(node.id, setTimeout(() => this.saveTextNode(node), 450));
  }

  async saveTextNode(node) {
    clearTimeout(this.textTimers.get(node.id));
    this.textTimers.delete(node.id);
    this.setSaving(true);
    try {
      const updated = await api(`/api/nodes/${node.id}`, {
        method: "PATCH",
        body: JSON.stringify({ content: node.content }),
      });
      node.content = updated.content;
    } catch (error) {
      toast(`文字保存失败：${error.message}`);
    } finally {
      this.setSaving(false);
    }
  }

  queueGenerationSave(node) {
    clearTimeout(this.generationTimers.get(node.id));
    this.generationTimers.set(node.id, setTimeout(() => this.saveGeneration(node).catch(() => {}), 450));
  }

  async saveGeneration(node) {
    clearTimeout(this.generationTimers.get(node.id));
    this.generationTimers.delete(node.id);
    this.setSaving(true);
    try {
      const submitted = JSON.parse(JSON.stringify(node.generation));
      const updated = await api(`/api/nodes/${node.id}`, {
        method: "PATCH",
        body: JSON.stringify({ generation: submitted }),
      });
      Object.entries(updated.generation).forEach(([key, value]) => {
        if (JSON.stringify(node.generation[key]) === JSON.stringify(submitted[key])) node.generation[key] = value;
      });
      return updated;
    } catch (error) {
      toast(`制作参数保存失败：${error.message}`);
      throw error;
    } finally {
      this.setSaving(false);
    }
  }

  updateGeneratorStatus(element, generation) {
    const status = element.querySelector("[data-generator-status]");
    status.className = `generator-status ${generation.status}`;
    status.textContent = generation.status === "generating" ? "正在生成…" : generation.status === "failed" ? (generation.error || "生成失败") : generation.status === "complete" ? "生成完成" : "";
  }

  async generateVideo(node, element, button) {
    const selectedReferences = new Set(node.generation.selectedReferenceNodeIds || []);
    const hasConnectedText = (node.generation.linkedReferences || []).some((reference) => selectedReferences.has(reference.nodeId) && reference.type === "text" && reference.content?.trim());
    if (!node.generation.prompt.trim() && !hasConnectedText) {
      element.querySelector("[data-generator-prompt]").focus();
      return toast("请先描述内容，或用 @ 引用一个文字节点");
    }
    button.disabled = true;
    node.generation.status = "generating";
    this.updateGeneratorStatus(element, node.generation);
    try {
      await this.saveGeneration(node);
      const updated = await api(`/api/nodes/${node.id}/generate`, { method: "POST", body: JSON.stringify({}) });
      Object.assign(node, updated);
      this.replaceNodeElement(node);
      await this.refreshLinkedPreviews().catch(() => {});
      toast(updated.generation.status === "complete" ? "生成完成" : updated.generation.status === "failed" ? "生成失败，可检查提示后重试" : "生成任务已提交");
    } catch (error) {
      node.generation.status = error.message.includes("尚未配置") ? "draft" : "failed";
      node.generation.error = node.generation.status === "failed" ? error.message : null;
      this.updateGeneratorStatus(element, node.generation);
      button.disabled = false;
      toast(error.message);
    }
  }

  replaceNodeElement(node, select = true) {
    this.world.querySelector(`[data-node-id="${node.id}"]`)?.remove();
    this.mountNode(node);
    this.updateEdgesForNode(node.id);
    if (select) this.selectNode(node.id);
    else this.renderSelectionBox();
  }

  async uploadReferences(node, files) {
    const referenceCount = (node.generation.references || []).length;
    const policy = node.type === "video" ? VideoModels.referencePolicy(node.generation) : { limit: 2, types: ["image"] };
    const available = Math.max(0, policy.limit - referenceCount);
    const supported = files.filter((file) => policy.types.includes(fileType(file)));
    const images = supported.slice(0, available);
    if (!images.length) return toast(available ? "当前生成方式不支持这些参考素材" : `当前生成方式最多添加 ${policy.limit} 个参考素材`);
    if (images.length !== files.length) toast(`已选择 ${images.length} 个素材，其余文件超出数量限制或格式不支持`);
    try { await this.saveGeneration(node); } catch { return; }
    this.pushHistorySnapshot(this.captureHistorySnapshot());
    const item = this.createUploadItem(images[0]);
    item.querySelector(".upload-caption").textContent = `上传 ${images.length} 个参考素材`;
    item.querySelector(".upload-progress span").style.width = "45%";
    const form = new FormData();
    images.forEach((file) => form.append("files", file, file.name));
    try {
      const response = serviceConfig.directUpload ? null : await fetch(`/api/projects/${this.project.id}/nodes/${node.id}/references`, { method: "POST", body: form });
      let updated;
      if (serviceConfig.directUpload) {
        for (const file of images) updated = await window.uploadToCloud(file, this.project.id, { referenceNodeId: node.id });
      } else {
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "参考图上传失败");
      }
      updated = await response.json();
      }
      node.generation = updated.generation;
      item.classList.add("success");
      item.querySelector(".upload-status-icon").innerHTML = icons.check;
      item.querySelector(".upload-caption").textContent = "参考素材已添加";
      item.querySelector(".upload-progress span").style.width = "100%";
      setTimeout(() => item.remove(), 1400);
      this.replaceNodeElement(node);
    } catch (error) {
      this.historyStack.pop();
      item.classList.add("failed");
      item.querySelector(".upload-status-icon").innerHTML = icons.alert;
      item.querySelector(".upload-caption").textContent = error.message;
      item.querySelector(".upload-progress span").style.width = "0%";
      toast(error.message);
    }
  }

  generatorPreviewHeight(node) {
    const aspectRatio = node.type === "video" && this.videoAspectRatios.get(node.url);
    if (aspectRatio) {
      const width = node.width * (this.expandedVideoIds.has(node.id) ? 1 : 0.64);
      // The preview has a 1px border; match its inner box to the encoded video.
      return (width - 2) / aspectRatio + 2;
    }
    const height = Math.max(180, (node.height - 296) * (node.type === "video" ? 0.78 : 1));
    return height / (node.type === "video" && this.expandedVideoIds.has(node.id) ? 0.64 : 1);
  }

  applyNodeStyle(element, node) {
    element.classList.toggle("video-preview-expanded", this.expandedVideoIds.has(node.id));
    element.style.left = `${node.x}px`;
    element.style.top = `${node.y}px`;
    element.style.width = `${node.width}px`;
    element.style.height = node.kind === "generator" ? "auto" : `${node.height}px`;
    if (node.kind === "generator") element.style.setProperty("--generator-preview-height", `${this.generatorPreviewHeight(node)}px`);
  }

  bindAudio(element) {
    const audio = element.querySelector("audio");
    const button = element.querySelector(".audio-play");
    const range = element.querySelector(".audio-seek");
    const time = element.querySelector(".audio-time");
    const sync = () => {
      const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
      const progress = duration ? (audio.currentTime / duration) * 100 : 0;
      range.value = String(progress);
      range.style.setProperty("--progress", `${progress}%`);
      time.textContent = `${formatTime(audio.currentTime)} / ${formatTime(duration)}`;
      button.innerHTML = audio.paused ? icons.play : icons.pause;
      button.setAttribute("aria-label", audio.paused ? "播放" : "暂停");
    };
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      if (audio.paused) audio.play().catch(() => toast("无法播放这个音频格式"));
      else audio.pause();
    });
    range.addEventListener("input", (event) => {
      event.stopPropagation();
      if (Number.isFinite(audio.duration)) audio.currentTime = (Number(range.value) / 100) * audio.duration;
      sync();
    });
    ["loadedmetadata", "timeupdate", "play", "pause", "ended"].forEach((name) => audio.addEventListener(name, sync));
  }

  startNodeDrag(event, node, element) {
    if (event.button !== 0 || event.target.closest("button, input, textarea, select, .generator-text-result, .generator-popover, [data-resize]")) return;
    if (event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      this.selectNode(node.id, { toggle: true });
      return;
    }
    const video = event.target.closest("video");
    if (video) {
      const rect = video.getBoundingClientRect();
      if (event.clientY > rect.bottom - 48) {
        if (!this.selectedIds.has(node.id)) this.selectNode(node.id);
        return;
      }
    }
    event.stopPropagation();
    this.closeAddMenu();
    if (!this.selectedIds.has(node.id)) this.selectNode(node.id);
    const movingNodes = this.selectedNodes();
    const startPositions = new Map(movingNodes.map((item) => [item.id, { x: item.x, y: item.y }]));
    const historySnapshot = this.captureHistorySnapshot();
    const start = { clientX: event.clientX, clientY: event.clientY };
    let dragging = false;
    const move = (moveEvent) => {
      const dx = (moveEvent.clientX - start.clientX) / this.viewport.zoom;
      const dy = (moveEvent.clientY - start.clientY) / this.viewport.zoom;
      if (!dragging && Math.abs(dx) + Math.abs(dy) < 3) return;
      if (!dragging) {
        dragging = true;
        this.pushHistorySnapshot(historySnapshot);
        movingNodes.forEach((item) => this.world.querySelector(`[data-node-id="${item.id}"]`)?.classList.add("dragging"));
        element.setPointerCapture?.(event.pointerId);
      }
      moveEvent.preventDefault();
      movingNodes.forEach((item) => {
        const origin = startPositions.get(item.id);
        item.x = origin.x + dx;
        item.y = origin.y + dy;
        const itemElement = this.world.querySelector(`[data-node-id="${item.id}"]`);
        if (itemElement) {
          itemElement.style.left = `${item.x}px`;
          itemElement.style.top = `${item.y}px`;
        }
      });
      this.renderEdges();
      this.renderSelectionBox();
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      movingNodes.forEach((item) => this.world.querySelector(`[data-node-id="${item.id}"]`)?.classList.remove("dragging"));
      if (dragging) this.saveNodes(movingNodes);
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  }

  startResize(event, node, element) {
    event.preventDefault();
    event.stopPropagation();
    if (!this.selectedIds.has(node.id)) this.selectNode(node.id);
    const historySnapshot = this.captureHistorySnapshot();
    const start = { clientX: event.clientX, width: node.width, height: node.height };
    const ratio = node.width / node.height;
    let resized = false;
    const move = (moveEvent) => {
      moveEvent.preventDefault();
      const delta = (moveEvent.clientX - start.clientX) / this.viewport.zoom;
      if (!resized && Math.abs(delta) < 2) return;
      if (!resized) {
        resized = true;
        this.pushHistorySnapshot(historySnapshot);
      }
      node.width = Math.max(node.kind === "generator" ? 620 : node.type === "text" ? 240 : 140, start.width + delta);
      node.height = node.width / ratio;
      this.applyNodeStyle(element, node);
      this.updateEdgesForNode(node.id);
      this.renderSelectionBox();
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      if (resized) this.saveNode(node);
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  }

  async saveNode(node) {
    return this.saveNodes([node]);
  }

  async saveNodes(nodes) {
    this.setSaving(true);
    try {
      const result = await api(`/api/projects/${this.project.id}/nodes`, {
        method: "PATCH",
        body: JSON.stringify({ nodes: nodes.map((node) => ({ id: node.id, x: node.x, y: node.y, width: node.width, height: node.height })) }),
      });
      result.nodes.forEach((updated) => {
        const node = this.nodes.find((item) => item.id === updated.id);
        if (node) Object.assign(node, updated);
      });
    } catch (error) {
      toast(`素材位置保存失败：${error.message}`);
    } finally {
      this.setSaving(false);
    }
  }

  openViewer(node) {
    let content;
    if (node.type === "image") {
      content = `<img src="${node.url}" alt="${escapeHtml(node.filename)}" />`;
    } else if (node.type === "video") {
      content = `<video src="${node.url}" controls autoplay playsinline></video>`;
    } else {
      content = `<div class="viewer-audio"><div class="viewer-audio-name">${escapeHtml(node.filename)}</div><audio src="${node.url}" controls autoplay></audio></div>`;
    }
    const backdrop = modalBackdrop(`
      <button class="viewer-close" aria-label="关闭">${icons.close}</button>
      <div class="viewer-content">${content}</div>
    `, "media-viewer");
    backdrop.querySelector(".viewer-close").addEventListener("click", closeModal);
    backdrop.querySelector(".media-viewer").addEventListener("pointerdown", (event) => {
      if (event.target === event.currentTarget) closeModal();
    });
  }

  async uploadFiles(files, point, expectedType = null, connection = null) {
    const supported = files.filter((file) => {
      const type = fileType(file);
      return type && (!expectedType || type === expectedType);
    });
    const skipped = files.length - supported.length;
    if (skipped) toast(`${skipped} 个文件格式不受支持，已跳过`);
    if (!supported.length) return;
    this.pushHistorySnapshot(this.captureHistorySnapshot());

    const tasks = supported.map(async (file, index) => {
      const type = fileType(file);
      const dimensions = await mediaDimensions(file, type);
      const connectedX = connection?.direction === "output" ? point.x + 100
        : connection?.direction === "input" ? point.x - dimensions.width - 100
          : point.x;
      const x = connectedX + (index % 5) * 38;
      const y = point.y + Math.floor(index / 5) * 38 + (index % 5) * 10;
      return this.uploadOne(file, { x, y, ...dimensions }, null, connection);
    });
    const results = await Promise.allSettled(tasks);
    if (!results.some((result) => result.status === "fulfilled")) this.historyStack.pop();
  }

  uploadOne(file, placement, existingItem = null, connection = null) {
    if (serviceConfig.directUpload) return this.uploadCloudFile(file, placement, existingItem, connection);
    return new Promise((resolve, reject) => {
      const item = existingItem || this.createUploadItem(file);
      item.className = "upload-item";
      item.querySelector(".upload-caption").textContent = "上传中 0%";
      item.querySelector(".upload-status-icon").innerHTML = icons.upload;
      item.querySelector(".retry-upload")?.remove();
      item.querySelector(".upload-progress span").style.width = "0%";

      const form = new FormData();
      form.append("x", String(placement.x));
      form.append("y", String(placement.y));
      form.append("width", String(placement.width));
      form.append("height", String(placement.height));
      form.append("files", file, file.name);

      const request = new XMLHttpRequest();
      request.open("POST", `/api/projects/${this.project.id}/assets`);
      request.upload.addEventListener("progress", (event) => {
        if (!event.lengthComputable) return;
        const percent = Math.round((event.loaded / event.total) * 100);
        item.querySelector(".upload-caption").textContent = `上传中 ${percent}%`;
        item.querySelector(".upload-progress span").style.width = `${percent}%`;
      });
      request.addEventListener("load", async () => {
        if (request.status >= 200 && request.status < 300) {
          const nodes = JSON.parse(request.responseText);
          for (const node of nodes) {
            this.nodes.push(node);
            this.mountNode(node);
            if (connection) await this.connectCreatedNode(node, connection);
          }
          item.classList.add("success");
          item.querySelector(".upload-status-icon").innerHTML = icons.check;
          item.querySelector(".upload-caption").textContent = "上传成功";
          item.querySelector(".upload-progress span").style.width = "100%";
          setTimeout(() => item.remove(), 1600);
          resolve(nodes);
        } else {
          let message = "上传失败";
          try { message = JSON.parse(request.responseText).error || message; } catch {}
          this.markUploadFailed(item, file, placement, message, connection);
          reject(new Error(message));
        }
      });
      request.addEventListener("error", () => {
        this.markUploadFailed(item, file, placement, "网络中断，请重试", connection);
        reject(new Error("网络中断，请重试"));
      });
      request.send(form);
    });
  }

  async uploadCloudFile(file, placement, existingItem = null, connection = null) {
    const item = existingItem || this.createUploadItem(file);
    item.className = 'upload-item';
    item.querySelector('.retry-upload')?.remove();
    try {
      const node = await window.uploadToCloud(file, this.project.id, placement, percent => {
        item.querySelector('.upload-caption').textContent = `上传中 ${percent}%`;
        item.querySelector('.upload-progress span').style.width = `${percent}%`;
      });
      this.nodes.push(node); this.mountNode(node);
      if (connection) await this.connectCreatedNode(node, connection);
      item.classList.add('success'); item.querySelector('.upload-status-icon').innerHTML = icons.check;
      item.querySelector('.upload-caption').textContent = '已上传到云端';
      setTimeout(() => item.remove(), 1600); return [node];
    } catch (error) { this.markUploadFailed(item, file, placement, error.message, connection); throw error; }
  }

  createUploadItem(file) {
    const item = document.createElement("div");
    item.className = "upload-item";
    item.innerHTML = `
      <div class="upload-body">
        <div class="upload-status-icon">${icons.upload}</div>
        <div class="upload-meta"><div class="upload-name">${escapeHtml(file.name)}</div><div class="upload-caption">准备上传</div></div>
      </div>
      <div class="upload-progress"><span></span></div>
    `;
    this.uploadStack.append(item);
    return item;
  }

  markUploadFailed(item, file, placement, message, connection = null) {
    item.classList.add("failed");
    item.querySelector(".upload-status-icon").innerHTML = icons.alert;
    item.querySelector(".upload-caption").textContent = message;
    item.querySelector(".upload-progress span").style.width = "0%";
    const retry = document.createElement("button");
    retry.className = "retry-upload";
    retry.type = "button";
    retry.textContent = "重试";
    retry.addEventListener("click", () => {
      this.pushHistorySnapshot(this.captureHistorySnapshot());
      this.uploadOne(file, placement, item, connection).catch(() => this.historyStack.pop());
    }, { once: true });
    item.querySelector(".upload-body").append(retry);
  }
}

function mediaDimensions(file, type) {
  if (type === "audio") return Promise.resolve({ width: 360, height: 104 });
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const media = type === "image" ? new Image() : document.createElement("video");
    const done = (width = 320, height = 220) => {
      URL.revokeObjectURL(url);
      const ratio = width > 0 && height > 0 ? width / height : 16 / 10;
      const maxWidth = type === "video" ? 360 : 320;
      const maxHeight = 320;
      let displayWidth = maxWidth;
      let displayHeight = displayWidth / ratio;
      if (displayHeight > maxHeight) {
        displayHeight = maxHeight;
        displayWidth = displayHeight * ratio;
      }
      if (displayWidth < 120) {
        displayWidth = 120;
        displayHeight = displayWidth / ratio;
      }
      if (displayHeight < 100) {
        displayHeight = 100;
        displayWidth = displayHeight * ratio;
      }
      resolve({ width: Math.round(displayWidth), height: Math.round(displayHeight) });
    };
    const timer = setTimeout(() => done(), 3000);
    if (type === "image") {
      media.onload = () => { clearTimeout(timer); done(media.naturalWidth, media.naturalHeight); };
      media.onerror = () => { clearTimeout(timer); done(); };
    } else {
      media.preload = "metadata";
      media.onloadedmetadata = () => { clearTimeout(timer); done(media.videoWidth, media.videoHeight); };
      media.onerror = () => { clearTimeout(timer); done(16, 10); };
    }
    media.src = url;
  });
}

filePicker.addEventListener("change", () => {
  const context = pickerContext;
  const files = [...filePicker.files];
  if (context && files.length && activeCanvas === context.canvas) {
    if (context.kind === "video-reference") context.canvas.uploadReferences(context.node, files);
    else context.canvas.uploadFiles(files, context.point, context.type, context.connection || null);
  }
  filePicker.value = "";
});

async function renderCanvas(projectId) {
  activeCanvas?.destroy();
  activeCanvas = null;
  closeModal();
  app.innerHTML = '<div class="loading-screen"><div><span class="loading-dot"></span>正在打开 Canvas</div></div>';
  try {
    const project = await api(`/api/projects/${projectId}`);
    activeCanvas = new MaterialCanvas(project);
  } catch (error) {
    toast(error.message);
    history.replaceState({}, "", "/");
    renderWorkspace();
  }
}

function route() {
  const match = location.pathname.match(/^\/canvas\/([^/]+)\/?$/);
  if (match) renderCanvas(decodeURIComponent(match[1]));
  else renderWorkspace();
}

window.addEventListener("popstate", route);
let serviceConfig = {};
api("/api/config").then((config) => { serviceConfig = config; route(); }).catch((error) => { toast(error.message); route(); });
