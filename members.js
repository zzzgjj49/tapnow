const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const publicUser = u => ({ id: u.id, email: u.email, name: u.name, role: u.role, disabled: !!u.disabled });
async function passwordHash(password, salt = crypto.randomBytes(16).toString('hex')) {
  return salt + ':' + (await scrypt(password, salt, 64)).toString('hex');
}
async function checkPassword(password, hash) {
  const candidate = await passwordHash(password, hash.split(':')[0]);
  return candidate.length === hash.length && crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(hash));
}
module.exports = function members({ app, db, save, enabled }) {
  const email = value => String(value || '').trim().toLowerCase().slice(0, 160);
  const validPassword = value => typeof value === 'string' && value.length >= 12 && value.length <= 128;
  const secure = Boolean(process.env.VERCEL || process.env.APP_URL?.startsWith('https://'));
  const cookie = (response, token, maxAge = 30 * 86400) => response.setHeader('Set-Cookie', `canvas_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`);
  async function bootstrap() {
    if (db.users.length) return;
    const adminEmail = email(process.env.ADMIN_EMAIL);
    if (!adminEmail || !validPassword(process.env.ADMIN_PASSWORD)) throw new Error('请配置管理员邮箱和至少 12 位的 ADMIN_PASSWORD');
    db.users.push({ id: crypto.randomUUID(), email: adminEmail, name: '管理员', role: 'admin', passwordHash: await passwordHash(process.env.ADMIN_PASSWORD), createdAt: new Date().toISOString() });
    save();
  }
  app.use(async (req, res, next) => {
    if (!enabled || (!req.path.startsWith('/api/') && !req.path.startsWith('/uploads/'))) return next();
    if (req.path === '/api/health' || req.path === '/api/internal/jobs') return next();
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.get('origin');
      const expected = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
      if ((origin && origin !== new URL(expected).origin) || req.get('sec-fetch-site') === 'cross-site') return res.status(403).json({ error: '不允许跨站操作' });
    }
    try { await bootstrap(); } catch (e) { return res.status(503).json({ error: e.message }); }
    const token = /(?:^|;\s*)canvas_session=([^;]+)/.exec(req.get('cookie') || '')?.[1];
    const session = token && db.sessions.find(s => s.hash === digest(token) && s.expires > Date.now());
    req.user = session && db.users.find(u => u.id === session.userId && !u.disabled);
    if (['/api/auth/login', '/api/auth/accept'].includes(req.path)) return next();
    if (!req.user) return res.status(401).json({ error: '请先登录', loginRequired: true });
    next();
  });
  function admin(req, res, next) {
    if (!enabled || req.user?.role !== 'admin') return res.status(403).json({ error: '只有管理员可以操作' });
    next();
  }
  function startSession(user, res) {
    const token = crypto.randomBytes(32).toString('base64url');
    db.sessions = db.sessions.filter(s => s.expires > Date.now());
    db.sessions.push({ hash: digest(token), userId: user.id, expires: Date.now() + 30 * 86400000 });
    cookie(res, token); save();
  }
  app.get('/api/auth/me', (req, res) => res.json({ enabled, user: req.user ? publicUser(req.user) : null }));
  app.post('/api/auth/login', async (req, res) => {
    if (!enabled) return res.status(400).json({ error: '本地模式未启用账号' });
    const address = email(req.body.email);
    const key = digest(address);
    const attempts = db.loginAttempts;
    for (const [k, a] of Object.entries(attempts)) if (a.until < Date.now()) delete attempts[k];
    const attempt = attempts[key] || { count: 0, until: Date.now() + 15 * 60000 };
    if (attempt.count >= 10) return res.status(429).json({ error: '尝试次数过多，请 15 分钟后重试' });
    const user = db.users.find(u => u.email === address && !u.disabled);
    const password = typeof req.body.password === 'string' ? req.body.password.slice(0, 129) : '';
    const fallback = '00000000000000000000000000000000:' + '0'.repeat(128);
    const matches = await checkPassword(password, user?.passwordHash || fallback);
    if (!user || !matches) {
      attempts[key] = { ...attempt, count: attempt.count + 1 }; save();
      return res.status(401).json({ error: '邮箱或密码不正确' });
    }
    delete attempts[key]; startSession(user, res); res.json(publicUser(user));
  });
  app.post('/api/auth/logout', (req, res) => {
    const token = /(?:^|;\s*)canvas_session=([^;]+)/.exec(req.get('cookie') || '')?.[1];
    if (token) db.sessions = db.sessions.filter(s => s.hash !== digest(token));
    cookie(res, '', 0); save(); res.json({ ok: true });
  });
  app.post('/api/auth/password', async (req, res) => {
    if (!req.user || !validPassword(req.body.password)) return res.status(400).json({ error: '新密码需为 12–128 位' });
    if (!await checkPassword(String(req.body.currentPassword || '').slice(0, 129), req.user.passwordHash)) return res.status(400).json({ error: '原密码不正确' });
    req.user.passwordHash = await passwordHash(req.body.password);
    db.sessions = db.sessions.filter(s => s.userId !== req.user.id);
    startSession(req.user, res); res.json({ ok: true });
  });
  app.get('/api/members', admin, (_req, res) => res.json({ users: db.users.map(publicUser), invites: db.invites.filter(i => !i.used && i.expires > Date.now()).map(({ hash, ...rest }) => rest) }));
  app.post('/api/members/invites', admin, (req, res) => {
    const address = email(req.body.email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return res.status(400).json({ error: '请填写有效邮箱' });
    if (db.users.some(u => u.email === address)) return res.status(409).json({ error: '该邮箱已有账号' });
    db.invites = db.invites.filter(i => i.email !== address && !i.used && i.expires > Date.now());
    const token = crypto.randomBytes(32).toString('base64url');
    db.invites.push({ id: crypto.randomUUID(), email: address, hash: digest(token), expires: Date.now() + 7 * 86400000 }); save();
    res.status(201).json({ path: '/account.html#invite=' + token, email: address });
  });
  app.delete('/api/members/invites/:id', admin, (req, res) => { db.invites = db.invites.filter(i => i.id !== req.params.id); save(); res.json({ ok: true }); });
  app.patch('/api/members/:id', admin, (req, res) => {
    const user = db.users.find(u => u.id === req.params.id);
    if (!user || user.role === 'admin') return res.status(400).json({ error: '不能修改管理员状态' });
    user.disabled = Boolean(req.body.disabled); db.sessions = db.sessions.filter(s => s.userId !== user.id); save(); res.json(publicUser(user));
  });
  app.post('/api/auth/accept', async (req, res) => {
    if (!enabled) return res.status(400).json({ error: '未启用账号' });
    const invite = db.invites.find(i => i.hash === digest(String(req.body.token || '')) && !i.used && i.expires > Date.now());
    if (!invite || db.users.some(u => u.email === invite.email)) return res.status(400).json({ error: '邀请已失效或已使用，请联系管理员' });
    if (!validPassword(req.body.password)) return res.status(400).json({ error: '密码需为 12–128 位' });
    const user = { id: crypto.randomUUID(), email: invite.email, name: String(req.body.name || invite.email.split('@')[0]).trim().slice(0, 50), role: 'member', passwordHash: await passwordHash(req.body.password), createdAt: new Date().toISOString() };
    db.users.push(user); invite.used = true; startSession(user, res); res.status(201).json(publicUser(user));
  });
  const monthOf = iso => new Date(iso).toISOString().slice(0, 7);
  app.get('/api/usage', (req, res) => {
    if (!req.user) return res.status(401).json({ error: '请先登录' });
    const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : monthOf(Date.now());
    const all = db.usage.filter(j => monthOf(j.createdAt) === month);
    const records = (req.user.role === 'admin' ? all : all.filter(j => j.userId === req.user.id)).map(({ payload, error, ...j }) => ({ ...j, userName: db.users.find(u => u.id === j.userId)?.name || '历史任务' }));
    const bill = db.bills[month] || null;
    const participants = bill?.userIds || [];
    const cents = bill?.cents || 0;
    const shares = participants.map((userId, index) => ({ userId, name: db.users.find(u => u.id === userId)?.name || '已停用成员', cents: Math.floor(cents / participants.length) + (index < cents % participants.length ? 1 : 0) }));
    res.json({ month, records, bill, shares, users: req.user.role === 'admin' ? db.users.map(publicUser) : [], timezone: 'UTC' });
  });
  app.put('/api/usage/bill', admin, (req, res) => {
    const { month, amount, userIds } = req.body;
    const cents = Math.round(Number(amount) * 100);
    const ids = [...new Set(Array.isArray(userIds) ? userIds : [])];
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || '') || !Number.isSafeInteger(cents) || cents < 0 || cents > 100000000 || !ids.length || ids.some(id => !db.users.some(u => u.id === id))) return res.status(400).json({ error: '请填写有效月份、美元金额，并选择分摊成员' });
    db.bills[month] = { cents, currency: 'USD', userIds: ids, updatedAt: new Date().toISOString(), updatedBy: req.user.id }; save(); res.json({ ok: true });
  });
};
