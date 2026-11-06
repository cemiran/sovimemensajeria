// Datos de demostración: node server/seed.js  (añade --reset para borrar la base)
const fs = require('fs');
const path = require('path');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (process.argv.includes('--reset')) {
  // Protección: una base marcada como en operación real no se borra sin confirmación explícita
  const dbFile = path.join(DATA_DIR, 'ultimamilla.db');
  if (fs.existsSync(dbFile)) {
    const { DatabaseSync } = require('node:sqlite');
    const chk = new DatabaseSync(dbFile, { readOnly: true });
    let prod = null;
    try { prod = chk.prepare("SELECT value FROM settings WHERE key='production_since'").get()?.value; } catch {}
    chk.close();
    if (prod && !process.argv.includes('--borrar-datos-reales')) {
      console.error(`ALTO: esta base está en operación real desde ${prod}. seed:reset borraría pedidos, clientes, inventario y configuración.`);
      console.error('Si de verdad quieres borrarla, respalda data/ y ejecuta: npm run seed:reset -- --borrar-datos-reales');
      process.exit(1);
    }
  }
  for (const f of ['ultimamilla.db', 'ultimamilla.db-wal', 'ultimamilla.db-shm']) fs.rmSync(path.join(DATA_DIR, f), { force: true });
}
const bcrypt = require('bcryptjs');
const { db, tx, getSettings } = require('./db');
const { optimizeRoute } = require('./routing');

if (db.prepare('SELECT COUNT(*) c FROM users').get().c > 0) {
  console.log('La base ya tiene datos. Usa: npm run seed -- --reset');
  process.exit(0);
}

let seed = 42;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const day = (offset) => new Date(Date.now() + offset * 864e5).toLocaleDateString('en-CA');

function ean13(base) {
  const d = String(base).padStart(12, '0').slice(0, 12);
  let s = 0;
  for (let i = 0; i < 12; i++) s += Number(d[i]) * (i % 2 ? 3 : 1);
  return d + ((10 - (s % 10)) % 10);
}

