const express = require('express');
const compression = require('compression');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { db, tx, getSettings, DATA_DIR, UPLOAD_DIR } = require('./db');
const { haversine, optimizeRoute, splitAmongDrivers } = require('./routing');
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
app.use(express.json({ limit: '12mb' }));
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
function genTracking() {
  return 'UM' + Date.now().toString(36).toUpperCase().slice(-6) + crypto.randomBytes(2).toString('hex').toUpperCase();
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
      const u = db.prepare('SELECT id, name, email, role, active, token_version, office_id, can_deliver FROM users WHERE id = ?').get(p.sub);
      if (!u || !u.active) return res.status(401).json({ error: 'Usuario inactivo' });
      if (req.headers['x-as-driver'] === '1' && u.can_deliver && u.role !== 'repartidor') { u.real_role = u.role; u.role = 'repartidor'; }
      if ((p.tv || 0) !== u.token_version) return res.status(401).json({ error: 'Tu sesión se cerró, vuelve a entrar' });
      if (roles.length && !roles.includes(u.role)) return res.status(403).json({ error: 'Sin permiso' });
      delete u.token_version;
      u.office = u.role === 'admin' ? null : Number(u.office_id || db.prepare('SELECT id FROM warehouses WHERE is_default = 1').get()?.id || 0) || null;
      u.supervises = db.prepare('SELECT id FROM warehouses WHERE supervisor_id = ? AND active = 1').all(u.id).map((r) => r.id);
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
const signToken = (u) => jwt.sign({ sub: u.id, role: u.role, tv: u.token_version || 0 }, JWT_SECRET, { expiresIn: '12h' });
const ME_FIELDS = 'id, name, email, role, phone, vehicle, capacity, can_deliver, last_login, must_change_password, created_at';

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
const USER_FIELDS = `u.id, u.name, u.email, u.role, u.phone, u.vehicle, u.capacity, u.can_deliver, u.active, u.notes,
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
    if (req.user.office) where.push(`${OFFICE_OF('u')} = ${Number(req.user.office)}`);
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
    audit(req, 'usuario.alta', `${req.body.email} (${req.body.role})`);
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
    if (used) throw new HttpError(409, 'Este usuario tiene historial (pedidos, rutas o movimientos). Desactívalo en lugar de eliminarlo.');
    tx(() => {
      db.prepare('DELETE FROM driver_locations WHERE driver_id=?').run(u.id);
      db.prepare('UPDATE audit_log SET user_id=NULL WHERE user_id=?').run(u.id);
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
  return after;
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
  const sn = normSerial(raw);
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
  if (user.role === 'repartidor') {
    if (s.holder_id && s.holder_id !== user.id) {
      const h = db.prepare('SELECT name FROM users WHERE id=?').get(s.holder_id);
      throw new HttpError(409, `El S/N ${sn} lo trae ${h?.name || 'otro repartidor'}`);
    }
    if (!s.holder_id && !s.open_pool && s.warehouse_id && user.office && s.warehouse_id !== user.office) {
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
  const rows = db.prepare(`SELECT o.tracking_code, o.scheduled_date, o.status, o.delivered_at, o.attempts, c.name customer, c.address, c.colonia, u.name driver,
      (SELECT receiver_name FROM evidences e WHERE e.order_id = o.id AND e.result = o.status ORDER BY e.id DESC LIMIT 1) receiver,
      (SELECT reason FROM evidences e WHERE e.order_id = o.id AND e.result = 'fallido' ORDER BY e.id DESC LIMIT 1) reason,
      (SELECT GROUP_CONCAT(s.serial, ' ') FROM serials s WHERE s.order_id = o.id) serials
    FROM orders o JOIN customers c ON c.id = o.customer_id LEFT JOIN users u ON u.id = o.driver_id
    WHERE o.account_id = ? AND o.scheduled_date BETWEEN ? AND ? AND o.status IN ('entregado','fallido')
    ORDER BY o.scheduled_date, o.tracking_code`).all(a.id, from, to);
  for (const r of rows) r.amount = r.status === 'entregado' ? a.rate_delivery : a.rate_failed;
  const del = rows.filter((r) => r.status === 'entregado').length;
  const fail = rows.length - del;
  const totals = { delivered: del, failed: fail, amount_delivered: del * a.rate_delivery, amount_failed: fail * a.rate_failed, total: del * a.rate_delivery + fail * a.rate_failed };
  if (req.query.format === 'csv') {
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['Guía', 'Fecha', 'Resultado', 'Entregado', 'Cliente', 'Domicilio', 'Colonia', 'Repartidor', 'Recibió', 'Motivo', 'S/N', 'Importe'];
    const lines = rows.map((r) => [r.tracking_code, r.scheduled_date, r.status, r.delivered_at || '', r.customer, r.address, r.colonia, r.driver, r.receiver, r.reason, r.serials, r.amount.toFixed(2)].map(q).join(','));
    lines.push('', [q('Entregados'), del, q('Tarifa'), a.rate_delivery.toFixed(2), q('Importe'), totals.amount_delivered.toFixed(2)].join(','));
    lines.push([q('Fallidos'), fail, q('Tarifa'), a.rate_failed.toFixed(2), q('Importe'), totals.amount_failed.toFixed(2)].join(','));
    lines.push([q('TOTAL'), '', '', '', '', totals.total.toFixed(2)].join(','));
    const fname = `estado-de-cuenta-${a.name.replace(/[^\w-]+/g, '_')}-${from}-a-${to}.csv`;
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    return res.type('text/csv; charset=utf-8').send('﻿' + head.map(q).join(',') + '\n' + lines.join('\n'));
  }
  res.json({ account: a, from, to, rows, totals });
}));

// ---------- Expediente del personal ----------
const PROFILE_TXT = ['hire_type', 'hire_date', 'end_date', 'birth_date', 'address', 'emergency_name', 'emergency_phone', 'rfc', 'curp', 'nss',
  'bank_name', 'clabe', 'account_number', 'account_holder', 'pay_period', 'notes'];
// Cumplimiento mínimo para dar de alta a personal (sobre todo externo)
const STAFF_DOCS = [['ine', 'INE / identificación oficial'], ['domicilio', 'Comprobante de domicilio'], ['csf', 'Constancia de situación fiscal (RFC)'],
  ['curp', 'CURP'], ['licencia', 'Licencia de manejo vigente'], ['antecedentes', 'Carta de no antecedentes penales'], ['contrato', 'Contrato / convenio firmado'],
  ['banco', 'Estado de cuenta (CLABE)'], ['seguro', 'Seguro de la unidad (si usa vehículo propio)']];
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
  // la licencia solo se pide a repartidores; el seguro de unidad es opcional
  const role = db.prepare('SELECT role FROM users WHERE id=?').get(userId)?.role;
  const need = STAFF_DOCS.filter(([k]) => k !== 'seguro' && (k !== 'licencia' || role === 'repartidor'));
  const missing = need.filter(([k]) => !docs[k]?.ok).map(([, l]) => l);
  const expired = STAFF_DOCS.filter(([k]) => docs[k]?.ok && docs[k]?.expires && docs[k].expires < today0).map(([, l]) => l);
  return { ...p, docs: publicDocs(docs), doc_list: STAFF_DOCS, missing, expired, complete: !missing.length && !expired.length,
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
  for (const k of ['pay_per_delivery', 'pay_per_failed']) {
    const n = b[k] === undefined || b[k] === '' ? Number(cur[k] || 0) : Number(b[k]);
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
  const cols = [...PROFILE_TXT, 'pay_per_delivery', 'pay_per_failed'];
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
const docListFor = (role) => STAFF_DOCS.map(([k, l]) => ({ key: k, label: l, optional: k === 'seguro' || (k === 'licencia' && role !== 'repartidor') }));
const publicDocs = (docs) => Object.fromEntries(Object.entries(docs).map(([k, d]) => [k, { ok: !!d.ok, status: d.status || (d.ok ? 'aprobado' : null), expires: d.expires || null, has_file: !!d.file, uploaded_at: d.uploaded_at || null, uploaded_by: d.uploaded_by || null, note: d.note || null, mime: d.file ? (d.file.endsWith('.pdf') ? 'pdf' : 'img') : null }]));
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
    d.note = b.status === 'rechazado' ? String(b.note || '').trim().slice(0, 200) || 'Rechazado: vuelve a subirlo' : null;
  }
  docs[doc] = d;
  saveDocs(userId, docs);
  return d;
}
// Colaborador: sus documentos
app.get('/api/me/documents', auth(), wrap((req, res) => {
  res.json({ doc_list: docListFor(req.user.role), docs: publicDocs(docsOf(req.user.id)) });
}));
app.post('/api/me/documents/:doc', auth(), wrap((req, res) => {
  if (!req.body?.file) throw new HttpError(400, 'Adjunta la foto o el PDF del documento');
  const d = putDoc(req, req.user.id, req.params.doc, { admin: false });
  audit(req, 'personal.documento', `${req.user.name} subió ${STAFF_DOCS.find(([k]) => k === req.params.doc)[1]}`);
  res.json(publicDocs({ [req.params.doc]: d })[req.params.doc]);
}));
// Administrador: subir, aprobar o rechazar
app.post('/api/users/:id/documents/:doc', auth('admin'), wrap((req, res) => {
  const u = db.prepare('SELECT id, name FROM users WHERE id=?').get(req.params.id);
  if (!u) throw new HttpError(404, 'No encontrado');
  const d = putDoc(req, u.id, req.params.doc, { admin: true });
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
    plain: prods.filter((p) => !p.serialized).map((p) => ({ ...p, available: warehouseQty(p.id) })).filter((p) => p.available > 0),
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
    for (const [pid, qty] of qtyBy) {
      db.prepare('INSERT INTO order_items (order_id, product_id, qty) VALUES (?,?,?)').run(oid, pid, qty);
      // la existencia libre baja como en cualquier pedido; si ya estaba apartada para otro pedido no se descuenta dos veces
      const st = db.prepare('SELECT stock FROM products WHERE id=?').get(pid).stock;
      if (st >= qty) moveStock(pid, 'salida', qty, `Pedido ${code}`, me);
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
      if (p.serialized) throw new HttpError(400, `${p.name} se controla por número de serie: elige o escanea sus S/N`);
      const qty = Math.trunc(Number(it.qty));
      if (!(qty > 0)) throw new HttpError(400, `Escribe la cantidad de ${p.name}`);
      const avail = warehouseQty(p.id);
      if (qty > avail) throw new HttpError(409, `Solo hay ${avail} ${p.unit || 'pza'} de ${p.name} en el almacén`);
      results.push({ product: p.name, qty, ok: true });
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
    const r = tx(() => assignSerial(o, req.body?.serial, req.user));
    res.json({ ok: true, already: r.already, serial: r.serial.serial, product: r.serial.pname, missing: missingSerialCount(o.id), serials: serialsOfOrder(o.id) });
  })
);
app.delete(
  '/api/orders/:id/serials/:sid',
  auth(...STAFF),
  wrap((req, res) => {
    const s = db.prepare("SELECT * FROM serials WHERE id=? AND order_id=? AND status='asignado'").get(req.params.sid, req.params.id);
    if (!s) throw new HttpError(404, 'Esa serie no está asignada a este pedido');
    tx(() => {
      db.prepare("UPDATE serials SET status='disponible', order_id=NULL, assigned_at=NULL, updated_at=datetime('now') WHERE id=?").run(s.id);
      serialEvent(s.id, 'liberado', Number(req.params.id), req.user.id, 'Quitado del pedido');
    });
    res.json({ ok: true, missing: missingSerialCount(Number(req.params.id)), serials: serialsOfOrder(Number(req.params.id)) });
  })
);

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
    const total = db.prepare(`SELECT COUNT(*) c FROM customers c ${w}`).get(...args).c;
    const rows = db
      .prepare(
        `SELECT c.*, ${matchCol}, (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id) orders_count,
           (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id AND o.status IN ('pendiente','asignado')) open_orders,
           (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id AND o.status IN ('pendiente','asignado','cargado','fallido')) active_orders,
           (SELECT o.status FROM orders o WHERE o.customer_id = c.id ORDER BY o.scheduled_date DESC, o.id DESC LIMIT 1) last_status,
           (SELECT u.name FROM orders o JOIN users u ON u.id = o.driver_id WHERE o.customer_id = c.id AND o.status IN ('asignado','cargado') ORDER BY o.id DESC LIMIT 1) driver_name
, (SELECT name FROM warehouses WHERE id = ${OFFICE_OF('c')}) office_name
         FROM customers c ${w} ORDER BY c.name LIMIT ? OFFSET ?`
      )
      .all(...margs, ...args, limit, offset);
    res.json({ total, rows });
  })
);
const customerFields = ['office_id', 'name', 'external_id', 'phone', 'phone_alt', 'email', 'address', 'reference', 'city', 'zip', 'lat', 'lng', 'window_start', 'window_end', 'notes', 'notify_sms', 'notify_email', 'notify_whatsapp'];
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
const CITY_CANON = { rosarito: 'Playas de Rosarito', 'playas de rosarito': 'Playas de Rosarito' };
function canonCity(city) { const t = String(city || '').trim(); return CITY_CANON[normCity(t)] || t; }
function officeForCity(city) {
  const c = normCity(city);
  if (!c) return null;
  const ws = db.prepare('SELECT id, city FROM warehouses WHERE active = 1 ORDER BY is_default DESC, id').all();
  return ws.find((w) => officeCities(w).includes(c))?.id ?? null;
}
const OFFICE_OF = (alias) => `COALESCE(${alias}.office_id, (SELECT id FROM warehouses WHERE is_default = 1))`;

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
app.get('/api/dashboard/breakdown', auth(...STAFF), wrap((req, res) => {
  const off = req.user.office || Number(req.query.office_id) || null;
  const city = String(req.query.city || '').trim();
  const d = today();
  const W = `WHERE 1 ${off ? `AND ${OFFICE_OF('c')} = ${Number(off)}` : ''} ${city ? 'AND lower(TRIM(c.city)) = lower(?)' : ''}`;
  const A = city ? [city] : [];
  const cols = `COUNT(DISTINCT c.id) clientes,
      SUM(o.status = 'pendiente') pendientes, SUM(o.status IN ('asignado','cargado')) en_ruta,
      SUM(o.status = 'entregado') entregados, SUM(o.status = 'fallido') fallidos,
      SUM(o.status = 'entregado' AND date(o.delivered_at,'localtime') = '${d}') entregados_hoy,
      SUM(o.status = 'fallido' AND date(o.delivered_at,'localtime') = '${d}') fallidos_hoy`;
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
  const list = db.prepare(`SELECT DISTINCT TRIM(c.city) city FROM customers c WHERE TRIM(COALESCE(c.city,'')) <> '' ${off ? `AND ${OFFICE_OF('c')} = ${Number(off)}` : ''} GROUP BY lower(TRIM(c.city)) ORDER BY city`).all().map((r) => r.city);
  res.json({ offices, cities, city_list: list });
}));
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
  tx(() => { for (const id of ids) n += Number(up.run(w.id, id).changes); });
  audit(req, 'oficina.personal', `${n} personas → ${w.name}`);
  res.json({ moved: n });
}));
app.post(
  '/api/customers',
  auth(...STAFF), // los clientes los registra el despacho; el repartidor solo busca y entrega
  wrap((req, res) => {
    const b = req.body;
    if (!b.name || !b.address) throw new HttpError(400, 'Nombre y dirección son obligatorios');
    if (req.user.office) b.office_id = req.user.office; // el personal de una oficina registra clientes de su oficina
    const vals = customerFields.map((f) => custVal(b, f));
    const r = db.prepare(`INSERT INTO customers (${customerFields.join(',')}) VALUES (${customerFields.map(() => '?').join(',')})`).run(...vals);
    res.status(201).json({ id: Number(r.lastInsertRowid) });
  })
);
app.put(
  '/api/customers/:id',
  auth(),
  wrap((req, res) => {
    const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
    if (!c) throw new HttpError(404, 'No encontrado');
    if (req.user.office && customerOffice(c.id) !== req.user.office) throw new HttpError(403, 'Este cliente es de otra oficina');
    const b = { ...c, ...req.body };
    if (req.user.office && !canManageOffice(req, b.office_id)) b.office_id = c.office_id;
    const vals = customerFields.map((f) => custVal(b, f));
    db.prepare(`UPDATE customers SET ${customerFields.map((f) => f + '=?').join(',')} WHERE id=?`).run(...vals, c.id);
    const moved = b.lat != null && b.lat !== '' && (Number(b.lat) !== c.lat || Number(b.lng) !== c.lng);
    if (moved) db.prepare("UPDATE customers SET geo_quality='manual' WHERE id=?").run(c.id);
    res.json({ ok: true });
  })
);

// ---------- Importación masiva de clientes (Excel/CSV) con pedido de entrega opcional ----------
// El navegador (o un script en el servidor) manda filas normalizadas. Con dry_run calcula todo sin guardar.
// Por defecto NO avisa a los clientes al crear los pedidos (evita una ráfaga de WhatsApp/correos).
const CUST_IMPORT_MAX = 3000;
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
    const results = [];
    const seen = new Map();
    const created = [];
    let stockNeeded = 0;
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
            let ex = c.external_id ? db.prepare('SELECT * FROM customers WHERE external_id=?').get(c.external_id) : null;
            if (!ex && !c.external_id && c.phone) ex = db.prepare('SELECT * FROM customers WHERE phone=? AND lower(name)=lower(?) AND address=?').get(c.phone, c.name, c.address);
            let cid;
            if (ex) {
              cid = ex.id;
              if (updateExisting) {
                const sameAddr = (ex.address || '') === c.address;
                db.prepare(`UPDATE customers SET external_id=COALESCE(?, external_id), name=?, phone=COALESCE(?, phone), phone_alt=COALESCE(?, phone_alt), email=COALESCE(?, email),
                  address=?, colonia=COALESCE(?, colonia), city=COALESCE(?, city), zip=COALESCE(?, zip), reference=COALESCE(?, reference), notes=COALESCE(?, notes),
                  lat=?, lng=?, geo_quality=? WHERE id=?`).run(
                  c.external_id, c.name, c.phone, c.phone_alt, c.email, c.address, c.colonia, c.city, c.zip, c.reference, c.notes,
                  c.lat ?? (sameAddr ? ex.lat : null), c.lng ?? (sameAddr ? ex.lng : null),
                  c.lat != null ? 'archivo' : sameAddr ? ex.geo_quality : null, cid
                );
                out.action = 'actualizado';
              } else out.action = 'existente';
            } else {
              cid = Number(db.prepare(`INSERT INTO customers (external_id, name, phone, phone_alt, email, address, colonia, city, zip, reference, notes, lat, lng, geo_quality)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(c.external_id, c.name, c.phone, c.phone_alt, c.email, c.address, c.colonia, c.city, c.zip, c.reference, c.notes,
                c.lat, c.lng, c.lat != null ? 'archivo' : null).lastInsertRowid);
              out.action = 'nuevo';
            }
            if (impOffice) db.prepare('UPDATE customers SET office_id=? WHERE id=?').run(impOffice, cid);
            else if (out.action === 'nuevo') db.prepare('UPDATE customers SET office_id=? WHERE id=?').run(officeForCity(c.city), cid);
            out.customer_id = cid;
            if (makeOrders) {
              const open = db.prepare("SELECT tracking_code FROM orders WHERE customer_id=? AND scheduled_date=? AND status IN ('pendiente','asignado','cargado')").get(cid, date);
              if (open && skipDupOrders) out.order = `ya tiene ${open.tracking_code}`;
              else {
                const code = genTracking();
                const oid = Number(db.prepare(`INSERT INTO orders (tracking_code, customer_id, scheduled_date, priority, notes, created_by, public_token, shipment_type)
                  VALUES (?,?,?,?,?,?,?,?)`).run(code, cid, date, 'normal', cleanTxt(o.notes, 300) || null, req.user.id, crypto.randomBytes(12).toString('hex'), stype).lastInsertRowid);
                if (accountId) db.prepare('UPDATE orders SET account_id=? WHERE id=?').run(accountId, oid);
                if (product) {
                  db.prepare('INSERT INTO order_items (order_id, product_id, qty) VALUES (?,?,?)').run(oid, product.id, qty);
                  moveStock(product.id, 'salida', qty, `Pedido ${code}`, req.user.id);
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
      sin_ubicacion: 0, stock_disponible: product ? db.prepare('SELECT stock FROM products WHERE id=?').get(product.id).stock : null, stock_necesario: stockNeeded };
    if (!dry) {
      summary.sin_ubicacion = db.prepare('SELECT COUNT(*) n FROM customers WHERE lat IS NULL').get().n;
      if (notifyNow) for (const id of created) notify.queueEvent('registrado', id);
      audit(req, 'clientes.importar', `${summary.nuevos} nuevos, ${summary.actualizados} actualizados, ${summary.pedidos} pedidos${notifyNow ? ' (con aviso)' : ' (sin aviso)'}`);
      setImmediate(geocodePending);
    }
    res.json({ dry_run: dry, summary, results });
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
  return j[0] ? { lat: Number(j[0].lat), lng: Number(j[0].lon) } : null;
}
// Limpia el domicilio para el buscador: "Blvd. Benito Juárez 984-Loc 8 B" -> "Boulevard Benito Juárez 984"
const CITY_OSM = { rosarito: 'Playas de Rosarito', 'playas de rosarito': 'Playas de Rosarito', 'san quintin': 'San Quintín', 'san luis rio colorado': 'San Luis Río Colorado', 'san luis r c': 'San Luis Río Colorado' };
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
async function cityCenter(city) {
  const k = osmCity(city);
  if (!(k in geoCityCache)) { geoCityCache[k] = await nominatim(`${k}, Baja California, México`); await pause(1100); }
  return geoCityCache[k];
}
// Ubica un domicilio probando varias búsquedas (de la más exacta a la más general). Devuelve { lat, lng, quality } o null.
async function geocodeAddress({ address, colonia, city }) {
  const cityName = osmCity(city);
  const ctr = await cityCenter(city).catch(() => null);
  const bias = ctr ? `${ctr.lng - 0.35},${ctr.lat + 0.3},${ctr.lng + 0.35},${ctr.lat - 0.3}` : null;
  const inBox = (g) => !ctr || (Math.abs(g.lat - ctr.lat) < 0.3 && Math.abs(g.lng - ctr.lng) < 0.35);
  const street = cleanStreet(address);
  // colonia: la que venga aparte o la escrita en el domicilio ("…, Col. MADERO" / "…, Zona Centro, …")
  const col = String(colonia || (String(address || '').match(/col(?:onia)?\.?\s*([^,]+)/i) || [])[1] || '').replace(/^col(onia)?\.?\s*/i, '').trim();
  const m = street.match(/^(.*?)\s+(\d+)\s*[A-Za-z]?$/);
  const name = m ? m[1] : street.replace(/\s+\d+.*$/, '');
  const tries = [];
  if (m) tries.push([{ street: `${m[2]} ${m[1]}`, city: cityName, state: 'Baja California', country: 'México' }, 'exacta']);
  if (street) tries.push([`${street}, ${col ? col + ', ' : ''}${cityName}, Baja California`, 'exacta']);
  if (street && col) tries.push([`${street}, ${cityName}, Baja California`, 'exacta']);
  if (street) tries.push(['photon', 'calle']);
  if (name && name !== street) tries.push([`${name}, ${col ? col + ', ' : ''}${cityName}, Baja California`, 'calle']);
  if (col) tries.push([`${col}, ${cityName}, Baja California`, 'colonia']);
  for (const [q, quality] of tries) {
    try {
      let g;
      if (q === 'photon') {
        g = await photon(`${street}${col ? ', ' + col : ''}, ${cityName}`, ctr);
        if (g && !['house', 'street'].includes(g.type)) g = null;
      } else { g = await nominatim(q, bias); await pause(1100); }
      if (g && inBox(g)) return { lat: g.lat, lng: g.lng, quality };
    } catch (e) { if (e.message === 'rate') await pause(30000); }
  }
  return null;
}
app.get('/api/geocode', auth(...STAFF), wrap(async (req, res) => {
  const { address = '', colonia = '', city = '' } = req.query;
  const hit = String(address).trim() ? await geocodeAddress({ address, colonia, city }) : null;
  if (hit) return res.json(hit);
  // no se encontró: el centro de la ciudad, solo para acercar el mapa
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
      const hit = await geocodeAddress({ address: c.address, colonia: colA, city: c.city || 'Tijuana' });
      void dl; void dg;
      if (hit) db.prepare('UPDATE customers SET lat=?, lng=?, geo_quality=? WHERE id=?').run(hit.lat, hit.lng, hit.quality, c.id);
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
  }
}
// Mejora ubicaciones aproximadas (centro de la colonia o de la calle): si encuentra el domicilio exacto lo actualiza;
// si no, deja la que ya tiene. Se reanuda solo tras un reinicio (guarda el último cliente revisado).
const refine = { running: false, done: 0, improved: 0 };
async function refineApprox() {
  if (refine.running || geo.running) return;
  refine.running = true;
  const setK = (k, v) => db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v));
  try {
    for (;;) {
      if (getSettings().geo_refine !== '1') break;
      const last = Number(getSettings().geo_refine_last || 0);
      const c = db.prepare("SELECT * FROM customers WHERE geo_quality IN ('colonia','calle') AND id > ? ORDER BY id LIMIT 1").get(last);
      if (!c) { setK('geo_refine', '0'); break; }
      const colA = c.colonia || (String(c.address || '').match(/col(?:onia)?\.?\s*([^,]+)/i) || [])[1] || '';
      const hit = await geocodeAddress({ address: c.address, colonia: colA, city: c.city || 'Tijuana' });
      // solo si mejora: exacta siempre; "calle" solo si antes era "colonia"
      if (hit && (hit.quality === 'exacta' || (hit.quality === 'calle' && c.geo_quality === 'colonia'))) {
        db.prepare("UPDATE customers SET lat=?, lng=?, geo_quality=? WHERE id=? AND geo_quality IN ('colonia','calle')").run(hit.lat, hit.lng, hit.quality, c.id);
        refine.improved++;
      }
      refine.done++;
      setK('geo_refine_last', c.id);
    }
  } catch (e) {
    console.error('refine', e.message);
  } finally {
    refine.running = false;
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
    if (req.user.office && customerOffice(c.id) !== req.user.office) throw new HttpError(403, 'Este cliente es de otra oficina');
    c.orders = db.prepare(`SELECT o.id, o.tracking_code, o.status, o.scheduled_date, o.delivered_at, o.appointment_time, o.driver_id, o.route_id, u.name driver_name
      FROM orders o LEFT JOIN users u ON u.id = o.driver_id WHERE o.customer_id = ? ORDER BY o.id DESC LIMIT 50`).all(c.id);
    res.json(c);
  })
);

