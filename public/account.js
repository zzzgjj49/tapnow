const content = document.querySelector('#content');
const notice = document.querySelector('#notice');
const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
let me, report;
async function api(url, body, method = body ? 'POST' : 'GET') {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await r.json(); if (!r.ok) throw new Error(data.error || '请求失败'); return data;
}
function handle(form, fn) { form.addEventListener('submit', async e => { e.preventDefault(); notice.textContent = ''; const button = e.submitter; button.disabled = true; try { await fn(new FormData(form)); } catch(e) { notice.textContent = e.message; } finally { button.disabled = false; } }); }
function login(token) {
  content.innerHTML = `<section class="login"><h1>${token ? '加入朋友的画板' : '登录画板'}</h1><p>${token ? '设置你的名字和密码。项目由受邀成员共同使用，用量记在各自账号下。' : '仅限受邀成员使用，没有账号请联系管理员。'}</p><form><label>${token ? '你的名字' : '邮箱'}<input name="identity" type="${token ? 'text' : 'email'}" required autocomplete="${token ? 'name' : 'username'}"></label><label>密码<input name="password" type="password" required ${token ? 'minlength="12"' : ''} maxlength="128" autocomplete="${token ? 'new-password' : 'current-password'}"></label><button class="primary">${token ? '接受邀请' : '登录'}</button></form></section>`;
  handle(content.querySelector('form'), async data => {
    await api(token ? '/api/auth/accept' : '/api/auth/login', token ? { token, name: data.get('identity'), password: data.get('password') } : { email: data.get('identity'), password: data.get('password') });
    location.replace('/');
  });
}
let selectedMember = null, usageVersion = 0;
function settings() {
  document.querySelector('#logout').hidden = false;
  content.innerHTML = '<h1>账号设置</h1><p>' + esc(me.name) + ' · ' + esc(me.email) + '</p><section><h2>修改我的密码</h2><form id="password"><label>原密码<input type="password" name="old" required autocomplete="current-password"></label><label>新密码（至少 12 位）<input type="password" name="password" required minlength="12" maxlength="128" autocomplete="new-password"></label><button>保存密码</button></form></section><a href="/account.html">返回管理中心</a>';
  handle(document.querySelector('#password'), async data => {
    await api('/api/auth/password', { currentPassword:data.get('old'), password:data.get('password') });
    notice.textContent = '你的密码已更新，其他设备已退出登录';
    document.querySelector('#password').reset();
  });
}
async function dashboard() {
  document.querySelector('#logout').hidden = false;
  content.innerHTML = '<h1>' + (me.role === 'admin' ? '管理中心' : '我的生成用量') + '</h1><p>' + (me.role === 'admin' ? '成员加入后自动显示在用量列表，每 30 秒更新一次。' : '查看自己发起的生成任务。') + '</p><section><h2>生成用量</h2><div class="toolbar"><label>月份<input id="month" type="month" value="' + new Date().toISOString().slice(0,7) + '"></label><button id="refresh">刷新</button><button id="export">导出任务明细 CSV</button></div><div id="usage"></div></section>' + (me.role === 'admin' ? '<section id="members"></section>' : '');
  document.querySelector('#refresh').onclick = () => loadUsage().catch(e => notice.textContent = e.message);
  document.querySelector('#month').onchange = document.querySelector('#refresh').onclick;
  document.querySelector('#export').onclick = exportCsv;
  await loadUsage(); if (me.role === 'admin') await loadMembers();
}
const tokens = r => r.tokens ?? 0;
const stateNames = { queued:'待提交', submitting:'提交中', generating:'生成中', archiving:'云端归档中', complete:'已完成', failed:'失败', unknown:'提交结果待核对', archive_failed:'归档暂停', poll_failed:'查询暂停' };
async function loadUsage() {
  const month = document.querySelector('#month')?.value;
  if (!month) return;
  const version = ++usageVersion;
  const result = await api('/api/usage?month=' + encodeURIComponent(month));
  if (version !== usageVersion || !document.querySelector('#usage')) return;
  report = result;
  renderUsage();
}
function filteredRecords() {
  return selectedMember === null ? report.records : report.records.filter(r => String(r.userId ?? '') === selectedMember);
}
function renderUsage() {
  const previousOpen = document.querySelector('#task-details')?.open;
  const total = report.totals;
  const rows = report.members;
  const selected = rows.find(u => String(u.userId ?? '') === selectedMember);
  if (selectedMember !== null && !selected) selectedMember = null;
  const records = filteredRecords();
  const memberTable = me.role === 'admin' ? '<h3>每位成员的用量</h3><div class="scroll"><table id="member-usage"><thead><tr><th>成员</th><th>生成任务</th><th>已完成</th><th>进行中</th><th>失败 / 待处理</th><th>已返回 Token</th><th>用量待返回</th><th>操作</th></tr></thead><tbody>' + rows.map(u => '<tr data-member-row="' + esc(u.userId ?? '') + '"><td><strong>' + esc(u.name) + '</strong><small>' + esc(u.email) + (u.disabled ? ' · 已停用' : '') + '</small></td><td>' + u.tasks + '</td><td>' + u.completed + '</td><td>' + u.active + '</td><td>' + (u.failed + u.unresolved) + '</td><td>' + u.tokens.toLocaleString() + '</td><td>' + u.unreported + '</td><td><button data-usage-member="' + esc(u.userId ?? '') + '">查看明细</button></td></tr>').join('') + '</tbody></table></div>' : '';
  document.querySelector('#usage').innerHTML = '<div class="stats"><div><strong>' + total.tasks + '</strong>生成任务</div><div><strong>' + total.completed + '</strong>已完成</div><div><strong>' + total.tokens.toLocaleString() + '</strong>已返回 Token</div><div><strong>' + total.unreported + '</strong>用量待返回</div></div><p>按发起账号统计，月份按 UTC 划分。Token 为服务商返回的用量，费用在字节后台查看。</p>' + memberTable + '<details id="task-details"' + (previousOpen || selectedMember !== null || me.role !== 'admin' ? ' open' : '') + '><summary>' + (selected ? esc(selected.name) + '的任务明细' : '全部任务明细') + '（' + records.length + '）</summary>' + (selectedMember !== null ? '<button id="clear-member">查看全部成员</button>' : '') + '<div class="scroll"><table><thead><tr><th>成员</th><th>时间 UTC</th><th>模型</th><th>状态</th><th>Token</th></tr></thead><tbody>' + records.map(r => '<tr><td>' + esc(r.userName) + '</td><td>' + esc(r.createdAt.slice(0,19).replace('T',' ')) + '</td><td>' + esc(r.model) + '</td><td>' + esc(stateNames[r.status] || r.status) + '</td><td>' + (r.tokens === null ? '待返回' : tokens(r).toLocaleString()) + '</td></tr>').join('') + (records.length ? '' : '<tr><td colspan="5">本月还没有生成任务</td></tr>') + '</tbody></table></div></details>';
  document.querySelectorAll('[data-usage-member]').forEach(button => button.onclick = () => {
    selectedMember = button.dataset.usageMember; renderUsage();
    document.querySelector('#task-details').scrollIntoView({block:'nearest',behavior:'smooth'});
  });
  const clear = document.querySelector('#clear-member');
  if (clear) clear.onclick = () => { selectedMember = null; renderUsage(); };
}
function exportCsv() {
  if (!report) return;
  const rows = [['任务编号','成员','时间UTC','模型','状态','请求时长秒','清晰度','视频参考','Token','服务商任务编号'], ...filteredRecords().map(r => [r.id,r.userName,r.createdAt,r.model,r.status,r.requestedSeconds,r.resolution,r.hasVideoInput ? '是':'否',r.tokens === null ? '' : tokens(r),r.jobId || ''])];
  const cell = value => { let s = String(value ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replaceAll('"','""') + '"'; };
  const url = URL.createObjectURL(new Blob(['\ufeff' + rows.map(row => row.map(cell).join(',')).join('\r\n')], { type:'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = 'canvas-usage-' + report.month + '.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
setInterval(() => { if (!document.hidden && document.querySelector('#usage')) loadUsage().catch(e => notice.textContent = e.message); }, 30000);
window.addEventListener('focus', () => { if (document.querySelector('#usage')) loadUsage().catch(e => notice.textContent = e.message); });
async function loadMembers() {
  const data = await api('/api/members');
  document.querySelector('#members').innerHTML = `<h2>邀请与成员</h2><p>邀请链接只显示一次，7 天内有效且只能使用一次。复制后由你发给朋友。</p><form><label>朋友的邮箱<input name="email" type="email" required></label><button>创建邀请链接</button></form><div id="invite-result"></div>${data.users.map(u => `<div class="member"><span>${esc(u.name)} · ${esc(u.email)} ${u.role === 'admin' ? '（管理员）' : u.disabled ? '（已停用）' : ''}</span>${u.role !== 'admin' ? `<button data-user="${esc(u.id)}" data-disabled="${u.disabled}">${u.disabled ? '恢复使用' : '停用账号'}</button>` : ''}</div>`).join('')}${data.invites.map(i => `<div class="member"><span>${esc(i.email)} · 待接受邀请</span><button data-invite="${esc(i.id)}">撤销邀请</button></div>`).join('')}`;
  handle(document.querySelector('#members form'), async fields => {
    const result = await api('/api/members/invites', { email: fields.get('email') });
    const url = location.origin + result.path;
    document.querySelector('#invite-result').innerHTML = `<label>复制这个链接发给 ${esc(result.email)}<input readonly value="${esc(url)}"></label><button id="copy-invite">复制链接</button>`;
    document.querySelector('#copy-invite').onclick = async () => { try { await navigator.clipboard.writeText(url); notice.textContent = '邀请链接已复制'; } catch { notice.textContent = '请选中链接后复制'; } };
  });
  document.querySelectorAll('[data-user]').forEach(b => b.onclick = async () => { try { await api('/api/members/' + b.dataset.user, { disabled: b.dataset.disabled !== 'true' }, 'PATCH'); await loadMembers(); } catch(e) { notice.textContent = e.message; } });
  document.querySelectorAll('[data-invite]').forEach(b => b.onclick = async () => { try { await api('/api/members/invites/' + b.dataset.invite, null, 'DELETE'); await loadMembers(); } catch(e) { notice.textContent = e.message; } });
}
document.querySelector('#logout').onclick = async () => { await api('/api/auth/logout', {}); location.replace('/account.html'); };
function showInvitation() {
  const token = new URLSearchParams(location.hash.slice(1)).get('invite');
  if (!token) return false;
  history.replaceState(null, '', '/account.html'); login(token); return true;
}
window.addEventListener('hashchange', showInvitation);
(async () => {
  if (showInvitation()) return;
  try { const result = await api('/api/auth/me'); if (!result.enabled) { content.innerHTML = '<section><h1>成员与邀请</h1><p>当前尚未启用账号登录，暂时无法创建邀请。</p><p>配置管理员账号并启用登录后，管理员可以在这里填写朋友的邮箱、创建邀请链接，再复制发给朋友。</p><p>朋友从其他电脑使用，还需要一个他们能访问的网站地址；localhost 只能在当前电脑打开。</p><a href="/">返回画板</a></section>'; return; } me = result.user; document.querySelector("#settings-link").hidden = false; if (new URLSearchParams(location.search).get("view") === "settings") settings(); else await dashboard(); }
  catch(e) { login(); if (e.message !== '请先登录') notice.textContent = e.message; }
})();
