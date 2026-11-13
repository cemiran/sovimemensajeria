// Notificaciones al cliente final (SMS, WhatsApp, correo) y registro de entregas en Google Sheets.
// Todo pasa por una cola en la base de datos: si un proveedor falla, se reintenta sin bloquear la operación.
// Sin credenciales configuradas, cada canal trabaja en "simulación": el mensaje se guarda pero no sale.
const { db, getSettings } = require('./db');

const EVENTS = {
  registrado: 'Pedido registrado',
  en_camino: 'En camino',
  proximo: 'Repartidor cerca',
  entregado: 'Entregado',
  fallido: 'No entregado',
};
const CHANNELS = ['sms', 'whatsapp', 'email'];
const SECRET_KEYS = ['twilio_token', 'wa_token', 'smtp_pass', 'sheets_secret', 'sms_android_pass', 'sms2_pass', 'sms3_pass'];
const INTEGRATION_KEYS = [
  'public_url', 'phone_country', 'notif_enabled', 'notif_matrix', 'notif_test_to', 'notif_test_email',
  ...Object.keys(EVENTS).map((e) => 'tpl_' + e),
  'sms_provider', 'twilio_sid', 'twilio_token', 'twilio_from', 'twilio_wa_from',
  'sms_android_mode', 'sms_android_url', 'sms_android_user', 'sms_android_pass', 'sms_android_name', 'sms_daily_cap_per_device',
  ...[2, 3].flatMap((i) => [`sms${i}_enabled`, `sms${i}_name`, `sms${i}_mode`, `sms${i}_url`, `sms${i}_user`, `sms${i}_pass`]),
  'notif_driver_phone_date', 'wa_provider', 'wa_token', 'wa_phone_id', 'wa_daily_cap', 'wa1_name', 'wa2_name', 'wa3_name', 'wa2_enabled', 'wa3_enabled',
  'email_provider', 'smtp_host', 'smtp_port', 'smtp_secure', 'smtp_user', 'smtp_pass', 'smtp_from',
  'sheets_enabled', 'sheets_url', 'sheets_secret',
];
const MAX_ATTEMPTS = 4;

const baseUrl = (s) => (s.public_url || `http://localhost:${process.env.PORT || 3000}`).replace(/\/+$/, '');
const trackLink = (s, token) => `${baseUrl(s)}/t/${token}`;
const fmtDate = (d) => {
  if (!d) return '';
  const x = new Date(String(d).length <= 10 ? d + 'T12:00:00' : String(d).replace(' ', 'T') + (String(d).includes('Z') ? '' : 'Z'));
  return x.toLocaleString('es-MX', String(d).length <= 10 ? { dateStyle: 'long' } : { dateStyle: 'medium', timeStyle: 'short' });
};
function matrix(s) {
  try { return JSON.parse(s.notif_matrix || '{}'); } catch { return {}; }
}
function phoneE164(raw, country = '52') {
  const d = String(raw || '').replace(/\D/g, '');
  if (!d) return null;
  if (String(raw).trim().startsWith('+')) return '+' + d;
  if (d.length === 10) return `+${country}${d}`;
  if (d.length > 10) return '+' + d;
  return null;
}
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || ''));

function render(tpl, vars) {
  return String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null && vars[k] !== '' ? String(vars[k]) : k === 'eta' ? 'hoy' : ''));
}
function orderVars(orderId, extra = {}) {
  const o = db
    .prepare(
      `SELECT o.*, c.name cname, c.phone cphone, c.external_id ctelnor, c.email cemail, c.notify_sms, c.notify_email, c.notify_whatsapp, u.name dname
       FROM orders o JOIN customers c ON c.id=o.customer_id LEFT JOIN users u ON u.id=o.driver_id WHERE o.id=?`
    )
    .get(orderId);
  if (!o) return null;
  const ev = db.prepare('SELECT * FROM evidences WHERE order_id=? ORDER BY id DESC LIMIT 1').get(orderId);
  const s = getSettings();
  return {
    o, s,
    vars: {
      cliente: String(o.cname || '').split(/\s+/)[0],
      cliente_completo: o.cname,
      guia: o.tracking_code,
      empresa: s.company_name || 'Sovime Mensajería',
      fecha: fmtDate(o.scheduled_date),
      eta: o.eta || '',
      repartidor: String(o.dname || 'Tu repartidor').split(/\s+/)[0],
      recibio: ev?.receiver_name || '',
      motivo: ev?.reason || '',
      fecha_entrega: fmtDate(o.delivered_at),
      link: trackLink(s, o.public_token),
      ...extra,
    },
  };
}

const EMAIL_SUBJECT = {
  registrado: 'Registramos tu envío {guia}',
  en_camino: 'Tu paquete {guia} va en camino',
  proximo: 'Tu repartidor está por llegar',
  entregado: 'Tu paquete {guia} fue entregado',
  fallido: 'No pudimos entregar tu paquete {guia}',
};