// ---------- Pedidos ----------
const ORDER_SELECT = `
  SELECT o.*, c.name customer_name, c.phone customer_phone, c.phone_alt customer_phone_alt, c.external_id telnor_phone, c.address, c.reference address_reference, c.city customer_city, c.colonia customer_colonia,
         c.lat, c.lng, c.window_start, c.window_end, u.name driver_name, (SELECT name FROM accounts WHERE id = o.account_id) account_name
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
  o.evidences = db.prepare('SELECT * FROM evidences WHERE order_id = ? ORDER BY id DESC').all(o.id);
  return o;
}
function canSee(user, order) {
  if (STAFF.includes(user.role)) return !user.office || customerOffice(order.customer_id) === user.office;
  return order.driver_id === user.id;
}
function customerOffice(customerId) {
  return db.prepare(`SELECT ${OFFICE_OF('c')} o FROM customers c WHERE c.id = ?`).get(customerId)?.o ?? null;
}
// Fragmentos SQL para limitar a la oficina del usuario (el número viene de la base, no del cliente)
const inOffice = (req, alias, kind = 'c') => (req.user.office ? ` AND ${OFFICE_OF(alias)} = ${Number(req.user.office)}` : '');
const canManageOffice = (req, officeId) => req.user.role === 'admin' || req.user.supervises.includes(Number(officeId));

app.get(
  '/api/orders',
  auth(),
  wrap((req, res) => {
    const { status, date, driver_id, q, route_id, unrouted, account_id } = req.query;
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
    if (unrouted === '1') where.push('o.route_id IS NULL');
    const offO = (req.user.role !== 'repartidor' && req.user.office) || req.query.office_id;
    if (offO) { where.push(`${OFFICE_OF('c')} = ?`); args.push(Number(offO)); }
    if (req.query.city) { where.push('lower(TRIM(c.city)) = lower(TRIM(?))'); args.push(String(req.query.city)); }
    if (account_id === 'none') where.push('o.account_id IS NULL');
    else if (account_id) { where.push('o.account_id = ?'); args.push(Number(account_id)); }
    if (q) {
      where.push('(EXISTS (SELECT 1 FROM serials s WHERE s.order_id = o.id AND s.serial LIKE ?) OR o.tracking_code LIKE ? OR c.name LIKE ? OR c.address LIKE ? OR c.phone LIKE ? OR c.external_id LIKE ?)');
      args.push(`%${normSerial(q)}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const total = db.prepare(`SELECT COUNT(*) c FROM orders o JOIN customers c ON c.id = o.customer_id ${w}`).get(...args).c;
    const rows = db.prepare(`${ORDER_SELECT} ${w} ORDER BY o.scheduled_date DESC, o.route_id, o.stop_seq, o.id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset);
    const snq = db.prepare("SELECT GROUP_CONCAT(serial, ', ') l FROM serials WHERE order_id = ?");
    for (const r of rows) r.sn_list = snq.get(r.id).l;
    res.json({ total, rows });
  })
);
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
      o.messages = db.prepare('SELECT id, event, channel, recipient, status, error, created_at, sent_at FROM messages WHERE order_id=? ORDER BY id DESC').all(o.id);
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
    const id = tx(() => {
      const code = (tracking_code || '').trim() || genTracking();
      const r = db
        .prepare('INSERT INTO orders (tracking_code, customer_id, scheduled_date, priority, notes, cod_amount, created_by, public_token, shipment_type, temp_min, temp_max, requires_seal, seal_number) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(code, customer_id, scheduled_date || today(), priority === 'alta' ? 'alta' : 'normal', notes || null, Number(cod_amount) || 0, req.user.id,
          crypto.randomBytes(12).toString('hex'), stype, tmin, tmax, req.body.requires_seal ? 1 : 0, req.body.seal_number ? String(req.body.seal_number).trim().slice(0, 40) : null);
      const oid = Number(r.lastInsertRowid);
      if (req.body.account_id && db.prepare('SELECT 1 FROM accounts WHERE id=?').get(Number(req.body.account_id))) db.prepare('UPDATE orders SET account_id=? WHERE id=?').run(Number(req.body.account_id), oid);
      for (const it of items) {
        const qty = Math.abs(Math.trunc(Number(it.qty))) || 1;
        db.prepare('INSERT INTO order_items (order_id, product_id, qty) VALUES (?,?,?)').run(oid, it.product_id, qty);
        moveStock(it.product_id, 'salida', qty, `Pedido ${code}`, req.user.id);
      }
      return oid;
    });
    notify.queueEvent('registrado', id);
    res.status(201).json(loadOrder(id));
  })
);
app.post(
  '/api/orders/:id/cancel',
  auth(...STAFF),
  wrap((req, res) => {
    const o = loadOrder(req.params.id);
    if (!o) throw new HttpError(404, 'No encontrado');
    if (['entregado', 'cancelado'].includes(o.status)) throw new HttpError(409, 'No se puede cancelar');
    tx(() => {
      for (const it of o.items) moveStock(it.product_id, 'devolucion', it.qty, `Cancelación ${o.tracking_code}`, req.user.id);
      releaseOrderSerials(o.id, req.user.id, `Pedido ${o.tracking_code} cancelado`);
      db.prepare("UPDATE orders SET status='cancelado', route_id=NULL, stop_seq=NULL WHERE id=?").run(o.id);
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
    ids = [...new Set(ids)].slice(0, 3000);
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
          for (const it of o.items) moveStock(it.product_id, 'devolucion', it.qty, `Cancelación ${o.tracking_code}`, req.user.id);
          releaseOrderSerials(o.id, req.user.id, `Pedido ${o.tracking_code} cancelado`);
          db.prepare("UPDATE orders SET status='cancelado', route_id=NULL, stop_seq=NULL, eta=NULL WHERE id=?").run(o.id);
        } else {
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
  if (result === 'entregado' && missingSerialCount(o.id)) throw serialsRequiredError(o);
  const comp = deliveryCompliance(o, req.user, b);
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
  return { ok: true, distance_to_customer_m: dist, order: loadOrder(o.id) };
}
// La oficina agrega (o cambia) la foto de una evidencia: p. ej. la foto que mandó el repartidor por WhatsApp
app.post('/api/evidences/:id/photo', auth(...STAFF), wrap((req, res) => {
  const e = db.prepare('SELECT e.*, o.customer_id, o.tracking_code FROM evidences e JOIN orders o ON o.id = e.order_id WHERE e.id = ?').get(req.params.id);
  if (!e) throw new HttpError(404, 'Evidencia no encontrada');
  if (req.user.office && customerOffice(e.customer_id) !== req.user.office) throw new HttpError(403, 'Este pedido es de otra oficina');
  const name = saveDataUrl(req.body?.photo, 'foto');
  if (!name) throw new HttpError(400, 'Falta la foto');
  const note = `Foto agregada por oficina (${req.user.name}, ${new Date().toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })})`;
  db.prepare("UPDATE evidences SET photo_path=?, notes=TRIM(COALESCE(notes,'') || CASE WHEN COALESCE(notes,'')='' THEN '' ELSE ' · ' END || ?) WHERE id=?").run(name, note, e.id);
  db.prepare("UPDATE sheet_sync SET status='pendiente', attempts=0, next_try_at=datetime('now') WHERE evidence_id=? AND status<>'desactivado'").run(e.id);
  audit(req, 'evidencia.foto', `${e.tracking_code}: ${e.photo_path ? 'foto reemplazada' : 'foto agregada'}`);
  res.json({ ok: true, photo_path: name });
}));
app.post('/api/orders/:id/deliver', auth(), wrap((req, res) => res.json(registerEvidence(req, 'entregado'))));
app.post('/api/orders/:id/fail', auth(), wrap((req, res) => res.json(registerEvidence(req, 'fallido'))));
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
  auth(...STAFF),
  wrap((req, res) => {
    const { limit, offset } = paging(req);
    const where = [];
    const args = [];
    if (req.query.from) { where.push("date(e.created_at, 'localtime') >= ?"); args.push(req.query.from); }
    if (req.query.to) { where.push("date(e.created_at, 'localtime') <= ?"); args.push(req.query.to); }
    if (req.query.result) { where.push('e.result = ?'); args.push(req.query.result); }
    if (req.query.kind) { where.push('e.kind = ?'); args.push(req.query.kind); }
    if (req.query.driver_id) { where.push('e.driver_id = ?'); args.push(Number(req.query.driver_id)); }
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
function persistRoute({ routeId, name, driverId, date, depot, orderIds, settings, startTime }) {
  const stops = stopsFor(orderIds);
  const opt = optimizeRoute(depot, stops, settings, { startTime });
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
      "UPDATE orders SET route_id=?, driver_id=?, stop_seq=?, eta=?, leg_km=?, status=CASE WHEN status='pendiente' THEN 'asignado' ELSE status END WHERE id=?"
    );
    for (const s of opt.sequence) upd.run(rid, driverId, s.seq, s.eta, s.leg_km, s.id);
    for (const id of opt.unlocated) upd.run(rid, driverId, 999, null, null, id);
    return { route_id: rid, ...opt };
  });
}

app.get(
  '/api/routes',
  auth(),
  wrap((req, res) => {
    const where = [];
    const args = [];
    if (req.query.date) {
      where.push('r.date = ?');
      args.push(req.query.date);
    }
    if (req.user.role === 'repartidor') {
      where.push('r.driver_id = ?');
      args.push(req.user.id);
    } else if (req.user.office || req.query.office_id) where.push(`r.driver_id IN (SELECT u2.id FROM users u2 WHERE 1 ${inOffice({ user: { office: req.user.office || Number(req.query.office_id) } }, 'u2')})`);
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
    const d = date || today();
    const out = persistRoute({ name: name || `Ruta ${drv.name} ${d}`, driverId: driver_id, date: d, depot: depotOf(s, req.body, driver_id), orderIds: order_ids.map(Number), settings: s, startTime: start_time });
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
    const drivers = db.prepare(`SELECT id, name, vehicle, phone FROM users WHERE (role='repartidor' OR can_deliver=1) ${only ? 'AND id=?' : 'AND active=1'} ORDER BY name`).all(...(only ? [only] : []));
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
function assignOrdersTo(req, drv, ids, date) {
  {
    const rows = db.prepare(`SELECT o.id, o.tracking_code, o.status, o.route_id, o.driver_id, o.scheduled_date, u.name dname FROM orders o LEFT JOIN users u ON u.id = o.driver_id WHERE o.id IN (${ids.map(() => '?').join(',')})`).all(...ids);
    const skipped = [];
    const take = [];
    for (const o of rows) {
      if (!['pendiente', 'asignado'].includes(o.status)) skipped.push({ tracking_code: o.tracking_code, reason: o.status === 'cargado' ? `ya está cargado en la unidad de ${o.dname || 'otro repartidor'}` : `está ${o.status}` });
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
    return { assigned: take.length, skipped, route_id: result.route_id, driver: drv.name, date, unlocated: result.unlocated?.length || 0 };
  }
}
// Programar varios pedidos en un rango de días para un repartidor: se reparten por cercanía, N por día
app.post(
  '/api/routes/assign-range',
  auth(...STAFF),
  wrap((req, res) => {
    const b = req.body || {};
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
    ids = [...new Set(ids)].slice(0, 3000);
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
    const drivers = driverIds.map((id) => db.prepare('SELECT id, name, capacity FROM users WHERE id=?').get(id)).filter(Boolean);
    const pend = db
      .prepare(
        `SELECT o.id, o.priority, c.lat, c.lng, c.window_start, c.window_end FROM orders o JOIN customers c ON c.id=o.customer_id
         WHERE o.status='pendiente' AND o.route_id IS NULL AND o.scheduled_date <= ? ${inOffice(req, 'c')}`
      )
      .all(date);
    if (!pend.length) throw new HttpError(400, 'No hay pedidos pendientes por rutear');
    const { assignments, overflow } = splitAmongDrivers(depot, pend, drivers);
    const created = [];
    for (const a of assignments) {
      if (!a.stops.length) continue;
      const r = persistRoute({
        name: `Ruta ${a.driver.name} ${date}`, driverId: a.driver.id, date, depot,
        orderIds: a.stops.map((x) => x.id), settings: s, startTime: req.body.start_time,
      });
      created.push({ driver: a.driver.name, ...r, sequence: undefined });
    }
    res.status(201).json({ created, overflow: overflow.map((o) => o.id) });
  })
);
app.post(
  '/api/routes/:id/optimize',
  auth(),
  wrap((req, res) => {
    const r = db.prepare('SELECT * FROM routes WHERE id=?').get(req.params.id);
    if (!r) throw new HttpError(404, 'No encontrada');
    if (req.user.role === 'repartidor' && r.driver_id !== req.user.id) throw new HttpError(403, 'Sin permiso');
    const s = getSettings();
    // Re-optimiza las paradas pendientes desde la posición actual (si viene) o desde el almacén
    const pending = db.prepare("SELECT id FROM orders WHERE route_id=? AND status IN ('asignado','cargado')").all(r.id).map((x) => x.id);
    const done = db.prepare("SELECT COUNT(*) c FROM orders WHERE route_id=? AND status IN ('entregado','fallido')").get(r.id).c;
    const from = req.body.lat != null ? { lat: Number(req.body.lat), lng: Number(req.body.lng) } : { lat: r.depot_lat, lng: r.depot_lng };
    const now = new Date();
    const startTime = done ? `${now.getHours()}:${now.getMinutes()}` : undefined;
    const opt = optimizeRoute(from, stopsFor(pending), s, { startTime });
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
    const { driver_id, add_order_ids = [], remove_order_ids = [] } = req.body;
    if (driver_id && driver_id !== r.driver_id) {
      db.prepare('UPDATE routes SET driver_id=? WHERE id=?').run(driver_id, r.id);
      db.prepare('UPDATE orders SET driver_id=? WHERE route_id=?').run(driver_id, r.id);
    }
    if (remove_order_ids.length)
      for (const id of remove_order_ids)
        db.prepare("UPDATE orders SET route_id=NULL, stop_seq=NULL, eta=NULL, driver_id=NULL, status='pendiente' WHERE id=? AND route_id=? AND status IN ('asignado','cargado')").run(id, r.id);
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
    const doneCnt = db.prepare("SELECT COUNT(*) c FROM orders WHERE route_id=? AND status IN ('entregado','fallido')").get(r.id).c;
    if (doneCnt) throw new HttpError(409, 'La ruta ya tiene entregas registradas');
    tx(() => {
      db.prepare("UPDATE orders SET route_id=NULL, stop_seq=NULL, eta=NULL, driver_id=NULL, status='pendiente' WHERE route_id=?").run(r.id);
      db.prepare('DELETE FROM routes WHERE id=?').run(r.id);
    });
    res.json({ ok: true });
  })
);

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
         FROM users u WHERE (u.role='repartidor' OR u.can_deliver=1) AND u.active=1 ${inOffice({ user: { office: req.user.office || Number(req.query.office_id) || null } }, 'u')} ORDER BY u.name`
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
    const sreq = { user: { office: offA } };
    const cityA = String(req.query.city || '').trim();
    const cityW = cityA ? ` AND lower(TRIM(c2.city)) = '${cityA.toLowerCase().replace(/'/g, "''")}'` : '';
    const OFF = offA || cityA ? ` AND o.customer_id IN (SELECT c2.id FROM customers c2 WHERE 1 ${inOffice(sreq, 'c2')}${cityW})` : '';
    const IN = `((o.status IN ('entregado','fallido') AND ${DONE} BETWEEN ? AND ?) OR (o.status NOT IN ('entregado','fallido') AND o.scheduled_date BETWEEN ? AND ?))${OFF}`;
    const R = [from, to, from, to];
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
       WHERE (u.role='repartidor' OR u.can_deliver=1) ${inOffice(sreq, 'u')} GROUP BY u.id ORDER BY delivered DESC`).all(from, to, from, to, from, to, ...R)
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
const PUBLIC_INTEGRATION = new Set(['public_url', 'notif_enabled', 'phone_country']);
app.get('/api/settings', auth(), (req, res) => {
  const s = getSettings();
  if (req.user.office) {
    const w = db.prepare('SELECT name, lat, lng FROM warehouses WHERE id=? AND lat IS NOT NULL').get(req.user.office);
    if (w) Object.assign(s, { depot_name: w.name, depot_lat: String(w.lat), depot_lng: String(w.lng), office_ref: '1' });
  }
  for (const k of notify.INTEGRATION_KEYS) if (!PUBLIC_INTEGRATION.has(k)) delete s[k];
  res.json(s);
});
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
// WhatsApp vinculado por QR
const wa = require('./wa');
app.get('/api/whatsapp/status', auth('admin'), (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json(wa.status()); });
app.post(
  '/api/whatsapp/connect',
  auth('admin'),
  wrap(async (req, res) => {
    if (getSettings().practice_mode === '1') throw new HttpError(403, 'En la copia de práctica no se vincula WhatsApp');
    await wa.start();
    audit(req, 'whatsapp.vincular', 'Solicitó QR / conexión');
    res.json(wa.status());
  })
);
app.post(
  '/api/whatsapp/logout',
  auth('admin'),
  wrap(async (req, res) => {
    await wa.logout();
    audit(req, 'whatsapp.desvincular', '');
    res.json(wa.status());
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
    const approx = n("SELECT COUNT(*) n FROM customers WHERE geo_quality IN ('calle','colonia')");
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

// ---------- Archivos estáticos ----------
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '30d', immutable: true }));
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
  // Resumen por oficina y ciudad en la hoja de Google (cada 15 min)
  const resumenTick = () => notify.pushResumen(resumenRows()).catch((e) => console.error('resumen sheet', e.message));
  setTimeout(resumenTick, 60000);
  setInterval(resumenTick, 15 * 60000).unref();
  setTimeout(geocodePending, 5000);
  require('./wa').boot(getSettings().wa_provider === 'qr');
  app.listen(PORT, () => console.log(`Sovime Mensajería escuchando en http://localhost:${PORT}`));
}
module.exports = app;
