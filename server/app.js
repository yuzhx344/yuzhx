import express from 'express';
import helmet from 'helmet';
import { randomBytes, randomUUID, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { openDatabase } from './database.js';

const derive = promisify(scrypt);
const hash = value => createHash('sha256').update(value).digest('hex');
const roles = ['admin', 'operator', 'viewer'];
const categories = ['power', 'temperature', 'brake', 'tire', 'connection', 'energy'];
const levels = ['高风险', '中风险', '低风险'];
class Failure extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new Failure(status, message); };
const text = (value, label, min = 1, max = 120) => {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) fail(422, `${label}需填写 ${min}–${max} 个字符。`);
  return value.trim();
};
const optional = (value, label, max = 120) => value == null || value === '' ? '' : text(value, label, 1, max);
const number = (value, label, nullable = true) => {
  if (nullable && (value == null || value === '')) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(422, `${label}必须是有效数字。`);
  return value;
};
const email = value => { const result = text(value, '邮箱', 5, 160).toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) fail(422, '请输入有效邮箱。'); return result; };
const password = value => { if (typeof value !== 'string' || value.length < 12 || value.length > 128) fail(422, '密码长度必须为 12–128 字符。'); return value; };
const publicUser = user => ({ id: user.id, email: user.email, name: user.name, role: user.role, active: Boolean(user.active) });
async function passwordHash(value) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${(await derive(value, salt, 64)).toString('hex')}`;
}
async function passwordMatches(value, encoded) {
  const [salt, key] = encoded.split(':');
  const actual = await derive(value, salt, 64);
  return timingSafeEqual(actual, Buffer.from(key, 'hex'));
}

export function createApp({ filename = resolve('var/fleetops.sqlite'), dist = resolve('dist'), production = false, setupToken = '', origin = '', trustProxy = false } = {}) {
  const db = openDatabase(filename);
  const app = express();
  app.disable('x-powered-by');
  if (trustProxy) app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: { directives: { 'style-src': ["'self'", "'unsafe-inline'"], 'script-src': ["'self'"], 'upgrade-insecure-requests': production ? [] : null } } }));
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const expected = origin || `${req.protocol}://${req.get('host')}`;
      if (req.get('sec-fetch-site') === 'cross-site' || (req.get('origin') && req.get('origin') !== expected)) return res.status(403).json({ error: '请求来源不受信任。' });
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return res.status(422).json({ error: '请求需使用 JSON 对象。' });
    }
    next();
  });
  const get = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const transaction = action => { db.exec('BEGIN IMMEDIATE'); try { const result = action(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } };
  const revision = () => run('UPDATE workspace SET revision=revision+1 WHERE id=1');
  const audit = (req, incidentId, title, content, kind = 'process') => run('INSERT INTO audit VALUES(?,?,?,?,?,?,?,?)', randomUUID(), incidentId, req.user.id, req.user.name, title, content, kind, Date.now());
  const workspace = () => get('SELECT name,created_at AS createdAt,revision FROM workspace WHERE id=1');
  const authorize = (req, res, next) => {
    const token = req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith('fleetops_session='))?.slice(17);
    const session = token && get('SELECT s.*,u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE token_hash=? AND expires_at>? AND active=1', hash(token), Date.now());
    if (!session) return res.status(401).json({ error: '登录已过期，请重新登录。' });
    req.user = session; req.session = session;
    if (!['GET', 'HEAD'].includes(req.method) && req.get('x-csrf-token') !== session.csrf) return res.status(403).json({ error: '会话校验失败，请刷新页面。' });
    next();
  };
  const writer = (req, res, next) => req.user.role === 'viewer' ? res.status(403).json({ error: '当前账号为只读权限。' }) : next();
  const admin = (req, res, next) => req.user.role !== 'admin' ? res.status(403).json({ error: '此操作需要管理员权限。' }) : next();
  const issueSession = (req, res, user) => {
    const token = randomBytes(32).toString('hex'), csrf = randomBytes(24).toString('hex');
    run('DELETE FROM sessions WHERE expires_at<=?', Date.now());
    run('INSERT INTO sessions VALUES(?,?,?,?)', hash(token), user.id, csrf, Date.now() + 8 * 3600000);
    res.cookie('fleetops_session', token, { httpOnly: true, secure: production || req.secure, sameSite: 'strict', maxAge: 8 * 3600000, path: '/' });
    return csrf;
  };
  const incidentQuery = `SELECT i.*,v.number AS vehicle,v.fleet_group AS fleetGroup,v.model,v.energy,v.mileage,u.name AS owner FROM incidents i JOIN vehicles v ON v.id=i.vehicle_id LEFT JOIN users u ON u.id=i.owner_id`;
  const serializeIncident = (row, userId) => {
    const entries = all('SELECT id,title,text,kind,at,actor_name AS actor FROM audit WHERE incident_id=? ORDER BY at,id', row.id);
    const draft = get('SELECT payload FROM drafts WHERE user_id=? AND incident_id=?', userId, row.id);
    return { id: row.id, code: row.code, vehicleId: row.vehicle_id, vehicle: row.vehicle, group: row.fleetGroup, model: row.model, energy: row.energy, mileage: row.mileage,
      category: row.category, level: row.level, description: row.description, step: row.step, ownerId: row.owner_id, owner: row.owner || '', metric: row.metric,
      observedValue: row.observed_value, resolvedValue: row.resolved_value, unit: row.unit, normalRange: row.normal_range, cause: row.cause, diagnosis: row.diagnosis, solution: row.solution,
      createdAt: row.created_at, updatedAt: row.updated_at, dueAt: row.due_at, closedAt: row.closed_at, version: row.version,
      history: entries.filter(e => e.kind !== 'comment'), comments: entries.filter(e => e.kind === 'comment'), draft: draft ? JSON.parse(draft.payload) : null };
  };
  const incident = (id, userId) => { const row = get(`${incidentQuery} WHERE i.id=?`, id); if (!row) fail(404, '事件不存在。'); return serializeIncident(row, userId); };
  const editable = (req, data, version) => {
    if (data.version !== version) fail(409, '其他成员已更新此事件。请核对最新记录后重新提交，当前填写内容已保留。');
    if (data.step === 4) fail(409, '已完成事件已归档，不能继续修改。');
    if (req.user.role === 'operator' && data.ownerId && data.ownerId !== req.user.id) fail(403, '只有负责人或管理员可以处理此事件。');
  };
  const owner = id => { const user = get('SELECT * FROM users WHERE id=? AND active=1 AND role!=?', id || '', 'viewer'); if (!user) fail(422, '请选择有效的处理负责人。'); return user; };
  const requestCache = req => {
    const key = req.get('idempotency-key');
    if (!key) return { save: () => {} };
    text(key, '请求标识', 16, 80);
    const fingerprint = hash(req.path + ':' + JSON.stringify(req.body));
    const previous = get('SELECT * FROM imports WHERE request_id=?', key);
    if (previous) {
      const record = JSON.parse(previous.result);
      if (previous.user_id !== req.user.id || record.fingerprint !== fingerprint) fail(409, '此请求已保存过其他内容，请刷新查看已保存记录后重新创建。');
      return { result: record.payload, save: () => {} };
    }
    return { save: payload => run('INSERT INTO imports VALUES(?,?,?)', key, req.user.id, JSON.stringify({fingerprint,payload})) };
  };
  const attempts = new Map();
  const rateLimit = req => {
    const keys = [[`ip:${req.ip}`,200],[`account:${req.ip}:${hash(String(req.body.email || '').trim().toLowerCase())}`,20]];
    for (const [key, limit] of keys) {
      const entry = attempts.get(key) || { count: 0, reset: Date.now() + 900000 };
      if (entry.reset < Date.now()) { entry.count = 0; entry.reset = Date.now() + 900000; }
      if (entry.count >= limit) fail(429, '登录尝试过多，请 15 分钟后再试。');
      entry.count++; attempts.set(key, entry);
    }
    if (attempts.size > 10000) for (const [key, item] of attempts) if (item.reset < Date.now()) attempts.delete(key);
  };
  app.get('/api/health', (req, res) => { get('SELECT 1'); res.json({ status: 'ok' }); });
  app.get('/api/auth/status', (req, res) => res.json({ initialized: Boolean(workspace()), needsSetupToken: production, setupAvailable: !production || Boolean(setupToken) }));
  app.post('/api/auth/setup', async (req, res) => {
    rateLimit(req);
    if (workspace()) fail(409, '工作空间已经初始化，请登录。');
    if (production && (!setupToken || typeof req.body.setupToken !== 'string' || hash(req.body.setupToken) !== hash(setupToken))) fail(403, '初始化令牌无效，请使用部署时生成的令牌。');
    const name = text(req.body.name, '姓名', 2, 40), address = email(req.body.email), secret = await passwordHash(password(req.body.password)), space = text(req.body.workspace, '工作空间名称', 2, 60), id = randomUUID();
    transaction(() => {
      if (workspace()) fail(409, '工作空间已经初始化。');
      run('INSERT INTO workspace(id,name,created_at) VALUES(1,?,?)', space, Date.now());
      run('INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)', id, address, name, secret, 'admin', Date.now());
    });
    const user = get('SELECT * FROM users WHERE id=?', id); res.status(201).json({ user: publicUser(user), csrf: issueSession(req, res, user) });
  });
  app.post('/api/auth/login', async (req, res) => {
    rateLimit(req);
    const address = email(req.body.email), value = typeof req.body.password === 'string' && req.body.password.length <= 128 ? req.body.password : '';
    const user = get('SELECT * FROM users WHERE email=?', address);
    // Run scrypt for unknown accounts as well, avoiding a fast account-existence signal.
    const encoded = user?.password_hash || `${'0'.repeat(32)}:${'0'.repeat(128)}`;
    if (!(await passwordMatches(value, encoded)) || !user?.active) fail(401, '邮箱或密码不正确。');
    res.json({ user: publicUser(user), csrf: issueSession(req, res, user) });
  });
  app.use('/api', authorize);
  app.post('/api/auth/logout', (req, res) => { run('DELETE FROM sessions WHERE token_hash=?', req.session.token_hash); res.clearCookie('fleetops_session', { path: '/', sameSite: 'strict', secure: production || req.secure }); res.json({ ok: true }); });
  app.get('/api/bootstrap', (req, res) => {
    const prefs = JSON.parse(req.user.settings);
    res.json({ user: publicUser(req.user), workspace: workspace(), csrf: req.session.csrf, serverNow: Date.now(),
      members: all('SELECT * FROM users ORDER BY created_at').map(publicUser), vehicles: all('SELECT id,number,fleet_group AS "group",model,energy,mileage,version,created_at AS createdAt FROM vehicles ORDER BY created_at DESC'),
      incidents: all(`${incidentQuery} ORDER BY i.created_at DESC`).map(d => serializeIncident(d, req.user.id)), settings: { notifications: true, compact: false, ...prefs }, read: prefs.read || [] });
  });
  app.get('/api/revision', (req, res) => res.json({ revision: workspace().revision }));
  app.get('/api/incidents/:id', (req, res) => res.json(incident(req.params.id, req.user.id)));
  app.post('/api/vehicles', writer, (req, res) => {
    const cache = requestCache(req); if (cache.result) return res.json(cache.result);
    const b = req.body, id = randomUUID(), mileage = number(b.mileage ?? 0, '里程', false);
    if (mileage < 0) fail(422, '里程不能为负数。');
    const data = [id, text(b.number, '车辆编号', 2, 40), text(b.group, '运营组', 2, 60), text(b.model, '车型', 2, 60), text(b.energy, '能源类型', 1, 20), mileage, Date.now(), Date.now()];
    transaction(() => { run('INSERT INTO vehicles(id,number,fleet_group,model,energy,mileage,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)', ...data); audit(req, null, '添加车辆', data[1], 'admin'); revision(); cache.save({id}); });
    res.status(201).json({ id });
  });
  app.patch('/api/vehicles/:id', writer, (req, res) => {
    const v = get('SELECT * FROM vehicles WHERE id=?', req.params.id); if (!v) fail(404, '车辆不存在。');
    if (v.version !== req.body.version) fail(409, '车辆档案已更新，请刷新后再编辑。');
    const b = req.body, mileage = number(b.mileage, '里程', false); if (mileage < 0) fail(422, '里程不能为负数。');
    transaction(() => { run('UPDATE vehicles SET number=?,fleet_group=?,model=?,energy=?,mileage=?,updated_at=?,version=version+1 WHERE id=?', text(b.number, '车辆编号', 2, 40), text(b.group, '运营组', 2, 60), text(b.model, '车型', 2, 60), text(b.energy, '能源类型', 1, 20), mileage, Date.now(), v.id); audit(req, null, '更新车辆档案', v.number, 'admin'); revision(); });
    res.json({ ok: true });
  });
  const validateIncident = b => {
    let vehicleId = b.vehicleId;
    if (!vehicleId && b.vehicleNumber) vehicleId = get('SELECT id FROM vehicles WHERE number=?', b.vehicleNumber)?.id;
    if (!get('SELECT id FROM vehicles WHERE id=?', vehicleId || '')) fail(422, '车辆未登记，请先添加车辆档案。');
    if (!categories.includes(b.category) || !levels.includes(b.level)) fail(422, '异常类型或风险等级无效。');
    const at = b.createdAt ?? Date.now(); if (!Number.isInteger(at) || at < 946684800000 || at > Date.now() + 300000) fail(422, '发生时间无效或位于未来。');
    return { vehicleId, category: b.category, level: b.level, description: text(b.description, '异常描述', 6, 1000), metric: optional(b.metric, '指标名称', 60), observedValue: number(b.observedValue, '发现读数'), unit: optional(b.unit, '单位', 20), normalRange: optional(b.normalRange, '正常区间', 100), createdAt: at };
  };
  const insertIncident = (req, b) => {
    const id = randomUUID(), code = `EX-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${randomBytes(4).toString('hex').toUpperCase()}`;
    run('INSERT INTO incidents(id,code,vehicle_id,category,level,description,metric,observed_value,unit,normal_range,created_at,updated_at,due_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)', id, code, b.vehicleId, b.category, b.level, b.description, b.metric, b.observedValue, b.unit, b.normalRange, b.createdAt, Date.now(), b.createdAt + ({ '高风险': 4, '中风险': 8, '低风险': 24 }[b.level]) * 3600000);
    audit(req, id, '问题发现 · 事件已登记', b.description, 'discovery'); return id;
  };
  app.post('/api/incidents', writer, (req, res) => {
    const cache = requestCache(req); if (cache.result) return res.json(incident(cache.result.id, req.user.id));
    const b = validateIncident(req.body); const id = transaction(() => { const id = insertIncident(req, b); revision(); cache.save({id}); return id; }); res.status(201).json(incident(id, req.user.id));
  });
  app.post('/api/incidents/import', writer, (req, res) => {
    text(req.get('idempotency-key'), '导入请求标识', 16, 80);
    const cache = requestCache(req); if (cache.result) return res.json(cache.result);
    if (!Array.isArray(req.body.items) || !req.body.items.length || req.body.items.length > 200) fail(422, '每次导入需包含 1–200 条事件。');
    const items = req.body.items.map((b, i) => { try { return validateIncident(b); } catch (error) { error.message = `第 ${i + 1} 行：${error.message}`; throw error; } });
    const result = transaction(() => { const result = { ids: items.map(b => insertIncident(req, b)) }; cache.save(result); revision(); return result; }); res.status(201).json(result);
  });
  app.post('/api/incidents/:id/advance', writer, (req, res) => {
    transaction(() => {
      const d = incident(req.params.id, req.user.id), b = req.body; editable(req, d, b.version); const note = text(b.note, '处理说明', 6, 500);
      let ownerId = d.ownerId, cause = d.cause, diagnosis = d.diagnosis, solution = d.solution, resolvedValue = d.resolvedValue;
      if (d.step === 0) { ownerId = owner(b.ownerId).id; if (req.user.role === 'operator' && ownerId !== req.user.id) fail(403, '处理人员只能认领自己的任务。'); }
      if (d.step === 1) { cause = text(b.cause, '可能原因', 6, 1000); diagnosis = text(b.diagnosis, '诊断结果', 6, 1000); solution = text(b.solution, '处理方案', 4, 1000); }
      if (d.step === 2) { resolvedValue = number(b.resolvedValue, '处理后读数', d.observedValue == null); }
      if (d.step === 3 && b.verified !== true) fail(422, '请核验处理结果并勾选确认项。');
      run('UPDATE incidents SET step=step+1,owner_id=?,cause=?,diagnosis=?,solution=?,resolved_value=?,updated_at=?,closed_at=?,version=version+1 WHERE id=?', ownerId, cause, diagnosis, solution, resolvedValue, Date.now(), d.step === 3 ? Date.now() : null, d.id);
      audit(req, d.id, ['问题发现 · 已受理', '原因分析 · 诊断已确认', '处理执行 · 结果已提交', '结果确认 · 已完成归档'][d.step], note);
      run('DELETE FROM drafts WHERE incident_id=?', d.id); revision();
    });
    res.json(incident(req.params.id, req.user.id));
  });
  app.put('/api/incidents/:id/draft', writer, (req, res) => {
    const d = incident(req.params.id, req.user.id); editable(req, d, req.body.version);
    const payload = { stage: d.step, note: optional(req.body.note, '说明', 500), cause: optional(req.body.cause, '原因', 1000), diagnosis: optional(req.body.diagnosis, '诊断', 1000), solution: optional(req.body.solution, '方案', 1000), ownerId: optional(req.body.ownerId, '负责人', 60), resolvedValue: number(req.body.resolvedValue, '处理后读数') };
    run('INSERT INTO drafts VALUES(?,?,?) ON CONFLICT(user_id,incident_id) DO UPDATE SET payload=excluded.payload', req.user.id, d.id, JSON.stringify(payload)); res.json({ ok: true });
  });
  app.post('/api/incidents/:id/comments', writer, (req, res) => {
    const d = incident(req.params.id, req.user.id), note = text(req.body.note, '备注', 6, 500);
    transaction(() => { audit(req, d.id, '协作备注', note, 'comment'); run('UPDATE incidents SET updated_at=?,version=version+1 WHERE id=?', Date.now(), d.id); revision(); }); res.json({ ok: true });
  });
  app.post('/api/incidents/assign', admin, (req, res) => {
    const target = owner(req.body.ownerId); if (!Array.isArray(req.body.items) || !req.body.items.length || req.body.items.length > 200) fail(422, '请选择 1–200 条事件。');
    transaction(() => { const items = req.body.items.map(item => { const d = incident(item.id, req.user.id); editable(req, d, item.version); return d; });
      if (new Set(items.map(d => d.id)).size !== items.length) fail(422, '事件不能重复选择。');
      for (const d of items) { run('UPDATE incidents SET owner_id=?,version=version+1,updated_at=? WHERE id=?', target.id, Date.now(), d.id); audit(req, d.id, '负责人已分派', `负责人：${target.name}`, 'assignment'); } revision(); }); res.json({ ok: true });
  });
  app.post('/api/users', admin, async (req, res) => {
    const b = req.body; if (!roles.includes(b.role)) fail(422, '角色无效。');
    const id = randomUUID(), name = text(b.name, '姓名', 2, 40), address = email(b.email), encoded = await passwordHash(password(b.password));
    transaction(() => { run('INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)', id, address, name, encoded, b.role, Date.now()); audit(req, null, '新增团队成员', name, 'admin'); revision(); }); res.status(201).json({ id });
  });
  app.patch('/api/users/:id', admin, (req, res) => {
    const u = get('SELECT * FROM users WHERE id=?', req.params.id); if (!u) fail(404, '成员不存在。');
    const role = req.body.role ?? u.role, active = req.body.active ?? Boolean(u.active); if (!roles.includes(role) || typeof active !== 'boolean') fail(422, '成员设置无效。');
    transaction(() => {
      if (u.role === 'admin' && u.active && (role !== 'admin' || !active) && get("SELECT COUNT(*) AS n FROM users WHERE role='admin' AND active=1").n <= 1) fail(409, '至少保留一名有效管理员。');
      if ((!active || role === 'viewer') && get('SELECT COUNT(*) AS n FROM incidents WHERE owner_id=? AND step<4', u.id).n) fail(409, '请先转移此成员的活跃任务，再停用或设为只读。');
      run('UPDATE users SET role=?,active=? WHERE id=?', role, Number(active), u.id); run('DELETE FROM sessions WHERE user_id=?', u.id); audit(req, null, '成员权限已更新', u.name, 'admin'); revision();
    }); res.json({ ok: true });
  });
  app.post('/api/auth/password', async (req, res) => {
    const current = req.body.currentPassword;
    if (typeof current !== 'string' || !current.length || current.length > 128 || !(await passwordMatches(current, req.user.password_hash))) fail(422, '当前密码不正确。');
    const encoded = await passwordHash(password(req.body.password)); transaction(() => { run('UPDATE users SET password_hash=? WHERE id=?', encoded, req.user.id); run('DELETE FROM sessions WHERE user_id=? AND token_hash!=?', req.user.id, req.session.token_hash); }); res.json({ ok: true });
  });
  app.patch('/api/preferences', (req, res) => {
    const prefs = JSON.parse(req.user.settings);
    for (const key of ['notifications', 'compact']) if (key in req.body) { if (typeof req.body[key] !== 'boolean') fail(422, '偏好设置无效。'); prefs[key] = req.body[key]; }
    if (req.body.readAppend) { if (!Array.isArray(req.body.readAppend) || req.body.readAppend.some(v => typeof v !== 'string' || v.length > 100)) fail(422, '消息标识无效。'); prefs.read = [...new Set([...(prefs.read || []), ...req.body.readAppend])].slice(-500); }
    run('UPDATE users SET settings=? WHERE id=?', JSON.stringify(prefs), req.user.id); res.json({ ok: true });
  });
  app.get('/api/export', admin, (req, res) => res.json({ exportedAt: Date.now(), workspace: workspace(), members: all('SELECT * FROM users').map(publicUser), vehicles: all('SELECT id,number,fleet_group,model,energy,mileage FROM vehicles'), incidents: all(incidentQuery).map(d => { const record = serializeIncident(d, req.user.id); delete record.draft; return record; }) }));
  app.use('/api', (req, res) => res.status(404).json({ error: '接口不存在。' }));
  app.use(express.static(dist, { index: false, maxAge: production ? '1h' : 0 }));
  app.get('/{*path}', (req, res) => { res.set('Cache-Control', 'no-cache'); res.sendFile(resolve(dist, 'index.html')); });
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error.status || (error.code?.startsWith('ERR_SQLITE') ? 409 : 500);
    const message = error instanceof Failure ? error.message : error.type === 'entity.parse.failed' ? '请求格式无效。' : error.type === 'entity.too.large' ? '请求超过 1 MB，请减少导入记录或内容。' : error.code?.startsWith('ERR_SQLITE') ? '数据冲突：邮箱、姓名或车辆编号已存在，请核对后再提交。' : '服务器暂时无法处理请求，请稍后重试。';
    if (status >= 500) console.error('Request failed:', error.name, error.code || 'internal');
    res.status(status).json({ error: message });
  });
  return { app, db };
}
