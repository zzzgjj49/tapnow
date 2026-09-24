# 素材 Canvas

一个面向小团队的内部 Canvas 制作平台。当前包含项目管理、文字与媒体节点、视频制作节点，以及可自由连接的节点工作流。

## Vercel 私人共享版本

已添加邀请登录、成员停用、每位成员的生成用量汇总和 CSV 明细导出。新成员接受邀请后自动出现在管理员的用量表中，零用量成员同样展示；成员只能查看自己的用量，并在账号设置中修改自己的密码。费用直接在字节后台查看。云端模式支持使用私有 TOS 保存账号、项目和任务，也兼容 PostgreSQL，浏览器分片直传私有 TOS，QStash 负责关闭页面后的查询与归档。项目分为个人项目和团队项目：启用账号后，个人项目及其素材仅创建者可访问（管理员也无法查看其他人的个人项目），团队项目由受邀成员共同编辑。首页分类决定新建项目类型，项目菜单可修改分类；只有创建者可修改分类，无创建者的旧项目由管理员管理。旧项目默认归入团队项目。分类保存在云端，刷新或重新部署后保留；目前没有实时多人光标或编辑冲突合并。

配置 `STATE_STORAGE=tos` 后使用现有 TOS 启用云端模式并强制登录，无需新增数据库。已有项目用 `node scripts/migrate-cloud.js --tos` 迁移；也可配置 `DATABASE_URL` 使用 PostgreSQL。两种云存储都未配置时使用本地模式。具体步骤见 [Vercel 部署说明](docs/vercel-deployment.md)。存储、队列与正式域名需在服务控制台配置，代码和本地测试完成不等于已经上线。

## 启动

使用 Node.js 22。

```bash
npm install
npm start
```

浏览器打开 `http://localhost:3000`。服务默认监听 `0.0.0.0:3000`，同一局域网内可通过运行机器的 IP 访问。

开发时可使用：

```bash
npm run dev
```

## 使用方式

- 在工作空间新建、打开、重命名或删除项目。
- 在 Canvas 空白处双击，可创建文字制作、图片制作、视频制作节点，或上传音频。文字和图片菜单直接打开制作节点；图片、视频和音频文件仍可拖入画布上传。
- 文字制作支持提示词、模型、风格和篇幅；图片制作支持提示词、模型、比例和尺寸。两者都支持参考图片、上游引用和生成结果展示。已有文字便签和上传素材保持原有功能。
- 文字、图片、视频、音频和视频制作节点左右两侧都有连接端口；可从右侧向下游连，也可从左侧反向寻找上游。
- 把连线拖到已有节点即可建立引用关系；拖到空白处会弹出节点菜单，创建完成后自动连接。
- 视频制作节点支持提示词、参考首尾帧、模型、生成模式、生成方式、比例、清晰度、时长、音频、多镜头和生成数量配置。
- 视频参数随模型切换。Seedance 2.0 Fast 提供 480p/720p，2.0 提供至 4K，2.5 提供自适应比例、视频编辑和最长 30 秒；这些是按参考截图整理的界面预设，真实可用参数待接入服务确认。
- 全能参考支持图片、视频、音频；素材库按钮会连接并选中画布中的参考节点，+ 按当前生成方式上传素材。首尾帧按添加顺序使用图片，视频编辑要求一个参考视频。
- 1×/2×/4× 会提交对应数量的独立任务；结果区可切换输出并下载。选中的结果会用于后续节点引用。
- 任务每 3 秒查询一次，刷新页面后会继续查询；查询失败保留任务编号，生成失败可重新提交。
- 麦克风按钮调用浏览器语音识别，把识别文字填入提示词，再次点击停止。需浏览器支持、麦克风权限和可用的语音识别服务。
- 连接后点击引用卡片或使用 `@` 选择输入。已选上游文字会与制作节点自身的提示词一起发送给生成服务；已选上游图片、视频和音频会作为媒体参考。
- 点击连线可查看关系并删除；重复连线、节点自连和形成循环的连线会被拦截，删除节点时相关连线会自动清理。
- 也可以直接把素材拖入 Canvas，松开位置就是节点创建位置。
- 按住鼠标右键拖动可平移画布（在空白处或节点上均可），左键拖动空白处框选节点；也可按住 Space 加左键或使用中键平移。滚轮以鼠标位置为中心缩放。
- 点击节点后显示轻量的查看、删除操作；拖动节点可改变位置，图片和视频可等比例调整大小。
- 双击节点打开大图、视频播放器或音频播放器。