/** Encola los mensajes de un evento según la matriz evento×canal y las preferencias del cliente. */
function queueEvent(event, orderId, extra = {}, { force = false, channels = null } = {}) {
  try {
    if (!EVENTS[event]) return 0;
    const d = orderVars(orderId, extra);
    if (!d) return 0;
    const { o, s, vars } = d;
    if (s.notif_enabled !== '1' && !force) return 0;
    // ese día los SMS y WhatsApp los manda el repartidor desde su teléfono (el correo sigue saliendo)
    // "siempre" = de forma permanente; una fecha = solo ese día
    const driverDay = !force && (s.notif_driver_phone_date === 'siempre' || (s.notif_driver_phone_date && s.notif_driver_phone_date === new Date().toLocaleDateString('en-CA')));
    // "Repartidor cerca" solo una vez por pedido
    if (event === 'proximo' && !force && db.prepare("SELECT 1 FROM messages WHERE order_id=? AND event='proximo' LIMIT 1").get(o.id)) return 0;
    const mx = matrix(s)[event] || {};
    const body = render(s['tpl_' + event], vars);
    const ins = db.prepare(
      'INSERT INTO messages (order_id, customer_id, event, channel, recipient, subject, body) VALUES (?,?,?,?,?,?,?)'
    );
    let n = 0;
    for (const ch of channels || CHANNELS) {
      if (!channels && !Number(mx[ch])) continue;
      if (!Number(o['notify_' + ch])) continue;
      if (driverDay && ch !== 'email') continue;
      // SMS y WhatsApp: solo al TELÉFONO MÓVIL del cliente (nunca al adicional ni a la línea Telnor, que es fija)
      const last10 = (x) => String(x || '').replace(/\D/g, '').slice(-10);
      if (ch !== 'email' && last10(o.cphone) && last10(o.cphone) === last10(o.ctelnor)) continue;
      const to = ch === 'email' ? (validEmail(o.cemail) ? o.cemail : null) : phoneE164(o.cphone, s.phone_country);
      if (!to) continue;
      ins.run(o.id, o.customer_id, event, ch, to, ch === 'email' ? render(EMAIL_SUBJECT[event], vars) : null, body);
      n++;
    }
    if (n) setImmediate(processQueue);
    return n;
  } catch (e) {
    console.error('queueEvent', e);
    return 0;
  }
}

// ---------- Proveedores ----------
async function postForm(url, form, headers) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(form), signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message || j.error?.message || `HTTP ${r.status}`);
  return j;
}
const basic = (u, p) => 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64');

