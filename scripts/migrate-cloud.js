// Run locally after configuring DATABASE_URL. Copies metadata, never prints credentials.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
process.loadEnvFile(path.join(root, '.env'));
async function main() {
  const tos = process.argv.includes('--tos') || process.env.STATE_STORAGE === 'tos';
  if (!tos && !process.env.DATABASE_URL) throw new Error('请配置云数据库，或使用 --tos 迁移到现有 TOS');
  const local = JSON.parse(fs.readFileSync(path.join(root, 'data/canvas-data.json'), 'utf8'));
  const records = JSON.parse(fs.readFileSync(path.join(root, 'data/cloud-storage.json'), 'utf8'));
  const urls = new Set();
  for (const node of local.nodes) {
    if (node.storedName) urls.add(`/uploads/${encodeURIComponent(node.projectId)}/${encodeURIComponent(node.storedName)}`);
    for (const r of node.generation?.references || []) urls.add(`/uploads/${encodeURIComponent(node.projectId)}/${encodeURIComponent(r.storedName)}`);
    for (const output of node.generation?.outputs || []) if (output.url) urls.add(output.url);
    if (node.generation?.status === 'generating') throw new Error('仍有生成中的任务，请完成后再迁移');
  }
  const endpoint = new URL(process.env.TOS_ENDPOINT).host;
  if ([...urls].some(url => !url.startsWith('/uploads/') || records[url]?.status !== 'ready' || records[url].bucket !== process.env.TOS_BUCKET || records[url].endpoint !== endpoint)) throw new Error('还有素材没有归档到目标桶，请先在本地完成云端备份');
  const store = require('../state-store')({ databaseUrl: process.env.DATABASE_URL, tos });
  try {
    await store.transaction(() => {
      if (store.state.projects.length || store.state.nodes.length) throw new Error('目标云端存储已有项目，已停止迁移以避免覆盖');
      store.state.projects = local.projects; store.state.nodes = local.nodes; store.state.edges = local.edges;
      store.state.cloudRecords = records;
      // Historic jobs have no verified member attribution and are not added to personal bills.
      store.save();
    });
    console.log(`迁移完成：${local.projects.length} 个项目，${local.nodes.length} 个节点，${urls.size} 份素材。原始本地数据保留。`);
  } finally { await store.close(); }
}
main().catch(e => { console.error(e.code || (String(e.message).includes('://') ? '迁移失败，请检查连接配置' : e.message)); process.exitCode = 1; });
