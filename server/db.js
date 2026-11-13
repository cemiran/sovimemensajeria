// Capa de datos: SQLite embebido (node:sqlite) en modo WAL.
// Para >500 usuarios concurrentes o varias instancias, migrar a PostgreSQL (ver README).
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'ultimamilla.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
`);

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','despachador','repartidor')),
  phone TEXT,
  vehicle TEXT,
  capacity INTEGER DEFAULT 40,
  active INTEGER NOT NULL DEFAULT 1,
  last_lat REAL, last_lng REAL, last_seen TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT NOT NULL UNIQUE,
  barcode TEXT UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  unit TEXT DEFAULT 'pza',
  stock INTEGER NOT NULL DEFAULT 0,
  min_stock INTEGER NOT NULL DEFAULT 0,
  location TEXT,
  weight_kg REAL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  type TEXT NOT NULL CHECK (type IN ('entrada','salida','ajuste','devolucion')),
  qty INTEGER NOT NULL,
  stock_after INTEGER NOT NULL,
  reference TEXT,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mov_product ON inventory_movements(product_id, created_at);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT NOT NULL,
  reference TEXT,
  city TEXT,
  zip TEXT,
  lat REAL,
  lng REAL,
  window_start TEXT,
  window_end TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);

CREATE TABLE IF NOT EXISTS routes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  driver_id INTEGER REFERENCES users(id),
  date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planificada' CHECK (status IN ('planificada','en_curso','completada')),
  depot_lat REAL, depot_lng REAL,
  distance_km REAL, original_distance_km REAL, est_minutes REAL,
  started_at TEXT, finished_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_routes_date ON routes(date, driver_id);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tracking_code TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  status TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (status IN ('pendiente','asignado','cargado','entregado','fallido','cancelado')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','alta')),
  scheduled_date TEXT NOT NULL,
  driver_id INTEGER REFERENCES users(id),
  route_id INTEGER REFERENCES routes(id) ON DELETE SET NULL,
  stop_seq INTEGER,
  eta TEXT,
  leg_km REAL,
  cod_amount REAL DEFAULT 0,
  notes TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  loaded_at TEXT, delivered_at TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, scheduled_date);
CREATE INDEX IF NOT EXISTS idx_orders_route ON orders(route_id, stop_seq);
CREATE INDEX IF NOT EXISTS idx_orders_driver ON orders(driver_id, scheduled_date);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);

CREATE TABLE IF NOT EXISTS evidences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  driver_id INTEGER REFERENCES users(id),
  result TEXT NOT NULL CHECK (result IN ('entregado','fallido')),
  receiver_name TEXT,
  receiver_relation TEXT,
  reason TEXT,
  photo_path TEXT,
  signature_path TEXT,
  barcode_verified INTEGER DEFAULT 0,
  lat REAL, lng REAL,
  distance_to_customer_m REAL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_evid_order ON evidences(order_id);

CREATE TABLE IF NOT EXISTS driver_locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  driver_id INTEGER NOT NULL REFERENCES users(id),
  lat REAL NOT NULL, lng REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_loc_driver ON driver_locations(driver_id, created_at);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`);

const defaults = {
  company_name: 'Sovime Mensajería',
  depot_name: 'Almacén central',
  depot_lat: '19.4326',
  depot_lng: '-99.1332',
  avg_speed_kmh: '22',
  service_minutes: '6',
  road_factor: '1.35',
  start_time: '09:00',
};
const ins = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(defaults)) ins.run(k, v);

// ---- Migraciones ligeras (bases creadas con versiones anteriores) ----
const userCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
for (const [col, def] of [
  ['last_login', 'TEXT'],
  ['must_change_password', 'INTEGER NOT NULL DEFAULT 0'],
  ['token_version', 'INTEGER NOT NULL DEFAULT 0'],
  ['notes', 'TEXT'],
]) if (!userCols.includes(col)) db.exec(`ALTER TABLE users ADD COLUMN ${col} ${def}`);