// SMS desde un teléfono Android propio con la app "SMS Gateway for Android" (sms-gate.app):
// modo nube (api.sms-gate.app, el teléfono solo necesita internet) o modo local (IP del teléfono en la misma red).
// Líneas de SMS: cada una es una cuenta de SMS Gateway (uno o varios teléfonos). La 1 es la configuración de siempre.
function smsAccounts(s) {
  const out = [];
  if (s.sms_android_user && s.sms_android_pass) out.push({ ch: 1, name: s.sms_android_name || 'Línea 1', mode: s.sms_android_mode, url: s.sms_android_url, user: s.sms_android_user, pass: s.sms_android_pass });
  for (const i of [2, 3]) if (s[`sms${i}_enabled`] === '1' && s[`sms${i}_user`] && s[`sms${i}_pass`])
    out.push({ ch: i, name: s[`sms${i}_name`] || `Línea ${i}`, mode: s[`sms${i}_mode`], url: s[`sms${i}_url`], user: s[`sms${i}_user`], pass: s[`sms${i}_pass`] });
  return out;
}
const smsBase = (a) => (a.mode === 'local' ? String(a.url || '').replace(/\/+$/, '') : 'https://api.sms-gate.app');
// Teléfonos conectados a cada cuenta (se consulta cada 2 min)
const devCache = new Map();
async function smsDevices(s) {
  if (s.sms_provider !== 'android') return [];
  const all = [];
  for (const a of smsAccounts(s)) {
    const key = `${a.ch}|${a.user}`;
    let c = devCache.get(key);
    if (!c || Date.now() - c.at > 120000) {
      try {
        const r = await fetch(`${smsBase(a)}/3rdparty/v1/devices`, { headers: { Authorization: basic(a.user, a.pass) }, signal: AbortSignal.timeout(10000) });
        if (r.ok) { c = { at: Date.now(), list: (await r.json()).map((d) => ({ id: d.id, name: d.name, lastSeen: d.lastSeen })) }; devCache.set(key, c); }
      } catch {}
    }
    for (const d of c?.list || []) all.push({ ...d, ch: a.ch, line: a.name, acc: a });
  }
  return all;
}
// uso de hoy de cada teléfono (para la pantalla de Mensajes)
async function smsDeviceStats() {
  const s = getSettings();
  const cap = Number(s.sms_daily_cap_per_device) || 300;
  const devs = await smsDevices(s);
  return devs.map(({ acc, ...d }) => ({ ...d, cap,
    today: db.prepare("SELECT COUNT(*) n FROM messages WHERE channel='sms' AND gw_device=? AND date(sent_at,'localtime') = date('now','localtime')").get(d.id).n,
    online: !d.lastSeen || Date.now() - Date.parse(d.lastSeen) < 30 * 60000 }));
}
async function sendAndroidSMS(s, to, body, deviceId, acc) {
  acc ||= smsAccounts(s)[0] || { mode: s.sms_android_mode, url: s.sms_android_url, user: s.sms_android_user, pass: s.sms_android_pass };
  // México: el "1" después del 52 solo lo usa WhatsApp; para SMS se marca +52 + 10 dígitos
  if (/^\+521\d{10}$/.test(to)) to = '+52' + to.slice(-10);
  if (!acc.user || !acc.pass) throw new Error('Faltan usuario y contraseña de SMS Gateway (pantalla principal de la app)');
  const base = smsBase(acc);
  if (!/^https?:\/\/\S+$/.test(base)) throw new Error('Escribe la dirección local del teléfono, p. ej. http://192.168.1.50:8080');
  const post = (dev) => fetch(`${base}/3rdparty/v1/messages`, {
    method: 'POST',
    headers: { Authorization: basic(acc.user, acc.pass), 'Content-Type': 'application/json' },
    body: JSON.stringify({ phoneNumbers: [to], textMessage: { text: body }, ...(dev ? { deviceId: dev } : {}) }),
    signal: AbortSignal.timeout(20000),
  });
  let r = await post(deviceId);
  // si SMS Gateway no acepta el teléfono elegido, se manda sin elegir (lo reparte la propia cuenta)
  if (deviceId && r.status >= 400 && r.status < 500 && r.status !== 401) r = await post(null);
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) throw new Error('Usuario o contraseña de SMS Gateway incorrectos');
  if (!r.ok) throw new Error(j.message || j.error || `SMS Gateway respondió HTTP ${r.status}`);
  return { ref: j.id };
}
async function sendSMS(s, to, body, deviceId, acc) {
  if (s.sms_provider === 'android') return sendAndroidSMS(s, to, body, deviceId, acc);
  if (s.sms_provider !== 'twilio') return { simulated: true };
  if (!s.twilio_sid || !s.twilio_token || !s.twilio_from) throw new Error('Faltan datos de Twilio (SID, token o número)');
  const j = await postForm(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(s.twilio_sid)}/Messages.json`,
    { To: to, From: s.twilio_from, Body: body }, { Authorization: basic(s.twilio_sid, s.twilio_token) });
  return { ref: j.sid };
}
async function sendWhatsApp(s, to, body) {
  if (s.wa_provider === 'qr') {
    const wa = require('./wa');
    const cap = Math.max(1, Number(s.wa_daily_cap) || 200);
    const on = wa.SLOTS.filter((i) => (i === 1 || s[`wa${i}_enabled`] === '1') && wa.status(i).status === 'conectado')
      .map((i) => ({ i, today: db.prepare("SELECT COUNT(*) n FROM messages WHERE channel='whatsapp' AND gw_channel=? AND date(sent_at,'localtime') = date('now','localtime')").get('wa' + i).n }));
    if (!on.length) throw new Error('Ningún número de WhatsApp está conectado: vincúlalo escaneando el QR en Configuración');
    const pick = on.filter((x) => x.today < cap).sort((a, b) => a.today - b.today)[0];
    if (!pick) throw new Error(`Los números de WhatsApp llegaron a su tope de ${cap} mensajes hoy`);
    return { ...(await wa.sendText(to, body, pick.i)), gwch: 'wa' + pick.i };
  }
  if (s.wa_provider === 'twilio') {
    if (!s.twilio_sid || !s.twilio_token || !s.twilio_wa_from) throw new Error('Faltan datos de Twilio WhatsApp');
    const from = s.twilio_wa_from.startsWith('whatsapp:') ? s.twilio_wa_from : 'whatsapp:' + s.twilio_wa_from;
    const j = await postForm(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(s.twilio_sid)}/Messages.json`,
      { To: 'whatsapp:' + to, From: from, Body: body }, { Authorization: basic(s.twilio_sid, s.twilio_token) });
    return { ref: j.sid };
  }
  if (s.wa_provider === 'meta') {
    if (!s.wa_token || !s.wa_phone_id) throw new Error('Faltan token o Phone number ID de WhatsApp Cloud API');
    const r = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(s.wa_phone_id)}/messages`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + s.wa_token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: to.replace('+', ''), type: 'text', text: { preview_url: true, body } }),
      signal: AbortSignal.timeout(15000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error?.message || `HTTP ${r.status}`);
    return { ref: j.messages?.[0]?.id };
  }
  return { simulated: true };
}
let mailer = null;
let mailerKey = '';
function emailHtml(s, subject, body) {
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const linkRe = /(https?:\/\/[^\s]+)/g;
  const link = (String(body).match(linkRe) || [])[0];
  const text = esc(String(body).replace(linkRe, '').trim());
  return `<!doctype html><html><body style="margin:0;background:#f5f7fa;font-family:Arial,Helvetica,sans-serif;color:#1b2430">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
  <table role="presentation" width="100%" style="max-width:520px;background:#fff;border-radius:14px;border:1px solid #dde3ea">
  <tr><td style="padding:22px 24px 6px" align="center"><img src="${baseUrl(s)}/img/logo.png" alt="${esc(s.company_name || 'Sovime Mensajería')}" width="170" style="display:block;border:0"></td></tr>
  <tr><td style="padding:10px 24px 0"><h2 style="margin:0 0 10px;font-size:19px">${esc(subject)}</h2><p style="margin:0;font-size:15px;line-height:1.5">${text}</p></td></tr>
  ${link ? `<tr><td style="padding:20px 24px" align="center"><a href="${esc(link)}" style="background:#1d5a96;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:bold;display:inline-block">Ver mi envío</a></td></tr>` : ''}
  <tr><td style="padding:14px 24px 20px;border-top:1px solid #eef2f7;font-size:12px;color:#5f6b7a" align="center">${esc(s.company_name || 'Sovime Mensajería')} · Mensaje automático sobre tu envío</td></tr>
  </table></td></tr></table></body></html>`;
}
async function sendEmail(s, to, subject, body) {
  if (s.email_provider !== 'smtp') return { simulated: true };
  if (!s.smtp_host || !s.smtp_from) throw new Error('Faltan servidor SMTP o remitente');
  const key = [s.smtp_host, s.smtp_port, s.smtp_secure, s.smtp_user, s.smtp_pass].join('|');
  if (!mailer || key !== mailerKey) {
    const nodemailer = require('nodemailer');
    mailer = nodemailer.createTransport({
      host: s.smtp_host, port: Number(s.smtp_port) || 587, secure: s.smtp_secure === '1',
      auth: s.smtp_user ? { user: s.smtp_user, pass: s.smtp_pass } : undefined,
      connectionTimeout: 15000, disableFileAccess: true, disableUrlAccess: true,
      // se presenta con el nombre público del servidor (no "127.0.0.1"): los filtros de spam lo revisan
      name: (() => { try { return new URL(baseUrl(s)).hostname; } catch { return undefined; } })(),
    });
    mailerKey = key;
  }
  // remitente con nombre de la empresa: "Sovime Mensajería <telnor@…>" (Gmail desconfía menos que de una dirección sola)
  const from = s.smtp_from.includes('<') ? s.smtp_from : { name: s.company_name || 'Sovime Mensajería', address: s.smtp_from };
  const info = await mailer.sendMail({ from, replyTo: s.company_email || undefined, to, subject, text: body, html: emailHtml(s, subject, body) });
  return { ref: info.messageId };
}
async function deliver(s, m, { direct = false } = {}) {
  // Modo de prueba: todo se desvía al teléfono/correo del administrador (salvo pruebas manuales con destino explícito)
  const tPhone = phoneE164(s.notif_test_to, s.phone_country);
  const tMail = validEmail(s.notif_test_email) ? s.notif_test_email : null;
  if (!direct && (tPhone || tMail)) {
    const to = m.channel === 'email' ? tMail : tPhone;
    if (!to) return { simulated: true };
    if (to !== m.recipient) m = { ...m, recipient: to, body: `[PRUEBA · era para ${m.recipient}]