## 数据与备份

运行后会自动创建 `data/`：

- `data/canvas-data.json` 保存项目、节点和画布状态。
- `data/uploads/` 保存原始素材及已归档的生成结果。
- `data/cloud-storage.json` 保存云端文件索引，播放时生成临时签名地址。

备份时完整复制 `data/` 即可。元数据写入使用同目录临时文件替换，避免写到一半留下损坏的 JSON。

默认单文件上限为 1 GB，可通过 `MAX_FILE_SIZE` 环境变量（字节）调整。可通过 `PORT`、`HOST` 和 `DATA_DIR` 调整端口、监听地址及数据目录。

MOV、M4A 等文件会保留原格式；能否在页面内直接播放取决于使用者浏览器和系统内置的编解码器。MP4（H.264/AAC）、WebM、MP3 通常具有更好的跨浏览器兼容性。

### BytePlus TOS 云端存储

在服务端 `.env` 填写 `TOS_BUCKET`、`TOS_REGION`、`TOS_ENDPOINT`、`TOS_ACCESS_KEY`、`TOS_SECRET_KEY`，重启后自动启用。当前使用香港区域 `cn-hongkong`，Endpoint 为 `https://tos-cn-hongkong.bytepluses.com`，桶为 `ai-video-team-prod`。IAM 权限示例见 [存储权限策略](docs/tos-upload-policy.json)。密钥只由服务端读取。

上传的图片、视频、音频、参考素材，以及生成完成的结果会自动保存到桶内 `canvas/uploads/`。服务启动时补存已有文件，并每 15 秒检查素材及生成任务；浏览器关闭后，服务仍可查询任务并归档结果。超过 20 MB 的文件使用分片上传。生成结果先下载到本地再上传，避免依赖服务商的临时结果链接。已经过期且没有本地副本的结果无法自动恢复，会显示保存错误。

桶保持私有；页面优先读取本地副本，本地副本缺失时用临时签名地址播放，下载由服务端转发。模型参考素材也使用临时签名地址，因此启用 TOS 后无需用 `PUBLIC_BASE_URL` 暴露本机视频。上传失败会保留本地文件，画板顶部显示错误并可点击重试；后台也会自动重试。

云存储保存的是文件，**项目、提示词、连线、布局和云端索引仍在本机 `data/` 中，仍需完整备份该目录**。删除画板节点或项目不会删除桶内的文件；云端清理由桶管理员处理。`TOS_STORAGE_ENABLED=0` 可停用自动云存储。

## 接入视频生成服务

### BytePlus ModelArk 原生接口

在项目根目录创建 `.env`（参考 `.env.example`），填写 `VIDEO_GENERATION_PROVIDER=byteplus`、`ARK_API_KEY` 后运行 `npm start`。服务启动时自动读取此文件；环境变量优先，Key 只在服务端使用。

适配器 `byteplus.js` 对接新加坡区域 `/api/v3/contents/generations/tasks`，支持截图提供的 Seedance 2.0、Fast、Mini 三个模型 ID。启用后模型菜单仅显示这三个模型，默认使用 Fast。若配置 `ARK_SEEDANCE_20_FAST_ENDPOINT_ID=ep-...`，Fast 请求会优先使用该自定义推理接入点；未配置时回退官方模型 ID。没有填充其他模型的替代映射。

支持提示词、首尾帧、全能参考、比例、清晰度、4–15 秒时长、音频开关和 1/2/4 个独立任务；处理原生任务编号、排队/运行/成功/失败/过期状态及结果 URL，保存服务商返回的 usage。真实费用由 BytePlus 结算，接入后不显示截图积分估算。

启用 TOS 后，本地图片、音频、视频参考先存入私有桶，再通过临时签名地址交给模型。未启用 TOS 时，图片、音频由服务端以 Base64 发送；本地视频参考需要配置可从公网访问本站 `/uploads/` 的 `PUBLIC_BASE_URL`，localhost 或内网地址不可用。素材数量和角色在提交前校验，云端参考的格式、大小、时长和画面尺寸由模型服务进一步校验。