db.exec(`
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  detail TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log(created_at);
`);
db.prepare("UPDATE settings SET value='Sovime Mensajería' WHERE key='company_name' AND value='Última Milla'").run();
// ---- Notificaciones, Google Sheets, rastreo y recepción ----
function addCols(table, cols) {
  const have = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  for (const [col, def] of cols) if (!have.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}
addCols('customers', [['notify_sms', 'INTEGER NOT NULL DEFAULT 1'], ['notify_email', 'INTEGER NOT NULL DEFAULT 1'], ['notify_whatsapp', 'INTEGER NOT NULL DEFAULT 1']]);
addCols('orders', [['public_token', 'TEXT']]);
addCols('evidences', [['kind', "TEXT NOT NULL DEFAULT 'ruta'"], ['receiver_id_doc', 'TEXT']]);
addCols('driver_locations', [['accuracy', 'REAL'], ['speed', 'REAL'], ['heading', 'REAL']]);
db.exec(`
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_token ON orders(public_token);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  customer_id INTEGER REFERENCES customers(id),
  event TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('sms','email','whatsapp')),
  recipient TEXT NOT NULL,
  subject TEXT,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente','enviado','simulado','error')),
  provider_ref TEXT,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_try_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_msg_status ON messages(status, next_try_at);
CREATE INDEX IF NOT EXISTS idx_msg_order ON messages(order_id);
CREATE TABLE IF NOT EXISTS sheet_sync (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  evidence_id INTEGER NOT NULL UNIQUE REFERENCES evidences(id) ON DELETE CASCADE,
  order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente','enviado','error','desactivado')),
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_try_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sheet_status ON sheet_sync(status, next_try_at);
`);
{
  const crypto = require('crypto');
  const up = db.prepare('UPDATE orders SET public_token=? WHERE id=?');
  for (const r of db.prepare('SELECT id FROM orders WHERE public_token IS NULL').all()) up.run(crypto.randomBytes(12).toString('hex'), r.id);
}
// ---- Inventario en manos de repartidores (custodia) ----
// Se crea después de la tabla serials (ver más abajo): serials.holder_id = repartidor que trae el equipo; NULL = en almacén.
// ---- Control por número de serie (cada equipo por su S/N) ----
addCols('products', [['serialized', 'INTEGER NOT NULL DEFAULT 0']]);
// estado real del SMS en el teléfono (SMS Gateway): Pending, Processed, Sent, Delivered, Failed
addCols('messages', [['gw_state', 'TEXT'], ['gw_checked_at', 'TEXT'], ['gw_device', 'TEXT'], ['gw_channel', 'TEXT']]);
db.exec(`
CREATE TABLE IF NOT EXISTS serials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  serial TEXT NOT NULL UNIQUE COLLATE NOCASE,
  status TEXT NOT NULL DEFAULT 'disponible' CHECK (status IN ('disponible','asignado','entregado','baja')),
  order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  reference TEXT,
  notes TEXT,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  assigned_at TEXT,
  delivered_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_serials_product ON serials(product_id, status);
CREATE INDEX IF NOT EXISTS idx_serials_order ON serials(order_id);
CREATE TABLE IF NOT EXISTS serial_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  serial_id INTEGER NOT NULL REFERENCES serials(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  user_id INTEGER REFERENCES users(id),
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_serial_events ON serial_events(serial_id, id);
`);

// ---- Cumplimiento: unidades, recurso confiable, checklists, cadena de frío, certificados ----
db.exec(`
CREATE TABLE IF NOT EXISTS vehicles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'van',
  plates TEXT NOT NULL,
  brand TEXT, model TEXT, year INTEGER, color TEXT,
  insurer TEXT, policy_no TEXT, insurance_expires TEXT, insurance_file TEXT,
  circulation_card TEXT, circulation_file TEXT,
  fumigation_date TEXT, fumigation_expires TEXT, fumigation_provider TEXT, fumigation_cert TEXT, fumigation_file TEXT,
  branded INTEGER NOT NULL DEFAULT 0,
  refrigerated INTEGER NOT NULL DEFAULT 0,
  temp_min REAL, temp_max REAL,
  thermometer_id TEXT, thermometer_calibrated TEXT, thermometer_file TEXT,
  driver_id INTEGER REFERENCES users(id),
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicles_plates ON vehicles(plates);
CREATE TABLE IF NOT EXISTS vehicle_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
  driver_id INTEGER REFERENCES users(id),
  route_id INTEGER REFERENCES routes(id) ON DELETE SET NULL,
  date TEXT NOT NULL,
  fuel TEXT,
  odometer INTEGER,
  temp_c REAL,
  items_json TEXT NOT NULL,
  passed INTEGER NOT NULL DEFAULT 1,
  photo_path TEXT, signature_path TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_checks_date ON vehicle_checks(date, vehicle_id);
CREATE TABLE IF NOT EXISTS certificates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  folio TEXT NOT NULL UNIQUE,
  token TEXT NOT NULL UNIQUE,
  data_json TEXT NOT NULL,
  issued_by INTEGER REFERENCES users(id),
  issued_at TEXT NOT NULL DEFAULT (datetime('now')),
  valid_until TEXT NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0
);
`);
addCols('users', [['trusted_cert_folio', 'TEXT'], ['trusted_cert_issuer', 'TEXT'], ['trusted_cert_expires', 'TEXT'], ['trusted_cert_file', 'TEXT'],
  ['trainings_json', 'TEXT'], ['vehicle_id', 'INTEGER']]);
addCols('routes', [['vehicle_id', 'INTEGER'], ['check_id', 'INTEGER']]);
// usuario eliminado que tenía historial: la cuenta ya no existe para operar, su nombre se conserva en pedidos y entregas
addCols('users', [['deleted_at', 'TEXT']]);
addCols('customers', [['external_id', 'TEXT'], ['phone_alt', 'TEXT'], ['colonia', 'TEXT'], ['geo_quality', 'TEXT']]);
db.exec('CREATE INDEX IF NOT EXISTS idx_customers_ext ON customers(external_id)');
addCols('orders', [['shipment_type', "TEXT NOT NULL DEFAULT 'general'"], ['temp_min', 'REAL'], ['temp_max', 'REAL'], ['requires_seal', 'INTEGER NOT NULL DEFAULT 0'], ['seal_number', 'TEXT']]);
addCols('evidences', [['compliance_json', 'TEXT']]);
addCols('orders', [['retry_at', 'TEXT']]);

const moreDefaults = {
  public_url: '',
  phone_country: '52',
  require_photo: '1',
  require_signature: '1',
  fail_geofence_m: '300',
  workday_minutes: '540',
  osrm_url: 'https://routing.openstreetmap.de/routed-car',
  notif_enabled: '1',
  notif_matrix: JSON.stringify({
    registrado: { sms: 0, email: 1, whatsapp: 1 },
    en_camino: { sms: 1, email: 0, whatsapp: 1 },
    proximo: { sms: 1, email: 0, whatsapp: 1 },
    entregado: { sms: 1, email: 1, whatsapp: 1 },
    fallido: { sms: 1, email: 1, whatsapp: 1 },
  }),
  tpl_registrado: 'Hola {cliente}, {empresa} registró tu envío {guia} para el {fecha}. Síguelo aquí: {link}',
  tpl_en_camino: '{cliente}, tu paquete {guia} ya va en camino. Llegada estimada: {eta}. Rastreo en vivo: {link}',
  tpl_proximo: '{cliente}, {repartidor} llega en aprox. {minutos} min con tu paquete {guia}. Rastreo: {link}',
  tpl_entregado: '¡Listo, {cliente}! Tu paquete {guia} fue entregado a {recibio} ({fecha_entrega}). Comprobante con firma y foto: {link} Gracias por elegir {empresa}.',
  tpl_fallido: 'No pudimos entregar tu paquete {guia}: {motivo}. Te contactaremos para reprogramar. {link}',
  sms_provider: 'simulacion',
  twilio_sid: '', twilio_token: '', twilio_from: '', twilio_wa_from: '',
  wa_provider: 'simulacion',
  wa_token: '', wa_phone_id: '',
  email_provider: 'simulacion',
  smtp_host: '', smtp_port: '587', smtp_secure: '0', smtp_user: '', smtp_pass: '', smtp_from: '',
  inventory_sheet_url: '',
  company_legal_name: '', company_rfc: '', company_address: '', company_phone: '', company_email: '', company_responsible: '',
  company_responsible_title: 'Representante legal', company_sanitary_license: '',
  compliance_in_delivery: '1',
  require_vehicle_check: '0',
  medical_practices: '[]',
  cert_validity_days: '90',
  sheets_enabled: '0',
  sheets_url: '',
  sheets_secret: '',
};
for (const [k, v] of Object.entries(moreDefaults)) ins.run(k, v);
db.prepare("UPDATE settings SET value=? WHERE key='tpl_entregado' AND value=?").run(moreDefaults.tpl_entregado,
  'Tu paquete {guia} fue entregado a {recibio} el {fecha_entrega}. Comprobante con firma y foto: {link} ¡Gracias por elegir {empresa}!');


function getSettings() {
  const out = {};
  for (const r of db.prepare('SELECT key, value FROM settings').all()) out[r.key] = r.value;
  return out;
}

// Transacción simple (node:sqlite no trae helper)
function tx(fn) {
  // anidada (p. ej. persistRoute dentro de otra transacción): corre dentro de la transacción de afuera
  if (db.isTransaction) return fn();
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// ---- Inventario asignado a repartidores ----
addCols('serials', [['holder_id', 'INTEGER REFERENCES users(id)'], ['held_at', 'TEXT']]);
db.exec(`
CREATE INDEX IF NOT EXISTS idx_serials_holder ON serials(holder_id);
CREATE TABLE IF NOT EXISTS driver_stock (
  user_id INTEGER NOT NULL REFERENCES users(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, product_id)
);
CREATE TABLE IF NOT EXISTS custody_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  driver_id INTEGER NOT NULL REFERENCES users(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty INTEGER NOT NULL,
  serial TEXT,
  action TEXT NOT NULL CHECK (action IN ('asignado','devuelto','entregado')),
  order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  by_user INTEGER REFERENCES users(id),
  reference TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_custody_driver ON custody_log(driver_id, created_at);
`);
// Inventario "abierto": salió del almacén y lo puede entregar cualquier repartidor
addCols('serials', [['open_pool', 'INTEGER NOT NULL DEFAULT 0']]);
db.exec(`
CREATE TABLE IF NOT EXISTS open_stock (
  product_id INTEGER PRIMARY KEY REFERENCES products(id),
  qty INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// ---- Clientes mayoristas (empresas a las que Sovime da el servicio de entrega) ----
db.exec(`
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  legal_name TEXT,
  rfc TEXT,
  contact_name TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  rate_delivery REAL NOT NULL DEFAULT 0,
  rate_failed REAL NOT NULL DEFAULT 0,
  payment_terms TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);
addCols('orders', [['account_id', 'INTEGER REFERENCES accounts(id)']]);
addCols('orders', [['appointment_time', 'TEXT']]); // hora de entrega acordada con el cliente (HH:MM)
db.exec('CREATE INDEX IF NOT EXISTS idx_orders_account ON orders(account_id, scheduled_date)');

// ---- Expediente del personal (interno o externo): datos personales, fiscales, bancarios y pago ----
db.exec(`
CREATE TABLE IF NOT EXISTS staff_profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  hire_type TEXT NOT NULL DEFAULT 'externo' CHECK (hire_type IN ('interno','externo')),
  hire_date TEXT, end_date TEXT, birth_date TEXT,
  address TEXT, emergency_name TEXT, emergency_phone TEXT,
  rfc TEXT, curp TEXT, nss TEXT,
  bank_name TEXT, clabe TEXT, account_number TEXT, account_holder TEXT,
  pay_per_delivery REAL NOT NULL DEFAULT 0, pay_per_failed REAL NOT NULL DEFAULT 0, pay_period TEXT DEFAULT 'semanal',
  photo_path TEXT, docs_json TEXT, notes TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);
// ---- Varios almacenes: los equipos con S/N saben en qué almacén están ----
db.exec(`
CREATE TABLE IF NOT EXISTS warehouses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  address TEXT, lat REAL, lng REAL, phone TEXT, manager TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);
addCols('serials', [['warehouse_id', 'INTEGER REFERENCES warehouses(id)']]);
addCols('routes', [['warehouse_id', 'INTEGER']]);
if (!db.prepare('SELECT 1 FROM warehouses LIMIT 1').get()) {
  const g = (k) => db.prepare('SELECT value FROM settings WHERE key=?').get(k)?.value;
  const id = Number(db.prepare('INSERT INTO warehouses (name, lat, lng, is_default) VALUES (?,?,?,1)')
    .run(g('depot_name') || 'Almacén central', Number(g('depot_lat')) || null, Number(g('depot_lng')) || null).lastInsertRowid);
  db.prepare('UPDATE serials SET warehouse_id=? WHERE warehouse_id IS NULL').run(id);
}
// Oficinas foráneas por ciudad: cada almacén es la oficina de una ciudad, con sus clientes finales y su personal
addCols('warehouses', [['city', 'TEXT']]);
addCols('customers', [['office_id', 'INTEGER REFERENCES warehouses(id)']]);
addCols('users', [['office_id', 'INTEGER REFERENCES warehouses(id)']]);
addCols('warehouses', [['supervisor_id', 'INTEGER REFERENCES users(id)']]);
// Supervisor / despachador que también reparte: aparece como repartidor y puede usar la app en modo repartidor
addCols('users', [['can_deliver', 'INTEGER NOT NULL DEFAULT 0']]);
// Índices para bases grandes (miles de clientes y pedidos)
db.exec(`CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id, status);
CREATE INDEX IF NOT EXISTS idx_customers_office ON customers(office_id);
CREATE INDEX IF NOT EXISTS idx_customers_city ON customers(city);
CREATE INDEX IF NOT EXISTS idx_customers_external ON customers(external_id);`);
if (!db.prepare("SELECT 1 FROM settings WHERE key='offices_migrated'").get()) {
  // el principal toma la ciudad más común de los clientes; los demás, su propio nombre
  const top = db.prepare("SELECT city FROM customers WHERE TRIM(COALESCE(city,'')) <> '' GROUP BY lower(TRIM(city)) ORDER BY COUNT(*) DESC LIMIT 1").get();
  db.prepare("UPDATE warehouses SET city = ? WHERE is_default = 1 AND (city IS NULL OR city = '')").run(top ? top.city.trim() : null);
  db.prepare("UPDATE warehouses SET city = name WHERE is_default = 0 AND (city IS NULL OR city = '')").run();
  db.prepare(`UPDATE customers SET office_id = (SELECT w.id FROM warehouses w WHERE w.active = 1 AND lower(TRIM(w.city)) = lower(TRIM(customers.city)) ORDER BY w.is_default DESC LIMIT 1)
    WHERE office_id IS NULL`).run();
  db.prepare("INSERT INTO settings (key, value) VALUES ('offices_migrated', '1')").run();
}

module.exports = { db, tx, getSettings, DATA_DIR, UPLOAD_DIR };
