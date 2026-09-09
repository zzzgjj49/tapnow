const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
if (fs.existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));
const keys = ['DATABASE_URL','APP_URL','ADMIN_EMAIL','ADMIN_PASSWORD','TOS_BUCKET','TOS_REGION','TOS_ENDPOINT','TOS_ACCESS_KEY','TOS_SECRET_KEY','ARK_API_KEY','QSTASH_TOKEN','QSTASH_CURRENT_SIGNING_KEY','QSTASH_NEXT_SIGNING_KEY'];
let missing = false;
for (const key of keys) { const present = Boolean(process.env[key]?.trim()); console.log(`${key}: ${present ? '已配置' : '待配置'}`); missing ||= !present; }
if (process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.length < 12) { console.log('管理员密码至少需要 12 位'); missing = true; }
if (process.env.APP_URL && !/^https:\/\/[^/]+$/.test(process.env.APP_URL)) { console.log('APP_URL 应为完整 HTTPS 域名且末尾不带斜杠'); missing = true; }
console.log('还需在 TOS 设置精确站点域名的 CORS（PUT/GET/HEAD），并完成真实部署验收。');
process.exitCode = missing ? 1 : 0;