${m.body}` };
  }
  if (m.channel === 'sms') return sendSMS(s, m.recipient, m.body, m.device, m.acc);
  if (m.channel === 'whatsapp') return sendWhatsApp(s, m.recipient, m.body);
  return sendEmail(s, m.recipient, m.subject || s.company_name, m.body);
}

// ---------- Google Sheets (Apps Script Web App) ----------
// Formato de la hoja "Entregas" de Sovime (orden definido por el usuario en la hoja): teléfonos Telnor D, móvil E, adicional F,
// números de serie G; el Dashboard cuenta Estatus en J y Repartidor en K; la evidencia a partir de la M.
// Las columnas se escriben por posición: si se cambia el orden aquí, hay que mover la columna en la hoja igual (y viceversa).
const SHEET_NAME = 'Entregas';
const SHEET_HEADERS = ['ID de Rastreo', 'Fecha y Hora', 'Cliente', 'Teléfono Telnor', 'Teléfono móvil', 'Teléfono adicional', 'Números de serie',
  'Dirección', 'Zona', 'Estatus', 'Repartidor', 'Notas',
  'Recibió', 'Parentesco', 'Identificación', 'Tipo de entrega', 'Motivo', 'Ruta', 'Latitud', 'Longitud', 'Distancia al domicilio (m)',
  'Escaneo verificado', 'Cobro', 'Foto', 'Firma', 'Comprobante',
  'Tipo de envío', 'Temperatura (°C)', 'En rango', 'Sello / precinto', 'Unidad (placas)', 'Checklist de unidad', 'Recurso confiable'];
function fmtPhone(p) {
  const d = String(p || '').replace(/\D/g, '');
  return d.length === 10 ? `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6)}` : String(p || '');
}
// Zona respecto al almacén: Centro (< 3 km) o Norte/Sur/Oriente/Poniente según la dirección
function zoneOf(s, lat, lng) {
  const dl = Number(s.depot_lat), dg = Number(s.depot_lng);
  if (lat == null || lng == null || !Number.isFinite(dl)) return '';
  const dy = (lat - dl) * 111.32;
  const dx = (lng - dg) * 111.32 * Math.cos((dl * Math.PI) / 180);
  if (Math.hypot(dx, dy) < 3) return 'Centro';
  return Math.abs(dy) >= Math.abs(dx) ? (dy > 0 ? 'Norte' : 'Sur') : dx > 0 ? 'Oriente' : 'Poniente';
}
function sheetRow(evidenceId) {
  const e = db
    .prepare(
      `SELECT e.*, o.tracking_code, o.cod_amount, o.public_token, c.name cname, c.phone cphone, c.phone_alt cphone2, c.external_id ctelnor, c.address, c.lat clat, c.lng clng,
              u.name dname, r.name rname
       FROM evidences e JOIN orders o ON o.id=e.order_id JOIN customers c ON c.id=o.customer_id
       LEFT JOIN users u ON u.id=e.driver_id LEFT JOIN routes r ON r.id=o.route_id WHERE e.id=?`
    )
    .get(evidenceId);
  if (!e) return null;
  const s = getSettings();
  const up = (p) => (p ? `${baseUrl(s)}/uploads/${p}` : '');
  const ok = e.result === 'entregado';
  const counter = e.kind === 'mostrador';
  const note = e.notes || (ok ? `Recibió ${e.receiver_name || ''}${e.receiver_relation ? ' (' + e.receiver_relation + ')' : ''}${counter ? ' en mostrador' : ''}` : `Motivo: ${e.reason || ''}`);
  const iso = new Date(String(e.created_at).replace(' ', 'T') + 'Z').toISOString();
  return [
    e.tracking_code, iso, e.cname, fmtPhone(e.ctelnor), fmtPhone(e.cphone), fmtPhone(e.cphone2),
    db.prepare('SELECT GROUP_CONCAT(serial, \', \') sn FROM (SELECT serial FROM serials WHERE order_id = ? ORDER BY serial)').get(e.order_id)?.sn || '',
    e.address, counter ? 'Mostrador' : zoneOf(s, e.clat, e.clng),
    ok ? 'Entregado' : 'No Entregado', counter ? (e.dname ? `${e.dname} (mostrador)` : 'Mostrador') : e.dname || '', note,
    e.receiver_name || '', e.receiver_relation || '', e.receiver_id_doc || '', counter ? 'Mostrador' : 'En ruta', e.reason || '', e.rname || '',
    e.lat ?? '', e.lng ?? '', e.distance_to_customer_m ?? '', e.barcode_verified ? 'Sí' : 'No', e.cod_amount || 0,
    up(e.photo_path), up(e.signature_path), trackLink(s, e.public_token),
    ...(() => {
      let c = null;
      try { c = JSON.parse(e.compliance_json || 'null'); } catch {}
      if (!c) return ['', '', '', '', '', '', ''];
      const yn = (v) => (v == null ? '' : v ? 'Sí' : 'No');
      const types = { general: 'General', medicamento: 'Medicamento', muestra: 'Muestra biológica', dispositivo: 'Dispositivo médico', refrigerado: 'Refrigerado' };
      return [types[c.shipment_type] || '', c.temp_c ?? '', yn(c.temp_in_range), c.seal_number ? `${c.seal_number}${c.seal_ok == null ? '' : c.seal_ok ? ' (íntegro)' : ' (dañado)'}` : yn(c.seal_ok),
        c.vehicle?.plates || '', c.check ? (c.check.passed ? 'Aprobado' : 'Con observaciones') : '', c.trusted ? `${c.trusted.folio}${c.trusted.valid ? '' : ' (vencido)'}` : ''];
    })(),
  ];
}
function queueSheet(evidenceId, orderId) {
  try {
    db.prepare('INSERT OR IGNORE INTO sheet_sync (evidence_id, order_id) VALUES (?,?)').run(evidenceId, orderId);
    setImmediate(processQueue);
  } catch (e) {
    console.error('queueSheet', e);
  }
}
async function postSheet(s, payload) {
  if (!s.sheets_url) throw new Error('Falta la URL de la Web App de Google Apps Script');
  if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(s.sheets_url)) throw new Error('La URL debe ser de script.google.com');
  const r = await fetch(s.sheets_url, {
    method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow',
    body: JSON.stringify({ secret: s.sheets_secret || '', sheet: SHEET_NAME, headers: SHEET_HEADERS, ...payload }), signal: AbortSignal.timeout(20000),
  });
  const txt = await r.text();
  let j = null;
  try { j = JSON.parse(txt); } catch {}
  if (!r.ok || !j?.ok) {
    if (j?.error) throw new Error(j.error);
    if (/accounts\.google\.com|ServiceLogin/i.test(txt)) throw new Error('Google pide iniciar sesión: en la implementación elige acceso "Cualquier persona"');
    throw new Error(txt.includes('<html') ? 'La Web App no respondió JSON: revisa que esté implementada como Aplicación web' : `HTTP ${r.status}`);
  }
  return j;
}
// Script de Google Apps Script con la clave real (lo entrega el servidor solo al administrador)
function appsScript(secret, company) {
  return `// ${company || 'Sovime Mensajería'} → Google Sheets (registro de entregas)
