# 给几位朋友使用的 Vercel 部署

程序包含两种运行方式：未设置 DATABASE_URL 时继续使用原有本地项目文件；设置后使用 PostgreSQL 保存共享工作空间、账号、会话、上传索引、生成任务和用量。云端模式必须登录，没有公开注册入口。所有受邀成员共用项目；每个人看到自己的生成明细，管理员可以看到全体明细。删除项目不会删除云端媒体或历史用量。

## 需要准备的服务

1. Vercel 项目：运行网站与短请求接口。Hobby 适用于个人非商业用途，使用量受免费额度限制。
2. Neon Postgres：保存项目、提示词、连线和账号。在 Vercel Storage 中选择 Neon，创建后连接到此项目，获得 DATABASE_URL。不需要手动创建数据表，程序首次请求会初始化。
3. 已有 BytePlus TOS：保存图片、音频、视频，继续使用香港私有桶。
4. Upstash QStash：后台任务投递。它会定时唤醒网站检查生成进度、归档成品，不需要本地电脑开机。它与模型服务无关，有独立的额度和计费规则；在其控制台复制 Token、Current Signing Key、Next Signing Key 到 Vercel 环境变量。没有配置时，云端生成明确拒绝提交，不会假装后台持续运行。

## 部署步骤

1. 将代码上传到自己的私有 Git 仓库，在 Vercel 导入为 Express 项目，或使用 Vercel CLI 创建项目。不要上传 `.env`、`data/`、`.run/`。仓库中的 `.gitignore` 和 `.vercelignore` 已排除这些目录。
2. 在 Vercel 为项目添加 Neon 数据库连接，使用带连接池的 DATABASE_URL。数据库连接应使用服务商要求的 TLS 配置。部署区域尽量接近数据库，不要假定不同云厂商的香港资源能走内网。
3. 在 Vercel Settings → Environment Variables 填入 `.env.example` 所列云端配置。APP_URL 是固定的正式访问域名，例如 `https://your-canvas.vercel.app`，不要填写临时预览地址，末尾不带 `/`。
4. 设置 ADMIN_EMAIL 和至少 12 位的 ADMIN_PASSWORD。首次启动创建管理员；已有管理员的密码不会因重新部署而重置。后续在账号页修改密码。
5. 配置 QStash 三个变量。QStash 要访问 `/api/internal/jobs`；如果 Vercel 启用了部署保护，必须允许已验证的队列请求到达应用。应用会校验 QStash 签名，不接受普通用户调用此接口。生成请求通常在一分钟内开始处理，后台每次最多处理 4 个阶段；页面轮询只读取进度。
6. 在 TOS 桶的“跨域访问”添加规则：允许来源为准确的 APP_URL；允许方法 PUT、GET、HEAD；允许请求头 `*`；可暴露响应头 ETag、Content-Length、Content-Type；缓存时间 3600。生产站点与本地测试站点需分别加入准确来源，保持桶私有。服务器 AK/SK 不会交给浏览器，浏览器只获得指定文件、指定分片的临时签名链接。
7. 重新部署。Node.js 使用 22；应用入口为 server.js。无需购买 GPU 或把视频文件放到 Vercel。
8. 本机 `.env` 填入 DATABASE_URL 后运行 `node scripts/migrate-cloud.js`，将已有项目与云端索引复制过去。迁移会检查素材已备份、没有运行中的生成任务，且目标没有项目，避免覆盖。原始文件保留。迁移前后可完整备份本机 data 目录。
9. 打开网站登录管理员，在“成员与用量”生成邀请链接，手动发给朋友。朋友设置自己的密码后进入共享画板。邀请 7 天有效、单次使用；管理员可撤销邀请、停用成员。

## 费用与任务记录

每个批量结果都是一条独立用量记录，包含发起成员、模型、请求时长、参考视频标记、服务商任务号、返回的原始 usage。没有 usage 的记录显示待核对，不当作免费。新一轮生成或删除节点不会抹掉账目；迁移前无成员归属的历史任务不自动算到任何人头上。

月份按 UTC 统计。管理员可填写已核对的月度 USD 实际账单，选择参与成员后平分，余下的美分依次分配，总额保持一致。系统不根据 Token 自动推算金额、不代扣款。明细支持 CSV 导出。

后台先保存任务和后续唤醒消息，再向模型提交。遇到提交中断且没有取得任务号时标记“结果待核对”，不会自动重发可能收费的 POST。需要先在服务商控制台检查，再决定是否重新生成。已有任务的查询与归档可重试，关闭浏览器不影响队列继续工作。后台查询、媒体归档连续失败 20 次后暂停，避免无限消耗队列额度；恢复服务后点击云端状态按钮重试。队列额度耗尽时也需要恢复队列后重试。TOS 临时链接到期后且尚未归档的结果仍可能无法恢复。

## 验收

运行 `node scripts/check-deploy.js` 仅显示配置是否存在，不输出密钥。

正式部署后必须验证：未登录无法访问 API/媒体；邀请一次性有效；两名成员各自生成后记录归属正确；大于 4.5 MB 的文件直传成功；关闭页面后后台仍更新状态；重新部署后项目仍在；私有媒体可播放、下载；成员停用后旧会话失效。

本地自动化使用隔离 PostgreSQL 引擎、模拟 TOS 和模型服务，不能替代真实 Neon、QStash、TOS CORS 及 Vercel 平台的联调。部署前完成上述真实验收，不把仅通过本地测试称为已经上线。

参考：[Vercel Express](https://vercel.com/docs/frameworks/backend/express)、[函数限制](https://vercel.com/docs/functions/limitations)、[Neon 集成](https://vercel.com/integrations/neon)、[QStash 入门](https://upstash.com/docs/qstash/overall/getstarted)。