接口文档：[创建任务](https://docs.byteplus.com/en/docs/ModelArk/1520757)、[查询任务](https://docs.byteplus.com/en/docs/ModelArk/1521309)。图像和文字生成仍需单独配置对应模型服务。

### 通用生成网关

使用通用网关时设置 `VIDEO_GENERATION_PROVIDER=gateway`。

界面和制作参数可在没有模型服务时独立使用、保存。实际生成需要设置：

```bash
VIDEO_GENERATION_API_URL=https://your-generation-gateway.example/jobs
VIDEO_GENERATION_API_KEY=your-key
npm start
```

服务端会向该地址发送 JSON，包含 `projectId`、`nodeId`、合并后的 `prompt`、`model`、`settings`、上游节点摘要 `inputs` 和本机媒体路径 `references`。生成网关应返回：

```json
{
  "jobId": "job-123",
  "status": "generating",
  "outputUrl": null
}
```

如果网关同步返回成品，可把 `status` 设置为 `complete` 并提供浏览器可播放的 `outputUrl`。未配置生成服务时，生成按钮会给出明确提示，不会伪造生成结果。

## 文字与图片生成

文字和图片生成分别使用 `TEXT_GENERATION_API_URL` / `TEXT_GENERATION_API_KEY`、`IMAGE_GENERATION_API_URL` / `IMAGE_GENERATION_API_KEY`，请求格式与视频网关一致，另有 `type` 字段区分 `text`、`image`、`video`。默认模型名称为 `default`，可在节点中填写网关支持的模型名称。

文字网关同步返回 `{ "outputText": "生成的文字", "status": "complete" }`；图片网关同步返回 `{ "outputUrl": "https://example.com/result.png", "status": "complete" }`。文字设置包含 `style`、`length`，图片设置包含 `ratio`、`resolution`。生成的文字可继续作为下游提示词输入，生成的图片可通过 URL 作为下游媒体参考。未配置对应服务时会提示配置缺失。

## 任务查询与接入边界

异步网关返回 `jobId` 后，服务端默认使用 `GET <生成地址>/<jobId>` 查询。可通过 `VIDEO_GENERATION_STATUS_URL`、`IMAGE_GENERATION_STATUS_URL`、`TEXT_GENERATION_STATUS_URL` 设置包含 `{jobId}` 的查询地址模板。查询响应与提交响应使用同一结构，最终返回 `status: "complete"` 和结果，失败返回 `status: "failed"`、`error`。

每个批量子任务的 `settings.count` 为 1，附带 `requestId`、`batchIndex`、`batchCount`。启用 TOS 时，参考素材传递临时签名 URL。未启用时默认传递本机文件路径；配置 `PUBLIC_BASE_URL` 后还会提供公开素材 URL。远程服务必须能够访问这些素材，或由适配层上传文件。

`generation.js` 是统一任务流程，BytePlus 原生请求/响应转换位于 `byteplus.js`。通用网关和 BytePlus 使用不同协议，通过 `VIDEO_GENERATION_PROVIDER` 选择。

按钮上的 `≈` 数字按截图中可推算的费率计算总积分（时长 × 数量 × 参考费率），不是实际计费。缺少参考费率的组合显示“生成”。模型预设与估算统一位于 `public/video-models.js`。

详细行为与验收记录见 [制作功能说明](docs/production-workflow.md)。

## 验证

```bash
npm test
```

测试启动隔离服务和本地测试网关，覆盖项目/素材、模型参数、引用传递、异步批量生成、查询恢复、失败重试、结果切换和下载。测试网关仅在测试中启动，不会给用户项目伪造生成结果。

云端回归使用本地 PostgreSQL 引擎和模拟 TOS，验证数据库并发保存、邀请单次使用、私有素材鉴权、分片校验、任务恢复、费用记录归属、改密与停用后的会话失效。`node scripts/browser_cloud_smoke.js` 验证浏览器中的邀请流程、9 MB 直传和个人用量页面。

Windows 上可运行 `node scripts/browser_production_smoke.js` 进行 Edge 无界面浏览器验收，截图保存在 `.run/`。此脚本需要 Node.js 22 和 Edge；可用 `BROWSER_PATH` 指定浏览器路径。语音识别回调使用模拟输入验证，未验证真实麦克风识别服务。`scripts/browser_byteplus_smoke.js` 可对已有真实生成任务验证播放和下载，不提交新任务。

`node scripts/verify-cloud-storage.js` 从实际私有桶读取已有文件，与本地进行 SHA-256 校验。加 `--multipart` 会以同一内容分片重传已有大文件；加 `--fallback` 会临时移开已有验收视频的本地副本，验证云端播放、下载后恢复文件。后者依赖 `.run/byteplus-live.json` 中的验收节点和正在运行的 3000 端口服务。