// Pega este código en la hoja: Extensiones > Apps Script. Guarda y luego:
// Implementar > Nueva implementación > Tipo: Aplicación web
//   Ejecutar como: Yo   ·   Quién tiene acceso: Cualquier persona
// Copia la URL que termina en /exec y pégala en la app (Configuración > Google Sheets).
const CLAVE = '${String(secret || '').replace(/'/g, '')}';

function doPost(e) {
  const out = (o) => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
  const lock = LockService.getScriptLock();
  try {
    const d = JSON.parse(e.postData.contents);
    if (!CLAVE || d.secret !== CLAVE) return out({ ok: false, error: 'Clave incorrecta: la clave del script no coincide con la de la app' });
    lock.waitLock(20000);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName(d.sheet || 'Entregas') || ss.insertSheet(d.sheet || 'Entregas');
    // Encabezados: respeta los existentes y solo completa las columnas vacías
    const width = d.headers.length;
    if (sh.getMaxColumns() < width) sh.insertColumnsAfter(sh.getMaxColumns(), width - sh.getMaxColumns());
    const head = sh.getRange(1, 1, 1, width).getValues()[0];
    let changed = false;
    for (let i = 0; i < width; i++) if (!head[i]) { head[i] = d.headers[i]; changed = true; }
    if (changed) {
      sh.getRange(1, 1, 1, width).setValues([head]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
    if (d.test) return out({ ok: true, test: true, sheet: sh.getName(), rows: Math.max(0, sh.getLastRow() - 1) });
    const row = d.row.slice();
    row[1] = new Date(row[1]); // Fecha y Hora como fecha real de Sheets
    // Si la guía ya está en la hoja, actualiza esa fila; si no, agrega una nueva
    const last = sh.getLastRow();
    let target = 0;
    if (last > 1) {
      const ids = sh.getRange(2, 1, last - 1, 1).getValues();
      for (let i = ids.length - 1; i >= 0; i--) if (String(ids[i][0]) === String(row[0])) { target = i + 2; break; }
    }
    if (!target) target = last + 1;
    sh.getRange(target, 1, 1, row.length).setValues([row]);
    sh.getRange(target, 2).setNumberFormat('yyyy-mm-dd hh:mm');
    return out({ ok: true, row: target, updated: target <= last });
  } catch (err) {
    return out({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}
`;
}

// ---------- Procesador de la cola ----------
let busy = false;
const retryAt = (n) => `datetime('now', '+${Math.min(60, 2 ** n)} minutes')`;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
// avisos que pierden sentido si se mandan tarde
const STALE_H = { en_camino: 4, proximo: 2 };
async function processQueue() {
  if (busy) return;
  busy = true;
  try {
    const s = getSettings();
    // los más urgentes primero: "está por llegar", luego entregado/no entregado, luego "va en camino"
    const msgs = db.prepare(`SELECT * FROM messages WHERE status='pendiente' AND next_try_at<=datetime('now')
      ORDER BY CASE event WHEN 'prueba' THEN 0 WHEN 'proximo' THEN 1 WHEN 'entregado' THEN 2 WHEN 'fallido' THEN 2 WHEN 'registrado' THEN 4 ELSE 3 END, id LIMIT 40`).all();
    // si el teléfono rechazó SMS por su límite en la última media hora, se baja solo al ritmo seguro (25 por 30 min)
    // (solo rechazos NUEVOS: de SMS mandados en los últimos 30 min)
    const limitHit = db.prepare("SELECT COUNT(*) n FROM messages WHERE channel='sms' AND gw_state='Failed' AND error LIKE 'Teléfono: límite%' AND sent_at >= datetime('now','-30 minutes')").get().n;
    const smsLimit = Math.max(1, limitHit ? Math.min(25, Number(s.sms_limit_30min) || 28) : Number(s.sms_limit_30min) || 28);
    const smsGapMs = Math.max(0, Number(s.sms_gap_seconds ?? 3)) * 1000;
    let smsRecent = db.prepare("SELECT COUNT(*) n FROM messages WHERE channel='sms' AND sent_at >= datetime('now','-30 minutes')").get().n;
    // Varios teléfonos: cada SMS sale por el que lleva menos hoy, sin pasar su tope diario (300) ni su ritmo por media hora.
    // Se reservan los últimos 15 del día de cada línea para los urgentes.
    const cap = Math.max(1, Number(s.sms_daily_cap_per_device) || 300);
    const devs = msgs.some((m) => m.channel === 'sms') ? await smsDevices(s) : [];
    if (devs.length === 1) db.prepare("UPDATE messages SET gw_device=? WHERE channel='sms' AND gw_device IS NULL AND provider_ref IS NOT NULL AND sent_at >= datetime('now','-1 day')").run(devs[0].id);
    const fresh = devs.filter((d) => !d.lastSeen || Date.now() - Date.parse(d.lastSeen) < 30 * 60000);
    const pool = (fresh.length ? fresh : devs).map((d) => {
      const q = (sql) => db.prepare(sql).get(d.id).n;
      const hit = q("SELECT COUNT(*) n FROM messages WHERE channel='sms' AND gw_device=? AND gw_state='Failed' AND error LIKE 'Teléfono: límite%' AND sent_at >= datetime('now','-30 minutes')");
      return { ...d, lim: hit ? Math.min(25, Number(s.sms_limit_30min) || 28) : Number(s.sms_limit_30min) || 28,
        today: q("SELECT COUNT(*) n FROM messages WHERE channel='sms' AND gw_device=? AND date(sent_at,'localtime') = date('now','localtime')"),
        recent: q("SELECT COUNT(*) n FROM messages WHERE channel='sms' AND gw_device=? AND sent_at >= datetime('now','-30 minutes')") };
    });
    const pickDevice = (urgent) => pool.filter((d) => d.today < (urgent ? cap : cap - 15) && (urgent || d.recent < d.lim)).sort((a, b) => a.today - b.today)[0] || null;
    for (const m of msgs) {
      const ageH = (Date.now() - new Date(m.created_at.replace(' ', 'T') + 'Z').getTime()) / 36e5;
      if (STALE_H[m.event] && ageH > STALE_H[m.event]) {
        db.prepare("UPDATE messages SET status='error', error=? WHERE id=?").run(`Vencido: llevaba más de ${STALE_H[m.event]} h en espera y el aviso ya no aplica`, m.id);
        continue;
      }
      if (m.channel === 'sms' && s.sms_provider === 'android') {
        // tope del teléfono: los avisos masivos ("va en camino") esperan a que se libere;
        // los urgentes ("está por llegar", entregado, no entregado, prueba) salen siempre
        const urgent = ['proximo', 'entregado', 'fallido', 'prueba'].includes(m.event);
        if (pool.length) {
          const d = pickDevice(urgent);
          if (!d) continue; // todas las líneas en su tope: espera (los "va en camino" se vencen a las 4 h)
          m.device = d.id; m.acc = d.acc; m.gwch = 'sms' + d.ch; d.today++; d.recent++;
        } else {
          if (!urgent && smsRecent >= smsLimit) continue;
          smsRecent++;
        }
      }
      try {
        const r = await deliver(s, m);
        if (m.channel === 'sms' && smsGapMs && !r.simulated) await pause(smsGapMs);
        db.prepare("UPDATE messages SET status=?, provider_ref=?, attempts=attempts+1, error=NULL, sent_at=datetime('now'), gw_state=NULL, gw_checked_at=NULL, gw_device=?, gw_channel=? WHERE id=?").run(
          r.simulated ? 'simulado' : 'enviado', r.ref || null, m.device || null, r.gwch || m.gwch || null, m.id
        );
      } catch (e) {
        const n = m.attempts + 1;
        db.prepare(`UPDATE messages SET attempts=?, error=?, status=?, next_try_at=${retryAt(n)} WHERE id=?`).run(
          n, String(e.message).slice(0, 300), n >= MAX_ATTEMPTS ? 'error' : 'pendiente', m.id
        );
      }
    }
    const rows = db.prepare("SELECT * FROM sheet_sync WHERE status='pendiente' AND next_try_at<=datetime('now') ORDER BY id LIMIT 25").all();
    for (const it of rows) {
      if (s.sheets_enabled !== '1') {
        db.prepare("UPDATE sheet_sync SET status='desactivado' WHERE id=?").run(it.id);
        continue;
      }
      // la hoja "Entregas" solo lleva lo entregado: los intentos no entregados no se mandan
      const evr = db.prepare('SELECT result FROM evidences WHERE id=?').get(it.evidence_id);
      if (evr && evr.result !== 'entregado') {
        db.prepare("UPDATE sheet_sync SET status='desactivado', error='No entregado: la hoja solo lleva entregas' WHERE id=?").run(it.id);
        continue;
      }
      try {
        const row = sheetRow(it.evidence_id);
        if (!row) throw new Error('Evidencia no encontrada');
        await postSheet(s, { row });
        db.prepare("UPDATE sheet_sync SET status='enviado', attempts=attempts+1, error=NULL, sent_at=datetime('now') WHERE id=?").run(it.id);
      } catch (e) {
        const n = it.attempts + 1;
        db.prepare(`UPDATE sheet_sync SET attempts=?, error=?, status=?, next_try_at=${retryAt(n)} WHERE id=?`).run(
          n, String(e.message).slice(0, 300), n >= MAX_ATTEMPTS + 2 ? 'error' : 'pendiente', it.id
        );
      }
    }
  } catch (e) {
    console.error('processQueue', e);
  } finally {
    busy = false;
  }
}
// Estado real de los SMS en el teléfono (SMS Gateway): si el teléfono no pudo enviarlo (p. ej. límite de Android),
// el mensaje vuelve a la cola y se reintenta solo
let checking = false;
async function checkSmsStates() {
  const s = getSettings();
  const accs = smsAccounts(s);
  if (checking || s.sms_provider !== 'android' || !accs.length) return;
  checking = true;
  try {
    const list = db.prepare(`SELECT * FROM messages WHERE channel='sms' AND status='enviado' AND provider_ref IS NOT NULL
      AND sent_at >= datetime('now','-12 hours') AND (gw_state IS NULL OR gw_state IN ('Pending','Processed','Sent'))
      AND (gw_checked_at IS NULL OR gw_checked_at <= datetime('now','-90 seconds')) ORDER BY id LIMIT 60`).all();
    for (const m of list) {
      try {
        const a = accs.find((x) => 'sms' + x.ch === m.gw_channel) || accs[0];
        const r = await fetch(`${smsBase(a)}/3rdparty/v1/messages/${encodeURIComponent(m.provider_ref)}`, { headers: { Authorization: basic(a.user, a.pass) }, signal: AbortSignal.timeout(15000) });
        if (!r.ok) continue;
        const j = await r.json();
        const st = j.state || null;
        db.prepare("UPDATE messages SET gw_state=?, gw_checked_at=datetime('now') WHERE id=?").run(st, m.id);
        if (st === 'Failed') {
          const err = (j.recipients || []).map((x) => x.error).filter(Boolean)[0] || 'El teléfono no pudo enviar el SMS';
          const limit = /LIMIT_EXCEEDED/i.test(err);
          const ageH = (Date.now() - new Date(m.created_at.replace(' ', 'T') + 'Z').getTime()) / 36e5;
          const stale = STALE_H[m.event] && ageH > STALE_H[m.event];
          const again = !stale && m.attempts < 8;
          db.prepare(`UPDATE messages SET status=?, error=?, next_try_at=datetime('now', ?) WHERE id=?`).run(
            again ? 'pendiente' : 'error', `Teléfono: ${limit ? 'límite de envío de Android alcanzado' : err}`.slice(0, 300), limit ? '+10 minutes' : '+3 minutes', m.id);
        }
      } catch {}
    }
  } finally {
    checking = false;
  }
}
function start() {
  setInterval(processQueue, 10000).unref();
  setInterval(checkSmsStates, 120000).unref();
  setTimeout(checkSmsStates, 20000).unref();
  setTimeout(processQueue, 2000).unref();
}

// ---------- Pruebas desde Configuración ----------
async function testChannel(channel, to) {
  const s = getSettings();
  const body = `Mensaje de prueba de ${s.company_name || 'Sovime Mensajería'}. Si lo recibiste, el canal funciona.`;
  if (channel === 'sheets') {
    const j = await postSheet(s, { test: true });
    return { ok: true, detail: `Conexión correcta con la pestaña "${j.sheet}" (${j.rows} filas). La prueba no escribe datos.` };
  }
  const dest = channel === 'email' ? (validEmail(to) ? to : null) : phoneE164(to, s.phone_country);
  if (!dest) throw new Error(channel === 'email' ? 'Correo de prueba inválido' : 'Teléfono de prueba inválido (10 dígitos o formato +52…)');
  const r = await deliver(s, { channel, recipient: dest, subject: 'Prueba de notificaciones', body }, { direct: true });
  return { ok: true, detail: r.simulated ? 'Modo simulación: el mensaje no salió (configura un proveedor)' : `Enviado a ${dest}` };
}

// Pestaña "Resumen": un renglón por oficina y por ciudad (se reescribe por clave en la columna A)
const RESUMEN_HEADERS = ['Clave', 'Actualizado', 'Tipo', 'Nombre', 'Ciudades', 'Clientes', 'Pendientes', 'En ruta', 'Entregados', 'No entregados', 'Cancelados', 'Avance %',
  'Inventario almacén', 'Inventario repartidores', 'Inventario abierto', 'Inventario disponible', 'Por entregar', 'Faltan'];
async function pushResumen(rows) {
  const s = getSettings();
  if (s.sheets_enabled !== '1' || !s.sheets_url) return { skipped: true };
  let n = 0;
  for (const row of rows) { await postSheet(s, { sheet: 'Resumen', headers: RESUMEN_HEADERS, row }); n++; }
  return { sent: n };
}
module.exports = { smsDeviceStats, EVENTS, CHANNELS, SECRET_KEYS, INTEGRATION_KEYS, SHEET_HEADERS, appsScript, queueEvent, queueSheet, processQueue, start, testChannel, phoneE164, trackLink, baseUrl, pushResumen };
