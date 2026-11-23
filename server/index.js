const express = require('express');
const compression = require('compression');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { db, tx, getSettings, DATA_DIR, UPLOAD_DIR } = require('./db');
const { haversine, optimizeRoute, balancedZones } = require('./routing');
const osrm = require('./osrm');
const gmaps = require('./gmaps');
const notify = require('./notify');

// ---------- Configuración ----------
const PORT = Number(process.env.PORT) || 3000;
const secretFile = path.join(DATA_DIR, '.jwt_secret');
const JWT_SECRET =
  process.env.JWT_SECRET ||
  (fs.existsSync(secretFile)
    ? fs.readFileSync(secretFile, 'utf8')
    : (() => {
        const s = crypto.randomBytes(48).toString('hex');
        fs.writeFileSync(secretFile, s);
        return s;
      })());

const app = express();
app.disable('x-powered-by');
// Detrás de un proxy (Traefik / Nginx con https) para que la IP real y el https se detecten bien
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? true : Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
app.use(compression());
// versión de los datos: cualquier cambio guardado (no GET) la sube y vacía el caché de listas; la ubicación GPS no cuenta
let dataVer = 0;
const LIST_CACHE = new Map();
const bumpData = () => { dataVer++; LIST_CACHE.clear(); };
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.path.startsWith('/api/') && req.path !== '/api/my/location') res.on('finish', () => { if (res.statusCode < 400) bumpData(); });
  next();
});
// listas grandes: misma consulta del mismo usuario sin cambios en medio (máx. 30 s) → se responde al instante
function cachedList(req, res) {
  const c = LIST_CACHE.get(`${req.user.id}|${req.user.role}|${req.originalUrl}`);
  if (c && c.ver === dataVer && Date.now() - c.at < 30000) { res.type('application/json').send(c.body); return true; }
  return false;
}
function sendList(req, res, obj) {
  const body = JSON.stringify(obj);
  if (body.length > 100000) {
    LIST_CACHE.set(`${req.user.id}|${req.user.role}|${req.originalUrl}`, { ver: dataVer, at: Date.now(), body });
    while (LIST_CACHE.size > 16) LIST_CACHE.delete(LIST_CACHE.keys().next().value);
  }
  res.type('application/json').send(body);
}
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) return next();
  const t = process.hrtime.bigint();
  res.on('finish', () => { const ms = Number(process.hrtime.bigint() - t) / 1e6; if (ms > 1500) console.warn(`[lento] ${req.method} ${req.path} ${Math.round(ms)} ms`); });
  next();
});
app.use(express.json({ limit: '40mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // solo el dominio (nunca la ruta con tokens) a sitios externos: OpenStreetMap lo exige para servir el mapa
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// ---------- Utilidades ----------
const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD local
class HttpError extends Error {
  constructor(status, msg) {
    super(msg);
    this.status = status;
  }
}
const wrap = (fn) => (req, res, next) => {
  try {
    const r = fn(req, res, next);
    if (r && typeof r.then === 'function') r.catch(next);
  } catch (e) {
    next(e);
  }
};
function paging(req, max = 500) {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), max);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  return { limit, offset };
}
// guía única: en importaciones grandes se crean miles por milisegundo, así que se verifica que no exista
let trackStmt = null;
function genTracking() {
  trackStmt ||= db.prepare('SELECT 1 FROM orders WHERE tracking_code=?');
  for (;;) {
    const c = 'UM' + Date.now().toString(36).toUpperCase().slice(-6) + crypto.randomBytes(2).toString('hex').toUpperCase();
    if (!trackStmt.get(c)) return c;
  }
}
function saveDataUrl(dataUrl, prefix) {
  if (!dataUrl) return null;
  const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/.exec(dataUrl);
  if (!m) throw new HttpError(400, 'Imagen inválida');
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 6 * 1024 * 1024) throw new HttpError(413, 'Imagen demasiado grande');
  const name = `${prefix}_${Date.now()}_${crypto.randomBytes(12).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  return name;
}

// Rate limit básico para login (en memoria)
const loginHits = new Map();
function loginLimiter(req, res, next) {
  const key = req.ip;
  const now = Date.now();
  const rec = loginHits.get(key) || { n: 0, t: now };
  if (now - rec.t > 15 * 60 * 1000) {
    rec.n = 0;
    rec.t = now;
  }
  rec.n++;
  loginHits.set(key, rec);
  if (rec.n > 30) return res.status(429).json({ error: 'Demasiados intentos, espera 15 minutos' });
  next();
}

// ---------- Autenticación ----------
function auth(...roles) {
  return (req, res, next) => {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'No autenticado' });
    try {
      const p = jwt.verify(token, JWT_SECRET);
      const u = db.prepare('SELECT id, name, email, role, active, token_version, office_id, can_deliver, cities FROM users WHERE id = ?').get(p.sub);
      if (!u || !u.active) return res.status(401).json({ error: 'Usuario inactivo' });
      if (req.headers['x-as-driver'] === '1' && u.can_deliver && u.role !== 'repartidor') { u.real_role = u.role; u.role = 'repartidor'; }
      if ((p.tv || 0) !== u.token_version) return res.status(401).json({ error: 'Tu sesión se cerró, vuelve a entrar' });
      if (roles.length && !roles.includes(u.role)) return res.status(403).json({ error: 'Sin permiso' });
      // renovación: si la sesión tiene más de 1 hora, se entrega una nueva (la app la guarda sola)
      if (Date.now() / 1000 - (p.iat || 0) > 3600) res.setHeader('X-Renew-Token', signToken({ id: u.id, role: u.real_role || u.role, token_version: u.token_version }));
      delete u.token_version;
      u.office = u.role === 'admin' ? null : Number(u.office_id || db.prepare('SELECT id FROM warehouses WHERE is_default = 1').get()?.id || 0) || null;
      u.supervises = db.prepare('SELECT id FROM warehouses WHERE supervisor_id = ? AND active = 1').all(u.id).map((r) => r.id);
      // supervisor por ciudad: solo ve sus ciudades (en modo repartidor, solo su ruta)
      u.cities = u.role === 'despachador' && u.cities ? String(u.cities).split(',').map((x) => x.trim()).filter(Boolean) : null;
      // personal a cargo: si el supervisor tiene equipo, solo ve y opera a su personal (y a sí mismo)
      u.team = u.role === 'despachador' ? db.prepare('SELECT id FROM users WHERE reports_to = ? AND active = 1 AND deleted_at IS NULL').all(u.id).map((r) => r.id) : [];
      req.user = u;
      next();
    } catch {
      return res.status(401).json({ error: 'Sesión expirada' });
    }
  };
}
const STAFF = ['admin', 'despachador'];
const ROLES = ['admin', 'despachador', 'repartidor'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Bitácora de actividad (solo administración la consulta)
function audit(req, action, detail) {
  try {
    db.prepare('INSERT INTO audit_log (user_id, action, detail, ip) VALUES (?,?,?,?)').run(
      req.user?.id ?? null, action, detail == null ? null : String(detail).slice(0, 500), req.ip || null
    );
  } catch (e) {
    console.error('audit', e.message);
  }
}
function tempPassword() {
  const abc = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.randomBytes(10), (b) => abc[b % abc.length]).join('');
}
// Sesión de 30 días que se renueva sola mientras se usa (el repartidor no vuelve a entrar a media ruta).
// Se cierra de inmediato si se desactiva el usuario o se cambia su contraseña (token_version).
const signToken = (u) => jwt.sign({ sub: u.id, role: u.role, tv: u.token_version || 0 }, JWT_SECRET, { expiresIn: '30d' });
const ME_FIELDS = 'id, name, email, role, phone, vehicle, capacity, can_deliver, cities, last_login, must_change_password, created_at';

app.post(
  '/api/auth/login',
  loginLimiter,
  wrap((req, res) => {
    const { email, password } = req.body || {};
    const u = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').trim());
    if (!u || !bcrypt.compareSync(String(password || ''), u.password_hash))
      throw new HttpError(401, 'Correo o contraseña incorrectos');
    if (!u.active) throw new HttpError(403, 'Tu cuenta está desactivada. Contacta al administrador.');
    db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(u.id);
    req.user = u;
    audit(req, 'login', u.email);
    res.json({ token: signToken(u), user: db.prepare(`SELECT ${ME_FIELDS} FROM users WHERE id=?`).get(u.id) });
  })
);
app.get('/api/me', auth(), (req, res) => res.json(db.prepare(`SELECT ${ME_FIELDS} FROM users WHERE id=?`).get(req.user.id)));
app.put(
  '/api/me',
  auth(),
  wrap((req, res) => {
    const { name, phone } = req.body || {};
    if (!String(name || '').trim()) throw new HttpError(400, 'El nombre es obligatorio');
    db.prepare('UPDATE users SET name=?, phone=? WHERE id=?').run(String(name).trim(), phone || null, req.user.id);
    audit(req, 'perfil', 'Actualizó sus datos');
    res.json(db.prepare(`SELECT ${ME_FIELDS} FROM users WHERE id=?`).get(req.user.id));
  })
);
app.post(
  '/api/me/password',
  auth(),
  wrap((req, res) => {
    const { current, password } = req.body || {};
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    if (!bcrypt.compareSync(String(current || ''), u.password_hash)) throw new HttpError(400, 'La contraseña actual no es correcta');
    if (String(password || '').length < 8) throw new HttpError(400, 'La nueva contraseña debe tener al menos 8 caracteres');
    if (password === current) throw new HttpError(400, 'La nueva contraseña debe ser distinta');
    db.prepare('UPDATE users SET password_hash=?, must_change_password=0, token_version=token_version+1 WHERE id=?').run(
      bcrypt.hashSync(password, 10), u.id
    );
    audit(req, 'password', 'Cambió su contraseña');
    const nu = db.prepare('SELECT * FROM users WHERE id=?').get(u.id);
    res.json({ token: signToken(nu), user: db.prepare(`SELECT ${ME_FIELDS} FROM users WHERE id=?`).get(u.id) });
  })
);

// ---------- Usuarios (administración) ----------
const USER_FIELDS = `u.id, u.name, u.email, u.role, u.phone, u.vehicle, u.capacity, u.can_deliver, u.active, u.notes, u.route_mode, u.cities, u.office_id, u.reports_to, u.suspended_reason,
  (SELECT s2.name FROM users s2 WHERE s2.id = u.reports_to) reports_to_name, (SELECT COUNT(*) FROM users t WHERE t.reports_to = u.id AND t.active = 1 AND t.deleted_at IS NULL) team_size,
  u.last_lat, u.last_lng, u.last_seen, u.last_login, u.must_change_password, u.created_at`;

app.get(
  '/api/users',
  auth(...STAFF),
  wrap((req, res) => {
    const { role, q, active } = req.query;
    const where = [];
    const args = [];
    if (role === 'repartidor') where.push("(u.role = 'repartidor' OR u.can_deliver = 1)"); // incluye supervisores que también reparten
    else if (role) {
      where.push('u.role = ?');
      args.push(role);
    }
    if (active === '1' || active === '0') {
      where.push('u.active = ?');
      args.push(Number(active));
    }
    where.push('u.deleted_at IS NULL');
    if (req.user.office && !req.user.team?.length) where.push(`${OFFICE_OF('u')} = ${Number(req.user.office)}`);
    if (req.user.team?.length) where.push(`u.id IN (${[...req.user.team, req.user.id].map(Number).join(',')})`);
    if (q) {
      where.push('(u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)');
      args.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    const rows = db
      .prepare(
        `SELECT ${USER_FIELDS},
           (SELECT COUNT(*) FROM orders o WHERE o.driver_id=u.id AND o.status='entregado') AS delivered,
           (SELECT COUNT(*) FROM orders o WHERE o.driver_id=u.id AND o.status='fallido') AS failed
         FROM users u ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY u.active DESC, u.name`
      )
      .all(...args);
    res.json(rows);
  })
);
app.get(
  '/api/users/:id',
  auth('admin'),
  wrap((req, res) => {
    const u = db.prepare(`SELECT ${USER_FIELDS} FROM users u WHERE u.id=?`).get(req.params.id);
    if (!u) throw new HttpError(404, 'No encontrado');
    u.stats = db
      .prepare(
        `SELECT SUM(status='entregado') AS delivered, SUM(status='fallido') AS failed,
                SUM(status IN ('asignado','cargado')) AS in_route
         FROM orders WHERE driver_id=?`
      )
      .get(u.id);
    u.activity = db
      .prepare('SELECT action, detail, created_at FROM audit_log WHERE user_id=? ORDER BY id DESC LIMIT 15')
      .all(u.id);
    res.json(u);
  })
);

// Rol "supervisor": despachador limitado a sus ciudades; todas deben ser de la misma oficina
// oficina elegida al dar de alta o editar (para el supervisor la definen sus ciudades)
function pickOffice(v) {
  if (v === undefined || v === null || v === '') return undefined;
  const w = db.prepare('SELECT id FROM warehouses WHERE id = ? AND active = 1').get(Number(v));
  if (!w) throw new HttpError(400, 'Esa oficina no existe o está inactiva');
  return w.id;
}
function supCities(b) {
  if (b.role !== 'supervisor') return undefined;
  const list = [...new Set([].concat(b.cities || []).flatMap((x) => String(x).split(',')).map((x) => canonCity(x.trim())).filter(Boolean))];
  if (!list.length) throw new HttpError(400, 'Elige al menos una ciudad para el supervisor');
  const offs = [...new Set(list.map((c) => officeForCity(c)))];
  if (offs.length > 1) throw new HttpError(400, 'Las ciudades del supervisor deben ser de la misma oficina (crea otro supervisor para la otra oficina)');
  b.role = 'despachador';
  return { cities: list.join(', '), office: offs[0] || null };
}
// a quién reporta (supervisor o despachador activo) y, para un supervisor, su personal a cargo
function saveTeam(uid, b, req) {
  if (b.reports_to !== undefined) {
    const to = Number(b.reports_to) || null;
    if (to === uid) throw new HttpError(400, 'Un usuario no puede reportarse a sí mismo');
    if (to && !db.prepare("SELECT 1 FROM users WHERE id=? AND role IN ('despachador','admin') AND active=1").get(to)) throw new HttpError(400, 'El supervisor elegido no es válido');
    db.prepare('UPDATE users SET reports_to=? WHERE id=?').run(to, uid);
  }
  if (Array.isArray(b.team)) {
    const me = db.prepare('SELECT name, office_id FROM users WHERE id=?').get(uid);
    const ids = [...new Set(b.team.map(Number).filter((x) => x && x !== uid))];
    const was = db.prepare('SELECT id FROM users WHERE reports_to=?').all(uid).map((r) => r.id);
    for (const id of was) if (!ids.includes(id)) db.prepare('UPDATE users SET reports_to=NULL WHERE id=?').run(id);
    for (const id of ids) {
      const t = db.prepare("SELECT id, role FROM users WHERE id=? AND role <> 'admin'").get(id);
      if (!t) continue;
      db.prepare('UPDATE users SET reports_to=? WHERE id=?').run(uid, id);
      // el personal a cargo queda en la oficina de su supervisor
      if (me.office_id) db.prepare('UPDATE users SET office_id=? WHERE id=? AND COALESCE(office_id, 0) <> ?').run(me.office_id, id, me.office_id);
    }
    const add = ids.filter((x) => !was.includes(x)).length, rem = was.filter((x) => !ids.includes(x)).length;
    if ((add || rem) && req) audit(req, 'usuario.equipo', `${me.name}: ${ids.length} a cargo (+${add} / -${rem})`);
  }
}
function validateUser(b, isNew) {
  if (!String(b.name || '').trim()) throw new HttpError(400, 'El nombre es obligatorio');
  if (!EMAIL_RE.test(String(b.email || '').trim())) throw new HttpError(400, 'Correo inválido');
  if (!ROLES.includes(b.role)) throw new HttpError(400, 'Rol inválido');
  if (isNew && b.password && String(b.password).length < 8) throw new HttpError(400, 'La contraseña debe tener al menos 8 caracteres');
}
function activeAdmins(exceptId) {
  return db.prepare("SELECT COUNT(*) n FROM users WHERE role='admin' AND active=1 AND id<>?").get(exceptId).n;
}
function createUser(b) {
  const sup = supCities(b);
  const off = sup ? undefined : pickOffice(b.office_id);
  validateUser(b, true);
  const pwd = b.password || tempPassword();
  try {
    const r = db
      .prepare(
        `INSERT INTO users (name, email, password_hash, role, phone, vehicle, capacity, notes, must_change_password)
         VALUES (?,?,?,?,?,?,?,?,?)`
      )
      .run(
        String(b.name).trim(), String(b.email).trim(), bcrypt.hashSync(pwd, 10), b.role, b.phone || null, b.vehicle || null,
        Number(b.capacity) || 40, b.notes || null, b.password && !b.force_change ? 0 : 1
      );
    const cd = b.role !== 'repartidor' && [true, 1, '1', 'on', 'true'].includes(b.can_deliver) ? 1 : 0;
    if (cd) db.prepare('UPDATE users SET can_deliver=1 WHERE id=?').run(Number(r.lastInsertRowid));
    if (b.route_mode === 'dia') db.prepare("UPDATE users SET route_mode='dia' WHERE id=?").run(Number(r.lastInsertRowid));
    if (sup) db.prepare('UPDATE users SET cities=?, office_id=? WHERE id=?').run(sup.cities, sup.office, Number(r.lastInsertRowid));
    else if (off) db.prepare('UPDATE users SET office_id=? WHERE id=?').run(off, Number(r.lastInsertRowid));
    saveTeam(Number(r.lastInsertRowid), b, null);
    return { id: Number(r.lastInsertRowid), temp_password: b.password ? null : pwd };
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw new HttpError(409, `El correo ${b.email} ya está registrado`);
    throw e;
  }
}
app.post(
  '/api/users',
  auth('admin'),
  wrap((req, res) => {
    const r = createUser(req.body || {});
    audit(req, 'usuario.alta', `${req.body.email} (${req.body.cities?.length ? 'supervisor de ' + [].concat(req.body.cities).join(', ') : req.body.role}${!req.body.cities?.length && req.body.office_id ? ' · ' + (db.prepare('SELECT name FROM warehouses WHERE id=?').get(Number(req.body.office_id))?.name || '') : ''})`);
    res.status(201).json(r);
  })
);
// Alta masiva (CSV ya convertido a filas por el navegador)
app.post(
  '/api/users/bulk',
  auth('admin'),
  wrap((req, res) => {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows.slice(0, 1000) : [];
    const created = [];
    const errors = [];
    for (const [i, row] of rows.entries()) {
      try {
        const r = createUser({ role: 'repartidor', ...row, password: '' });
        created.push({ email: row.email, name: row.name, temp_password: r.temp_password });
      } catch (e) {
        errors.push({ line: i + 1, email: row.email, error: e.message });
      }
    }
    audit(req, 'usuario.importar', `${created.length} creados, ${errors.length} con error`);
    res.json({ created, errors });
  })
);
app.put(
  '/api/users/:id',
  auth('admin'),
  wrap((req, res) => {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!u) throw new HttpError(404, 'No encontrado');
    const b = { ...u, ...req.body };
    b.active = b.active === true || b.active === 1 || b.active === '1' || b.active === 'on' ? 1 : 0;
    const sup = supCities(b);
    validateUser(b, false);
    if (u.id === req.user.id && (b.role !== 'admin' || !b.active))
      throw new HttpError(400, 'No puedes quitarte el rol de administrador ni desactivar tu propia cuenta');
    if (u.role === 'admin' && u.active && (b.role !== 'admin' || !b.active) && activeAdmins(u.id) === 0)
      throw new HttpError(400, 'Debe quedar al menos un administrador activo');
    try {
      db.prepare('UPDATE users SET name=?, email=?, role=?, phone=?, vehicle=?, capacity=?, active=?, notes=? WHERE id=?').run(
        String(b.name).trim(), String(b.email).trim(), b.role, b.phone || null, b.vehicle || null, Number(b.capacity) || 40, b.active,
        b.notes || null, u.id
      );
      if (['continua', 'dia'].includes(req.body.route_mode) && req.body.route_mode !== u.route_mode) {
        db.prepare('UPDATE users SET route_mode=? WHERE id=?').run(req.body.route_mode, u.id);
        audit(req, 'usuario.tipo_ruta', `${u.name}: ${req.body.route_mode === 'dia' ? 'ruta por día (a medianoche se libera lo pendiente)' : 'ruta continua (lo pendiente sigue con él hasta terminar)'}`);
      }
      if (sup && (sup.cities !== u.cities || sup.office !== u.office_id)) {
        db.prepare('UPDATE users SET cities=?, office_id=? WHERE id=?').run(sup.cities, sup.office, u.id);
        audit(req, 'usuario.supervisor', `${u.name}: supervisor de ${sup.cities}`);
      } else if (!sup && req.body.role && u.cities) db.prepare('UPDATE users SET cities=NULL WHERE id=?').run(u.id);
      const off = sup ? undefined : pickOffice(req.body.office_id);
      if (off && off !== u.office_id) {
        db.prepare('UPDATE users SET office_id=? WHERE id=?').run(off, u.id);
        db.prepare('UPDATE warehouses SET supervisor_id=NULL WHERE supervisor_id=? AND id<>?').run(u.id, off);
        audit(req, 'oficina.personal', `${u.name} → ${db.prepare('SELECT name FROM warehouses WHERE id=?').get(off).name}`);
      }
      saveTeam(u.id, { reports_to: req.body.reports_to, team: sup ? req.body.team : u.cities && req.body.role ? [] : undefined }, req);
      if (req.body.can_deliver !== undefined || b.role === 'repartidor')
        db.prepare('UPDATE users SET can_deliver=? WHERE id=?').run(b.role !== 'repartidor' && [true, 1, '1', 'on', 'true'].includes(req.body.can_deliver) ? 1 : 0, u.id);
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) throw new HttpError(409, 'Ese correo ya está registrado');
      throw e;
    }
    // Cambios de rol o desactivación cierran sus sesiones abiertas
    if (b.role !== u.role || (!b.active && u.active)) db.prepare('UPDATE users SET token_version=token_version+1 WHERE id=?').run(u.id);
    if (req.body.password) {
      if (String(req.body.password).length < 8) throw new HttpError(400, 'La contraseña debe tener al menos 8 caracteres');
      db.prepare('UPDATE users SET password_hash=?, token_version=token_version+1 WHERE id=?').run(bcrypt.hashSync(req.body.password, 10), u.id);
    }
    const changes = [];
    if (b.role !== u.role) changes.push(`rol ${u.role}→${b.role}`);
    if (b.active !== u.active) changes.push(b.active ? 'activado' : 'desactivado');
    audit(req, 'usuario.edicion', `${b.email}${changes.length ? ': ' + changes.join(', ') : ''}`);
    res.json({ ok: true });
  })
);
app.post(
  '/api/users/:id/reset-password',
  auth('admin'),
  wrap((req, res) => {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!u) throw new HttpError(404, 'No encontrado');
    const pwd = tempPassword();
    db.prepare('UPDATE users SET password_hash=?, must_change_password=1, token_version=token_version+1 WHERE id=?').run(
      bcrypt.hashSync(pwd, 10), u.id
    );
    audit(req, 'usuario.reset', u.email);
    res.json({ temp_password: pwd });
  })
);
app.post(
  '/api/users/:id/logout',
  auth('admin'),
  wrap((req, res) => {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!u) throw new HttpError(404, 'No encontrado');
    db.prepare('UPDATE users SET token_version=token_version+1 WHERE id=?').run(u.id);
    audit(req, 'usuario.cerrar_sesion', u.email);
    res.json({ ok: true });
  })
);
app.delete(
  '/api/users/:id',
  auth('admin'),
  wrap((req, res) => {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!u) throw new HttpError(404, 'No encontrado');
    if (u.id === req.user.id) throw new HttpError(400, 'No puedes eliminar tu propia cuenta');
    if (u.role === 'admin' && activeAdmins(u.id) === 0) throw new HttpError(400, 'Debe quedar al menos un administrador activo');
    const used =
      db.prepare('SELECT COUNT(*) n FROM orders WHERE driver_id=? OR created_by=?').get(u.id, u.id).n +
      db.prepare('SELECT COUNT(*) n FROM routes WHERE driver_id=?').get(u.id).n +
      db.prepare('SELECT COUNT(*) n FROM evidences WHERE driver_id=?').get(u.id).n +
      db.prepare('SELECT COUNT(*) n FROM inventory_movements WHERE user_id=?').get(u.id).n;
    if (used) {
      // con historial: no se puede borrar el renglón (pedidos, entregas y rutas lo citan), se elimina la cuenta
      const held = db.prepare("SELECT COUNT(*) n FROM serials WHERE holder_id=? AND status IN ('disponible','asignado')").get(u.id).n
        + (db.prepare('SELECT COALESCE(SUM(qty),0) n FROM driver_stock WHERE user_id=?').get(u.id).n || 0);
      if (held) throw new HttpError(409, `${u.name} todavía tiene ${held} equipo(s) en su custodia: regrésalos al almacén o pásalos a otro repartidor antes de eliminarlo.`);
      const open = db.prepare("SELECT COUNT(*) n FROM orders WHERE driver_id=? AND status IN ('asignado','cargado')").get(u.id).n;
      if (open) throw new HttpError(409, `${u.name} tiene ${open} pedido(s) asignados o cargados: reasígnalos o cierra su ruta antes de eliminarlo.`);
      tx(() => {
        db.prepare("UPDATE routes SET status='completada', finished_at=COALESCE(finished_at, datetime('now')) WHERE driver_id=? AND status IN ('planificada','en_curso')").run(u.id);
        db.prepare('UPDATE warehouses SET supervisor_id=NULL WHERE supervisor_id=?').run(u.id);
        db.prepare('UPDATE users SET reports_to=NULL WHERE reports_to=?').run(u.id); // su equipo queda sin célula
        // el correo queda libre para volver a usarse; ya no puede entrar
        db.prepare("UPDATE users SET active=0, can_deliver=0, deleted_at=datetime('now'), token_version=token_version+1, email=? WHERE id=?").run(`eliminado-${u.id}-${u.email}`, u.id);
        db.prepare('DELETE FROM driver_locations WHERE driver_id=?').run(u.id);
      });
      audit(req, 'usuario.baja', `${u.email} (con historial: se conserva su nombre en pedidos y entregas)`);
      return res.json({ ok: true, kept_history: true });
    }
    tx(() => {
      db.prepare('DELETE FROM driver_locations WHERE driver_id=?').run(u.id);
      db.prepare('UPDATE audit_log SET user_id=NULL WHERE user_id=?').run(u.id);
      db.prepare('UPDATE users SET reports_to=NULL WHERE reports_to=?').run(u.id); // su equipo queda sin célula
      db.prepare('DELETE FROM users WHERE id=?').run(u.id);
    });
    audit(req, 'usuario.baja', u.email);
    res.json({ ok: true });
  })
);
app.get(
  '/api/audit',
  auth('admin'),
  wrap((req, res) => {
    const { limit, offset } = paging(req);
    const where = [];
    const args = [];
    if (req.query.user_id) {
      where.push('a.user_id=?');
      args.push(Number(req.query.user_id));
    }
    if (req.query.q) {
      where.push('(a.action LIKE ? OR a.detail LIKE ? OR u.name LIKE ?)');
      args.push(`%${req.query.q}%`, `%${req.query.q}%`, `%${req.query.q}%`);
    }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const rows = db
      .prepare(
        `SELECT a.id, a.action, a.detail, a.ip, a.created_at, u.name AS user_name, u.role AS user_role
         FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ${w} ORDER BY a.id DESC LIMIT ? OFFSET ?`
      )
      .all(...args, limit, offset);
    const total = db.prepare(`SELECT COUNT(*) n FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ${w}`).get(...args).n;
    res.json({ rows, total });
  })
);

// ---------- Inventario ----------
app.get(
  '/api/products',
  auth(),
  wrap((req, res) => {
    const { q, low } = req.query;
    const { limit, offset } = paging(req);
    const where = [];
    const args = [];
    if (q) {
      const qs = normSerial(q);
      where.push('(id IN (SELECT product_id FROM serials WHERE serial LIKE ?) OR name LIKE ? OR sku LIKE ? OR barcode LIKE ?)');
      args.push(`%${qs}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (low === '1') where.push('stock <= min_stock');
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const total = db.prepare(`SELECT COUNT(*) c FROM products ${w}`).get(...args).c;
    const rows = db
      .prepare(`SELECT products.*, (SELECT COUNT(*) FROM serials s WHERE s.product_id = products.id AND s.status = 'disponible') serials_available FROM products ${w} ORDER BY name LIMIT ? OFFSET ?`)
      .all(...args, limit, offset);
    res.json({ total, rows });
  })
);
app.get(
  '/api/products/barcode/:code',
  auth(),
  wrap((req, res) => {
    const p = db.prepare('SELECT * FROM products WHERE barcode = ? OR sku = ?').get(req.params.code, req.params.code);
    if (!p) throw new HttpError(404, 'Producto no encontrado');
    res.json(p);
  })
);
app.post(
  '/api/products',
  auth(...STAFF),
  wrap((req, res) => {
    const { sku, barcode, name, description, unit, stock, min_stock, location, weight_kg, serialized } = req.body;
    if (!sku || !name) throw new HttpError(400, 'SKU y nombre son obligatorios');
    try {
      const id = tx(() => {
        const r = db
          .prepare(
            'INSERT INTO products (sku, barcode, name, description, unit, stock, min_stock, location, weight_kg, serialized) VALUES (?,?,?,?,?,?,?,?,?,?)'
          )
          .run(sku, barcode || null, name, description || null, unit || 'pza', 0, Number(min_stock) || 0, location || null, Number(weight_kg) || 1,
            [true, 1, '1', 'on'].includes(serialized) ? 1 : 0);
        const id = Number(r.lastInsertRowid);
        const s = Number(stock) || 0;
        if (s > 0) moveStock(id, 'entrada', s, 'Alta de producto', req.user.id);
        return id;
      });
      res.status(201).json({ id });
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) throw new HttpError(409, 'SKU o código de barras duplicado');
      throw e;
    }
  })
);
app.put(
  '/api/products/:id',
  auth(...STAFF),
  wrap((req, res) => {
    const p = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    if (!p) throw new HttpError(404, 'No encontrado');
    const b = { ...p, ...req.body };
    db.prepare('UPDATE products SET sku=?, barcode=?, name=?, description=?, unit=?, min_stock=?, location=?, weight_kg=?, serialized=? WHERE id=?').run(
      b.sku, b.barcode || null, b.name, b.description || null, b.unit, Number(b.min_stock) || 0, b.location || null, Number(b.weight_kg) || 1,
      [true, 1, '1', 'on'].includes(b.serialized) ? 1 : 0, p.id
    );
    res.json({ ok: true });
  })
);
// Eliminar producto: solo si nunca se usó en pedidos ni tiene números de serie y su existencia es 0 (p. ej. creado por error)
app.delete(
  '/api/products/:id',
  auth(...STAFF),
  wrap((req, res) => {
    const p = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    if (!p) throw new HttpError(404, 'No encontrado');
    const used = db.prepare('SELECT COUNT(*) n FROM order_items WHERE product_id=?').get(p.id).n;
    if (used) throw new HttpError(409, `No se puede eliminar: ${p.name} está en ${used} pedido(s).`);
    const sn = db.prepare('SELECT COUNT(*) n FROM serials WHERE product_id=?').get(p.id).n;
    if (sn) throw new HttpError(409, `No se puede eliminar: ${p.name} tiene ${sn} número(s) de serie registrados.`);
    if (p.stock) throw new HttpError(409, `Primero deja la existencia en 0 (tiene ${p.stock}).`);
    const held = db.prepare("SELECT u.name, d.qty FROM driver_stock d JOIN users u ON u.id = d.user_id WHERE d.product_id=? AND d.qty > 0").all(p.id);
    if (held.length) throw new HttpError(409, `No se puede eliminar: ${held.map((h) => `${h.name} trae ${h.qty}`).join(', ')}. Primero regrésalo al almacén.`);
    tx(() => {
      db.prepare('DELETE FROM driver_stock WHERE product_id=?').run(p.id);
      db.prepare('DELETE FROM open_stock WHERE product_id=?').run(p.id);
      db.prepare('DELETE FROM custody_log WHERE product_id=?').run(p.id);
      db.prepare('DELETE FROM inventory_movements WHERE product_id=?').run(p.id);
      db.prepare('DELETE FROM products WHERE id=?').run(p.id);
    });
    audit(req, 'producto.eliminar', `${p.sku} · ${p.name}`);
    res.json({ ok: true });
  })
);

function moveStock(productId, type, qty, reference, userId) {
  const p = db.prepare('SELECT id, stock, name FROM products WHERE id = ?').get(productId);
  if (!p) throw new HttpError(404, 'Producto no encontrado');
  qty = Math.trunc(Number(qty));
  if (!qty) throw new HttpError(400, 'Cantidad inválida');
  let delta;
  if (type === 'entrada' || type === 'devolucion') delta = Math.abs(qty);
  else if (type === 'salida') delta = -Math.abs(qty);
  else if (type === 'ajuste') delta = qty; // puede ser + o -
  else throw new HttpError(400, 'Tipo inválido');
  const after = p.stock + delta;
  if (after < 0) throw new HttpError(409, `Stock insuficiente de "${p.name}" (disponible ${p.stock})`);
  db.prepare('UPDATE products SET stock = ? WHERE id = ?').run(after, p.id);
  db.prepare('INSERT INTO inventory_movements (product_id, type, qty, stock_after, reference, user_id) VALUES (?,?,?,?,?,?)').run(
    p.id, type, delta, after, reference || null, userId || null
  );
  if (delta > 0 && !FILL.busy && getSettings().auto_fill !== '0') fillBackorders(userId, p.id);
  return after;
}
// ---------- Pedidos por surtir ----------
// order_items.filled = piezas ya descontadas del inventario; qty - filled queda "por surtir" hasta que haya existencia
const FILL = { busy: false, skip: new Set() };
const OPEN_ST = "('pendiente','asignado','cargado','fallido')";
// Inventario abierto (stock_at = 'entrega'): el pedido NO aparta existencia; la pieza sale del inventario de la ciudad al entregarse.
const stockAtDelivery = () => getSettings().stock_at === 'entrega';
// descuenta hasta "want" piezas de lo que haya; regresa cuántas tomó (con inventario abierto, solo revisa si hay, salvo al entregar)
function takeStock(orderId, productId, want, code, userId, note = '', { force = false } = {}) {
  const st = db.prepare('SELECT stock FROM products WHERE id=?').get(productId)?.stock || 0;
  const take = Math.max(0, Math.min(st, Math.trunc(want)));
  if (stockAtDelivery() && !force) return take;
  if (!take) return 0;
  const was = FILL.busy; FILL.busy = true;
  try { moveStock(productId, 'salida', take, `Pedido ${code}${note}`, userId); } finally { FILL.busy = was; }
  db.prepare('UPDATE order_items SET filled = MIN(qty, filled + ?) WHERE order_id=? AND product_id=?').run(take, orderId, productId);
  return take;
}
// regresa al inventario lo que el pedido ya tenía descontado (al cancelarlo); lo que regresa surte a otros pedidos
function returnOrderStock(orderId, code, userId, why = 'Cancelación') {
  const items = db.prepare('SELECT product_id, filled FROM order_items WHERE order_id=? AND filled > 0').all(orderId);
  FILL.skip.add(Number(orderId));
  try {
    for (const it of items) {
      db.prepare('UPDATE order_items SET filled = 0 WHERE order_id=? AND product_id=?').run(orderId, it.product_id);
      moveStock(it.product_id, 'devolucion', it.filled, `${why} ${code}`, userId);
    }
  } finally { FILL.skip.delete(Number(orderId)); }
}
// surte pedidos abiertos con faltante: primero los de fecha más próxima y prioridad alta
function fillBackorders(userId, productId = null) {
  if (FILL.busy || stockAtDelivery()) return { orders: 0, units: 0 };
  FILL.busy = true;
  const out = { orders: 0, units: 0, codes: [] };
  try {
    const rows = db.prepare(`SELECT i.order_id, i.product_id, i.qty - i.filled need, o.tracking_code FROM order_items i JOIN orders o ON o.id = i.order_id
      WHERE i.filled < i.qty AND o.status IN ${OPEN_ST} ${productId ? 'AND i.product_id = ' + Number(productId) : ''}
      ORDER BY o.scheduled_date, o.priority = 'alta' DESC, o.id`).all();
    const empty = new Set();
    for (const r of rows) {
      if (empty.has(r.product_id) || FILL.skip.has(r.order_id)) continue;
      const t = takeStock(r.order_id, r.product_id, r.need, r.tracking_code, userId, ' (surtido)');
      if (!t) { empty.add(r.product_id); continue; }
      out.units += t; out.orders++; if (out.codes.length < 10) out.codes.push(r.tracking_code);
    }
  } finally { FILL.busy = false; }
  if (out.units) db.prepare('INSERT INTO audit_log (user_id, action, detail) VALUES (?, ?, ?)').run(userId || null, 'inventario.surtir', `${out.units} pieza(s) surtidas a ${out.orders} pedido(s) por surtir: ${out.codes.join(', ')}${out.orders > 10 ? '…' : ''}`);
  return out;
}


// ---------- Importación masiva de inventario (Excel, CSV o Google Sheets) ----------
// El navegador convierte el archivo en filas {sku, barcode, name, ...}; aquí se validan y se aplican
// en una sola transacción. Con dry_run se calcula el resultado exacto sin guardar nada (vista previa).
const IMPORT_MAX = 5000;
const numOrNull = (v) => {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(String(v).replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : NaN;
};
const txt = (v, max = 200) => (v === null || v === undefined ? '' : String(v).trim().slice(0, max));
app.post(
  '/api/products/import',
  auth(...STAFF),
  wrap((req, res) => {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) throw new HttpError(400, 'No hay filas para importar');
    if (rows.length > IMPORT_MAX) throw new HttpError(400, `Máximo ${IMPORT_MAX} filas por importación`);
    const stockMode = ['reemplazar', 'sumar', 'ignorar'].includes(req.body.stock_mode) ? req.body.stock_mode : 'reemplazar';
    const updateExisting = req.body.update_existing !== false;
    const dry = !!req.body.dry_run;
    const ref = txt(req.body.reference, 80) || 'Importación masiva';
    const bySku = db.prepare('SELECT * FROM products WHERE sku = ?');
    const byBarcode = db.prepare('SELECT * FROM products WHERE barcode = ?');
    const results = [];
    const seen = new Map();
    db.exec('BEGIN IMMEDIATE');
    try {
      rows.forEach((raw, i) => {
        const line = Number(raw.__line) || i + 2;
        const r = {
          sku: txt(raw.sku, 64), barcode: txt(raw.barcode, 64), name: txt(raw.name), description: txt(raw.description, 500),
          unit: txt(raw.unit, 16), location: txt(raw.location, 64),
          stock: numOrNull(raw.stock), min_stock: numOrNull(raw.min_stock), weight_kg: numOrNull(raw.weight_kg),
        };
        const out = { line, sku: r.sku || r.barcode, name: r.name };
        try {
          if (!r.sku && !r.barcode) throw new Error('Falta SKU o código de barras');
          for (const [k, l] of [['stock', 'Existencia'], ['min_stock', 'Mínimo'], ['weight_kg', 'Peso']]) {
            if (Number.isNaN(r[k])) throw new Error(`${l} no es un número`);
            if (r[k] != null && r[k] < 0) throw new Error(`${l} no puede ser negativo`);
          }
          if (r.stock != null && !Number.isInteger(r.stock)) throw new Error('La existencia debe ser un número entero');
          const key = (r.sku || 'b:' + r.barcode).toLowerCase();
          if (seen.has(key)) throw new Error(`Repetido en el archivo (también en la fila ${seen.get(key)})`);
          seen.set(key, line);
          db.exec('SAVEPOINT fila');
          try {
            let p = (r.sku && bySku.get(r.sku)) || null;
            if (!p && r.barcode) {
              p = byBarcode.get(r.barcode) || null;
              // el código de barras ya pertenece a otro producto con SKU distinto: no mezclar
              if (p && r.sku && p.sku !== r.sku) throw new Error(`El código de barras ${r.barcode} ya es del SKU ${p.sku} ("${p.name}")`);
            }
            if (p && r.barcode && p.barcode !== r.barcode) {
              const other = byBarcode.get(r.barcode);
              if (other && other.id !== p.id) throw new Error(`El código de barras ${r.barcode} ya es de "${other.name}"`);
            }
            out.stock_before = p ? p.stock : 0;
            if (!p) {
              if (!r.name) throw new Error('Producto nuevo sin nombre');
              const ins = db
                .prepare('INSERT INTO products (sku, barcode, name, description, unit, stock, min_stock, location, weight_kg) VALUES (?,?,?,?,?,0,?,?,?)')
                .run(r.sku || r.barcode, r.barcode || null, r.name, r.description || null, r.unit || 'pza', Math.trunc(r.min_stock ?? 0),
                  r.location || null, r.weight_kg ?? 1);
              p = { id: Number(ins.lastInsertRowid), stock: 0 };
              out.action = 'nuevo';
              out.sku = r.sku || r.barcode;
            } else if (!updateExisting) {
              out.action = 'sin cambios';
              out.note = 'Ya existe (no se actualizan existentes)';
              out.stock_after = p.stock;
              out.name = p.name;
              db.exec('RELEASE fila');
              results.push(out);
              return;
            } else {
              const nv = {
                barcode: r.barcode || p.barcode, name: r.name || p.name, description: r.description || p.description, unit: r.unit || p.unit,
                min_stock: r.min_stock != null ? Math.trunc(r.min_stock) : p.min_stock, location: r.location || p.location,
                weight_kg: r.weight_kg != null ? r.weight_kg : p.weight_kg,
              };
              const changed = Object.keys(nv).filter((k) => String(nv[k] ?? '') !== String(p[k] ?? ''));
              if (changed.length) {
                db.prepare('UPDATE products SET barcode=?, name=?, description=?, unit=?, min_stock=?, location=?, weight_kg=? WHERE id=?').run(
                  nv.barcode || null, nv.name, nv.description || null, nv.unit, nv.min_stock, nv.location || null, nv.weight_kg, p.id
                );
              }
              out.action = changed.length ? 'actualizado' : 'sin cambios';
              out.name = nv.name;
            }
            // Existencia: siempre con movimiento de inventario para que quede en el kárdex
            let after = p.stock;
            if (r.stock != null && stockMode !== 'ignorar') {
              if (stockMode === 'reemplazar' && r.stock !== p.stock) after = moveStock(p.id, out.action === 'nuevo' ? 'entrada' : 'ajuste', r.stock - p.stock, ref, req.user.id);
              if (stockMode === 'sumar' && r.stock > 0) after = moveStock(p.id, 'entrada', r.stock, ref, req.user.id);
              if (after !== p.stock && out.action === 'sin cambios') out.action = 'actualizado';
            }
            out.stock_after = after;
            db.exec('RELEASE fila');
          } catch (e) {
            db.exec('ROLLBACK TO fila');
            db.exec('RELEASE fila');
            throw e;
          }
        } catch (e) {
          out.action = 'error';
          out.error = String(e.message || e).includes('UNIQUE') ? 'SKU o código de barras duplicado' : e.message;
        }
        results.push(out);
      });
      db.exec(dry ? 'ROLLBACK' : 'COMMIT');
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch {}
      throw e;
    }
    const count = (a) => results.filter((x) => x.action === a).length;
    const summary = { total: results.length, nuevos: count('nuevo'), actualizados: count('actualizado'), sin_cambios: count('sin cambios'), errores: count('error') };
    if (!dry) audit(req, 'inventario.importar', `${summary.nuevos} nuevos, ${summary.actualizados} actualizados, ${summary.errores} con error (${ref})`);
    res.json({ dry_run: dry, summary, results });
  })
);
// Lee una pestaña de Google Sheets como CSV (la hoja debe compartirse "Cualquier persona con el enlace: Lector")
app.post(
  '/api/products/import/gsheet',
  auth(...STAFF),
  wrap(async (req, res) => {
    const url = String(req.body?.url || '').trim();
    const m = /docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/.exec(url);
    if (!m) throw new HttpError(400, 'Pega el enlace de la hoja de Google Sheets (https://docs.google.com/spreadsheets/d/…)');
    const gid = (/[#&?]gid=(\d+)/.exec(url) || [])[1] || '0';
    const r = await fetch(`https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv&gid=${gid}`, { redirect: 'follow', signal: AbortSignal.timeout(20000) });
    const ct = r.headers.get('content-type') || '';
    if (!r.ok || !ct.includes('text/csv')) {
      throw new HttpError(400, 'No se pudo leer la hoja. En Google Sheets toca Compartir → Acceso general: "Cualquier persona con el enlace" (Lector) y vuelve a intentar.');
    }
    const csv = await r.text();
    if (csv.length > 5 * 1024 * 1024) throw new HttpError(413, 'La hoja es demasiado grande (máx. 5 MB)');
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('inventory_sheet_url', url.slice(0, 500));
    res.json({ csv, gid });
  })
);


// ---------- Números de serie (control por equipo) ----------
const SERIAL_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{2,63}$/;
const normSerial = (s) => String(s || '').trim().replace(/^S\/?N[:\s]*/i, '').toUpperCase();
// Telmex S/N: es el único número que se guarda (HWTC + 8 caracteres, p. ej. HWTCE4A377BA). Se puede desactivar con serial_telmex_only = '0'
const TELMEX_RE = /^HWTC[0-9A-F]{8}$/;
function telmexSerial(raw) {
  const sn = normSerial(raw).replace(/^TELMEX\s*S\/?N[:\s]*/, '').replace(/[^A-Z0-9]/g, '');
  if (getSettings().serial_telmex_only === '0') return normSerial(raw);
  if (TELMEX_RE.test(sn)) return sn;
  // prefijo mal capturado (HETC, HWYC, HTWC…) o incompleto (CE43D63BA): si el resto coincide con un equipo del inventario, se usa ese
  const cands = [];
  if (sn.length === 12) cands.push('HWTC' + sn.slice(4));
  if (sn.length === 9) cands.push('HWT' + sn);
  if (sn.length === 8) cands.push('HWTC' + sn);
  for (const c of cands) if (TELMEX_RE.test(c) && db.prepare('SELECT 1 FROM serials WHERE serial = ?').get(c)) return c;
  if (/^2150080/.test(sn)) throw new HttpError(400, `${sn} es el PROD ID de la caja. Escanea el código de «Telmex S/N» (empieza con HWTC, p. ej. HWTCE4A377BA).`);
  if (/^\d+$/.test(sn)) throw new HttpError(400, `${sn} es el código de barras del producto, no el número de serie. Escanea el código de «Telmex S/N» (empieza con HWTC).`);
  throw new HttpError(400, `«${String(raw).trim()}» no es un Telmex S/N. Debe empezar con HWTC y tener 12 caracteres (p. ej. HWTCE4A377BA).`);
}
function serialEvent(serialId, event, orderId, userId, detail) {
  db.prepare('INSERT INTO serial_events (serial_id, event, order_id, user_id, detail) VALUES (?,?,?,?,?)').run(serialId, event, orderId ?? null, userId ?? null, detail ?? null);
}
// Qué series le faltan a un pedido: por cada artículo con control de serie, cantidad pedida vs. asignada
function orderSerialNeeds(orderId) {
  return db
    .prepare(
      `SELECT i.product_id, p.name, p.sku, SUM(i.qty) qty,
         (SELECT COUNT(*) FROM serials s WHERE s.order_id = ? AND s.product_id = i.product_id AND s.status IN ('asignado','entregado')) assigned
       FROM order_items i JOIN products p ON p.id = i.product_id
       WHERE i.order_id = ? AND p.serialized = 1 GROUP BY i.product_id`
    )
    .all(orderId, orderId)
    .map((r) => ({ ...r, missing: Math.max(0, r.qty - r.assigned) }));
}
const missingSerialCount = (orderId) => orderSerialNeeds(orderId).reduce((a, r) => a + r.missing, 0);
function serialsRequiredError(o) {
  const needs = orderSerialNeeds(o.id).filter((r) => r.missing);
  const e = new HttpError(409, `Faltan ${needs.reduce((a, r) => a + r.missing, 0)} número(s) de serie: ${needs.map((r) => `${r.missing} × ${r.name}`).join(', ')}`);
  e.data = { code: 'serials_required', order_id: o.id, tracking_code: o.tracking_code, needs };
  return e;
}
function assignSerial(o, raw, user) {
  const sn = telmexSerial(raw);
  if (!SERIAL_RE.test(sn)) throw new HttpError(400, `"${raw}" no parece un número de serie válido`);
  const lateDelivered = o.status === 'entregado' && STAFF.includes(user.role);
  if (!['pendiente', 'asignado', 'cargado', 'fallido'].includes(o.status) && !lateDelivered) throw new HttpError(409, `El pedido está "${o.status}"`);
  const needs = orderSerialNeeds(o.id);
  if (!needs.length) throw new HttpError(409, 'Este pedido no lleva productos con número de serie');
  let s = db.prepare('SELECT s.*, p.name pname FROM serials s JOIN products p ON p.id = s.product_id WHERE s.serial = ?').get(sn);
  if (!s) {
    // S/N que no se había registrado (existencia anterior al control por serie): se da de alta al asignarlo
    const open = needs.filter((r) => r.missing);
    if (open.length !== 1) throw new HttpError(404, `El S/N ${sn} no está registrado. Recíbelo primero en Inventario → Números de serie.`);
    const r = db.prepare("INSERT INTO serials (product_id, serial, status, reference) VALUES (?,?, 'disponible', 'Alta al asignar')").run(open[0].product_id, sn);
    s = db.prepare('SELECT s.*, p.name pname FROM serials s JOIN products p ON p.id = s.product_id WHERE s.id = ?').get(Number(r.lastInsertRowid));
    serialEvent(s.id, 'alta', null, user.id, 'Registrado al asignarlo a un pedido (existencia previa sin serie)');
  }
  if (s.order_id === o.id && s.status === 'asignado') return { serial: s, already: true };
  if (s.status !== 'disponible') {
    const ord = s.order_id ? db.prepare('SELECT tracking_code FROM orders WHERE id=?').get(s.order_id) : null;
    const where = { asignado: `ya está asignado al pedido ${ord?.tracking_code || ''}`, entregado: `ya fue entregado (pedido ${ord?.tracking_code || ''})`, baja: 'está dado de baja' }[s.status];
    throw new HttpError(409, `El S/N ${sn} ${where}`);
  }
  // El repartidor toma del inventario disponible de su oficina, del abierto o del que él trae
  // (también del almacén de la oficina que atiende la ciudad del cliente; y si no trae inventario asignado de ese
  // artículo, puede usar uno que tenga otro repartidor de su oficina: el inventario queda abierto para entregar)
  if (user.role === 'repartidor') {
    const offs = new Set([user.office, customerOffice(o.customer_id)].filter(Boolean).map(Number));
    if (s.holder_id && s.holder_id !== user.id) {
      const mine = db.prepare("SELECT COUNT(*) n FROM serials WHERE holder_id=? AND product_id=? AND status='disponible'").get(user.id, s.product_id).n;
      if (mine || !offs.has(Number(userOffice(s.holder_id)))) {
        const h = db.prepare('SELECT name FROM users WHERE id=?').get(s.holder_id);
        throw new HttpError(409, `El S/N ${sn} lo trae ${h?.name || 'otro repartidor'}${mine ? `; tú traes ${mine} de este artículo: usa uno de los tuyos` : ''}`);
      }
      serialEvent(s.id, 'traspaso', o.id, user.id, `Lo traía ${db.prepare('SELECT name FROM users WHERE id=?').get(s.holder_id)?.name || 'otro repartidor'}; lo entrega ${user.name}`);
    }
    if (!s.holder_id && !s.open_pool && s.warehouse_id && offs.size && !offs.has(Number(s.warehouse_id))) {
      const w = db.prepare('SELECT name FROM warehouses WHERE id=?').get(s.warehouse_id);
      throw new HttpError(409, `El S/N ${sn} está en el almacén ${w?.name || 'de otra oficina'}, no en el de tu oficina`);
    }
  }
  const need = needs.find((r) => r.product_id === s.product_id);
  if (!need) throw new HttpError(409, `El S/N ${sn} es de "${s.pname}", que no está en este pedido`);
  if (!need.missing) throw new HttpError(409, `Este pedido ya tiene todas las series de "${s.pname}"`);
  if (lateDelivered) {
    // el pedido ya se entregó: la pieza sale como entregada (y deja de contar en almacén, abierto o con el repartidor)
    if (s.holder_id) custodyLog(s.holder_id, s.product_id, 1, 'entregado', user.id, { serial: s.serial, orderId: o.id, reference: 'S/N asignado después de la entrega' });
    db.prepare("UPDATE serials SET status='entregado', order_id=?, holder_id=NULL, held_at=NULL, open_pool=0, assigned_at=COALESCE(assigned_at, datetime('now')), delivered_at=COALESCE(?, datetime('now')), updated_at=datetime('now') WHERE id=?").run(o.id, o.delivered_at, s.id);
    serialEvent(s.id, 'entregado', o.id, user.id, `Asignado al pedido ${o.tracking_code} (ya entregado)`);
    // la hoja de Google se actualiza con el S/N
    db.prepare("UPDATE sheet_sync SET status='pendiente', attempts=0, next_try_at=datetime('now') WHERE order_id=? AND status<>'desactivado'").run(o.id);
    return { serial: { ...s, status: 'entregado', order_id: o.id }, already: false };
  }
  db.prepare("UPDATE serials SET status='asignado', order_id=?, assigned_at=datetime('now'), updated_at=datetime('now') WHERE id=?").run(o.id, s.id);
  serialEvent(s.id, 'asignado', o.id, user.id, `Pedido ${o.tracking_code}`);
  return { serial: { ...s, status: 'asignado', order_id: o.id }, already: false };
}
function releaseOrderSerials(orderId, userId, why) {
  for (const s of db.prepare("SELECT id FROM serials WHERE order_id=? AND status='asignado'").all(orderId)) {
    db.prepare("UPDATE serials SET status='disponible', order_id=NULL, assigned_at=NULL, updated_at=datetime('now') WHERE id=?").run(s.id);
    serialEvent(s.id, 'liberado', orderId, userId, why);
  }
}
function deliverOrderSerials(orderId, userId, receiver) {
  for (const s of db.prepare("SELECT id FROM serials WHERE order_id=? AND status='asignado'").all(orderId)) {
    db.prepare("UPDATE serials SET status='entregado', delivered_at=datetime('now'), updated_at=datetime('now') WHERE id=?").run(s.id);
    serialEvent(s.id, 'entregado', orderId, userId, receiver ? `Recibió ${receiver}` : null);
  }
}
const serialsOfOrder = (orderId) =>
  db.prepare('SELECT s.id, s.serial, s.status, s.product_id, p.name product_name FROM serials s JOIN products p ON p.id = s.product_id WHERE s.order_id = ? ORDER BY p.name, s.serial').all(orderId);

app.get(
  '/api/serials',
  auth(...STAFF),
  wrap((req, res) => {
    const { limit, offset } = paging(req);
    const where = [];
    const args = [];
    if (req.query.status) { where.push('s.status = ?'); args.push(req.query.status); }
    if (req.query.product_id) { where.push('s.product_id = ?'); args.push(Number(req.query.product_id)); }
    if (req.user.office) {
      const off = Number(req.user.office);
      where.push(`(s.warehouse_id = ${off} OR (o.id IS NOT NULL AND ${OFFICE_OF('c')} = ${off}) OR s.holder_id IN (SELECT u2.id FROM users u2 WHERE ${OFFICE_OF('u2')} = ${off}))`);
    }
    if (req.query.q) { where.push('(s.serial LIKE ? OR o.tracking_code LIKE ? OR c.name LIKE ?)'); args.push(...Array(3).fill(`%${req.query.q}%`)); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const from = `FROM serials s JOIN products p ON p.id = s.product_id LEFT JOIN orders o ON o.id = s.order_id LEFT JOIN customers c ON c.id = o.customer_id ${w}`;
    const rows = db.prepare(`SELECT s.*, p.name product_name, p.sku, o.tracking_code, o.status order_status, c.name customer_name, (SELECT name FROM users WHERE id = s.holder_id) holder_name, (SELECT name FROM warehouses WHERE id = s.warehouse_id) warehouse_name ${from} ORDER BY s.updated_at DESC, s.id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset);
    const total = db.prepare(`SELECT COUNT(*) n ${from}`).get(...args).n;
    const stats = db.prepare('SELECT status, COUNT(*) n FROM serials GROUP BY status').all();
    const products = db.prepare(
      `SELECT p.id, p.name, p.sku, p.stock, SUM(s.status='disponible') disponibles FROM products p LEFT JOIN serials s ON s.product_id = p.id
       WHERE p.serialized = 1 GROUP BY p.id ORDER BY p.name`
    ).all();
    res.json({ rows, total, stats, products });
  })
);
app.get(
  '/api/serials/lookup/:serial',
  auth(),
  wrap((req, res) => {
    const sn = normSerial(req.params.serial);
    const s = db
      .prepare(
        `SELECT s.*, p.name product_name, p.sku, o.tracking_code, o.status order_status, o.driver_id, o.public_token, c.name customer_name, c.address
         FROM serials s JOIN products p ON p.id = s.product_id LEFT JOIN orders o ON o.id = s.order_id LEFT JOIN customers c ON c.id = o.customer_id
         WHERE s.serial = ?`
      )
      .get(sn);
    if (!s) throw new HttpError(404, `El S/N ${sn} no está registrado`);
    if (!STAFF.includes(req.user.role) && s.driver_id !== req.user.id) {
      return res.json({ serial: s.serial, product_name: s.product_name, status: s.status, mine: false });
    }
    s.events = db
      .prepare('SELECT e.event, e.detail, e.created_at, u.name user_name, o.tracking_code FROM serial_events e LEFT JOIN users u ON u.id = e.user_id LEFT JOIN orders o ON o.id = e.order_id WHERE e.serial_id = ? ORDER BY e.id DESC')
      .all(s.id);
    if (s.public_token) s.public_link = notify.trackLink(getSettings(), s.public_token);
    delete s.public_token;
    res.json(s);
  })
);
app.post(
  '/api/serials/receive',
  auth(...STAFF),
  wrap((req, res) => {
    const p = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(req.body?.product_id));
    if (!p) throw new HttpError(404, 'Elige el producto');
    const dry = !!req.body.dry_run;
    // desde la importación de Excel se puede activar el control por S/N si el producto aún no lo tenía (y no tiene existencia sin serie)
    const enable = !p.serialized && req.body.enable_serial === true;
    if (!p.serialized && !enable) throw new HttpError(409, `Activa "Controlar por número de serie" en ${p.name}`);
    if (enable && p.stock > 0) throw new HttpError(409, `${p.name} tiene ${p.stock} piezas sin número de serie. Ajusta su existencia a 0 o elige otro producto.`);
    const list = (Array.isArray(req.body.serials) ? req.body.serials : []).map(normSerial).filter(Boolean);
    if (!list.length) throw new HttpError(400, 'No hay números de serie');
    if (list.length > 2000) throw new HttpError(400, 'Máximo 2,000 series por recepción');
    const ref = String(req.body.reference || '').trim().slice(0, 80);
    const results = [];
    const seen = new Set();
    // opcional: los equipos recibidos se entregan de inmediato a un repartidor
    let drv = null;
    if (req.body.driver_id) {
      drv = db.prepare("SELECT id, name, active FROM users WHERE id=? AND (role='repartidor' OR can_deliver=1)").get(Number(req.body.driver_id));
      if (!drv) throw new HttpError(400, 'Repartidor no encontrado');
      if (!drv.active) throw new HttpError(409, `${drv.name} está desactivado`);
    }
    if (enable && !dry) db.prepare('UPDATE products SET serialized=1 WHERE id=?').run(p.id);
    const whId = (req.body.warehouse_id && db.prepare('SELECT id FROM warehouses WHERE id=? AND active=1').get(Number(req.body.warehouse_id))?.id) || whDefault()?.id || null;
    tx(() => {
      for (const sn of list) {
        if (seen.has(sn)) { results.push({ serial: sn, ok: false, error: 'Repetido en la lista' }); continue; }
        seen.add(sn);
        if (!SERIAL_RE.test(sn)) { results.push({ serial: sn, ok: false, error: 'Formato no válido' }); continue; }
        if (getSettings().serial_telmex_only !== '0' && !TELMEX_RE.test(sn)) { results.push({ serial: sn, ok: false, error: /^2150080/.test(sn) ? 'Es el PROD ID: captura el Telmex S/N (HWTC…)' : 'No es un Telmex S/N (HWTC + 8 caracteres)' }); continue; }
        const ex = db.prepare('SELECT s.status, p.name FROM serials s JOIN products p ON p.id=s.product_id WHERE s.serial = ?').get(sn);
        if (ex) { results.push({ serial: sn, ok: false, error: `Ya registrado (${ex.name}, ${ex.status})` }); continue; }
        if (dry) { results.push({ serial: sn, ok: true }); continue; }
        const r = db.prepare('INSERT INTO serials (product_id, serial, reference, warehouse_id) VALUES (?,?,?,?)').run(p.id, sn, ref || null, whId);
        const sid = Number(r.lastInsertRowid);
        serialEvent(sid, 'recibido', null, req.user.id, ref || null);
        if (drv) {
          db.prepare("UPDATE serials SET holder_id=?, held_at=datetime('now') WHERE id=?").run(drv.id, sid);
          serialEvent(sid, 'repartidor', null, req.user.id, `Entregado a ${drv.name} al recibirlo${ref ? ' · ' + ref : ''}`);
          custodyLog(drv.id, p.id, 1, 'asignado', req.user.id, { serial: sn, reference: ref || 'Al recibir en almacén' });
        }
        results.push({ serial: sn, ok: true });
      }
      const n = dry ? 0 : results.filter((r) => r.ok).length;
      if (n) moveStock(p.id, 'entrada', n, `Recepción de ${n} S/N${ref ? ' · ' + ref : ''}`, req.user.id);
    });
    if (dry) return res.json({ dry_run: true, received: 0, errors: results.filter((r) => !r.ok), results, product: p.name, will_enable: enable, stock: p.stock, driver: drv?.name || null });
    const ok = results.filter((r) => r.ok).length;
    if (ok) audit(req, 'series.recibir', `${ok} S/N de ${p.name}${ref ? ' · ' + ref : ''}${drv ? ` → ${drv.name}` : ''}`);
    res.json({ received: ok, errors: results.filter((r) => !r.ok), results, product: p.name, driver: drv?.name || null, stock: db.prepare('SELECT stock FROM products WHERE id=?').get(p.id).stock });
  })
);

// ---------- Clientes mayoristas ----------
const ACC_FIELDS = ['name', 'legal_name', 'rfc', 'contact_name', 'phone', 'email', 'address', 'payment_terms', 'notes'];
function accountBody(b) {
  const out = {};
  for (const k of ACC_FIELDS) out[k] = b[k] == null ? null : String(b[k]).trim().slice(0, k === 'notes' || k === 'address' ? 500 : 120) || null;
  if (!out.name) throw new HttpError(400, 'Escribe el nombre del mayorista');
  if (out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) throw new HttpError(400, 'Correo no válido');
  for (const k of ['rate_delivery', 'rate_failed']) {
    const v = b[k] === '' || b[k] == null ? 0 : Number(b[k]);
    if (!Number.isFinite(v) || v < 0) throw new HttpError(400, 'La tarifa debe ser un número positivo');
    out[k] = Math.round(v * 100) / 100;
  }
  out.active = b.active === false || b.active === 0 || b.active === '0' ? 0 : 1;
  return out;
}
const ACC_STATS = `SELECT a.*,
    COUNT(o.id) orders_total,
    SUM(o.status = 'entregado') delivered,
    SUM(o.status = 'fallido') failed,
    SUM(o.status IN ('pendiente','asignado','cargado')) open,
    SUM(o.status = 'cancelado') cancelled,
    MAX(o.scheduled_date) last_date
  FROM accounts a LEFT JOIN orders o ON o.account_id = a.id`;
app.get('/api/accounts', auth(...STAFF), wrap((req, res) => {
  const rows = db.prepare(`${ACC_STATS} GROUP BY a.id ORDER BY a.active DESC, a.name`).all();
  const unassigned = db.prepare("SELECT COUNT(*) n FROM orders WHERE account_id IS NULL AND status <> 'cancelado'").get().n;
  res.json({ rows, unassigned });
}));
app.get('/api/accounts/:id', auth(...STAFF), wrap((req, res) => {
  const a = db.prepare(`${ACC_STATS} WHERE a.id = ? GROUP BY a.id`).get(req.params.id);
  if (!a) throw new HttpError(404, 'No encontrado');
  a.by_day = db.prepare(`SELECT scheduled_date day, COUNT(*) total, SUM(status='entregado') delivered, SUM(status='fallido') failed
    FROM orders WHERE account_id = ? GROUP BY scheduled_date ORDER BY scheduled_date DESC LIMIT 30`).all(a.id);
  res.json(a);
}));
app.post('/api/accounts', auth('admin'), wrap((req, res) => {
  const b = accountBody(req.body || {});
  try {
    const r = db.prepare(`INSERT INTO accounts (${Object.keys(b).join(',')}) VALUES (${Object.keys(b).map(() => '?').join(',')})`).run(...Object.values(b));
    audit(req, 'mayorista.alta', b.name);
    res.status(201).json({ id: Number(r.lastInsertRowid) });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw new HttpError(409, `Ya existe un mayorista llamado "${b.name}"`);
    throw e;
  }
}));
app.put('/api/accounts/:id', auth('admin'), wrap((req, res) => {
  const a = db.prepare('SELECT * FROM accounts WHERE id=?').get(req.params.id);
  if (!a) throw new HttpError(404, 'No encontrado');
  const b = accountBody({ ...a, ...req.body });
  try {
    db.prepare(`UPDATE accounts SET ${Object.keys(b).map((k) => `${k}=?`).join(', ')} WHERE id=?`).run(...Object.values(b), a.id);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw new HttpError(409, `Ya existe un mayorista llamado "${b.name}"`);
    throw e;
  }
  audit(req, 'mayorista.editar', b.name);
  res.json({ ok: true });
}));
// Ligar pedidos a un mayorista: { order_ids:[...] } o { date, only_unassigned } (todos los de un día)
app.post('/api/accounts/:id/orders', auth(...STAFF), wrap((req, res) => {
  const a = db.prepare('SELECT * FROM accounts WHERE id=?').get(req.params.id);
  if (!a) throw new HttpError(404, 'No encontrado');
  const b = req.body || {};
  let n = 0;
  tx(() => {
    if (Array.isArray(b.order_ids) && b.order_ids.length) {
      const up = db.prepare('UPDATE orders SET account_id=? WHERE id=?');
      for (const id of b.order_ids.slice(0, 5000)) n += up.run(a.id, Number(id)).changes;
    } else if (b.date) {
      n = db.prepare(`UPDATE orders SET account_id=? WHERE scheduled_date=? AND status <> 'cancelado' ${b.only_unassigned === false ? '' : 'AND account_id IS NULL'}`).run(a.id, String(b.date)).changes;
    } else if (b.all_unassigned) {
      n = db.prepare("UPDATE orders SET account_id=? WHERE account_id IS NULL AND status <> 'cancelado'").run(a.id).changes;
    } else throw new HttpError(400, 'Indica los pedidos');
  });
  audit(req, 'mayorista.pedidos', `${n} pedidos → ${a.name}`);
  res.json({ updated: n });
}));
app.put('/api/orders/:id/account', auth(...STAFF), wrap((req, res) => {
  const o = db.prepare('SELECT id, tracking_code FROM orders WHERE id=?').get(req.params.id);
  if (!o) throw new HttpError(404, 'No encontrado');
  if (!officeOrders(req, [o.id]).length) throw new HttpError(403, 'Este pedido es de otra oficina');
  const aid = req.body?.account_id ? Number(req.body.account_id) : null;
  if (aid && !db.prepare('SELECT 1 FROM accounts WHERE id=?').get(aid)) throw new HttpError(400, 'Mayorista no encontrado');
  db.prepare('UPDATE orders SET account_id=? WHERE id=?').run(aid, o.id);
  res.json({ ok: true });
}));
// Estado de cuenta: entregas y fallidos del periodo con la tarifa del mayorista (JSON o CSV para Excel)
app.get('/api/accounts/:id/statement', auth(...STAFF), wrap((req, res) => {
  const a = db.prepare('SELECT * FROM accounts WHERE id=?').get(req.params.id);
  if (!a) throw new HttpError(404, 'No encontrado');
  const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : today().slice(0, 8) + '01';
  const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') ? req.query.to : today();
  // se cobra por la fecha real de la entrega (o de la última visita sin entrega), no por la fecha programada
  const [uf, ut] = utcRange(from, to);
  const rows = db.prepare(`SELECT * FROM (SELECT o.tracking_code, o.scheduled_date, o.status, o.delivered_at, o.attempts, c.name customer, c.address, c.colonia, u.name driver,
      COALESCE(o.delivered_at, (SELECT MAX(e.created_at) FROM evidences e WHERE e.order_id = o.id AND e.result = 'fallido')) done_at, c.external_id telnor_phone,
      (SELECT receiver_name FROM evidences e WHERE e.order_id = o.id AND e.result = o.status ORDER BY e.id DESC LIMIT 1) receiver,
      (SELECT reason FROM evidences e WHERE e.order_id = o.id AND e.result = 'fallido' ORDER BY e.id DESC LIMIT 1) reason,
      (SELECT GROUP_CONCAT(s.serial, ' ') FROM serials s WHERE s.order_id = o.id) serials
    FROM orders o JOIN customers c ON c.id = o.customer_id LEFT JOIN users u ON u.id = o.driver_id
    WHERE o.account_id = ? AND o.status IN ('entregado','fallido')) WHERE done_at >= ? AND done_at < ?
    ORDER BY done_at, tracking_code`).all(a.id, uf, ut);
  const localDate = (u) => (u ? new Date(String(u).replace(' ', 'T') + 'Z').toLocaleDateString('en-CA') : '');
  for (const r of rows) { r.amount = r.status === 'entregado' ? a.rate_delivery : a.rate_failed; r.date = localDate(r.done_at); }
  const del = rows.filter((r) => r.status === 'entregado').length;
  const fail = rows.length - del;
  const sub = del * a.rate_delivery + fail * a.rate_failed;
  const iva = Math.round(sub * 0.16 * 100) / 100;
  const totals = { delivered: del, failed: fail, amount_delivered: del * a.rate_delivery, amount_failed: fail * a.rate_failed, total: sub, iva, total_iva: Math.round((sub + iva) * 100) / 100 };
  if (req.query.format === 'csv') {
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['Guía', 'Fecha de entrega', 'Resultado', 'Fecha programada', 'Cliente', 'Teléfono Telnor', 'Domicilio', 'Colonia', 'Repartidor', 'Recibió', 'Motivo', 'S/N', 'Importe'];
    const lines = rows.map((r) => [r.tracking_code, r.date, r.status, r.scheduled_date || '', r.customer, r.telnor_phone || '', r.address, r.colonia, r.driver, r.receiver, r.reason, r.serials, r.amount.toFixed(2)].map(q).join(','));
    lines.push('', [q('Entregados'), del, q('Tarifa'), a.rate_delivery.toFixed(2), q('Importe'), totals.amount_delivered.toFixed(2)].join(','));
    lines.push([q('Fallidos'), fail, q('Tarifa'), a.rate_failed.toFixed(2), q('Importe'), totals.amount_failed.toFixed(2)].join(','));
    lines.push([q('Subtotal'), '', '', '', '', totals.total.toFixed(2)].join(','));
    lines.push([q('IVA 16%'), '', '', '', '', totals.iva.toFixed(2)].join(','));
    lines.push([q('TOTAL a facturar'), '', '', '', '', totals.total_iva.toFixed(2)].join(','));
    const fname = `estado-de-cuenta-${a.name.replace(/[^\w-]+/g, '_')}-${from}-a-${to}.csv`;
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    return res.type('text/csv; charset=utf-8').send('﻿' + head.map(q).join(',') + '\n' + lines.join('\n'));
  }
  res.json({ account: a, from, to, rows, totals });
}));

// ---- Facturación al mayorista: lo pendiente de facturar (entregado o fallido y aún en ningún estado de cuenta) y los cortes generados ----
const BILL_COLS = `o.id order_id, o.tracking_code, o.scheduled_date, o.status, o.delivered_at, c.name customer, c.address, c.colonia, u.name driver,
      COALESCE(o.delivered_at, (SELECT MAX(e.created_at) FROM evidences e WHERE e.order_id = o.id AND e.result = 'fallido')) done_at, c.external_id telnor_phone,
      (SELECT receiver_name FROM evidences e WHERE e.order_id = o.id AND e.result = o.status ORDER BY e.id DESC LIMIT 1) receiver,
      (SELECT reason FROM evidences e WHERE e.order_id = o.id AND e.result = 'fallido' ORDER BY e.id DESC LIMIT 1) reason,
      (SELECT GROUP_CONCAT(s.serial, ' ') FROM serials s WHERE s.order_id = o.id) serials`;
const billDate = (u) => (u ? new Date(String(u).replace(' ', 'T') + 'Z').toLocaleDateString('en-CA', { timeZone: 'America/Tijuana' }) : '');
const money2b = (n) => Math.round(n * 100) / 100;
function billTotals(rows) {
  const del = rows.filter((r) => r.status === 'entregado');
  const sub = money2b(rows.reduce((a, r) => a + (r.amount || 0), 0));
  const iva = money2b(sub * 0.16);
  return { delivered: del.length, failed: rows.length - del.length, amount_delivered: money2b(del.reduce((a, r) => a + r.amount, 0)), amount_failed: money2b(sub - del.reduce((a, r) => a + r.amount, 0)), total: sub, iva, total_iva: money2b(sub + iva) };
}
function pendingBill(a, to) {
  const [, ut] = utcRange(to, to);
  const rows = db.prepare(`SELECT * FROM (SELECT ${BILL_COLS} FROM orders o JOIN customers c ON c.id = o.customer_id LEFT JOIN users u ON u.id = o.driver_id
    WHERE o.account_id = ? AND o.status IN ('entregado','fallido') AND NOT EXISTS (SELECT 1 FROM account_invoice_items i WHERE i.order_id = o.id))
    WHERE done_at IS NOT NULL AND done_at < ? ORDER BY done_at, tracking_code`).all(a.id, ut);
  for (const r of rows) { r.amount = r.status === 'entregado' ? a.rate_delivery : a.rate_failed; r.date = billDate(r.done_at); }
  return rows;
}
app.get('/api/accounts/:id/billing', auth(...STAFF), wrap((req, res) => {
  const a = db.prepare('SELECT * FROM accounts WHERE id=?').get(req.params.id);
  if (!a) throw new HttpError(404, 'No encontrado');
  const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') ? req.query.to : today();
  const rows = pendingBill(a, to);
  const invoices = db.prepare("SELECT i.*, u.name created_by_name FROM account_invoices i LEFT JOIN users u ON u.id = i.created_by WHERE i.account_id = ? AND i.status <> 'cancelado' ORDER BY i.id DESC").all(a.id);
  const billed = invoices.reduce((x, i) => ({ n: x.n + i.delivered + i.failed, total: money2b(x.total + i.total), paid: money2b(x.paid + (i.paid_at ? i.total : 0)) }), { n: 0, total: 0, paid: 0 });
  res.json({ account: a, to, rows, totals: billTotals(rows), invoices, billed });
}));
app.post('/api/accounts/:id/invoices', auth('admin'), wrap((req, res) => {
  const a = db.prepare('SELECT * FROM accounts WHERE id=?').get(req.params.id);
  if (!a) throw new HttpError(404, 'No encontrado');
  const ids = new Set((Array.isArray(req.body?.order_ids) ? req.body.order_ids : []).map(Number).filter(Boolean));
  if (!ids.size) throw new HttpError(400, 'Marca lo que vas a facturar');
  const rows = pendingBill(a, today()).filter((r) => ids.has(r.order_id));
  if (!rows.length) throw new HttpError(409, 'Esos pedidos ya están en otro estado de cuenta o no están entregados/fallidos');
  const t = billTotals(rows);
  const n = db.prepare('SELECT COUNT(*) n FROM account_invoices WHERE account_id=?').get(a.id).n + 1;
  const folio = `EC-${String(a.id).padStart(2, '0')}-${String(n).padStart(4, '0')}`;
  const id = tx(() => {
    const r = db.prepare(`INSERT INTO account_invoices (account_id, folio, period_from, period_to, delivered, failed, subtotal, iva, total, rate_delivery, rate_failed, notes, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(a.id, folio, rows[0].date, rows[rows.length - 1].date, t.delivered, t.failed, t.total, t.iva, t.total_iva, a.rate_delivery, a.rate_failed,
      String(req.body?.notes || '').trim().slice(0, 300) || null, req.user.id);
    const iid = Number(r.lastInsertRowid);
    const ins = db.prepare('INSERT INTO account_invoice_items (invoice_id, order_id, result, done_at, amount) VALUES (?,?,?,?,?)');
    for (const x of rows) ins.run(iid, x.order_id, x.status, x.done_at, x.amount);
    return iid;
  });
  audit(req, 'mayorista.estado_cuenta', `${a.name} ${folio}: ${rows.length} pedidos, ${t.total_iva.toFixed(2)} con IVA`);
  res.status(201).json({ id, folio, totals: t });
}));
app.get('/api/accounts/:id/invoices/:inv', auth(...STAFF), wrap((req, res) => {
  const i = db.prepare('SELECT i.*, a.name account_name, a.legal_name, a.rfc FROM account_invoices i JOIN accounts a ON a.id = i.account_id WHERE i.id=? AND i.account_id=?').get(req.params.inv, req.params.id);
  if (!i) throw new HttpError(404, 'No encontrado');
  const rows = db.prepare(`SELECT ${BILL_COLS}, it.result, it.amount, it.done_at billed_done FROM account_invoice_items it JOIN orders o ON o.id = it.order_id JOIN customers c ON c.id = o.customer_id LEFT JOIN users u ON u.id = o.driver_id
    WHERE it.invoice_id = ? ORDER BY it.done_at, o.tracking_code`).all(i.id);
  for (const r of rows) { r.status = r.result; r.date = billDate(r.billed_done); }
  res.json({ invoice: i, rows });
}));
app.put('/api/accounts/:id/invoices/:inv', auth('admin'), wrap((req, res) => {
  const i = db.prepare('SELECT * FROM account_invoices WHERE id=? AND account_id=?').get(req.params.inv, req.params.id);
  if (!i) throw new HttpError(404, 'No encontrado');
  const b = req.body || {};
  db.prepare('UPDATE account_invoices SET invoice_ref=?, notes=?, paid_at=? WHERE id=?').run(
    b.invoice_ref !== undefined ? String(b.invoice_ref || '').trim().slice(0, 80) || null : i.invoice_ref,
    b.notes !== undefined ? String(b.notes || '').trim().slice(0, 300) || null : i.notes,
    b.paid !== undefined ? (b.paid ? i.paid_at || today() : null) : i.paid_at, i.id);
  audit(req, 'mayorista.estado_cuenta', `${i.folio}: ${b.paid !== undefined ? (b.paid ? 'pagado' : 'sin pagar') : 'datos de factura'}`);
  res.json({ ok: true });
}));
// cancelar un estado de cuenta: sus pedidos vuelven a quedar por facturar
app.delete('/api/accounts/:id/invoices/:inv', auth('admin'), wrap((req, res) => {
  const i = db.prepare("SELECT * FROM account_invoices WHERE id=? AND account_id=? AND status <> 'cancelado'").get(req.params.inv, req.params.id);
  if (!i) throw new HttpError(404, 'No encontrado');
  if (i.paid_at) throw new HttpError(409, 'Está marcado como pagado: quita la marca de pagado antes de cancelarlo');
  tx(() => {
    db.prepare('DELETE FROM account_invoice_items WHERE invoice_id=?').run(i.id);
    db.prepare("UPDATE account_invoices SET status='cancelado' WHERE id=?").run(i.id);
  });
  audit(req, 'mayorista.estado_cuenta', `${i.folio} cancelado: sus pedidos vuelven a quedar por facturar`);
  res.json({ ok: true });
}));

// ---------- Expediente del personal ----------
const PROFILE_TXT = ['hire_type', 'hire_date', 'end_date', 'birth_date', 'address', 'emergency_name', 'emergency_phone', 'rfc', 'curp', 'nss',
  'bank_name', 'clabe', 'account_number', 'account_holder', 'pay_period', 'notes',
  'persona_tipo', 'regimen_fiscal', 'id_tipo', 'id_numero', 'rep_legal_nombre', 'escritura_dato', 'vehiculo_tipo', 'vehiculo_marca_modelo', 'vehiculo_placas',
  'licencia_numero', 'licencia_vigencia', 'seguro_aseguradora', 'seguro_poliza', 'tiene_empleados'];
// Cumplimiento mínimo para dar de alta a personal (sobre todo externo)
const kyc = require('./kyc');
const STAFF_DOCS = kyc.DOCS;
// documentos obligatorios de una persona: los de identidad, fiscales y bancarios; los del vehículo si reparte; REPSE si es persona moral o tiene empleados
function requiredDocs(userId) {
  const u = db.prepare('SELECT role, can_deliver FROM users WHERE id=?').get(userId) || {};
  const p = db.prepare('SELECT persona_tipo, tiene_empleados FROM staff_profiles WHERE user_id=?').get(userId) || {};
  return kyc.required({ conduce: u.role === 'repartidor' || !!u.can_deliver, repse: /moral/i.test(p.persona_tipo || '') || p.tiene_empleados === 'si' });
}
// lo que impide firmar el contrato u operar: documentos obligatorios sin aprobar o vencidos
function docBlockers(userId) {
  const docs = docsOf(userId); const t = today();
  return requiredDocs(userId).map((k) => { const d = docs[k] || {}; const l = STAFF_DOCS.find(([x]) => x === k)[1]; if (!d.ok) return `${l}${d.status === 'pendiente' ? ' (por revisar)' : d.status === 'rechazado' ? ' (rechazado)' : ''}`; if (d.expires && d.expires < t) return `${l} (vencido el ${d.expires})`; return null; }).filter(Boolean);
}
const RFC_RE = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;
const CURP_RE = /^[A-Z][AEIOUX][A-Z]{2}\d{6}[HM][A-Z]{2}[B-DF-HJ-NP-TV-Z]{3}[A-Z0-9]\d$/;
function clabeOk(c) {
  if (!/^\d{18}$/.test(c)) return false;
  const w = [3, 7, 1];
  const sum = [...c.slice(0, 17)].reduce((a, d, i) => a + ((Number(d) * w[i % 3]) % 10), 0);
  return (10 - (sum % 10)) % 10 === Number(c[17]);
}
function profileOf(userId) {
  const p = db.prepare('SELECT * FROM staff_profiles WHERE user_id=?').get(userId) || { user_id: Number(userId), hire_type: 'externo', pay_per_delivery: 0, pay_per_failed: 0, pay_period: 'semanal' };
  const docs = (() => { try { return JSON.parse(p.docs_json || '{}'); } catch { return {}; } })();
  const today0 = today();
  // obligatorios según su perfil (reparte, persona moral o con empleados)
  const reqK = requiredDocs(userId);
  const need = STAFF_DOCS.filter(([k]) => reqK.includes(k));
  const missing = need.filter(([k]) => !docs[k]?.ok).map(([, l]) => l);
  const expired = STAFF_DOCS.filter(([k]) => docs[k]?.ok && docs[k]?.expires && docs[k].expires < today0).map(([, l]) => l);
  return { ...p, docs: publicDocs(docs), doc_list: STAFF_DOCS, required: reqK, missing, expired, complete: !missing.length && !expired.length, blockers: docBlockers(userId),
    pending_docs: Object.values(docs).filter((d) => d.status === 'pendiente').length };
}
app.get('/api/users/:id/profile', auth('admin'), wrap((req, res) => {
  if (!db.prepare('SELECT 1 FROM users WHERE id=?').get(req.params.id)) throw new HttpError(404, 'No encontrado');
  res.json(profileOf(req.params.id));
}));
app.put('/api/users/:id/profile', auth('admin'), wrap((req, res) => {
  const u = db.prepare('SELECT id, name FROM users WHERE id=?').get(req.params.id);
  if (!u) throw new HttpError(404, 'No encontrado');
  const b = req.body || {};
  const cur = db.prepare('SELECT * FROM staff_profiles WHERE user_id=?').get(u.id) || {};
  const v = {};
  for (const k of PROFILE_TXT) v[k] = b[k] === undefined ? cur[k] ?? null : String(b[k] ?? '').trim().slice(0, k === 'address' || k === 'notes' ? 400 : 120) || null;
  v.hire_type = v.hire_type === 'interno' ? 'interno' : 'externo';
  for (const k of ['rfc', 'curp']) if (v[k]) v[k] = v[k].toUpperCase().replace(/\s+/g, '');
  if (v.rfc && !RFC_RE.test(v.rfc)) throw new HttpError(400, 'El RFC no tiene un formato válido (12 o 13 caracteres)');
  if (v.curp && !CURP_RE.test(v.curp)) throw new HttpError(400, 'La CURP no tiene un formato válido (18 caracteres)');
  if (v.clabe) { v.clabe = v.clabe.replace(/\D/g, ''); if (!clabeOk(v.clabe)) throw new HttpError(400, 'La CLABE debe tener 18 dígitos y su dígito verificador no coincide'); }
  for (const k of ['pay_per_delivery', 'pay_per_failed', 'team_pay_per_delivery', 'team_pay_pct']) {
    const n = b[k] === undefined || b[k] === '' ? Number(cur[k] || 0) : Number(b[k]);
    if (k === 'team_pay_pct' && n > 100) throw new HttpError(400, 'El porcentaje del equipo no puede pasar de 100');
    if (!Number.isFinite(n) || n < 0) throw new HttpError(400, 'El monto de pago debe ser un número positivo');
    v[k] = Math.round(n * 100) / 100;
  }
  let docs = cur.docs_json || '{}';
  if (b.docs && typeof b.docs === 'object') {
    const prev = (() => { try { return JSON.parse(cur.docs_json || '{}'); } catch { return {}; } })();
    const clean = {};
    for (const [k] of STAFF_DOCS) {
      if (!b.docs[k] && !prev[k]) continue;
      const nd = b.docs[k] || prev[k];
      const ok = !!nd.ok;
      clean[k] = { ...prev[k], ok, expires: /^\d{4}-\d{2}-\d{2}$/.test(nd.expires || '') ? nd.expires : null,
        status: ok ? 'aprobado' : prev[k]?.status === 'aprobado' ? (prev[k]?.file ? 'pendiente' : null) : prev[k]?.status || null };
    }
    docs = JSON.stringify(clean);
  }
  let photo = cur.photo_path || null;
  if (b.photo === null) photo = null;
  else if (typeof b.photo === 'string' && b.photo.startsWith('data:')) photo = saveDataUrl(b.photo, 'personal');
  const cols = [...PROFILE_TXT, 'pay_per_delivery', 'pay_per_failed', 'team_pay_per_delivery', 'team_pay_pct'];
  db.prepare(`INSERT INTO staff_profiles (user_id, ${cols.join(',')}, docs_json, photo_path, updated_at) VALUES (?, ${cols.map(() => '?').join(',')}, ?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET ${cols.map((c) => `${c}=excluded.${c}`).join(', ')}, docs_json=excluded.docs_json, photo_path=excluded.photo_path, updated_at=datetime('now')`)
    .run(u.id, ...cols.map((c) => v[c]), docs, photo);
  audit(req, 'personal.expediente', u.name);
  res.json(profileOf(u.id));
}));
// Pago del periodo según entregas (y fallidos) registrados a su nombre
app.get('/api/users/:id/pay', auth('admin'), wrap((req, res) => {
  const p = profileOf(req.params.id);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : today().slice(0, 8) + '01';
  const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') ? req.query.to : today();
  const r = db.prepare(`SELECT SUM(result='entregado') delivered, SUM(result='fallido') failed FROM evidences
    WHERE driver_id=? AND date(created_at) BETWEEN ? AND ?`).get(req.params.id, from, to);
  const d = r.delivered || 0, f = r.failed || 0;
  res.json({ from, to, delivered: d, failed: f, rate_delivery: p.pay_per_delivery, rate_failed: p.pay_per_failed,
    amount: Math.round((d * p.pay_per_delivery + f * p.pay_per_failed) * 100) / 100 });
}));

// ---------- Capital Humano: ganancias, pagos y saldos por periodo de pago ----------
const isoD = (d) => d.toLocaleDateString('en-CA');
// periodo que contiene la fecha (offset -1 = el anterior): semanal lun–dom, quincenal 1–15 / 16–fin, mensual
function payPeriod(type, dateStr, offset = 0) {
  const d = new Date(dateStr + 'T12:00:00');
  if (type === 'semanal') {
    const st = new Date(d); st.setDate(d.getDate() - ((d.getDay() + 6) % 7) + offset * 7);
    const en = new Date(st); en.setDate(st.getDate() + 6);
    return { from: isoD(st), to: isoD(en) };
  }
  if (type === 'quincenal') {
    let half = d.getFullYear() * 24 + d.getMonth() * 2 + (d.getDate() > 15 ? 1 : 0) + offset;
    const y = Math.floor(half / 24), m = Math.floor((half % 24) / 2), h = half % 2;
    return { from: isoD(new Date(y, m, h ? 16 : 1, 12)), to: isoD(h ? new Date(y, m + 1, 0, 12) : new Date(y, m, 15, 12)) };
  }
  const st = new Date(d.getFullYear(), d.getMonth() + offset, 1, 12);
  return { from: isoD(st), to: isoD(new Date(st.getFullYear(), st.getMonth() + 1, 0, 12)) };
}
const PAY_KINDS = ['pago', 'anticipo', 'bono', 'descuento'];
const money2 = (x) => Math.round((Number(x) || 0) * 100) / 100;
function hrSummary(uid, p, from, to) {
  const ev = db.prepare(`SELECT SUM(result='entregado') d, SUM(result='fallido') f FROM evidences WHERE driver_id=? AND date(created_at,'localtime') BETWEEN ? AND ?`).get(uid, from, to);
  const mv = db.prepare('SELECT kind, SUM(amount) n FROM staff_payments WHERE user_id=? AND date BETWEEN ? AND ? GROUP BY kind').all(uid, from, to);
  const k = Object.fromEntries(PAY_KINDS.map((x) => [x, money2(mv.find((m) => m.kind === x)?.n)]));
  const delivered = ev.d || 0, failed = ev.f || 0;
  const own = money2(delivered * (p.pay_per_delivery || 0) + failed * (p.pay_per_failed || 0));
  // personal a cargo: un monto por cada entrega de su equipo y/o un porcentaje de lo que gana su equipo
  let team = { members: 0, delivered: 0, earned: 0, pay: 0 };
  if ((p.team_pay_per_delivery || 0) > 0 || (p.team_pay_pct || 0) > 0) {
    const mem = db.prepare('SELECT id FROM users WHERE reports_to=? AND deleted_at IS NULL').all(uid).map((r) => r.id);
    for (const m of mem) {
      const pm = db.prepare('SELECT pay_per_delivery, pay_per_failed FROM staff_profiles WHERE user_id=?').get(m) || {};
      const e = db.prepare(`SELECT SUM(result='entregado') d, SUM(result='fallido') f FROM evidences WHERE driver_id=? AND date(created_at,'localtime') BETWEEN ? AND ?`).get(m, from, to);
      team.delivered += e.d || 0;
      team.earned += (e.d || 0) * (pm.pay_per_delivery || 0) + (e.f || 0) * (pm.pay_per_failed || 0);
    }
    team.members = mem.length;
    team.pay = money2(team.delivered * (p.team_pay_per_delivery || 0) + (team.earned * (p.team_pay_pct || 0)) / 100);
    team.earned = money2(team.earned);
  }
  const earned = money2(own + team.pay);
  return { from, to, delivered, failed, own, team, earned, ...k, paid: money2(k.pago + k.anticipo), balance: money2(earned + k.bono - k.descuento - k.pago - k.anticipo) };
}
// saldo acumulado: todo lo ganado (con su tarifa actual) + bonos − descuentos − pagos y anticipos
function hrTotal(uid, p) {
  const first = db.prepare("SELECT MIN(date(created_at,'localtime')) d FROM evidences WHERE driver_id=?").get(uid).d;
  const firstPay = db.prepare('SELECT MIN(date) d FROM staff_payments WHERE user_id=?').get(uid).d;
  const from = [p.hire_date, first, firstPay].filter(Boolean).sort()[0] || today();
  return hrSummary(uid, p, from, '9999-12-31').balance;
}
app.get('/api/hr', auth('admin'), wrap((req, res) => {
  const okD = (x) => /^\d{4}-\d{2}-\d{2}$/.test(x || '');
  const custom = okD(req.query.from) && okD(req.query.to) ? { from: req.query.from, to: req.query.to } : null;
  const off = Math.max(-24, Math.min(0, Number(req.query.offset) || 0));
  const users = db.prepare(`SELECT u.id, u.name, u.role, u.active, u.vehicle, u.can_deliver, (SELECT name FROM warehouses w WHERE w.id = u.office_id) office FROM users u
    WHERE u.deleted_at IS NULL AND (u.role = 'repartidor' OR u.can_deliver = 1 OR EXISTS (SELECT 1 FROM staff_profiles sp WHERE sp.user_id = u.id AND (sp.pay_per_delivery > 0 OR sp.pay_per_failed > 0 OR sp.team_pay_per_delivery > 0 OR sp.team_pay_pct > 0))
      OR EXISTS (SELECT 1 FROM staff_payments x WHERE x.user_id = u.id)) ORDER BY u.active DESC, u.name`).all();
  const rows = users.map((u) => {
    const p = profileOf(u.id);
    const per = custom || payPeriod(p.pay_period || 'semanal', today(), off);
    return { ...u, hire_type: p.hire_type, pay_period: p.pay_period || 'semanal', rate_delivery: p.pay_per_delivery || 0, rate_failed: p.pay_per_failed || 0, team_rate: p.team_pay_per_delivery || 0, team_pct: p.team_pay_pct || 0,
      bank: p.bank_name || '', clabe: p.clabe || '', ...hrSummary(u.id, p, per.from, per.to), total_balance: hrTotal(u.id, p) };
  });
  res.json({ offset: off, custom: !!custom, rows });
}));
app.get('/api/hr/:id', auth('admin'), wrap((req, res) => {
  const u = db.prepare('SELECT id, name, role, active FROM users WHERE id=?').get(Number(req.params.id));
  if (!u) throw new HttpError(404, 'Colaborador no encontrado');
  const p = profileOf(u.id);
  const type = p.pay_period || 'semanal';
  const periods = Array.from({ length: 12 }, (_, i) => { const per = payPeriod(type, today(), -i); return hrSummary(u.id, p, per.from, per.to); });
  const moves = db.prepare('SELECT m.*, b.name by_name FROM staff_payments m LEFT JOIN users b ON b.id = m.by_user WHERE m.user_id=? ORDER BY m.date DESC, m.id DESC LIMIT 200').all(u.id);
  res.json({ ...u, pay_period: type, hire_type: p.hire_type, rate_delivery: p.pay_per_delivery || 0, rate_failed: p.pay_per_failed || 0, bank: p.bank_name || '', clabe: p.clabe || '', account_holder: p.account_holder || '', periods, moves, total_balance: hrTotal(u.id, p) });
}));
app.post('/api/hr/movements', auth('admin'), wrap((req, res) => {
  const b = req.body || {};
  const u = db.prepare('SELECT id, name FROM users WHERE id=?').get(Number(b.user_id));
  if (!u) throw new HttpError(400, 'Elige al colaborador');
  if (!PAY_KINDS.includes(b.kind)) throw new HttpError(400, 'Elige el tipo de movimiento');
  const amount = money2(b.amount);
  if (!(amount > 0)) throw new HttpError(400, 'Escribe un monto mayor a cero');
  const okD = (x) => /^\d{4}-\d{2}-\d{2}$/.test(x || '');
  const date = okD(b.date) ? b.date : today();
  const txt = (x, n) => String(x || '').trim().slice(0, n) || null;
  const r = db.prepare('INSERT INTO staff_payments (user_id, kind, amount, date, period_from, period_to, method, reference, notes, by_user) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(u.id, b.kind, amount, date, okD(b.period_from) ? b.period_from : null, okD(b.period_to) ? b.period_to : null, txt(b.method, 40), txt(b.reference, 80), txt(b.notes, 300), req.user.id);
  audit(req, 'capital.movimiento', `${u.name}: ${b.kind} $${amount.toFixed(2)} (${date})${b.period_from ? ` · periodo ${b.period_from} a ${b.period_to}` : ''}`);
  res.status(201).json({ id: Number(r.lastInsertRowid) });
}));
app.delete('/api/hr/movements/:id', auth('admin'), wrap((req, res) => {
  const m = db.prepare('SELECT m.*, u.name FROM staff_payments m JOIN users u ON u.id = m.user_id WHERE m.id=?').get(Number(req.params.id));
  if (!m) throw new HttpError(404, 'Movimiento no encontrado');
  db.prepare('DELETE FROM staff_payments WHERE id=?').run(m.id);
  audit(req, 'capital.eliminar', `${m.name}: ${m.kind} $${Number(m.amount).toFixed(2)} del ${m.date} eliminado`);
  res.json({ ok: true });
}));

// ---------- Contrato con firma electrónica ----------
const contract = require('./contract');
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const fmtLocal = (d = new Date()) => d.toLocaleString('es-MX', { timeZone: process.env.TZ || 'America/Tijuana', dateStyle: 'long', timeStyle: 'medium' }) + ` (${process.env.TZ || 'America/Tijuana'})`;
// variables del contrato con los datos del expediente y del usuario
function contractVars(uid) {
  const u = db.prepare('SELECT id, name, email, phone, vehicle FROM users WHERE id=?').get(uid);
  const p = db.prepare('SELECT * FROM staff_profiles WHERE user_id=?').get(uid) || {};
  const moral = /moral/i.test(p.persona_tipo || '');
  return {
    prestador_tipo_persona: moral ? 'Moral' : 'Física',
    prestador_nombre_o_razon_social: u.name,
    bloque_representante_moral: moral && p.rep_legal_nombre ? `, representada en este acto por su Representante Legal el C. ${p.rep_legal_nombre},` : '',
    bloque_escritura_moral: moral && p.escritura_dato ? `, constituida mediante Escritura Pública ${p.escritura_dato}` : '',
    prestador_regimen_fiscal: p.regimen_fiscal, prestador_rfc: p.rfc, prestador_curp: p.curp,
    prestador_tipo_identificacion: p.id_tipo || 'Credencial para Votar (INE)', prestador_numero_identificacion: p.id_numero,
    prestador_domicilio_completo: p.address, prestador_telefono: u.phone, prestador_email: u.email,
    prestador_clabe: p.clabe, prestador_banco: p.bank_name, prestador_titular_cuenta: p.account_holder,
    vehiculo_tipo: p.vehiculo_tipo, vehiculo_marca_modelo: p.vehiculo_marca_modelo, vehiculo_placas: p.vehiculo_placas || '',
    vehiculo_licencia_numero: p.licencia_numero, vehiculo_licencia_vigencia: p.licencia_vigencia,
    seguro_aseguradora: p.seguro_aseguradora, seguro_poliza_numero: p.seguro_poliza,
  };
}
const contractRow = (c) => c && ({ id: c.id, folio: c.folio, status: c.status, issued_at: c.issued_at, signed_at: c.signed_at, otp_channel: c.otp_channel,
  pdf: !!c.pdf_file, pdf_sha256: c.pdf_sha256, identity_ok_at: c.identity_ok_at, is_test: !!c.is_test, nom151_status: c.nom151_status, nom151_folio: c.nom151_folio, nom151_error: c.nom151_error, nom151_at: c.nom151_at,
  link: c.status === 'enviado' ? `${notify.baseUrl(getSettings())}/firma/${c.token}` : null, meta: (() => { try { return JSON.parse(c.meta_json || 'null'); } catch { return null; } })() });
app.get('/api/users/:id/contract', auth('admin'), wrap((req, res) => {
  const u = db.prepare('SELECT id FROM users WHERE id=?').get(Number(req.params.id));
  if (!u) throw new HttpError(404, 'No encontrado');
  const vars = contractVars(u.id);
  res.json({ vars, missing: contract.missingVars(vars), blockers: docBlockers(u.id), psc: !!getSettings().psc_url, contracts: db.prepare('SELECT * FROM contracts WHERE user_id=? ORDER BY id DESC').all(u.id).map(contractRow) });
}));
// genera el contrato con sus datos y le envía el enlace para firmarlo (SMS y correo)
app.post('/api/users/:id/contract', auth('admin'), wrap(async (req, res) => {
  const u = db.prepare('SELECT id, name, email, phone FROM users WHERE id=?').get(Number(req.params.id));
  if (!u) throw new HttpError(404, 'No encontrado');
  const vars = contractVars(u.id);
  const miss = contract.missingVars(vars);
  if (miss.length) throw new HttpError(400, `Completa en el expediente: ${miss.join(', ')}`);
  const blk = docBlockers(u.id);
  if (blk.length) throw new HttpError(400, `Faltan documentos aprobados: ${blk.join(', ')}`);
  const s = getSettings();
  const html = contract.fill(s.contract_template || null, vars);
  const folio = `CT-${today().replace(/-/g, '')}-${String(u.id).padStart(4, '0')}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
  const token = crypto.randomBytes(24).toString('base64url');
  const text = sha256(html);
  const company = sha256(`${folio}|${text}|${req.user.id}|${new Date().toISOString()}`);
  tx(() => {
    db.prepare("UPDATE contracts SET status='anulado' WHERE user_id=? AND status='enviado'").run(u.id);
    db.prepare('INSERT INTO contracts (user_id, folio, token, vars_json, html, text_sha256, issued_by, company_sha256) VALUES (?,?,?,?,?,?,?,?)').run(u.id, folio, token, JSON.stringify(vars), html, text, req.user.id, company);
  });
  const link = `${notify.baseUrl(s)}/firma/${token}`;
  const sent = [];
  const msg = `${s.company_name || 'Sovime'}: tu contrato de prestación de servicios está listo para firmarse electrónicamente. Ábrelo aquí: ${link}`;
  if (s.practice_mode !== '1') {
    if (u.phone) { try { const r = await notify.sendSMS(s, notify.phoneE164(u.phone), msg); if (!r?.simulated) sent.push('SMS'); } catch (e) { console.error('contrato sms', e.message); } }
    if (u.email) { try { const r = await notify.sendEmail(s, u.email, 'Tu contrato para firma electrónica', msg); if (!r?.simulated) sent.push('correo'); } catch (e) { console.error('contrato correo', e.message); } }
  }
  audit(req, 'contrato.enviar', `${u.name}: ${folio}${sent.length ? ' por ' + sent.join(' y ') : ' (comparte el enlace)'}`);
  res.status(201).json({ folio, link, sent });
}));
// contrato de prueba para el administrador (datos de ejemplo, folio PRUEBA): sirve para revisar el envío, la sesión de firma y el PDF
async function sendTestContract(userId, byUserId) {
  const u = db.prepare('SELECT id, name, email, phone FROM users WHERE id=?').get(userId);
  if (!u?.email) throw new HttpError(400, 'Tu usuario no tiene correo');
  const s = getSettings();
  const vars = { prestador_tipo_persona: 'Física', prestador_nombre_o_razon_social: `PRUEBA — ${u.name}`, prestador_regimen_fiscal: 'Régimen Simplificado de Confianza (RESICO)',
    prestador_rfc: 'XAXX010101000', prestador_curp: 'XEXX010101HNEXXXA4', prestador_tipo_identificacion: 'Credencial para Votar (INE)', prestador_numero_identificacion: '0000000000000',
    prestador_domicilio_completo: 'Domicilio de prueba, C.P. 22000, Tijuana, B.C.', prestador_telefono: u.phone || '—', prestador_email: u.email,
    prestador_clabe: '000000000000000000', prestador_banco: 'Banco de prueba', prestador_titular_cuenta: 'PRUEBA', vehiculo_tipo: 'Motocicleta', vehiculo_marca_modelo: 'Vehículo de prueba',
    vehiculo_placas: 'PRUEBA', vehiculo_licencia_numero: 'PRUEBA', vehiculo_licencia_vigencia: '2030-12-31', seguro_aseguradora: 'Aseguradora de prueba', seguro_poliza_numero: 'PRUEBA' };
  const html = contract.fill(s.contract_template || null, vars);
  const folio = `PRUEBA-${today().replace(/-/g, '')}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
  const token = crypto.randomBytes(24).toString('base64url');
  db.prepare('INSERT INTO contracts (user_id, folio, token, vars_json, html, text_sha256, issued_by, company_sha256, is_test) VALUES (?,?,?,?,?,?,?,?,1)')
    .run(u.id, folio, token, JSON.stringify(vars), html, sha256(html), byUserId, sha256(folio + html), );
  const link = `${notify.baseUrl(s)}/firma/${token}`;
  const r = await notify.sendEmail(s, u.email, `Prueba: contrato para firma electrónica (${folio})`,
    `Este es un contrato de PRUEBA con datos de ejemplo para revisar la firma electrónica.\n\nÁbrelo desde tu celular: ${link}\n\nPasos: leer y aceptar, permitir la ubicación, tomar selfie y fotos de INE, subir CSF y póliza (pueden ser fotos cualesquiera para la prueba), firmar con el dedo y escribir el código que llegará por SMS y correo.\n\nAl firmarlo se genera el PDF con su certificado; no se guarda en ningún expediente.`);
  return { folio, link, sent: !r?.simulated, to: u.email };
}
app.post('/api/contracts/test', auth('admin'), wrap(async (req, res) => {
  const r = await sendTestContract(req.user.id, req.user.id);
  audit(req, 'contrato.prueba', `${r.folio} enviado a ${r.to}`);
  res.status(201).json(r);
}));
app.post('/api/contracts/:id/cancel', auth('admin'), wrap((req, res) => {
  const c = db.prepare('SELECT c.*, u.name FROM contracts c JOIN users u ON u.id=c.user_id WHERE c.id=?').get(Number(req.params.id));
  if (!c) throw new HttpError(404, 'No encontrado');
  if (c.status !== 'enviado') throw new HttpError(409, 'Solo se anula un contrato que aún no se firma');
  db.prepare("UPDATE contracts SET status='anulado' WHERE id=?").run(c.id);
  audit(req, 'contrato.anular', `${c.name}: ${c.folio}`);
  res.json({ ok: true });
}));
app.get('/api/contracts/:id/pdf', auth('admin'), wrap((req, res) => {
  const c = db.prepare('SELECT * FROM contracts WHERE id=?').get(Number(req.params.id));
  if (!c?.pdf_file) throw new HttpError(404, 'El contrato aún no está firmado');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${c.folio}.pdf"`);
  res.sendFile(path.join(DOCS_DIR, c.pdf_file));
}));
app.get('/api/contracts/:id/kyc/:k', auth('admin'), wrap((req, res) => {
  const c = db.prepare('SELECT kyc_json FROM contracts WHERE id=?').get(Number(req.params.id));
  const f = (() => { try { return JSON.parse(c?.kyc_json || '{}'); } catch { return {}; } })()[req.params.k];
  if (!f) throw new HttpError(404, 'Sin archivo');
  res.sendFile(path.join(DOCS_DIR, f));
}));
app.post('/api/contracts/:id/identity', auth('admin'), wrap((req, res) => {
  const c = db.prepare('SELECT c.*, u.name FROM contracts c JOIN users u ON u.id=c.user_id WHERE c.id=?').get(Number(req.params.id));
  if (!c?.kyc_json) throw new HttpError(409, 'El contrato aún no está firmado');
  db.prepare("UPDATE contracts SET identity_ok_by=?, identity_ok_at=datetime('now') WHERE id=?").run(req.user.id, c.id);
  audit(req, 'contrato.identidad', `${c.name}: identidad verificada (selfie contra INE) en ${c.folio}`);
  res.json({ ok: true });
}));
app.get('/api/contracts/:id/nom151', auth('admin'), wrap((req, res) => {
  const c = db.prepare('SELECT * FROM contracts WHERE id=?').get(Number(req.params.id));
  if (!c?.nom151_file) throw new HttpError(404, 'Sin constancia NOM-151');
  res.download(path.join(DOCS_DIR, c.nom151_file), `${c.folio}-NOM151${path.extname(c.nom151_file)}`);
}));
// Constancia NOM-151 con el Prestador de Servicios de Certificación configurado (envía la huella SHA-256 del PDF)
async function requestNom151(cid) {
  const c = db.prepare('SELECT * FROM contracts WHERE id=?').get(cid);
  const s = getSettings();
  if (!c?.pdf_sha256) return;
  if (!s.psc_url) { db.prepare("UPDATE contracts SET nom151_status='pendiente', nom151_error='Falta configurar el Prestador de Servicios de Certificación (PSC) en Configuración' WHERE id=?").run(cid); return; }
  try {
    const r = await fetch(s.psc_url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(s.psc_api_key ? { Authorization: `Bearer ${s.psc_api_key}` } : {}) },
      body: JSON.stringify({ hash: c.pdf_sha256, algorithm: 'SHA-256', name: `${c.folio}.pdf`, reference: c.folio }), signal: AbortSignal.timeout(30000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.message || j.error || `HTTP ${r.status}`);
    const blob = j.constancia || j.certificate || j.timestamp || j.tsr || j.data;
    let file = null;
    if (blob) { file = `contrato_${c.id}_nom151_${Date.now()}.${/^[A-Za-z0-9+/=\s]+$/.test(blob) ? 'tsr' : 'json'}`; fs.writeFileSync(path.join(DOCS_DIR, file), /^[A-Za-z0-9+/=\s]+$/.test(blob) ? Buffer.from(blob, 'base64') : JSON.stringify(j)); }
    else { file = `contrato_${c.id}_nom151_${Date.now()}.json`; fs.writeFileSync(path.join(DOCS_DIR, file), JSON.stringify(j)); }
    db.prepare("UPDATE contracts SET status='sellado', nom151_status='emitida', nom151_folio=?, nom151_file=?, nom151_at=datetime('now'), nom151_error=NULL WHERE id=?").run(String(j.folio || j.id || j.serial || '').slice(0, 120) || null, file, cid);
  } catch (e) {
    db.prepare("UPDATE contracts SET nom151_status='error', nom151_error=? WHERE id=?").run(String(e.message).slice(0, 300), cid);
  }
}
app.post('/api/contracts/:id/nom151', auth('admin'), wrap(async (req, res) => {
  const c = db.prepare('SELECT * FROM contracts WHERE id=?').get(Number(req.params.id));
  if (!c?.pdf_sha256) throw new HttpError(409, 'El contrato aún no está firmado');
  await requestNom151(c.id);
  res.json(contractRow(db.prepare('SELECT * FROM contracts WHERE id=?').get(c.id)));
}));
// ---- Sesión de firma (pública, con el enlace del contrato) ----
const contractByToken = (t) => db.prepare("SELECT c.*, u.name, u.email, u.phone FROM contracts c JOIN users u ON u.id=c.user_id WHERE c.token=?").get(String(t || ''));
app.get('/api/firma/:token', wrap((req, res) => {
  const c = contractByToken(req.params.token);
  if (!c || c.status === 'anulado') throw new HttpError(404, 'Este enlace no es válido o el contrato fue reemplazado');
  const mask = (x, n) => (x ? String(x).slice(0, 2) + '•••' + String(x).slice(-n) : null);
  res.json({ folio: c.folio, status: c.status, name: c.name, html: c.html, signed_at: c.signed_at, company: getSettings().company_name || 'Sovime', annexes: legalFor(c.user_id).filter((d) => c.is_test || !d.accepted),
    phone: mask(String(c.phone || '').replace(/\D/g, ''), 4), email: c.email ? c.email.replace(/^(.{2}).*(@.*)$/, '$1•••$2') : null, practice: getSettings().practice_mode === '1' });
}));
// código de un solo uso (OTP) por SMS y correo; vence en 10 minutos
app.post('/api/firma/:token/otp', wrap(async (req, res) => {
  const c = contractByToken(req.params.token);
  if (!c || c.status !== 'enviado') throw new HttpError(409, 'Este contrato ya no está pendiente de firma');
  if (c.otp_sent_at && Date.now() - new Date(c.otp_sent_at + 'Z').getTime() < 60000) throw new HttpError(429, 'Espera un minuto para pedir otro código');
  if (c.otp_sends >= 6) throw new HttpError(429, 'Se alcanzó el máximo de códigos; pide a tu oficina un enlace nuevo');
  const s = getSettings();
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const msg = `${s.company_name || 'Sovime'}: tu código para firmar el contrato ${c.folio} es ${code}. Vence en 10 minutos. No lo compartas con nadie.`;
  const via = [];
  if (s.practice_mode !== '1') {
    if (c.phone) { try { const r = await notify.sendSMS(s, notify.phoneE164(c.phone), msg); if (!r?.simulated) via.push('SMS'); } catch (e) { console.error('otp sms', e.message); } }
    if (c.email) { try { const r = await notify.sendEmail(s, c.email, `Código de firma ${c.folio}`, msg); if (!r?.simulated) via.push('correo'); } catch (e) { console.error('otp correo', e.message); } }
    if (!via.length) throw new HttpError(503, 'No se pudo enviar el código por SMS ni por correo. Pide a tu oficina que revise los avisos.');
  }
  db.prepare("UPDATE contracts SET otp_hash=?, otp_sent_at=datetime('now'), otp_tries=0, otp_sends=otp_sends+1, otp_channel=? WHERE id=?").run(sha256(c.token + code), via.join(' y ') || 'práctica', c.id);
  res.json({ ok: true, via, ...(s.practice_mode === '1' ? { practice_code: code } : {}) });
}));
// firmar: valida el OTP, guarda selfie y documentos, metadatos, genera el PDF con su certificado y pide la constancia NOM-151
app.post('/api/firma/:token/sign', wrap(async (req, res) => {
  const c = contractByToken(req.params.token);
  if (!c || c.status !== 'enviado') throw new HttpError(409, 'Este contrato ya no está pendiente de firma');
  const b = req.body || {};
  if (!b.accepted) throw new HttpError(400, 'Marca que leíste y aceptas el contrato');
  if (!c.otp_hash || Date.now() - new Date(c.otp_sent_at + 'Z').getTime() > 10 * 60000) throw new HttpError(400, 'Pide tu código de verificación (el anterior venció)');
  if (c.otp_tries >= 5) throw new HttpError(429, 'Demasiados intentos; pide un código nuevo');
  if (sha256(c.token + String(b.otp || '').trim()) !== c.otp_hash) { db.prepare('UPDATE contracts SET otp_tries=otp_tries+1 WHERE id=?').run(c.id); throw new HttpError(400, 'El código no coincide'); }
  const lat = Number(b.gps?.lat), lng = Number(b.gps?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new HttpError(400, 'Activa la ubicación del teléfono: es parte del registro de la firma');
  // anexos vigentes: todos deben aceptarse en esta sesión
  const annexes = legalFor(c.user_id).filter((d) => c.is_test || !d.accepted);
  const acc = (b.accept_annex || []).map(Number);
  const notAcc = annexes.filter((d) => !acc.includes(d.id));
  if (notAcc.length) throw new HttpError(400, `Acepta también: ${notAcc.map((d) => d.title).join(', ')}`);
  const need = [['selfie', 'Selfie (prueba de vida)'], ['ine_front', 'INE (frente)'], ['ine_back', 'INE (reverso)'], ['csf', 'Constancia de Situación Fiscal'], ['poliza', 'Póliza de seguro'], ['signature', 'Firma']];
  const miss = need.filter(([k]) => !b[k]).map(([, l]) => l);
  if (miss.length) throw new HttpError(400, `Falta: ${miss.join(', ')}`);
  const files = {}, evidence = [], images = {};
  for (const [k, l] of need) {
    const name = saveDocFile(b[k], c.user_id, `firma_${k}`);
    const buf = fs.readFileSync(path.join(DOCS_DIR, name));
    files[k] = name; evidence.push({ label: l, sha256: sha256(buf) });
    if (/\.(png|jpe?g)$/i.test(name)) images[k] = buf;
  }
  const now = new Date();
  const ua = String(req.headers['user-agent'] || '').slice(0, 300);
  const meta = { ip: req.ip, gps: { lat, lng, acc: Number(b.gps.acc) || null }, device: String(b.device || '').slice(0, 160), ua, signed_utc: now.toISOString(), signed_local: fmtLocal(now), tz: String(b.tz || '').slice(0, 60) };
  const vars = { ...JSON.parse(c.vars_json || '{}'), contrato_fecha_firma: meta.signed_local };
  const html = contract.fill(getSettings().contract_template || null, vars);
  const admin = db.prepare('SELECT name FROM users WHERE id=?').get(c.issued_by)?.name || 'Administración';
  const pdf = await contract.buildPdf({ html, folio: c.folio,
    company: { signer: getSettings().contract_company_signer || 'Socio Administrador', issued_at: fmtLocal(new Date(c.issued_at + 'Z')), issued_by: admin },
    signer: { name: c.name, rfc: vars.prestador_rfc, curp: vars.prestador_curp, id: `${vars.prestador_tipo_identificacion} ${vars.prestador_numero_identificacion}`, email: c.email, phone: c.phone },
    cert: { text_sha256: c.text_sha256, company_sha256: c.company_sha256, otp: `Código de 6 dígitos enviado por ${c.otp_channel} (${c.phone || ''}${c.email ? ' / ' + c.email : ''})`, otp_verified_at: meta.signed_local,
      signed_local: meta.signed_local, signed_utc: meta.signed_utc.replace('T', ' ').slice(0, 19), ip: meta.ip, gps: `${lat.toFixed(6)}, ${lng.toFixed(6)}${meta.gps.acc ? ` (±${Math.round(meta.gps.acc)} m)` : ''}`, device: meta.device || '—', ua, evidence, nom151: null },
    images: { signature: images.signature, selfie: images.selfie, ine_front: images.ine_front, ine_back: images.ine_back }, annexes: annexes.map((d) => ({ title: d.title, version: d.version, html: d.html, sha256: sha256(d.html) })) });
  const pdfName = `contrato_${c.id}_${c.folio}.pdf`;
  fs.writeFileSync(path.join(DOCS_DIR, pdfName), pdf);
  const pdfHash = sha256(pdf);
  tx(() => {
    db.prepare("UPDATE contracts SET status='firmado', otp_verified_at=datetime('now'), kyc_json=?, meta_json=?, signed_at=datetime('now'), pdf_file=?, pdf_sha256=?, html=? WHERE id=?")
      .run(JSON.stringify(files), JSON.stringify(meta), pdfName, pdfHash, html, c.id);
    // el expediente queda con el contrato firmado y los documentos de la sesión por revisar (un contrato de prueba no lo toca)
    if (!c.is_test) {
    const docs = docsOf(c.user_id);
    const put = (k, file, ok) => { docs[k] = { ...(docs[k] || {}), file, ok, status: ok ? 'aprobado' : 'pendiente', uploaded_at: now.toISOString() }; };
    put('contrato', pdfName, true); put('ine', files.ine_front, false); put('csf', files.csf, false); put('seguro', files.poliza, false);
    saveDocs(c.user_id, docs);
    }
    if (!c.is_test) for (const d of annexes) acceptLegal(c.user_id, d, { ip: meta.ip, ua, gps: `${lat.toFixed(6)},${lng.toFixed(6)}`, device: meta.device, via: `firma ${c.folio} · OTP ${c.otp_channel}`, contract_id: c.id });
    db.prepare('INSERT INTO audit_log (user_id, action, detail) VALUES (?, ?, ?)').run(c.user_id, 'contrato.firmar', `${c.folio} firmado · IP ${meta.ip} · GPS ${lat.toFixed(5)},${lng.toFixed(5)} · OTP por ${c.otp_channel}`);
  });
  if (!c.is_test) await requestNom151(c.id);
  else db.prepare("UPDATE contracts SET nom151_status='prueba', nom151_error='Contrato de prueba: no se solicita constancia NOM-151' WHERE id=?").run(c.id);
  const done = db.prepare('SELECT status, nom151_status, nom151_error FROM contracts WHERE id=?').get(c.id);
  res.json({ ok: true, folio: c.folio, status: done.status, pdf_sha256: pdfHash, nom151: done.nom151_status, nom151_error: done.nom151_error });
}));

// ---------- Documentos legales del prestador ----------
const legal = require('./legal');
const money0 = (n) => '$' + Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function legalVars(uid) {
  const u = db.prepare('SELECT name FROM users WHERE id=?').get(uid) || {};
  const p = db.prepare('SELECT * FROM staff_profiles WHERE user_id=?').get(uid) || {};
  const s = getSettings();
  const coord = [p.team_pay_per_delivery > 0 ? `${money0(p.team_pay_per_delivery)} por cada servicio entregado por los prestadores que coordina` : '', p.team_pay_pct > 0 ? `${p.team_pay_pct}% de la liquidación de los prestadores que coordina` : ''].filter(Boolean).join(' y ');
  return { prestador_nombre: u.name, tarifa_entrega: p.pay_per_delivery > 0 ? money0(p.pay_per_delivery) + ' MXN' : 'la tarifa que se muestra en la Plataforma',
    tarifa_visita: p.pay_per_failed > 0 ? money0(p.pay_per_failed) + ' MXN' : 'sin costo adicional', tarifa_coordinacion: coord || 'no aplica',
    correo_privacidad: s.privacy_email || s.company_email || s.smtp_from || 'el correo de contacto de ANDERNS' };
}
// documentos vigentes que la persona aún no acepta (con su texto ya llenado)
const legalFor = (uid) => db.prepare("SELECT * FROM legal_docs WHERE status='vigente' ORDER BY CASE kind WHEN 'anexo_a' THEN 1 WHEN 'aviso' THEN 2 ELSE 3 END").all()
  .map((d) => ({ id: d.id, kind: d.kind, title: d.title, version: d.version, html: legal.fillLegal(d.html, legalVars(uid)), accepted: !!db.prepare('SELECT 1 FROM legal_acceptances WHERE user_id=? AND doc_id=?').get(uid, d.id) }));
function acceptLegal(uid, doc, meta) {
  db.prepare('INSERT OR IGNORE INTO legal_acceptances (user_id, doc_id, sha256, ip, ua, gps, device, via, contract_id) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(uid, doc.id, sha256(doc.html), meta.ip || null, meta.ua || null, meta.gps || null, meta.device || null, meta.via || 'app', meta.contract_id || null);
}
app.get('/api/legal', auth('admin'), wrap((req, res) => {
  res.json(db.prepare('SELECT d.*, (SELECT COUNT(*) FROM legal_acceptances a WHERE a.doc_id = d.id) accepted FROM legal_docs d ORDER BY d.kind, d.version DESC').all());
}));
app.put('/api/legal/:id', auth('admin'), wrap((req, res) => {
  const d = db.prepare('SELECT * FROM legal_docs WHERE id=?').get(Number(req.params.id));
  if (!d) throw new HttpError(404, 'No encontrado');
  const html = String(req.body?.html || '').trim();
  if (html.length < 50) throw new HttpError(400, 'El texto está vacío');
  if (d.status === 'borrador') { db.prepare('UPDATE legal_docs SET html=?, title=? WHERE id=?').run(html, String(req.body?.title || d.title).slice(0, 120), d.id); audit(req, 'legal.editar', `${d.title} v${d.version}`); return res.json({ id: d.id }); }
  // una versión publicada no se modifica: se crea una nueva versión en borrador
  const v = db.prepare('SELECT MAX(version) v FROM legal_docs WHERE kind=?').get(d.kind).v + 1;
  const r = db.prepare('INSERT INTO legal_docs (kind, version, title, html) VALUES (?,?,?,?)').run(d.kind, v, String(req.body?.title || d.title).slice(0, 120), html);
  audit(req, 'legal.version', `${d.title} v${v} (borrador)`);
  res.json({ id: Number(r.lastInsertRowid), version: v });
}));
app.post('/api/legal/:id/publish', auth('admin'), wrap((req, res) => {
  const d = db.prepare("SELECT * FROM legal_docs WHERE id=? AND status='borrador'").get(Number(req.params.id));
  if (!d) throw new HttpError(409, 'Solo se publica una versión en borrador');
  if (/BORRADOR PARA REVISIÓN LEGAL/.test(d.html) && !req.body?.confirm) throw new HttpError(409, 'El texto aún dice "BORRADOR PARA REVISIÓN LEGAL": quítalo cuando tu abogado lo apruebe');
  tx(() => {
    db.prepare("UPDATE legal_docs SET status='reemplazado' WHERE kind=? AND status='vigente'").run(d.kind);
    db.prepare("UPDATE legal_docs SET status='vigente', published_at=datetime('now'), published_by=? WHERE id=?").run(req.user.id, d.id);
  });
  audit(req, 'legal.publicar', `${d.title} v${d.version} publicado: los prestadores deben aceptarlo`);
  res.json({ ok: true });
}));
// prestador: lo que tiene pendiente de aceptar, y aceptar
app.get('/api/my/legal', auth(), wrap((req, res) => res.json(legalFor(req.user.id).filter((d) => !d.accepted))));
app.post('/api/my/legal/:id/accept', auth(), wrap((req, res) => {
  const d = legalFor(req.user.id).find((x) => x.id === Number(req.params.id));
  if (!d) throw new HttpError(404, 'Documento no vigente');
  const g = req.body?.gps;
  acceptLegal(req.user.id, d, { ip: req.ip, ua: String(req.headers['user-agent'] || '').slice(0, 300), gps: g && Number.isFinite(Number(g.lat)) ? `${Number(g.lat).toFixed(6)},${Number(g.lng).toFixed(6)}` : null, device: String(req.body?.device || '').slice(0, 160), via: 'app' });
  audit(req, 'legal.aceptar', `${req.user.name} aceptó ${d.title} v${d.version}`);
  res.json({ ok: true });
}));
app.get('/api/my/rates', auth(), wrap((req, res) => { const p = db.prepare('SELECT pay_per_delivery, pay_per_failed FROM staff_profiles WHERE user_id=?').get(req.user.id) || {}; res.json({ entrega: p.pay_per_delivery || 0, visita: p.pay_per_failed || 0 }); }));

// ---------- Liquidación semanal (lunes a domingo) ----------
const cfdi = require('./cfdi');
const weekOf = (date, off = 0) => payPeriod('semanal', date, off); // lunes a domingo
// prestadores que se liquidan: los que reparten o tienen tarifa
const settleUsers = () => db.prepare(`SELECT u.id, u.name FROM users u WHERE u.deleted_at IS NULL AND (u.role = 'repartidor' OR u.can_deliver = 1
  OR EXISTS (SELECT 1 FROM staff_profiles sp WHERE sp.user_id = u.id AND (sp.pay_per_delivery > 0 OR sp.pay_per_failed > 0 OR sp.team_pay_per_delivery > 0 OR sp.team_pay_pct > 0)))`).all();
// importe de la semana: servicios con evidencia + coordinación + bonos − incidencias; se paga lo que queda después de anticipos
function settleCalc(uid, from, to) {
  const x = hrSummary(uid, profileOf(uid), from, to);
  const amount = money2(x.own + (x.team?.pay || 0) + x.bono - x.descuento);
  return { delivered: x.delivered, failed: x.failed, services: x.own, team: x.team?.pay || 0, bonos: x.bono, incidencias: x.descuento, anticipos: x.anticipo, amount, to_pay: money2(amount - x.anticipo) };
}
// cierra el corte de una semana (no toca los ya facturados o pagados)
function settleClose(weekFrom, { force = false } = {}) {
  const w = weekOf(weekFrom);
  let n = 0;
  tx(() => {
    for (const u of settleUsers()) {
      const c = settleCalc(u.id, w.from, w.to);
      const cur = db.prepare('SELECT * FROM settlements WHERE user_id=? AND week_from=?').get(u.id, w.from);
      if (!c.delivered && !c.failed && !c.amount && !cur) continue;
      if (cur && !force && cur.status !== 'cerrada' && cur.status !== 'rechazada') continue;
      if (cur && ['validada', 'pagada', 'facturada'].includes(cur.status)) continue;
      db.prepare(`INSERT INTO settlements (user_id, week_from, week_to, delivered, failed, services, team, bonos, incidencias, anticipos, amount, to_pay, status)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'cerrada') ON CONFLICT(user_id, week_from) DO UPDATE SET delivered=excluded.delivered, failed=excluded.failed, services=excluded.services,
        team=excluded.team, bonos=excluded.bonos, incidencias=excluded.incidencias, anticipos=excluded.anticipos, amount=excluded.amount, to_pay=excluded.to_pay, closed_at=datetime('now')`)
        .run(u.id, w.from, w.to, c.delivered, c.failed, c.services, c.team, c.bonos, c.incidencias, c.anticipos, c.amount, c.to_pay);
      n++;
    }
  });
  return { ...w, closed: n };
}
// cada hora: el lunes se cierra el corte de la semana anterior (domingo 23:59)
function settleJob() {
  const prev = weekOf(today(), -1);
  const done = db.prepare("SELECT value FROM settings WHERE key='settle_last'").get()?.value;
  if (done === prev.from) return;
  const r = settleClose(prev.from);
  db.prepare("INSERT INTO settings (key, value) VALUES ('settle_last', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(prev.from);
  db.prepare('INSERT INTO audit_log (user_id, action, detail) VALUES (NULL, ?, ?)').run('liquidacion.corte', `Corte semanal ${r.from} a ${r.to}: ${r.closed} liquidaciones`);
}
const settleRow = (r) => ({ ...r, cfdi: (() => { try { return JSON.parse(r.cfdi_json || 'null'); } catch { return null; } })(), issues: (() => { try { return JSON.parse(r.cfdi_issues || '[]'); } catch { return []; } })(), cfdi_json: undefined, cfdi_issues: undefined });
// valida el CFDI contra el corte y consulta su estado en el SAT
async function settleValidate(id) {
  const st = db.prepare('SELECT s.*, sp.rfc FROM settlements s LEFT JOIN staff_profiles sp ON sp.user_id = s.user_id WHERE s.id=?').get(id);
  const xml = fs.readFileSync(path.join(DOCS_DIR, st.cfdi_xml), 'utf8');
  const issues = [];
  let c = null;
  try { c = cfdi.parseCfdi(xml); } catch (e) { issues.push(e.message); }
  let sat = null;
  if (c) {
    const rfcCo = (getSettings().cfdi_receptor_rfc || 'ASI050304FIA').toUpperCase();
    if (c.tipo && c.tipo !== 'I') issues.push(`Debe ser un CFDI de ingreso (tipo I), éste es tipo ${c.tipo}`);
    if (c.rfc_receptor !== rfcCo) issues.push(`El RFC receptor debe ser ${rfcCo} (viene ${c.rfc_receptor})`);
    if (st.rfc && c.rfc_emisor !== String(st.rfc).toUpperCase()) issues.push(`El RFC emisor (${c.rfc_emisor}) no es el del prestador (${st.rfc})`);
    if (Math.abs(c.subtotal - st.amount) > 1) issues.push(`El subtotal del CFDI ($${c.subtotal.toFixed(2)}) no coincide con la liquidación ($${Number(st.amount).toFixed(2)})`);
    if (c.uuid && db.prepare('SELECT 1 FROM settlements WHERE cfdi_uuid=? AND id<>?').get(c.uuid, id)) issues.push('Ese CFDI ya se usó en otra liquidación');
    try { sat = await cfdi.satStatus(c); if (sat.estado !== 'Vigente') issues.push(`Estado en el SAT: ${sat.estado || 'sin respuesta'}`); }
    catch (e) { issues.push('No se pudo consultar el SAT; se reintenta más tarde'); }
  }
  const status = issues.length ? 'rechazada' : 'validada';
  db.prepare("UPDATE settlements SET cfdi_uuid=?, cfdi_subtotal=?, cfdi_total=?, cfdi_json=?, cfdi_issues=?, sat_estado=?, sat_at=datetime('now'), status=? WHERE id=?")
    .run(c?.uuid || null, c?.subtotal ?? null, c?.total ?? null, JSON.stringify(c), JSON.stringify(issues), sat?.estado || null, status, id);
  return { status, issues, sat: sat?.estado || null };
}
// prestador: su estado de cuenta (semana en curso y liquidaciones cerradas)
app.get('/api/my/settlements', auth(), wrap((req, res) => {
  const w = weekOf(today());
  const live = settleCalc(req.user.id, w.from, w.to);
  res.json({ current: { ...w, ...live }, company_rfc: getSettings().cfdi_receptor_rfc || 'ASI050304FIA', company: 'ANDERNS SERVICIOS INTEGRALES, S.C.',
    rows: db.prepare('SELECT * FROM settlements WHERE user_id=? ORDER BY week_from DESC LIMIT 26').all(req.user.id).map(settleRow) });
}));
// prestador sube su CFDI (XML + PDF)
app.post('/api/my/settlements/:id/cfdi', auth(), wrap(async (req, res) => {
  const st = db.prepare('SELECT * FROM settlements WHERE id=? AND user_id=?').get(Number(req.params.id), req.user.id);
  if (!st) throw new HttpError(404, 'Liquidación no encontrada');
  if (['validada', 'pagada'].includes(st.status)) throw new HttpError(409, 'Esta liquidación ya tiene su CFDI validado');
  const xml = String(req.body?.xml || '');
  if (!/<(?:\w+:)?Comprobante\b/.test(xml)) throw new HttpError(400, 'Adjunta el XML del CFDI');
  if (xml.length > 2 * 1024 * 1024) throw new HttpError(413, 'El XML es demasiado grande');
  const xmlName = `cfdi_${st.id}_${Date.now()}.xml`;
  fs.writeFileSync(path.join(DOCS_DIR, xmlName), xml);
  const pdfName = req.body?.pdf ? saveDocFile(req.body.pdf, req.user.id, `cfdi_${st.id}`) : st.cfdi_pdf;
  db.prepare("UPDATE settlements SET cfdi_xml=?, cfdi_pdf=?, uploaded_at=datetime('now'), status='facturada' WHERE id=?").run(xmlName, pdfName, st.id);
  const v = await settleValidate(st.id);
  audit(req, 'liquidacion.cfdi', `${req.user.name}: CFDI semana ${st.week_from} ${v.status}${v.issues.length ? ' · ' + v.issues.join('; ') : ''}`.slice(0, 500));
  res.json(v);
}));
app.get('/api/settlements/:id/file/:kind', auth(), wrap((req, res) => {
  const st = db.prepare('SELECT * FROM settlements WHERE id=?').get(Number(req.params.id));
  if (!st || (req.user.role !== 'admin' && st.user_id !== req.user.id)) throw new HttpError(404, 'No encontrado');
  const f = req.params.kind === 'xml' ? st.cfdi_xml : st.cfdi_pdf;
  if (!f) throw new HttpError(404, 'Sin archivo');
  res.sendFile(path.join(DOCS_DIR, f));
}));
// administrador: las liquidaciones de una semana
app.get('/api/settlements', auth('admin'), wrap((req, res) => {
  const w = weekOf(/^\d{4}-\d{2}-\d{2}$/.test(req.query.week || '') ? req.query.week : weekOf(today(), -1).from);
  const rows = db.prepare(`SELECT s.*, u.name, sp.rfc, sp.clabe, sp.bank_name, sp.account_holder FROM settlements s JOIN users u ON u.id = s.user_id LEFT JOIN staff_profiles sp ON sp.user_id = s.user_id
    WHERE s.week_from = ? ORDER BY u.name`).all(w.from).map(settleRow);
  res.json({ ...w, closed: !!rows.length, rows });
}));
app.post('/api/settlements/close', auth('admin'), wrap((req, res) => {
  const r = settleClose(req.body?.week || weekOf(today(), -1).from, { force: true });
  audit(req, 'liquidacion.corte', `Corte semanal ${r.from} a ${r.to} (manual): ${r.closed} liquidaciones`);
  res.json(r);
}));
app.post('/api/settlements/:id/recheck', auth('admin'), wrap(async (req, res) => {
  const st = db.prepare('SELECT * FROM settlements WHERE id=?').get(Number(req.params.id));
  if (!st?.cfdi_xml) throw new HttpError(409, 'Aún no tiene CFDI');
  res.json(await settleValidate(st.id));
}));
// archivo para dispersión SPEI en el portal del banco (CSV): solo liquidaciones con CFDI validado
app.post('/api/settlements/spei', auth('admin'), wrap((req, res) => {
  const ids = (req.body?.ids || []).map(Number).filter(Boolean);
  const rows = db.prepare(`SELECT s.*, u.name, sp.rfc, sp.clabe, sp.account_holder, sp.bank_name FROM settlements s JOIN users u ON u.id=s.user_id LEFT JOIN staff_profiles sp ON sp.user_id=s.user_id
    WHERE s.id IN (${ids.map(() => '?').join(',') || 0}) AND s.status='validada'`).all(...ids);
  if (!rows.length) throw new HttpError(400, 'Elige liquidaciones con CFDI validado');
  const bad = rows.filter((r) => !/^\d{18}$/.test(r.clabe || ''));
  if (bad.length) throw new HttpError(400, `Sin CLABE válida: ${bad.map((r) => r.name).join(', ')}`);
  const q = (x) => `"${String(x ?? '').replace(/"/g, '""')}"`;
  const csv = ['CLABE,Beneficiario,RFC,Monto,Referencia,Concepto', ...rows.map((r) => [r.clabe, q(r.account_holder || r.name), r.rfc || '', Number(r.to_pay).toFixed(2), String(r.id).padStart(7, '0'), q(`Liquidacion ${r.week_from} al ${r.week_to}`)].join(','))].join('\r\n');
  audit(req, 'liquidacion.spei', `Archivo SPEI: ${rows.length} liquidaciones, $${rows.reduce((a, r) => a + r.to_pay, 0).toFixed(2)}`);
  res.json({ csv, count: rows.length, total: money2(rows.reduce((a, r) => a + r.to_pay, 0)) });
}));
// marcar pagadas (después de la transferencia): registra el pago en Capital Humano
app.post('/api/settlements/paid', auth('admin'), wrap((req, res) => {
  const ids = (req.body?.ids || []).map(Number).filter(Boolean);
  const ref = String(req.body?.reference || '').trim().slice(0, 80) || null;
  let n = 0;
  tx(() => {
    for (const id of ids) {
      const st = db.prepare("SELECT * FROM settlements WHERE id=? AND status='validada'").get(id);
      if (!st) continue;
      db.prepare("UPDATE settlements SET status='pagada', paid_at=datetime('now'), pay_ref=? WHERE id=?").run(ref, id);
      if (st.to_pay > 0) db.prepare("INSERT INTO staff_payments (user_id, kind, amount, date, period_from, period_to, method, reference, notes, by_user) VALUES (?, 'pago', ?, ?, ?, ?, 'SPEI', ?, ?, ?)")
        .run(st.user_id, st.to_pay, today(), st.week_from, st.week_to, ref, `Liquidación semanal · CFDI ${st.cfdi_uuid}`, req.user.id);
      n++;
    }
  });
  audit(req, 'liquidacion.pagada', `${n} liquidaciones pagadas${ref ? ' · ' + ref : ''}`);
  res.json({ paid: n });
}));

// ---------- Documentos del expediente (los sube el colaborador o el administrador) ----------
// Se guardan fuera de la carpeta pública: solo los ve el administrador o el propio colaborador.
const DOCS_DIR = path.join(DATA_DIR, 'expedientes');
fs.mkdirSync(DOCS_DIR, { recursive: true });
const DOC_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp', 'application/pdf': 'pdf' };
function saveDocFile(dataUrl, userId, doc) {
  const m = /^data:([\w/+.-]+);base64,(.+)$/.exec(String(dataUrl || ''));
  if (!m || !DOC_TYPES[m[1]]) throw new HttpError(400, 'Sube una foto (JPG, PNG) o un PDF');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 8 * 1024 * 1024) throw new HttpError(413, 'El archivo es demasiado grande (máx. 8 MB)');
  const name = `u${userId}_${doc}_${Date.now()}_${crypto.randomBytes(8).toString('hex')}.${DOC_TYPES[m[1]]}`;
  fs.writeFileSync(path.join(DOCS_DIR, name), buf);
  return name;
}
const docsOf = (userId) => { try { return JSON.parse(db.prepare('SELECT docs_json FROM staff_profiles WHERE user_id=?').get(userId)?.docs_json || '{}'); } catch { return {}; } };
function saveDocs(userId, docs) {
  db.prepare(`INSERT INTO staff_profiles (user_id, docs_json, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET docs_json=excluded.docs_json, updated_at=datetime('now')`).run(userId, JSON.stringify(docs));
}
const docListFor = (userId) => { const r = requiredDocs(userId); return STAFF_DOCS.filter(([k]) => k !== 'contrato').map(([k, l]) => ({ key: k, label: l, optional: !r.includes(k), expiring: kyc.EXPIRING.includes(k) })); };
const publicDocs = (docs) => Object.fromEntries(Object.entries(docs).map(([k, d]) => [k, { ok: !!d.ok, status: d.status || (d.ok ? 'aprobado' : null), expires: d.expires || null, has_file: !!d.file, check: d.check || null, override: !!d.override, uploaded_at: d.uploaded_at || null, uploaded_by: d.uploaded_by || null, note: d.note || null, mime: d.file ? (d.file.endsWith('.pdf') ? 'pdf' : 'img') : null }]));
function putDoc(req, userId, doc, { admin }) {
  if (!STAFF_DOCS.some(([k]) => k === doc)) throw new HttpError(400, 'Documento no válido');
  const b = req.body || {};
  const docs = docsOf(userId);
  const d = { ...(docs[doc] || {}) };
  if (b.file) {
    const old = d.file;
    d.file = saveDocFile(b.file, userId, doc);
    d.uploaded_at = new Date().toISOString().replace('T', ' ').slice(0, 19);
    d.uploaded_by = req.user.name;
    if (old) fs.rm(path.join(DOCS_DIR, old), { force: true }, () => {});
    d.status = admin ? 'aprobado' : 'pendiente';
    d.ok = !!admin;
    d.note = null;
  }
  if (b.expires !== undefined) d.expires = /^\d{4}-\d{2}-\d{2}$/.test(b.expires || '') ? b.expires : null;
  if (admin && ['aprobado', 'rechazado'].includes(b.status)) {
    if (!d.file && b.status === 'aprobado' && !b.file) d.status = 'aprobado';
    d.status = b.status; d.ok = b.status === 'aprobado';
    d.override = b.status === 'aprobado' && d.check && !d.check.ok ? true : undefined;
    d.note = b.status === 'rechazado' ? String(b.note || '').trim().slice(0, 200) || 'Rechazado: vuelve a subirlo' : null;
  }
  docs[doc] = d;
  saveDocs(userId, docs);
  return d;
}
// revisa la CSF recién subida contra el expediente y guarda el resultado en el documento
async function csfReview(userId) {
  const docs = docsOf(userId); const d = docs.csf;
  if (!d?.file) return null;
  if (!/\.pdf$/i.test(d.file)) { d.check = { ok: false, manual: true, issues: ['Es una foto: súbela en PDF (descárgala del portal del SAT) o revísala a mano'] }; }
  else {
    const p = db.prepare('SELECT rfc, account_holder FROM staff_profiles WHERE user_id=?').get(userId) || {};
    const u = db.prepare('SELECT name FROM users WHERE id=?').get(userId);
    d.check = await kyc.checkCsf(fs.readFileSync(path.join(DOCS_DIR, d.file)), { rfc: p.rfc, holder: p.account_holder, name: u?.name, today: today() });
  }
  d.check.at = new Date().toISOString();
  saveDocs(userId, { ...docsOf(userId), csf: d });
  return d.check;
}
// Colaborador: sus documentos
app.get('/api/me/documents', auth(), wrap((req, res) => {
  res.json({ doc_list: docListFor(req.user.id), docs: publicDocs(docsOf(req.user.id)), blockers: docBlockers(req.user.id), suspended: db.prepare('SELECT suspended_reason FROM users WHERE id=?').get(req.user.id)?.suspended_reason || null });
}));
app.post('/api/me/documents/:doc', auth(), wrap(async (req, res) => {
  if (!req.body?.file) throw new HttpError(400, 'Adjunta la foto o el PDF del documento');
  let d = putDoc(req, req.user.id, req.params.doc, { admin: false });
  if (req.params.doc === 'csf') { await csfReview(req.user.id); d = docsOf(req.user.id).csf; }
  audit(req, 'personal.documento', `${req.user.name} subió ${STAFF_DOCS.find(([k]) => k === req.params.doc)[1]}`);
  res.json(publicDocs({ [req.params.doc]: d })[req.params.doc]);
}));
// Administrador: subir, aprobar o rechazar
app.post('/api/users/:id/documents/:doc', auth('admin'), wrap(async (req, res) => {
  const u = db.prepare('SELECT id, name FROM users WHERE id=?').get(req.params.id);
  if (!u) throw new HttpError(404, 'No encontrado');
  let d = putDoc(req, u.id, req.params.doc, { admin: true });
  if (req.params.doc === 'csf' && (req.body?.file || req.body?.recheck)) { await csfReview(u.id); d = docsOf(u.id).csf; }
  if (d.ok) liftDocSuspension(u.id);
  audit(req, 'personal.documento', `${u.name}: ${STAFF_DOCS.find(([k]) => k === req.params.doc)[1]} ${d.status || ''}`);
  res.json(publicDocs({ [req.params.doc]: d })[req.params.doc]);
}));
// Ver el archivo (administrador o el propio colaborador)
app.get('/api/users/:id/documents/:doc/file', auth(), wrap((req, res) => {
  const uid = Number(req.params.id);
  if (req.user.role !== 'admin' && req.user.id !== uid) throw new HttpError(403, 'Sin permiso');
  const f = docsOf(uid)[req.params.doc]?.file;
  if (!f) throw new HttpError(404, 'Sin archivo');
  res.setHeader('Cache-Control', 'private, no-store');
  res.sendFile(path.join(DOCS_DIR, path.basename(f)));
}));

// ---------- Almacenes ----------
const whDefault = () => db.prepare('SELECT * FROM warehouses WHERE is_default=1 ORDER BY id LIMIT 1').get() || db.prepare('SELECT * FROM warehouses ORDER BY id LIMIT 1').get();
app.get('/api/warehouses', auth(), wrap((req, res) => {
  res.json(db.prepare(`SELECT w.*, (SELECT COUNT(*) FROM serials s WHERE s.warehouse_id = w.id AND s.holder_id IS NULL AND s.open_pool = 0 AND s.status IN ('disponible','asignado')) units
    FROM warehouses w ORDER BY w.active DESC, w.is_default DESC, w.name`).all());
}));
function whBody(b) {
  const name = String(b.name || '').trim().slice(0, 80);
  if (!name) throw new HttpError(400, 'Escribe el nombre del almacén');
  const num = (x) => (x === '' || x == null || !Number.isFinite(Number(x)) ? null : Number(x));
  return { name, city: String(b.city || '').trim().slice(0, 80) || null, address: String(b.address || '').trim().slice(0, 250) || null, lat: num(b.lat), lng: num(b.lng),
    phone: String(b.phone || '').trim().slice(0, 30) || null, manager: String(b.manager || '').trim().slice(0, 80) || null };
}
app.post('/api/warehouses', auth('admin'), wrap((req, res) => {
  const b = whBody(req.body || {});
  try {
    const id = Number(db.prepare('INSERT INTO warehouses (name, city, address, lat, lng, phone, manager) VALUES (?,?,?,?,?,?,?)').run(b.name, b.city, b.address, b.lat, b.lng, b.phone, b.manager).lastInsertRowid);
    audit(req, 'almacen.alta', b.name);
    res.status(201).json({ id });
  } catch (e) { if (String(e.message).includes('UNIQUE')) throw new HttpError(409, 'Ya existe un almacén con ese nombre'); throw e; }
}));
app.put('/api/warehouses/:id', auth('admin'), wrap((req, res) => {
  const w = db.prepare('SELECT * FROM warehouses WHERE id=?').get(req.params.id);
  if (!w) throw new HttpError(404, 'No encontrado');
  const b = whBody({ ...w, ...req.body });
  const active = req.body.active === undefined ? w.active : req.body.active ? 1 : 0;
  if (!active && w.is_default) throw new HttpError(409, 'No puedes desactivar el almacén principal; primero marca otro como principal');
  tx(() => {
    db.prepare('UPDATE warehouses SET name=?, city=?, address=?, lat=?, lng=?, phone=?, manager=?, active=? WHERE id=?').run(b.name, b.city, b.address, b.lat, b.lng, b.phone, b.manager, active, w.id);
    if (req.body.is_default) {
      db.prepare('UPDATE warehouses SET is_default = (id = ?)').run(w.id);
      // el principal es el punto de salida por omisión de las rutas
      if (b.lat != null) for (const [k, val] of [['depot_name', b.name], ['depot_lat', String(b.lat)], ['depot_lng', String(b.lng)]])
        db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, val);
    }
  });
  audit(req, 'almacen.editar', b.name);
  res.json({ ok: true });
}));
// Traspaso de equipos con S/N entre almacenes
app.post('/api/warehouses/:id/transfer', auth(...STAFF), wrap((req, res) => {
  const w = db.prepare('SELECT * FROM warehouses WHERE id=? AND active=1').get(req.params.id);
  if (!w) throw new HttpError(404, 'Almacén no encontrado');
  const list = [...new Set((Array.isArray(req.body?.serials) ? req.body.serials : []).map(normSerial).filter(Boolean))];
  if (!list.length) throw new HttpError(400, 'Elige los equipos a mover');
  const ref = String(req.body?.reference || '').trim().slice(0, 80);
  const fromId = req.body?.from_id ? Number(req.body.from_id) : null;
  const from = fromId ? db.prepare('SELECT * FROM warehouses WHERE id=?').get(fromId) : null;
  if (fromId && !from) throw new HttpError(404, 'Almacén de origen no encontrado');
  if (fromId === w.id) throw new HttpError(400, 'El almacén de origen y el de destino son el mismo');
  if (req.user.office && fromId !== req.user.office) throw new HttpError(403, 'Solo puedes enviar equipos desde tu oficina');
  let n = 0; const errors = [];
  tx(() => {
    for (const sn of list) {
      const s = db.prepare('SELECT s.*, w.name wname FROM serials s LEFT JOIN warehouses w ON w.id = s.warehouse_id WHERE s.serial=?').get(sn);
      if (!s) { errors.push({ serial: sn, error: 'No registrado' }); continue; }
      if (s.holder_id || s.open_pool || !['disponible', 'asignado'].includes(s.status)) { errors.push({ serial: sn, error: 'No está en un almacén' }); continue; }
      if (s.warehouse_id === w.id) { errors.push({ serial: sn, error: `Ya está en ${w.name}` }); continue; }
      if (from && s.warehouse_id !== from.id) { errors.push({ serial: sn, error: `No está en ${from.name} (está en ${s.wname || 'sin almacén'})` }); continue; }
      db.prepare("UPDATE serials SET warehouse_id=?, updated_at=datetime('now') WHERE id=?").run(w.id, s.id);
      serialEvent(s.id, 'traspaso', s.order_id, req.user.id, `${s.wname || 'Sin almacén'} → ${w.name}${ref ? ' · ' + ref : ''}`);
      n++;
    }
  });
  if (n) audit(req, 'almacen.traspaso', `${n} equipos ${from ? from.name + ' ' : ''}→ ${w.name}${ref ? ' · ' + ref : ''}`);
  res.json({ moved: n, errors });
}));
// Historial de traspasos entre almacenes (agrupado por operación)
app.get('/api/warehouse-transfers', auth(...STAFF), wrap((req, res) => {
  res.json(db.prepare(`SELECT e.created_at, e.detail, u.name user_name, COUNT(*) n, GROUP_CONCAT(s.serial, ', ') serials
    FROM serial_events e JOIN serials s ON s.id = e.serial_id LEFT JOIN users u ON u.id = e.user_id
    WHERE e.event = 'traspaso' ${req.user.office ? 'AND e.detail LIKE ?' : ''} GROUP BY e.created_at, e.user_id, e.detail ORDER BY e.created_at DESC LIMIT 40`)
    .all(...(req.user.office ? [`%${db.prepare('SELECT name FROM warehouses WHERE id = ?').get(req.user.office)?.name || '#'}%`] : [])));
}));
// Inventario en listado: una fila por equipo con S/N (y por ubicación para productos sin S/N)
app.get('/api/inventory/list', auth(...STAFF), wrap((req, res) => {
  const off = req.user.office ? Number(req.user.office) : null;
  const scope = off ? `AND (s.warehouse_id = ${off} OR (o.id IS NOT NULL AND ${OFFICE_OF('c')} = ${off}) OR s.holder_id IN (SELECT u2.id FROM users u2 WHERE ${OFFICE_OF('u2')} = ${off}))` : '';
  const sn = db.prepare(`SELECT s.serial, s.status, s.open_pool, s.updated_at, s.holder_id, s.warehouse_id, p.id product_id, p.name product, p.sku,
      w.name warehouse, w.city, u.name holder, o.tracking_code, o.status order_status, c.name customer
    FROM serials s JOIN products p ON p.id = s.product_id LEFT JOIN warehouses w ON w.id = s.warehouse_id LEFT JOIN users u ON u.id = s.holder_id
    LEFT JOIN orders o ON o.id = s.order_id LEFT JOIN customers c ON c.id = o.customer_id
    WHERE 1 ${scope} ORDER BY p.name, s.serial LIMIT 20000`).all();
  const rows = sn.map((s) => {
    const loc = s.status === 'entregado' ? ['entregado', s.customer || 'Cliente'] : s.status === 'baja' ? ['baja', 'Baja']
      : s.holder_id ? ['repartidor', s.holder] : s.open_pool ? ['abierto', 'Abierto (cualquier repartidor)'] : ['almacen', s.warehouse || 'Sin almacén'];
    return { serial: s.serial, product_id: s.product_id, product: s.product, sku: s.sku, status: s.status, loc_type: loc[0], location: loc[1],
      warehouse_id: s.warehouse_id, warehouse: s.warehouse, city: s.city, order: s.tracking_code, customer: s.customer, qty: 1, updated_at: s.updated_at };
  });
  // productos sin S/N: cantidad por ubicación
  const def = db.prepare('SELECT id, name FROM warehouses WHERE is_default = 1').get();
  if (!off || off === def?.id) {
    for (const p of db.prepare('SELECT id, name, sku FROM products WHERE serialized = 0 ORDER BY name').all()) {
      const base = { serial: '', product_id: p.id, product: p.name, sku: p.sku, status: 'disponible' };
      const wq = warehouseQty(p.id);
      if (wq > 0) rows.push({ ...base, loc_type: 'almacen', location: def?.name || 'Almacén', warehouse_id: def?.id, warehouse: def?.name, qty: wq });
      for (const d of db.prepare(`SELECT u.name, d.qty FROM driver_stock d JOIN users u ON u.id = d.user_id WHERE d.product_id = ? AND d.qty > 0 ${inOffice(req, 'u')}`).all(p.id))
        rows.push({ ...base, loc_type: 'repartidor', location: d.name, qty: d.qty });
      const op = db.prepare('SELECT qty FROM open_stock WHERE product_id = ? AND qty > 0').get(p.id);
      if (op) rows.push({ ...base, loc_type: 'abierto', location: 'Abierto (cualquier repartidor)', qty: op.qty });
    }
  }
  res.json({ rows });
}));
// Existencias: dónde está cada unidad (almacenes, repartidores, abierto) y lo apartado en pedidos
app.get('/api/inventory/breakdown', auth(...STAFF), wrap((req, res) => {
  const whs = db.prepare('SELECT id, name, is_default, active FROM warehouses ORDER BY is_default DESC, name').all();
  const prods = db.prepare('SELECT id, name, sku, serialized, stock, unit FROM products ORDER BY name').all();
  const out = prods.map((p) => {
    const reserved = db.prepare(`SELECT COALESCE(SUM(oi.qty),0) n FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE oi.product_id = ? AND o.status IN ('pendiente','asignado','cargado')`).get(p.id).n;
    if (p.serialized) {
      const byWh = whs.map((w) => ({ id: w.id, name: w.name, n: db.prepare(`SELECT COUNT(*) n FROM serials WHERE product_id=? AND warehouse_id=? AND holder_id IS NULL AND open_pool=0 AND status IN ('disponible','asignado')`).get(p.id, w.id).n }));
      const noWh = db.prepare(`SELECT COUNT(*) n FROM serials WHERE product_id=? AND warehouse_id IS NULL AND holder_id IS NULL AND open_pool=0 AND status IN ('disponible','asignado')`).get(p.id).n;
      const drivers = db.prepare(`SELECT COUNT(*) n FROM serials WHERE product_id=? AND holder_id IS NOT NULL AND status IN ('disponible','asignado')`).get(p.id).n;
      const open = db.prepare(`SELECT COUNT(*) n FROM serials WHERE product_id=? AND open_pool=1 AND holder_id IS NULL AND status IN ('disponible','asignado')`).get(p.id).n;
      const delivered = db.prepare(`SELECT COUNT(*) n FROM serials WHERE product_id=? AND status='entregado'`).get(p.id).n;
      const inWh = byWh.reduce((a, x) => a + x.n, 0) + noWh;
      return { ...p, reserved, warehouses: byWh, no_warehouse: noWh, in_warehouses: inWh, drivers, open, delivered, total: inWh + drivers + open };
    }
    const drivers = db.prepare('SELECT COALESCE(SUM(qty),0) n FROM driver_stock WHERE product_id=?').get(p.id).n;
    const open = db.prepare('SELECT qty FROM open_stock WHERE product_id=?').get(p.id)?.qty || 0;
    const inWh = warehouseQty(p.id);
    return { ...p, reserved, warehouses: null, in_warehouses: inWh, drivers, open, total: inWh + drivers + open };
  });
  res.json({ warehouses: whs, products: out });
}));
// Equipos con S/N dentro de un almacén (para revisar o traspasar)
app.get('/api/warehouses/:id/serials', auth(...STAFF), wrap((req, res) => {
  if (req.user.office && req.user.office !== Number(req.params.id)) throw new HttpError(403, 'Solo puedes ver el inventario de tu oficina');
  res.json(db.prepare(`SELECT s.serial, s.status, p.name product_name, o.tracking_code FROM serials s JOIN products p ON p.id = s.product_id LEFT JOIN orders o ON o.id = s.order_id
    WHERE s.warehouse_id = ? AND s.holder_id IS NULL AND s.open_pool = 0 AND s.status IN ('disponible','asignado') ORDER BY p.name, s.serial`).all(req.params.id));
}));

// ---------- Inventario asignado a repartidores ----------
// Equipos con S/N: serials.holder_id. Productos sin S/N: driver_stock (cantidad por repartidor).
// La existencia del almacén no cambia al asignar (el equipo sigue siendo de la empresa); solo cambia quién lo trae.
const custodyLog = (driverId, productId, qty, action, byUser, { serial = null, orderId = null, reference = null } = {}) =>
  db.prepare('INSERT INTO custody_log (driver_id, product_id, qty, serial, action, order_id, by_user, reference) VALUES (?,?,?,?,?,?,?,?)')
    .run(driverId, productId, qty, serial, action, orderId, byUser, reference);
function custodyOf(driverId) {
  const where = driverId ? 'WHERE u.id = ?' : "WHERE (u.role = 'repartidor' OR u.can_deliver = 1)";
  const args = driverId ? [driverId] : [];
  const drivers = db.prepare(`SELECT u.id, u.name, u.vehicle, u.active FROM users u ${where} ORDER BY u.active DESC, u.name`).all(...args);
  const sn = db.prepare(`SELECT s.holder_id, s.product_id, s.serial, s.status, s.held_at, o.tracking_code FROM serials s LEFT JOIN orders o ON o.id = s.order_id
    WHERE s.holder_id IS NOT NULL ${driverId ? 'AND s.holder_id = ?' : ''} ORDER BY s.serial`).all(...args);
  const qt = db.prepare(`SELECT user_id, product_id, qty FROM driver_stock WHERE qty > 0 ${driverId ? 'AND user_id = ?' : ''}`).all(...args);
  const prods = new Map(db.prepare('SELECT id, name, sku, serialized FROM products').all().map((p) => [p.id, p]));
  return drivers.map((d) => {
    const items = new Map();
    const item = (pid) => {
      if (!items.has(pid)) { const p = prods.get(pid) || { name: '?', sku: '' }; items.set(pid, { product_id: pid, name: p.name, sku: p.sku, serialized: !!p.serialized, qty: 0, serials: [] }); }
      return items.get(pid);
    };
    for (const s of sn.filter((x) => x.holder_id === d.id)) { const it = item(s.product_id); it.qty++; it.serials.push({ serial: s.serial, status: s.status, order: s.tracking_code, since: s.held_at }); }
    for (const q of qt.filter((x) => x.user_id === d.id)) item(q.product_id).qty += q.qty;
    const list = [...items.values()].sort((a, b) => a.name.localeCompare(b.name));
    return { ...d, total: list.reduce((a, x) => a + x.qty, 0), items: list };
  });
}
// Lo que está "abierto": fuera del almacén y disponible para cualquier repartidor
function openPool() {
  const prods = new Map(db.prepare('SELECT id, name, sku, serialized FROM products').all().map((p) => [p.id, p]));
  const items = new Map();
  const item = (pid) => {
    if (!items.has(pid)) { const p = prods.get(pid) || { name: '?', sku: '' }; items.set(pid, { product_id: pid, name: p.name, sku: p.sku, serialized: !!p.serialized, qty: 0, serials: [] }); }
    return items.get(pid);
  };
  for (const s of db.prepare(`SELECT s.product_id, s.serial, s.status, s.held_at, o.tracking_code FROM serials s LEFT JOIN orders o ON o.id = s.order_id
    WHERE s.open_pool = 1 AND s.holder_id IS NULL AND s.status IN ('disponible','asignado') ORDER BY s.serial`).all()) {
    const it = item(s.product_id); it.qty++; it.serials.push({ serial: s.serial, status: s.status, order: s.tracking_code, since: s.held_at });
  }
  for (const q of db.prepare('SELECT product_id, qty FROM open_stock WHERE qty > 0').all()) item(q.product_id).qty += q.qty;
  const list = [...items.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { id: 'open', name: 'Abierto · cualquier repartidor', open: true, active: 1, vehicle: null, total: list.reduce((a, x) => a + x.qty, 0), items: list };
}
const isOpen = (v) => v === 'open' || v === 'abierto';
// Unidades físicas de un producto sin S/N que siguen en el almacén: existencia libre + lo apartado en pedidos abiertos − lo que ya traen repartidores
function warehouseQty(productId) {
  const p = db.prepare('SELECT stock FROM products WHERE id=?').get(productId);
  const open = db.prepare(`SELECT COALESCE(SUM(oi.qty),0) n FROM order_items oi JOIN orders o ON o.id = oi.order_id
    WHERE oi.product_id = ? AND o.status IN ('pendiente','asignado','cargado','en_camino')`).get(productId).n;
  const held = db.prepare('SELECT COALESCE(SUM(qty),0) n FROM driver_stock WHERE product_id=?').get(productId).n
    + (db.prepare('SELECT qty FROM open_stock WHERE product_id=?').get(productId)?.qty || 0);
  return Math.max(0, (p?.stock || 0) + open - held);
}
function serialQtyAvail(productId) {
  const free = db.prepare("SELECT COUNT(*) n FROM serials WHERE product_id=? AND status='disponible' AND holder_id IS NULL AND open_pool=0").get(productId).n;
  const held = db.prepare('SELECT COALESCE(SUM(qty),0) n FROM driver_stock WHERE product_id=?').get(productId).n + (db.prepare('SELECT qty FROM open_stock WHERE product_id=?').get(productId)?.qty || 0);
  return Math.max(0, free - held);
}
app.get('/api/custody', auth(...STAFF), wrap((req, res) => {
  let drivers = custodyOf(null);
  if (req.user.office) { const ids = new Set(db.prepare(`SELECT u.id FROM users u WHERE 1 ${inOffice(req, 'u')}`).all().map((r) => r.id)); drivers = drivers.filter((d) => ids.has(d.id)); }
  res.json({ drivers: [openPool(), ...drivers] });
}));
// Lo que hay en el almacén para asignar: equipos con S/N que nadie trae y productos sin S/N con su cantidad disponible
app.get('/api/custody/available', auth(...STAFF), wrap((req, res) => {
  const prods = db.prepare('SELECT id, name, sku, unit, serialized, location FROM products ORDER BY name').all();
  const sn = db.prepare(`SELECT s.product_id, s.serial, s.status, o.tracking_code, c.name customer FROM serials s LEFT JOIN orders o ON o.id = s.order_id LEFT JOIN customers c ON c.id = o.customer_id
    WHERE s.holder_id IS NULL AND s.open_pool = 0 AND s.status IN ('disponible','asignado') ORDER BY s.status DESC, s.serial`).all();
  res.json({
    serialized: prods.filter((p) => p.serialized).map((p) => ({ ...p, serials: sn.filter((s) => s.product_id === p.id) })).filter((p) => p.serials.length),
    plain: prods.map((p) => ({ ...p, by_qty: !!p.serialized, available: p.serialized ? serialQtyAvail(p.id) : warehouseQty(p.id) })).filter((p) => p.available > 0),
  });
}));
app.get('/api/my/custody', auth('repartidor'), wrap((req, res) => {
  const [me] = custodyOf(req.user.id);
  const log = db.prepare(`SELECT l.action, l.qty, l.serial, l.reference, l.created_at, p.name product_name, o.tracking_code, u.name by_name FROM custody_log l
    JOIN products p ON p.id = l.product_id LEFT JOIN orders o ON o.id = l.order_id LEFT JOIN users u ON u.id = l.by_user
    WHERE l.driver_id = ? ORDER BY l.id DESC LIMIT 30`).all(req.user.id);
  res.json({ ...me, log, open_items: openPool().items });
}));
// Repartidor: buscar un producto o número de serie y saber dónde está (suyo, abierto, almacén, otro repartidor, entregado)
app.get('/api/my/lookup', auth('repartidor'), wrap((req, res) => {
  const me = req.user.id;
  const q = String(req.query.q || '').trim().replace(/^S\/?N[:\s]*/i, '');
  if (q.length < 2) return res.json({ products: [], serials: [] });
  const like = `%${q}%`;
  const serials = db.prepare(`SELECT s.serial, s.status, s.holder_id, s.open_pool, p.name product, u.name holder, o.tracking_code, c.name customer
      FROM serials s JOIN products p ON p.id = s.product_id LEFT JOIN users u ON u.id = s.holder_id
      LEFT JOIN orders o ON o.id = s.order_id LEFT JOIN customers c ON c.id = o.customer_id
      WHERE s.serial LIKE ? ORDER BY (s.serial = ?) DESC, s.serial LIMIT 20`).all(like, q.toUpperCase())
    .map((s) => ({
      serial: s.serial, product: s.product, order: s.tracking_code || null,
      where: s.status === 'entregado' ? 'entregado' : s.status === 'baja' ? 'baja' : s.holder_id === me ? 'tuyo' : s.holder_id ? 'otro' : s.open_pool ? 'abierto' : 'almacen',
      holder: s.holder_id && s.holder_id !== me ? s.holder : null,
      customer: s.status === 'entregado' || s.order_id ? s.customer : null,
    }));
  const products = db.prepare(`SELECT id, name, sku, barcode, unit, serialized FROM products
      WHERE name LIKE ? OR sku LIKE ? OR barcode LIKE ? ORDER BY name LIMIT 20`).all(like, like, like)
    .map((p) => {
      const sn = (cond, ...a) => db.prepare(`SELECT COUNT(*) n FROM serials WHERE product_id=? AND status IN ('disponible','asignado') AND ${cond}`).get(p.id, ...a).n;
      return p.serialized
        ? { ...p, mine: sn('holder_id = ?', me), open: sn('holder_id IS NULL AND open_pool = 1'), warehouse: sn("holder_id IS NULL AND open_pool = 0 AND status = 'disponible'") }
        : { ...p, mine: db.prepare('SELECT qty FROM driver_stock WHERE user_id=? AND product_id=?').get(me, p.id)?.qty || 0,
          open: db.prepare('SELECT qty FROM open_stock WHERE product_id=?').get(p.id)?.qty || 0, warehouse: warehouseQty(p.id) };
    });
  res.json({ products, serials });
}));
// Repartidor sin inventario asignado: puede elegir lo disponible en almacén que trae en su unidad
app.get('/api/my/available', auth('repartidor'), wrap((req, res) => {
  const prods = db.prepare('SELECT id, name, sku, unit, serialized FROM products ORDER BY name').all();
  const sn = db.prepare(`SELECT product_id, serial FROM serials WHERE holder_id IS NULL AND open_pool = 0 AND status = 'disponible' ORDER BY serial`).all();
  res.json({
    serialized: prods.filter((p) => p.serialized).map((p) => ({ product_id: p.id, name: p.name, sku: p.sku, serials: sn.filter((x) => x.product_id === p.id).map((x) => x.serial) })),
    plain: prods.filter((p) => !p.serialized).map((p) => ({ product_id: p.id, name: p.name, sku: p.sku, unit: p.unit, available: warehouseQty(p.id) })).filter((p) => p.available > 0),
  });
}));
// ---------- Edición completa del pedido (administrador) ----------
const adminOrder = (req) => {
  const o = db.prepare('SELECT * FROM orders WHERE id=?').get(Number(req.params.id));
  if (!o) throw new HttpError(404, 'Pedido no encontrado');
  if (!officeOrders(req, [o.id]).length) throw new HttpError(403, 'Este pedido es de otra oficina');
  return o;
};
const resendSheet = (orderId) => db.prepare("UPDATE sheet_sync SET status='pendiente', attempts=0, next_try_at=datetime('now') WHERE order_id=? AND status<>'desactivado'").run(orderId);
app.put('/api/orders/:id/edit', auth('admin'), wrap((req, res) => {
  const o = adminOrder(req);
  const b = req.body || {};
  const ch = [];
  const set = (col, v, label) => { if (v === undefined) return; if (String(v ?? '') !== String(o[col] ?? '')) { db.prepare(`UPDATE orders SET ${col}=? WHERE id=?`).run(v === '' ? null : v, o.id); ch.push(`${label}: ${o[col] ?? '—'} → ${v || '—'}`); } };
  if (b.scheduled_date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(b.scheduled_date)) throw new HttpError(400, 'Fecha inválida');
  set('scheduled_date', b.scheduled_date, 'fecha');
  if (b.priority !== undefined) set('priority', b.priority === 'alta' ? 'alta' : 'normal', 'prioridad');
  if (b.notes !== undefined) set('notes', String(b.notes).slice(0, 500), 'notas');
  if (b.cod_amount !== undefined) set('cod_amount', Number(b.cod_amount) || 0, 'cobro');
  if (b.appointment_time !== undefined) set('appointment_time', /^\d{2}:\d{2}$/.test(b.appointment_time) ? b.appointment_time : '', 'hora acordada');
  if (ch.length) { audit(req, 'pedidos.editar', `${o.tracking_code}: ${ch.join('; ')}`.slice(0, 500)); if (o.status === 'entregado') resendSheet(o.id); }
  res.json(loadOrder(o.id));
}));
// agregar producto al pedido (también ya entregado), opcionalmente con su S/N
app.post('/api/orders/:id/items', auth('admin'), wrap((req, res) => {
  const o = adminOrder(req);
  if (o.status === 'cancelado') throw new HttpError(409, 'El pedido está cancelado');
  const p = db.prepare('SELECT * FROM products WHERE id=?').get(Number(req.body?.product_id));
  if (!p) throw new HttpError(400, 'Elige el producto');
  const qty = Math.max(1, Math.trunc(Number(req.body?.qty) || 1));
  const serials = [].concat(req.body?.serials || req.body?.serial || []).map((x) => String(x || '').trim()).filter(Boolean);
  if (serials.length > qty) throw new HttpError(400, 'Hay más números de serie que piezas');
  // si el pedido ya trae ese equipo sin S/N, el S/N llena esa pieza (no se agrega otra)
  let add = qty;
  tx(() => {
    const it = db.prepare('SELECT * FROM order_items WHERE order_id=? AND product_id=?').get(o.id, p.id);
    if (it && p.serialized && serials.length) {
      const have = db.prepare("SELECT COUNT(*) n FROM serials WHERE order_id=? AND product_id=? AND status IN ('asignado','entregado')").get(o.id, p.id).n;
      add = Math.max(0, qty - Math.max(0, it.qty - have));
    }
    if (it) { if (add) db.prepare('UPDATE order_items SET qty = qty + ? WHERE order_id=? AND product_id=?').run(add, o.id, p.id); }
    else db.prepare('INSERT INTO order_items (order_id, product_id, qty) VALUES (?,?,?)').run(o.id, p.id, qty);
    if (add) takeStock(o.id, p.id, add, o.tracking_code, req.user.id, ' (agregado por administración)', { force: o.status === 'entregado' });
    for (const sn of serials) assignSerial(db.prepare('SELECT * FROM orders WHERE id=?').get(o.id), sn, req.user);
  });
  audit(req, 'pedidos.producto', add ? `${o.tracking_code}: + ${add} × ${p.name}${serials.length ? ' (S/N ' + serials.join(', ') + ')' : ''}` : `${o.tracking_code}: S/N ${serials.join(', ')} de ${p.name} (la pieza ya estaba en el pedido)`);
  if (o.status === 'entregado') resendSheet(o.id);
  res.json(loadOrder(o.id));
}));
// cambiar la cantidad de un producto del pedido (0 = quitarlo)
app.put('/api/orders/:id/items/:pid', auth('admin'), wrap((req, res) => {
  const o = adminOrder(req);
  const it = db.prepare('SELECT i.*, p.name FROM order_items i JOIN products p ON p.id=i.product_id WHERE i.order_id=? AND i.product_id=?').get(o.id, Number(req.params.pid));
  if (!it) throw new HttpError(404, 'Ese producto no está en el pedido');
  const qty = Math.max(0, Math.trunc(Number(req.body?.qty)));
  const sn = db.prepare('SELECT COUNT(*) n FROM serials WHERE order_id=? AND product_id=?').get(o.id, it.product_id).n;
  if (qty < sn) throw new HttpError(409, `Este pedido tiene ${sn} S/N de ${it.name}: quita o corrige primero los números de serie`);
  tx(() => {
    // baja: regresa solo lo que sí se había descontado; sube: descuenta lo que haya (lo demás queda por surtir)
    const keep = Math.min(it.filled, qty), back = it.filled - keep;
    if (qty === 0) db.prepare('DELETE FROM order_items WHERE order_id=? AND product_id=?').run(o.id, it.product_id);
    else db.prepare('UPDATE order_items SET qty=?, filled=? WHERE order_id=? AND product_id=?').run(qty, keep, o.id, it.product_id);
    if (back > 0) { FILL.skip.add(o.id); try { moveStock(it.product_id, 'devolucion', back, `Pedido ${o.tracking_code} (ajuste de administración)`, req.user.id); } finally { FILL.skip.delete(o.id); } }
    if (qty > keep && !['entregado', 'cancelado'].includes(o.status)) takeStock(o.id, it.product_id, qty - keep, o.tracking_code, req.user.id, ' (ajuste de administración)');
  });
  audit(req, 'pedidos.producto', `${o.tracking_code}: ${it.name} ${it.qty} → ${qty}`);
  res.json(loadOrder(o.id));
}));
// datos de la recepción (quién recibió, fecha y hora, notas)
app.put('/api/evidences/:id', auth('admin'), wrap((req, res) => {
  const e = db.prepare('SELECT e.*, o.tracking_code, o.customer_id FROM evidences e JOIN orders o ON o.id=e.order_id WHERE e.id=?').get(Number(req.params.id));
  if (!e) throw new HttpError(404, 'Recepción no encontrada');
  if (!officeOrders(req, [e.order_id]).length) throw new HttpError(403, 'Este pedido es de otra oficina');
  const b = req.body || {};
  const ch = [];
  const set = (col, v, label) => { if (v === undefined) return; v = String(v ?? '').trim().slice(0, 300); if (v !== String(e[col] ?? '')) { db.prepare(`UPDATE evidences SET ${col}=? WHERE id=?`).run(v || null, e.id); ch.push(`${label}: ${e[col] || '—'} → ${v || '—'}`); } };
  set('receiver_name', b.receiver_name, 'recibió');
  set('receiver_relation', b.receiver_relation, 'parentesco');
  set('receiver_id_doc', b.receiver_id_doc, 'identificación');
  set('notes', b.notes, 'notas');
  set('reason', b.reason, 'motivo');
  // quién entregó (cualquier empleado activo) y si fue en ruta o en mostrador: la entrega se le cuenta a esa persona
  if (b.driver_id !== undefined || b.kind !== undefined) {
    const kind = b.kind === 'mostrador' ? 'mostrador' : b.kind === 'ruta' ? 'ruta' : e.kind;
    const did = b.driver_id === '' || b.driver_id === null ? null : b.driver_id !== undefined ? Number(b.driver_id) : e.driver_id;
    const u = did ? db.prepare('SELECT id, name FROM users WHERE id=? AND deleted_at IS NULL').get(did) : null;
    if (did && !u) throw new HttpError(400, 'Empleado no encontrado');
    if (did !== e.driver_id || kind !== e.kind) {
      const prev = e.driver_id ? db.prepare('SELECT name FROM users WHERE id=?').get(e.driver_id)?.name : null;
      db.prepare('UPDATE evidences SET driver_id=?, kind=? WHERE id=?').run(did, kind, e.id);
      if (e.result === 'entregado' && did) db.prepare('UPDATE orders SET driver_id=? WHERE id=?').run(did, e.order_id);
      ch.push(`entregó: ${prev || '—'}${e.kind === 'mostrador' ? ' (mostrador)' : ''} → ${u?.name || '—'}${kind === 'mostrador' ? ' (mostrador)' : ''}`);
    }
  }
  if (b.created_at) {
    const d = new Date(b.created_at);
    if (isNaN(d)) throw new HttpError(400, 'Fecha y hora inválidas');
    const iso = d.toISOString().replace('T', ' ').slice(0, 19);
    if (iso !== e.created_at) {
      db.prepare('UPDATE evidences SET created_at=? WHERE id=?').run(iso, e.id);
      if (e.result === 'entregado') db.prepare('UPDATE orders SET delivered_at=? WHERE id=?').run(iso, e.order_id);
      db.prepare("UPDATE serials SET delivered_at=? WHERE order_id=? AND status='entregado'").run(iso, e.order_id);
      ch.push(`fecha: ${e.created_at} → ${iso}`);
    }
  }
  if (ch.length) { audit(req, 'recepcion.editar', `${e.tracking_code}: ${ch.join('; ')}`.slice(0, 500)); db.prepare("UPDATE sheet_sync SET status='pendiente', attempts=0, next_try_at=datetime('now') WHERE evidence_id=? AND status<>'desactivado'").run(e.id); }
  res.json(loadOrder(e.order_id));
}));
// Repartidor: S/N disponibles para entregar, buscando por cualquier parte del número (los suyos primero)
app.get('/api/my/serials', auth('repartidor'), wrap((req, res) => {
  const me = req.user;
  // busca por S/N (cualquier parte), por descripción o SKU del producto; sin texto, lista lo disponible (primero lo del pedido y lo que trae)
  const raw = String(req.query.q || '').trim();
  const q = normSerial(raw).replace(/[^A-Z0-9]/g, '');
  const words = normCity(raw).split(' ').filter((w) => w.length >= 2);
  const order = req.query.order ? db.prepare('SELECT id, customer_id FROM orders WHERE id=?').get(Number(req.query.order)) : null;
  const need = new Set(order ? orderSerialNeeds(order.id).filter((n) => n.missing).map((n) => n.product_id) : []);
  const offs = new Set([me.office, order ? customerOffice(order.customer_id) : null].filter(Boolean).map(Number));
  const rows = db.prepare(`SELECT s.serial, s.product_id, s.holder_id, s.open_pool, s.warehouse_id, p.name product, p.sku, u.name holder, w.name wname
      FROM serials s JOIN products p ON p.id = s.product_id LEFT JOIN users u ON u.id = s.holder_id LEFT JOIN warehouses w ON w.id = s.warehouse_id
      WHERE s.status='disponible' ORDER BY (s.holder_id = ?) DESC, s.open_pool DESC, s.serial`).all(me.id);
  const hit = (s) => !raw || (q.length >= 2 && s.serial.toUpperCase().replace(/[^A-Z0-9]/g, '').includes(q))
    || (words.length && words.every((w) => normCity(`${s.product} ${s.sku}`).includes(w)));
  const ok = rows.filter((s) => hit(s) && (s.holder_id === me.id || s.open_pool || (!s.holder_id && (!s.warehouse_id || !offs.size || offs.has(Number(s.warehouse_id))))
    || (s.holder_id && offs.has(Number(userOffice(s.holder_id))))));
  const dot = new Set(db.prepare('SELECT product_id FROM driver_stock WHERE user_id=? AND qty > 0').all(me.id).map((r) => r.product_id));
  const mineQ = (s) => !s.holder_id && !s.open_pool && dot.has(s.product_id);
  const rank = (s) => (need.has(s.product_id) ? 0 : 4) + (s.holder_id === me.id || mineQ(s) ? 0 : s.open_pool ? 1 : !s.holder_id ? 2 : 3);
  ok.sort((a, b) => rank(a) - rank(b));
  res.json(ok.slice(0, 60).map((s) => ({ serial: s.serial, product: s.product, sku: s.sku, product_id: s.product_id, need: !need.size || need.has(s.product_id),
    where: s.holder_id === me.id ? 'tuyo' : mineQ(s) ? 'tu dotación' : s.holder_id ? `lo trae ${s.holder}` : s.open_pool ? 'abierto' : s.wname || 'almacén' })));
}));
// Pedidos del cliente que el repartidor puede reactivar / tomar para entregar ahora (de su oficina)
app.get('/api/my/customer-orders/:cid', auth('repartidor'), wrap((req, res) => {
  const c = db.prepare('SELECT id FROM customers WHERE id=?').get(Number(req.params.cid));
  if (!c) throw new HttpError(404, 'Cliente no encontrado');
  if (req.user.office && customerOffice(c.id) !== req.user.office) return res.json({ rows: [], other_office: true });
  const rows = db.prepare(`SELECT o.id, o.tracking_code, o.status, o.scheduled_date, o.driver_id, o.notes, u.name driver_name,
      (SELECT GROUP_CONCAT(i.qty || ' × ' || p.name, ', ') FROM order_items i JOIN products p ON p.id = i.product_id WHERE i.order_id = o.id) items
    FROM orders o LEFT JOIN users u ON u.id = o.driver_id WHERE o.customer_id=? AND o.status <> 'entregado' ORDER BY o.id DESC`).all(c.id);
  const live = rows.filter((o) => o.status !== 'cancelado');
  const delivered = db.prepare("SELECT COUNT(*) n FROM orders WHERE customer_id=? AND status='entregado'").get(c.id).n;
  // cancelados: solo si el cliente no tiene otro pedido vivo ni entregado (no revivir duplicados)
  const out = live.length || delivered ? live : rows.slice(0, 1);
  res.json({ rows: out.map((o) => ({ ...o, mine: o.driver_id === req.user.id && ['asignado', 'cargado'].includes(o.status) })), delivered });
}));
app.post('/api/my/orders/:id/reactivate', auth('repartidor'), wrap((req, res) => {
  const me = req.user;
  const o = db.prepare('SELECT * FROM orders WHERE id=?').get(Number(req.params.id));
  if (!o) throw new HttpError(404, 'Pedido no encontrado');
  if (me.office && customerOffice(o.customer_id) !== me.office) throw new HttpError(403, 'Este cliente es de otra oficina');
  if (o.status === 'entregado') throw new HttpError(409, 'Este pedido ya fue entregado');
  if (o.status === 'cargado' && o.driver_id !== me.id) throw new HttpError(409, 'Este pedido ya va cargado en la unidad de otro repartidor');
  if (['asignado', 'cargado'].includes(o.status) && o.driver_id === me.id && o.scheduled_date === today()) return res.json({ id: o.id, tracking_code: o.tracking_code, already: true });
  const before = o.status;
  tx(() => {
    if (o.status === 'cancelado') {
      // vuelve a apartar su existencia (al cancelarse regresó al inventario)
      for (const it of db.prepare('SELECT product_id, qty FROM order_items WHERE order_id=?').all(o.id)) {
        const st = db.prepare('SELECT stock FROM products WHERE id=?').get(it.product_id)?.stock || 0;
        if (st >= it.qty) moveStock(it.product_id, 'salida', it.qty, `Pedido ${o.tracking_code} reactivado`, me.id);
      }
    }
    db.prepare(`UPDATE orders SET status='pendiente', notes=TRIM(COALESCE(notes,'') || CASE WHEN COALESCE(notes,'')='' THEN '' ELSE ' | ' END || ?) WHERE id=?`)
      .run(`Reactivado por ${me.name} para entrega inmediata (${before})`, o.id);
  });
  const r = assignOrdersTo(req, { id: me.id, name: me.name }, [o.id], today());
  if (!r.assigned) throw new HttpError(409, r.skipped[0]?.reason || 'No se pudo tomar el pedido');
  audit(req, 'pedidos.reactivar', `${o.tracking_code}: ${before} → entrega inmediata por ${me.name}`);
  res.json({ id: o.id, tracking_code: o.tracking_code });
}));
// Pedidos del mismo número Telnor (el número Telnor es la referencia del pedido): abierto y/o ya entregado
function telnorOrders(customerId) {
  const c = db.prepare('SELECT id, external_id FROM customers WHERE id=?').get(Number(customerId));
  if (!c) return { open: null, delivered: null, telnor: '' };
  const ids = c.external_id ? db.prepare('SELECT id FROM customers WHERE external_id=?').all(c.external_id).map((x) => x.id) : [c.id];
  const q = (st) => db.prepare(`SELECT id, tracking_code, status, scheduled_date FROM orders WHERE customer_id IN (${ids.join(',')}) AND status IN (${st}) ORDER BY id DESC LIMIT 1`).get();
  return { open: q("'pendiente','asignado','cargado','fallido'"), delivered: q("'entregado'"), telnor: c.external_id || '' };
}
function telnorGuard(customerId, { allowSecond = false } = {}) {
  const t = telnorOrders(customerId);
  const tel = t.telnor ? ` (Telnor ${t.telnor})` : '';
  if (t.open) { const e = new HttpError(409, `Este cliente${tel} ya tiene el pedido ${t.open.tracking_code} (${t.open.status}): usa ese pedido en lugar de crear otro`); e.data = { code: 'telnor_open', order_id: t.open.id, tracking_code: t.open.tracking_code }; throw e; }
  if (t.delivered && !allowSecond) { const e = new HttpError(409, `A este cliente${tel} ya se le entregó el pedido ${t.delivered.tracking_code}. Si de verdad lleva un segundo equipo, el administrador debe confirmarlo`); e.data = { code: 'telnor_delivered', order_id: t.delivered.id, tracking_code: t.delivered.tracking_code }; throw e; }
  return t;
}
// El repartidor arma una entrega en campo: elige cliente y productos de lo que él trae (S/N o cantidad).
// Se crea el pedido ya cargado en su unidad y se agrega a su ruta del día, listo para registrar la entrega.
app.post('/api/my/orders', auth('repartidor'), wrap((req, res) => {
  const b = req.body || {};
  const me = req.user.id;
  const c = db.prepare('SELECT id, name FROM customers WHERE id=?').get(Number(b.customer_id));
  if (!c) throw new HttpError(400, 'Elige el cliente');
  const serials = [...new Set((Array.isArray(b.serials) ? b.serials : []).map(normSerial).filter(Boolean))];
  const items = (Array.isArray(b.items) ? b.items : []).map((it) => ({ product_id: Number(it.product_id), qty: Math.trunc(Number(it.qty)) })).filter((it) => it.product_id && it.qty > 0);
  if (!serials.length && !items.length) throw new HttpError(400, 'Elige al menos un producto de tu inventario');
  telnorGuard(c.id);
  const out = tx(() => {
    const code = genTracking();
    const oid = Number(db.prepare(`INSERT INTO orders (tracking_code, customer_id, scheduled_date, priority, notes, created_by, public_token, shipment_type)
      VALUES (?,?,?,?,?,?,?,?)`).run(code, c.id, today(), 'normal', String(b.notes || '').trim().slice(0, 300) || null, me, crypto.randomBytes(12).toString('hex'), 'general').lastInsertRowid);
    const qtyBy = new Map();
    for (const sn of serials) {
      let s = db.prepare('SELECT s.*, p.name pname FROM serials s JOIN products p ON p.id = s.product_id WHERE s.serial=?').get(sn);
      if (!s) {
        // equipo que el repartidor trae en su unidad pero no estaba registrado: se da de alta en campo
        if (!SERIAL_RE.test(sn)) throw new HttpError(400, `El S/N ${sn} no tiene un formato válido`);
        const prod = db.prepare('SELECT id, name FROM products WHERE id=? AND serialized=1').get(Number(b.new_serial_product_id))
          || (db.prepare('SELECT COUNT(*) n FROM products WHERE serialized=1').get().n === 1 ? db.prepare('SELECT id, name FROM products WHERE serialized=1').get() : null);
        if (!prod) throw new HttpError(409, `El S/N ${sn} no está registrado; elige a qué producto pertenece`);
        const sid = Number(db.prepare('INSERT INTO serials (product_id, serial, reference, warehouse_id, holder_id, held_at) VALUES (?,?,?,?,?,datetime(\'now\'))')
          .run(prod.id, sn, 'Alta en campo por el repartidor', whDefault()?.id || null, me).lastInsertRowid);
        serialEvent(sid, 'alta', null, me, 'Registrado en campo: el repartidor lo traía en su unidad');
        custodyLog(me, prod.id, 1, 'asignado', me, { serial: sn, reference: 'Alta en campo (lo traía en su unidad)' });
        s = db.prepare('SELECT s.*, p.name pname FROM serials s JOIN products p ON p.id = s.product_id WHERE s.id=?').get(sid);
      }
      const fromOpen = s.holder_id == null && s.open_pool === 1;
      const fromWh = s.holder_id == null && !s.open_pool && s.status === 'disponible';
      if (s.holder_id !== me && !fromOpen && !fromWh) throw new HttpError(409, `El S/N ${sn} lo trae otro repartidor`);
      if (s.status !== 'disponible') throw new HttpError(409, `El S/N ${sn} ya está ligado a otro pedido`);
      if (fromOpen || fromWh) {
        db.prepare("UPDATE serials SET holder_id=?, open_pool=0, held_at=datetime('now') WHERE id=?").run(me, s.id);
        custodyLog(me, s.product_id, 1, 'asignado', me, { serial: sn, reference: fromOpen ? 'Tomado del inventario abierto' : 'Tomado del almacén (lo traía en su unidad)' });
      }
      db.prepare("UPDATE serials SET status='asignado', order_id=?, assigned_at=datetime('now'), updated_at=datetime('now') WHERE id=?").run(oid, s.id);
      serialEvent(s.id, 'asignado', oid, me, `Pedido ${code} (armado por el repartidor)`);
      qtyBy.set(s.product_id, (qtyBy.get(s.product_id) || 0) + 1);
    }
    for (const it of items) {
      const p = db.prepare('SELECT * FROM products WHERE id=?').get(it.product_id);
      if (!p) throw new HttpError(400, 'Producto no encontrado');
      if (p.serialized) throw new HttpError(400, `${p.name} se entrega por número de serie`);
      const held = db.prepare('SELECT qty FROM driver_stock WHERE user_id=? AND product_id=?').get(me, p.id)?.qty || 0;
      const pool = db.prepare('SELECT qty FROM open_stock WHERE product_id=?').get(p.id)?.qty || 0;
      const wh = warehouseQty(p.id);
      if (it.qty > held + pool + wh) throw new HttpError(409, `Solo hay ${held + pool + wh} de ${p.name} (tuyos ${held}, abiertos ${pool}, almacén ${wh})`);
      // lo que falta se toma primero de lo abierto y luego del almacén; pasa a ser suyo
      const fromPool = Math.min(pool, Math.max(0, it.qty - held));
      const fromWh = Math.max(0, it.qty - held - fromPool);
      if (fromPool) db.prepare("UPDATE open_stock SET qty = qty - ?, updated_at=datetime('now') WHERE product_id=?").run(fromPool, p.id);
      if (fromPool + fromWh) {
        db.prepare(`INSERT INTO driver_stock (user_id, product_id, qty) VALUES (?,?,?)
          ON CONFLICT(user_id, product_id) DO UPDATE SET qty = qty + excluded.qty, updated_at = datetime('now')`).run(me, p.id, fromPool + fromWh);
        if (fromPool) custodyLog(me, p.id, fromPool, 'asignado', me, { reference: 'Tomado del inventario abierto' });
        if (fromWh) custodyLog(me, p.id, fromWh, 'asignado', me, { reference: 'Tomado del almacén (lo traía en su unidad)' });
      }
      qtyBy.set(p.id, (qtyBy.get(p.id) || 0) + it.qty);
    }
    // Si el cliente ya tenía un pedido abierto (p. ej. el que cargó la oficina), esta entrega lo reemplaza:
    // se cancela el anterior (sin pedido duplicado) y el nuevo hereda su mayorista y notas. Solo uno por entrega.
    const prev = db.prepare(`SELECT * FROM orders WHERE customer_id=? AND id<>? AND status IN ('pendiente','asignado','fallido','cargado')
      AND (status<>'cargado' OR driver_id=?) ORDER BY CASE status WHEN 'cargado' THEN 0 WHEN 'asignado' THEN 1 ELSE 2 END, id LIMIT 1`).get(c.id, oid, me);
    if (prev) {
      db.prepare("UPDATE orders SET account_id=COALESCE(account_id, ?), notes=TRIM(COALESCE(notes,'') || CASE WHEN COALESCE(notes,'')='' THEN '' ELSE ' | ' END || ?) WHERE id=?")
        .run(prev.account_id, `Reemplaza a ${prev.tracking_code}`, oid);
      for (const x of db.prepare("SELECT id FROM serials WHERE order_id=? AND status='asignado'").all(prev.id)) {
        db.prepare("UPDATE serials SET status='disponible', order_id=NULL, assigned_at=NULL, updated_at=datetime('now') WHERE id=?").run(x.id);
        serialEvent(x.id, 'liberado', prev.id, me, `Pedido reemplazado por ${code}`);
      }
      db.prepare("UPDATE orders SET status='cancelado', route_id=NULL, stop_seq=NULL, eta=NULL, leg_km=NULL, notes=TRIM(COALESCE(notes,'') || CASE WHEN COALESCE(notes,'')='' THEN '' ELSE ' | ' END || ?) WHERE id=?")
        .run(`Cancelado: reemplazado por ${code} (entrega registrada por el repartidor)`, prev.id);
    }
    for (const [pid, qty] of qtyBy) {
      db.prepare('INSERT INTO order_items (order_id, product_id, qty) VALUES (?,?,?)').run(oid, pid, qty);
      // la existencia libre baja como en cualquier pedido; lo que no haya queda por surtir
      takeStock(oid, pid, qty, code, me);
    }
    // a su ruta del día (o una nueva) y ya en su unidad
    const s = getSettings();
    const r = db.prepare("SELECT * FROM routes WHERE driver_id=? AND date=? AND status IN ('planificada','en_curso') ORDER BY id DESC LIMIT 1").get(me, today());
    const keep = r ? db.prepare("SELECT id FROM orders WHERE route_id=? AND status IN ('asignado','cargado')").all(r.id).map((x) => x.id) : [];
    persistRoute({ routeId: r?.id, name: `Ruta ${req.user.name || ''} ${today()}`.trim(), driverId: me, date: today(), depot: r ? { lat: r.depot_lat, lng: r.depot_lng } : depotOf(s, {}, me), orderIds: [...keep, oid], settings: s });
    db.prepare("UPDATE orders SET status='cargado', loaded_at=datetime('now') WHERE id=?").run(oid);
    return { id: oid, tracking_code: code };
  });
  audit(req, 'pedido.campo', `${out.tracking_code} → ${c.name}`);
  res.status(201).json(out);
}));
app.get('/api/custody/:driverId/log', auth(...STAFF), wrap((req, res) => {
  if (isOpen(req.params.driverId)) return res.json([]);
  res.json(db.prepare(`SELECT l.action, l.qty, l.serial, l.reference, l.created_at, p.name product_name, o.tracking_code, u.name by_name FROM custody_log l
    JOIN products p ON p.id = l.product_id LEFT JOIN orders o ON o.id = l.order_id LEFT JOIN users u ON u.id = l.by_user
    WHERE l.driver_id = ? ORDER BY l.id DESC LIMIT 60`).all(req.params.driverId));
}));
// Asignar: { driver_id, serials:[...] } para equipos con S/N, o { driver_id, product_id, qty } para productos sin S/N
app.get('/api/custody/balance', auth(...STAFF), wrap((req, res) => {
  const okD = (x) => /^\d{4}-\d{2}-\d{2}$/.test(x || '');
  const to = okD(req.query.to) ? req.query.to : today();
  const from = okD(req.query.from) ? req.query.from : to.slice(0, 8) + '01';
  const drivers = db.prepare(`SELECT u.id, u.name, u.active FROM users u WHERE (u.role='repartidor' OR u.can_deliver=1) AND u.deleted_at IS NULL ${inOffice(req, 'u')} ORDER BY u.active DESC, u.name`).all();
  const prods = new Map(db.prepare('SELECT id, name, sku, serialized FROM products').all().map((p) => [p.id, p]));
  const sgn = "CASE l.action WHEN 'asignado' THEN l.qty ELSE -l.qty END";
  const rows = [];
  for (const d of drivers) {
    const per = new Map();
    const row = (pid) => { if (!per.has(pid)) { const p = prods.get(pid) || {}; per.set(pid, { driver_id: d.id, driver: d.name, active: d.active, product_id: pid, product: p.name, sku: p.sku, serialized: !!p.serialized, inicial: 0, asignado: 0, entregado: 0, devuelto: 0, trae: 0, por_entregar: 0 }); } return per.get(pid); };
    for (const r of db.prepare(`SELECT l.product_id, SUM(${sgn}) n FROM custody_log l WHERE l.driver_id=? AND date(l.created_at,'localtime') < ? GROUP BY l.product_id`).all(d.id, from)) row(r.product_id).inicial = r.n;
    for (const r of db.prepare("SELECT l.product_id, l.action, SUM(l.qty) n FROM custody_log l WHERE l.driver_id=? AND date(l.created_at,'localtime') BETWEEN ? AND ? GROUP BY l.product_id, l.action").all(d.id, from, to)) row(r.product_id)[r.action] = r.n;
    for (const r of db.prepare('SELECT product_id, qty FROM driver_stock WHERE user_id=? AND qty <> 0').all(d.id)) row(r.product_id).trae += r.qty;
    for (const r of db.prepare("SELECT product_id, COUNT(*) n FROM serials WHERE holder_id=? AND status IN ('disponible','asignado') GROUP BY product_id").all(d.id)) row(r.product_id).trae += r.n;
    for (const r of db.prepare("SELECT i.product_id, SUM(i.qty) n FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.driver_id=? AND o.status IN ('asignado','cargado') GROUP BY i.product_id").all(d.id)) if (per.has(r.product_id) || r.n) row(r.product_id).por_entregar = r.n;
    for (const r of per.values()) {
      r.debe_traer = r.inicial + r.asignado - r.entregado - r.devuelto;
      // la diferencia solo se puede medir al día de hoy (lo que trae es de hoy)
      r.diferencia = to >= today() ? r.trae - r.debe_traer : null;
      r.faltan_para_ruta = Math.max(0, r.por_entregar - r.trae);
      if (r.inicial || r.asignado || r.entregado || r.devuelto || r.trae || r.por_entregar) rows.push(r);
    }
  }
  res.json({ from, to, rows });
}));
app.post('/api/custody/assign', auth(...STAFF), wrap((req, res) => {
  const b = req.body || {};
  const open = isOpen(b.driver_id);
  const d = open ? { id: null, name: 'Abierto (cualquier repartidor)', active: 1 } : db.prepare("SELECT id, name, active FROM users WHERE id=? AND (role='repartidor' OR can_deliver=1)").get(Number(b.driver_id));
  if (!d) throw new HttpError(400, 'Elige el repartidor');
  if (!d.active) throw new HttpError(409, `${d.name} está desactivado`);
  const ref = String(b.reference || '').trim().slice(0, 80) || null;
  const dry = !!b.dry_run;
  const results = [];
  tx(() => {
    if (Array.isArray(b.serials) && b.serials.length) {
      if (b.serials.length > 2000) throw new HttpError(400, 'Máximo 2,000 series a la vez');
      const seen = new Set();
      for (const raw of b.serials) {
        const sn = normSerial(raw);
        if (!sn) continue;
        if (seen.has(sn)) { results.push({ serial: sn, ok: false, error: 'Repetido en la lista' }); continue; }
        seen.add(sn);
        const s = db.prepare('SELECT s.*, p.name pname, u.name holder_name FROM serials s JOIN products p ON p.id=s.product_id LEFT JOIN users u ON u.id=s.holder_id WHERE s.serial=?').get(sn);
        if (!s) { results.push({ serial: sn, ok: false, error: 'No está registrado en el inventario' }); continue; }
        if (['entregado', 'baja'].includes(s.status)) { results.push({ serial: sn, ok: false, error: s.status === 'entregado' ? 'Ya fue entregado a un cliente' : 'Está dado de baja' }); continue; }
        if (!open && s.holder_id === d.id) { results.push({ serial: sn, ok: false, error: `${d.name} ya lo trae` }); continue; }
        if (open && s.open_pool === 1 && s.holder_id == null) { results.push({ serial: sn, ok: false, error: 'Ya está abierto' }); continue; }
        results.push({ serial: sn, ok: true, product: s.pname, note: s.holder_id ? `Se pasa de ${s.holder_name}` : s.open_pool ? 'Sale de abierto' : null });
        if (dry) continue;
        if (s.holder_id) custodyLog(s.holder_id, s.product_id, 1, 'devuelto', req.user.id, { serial: sn, reference: `Reasignado a ${d.name}` });
        db.prepare("UPDATE serials SET holder_id=?, open_pool=?, held_at=datetime('now'), updated_at=datetime('now') WHERE id=?").run(d.id, open ? 1 : 0, s.id);
        serialEvent(s.id, open ? 'abierto' : 'repartidor', s.order_id, req.user.id, `${open ? 'Abierto para cualquier repartidor' : 'Entregado a ' + d.name}${ref ? ' · ' + ref : ''}`);
        if (!open) custodyLog(d.id, s.product_id, 1, 'asignado', req.user.id, { serial: sn, reference: ref });
      }
    }
    // productos sin S/N por cantidad: items:[{product_id, qty}] (varios a la vez) o product_id + qty (uno)
    const items = Array.isArray(b.items) ? b.items : b.product_id ? [{ product_id: b.product_id, qty: b.qty }] : [];
    if (!items.length && !(Array.isArray(b.serials) && b.serials.length)) throw new HttpError(400, 'Elige al menos un producto o equipo');
    for (const it of items) {
      const p = db.prepare('SELECT * FROM products WHERE id=?').get(Number(it.product_id));
      if (!p) throw new HttpError(400, 'Elige el producto');
      // con S/N también se puede dar por cantidad (sin detalle de series): el repartidor registra el S/N al entregar
      const qty = Math.trunc(Number(it.qty));
      if (!(qty > 0)) throw new HttpError(400, `Escribe la cantidad de ${p.name}`);
      const avail = p.serialized ? serialQtyAvail(p.id) : warehouseQty(p.id);
      if (qty > avail) throw new HttpError(409, `Solo hay ${avail} ${p.unit || 'pza'} de ${p.name} en el almacén`);
      results.push({ product: p.name + (p.serialized ? ' (sin detalle de S/N)' : ''), qty, ok: true });
      if (!dry && open) {
        db.prepare(`INSERT INTO open_stock (product_id, qty) VALUES (?,?)
          ON CONFLICT(product_id) DO UPDATE SET qty = qty + excluded.qty, updated_at = datetime('now')`).run(p.id, qty);
      } else if (!dry) {
        db.prepare(`INSERT INTO driver_stock (user_id, product_id, qty) VALUES (?,?,?)
          ON CONFLICT(user_id, product_id) DO UPDATE SET qty = qty + excluded.qty, updated_at = datetime('now')`).run(d.id, p.id, qty);
        custodyLog(d.id, p.id, qty, 'asignado', req.user.id, { reference: ref });
      }
    }
  });
  const ok = results.filter((r) => r.ok);
  const nSn = ok.filter((r) => r.serial).length;
  if (!dry && ok.length) audit(req, 'inventario.asignar', `${d.name}: ${[nSn ? `${nSn} equipos con S/N` : '', ...ok.filter((r) => !r.serial).map((r) => `${r.qty} ${r.product}`)].filter(Boolean).join(', ')}`);
  res.json({ dry_run: dry, driver: d.name, assigned: ok.reduce((a, r) => a + (r.qty || 1), 0), results, errors: results.filter((r) => !r.ok) });
}));
// Devolver al almacén: { driver_id, serials:[...] } | { driver_id, product_id, qty } | { driver_id, all: true }
app.post('/api/custody/return', auth(...STAFF), wrap((req, res) => {
  const b = req.body || {};
  if (isOpen(b.driver_id)) {
    let n = 0;
    const ref = String(b.reference || '').trim().slice(0, 80) || null;
    tx(() => {
      const back = (s) => { db.prepare("UPDATE serials SET open_pool=0, held_at=NULL, updated_at=datetime('now') WHERE id=?").run(s.id); serialEvent(s.id, 'almacen', s.order_id, req.user.id, `Regresó de abierto al almacén${ref ? ' · ' + ref : ''}`); n++; };
      if (b.all) {
        for (const s of db.prepare('SELECT * FROM serials WHERE open_pool=1 AND holder_id IS NULL').all()) back(s);
        n += db.prepare('SELECT COALESCE(SUM(qty),0) n FROM open_stock').get().n;
        db.prepare('DELETE FROM open_stock').run();
      } else if (Array.isArray(b.serials) && b.serials.length) {
        for (const raw of b.serials) { const s = db.prepare('SELECT * FROM serials WHERE serial=? AND open_pool=1').get(normSerial(raw)); if (s) back(s); }
      } else {
        const q = db.prepare('SELECT qty FROM open_stock WHERE product_id=?').get(Number(b.product_id));
        const qty = Math.trunc(Number(b.qty));
        if (!q || !(qty > 0) || qty > q.qty) throw new HttpError(409, `En abierto solo hay ${q?.qty || 0} de ese producto`);
        db.prepare("UPDATE open_stock SET qty = qty - ?, updated_at=datetime('now') WHERE product_id=?").run(qty, Number(b.product_id));
        n += qty;
      }
    });
    if (n) audit(req, 'inventario.devolver', `Abierto: ${n} de regreso al almacén`);
    return res.json({ returned: n, errors: [] });
  }
  const d = db.prepare("SELECT id, name FROM users WHERE id=? AND (role='repartidor' OR can_deliver=1)").get(Number(b.driver_id));
  if (!d) throw new HttpError(400, 'Elige el repartidor');
  const ref = String(b.reference || '').trim().slice(0, 80) || null;
  let n = 0;
  const errors = [];
  tx(() => {
    const back = (s) => {
      db.prepare("UPDATE serials SET holder_id=NULL, held_at=NULL, updated_at=datetime('now') WHERE id=?").run(s.id);
      serialEvent(s.id, 'almacen', s.order_id, req.user.id, `Devuelto por ${d.name}${ref ? ' · ' + ref : ''}`);
      custodyLog(d.id, s.product_id, 1, 'devuelto', req.user.id, { serial: s.serial, reference: ref });
      n++;
    };
    if (b.all) {
      for (const s of db.prepare('SELECT * FROM serials WHERE holder_id=?').all(d.id)) back(s);
      for (const q of db.prepare('SELECT * FROM driver_stock WHERE user_id=? AND qty>0').all(d.id)) {
        custodyLog(d.id, q.product_id, q.qty, 'devuelto', req.user.id, { reference: ref });
        n += q.qty;
      }
      db.prepare('DELETE FROM driver_stock WHERE user_id=?').run(d.id);
    } else if (Array.isArray(b.serials) && b.serials.length) {
      for (const raw of b.serials) {
        const sn = normSerial(raw);
        const s = db.prepare('SELECT * FROM serials WHERE serial=?').get(sn);
        if (!s || s.holder_id !== d.id) { errors.push({ serial: sn, error: `${d.name} no trae este equipo` }); continue; }
        back(s);
      }
    } else {
      const q = db.prepare('SELECT * FROM driver_stock WHERE user_id=? AND product_id=?').get(d.id, Number(b.product_id));
      const qty = Math.trunc(Number(b.qty));
      if (!q || !(qty > 0) || qty > q.qty) throw new HttpError(409, `${d.name} solo trae ${q?.qty || 0} de ese producto`);
      db.prepare("UPDATE driver_stock SET qty = qty - ?, updated_at=datetime('now') WHERE user_id=? AND product_id=?").run(qty, d.id, q.product_id);
      custodyLog(d.id, q.product_id, qty, 'devuelto', req.user.id, { reference: ref });
      n += qty;
    }
  });
  if (n) audit(req, 'inventario.devolver', `${d.name} devolvió ${n} al almacén`);
  res.json({ returned: n, errors });
}));
// Al entregar un pedido, lo que el repartidor traía de ese pedido sale de su inventario
function custodyOnDelivery(orderId, driverId, userId) {
  const code = db.prepare('SELECT tracking_code FROM orders WHERE id=?').get(orderId)?.tracking_code || orderId;
  for (const it of db.prepare('SELECT product_id, qty - filled need FROM order_items WHERE order_id=? AND filled < qty').all(orderId))
    takeStock(orderId, it.product_id, it.need, code, userId, ' (entregado)', { force: true });
  if (driverId) for (const g of db.prepare("SELECT product_id, GROUP_CONCAT(serial, ', ') sns, COUNT(*) n FROM serials WHERE order_id=? AND holder_id IS NULL AND open_pool=0 GROUP BY product_id").all(orderId)) {
    const q = db.prepare('SELECT qty FROM driver_stock WHERE user_id=? AND product_id=?').get(driverId, g.product_id);
    const take = Math.min(q?.qty || 0, g.n);
    if (!take) continue;
    db.prepare("UPDATE driver_stock SET qty = qty - ?, updated_at=datetime('now') WHERE user_id=? AND product_id=?").run(take, driverId, g.product_id);
    custodyLog(driverId, g.product_id, take, 'entregado', userId, { serial: g.sns, orderId, reference: 'De su dotación por cantidad' });
  }
  db.prepare('UPDATE serials SET open_pool=0 WHERE order_id=?').run(orderId);
  for (const s of db.prepare('SELECT * FROM serials WHERE order_id=? AND holder_id IS NOT NULL').all(orderId)) {
    db.prepare('UPDATE serials SET holder_id=NULL, held_at=NULL WHERE id=?').run(s.id);
    custodyLog(s.holder_id, s.product_id, 1, 'entregado', userId, { serial: s.serial, orderId });
  }
  if (!driverId) return;
  for (const it of db.prepare('SELECT oi.product_id, oi.qty FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id=? AND p.serialized=0').all(orderId)) {
    const q = db.prepare('SELECT qty FROM driver_stock WHERE user_id=? AND product_id=?').get(driverId, it.product_id);
    const take = Math.min(q?.qty || 0, it.qty);
    if (!take) continue;
    db.prepare('UPDATE driver_stock SET qty = qty - ? WHERE user_id=? AND product_id=?').run(take, driverId, it.product_id);
    custodyLog(driverId, it.product_id, take, 'entregado', userId, { orderId });
  }
}
app.post(
  '/api/serials/:id/action',
  auth(...STAFF),
  wrap((req, res) => {
    const s = db.prepare('SELECT s.*, p.name pname FROM serials s JOIN products p ON p.id=s.product_id WHERE s.id=?').get(req.params.id);
    if (!s) throw new HttpError(404, 'No encontrado');
    const action = req.body?.action;
    const notes = String(req.body?.notes || '').trim().slice(0, 200);
    const rules = {
      baja: { from: 'disponible', to: 'baja', move: ['ajuste', -1], label: 'Baja' },
      reingreso: { from: 'baja', to: 'disponible', move: ['ajuste', 1], label: 'Reingreso' },
      devolucion: { from: 'entregado', to: 'disponible', move: ['devolucion', 1], label: 'Devolución del cliente' },
    }[action];
    if (!rules) throw new HttpError(400, 'Acción inválida');
    if (s.status !== rules.from) throw new HttpError(409, `No se puede: el S/N está "${s.status}"`);
    if (action === 'baja' && !notes) throw new HttpError(400, 'Indica el motivo de la baja');
    tx(() => {
      db.prepare(`UPDATE serials SET status=?, ${action === 'devolucion' ? 'order_id=NULL, ' : ''}notes=COALESCE(?, notes), updated_at=datetime('now') WHERE id=?`).run(rules.to, notes || null, s.id);
      serialEvent(s.id, action, action === 'devolucion' ? s.order_id : null, req.user.id, notes || null);
      moveStock(s.product_id, rules.move[0], rules.move[1], `${rules.label} S/N ${s.serial}${notes ? ' · ' + notes : ''}`, req.user.id);
    });
    audit(req, 'series.' + action, `${s.serial} (${s.pname})`);
    res.json({ ok: true });
  })
);
app.post(
  '/api/orders/:id/serials',
  auth(),
  wrap((req, res) => {
    const o = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
    if (!o) throw new HttpError(404, 'Pedido no encontrado');
    if (!canSee(req.user, o)) throw new HttpError(403, 'Este pedido no está asignado a ti');
    const r = tx(() => {
      // swap: el repartidor eligió un equipo de otro producto (otro modelo): ese equipo reemplaza al artículo del pedido que aún no tiene S/N
      if (req.body?.swap) {
        const s = db.prepare('SELECT s.product_id, p.name FROM serials s JOIN products p ON p.id = s.product_id WHERE s.serial = ?').get(normSerial(req.body.serial));
        const needs = orderSerialNeeds(o.id);
        if (s && !needs.some((n) => n.product_id === s.product_id && n.missing)) {
          const from = needs.find((n) => n.missing && n.assigned === 0);
          if (!from) throw new HttpError(409, 'Este pedido ya tiene S/N asignados: pide a la oficina que cambie el producto');
          const it = db.prepare('SELECT * FROM order_items WHERE order_id=? AND product_id=?').get(o.id, from.product_id);
          if (it.qty > 1) {
            db.prepare('UPDATE order_items SET qty = qty - 1, filled = MIN(filled, qty - 1) WHERE id=?').run(it.id);
            const ex = db.prepare('SELECT id FROM order_items WHERE order_id=? AND product_id=?').get(o.id, s.product_id);
            if (ex) db.prepare('UPDATE order_items SET qty = qty + 1 WHERE id=?').run(ex.id);
            else db.prepare('INSERT INTO order_items (order_id, product_id, qty) VALUES (?,?,1)').run(o.id, s.product_id);
          } else db.prepare('UPDATE order_items SET product_id=? WHERE id=?').run(s.product_id, it.id);
          db.prepare("UPDATE orders SET notes=TRIM(COALESCE(notes,'') || ?) WHERE id=?").run(` | Se entrega ${s.name} en lugar de ${from.name} (${req.user.name})`, o.id);
          audit(req, 'pedidos.producto', `${o.tracking_code}: ${from.name} → ${s.name} (elegido al entregar)`);
        }
      }
      return assignSerial(o, req.body?.serial, req.user);
    });
    res.json({ ok: true, already: r.already, serial: r.serial.serial, product: r.serial.pname, missing: missingSerialCount(o.id), serials: serialsOfOrder(o.id) });
  })
);
app.delete(
  '/api/orders/:id/serials/:sid',
  auth(...STAFF),
  wrap((req, res) => {
    const s = db.prepare('SELECT * FROM serials WHERE id=? AND order_id=?').get(req.params.sid, req.params.id);
    if (!s) throw new HttpError(404, 'Esa serie no está en este pedido');
    if (!officeOrders(req, [s.order_id]).length) throw new HttpError(403, 'Este pedido es de otra oficina');
    if (s.status !== 'asignado' && !(s.status === 'entregado' && req.user.role === 'admin')) throw new HttpError(409, 'Solo el administrador puede quitar un S/N ya entregado');
    const o = db.prepare('SELECT * FROM orders WHERE id=?').get(s.order_id);
    let how = 'liberado';
    tx(() => {
      // S/N que solo existió por este pedido (alta al asignar, sin otro movimiento): era un error de captura y se borra
      const otherEvents = db.prepare("SELECT COUNT(*) n FROM serial_events WHERE serial_id=? AND event NOT IN ('alta','asignado','entregado','corregido')").get(s.id).n;
      const typo = /^Alta (al asignar|en campo)/.test(s.reference || '') && !otherEvents;
      if (typo) {
        db.prepare('DELETE FROM serial_events WHERE serial_id=?').run(s.id);
        db.prepare('DELETE FROM serials WHERE id=?').run(s.id);
        how = 'borrado';
      } else {
        // regresa al inventario disponible (almacén de la oficina del pedido)
        db.prepare("UPDATE serials SET status='disponible', order_id=NULL, assigned_at=NULL, delivered_at=NULL, holder_id=NULL, held_at=NULL, open_pool=0, warehouse_id=COALESCE(warehouse_id, ?), updated_at=datetime('now') WHERE id=?").run(customerOffice(o.customer_id), s.id);
        serialEvent(s.id, 'liberado', o.id, req.user.id, s.status === 'entregado' ? 'Quitado de un pedido entregado (corrección de administración)' : 'Quitado del pedido');
      }
      // pedido entregado: también baja la cantidad del producto (lo entregado fue una pieza menos)
      if (s.status === 'entregado') {
        const it = db.prepare('SELECT qty FROM order_items WHERE order_id=? AND product_id=?').get(o.id, s.product_id);
        if (it && it.qty > 1) db.prepare('UPDATE order_items SET qty=qty-1, filled=MIN(filled, qty-1) WHERE order_id=? AND product_id=?').run(o.id, s.product_id);
        else if (it) db.prepare('DELETE FROM order_items WHERE order_id=? AND product_id=?').run(o.id, s.product_id);
        db.prepare("UPDATE sheet_sync SET status='pendiente', attempts=0, next_try_at=datetime('now') WHERE order_id=? AND status<>'desactivado'").run(o.id);
      }
    });
    audit(req, 'series.quitar', `${o.tracking_code}: ${s.serial} ${how === 'borrado' ? 'borrado (error de captura)' : 'regresó al inventario'}`);
    res.json({ ok: true, how, missing: missingSerialCount(o.id), serials: serialsOfOrder(o.id) });
  })
);

// Corregir un S/N mal capturado en un pedido (también ya entregado):
// - si el S/N correcto no existe en el sistema, se corrige el texto (error de dedo)
// - si existe y está libre (almacén, repartidor o abierto), pasa a este pedido y el equivocado ocupa su lugar en el inventario
app.post('/api/orders/:id/serials/fix', auth(...STAFF), wrap((req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
  if (!o) throw new HttpError(404, 'No encontrado');
  if (!officeOrders(req, [o.id]).length) throw new HttpError(403, 'Este pedido es de otra oficina');
  const oldS = normSerial(req.body?.old_serial), newS = telmexSerial(req.body?.new_serial);
  if (!newS || newS.length < 5) throw new HttpError(400, 'Escribe el número de serie correcto');
  if (newS === oldS) throw new HttpError(400, 'Es el mismo número de serie');
  const old = db.prepare('SELECT * FROM serials WHERE serial=? AND order_id=?').get(oldS, o.id);
  if (!old) throw new HttpError(404, `${oldS} no está en este pedido`);
  const ex = db.prepare('SELECT s.*, (SELECT tracking_code FROM orders WHERE id=s.order_id) ped FROM serials s WHERE serial=?').get(newS);
  let how;
  tx(() => {
    if (!ex) {
      db.prepare("UPDATE serials SET serial=?, updated_at=datetime('now') WHERE id=?").run(newS, old.id);
      serialEvent(old.id, 'corregido', o.id, req.user.id, `S/N corregido: ${oldS} → ${newS} (error de captura)`);
      how = 'corregido';
    } else {
      if (ex.order_id === o.id) throw new HttpError(409, `${newS} ya está en este pedido`);
      if (ex.status === 'entregado' || ex.order_id) throw new HttpError(409, `${newS} está ${ex.status} en el pedido ${ex.ped || '—'}`);
      if (ex.product_id !== old.product_id) throw new HttpError(409, `${newS} es de otro artículo`);
      // el correcto toma el lugar del equivocado en el pedido; el equivocado vuelve a donde estaba el correcto
      db.prepare("UPDATE serials SET status=?, order_id=?, assigned_at=?, delivered_at=?, holder_id=NULL, held_at=NULL, open_pool=0, updated_at=datetime('now') WHERE id=?")
        .run(old.status, o.id, old.assigned_at, old.delivered_at, ex.id);
      db.prepare("UPDATE serials SET status='disponible', order_id=NULL, assigned_at=NULL, delivered_at=NULL, holder_id=?, held_at=?, open_pool=?, warehouse_id=?, updated_at=datetime('now') WHERE id=?")
        .run(ex.holder_id, ex.held_at, ex.open_pool, ex.warehouse_id, old.id);
      serialEvent(ex.id, old.status, o.id, req.user.id, `Corrección de captura: era ${oldS}`);
      serialEvent(old.id, 'liberado', o.id, req.user.id, `Corrección de captura: el correcto es ${newS}; vuelve al inventario`);
      how = 'intercambiado';
    }
    // la hoja de Google se vuelve a enviar con el S/N correcto
    db.prepare("UPDATE sheet_sync SET status='pendiente', attempts=0, next_try_at=datetime('now') WHERE order_id=? AND status<>'desactivado'").run(o.id);
  });
  audit(req, 'series.correccion', `${o.tracking_code}: ${oldS} → ${newS} (${how})`);
  res.json({ ok: true, how, serials: serialsOfOrder(o.id), serials_text: db.prepare("SELECT GROUP_CONCAT(serial, ', ') t FROM serials WHERE order_id=?").get(o.id).t });
}));
app.post(
  '/api/inventory/movements',
  auth(...STAFF),
  wrap((req, res) => {
    const { product_id, barcode, type, qty, reference } = req.body;
    let pid = product_id;
    if (!pid && barcode) {
      const p = db.prepare('SELECT id FROM products WHERE barcode = ? OR sku = ?').get(barcode, barcode);
      if (!p) throw new HttpError(404, 'Código no registrado');
      pid = p.id;
    }
    const stock = tx(() => moveStock(pid, type, qty, reference, req.user.id));
    res.status(201).json({ product_id: pid, stock });
  })
);
app.get(
  '/api/inventory/movements',
  auth(...STAFF),
  wrap((req, res) => {
    const { limit, offset } = paging(req);
    const args = [];
    let w = '';
    if (req.query.product_id) {
      w = 'WHERE m.product_id = ?';
      args.push(req.query.product_id);
    }
    const rows = db
      .prepare(
        `SELECT m.*, p.name product_name, p.sku, u.name user_name FROM inventory_movements m
         JOIN products p ON p.id = m.product_id LEFT JOIN users u ON u.id = m.user_id
         ${w} ORDER BY m.id DESC LIMIT ? OFFSET ?`
      )
      .all(...args, limit, offset);
    res.json(rows);
  })
);

// ---------- Clientes ----------
app.get(
  '/api/customers',
  auth(),
  wrap((req, res) => {
    const { q } = req.query;
    if (cachedList(req, res)) return;
    const { limit, offset } = paging(req, 200000);
    const args = [];
    let w = '';
    let matchCol = 'NULL match_txt';
    const margs = [];
    if (q) {
      const qs = `%${normSerial(q)}%`;
      w = `WHERE c.id IN (SELECT o.customer_id FROM serials s JOIN orders o ON o.id = s.order_id WHERE s.serial LIKE ?)
             OR c.id IN (SELECT customer_id FROM orders WHERE tracking_code LIKE ?)
             OR c.name LIKE ? OR c.phone LIKE ? OR c.phone_alt LIKE ? OR c.external_id LIKE ? OR c.address LIKE ? OR c.email LIKE ?`;
      args.push(qs, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
      // qué coincidió (S/N o pedido), para mostrarlo en la lista
      matchCol = `COALESCE((SELECT 'S/N ' || GROUP_CONCAT(s.serial, ', ') FROM serials s JOIN orders o ON o.id = s.order_id WHERE o.customer_id = c.id AND s.serial LIKE ?),
                          (SELECT 'Pedido ' || GROUP_CONCAT(tracking_code, ', ') FROM orders WHERE customer_id = c.id AND tracking_code LIKE ?)) match_txt`;
      margs.push(qs, `%${q}%`);
    }
    const offC = req.user.office || req.query.office_id;
    if (offC) { w = (w ? `WHERE (${w.slice(6)}) AND ` : 'WHERE ') + `${OFFICE_OF('c')} = ?`; args.push(Number(offC)); }
    if (cityIn(req)) w = (w ? `WHERE (${w.slice(6)})` : 'WHERE 1') + cityIn(req);
    const total = db.prepare(`SELECT COUNT(*) c FROM customers c ${w}`).get(...args).c;
    const rows = db
      .prepare(
        `SELECT c.*, ${matchCol}, COALESCE(ag.n, 0) orders_count, COALESCE(ag.open_n, 0) open_orders, COALESCE(ag.act_n, 0) active_orders,
           (SELECT o.status FROM orders o WHERE o.customer_id = c.id ORDER BY o.scheduled_date DESC, o.id DESC LIMIT 1) last_status,
           CASE WHEN ag.drv_n > 0 THEN (SELECT u.name FROM orders o JOIN users u ON u.id = o.driver_id WHERE o.customer_id = c.id AND o.status IN ('asignado','cargado') ORDER BY o.id DESC LIMIT 1) END driver_name,
           wo.name office_name
         FROM customers c
         LEFT JOIN (SELECT customer_id, COUNT(*) n, SUM(status IN ('pendiente','asignado')) open_n, SUM(status IN ('pendiente','asignado','cargado','fallido')) act_n, SUM(status IN ('asignado','cargado')) drv_n FROM orders GROUP BY customer_id) ag ON ag.customer_id = c.id
         LEFT JOIN warehouses wo ON wo.id = ${OFFICE_OF('c')}
         ${w} ORDER BY c.name LIMIT ? OFFSET ?`
      )
      .all(...margs, ...args, limit, offset);
    sendList(req, res, { total, rows });
  })
);
const customerFields = ['office_id', 'name', 'external_id', 'phone', 'phone_alt', 'email', 'address', 'colonia', 'reference', 'city', 'zip', 'lat', 'lng', 'window_start', 'window_end', 'notes', 'notify_sms', 'notify_email', 'notify_whatsapp'];
const custVal = (b, f) => {
  if (f.startsWith('notify_')) return b[f] === undefined ? 1 : [true, 1, '1', 'on', 'true'].includes(b[f]) ? 1 : 0;
  if (f === 'office_id') return b[f] === '' || b[f] == null ? officeForCity(b.city) : Number(b[f]);
  if (f === 'city') return b.city === '' || b.city == null ? null : canonCity(b.city);
  return b[f] === '' || b[f] === undefined ? null : f === 'lat' || f === 'lng' ? Number(b[f]) : b[f];
};
// Oficina que atiende una ciudad (si no hay, queda en la principal)
// La oficina puede atender varias ciudades: "Mexicali, San Luis Río Colorado" (sin importar acentos ni mayúsculas)
const normCity = (x) => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[.]/g, ' ').replace(/\s+/g, ' ').trim()
  .replace(/\br c$/, 'rio colorado');
const officeCities = (w) => String(w.city || '').split(/[,;/]/).map(normCity).filter(Boolean);
// Nombre oficial de la ciudad: "Rosarito" se guarda como "Playas de Rosarito"
// Nombre de ciudad uniforme: el de las oficinas (Tijuana, Mexicali, San Luis Río Colorado…), sus abreviaturas comunes y,
// para cualquier otra, mayúscula inicial en cada palabra ("de", "del", "la"… en minúscula)
const CITY_CANON = {
  rosarito: 'Playas de Rosarito', 'playas de rosarito': 'Playas de Rosarito', 'playas rosarito': 'Playas de Rosarito', 'p rosarito': 'Playas de Rosarito',
  tj: 'Tijuana', tij: 'Tijuana', mxl: 'Mexicali', mexicalli: 'Mexicali', ens: 'Ensenada',
  'san luis': 'San Luis Río Colorado', slrc: 'San Luis Río Colorado', 'san luis rc': 'San Luis Río Colorado', 'san luis r c': 'San Luis Río Colorado', 'san luis rio colorado': 'San Luis Río Colorado', 'san luis colorado': 'San Luis Río Colorado',
  's l r c': 'San Luis Río Colorado', 'san quintin': 'San Quintín', tecate: 'Tecate', tijuana: 'Tijuana', mexicali: 'Mexicali', ensenada: 'Ensenada',
};
const CITY_SMALL = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y']);
const titleCity = (t) => t.toLocaleLowerCase('es-MX').split(' ').map((w, i) => (i && CITY_SMALL.has(w) ? w : w.charAt(0).toLocaleUpperCase('es-MX') + w.slice(1))).join(' ');
let officeCityNames = { at: 0, map: new Map() };
function canonCity(city) {
  const t = String(city || '').replace(/\s+/g, ' ').trim().replace(/[.,;]+$/, '');
  if (!t) return t;
  const k = normCity(t);
  if (CITY_CANON[k]) return CITY_CANON[k];
  if (Date.now() - officeCityNames.at > 60000) {
    const map = new Map();
    for (const w of db.prepare('SELECT city FROM warehouses WHERE city IS NOT NULL').all()) for (const c of String(w.city).split(/[,;/]/).map((x) => x.trim()).filter(Boolean)) map.set(normCity(c), c);
    officeCityNames = { at: Date.now(), map };
  }
  return officeCityNames.map.get(k) || titleCity(t);
}
function officeForCity(city) {
  const c = normCity(city);
  if (!c) return null;
  const ws = db.prepare('SELECT id, city FROM warehouses WHERE active = 1 ORDER BY is_default DESC, id').all();
  return ws.find((w) => officeCities(w).includes(c))?.id ?? null;
}
const OFFICE_OF = (alias) => `COALESCE(${alias}.office_id, (SELECT id FROM warehouses WHERE is_default = 1))`;

// ---------- Pedidos por surtir (sin existencia al crearlos) ----------
app.get('/api/stock/backorders', auth(...STAFF), wrap((req, res) => {
  const rows = db.prepare(`SELECT p.id product_id, p.name, p.sku, p.stock, p.serialized, COUNT(DISTINCT o.id) orders, SUM(i.qty - i.filled) missing,
      SUM(o.status IN ('asignado','cargado')) in_route, MIN(o.scheduled_date) oldest
    FROM order_items i JOIN orders o ON o.id = i.order_id JOIN products p ON p.id = i.product_id JOIN customers c ON c.id = o.customer_id
    WHERE i.filled < i.qty AND o.status IN ${OPEN_ST} ${inOffice(req, 'c')} GROUP BY p.id ORDER BY missing DESC`).all();
  res.json({ products: rows, orders: rows.reduce((a, r) => a + r.orders, 0), missing: rows.reduce((a, r) => a + r.missing, 0), auto: getSettings().auto_fill !== '0' });
}));
app.get('/api/stock/by-office', auth(...STAFF), wrap((req, res) => {
  const offs = db.prepare(`SELECT id, name, city FROM warehouses WHERE active = 1 ${req.user.office ? 'AND id = ' + Number(req.user.office) : ''} ORDER BY is_default DESC, name`).all();
  const prods = db.prepare('SELECT id, name, sku, serialized, stock FROM products').all();
  const need = db.prepare(`SELECT i.product_id, SUM(i.qty - i.filled) n, SUM(CASE WHEN o.status IN ('asignado','cargado') THEN i.qty - i.filled ELSE 0 END) ruta, COUNT(DISTINCT o.id) pedidos
    FROM order_items i JOIN orders o ON o.id = i.order_id JOIN customers c ON c.id = o.customer_id
    WHERE o.status IN ${OPEN_ST} AND i.filled < i.qty AND ${OFFICE_OF('c')} = ? ${cityIn(req, 'c')} GROUP BY i.product_id`);
  const sn = db.prepare(`SELECT s.product_id,
      SUM(s.holder_id IS NULL AND s.open_pool = 0) almacen,
      SUM(s.holder_id IS NOT NULL) repartidores,
      SUM(s.holder_id IS NULL AND s.open_pool = 1) abierto
    FROM serials s LEFT JOIN users u ON u.id = s.holder_id
    WHERE s.status = 'disponible' AND (CASE WHEN s.holder_id IS NOT NULL THEN ${OFFICE_OF('u')} ELSE COALESCE(s.warehouse_id, (SELECT id FROM warehouses WHERE is_default = 1)) END) = ?
    GROUP BY s.product_id`);
  const out = offs.map((w) => {
    const nd = new Map(need.all(w.id).map((r) => [r.product_id, r]));
    const sv = new Map(sn.all(w.id).map((r) => [r.product_id, r]));
    for (const q of db.prepare(`SELECT d.product_id, SUM(d.qty) n FROM driver_stock d JOIN users u ON u.id = d.user_id WHERE d.qty > 0 AND ${OFFICE_OF('u')} = ? GROUP BY d.product_id`).all(w.id)) {
      const v = sv.get(q.product_id) || { almacen: 0, repartidores: 0, abierto: 0 };
      const mv = Math.min(v.almacen || 0, q.n); v.almacen = (v.almacen || 0) - mv; v.repartidores = (v.repartidores || 0) + mv; sv.set(q.product_id, v);
    }
    const rows = prods.map((p) => {
      const n = nd.get(p.id) || {}, v = sv.get(p.id) || {};
      const have = p.serialized ? (v.almacen || 0) + (v.repartidores || 0) + (v.abierto || 0) : null;
      return { product_id: p.id, name: p.name, sku: p.sku, serialized: p.serialized, pedidos: n.pedidos || 0, necesita: n.n || 0, en_ruta: n.ruta || 0,
        almacen: v.almacen || 0, repartidores: v.repartidores || 0, abierto: v.abierto || 0, disponible: have, faltan: have == null ? null : Math.max(0, (n.n || 0) - have) };
    }).filter((r) => r.necesita || r.disponible);
    return { id: w.id, name: w.name, cities: w.city, rows };
  });
  res.json({ offices: out, stock_at: getSettings().stock_at || 'pedido' });
}));
app.post('/api/stock/fill', auth(...STAFF), wrap((req, res) => {
  const r = tx(() => fillBackorders(req.user.id, Number(req.body?.product_id) || null));
  const left = db.prepare(`SELECT COALESCE(SUM(i.qty - i.filled), 0) n FROM order_items i JOIN orders o ON o.id = i.order_id WHERE i.filled < i.qty AND o.status IN ${OPEN_ST}`).get().n;
  res.json({ ...r, left });
}));
// ---------- Oficinas foráneas por ciudad ----------
app.get('/api/offices', auth(...STAFF), wrap((req, res) => {
  const now = new Date(); const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const rows = db.prepare(`SELECT w.*,
      (SELECT COUNT(*) FROM serials s WHERE s.warehouse_id = w.id AND s.holder_id IS NULL AND s.open_pool = 0 AND s.status IN ('disponible','asignado')) units,
      (SELECT COUNT(*) FROM customers c WHERE ${OFFICE_OF('c')} = w.id) customers,
      (SELECT COUNT(*) FROM orders o JOIN customers c ON c.id = o.customer_id WHERE ${OFFICE_OF('c')} = w.id AND o.status IN ('pendiente','asignado','cargado','fallido')) open_orders,
      (SELECT COUNT(*) FROM orders o JOIN customers c ON c.id = o.customer_id WHERE ${OFFICE_OF('c')} = w.id AND o.status = 'entregado' AND strftime('%Y-%m', o.delivered_at, 'localtime') = ?) delivered_month,
      (SELECT COUNT(*) FROM users u WHERE u.active = 1 AND ${OFFICE_OF('u')} = w.id) staff,
      (SELECT name FROM users WHERE id = w.supervisor_id AND active = 1) supervisor_name
    FROM warehouses w ${req.user.office ? `WHERE w.id = ${Number(req.user.office)}` : ''} ORDER BY w.active DESC, w.is_default DESC, w.city, w.name`).all(month);
  res.json(rows);
}));
app.get('/api/offices/:id', auth(...STAFF), wrap((req, res) => {
  const w = db.prepare('SELECT * FROM warehouses WHERE id = ?').get(req.params.id);
  if (!w) throw new HttpError(404, 'Oficina no encontrada');
  if (req.user.office && req.user.office !== w.id) throw new HttpError(403, 'Solo puedes ver tu oficina');
  w.supervisor_name = w.supervisor_id ? db.prepare('SELECT name FROM users WHERE id = ? AND active = 1').get(w.supervisor_id)?.name || null : null;
  w.can_manage = canManageOffice(req, w.id);
  const inventory = db.prepare(`SELECT p.id, p.name, p.sku, COUNT(*) n, SUM(s.order_id IS NOT NULL) reserved FROM serials s JOIN products p ON p.id = s.product_id
    WHERE s.warehouse_id = ? AND s.holder_id IS NULL AND s.open_pool = 0 AND s.status IN ('disponible','asignado') GROUP BY p.id ORDER BY p.name`).all(w.id);
  const plain = w.is_default ? db.prepare('SELECT id, name, sku FROM products WHERE serialized = 0 ORDER BY name').all().map((p) => ({ ...p, n: warehouseQty(p.id) })).filter((p) => p.n > 0) : [];
  const staff = db.prepare(`SELECT u.id, u.name, u.role, u.phone, u.vehicle, u.office_id,
      (SELECT COUNT(*) FROM serials s WHERE s.holder_id = u.id AND s.status IN ('disponible','asignado')) + (SELECT COALESCE(SUM(qty),0) FROM driver_stock d WHERE d.user_id = u.id) holding
    FROM users u WHERE u.active = 1 AND ${OFFICE_OF('u')} = ? ORDER BY u.role, u.name`).all(w.id);
  res.json({ ...w, inventory, plain, staff });
}));
// Asignación por Excel: cada fila trae una referencia del cliente/pedido y, opcional, el repartidor
app.post('/api/assign/resolve', auth(...STAFF), wrap((req, res) => {
  const rows = (Array.isArray(req.body?.rows) ? req.body.rows : []).slice(0, 3000);
  if (!rows.length) throw new HttpError(400, 'El archivo no tiene filas');
  const offSql = inOffice(req, 'c');
  const drivers = db.prepare(`SELECT u.id, u.name FROM users u WHERE (u.role='repartidor' OR u.can_deliver=1) AND u.active=1 ${inOffice(req, 'u')}`).all();
  const norm = (x) => String(x ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
  const findDriver = (name) => {
    const n = norm(name);
    if (!n) return null;
    return drivers.find((d) => norm(d.name) === n) || drivers.filter((d) => norm(d.name).includes(n) || n.includes(norm(d.name)))[0] || null;
  };
  const OPEN = "('pendiente','asignado')";
  const out = rows.map((r, i) => {
    const line = Number(r.line) || i + 2;
    const ref = String(r.ref ?? '').trim();
    const o = { line, ref };
    if (!ref) return { ...o, error: 'Sin referencia' };
    const digits = ref.replace(/\D/g, '');
    let cust = null, orders = [];
    const byOrder = db.prepare(`SELECT o.id, o.customer_id FROM orders o JOIN customers c ON c.id=o.customer_id WHERE o.tracking_code = ? ${offSql}`).get(ref.toUpperCase());
    const bySerial = !byOrder && db.prepare(`SELECT o.id, o.customer_id FROM serials s JOIN orders o ON o.id=s.order_id JOIN customers c ON c.id=o.customer_id WHERE s.serial = ? ${offSql} ORDER BY o.id DESC`).get(normSerial(ref));
    const hit = byOrder || bySerial;
    if (hit) { cust = hit.customer_id; orders = db.prepare(`SELECT id, tracking_code FROM orders WHERE id = ? AND status IN ${OPEN}`).all(hit.id); o.match = byOrder ? 'pedido' : 'S/N'; }
    else {
      let c = digits.length >= 7 ? db.prepare(`SELECT c.id FROM customers c WHERE (c.external_id = ? OR c.phone = ? OR c.phone_alt = ?) ${offSql}`).all(digits, digits, digits) : [];
      if (c.length) o.match = 'teléfono';
      else { c = db.prepare(`SELECT c.id FROM customers c WHERE lower(TRIM(c.name)) = lower(?) ${offSql}`).all(ref); if (c.length) o.match = 'nombre'; }
      if (c.length > 1) return { ...o, error: `${c.length} clientes coinciden; usa el número de pedido o el S/N` };
      if (c.length) { cust = c[0].id; orders = db.prepare(`SELECT id, tracking_code FROM orders WHERE customer_id = ? AND status IN ${OPEN}`).all(cust); }
    }
    if (!cust) return { ...o, error: 'No se encontró (pedido, S/N, teléfono o nombre)' };
    const cc = db.prepare('SELECT name FROM customers WHERE id=?').get(cust);
    Object.assign(o, { customer_id: cust, customer_name: cc?.name, order_ids: orders.map((x) => x.id), tracking: orders.map((x) => x.tracking_code).join(', ') });
    if (r.driver != null && String(r.driver).trim()) {
      const d = findDriver(r.driver);
      if (!d) o.driver_error = `Repartidor "${String(r.driver).trim()}" no encontrado`;
      else { o.driver_id = d.id; o.driver_name = d.name; }
    }
    return o;
  });
  res.json({ rows: out, drivers });
}));
// Tablero: avance por oficina y por ciudad (hoy y acumulado)
const DASH_MEMO = new Map();
// reportes pesados (historial completo): la respuesta se guarda 60 s por alcance del usuario y filtros
const REPORT_CACHE = new Map();
function cachedReport(req, name, fn) {
  const key = [name, req.user.id, req.user.office, (req.user.cities || []).join(','), (req.user.team || []).join(','), JSON.stringify(req.query)].join('|');
  const h = REPORT_CACHE.get(key);
  if (h && Date.now() - h.at < 60000) return h.v;
  const v = fn();
  if (REPORT_CACHE.size > 500) REPORT_CACHE.clear();
  REPORT_CACHE.set(key, { at: Date.now(), v });
  return v;
}
// rango de días locales como rango de fecha UTC (para usar índices en delivered_at / created_at)
const utcDay = (d) => new Date(`${d}T00:00:00`).toISOString().replace('T', ' ').slice(0, 19);
const utcRange = (f, t) => [utcDay(f), utcDay(new Date(new Date(t + 'T12:00:00Z').getTime() + 864e5).toISOString().slice(0, 10))];
app.get('/api/dashboard/exec', auth(...STAFF), wrap((req, res) => {
  const okD = (x) => /^\d{4}-\d{2}-\d{2}$/.test(x || '');
  const to = okD(req.query.to) ? req.query.to : today();
  const from = okD(req.query.from) ? req.query.from : to;
  const dayMs = 864e5;
  const dd = (x) => new Date(x + 'T12:00:00Z');
  const iso = (t) => new Date(t).toISOString().slice(0, 10);
  const nDays = Math.round((dd(to) - dd(from)) / dayMs) + 1;
  const pFrom = iso(dd(from) - nDays * dayMs), pTo = iso(dd(from) - dayMs);
  // filtros: oficina (el personal de una oficina, siempre la suya), ciudad y repartidor
  const off = req.user.office || Number(req.query.office_id) || null;
  const city = String(req.query.city || '').trim();
  const drv = Number(req.query.driver_id) || null;
  const cw = [];
  const ca = [];
  if (off) { cw.push(`${OFFICE_OF('c')} = ?`); ca.push(off); }
  if (cityIn(req)) cw.push('1' + cityIn(req));
  if (city) { cw.push('lower(TRIM(c.city)) = lower(TRIM(?))'); ca.push(city); }
  if (drv) { cw.push('o.driver_id = ?'); ca.push(drv); }
  const W = cw.length ? ' AND ' + cw.join(' AND ') : '';
  // sin filtros de oficina/ciudad no hace falta cruzar con clientes; las fechas van como rango de delivered_at (usa índice)
  const J = W.includes('c.') ? 'FROM orders o JOIN customers c ON c.id = o.customer_id' : 'FROM orders o';
  const JC = 'FROM orders o JOIN customers c ON c.id = o.customer_id';
  const utc = (d) => new Date(`${d}T00:00:00`).toISOString().replace('T', ' ').slice(0, 19);
  const rng = (f, t) => [utc(f), utc(iso(dd(t).getTime() + dayMs))];
  // totales de cartera (todo el historial): cambian despacio, se guardan 60 s por filtro
  const memo = (k, fn) => { const key = k + '|' + W + '|' + JSON.stringify(ca); const h = DASH_MEMO.get(key); if (h && Date.now() - h.at < 60000) return h.v; const v = fn(); DASH_MEMO.set(key, { at: Date.now(), v }); if (DASH_MEMO.size > 300) DASH_MEMO.clear(); return v; };
  const IN_D = 'o.delivered_at >= ? AND o.delivered_at < ?';
  const DONE = "date(o.delivered_at,'localtime')";
  const per = (f, t) => db.prepare(`SELECT SUM(o.status='entregado') delivered, SUM(o.status='fallido') failed,
      SUM(o.status='entregado' AND o.attempts <= 1) first_try, COUNT(DISTINCT CASE WHEN o.status='entregado' THEN o.driver_id END) drivers,
      COUNT(DISTINCT CASE WHEN o.status='entregado' THEN ${DONE} END) days
    ${J} WHERE o.status IN ('entregado','fallido') AND ${IN_D}${W}`).get(...rng(f, t), ...ca);
  const cur = per(from, to), prev = per(pFrom, pTo);
  // visitas: cada intento en el domicilio (entregado o no), por la fecha en que ocurrió
  const visits = (f, t) => db.prepare(`SELECT COUNT(*) v, SUM(e.result='fallido') f FROM evidences e JOIN orders o ON o.id = e.order_id ${W.includes('c.') ? 'JOIN customers c ON c.id = o.customer_id' : ''}
    WHERE e.kind <> 'mostrador' AND e.created_at >= ? AND e.created_at < ?${W}`).get(...rng(f, t), ...ca);
  { const a = visits(from, to), b = visits(pFrom, pTo); Object.assign(cur, { visits: a.v || 0, visits_failed: a.f || 0 }); Object.assign(prev, { visits: b.v || 0, visits_failed: b.f || 0 }); }
  // tendencia: el periodo (o los últimos 14 días si es un solo día)
  const sFrom = nDays < 7 ? iso(dd(to) - 13 * dayMs) : from;
  const rows = db.prepare(`SELECT ${DONE} d, SUM(o.status='entregado') delivered, SUM(o.status='fallido') failed
    ${J} WHERE o.status IN ('entregado','fallido') AND ${IN_D}${W} GROUP BY d`).all(...rng(sFrom, to), ...ca);
  const byD = new Map(rows.map((r) => [r.d, r]));
  const series = [];
  for (let t = dd(sFrom).getTime(); t <= dd(to).getTime(); t += dayMs) { const k = iso(t); series.push({ d: k, delivered: byD.get(k)?.delivered || 0, failed: byD.get(k)?.failed || 0 }); }
  // ranking de repartidores del periodo
  const drivers = db.prepare(`SELECT u.id, u.name, SUM(o.status='entregado') delivered, SUM(o.status='fallido') failed, SUM(o.status='entregado' AND o.attempts <= 1) first_try,
      COUNT(DISTINCT CASE WHEN o.status='entregado' THEN ${DONE} END) days
    ${J} JOIN users u ON u.id = o.driver_id WHERE o.status IN ('entregado','fallido') AND ${IN_D}${W} GROUP BY u.id ORDER BY delivered DESC`).all(...rng(from, to), ...ca);
  // cartera (todo lo que no está cancelado, sin importar fechas)
  const port = memo('port' + today(), () => db.prepare(`SELECT SUM(o.status='entregado') delivered, SUM(o.status IN ('pendiente','asignado','cargado','fallido')) open,
      SUM(o.status IN ('pendiente','asignado','cargado','fallido') AND o.scheduled_date < ?) overdue, SUM(o.status IN ('asignado','cargado')) in_route
    ${J} WHERE o.status <> 'cancelado'${W}`).get(today(), ...ca));
  // por oficina (para la tarjeta de resultados)
  const offices = memo('off' + from + to, () => db.prepare(`SELECT ${OFFICE_OF('c')} id, (SELECT name FROM warehouses WHERE id = ${OFFICE_OF('c')}) name,
      SUM(o.status='entregado' AND ${IN_D}) delivered, SUM(o.status='fallido' AND ${IN_D}) failed,
      SUM(o.status='entregado') delivered_all, SUM(o.status IN ('pendiente','asignado','cargado','fallido')) open,
      SUM(o.status IN ('pendiente','asignado','cargado','fallido') AND o.scheduled_date < ?) overdue
    ${JC} WHERE o.status <> 'cancelado'${W} GROUP BY 1 ORDER BY delivered_all DESC`).all(...rng(from, to), ...rng(from, to), today(), ...ca));
  // alertas
  const openW = `o.status IN ('pendiente','asignado','cargado','fallido')${W}`;
  const alerts = {
    overdue: port.overdue || 0,
    geo_check: memo('geo', () => db.prepare(`SELECT COUNT(DISTINCT c.id) n ${JC} WHERE ${openW} AND (c.lat IS NULL OR c.geo_quality IN ('calle','colonia','cp','ciudad'))`).get(...ca).n),
    no_route_today: db.prepare(`SELECT COUNT(*) n ${J} WHERE o.status='pendiente' AND o.route_id IS NULL AND o.scheduled_date <= ?${W}`).get(today(), ...ca).n,
    sms_failed: db.prepare("SELECT COUNT(*) n FROM messages WHERE channel='sms' AND status='error' AND error NOT LIKE 'Vencido%' AND created_at >= datetime('now','-1 day')").get().n,
  };
  res.json({ from, to, prev: { from: pFrom, to: pTo }, days: nDays, cur, prevp: prev, series, drivers, portfolio: port, offices, alerts });
}));
app.get('/api/dashboard/breakdown', auth(...STAFF), wrap((req, res) => res.json(cachedReport(req, 'breakdown', () => {
  const off = req.user.office || Number(req.query.office_id) || null;
  const city = String(req.query.city || '').trim();
  const okD = (x) => /^\d{4}-\d{2}-\d{2}$/.test(x || '');
  const [p1, p2] = [okD(req.query.from) ? req.query.from : today(), okD(req.query.to) ? req.query.to : today()].sort();
  const drvB = Number(req.query.driver_id) || null;
  const W = `WHERE 1 ${drvB ? `AND o.driver_id = ${drvB}` : ''} ${off ? `AND ${OFFICE_OF('c')} = ${Number(off)}` : ''}${cityIn(req)} ${city ? 'AND lower(TRIM(c.city)) = lower(?)' : ''}`;
  const A = city ? [city] : [];
  const cols = `COUNT(DISTINCT c.id) clientes,
      SUM(o.status = 'pendiente') pendientes, SUM(o.status IN ('asignado','cargado')) en_ruta,
      SUM(o.status = 'entregado') entregados, SUM(o.status = 'fallido') fallidos,
      SUM(o.status = 'entregado' AND date(o.delivered_at,'localtime') BETWEEN '${p1}' AND '${p2}') entregados_hoy,
      SUM(o.status = 'fallido' AND date(o.delivered_at,'localtime') BETWEEN '${p1}' AND '${p2}') fallidos_hoy`;
  const from = `FROM customers c LEFT JOIN orders o ON o.customer_id = c.id AND o.status <> 'cancelado'`;
  const offices = db.prepare(`SELECT w.id, w.name, w.city cities, ${cols} ${from} JOIN warehouses w ON w.id = ${OFFICE_OF('c')} ${W} GROUP BY w.id ORDER BY w.is_default DESC, w.name`).all(...A);
  // inventario disponible (equipos con S/N libres): en el almacén de la oficina, con sus repartidores y en abierto
  const inv = db.prepare(`SELECT
      SUM(s.holder_id IS NULL AND s.open_pool = 0 AND s.warehouse_id = ?) almacen,
      SUM(s.holder_id IN (SELECT u.id FROM users u WHERE ${OFFICE_OF('u')} = ?)) repartidores,
      SUM(s.holder_id IS NULL AND s.open_pool = 1 AND s.warehouse_id = ?) abierto
    FROM serials s WHERE s.status = 'disponible'`);
  for (const o of offices) { const r = inv.get(o.id, o.id, o.id); Object.assign(o, { inv_almacen: r.almacen || 0, inv_repartidores: r.repartidores || 0, inv_abierto: r.abierto || 0 }); o.inv_total = o.inv_almacen + o.inv_repartidores + o.inv_abierto; }
  const cities = db.prepare(`SELECT COALESCE(NULLIF(TRIM(c.city),''),'Sin ciudad') city, ${cols} ${from} ${W} GROUP BY lower(TRIM(COALESCE(c.city,''))) ORDER BY clientes DESC`).all(...A);
  // ciudades disponibles para filtrar (dentro de la oficina)
  const list = db.prepare(`SELECT DISTINCT TRIM(c.city) city FROM customers c WHERE TRIM(COALESCE(c.city,'')) <> '' ${off ? `AND ${OFFICE_OF('c')} = ${Number(off)}` : ''}${cityIn(req)} GROUP BY lower(TRIM(c.city)) ORDER BY city`).all().map((r) => r.city);
  return { offices, cities, city_list: list };
}))));
// Renglones del resumen para la hoja: oficinas (con inventario) y ciudades
function resumenRows() {
  const now = new Date().toISOString();
  const stat = (W, args) => db.prepare(`SELECT COUNT(DISTINCT c.id) clientes, SUM(o.status='pendiente') pen, SUM(o.status IN ('asignado','cargado')) ruta,
      SUM(o.status='entregado') ent, SUM(o.status='fallido') fal, SUM(o.status='cancelado') can
    FROM customers c LEFT JOIN orders o ON o.customer_id = c.id WHERE ${W}`).get(...args);
  const pct = (r) => { const t = (r.pen || 0) + (r.ruta || 0) + (r.ent || 0) + (r.fal || 0); return t ? Math.round(((r.ent || 0) / t) * 1000) / 10 : 0; };
  const rows = [];
  for (const w of db.prepare('SELECT * FROM warehouses WHERE active = 1 ORDER BY is_default DESC, name').all()) {
    const r = stat(`${OFFICE_OF('c')} = ?`, [w.id]);
    const inv = db.prepare(`SELECT SUM(s.holder_id IS NULL AND s.open_pool = 0 AND s.warehouse_id = ?) alm,
        SUM(s.holder_id IN (SELECT u.id FROM users u WHERE ${OFFICE_OF('u')} = ?)) rep, SUM(s.holder_id IS NULL AND s.open_pool = 1 AND s.warehouse_id = ?) ab
      FROM serials s WHERE s.status = 'disponible'`).get(w.id, w.id, w.id);
    const disp = (inv.alm || 0) + (inv.rep || 0) + (inv.ab || 0);
    const need = (r.pen || 0) + (r.ruta || 0);
    rows.push([`Oficina · ${w.name}`, now, 'Oficina', w.name, w.city || '', r.clientes || 0, r.pen || 0, r.ruta || 0, r.ent || 0, r.fal || 0, r.can || 0, pct(r),
      inv.alm || 0, inv.rep || 0, inv.ab || 0, disp, need, Math.max(0, need - disp)]);
  }
  for (const c of db.prepare("SELECT TRIM(city) city FROM customers WHERE TRIM(COALESCE(city,'')) <> '' GROUP BY lower(TRIM(city)) ORDER BY COUNT(*) DESC").all()) {
    const r = stat('lower(TRIM(c.city)) = lower(?)', [c.city]);
    const off = officeForCity(c.city);
    const on = off ? db.prepare('SELECT name FROM warehouses WHERE id=?').get(off)?.name : '';
    rows.push([`Ciudad · ${canonCity(c.city)}`, now, 'Ciudad', canonCity(c.city), on || '', r.clientes || 0, r.pen || 0, r.ruta || 0, r.ent || 0, r.fal || 0, r.can || 0, pct(r),
      '', '', '', '', (r.pen || 0) + (r.ruta || 0), '']);
  }
  return rows;
}
// Renglones diarios por oficina y ciudad (fecha local): entregados, no entregados, visitas y pedidos nuevos
function diarioRows(day) {
  const [f, t] = utcRange(day, day);
  const offName = new Map(db.prepare('SELECT id, name FROM warehouses').all().map((w) => [w.id, w.name]));
  const acc = new Map();
  const add = (tipo, name, k, v) => {
    if (!name) return;
    const key = `${tipo}|${name}`;
    if (!acc.has(key)) acc.set(key, { tipo, name, ent: 0, fal: 0, vis: 0, nue: 0 });
    acc.get(key)[k] += v;
  };
  const ev = db.prepare(`SELECT ${OFFICE_OF('c')} office, c.city, SUM(e.result = 'entregado') ent, SUM(e.result = 'fallido') fal, COUNT(*) vis
    FROM evidences e JOIN orders o ON o.id = e.order_id JOIN customers c ON c.id = o.customer_id
    WHERE e.created_at >= ? AND e.created_at < ? GROUP BY 1, 2`).all(f, t);
  const nu = db.prepare(`SELECT ${OFFICE_OF('c')} office, c.city, COUNT(*) nue FROM orders o JOIN customers c ON c.id = o.customer_id
    WHERE o.created_at >= ? AND o.created_at < ? GROUP BY 1, 2`).all(f, t);
  for (const r of ev) for (const k of ['ent', 'fal', 'vis']) { add('Oficina', offName.get(r.office), k, r[k] || 0); add('Ciudad', r.city ? canonCity(r.city) : '', k, r[k] || 0); }
  for (const r of nu) { add('Oficina', offName.get(r.office), 'nue', r.nue || 0); add('Ciudad', r.city ? canonCity(r.city) : '', 'nue', r.nue || 0); }
  const iso = new Date(`${day}T00:00:00`).toISOString();
  return [...acc.values()].map((a) => [`${day} · ${a.tipo} · ${a.name}`, iso, a.tipo, a.name, a.ent, a.fal, a.vis, a.nue]);
}
// Manda a la hoja los días pendientes (la primera vez, todo el historial; después, ayer y hoy)
let diarioBusy = false;
async function diarioTick() {
  if (diarioBusy) return;
  diarioBusy = true;
  try {
    const s = getSettings();
    if (s.sheets_enabled !== '1' || !s.sheets_url) return;
    const first = db.prepare('SELECT MIN(created_at) d FROM evidences').get().d;
    if (!first) return;
    const localDay = (u) => new Date(String(u).replace(' ', 'T') + 'Z').toLocaleDateString('en-CA');
    const end = today();
    const yest = new Date(new Date(end + 'T12:00:00Z').getTime() - 864e5).toISOString().slice(0, 10);
    let d = s.sheets_diario_done ? (s.sheets_diario_done < yest ? s.sheets_diario_done : yest) : localDay(first);
    while (d <= end) {
      await notify.pushDiario(diarioRows(d));
      if (d < end) db.prepare("INSERT INTO settings (key, value) VALUES ('sheets_diario_done', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(d);
      d = new Date(new Date(d + 'T12:00:00Z').getTime() + 864e5).toISOString().slice(0, 10);
    }
  } catch (e) { console.error('diario sheet', e.message); }
  finally { diarioBusy = false; }
}
// Supervisor operativo de la oficina (lo nombra el administrador; queda asignado a esa oficina)
app.put('/api/offices/:id/supervisor', auth('admin'), wrap((req, res) => {
  const w = db.prepare('SELECT * FROM warehouses WHERE id = ?').get(req.params.id);
  if (!w) throw new HttpError(404, 'Oficina no encontrada');
  const uid = req.body?.user_id ? Number(req.body.user_id) : null;
  let u = null;
  if (uid) {
    u = db.prepare('SELECT id, name, role, active FROM users WHERE id = ?').get(uid);
    if (!u || !u.active) throw new HttpError(404, 'Usuario no encontrado');
    if (u.role === 'repartidor') throw new HttpError(400, 'El supervisor debe ser despachador o administrador (cámbiale el rol en Usuarios)');
  }
  tx(() => {
    db.prepare('UPDATE warehouses SET supervisor_id = ? WHERE id = ?').run(uid, w.id);
    if (u && u.role !== 'admin') db.prepare('UPDATE users SET office_id = ? WHERE id = ?').run(w.id, u.id);
  });
  audit(req, 'oficina.supervisor', `${w.name}: ${u ? u.name : 'sin supervisor'}`);
  res.json({ ok: true });
}));
// Pasar clientes o personal a una oficina
app.post('/api/offices/:id/customers', auth(...STAFF), wrap((req, res) => {
  const w = db.prepare('SELECT * FROM warehouses WHERE id = ? AND active = 1').get(req.params.id);
  if (!w) throw new HttpError(404, 'Oficina no encontrada');
  if (req.user.office) throw new HttpError(403, 'Solo el administrador pasa clientes entre oficinas');
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter(Boolean);
  if (!ids.length) throw new HttpError(400, 'Elige los clientes');
  const up = db.prepare('UPDATE customers SET office_id = ? WHERE id = ?');
  let n = 0;
  tx(() => { for (const id of ids) n += Number(up.run(w.id, id).changes); });
  audit(req, 'oficina.clientes', `${n} clientes → ${w.name}`);
  res.json({ moved: n });
}));
app.post('/api/offices/:id/staff', auth(...STAFF), wrap((req, res) => {
  const w = db.prepare('SELECT * FROM warehouses WHERE id = ? AND active = 1').get(req.params.id);
  if (!w) throw new HttpError(404, 'Oficina no encontrada');
  if (req.user.role !== 'admin') throw new HttpError(403, 'Solo el administrador asigna personal a una oficina');
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter(Boolean);
  if (!ids.length) throw new HttpError(400, 'Elige al personal');
  const up = db.prepare('UPDATE users SET office_id = ? WHERE id = ?');
  let n = 0;
  // quien supervisaba otra oficina deja de hacerlo al cambiarse
  const unsup = db.prepare('UPDATE warehouses SET supervisor_id = NULL WHERE supervisor_id = ? AND id <> ?');
  tx(() => { for (const id of ids) { n += Number(up.run(w.id, id).changes); unsup.run(id, w.id); } });
  audit(req, 'oficina.personal', `${n} personas → ${w.name}${req.body?.from ? ' (quitadas de ' + (db.prepare('SELECT name FROM warehouses WHERE id=?').get(Number(req.body.from))?.name || '') + ')' : ''}`);
  res.json({ moved: n });
}));
app.post(
  '/api/customers',
  auth(...STAFF), // los clientes los registra el despacho; el repartidor solo busca y entrega
  wrap((req, res) => {
    const b = req.body;
    if (!b.name || !b.address) throw new HttpError(400, 'Nombre y dirección son obligatorios');
    // el cliente queda en la oficina de su ciudad; si su ciudad no tiene oficina, en la del usuario
    b.office_id = officeForCity(b.city) || req.user.office || b.office_id;
    if (scopeCities(req) && !req.user.cities.map(normCity).includes(normCity(b.city))) throw new HttpError(403, `Solo puedes registrar clientes de ${req.user.cities.join(', ')}`);
    const vals = customerFields.map((f) => custVal(b, f));
    const r = db.prepare(`INSERT INTO customers (${customerFields.join(',')}) VALUES (${customerFields.map(() => '?').join(',')})`).run(...vals);
    if (b.lat != null && b.lat !== '') db.prepare('UPDATE customers SET geo_quality=? WHERE id=?').run(['exacta', 'calle', 'colonia'].includes(b.geo_quality) ? b.geo_quality : 'manual', Number(r.lastInsertRowid));
    res.status(201).json({ id: Number(r.lastInsertRowid) });
  })
);
app.put(
  '/api/customers/:id',
  auth(),
  wrap((req, res) => {
    const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
    if (!c) throw new HttpError(404, 'No encontrado');
    if (outOfScope(req, c.id)) throw new HttpError(403, 'Este cliente es de otra oficina o ciudad');
    const b = { ...c, ...req.body };
    if (req.user.office && !canManageOffice(req, b.office_id)) b.office_id = c.office_id;
    // si cambió de ciudad, pasa a la oficina de su nueva ciudad
    if (req.body.city !== undefined && normCity(req.body.city) !== normCity(c.city) && officeForCity(req.body.city)) b.office_id = officeForCity(req.body.city);
    const vals = customerFields.map((f) => custVal(b, f));
    db.prepare(`UPDATE customers SET ${customerFields.map((f) => f + '=?').join(',')} WHERE id=?`).run(...vals, c.id);
    const moved = b.lat != null && b.lat !== '' && (Number(b.lat) !== c.lat || Number(b.lng) !== c.lng);
    if (moved) db.prepare('UPDATE customers SET geo_quality=? WHERE id=?').run(['exacta', 'calle', 'colonia'].includes(req.body.geo_quality) ? req.body.geo_quality : 'manual', c.id);
    res.json({ ok: true });
  })
);

// ---------- Importación masiva de clientes (Excel/CSV) con pedido de entrega opcional ----------
// El navegador (o un script en el servidor) manda filas normalizadas. Con dry_run calcula todo sin guardar.
// Por defecto NO avisa a los clientes al crear los pedidos (evita una ráfaga de WhatsApp/correos).
const CUST_IMPORT_MAX = 20000;
// Los errores de fórmula de Excel (#N/A, #REF!…) cuentan como celda vacía
const XL_ERR = /^#?(N\/A|NA|REF!|VALUE!|DIV\/0!|NAME\?|NULL!|NUM!|SPILL!|CALC!)$/i;
const cleanTxt = (v, max = 200) => {
  const t = v == null ? '' : String(v).replace(/\s+/g, ' ').trim();
  return XL_ERR.test(t) ? '' : t.slice(0, max);
};
const digits = (v) => String(v ?? '').replace(/\D/g, '');
function normCustomerRow(r) {
  const street = cleanTxt(r.street, 150);
  const number = cleanTxt(r.number, 20);
  const colonia = cleanTxt(r.colonia, 100);
  const address = cleanTxt(r.address, 250) || [[street, number].filter(Boolean).join(' '), colonia ? `Col. ${colonia}` : ''].filter(Boolean).join(', ');
  const phone = [r.phone, r.phone2, r.phone3, r.phone_line].map(digits).find((d) => d.length >= 10) || '';
  const alt = [r.phone_alt, r.phone_line].map(digits).find((d) => d.length >= 10 && d !== phone) || '';
  const email = cleanTxt(r.email, 120).toLowerCase();
  const lat = r.lat === '' || r.lat == null ? null : Number(r.lat);
  const lng = r.lng === '' || r.lng == null ? null : Number(r.lng);
  return {
    external_id: cleanTxt(r.external_id, 60) || null,
    name: cleanTxt(r.name, 150),
    phone: phone || null,
    phone_alt: alt || null,
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null,
    address, colonia: colonia || null,
    city: canonCity(cleanTxt(r.city, 80)) || null,
    zip: cleanTxt(r.zip, 10) || null,
    reference: cleanTxt(r.reference, 200) || null,
    notes: cleanTxt(r.notes, 1000) || null,
    lat: Number.isFinite(lat) && Math.abs(lat) <= 90 ? lat : null,
    lng: Number.isFinite(lng) && Math.abs(lng) <= 180 ? lng : null,
  };
}
app.post(
  '/api/customers/import',
  auth(...STAFF),
  wrap((req, res) => {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) throw new HttpError(400, 'No hay filas para importar');
    if (rows.length > CUST_IMPORT_MAX) throw new HttpError(400, `Máximo ${CUST_IMPORT_MAX} clientes por importación`);
    const o = req.body.orders || {};
    const accountId = o.account_id && db.prepare('SELECT id FROM accounts WHERE id=?').get(Number(o.account_id)) ? Number(o.account_id) : null;
    const makeOrders = !!o.create;
    const product = makeOrders && o.product_id ? db.prepare('SELECT * FROM products WHERE id=?').get(Number(o.product_id)) : null;
    if (makeOrders && o.product_id && !product) throw new HttpError(400, 'Producto no encontrado');
    const qty = Math.max(1, Math.trunc(Number(o.qty) || 1));
    const date = /^\d{4}-\d{2}-\d{2}$/.test(o.scheduled_date || '') ? o.scheduled_date : today();
    const stype = ['general', 'medicamento', 'muestra', 'dispositivo', 'refrigerado'].includes(o.shipment_type) ? o.shipment_type : 'general';
    const notifyNow = !!o.notify;
    const updateExisting = req.body.update_existing !== false;
    // oficina destino: la del usuario si es personal de oficina; si no, la que elija el administrador (o según la ciudad)
    const impOffice = req.user.office || (req.body.office_id && db.prepare('SELECT id FROM warehouses WHERE id=? AND active=1').get(Number(req.body.office_id)) ? Number(req.body.office_id) : null);
    const skipDupOrders = o.skip_if_open !== false;
    const dry = !!req.body.dry_run;
    const stc = new Map();
    const P = (sql) => { let st = stc.get(sql); if (!st) stc.set(sql, (st = db.prepare(sql))); return st; };
    const results = [];
    const seen = new Map();
    const created = [];
    let stockNeeded = 0;
    let noStockOrders = 0;
    db.exec('BEGIN IMMEDIATE');
    try {
      rows.forEach((raw, i) => {
        const line = Number(raw.__line) || i + 2;
        const c = normCustomerRow(raw);
        const out = { line, name: c.name, phone: c.phone ? c.phone.replace(/.(?=.{4})/g, '•') : '', address: c.address };
        try {
          if (!c.name) throw new Error('Falta el nombre');
          if (!c.address) throw new Error('Falta el domicilio');
          const key = (c.external_id || `${c.name}|${c.address}`).toLowerCase();
          if (seen.has(key)) throw new Error(`Repetido en el archivo (fila ${seen.get(key)})`);
          seen.set(key, line);
          db.exec('SAVEPOINT cli');
          try {
            // Con identificador (p. ej. la línea telefónica) cada identificador es un cliente distinto, aunque compartan nombre y celular
            let ex = c.external_id ? P('SELECT * FROM customers WHERE external_id=?').get(c.external_id) : null;
            if (!ex && !c.external_id && c.phone) ex = P('SELECT * FROM customers WHERE phone=? AND lower(name)=lower(?) AND address=?').get(c.phone, c.name, c.address);
            let cid;
            if (ex) {
              cid = ex.id;
              if (updateExisting) {
                const sameAddr = (ex.address || '') === c.address;
                P(`UPDATE customers SET external_id=COALESCE(?, external_id), name=?, phone=COALESCE(?, phone), phone_alt=COALESCE(?, phone_alt), email=COALESCE(?, email),
                  address=?, colonia=COALESCE(?, colonia), city=COALESCE(?, city), zip=COALESCE(?, zip), reference=COALESCE(?, reference), notes=COALESCE(?, notes),
                  lat=?, lng=?, geo_quality=? WHERE id=?`).run(
                  c.external_id, c.name, c.phone, c.phone_alt, c.email, c.address, c.colonia, c.city, c.zip, c.reference, c.notes,
                  c.lat ?? (sameAddr ? ex.lat : null), c.lng ?? (sameAddr ? ex.lng : null),
                  c.lat != null ? 'archivo' : sameAddr ? ex.geo_quality : null, cid
                );
                out.action = 'actualizado';
              } else out.action = 'existente';
            } else {
              cid = Number(P(`INSERT INTO customers (external_id, name, phone, phone_alt, email, address, colonia, city, zip, reference, notes, lat, lng, geo_quality)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(c.external_id, c.name, c.phone, c.phone_alt, c.email, c.address, c.colonia, c.city, c.zip, c.reference, c.notes,
                c.lat, c.lng, c.lat != null ? 'archivo' : null).lastInsertRowid);
              out.action = 'nuevo';
            }
            // cada cliente va a la oficina de su ciudad; la oficina elegida solo aplica a ciudades que no tienen oficina
            const cityOff = officeForCity(c.city);
            if (cityOff) { if (out.action === 'nuevo' || impOffice) P('UPDATE customers SET office_id=? WHERE id=?').run(cityOff, cid); }
            else if (impOffice) P('UPDATE customers SET office_id=? WHERE id=?').run(impOffice, cid);
            out.customer_id = cid;
            if (makeOrders) {
              const tt = telnorOrders(cid);
              if (tt.open && skipDupOrders) out.order = `ya tiene ${tt.open.tracking_code}`;
              else if (tt.delivered && skipDupOrders) out.order = `ya entregado ${tt.delivered.tracking_code}`;
              else {
                const code = genTracking();
                const oid = Number(P(`INSERT INTO orders (tracking_code, customer_id, scheduled_date, priority, notes, created_by, public_token, shipment_type)
                  VALUES (?,?,?,?,?,?,?,?)`).run(code, cid, date, 'normal', cleanTxt(o.notes, 300) || null, req.user.id, crypto.randomBytes(12).toString('hex'), stype).lastInsertRowid);
                if (accountId) P('UPDATE orders SET account_id=? WHERE id=?').run(accountId, oid);
                if (product) {
                  P('INSERT INTO order_items (order_id, product_id, qty) VALUES (?,?,?)').run(oid, product.id, qty);
                  // sin existencia el pedido se crea igual (queda por surtir)
                  if (takeStock(oid, product.id, qty, code, req.user.id) < qty) noStockOrders++;
                  stockNeeded += qty;
                }
                out.order = code;
                created.push(oid);
              }
            }
            db.exec('RELEASE cli');
          } catch (e) {
            db.exec('ROLLBACK TO cli');
            db.exec('RELEASE cli');
            throw e;
          }
        } catch (e) {
          out.action = 'error';
          out.error = e.message;
        }
        results.push(out);
      });
      db.exec(dry ? 'ROLLBACK' : 'COMMIT');
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch {}
      throw e;
    }
    const n = (a) => results.filter((x) => x.action === a).length;
    const summary = { total: results.length, nuevos: n('nuevo'), actualizados: n('actualizado'), existentes: n('existente'), errores: n('error'),
      pedidos: results.filter((x) => x.order && !String(x.order).startsWith('ya tiene')).length,
      sin_ubicacion: 0, stock_disponible: product ? db.prepare('SELECT stock FROM products WHERE id=?').get(product.id).stock : null, stock_necesario: stockNeeded, sin_inventario: noStockOrders };
    if (!dry) {
      summary.sin_ubicacion = db.prepare('SELECT COUNT(*) n FROM customers WHERE lat IS NULL').get().n;
      if (notifyNow) for (const id of created) notify.queueEvent('registrado', id);
      audit(req, 'clientes.importar', `${summary.nuevos} nuevos, ${summary.actualizados} actualizados, ${summary.pedidos} pedidos${notifyNow ? ' (con aviso)' : ' (sin aviso)'}`);
      setImmediate(geocodePending);
    }
    const detail = [...results.filter((x) => x.action === 'error'), ...results.filter((x) => x.action !== 'error')].slice(0, 1000);
    res.json({ dry_run: dry, summary, results: detail, detail_truncated: results.length > detail.length });
  })
);

// ---------- Geolocalización de domicilios (OpenStreetMap / Nominatim, 1 consulta por segundo) ----------
const geoCityCache = {};
const geo = { running: false, done: 0, found: 0, approx: 0, failed: 0, last: null };
async function nominatim(q, bias) {
  // q puede ser texto libre o búsqueda estructurada { street, city, state }
  const p = new URLSearchParams({ format: 'jsonv2', limit: '1', countrycodes: 'mx', addressdetails: '0', ...(typeof q === 'string' ? { q } : q) });
  if (bias) { p.set('viewbox', bias); p.set('bounded', '1'); }
  const r = await fetch('https://nominatim.openstreetmap.org/search?' + p, {
    headers: { 'User-Agent': `SovimeMensajeria/1.0 (${notify.baseUrl(getSettings())})`, 'Accept-Language': 'es' },
    signal: AbortSignal.timeout(15000),
  });
  if (r.status === 429) throw new Error('rate');
  if (!r.ok) return null;
  const j = await r.json();
  return j[0] ? { lat: Number(j[0].lat), lng: Number(j[0].lon), cat: j[0].category, type: j[0].type, addr: j[0].addresstype } : null;
}
// Limpia el domicilio para el buscador: "Blvd. Benito Juárez 984-Loc 8 B" -> "Boulevard Benito Juárez 984"
const CITY_OSM = { rosarito: 'Playas de Rosarito', 'playas de rosarito': 'Playas de Rosarito', 'san quintin': 'San Quintín', 'san luis rio colorado': 'San Luis Río Colorado', 'san luis r c': 'San Luis Río Colorado' };
// estado de cada ciudad (San Luis Río Colorado está en Sonora)
const CITY_STATE = { 'san luis rio colorado': 'Sonora' };
const stateOf = (city) => CITY_STATE[normCity(osmCity(city))] || 'Baja California';
function osmCity(city) { const k = normCity(city); return CITY_OSM[k] || String(city || '').trim() || 'Tijuana'; }
function cleanStreet(addr) {
  let x = String(addr || '').split(',')[0];
  x = x.replace(/(\d+)\s*[-–]\s*(loc|local|int|interior|depto|dpto|ofi|of|suite|piso|edif|bodega|lote|lt|mz|a|b|c|d)\b.*$/i, '$1');
  x = x.replace(/\s+\b(loc|local|int|interior|depto|dpto|departamento|ofi|oficina|suite|piso|edif|edificio|bodega)\b\.?.*$/i, '');
  x = x.replace(/\bblvd\b\.?/i, 'Boulevard').replace(/\bav\b\.?/i, 'Avenida').replace(/\bcalz\b\.?/i, 'Calzada').replace(/\bprol\b\.?/i, 'Prolongación')
    .replace(/\bs\/n\b/i, '').replace(/#\s*/g, '').replace(/\s+/g, ' ').trim();
  return x;
}
async function photon(q, center) {
  const p = new URLSearchParams({ q, limit: '1', lang: 'es' });
  if (center) { p.set('lat', center.lat); p.set('lon', center.lng); }
  const r = await fetch('https://photon.komoot.io/api/?' + p, { headers: { 'User-Agent': `SovimeMensajeria/1.0 (${notify.baseUrl(getSettings())})` }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) return null;
  const f = (await r.json()).features?.[0];
  if (!f) return null;
  return { lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], type: f.properties?.type, city: f.properties?.city || f.properties?.county || '' };
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
// Centro urbano fijo de cada ciudad (el buscador devolvía el centro del MUNICIPIO, que en Ensenada queda lejísimos)
// r = radio en grados (~0.15° ≈ 16 km) dentro del cual se aceptan resultados
const CITY_CENTERS = {
  tijuana: { lat: 32.5149, lng: -117.0382, r: 0.17 }, ensenada: { lat: 31.8667, lng: -116.5964, r: 0.15 },
  mexicali: { lat: 32.6245, lng: -115.4523, r: 0.17 }, 'playas de rosarito': { lat: 32.3661, lng: -117.0618, r: 0.12 },
  tecate: { lat: 32.5725, lng: -116.6264, r: 0.1 }, 'san luis rio colorado': { lat: 32.456, lng: -114.7717, r: 0.12 },
  'san quintin': { lat: 30.56, lng: -115.938, r: 0.3 },
};
async function cityCenter(city) {
  const fixed = CITY_CENTERS[normCity(osmCity(city))];
  if (fixed) return fixed;
  const k = osmCity(city);
  if (!(k in geoCityCache)) { geoCityCache[k] = await nominatim(`${k}, ${stateOf(city)}, México`); await pause(1100); }
  return geoCityCache[k];
}
// Colonia / fraccionamiento: "TERRAZAS DEL VALLE 2A SECCION" y "Terrazas del Valle" son la misma
const colKey = (x) => normCity(String(x || '').replace(/\(.*?\)/g, '').replace(/\b(\d+\s*[aªo]?|primera|segunda|tercera|1ra|2da|3ra)\s*secci[oó]n\b.*$/i, '').replace(/\bsecci[oó]n\b.*$/i, '').replace(/^(col(onia)?|fracc?(ionamiento)?|fracc)\.?\s+/i, ''));
const GOOD_GEO = ['exacta', 'manual', 'gps_entrega', 'repartidor', 'archivo'];
const APPROX_GEO = ['calle', 'colonia', 'cp', 'ciudad'];
// Centro de una colonia según nuestros propios clientes bien ubicados en ella (mediana, sin los que queden a >3 km)
function colonyCenter(colonia, city, excludeId = 0) {
  const k = colKey(colonia);
  if (!k) return null;
  const peers = db.prepare(`SELECT lat, lng, colonia FROM customers WHERE lat IS NOT NULL AND geo_quality IN (${GOOD_GEO.map(() => '?').join(',')}) AND lower(TRIM(city)) = lower(TRIM(?)) AND id <> ?`)
    .all(...GOOD_GEO, String(city || ''), excludeId).filter((p) => colKey(p.colonia) === k);
  if (!peers.length) return null;
  const med = (a) => { const x = [...a].sort((p, q) => p - q); return x[Math.floor(x.length / 2)]; };
  let c = { lat: med(peers.map((p) => p.lat)), lng: med(peers.map((p) => p.lng)) };
  const near = peers.filter((p) => haversine(p, c) < 3);
  if (near.length) c = { lat: med(near.map((p) => p.lat)), lng: med(near.map((p) => p.lng)) };
  return { ...c, n: near.length || peers.length };
}
// Ubica un domicilio probando varias búsquedas (de la más exacta a la más general). Devuelve { lat, lng, quality } o null.
// Centro de la colonia: el del mapa (zona/colonia de OpenStreetMap) o, si no está, el de nuestros clientes bien ubicados en ella
const colAnchorCache = new Map();
async function colonyAnchor(col, city, cityName, st, bias, inBox, excludeId = 0) {
  if (!col) return null;
  const key = normCity(city) + '|' + colKey(col);
  if (!colAnchorCache.has(key)) {
    let a = null;
    const colS = String(col).replace(/\(.*?\)/g, '').replace(/\b(\d+\s*[aªoAO]?|primera|segunda|tercera)\s*secci[oó]n\b.*$/i, '').replace(/\bsecci[oó]n\b.*$/i, '').replace(/^(fracc?(ionamiento)?|col(onia)?)\.?\s+/i, '').trim();
    // variantes: tal cual, sin "2a sección"/"Fracc.", y en plural o singular ("INFONAVIT PRESIDENTE" = "INFONAVIT Presidentes")
    const pl = (x) => (/s$/i.test(x) ? x.replace(/e?s$/i, '') : /[aeiou]$/i.test(x) ? x + 'S' : x + 'ES');
    if (gmaps.enabled()) {
      const g = await gmaps.colonyCenter(`${colS || col}, ${cityName}, ${st}, México`);
      if (g && inBox(g)) a = { lat: g.lat, lng: g.lng, src: 'google' };
    }
    for (const v of a ? [] : [...new Set([col, colS, pl(colS)])].filter(Boolean)) {
      try {
        const g = await nominatim(`${v}, ${cityName}, ${st}`, bias); await pause(1100);
        // solo una zona (colonia, fraccionamiento, barrio), no una calle que se llame igual
        if (g && inBox(g) && g.cat !== 'highway' && (['place', 'landuse', 'boundary'].includes(g.cat) || ['suburb', 'neighbourhood', 'quarter', 'residential', 'city_district', 'hamlet', 'village', 'isolated_dwelling'].includes(g.addr))) { a = { lat: g.lat, lng: g.lng, src: 'mapa' }; break; }
      } catch (e) { if (e.message === 'rate') await pause(30000); }
    }
    colAnchorCache.set(key, a);
  }
  const ext = colAnchorCache.get(key);
  // colonia "amplia" o genérica (p. ej. Telnor pone "CENTRO" a clientes de toda Ensenada): si nuestros clientes con
  // ubicación exacta en esa colonia están dispersos (mitad a más de 2.5 km del centro), la colonia no sirve para validar
  const k = colKey(col);
  const spread = db.prepare(`SELECT lat, lng, colonia FROM customers WHERE lat IS NOT NULL AND geo_quality IN ('exacta','manual','gps_entrega','repartidor') AND lower(TRIM(city)) = lower(TRIM(?)) AND id <> ?`)
    .all(String(city || ''), excludeId).filter((p) => colKey(p.colonia) === k);
  const broad = (a) => { if (spread.length < 5) return false; const ds = spread.map((p) => haversine(p, a)).sort((x, y) => x - y); return ds[Math.floor(ds.length / 2)] > 2.5; };
  if (ext) return broad(ext) ? null : ext;
  const own = colonyCenter(col, city, excludeId);
  return own && own.n >= 2 && !broad(own) ? { lat: own.lat, lng: own.lng, src: 'clientes' } : null;
}
// ---------- Ubicar por vecinos (sin costo): calle + número + colonia contra clientes ya ubicados ----------
const NB_REF = ['exacta', 'manual', 'gps_entrega', 'repartidor'];
const colOfC = (c) => c.colonia || (String(c.address || '').match(/col(?:onia)?\.?\s*([^,]+)/i) || [])[1] || '';
function parseStreetNum(c) {
  const seg = String(c.address || '').split(',')[0].replace(/#/g, ' ').replace(/\s+/g, ' ').trim();
  const m = seg.match(/^(.*?[A-Za-zÁÉÍÓÚÑáéíóúñ.\-]\s*)\s(?:no\.?\s*|num\.?\s*)?(\d{1,6})(?:\s*-?\s*[A-Za-z])?(?:\s+(?:int|interior|depto|dpto)\b.*)?$/i);
  if (!m) return null;
  const street = normCity(m[1]).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^(calle|c|av|avenida|blvd|boulevard|bulevar|calz|calzada)\s+/, '');
  const col = colKey(colOfC(c));
  if (street.length < 3 || !col) return null;
  return { key: `${normCity(c.city)}|${col}|${street}`, num: Number(m[2]) };
}
let nbIndex = { at: 0, map: new Map() };
function nbRefs() {
  if (Date.now() - nbIndex.at < 10 * 60000) return nbIndex.map;
  const map = new Map();
  for (const c of db.prepare(`SELECT id, address, colonia, city, lat, lng FROM customers WHERE lat IS NOT NULL AND geo_quality IN (${NB_REF.map(() => '?').join(',')})`).all(...NB_REF)) {
    const p = parseStreetNum(c); if (!p) continue;
    if (!map.has(p.key)) map.set(p.key, []);
    map.get(p.key).push({ id: c.id, num: p.num, lat: c.lat, lng: c.lng });
  }
  nbIndex = { at: Date.now(), map };
  return map;
}
// devuelve { lat, lng, how } si hay vecinos en su calle: entre dos números conocidos (interpola) o uno de su misma cuadra (±30)
function neighborPin(c) {
  const p = parseStreetNum(c); if (!p) return null;
  const pts = (nbRefs().get(p.key) || []).filter((x) => x.id !== c.id);
  if (!pts.length) return null;
  let pos = null;
  const lo = pts.filter((x) => x.num <= p.num).sort((a, b) => b.num - a.num)[0];
  const hi = pts.filter((x) => x.num >= p.num).sort((a, b) => a.num - b.num)[0];
  if (lo && hi && lo.num !== hi.num && haversine(lo, hi) < 1.5) { const t = (p.num - lo.num) / (hi.num - lo.num); pos = { lat: lo.lat + t * (hi.lat - lo.lat), lng: lo.lng + t * (hi.lng - lo.lng), how: 'interpolado' }; }
  else { const near = [...pts].sort((a, b) => Math.abs(a.num - p.num) - Math.abs(b.num - p.num))[0]; if (Math.abs(near.num - p.num) <= 30) pos = { lat: near.lat, lng: near.lng, how: 'misma cuadra' }; }
  if (!pos) return null;
  // debe caer en su código postal (si lo conocemos)
  const z = String(c.zip || '').replace(/\D/g, '').slice(0, 5);
  const a = z.length === 5 ? db.prepare('SELECT * FROM gm_zip WHERE zip=? AND lat IS NOT NULL').get(z) : null;
  if (a && !gmaps.inZip(pos, a, 0.6)) return null;
  return pos;
}
// aplica la ubicación por vecinos a los domicilios aproximados (cada 6 h: cada entrega con GPS suma nuevas referencias)
const nbJob = { running: false, last: null };
function neighborRefine() {
  if (nbJob.running) return nbJob.last;
  nbJob.running = true;
  const out = { revisados: 0, mejorados: 0 };
  try {
    nbIndex.at = 0;
    const up = db.prepare("UPDATE customers SET lat=?, lng=?, geo_quality='calle' WHERE id=? AND geo_quality IN ('calle','colonia','cp','ciudad')");
    for (const c of db.prepare("SELECT id, address, colonia, city, zip, lat, lng, geo_quality FROM customers WHERE geo_quality IN ('calle','colonia','cp','ciudad')").all()) {
      out.revisados++;
      const nb = neighborPin(c);
      if (!nb || (c.lat != null && haversine(c, nb) < 0.03)) continue;
      up.run(nb.lat, nb.lng, c.id); out.mejorados++;
    }
    if (out.mejorados) db.prepare('INSERT INTO audit_log (user_id, action, detail) VALUES (NULL, ?, ?)').run('clientes.ubicacion', `Ubicación por vecinos (calle, número y colonia de clientes ya ubicados): ${out.mejorados} de ${out.revisados} domicilios aproximados`);
  } catch (e) { console.error('neighborRefine', e.message); }
  finally { nbJob.running = false; nbJob.last = { at: new Date().toISOString(), ...out }; }
  return out;
}
// ---------- Revisión de pins (cada 6 h): cada cliente en su ciudad, en su CP y sobre una calle ----------
const PIN_HUMAN = new Set(['manual', 'gps_entrega', 'repartidor']); // los confirmó una persona o la entrega: no se tocan
const cityBox = (city) => CITY_CENTERS[normCity(osmCity(city))] || null;
const inCityBox = (p, c) => Math.abs(p.lat - c.lat) < c.r && Math.abs(p.lng - c.lng) < c.r * 1.2;
const zipAreaOf = (zip) => { const z = String(zip || '').replace(/\D/g, '').slice(0, 5); return z.length === 5 ? db.prepare('SELECT * FROM gm_zip WHERE zip=? AND lat IS NOT NULL').get(z) : null; };
// ¿el pin está claramente mal? (devuelve el motivo)
function pinProblem(c) {
  if (c.lat == null || PIN_HUMAN.has(c.geo_quality)) return null;
  if (c.lat < 30 || c.lat > 33 || c.lng < -117.4 || c.lng > -114.3) return 'fuera de la región';
  const z = zipAreaOf(c.zip);
  if (z && gmaps.inZip(c, z, 0.6)) return null; // coincide con su código postal: se respeta
  const own = cityBox(c.city);
  if (!own || inCityBox(c, own)) return null;
  const other = Object.entries(CITY_CENTERS).find(([, b]) => inCityBox(c, b));
  if (other) return `en otra ciudad (${other[0]})`;
  if (haversine(c, own) > 60) return 'muy lejos de su ciudad';
  return null;
}
// mejor punto de reemplazo dentro de su ciudad: vecinos de su calle, centro de su CP (si es de su ciudad), centro de su colonia o de la ciudad
function pinReplacement(c) {
  const own = cityBox(c.city);
  const ok = (p) => p && (!own || inCityBox(p, own));
  const nb = neighborPin(c); if (ok(nb)) return { lat: nb.lat, lng: nb.lng, quality: 'calle', how: 'vecinos de su calle' };
  const z = zipAreaOf(c.zip); if (ok(z)) return { lat: z.lat, lng: z.lng, quality: 'cp', how: 'centro de su CP' };
  const colA = c.colonia || (String(c.address || '').match(/col(?:onia)?\.?\s*([^,]+)/i) || [])[1] || '';
  const cc = colA ? colonyCenter(colA, c.city, c.id) : null; if (ok(cc)) return { lat: cc.lat, lng: cc.lng, quality: 'colonia', how: 'centro de su colonia' };
  if (own) return { lat: own.lat, lng: own.lng, quality: 'ciudad', how: 'centro de su ciudad' };
  return null;
}
const pinJob = { running: false, last: null };
async function pinCheck({ dry = false } = {}) {
  if (pinJob.running) return { busy: true };
  pinJob.running = true;
  const out = { revisados: 0, mal_ubicados: 0, corregidos: 0, lejos_de_calle: 0, a_la_calle: 0, motivos: {}, prev: [] };
  try {
    const rows = db.prepare('SELECT id, address, colonia, city, zip, lat, lng, geo_quality FROM customers WHERE lat IS NOT NULL').all();
    const up = db.prepare('UPDATE customers SET lat=?, lng=?, geo_quality=? WHERE id=? AND lat=? AND lng=?');
    for (const c of rows) {
      out.revisados++;
      const why = pinProblem(c);
      if (why) {
        out.mal_ubicados++; out.motivos[why] = (out.motivos[why] || 0) + 1;
        const r = pinReplacement(c);
        if (r && !dry && up.run(r.lat, r.lng, r.quality, c.id, c.lat, c.lng).changes) { out.corregidos++; out.prev.push({ id: c.id, lat: c.lat, lng: c.lng, q: c.geo_quality, why, how: r.how }); }
        else if (r && dry) out.corregidos++;
        continue;
      }
      // aproximados: si quedaron lejos de toda calle (en un cerro, un baldío o el mar), se pasan a la calle más cercana
      if (APPROX_GEO.includes(c.geo_quality) && osrm.enabled()) {
        const n = await osrm.nearest(c);
        if (n && n.m > 300 && n.m < 5000) {
          out.lejos_de_calle++;
          if (!dry && up.run(n.lat, n.lng, c.geo_quality, c.id, c.lat, c.lng).changes) { out.a_la_calle++; out.prev.push({ id: c.id, lat: c.lat, lng: c.lng, q: c.geo_quality, why: `a ${Math.round(n.m)} m de la calle`, how: 'calle más cercana' }); }
          else if (dry) out.a_la_calle++;
        }
      }
    }
    if (!dry && out.prev.length) {
      fs.writeFileSync(path.join(DATA_DIR, `pins_prev_${today()}.json`), JSON.stringify(out.prev));
      db.prepare('INSERT INTO audit_log (user_id, action, detail) VALUES (NULL, ?, ?)').run('clientes.ubicacion', `Revisión de pins: ${out.corregidos} mal ubicados corregidos (${Object.entries(out.motivos).map(([k, v]) => k + ': ' + v).join(', ')}); ${out.a_la_calle} aproximados movidos a la calle más cercana`.slice(0, 900));
    }
  } catch (e) { console.error('pinCheck', e.message); }
  finally { pinJob.running = false; }
  const { prev, ...res } = out; void prev;
  pinJob.last = { at: new Date().toISOString(), ...res };
  return res;
}
// ---------- Vencimiento de documentos: aviso 15 días antes y suspensión al vencer (se levanta sola al aprobar el nuevo) ----------
function liftDocSuspension(uid) {
  const u = db.prepare('SELECT suspended_reason FROM users WHERE id=?').get(uid);
  if (!u?.suspended_reason || !u.suspended_reason.startsWith('Documento vencido')) return;
  const t = today(); const docs = docsOf(uid);
  const still = requiredDocs(uid).filter((k) => kyc.EXPIRING.includes(k) && docs[k]?.expires && docs[k].expires < t);
  if (!still.length) { db.prepare('UPDATE users SET suspended_reason=NULL WHERE id=?').run(uid); db.prepare('INSERT INTO audit_log (user_id, action, detail) VALUES (NULL, ?, ?)').run('personal.reactivar', `Cuenta reactivada: documentos al corriente (usuario ${uid})`); }
}
async function docExpiryJob() {
  const s = getSettings(); const t = today();
  const soon = new Date(Date.now() + 15 * 864e5).toLocaleDateString('en-CA');
  for (const u of db.prepare("SELECT id, name, phone, email, suspended_reason FROM users WHERE active=1 AND deleted_at IS NULL AND (role='repartidor' OR can_deliver=1)").all()) {
    const docs = docsOf(u.id); let changed = false;
    const req = requiredDocs(u.id).filter((k) => kyc.EXPIRING.includes(k));
    const expired = [];
    for (const k of req) {
      const d = docs[k]; if (!d?.expires) continue;
      const l = STAFF_DOCS.find(([x]) => x === k)[1];
      if (d.expires < t) expired.push(l);
      else if (d.expires <= soon && d.alerted !== d.expires) {
        const msg = `${s.company_name || 'Sovime'}: tu ${l.toLowerCase()} vence el ${d.expires}. Sube la renovación en la app (Mi perfil → Mis documentos) antes de esa fecha para seguir recibiendo servicios.`;
        if (s.practice_mode !== '1') {
          if (u.phone) await notify.sendSMS(s, notify.phoneE164(u.phone), msg).catch(() => null);
          if (u.email) await notify.sendEmail(s, u.email, `Tu ${l.toLowerCase()} vence pronto`, msg).catch(() => null);
        }
        d.alerted = d.expires; changed = true;
        db.prepare('INSERT INTO audit_log (user_id, action, detail) VALUES (NULL, ?, ?)').run('personal.vencimiento', `${u.name}: aviso de vencimiento de ${l} (${d.expires})`);
      }
    }
    if (changed) saveDocs(u.id, docs);
    if (expired.length && !u.suspended_reason) {
      db.prepare('UPDATE users SET suspended_reason=? WHERE id=?').run(`Documento vencido: ${expired.join(', ')}`, u.id);
      db.prepare('INSERT INTO audit_log (user_id, action, detail) VALUES (NULL, ?, ?)').run('personal.suspender', `${u.name}: suspendido por documento vencido (${expired.join(', ')})`);
    } else if (!expired.length) liftDocSuspension(u.id);
  }
}
async function geocodeAddress(args) {
  const r = await geocodeAddressRaw(args);
  if (r && r.quality === 'exacta') return r;
  // Google o el mapa solo dieron calle, colonia o CP: si hay vecinos ya ubicados en su calle, el número da un punto mejor
  const nb = neighborPin({ id: args.id || 0, address: args.address, colonia: args.colonia, city: args.city, zip: args.zip });
  return nb ? { lat: nb.lat, lng: nb.lng, quality: 'calle', how: nb.how } : r;
}
async function geocodeAddressRaw({ address, colonia, city, zip, id = 0, bulk = false }) {
  const cityName = osmCity(city);
  const st = stateOf(city);
  const ctr = await cityCenter(city).catch(() => null);
  const rr = ctr?.r || 0.2;
  const bias = ctr ? `${ctr.lng - rr * 1.2},${ctr.lat + rr},${ctr.lng + rr * 1.2},${ctr.lat - rr}` : null;
  const inBox = (g) => !ctr || (Math.abs(g.lat - ctr.lat) < rr && Math.abs(g.lng - ctr.lng) < rr * 1.2);
  const street = cleanStreet(address);
  // colonia: la que venga aparte o la escrita en el domicilio ("…, Col. MADERO" / "…, Zona Centro, …")
  const col = String(colonia || (String(address || '').match(/col(?:onia)?\.?\s*([^,]+)/i) || [])[1] || '').replace(/^col(onia)?\.?\s*/i, '').trim();
  const m = street.match(/^(.*?)\s+(\d+)\s*[A-Za-z]?$/);
  const name = m ? m[1] : street.replace(/\s+\d+.*$/, '');
  const tries = [];
  if (m) tries.push([{ street: `${m[2]} ${m[1]}`, city: cityName, state: st, country: 'México' }, 'exacta']);
  if (street) tries.push([`${street}, ${col ? col + ', ' : ''}${cityName}, ${st}`, 'exacta']);
  if (street && col) tries.push([`${street}, ${cityName}, ${st}`, 'exacta']);
  if (street) tries.push(['photon', 'calle']);
  if (name && name !== street) tries.push([`${name}, ${col ? col + ', ' : ''}${cityName}, ${st}`, 'calle']);
  if (name && name !== street) tries.push(['photon-calle', 'calle']);
  const anchor = await colonyAnchor(col, city, cityName, st, bias, inBox, id);
  const house = (g) => g.cat === 'building' || ['house', 'building', 'apartments', 'detached', 'commercial'].includes(g.type) || ['building', 'house'].includes(g.addr) || (g.cat === 'place' && g.type === 'house');
  let street1 = null;
  // código postal: la búsqueda lo incluye y el resultado debe caer dentro de él
  const cp = String(zip || '').replace(/D/g, '').slice(0, 5);
  const zarea = cp.length === 5 ? await gmaps.zipArea(cp, cityName, st).catch(() => null) : null;
  const zipOk = (g) => !zarea || gmaps.inZip(g, zarea, 0.6) !== false || (g.zip && g.zip === cp);
  if (street && gmaps.enabled()) {
    try {
      const g = await gmaps.geocode(`${street}${col ? ', Col. ' + col : ''}${cp.length === 5 ? ', C.P. ' + cp : ''}, ${cityName}, ${st}, México`, { zip: cp.length === 5 ? cp : undefined, bulk });
      if (g && inBox(g) && zipOk(g) && !(anchor && haversine(g, anchor) > (g.quality === 'exacta' ? 2.5 : 1.2))) {
        if (g.quality === 'exacta' && !g.partial) return { lat: g.lat, lng: g.lng, quality: 'exacta' };
        if (g.quality === 'exacta' || g.quality === 'calle') street1 = { lat: g.lat, lng: g.lng, quality: 'calle' };
      }
    } catch (e) { console.error('google geocode', e.message); }
  }
  for (const [q] of tries) {
    try {
      let g, quality;
      if (q === 'photon') {
        g = await photon(`${street}${col ? ', ' + col : ''}, ${cityName}`, ctr);
        quality = g?.type === 'house' ? 'exacta' : g?.type === 'street' ? 'calle' : null;
      } else if (q === 'photon-calle') {
        g = await photon(`${name}, ${cityName}, ${st}`, ctr);
        quality = g?.type === 'street' ? 'calle' : null;
      } else {
        g = await nominatim(q, bias); await pause(1100);
        // con número: exacta solo si encontró el edificio; si encontró la calle, es "calle"
        quality = g ? (house(g) ? 'exacta' : 'calle') : null;
      }
      if (!g || !quality || !inBox(g) || !zipOk(g)) continue;
      // debe quedar dentro de su colonia: una avenida larga con el mismo nombre puede estar a kilómetros
      if (anchor && haversine(g, anchor) > (quality === 'exacta' ? 2.5 : 1.2)) continue;
      if (quality === 'exacta') return { lat: g.lat, lng: g.lng, quality };
      if (!street1) street1 = { lat: g.lat, lng: g.lng, quality: 'calle' };
      if (anchor) break; // calle dentro de su colonia: suficiente
    } catch (e) { if (e.message === 'rate') await pause(30000); }
  }
  if (street1 && anchor) return street1;
  if (anchor && zipOk(anchor)) return { lat: anchor.lat, lng: anchor.lng, quality: 'colonia' };
  if (street1 && zarea) return street1;
  if (zarea) return { lat: zarea.lat, lng: zarea.lng, quality: 'cp' }; // centro del código postal: aproximada, por revisar
  if (anchor) return { lat: anchor.lat, lng: anchor.lng, quality: 'colonia' };
  return street1; // sin colonia ni CP para validar: la calle (queda por revisar)
}
// Auditoría en segundo plano: revisa las ubicaciones guardadas contra su colonia y corrige las que quedaron lejos
const gaudit = { running: false, done: 0, fixed: 0 };
async function geoAudit() {
  if (gaudit.running || geo.running || refine.running) return;
  gaudit.running = true;
  const setK = (k, v) => db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v));
  try {
    for (;;) {
      if (getSettings().geo_audit !== '1') break;
      const last = Number(getSettings().geo_audit_last || 0);
      const c = db.prepare("SELECT * FROM customers WHERE id > ? AND lat IS NOT NULL AND geo_quality IN ('exacta','calle','colonia','cp','ciudad') ORDER BY id LIMIT 1").get(last);
      if (!c) { setK('geo_audit', '0'); break; }
      const colA = c.colonia || (String(c.address || '').match(/col(?:onia)?\.?\s*([^,]+)/i) || [])[1] || '';
      const cityName = osmCity(c.city), st = stateOf(c.city);
      const ctr = await cityCenter(c.city).catch(() => null);
      const rr = ctr?.r || 0.2;
      const bias = ctr ? `${ctr.lng - rr * 1.2},${ctr.lat + rr},${ctr.lng + rr * 1.2},${ctr.lat - rr}` : null;
      const inBox = (g) => !ctr || (Math.abs(g.lat - ctr.lat) < rr && Math.abs(g.lng - ctr.lng) < rr * 1.2);
      const anchor = await colonyAnchor(colA, c.city, cityName, st, bias, inBox, c.id);
      const lim = c.geo_quality === 'exacta' ? 2.5 : c.geo_quality === 'calle' ? 1.5 : 1;
      if (anchor && (c.geo_quality === 'ciudad' || haversine(c, anchor) > lim)) {
        const hit = await geocodeAddress({ address: c.address, colonia: colA, city: c.city, zip: c.zip, id: c.id });
        if (hit) {
          db.prepare("UPDATE customers SET lat=?, lng=?, geo_quality=? WHERE id=? AND geo_quality IN ('exacta','calle','colonia','cp','ciudad')").run(hit.lat, hit.lng, hit.quality, c.id);
          db.prepare('INSERT INTO audit_log (user_id, action, detail) VALUES (NULL, ?, ?)').run('clientes.ubicacion', `${c.name}: estaba a ${haversine(c, anchor).toFixed(1)} km de su colonia (${colA}); reubicado (${hit.quality})`);
          gaudit.fixed++;
        }
      }
      gaudit.done++;
      setK('geo_audit_last', c.id);
    }
  } catch (e) {
    console.error('geoAudit', e.message);
  } finally {
    gaudit.running = false;
  }
}
app.get('/api/geocode', auth(...STAFF), wrap(async (req, res) => {
  const { address = '', colonia = '', city = '', zip = '' } = req.query;
  const hit = String(address).trim() ? await geocodeAddress({ address, colonia, city, zip }) : null;
  if (hit && hit.quality !== 'colonia') return res.json(hit);
  // no se encontró el domicilio: su colonia según nuestros clientes, o la del mapa
  const colA = colonia || (String(address).match(/col(?:onia)?\.?\s*([^,]+)/i) || [])[1] || '';
  const cc = colonyCenter(colA, city);
  if (cc) return res.json({ lat: cc.lat, lng: cc.lng, quality: 'colonia' });
  if (hit) return res.json(hit);
  // ni la colonia: el centro de la ciudad, solo para acercar el mapa
  const c = await cityCenter(city).catch(() => null);
  res.json(c ? { lat: c.lat, lng: c.lng, quality: 'ciudad' } : { quality: null });
}));
async function geocodePending() {
  if (geo.running) return;
  geo.running = true;
  try {
    const s = getSettings();
    const dl = Number(s.depot_lat), dg = Number(s.depot_lng);
    for (;;) {
      const c = db.prepare("SELECT * FROM customers WHERE lat IS NULL AND (geo_quality IS NULL OR geo_quality='') ORDER BY id LIMIT 1").get();
      if (!c) break;
      // colonia escrita en el domicilio ("…, Col. MADERO") si no viene aparte
      const colA = c.colonia || (String(c.address || '').match(/col(?:onia)?\.?\s*([^,]+)/i) || [])[1] || '';
      const hit = await geocodeAddress({ address: c.address, colonia: colA, city: c.city || 'Tijuana', zip: c.zip, id: c.id });
      void dl; void dg;
      let hit2 = hit;
      if (!hit2 || hit2.quality === 'colonia') { const cc = colonyCenter(colA, c.city, c.id); if (cc) hit2 = { lat: cc.lat, lng: cc.lng, quality: 'colonia' }; }
      const ctrC = hit2 ? null : await cityCenter(c.city || 'Tijuana').catch(() => null);
      if (hit2) db.prepare('UPDATE customers SET lat=?, lng=?, geo_quality=? WHERE id=?').run(hit2.lat, hit2.lng, hit2.quality, c.id);
      else if (ctrC) db.prepare("UPDATE customers SET lat=?, lng=?, geo_quality='ciudad' WHERE id=?").run(ctrC.lat, ctrC.lng, c.id);
      else db.prepare("UPDATE customers SET geo_quality='no_encontrada' WHERE id=?").run(c.id);
      geo.done++;
      if (hit?.quality === 'exacta') geo.found++; else if (hit) geo.approx++; else geo.failed++;
      geo.last = new Date().toISOString();
    }
  } catch (e) {
    console.error('geocode', e.message);
  } finally {
    geo.running = false;
    if (getSettings().geo_refine === '1') setImmediate(refineApprox);
    else if (getSettings().geo_audit === '1') setImmediate(geoAudit);
  }
}
// Mejora ubicaciones aproximadas (centro de la colonia o de la calle): si encuentra el domicilio exacto lo actualiza;
// si no, deja la que ya tiene. Se reanuda solo tras un reinicio (guarda el último cliente revisado).
const refine = { running: false, done: 0, improved: 0 };
// ---------- Ubicación de las paradas en ruta (prioridad para navegar) ----------
const GEO_RANK = { exacta: 4, calle: 3, colonia: 2, cp: 1, ciudad: 0 };
const addrKey = (c) => normCity(String(c.address || '').split(',')[0].replace(/#\s*/g, '').replace(/\b(col(onia)?|fracc?(ionamiento)?)\b.*$/i, '')) + '|' + normCity(c.city);
// mismo domicilio ya confirmado en otro cliente (exacto, a mano, GPS de entrega o el repartidor): se usa ese pin
function sameAddressPin(c) {
  const k = addrKey(c);
  if (k.length < 8 || !/\d/.test(k)) return null; // sin número no es un domicilio único
  const peers = db.prepare(`SELECT id, address, city, colonia, lat, lng FROM customers WHERE id <> ? AND lat IS NOT NULL AND geo_quality IN ('exacta','manual','gps_entrega','repartidor')
    AND lower(TRIM(city)) = lower(TRIM(?)) AND substr(lower(TRIM(address)), 1, 6) = substr(lower(TRIM(?)), 1, 6)`).all(c.id, c.city || '', c.address || '');
  return peers.find((p) => addrKey(p) === k && (!c.colonia || !p.colonia || colKey(p.colonia) === colKey(c.colonia))) || null;
}
const routedGeo = { running: false, last: null };
// paradas con pin aproximado en rutas de hoy y mañana: primero las más próximas en la ruta
async function routedRefine({ routeId = null, force = false } = {}) {
  if (routedGeo.running) return { busy: true };
  routedGeo.running = true;
  const out = { revisadas: 0, mejoradas: 0, mismo_domicilio: 0, rutas: new Set() };
  try {
    const tom = new Date(Date.now() + 864e5).toLocaleDateString('en-CA');
    const rows = db.prepare(`SELECT DISTINCT c.*, r.id rid FROM orders o JOIN routes r ON r.id = o.route_id JOIN customers c ON c.id = o.customer_id
      WHERE o.status IN ('asignado','cargado') AND c.geo_quality IN ('calle','colonia','cp','ciudad')
        ${routeId ? 'AND r.id = ' + Number(routeId) : "AND r.date BETWEEN date('now','localtime') AND '" + tom + "'"}
        ${force ? '' : "AND (c.geo_tried IS NULL OR c.geo_tried < datetime('now','-12 hours'))"}
      ORDER BY r.date, o.stop_seq LIMIT 400`).all();
    for (const c of rows) {
      out.revisadas++;
      db.prepare("UPDATE customers SET geo_tried = datetime('now') WHERE id = ?").run(c.id);
      const same = sameAddressPin(c);
      if (same) {
        db.prepare("UPDATE customers SET lat=?, lng=?, geo_quality='exacta' WHERE id=? AND geo_quality IN ('calle','colonia','cp','ciudad')").run(same.lat, same.lng, c.id);
        out.mejoradas++; out.mismo_domicilio++; out.rutas.add(c.rid); continue;
      }
      const colA = c.colonia || (String(c.address || '').match(/col(?:onia)?\.?\s*([^,]+)/i) || [])[1] || '';
      const hit = await geocodeAddress({ address: c.address, colonia: colA, city: c.city || 'Tijuana', zip: c.zip, id: c.id }).catch(() => null);
      if (hit && GEO_RANK[hit.quality] > GEO_RANK[c.geo_quality]) {
        db.prepare("UPDATE customers SET lat=?, lng=?, geo_quality=? WHERE id=? AND geo_quality IN ('calle','colonia','cp','ciudad')").run(hit.lat, hit.lng, hit.quality, c.id);
        out.mejoradas++; out.rutas.add(c.rid);
      }
    }
    // rutas que aún no salen: se reordenan con los pins nuevos
    for (const rid of out.rutas) googleRefine(rid);
    if (out.mejoradas) db.prepare('INSERT INTO audit_log (user_id, action, detail) VALUES (NULL, ?, ?)').run('clientes.ubicacion', `Paradas en ruta: ${out.mejoradas} de ${out.revisadas} ubicaciones mejoradas${out.mismo_domicilio ? ` (${out.mismo_domicilio} por domicilio ya confirmado)` : ''}`);
  } catch (e) { console.error('routedRefine', e.message); }
  finally { routedGeo.running = false; routedGeo.last = { at: new Date().toISOString(), revisadas: out.revisadas, mejoradas: out.mejoradas }; }
  return { revisadas: out.revisadas, mejoradas: out.mejoradas, mismo_domicilio: out.mismo_domicilio, rutas: out.rutas.size };
}
app.post('/api/routes/:id/geo-improve', auth(...STAFF), wrap(async (req, res) => {
  const r = db.prepare('SELECT * FROM routes WHERE id=?').get(req.params.id);
  if (!r) throw new HttpError(404, 'Ruta no encontrada');
  officeRoute(req, r);
  const x = await routedRefine({ routeId: r.id, force: true });
  if (x.busy) throw new HttpError(409, 'Ya se están mejorando ubicaciones; intenta en un minuto');
  audit(req, 'rutas.ubicaciones', `${r.name || 'Ruta ' + r.id}: ${x.mejoradas} de ${x.revisadas} ubicaciones mejoradas`);
  res.json(x);
}));
async function refineApprox() {
  if (refine.running || geo.running) return;
  refine.running = true;
  const setK = (k, v) => db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v));
  try {
    for (;;) {
      if (getSettings().geo_refine !== '1') break;
      const last = Number(getSettings().geo_refine_last || 0);
      const c = db.prepare("SELECT * FROM customers WHERE geo_quality IN ('colonia','calle','cp','ciudad') AND id > ? ORDER BY id LIMIT 1").get(last);
      if (!c) { setK('geo_refine', '0'); break; }
      const colA = c.colonia || (String(c.address || '').match(/col(?:onia)?\.?\s*([^,]+)/i) || [])[1] || '';
      const hit = await geocodeAddress({ address: c.address, colonia: colA, city: c.city || 'Tijuana', zip: c.zip, id: c.id, bulk: true });
      // solo si mejora: exacta siempre; "calle" solo si antes era "colonia"
      const rank = { exacta: 4, calle: 3, colonia: 2, cp: 1, ciudad: 0 };
      if (['ciudad', 'cp'].includes(c.geo_quality) && (!hit || ['colonia', 'cp'].includes(hit.quality))) {
        const cc = colonyCenter(colA, c.city, c.id);
        if (cc) { db.prepare("UPDATE customers SET lat=?, lng=?, geo_quality='colonia' WHERE id=? AND geo_quality IN ('ciudad','cp')").run(cc.lat, cc.lng, c.id); refine.improved++; refine.done++; setK('geo_refine_last', c.id); continue; }
      }
      if (hit && rank[hit.quality] > rank[c.geo_quality]) {
        db.prepare("UPDATE customers SET lat=?, lng=?, geo_quality=? WHERE id=? AND geo_quality IN ('colonia','calle','cp','ciudad')").run(hit.lat, hit.lng, hit.quality, c.id);
        refine.improved++;
      }
      refine.done++;
      setK('geo_refine_last', c.id);
    }
  } catch (e) {
    console.error('refine', e.message);
  } finally {
    refine.running = false;
    if (getSettings().geo_audit === '1') setImmediate(geoAudit);
  }
}
app.get(
  '/api/customers/geocode',
  auth(...STAFF),
  wrap((req, res) => {
    const st = Object.fromEntries(db.prepare("SELECT COALESCE(geo_quality, CASE WHEN lat IS NULL THEN 'pendiente' ELSE 'manual' END) q, COUNT(*) n FROM customers GROUP BY q").all().map((r) => [r.q, r.n]));
    res.json({ running: geo.running, stats: st, session: geo, refine: { ...refine, active: getSettings().geo_refine === '1' } });
  })
);
app.post(
  '/api/customers/geocode',
  auth(...STAFF),
  wrap((req, res) => {
    if (req.body?.retry_failed) db.prepare("UPDATE customers SET geo_quality=NULL WHERE geo_quality='no_encontrada' AND lat IS NULL").run();
    if (req.body?.refine) { db.prepare("INSERT INTO settings (key, value) VALUES ('geo_refine','1') ON CONFLICT(key) DO UPDATE SET value='1'").run(); db.prepare("INSERT INTO settings (key, value) VALUES ('geo_refine_last','0') ON CONFLICT(key) DO UPDATE SET value='0'").run(); setImmediate(refineApprox); }
    setImmediate(geocodePending);
    res.json({ ok: true });
  })
);

app.get(
  '/api/customers/:id',
  auth(),
  wrap((req, res) => {
    const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
    if (!c) throw new HttpError(404, 'No encontrado');
    if (outOfScope(req, c.id)) throw new HttpError(403, 'Este cliente es de otra oficina o ciudad');
    c.orders = db.prepare(`SELECT o.id, o.tracking_code, o.status, o.scheduled_date, o.delivered_at, o.appointment_time, o.driver_id, o.route_id, u.name driver_name
      FROM orders o LEFT JOIN users u ON u.id = o.driver_id WHERE o.customer_id = ? ORDER BY o.id DESC LIMIT 50`).all(c.id);
    res.json(c);
  })
);

// ---------- Pedidos ----------
const ORDER_SELECT = `
  SELECT o.*, c.name customer_name, c.phone customer_phone, c.phone_alt customer_phone_alt, c.external_id telnor_phone, c.address, c.reference address_reference, c.city customer_city, c.colonia customer_colonia, c.zip customer_zip,
         c.lat, c.lng, c.geo_quality, c.window_start, c.window_end, u.name driver_name, (SELECT name FROM accounts WHERE id = o.account_id) account_name
  FROM orders o JOIN customers c ON c.id = o.customer_id LEFT JOIN users u ON u.id = o.driver_id`;

function loadOrder(id) {
  const o = db.prepare(`${ORDER_SELECT} WHERE o.id = ?`).get(id);
  if (!o) return null;
  o.items = db
    .prepare('SELECT i.*, p.name, p.sku, p.barcode, p.serialized FROM order_items i JOIN products p ON p.id = i.product_id WHERE i.order_id = ?')
    .all(o.id);
  o.serials = serialsOfOrder(o.id);
  o.serial_needs = orderSerialNeeds(o.id);
  o.serials_missing = o.serial_needs.reduce((a, r) => a + r.missing, 0);
  o.evidences = db.prepare('SELECT e.*, u.name driver_name FROM evidences e LEFT JOIN users u ON u.id = e.driver_id WHERE e.order_id = ? ORDER BY e.id DESC').all(o.id);
  return o;
}
function canSee(user, order) {
  if (STAFF.includes(user.role)) return !user.office || customerOffice(order.customer_id) === user.office;
  return order.driver_id === user.id;
}
// Ordena pedidos por ciudad y, dentro de cada ciudad, por cercanía (vecino más cercano desde su oficina):
// los renglones seguidos quedan juntos en el mapa y al seleccionarlos se arma una ruta compacta.
const zipOf = (z) => String(z || '').replace(/\D/g, '').slice(0, 5);
function geoSort(rows, by = 'colonia') {
  const groups = new Map();
  for (const r of rows) {
    const k = canonCity(r.customer_city || '') || 'Sin ciudad';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const out = [];
  const cities = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [city, list] of cities) {
    const geo = list.filter((r) => r.lat != null), none = list.filter((r) => r.lat == null);
    const offId = officeForCity(city) || db.prepare('SELECT id FROM warehouses WHERE is_default=1').get()?.id;
    const w = offId ? db.prepare('SELECT lat, lng FROM warehouses WHERE id=? AND lat IS NOT NULL').get(offId) : null;
    let cur = w || (geo.length ? { lat: geo.reduce((a, r) => a + r.lat, 0) / geo.length, lng: geo.reduce((a, r) => a + r.lng, 0) / geo.length } : null);
    const kx = Math.cos(((cur?.lat || 32) * Math.PI) / 180);
    const d2 = (a, b) => ((a.lng - b.lng) * kx) ** 2 + (a.lat - b.lat) ** 2;
    // colonias de la ciudad: se recorren en orden de cercanía (desde la oficina) y dentro de cada una, pedido por pedido
    const cols = new Map();
    const colName = by === 'cp' ? (r) => (zipOf(r.customer_zip) ? 'CP ' + zipOf(r.customer_zip) : 'Sin código postal') : (r) => String(r.customer_colonia || '').replace(/\s+/g, ' ').trim() || 'Sin colonia';
    for (const r of geo) { const k = by === 'cp' ? colName(r) : colKey(colName(r)) || 'sin colonia'; if (!cols.has(k)) cols.set(k, { name: colName(r), rows: [] }); const g = cols.get(k); if (colName(r).length < g.name.length) g.name = colName(r); g.rows.push(r); }
    const pend = [...cols.values()].map((c) => ({ ...c, lat: c.rows.reduce((a, r) => a + r.lat, 0) / c.rows.length, lng: c.rows.reduce((a, r) => a + r.lng, 0) / c.rows.length }));
    let i = 0;
    while (pend.length) {
      let bi = 0, bd = Infinity;
      for (let j = 0; j < pend.length; j++) { const d = d2(pend[j], cur); if (d < bd) { bd = d; bi = j; } }
      const col = pend.splice(bi, 1)[0];
      const left = [...col.rows];
      while (left.length) {
        let ri = 0, rd = Infinity;
        for (let j = 0; j < left.length; j++) { const d = d2(left[j], cur); if (d < rd) { rd = d; ri = j; } }
        cur = left.splice(ri, 1)[0];
        out.push({ ...cur, city_group: city, col_group: col.name, geo_seq: ++i });
      }
    }
    // sin ubicación al final de su ciudad, también por colonia
    none.sort((a, b) => colName(a).localeCompare(colName(b), 'es'));
    for (const r of none) out.push({ ...r, city_group: city, col_group: colName(r), geo_seq: null });
  }
  return out;
}
function customerOffice(customerId) {
  return db.prepare(`SELECT ${OFFICE_OF('c')} o FROM customers c WHERE c.id = ?`).get(customerId)?.o ?? null;
}
// Fragmentos SQL para limitar a la oficina del usuario (el número viene de la base, no del cliente)
let cityVarC = { at: 0, rows: [] };
function scopeCities(req) {
  const l = req.user?.cities;
  if (!l || !l.length || req.user.role === 'repartidor') return null;
  if (Date.now() - cityVarC.at > 60000) cityVarC = { at: Date.now(), rows: db.prepare("SELECT DISTINCT TRIM(city) c FROM customers WHERE TRIM(COALESCE(city,'')) <> ''").all().map((r) => r.c) };
  const want = new Set(l.map(normCity));
  return cityVarC.rows.filter((c) => want.has(normCity(c)));
}
// filtro SQL de las ciudades del supervisor sobre la tabla de clientes (alias)
const cityIn = (req, alias = 'c') => { const l = scopeCities(req); return l ? (l.length ? ` AND TRIM(${alias}.city) IN (${l.map((c) => "'" + c.replace(/'/g, "''") + "'").join(',')})` : ' AND 0') : ''; };
// ¿el cliente queda fuera de lo que puede ver este usuario? (otra oficina u otra ciudad)
const outOfScope = (req, customerId) => (req.user.office && customerOffice(customerId) !== req.user.office) || (scopeCities(req) && !db.prepare(`SELECT 1 FROM customers c WHERE c.id = ? ${cityIn(req, 'c')}`).get(Number(customerId)));
const teamIn = (req, alias) => (req.user?.team?.length && req.user.role !== 'repartidor' ? ` AND ${alias}.id IN (${[...req.user.team, req.user.id].map(Number).join(',')})` : '');
// personal (alias u…): si el coordinador tiene equipo, su equipo manda sobre la oficina (alguien puede tener otra oficina en su ficha)
const inOffice = (req, alias, kind = 'c') => (/^u/.test(alias) && teamIn(req, alias) ? teamIn(req, alias) : (req.user.office ? ` AND ${OFFICE_OF(alias)} = ${Number(req.user.office)}` : '') + (/^c/.test(alias) ? cityIn(req, alias) : /^u/.test(alias) ? teamIn(req, alias) : ''));
const canManageOffice = (req, officeId) => req.user.role === 'admin' || req.user.supervises.includes(Number(officeId));

app.get(
  '/api/orders',
  auth(),
  wrap((req, res) => {
    const { status, date, driver_id, q, route_id, unrouted, account_id } = req.query;
    if (cachedList(req, res)) return;
    const { limit, offset } = paging(req, 200000);
    const where = [];
    const args = [];
    if (req.user.role === 'repartidor') {
      where.push('o.driver_id = ?');
      args.push(req.user.id);
    } else if (driver_id) {
      where.push('o.driver_id = ?');
      args.push(driver_id);
    }
    if (status) {
      const list = String(status).split(',');
      where.push(`o.status IN (${list.map(() => '?').join(',')})`);
      args.push(...list);
    }
    const dateTo = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date_to || '') ? req.query.date_to : '';
    if (date && dateTo && dateTo !== date) {
      // rango de fechas (en cualquier orden)
      where.push('o.scheduled_date BETWEEN ? AND ?');
      args.push(...[date, dateTo].sort());
    } else if (date) {
      where.push('o.scheduled_date = ?');
      args.push(date);
    }
    if (route_id) {
      where.push('o.route_id = ?');
      args.push(route_id);
    }
    if (unrouted === '1') where.push('o.route_id IS NULL', FOLLOW_OPEN);
    if (req.query.backorder === '1') where.push(`o.status IN ${OPEN_ST} AND EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id AND i.filled < i.qty)`);
    const offO = (req.user.role !== 'repartidor' && req.user.office) || req.query.office_id;
    if (offO) { where.push(`${OFFICE_OF('c')} = ?`); args.push(Number(offO)); }
    if (cityIn(req)) where.push('1' + cityIn(req));
    if (req.query.city) { where.push('lower(TRIM(c.city)) = lower(TRIM(?))'); args.push(String(req.query.city)); }
    const colQ = [].concat(req.query.colonia || []).map(String).filter((x) => x.trim());
    if (colQ.length) {
      // una o varias colonias; la misma colonia aunque esté escrita distinto ("2A SECCION", "Fracc.", mayúsculas o acentos)
      const keys = new Set(colQ.map(colKey));
      const ids = db.prepare(`SELECT DISTINCT colonia FROM customers WHERE colonia IS NOT NULL`).all().map((r) => r.colonia).filter((x) => keys.has(colKey(x)));
      if (ids.length) { where.push(`c.colonia IN (${ids.map(() => '?').join(',')})`); args.push(...ids); } else where.push('0');
    }
    const zipQ = [].concat(req.query.zip || []).flatMap((x) => String(x).split(/[,\s]+/)).map(zipOf).filter(Boolean);
    if (zipQ.length) { where.push(`substr(replace(COALESCE(c.zip,''),' ',''),1,5) IN (${zipQ.map(() => '?').join(',')})`); args.push(...zipQ); }
    if (account_id === 'none') where.push('o.account_id IS NULL');
    else if (account_id) { where.push('o.account_id = ?'); args.push(Number(account_id)); }
    if (q) {
      where.push('(EXISTS (SELECT 1 FROM serials s WHERE s.order_id = o.id AND s.serial LIKE ?) OR o.tracking_code LIKE ? OR c.name LIKE ? OR c.address LIKE ? OR c.phone LIKE ? OR c.external_id LIKE ?)');
      args.push(`%${normSerial(q)}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const total = db.prepare(`SELECT COUNT(*) c FROM orders o JOIN customers c ON c.id = o.customer_id ${w}`).get(...args).c;
    const rows = db.prepare(`${ORDER_SELECT} ${w} ORDER BY o.scheduled_date DESC, o.route_id, o.stop_seq, o.id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset);
    // S/N de todos los pedidos de la lista en una sola consulta (antes era una por pedido)
    const snMap = new Map();
    if (rows.length > 300) for (const x of db.prepare("SELECT order_id, GROUP_CONCAT(serial, ', ') l FROM serials WHERE order_id IS NOT NULL GROUP BY order_id").all()) snMap.set(x.order_id, x.l);
    else if (rows.length) for (const x of db.prepare(`SELECT order_id, GROUP_CONCAT(serial, ', ') l FROM serials WHERE order_id IN (${rows.map(() => '?').join(',')}) GROUP BY order_id`).all(...rows.map((r) => r.id))) snMap.set(x.order_id, x.l);
    for (const r of rows) { r.sn_list = snMap.get(r.id) ?? null; delete r.public_token; }
    sendList(req, res, { total, rows: req.query.sort === 'geo' ? geoSort(rows) : req.query.sort === 'cp' ? geoSort(rows, 'cp') : rows });
  })
);
app.get('/api/orders/zips', auth(...STAFF), wrap((req, res) => {
  const where = ["TRIM(COALESCE(c.zip,'')) <> ''", "o.status <> 'cancelado'"];
  const args = [];
  const off = req.user.office || Number(req.query.office_id) || null;
  if (off) { where.push(`${OFFICE_OF('c')} = ?`); args.push(off); }
  if (cityIn(req)) where.push('1' + cityIn(req));
  if (req.query.city) { where.push('lower(TRIM(c.city)) = lower(TRIM(?))'); args.push(String(req.query.city)); }
  if (req.query.open === '1') where.push("o.status IN ('pendiente','asignado','cargado','fallido')");
  const rows = db.prepare(`SELECT c.zip, c.colonia, c.city, COUNT(*) n FROM orders o JOIN customers c ON c.id = o.customer_id WHERE ${where.join(' AND ')} GROUP BY c.zip, c.colonia, c.city`).all(...args);
  const m = new Map();
  for (const r of rows) {
    const z = zipOf(r.zip); if (!z) continue;
    const x = m.get(z) || { zip: z, city: r.city, n: 0, cols: new Map() };
    x.n += r.n; if (r.colonia) x.cols.set(r.colonia, (x.cols.get(r.colonia) || 0) + r.n); m.set(z, x);
  }
  res.json([...m.values()].map((x) => ({ zip: x.zip, city: x.city, n: x.n, colonias: [...x.cols.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map((c) => c[0]) })).sort((a, b) => a.zip.localeCompare(b.zip)));
}));
app.get('/api/orders/colonias', auth(...STAFF), wrap((req, res) => {
  const where = ["TRIM(COALESCE(c.colonia,'')) <> ''"];
  const args = [];
  const off = req.user.office || Number(req.query.office_id) || null;
  if (off) { where.push(`${OFFICE_OF('c')} = ?`); args.push(off); }
  if (cityIn(req)) where.push('1' + cityIn(req));
  if (req.query.city) { where.push('lower(TRIM(c.city)) = lower(TRIM(?))'); args.push(String(req.query.city)); }
  if (req.query.open === '1') where.push("o.status IN ('pendiente','asignado','cargado','fallido')");
  const rows = db.prepare(`SELECT c.colonia, c.city, COUNT(*) n FROM orders o JOIN customers c ON c.id = o.customer_id WHERE ${where.join(' AND ')} AND o.status <> 'cancelado' GROUP BY c.colonia, c.city`).all(...args);
  const m = new Map();
  for (const r of rows) { const k = colKey(r.colonia); const nm = String(r.colonia).replace(/\s+/g, ' ').trim(); const x = m.get(k) || { name: nm, city: r.city, n: 0 }; if (nm.length < x.name.length) x.name = nm; x.n += r.n; m.set(k, x); }
  res.json([...m.values()].sort((a, b) => a.name.localeCompare(b.name, 'es')));
}));
app.get(
  '/api/orders/tracking/:code',
  auth(),
  wrap((req, res) => {
    let r = db.prepare('SELECT id FROM orders WHERE tracking_code = ?').get(req.params.code.trim());
    // ¿es el número de serie del equipo? -> su pedido más reciente
    if (!r) r = db.prepare('SELECT o.id FROM serials s JOIN orders o ON o.id = s.order_id WHERE s.serial = ? ORDER BY o.id DESC LIMIT 1').get(normSerial(req.params.code));
    if (!r) throw new HttpError(404, 'No hay pedido con ese número de serie o número de pedido');
    const o = loadOrder(r.id);
    if (!canSee(req.user, o)) throw new HttpError(403, 'Este paquete no está asignado a ti');
    res.json(o);
  })
);
app.get(
  '/api/orders/:id',
  auth(),
  wrap((req, res) => {
    const o = loadOrder(req.params.id);
    if (!o) throw new HttpError(404, 'No encontrado');
    if (!canSee(req.user, o)) throw new HttpError(403, 'Sin permiso');
    if (STAFF.includes(req.user.role)) {
      o.messages = db.prepare('SELECT id, event, channel, recipient, status, error, created_at, sent_at, gw_state FROM messages WHERE order_id=? ORDER BY id DESC').all(o.id);
      o.sheet = db.prepare('SELECT status, error, sent_at FROM sheet_sync WHERE order_id=? ORDER BY id DESC LIMIT 1').get(o.id) || null;
      o.public_link = notify.trackLink(getSettings(), o.public_token);
    }
    res.json(o);
  })
);
app.post(
  '/api/orders',
  auth(...STAFF),
  wrap((req, res) => {
    const { customer_id, items = [], scheduled_date, priority, notes, cod_amount, tracking_code } = req.body;
    const stype = ['general', 'medicamento', 'muestra', 'dispositivo', 'refrigerado'].includes(req.body.shipment_type) ? req.body.shipment_type : 'general';
    const tnum = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
    const tmin = tnum(req.body.temp_min), tmax = tnum(req.body.temp_max);
    if (tmin != null && tmax != null && tmin > tmax) throw new HttpError(400, 'La temperatura mínima no puede ser mayor que la máxima');
    if (!customer_id) throw new HttpError(400, 'Selecciona un cliente');
    const t2 = telnorGuard(customer_id, { allowSecond: req.user.role === 'admin' && req.body.second_unit === true });
    const noStock = [];
    const id = tx(() => {
      const code = (tracking_code || '').trim() || genTracking();
      const r = db
        .prepare('INSERT INTO orders (tracking_code, customer_id, scheduled_date, priority, notes, cod_amount, created_by, public_token, shipment_type, temp_min, temp_max, requires_seal, seal_number) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(code, customer_id, scheduled_date || today(), priority === 'alta' ? 'alta' : 'normal', notes || null, Number(cod_amount) || 0, req.user.id,
          crypto.randomBytes(12).toString('hex'), stype, tmin, tmax, req.body.requires_seal ? 1 : 0, req.body.seal_number ? String(req.body.seal_number).trim().slice(0, 40) : null);
      const oid = Number(r.lastInsertRowid);
      if (req.body.account_id && db.prepare('SELECT 1 FROM accounts WHERE id=?').get(Number(req.body.account_id))) db.prepare('UPDATE orders SET account_id=? WHERE id=?').run(Number(req.body.account_id), oid);
      if (t2.delivered) { db.prepare("UPDATE orders SET notes=TRIM(COALESCE(notes,'') || ' · Segundo equipo autorizado (ya se entregó ' || ? || ')') WHERE id=?").run(t2.delivered.tracking_code, oid); audit(req, 'pedido.segundo_equipo', `${t2.delivered.tracking_code} → nuevo pedido`); }
      for (const it of items) {
        const qty = Math.abs(Math.trunc(Number(it.qty))) || 1;
        db.prepare('INSERT INTO order_items (order_id, product_id, qty) VALUES (?,?,?)').run(oid, it.product_id, qty);
        // sin existencia suficiente el pedido se crea igual (queda por surtir); solo se descuenta lo que hay
        if (takeStock(oid, it.product_id, qty, code, req.user.id) < qty) noStock.push(db.prepare('SELECT name FROM products WHERE id=?').get(it.product_id)?.name || 'producto');
      }
      return oid;
    });
    notify.queueEvent('registrado', id);
    res.status(201).json({ ...loadOrder(id), without_stock: noStock });
  })
);
app.post(
  '/api/orders/:id/cancel',
  auth(...STAFF),
  wrap((req, res) => {
    const o = loadOrder(req.params.id);
    if (!o) throw new HttpError(404, 'No encontrado');
    if (!officeOrders(req, [o.id]).length) throw new HttpError(403, 'Este pedido es de otra oficina');
    if (['entregado', 'cancelado'].includes(o.status)) throw new HttpError(409, 'No se puede cancelar');
    tx(() => {
      releaseOrderSerials(o.id, req.user.id, `Pedido ${o.tracking_code} cancelado`);
      db.prepare("UPDATE orders SET status='cancelado', route_id=NULL, stop_seq=NULL WHERE id=?").run(o.id);
      returnOrderStock(o.id, o.tracking_code, req.user.id);
    });
    audit(req, 'pedido.cancelar', o.tracking_code);
    res.json({ ok: true });
  })
);
// Rutas que perdieron paradas: se recalculan, o se eliminan si quedaron vacías y sin visitas
function recalcRoutes(routeIds) {
  const s = getSettings();
  for (const rid of [...new Set(routeIds.filter(Boolean))]) {
    const old = db.prepare('SELECT * FROM routes WHERE id=?').get(rid);
    if (!old) continue;
    const rest = db.prepare("SELECT id FROM orders WHERE route_id=? AND status IN ('asignado','cargado')").all(rid).map((x) => x.id);
    const closed = db.prepare("SELECT COUNT(*) c FROM orders WHERE route_id=? AND status IN ('entregado','fallido')").get(rid).c;
    if (!rest.length && !closed) db.prepare('DELETE FROM routes WHERE id=?').run(rid);
    else if (rest.length && old.status === 'planificada') persistRoute({ routeId: rid, driverId: old.driver_id, date: old.date, depot: { lat: old.depot_lat, lng: old.depot_lng }, orderIds: rest, settings: s });
    else if (!rest.length) db.prepare("UPDATE routes SET status='completada', finished_at=COALESCE(finished_at, datetime('now')) WHERE id=?").run(rid);
  }
}
// Cambio de estado masivo desde Clientes o Pedidos.
// pendiente: lo quita de su ruta (opcional: nueva fecha) · cancelado: regresa existencias y libera S/N
// fallido: registra el intento con motivo · entregado: registro manual sin evidencia (solo administrador, con quién recibió)
const BULK_FROM = {
  pendiente: ['asignado', 'cargado', 'fallido', 'pendiente'],
  cancelado: ['pendiente', 'asignado', 'cargado', 'fallido'],
  fallido: ['pendiente', 'asignado', 'cargado'],
  entregado: ['pendiente', 'asignado', 'cargado', 'fallido'],
};
app.post(
  '/api/orders/bulk-status',
  auth(...STAFF),
  wrap((req, res) => {
    const b = req.body || {};
    const status = b.status;
    if (!BULK_FROM[status]) throw new HttpError(400, 'Elige el nuevo estado');
    if (status === 'entregado' && req.user.role !== 'admin') throw new HttpError(403, 'Solo el administrador puede marcar entregas manuales');
    const reason = String(b.reason || '').trim().slice(0, 200);
    const receiver = String(b.receiver_name || '').trim().slice(0, 120);
    // foto de la recepción (opcional) para entregas o intentos registrados por la oficina
    const manualPhoto = ['entregado', 'fallido'].includes(status) && b.photo ? saveDataUrl(b.photo, 'foto') : null;
    const note = String(b.note || '').trim().slice(0, 300);
    if (status === 'fallido' && !reason) throw new HttpError(400, 'Indica el motivo del intento fallido');
    if (status === 'entregado' && !receiver) throw new HttpError(400, 'Indica quién recibió');
    const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : null;
    let ids = (Array.isArray(b.order_ids) ? b.order_ids : []).map(Number).filter(Boolean);
    if (Array.isArray(b.customer_ids) && b.customer_ids.length) {
      const cids = b.customer_ids.map(Number).filter(Boolean).slice(0, 5000);
      // de cada cliente se toman sus pedidos que todavía pueden pasar al nuevo estado
      ids.push(...db.prepare(`SELECT id FROM orders WHERE customer_id IN (${cids.map(() => '?').join(',')}) AND status IN (${BULK_FROM[status].map(() => '?').join(',')})`).all(...cids, ...BULK_FROM[status]).map((r) => r.id));
    }
    ids = officeOrders(req, [...new Set(ids)].slice(0, 3000));
    if (!ids.length) throw new HttpError(400, 'La selección no tiene pedidos que puedan cambiar a ese estado');
    const changed = [];
    const skipped = [];
    const routes = [];
    const who = req.user.name || 'administración';
    tx(() => {
      for (const id of ids) {
        const o = loadOrder(id);
        if (!o) continue;
        if (!BULK_FROM[status].includes(o.status)) { skipped.push({ tracking_code: o.tracking_code, reason: `está ${o.status}` }); continue; }
        if (o.route_id) routes.push(o.route_id);
        if (status === 'pendiente') {
          db.prepare("UPDATE orders SET status='pendiente', route_id=NULL, stop_seq=NULL, eta=NULL, leg_km=NULL, driver_id=NULL, loaded_at=NULL, scheduled_date=COALESCE(?, scheduled_date) WHERE id=?").run(date, o.id);
        } else if (status === 'cancelado') {
          releaseOrderSerials(o.id, req.user.id, `Pedido ${o.tracking_code} cancelado`);
          db.prepare("UPDATE orders SET status='cancelado', route_id=NULL, stop_seq=NULL, eta=NULL WHERE id=?").run(o.id);
          returnOrderStock(o.id, o.tracking_code, req.user.id);
        } else {
          // entrega manual: el Telmex S/N de cada pieza es obligatorio (se captura en el mismo diálogo)
          if (status === 'entregado' && missingSerialCount(o.id)) {
            const given = b.serials && typeof b.serials === 'object' ? [].concat(b.serials[o.id] || b.serials[String(o.id)] || []).map((x) => String(x || '').trim()).filter(Boolean) : [];
            let err = null;
            db.exec('SAVEPOINT msn');
            try { for (const sn of given) assignSerial(o, sn, req.user); } catch (e) { err = e.message; }
            if (err || missingSerialCount(o.id)) { db.exec('ROLLBACK TO msn'); db.exec('RELEASE msn'); skipped.push({ tracking_code: o.tracking_code, reason: err || 'Falta el Telmex S/N (HWTC…)' }); continue; }
            db.exec('RELEASE msn');
          }
          const ev = db.prepare(`INSERT INTO evidences (order_id, driver_id, result, receiver_name, reason, notes, kind, photo_path) VALUES (?,?,?,?,?,?, 'manual', ?)`)
            .run(o.id, o.driver_id || null, status, status === 'entregado' ? receiver : null, status === 'fallido' ? reason : null,
              `Registro manual por ${who}${note ? ' · ' + note : ''}${manualPhoto ? ' · con foto' : ''}`, manualPhoto);
          db.prepare("UPDATE orders SET status=?, attempts=attempts+1, delivered_at=datetime('now') WHERE id=?").run(status, o.id);
          if (status === 'entregado') { custodyOnDelivery(o.id, o.driver_id, req.user.id); deliverOrderSerials(o.id, req.user.id, receiver); }
          notify.queueSheet(Number(ev.lastInsertRowid), o.id);
          if (b.notify) notify.queueEvent(status, o.id);
        }
        changed.push(o.tracking_code);
      }
      recalcRoutes(routes);
    });
    if (changed.length) audit(req, 'pedidos.estado', `${changed.length} → ${status}${reason ? ' · ' + reason : ''}${receiver ? ' · recibió ' + receiver : ''}`);
    res.json({ changed: changed.length, skipped });
  })
);
// Programar día y hora de entrega (la asignación a repartidor se hace con /api/routes/assign)
app.put('/api/orders/:id/schedule', auth(...STAFF), wrap((req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
  if (!o) throw new HttpError(404, 'No encontrado');
  if (!officeOrders(req, [o.id]).length) throw new HttpError(403, 'Este pedido es de otra oficina');
  if (['entregado', 'cancelado'].includes(o.status)) throw new HttpError(409, `El pedido ya está ${o.status}`);
  const b = req.body || {};
  const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : o.scheduled_date;
  const time = b.time === '' || b.time === null ? null : /^\d{2}:\d{2}$/.test(b.time || '') ? b.time : o.appointment_time;
  db.prepare("UPDATE orders SET scheduled_date=?, appointment_time=?, status=CASE WHEN status='fallido' THEN 'pendiente' ELSE status END WHERE id=?").run(date, time, o.id);
  // si ya va en una ruta, se reordena con la nueva hora
  if (o.route_id && (time !== o.appointment_time)) {
    const r = db.prepare('SELECT * FROM routes WHERE id=?').get(o.route_id);
    if (r && r.status === 'planificada') {
      const ids = db.prepare("SELECT id FROM orders WHERE route_id=? AND status IN ('asignado','cargado')").all(r.id).map((x) => x.id);
      if (ids.length) persistRoute({ routeId: r.id, driverId: r.driver_id, date: r.date, depot: { lat: r.depot_lat, lng: r.depot_lng }, orderIds: ids, settings: getSettings() });
    }
  }
  audit(req, 'pedido.programar', `${o.tracking_code} → ${date}${time ? ' ' + time : ''}`);
  res.json({ ok: true, date, time });
}));
app.post(
  '/api/orders/:id/reschedule',
  auth(...STAFF),
  wrap((req, res) => {
    const o = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
    if (!o) throw new HttpError(404, 'No encontrado');
    if (!officeOrders(req, [o.id]).length) throw new HttpError(403, 'Este pedido es de otra oficina');
    if (!['fallido', 'pendiente', 'asignado'].includes(o.status)) throw new HttpError(409, 'Estado no permite reprogramar');
    db.prepare("UPDATE orders SET status='pendiente', route_id=NULL, stop_seq=NULL, eta=NULL, driver_id=NULL, scheduled_date=? WHERE id=?").run(
      req.body.date || today(), o.id
    );
    res.json({ ok: true });
  })
);

// Escaneo de carga al vehículo (verifica que el paquete pertenece a la ruta del repartidor)
app.post(
  '/api/scan/load',
  auth(),
  wrap((req, res) => {
    const code = String(req.body.code || '').trim();
    let o = db.prepare('SELECT * FROM orders WHERE tracking_code = ?').get(code);
    if (!o) {
      // ¿escanearon el número de serie del equipo? Se carga el pedido al que está asignado
      const s = db.prepare("SELECT order_id FROM serials WHERE serial = ? AND status = 'asignado'").get(normSerial(code));
      if (s) o = db.prepare('SELECT * FROM orders WHERE id = ?').get(s.order_id);
    }
    if (!o) throw new HttpError(404, `Guía o S/N ${code} no existe`);
    if (req.user.role === 'repartidor' && o.driver_id !== req.user.id) throw new HttpError(409, 'Paquete NO pertenece a tu ruta');
    if (o.status === 'cargado') return res.json({ ok: true, already: true, order: loadOrder(o.id) });
    if (o.status !== 'asignado') throw new HttpError(409, `Paquete en estado "${o.status}", no se puede cargar`);
    if (missingSerialCount(o.id)) throw serialsRequiredError(o);
    if (req.user.role === 'repartidor' && getSettings().require_vehicle_check === '1' && !todayCheck(req.user.id)) {
      const e = new HttpError(409, 'Antes de cargar, llena el checklist de tu unidad (menú Mi ruta → Checklist de unidad)');
      e.data = { code: 'check_required' };
      throw e;
    }
    db.prepare("UPDATE orders SET status='cargado', loaded_at=datetime('now') WHERE id=?").run(o.id);
    notify.queueEvent('en_camino', o.id);
    res.json({ ok: true, order: loadOrder(o.id) });
  })
);

// Para registrar "Cliente ausente", "Rechazado", "Dirección incorrecta" u "Otro" el repartidor debe estar en el domicilio
// (o cerca, si el pin es aproximado). Así el intento es real y no un cierre a distancia.
const PRESENCE_REASONS = ['Cliente ausente', 'Rechazado por cliente', 'No es cliente Telnor', 'Dirección incorrecta', 'Otro'];
function presenceCheck(o, b, reason) {
  if (reason === 'Reprogramado por cliente') throw new HttpError(400, 'Si el cliente pidió otra fecha, usa "Reprogramar" e indica el día: no cuenta como entrega fallida');
  if (!PRESENCE_REASONS.includes(reason)) return;
  if (reason === 'Cliente ausente' && !b.photo) throw new HttpError(400, 'Toma la foto de la fachada: es la prueba de que estuviste en el domicilio');
  if (reason === 'Cliente ausente' && !b.contacted) throw new HttpError(400, 'Antes de registrar "Cliente ausente" llama o envía mensaje al cliente');
  const lat = Number(b.lat), lng = Number(b.lng);
  if (b.lat == null || !Number.isFinite(lat) || !Number.isFinite(lng)) { if (!b.photo) throw new HttpError(400, 'Sin GPS: toma la foto del domicilio para registrar el intento'); return; }
  const c = db.prepare('SELECT c.lat, c.lng, c.geo_quality FROM customers c WHERE c.id=?').get(o.customer_id);
  if (!c || c.lat == null || c.geo_quality === 'ciudad') return;
  const lim = APPROX_GEO.includes(c.geo_quality) ? 2000 : reason === 'Dirección incorrecta' ? 1000 : Number(getSettings().fail_geofence_m) || 300;
  const d = haversine({ lat, lng }, c) * 1000;
  if (d > lim) throw new HttpError(400, `Estás a ${d >= 1000 ? (d / 1000).toFixed(1) + ' km' : Math.round(d) + ' m'} del domicilio. Para registrar "${reason}" debes llegar al domicilio (máx. ${lim} m). Si el cliente pidió otro día, usa "Reprogramar".`);
}
// Seguimiento: visitas sin entregar (no cuenta "Reprogramado por cliente"); al llegar a N pasa a la cola de la oficina
const FOLLOW_OPEN = '(o.followup_at IS NULL OR o.followup_done_at IS NOT NULL)'; // fuera de la cola: se puede planificar
const failVisits = (id) => db.prepare("SELECT COUNT(*) n FROM evidences WHERE order_id=? AND result='fallido' AND COALESCE(reason,'') <> 'Reprogramado por cliente'").get(id).n;
function checkFollowup(orderId) {
  const n = Number(getSettings().followup_visits) || 0;
  if (n < 1) return false;
  const o = db.prepare('SELECT id, status, followup_at, followup_done_at, followup_base FROM orders WHERE id=?').get(orderId);
  if (!o || ['entregado', 'cancelado'].includes(o.status)) return false;
  if (o.followup_at && !o.followup_done_at) return false; // ya está en la cola
  const v = failVisits(orderId);
  if (v - (o.followup_done_at ? o.followup_base : 0) < n) return false;
  db.prepare("UPDATE orders SET followup_at=datetime('now'), followup_done_at=NULL, followup_by=NULL, followup_note=NULL WHERE id=?").run(orderId);
  return true;
}
app.get('/api/followup', auth(...STAFF), wrap((req, res) => {
  const rows = db.prepare(`SELECT o.id, o.tracking_code, o.status, o.scheduled_date, o.followup_at, o.notes, c.id customer_id, c.name customer_name, c.phone customer_phone, c.phone_alt customer_phone_alt,
      c.external_id telnor_phone, c.address, c.colonia customer_colonia, c.city customer_city, c.reference address_reference, c.lat, c.lng, c.geo_quality, u.name driver_name,
      (SELECT COUNT(*) FROM evidences e WHERE e.order_id=o.id AND e.result='fallido' AND COALESCE(e.reason,'') <> 'Reprogramado por cliente') visits,
      (SELECT GROUP_CONCAT(serial, ', ') FROM serials WHERE order_id=o.id) sn_list
    FROM orders o JOIN customers c ON c.id=o.customer_id LEFT JOIN users u ON u.id=o.driver_id
    WHERE o.followup_at IS NOT NULL AND o.followup_done_at IS NULL AND o.status NOT IN ('entregado','cancelado') ${inOffice(req, 'c')} ORDER BY o.followup_at`).all();
  const ev = db.prepare("SELECT e.created_at, e.reason, e.notes, e.photo_path, e.distance_to_customer_m dist, u.name driver FROM evidences e LEFT JOIN users u ON u.id=e.driver_id WHERE e.order_id=? AND e.result='fallido' ORDER BY e.id DESC LIMIT 6");
  for (const r of rows) r.visits_list = ev.all(r.id);
  res.json(rows);
}));
app.get('/api/followup/count', auth(...STAFF), wrap((req, res) => {
  res.json({ n: db.prepare(`SELECT COUNT(*) n FROM orders o JOIN customers c ON c.id=o.customer_id WHERE o.followup_at IS NOT NULL AND o.followup_done_at IS NULL AND o.status NOT IN ('entregado','cancelado') ${inOffice(req, 'c')}`).get().n });
}));
// la oficina verificó cliente y datos: vuelve a planificación (cuenta N visitas más antes de volver a la cola)
app.post('/api/followup/:id/verify', auth(...STAFF), wrap((req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
  if (!o) throw new HttpError(404, 'No encontrado');
  if (!officeOrders(req, [o.id]).length) throw new HttpError(403, 'Este pedido es de otra oficina');
  const note = String(req.body?.note || '').trim().slice(0, 300);
  if (!note) throw new HttpError(400, 'Escribe qué verificaste (p. ej. "Se confirmó domicilio y teléfono con el cliente")');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.body?.date || '') ? req.body.date : null;
  tx(() => {
    db.prepare("UPDATE orders SET followup_done_at=datetime('now'), followup_by=?, followup_note=?, followup_base=? WHERE id=?").run(req.user.id, note, failVisits(o.id), o.id);
    // regresa a pendiente sin ruta para planificarlo (si ya no está en una ruta activa)
    if (o.status === 'fallido') db.prepare("UPDATE orders SET status='pendiente', route_id=NULL, driver_id=NULL, stop_seq=NULL, eta=NULL, leg_km=NULL, scheduled_date=COALESCE(?, scheduled_date) WHERE id=?").run(date, o.id);
    else if (date) db.prepare('UPDATE orders SET scheduled_date=? WHERE id=? AND route_id IS NULL').run(date, o.id);
  });
  audit(req, 'seguimiento.verificado', `${o.tracking_code}: ${note}`);
  res.json({ ok: true });
}));
// PDF que se anexa al aviso de entrega (guía de uso, garantía…): uno para toda la empresa
app.post('/api/settings/delivery-pdf', auth('admin'), wrap((req, res) => {
  const m = /^data:application\/pdf;base64,(.+)$/.exec(String(req.body?.pdf || ''));
  if (!m) throw new HttpError(400, 'Elige un archivo PDF');
  const buf = Buffer.from(m[1], 'base64');
  if (buf.subarray(0, 5).toString() !== '%PDF-') throw new HttpError(400, 'El archivo no es un PDF válido');
  if (buf.length > 8 * 1024 * 1024) throw new HttpError(413, 'El PDF pasa de 8 MB: redúcelo antes de subirlo');
  const name = `pdf_${Date.now()}_${crypto.randomBytes(12).toString('hex')}.pdf`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  const old = getSettings().delivery_pdf;
  const label = String(req.body?.name || '').replace(/\.pdf$/i, '').trim().slice(0, 60) || 'Documento';
  const up = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  up.run('delivery_pdf', name); up.run('delivery_pdf_name', label);
  if (old && /^pdf_[\w]+\.pdf$/.test(old)) fs.rm(path.join(UPLOAD_DIR, old), () => {});
  audit(req, 'configuracion', `PDF del aviso de entrega: ${label}`);
  res.json({ delivery_pdf: name, delivery_pdf_name: label });
}));
app.delete('/api/settings/delivery-pdf', auth('admin'), wrap((req, res) => {
  const old = getSettings().delivery_pdf;
  db.prepare("UPDATE settings SET value='' WHERE key IN ('delivery_pdf','delivery_pdf_name')").run();
  if (old && /^pdf_[\w]+\.pdf$/.test(old)) fs.rm(path.join(UPLOAD_DIR, old), () => {});
  audit(req, 'configuracion', 'PDF del aviso de entrega quitado');
  res.json({ ok: true });
}));
function registerEvidence(req, result) {
  const o = db.prepare(`SELECT o.*, c.lat clat, c.lng clng FROM orders o JOIN customers c ON c.id=o.customer_id WHERE o.id=?`).get(req.params.id);
  if (!o) throw new HttpError(404, 'No encontrado');
  if (!canSee(req.user, o)) throw new HttpError(403, 'Sin permiso');
  const staff = STAFF.includes(req.user.role);
  // Recepción en mostrador: el despacho entrega al cliente que pasa por su paquete (también pedidos aún sin ruta)
  const counter = staff && req.body.kind === 'mostrador';
  const allowed = counter ? ['pendiente', 'asignado', 'cargado', 'fallido'] : ['asignado', 'cargado'];
  if (!allowed.includes(o.status)) throw new HttpError(409, `El pedido ya está "${o.status}"`);
  const b = req.body;
  const s = getSettings();
  if (result === 'entregado') {
    if (!String(b.receiver_name || '').trim()) throw new HttpError(400, 'Indica el nombre de quien recibe');
    if (s.require_photo === '1' && !b.photo) throw new HttpError(400, 'La foto de la recepción es obligatoria');
    if (s.require_signature === '1' && !b.signature) throw new HttpError(400, 'La firma de quien recibe es obligatoria');
    if (!b.photo && !b.signature) throw new HttpError(400, 'Se requiere foto o firma como evidencia');
  }
  if (result === 'fallido' && !b.reason) throw new HttpError(400, 'Indica el motivo');
  if (result === 'fallido' && !counter && req.user.role === 'repartidor') presenceCheck(o, b, b.reason);
  if (result === 'entregado' && missingSerialCount(o.id)) throw serialsRequiredError(o);
  // entrega en ruta del repartidor: prevalece la entrega confirmada (es el cliente y dio su número Telnor). El GPS se guarda si lo hay, nunca bloquea.
  let idConf = null;
  if (result === 'entregado' && !counter && req.user.role === 'repartidor' && s.require_client_confirm === '1') {
    const tel = String(db.prepare('SELECT external_id FROM customers WHERE id=?').get(o.customer_id)?.external_id || '').replace(/\D/g, '').slice(-10);
    const dicho = String(b.telnor_confirm || '').replace(/\D/g, '').slice(-10);
    if (tel.length >= 4) {
      if (dicho.length < 4) throw new HttpError(400, 'Confirma con el cliente los últimos 4 dígitos de su número Telnor');
      if (!tel.endsWith(dicho)) throw new HttpError(400, 'El número Telnor no coincide con el del cliente: pídele que lo confirme');
    } else if (!b.id_confirmed) throw new HttpError(400, 'Confirma que quien recibe es el cliente');
    idConf = { cliente_confirmado: true, telnor_confirmado: tel.length >= 4 };
  }
  const comp = deliveryCompliance(o, req.user, b);
  if (idConf) Object.assign(comp.c, idConf);
  if (result === 'entregado') {
    if (comp.needsTemp && comp.c.temp_c == null) throw new HttpError(400, `Envío de ${SHIPMENT_TYPES[o.shipment_type].toLowerCase()}: registra la temperatura al entregar`);
    if (comp.needsSeal && comp.c.seal_ok == null) throw new HttpError(400, 'Indica si el sello o precinto llegó íntegro');
    if ((comp.c.temp_in_range === false || comp.c.seal_ok === false || comp.c.package_ok === false) && !String(b.notes || '').trim())
      throw new HttpError(400, 'Hay una incidencia (temperatura fuera de rango, sello o empaque dañado): descríbela en comentarios');
  }
  const photo = saveDataUrl(b.photo, 'foto');
  const sig = saveDataUrl(b.signature, 'firma');
  const lat = Number.isFinite(Number(b.lat)) && b.lat !== null ? Number(b.lat) : null;
  const lng = Number.isFinite(Number(b.lng)) && b.lng !== null ? Number(b.lng) : null;
  const dist = !counter && lat != null && o.clat != null ? Math.round(haversine({ lat, lng }, { lat: o.clat, lng: o.clng }) * 1000) : null;
  const when = b.captured_at && !isNaN(Date.parse(b.captured_at)) ? new Date(b.captured_at).toISOString().replace('T', ' ').slice(0, 19) : null;
  const evId = tx(() => {
    const r = db.prepare(
      `INSERT INTO evidences (order_id, driver_id, result, receiver_name, receiver_relation, receiver_id_doc, reason, photo_path, signature_path,
        barcode_verified, lat, lng, distance_to_customer_m, notes, kind, compliance_json, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, COALESCE(?, datetime('now')))`
    ).run(o.id, req.user.id, result, b.receiver_name ? String(b.receiver_name).trim() : null, b.receiver_relation || null,
      b.receiver_id_doc ? String(b.receiver_id_doc).trim().slice(0, 60) : null, b.reason || null, photo, sig,
      b.barcode_verified ? 1 : 0, lat, lng, dist, b.notes || null, counter ? 'mostrador' : 'ruta', JSON.stringify(comp.c), when);
    db.prepare(`UPDATE orders SET status=?, attempts=attempts+1, delivered_at=COALESCE(?, datetime('now')) WHERE id=?`).run(result, when, o.id);
    if (result === 'entregado') { custodyOnDelivery(o.id, req.user.role === 'repartidor' ? req.user.id : null, req.user.id); deliverOrderSerials(o.id, req.user.id, b.receiver_name); }
    if (o.route_id) {
      const pending = db.prepare("SELECT COUNT(*) c FROM orders WHERE route_id=? AND status IN ('asignado','cargado')").get(o.route_id).c;
      if (pending === 0) db.prepare("UPDATE routes SET status='completada', finished_at=datetime('now') WHERE id=?").run(o.route_id);
      else db.prepare("UPDATE routes SET status='en_curso', started_at=COALESCE(started_at, datetime('now')) WHERE id=? AND status='planificada'").run(o.route_id);
    }
    return Number(r.lastInsertRowid);
  });
  if (counter) audit(req, 'recepcion.mostrador', `${o.tracking_code} → ${b.receiver_name}`);
  if (result === 'entregado' && !counter && lat != null) {
    const cq = db.prepare('SELECT geo_quality, lat FROM customers WHERE id=?').get(o.customer_id);
    const far = cq.geo_quality === 'ciudad' || cq.lat == null ? 25000 : 3000; // del centro de la ciudad cualquier punto de la ciudad; de la colonia, hasta 3 km
    const acc = Number(b.acc) || 0; // precisión del GPS del teléfono (m): una lectura imprecisa no mueve el pin
    if ((cq.lat == null || APPROX_GEO.includes(cq.geo_quality)) && (dist == null || dist <= far) && (!acc || acc <= 100))
      db.prepare("UPDATE customers SET lat=?, lng=?, geo_quality='gps_entrega' WHERE id=?").run(lat, lng, o.customer_id);
  }
  const toFollow = result === 'fallido' && !counter && checkFollowup(o.id);
  notify.queueSheet(evId, o.id);
  notify.queueEvent(result, o.id);
  // Aviso "tu repartidor está cerca" para la siguiente parada de la ruta
  if (o.route_id && !counter) {
    const nx = db.prepare("SELECT id, leg_km FROM orders WHERE route_id=? AND status IN ('asignado','cargado') ORDER BY stop_seq LIMIT 1").get(o.route_id);
    if (nx) {
      const mins = Math.max(5, Math.round(((nx.leg_km || 2) / (Number(s.avg_speed_kmh) || 22)) * 60 + (Number(s.service_minutes) || 6)));
      notify.queueEvent('proximo', nx.id, { minutos: mins });
    }
  }
  return { ok: true, distance_to_customer_m: dist, followup: toFollow || undefined, order: loadOrder(o.id) };
}
// La oficina agrega (o cambia) la foto de una evidencia: p. ej. la foto que mandó el repartidor por WhatsApp
app.post('/api/evidences/:id/photo', auth(...STAFF), wrap((req, res) => {
  const e = db.prepare('SELECT e.*, o.customer_id, o.tracking_code FROM evidences e JOIN orders o ON o.id = e.order_id WHERE e.id = ?').get(req.params.id);
  if (!e) throw new HttpError(404, 'Evidencia no encontrada');
  if (outOfScope(req, e.customer_id)) throw new HttpError(403, 'Este pedido es de otra oficina o ciudad');
  const name = saveDataUrl(req.body?.photo, 'foto');
  if (!name) throw new HttpError(400, 'Falta la foto');
  const note = `Foto agregada por oficina (${req.user.name}, ${new Date().toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })})`;
  db.prepare("UPDATE evidences SET photo_path=?, notes=TRIM(COALESCE(notes,'') || CASE WHEN COALESCE(notes,'')='' THEN '' ELSE ' · ' END || ?) WHERE id=?").run(name, note, e.id);
  db.prepare("UPDATE sheet_sync SET status='pendiente', attempts=0, next_try_at=datetime('now') WHERE evidence_id=? AND status<>'desactivado'").run(e.id);
  audit(req, 'evidencia.foto', `${e.tracking_code}: ${e.photo_path ? 'foto reemplazada' : 'foto agregada'}`);
  res.json({ ok: true, photo_path: name });
}));
app.post('/api/orders/:id/deliver', auth(), wrap((req, res) => res.json(registerEvidence(req, 'entregado'))));
// "Estoy en el domicilio": el repartidor fija la ubicación del cliente con su GPS
app.post('/api/orders/:id/location', auth(), wrap((req, res) => {
  const o = db.prepare('SELECT o.*, c.name cname FROM orders o JOIN customers c ON c.id=o.customer_id WHERE o.id=?').get(req.params.id);
  if (!o) throw new HttpError(404, 'No encontrado');
  if (!canSee(req.user, o)) throw new HttpError(403, 'Sin permiso');
  const lat = Number(req.body?.lat), lng = Number(req.body?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new HttpError(400, 'Sin ubicación GPS');
  const q = STAFF.includes(req.user.role) && !req.headers['x-as-driver'] ? 'manual' : 'repartidor';
  db.prepare('UPDATE customers SET lat=?, lng=?, geo_quality=? WHERE id=?').run(lat, lng, q, o.customer_id);
  audit(req, 'clientes.ubicacion', `${o.cname}: ubicación confirmada en el domicilio por ${req.user.name} (${o.tracking_code})`);
  res.json({ ok: true, geo_quality: q });
}));
app.post('/api/orders/:id/fail', auth(), wrap((req, res) => res.json(registerEvidence(req, 'fallido'))));
// El cliente pidió otra fecha u hora: no es entrega fallida. Hoy → se queda en la ruta con la hora acordada; otro día → queda libre para esa fecha
app.post('/api/orders/:id/client-reschedule', auth(), wrap((req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
  if (!o) throw new HttpError(404, 'No encontrado');
  if (!canSee(req.user, o)) throw new HttpError(403, 'Sin permiso');
  if (!['asignado', 'cargado', 'pendiente', 'fallido'].includes(o.status)) throw new HttpError(409, `El pedido ya está "${o.status}"`);
  const b = req.body || {};
  const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : null;
  if (!date || date < today()) throw new HttpError(400, 'Indica la nueva fecha (hoy o después)');
  const time = /^\d{2}:\d{2}$/.test(b.time || '') ? b.time : null;
  const who = req.user.name;
  const note = `Cliente pidió ${date === today() ? 'otra hora' : 'otra fecha'}: ${date}${time ? ' ' + time : ''} (${who}${b.notes ? ': ' + String(b.notes).slice(0, 200) : ''})`;
  const addNote = "notes=TRIM(COALESCE(notes,'') || CASE WHEN COALESCE(notes,'')='' THEN '' ELSE ' | ' END || ?)";
  tx(() => {
    if (date === today() && o.route_id && ['asignado', 'cargado'].includes(o.status)) {
      const mx = db.prepare('SELECT COALESCE(MAX(stop_seq),0) m FROM orders WHERE route_id=? AND stop_seq < 999').get(o.route_id).m;
      db.prepare(`UPDATE orders SET appointment_time=COALESCE(?, appointment_time), stop_seq=?, eta=COALESCE(?, eta), ${addNote} WHERE id=?`).run(time, mx + 1, time, note, o.id);
    } else {
      db.prepare(`UPDATE orders SET status='pendiente', scheduled_date=?, appointment_time=?, route_id=NULL, driver_id=NULL, stop_seq=NULL, eta=NULL, leg_km=NULL, ${addNote} WHERE id=?`).run(date, time, note, o.id);
      if (o.route_id) {
        const pending = db.prepare("SELECT COUNT(*) c FROM orders WHERE route_id=? AND status IN ('asignado','cargado')").get(o.route_id).c;
        if (!pending) db.prepare("UPDATE routes SET status='completada', finished_at=COALESCE(finished_at, datetime('now')) WHERE id=? AND status IN ('planificada','en_curso')").run(o.route_id);
      }
    }
  });
  audit(req, 'pedido.reprogramado_cliente', `${o.tracking_code}: ${note}`);
  res.json({ ok: true, same_day: date === today(), order: loadOrder(o.id) });
}));
// Cliente ausente: dejar la parada para más tarde hoy (una vez por día), en lugar de cerrarla como fallida
app.post('/api/orders/:id/retry-later', auth(), wrap((req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
  if (!o) throw new HttpError(404, 'No encontrado');
  if (!canSee(req.user, o)) throw new HttpError(403, 'Sin permiso');
  if (!['asignado', 'cargado'].includes(o.status) || !o.route_id) throw new HttpError(409, 'Solo pedidos en una ruta activa');
  if (String(o.retry_at || '').slice(0, 10) === today()) throw new HttpError(409, 'Ya lo dejaste para más tarde hoy. Si sigue sin estar, registra "Cliente ausente".');
  const b = req.body || {};
  if (req.user.role === 'repartidor') presenceCheck(o, { ...b, contacted: true, photo: b.photo || 'x' }, 'Cliente ausente');
  const dist = b.lat != null && o.customer_id ? (() => { const c = db.prepare('SELECT lat, lng FROM customers WHERE id=?').get(o.customer_id); return c?.lat != null ? Math.round(haversine({ lat: Number(b.lat), lng: Number(b.lng) }, c) * 1000) : null; })() : null;
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const mx = db.prepare('SELECT COALESCE(MAX(stop_seq),0) m FROM orders WHERE route_id=? AND stop_seq < 999').get(o.route_id).m;
  db.prepare(`UPDATE orders SET retry_at=?, stop_seq=?, notes=TRIM(COALESCE(notes,'') || CASE WHEN COALESCE(notes,'')='' THEN '' ELSE ' | ' END || ?) WHERE id=?`)
    .run(`${today()} ${hhmm}`, mx + 1, `Ausente ${hhmm}${dist != null ? ` (a ${dist} m)` : ''}: se reintenta más tarde`, o.id);
  audit(req, 'pedido.reintento', `${o.tracking_code}: ausente a las ${hhmm}, pasa al final de la ruta`);
  res.json({ ok: true });
}));
// El repartidor inició la navegación hacia esta parada: avisa al cliente una sola vez
app.post(
  '/api/orders/:id/arriving',
  auth(),
  wrap((req, res) => {
    const o = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
    if (!o) throw new HttpError(404, 'No encontrado');
    if (!canSee(req.user, o)) throw new HttpError(403, 'Sin permiso');
    if (o.status !== 'cargado') return res.json({ queued: 0 });
    const mins = Math.min(240, Math.max(1, Math.round(Number(req.body.minutes) || 10)));
    res.json({ queued: notify.queueEvent('proximo', o.id, { minutos: mins }) });
  })
);
// Reenviar una notificación manualmente (despacho)
app.post(
  '/api/orders/:id/notify',
  auth(...STAFF),
  wrap((req, res) => {
    const o = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
    if (!o) throw new HttpError(404, 'No encontrado');
    const ev = req.body.event;
    if (!notify.EVENTS[ev]) throw new HttpError(400, 'Evento inválido');
    const chans = (Array.isArray(req.body.channels) ? req.body.channels : notify.CHANNELS).filter((c) => notify.CHANNELS.includes(c));
    const n = notify.queueEvent(ev, o.id, { minutos: req.body.minutes || 15 }, { force: true, channels: chans });
    if (!n) throw new HttpError(400, 'El cliente no tiene teléfono/correo válido o desactivó esos canales');
    audit(req, 'notificacion.manual', `${o.tracking_code}: ${ev}`);
    res.json({ queued: n });
  })
);
app.get(
  '/api/messages',
  auth(...STAFF),
  wrap((req, res) => {
    const { limit, offset } = paging(req);
    const where = [];
    const args = [];
    for (const k of ['status', 'channel', 'event']) if (req.query[k]) { where.push(`m.${k}=?`); args.push(req.query[k]); }
    if (req.query.q) { where.push('(o.tracking_code LIKE ? OR c.name LIKE ? OR m.recipient LIKE ?)'); args.push(...Array(3).fill(`%${req.query.q}%`)); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const rows = db.prepare(
      `SELECT m.*, o.tracking_code, c.name customer_name FROM messages m LEFT JOIN orders o ON o.id=m.order_id LEFT JOIN customers c ON c.id=m.customer_id
       ${w} ORDER BY m.id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset);
    const total = db.prepare(`SELECT COUNT(*) n FROM messages m LEFT JOIN orders o ON o.id=m.order_id LEFT JOIN customers c ON c.id=m.customer_id ${w}`).get(...args).n;
    const stats = db.prepare("SELECT status, COUNT(*) n FROM messages WHERE created_at >= datetime('now','-1 day') GROUP BY status").all();
    res.json({ rows, total, stats });
  })
);
// teléfonos que envían SMS y cuántos lleva cada uno hoy
app.get('/api/messages/devices', auth(...STAFF), wrap(async (req, res) => res.json(await notify.smsDeviceStats())));
app.post(
  '/api/messages/:id/retry',
  auth(...STAFF),
  wrap((req, res) => {
    const r = db.prepare("UPDATE messages SET status='pendiente', attempts=0, error=NULL, next_try_at=datetime('now') WHERE id=? AND status IN ('error','simulado')").run(req.params.id);
    if (!r.changes) throw new HttpError(409, 'Solo se reintentan mensajes con error o simulados');
    setImmediate(notify.processQueue);
    res.json({ ok: true });
  })
);
// Recepciones: evidencias de entrega (firma + foto) para consulta y comprobantes
app.get(
  '/api/evidences',
  auth(...STAFF, 'repartidor'),
  wrap((req, res) => {
    const { limit, offset } = paging(req);
    const where = [];
    const args = [];
    // el repartidor solo ve sus propias recepciones
    const own = req.user.role === 'repartidor';
    if (own) { req.query.driver_id = req.user.id; req.query.office_id = ''; }
    if (req.query.from) { where.push("date(e.created_at, 'localtime') >= ?"); args.push(req.query.from); }
    if (req.query.to) { where.push("date(e.created_at, 'localtime') <= ?"); args.push(req.query.to); }
    if (req.query.result) { where.push('e.result = ?'); args.push(req.query.result); }
    if (req.query.kind) { where.push('e.kind = ?'); args.push(req.query.kind); }
    if (req.query.driver_id) { where.push('e.driver_id = ?'); args.push(Number(req.query.driver_id)); }
    const offR = own ? null : req.user.office || Number(req.query.office_id) || null;
    if (offR) { where.push(`${OFFICE_OF('c')} = ?`); args.push(offR); }
    if (!own && cityIn(req)) where.push('1' + cityIn(req));
    if (req.query.city) { where.push('lower(TRIM(c.city)) = lower(TRIM(?))'); args.push(String(req.query.city)); }
    if (req.query.q) { where.push('(o.tracking_code LIKE ? OR c.name LIKE ? OR e.receiver_name LIKE ?)'); args.push(...Array(3).fill(`%${req.query.q}%`)); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const from = `FROM evidences e JOIN orders o ON o.id=e.order_id JOIN customers c ON c.id=o.customer_id LEFT JOIN users u ON u.id=e.driver_id ${w}`;
    const rows = db.prepare(
      `SELECT e.*, o.tracking_code, o.public_token, o.cod_amount, c.name customer_name, c.address, c.phone customer_phone, u.name driver_name,
        (SELECT status FROM sheet_sync s WHERE s.evidence_id=e.id) sheet_status,
        CASE WHEN e.result='entregado' THEN (SELECT GROUP_CONCAT(serial, ', ') FROM serials sr WHERE sr.order_id=e.order_id) END serials_text
       ${from} ORDER BY e.id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset);
    const total = db.prepare(`SELECT COUNT(*) n ${from}`).get(...args).n;
    const s = getSettings();
    for (const r of rows) r.public_link = notify.trackLink(s, r.public_token);
    res.json({ rows, total });
  })
);


// ---------- Rutas ----------
// Ubicación de la oficina de un usuario (o de la principal si no tiene oficina)
function officeDepot(userId) {
  const u = userId ? db.prepare('SELECT office_id FROM users WHERE id=?').get(Number(userId)) : null;
  return db.prepare('SELECT id, name, lat, lng FROM warehouses WHERE id = COALESCE(?, (SELECT id FROM warehouses WHERE is_default=1)) AND lat IS NOT NULL').get(u?.office_id ?? null) || null;
}
function depotOf(s, body = {}, userId = null) {
  if (body.warehouse_id) {
    const w = db.prepare('SELECT lat, lng FROM warehouses WHERE id=? AND lat IS NOT NULL').get(Number(body.warehouse_id));
    if (w) return { lat: w.lat, lng: w.lng };
  }
  const od = userId && body.depot_lat == null ? officeDepot(userId) : null;
  if (od) return { lat: od.lat, lng: od.lng };
  return { lat: Number(body.depot_lat ?? s.depot_lat), lng: Number(body.depot_lng ?? s.depot_lng) };
}
function stopsFor(orderIds) {
  if (!orderIds.length) return [];
  return db
    .prepare(
      // si se acordó una hora con el cliente, la ventana es ±30 min alrededor de esa hora
      `SELECT o.id, o.priority, c.lat, c.lng,
         CASE WHEN o.appointment_time IS NOT NULL THEN strftime('%H:%M', '2000-01-01 ' || o.appointment_time, '-30 minutes') ELSE c.window_start END window_start,
         CASE WHEN o.appointment_time IS NOT NULL THEN strftime('%H:%M', '2000-01-01 ' || o.appointment_time, '+30 minutes') ELSE c.window_end END window_end
       FROM orders o JOIN customers c ON c.id=o.customer_id
       WHERE o.id IN (${orderIds.map(() => '?').join(',')}) ORDER BY o.id`
    )
    .all(...orderIds);
}
// puntos de la matriz: almacén + paradas con ubicación (mismo orden que usa el optimizador)
const matrixPoints = (depot, stops) => [depot, ...stops.filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lng))];
const googleMatrix = (depot, stops) => (gmaps.enabled() ? gmaps.cachedMatrix(matrixPoints(depot, stops)) : null);
const gmPending = new Set();
function googleRefine(rid) {
  if ((!gmaps.enabled() && !osrm.enabled()) || gmPending.has(rid)) return;
  gmPending.add(rid);
  setTimeout(async () => {
    try {
      const r = db.prepare('SELECT * FROM routes WHERE id=?').get(rid);
      if (!r || r.status !== 'planificada') return;
      const ids = db.prepare("SELECT id FROM orders WHERE route_id=? AND status IN ('asignado','cargado')").all(rid).map((x) => x.id);
      const done = db.prepare("SELECT COUNT(*) c FROM orders WHERE route_id=? AND status IN ('entregado','fallido')").get(rid).c;
      if (!ids.length || done) return;
      const depot = { lat: r.depot_lat, lng: r.depot_lng };
      const pts = matrixPoints(depot, stopsFor(ids));
      // primero Google si ya tiene los tramos o le alcanza el cupo; si no, el motor de rutas propio (calles reales, sin costo)
      const okG = gmaps.enabled() && (await gmaps.fillMatrix(pts).catch(() => false));
      const mx = okG ? null : await osrm.table(pts);
      if (!okG && !mx) return;
      persistRoute({ routeId: rid, driverId: r.driver_id, date: r.date, depot, orderIds: ids, settings: getSettings(), noRefine: true, matrix: mx || undefined });
    } catch (e) { console.error('googleRefine', e.message); } finally { gmPending.delete(rid); }
  }, 1500);
}
function persistRoute({ routeId, name, driverId, date, depot, orderIds, settings, startTime, noRefine, matrix: given }) {
  const stops = stopsFor(orderIds);
  const matrix = given || googleMatrix(depot, stops);
  const opt = optimizeRoute(depot, stops, settings, { startTime, matrix });
  if (!matrix && !noRefine && orderIds.length && (gmaps.enabled() || osrm.enabled())) setImmediate(() => { const id = routeId || db.prepare('SELECT route_id FROM orders WHERE id=?').get(orderIds[0])?.route_id; if (id) googleRefine(id); });
  return tx(() => {
    let rid = routeId;
    if (!rid) {
      const r = db
        .prepare('INSERT INTO routes (name, driver_id, date, depot_lat, depot_lng, distance_km, original_distance_km, est_minutes) VALUES (?,?,?,?,?,?,?,?)')
        .run(name, driverId, date, depot.lat, depot.lng, opt.distance_km, opt.original_distance_km, opt.est_minutes);
      rid = Number(r.lastInsertRowid);
    } else {
      db.prepare('UPDATE routes SET distance_km=?, original_distance_km=COALESCE(original_distance_km, ?), est_minutes=? WHERE id=?').run(
        opt.distance_km, opt.original_distance_km, opt.est_minutes, rid
      );
    }
    const upd = db.prepare(
      "UPDATE orders SET route_id=?, driver_id=?, stop_seq=?, eta=?, leg_km=?, status=CASE WHEN status='pendiente' THEN 'asignado' ELSE status END, scheduled_date=COALESCE((SELECT date FROM routes WHERE id=?), scheduled_date) WHERE id=?"
    );
    for (const s of opt.sequence) upd.run(rid, driverId, s.seq, s.eta, s.leg_km, rid, s.id);
    for (const id of opt.unlocated) upd.run(rid, driverId, 999, null, null, rid, id);
    return { route_id: rid, ...opt };
  });
}

app.get(
  '/api/routes',
  auth(),
  wrap((req, res) => {
    const where = [];
    const args = [];
    if (req.query.date && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date_to || '') && req.query.date_to !== req.query.date) {
      where.push('r.date BETWEEN ? AND ?');
      args.push(...[req.query.date, req.query.date_to].sort());
    } else if (req.query.date) {
      where.push('r.date = ?');
      args.push(req.query.date);
    }
    if (req.user.role === 'repartidor') {
      where.push('r.driver_id = ?');
      args.push(req.user.id);
    } else {
      if (Number(req.query.driver_id)) { where.push('r.driver_id = ?'); args.push(Number(req.query.driver_id)); }
      if (req.user.office || req.query.office_id) where.push(`r.driver_id IN (SELECT u2.id FROM users u2 WHERE 1 ${inOffice({ user: { office: req.user.office || Number(req.query.office_id), team: req.user.team, id: req.user.id, role: req.user.role } }, 'u2')})`);
    }
    const rows = db
      .prepare(
        `SELECT r.*, u.name driver_name,
          (SELECT COUNT(*) FROM orders o WHERE o.route_id=r.id) stops,
          (SELECT COUNT(*) FROM orders o WHERE o.route_id=r.id AND o.status='entregado') delivered,
          (SELECT COUNT(*) FROM orders o WHERE o.route_id=r.id AND o.status='fallido') failed,
          (SELECT COUNT(*) FROM orders o WHERE o.route_id=r.id AND o.status='cargado') loaded
         FROM routes r LEFT JOIN users u ON u.id=r.driver_id
         ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY r.date DESC, r.id DESC LIMIT 200`
      )
      .all(...args);
    res.json(rows);
  })
);
app.get(
  '/api/routes/:id',
  auth(),
  wrap((req, res) => {
    const r = db.prepare('SELECT r.*, u.name driver_name, u.last_lat, u.last_lng, u.last_seen FROM routes r LEFT JOIN users u ON u.id=r.driver_id WHERE r.id=?').get(req.params.id);
    if (!r) throw new HttpError(404, 'No encontrada');
    if (req.user.role === 'repartidor' && r.driver_id !== req.user.id) throw new HttpError(403, 'Sin permiso');
    officeRoute(req, r);
    r.stops = db.prepare(`${ORDER_SELECT} WHERE o.route_id=? ORDER BY o.stop_seq`).all(r.id);
    res.json(r);
  })
);
app.post(
  '/api/routes',
  auth(...STAFF),
  wrap((req, res) => {
    const { driver_id, date, order_ids = [], name, start_time } = req.body;
    if (!driver_id || !order_ids.length) throw new HttpError(400, 'Selecciona repartidor y pedidos');
    const s = getSettings();
    const drv = db.prepare("SELECT name FROM users WHERE id=? AND (role='repartidor' OR can_deliver=1)").get(driver_id);
    if (!drv) throw new HttpError(400, 'Repartidor inválido');
    officeDriver(req, driver_id);
    const oids = officeOrders(req, order_ids.map(Number));
    if (!oids.length) throw new HttpError(403, 'Los pedidos son de otra oficina');
    const d = date || today();
    const out = persistRoute({ name: name || `Ruta ${drv.name} ${d}`, driverId: driver_id, date: d, depot: depotOf(s, req.body, driver_id), orderIds: oids, settings: s, startTime: start_time });
    res.status(201).json(out);
  })
);
// Lo asignado a cada repartidor en una fecha (para imprimir / Excel): pedidos con cliente, productos y S/N + inventario que trae
app.get(
  '/api/assigned/export',
  auth(...STAFF),
  wrap((req, res) => {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : today();
    const only = req.query.driver_id ? Number(req.query.driver_id) : null;
    const drivers = db.prepare(`SELECT id, name, vehicle, phone FROM users u WHERE (role='repartidor' OR can_deliver=1) ${only ? 'AND id=?' : 'AND active=1'} ${inOffice(req, 'u')} ORDER BY name`).all(...(only ? [only] : []));
    const custody = new Map(custodyOf(only).map((d) => [d.id, d.items]));
    const out = drivers.map((d) => {
      const orders = db.prepare(`SELECT o.id, o.tracking_code, o.status, o.stop_seq, o.eta, o.scheduled_date, o.notes, o.cod_amount,
          c.name customer, c.phone, c.phone_alt, c.external_id telnor, c.address, c.colonia, c.reference, c.window_start, c.window_end, r.name route_name,
          (SELECT name FROM accounts WHERE id = o.account_id) account,
          (SELECT GROUP_CONCAT(i.qty || ' × ' || p.name, ', ') FROM order_items i JOIN products p ON p.id = i.product_id WHERE i.order_id = o.id) items,
          (SELECT GROUP_CONCAT(s.serial, ', ') FROM serials s WHERE s.order_id = o.id) serials, o.appointment_time
        FROM orders o JOIN customers c ON c.id = o.customer_id LEFT JOIN routes r ON r.id = o.route_id
        WHERE o.driver_id = ? AND o.status <> 'cancelado' AND (o.scheduled_date = ? OR r.date = ? OR (o.status IN ('entregado','fallido') AND date(o.delivered_at,'localtime') = ?))
        ORDER BY COALESCE(o.stop_seq, 999), o.id`).all(d.id, date, date, date);
      return { ...d, orders, inventory: custody.get(d.id) || [] };
    });
    res.json({ date, drivers: out });
  })
);
// Asignación masiva: pedidos (o los pedidos abiertos de varios clientes) a un repartidor.
// Se agregan a su ruta del día (o se crea) y la ruta se re-optimiza; las rutas de donde salieron se recalculan.
app.post(
  '/api/routes/assign',
  auth(...STAFF),
  wrap((req, res) => {
    const b = req.body || {};
    officeDriver(req, b.driver_id);
    selfDriver(req, b.driver_id);
    const drv = db.prepare("SELECT id, name, active FROM users WHERE id=? AND (role='repartidor' OR can_deliver=1)").get(Number(b.driver_id));
    if (!drv) throw new HttpError(400, 'Elige el repartidor');
    if (!drv.active) throw new HttpError(409, `${drv.name} está desactivado`);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : today();
    let ids = (Array.isArray(b.order_ids) ? b.order_ids : []).map(Number).filter(Boolean);
    if (Array.isArray(b.customer_ids) && b.customer_ids.length) {
      const cids = b.customer_ids.map(Number).filter(Boolean).slice(0, 5000);
      ids.push(...db.prepare(`SELECT id FROM orders WHERE customer_id IN (${cids.map(() => '?').join(',')}) AND status IN ('pendiente','asignado')`).all(...cids).map((r) => r.id));
    }
    ids = [...new Set(ids)].slice(0, 2000);
    if (!ids.length) throw new HttpError(400, 'No hay pedidos abiertos para asignar en la selección');
    res.json(assignOrdersTo(req, drv, ids, date));
  })
);
// Personal de una oficina: solo repartidores, pedidos y rutas de su oficina (el admin ve todo)
const userOffice = (id) => db.prepare(`SELECT ${OFFICE_OF('u')} o FROM users u WHERE u.id = ?`).get(Number(id))?.o ?? null;
function officeDriver(req, id) {
  if (req.user.office && userOffice(id) !== req.user.office) throw new HttpError(403, 'Ese repartidor es de otra oficina');
  if (req.user.team?.length && req.user.role !== 'repartidor' && ![...req.user.team, req.user.id].includes(Number(id))) throw new HttpError(403, 'Ese prestador no está en tu coordinación');
}
function officeRoute(req, r) { if (req.user.office && r.driver_id && userOffice(r.driver_id) !== req.user.office) throw new HttpError(403, 'Esta ruta es de otra oficina'); }
function officeOrders(req, ids) {
  if ((!req.user.office && !scopeCities(req)) || !ids.length) return ids;
  const ok = new Set(db.prepare(`SELECT o.id FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.id IN (${ids.map(() => '?').join(',')}) ${inOffice(req, 'c')}`).all(...ids).map((r) => r.id));
  return ids.filter((i) => ok.has(Number(i)));
}
// El despachador (o admin) puede asignarse pedidos a sí mismo: se le activa "También reparte" para entregar en modo repartidor
function selfDriver(req, id) {
  if (Number(id) !== req.user.id || req.user.role === 'repartidor') return;
  const u = db.prepare('SELECT can_deliver FROM users WHERE id=?').get(req.user.id);
  if (u && !u.can_deliver) { db.prepare('UPDATE users SET can_deliver=1 WHERE id=?').run(req.user.id); audit(req, 'usuario.tambien_reparte', `${req.user.name} se asignó pedidos: se activó "También reparte"`); }
}
// El cliente sí lo quiere: el pedido no entregado vuelve a la ruta de hoy de su repartidor (o del elegido) como parada pendiente.
// El intento fallido queda en el historial, marcado como reactivado.
app.post('/api/orders/:id/reactivate', auth(...STAFF), wrap((req, res) => res.json(reactivateOrder(req, Number(req.params.id), req.body || {}))));
function reactivateOrder(req, orderId, body) {
  const o = db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
  if (!o) throw new HttpError(404, 'Pedido no encontrado');
  if (!officeOrders(req, [o.id]).length) throw new HttpError(403, 'Este pedido es de otra oficina o ciudad');
  const lastFail = db.prepare("SELECT id, driver_id, reason FROM evidences WHERE order_id=? AND result='fallido' ORDER BY id DESC LIMIT 1").get(o.id);
  if (!(o.status === 'fallido' || (o.status === 'pendiente' && lastFail))) throw new HttpError(409, `El pedido está "${o.status}": solo se reactivan pedidos no entregados`);
  const did = Number(body.driver_id) || o.driver_id || lastFail?.driver_id;
  const drv = did ? db.prepare("SELECT id, name, active FROM users WHERE id=? AND (role='repartidor' OR can_deliver=1)").get(did) : null;
  if (!drv || !drv.active) throw new HttpError(400, 'Elige el repartidor que lo va a entregar');
  officeDriver(req, drv.id);
  const why = String(body.reason || '').trim().slice(0, 200) || 'El cliente confirmó que sí lo quiere';
  const hora = String(body.appointment_time || '');
  const out = tx(() => {
    db.prepare(`UPDATE orders SET status='pendiente', route_id=NULL, stop_seq=NULL, eta=NULL, leg_km=NULL, driver_id=NULL, retry_at=NULL, delivered_at=NULL,
      appointment_time=CASE WHEN ? <> '' THEN ? ELSE appointment_time END, notes=TRIM(COALESCE(notes,'') || ?) WHERE id=?`)
      .run(/^\d{2}:\d{2}$/.test(hora) ? hora : '', hora, ` | Reactivado ${today()} (${req.user.name}): ${why}${lastFail?.reason ? ' · antes: ' + lastFail.reason : ''}`, o.id);
    if (lastFail) db.prepare("UPDATE evidences SET notes=TRIM(COALESCE(notes,'') || ?) WHERE id=?").run(` [Reactivado: ${why}]`, lastFail.id);
    return assignOrdersTo(req, { id: drv.id, name: drv.name }, [o.id], today());
  });
  if (!out.assigned) throw new HttpError(409, out.skipped?.[0]?.reason || 'No se pudo regresar a la ruta');
  audit(req, 'pedido.reactivar', `${o.tracking_code}: el cliente sí lo quiere → ruta de ${drv.name} (${today()})${lastFail?.reason ? ' · antes: ' + lastFail.reason : ''}`);
  return { ok: true, driver: drv.name, route_id: out.route_id, order: loadOrder(o.id) };
}
app.post('/api/my/orders/:id/decline', auth('repartidor'), wrap((req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id=?').get(Number(req.params.id));
  if (!o || o.driver_id !== req.user.id) throw new HttpError(404, 'Ese servicio no está en tu ruta');
  if (o.status !== 'asignado') throw new HttpError(409, o.status === 'cargado' ? 'Ya lo cargaste: entrégalo o regrésalo a la oficina para que lo reasignen' : `El servicio está "${o.status}"`);
  const why = String(req.body?.reason || '').trim().slice(0, 200);
  const rid = o.route_id;
  tx(() => {
    db.prepare(`UPDATE orders SET status='pendiente', route_id=NULL, stop_seq=NULL, eta=NULL, leg_km=NULL, driver_id=NULL,
      notes=TRIM(COALESCE(notes,'') || ?) WHERE id=?`).run(` | Rechazado por ${req.user.name} (${today()})${why ? ': ' + why : ''}: sin penalización, por reasignar`, o.id);
    if (rid) {
      const r = db.prepare('SELECT * FROM routes WHERE id=?').get(rid);
      const rest = db.prepare("SELECT id FROM orders WHERE route_id=? AND status IN ('asignado','cargado')").all(rid).map((x) => x.id);
      const done = db.prepare("SELECT COUNT(*) c FROM orders WHERE route_id=? AND status IN ('entregado','fallido')").get(rid).c;
      if (rest.length && !done) persistRoute({ routeId: rid, driverId: r.driver_id, date: r.date, depot: { lat: r.depot_lat, lng: r.depot_lng }, orderIds: rest, settings: getSettings() });
    }
  });
  audit(req, 'servicio.rechazo', `${o.tracking_code} rechazado por el prestador${why ? ': ' + why : ''}`);
  res.json({ ok: true });
}));
function assignOrdersTo(req, drv, ids, date, opts = {}) {
  {
    const susp = db.prepare('SELECT suspended_reason FROM users WHERE id=?').get(drv.id)?.suspended_reason;
    if (susp) throw new HttpError(409, `${drv.name} no puede recibir servicios: ${susp}`);
    const rows = db.prepare(`SELECT o.id, o.tracking_code, o.status, o.route_id, o.driver_id, o.scheduled_date, u.name dname, ${FOLLOW_OPEN} free_follow FROM orders o LEFT JOIN users u ON u.id = o.driver_id WHERE o.id IN (${ids.map(() => '?').join(',')})`).all(...ids);
    const skipped = [];
    const take = [];
    const mine = new Set(officeOrders(req, ids));
    for (const o of rows) {
      if (!mine.has(o.id)) skipped.push({ tracking_code: o.tracking_code, reason: 'es de otra oficina' });
      else if (!o.free_follow) skipped.push({ tracking_code: o.tracking_code, reason: 'está en seguimiento: la oficina debe verificar cliente y datos' });
      else if (!['pendiente', 'asignado', 'fallido'].includes(o.status) && !(o.status === 'cargado' && (o.scheduled_date < today() || opts.allowLoaded))) skipped.push({ tracking_code: o.tracking_code, reason: o.status === 'cargado' ? `ya está cargado en la unidad de ${o.dname || 'otro repartidor'}` : `está ${o.status}` });
      else if (o.driver_id === drv.id && o.route_id && o.scheduled_date === date) skipped.push({ tracking_code: o.tracking_code, reason: `${drv.name} ya lo tiene` });
      else take.push(o);
    }
    if (!take.length) return { assigned: 0, skipped, route_id: null, driver: drv.name, date };
    const s = getSettings();
    const fromRoutes = [...new Set(take.map((o) => o.route_id).filter(Boolean))];
    const result = tx(() => {
      // se sueltan de su ruta anterior
      // se sueltan de su ruta anterior y quedan programados para el día de la ruta
      const free = db.prepare("UPDATE orders SET route_id=NULL, driver_id=NULL, stop_seq=NULL, eta=NULL, leg_km=NULL, status='pendiente', scheduled_date=? WHERE id=?");
      for (const o of take) free.run(date, o.id);
      // ruta del repartidor para ese día (abierta) o una nueva
      const r = db.prepare("SELECT * FROM routes WHERE driver_id=? AND date=? AND status IN ('planificada','en_curso') ORDER BY id DESC LIMIT 1").get(drv.id, date);
      const keep = r ? db.prepare("SELECT id FROM orders WHERE route_id=? AND status IN ('asignado','cargado')").all(r.id).map((x) => x.id) : [];
      const done = r ? db.prepare("SELECT COUNT(*) c FROM orders WHERE route_id=? AND status IN ('entregado','fallido')").get(r.id).c : 0;
      const out = persistRoute({ routeId: r?.id, name: `Ruta ${drv.name} ${date}`, driverId: drv.id, date, depot: r ? { lat: r.depot_lat, lng: r.depot_lng } : depotOf(s, {}, drv.id), orderIds: [...keep, ...take.map((o) => o.id)], settings: s });
      if (done) db.prepare('UPDATE orders SET stop_seq = stop_seq + ? WHERE route_id=? AND status IN (\'asignado\',\'cargado\') AND stop_seq < 999').run(done, out.route_id);
      // rutas de origen: se recalculan o se eliminan si quedaron vacías
      for (const rid of fromRoutes.filter((x) => x !== out.route_id)) {
        const old = db.prepare('SELECT * FROM routes WHERE id=?').get(rid);
        const rest = db.prepare("SELECT id FROM orders WHERE route_id=? AND status IN ('asignado','cargado')").all(rid).map((x) => x.id);
        const closed = db.prepare("SELECT COUNT(*) c FROM orders WHERE route_id=? AND status IN ('entregado','fallido')").get(rid).c;
        if (!rest.length && !closed) db.prepare('DELETE FROM routes WHERE id=?').run(rid);
        else if (rest.length) persistRoute({ routeId: rid, driverId: old.driver_id, date: old.date, depot: { lat: old.depot_lat, lng: old.depot_lng }, orderIds: rest, settings: s });
      }
      return out;
    });
    audit(req, 'pedidos.asignar', `${take.length} pedidos → ${drv.name} (${date})`);
    const rt = db.prepare('SELECT est_minutes FROM routes WHERE id=?').get(result.route_id);
    const wd = Number(getSettings().workday_minutes) || 540;
    return { assigned: take.length, skipped, route_id: result.route_id, driver: drv.name, date, unlocated: result.unlocated?.length || 0, est_minutes: rt?.est_minutes || 0, over_workday: (rt?.est_minutes || 0) > wd ? Math.round(((rt.est_minutes - wd) / 60) * 10) / 10 : 0 };
  }
}
// Programar fecha en bloque: sin repartidor solo cambia la fecha; con repartidor pasan a su ruta de ese día
app.post('/api/orders/bulk-schedule', auth(...STAFF), wrap((req, res) => {
  const b = req.body || {};
  const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : null;
  if (!date) throw new HttpError(400, 'Elige la fecha');
  let ids = (Array.isArray(b.order_ids) ? b.order_ids : []).map(Number).filter(Boolean);
  if (Array.isArray(b.customer_ids) && b.customer_ids.length) {
    const cids = b.customer_ids.map(Number).filter(Boolean).slice(0, 5000);
    ids.push(...db.prepare(`SELECT id FROM orders WHERE customer_id IN (${cids.map(() => '?').join(',')}) AND status IN ('pendiente','asignado','fallido')`).all(...cids).map((r) => r.id));
  }
  ids = officeOrders(req, [...new Set(ids)].slice(0, 3000));
  if (!ids.length) throw new HttpError(400, 'No hay pedidos para programar');
  const rows = db.prepare(`SELECT o.id, o.tracking_code, o.status, o.driver_id, u.name dname FROM orders o LEFT JOIN users u ON u.id = o.driver_id WHERE o.id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  const skipped = [];
  let moved = 0;
  const byDriver = new Map();
  tx(() => {
    for (const o of rows) {
      if (['pendiente', 'fallido'].includes(o.status) && !o.driver_id) {
        db.prepare("UPDATE orders SET scheduled_date=?, status='pendiente' WHERE id=?").run(date, o.id);
        moved++;
      } else if (o.status === 'asignado' && o.driver_id) {
        if (!byDriver.has(o.driver_id)) byDriver.set(o.driver_id, { drv: { id: o.driver_id, name: o.dname }, ids: [] });
        byDriver.get(o.driver_id).ids.push(o.id);
      } else skipped.push({ tracking_code: o.tracking_code, reason: o.status === 'cargado' ? `ya está cargado en la unidad de ${o.dname || 'un repartidor'}` : `está ${o.status}` });
    }
  });
  for (const { drv, ids: dids } of byDriver.values()) {
    const r = assignOrdersTo(req, drv, dids, date);
    moved += r.assigned;
    skipped.push(...r.skipped);
  }
  audit(req, 'pedidos.programar', `${moved} pedido(s) programados para el ${date}`);
  res.json({ moved, skipped, date });
}));
// Cerrar la ruta tal como está (p. ej. el repartidor ya no sigue hoy)
app.post('/api/routes/:id/close', auth(...STAFF), wrap((req, res) => {
  const r = db.prepare('SELECT r.*, u.name dname FROM routes r LEFT JOIN users u ON u.id = r.driver_id WHERE r.id=?').get(req.params.id);
  if (!r) throw new HttpError(404, 'No encontrada');
  officeRoute(req, r);
  if (r.status === 'completada') throw new HttpError(409, 'La ruta ya está cerrada');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.body?.date || '') ? req.body.date : null;
  const reason = String(req.body?.reason || '').trim().slice(0, 200);
  const open = db.prepare("SELECT id, tracking_code, status FROM orders WHERE route_id=? AND status IN ('asignado','cargado')").all(r.id);
  const done = db.prepare("SELECT SUM(status='entregado') d, SUM(status='fallido') f FROM orders WHERE route_id=?").get(r.id);
  const mode = req.body?.mode;
  // pasar lo pendiente a otro repartidor (a su ruta de hoy o de la fecha elegida)
  if (mode === 'driver') {
    const drv = db.prepare("SELECT id, name FROM users WHERE id=? AND active=1 AND (role='repartidor' OR can_deliver=1)").get(Number(req.body.driver_id));
    if (!drv) throw new HttpError(400, 'Elige el repartidor que continúa la ruta');
    officeDriver(req, drv.id);
    if (!open.length) throw new HttpError(400, 'La ruta no tiene paradas pendientes');
    const d = date && date >= today() ? date : today();
    // los ya cargados en la unidad del anterior se pasan también (el paquete se entrega físicamente al nuevo)
    db.prepare(`UPDATE orders SET status='asignado', loaded_at=NULL WHERE id IN (${open.map((o) => o.id).join(',')}) AND status='cargado'`).run();
    const out = assignOrdersTo(req, drv, open.map((o) => o.id), d);
    const rest = db.prepare("SELECT COUNT(*) c FROM orders WHERE route_id=? AND status IN ('asignado','cargado')").get(r.id).c;
    if (!rest) db.prepare("UPDATE routes SET status='completada', finished_at=COALESCE(finished_at, datetime('now')) WHERE id=?").run(r.id);
    audit(req, 'rutas.pasar', `${r.name || 'Ruta ' + r.id}: ${out.assigned} pendiente(s) de ${r.dname || 'repartidor'} → ${drv.name} (${d})${reason ? ' · ' + reason : ''}`);
    return res.json({ delivered: done.d || 0, failed: done.f || 0, returned: 0, moved: out.assigned, to: drv.name, date: d, skipped: out.skipped });
  }
  // cancelar lo pendiente (regresan existencias y se liberan los S/N)
  if (mode === 'cancel') {
    if (req.user.role !== 'admin') throw new HttpError(403, 'Solo el administrador cancela pedidos');
    tx(() => {
      for (const o of open) {
        releaseOrderSerials(o.id, req.user.id, `Pedido ${o.tracking_code} cancelado al cerrar la ruta`);
        db.prepare(`UPDATE orders SET status='cancelado', route_id=NULL, stop_seq=NULL, eta=NULL, leg_km=NULL, loaded_at=NULL, notes=TRIM(COALESCE(notes,'') || ?) WHERE id=?`)
          .run(` | Cancelado al cerrar la ruta ${today()} (${r.dname || 'repartidor'})${reason ? ': ' + reason : ''}`, o.id);
        returnOrderStock(o.id, o.tracking_code, req.user.id);
      }
      db.prepare("UPDATE routes SET status='completada', finished_at=COALESCE(finished_at, datetime('now')), started_at=COALESCE(started_at, datetime('now')) WHERE id=?").run(r.id);
    });
    audit(req, 'rutas.cerrar', `${r.name || 'Ruta ' + r.id}: ${open.length} pendiente(s) CANCELADOS${reason ? ' · ' + reason : ''}`);
    return res.json({ delivered: done.d || 0, failed: done.f || 0, returned: 0, cancelled: open.length });
  }
  tx(() => {
    for (const o of open)
      db.prepare(`UPDATE orders SET status='pendiente', route_id=NULL, driver_id=NULL, stop_seq=NULL, eta=NULL, leg_km=NULL, loaded_at=NULL,
        scheduled_date=COALESCE(?, scheduled_date), notes=TRIM(COALESCE(notes,'') || ?) WHERE id=?`)
        .run(date, ` | Ruta cerrada ${today()} (${r.dname || 'repartidor'})${reason ? ': ' + reason : ''}`, o.id);
    db.prepare("UPDATE routes SET status='completada', finished_at=COALESCE(finished_at, datetime('now')), started_at=COALESCE(started_at, datetime('now')) WHERE id=?").run(r.id);
  });
  audit(req, 'rutas.cerrar', `${r.name || 'Ruta ' + r.id}: ${done.d || 0} entregados, ${done.f || 0} no entregados; ${open.length} pendientes regresan${date ? ' para el ' + date : ''}${reason ? ' · ' + reason : ''}`);
  res.json({ delivered: done.d || 0, failed: done.f || 0, returned: open.length, loaded: open.filter((o) => o.status === 'cargado').length, date });
}));
// Cambiar la fecha de una ruta completa (aún sin entregas): sus pedidos pasan a la ruta de ese día del mismo repartidor
app.post('/api/routes/:id/date', auth(...STAFF), wrap((req, res) => {
  const r = db.prepare('SELECT r.*, u.name dname FROM routes r LEFT JOIN users u ON u.id = r.driver_id WHERE r.id=?').get(req.params.id);
  if (!r) throw new HttpError(404, 'No encontrada');
  officeRoute(req, r);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.body?.date || '') ? req.body.date : null;
  if (!date) throw new HttpError(400, 'Elige la fecha');
  if (date === r.date) throw new HttpError(400, 'La ruta ya es de esa fecha');
  const st = db.prepare('SELECT status, COUNT(*) n FROM orders WHERE route_id=? GROUP BY status').all(r.id);
  const n = (k) => st.find((x) => x.status === k)?.n || 0;
  if (n('entregado') || n('fallido')) throw new HttpError(409, 'La ruta ya tiene entregas registradas: mueve solo los pedidos pendientes desde Pedidos');
  if (n('cargado')) throw new HttpError(409, `${n('cargado')} pedido(s) ya están cargados en la unidad: regrésalos primero`);
  const ids = db.prepare("SELECT id FROM orders WHERE route_id=? AND status='asignado'").all(r.id).map((x) => x.id);
  if (!ids.length) throw new HttpError(400, 'La ruta no tiene pedidos');
  const out = assignOrdersTo(req, { id: r.driver_id, name: r.dname }, ids, date);
  audit(req, 'rutas.fecha', `${r.name || 'Ruta ' + r.id}: ${r.date} → ${date} (${out.assigned} pedidos)`);
  res.json(out);
}));
// Mover lo NO entregado de una ruta a otro día (mismo repartidor): pendientes y en vehículo y/o los no entregados
app.post('/api/routes/:id/move-open', auth(...STAFF), wrap((req, res) => {
  const r = db.prepare('SELECT r.*, u.name dname FROM routes r LEFT JOIN users u ON u.id = r.driver_id WHERE r.id=?').get(req.params.id);
  if (!r) throw new HttpError(404, 'No encontrada');
  officeRoute(req, r);
  if (!r.driver_id) throw new HttpError(409, 'La ruta no tiene repartidor');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.body?.date || '') ? req.body.date : null;
  if (!date) throw new HttpError(400, 'Elige la fecha');
  if (date < today()) throw new HttpError(400, 'Elige hoy o una fecha futura');
  const sts = [...(req.body?.include_open === false ? [] : ['asignado', 'cargado']), ...(req.body?.include_failed ? ['fallido'] : [])];
  if (!sts.length) throw new HttpError(400, 'Elige qué mover');
  const ids = db.prepare(`SELECT id FROM orders WHERE route_id=? AND status IN (${sts.map(() => '?').join(',')})`).all(r.id, ...sts).map((x) => x.id);
  if (!ids.length) throw new HttpError(400, 'La ruta no tiene pedidos sin entregar');
  const out = assignOrdersTo(req, { id: r.driver_id, name: r.dname }, ids, date, { allowLoaded: true });
  audit(req, 'rutas.mover_pendientes', `${r.name || 'Ruta ' + r.id}: ${out.assigned} pedido(s) sin entregar → ${date}`);
  res.json(out);
}));
// Pedidos cuya fecha ya pasó sin entregarse: se sueltan de su ruta y repartidor.
// Los no entregados conservan su estado (y su intento registrado); los que ni se intentaron vuelven a pendiente.
function releaseOverdue() {
  try {
    const t = today();
    // cuenta la fecha de su RUTA (no la fecha original del pedido): lo que está en una ruta de hoy o futura no se toca
    const rows = db.prepare(`SELECT o.id, o.status, o.driver_id, COALESCE(r.date, o.scheduled_date) scheduled_date FROM orders o LEFT JOIN routes r ON r.id = o.route_id
      WHERE COALESCE(r.date, o.scheduled_date) < ?
      AND (o.status IN ('asignado','cargado') OR (o.status='fallido' AND (o.route_id IS NOT NULL OR o.driver_id IS NOT NULL)))`).all(t);
    const routes = db.prepare("SELECT COUNT(*) n FROM routes WHERE date < ? AND status IN ('planificada','en_curso')").get(t).n;
    if (!rows.length && !routes) return;
    // sin entregar (ni intentados) con repartidor activo: pasan a la ruta de HOY del mismo repartidor
    const active = (id) => id && db.prepare("SELECT 1 FROM users WHERE id=? AND active=1 AND deleted_at IS NULL AND COALESCE(route_mode,'continua') <> 'dia'").get(id);
    const carry = new Map();
    for (const o of rows) if (o.status !== 'fallido' && active(o.driver_id)) { if (!carry.has(o.driver_id)) carry.set(o.driver_id, []); carry.get(o.driver_id).push(o); }
    const free = rows.filter((o) => !(o.status !== 'fallido' && active(o.driver_id)));
    const s = getSettings();
    let carried = 0;
    for (const [did, list] of carry) {
      try {
        tx(() => {
          const drv = db.prepare('SELECT name FROM users WHERE id=?').get(did);
          const r = db.prepare("SELECT * FROM routes WHERE driver_id=? AND date=? AND status IN ('planificada','en_curso') ORDER BY id DESC LIMIT 1").get(did, t);
          const keep = r ? db.prepare("SELECT id FROM orders WHERE route_id=? AND status IN ('asignado','cargado')").all(r.id).map((x) => x.id) : [];
          const addNote = db.prepare("UPDATE orders SET notes=TRIM(COALESCE(notes,'') || CASE WHEN COALESCE(notes,'')='' THEN '' ELSE ' | ' END || ?) WHERE id=?");
          for (const o of list) addNote.run(`Sin entregar el ${o.scheduled_date}: sigue con ${drv?.name || 'su repartidor'} el ${t}`, o.id);
          persistRoute({ routeId: r?.id, name: `Ruta ${drv?.name || ''} ${t}`.trim(), driverId: did, date: t, depot: r ? { lat: r.depot_lat, lng: r.depot_lng } : depotOf(s, {}, did), orderIds: [...keep, ...list.map((o) => o.id)], settings: s });
        });
        carried += list.length;
      } catch (e) { console.error('releaseOverdue carry', e.message); free.push(...list); }
    }
    tx(() => {
      for (const o of free) {
        db.prepare(`UPDATE orders SET status=?, route_id=NULL, driver_id=NULL, stop_seq=NULL, eta=NULL, leg_km=NULL, loaded_at=NULL,
          notes=TRIM(COALESCE(notes,'') || CASE WHEN COALESCE(notes,'')='' THEN '' ELSE ' | ' END || ?) WHERE id=?`)
          .run(o.status === 'fallido' ? 'fallido' : 'pendiente', `${o.status === 'fallido' ? 'No entregado' : 'Sin entregar'} el ${o.scheduled_date}: liberado para reasignar`, o.id);
      }
      db.prepare("UPDATE routes SET status='completada', finished_at=COALESCE(finished_at, datetime('now')) WHERE date < ? AND status IN ('planificada','en_curso')").run(t);
    });
    if (free.length) db.prepare('INSERT INTO audit_log (user_id, action, detail) VALUES (NULL, ?, ?)').run('pedidos.liberar', `${free.length} pedido(s) no exitosos en su fecha quedaron libres para reasignar`);
    if (carried) db.prepare('INSERT INTO audit_log (user_id, action, detail) VALUES (NULL, ?, ?)').run('pedidos.siguen', `${carried} pedido(s) sin entregar siguen con su repartidor en la ruta del ${t}`);
  } catch (e) { console.error('releaseOverdue', e.message); }
}
// Programar varios pedidos en un rango de días para un repartidor: se reparten por cercanía, N por día
app.post(
  '/api/routes/assign-range',
  auth(...STAFF),
  wrap((req, res) => {
    const b = req.body || {};
    officeDriver(req, b.driver_id);
    selfDriver(req, b.driver_id);
    const drv = db.prepare("SELECT id, name, active, capacity FROM users WHERE id=? AND (role='repartidor' OR can_deliver=1)").get(Number(b.driver_id));
    if (!drv) throw new HttpError(400, 'Elige el repartidor');
    if (!drv.active) throw new HttpError(409, `${drv.name} está desactivado`);
    const okD = (x) => /^\d{4}-\d{2}-\d{2}$/.test(x || '');
    if (!okD(b.date_from) || !okD(b.date_to)) throw new HttpError(400, 'Elige el rango de fechas');
    const [d1, d2] = [b.date_from, b.date_to].sort();
    const days = [];
    for (let d = new Date(d1 + 'T12:00:00'); d.toLocaleDateString('en-CA') <= d2 && days.length < 62; d.setDate(d.getDate() + 1)) {
      if (b.skip_sunday && d.getDay() === 0) continue;
      if (b.skip_saturday && d.getDay() === 6) continue;
      days.push(d.toLocaleDateString('en-CA'));
    }
    if (!days.length) throw new HttpError(400, 'El rango no tiene días hábiles');
    let ids = (Array.isArray(b.order_ids) ? b.order_ids : []).map(Number).filter(Boolean);
    if (Array.isArray(b.customer_ids) && b.customer_ids.length) {
      const cids = b.customer_ids.map(Number).filter(Boolean).slice(0, 5000);
      ids.push(...db.prepare(`SELECT id FROM orders WHERE customer_id IN (${cids.map(() => '?').join(',')}) AND status IN ('pendiente','asignado')`).all(...cids).map((r) => r.id));
    }
    ids = officeOrders(req, [...new Set(ids)].slice(0, 3000));
    const list = ids.length ? db.prepare(`SELECT o.id, o.status, c.lat, c.lng FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.id IN (${ids.map(() => '?').join(',')}) AND o.status IN ('pendiente','asignado')`).all(...ids) : [];
    if (!list.length) throw new HttpError(400, 'No hay pedidos abiertos para programar en la selección');
    const perDay = Math.max(1, Math.trunc(Number(b.per_day)) || Math.ceil(list.length / days.length));
    // orden por cercanía (vecino más cercano desde la oficina): cada día queda en una zona compacta
    const dep = depotOf(getSettings(), {}, drv.id);
    const geo = list.filter((o) => o.lat != null), noGeo = list.filter((o) => o.lat == null);
    const ordered = [];
    let cur = { lat: dep.lat, lng: dep.lng };
    while (geo.length) {
      let bi = 0, bd = Infinity;
      for (let i = 0; i < geo.length; i++) { const dd = (geo[i].lat - cur.lat) ** 2 + (geo[i].lng - cur.lng) ** 2; if (dd < bd) { bd = dd; bi = i; } }
      cur = geo.splice(bi, 1)[0]; ordered.push(cur);
    }
    ordered.push(...noGeo);
    const plan = [];
    const skipped = [];
    let k = 0;
    for (const day of days) {
      const chunk = ordered.slice(k, k + perDay); k += chunk.length;
      if (!chunk.length) break;
      const r = assignOrdersTo(req, drv, chunk.map((o) => o.id), day);
      plan.push({ date: day, assigned: r.assigned, unlocated: r.unlocated || 0 });
      skipped.push(...r.skipped);
    }
    const left = ordered.length - k;
    res.json({ driver: drv.name, per_day: perDay, days: plan, assigned: plan.reduce((a, x) => a + x.assigned, 0), not_scheduled: left, skipped });
  })
);
// Planificación automática: reparte todos los pendientes del día entre los repartidores elegidos
app.post(
  '/api/routes/auto',
  auth(...STAFF),
  wrap((req, res) => {
    const s = getSettings();
    const date = req.body.date || today();
    // el personal de una oficina planifica solo su oficina, saliendo de ella
    const depot = depotOf(s, req.user.office && !req.body.warehouse_id ? { ...req.body, warehouse_id: req.user.office } : req.body);
    let driverIds = (req.body.driver_ids || []).map(Number);
    const offDrivers = db.prepare(`SELECT u.id FROM users u WHERE (u.role='repartidor' OR u.can_deliver=1) AND u.active=1 ${inOffice(req, 'u')}`).all().map((r) => r.id);
    if (!driverIds.length) driverIds = offDrivers;
    else if (req.user.office) driverIds = driverIds.filter((id) => offDrivers.includes(id));
    void depot;
    const drivers = driverIds.map((id) => db.prepare("SELECT id, name, capacity, active FROM users WHERE id=? AND active=1").get(id)).filter(Boolean);
    const only = Array.isArray(req.body.order_ids) ? req.body.order_ids.map(Number).filter(Boolean).slice(0, 5000) : null;
    const pend = db
      .prepare(
        `SELECT o.id, o.priority, c.lat, c.lng, c.city customer_city, ${OFFICE_OF('c')} off FROM orders o JOIN customers c ON c.id=o.customer_id
         WHERE ${only ? `o.id IN (${only.join(',') || 0}) AND o.status IN ('pendiente','fallido','asignado')` : "o.status='pendiente' AND o.route_id IS NULL AND o.scheduled_date <= ?"} AND ${FOLLOW_OPEN} ${inOffice(req, 'c')}`
      )
      .all(...(only ? [] : [date]));
    if (!pend.length) throw new HttpError(400, 'No hay pedidos pendientes por rutear');
    // Misma lógica que en Pedidos: cada oficina con sus repartidores; los pedidos en orden de ciudad y cercanía
    // desde la oficina, en tramos seguidos (una zona compacta por repartidor, según su capacidad);
    // se agregan a la ruta del día de cada uno y la ruta se optimiza (camino más corto).
    const byOff = new Map();
    for (const o of pend) { if (!byOff.has(o.off)) byOff.set(o.off, []); byOff.get(o.off).push(o); }
    const created = [];
    const overflow = [];
    for (const [off, list] of byOff) {
      // al repartir una selección se respetan los repartidores elegidos aunque sean de otra oficina
      const team = only ? drivers : drivers.filter((d) => userOffice(d.id) === off);
      const located = list.filter((o) => o.lat != null);
      overflow.push(...list.filter((o) => o.lat == null));
      if (!team.length) { overflow.push(...located); continue; }
      // cupo de cada uno: lo que le queda de capacidad hoy, repartido en proporción para que todos lleven carga parecida
      const cap = (d) => Math.max(0, (Number(d.capacity) || 30) - (db.prepare("SELECT COUNT(*) n FROM orders o JOIN routes r ON r.id=o.route_id WHERE r.driver_id=? AND r.date=? AND o.status IN ('asignado','cargado')").get(d.id, date).n));
      const caps0 = team.map(cap);
      const capSum = caps0.reduce((a, c) => a + c, 0);
      const caps = caps0.map((c) => (capSum ? Math.min(c, Math.ceil((located.length * c) / capSum)) : 0));
      const zones = balancedZones(located, caps);
      const placed = new Set(zones.flat().map((o) => o.id));
      let k = 0;
      for (const [zi, d] of team.entries()) {
        const chunk = zones[zi] || [];
        k += chunk.length;
        if (!chunk.length) continue;
        const r = assignOrdersTo(req, d, chunk.map((o) => o.id), date);
        if (!r.route_id) continue;
        const rt = db.prepare('SELECT distance_km, original_distance_km, est_minutes FROM routes WHERE id=?').get(r.route_id);
        created.push({ driver: d.name, route_id: r.route_id, stops: r.assigned, ...rt });
      }
      overflow.push(...located.filter((o) => !placed.has(o.id)));
      void k;
    }
    res.status(201).json({ created, overflow: overflow.map((o) => o.id) });
  })
);
app.post(
  '/api/routes/:id/optimize',
  auth(),
  wrap(async (req, res) => {
    const r = db.prepare('SELECT * FROM routes WHERE id=?').get(req.params.id);
    if (!r) throw new HttpError(404, 'No encontrada');
    if (req.user.role === 'repartidor' && r.driver_id !== req.user.id) throw new HttpError(403, 'Sin permiso');
    officeRoute(req, r);
    const s = getSettings();
    // Re-optimiza las paradas pendientes desde la posición actual (si viene) o desde el almacén
    const pending = db.prepare("SELECT id FROM orders WHERE route_id=? AND status IN ('asignado','cargado')").all(r.id).map((x) => x.id);
    const done = db.prepare("SELECT COUNT(*) c FROM orders WHERE route_id=? AND status IN ('entregado','fallido')").get(r.id).c;
    const from = req.body.lat != null ? { lat: Number(req.body.lat), lng: Number(req.body.lng) } : { lat: r.depot_lat, lng: r.depot_lng };
    const now = new Date();
    const startTime = done ? `${now.getHours()}:${now.getMinutes()}` : undefined;
    const stops = stopsFor(pending);
    if (gmaps.enabled()) await gmaps.fillMatrix(matrixPoints(from, stops)).catch(() => false);
    const opt = optimizeRoute(from, stops, s, { startTime, matrix: googleMatrix(from, stops) || (await osrm.table(matrixPoints(from, stops))) });
    tx(() => {
      const upd = db.prepare('UPDATE orders SET stop_seq=?, eta=?, leg_km=? WHERE id=?');
      for (const st of opt.sequence) upd.run(done + st.seq, st.eta, st.leg_km, st.id);
      if (!done) db.prepare('UPDATE routes SET distance_km=?, est_minutes=? WHERE id=?').run(opt.distance_km, opt.est_minutes, r.id);
    });
    res.json(opt);
  })
);
app.put(
  '/api/routes/:id',
  auth(...STAFF),
  wrap((req, res) => {
    const r = db.prepare('SELECT * FROM routes WHERE id=?').get(req.params.id);
    if (!r) throw new HttpError(404, 'No encontrada');
    officeRoute(req, r);
    const { driver_id, remove_order_ids = [] } = req.body;
    if (driver_id) officeDriver(req, driver_id);
    const add_order_ids = officeOrders(req, (req.body.add_order_ids || []).map(Number));
    if (driver_id && driver_id !== r.driver_id) {
      db.prepare('UPDATE routes SET driver_id=? WHERE id=?').run(driver_id, r.id);
      db.prepare('UPDATE orders SET driver_id=? WHERE route_id=?').run(driver_id, r.id);
    }
    if (remove_order_ids.length) {
      // quitar de la ruta: liberar (pendiente sin repartidor), reprogramar a otra fecha o cancelar (solo administrador)
      const mode = ['liberar', 'fecha', 'cancelar'].includes(req.body.remove_mode) ? req.body.remove_mode : 'liberar';
      const rdate = /^\d{4}-\d{2}-\d{2}$/.test(req.body.remove_date || '') ? req.body.remove_date : null;
      if (mode === 'fecha' && !rdate) throw new HttpError(400, 'Elige la nueva fecha');
      if (mode === 'cancelar' && req.user.role !== 'admin') throw new HttpError(403, 'Solo el administrador cancela pedidos');
      const why = String(req.body.reason || '').trim().slice(0, 200);
      const dn = db.prepare('SELECT name FROM users WHERE id=?').get(r.driver_id)?.name || 'repartidor';
      const note = ` | Quitado de la ruta de ${dn} (${today()}, ${req.user.name})${mode === 'fecha' ? ' → ' + rdate : mode === 'cancelar' ? ': cancelado' : ''}${why ? ': ' + why : ''}`;
      const done = [];
      tx(() => {
        for (const id of remove_order_ids.map(Number)) {
          const o = db.prepare("SELECT id, tracking_code FROM orders WHERE id=? AND route_id=? AND status IN ('asignado','cargado')").get(id, r.id);
          if (!o) continue;
          if (mode === 'cancelar') releaseOrderSerials(o.id, req.user.id, `Pedido ${o.tracking_code} cancelado al quitarlo de la ruta`);
          db.prepare(`UPDATE orders SET route_id=NULL, stop_seq=NULL, eta=NULL, leg_km=NULL, driver_id=NULL, loaded_at=NULL, status=?, scheduled_date=COALESCE(?, scheduled_date),
            notes=TRIM(COALESCE(notes,'') || ?) WHERE id=?`).run(mode === 'cancelar' ? 'cancelado' : 'pendiente', rdate, note, o.id);
          if (mode === 'cancelar') returnOrderStock(o.id, o.tracking_code, req.user.id);
          done.push(o.tracking_code);
        }
      });
      if (done.length) audit(req, 'rutas.quitar', `${r.name || 'Ruta ' + r.id}: ${done.length} quitado(s) (${mode === 'fecha' ? 'reprogramados al ' + rdate : mode === 'cancelar' ? 'cancelados' : 'liberados'}): ${done.slice(0, 10).join(', ')}${done.length > 10 ? '…' : ''}`);
    }
    const s = getSettings();
    const keep = db.prepare("SELECT id FROM orders WHERE route_id=? AND status IN ('asignado','cargado','pendiente')").all(r.id).map((x) => x.id);
    const all = [...new Set([...keep, ...add_order_ids.map(Number)])];
    const out = persistRoute({ routeId: r.id, driverId: driver_id || r.driver_id, date: r.date, depot: { lat: r.depot_lat, lng: r.depot_lng }, orderIds: all, settings: s });
    res.json(out);
  })
);
app.delete(
  '/api/routes/:id',
  auth(...STAFF),
  wrap((req, res) => {
    const r = db.prepare('SELECT * FROM routes WHERE id=?').get(req.params.id);
    if (!r) throw new HttpError(404, 'No encontrada');
    officeRoute(req, r);
    const doneCnt = db.prepare("SELECT COUNT(*) c FROM orders WHERE route_id=? AND status IN ('entregado','fallido')").get(r.id).c;
    if (doneCnt) throw new HttpError(409, 'La ruta ya tiene entregas registradas');
    const n = db.prepare('SELECT COUNT(*) c FROM orders WHERE route_id=?').get(r.id).c;
    tx(() => {
      db.prepare("UPDATE orders SET route_id=NULL, stop_seq=NULL, eta=NULL, driver_id=NULL, status='pendiente' WHERE route_id=?").run(r.id);
      db.prepare('DELETE FROM routes WHERE id=?').run(r.id);
    });
    audit(req, 'rutas.eliminar', `${r.name || 'Ruta ' + r.id} eliminada: ${n} pedido(s) vuelven a pendiente`);
    res.json({ ok: true });
  })
);

// Reporte de rutas y estatus por periodo (fecha local): visitas registradas y paradas sin visitar; JSON o CSV para Excel
app.get('/api/reports/routes', auth(...STAFF), wrap((req, res) => {
  const iso = (x) => (/^\d{4}-\d{2}-\d{2}$/.test(x || '') ? x : null);
  const from = iso(req.query.from) || today();
  const to = iso(req.query.to) || from;
  if (to < from) throw new HttpError(400, 'La fecha final es anterior a la inicial');
  const drv = req.query.driver_id ? Number(req.query.driver_id) : null;
  const [uf, ut] = utcRange(from, to);
  const localDT = (u) => (u ? new Date(String(u).replace(' ', 'T') + 'Z') : null);
  const ymd = (d) => (d ? d.toLocaleDateString('en-CA') : '');
  const hm = (d) => (d ? d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false }) : '');
  const routeOf = db.prepare('SELECT id, name, date FROM routes WHERE driver_id = ? AND date = ? ORDER BY id DESC LIMIT 1');
  const SEL = `o.id oid, o.tracking_code, o.status, o.attempts, o.stop_seq, c.name customer, c.external_id telnor, c.phone, c.address, c.colonia, c.city, c.zip,
    (SELECT GROUP_CONCAT(s.serial, ' ') FROM serials s WHERE s.order_id = o.id) serials`;
  const visits = db.prepare(`SELECT ${SEL}, e.id eid, e.created_at at, e.result, e.kind, e.reason, e.notes, e.receiver_name, e.receiver_relation, e.distance_to_customer_m dist,
      e.driver_id, u.name driver
    FROM evidences e JOIN orders o ON o.id = e.order_id JOIN customers c ON c.id = o.customer_id LEFT JOIN users u ON u.id = e.driver_id
    WHERE e.created_at >= ? AND e.created_at < ? ${drv ? 'AND e.driver_id = ?' : ''} ${inOffice(req, 'c')}
    ORDER BY e.driver_id, e.created_at`).all(uf, ut, ...(drv ? [drv] : []));
  const open = db.prepare(`SELECT ${SEL}, r.id rid, r.name rname, r.date rdate, r.driver_id, u.name driver
    FROM orders o JOIN routes r ON r.id = o.route_id JOIN customers c ON c.id = o.customer_id LEFT JOIN users u ON u.id = r.driver_id
    WHERE r.date BETWEEN ? AND ? AND o.status IN ('pendiente','asignado','cargado') ${drv ? 'AND r.driver_id = ?' : ''} ${inOffice(req, 'c')}
    ORDER BY r.date, r.driver_id, o.stop_seq`).all(from, to, ...(drv ? [drv] : []));
  const ST = { pendiente: 'Pendiente', asignado: 'Asignado', cargado: 'Cargado', entregado: 'Entregado', fallido: 'No entregado', cancelado: 'Cancelado' };
  const KIND = { ruta: 'En ruta', manual: 'Registro manual', mostrador: 'Mostrador' };
  const rows = [];
  for (const v of visits) {
    const d = localDT(v.at);
    const r = v.driver_id ? routeOf.get(v.driver_id, ymd(d)) : null;
    rows.push({ date: ymd(d), time: hm(d), route: r ? r.name || 'Ruta ' + r.id : '', driver: v.driver || '', stop: v.stop_seq ?? '', tracking_code: v.tracking_code,
      customer: v.customer, telnor: v.telnor || '', phone: v.phone || '', address: [v.address, v.colonia].filter(Boolean).join(', '), city: v.city ? canonCity(v.city) : '', zip: v.zip || '',
      visit: v.result === 'entregado' ? 'Entregado' : 'No entregado', recorded: KIND[v.kind] || v.kind || '', reason: v.reason || '', notes: v.notes || '',
      receiver: [v.receiver_name, v.receiver_relation ? '(' + v.receiver_relation + ')' : ''].filter(Boolean).join(' '), dist: v.dist ?? '',
      serials: v.serials || '', status: ST[v.status] || v.status, attempts: v.attempts || 0, oid: v.oid, st: v.status });
  }
  for (const o of open) rows.push({ date: o.rdate, time: '', route: o.rname || 'Ruta ' + o.rid, driver: o.driver || '', stop: o.stop_seq ?? '', tracking_code: o.tracking_code,
    customer: o.customer, telnor: o.telnor || '', phone: o.phone || '', address: [o.address, o.colonia].filter(Boolean).join(', '), city: o.city ? canonCity(o.city) : '', zip: o.zip || '',
    visit: 'Sin visita', recorded: '', reason: '', notes: '', receiver: '', dist: '', serials: o.serials || '', status: ST[o.status] || o.status, attempts: o.attempts || 0, oid: o.oid, st: o.status });
  rows.sort((a, b) => (a.date + a.driver + (a.time || '99')).localeCompare(b.date + b.driver + (b.time || '99')));
  const byDriver = {};
  for (const r of rows) {
    const k = r.driver || 'Sin repartidor';
    const x = (byDriver[k] ||= { driver: k, entregados: 0, no_entregados: 0, sin_visita: 0, manual: 0 });
    if (r.visit === 'Entregado') x.entregados++; else if (r.visit === 'No entregado') x.no_entregados++; else x.sin_visita++;
    if (r.recorded === 'Registro manual') x.manual++;
  }
  const summary = Object.values(byDriver).sort((a, b) => b.entregados - a.entregados);
  // filtro por estatus: el resumen por repartidor se queda completo; el detalle y el Excel solo llevan lo filtrado
  const FILT = { entregado: (r) => r.visit === 'Entregado', fallido: (r) => r.visit === 'No entregado', sin_visita: (r) => r.visit === 'Sin visita',
    sin_telmex: (r) => r.visit === 'Entregado' && r.status === 'Entregado' && (!r.serials || r.serials.split(' ').some((x) => !/^HWTC[0-9A-F]{8}$/.test(x))),
    manual: (r) => r.recorded === 'Registro manual', mostrador: (r) => r.recorded === 'Mostrador',
    hoy_entregado: (r) => r.status === 'Entregado', hoy_fallido: (r) => r.status === 'No entregado', hoy_abierto: (r) => ['Pendiente', 'Asignado', 'Cargado'].includes(r.status) };
  const sts = String(req.query.status || '').split(',').filter((k) => FILT[k]);
  const st = sts.join('-');
  if (sts.length) { const keep = rows.filter((r) => sts.some((k) => FILT[k](r))); rows.length = 0; rows.push(...keep); }
  if (req.query.format === 'csv') {
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['Fecha', 'Hora', 'Ruta', 'Repartidor', 'Parada', 'Guía', 'Cliente', 'Teléfono Telnor', 'Teléfono', 'Dirección', 'Ciudad', 'C.P.', 'Resultado de la visita', 'Registrado', 'Motivo', 'Notas', 'Recibió', 'Distancia al domicilio (m)', 'S/N', 'Estatus actual del pedido', 'Intentos'];
    const keys = ['date', 'time', 'route', 'driver', 'stop', 'tracking_code', 'customer', 'telnor', 'phone', 'address', 'city', 'zip', 'visit', 'recorded', 'reason', 'notes', 'receiver', 'dist', 'serials', 'status', 'attempts'];
    const lines = rows.map((r) => keys.map((k) => q(r[k])).join(','));
    lines.push('', [q('Resumen por repartidor'), q('Entregados'), q('No entregados'), q('Sin visita'), q('Registros manuales')].join(','));
    for (const s of summary) lines.push([q(s.driver), s.entregados, s.no_entregados, s.sin_visita, s.manual].join(','));
    const who = drv ? '-' + (db.prepare('SELECT name FROM users WHERE id = ?').get(drv)?.name || String(drv)).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '_') : '';
    res.setHeader('Content-Disposition', `attachment; filename="rutas-${from}-a-${to}${who}${st ? '-' + st : ''}.csv"`);
    return res.type('text/csv; charset=utf-8').send('\uFEFF' + head.map(q).join(',') + '\n' + lines.join('\n'));
  }
  res.json({ from, to, summary, rows: rows.slice(0, 2000), total: rows.length });
}));

// Organización de cada persona: ciudad (la principal de su oficina), oficina y célula operativa (su coordinador, o la suya si coordina)
app.get('/api/org', auth(...STAFF), wrap((req, res) => {
  const where = ['u.deleted_at IS NULL'];
  if (req.user.office && !req.user.team?.length) where.push(`${OFFICE_OF('u')} = ${Number(req.user.office)}`);
  if (req.user.team?.length) where.push(`u.id IN (${[...req.user.team, req.user.id].map(Number).join(',')})`);
  const rows = db.prepare(`SELECT u.id, u.name, u.reports_to, w.name office, w.city office_cities,
      (SELECT COUNT(*) FROM users t WHERE t.reports_to = u.id AND t.deleted_at IS NULL) team
    FROM users u LEFT JOIN warehouses w ON w.id = ${OFFICE_OF('u')} WHERE ${where.join(' AND ')}`).all();
  const names = new Map(db.prepare('SELECT id, name FROM users').all().map((u) => [u.id, u.name]));
  res.json(rows.map((u) => {
    const city = canonCity(String(u.office_cities || '').split(',')[0].trim()) || u.office || 'Sin ciudad';
    const cell = u.reports_to || (u.team ? u.id : null);
    return { id: u.id, office: u.office || '', city, cell_id: cell || 0, cell_name: cell ? names.get(cell) || '' : '', leads: u.team || 0 };
  }));
}));
// ---------- App del repartidor ----------
app.get(
  '/api/my/route',
  auth('repartidor'),
  wrap((req, res) => {
    const date = req.query.date || today();
    const r = db
      .prepare("SELECT id FROM routes WHERE driver_id=? AND date=? ORDER BY CASE status WHEN 'en_curso' THEN 0 WHEN 'planificada' THEN 1 ELSE 2 END, id DESC LIMIT 1")
      .get(req.user.id, date);
    if (!r) return res.json(null);
    const route = db.prepare('SELECT * FROM routes WHERE id=?').get(r.id);
    route.stops = db.prepare(`${ORDER_SELECT} WHERE o.route_id=? ORDER BY o.stop_seq`).all(r.id);
    res.json(route);
  })
);
// Fechas con ruta asignada al repartidor (de 7 días atrás en adelante) para elegir el día en Mi ruta
app.get(
  '/api/my/route/dates',
  auth('repartidor'),
  wrap((req, res) => {
    const from = new Date(new Date(today() + 'T12:00:00Z').getTime() - 7 * 864e5).toISOString().slice(0, 10);
    res.json(db.prepare(`SELECT r.date, COUNT(o.id) stops, SUM(o.status IN ('asignado','cargado')) open FROM routes r LEFT JOIN orders o ON o.route_id = r.id
      WHERE r.driver_id = ? AND r.date >= ? GROUP BY r.date HAVING COUNT(o.id) > 0 ORDER BY r.date LIMIT 40`).all(req.user.id, from));
  })
);
app.post(
  '/api/my/route/start',
  auth('repartidor'),
  wrap((req, res) => {
    const r = db.prepare("SELECT * FROM routes WHERE driver_id=? AND date=? AND status IN ('planificada','en_curso') ORDER BY CASE status WHEN 'en_curso' THEN 0 ELSE 1 END, id DESC LIMIT 1").get(req.user.id, today());
    if (!r) throw new HttpError(404, 'No tienes ruta para hoy');
    if (getSettings().require_vehicle_check === '1' && !todayCheck(req.user.id)) {
      const e = new HttpError(409, 'Antes de iniciar, llena el checklist de tu unidad (menú Mi ruta → Checklist de unidad)');
      e.data = { code: 'check_required' };
      throw e;
    }
    const s = getSettings();
    const open = db.prepare("SELECT id, eta, leg_km FROM orders WHERE route_id=? AND status IN ('asignado','cargado') ORDER BY stop_seq").all(r.id);
    if (!open.length) throw new HttpError(409, 'Tu ruta no tiene paradas pendientes');
    const speed = Number(s.avg_speed_kmh) || 22;
    tx(() => {
      db.prepare("UPDATE routes SET status='en_curso', started_at=COALESCE(started_at, datetime('now')) WHERE id=?").run(r.id);
      // la hora estimada de llegada se recorre a la hora real de salida (si cambió más de 10 min)
      const toMin = (t) => (/^\d{1,2}:\d{2}$/.test(t || '') ? Number(t.split(':')[0]) * 60 + Number(t.split(':')[1]) : null);
      const first = open[0];
      const e1 = toMin(first.eta);
      if (e1 != null) {
        const now = new Date(); const nowMin = now.getHours() * 60 + now.getMinutes();
        const plannedStart = e1 - Math.round(((first.leg_km || 2) / speed) * 60);
        const delta = nowMin - plannedStart;
        if (Math.abs(delta) > 10) {
          const up = db.prepare('UPDATE orders SET eta=? WHERE id=?');
          for (const o of open) { const m = toMin(o.eta); if (m == null) continue; const t = Math.max(0, Math.min(23 * 60 + 59, m + delta)); up.run(`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`, o.id); }
        }
      }
    });
    // avisos (según la matriz de Notificaciones y solo al móvil del cliente); sin repetir "en camino"
    let avisados = 0;
    for (const o of open) {
      if (db.prepare("SELECT 1 FROM messages WHERE order_id=? AND event='en_camino' LIMIT 1").get(o.id)) continue;
      if (notify.queueEvent('en_camino', o.id)) avisados++;
    }
    const f = open[0];
    const mins = Math.max(5, Math.round(((f.leg_km || 2) / speed) * 60 + 2));
    const cerca = notify.queueEvent('proximo', f.id, { minutos: mins }) ? 1 : 0;
    audit(req, 'ruta.iniciar', `Ruta ${r.id}: ${open.length} paradas, ${avisados} clientes avisados`);
    res.json({ ok: true, stops: open.length, notified: avisados, first_notified: cerca });
  })
);
app.post(
  '/api/my/location',
  auth('repartidor'),
  wrap((req, res) => {
    const lat = Number(req.body.lat);
    const lng = Number(req.body.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new HttpError(400, 'Coordenadas inválidas');
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new HttpError(400, 'Coordenadas inválidas');
    const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);
    db.prepare("UPDATE users SET last_lat=?, last_lng=?, last_seen=datetime('now') WHERE id=?").run(lat, lng, req.user.id);
    db.prepare('INSERT INTO driver_locations (driver_id, lat, lng, accuracy, speed, heading) VALUES (?,?,?,?,?,?)').run(
      req.user.id, lat, lng, num(req.body.accuracy), num(req.body.speed), num(req.body.heading)
    );
    res.json({ ok: true });
  })
);
app.get(
  '/api/tracking/drivers',
  auth(...STAFF),
  wrap((req, res) => {
    const rows = db
      .prepare(
        `SELECT u.id, u.name, u.vehicle, u.last_lat, u.last_lng, u.last_seen,
          (SELECT COUNT(*) FROM orders o WHERE o.driver_id=u.id AND o.scheduled_date=? AND o.status IN ('asignado','cargado')) pending,
          (SELECT COUNT(*) FROM orders o WHERE o.driver_id=u.id AND o.scheduled_date=? AND o.status='entregado') delivered
         FROM users u WHERE (u.role='repartidor' OR u.can_deliver=1) AND u.active=1 ${Number(req.query.driver_id) ? `AND u.id = ${Number(req.query.driver_id)}` : ''} ${inOffice({ user: { office: req.user.office || Number(req.query.office_id) || null } }, 'u')} ORDER BY u.name`
      )
      .all(today(), today());
    res.json(rows);
  })
);

// Recorrido GPS del día de un repartidor (para el mapa en vivo)
app.get(
  '/api/tracking/trail/:driverId',
  auth(...STAFF),
  wrap((req, res) => {
    const date = req.query.date || today();
    const id = Number(req.params.driverId);
    const pts = db
      .prepare(
        `SELECT lat, lng, accuracy, speed, created_at FROM driver_locations
         WHERE driver_id=? AND date(created_at, 'localtime')=? ORDER BY id`
      )
      .all(id, date);
    // reduce a ~1500 puntos como máximo
    const step = Math.max(1, Math.ceil(pts.length / 1500));
    const out = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
    let km = 0;
    for (let i = 1; i < pts.length; i++) km += haversine(pts[i - 1], pts[i]);
    const route = db.prepare('SELECT id FROM routes WHERE driver_id=? AND date=? ORDER BY id DESC LIMIT 1').get(id, date);
    const stops = route ? db.prepare(`${ORDER_SELECT} WHERE o.route_id=? ORDER BY o.stop_seq`).all(route.id) : [];
    res.json({ points: out, km: Math.round(km * 10) / 10, stops });
  })
);

// ---------- Análisis y eficiencia ----------
app.get(
  '/api/analytics',
  auth(...STAFF),
  wrap((req, res) => {
    const to = req.query.to || today();
    const from = req.query.from || new Date(Date.now() - 13 * 864e5).toLocaleDateString('en-CA');
    // Entregas y fallidos cuentan por la FECHA REAL en que pasaron (hora local); lo abierto, por su fecha programada.
    const DONE = "date(o.delivered_at,'localtime')";
    const offA = req.user.office || Number(req.query.office_id) || null;
    const sreq = { user: { office: offA, cities: req.user.cities, role: req.user.role } };
    const cityA = String(req.query.city || '').trim();
    const cityW = cityA ? ` AND lower(TRIM(c2.city)) = '${cityA.toLowerCase().replace(/'/g, "''")}'` : '';
    const drvA = Number(req.query.driver_id) || null;
    const OFF = (offA || cityA || cityIn(req) ? ` AND o.customer_id IN (SELECT c2.id FROM customers c2 WHERE 1 ${inOffice(sreq, 'c2')}${cityW})` : '') + (drvA ? ` AND o.driver_id = ${drvA}` : '');
    const IN = `((o.status IN ('entregado','fallido') AND o.delivered_at >= ? AND o.delivered_at < ?) OR (o.status NOT IN ('entregado','fallido') AND o.scheduled_date BETWEEN ? AND ?))${OFF}`;
    const R = [...utcRange(from, to), from, to];
    const totals = db.prepare(`SELECT COUNT(*) total, SUM(o.status='entregado') delivered, SUM(o.status='fallido') failed,
        SUM(o.status IN ('pendiente','asignado','cargado')) open, SUM(o.status='cancelado') cancelled FROM orders o WHERE ${IN}`).get(...R);
    const routes = db.prepare(`SELECT COUNT(*) routes, ROUND(SUM(distance_km),1) km, ROUND(SUM(original_distance_km),1) original_km,
        ROUND(AVG(est_minutes)) avg_minutes FROM routes WHERE date BETWEEN ? AND ? ${offA ? `AND driver_id IN (SELECT u2.id FROM users u2 WHERE 1 ${inOffice(sreq, 'u2')})` : ''}`).get(from, to);
    const byDriver = db.prepare(`SELECT u.id, u.name, COUNT(o.id) assigned, SUM(o.status='entregado') delivered, SUM(o.status='fallido') failed,
        (SELECT ROUND(SUM(r.distance_km),1) FROM routes r WHERE r.driver_id=u.id AND r.date BETWEEN ? AND ?) km,
        (SELECT ROUND(SUM((julianday(COALESCE(r.finished_at, datetime('now'))) - julianday(r.started_at))*24),2)
           FROM routes r WHERE r.driver_id=u.id AND r.date BETWEEN ? AND ? AND r.started_at IS NOT NULL) hours,
        (SELECT ROUND(AVG(e.distance_to_customer_m)) FROM evidences e WHERE e.driver_id=u.id AND date(e.created_at,'localtime') BETWEEN ? AND ?) avg_gps_dev_m
       FROM users u LEFT JOIN orders o ON o.driver_id=u.id AND ${IN}
       WHERE (u.role='repartidor' OR u.can_deliver=1) ${inOffice(sreq, 'u')}${drvA ? ` AND u.id = ${drvA}` : ''} GROUP BY u.id ORDER BY delivered DESC`).all(from, to, from, to, from, to, ...R)
      .map((d) => ({
        ...d,
        success_rate: d.delivered + d.failed ? +((d.delivered / (d.delivered + d.failed)) * 100).toFixed(1) : null,
        per_hour: d.hours > 0 ? +(d.delivered / d.hours).toFixed(2) : null,
        km_per_delivery: d.delivered ? +((d.km || 0) / d.delivered).toFixed(2) : null,
      }));
    const daily = db.prepare(`SELECT CASE WHEN o.status IN ('entregado','fallido') THEN ${DONE} ELSE o.scheduled_date END day,
        SUM(o.status='entregado') delivered, SUM(o.status='fallido') failed, COUNT(*) total
       FROM orders o WHERE ${IN} AND o.status <> 'cancelado' GROUP BY day ORDER BY day`).all(...R);
    const reasons = db.prepare(`SELECT reason, COUNT(*) n FROM evidences e WHERE e.result='fallido' AND date(e.created_at,'localtime') BETWEEN ? AND ? ${OFF ? `AND e.order_id IN (SELECT o.id FROM orders o WHERE 1 ${OFF})` : ''}
       GROUP BY reason ORDER BY n DESC`).all(from, to);
    const zones = db.prepare(`SELECT COALESCE(NULLIF(c.colonia,''), c.zip, 's/colonia') zone, COUNT(*) total, SUM(o.status='entregado') delivered, SUM(o.status='fallido') failed
       FROM orders o JOIN customers c ON c.id=o.customer_id WHERE ${IN} GROUP BY zone ORDER BY total DESC LIMIT 12`).all(...R);
    const onTime = db.prepare(`SELECT SUM(CASE WHEN c.window_end IS NULL OR time(o.delivered_at,'localtime') <= c.window_end THEN 1 ELSE 0 END) on_time, COUNT(*) n
       FROM orders o JOIN customers c ON c.id=o.customer_id WHERE o.status='entregado' AND ${DONE} BETWEEN ? AND ?${OFF}`).get(from, to);
    const lowStock = db.prepare('SELECT id, name, sku, stock, min_stock FROM products WHERE stock <= min_stock ORDER BY stock LIMIT 20').all();
    res.json({ from, to, totals, routes, byDriver, daily, reasons, zones, onTime, lowStock });
  })
);

// ---------- Configuración ----------
const PUBLIC_INTEGRATION = new Set(['public_url', 'notif_enabled', 'phone_country', 'notif_driver_phone_date']);
app.get('/api/settings', auth(), (req, res) => {
  const s = getSettings();
  if (req.user.office) {
    const w = db.prepare('SELECT name, lat, lng FROM warehouses WHERE id=? AND lat IS NOT NULL').get(req.user.office);
    if (w) Object.assign(s, { depot_name: w.name, depot_lat: String(w.lat), depot_lng: String(w.lng), office_ref: '1' });
  }
  for (const k of notify.INTEGRATION_KEYS) if (!PUBLIC_INTEGRATION.has(k)) delete s[k];
  s.google_maps = gmaps.enabled() ? '1' : '0';
  s.google_tiles = gmaps.tilesOn() ? '1' : '0';
  s.road_engine = osrm.enabled() ? '1' : '0';
  res.json(s);
});
// Trazo por calles de una ruta (Google; si no hay, la app deja la línea punteada)
app.post('/api/directions/path', auth(), wrap(async (req, res) => {
  const pts = (req.body?.points || []).map((p) => ({ lat: Number(p[0]), lng: Number(p[1]) })).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)).slice(0, 200);
  if (pts.length < 2) return res.json({ source: 'none' });
  const viaOsrm = async () => { const o = await osrm.route(pts); return o ? res.json({ source: 'osrm', coords: o.coords, distance: o.distance, duration: o.duration }) : res.json({ source: 'none' }); };
  if (!gmaps.enabled()) return viaOsrm();
  const coords = [];
  let distance = 0, duration = 0;
  for (let i = 0; i < pts.length - 1; i += 26) {
    const seg = await gmaps.directions(pts.slice(i, i + 27));
    if (!seg) return viaOsrm();
    coords.push(...seg.coords); distance += seg.distance; duration += seg.duration;
  }
  res.json({ source: 'google', coords, distance, duration });
}));
// Navegación dentro de la app: camino e indicaciones de Google desde donde está el repartidor (formato compatible con OSRM)
app.get('/api/directions/nav', auth(), wrap(async (req, res) => {
  const [fl, fg] = String(req.query.from || '').split(',').map(Number);
  const [tl, tg] = String(req.query.to || '').split(',').map(Number);
  if (![fl, fg, tl, tg].every(Number.isFinite)) return res.json({ source: 'none' });
  const d = gmaps.enabled() ? await gmaps.directions([{ lat: fl, lng: fg }, { lat: tl, lng: tg }], { steps: true, ttl: 3 * 60e3 }) : null;
  if (!d) {
    const o = await osrm.route([{ lat: fl, lng: fg }, { lat: tl, lng: tg }], { steps: true });
    if (!o) return res.json({ source: 'none' });
    return res.json({ source: 'osrm', distance: o.distance, duration: o.duration, geometry: { coordinates: o.coords.map(([a, b]) => [b, a]) }, legs: o.legs });
  }
  const steps = [...d.steps, { maneuver: { type: 'arrive', modifier: '', location: [tg, tl] }, text: 'Llegas a tu destino', distance: 0, name: '' }];
  res.json({ source: 'google', distance: d.distance, duration: d.duration, geometry: { coordinates: d.coords.map(([a, b]) => [b, a]) }, legs: [{ steps }] });
}));
app.get('/api/osrm/status', auth('admin'), wrap(async (req, res) => res.json(await osrm.status())));
app.put(
  '/api/settings',
  auth('admin'),
  wrap((req, res) => {
    const up = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
    const allowed = new Set(Object.keys(getSettings()).filter((k) => !notify.INTEGRATION_KEYS.includes(k)));
    for (const [k, v] of Object.entries(req.body || {})) if (allowed.has(k)) up.run(k, String(v).slice(0, 200));
    audit(req, 'configuracion', Object.keys(req.body || {}).join(', '));
    const out = getSettings();
    for (const k of notify.INTEGRATION_KEYS) if (!PUBLIC_INTEGRATION.has(k)) delete out[k];
    res.json(out);
  })
);

// ---------- Integraciones: notificaciones y Google Sheets (solo administrador) ----------
const mask = (v) => (v ? '••••••' + String(v).slice(-4) : '');
function integrationView() {
  const s = getSettings();
  const out = {};
  for (const k of notify.INTEGRATION_KEYS) out[k] = notify.SECRET_KEYS.includes(k) ? mask(s[k]) : s[k] ?? '';
  out.sheet_stats = db.prepare('SELECT status, COUNT(*) n FROM sheet_sync GROUP BY status').all();
  out.sheet_errors = db
    .prepare('SELECT s.error, s.created_at, o.tracking_code FROM sheet_sync s JOIN orders o ON o.id=s.order_id WHERE s.error IS NOT NULL ORDER BY s.id DESC LIMIT 5')
    .all();
  out.sheet_headers = notify.SHEET_HEADERS;
  return out;
}
app.get('/api/integrations', auth('admin'), (req, res) => res.json(integrationView()));
app.get('/api/google/status', auth('admin'), (req, res) => res.json(gmaps.status()));
app.post('/api/google/test', auth('admin'), wrap(async (req, res) => {
  try { const r = await gmaps.test(); audit(req, 'google.prueba', 'Conexión con Google Maps correcta'); res.json({ ok: true, ...r, status: gmaps.status() }); }
  catch (e) { res.status(400).json({ error: e.message, status: gmaps.status() }); }
}));
// WhatsApp vinculado por QR
const wa = require('./wa');
const waSlot = (req) => Number(req.query.slot || req.body?.slot) || 1;
app.get('/api/whatsapp/status', auth('admin'), (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json(wa.status(waSlot(req))); });
app.post(
  '/api/whatsapp/connect',
  auth('admin'),
  wrap(async (req, res) => {
    if (getSettings().practice_mode === '1') throw new HttpError(403, 'En la copia de práctica no se vincula WhatsApp');
    await wa.start(waSlot(req));
    audit(req, 'whatsapp.vincular', `Línea ${waSlot(req)}: solicitó QR / conexión`);
    res.json(wa.status(waSlot(req)));
  })
);
app.post(
  '/api/whatsapp/logout',
  auth('admin'),
  wrap(async (req, res) => {
    await wa.logout(waSlot(req));
    audit(req, 'whatsapp.desvincular', `Línea ${waSlot(req)}`);
    res.json(wa.status(waSlot(req)));
  })
);
// QR para abrir enlaces de instalación en el teléfono (solo enlaces conocidos)
const QR_LINKS = { smsgate: 'https://github.com/capcom6/android-sms-gateway/releases/latest/download/app-release.apk' };
app.get(
  '/api/qr/:key',
  auth('admin'),
  wrap(async (req, res) => {
    const url = QR_LINKS[req.params.key];
    if (!url) throw new HttpError(404, 'No encontrado');
    res.json({ url, qr: await require('qrcode').toDataURL(url, { margin: 1, width: 240 }) });
  })
);
// Script de Apps Script con la clave real, para copiar y pegar (solo administrador)
app.get('/api/integrations/sheets/script', auth('admin'), (req, res) => {
  const s = getSettings();
  res.setHeader('Cache-Control', 'no-store');
  res.json({ script: notify.appsScript(s.sheets_secret, s.company_name), has_secret: !!s.sheets_secret });
});
app.put(
  '/api/integrations',
  auth('admin'),
  wrap((req, res) => {
    const up = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
    const b = req.body || {};
    if (getSettings().practice_mode === '1' && (b.sheets_enabled === '1' || ['qr', 'meta', 'twilio', 'android', 'smtp'].includes(b.wa_provider || b.sms_provider || b.email_provider)))
      throw new HttpError(403, 'En la copia de práctica los canales reales (WhatsApp, SMS, correo y Google Sheets) están desactivados');
    if (b.public_url && !/^https?:\/\/\S+$/.test(b.public_url)) throw new HttpError(400, 'La URL pública debe empezar con http:// o https://');
    if (b.sheets_url && !/^https:\/\/script\.google\.com\//.test(b.sheets_url)) throw new HttpError(400, 'La URL de Google Sheets debe ser la de la Web App (https://script.google.com/...)');
    if (b.notif_matrix && typeof b.notif_matrix === 'object') b.notif_matrix = JSON.stringify(b.notif_matrix);
    const changed = [];
    for (const k of notify.INTEGRATION_KEYS) {
      if (!(k in b)) continue;
      const v = b[k] == null ? '' : String(b[k]).slice(0, 2000);
      if (notify.SECRET_KEYS.includes(k) && v.startsWith('••••••')) continue; // sin cambios
      up.run(k, v);
      changed.push(k);
    }
    // Al reactivar Sheets NO se envían solas las entregas hechas con el registro apagado (pueden ser pruebas);
    // se suben a mano con "Reenviar" en Configuración → Google Sheets.
    const secrets = changed.some((k) => notify.SECRET_KEYS.includes(k));
    audit(req, 'integraciones', changed.filter((k) => !notify.SECRET_KEYS.includes(k)).join(', ') + (secrets ? ' (+credenciales)' : ''));
    res.json(integrationView());
  })
);
app.post(
  '/api/integrations/test',
  auth('admin'),
  wrap(async (req, res) => {
    const { channel, to } = req.body || {};
    if (!['sms', 'whatsapp', 'email', 'sheets'].includes(channel)) throw new HttpError(400, 'Canal inválido');
    try {
      res.json(await notify.testChannel(channel, to));
    } catch (e) {
      throw new HttpError(400, e.message);
    }
  })
);
app.post(
  '/api/integrations/sheets/retry',
  auth('admin'),
  wrap((req, res) => {
    const r = db.prepare("UPDATE sheet_sync SET status='pendiente', attempts=0, next_try_at=datetime('now') WHERE status IN ('error','desactivado')").run();
    let backfill = 0;
    if (req.body?.backfill) backfill = Number(db.prepare('INSERT OR IGNORE INTO sheet_sync (evidence_id, order_id) SELECT id, order_id FROM evidences').run().changes);
    setImmediate(notify.processQueue);
    audit(req, 'sheets.reenviar', `${r.changes} reintentos, ${backfill} históricas`);
    res.json({ requeued: Number(r.changes), backfill });
  })
);


// ---------- Rastreo público para el cliente final (sin datos personales) ----------
app.get(
  '/api/public/track/:code',
  wrap((req, res) => {
    const o = db.prepare('SELECT tracking_code, status, scheduled_date, eta, delivered_at FROM orders WHERE tracking_code=?').get(req.params.code);
    if (!o) throw new HttpError(404, 'Guía no encontrada');
    res.json(o);
  })
);


// ---------- Cumplimiento: unidades, recurso confiable, checklist, cadena de frío y certificado ----------
const CHECK_ITEMS = [
  ['combustible', 'Combustible suficiente para la ruta', 1],
  ['desinfectada', 'Unidad limpia y desinfectada (cabina y caja de carga)', 1],
  ['mecanico', 'Revisión mecánica: frenos, luces, niveles y claxon', 1],
  ['llantas', 'Llantas en buen estado y con presión correcta (incluye refacción)', 1],
  ['epp', 'Equipo de protección personal: cubrebocas, guantes, gel, chaleco', 1],
  ['seguridad', 'Botiquín, extintor y señalamientos', 1],
  ['documentos', 'Tarjeta de circulación, póliza de seguro y licencia a bordo', 1],
  ['caja', 'Caja de carga sin plagas, humedad ni olores; sin químicos junto a la carga', 1],
  ['termometro', 'Termómetro o registrador de temperatura funcionando', 0],
  ['contenedores', 'Hieleras, refrigerantes y contenedores listos (si aplica)', 0],
  ['rotulada', 'Unidad rotulada e identificada con la empresa', 0],
];
const MED_PRACTICES = [
  ['cadena_frio', 'Cadena de frío: transporte a temperatura controlada (2–8 °C refrigerado, 15–25 °C ambiente controlado) con registro en salida y entrega'],
  ['registro_temp', 'Registro de temperatura con termómetro o registrador calibrado'],
  ['excursiones', 'Procedimiento ante desviaciones de temperatura: aislar el producto, avisar al cliente y documentar la incidencia'],
  ['triple_embalaje', 'Triple embalaje para muestras biológicas (UN3373, categoría B)'],
  ['precintos', 'Precintos o sellos de seguridad numerados y verificación de integridad al entregar'],
  ['separacion', 'Separación de medicamentos y material médico de alimentos, químicos y residuos'],
  ['limpieza', 'Limpieza y desinfección de unidades antes de cada ruta (checklist diario)'],
  ['plagas', 'Control de plagas: unidades con certificado de fumigación vigente'],
  ['personal', 'Personal capacitado en manejo de medicamentos y muestras, con equipo de protección'],
  ['confiable', 'Personal verificado como recurso confiable'],
  ['trazabilidad', 'Trazabilidad: guía, números de serie o lote, firma, fotografía y GPS en cada entrega'],
  ['custodia', 'Cadena de custodia: entrega solo a la persona autorizada, con identificación'],
];
const SHIPMENT_TYPES = { general: 'General', medicamento: 'Medicamento', muestra: 'Muestra biológica', dispositivo: 'Dispositivo médico', refrigerado: 'Refrigerado (cadena de frío)' };
const isoDay = (d = new Date()) => d.toLocaleDateString('en-CA');
const docState = (expires) => {
  if (!expires) return 'sin_dato';
  const days = (Date.parse(expires + 'T23:59:59') - Date.now()) / 864e5;
  return days < 0 ? 'vencido' : days <= 30 ? 'por_vencer' : 'vigente';
};
function saveDoc(dataUrl, prefix) {
  if (!dataUrl || !String(dataUrl).startsWith('data:')) return undefined; // sin cambio
  const m = /^data:application\/pdf;base64,(.+)$/.exec(dataUrl);
  if (!m) return saveDataUrl(dataUrl, prefix);
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > 8 * 1024 * 1024) throw new HttpError(413, 'El PDF es demasiado grande (máx. 8 MB)');
  if (buf.subarray(0, 4).toString() !== '%PDF') throw new HttpError(400, 'El archivo no es un PDF válido');
  const name = `${prefix}_${Date.now()}_${crypto.randomBytes(12).toString('hex')}.pdf`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  return name;
}
const VEHICLE_FIELDS = ['name', 'type', 'plates', 'brand', 'model', 'year', 'color', 'insurer', 'policy_no', 'insurance_expires', 'circulation_card',
  'fumigation_date', 'fumigation_expires', 'fumigation_provider', 'fumigation_cert', 'branded', 'refrigerated', 'temp_min', 'temp_max',
  'thermometer_id', 'thermometer_calibrated', 'driver_id', 'active', 'notes'];
const VTYPES_SERVER = ['moto', 'auto', 'van', 'camion', 'refrigerada', 'bici'];
const VEHICLE_FILES = ['insurance_file', 'circulation_file', 'fumigation_file', 'thermometer_file'];
function vehicleView(v) {
  return { ...v, insurance_state: docState(v.insurance_expires), fumigation_state: docState(v.fumigation_expires) };
}
function vehicleBody(b, prev = {}) {
  const out = {};
  for (const f of VEHICLE_FIELDS) {
    let v = f in b ? b[f] : prev[f];
    if (f === 'active' && v === undefined) v = 1; // las unidades nuevas quedan activas
    if (['branded', 'refrigerated', 'active'].includes(f)) v = [true, 1, '1', 'on', 'true'].includes(v) ? 1 : 0;
    else if (['year', 'driver_id'].includes(f)) v = v === '' || v == null ? null : Math.trunc(Number(v)) || null;
    else if (['temp_min', 'temp_max'].includes(f)) v = v === '' || v == null ? null : Number(v);
    else v = v == null ? null : String(v).trim().slice(0, 200) || null;
    out[f] = v;
  }
  if (!out.name) throw new HttpError(400, 'Ponle un nombre a la unidad (p. ej. "Van 01")');
  if (!out.plates) throw new HttpError(400, 'Las placas son obligatorias');
  out.plates = out.plates.toUpperCase();
  if (!VTYPES_SERVER.includes(out.type)) out.type = 'van';
  return out;
}
app.get(
  '/api/vehicles',
  auth(),
  wrap((req, res) => {
    const rows = db.prepare('SELECT v.*, u.name driver_name FROM vehicles v LEFT JOIN users u ON u.id=v.driver_id ORDER BY v.active DESC, v.name').all().map(vehicleView);
    if (!STAFF.includes(req.user.role)) return res.json(rows.filter((v) => v.active).map(({ id, name, plates, type, refrigerated, temp_min, temp_max, driver_id }) => ({ id, name, plates, type, refrigerated, temp_min, temp_max, driver_id })));
    res.json(rows);
  })
);
function saveVehicle(req, prev) {
  const v = vehicleBody(req.body || {}, prev || {});
  for (const f of VEHICLE_FILES) { const n = saveDoc(req.body?.[f], f.replace('_file', '')); v[f] = n === undefined ? prev?.[f] ?? null : n; }
  try {
    if (prev) {
      db.prepare(`UPDATE vehicles SET ${[...VEHICLE_FIELDS, ...VEHICLE_FILES].map((f) => f + '=?').join(',')} WHERE id=?`).run(...[...VEHICLE_FIELDS, ...VEHICLE_FILES].map((f) => v[f]), prev.id);
      return prev.id;
    }
    return Number(db.prepare(`INSERT INTO vehicles (${[...VEHICLE_FIELDS, ...VEHICLE_FILES].join(',')}) VALUES (${[...VEHICLE_FIELDS, ...VEHICLE_FILES].map(() => '?').join(',')})`).run(...[...VEHICLE_FIELDS, ...VEHICLE_FILES].map((f) => v[f])).lastInsertRowid);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw new HttpError(409, `Ya existe una unidad con placas ${v.plates}`);
    throw e;
  }
}
app.post('/api/vehicles', auth(...STAFF), wrap((req, res) => { const id = saveVehicle(req); audit(req, 'unidad.alta', req.body.plates); res.status(201).json({ id }); }));
app.put(
  '/api/vehicles/:id',
  auth(...STAFF),
  wrap((req, res) => {
    const prev = db.prepare('SELECT * FROM vehicles WHERE id=?').get(req.params.id);
    if (!prev) throw new HttpError(404, 'Unidad no encontrada');
    saveVehicle(req, prev);
    audit(req, 'unidad.edicion', prev.plates);
    res.json({ ok: true });
  })
);
// Recurso confiable y capacitación del personal
app.put(
  '/api/users/:id/compliance',
  auth(...STAFF),
  wrap((req, res) => {
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
    if (!u) throw new HttpError(404, 'No encontrado');
    const b = req.body || {};
    const t = (v) => (v == null ? null : String(v).trim().slice(0, 120) || null);
    const file = saveDoc(b.trusted_cert_file, 'confiable');
    let trainings = null;
    if (Array.isArray(b.trainings)) trainings = JSON.stringify(b.trainings.filter((x) => x && x.name).slice(0, 30).map((x) => ({ name: t(x.name), date: t(x.date), expires: t(x.expires) })));
    db.prepare('UPDATE users SET trusted_cert_folio=?, trusted_cert_issuer=?, trusted_cert_expires=?, trusted_cert_file=COALESCE(?, trusted_cert_file), trainings_json=COALESCE(?, trainings_json), vehicle_id=? WHERE id=?').run(
      t(b.trusted_cert_folio), t(b.trusted_cert_issuer), t(b.trusted_cert_expires), file ?? null, trainings, b.vehicle_id ? Number(b.vehicle_id) : null, u.id
    );
    audit(req, 'personal.confiable', u.email);
    res.json({ ok: true });
  })
);
function personnelView() {
  return db
    .prepare("SELECT id, name, email, role, phone, active, trusted_cert_folio, trusted_cert_issuer, trusted_cert_expires, trusted_cert_file, trainings_json, vehicle_id FROM users WHERE role IN ('repartidor','despachador') ORDER BY active DESC, role DESC, name")
    .all()
    .map((u) => ({ ...u, trainings: JSON.parse(u.trainings_json || '[]'), trusted_state: u.trusted_cert_folio ? docState(u.trusted_cert_expires) : 'sin_dato' }));
}
// Checklist diario de la unidad (lo llena el repartidor antes de salir)
function todayCheck(driverId) {
  return db.prepare('SELECT c.*, v.name vehicle_name, v.plates FROM vehicle_checks c JOIN vehicles v ON v.id=c.vehicle_id WHERE c.driver_id=? AND c.date=? ORDER BY c.id DESC LIMIT 1').get(driverId, isoDay());
}
app.get(
  '/api/my/check',
  auth(),
  wrap((req, res) => {
    const me = db.prepare('SELECT vehicle_id FROM users WHERE id=?').get(req.user.id);
    const route = db.prepare('SELECT id, vehicle_id FROM routes WHERE driver_id=? AND date=? ORDER BY id DESC LIMIT 1').get(req.user.id, isoDay());
    const vehicles = db.prepare('SELECT id, name, plates, type, refrigerated, temp_min, temp_max, branded, driver_id FROM vehicles WHERE active=1 ORDER BY name').all();
    const c = todayCheck(req.user.id);
    res.json({ items: CHECK_ITEMS, check: c ? { ...c, items: JSON.parse(c.items_json) } : null, vehicles, suggested_vehicle: route?.vehicle_id || me?.vehicle_id || vehicles.find((v) => v.driver_id === req.user.id)?.id || null, required: getSettings().require_vehicle_check === '1' });
  })
);
app.post(
  '/api/my/check',
  auth(),
  wrap((req, res) => {
    const b = req.body || {};
    const v = db.prepare('SELECT * FROM vehicles WHERE id=? AND active=1').get(Number(b.vehicle_id));
    if (!v) throw new HttpError(400, 'Elige la unidad');
    const items = {};
    for (const [k, , crit] of CHECK_ITEMS) {
      const val = b.items?.[k];
      if (!['ok', 'no', 'na'].includes(val)) throw new HttpError(400, `Responde: ${CHECK_ITEMS.find((x) => x[0] === k)[1]}`);
      if (crit && val === 'na') throw new HttpError(400, `"${CHECK_ITEMS.find((x) => x[0] === k)[1]}" no puede ser "No aplica"`);
      items[k] = val;
    }
    if (v.refrigerated && items.termometro === 'na') throw new HttpError(400, 'La unidad es refrigerada: el termómetro sí aplica');
    const temp = b.temp_c === '' || b.temp_c == null ? null : Number(b.temp_c);
    if (v.refrigerated && (temp == null || !Number.isFinite(temp))) throw new HttpError(400, 'Registra la temperatura de la caja refrigerada');
    const failed = CHECK_ITEMS.filter(([k, , crit]) => (crit || (k === 'termometro' && v.refrigerated)) && items[k] === 'no').map(([, l]) => l);
    const tempOut = v.refrigerated && temp != null && ((v.temp_min != null && temp < v.temp_min) || (v.temp_max != null && temp > v.temp_max));
    const passed = !failed.length && !tempOut ? 1 : 0;
    if (!passed && !String(b.notes || '').trim()) throw new HttpError(400, 'Hay puntos que no se cumplen: explica en comentarios qué se hará');
    const photo = saveDataUrl(b.photo, 'unidad');
    const sig = saveDataUrl(b.signature, 'firma_check');
    const route = db.prepare('SELECT id FROM routes WHERE driver_id=? AND date=? ORDER BY id DESC LIMIT 1').get(req.user.id, isoDay());
    const id = tx(() => {
      const r = db.prepare('INSERT INTO vehicle_checks (vehicle_id, driver_id, route_id, date, fuel, odometer, temp_c, items_json, passed, photo_path, signature_path, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(
        v.id, req.user.id, route?.id ?? null, isoDay(), b.fuel || null, b.odometer ? Math.trunc(Number(b.odometer)) || null : null, temp, JSON.stringify(items), passed, photo, sig, String(b.notes || '').slice(0, 500) || null
      );
      const cid = Number(r.lastInsertRowid);
      if (route) db.prepare('UPDATE routes SET vehicle_id=?, check_id=? WHERE id=?').run(v.id, cid, route.id);
      db.prepare('UPDATE users SET vehicle_id=? WHERE id=?').run(v.id, req.user.id);
      return cid;
    });
    audit(req, 'checklist.unidad', `${v.plates}: ${passed ? 'aprobado' : 'con observaciones'}`);
    res.status(201).json({ id, passed: !!passed, failed, temp_out: tempOut });
  })
);
app.get(
  '/api/vehicle-checks',
  auth(...STAFF),
  wrap((req, res) => {
    const { limit, offset } = paging(req);
    const from = req.query.from || isoDay(new Date(Date.now() - 29 * 864e5));
    const to = req.query.to || isoDay();
    const rows = db.prepare(
      `SELECT c.*, v.name vehicle_name, v.plates, u.name driver_name FROM vehicle_checks c JOIN vehicles v ON v.id=c.vehicle_id LEFT JOIN users u ON u.id=c.driver_id
       WHERE c.date BETWEEN ? AND ? ${req.query.vehicle_id ? 'AND c.vehicle_id=?' : ''} ORDER BY c.id DESC LIMIT ? OFFSET ?`
    ).all(...[from, to, ...(req.query.vehicle_id ? [Number(req.query.vehicle_id)] : []), limit, offset]);
    res.json({ rows: rows.map((r) => ({ ...r, items: JSON.parse(r.items_json) })), items: CHECK_ITEMS });
  })
);
// Datos de cumplimiento que se guardan con cada entrega (unidad, checklist, recurso confiable, temperatura y sello)
function deliveryCompliance(o, user, b) {
  const s = getSettings();
  const route = o.route_id ? db.prepare('SELECT vehicle_id, check_id FROM routes WHERE id=?').get(o.route_id) : null;
  const u = db.prepare('SELECT vehicle_id, trusted_cert_folio, trusted_cert_issuer, trusted_cert_expires FROM users WHERE id=?').get(user.id);
  const chk = route?.check_id ? db.prepare('SELECT * FROM vehicle_checks WHERE id=?').get(route.check_id) : todayCheck(user.id);
  const vid = route?.vehicle_id || chk?.vehicle_id || u?.vehicle_id;
  const v = vid ? db.prepare('SELECT * FROM vehicles WHERE id=?').get(vid) : null;
  const temp = b.temp_c === '' || b.temp_c == null ? null : Number(b.temp_c);
  if (temp != null && !Number.isFinite(temp)) throw new HttpError(400, 'Temperatura inválida');
  const hasRange = o.temp_min != null || o.temp_max != null;
  const inRange = temp == null || !hasRange ? null : !((o.temp_min != null && temp < o.temp_min) || (o.temp_max != null && temp > o.temp_max));
  const c = {
    shipment_type: o.shipment_type || 'general',
    temp_c: temp, temp_min: o.temp_min, temp_max: o.temp_max, temp_in_range: inRange,
    seal_number: b.seal_number ? String(b.seal_number).trim().slice(0, 40) : o.seal_number || null,
    seal_ok: b.seal_ok == null || b.seal_ok === '' ? null : !!(b.seal_ok === true || b.seal_ok === 'true' || b.seal_ok === '1'),
    package_ok: b.package_ok == null || b.package_ok === '' ? null : !!(b.package_ok === true || b.package_ok === 'true' || b.package_ok === '1'),
    vehicle: v ? { id: v.id, name: v.name, plates: v.plates, insured: docState(v.insurance_expires) !== 'vencido' && !!v.insurance_expires, insurer: v.insurer, fumigated: docState(v.fumigation_expires) !== 'vencido' && !!v.fumigation_expires, branded: !!v.branded, refrigerated: !!v.refrigerated } : null,
    check: chk ? { id: chk.id, date: chk.date, passed: !!chk.passed } : null,
    trusted: u?.trusted_cert_folio ? { folio: u.trusted_cert_folio, issuer: u.trusted_cert_issuer, valid: docState(u.trusted_cert_expires) !== 'vencido' } : null,
  };
  return { c, needsTemp: hasRange && o.shipment_type !== 'general', needsSeal: !!o.requires_seal, enabled: s.compliance_in_delivery === '1' };
}
// Resumen de cumplimiento (tablero y certificado)
function complianceSummary() {
  const s = getSettings();
  const vehicles = db.prepare('SELECT * FROM vehicles WHERE active=1 ORDER BY name').all().map(vehicleView);
  const personnel = personnelView().filter((p) => p.active);
  const drivers = personnel.filter((p) => p.role === 'repartidor');
  const since = isoDay(new Date(Date.now() - 29 * 864e5));
  const checks = db.prepare('SELECT COUNT(*) n, SUM(passed) ok, COUNT(DISTINCT date) days FROM vehicle_checks WHERE date >= ?').get(since);
  const checksToday = db.prepare('SELECT COUNT(*) n, SUM(passed) ok FROM vehicle_checks WHERE date = ?').get(isoDay());
  const medRows = db.prepare(`SELECT e.compliance_json FROM evidences e JOIN orders o ON o.id=e.order_id WHERE e.result='entregado' AND o.shipment_type <> 'general' AND date(e.created_at) >= date('now','-89 days')`).all();
  const med = medRows.map((r) => { try { return JSON.parse(r.compliance_json || '{}'); } catch { return {}; } });
  const withTemp = med.filter((x) => x.temp_in_range != null);
  const withSeal = med.filter((x) => x.seal_ok != null);
  let practices = [];
  try { practices = JSON.parse(s.medical_practices || '[]'); } catch {}
  return {
    company: { name: s.company_name, legal_name: s.company_legal_name, rfc: s.company_rfc, address: s.company_address, phone: s.company_phone, email: s.company_email,
      responsible: s.company_responsible, responsible_title: s.company_responsible_title, sanitary_license: s.company_sanitary_license },
    vehicles: vehicles.map((v) => ({ id: v.id, name: v.name, plates: v.plates, type: v.type, brand: v.brand, model: v.model, year: v.year, insurer: v.insurer, policy_no: v.policy_no,
      insurance_expires: v.insurance_expires, insurance_state: v.insurance_state, fumigation_expires: v.fumigation_expires, fumigation_provider: v.fumigation_provider,
      fumigation_cert: v.fumigation_cert, fumigation_state: v.fumigation_state, branded: !!v.branded, refrigerated: !!v.refrigerated, temp_min: v.temp_min, temp_max: v.temp_max,
      thermometer_id: v.thermometer_id, thermometer_calibrated: v.thermometer_calibrated })),
    personnel: personnel.map((p) => ({ id: p.id, name: p.name, role: p.role, trusted_cert_folio: p.trusted_cert_folio, trusted_cert_issuer: p.trusted_cert_issuer,
      trusted_cert_expires: p.trusted_cert_expires, trusted_state: p.trusted_state, trainings: p.trainings })),
    totals: {
      vehicles: vehicles.length,
      insured: vehicles.filter((v) => v.insurance_state === 'vigente' || v.insurance_state === 'por_vencer').length,
      fumigated: vehicles.filter((v) => v.fumigation_state === 'vigente' || v.fumigation_state === 'por_vencer').length,
      branded: vehicles.filter((v) => v.branded).length,
      refrigerated: vehicles.filter((v) => v.refrigerated).length,
      drivers: drivers.length,
      trusted: drivers.filter((p) => p.trusted_state === 'vigente' || p.trusted_state === 'por_vencer').length,
      checks_30d: checks.n || 0, checks_passed_30d: checks.ok || 0, check_days_30d: checks.days || 0,
      checks_today: checksToday.n || 0, checks_today_ok: checksToday.ok || 0,
      medical_deliveries_90d: med.length, temp_records: withTemp.length, temp_in_range: withTemp.filter((x) => x.temp_in_range).length,
      seal_records: withSeal.length, seal_ok: withSeal.filter((x) => x.seal_ok).length,
    },
    practices: MED_PRACTICES.filter(([k]) => practices.includes(k)).map(([k, l]) => ({ key: k, label: l })),
    alerts: [
      ...vehicles.filter((v) => v.insurance_state !== 'vigente').map((v) => `${v.name} (${v.plates}): seguro ${v.insurance_state.replace('_', ' ')}`),
      ...vehicles.filter((v) => v.fumigation_state !== 'vigente').map((v) => `${v.name} (${v.plates}): fumigación ${v.fumigation_state.replace('_', ' ')}`),
      ...drivers.filter((p) => p.trusted_state !== 'vigente').map((p) => `${p.name}: recurso confiable ${p.trusted_state.replace('_', ' ')}`),
    ],
  };
}
app.get('/api/compliance', auth(...STAFF), wrap((req, res) => res.json({ ...complianceSummary(), check_items: CHECK_ITEMS, med_practices: MED_PRACTICES, shipment_types: SHIPMENT_TYPES, personnel_full: personnelView() })));
app.get('/api/compliance/catalogs', auth(), (req, res) => res.json({ check_items: CHECK_ITEMS, shipment_types: SHIPMENT_TYPES }));
// Certificado de la empresa (autodeclaración con base en los registros) y verificación pública por QR
app.post(
  '/api/certificates',
  auth('admin'),
  wrap((req, res) => {
    const s = getSettings();
    if (!s.company_legal_name && !s.company_name) throw new HttpError(400, 'Completa los datos de la empresa');
    const data = complianceSummary();
    if (!data.vehicles.length) throw new HttpError(400, 'Registra al menos una unidad antes de emitir el certificado');
    const days = Math.min(365, Math.max(7, Number(s.cert_validity_days) || 90));
    const until = isoDay(new Date(Date.now() + days * 864e5));
    const year = new Date().getFullYear();
    const n = db.prepare("SELECT COUNT(*) n FROM certificates WHERE folio LIKE ?").get(`SOV-${year}-%`).n + 1;
    const folio = `SOV-${year}-${String(n).padStart(4, '0')}`;
    const token = crypto.randomBytes(12).toString('hex');
    data.scope = String(req.body?.scope || '').trim().slice(0, 300) || null;
    data.addressed_to = String(req.body?.addressed_to || '').trim().slice(0, 150) || null;
    const id = Number(db.prepare('INSERT INTO certificates (folio, token, data_json, issued_by, valid_until) VALUES (?,?,?,?,?)').run(folio, token, JSON.stringify(data), req.user.id, until).lastInsertRowid);
    audit(req, 'certificado.emitir', folio);
    res.status(201).json({ id, folio, token, valid_until: until, verify_url: `${notify.baseUrl(s)}/c/${token}` });
  })
);
app.get(
  '/api/certificates',
  auth(...STAFF),
  wrap((req, res) => {
    const s = getSettings();
    res.json(db.prepare('SELECT c.id, c.folio, c.token, c.issued_at, c.valid_until, c.revoked, c.data_json, u.name issued_by_name FROM certificates c LEFT JOIN users u ON u.id=c.issued_by ORDER BY c.id DESC').all()
      .map((c) => ({ ...c, data: JSON.parse(c.data_json), data_json: undefined, verify_url: `${notify.baseUrl(s)}/c/${c.token}` })));
  })
);
app.get(
  '/api/certificates/:id/qr',
  auth(...STAFF),
  wrap(async (req, res) => {
    const c = db.prepare('SELECT token FROM certificates WHERE id=?').get(req.params.id);
    if (!c) throw new HttpError(404, 'No encontrado');
    const url = `${notify.baseUrl(getSettings())}/c/${c.token}`;
    res.json({ url, qr: await require('qrcode').toDataURL(url, { margin: 1, width: 260 }) });
  })
);
app.post(
  '/api/certificates/:id/revoke',
  auth('admin'),
  wrap((req, res) => {
    const c = db.prepare('SELECT folio FROM certificates WHERE id=?').get(req.params.id);
    if (!c) throw new HttpError(404, 'No encontrado');
    db.prepare('UPDATE certificates SET revoked=1 WHERE id=?').run(req.params.id);
    audit(req, 'certificado.revocar', c.folio);
    res.json({ ok: true });
  })
);
app.get(
  '/api/public/cert/:token',
  wrap((req, res) => {
    if (!/^[a-f0-9]{24}$/.test(req.params.token)) throw new HttpError(404, 'Certificado no encontrado');
    const c = db.prepare('SELECT folio, issued_at, valid_until, revoked, data_json FROM certificates WHERE token=?').get(req.params.token);
    if (!c) throw new HttpError(404, 'Certificado no encontrado');
    const d = JSON.parse(c.data_json);
    const status = c.revoked ? 'revocado' : Date.parse(c.valid_until + 'T23:59:59') < Date.now() ? 'vencido' : 'vigente';
    res.setHeader('Cache-Control', 'no-store');
    // Sin datos personales: totales, unidades (placas parciales) y prácticas
    res.json({
      folio: c.folio, issued_at: c.issued_at, valid_until: c.valid_until, status,
      company: { name: d.company.name, legal_name: d.company.legal_name, rfc: d.company.rfc, address: d.company.address },
      totals: d.totals, practices: d.practices, scope: d.scope,
      vehicles: d.vehicles.map((v) => ({ name: v.name, plates: String(v.plates).replace(/.(?=.{3})/g, '•'), insured: ['vigente', 'por_vencer'].includes(v.insurance_state), fumigated: ['vigente', 'por_vencer'].includes(v.fumigation_state), branded: v.branded, refrigerated: v.refrigerated })),
    });
  })
);
app.get('/c/:token', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'cert.html')));


// ---------- Guía del administrador (en vivo: se llena con los datos actuales) ----------
app.get(
  '/api/guide',
  auth(...STAFF),
  wrap(async (req, res) => {
    const s = getSettings();
    const tpl = fs.readFileSync(path.join(__dirname, 'docs', 'guia-administrador.html'), 'utf8');
    const n = (sql, ...a) => db.prepare(sql).get(...a).n;
    const url = notify.baseUrl(s);
    const qr = (await require('qrcode').toDataURL(url, { margin: 1, width: 340, color: { dark: '#1d5a96', light: '#ffffff' } })).split(',')[1];
    const staffN = n("SELECT COUNT(*) n FROM users WHERE active=1 AND role<>'admin'");
    const drivers = n("SELECT COUNT(*) n FROM users WHERE active=1 AND (role='repartidor' OR can_deliver=1)");
    const noLoc = n("SELECT COUNT(*) n FROM customers WHERE lat IS NULL AND geo_quality='no_encontrada'");
    const approx = n("SELECT COUNT(*) n FROM customers WHERE geo_quality IN ('calle','colonia','cp','ciudad')");
    const pendingGeo = n("SELECT COUNT(*) n FROM customers WHERE lat IS NULL AND (geo_quality IS NULL OR geo_quality='')");
    const serialZero = db.prepare("SELECT name, stock FROM products WHERE serialized=1 AND stock<=0").all();
    const vehicles = n('SELECT COUNT(*) n FROM vehicles WHERE active=1');
    const adminDemo = n("SELECT COUNT(*) n FROM users WHERE role='admin' AND email LIKE '%@demo.com'");
    const e = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const item = (done, title, text) => `<li class="${done ? 'done' : ''}">${done ? '✅' : '☐'} <b>${e(title)}:</b> ${text}</li>`;
    const pend = [
      item(!(Number(s.depot_lat) === 19.4326 && Number(s.depot_lng) === -99.1332), 'Almacén', 'ubicarlo en <i>Configuración → General</i>; las rutas salen de ahí.'),
      item(drivers > 0, 'Equipo', drivers ? `${staffN} usuario(s) activos (${drivers} repartidores).` : 'dar de alta despachadores y repartidores en <i>Usuarios</i>.'),
      item(!serialZero.length, 'Existencia de equipos con S/N', serialZero.length ? `${serialZero.map((p) => e(p.name)).join(', ')} en ${serialZero.map((p) => p.stock).join(', ')}: registra tu conteo real y recibe los S/N.` : 'con existencia registrada.'),
      item(!adminDemo, 'Correo del administrador', adminDemo ? 'cambiar <code>admin@demo.com</code> por tu correo en <i>Usuarios</i>.' : 'actualizado.'),
      item(!!s.company_legal_name && vehicles > 0, 'Cumplimiento', `${s.company_legal_name ? 'datos de la empresa listos' : 'faltan datos de la empresa'} · ${vehicles} unidad(es) registradas.`),
      item(!noLoc && !pendingGeo, 'Domicilios en el mapa', pendingGeo ? `ubicando ${pendingGeo} domicilio(s)…` : noLoc ? `${noLoc} sin ubicar y ${approx} aproximados: ábrelos en <i>Clientes</i> y toca el mapa.` : `todos ubicados${approx ? ` (${approx} aproximados por calle o colonia: conviene revisarlos)` : ''}.`),
    ].join('');
    const html = tpl
      .replace('{{FECHA}}', new Date().toLocaleString('es-MX', { timeZone: process.env.TZ || 'America/Tijuana', dateStyle: 'long', timeStyle: 'short' }))
      .replace('{{CLIENTES}}', n('SELECT COUNT(*) n FROM customers'))
      .replace('{{PEDIDOS}}', n("SELECT COUNT(*) n FROM orders WHERE status IN ('pendiente','asignado','cargado')"))
      .replace('{{UBICADOS}}', `${n('SELECT COUNT(*) n FROM customers WHERE lat IS NOT NULL')}/${n('SELECT COUNT(*) n FROM customers')}`)
      .replace('{{MODO_PRUEBA}}', s.notif_test_to || s.notif_test_email ? 'encendido (los clientes no reciben avisos)' : 'apagado (los avisos van a los clientes)')
      .replace('{{PENDIENTES}}', pend)
      .replace('{{QR}}', qr)
      .replaceAll('https://sovime.srv1901867.hstgr.cloud', e(url));
    res.setHeader('Cache-Control', 'no-store');
    res.type('html').send(html);
  })
);

// Página pública de rastreo y comprobante para el cliente final (enlace con token aleatorio, no adivinable)
app.get(
  '/api/public/t/:token',
  wrap((req, res) => {
    if (!/^[a-f0-9]{24}$/.test(req.params.token)) throw new HttpError(404, 'Enlace no válido');
    const o = db
      .prepare(
        `SELECT o.id, o.tracking_code, o.status, o.scheduled_date, o.eta, o.created_at, o.loaded_at, o.delivered_at, o.route_id, o.stop_seq,
           c.name cname, c.lat, c.lng, c.address, u.name dname, u.last_lat, u.last_lng, u.last_seen
         FROM orders o JOIN customers c ON c.id=o.customer_id LEFT JOIN users u ON u.id=o.driver_id WHERE o.public_token=?`
      )
      .get(req.params.token);
    if (!o) throw new HttpError(404, 'Envío no encontrado');
    const s = getSettings();
    const out = {
      company: s.company_name, tracking_code: o.tracking_code, status: o.status, scheduled_date: o.scheduled_date, eta: o.eta,
      created_at: o.created_at, loaded_at: o.loaded_at, delivered_at: o.delivered_at,
      customer: String(o.cname || '').split(/\s+/)[0], address: o.address,
      destination: o.lat != null ? { lat: o.lat, lng: o.lng } : null,
    };
    if (o.status === 'cargado') {
      out.driver = String(o.dname || '').split(/\s+/)[0];
      out.stops_before = o.route_id
        ? db.prepare("SELECT COUNT(*) n FROM orders WHERE route_id=? AND status='cargado' AND stop_seq < ?").get(o.route_id, o.stop_seq || 0).n
        : null;
      const fresh = o.last_seen && Date.now() - Date.parse(o.last_seen.replace(' ', 'T') + 'Z') < 20 * 60000;
      if (fresh && o.last_lat != null) out.driver_position = { lat: o.last_lat, lng: o.last_lng, at: o.last_seen };
    }
    const ev = db.prepare('SELECT * FROM evidences WHERE order_id=? ORDER BY id DESC LIMIT 1').get(o.id);
    if (ev && o.status === 'entregado' && ev.result === 'entregado') {
      out.proof = {
        receiver_name: ev.receiver_name, receiver_relation: ev.receiver_relation, at: ev.created_at, kind: ev.kind,
        photo: ev.photo_path ? '/uploads/' + ev.photo_path : null, signature: ev.signature_path ? '/uploads/' + ev.signature_path : null,
        serials: serialsOfOrder(o.id).map((x) => ({ serial: x.serial, product: x.product_name })),
      };
      try {
        const c = JSON.parse(ev.compliance_json || 'null');
        if (c) out.proof.compliance = {
          shipment_type: SHIPMENT_TYPES[c.shipment_type] || null, temp_c: c.temp_c, temp_min: c.temp_min, temp_max: c.temp_max, temp_in_range: c.temp_in_range,
          seal_number: c.seal_number, seal_ok: c.seal_ok, package_ok: c.package_ok,
          vehicle: c.vehicle ? { plates: String(c.vehicle.plates).replace(/.(?=.{3})/g, '•'), insured: c.vehicle.insured, fumigated: c.vehicle.fumigated, refrigerated: c.vehicle.refrigerated } : null,
          check_passed: c.check ? c.check.passed : null, trusted: c.trusted ? c.trusted.valid : null,
        };
      } catch {}
    }
    if (ev && o.status === 'fallido') out.fail_reason = ev.reason;
    res.setHeader('Cache-Control', 'no-store');
    res.json(out);
  })
);
app.get('/t/:token', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'track.html')));
app.get('/firma/:token', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'firma.html')));

// ---------- Archivos estáticos ----------
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '30d', immutable: true }));
// Mosaicos del mapa (OpenStreetMap) con caché en disco: rápidos, y respetando la política de uso de OSM
// (User-Agent propio y caché). Se renuevan cada 30 días.
const TILE_DIR = path.join(require('./db').DATA_DIR, 'tiles');
const tileWait = new Map();
app.get('/tiles/:z/:x/:y.png', async (req, res) => {
  const z = Number(req.params.z), x = Number(req.params.x), y = Number(req.params.y);
  const max = 2 ** z;
  if (![z, x, y].every(Number.isInteger) || z < 0 || z > 19 || x < 0 || y < 0 || x >= max || y >= max) return res.status(400).end();
  if (req.query.src !== 'osm') {
    const g = await gmaps.tile(z, x, y);
    if (g) { res.set('Cache-Control', g.cache); return res.type(g.type).send(g.buf); }
  }
  const file = path.join(TILE_DIR, String(z), String(x), `${y}.png`);
  try {
    const st = fs.statSync(file);
    if (Date.now() - st.mtimeMs < 30 * 864e5) { res.set('Cache-Control', 'public, max-age=604800'); return res.type('png').sendFile(file); }
  } catch {}
  const key = `${z}/${x}/${y}`;
  try {
    if (!tileWait.has(key)) tileWait.set(key, (async () => {
      const r = await fetch(`https://tile.openstreetmap.org/${z}/${x}/${y}.png`, {
        headers: { 'User-Agent': `SovimeMensajeria/1.0 (+${notify.baseUrl(getSettings())})`, Referer: notify.baseUrl(getSettings()) + '/' },
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) throw new Error('OSM ' + r.status);
      const buf = Buffer.from(await r.arrayBuffer());
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, buf);
      return buf;
    })().finally(() => setTimeout(() => tileWait.delete(key), 1000)));
    const buf = await tileWait.get(key);
    res.set('Cache-Control', 'public, max-age=604800').type('png').send(buf);
  } catch {
    // sin conexión con OSM: si hay una copia vieja, se sirve
    if (fs.existsSync(file)) return res.type('png').sendFile(file);
    res.status(502).end();
  }
});
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: 0 })); // revalida con ETag: los cambios llegan al instante
app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

app.use((err, req, res, next) => {
  const status = err.status || (err.type === 'entity.too.large' ? 413 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Error interno' : err.message, ...(status < 500 && err.data ? err.data : {}) });
});

if (require.main === module) {
  // Esta base ya se migró a otro servidor: no arrancar aquí (evita desvincular WhatsApp en producción)
  const movedTo = getSettings().moved_to;
  if (movedTo && process.env.ALLOW_MOVED !== '1') {
    console.error(`Esta copia ya NO es la producción: la app se movió a ${movedTo}`);
    console.error('No se inicia para no desconectar WhatsApp ni duplicar registros. Usa la dirección de producción.');
    console.error('Para práctica usa: npm run practica');
    process.exit(1);
  }
  notify.start();
  // Pedidos no exitosos en su fecha programada: al día siguiente quedan libres (sin ruta ni repartidor) para reasignarlos
  setTimeout(releaseOverdue, 15000);
  setInterval(releaseOverdue, 30 * 60000).unref();
  // Resumen por oficina y ciudad en la hoja de Google (cada 15 min)
  const resumenTick = () => notify.pushResumen(resumenRows()).catch((e) => console.error('resumen sheet', e.message));
  setTimeout(resumenTick, 60000);
  setInterval(resumenTick, 15 * 60000).unref();
  setTimeout(diarioTick, 75000);
  setInterval(diarioTick, 15 * 60000).unref();
  setTimeout(geocodePending, 5000);
  setTimeout(() => routedRefine(), 90000);
  setInterval(() => routedRefine(), 10 * 60000).unref();
  setTimeout(neighborRefine, 120000);
  setInterval(neighborRefine, 6 * 3600000).unref();
  setTimeout(() => pinCheck(), 300000);
  setInterval(() => pinCheck(), 6 * 3600000).unref();
  setTimeout(() => docExpiryJob().catch((e) => console.error('vencimientos', e.message)), 240000);
  setTimeout(() => { try { settleJob(); } catch (e) { console.error('corte', e.message); } }, 180000);
  setInterval(() => { try { settleJob(); } catch (e) { console.error('corte', e.message); } }, 3600000).unref();
  setInterval(() => docExpiryJob().catch((e) => console.error('vencimientos', e.message)), 6 * 3600000).unref();
  setInterval(() => { try { db.exec('PRAGMA optimize'); } catch {} }, 24 * 3600000).unref();
  require('./wa').boot(getSettings().wa_provider === 'qr');
  app.listen(PORT, () => console.log(`Sovime Mensajería escuchando en http://localhost:${PORT}`));
}
// Inventario abierto por ciudad: una sola vez, lo que los pedidos abiertos tenían apartado regresa a la existencia
(function toOpenStock() {
  if (getSettings().stock_at === 'entrega') return;
  const up = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  tx(() => {
    up.run('auto_fill', '0'); up.run('stock_at', 'entrega');
    const open = db.prepare(`SELECT DISTINCT o.id, o.tracking_code FROM orders o JOIN order_items i ON i.order_id = o.id WHERE i.filled > 0 AND o.status IN ${OPEN_ST}`).all();
    for (const o of open) returnOrderStock(o.id, o.tracking_code, null, 'Inventario abierto (se descuenta al entregar):');
    db.prepare('INSERT INTO audit_log (user_id, action, detail) VALUES (NULL, ?, ?)').run('inventario.abierto', `Inventario abierto por ciudad: el pedido ya no aparta existencia, se descuenta al entregar (${open.length} pedido(s) abiertos regresaron lo apartado)`);
  });
})();
app.releaseOverdue = releaseOverdue;
app.internal = { telmexSerial, diarioRows, persistRoute, depotOf, routedRefine, reactivateOrder, canonCity, neighborRefine, neighborPin, pinCheck, sendTestContract, docExpiryJob, settleClose, settleJob };
module.exports = app;