tx(() => {
  const addUser = db.prepare('INSERT INTO users (name, email, password_hash, role, phone, vehicle, capacity) VALUES (?,?,?,?,?,?,?)');
  addUser.run('Administrador', 'admin@demo.com', bcrypt.hashSync('admin123', 10), 'admin', '5550000000', null, 0);
  addUser.run('Laura Despacho', 'despacho@demo.com', bcrypt.hashSync('despacho123', 10), 'despachador', '5550000001', null, 0);
  const drivers = [
    ['Carlos Méndez', 'Moto 01', 25],
    ['Ana Torres', 'Van 02', 45],
    ['Jorge Ruiz', 'Moto 03', 25],
    ['Sofía Ramírez', 'Van 04', 45],
  ];
  const driverIds = drivers.map(([n, v, cap], i) =>
    Number(addUser.run(n, `chofer${i + 1}@demo.com`, bcrypt.hashSync('chofer123', 10), 'repartidor', `55511100${i}`, v, cap).lastInsertRowid)
  );

  const prods = [
    ['Router WiFi 6 AX1800', 'RT-AX18', 'A1-01'], ['Módem fibra ONT GPON', 'ONT-G01', 'A1-02'], ['Repetidor WiFi Mesh', 'MESH-02', 'A1-03'],
    ['Decodificador 4K', 'DEC-4K', 'A2-01'], ['Cable Ethernet Cat6 5m', 'CAT6-5', 'B1-01'], ['Smartphone gama media', 'SPH-M1', 'C1-01'],
    ['Tablet 10"', 'TAB-10', 'C1-02'], ['Audífonos Bluetooth', 'AUD-BT', 'C2-01'], ['Cargador USB-C 30W', 'CHG-30', 'C2-02'],
    ['SIM Card prepago', 'SIM-PRE', 'D1-01'], ['Kit instalación fibra', 'KIT-FIB', 'B2-01'], ['Smart TV 50"', 'TV-50', 'E1-01'],
    ['Bocina inteligente', 'SPK-SM', 'C3-01'], ['Cámara de seguridad WiFi', 'CAM-WF', 'A3-01'], ['Switch 8 puertos', 'SW-8P', 'A3-02'],
    ['Power bank 10000mAh', 'PWB-10', 'C2-03'], ['Funda universal', 'FND-UN', 'D2-01'], ['Control remoto', 'CTRL-R', 'A2-02'],
  ];
  const addProd = db.prepare('INSERT INTO products (sku, barcode, name, stock, min_stock, location, weight_kg) VALUES (?,?,?,?,?,?,?)');
  const addMov = db.prepare('INSERT INTO inventory_movements (product_id, type, qty, stock_after, reference, user_id) VALUES (?,?,?,?,?,1)');
  const prodIds = prods.map(([name, sku, loc], i) => {
    const stock = 40 + Math.floor(rnd() * 160);
    const id = Number(addProd.run(sku, ean13(750100000000 + i * 137), name, stock, 15, loc, +(0.2 + rnd() * 4).toFixed(1)).lastInsertRowid);
    addMov.run(id, 'entrada', stock, stock, 'Inventario inicial');
    return id;
  });
  // Un par con stock bajo para mostrar alertas
  db.prepare('UPDATE products SET stock = 6 WHERE id = ?').run(prodIds[11]);
  db.prepare('UPDATE products SET stock = 9 WHERE id = ?').run(prodIds[6]);

  const s = getSettings();
  const depot = { lat: Number(s.depot_lat), lng: Number(s.depot_lng) };
  const first = ['María', 'José', 'Guadalupe', 'Juan', 'Fernanda', 'Luis', 'Daniela', 'Miguel', 'Valeria', 'Pedro', 'Camila', 'Ricardo', 'Paola', 'Eduardo', 'Andrea', 'Raúl'];
  const last = ['García', 'Hernández', 'López', 'Martínez', 'González', 'Pérez', 'Sánchez', 'Romero', 'Flores', 'Vargas', 'Castillo', 'Jiménez'];
  const streets = ['Av. Insurgentes Sur', 'Calle Durango', 'Av. Álvaro Obregón', 'Calle Tonalá', 'Av. Cuauhtémoc', 'Calle Medellín', 'Av. Revolución', 'Calle Puebla', 'Av. Universidad', 'Calle Amsterdam', 'Av. Coyoacán', 'Calle Orizaba'];
  const zips = ['06700', '06600', '03100', '06100', '03020', '06140', '11000', '04000'];
  const addCust = db.prepare('INSERT INTO customers (name, phone, email, address, reference, city, zip, lat, lng, window_start, window_end, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
  const custIds = [];
  for (let i = 0; i < 80; i++) {
    const n = `${pick(first)} ${pick(last)}`;
    const ang = rnd() * Math.PI * 2;
    const r = 0.01 + rnd() * 0.07; // ~1-8 km
    const hasWin = rnd() < 0.35;
    const ws = hasWin ? pick(['09:00', '10:00', '12:00', '14:00']) : null;
    const we = hasWin ? `${String(Number(ws.slice(0, 2)) + 3).padStart(2, '0')}:00` : null;
    custIds.push(
      Number(
        addCust.run(n, `55${Math.floor(10000000 + rnd() * 89999999)}`, `${n.split(' ')[0].toLowerCase()}${i}@correo.mx`,
          `${pick(streets)} ${Math.floor(10 + rnd() * 990)}`, rnd() < 0.4 ? pick(['Portón negro', 'Edificio B, depto 302', 'Frente a farmacia', 'Casa con fachada azul']) : null,
          'Ciudad de México', pick(zips), +(depot.lat + Math.sin(ang) * r).toFixed(6), +(depot.lng + Math.cos(ang) * r * 1.1).toFixed(6), ws, we, null
        ).lastInsertRowid
      )
    );
  }

  const addOrder = db.prepare(
    "INSERT INTO orders (tracking_code, customer_id, status, priority, scheduled_date, driver_id, route_id, stop_seq, eta, leg_km, delivered_at, attempts, created_by, cod_amount) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,2,?)"
  );
  const addItem = db.prepare('INSERT INTO order_items (order_id, product_id, qty) VALUES (?,?,?)');
  const addEv = db.prepare(
    'INSERT INTO evidences (order_id, driver_id, result, receiver_name, receiver_relation, reason, barcode_verified, lat, lng, distance_to_customer_m, created_at) VALUES (?,?,?,?,?,?,1,?,?,?,?)'
  );
  const addRoute = db.prepare(
    "INSERT INTO routes (name, driver_id, date, status, depot_lat, depot_lng, distance_km, original_distance_km, est_minutes, started_at, finished_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
  );
  const custById = Object.fromEntries(db.prepare('SELECT id, lat, lng, window_start, window_end, name FROM customers').all().map((c) => [c.id, c]));
  let seqCode = 1000;
  const reasons = ['Cliente ausente', 'Dirección incorrecta', 'Rechazado por cliente', 'Zona de riesgo / sin acceso'];

  // Historial: últimos 10 días con rutas completadas
  for (let d = -10; d <= -1; d++) {
    const date = day(d);
    driverIds.forEach((drv, k) => {
      const nStops = 8 + Math.floor(rnd() * 10);
      const cs = Array.from({ length: nStops }, () => pick(custIds));
      const stops = cs.map((cid, i) => ({ id: i, lat: custById[cid].lat, lng: custById[cid].lng, priority: 'normal' }));
      const opt = optimizeRoute(depot, stops, s);
      const startH = 9;
      const dur = opt.est_minutes * (0.9 + rnd() * 0.4);
      const started = `${date} ${String(startH + 6).padStart(2, '0')}:00:00`; // UTC aprox (CDMX -6)
      const finished = new Date(Date.parse(started.replace(' ', 'T') + 'Z') + dur * 60000).toISOString().replace('T', ' ').slice(0, 19);
      const rid = Number(addRoute.run(`Ruta ${drivers[k][0]} ${date}`, drv, date, 'completada', depot.lat, depot.lng, opt.distance_km, opt.original_distance_km, opt.est_minutes, started, finished).lastInsertRowid);
      opt.sequence.forEach((st) => {
        const cid = cs[st.id];
        const c = custById[cid];
        const ok = rnd() > 0.09 + k * 0.025;
        const [eh, em] = st.eta.split(':').map(Number);
        const when = new Date(Date.parse(`${date}T00:00:00Z`) + ((eh + 6) * 60 + em + Math.floor(rnd() * 25)) * 60000).toISOString().replace('T', ' ').slice(0, 19);
        const oid = Number(addOrder.run(`UM${seqCode++}`, cid, ok ? 'entregado' : 'fallido', 'normal', date, drv, rid, st.seq, st.eta, st.leg_km, when, 1, 0).lastInsertRowid);
        addItem.run(oid, pick(prodIds), 1 + Math.floor(rnd() * 2));
        const dev = Math.round(5 + rnd() * (ok ? 60 : 200));
        addEv.run(oid, drv, ok ? 'entregado' : 'fallido', ok ? c.name : null, ok ? pick(['Titular', 'Familiar', 'Vecino', 'Recepción']) : null,
          ok ? null : pick(reasons), c.lat + 0.0002, c.lng - 0.0002, dev, when);
      });
    });
  }

  // Pendientes de hoy (para planificar rutas en la demo)
  for (let i = 0; i < 48; i++) {
    const cid = custIds[i % custIds.length];
    const oid = Number(addOrder.run(`UM${seqCode++}`, cid, 'pendiente', rnd() < 0.12 ? 'alta' : 'normal', day(0), null, null, null, null, null, null, 0, rnd() < 0.2 ? Math.round(200 + rnd() * 2500) : 0).lastInsertRowid);
    const items = 1 + Math.floor(rnd() * 2);
    for (let j = 0; j < items; j++) {
      const pid = pick(prodIds);
      const q = 1;
      addItem.run(oid, pid, q);
      const st = db.prepare('SELECT stock FROM products WHERE id=?').get(pid).stock;
      if (st > q) {
        db.prepare('UPDATE products SET stock = stock - ? WHERE id=?').run(q, pid);
        addMov.run(pid, 'salida', -q, st - q, `Pedido UM${seqCode - 1}`);
      }
    }
  }
});

console.log(`Datos de demostración creados.
  Admin:        admin@demo.com / admin123
  Despachador:  despacho@demo.com / despacho123
  Repartidores: chofer1@demo.com … chofer4@demo.com / chofer123`);
