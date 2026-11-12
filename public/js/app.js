/* Sovime Mensajería – SPA (web + móvil / PWA) sin build step */
'use strict';

// ================= Utilidades =================
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => new Date().toLocaleDateString('en-CA');
const fmtDT = (s) => (s ? new Date(s.replace(' ', 'T') + (s.includes('Z') ? '' : 'Z')).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const fmtN = (n, d = 0) => (n == null || isNaN(n) ? '—' : Number(n).toLocaleString('es-MX', { maximumFractionDigits: d, minimumFractionDigits: d }));
const money = (n) => (n ? Number(n).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' }) : '—');

const STATUS = {
  pendiente: 'Pendiente', asignado: 'Asignado', cargado: 'En vehículo', entregado: 'Entregado', fallido: 'Fallido', cancelado: 'Cancelado',
  planificada: 'Planificada', en_curso: 'En curso', completada: 'Completada',
};
const badge = (s) => `<span class="badge b-${s}">${STATUS[s] || esc(s)}</span>`;
const FAIL_REASONS = ['Cliente ausente', 'Dirección incorrecta', 'Rechazado por cliente', 'Zona de riesgo / sin acceso', 'Paquete dañado', 'Reprogramado por cliente', 'Otro'];
const PIN_COLORS = { pendiente: '#7b8a85', asignado: '#2364aa', cargado: '#c27c0e', entregado: '#1f8a4c', fallido: '#c0392b' };
const ROUTE_COLORS = ['#1d5a96', '#e5612a', '#b34ad1', '#d9822b', '#c0392b', '#2a9d8f', '#6d597a', '#e76f51'];

const I = {
  dash: '<path d="M3 13h8V3H3zm0 8h8v-6H3zm10 0h8V11h-8zm0-18v6h8V3z"/>',
  box: '<path d="M21 8l-9-5-9 5v8l9 5 9-5zM3.3 7.6L12 12.5l8.7-4.9M12 12.5V21"/>',
  route: '<circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h8.5a3.5 3.5 0 000-7h-9a3.5 3.5 0 010-7H16"/>',
  inv: '<path d="M4 7h16M4 12h16M4 17h10"/><rect x="2" y="3" width="20" height="18" rx="2"/>',
  users: '<circle cx="9" cy="8" r="4"/><path d="M1 21v-1a6 6 0 0112 0v1M17 11a3 3 0 100-6M23 21v-1a5 5 0 00-4-4.9"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 6-6"/>',
  cog: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-2.7 1.1V21a2 2 0 11-4 0v-.1a1.6 1.6 0 00-2.7-1.1l-.1.1a2 2 0 11-2.8-2.8l.1-.1A1.6 1.6 0 003 15H3a2 2 0 110-4h.1a1.6 1.6 0 001.1-2.7l-.1-.1a2 2 0 112.8-2.8l.1.1A1.6 1.6 0 009 4.6V3a2 2 0 114 0v.1a1.6 1.6 0 002.7 1.1l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 001.1 2.7H21a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1z"/>',
  person: '<circle cx="12" cy="7" r="4"/><path d="M4 21v-1a8 8 0 0116 0v1"/>',
  building: '<path d="M3 21h18M5 21V5a2 2 0 012-2h7a2 2 0 012 2v16M16 9h3a2 2 0 012 2v10M9 7h2M9 11h2M9 15h2"/>',
  scan: '<path d="M3 7V4h3M21 7V4h-3M3 17v3h3M21 17v3h-3M7 8v8M10 8v8M13 8v8M17 8v8"/>',
  truck: '<path d="M1 4h14v12H1zM15 9h4l3 3v4h-7"/><circle cx="5.5" cy="18.5" r="2"/><circle cx="18.5" cy="18.5" r="2"/>',
  history: '<path d="M3 12a9 9 0 109-9 9.7 9.7 0 00-6.7 2.8L3 8"/><path d="M3 3v5h5M12 7v5l4 2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  nav: '<path d="M3 11l19-9-9 19-2-8z"/>',
  phone: '<path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012.1 4.2 2 2 0 014.1 2h3a2 2 0 012 1.7c.1 1 .4 1.9.7 2.8a2 2 0 01-.5 2.1L8 9.9a16 16 0 006 6l1.3-1.3a2 2 0 012.1-.4c.9.3 1.8.6 2.8.7a2 2 0 011.7 2z"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  logout: '<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/>',
  camera: '<path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M17.9 17.9A10 10 0 0112 20c-7 0-11-8-11-8a18 18 0 015.1-5.9M9.9 4.2A9 9 0 0112 4c7 0 11 8 11 8a18 18 0 01-2.2 3.2M1 1l22 22"/><path d="M14.1 14.1a3 3 0 01-4.2-4.2"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3L21 2M16 7l3 3M19 4l2 2"/>',
  more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  upload: '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  download: '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>',
  chev: '<path d="M9 18l6-6-6-6"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  sign: '<path d="M3 17c3-1 4-6 6-6s1 5 3 5 3-3 4-3 2 2 5 2"/><path d="M3 21h18"/>',
  tag: '<path d="M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0L2 12V2h10l8.6 8.6a2 2 0 010 2.8z"/><circle cx="7" cy="7" r="1.5"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>',
  chat: '<path d="M21 12a8.5 8.5 0 01-12.6 7.4L3 21l1.7-5.2A8.5 8.5 0 1121 12z"/>',
  send: '<path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 6l-10 7L2 6"/>',
  ext: '<path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/>',
  print: '<path d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 1v3M12 20v3M1 12h3M20 12h3"/>',
  video: '<path d="M23 7l-7 5 7 5z"/><rect x="1" y="5" width="15" height="14" rx="2"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  sheet: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>',
  pause: '<circle cx="12" cy="12" r="10"/><path d="M10 15V9M14 15V9"/>',
  trash: '<path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>',
  live: '<circle cx="12" cy="10" r="3"/><path d="M12 21s-7-6.2-7-11a7 7 0 0114 0c0 4.8-7 11-7 11z"/>',
};
const icon = (k) => `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${I[k] || ''}</svg>`;

function toast(msg, type = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), type === 'bad' ? 5000 : 3000);
}
function beep(ok = true) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = ok ? 1200 : 300;
    g.gain.value = 0.08;
    o.connect(g).connect(ctx.destination);
    o.start();
    setTimeout(() => { o.stop(); ctx.close(); }, ok ? 90 : 300);
    navigator.vibrate?.(ok ? 60 : [100, 60, 100]);
  } catch {}
}

// ================= Estado y API =================
const store = {
  get token() { try { return localStorage.getItem('um_token'); } catch { return null; } },
  set token(v) { try { v ? localStorage.setItem('um_token', v) : localStorage.removeItem('um_token'); } catch {} },
  get user() { try { return JSON.parse(localStorage.getItem('um_user') || 'null'); } catch { return null; } },
  set user(v) { try { v ? localStorage.setItem('um_user', JSON.stringify(v)) : localStorage.removeItem('um_user'); } catch {} },
};
let SETTINGS = {};

// Modo repartidor: un supervisor o despachador con "También reparte" puede usar la app como repartidor
const canDeliver = () => !!store.user && store.user.role !== 'repartidor' && !!store.user.can_deliver;
const driverMode = () => !!store.user && (store.user.role === 'repartidor' || (canDeliver() && (() => { try { return localStorage.getItem('modo') === 'repartidor'; } catch { return false; } })()));
function setMode(driver) { try { localStorage.setItem('modo', driver ? 'repartidor' : 'oficina'); } catch {} location.hash = driver ? '#/my' : '#/dashboard'; render(); }
async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(store.token ? { Authorization: 'Bearer ' + store.token } : {}), ...(canDeliver() && driverMode() ? { 'X-As-Driver': '1' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && url !== '/api/auth/login') {
    store.token = null;
    store.user = null;
    render();
    throw new Error('Sesión expirada');
  }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) {
    const e = new Error(data?.error || 'Error ' + res.status);
    e.data = data;
    e.status = res.status;
    throw e;
  }
  return data;
}
const GET = (u) => api('GET', u);
const POST = (u, b) => api('POST', u, b || {});
const PUT = (u, b) => api('PUT', u, b || {});

// ---- Cola offline (entregas registradas sin señal) ----
const outbox = {
  list() { try { return JSON.parse(localStorage.getItem('um_outbox') || '[]'); } catch { return []; } },
  save(l) { try { localStorage.setItem('um_outbox', JSON.stringify(l)); } catch { toast('No hay espacio para guardar offline', 'bad'); } },
  push(item) { const l = this.list(); l.push(item); this.save(l); },
  async flush() {
    const l = this.list();
    if (!l.length || !navigator.onLine) return;
    const rest = [];
    for (const it of l) {
      try { await POST(it.url, it.body); }
      catch (e) { if (!e.status) rest.push(it); else toast(`No se pudo sincronizar ${it.label}: ${e.message}`, 'bad'); }
    }
    this.save(rest);
    if (l.length !== rest.length) { toast(`Sincronizadas ${l.length - rest.length} evidencias`, 'ok'); if (location.hash.startsWith('#/my')) render(); }
  },
};
window.addEventListener('online', () => outbox.flush());
setInterval(() => outbox.flush(), 30000);

async function postOrQueue(url, body, label) {
  try {
    return await POST(url, body);
  } catch (e) {
    if (e.status) throw e; // error real del servidor
    outbox.push({ url, body, label, at: Date.now() });
    toast('Sin conexión: guardado, se enviará automáticamente', '');
    return { queued: true };
  }
}

// ================= Modal =================
function modal(title, body, { wide = false, footer = '', onClose, sheet = false } = {}) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg' + (sheet ? ' sheet' : '');
  bg.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
    <header><h2>${esc(title)}</h2><button class="btn ghost sm" data-close aria-label="Cerrar">${icon('x')}</button></header>
    <div class="body">${body}</div>${footer ? `<footer>${footer}</footer>` : ''}</div>`;
  const close = () => { bg.remove(); onClose?.(); };
  bg.addEventListener('click', (e) => { if (e.target === bg || e.target.closest('[data-close]')) close(); });
  document.body.appendChild(bg);
  return { el: bg, close };
}
function confirmDlg(msg) {
  return new Promise((ok) => {
    const m = modal('Confirmar', `<p>${esc(msg)}</p>`, { footer: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="cfm">Aceptar</button>', onClose: () => ok(false) });
    $('#cfm', m.el).onclick = () => { ok(true); m.el.remove(); };
  });
}

// ================= Mapas =================
function makeMap(el, center, zoom = 12) {
  const map = L.map(el, { zoomControl: true, preferCanvas: true }).setView(center || [Number(SETTINGS.depot_lat) || 19.43, Number(SETTINGS.depot_lng) || -99.13], zoom);
  baseTiles(map);
  const fitAfter = map.fitBounds.bind(map);
  map.fitBounds = (b, o) => { o = { ...o, animate: false }; map._lastFit = [b, o]; return fitAfter(b, o); };
  setTimeout(() => { map.invalidateSize(); if (map._lastFit) fitAfter(...map._lastFit); }, 150);
  return map;
}
const pinIcon = (label, color, chk = false) => L.divIcon({ className: '', html: `<div class="pin${chk ? ' chk' : ''}" style="background:${color}"><span>${esc(label)}</span></div>${chk ? '<b class="pin-q" title="Ubicación por revisar">!</b>' : ''}`, iconSize: [28, 28], iconAnchor: [14, 28], popupAnchor: [0, -26] });
// ubicación aproximada (calle, colonia o centro de la ciudad): se marca para que el repartidor la revise o la oficina la corrija
const geoChk = (q) => ['calle', 'colonia', 'ciudad'].includes(q);
// teléfonos del cliente para el repartidor: móvil, adicional y la línea Telnor (todos se pueden marcar)
const fmtTel = (p) => { const d = String(p || '').replace(/\D/g, '').slice(-10); return d.length === 10 ? `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` : String(p || ''); };
const phonesLine = (o) => [o.customer_phone && ['Móvil', o.customer_phone], o.customer_phone_alt && ['Adicional', o.customer_phone_alt], o.telnor_phone && ['Telnor', o.telnor_phone]]
  .filter(Boolean).map(([l, p]) => `<a href="tel:${esc(String(p).replace(/[^\d+]/g, ''))}" class="tel-l${l === 'Telnor' ? ' telnor' : ''}" onclick="event.stopPropagation()">${icon('phone')} ${l}: <b class="mono">${esc(fmtTel(p))}</b></a>`).join('');
const geoWarn = (q) => (geoChk(q) ? `<span class="chip warn" title="El pin está en su ${q === 'ciudad' ? 'ciudad' : q}; el repartidor la confirma al llegar o la oficina mueve el pin">⚠ Ubicación por revisar · ${q === 'ciudad' ? 'centro de la ciudad' : q === 'calle' ? 'por calle' : 'en su colonia'}</span>` : '');
const depotIcon = () => L.divIcon({ className: '', html: '<div class="depot-pin">🏭</div>', iconSize: [30, 30], iconAnchor: [15, 15] });
const truckIcon = () => L.divIcon({ className: '', html: '<div class="truck-pin">🚚</div>', iconSize: [34, 34], iconAnchor: [17, 17] });
function depotLatLng() { return [Number(SETTINGS.depot_lat), Number(SETTINGS.depot_lng)]; }

function drawRoute(map, stops, color = '#1d5a96', { depot = true, fit = true, onEdit = null, collect = null, depotLL = null, into = null } = {}) {
  const pts = [];
  const tgt = into || map;
  const dll = depotLL && depotLL[0] != null ? depotLL : depotLatLng();
  if (depot) { L.marker(dll, { icon: depotIcon() }).addTo(map).bindPopup(depotLL ? 'Punto de salida' : esc(SETTINGS.depot_name)); pts.push(dll); }
  for (const s of stops) {
    if (s.lat == null) continue;
    const ll = [s.lat, s.lng];
    pts.push(ll);
    const mk = L.marker(ll, { icon: pinIcon(s.stop_seq ?? '•', ['entregado', 'fallido'].includes(s.status) ? PIN_COLORS[s.status] : color, geoChk(s.geo_quality) && !['entregado', 'fallido'].includes(s.status)) })
      .addTo(tgt)
      .bindPopup(`<b>${esc(s.stop_seq ?? '')}. ${esc(s.customer_name)}</b><br>${esc(s.address)}<br>${esc(s.tracking_code)} · ${STATUS[s.status]}${s.eta ? '<br>ETA ' + esc(s.eta) : ''}${geoChk(s.geo_quality) ? '<br>' + geoWarn(s.geo_quality) : ''}${onEdit ? stopEditButtons() : ''}`);
    if (onEdit) wireStopEdit(map, mk, s, onEdit);
    collect?.push({ s, mk });
  }
  if (pts.length > 1) L.polyline(pts, { color, weight: 4, opacity: 0.75, dashArray: '6 6' }).addTo(tgt);
  if (fit && pts.length) map.fitBounds(pts, { padding: [30, 30], maxZoom: 15 });
  return pts;
}
// ---- Editar cliente y ubicación desde un mapa de ruta ----
const stopEditButtons = () => `<div class="row" style="margin-top:8px;gap:6px;flex-wrap:wrap"><button class="btn sm" data-ed="1">${icon('person')} Editar cliente</button><button class="btn sm" data-mv="1">${icon('live')} Mover ubicación</button><button class="btn sm" data-stp="1">${icon('check')} Estado</button></div>`;
async function afterCustomerMoved(s, onEdit) {
  // la ruta se reordena con la nueva ubicación (solo si aún no sale o tiene paradas pendientes)
  if (s.route_id && ['asignado', 'cargado'].includes(s.status)) {
    try { const o = await POST(`/api/routes/${s.route_id}/optimize`); toast(`Ruta recalculada: ${fmtN(o.distance_km, 1)} km`, 'ok'); } catch {}
  }
  onEdit();
}
function wireStopEdit(map, mk, s, onEdit) {
  mk.on('popupopen', (e) => {
    const el = e.popup.getElement();
    $('[data-ed]', el)?.addEventListener('click', async () => {
      map.closePopup();
      const c = await GET('/api/customers/' + s.customer_id);
      customerForm(c, () => afterCustomerMoved(s, onEdit));
    });
    $('[data-stp]', el)?.addEventListener('click', () => { map.closePopup(); statusPicker(s, () => onEdit()); });
    $('[data-mv]', el)?.addEventListener('click', () => {
      map.closePopup();
      const from = mk.getLatLng();
      mk.dragging.enable();
      mk.setZIndexOffset(2000);
      toast(`Arrastra el pin de ${s.customer_name} al domicilio correcto`, '');
      mk.once('dragend', async () => {
        mk.dragging.disable();
        const to = mk.getLatLng();
        if (!(await confirmDlg(`¿Guardar la nueva ubicación de ${s.customer_name}? Se usará en todas sus entregas.`))) { mk.setLatLng(from); return; }
        try {
          await api('PUT', '/api/customers/' + s.customer_id, { lat: to.lat, lng: to.lng });
          toast('Ubicación guardada', 'ok');
          afterCustomerMoved(s, onEdit);
        } catch (er) { toast(er.message, 'bad'); mk.setLatLng(from); }
      });
    });
  });
}
function editableCustomerPin(map, layer, c, onSaved) {
  // c: { id (cliente), name, address, extra }
  layer.bindPopup(`<b>${esc(c.name)}</b><br>${esc(c.address || '')}${c.extra || ''}<div class="row" style="margin-top:8px;gap:6px;flex-wrap:wrap"><button class="btn sm" data-ced="1">${icon('person')} Editar cliente</button><button class="btn sm" data-cmv="1">${icon('live')} Mover ubicación</button></div>`);
  layer.on('popupopen', (e) => {
    const el = e.popup.getElement();
    $('[data-ced]', el)?.addEventListener('click', async () => { map.closePopup(); customerForm(await GET('/api/customers/' + c.id), () => onSaved?.()); });
    $('[data-cmv]', el)?.addEventListener('click', () => {
      map.closePopup();
      toast(`Toca el mapa en el domicilio correcto de ${c.name}`, '');
      map.getContainer().style.cursor = 'crosshair';
      map.once('click', async (ev) => {
        map.getContainer().style.cursor = '';
        if (!(await confirmDlg(`¿Guardar la nueva ubicación de ${c.name}? Se usará en todas sus entregas.`))) return;
        try { await api('PUT', '/api/customers/' + c.id, { lat: ev.latlng.lat, lng: ev.latlng.lng }); layer.setLatLng(ev.latlng); toast('Ubicación guardada', 'ok'); }
        catch (er) { toast(er.message, 'bad'); }
      });
    });
  });
}
// Clientes sin ubicación: lista para abrirlos y marcarlos en el mapa
async function unlocatedCustomers(officeId) {
  const r = await GET(`/api/customers?limit=200000${officeId ? '&office_id=' + officeId : ''}`);
  const list = r.rows.filter((c) => c.lat == null || geoChk(c.geo_quality)).sort((a, b) => (a.lat == null ? 0 : a.geo_quality === 'ciudad' ? 1 : 2) - (b.lat == null ? 0 : b.geo_quality === 'ciudad' ? 1 : 2));
  const m = modal(`Ubicaciones por revisar (${list.length})`, `<div class="stack"><input id="unQ" placeholder="Buscar por nombre, dirección o ciudad" />
    <div class="table-wrap" style="max-height:60vh"><table><tbody>${list.map((c) => `<tr class="click" data-u="${c.id}" data-t="${esc((c.name + ' ' + c.address + ' ' + (c.city || '')).toLowerCase())}"><td><b>${esc(c.name)}</b><br><small class="muted">${esc(c.address || '')}${c.city ? ', ' + esc(c.city) : ''}</small></td><td><small class="muted">${c.lat == null ? (c.geo_quality === 'no_encontrada' ? 'no encontrado' : 'por ubicar') : geoWarn(c.geo_quality)}</small></td><td class="r"><button class="btn sm">Ubicar</button></td></tr>`).join('') || '<tr><td class="muted">Todos los clientes tienen ubicación ✅</td></tr>'}</tbody></table></div>
    <small class="muted">Abre el cliente, toca <b>Ubicar</b> o toca el mapa en su domicilio, y guarda.</small></div>`, { wide: true, footer: '<button class="btn primary" data-close>Cerrar</button>' });
  $('#unQ', m.el).oninput = (e) => { const q = e.target.value.toLowerCase().trim(); $$('tr[data-u]', m.el).forEach((tr) => (tr.hidden = !!q && !tr.dataset.t.includes(q))); };
  $$('tr[data-u]', m.el).forEach((tr) => (tr.onclick = async () => customerForm(await GET('/api/customers/' + tr.dataset.u), () => { tr.remove(); })));
}
// Destino para Google Maps / Waze: el pin si es exacto (o confirmado); si es aproximado, la dirección escrita
const navAddr = (s) => [s.address, s.customer_colonia && !String(s.address || '').toUpperCase().includes(String(s.customer_colonia).toUpperCase()) ? 'Col. ' + s.customer_colonia : '',
  s.customer_city, /san luis/i.test(s.customer_city || '') ? 'Sonora' : 'Baja California', 'México'].filter(Boolean).join(', ');
const exactPin = (s) => s.lat != null && !(typeof geoChk === 'function' && geoChk(s.geo_quality));
const navDest = (s) => (exactPin(s) ? `${s.lat},${s.lng}` : navAddr(s));
function navUrl(s, app) {
  if (app === 'waze') return exactPin(s) ? `https://waze.com/ul?ll=${s.lat},${s.lng}&navigate=yes` : `https://waze.com/ul?q=${encodeURIComponent(navAddr(s))}&navigate=yes`;
  return `https://www.google.com/maps/dir/?api=1&travelmode=driving&dir_action=navigate&destination=${encodeURIComponent(navDest(s))}`;
}
// app con la que navega este teléfono (se recuerda por dispositivo): google (recomendado), waze o app
const navPref = () => { try { return localStorage.getItem('navApp') || 'google'; } catch { return 'google'; } };
function gmapsUrl(stops) {
  const pts = stops.filter((s) => s.lat != null || s.address);
  if (!pts.length) return '#';
  const dest = pts[pts.length - 1];
  const way = pts.slice(0, -1).slice(0, 9).map(navDest).join('|');
  return `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${encodeURIComponent(navDest(dest))}${way ? '&waypoints=' + encodeURIComponent(way) : ''}`;
}
function getPosition(timeout = 10000) {
  return new Promise((ok) => {
    if (!navigator.geolocation) return ok(null);
    navigator.geolocation.getCurrentPosition((p) => ok({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }), () => ok(null), { enableHighAccuracy: true, timeout, maximumAge: 30000 });
  });
}

// ================= Escáner de códigos =================
// Tres formas de leer: cámara del teléfono (en vivo o con foto), lector USB/Bluetooth (pistola en modo teclado)
// y registro manual. La forma elegida se recuerda en cada dispositivo.
const SCAN_MODES = [['camara', 'Cámara', 'camera'], ['lector', 'Lector', 'scan'], ['manual', 'Escribir', 'edit']];
function scanFormats() {
  const F = window.Html5QrcodeSupportedFormats;
  if (!F) return undefined;
  return ['QR_CODE', 'EAN_13', 'EAN_8', 'UPC_A', 'UPC_E', 'CODE_128', 'CODE_39', 'CODE_93', 'ITF', 'CODABAR', 'DATA_MATRIX', 'PDF_417']
    .map((k) => F[k]).filter((x) => x != null);
}
// Imagen de un archivo, compatible con todos los navegadores (iOS < 15 no tiene createImageBitmap)
const IS_IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
async function loadImage(file) {
  if (window.createImageBitmap) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch {}
    try { return await createImageBitmap(file); } catch {}
  }
  return new Promise((ok, fail) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => { ok(img); setTimeout(() => URL.revokeObjectURL(url), 1000); };
    img.onerror = () => { URL.revokeObjectURL(url); fail(new Error('No se pudo abrir la foto (formato no compatible). Toma la foto con la cámara de la app.')); };
    img.src = url;
  });
}
const imgW = (b) => b.naturalWidth || b.width, imgH = (b) => b.naturalHeight || b.height;
// Lectura robusta desde una foto: imagen completa y, si no aparece, franjas con más contraste
// (y girada 90° para códigos verticales). Así se leen códigos pequeños o de barras finas dentro de fotos grandes.
async function decodeImageFile(file, onStep) {
  const bmp = await loadImage(file);
  let host = document.getElementById('scanDecodeTmp');
  if (!host) { host = document.createElement('div'); host.id = 'scanDecodeTmp'; host.hidden = true; document.body.appendChild(host); }
  const attempt = async (blob) => {
    const h = new Html5Qrcode('scanDecodeTmp', { verbose: false, formatsToSupport: scanFormats(), experimentalFeatures: { useBarCodeDetectorIfSupported: true } });
    try { return await h.scanFile(new File([blob], 'f.png', { type: 'image/png' }), false); } catch { return null; } finally { try { h.clear(); } catch {} }
  };
  const render = async (sx, sy, sw, sh, rotate) => {
    const scale = Math.min(2, Math.max(1, 1400 / Math.max(sw, sh)), 2400 / Math.max(sw, sh));
    const w = Math.round(sw * scale), h = Math.round(sh * scale);
    const c = document.createElement('canvas');
    [c.width, c.height] = rotate ? [h, w] : [w, h];
    const g = c.getContext('2d');
    const native = 'filter' in g;
    if (native) g.filter = 'grayscale(1) contrast(1.6)';
    if (rotate) { g.translate(h, 0); g.rotate(Math.PI / 2); }
    g.drawImage(bmp, sx, sy, sw, sh, 0, 0, w, h);
    if (!native || !g.filter || g.filter === 'none') {
      try {
        const d = g.getImageData(0, 0, c.width, c.height), px = d.data;
        for (let i = 0; i < px.length; i += 4) { const y = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]; const v = Math.max(0, Math.min(255, (y - 128) * 1.6 + 128)); px[i] = px[i + 1] = px[i + 2] = v; }
        g.putImageData(d, 0, 0);
      } catch {}
    }
    return new Promise((r) => c.toBlob(r, 'image/png'));
  };
  const W = imgW(bmp), H = imgH(bmp);
  const r0 = await attempt(Math.max(W, H) > 2000 ? await render(0, 0, W, H, false) : file);
  if (r0) return r0;
  const plans = [[0, 0, W, H, false]];
  for (const rot of [false, true]) {
    const long = rot ? W : H; // franjas a lo largo del eje donde se apilan los códigos
    const band = Math.round(long * 0.25), step = Math.round(long * 0.125);
    for (let o = 0; o + band <= long + step - 1; o += step) {
      const off = Math.min(o, long - band);
      plans.push(rot ? [off, 0, band, H, true] : [0, off, W, band, false]);
    }
    if (!rot) plans.push([0, 0, W, H, true]);
  }
  for (let i = 0; i < plans.length; i++) {
    onStep?.(i + 1, plans.length);
    const [x, y, w, h, rot] = plans[i];
    const r = await attempt(await render(x, y, w, h, rot));
    if (r) return r;
  }
  throw new Error('No se encontró un código en la foto');
}
function openScanner({ title = 'Escanear código', continuous = false, onCode, hint = '', onClose }) {
  let scanner = null;
  let last = '';
  let lastAt = 0;
  const touch = matchMedia('(pointer: coarse)').matches;
  const liveOk = window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;
  let mode;
  try { mode = localStorage.getItem('um_scan_mode'); } catch {}
  if (!SCAN_MODES.some(([k]) => k === mode)) mode = touch ? 'camara' : 'lector';
  const m = modal(title, `
    ${hint ? `<p class="muted" style="margin-top:0">${hint}</p>` : ''}
    <div class="pill-tabs scan-modes" role="tablist">${SCAN_MODES.map(([k, l, i]) => `<button type="button" role="tab" data-mode="${k}">${icon(i)} ${l}</button>`).join('')}</div>
    <div class="scan-pane" data-pane="camara">
      <div id="reader"></div>
      <div class="row scan-cam-bar" id="camBar" hidden>
        <select id="camSel" aria-label="Cámara" hidden></select>
        <button type="button" class="btn sm" id="torch" hidden>🔦 Linterna</button>
        <button type="button" class="btn sm" id="camPause">Pausar</button>
      </div>
      <div class="cam-photo" id="camPhoto" hidden>
        <p id="camWhy" class="muted" style="margin:0"></p>
        <label class="btn primary lg block">${icon('camera')} Tomar foto del código<input type="file" accept="image/*" capture="environment" id="snapFile" hidden /></label>
        <small class="muted">Acerca el teléfono para que el código se vea nítido y ocupe buena parte de la foto.</small>
      </div>
      <div id="snapTmp" hidden></div>
      <small class="muted" id="camMsg"></small>
    </div>
    <div class="scan-pane" data-pane="lector">
      <div class="lector-box" id="lectorBox" tabindex="-1">
        <span class="lector-dot"></span>
        <div><b id="lectorTxt">Listo: apunta el lector al código y dispara</b>
        <small class="muted">Lectores USB o Bluetooth en modo teclado (HID). No necesitas tocar nada más.</small></div>
      </div>
      <input id="lectorIn" class="lector-in" inputmode="none" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Lectura del escáner" />
    </div>
    <div class="scan-pane" data-pane="manual">
      <form id="manual" class="stack">
        <label class="f">Código de barras, SKU o número de guía<input id="manualCode" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Ej. 7501000009596 o UM1522" /></label>
        <div class="row between"><label class="row"><input type="checkbox" id="numKb" /> Teclado numérico</label><button class="btn primary">${icon('check')} Registrar</button></div>
      </form>
    </div>
    <div class="scan-last" id="scanLast" hidden></div>
    ${continuous ? '<h3 style="margin-top:14px">Escaneados</h3><div class="scan-log" id="scanLog"><small class="muted log-empty">Aún nada…</small></div>' : ''}
  `, { footer: '<button class="btn" data-close>Cerrar</button>', onClose: () => { stopCam(); onClose?.(); } });
  const $m = (s) => $(s, m.el);
  const log = $m('#scanLog');
  const flash = (ok, text) => {
    const box = $m('#scanLast');
    box.hidden = false;
    box.className = 'scan-last ' + (ok ? 'ok' : 'bad');
    box.textContent = text;
    m.el.querySelector('.modal').classList.remove('flash-ok', 'flash-bad');
    void m.el.offsetWidth;
    m.el.querySelector('.modal').classList.add(ok ? 'flash-ok' : 'flash-bad');
  };
  let busy = false;
  async function handle(code, via) {
    code = String(code).trim();
    if (!code || busy) return;
    const now = Date.now();
    if (code === last && now - lastAt < 2500) return; // evita lecturas duplicadas
    last = code; lastAt = now;
    busy = true;
    try {
      const res = await onCode(code, via);
      beep(true);
      flash(true, `✅ ${code}${res ? ' · ' + res : ''}`);
      if (continuous) {
        log.querySelector('.log-empty')?.remove();
        log.insertAdjacentHTML('afterbegin', `<div>✅ <b>${esc(code)}</b> ${res ? '· ' + esc(res) : ''} <small class="muted">${via}</small></div>`);
      } else { busy = false; m.close(); return; }
    } catch (e) {
      beep(false);
      flash(false, `⛔ ${code} · ${e.message}`);
      if (continuous) log.querySelector('.log-empty')?.remove();
      if (continuous) log.insertAdjacentHTML('afterbegin', `<div style="color:var(--bad)">⛔ <b>${esc(code)}</b> · ${esc(e.message)}</div>`);
      else toast(e.message, 'bad');
    } finally { busy = false; }
  }

  // ---------- Cámara ----------
  const showPhoto = (why) => {
    $m('#reader').style.display = 'none';
    $m('#camBar').hidden = true;
    $m('#camPhoto').hidden = false;
    $m('#camWhy').innerHTML = why;
  };
  async function startCam() {
    $m('#camMsg').textContent = '';
    if (!window.Html5Qrcode) return showPhoto('El lector de cámara no se pudo cargar (¿sin internet?). Usa el modo <b>Escribir</b>.');
    if (!liveOk) {
      return showPhoto(location.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(location.hostname)
        ? 'La cámara en vivo necesita que la app se abra con <b>https</b>. Mientras tanto, toma una foto del código y la app lo lee.'
        : 'Este navegador no permite la cámara en vivo. Toma una foto del código y la app lo lee.');
    }
    $m('#camPhoto').hidden = true;
    $m('#reader').style.display = '';
    try {
      scanner = new Html5Qrcode('reader', { verbose: false, formatsToSupport: scanFormats(), experimentalFeatures: { useBarCodeDetectorIfSupported: true } });
      const camId = (() => { try { return localStorage.getItem('um_cam'); } catch { return null; } })();
      const cfg = (vc) => ({ fps: 12, ...(IS_IOS ? {} : { aspectRatio: 1.333 }), videoConstraints: vc,
        qrbox: (w, h) => ({ width: Math.floor(Math.min(w * 0.9, 420)), height: Math.floor(Math.min(h * 0.55, 220)) }) });
      const hi = { width: { ideal: 1920 }, height: { ideal: 1080 } };
      try {
        await scanner.start(camId ? { deviceId: { exact: camId } } : { facingMode: 'environment' },
          cfg(camId ? { deviceId: { exact: camId }, ...hi } : { facingMode: { ideal: 'environment' }, ...hi }), (txt) => handle(txt, 'cámara'));
      } catch (e1) {
        if (/Permission|NotAllowed/i.test(String(e1?.name || e1))) throw e1;
        // la cámara guardada no existe en este teléfono o no acepta la resolución: cámara trasera con lo que dé
        try { localStorage.removeItem('um_cam'); } catch {}
        try { await scanner.clear(); } catch {}
        scanner = new Html5Qrcode('reader', { verbose: false, formatsToSupport: scanFormats(), experimentalFeatures: { useBarCodeDetectorIfSupported: true } });
        await scanner.start({ facingMode: 'environment' }, cfg(undefined), (txt) => handle(txt, 'cámara'));
      }
      // iOS: el video debe ir "en línea" y sin sonido o se queda en negro / se abre a pantalla completa
      $$('#reader video', m.el).forEach((vd) => { vd.setAttribute('playsinline', ''); vd.setAttribute('webkit-playsinline', ''); vd.muted = true; vd.play?.().catch(() => {}); });
      $m('#camBar').hidden = false;
      $m('#camPause').textContent = 'Pausar';
      // Selector de cámara (si hay más de una) y linterna (si el teléfono la soporta)
      Html5Qrcode.getCameras().then((cams) => {
        const sel = $m('#camSel');
        if (!sel || cams.length < 2) return;
        sel.innerHTML = cams.map((c, i) => `<option value="${esc(c.id)}">${esc(c.label || 'Cámara ' + (i + 1))}</option>`).join('');
        const cur = scanner?.getRunningTrackSettings?.().deviceId;
        if (cur) sel.value = cur;
        sel.hidden = false;
      }).catch(() => {});
      try {
        const torch = scanner.getRunningTrackCameraCapabilities?.().torchFeature?.();
        if (torch?.isSupported()) {
          const b = $m('#torch');
          b.hidden = false;
          b.onclick = async () => { const on = !torch.value(); await torch.apply(on); b.classList.toggle('primary', on); };
        }
      } catch {}
    } catch (e) {
      scanner = null;
      const denied = /Permission|NotAllowed/i.test(String(e?.name || e));
      showPhoto(denied ? 'No diste permiso para usar la cámara. Actívalo en la configuración del navegador o toma una foto del código.' : 'No se pudo abrir la cámara en vivo. Toma una foto del código y la app lo lee.');
    }
  }
  function stopCam() { if (scanner) { const s = scanner; scanner = null; s.stop().then(() => s.clear()).catch(() => {}); } }
  $m('#camPause').onclick = () => {
    if (!scanner) return startCam();
    if (scanner.getState?.() === 3) { scanner.resume(); $m('#camPause').textContent = 'Pausar'; } else { scanner.pause(true); $m('#camPause').textContent = 'Reanudar'; }
  };
  $m('#camSel').onchange = async (e) => { try { localStorage.setItem('um_cam', e.target.value); } catch {} stopCam(); setTimeout(startCam, 300); };
  $m('#snapFile').onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    if (!window.Html5Qrcode) return toast('Lector no disponible', 'bad');
    $m('#camMsg').textContent = 'Leyendo la foto…';
    try {
      const txt = await decodeImageFile(f, (i, n) => { $m('#camMsg').textContent = `Buscando el código en la foto… (${i}/${n})`; });
      $m('#camMsg').textContent = '';
      handle(txt, 'foto');
    } catch {
      $m('#camMsg').textContent = '';
      beep(false);
      flash(false, '⛔ No se encontró un código en la foto. Acércate más, evita reflejos y vuelve a intentar.');
    }
  };

  // ---------- Lector USB / Bluetooth (teclado) ----------
  const lin = $m('#lectorIn');
  let keyTimes = [];
  let burstTimer = null;
  const focusLector = () => { if (mode === 'lector' && document.activeElement !== lin) lin.focus({ preventScroll: true }); };
  lin.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); clearTimeout(burstTimer); const v = lin.value; lin.value = ''; keyTimes = []; handle(v, 'lector'); return; }
    keyTimes.push(performance.now());
  });
  // Lectores configurados sin "Enter" al final: se detecta la ráfaga de teclas y se procesa al terminar
  lin.addEventListener('input', () => {
    clearTimeout(burstTimer);
    burstTimer = setTimeout(() => {
      const v = lin.value.trim();
      const gaps = keyTimes.slice(1).map((t, i) => t - keyTimes[i]);
      const fast = gaps.length >= 3 && gaps.reduce((a, b) => a + b, 0) / gaps.length < 45;
      if (v.length >= 4 && fast) { lin.value = ''; keyTimes = []; handle(v, 'lector'); }
    }, 180);
  });
  lin.addEventListener('focus', () => $m('#lectorBox').classList.add('ready'));
  lin.addEventListener('blur', () => {
    $m('#lectorBox').classList.remove('ready');
    // Si el usuario no se fue a otro campo del formulario, volvemos a escuchar al lector
    setTimeout(() => { const a = document.activeElement; if (m.el.isConnected && (!a || a === document.body || !m.el.contains(a) || a.tagName === 'BUTTON')) focusLector(); }, 250);
  });
  $m('#lectorBox').onclick = focusLector;

  // ---------- Manual ----------
  $m('#manual').onsubmit = (e) => { e.preventDefault(); const i = $m('#manualCode'); handle(i.value, 'manual'); i.value = ''; i.focus(); };
  $m('#numKb').onchange = (e) => { const i = $m('#manualCode'); i.inputMode = e.target.checked ? 'numeric' : 'text'; i.blur(); setTimeout(() => i.focus(), 50); };

  // ---------- Cambio de modo ----------
  const setMode = (k) => {
    mode = k;
    try { localStorage.setItem('um_scan_mode', k); } catch {}
    $$('.scan-modes button', m.el).forEach((b) => b.classList.toggle('on', b.dataset.mode === k));
    $$('[data-pane]', m.el).forEach((p) => (p.hidden = p.dataset.pane !== k));
    if (k === 'camara') { if (!scanner) startCam(); } else stopCam();
    if (k === 'lector') setTimeout(focusLector, 100);
    if (k === 'manual') setTimeout(() => $m('#manualCode').focus(), 100);
  };
  $$('.scan-modes button', m.el).forEach((b) => (b.onclick = () => setMode(b.dataset.mode)));
  setMode(mode);
  return m;
}

function compressImage(file, maxSide = 1280, quality = 0.7) {
  return loadImage(file).then((img) => {
    {
      const k = Math.min(1, maxSide / Math.max(imgW(img), imgH(img)));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(imgW(img) * k));
      c.height = Math.max(1, Math.round(imgH(img) * k));
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, c.width, c.height);
      try { img.close?.(); } catch {}
      // sello de tiempo en la foto
      ctx.font = `${Math.max(14, c.width / 40)}px sans-serif`;
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.fillRect(0, c.height - c.width / 22, c.width, c.width / 22);
      ctx.fillStyle = '#fff';
      ctx.fillText(new Date().toLocaleString('es-MX'), 10, c.height - c.width / 80);
      return c.toDataURL('image/jpeg', quality);
    }
  });
}
function signaturePad(canvas) {
  const ctx = canvas.getContext('2d');
  let drawing = false;
  let dirty = false;
  function size() {
    const r = canvas.getBoundingClientRect();
    canvas.width = r.width * devicePixelRatio;
    canvas.height = r.height * devicePixelRatio;
    ctx.scale(devicePixelRatio, devicePixelRatio);
    ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.strokeStyle = '#111';
  }
  size();
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  canvas.addEventListener('pointerdown', (e) => { drawing = true; dirty = true; canvas.setPointerCapture(e.pointerId); ctx.beginPath(); ctx.moveTo(...pos(e)); });
  canvas.addEventListener('pointermove', (e) => { if (!drawing) return; ctx.lineTo(...pos(e)); ctx.stroke(); });
  canvas.addEventListener('pointerup', () => (drawing = false));
  return {
    clear() { ctx.clearRect(0, 0, canvas.width, canvas.height); dirty = false; },
    get empty() { return !dirty; },
    data() { return dirty ? canvas.toDataURL('image/png') : null; },
  };
}

// ================= Marca / logotipo =================
// Si existe public/img/logo.png (el logotipo original), se usa; si no, el logotipo tipográfico.
let HAS_LOGO_IMG = false;
async function detectLogo() {
  try {
    const r = await fetch('/img/logo.png', { method: 'HEAD', cache: 'no-store' });
    HAS_LOGO_IMG = r.ok && (r.headers.get('content-type') || '').startsWith('image/');
  } catch { HAS_LOGO_IMG = false; }
}
const logo = (cls = '') => HAS_LOGO_IMG
  ? `<img class="logo-img ${cls}" src="/img/logo.png" alt="Sovime Mensajería" />`
  : `<span class="wordmark ${cls}" role="img" aria-label="Sovime Mensajería"><span class="wm-top"><b>S</b>ovime</span><span class="wm-sub">Mensajería</span></span>`;

const ROLE = { admin: 'Administrador', despachador: 'Despachador', repartidor: 'Repartidor' };
const ROLE_DESC = {
  admin: 'Control total: usuarios, configuración, operación y reportes.',
  despachador: 'Opera el día: pedidos, rutas, inventario, clientes y análisis.',
  repartidor: 'App móvil: su ruta, carga por escaneo y evidencias de entrega.',
};
const roleChip = (r) => `<span class="chip role-${r}">${ROLE[r] || esc(r)}</span>`;
const initials = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const AV_COLORS = ['#1d5a96', '#e5612a', '#2a9d8f', '#8e5bd1', '#c0392b', '#3c7a3b', '#b5771b', '#5a6b7d'];
const avatar = (u, size = '') => `<span class="avatar ${size}" style="background:${AV_COLORS[(u.id || 0) % AV_COLORS.length]}" aria-hidden="true">${esc(initials(u.name))}</span>`;
const firstName = (n) => String(n || '').trim().split(/\s+/)[0];
const ago = (s) => {
  if (!s) return 'Nunca';
  const d = (Date.now() - new Date(s.replace(' ', 'T') + 'Z').getTime()) / 60000;
  if (d < 1) return 'Ahora';
  if (d < 60) return `Hace ${Math.round(d)} min`;
  if (d < 1440) return `Hace ${Math.round(d / 60)} h`;
  if (d < 43200) return `Hace ${Math.round(d / 1440)} d`;
  return fmtDT(s);
};

// Tema claro / oscuro / automático
const theme = {
  get() { try { return localStorage.getItem('um_theme') || 'auto'; } catch { return 'auto'; } },
  set(v) { try { localStorage.setItem('um_theme', v); } catch {} this.apply(); },
  apply() { const v = this.get(); if (v === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = v; },
};
theme.apply();

// Instalación como app (PWA)
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; });

function pwdField(name, label, { auto = 'new-password', min = 8, required = true, meter = false } = {}) {
  return `<label class="f">${label}<span class="pwd"><input name="${name}" type="password" autocomplete="${auto}" ${min ? `minlength="${min}"` : ''} ${required ? 'required' : ''} />
    <button type="button" class="eye" aria-label="Mostrar contraseña" data-eye>${icon('eye')}</button></span>${meter ? '<span class="meter" data-meter><i></i></span><small class="muted" data-meter-txt>Mínimo 8 caracteres, mezcla letras y números.</small>' : ''}</label>`;
}
function wirePwd(root) {
  $$('[data-eye]', root).forEach((b) => (b.onclick = () => {
    const i = b.previousElementSibling;
    i.type = i.type === 'password' ? 'text' : 'password';
    b.innerHTML = icon(i.type === 'password' ? 'eye' : 'eyeOff');
  }));
  $$('[data-meter]', root).forEach((m) => {
    const inp = m.parentElement.querySelector('input');
    const txt = m.parentElement.querySelector('[data-meter-txt]');
    inp.addEventListener('input', () => {
      const v = inp.value;
      let s = 0;
      if (v.length >= 8) s++;
      if (v.length >= 12) s++;
      if (/[a-z]/.test(v) && /[A-Z]/.test(v)) s++;
      if (/\d/.test(v)) s++;
      if (/[^A-Za-z0-9]/.test(v)) s++;
      const lv = !v ? 0 : s <= 1 ? 1 : s <= 3 ? 2 : 3;
      m.dataset.level = lv;
      txt.textContent = ['Mínimo 8 caracteres, mezcla letras y números.', 'Débil', 'Aceptable', 'Fuerte'][lv];
    });
  });
}
function copyText(t) {
  (navigator.clipboard?.writeText(t) || Promise.reject()).then(() => toast('Copiado', 'ok')).catch(() => {
    const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('Copiado', 'ok'); } catch { toast('No se pudo copiar', 'bad'); }
    ta.remove();
  });
}
function showCredentials(name, email, pwd, title = 'Contraseña temporal') {
  const msg = `Hola ${firstName(name)}, ya tienes acceso a ${SETTINGS.company_name || 'Sovime Mensajería'}.\nEntra en ${location.origin}\nUsuario: ${email}\nContraseña temporal: ${pwd}\nAl entrar te pediremos cambiarla.`;
  const m = modal(title, `<div class="stack">
    <p>Comparte estos datos con <b>${esc(name)}</b>. Por seguridad <b>no se volverán a mostrar</b>; al entrar se le pedirá crear su propia contraseña.</p>
    <div class="cred"><div><small class="muted">Usuario</small><b>${esc(email)}</b></div><div><small class="muted">Contraseña temporal</small><b class="mono">${esc(pwd)}</b></div></div>
  </div>`, { footer: `<button class="btn" id="cpP">${icon('copy')} Copiar contraseña</button><button class="btn primary" id="cpM">${icon('copy')} Copiar mensaje de bienvenida</button>` });
  $('#cpP', m.el).onclick = () => copyText(pwd);
  $('#cpM', m.el).onclick = () => copyText(msg);
}

// ================= Login =================
function afterLogin(r) {
  store.token = r.token;
  store.user = r.user;
  location.hash = driverMode() ? '#/my' : '#/dashboard';
  render();
}
function viewLogin() {
  $('#app').innerHTML = `
  <div class="login">
    <section class="login-hero">
      <div class="hero-logo">${logo('lg')}</div>
      <h2>Entregas a tiempo, sin papeles.</h2>
      <ul class="hero-list">
        <li>${icon('route')}<span><b>Rutas optimizadas</b> por zona, horario y prioridad</span></li>
        <li>${icon('scan')}<span><b>Escaneo</b> de inventario y paquetes con la cámara</span></li>
        <li>${icon('camera')}<span><b>Evidencia</b> con foto, firma y GPS</span></li>
        <li>${icon('chart')}<span><b>Reportes</b> de eficiencia por repartidor</span></li>
      </ul>
    </section>
    <section class="login-side">
      <form class="login-card stack" id="loginForm" novalidate>
        <div class="login-logo">${logo()}</div>
        <div><h1>Bienvenido</h1><p class="muted" style="margin:4px 0 0">Entra con tu correo y contraseña.</p></div>
        <label class="f">Correo<input name="email" type="email" inputmode="email" autocomplete="username" placeholder="tucorreo@empresa.com" required /></label>
        ${pwdField('password', 'Contraseña', { auto: 'current-password', min: 0 })}
        <div class="login-err" id="loginErr" hidden></div>
        <button class="btn primary lg block" id="loginBtn">Entrar</button>
        <p class="muted center" style="font-size:.8rem;margin:0">¿Olvidaste tu contraseña? Pide al administrador que la restablezca.</p>
      </form>
    </section>
  </div>`;
  const f = $('#loginForm');
  wirePwd(f);
  const go = async (email, password) => {
    const err = $('#loginErr');
    err.hidden = true;
    if (!email || !password) { err.textContent = 'Escribe tu correo y contraseña.'; err.hidden = false; return; }
    const b = $('#loginBtn');
    b.disabled = true; b.textContent = 'Entrando…';
    try { afterLogin(await POST('/api/auth/login', { email, password })); }
    catch (e) { err.textContent = e.message; err.hidden = false; b.disabled = false; b.textContent = 'Entrar'; }
  };
  f.onsubmit = (e) => { e.preventDefault(); go(f.email.value.trim(), f.password.value); };
}

// Cambio obligatorio de contraseña (primer acceso o contraseña restablecida)
function viewForcePassword() {
  const u = store.user;
  $('#app').innerHTML = `<div class="login single"><section class="login-side">
    <form class="login-card stack" id="fpForm">
      <div class="login-logo">${logo()}</div>
      <div><h1>Hola, ${esc(firstName(u.name))} 👋</h1><p class="muted" style="margin:4px 0 0">Antes de continuar crea tu propia contraseña.</p></div>
      ${pwdField('current', 'Contraseña temporal', { auto: 'current-password', min: 0 })}
      ${pwdField('password', 'Nueva contraseña', { meter: true })}
      ${pwdField('confirm', 'Repite la nueva contraseña')}
      <button class="btn primary lg block">Guardar y continuar</button>
      <button type="button" class="btn ghost block" id="fpOut">Salir</button>
    </form></section></div>`;
  const f = $('#fpForm');
  wirePwd(f);
  $('#fpOut').onclick = logout;
  f.onsubmit = async (e) => {
    e.preventDefault();
    if (!f.reportValidity()) return;
    if (f.password.value !== f.confirm.value) return toast('Las contraseñas no coinciden', 'bad');
    try {
      const r = await POST('/api/me/password', { current: f.current.value, password: f.password.value });
      toast('Contraseña actualizada', 'ok');
      afterLogin(r);
    } catch (err) { toast(err.message, 'bad'); }
  };
}

// ================= Shell =================
const NAV_GROUPS = [
  ['Operación', [['dashboard', 'Tablero', 'dash'], ['orders', 'Pedidos', 'box'], ['routes', 'Rutas', 'route'], ['live', 'Mapa en vivo', 'live'], ['receipts', 'Recepciones', 'sign'], ['messages', 'Mensajes', 'chat']]],
  ['Catálogos', [['offices', 'Oficinas', 'building'], ['inventory', 'Inventario', 'inv'], ['serials', 'Números de serie', 'tag'], ['accounts', 'Mayoristas', 'building'], ['customers', 'Clientes', 'person']]],
  ['Calidad', [['compliance', 'Cumplimiento', 'shield']]],
  ['Reportes', [['analytics', 'Análisis', 'chart']]],
  ['Administración', [['guide', 'Guía', 'info'], ['users', 'Usuarios', 'users'], ['activity', 'Actividad', 'activity'], ['settings', 'Configuración', 'cog']], 'admin'],
];
const DRIVER_NAV = [['my', 'Mi ruta', 'route'], ['load', 'Cargar', 'truck'], ['stock', 'Inventario', 'inv'], ['scan', 'Buscar', 'search'], ['new-customer', 'Cliente', 'search'], ['history', 'Historial', 'history']];
const MOBILE_STAFF = [['dashboard', 'Tablero', 'dash'], ['orders', 'Pedidos', 'box'], ['routes', 'Rutas', 'route'], ['inventory', 'Inventario', 'inv']];
const navGroups = (u) => NAV_GROUPS.filter((g) => !g[2] || g[2] === u.role);

function shell(active, content) {
  const u = store.user;
  const driver = driverMode();
  const groups = driver ? [['Mi trabajo', DRIVER_NAV]] : navGroups(u);
  const all = groups.flatMap((g) => g[1]);
  const title = (all.find(([k]) => k === active) || [, active === 'profile' ? 'Mi perfil' : ''])[1];
  const mobile = driver ? DRIVER_NAV : MOBILE_STAFF;
  const moreActive = !driver && !MOBILE_STAFF.some(([k]) => k === active);
  $('#app').innerHTML = `${SETTINGS.practice_mode === '1' ? '<div class="practice-bar">🧪 COPIA DE PRÁCTICA · los datos son de ejemplo y no se envían mensajes ni filas a Google Sheets</div>' : ''}
  <div class="shell">
    <aside class="side">
      <a class="side-logo" href="#/${driver ? 'my' : 'dashboard'}">${logo()}</a>
      ${canDeliver() ? `<button class="btn block ${driver ? '' : 'primary'}" id="modeSw2" style="margin:0 10px 10px;width:calc(100% - 20px)">${driver ? '⇄ Volver a modo supervisor' : `${icon('truck')} Modo repartidor`}</button>` : ''}
      <nav class="nav">${groups.map(([g, items]) => `<div class="nav-group">${esc(g)}</div>${items.map(([k, l, i]) => `<a href="#/${k}" class="${k === active ? 'active' : ''}">${icon(i)}${l}</a>`).join('')}`).join('')}</nav>
      <a class="who ${active === 'profile' ? 'active' : ''}" href="#/profile" title="Mi perfil">${avatar(u)}<span class="grow"><b>${esc(u.name)}</b><small>${ROLE[u.role]}</small></span>${icon('chev')}</a>
    </aside>
    <div class="main-wrap">
      <header class="appbar">
        <a class="appbar-logo" href="#/${driver ? 'my' : 'dashboard'}">${logo('sm')}</a>
        <span class="appbar-title">${driver ? '<i class="gps-dot" title="Estado del GPS"></i>' : ''}${esc(title)}</span>
        ${canDeliver() ? `<button class="btn sm" id="modeSw" title="Cambiar de modo">${driver ? '⇄ Supervisor' : '⇄ Repartir'}</button>` : ''}
        <a class="appbar-av" href="#/profile" aria-label="Mi perfil">${avatar(u)}</a>
      </header>
      <main class="main" id="view">${content || ''}</main>
    </div>
  </div>
  <nav class="bottomnav">${mobile.map(([k, l, i]) => `<a href="#/${k}" class="${k === active ? 'active' : ''}">${icon(i)}<span>${l}</span></a>`).join('')}
    ${driver ? '' : `<button class="${moreActive ? 'active' : ''}" id="moreBtn">${icon('more')}<span>Más</span></button>`}</nav>`;
  $('#moreBtn')?.addEventListener('click', () => moreSheet(groups, active));
  $('#modeSw')?.addEventListener('click', () => setMode(!driver));
  $('#modeSw2')?.addEventListener('click', () => setMode(!driver));
  return $('#view');
}
function moreSheet(groups, active) {
  const u = store.user;
  const m = modal('Menú', `<a class="sheet-user" href="#/profile" data-close>${avatar(u, 'lg')}<span><b>${esc(u.name)}</b><br>${roleChip(u.role)}</span></a>
    ${groups.map(([g, items]) => `<div class="nav-group">${esc(g)}</div><div class="sheet-grid">${items.map(([k, l, i]) => `<a href="#/${k}" data-close class="${k === active ? 'active' : ''}">${icon(i)}<span>${l}</span></a>`).join('')}</div>`).join('')}
    <button class="btn block bad" style="margin-top:16px" id="sheetOut">${icon('logout')} Cerrar sesión</button>`, { sheet: true });
  $('#sheetOut', m.el).onclick = () => { m.close(); logout(); };
}
function logout() { store.token = null; store.user = null; stopTracking(); location.hash = ''; render(); }
const topbar = (title, actions = '', sub = '') => `<div class="topbar"><div><h1>${title}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}</div><div class="actions">${actions}</div></div>`;
const skeleton = () => `<div class="skel-wrap"><div class="skel h"></div><div class="grid g4">${'<div class="skel k"></div>'.repeat(4)}</div><div class="skel b"></div></div>`;

// ================= STAFF: Tablero =================
async function viewDashboard(v) {
  const prm = new URLSearchParams(location.hash.split('?')[1] || '');
  // Periodo: hoy, ayer, últimos 7 / 30 días, este mes o un rango
  const iso = (x) => x.toLocaleDateString('en-CA');
  const per = prm.get('per') || 'hoy';
  const now0 = new Date(); const back = (n) => { const x = new Date(now0); x.setDate(x.getDate() - n); return iso(x); };
  let d = today(), dTo = today();
  if (per === 'ayer') d = dTo = back(1);
  else if (per === '7') d = back(6);
  else if (per === '30') d = back(29);
  else if (per === 'mes') d = iso(new Date(now0.getFullYear(), now0.getMonth(), 1));
  else if (per === 'rango') { d = prm.get('from') || today(); dTo = prm.get('to') || d; if (dTo < d) [d, dTo] = [dTo, d]; }
  const one = d === dTo;
  const fmtD = (x) => new Date(x + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
  const perTxt = per === 'hoy' ? 'hoy' : per === 'ayer' ? 'ayer' : one ? `del ${fmtD(d)}` : `del ${fmtD(d)} al ${fmtD(dTo)}`;
  const admin = store.user.role === 'admin';
  const fOff = admin ? prm.get('office_id') || '' : '';
  const fCity = prm.get('city') || '';
  const fDrv = prm.get('driver_id') || '';
  const F = `&office_id=${fOff}&city=${encodeURIComponent(fCity)}&driver_id=${fDrv}`;
  const drvList = await GET('/api/users?role=repartidor').then((r) => (Array.isArray(r) ? r : r.rows || []).filter((u) => u.active)).catch(() => []);
  const exP = GET(`/api/dashboard/exec?from=${d}&to=${dTo}${F}`).catch(() => null);
  const [orders, routes, drivers, an, bd, offs] = await Promise.all([
    GET(`/api/orders?date=${d}&date_to=${dTo}&limit=200000${F}`), GET(`/api/routes?date=${d}&date_to=${dTo}&office_id=${fOff}&driver_id=${fDrv}`), GET(`/api/tracking/drivers?office_id=${fOff}&driver_id=${fDrv}`), GET(`/api/analytics?from=${d}&to=${dTo}${F}`),
    GET(`/api/dashboard/breakdown?${F.slice(1)}&from=${d}&to=${dTo}`).catch(() => null), admin ? GET('/api/offices').catch(() => []) : Promise.resolve([]),
  ]);
  const pct = (a, b) => (b ? fmtN((a / b) * 100, 0) + '%' : '—');
  const bdRow = (x, attr) => {
    const tot = (x.pendientes || 0) + (x.en_ruta || 0) + (x.entregados || 0) + (x.fallidos || 0);
    return `<tr class="click" ${attr}><td><b>${esc(x.name || x.city)}</b>${x.cities ? `<br><small class="muted">${esc(x.cities)}</small>` : ''}</td><td class="r num">${fmtN(x.clientes)}</td><td class="r num">${fmtN(x.pendientes)}</td><td class="r num">${fmtN(x.en_ruta)}</td>
      <td class="r num" style="color:var(--ok)"><b>${fmtN(x.entregados)}</b>${x.entregados_hoy ? `<br><small>+${x.entregados_hoy} ${esc(perTxt)}</small>` : ''}</td><td class="r num" style="color:var(--bad)">${fmtN(x.fallidos)}${x.fallidos_hoy ? `<br><small>+${x.fallidos_hoy} ${esc(perTxt)}</small>` : ''}</td>${invCell(x)}
      <td style="min-width:110px"><div class="progress"><i style="width:${tot ? (x.entregados / tot) * 100 : 0}%;background:var(--ok)"></i></div><small class="muted">${pct(x.entregados, tot)} entregado</small></td></tr>`;
  };
  const bdHead = (first, inv) => `<thead><tr><th>${first}</th><th class="r">Clientes</th><th class="r">Pendientes</th><th class="r">En ruta</th><th class="r">Entregados</th><th class="r">Fallidos</th>${inv ? '<th class="r" title="Equipos con S/N libres: almacén + repartidores + abierto">Inventario disponible</th>' : ''}<th>Avance</th></tr></thead>`;
  const invCell = (x) => {
    if (x.inv_total == null) return '';
    const need = (x.pendientes || 0) + (x.en_ruta || 0);
    const short = need - x.inv_total;
    return `<td class="r num" title="Almacén ${x.inv_almacen} · repartidores ${x.inv_repartidores} · abierto ${x.inv_abierto}"><b>${fmtN(x.inv_total)}</b><br><small class="muted">${fmtN(x.inv_almacen)} alm · ${fmtN(x.inv_repartidores)} rep${x.inv_abierto ? ` · ${fmtN(x.inv_abierto)} abierto` : ''}</small>${short > 0 ? `<br><small style="color:var(--bad)">faltan ${fmtN(short)}</small>` : need ? '<br><small style="color:var(--ok)">alcanza ✓</small>' : ''}</td>`;
  };
  const c = (s) => orders.rows.filter((o) => s.includes(o.status)).length;
  const T = an.totals || {};
  const nDel = T.delivered || 0, nFail = T.failed || 0;
  const done = nDel + nFail;
  const hr = new Date().getHours();
  v.innerHTML = topbar(`${hr < 12 ? 'Buenos días' : hr < 19 ? 'Buenas tardes' : 'Buenas noches'}, ${esc(firstName(store.user.name))}`,
    `<a class="btn" href="#/routes">${icon('route')} Planificar rutas</a><button class="btn primary" id="newOrder">${icon('plus')} Nuevo pedido</button>`,
    per === 'hoy' ? `Resumen del ${new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })}` : `Resumen ${perTxt}`) + `
  <form class="row card" id="dashF" style="gap:8px;flex-wrap:wrap;padding:10px 14px;margin-bottom:12px">
    <label class="row" style="gap:6px">${icon('history')}<select name="per">${[['hoy', 'Hoy'], ['ayer', 'Ayer'], ['7', 'Últimos 7 días'], ['30', 'Últimos 30 días'], ['mes', 'Este mes'], ['rango', 'Elegir fechas…']].map(([k, l]) => `<option value="${k}" ${k === per ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    ${per === 'rango' ? `<input type="date" name="from" value="${d}" /><small>a</small><input type="date" name="to" value="${dTo}" />` : ''}
    ${admin && offs.length > 1 ? `<label class="row" style="gap:6px">${icon('building')}<select name="office_id"><option value="">Todas las oficinas</option>${offs.map((o) => `<option value="${o.id}" ${String(o.id) === fOff ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select></label>` : ''}
    <label class="row" style="gap:6px">${icon('truck')}<select name="driver_id"><option value="">Todos los repartidores</option>${drvList.map((u) => `<option value="${u.id}" ${String(u.id) === fDrv ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></label>
    <label class="row" style="gap:6px">${icon('live')}<select name="city"><option value="">Todas las ciudades</option>${(bd?.city_list || []).map((c) => `<option ${c.toLowerCase() === fCity.toLowerCase() ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
    ${fOff || fCity || fDrv ? `<a class="btn sm ghost" href="#/dashboard?per=${per}${per === 'rango' ? `&from=${d}&to=${dTo}` : ''}">Quitar filtros</a>` : ''}
    <small class="muted grow" style="text-align:right">${fOff || fCity || fDrv ? `Viendo: ${esc([offs.find((o) => String(o.id) === fOff)?.name, fCity, drvList.find((u) => String(u.id) === fDrv)?.name].filter(Boolean).join(' · '))}` : 'Viendo todo'}</small>
  </form>
  <div class="grid g4">
    <div class="card kpi"><div class="label">Pedidos ${esc(perTxt)}</div><div class="value">${T.total || 0}</div><div class="sub">${c(['pendiente'])} sin ruta · programados o atendidos ${esc(perTxt)}</div></div>
    <div class="card kpi"><div class="label">En ruta</div><div class="value">${c(['asignado', 'cargado'])}</div><div class="sub">${c(['cargado'])} ya en vehículo</div></div>
    <div class="card kpi"><div class="label">Entregados ${esc(perTxt)}</div><div class="value" style="color:var(--ok)">${nDel}</div><div class="sub">${done ? fmtN((nDel / done) * 100, 1) + '% de éxito' : '—'}</div></div>
    <div class="card kpi"><div class="label">Fallidos ${esc(perTxt)}</div><div class="value" style="color:var(--bad)">${nFail}</div><div class="sub">${routes.length} rutas · ${fmtN(routes.reduce((a, r) => a + (r.distance_km || 0), 0), 1)} km plan</div></div>
  </div>
  <div class="grid g-main" style="margin-top:14px">
    <div class="card"><div class="row between"><h2>${fOff || fCity ? `Clientes con pedido · ${esc([offs.find((o) => String(o.id) === fOff)?.name, fCity].filter(Boolean).join(' · '))}` : per === 'hoy' ? 'Rutas del día' : `Rutas ${esc(perTxt)}`}</h2><small class="muted" id="dmapInfo">🚚 posición de repartidores</small></div><div id="dmap" class="map${fOff || fCity ? ' tall' : ''}"></div>
      ${fOff || fCity ? `<div class="legend" style="margin-top:8px">${['pendiente', 'asignado', 'cargado', 'fallido'].map((k) => `<span><i style="background:${PIN_COLORS[k]}"></i>${STATUS[k]}</span>`).join('')}<span>🚚 Repartidor</span></div>` : ''}</div>
    <div class="stack">
      <div class="card"><h2>Avance por repartidor</h2>${drivers.length ? drivers.map((x) => {
        const t = x.pending + x.delivered;
        return `<div style="margin-bottom:12px"><div class="row between"><b>${esc(x.name)}</b><small class="num">${x.delivered}/${t}</small></div>
          <div class="progress"><i style="width:${t ? (x.delivered / t) * 100 : 0}%;background:var(--ok)"></i></div>
          <small class="muted">${x.last_seen ? 'Visto ' + fmtDT(x.last_seen) : 'Sin GPS'}</small></div>`;
      }).join('') : '<p class="muted">Sin repartidores</p>'}</div>
      <div class="card"><h2>Stock bajo</h2>${an.lowStock.length ? `<table><tbody>${an.lowStock.map((p) => `<tr><td>${esc(p.name)}<br><small class="muted">${esc(p.sku)}</small></td><td class="r num" style="color:var(--bad);font-weight:700">${p.stock}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Todo en orden ✅</p>'}</div>
    </div>
  </div>`;
  const ex = await exP;
  if (ex) $('#dashF').insertAdjacentHTML('afterend', execBoard(ex, bd, perTxt) + '<h2 class="ops-title">Operación</h2>');
  wireExecBoard(v);
  if (bd) v.querySelector('.grid.g4').insertAdjacentHTML('afterend', `<div class="grid g2" style="margin-top:14px">
    ${bd.offices.length ? `<div class="card"><div class="row between"><h2>${icon('building')} Por oficina</h2><small class="muted">acumulado · toca para filtrar</small></div><div class="table-wrap"><table>${bdHead('Oficina', true)}<tbody>${bd.offices.map((x) => bdRow(x, `data-off="${x.id}"`)).join('')}</tbody></table></div></div>` : ''}
    <div class="card"><div class="row between"><h2>${icon('live')} Por ciudad</h2><small class="muted">acumulado · toca para filtrar</small></div><div class="table-wrap"><table>${bdHead('Ciudad')}<tbody>${bd.cities.map((x) => bdRow(x, `data-city="${esc(x.city)}"`)).join('') || '<tr><td colspan="7" class="muted">Sin datos</td></tr>'}</tbody></table></div></div></div>`);
  const perQ = () => { const f = new FormData($('#dashF')); const pp = f.get('per') || per; return `&per=${pp}${pp === 'rango' ? `&from=${f.get('from') || d}&to=${f.get('to') || dTo}` : ''}`; };
  const go = (o, c) => { location.hash = `#/dashboard?office_id=${o ?? fOff}&city=${encodeURIComponent(c ?? fCity)}&driver_id=${new FormData($('#dashF')).get('driver_id') || ''}${perQ()}`; };
  $('#dashF').onchange = (e) => { const f = new FormData($('#dashF')); go(f.get('office_id') ?? '', e.target.name === 'office_id' ? '' : f.get('city') || ''); };
  $$('[data-off]', v).forEach((tr) => (tr.onclick = () => admin && go(tr.dataset.off, '')));
  $$('[data-city]', v).forEach((tr) => (tr.onclick = () => tr.dataset.city !== 'Sin ciudad' && go(null, tr.dataset.city)));
  $('#newOrder').onclick = () => orderForm(() => render());
  const map = makeMap($('#dmap'));
  const all = [depotLatLng()];
  for (const [i, r] of (fOff || fCity ? [] : routes).entries()) {
    const det = await GET('/api/routes/' + r.id);
    all.push(...drawRoute(map, det.stops, ROUTE_COLORS[i % ROUTE_COLORS.length], { fit: false, depot: i === 0, onEdit: () => render() }));
  }
  if (!routes.length) L.marker(depotLatLng(), { icon: depotIcon() }).addTo(map);
  for (const x of drivers) if (x.last_lat) { L.marker([x.last_lat, x.last_lng], { icon: truckIcon() }).addTo(map).bindPopup(`<b>${esc(x.name)}</b><br>${fmtDT(x.last_seen)}`); all.push([x.last_lat, x.last_lng]); }
  // Con filtro de oficina o ciudad: clientes con pedido abierto de esa selección
  if (fOff || fCity) {
    const op = await GET(`/api/orders?limit=200000&date=&status=pendiente,asignado,cargado,fallido${F}`);
    const seen = new Map();
    for (const o of op.rows) if (o.lat != null) { const k = o.customer_id; if (!seen.has(k)) seen.set(k, []); seen.get(k).push(o); }
    const pts = [];
    for (const list of seen.values()) {
      const o = list[0];
      const st = list.some((x) => x.status === 'cargado') ? 'cargado' : list.some((x) => x.status === 'asignado') ? 'asignado' : list.some((x) => x.status === 'fallido') ? 'fallido' : 'pendiente';
      editableCustomerPin(map, L.circleMarker([o.lat, o.lng], { radius: 7, color: '#fff', weight: 1.5, fillColor: PIN_COLORS[st], fillOpacity: 0.9 }).addTo(map),
        { id: o.customer_id, name: o.customer_name, address: `${o.address || ''}${o.customer_city ? ', ' + o.customer_city : ''}`, extra: `<br>${list.map((x) => `${esc(x.tracking_code)} · ${STATUS[x.status]}${x.driver_name ? ' · ' + esc(x.driver_name) : ''}`).join('<br>')}` });
      pts.push([o.lat, o.lng]);
    }
    const sinUbic = new Set(op.rows.filter((o) => o.lat == null).map((o) => o.customer_id)).size;
    $('#dmapInfo').textContent = `${seen.size} clientes en el mapa${sinUbic ? ` · ${sinUbic} sin ubicar` : ''}${op.total > op.rows.length ? ` · mostrando ${op.rows.length} de ${op.total} pedidos` : ''}`;
    if (pts.length) map.fitBounds(pts, { padding: [30, 30], maxZoom: 15 });
    return;
  }
  if (all.length > 1) map.fitBounds(all, { padding: [30, 30] });
}

// ---------- Tablero de Dirección ----------
// Indicadores clave contra el periodo anterior, tendencia diaria, ranking de repartidores, oficinas y alertas
function execBoard(ex, bd, perTxt) {
  const n = (x) => Number(x) || 0;
  const goal = Number(SETTINGS.success_goal) || 95;
  const rate = (a, b) => (n(b) ? (n(a) / n(b)) * 100 : null);
  const c = ex.cur, p = ex.prevp;
  const sr = rate(c.delivered, n(c.delivered) + n(c.failed)), srP = rate(p.delivered, n(p.delivered) + n(p.failed));
  const ft = rate(c.first_try, c.delivered), ftP = rate(p.first_try, p.delivered);
  const dDays = ex.drivers.reduce((a, x) => a + n(x.days), 0);
  const prod = dDays ? n(c.delivered) / dDays : null;
  const port = ex.portfolio, totP = n(port.delivered) + n(port.open);
  const adv = rate(port.delivered, totP);
  const fmtDay = (x) => new Date(x + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
  // variación contra el periodo anterior (en % para cantidades, en puntos para tasas)
  const delta = (cur, prev, { pts = false, inverse = false } = {}) => {
    if (cur == null || prev == null || (!pts && !n(prev))) return '<span class="xk-delta muted">sin periodo previo</span>';
    const v = pts ? cur - prev : ((cur - prev) / prev) * 100;
    if (Math.abs(v) < 0.05) return '<span class="xk-delta muted">= igual</span>';
    const good = inverse ? v < 0 : v > 0;
    return `<span class="xk-delta ${good ? 'up' : 'down'}" title="Contra ${fmtDay(ex.prev.from)} – ${fmtDay(ex.prev.to)}">${v > 0 ? '▲' : '▼'} ${fmtN(Math.abs(v), 1)}${pts ? ' pts' : '%'}</span>`;
  };
  const tile = (label, value, sub, extra = '', cls = '') => `<div class="xk ${cls}"><div class="xk-label">${label}</div><div class="xk-value">${value}</div>${extra}<div class="xk-sub">${sub}</div></div>`;
  const meter = (v, goalV) => `<div class="xk-meter"><i style="width:${Math.max(0, Math.min(100, v || 0))}%"></i>${goalV ? `<b style="left:${goalV}%" title="Meta ${goalV}%"></b>` : ''}</div>`;
  const kpis = [
    tile('Entregas', fmtN(n(c.delivered)), `${delta(n(c.delivered), n(p.delivered))} · ${fmtN(n(c.delivered) / Math.max(1, ex.days), 1)} por día`),
    tile('Tasa de éxito', sr == null ? '—' : fmtN(sr, 1) + '%', `${delta(sr, srP, { pts: true })} · meta ${goal}%`, meter(sr, goal), sr != null && sr < goal ? 'warn' : ''),
    tile('Primer intento', ft == null ? '—' : fmtN(ft, 1) + '%', `${delta(ft, ftP, { pts: true })} · sin reintentos`, meter(ft)),
    tile('Productividad', prod == null ? '—' : fmtN(prod, 1), `entregas por repartidor por día · ${n(c.drivers)} repartidor(es)`),
    tile('Avance de la cartera', adv == null ? '—' : fmtN(adv, 1) + '%', `${fmtN(n(port.delivered))} de ${fmtN(totP)} · ${fmtN(n(port.open))} abiertos`, meter(adv)),
    tile('Pendientes vencidos', fmtN(n(port.overdue)), n(port.overdue) ? 'con fecha anterior a hoy · reprogramar' : 'al día', '', n(port.overdue) ? 'bad' : 'good'),
  ].join('');
  // tendencia diaria: barras apiladas entregados + no entregados (estado), con tooltip
  const max = Math.max(1, ...ex.series.map((x) => x.delivered + x.failed));
  const step = Math.max(1, Math.ceil(ex.series.length / 8));
  const nice = (() => { const r = Math.pow(10, Math.floor(Math.log10(max))); return Math.ceil(max / r) * r; })();
  const trend = `<div class="xt-wrap"><div class="xt-grid">${[1, 0.5, 0].map((f) => `<div style="bottom:${f * 100}%"><span>${fmtN(nice * f)}</span></div>`).join('')}</div>
    <div class="xt-bars">${ex.series.map((x, i) => {
      const t = x.delivered + x.failed;
      return `<div class="xt-col" data-tip="${esc(new Date(x.d + 'T12:00:00').toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' }))}|${x.delivered}|${x.failed}|${t ? fmtN((x.delivered / t) * 100, 1) + '%' : '—'}">
        <div class="xt-stack" style="height:${(t / nice) * 100}%">${x.failed ? `<i class="f" style="flex:${x.failed}"></i>` : ''}${x.delivered ? `<i class="d" style="flex:${x.delivered}"></i>` : ''}</div>
        <small>${(i % step === 0 && ex.series.length - 1 - i >= Math.ceil(step / 2)) || i === ex.series.length - 1 ? esc(fmtDay(x.d)) : ''}</small></div>`;
    }).join('')}</div><div class="xt-tip" hidden></div></div>
    <div class="legend" style="margin-top:6px"><span><i style="background:var(--ok)"></i>Entregados</span><span><i style="background:var(--bad)"></i>No entregados</span></div>`;
  // alertas
  const al = ex.alerts;
  const alert = (k, nn, txt, href) => `<a class="xa ${nn ? k : 'ok'}" href="${href}"><b>${fmtN(nn)}</b><span>${txt}</span>${nn ? icon('chev') : '✓'}</a>`;
  const alerts = [
    alert('bad', al.overdue, 'pedidos vencidos sin entregar', '#/orders?date=&status=pendiente'),
    alert('warn', al.no_route_today, 'pedidos de hoy sin ruta asignada', '#/routes'),
    alert('warn', al.geo_check, 'clientes con ubicación por revisar', '#/customers'),
    alert('warn', al.sms_failed, 'SMS no enviados (24 h)', '#/messages?status=error'),
  ].join('');
  // ranking
  const maxD = Math.max(1, ...ex.drivers.map((x) => n(x.delivered)));
  const rank = ex.drivers.length ? `<div class="table-wrap"><table class="xr"><thead><tr><th>#</th><th>Repartidor</th><th>Entregas</th><th class="r">Éxito</th><th class="r">1er intento</th><th class="r">Por día</th></tr></thead><tbody>${ex.drivers.slice(0, 12).map((x, i) => {
    const r = rate(x.delivered, n(x.delivered) + n(x.failed)), f1 = rate(x.first_try, x.delivered);
    return `<tr><td class="num">${i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1}</td><td><b>${esc(x.name)}</b></td>
      <td style="min-width:140px"><div class="xr-bar"><i style="width:${(n(x.delivered) / maxD) * 100}%"></i><span>${fmtN(n(x.delivered))}</span></div></td>
      <td class="r num ${r != null && r < goal ? 'xr-low' : ''}">${r == null ? '—' : fmtN(r, 1) + '%'}</td><td class="r num">${f1 == null ? '—' : fmtN(f1, 0) + '%'}</td><td class="r num">${x.days ? fmtN(n(x.delivered) / x.days, 1) : '—'}</td></tr>`;
  }).join('')}</tbody></table></div>` : '<p class="muted">Sin entregas en el periodo</p>';
  // oficinas
  const invOf = (id) => bd?.offices?.find((o) => String(o.id) === String(id));
  const offRows = ex.offices.map((o) => {
    const tot = n(o.delivered_all) + n(o.open), a = rate(o.delivered_all, tot), r = rate(o.delivered, n(o.delivered) + n(o.failed));
    const inv = invOf(o.id)?.inv_total;
    const cover = inv == null ? '' : inv >= n(o.open) ? `<span class="chip ok" title="Inventario disponible ${inv} para ${o.open} pedidos abiertos">✓ ${fmtN(inv)}</span>` : `<span class="chip off" title="Inventario ${inv}: faltan ${n(o.open) - inv} equipos para cubrir los pedidos abiertos">⚠ faltan ${fmtN(n(o.open) - inv)}</span>`;
    return `<tr><td><b>${esc(o.name || 'Oficina')}</b></td><td style="min-width:130px">${meter(a)}<small class="muted">${a == null ? '—' : fmtN(a, 1) + '%'} · ${fmtN(n(o.delivered_all))}/${fmtN(tot)}</small></td>
      <td class="r num ${r != null && r < goal ? 'xr-low' : ''}">${r == null ? '—' : fmtN(r, 1) + '%'}<br><small class="muted">${fmtN(n(o.delivered))} entregas</small></td><td class="r num">${fmtN(n(o.open))}${n(o.overdue) ? `<br><small style="color:var(--bad)">${fmtN(n(o.overdue))} vencidos</small>` : ''}</td><td class="r">${cover}</td></tr>`;
  }).join('');
  return `<section class="exec">
    <div class="exec-head"><div><small class="muted">VISTA DE DIRECCIÓN</small><h2 style="margin:2px 0 0">Desempeño ${esc(perTxt)}</h2></div><small class="muted">Comparado con ${esc(fmtDay(ex.prev.from))} – ${esc(fmtDay(ex.prev.to))}</small></div>
    <div class="xk-grid">${kpis}</div>
    <div class="grid g-main" style="margin-top:12px">
      <div class="card"><div class="row between"><h3 style="margin:0">Tendencia diaria</h3><small class="muted">${ex.series.length} días</small></div>${trend}</div>
      <div class="card"><h3 style="margin:0 0 8px">Alertas</h3><div class="xa-list">${alerts}</div></div>
    </div>
    <div class="grid g2" style="margin-top:12px">
      <div class="card"><div class="row between"><h3 style="margin:0">Ranking de repartidores</h3><small class="muted">éxito bajo la meta en naranja</small></div>${rank}</div>
      <div class="card"><div class="row between"><h3 style="margin:0">Resultados por oficina</h3><small class="muted">avance de la cartera · inventario vs abiertos</small></div>
        ${offRows ? `<div class="table-wrap"><table><thead><tr><th>Oficina</th><th>Avance</th><th class="r">Éxito</th><th class="r">Abiertos</th><th class="r">Inventario</th></tr></thead><tbody>${offRows}</tbody></table></div>` : '<p class="muted">Sin datos</p>'}</div>
    </div>
  </section>`;
}
function wireExecBoard(v) {
  const tip = $('.xt-tip', v);
  if (!tip) return;
  $$('.xt-col', v).forEach((c) => {
    c.onmouseenter = () => {
      const [d, del, fail, sr] = c.dataset.tip.split('|');
      tip.innerHTML = `<b>${d}</b><div><i style="background:var(--ok)"></i>Entregados <b>${del}</b></div><div><i style="background:var(--bad)"></i>No entregados <b>${fail}</b></div><div class="muted">Éxito ${sr}</div>`;
      tip.hidden = false;
      const w = c.parentElement.getBoundingClientRect(), r = c.getBoundingClientRect();
      tip.style.left = Math.min(w.width - 150, Math.max(0, r.left - w.left + r.width / 2 - 75)) + 'px';
      c.classList.add('on');
    };
    c.onmouseleave = () => { tip.hidden = true; c.classList.remove('on'); };
  });
}

// ================= STAFF: Pedidos =================
async function viewOrders(v) {
  const p = new URLSearchParams(location.hash.split('?')[1] || '');
  const st = p.get('status') || '';
  const date = p.get('date') ?? today();
  const dateTo = date ? p.get('date_to') || '' : '';
  const q = p.get('q') || '';
  const acc = p.get('account_id') || '';
  const off = p.get('office_id') || '';
  const city = p.get('city') || '';
  const colonias = p.getAll('colonia').filter(Boolean);
  const colSet = new Set(colonias.map((x) => x.toLowerCase()));
  const sort = p.get('sort') || 'geo';
  const cityList = GET(`/api/dashboard/breakdown?office_id=${off}`).then((r) => r.city_list).catch(() => []);
  const colList = GET(`/api/orders/colonias?office_id=${off}&city=${encodeURIComponent(city)}`).catch(() => []);
  const [data, accs, offList] = await Promise.all([GET(`/api/orders?limit=200000&status=${st}&date=${date}&date_to=${dateTo}&q=${encodeURIComponent(q)}&account_id=${acc}&office_id=${off}&city=${encodeURIComponent(city)}${colonias.map((x) => '&colonia=' + encodeURIComponent(x)).join('')}&sort=${sort}`), GET('/api/accounts').catch(() => ({ rows: [] })), GET('/api/warehouses').catch(() => [])]);
  v.innerHTML = topbar('Pedidos', `<button class="btn" id="scanFind">${icon('scan')} Escanear S/N o guía</button><button class="btn" id="asgX">${icon('upload')} Asignar por Excel</button><button class="btn primary" id="newOrder">${icon('plus')} Nuevo pedido</button>`) + `
  <div class="card">
    <form class="row" id="filt" style="margin-bottom:12px">
      <input name="q" placeholder="Número de serie o número de pedido (o cliente, teléfono)" value="${esc(q)}" class="grow" style="max-width:340px" autofocus />
      <label class="row" style="gap:4px"><small class="muted">Desde</small><input type="date" name="date" value="${esc(date)}" style="max-width:160px" /></label>
      <label class="row" style="gap:4px"><small class="muted">Hasta</small><input type="date" name="date_to" value="${esc(dateTo || date)}" style="max-width:160px" /></label>
      <span class="row" style="gap:4px">${[['hoy', 'Hoy'], ['7', '7 días'], ['sem', 'Esta semana'], ['mes', 'Este mes']].map(([k, l]) => `<button type="button" class="btn sm ghost" data-rng="${k}">${l}</button>`).join('')}</span>
      <select name="status" style="max-width:170px"><option value="">Todos los estados</option>${['pendiente', 'asignado', 'cargado', 'entregado', 'fallido', 'cancelado'].map((s) => `<option value="${s}" ${s === st ? 'selected' : ''}>${STATUS[s]}</option>`).join('')}</select>
      ${accs.rows.length ? `<select name="account_id" style="max-width:190px"><option value="">Todos los mayoristas</option>${accs.rows.map((a) => `<option value="${a.id}" ${String(a.id) === acc ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}<option value="none" ${acc === 'none' ? 'selected' : ''}>Sin mayorista</option></select>` : ''}
      ${store.user.role === 'admin' && offList.length > 1 ? `<select name="office_id" style="max-width:190px"><option value="">Todas las oficinas</option>${offList.map((w) => `<option value="${w.id}" ${String(w.id) === off ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}</select>` : ''}
      <select name="city" style="max-width:190px"><option value="">Todas las ciudades</option>${(await cityList).map((c) => `<option ${c.toLowerCase() === city.toLowerCase() ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
      ${await (async () => { const cl = await colList; const extra = colonias.filter((x) => !cl.some((c) => c.name.toLowerCase() === x.toLowerCase())).map((x) => ({ name: x, n: '' }));
        return `<details class="multi-sel" id="colSel"><summary class="btn" title="Colonia o fraccionamiento">${icon('building')} ${colonias.length ? (colonias.length === 1 ? esc(colonias[0]) : `${colonias.length} colonias`) : 'Todas las colonias'}</summary>
        <div class="multi-pop"><input type="search" id="colQ" placeholder="Buscar colonia…" />
          <div class="multi-list">${[...extra, ...cl].map((c) => `<label data-t="${esc((c.name + ' ' + (c.city || '')).toLowerCase())}"><input type="checkbox" name="colonia" value="${esc(c.name)}" ${colSet.has(c.name.toLowerCase()) ? 'checked' : ''} /> <span class="grow">${esc(c.name)}${city || !c.city ? '' : ` <small class="muted">· ${esc(c.city)}</small>`}</span> <small class="muted">${c.n}</small></label>`).join('') || '<small class="muted">Sin colonias</small>'}</div>
          <div class="row" style="gap:6px;margin-top:8px"><button type="button" class="btn sm ghost" id="colNone">Limpiar</button><span class="grow"></span><button class="btn sm primary">Aplicar</button></div></div></details>`; })()}
      <select name="sort" style="max-width:220px" title="Orden de la lista"><option value="geo" ${sort === 'geo' ? 'selected' : ''}>Por ciudad, colonia y cercanía</option><option value="fecha" ${sort !== 'geo' ? 'selected' : ''}>Por fecha</option></select>
      <button class="btn">Filtrar</button><button type="button" class="btn ghost" id="allDates">Todas las fechas</button>
      <small class="muted" style="margin-left:auto">${data.total} pedidos</small>
    </form>
    <div class="row" style="gap:6px;margin-bottom:8px;flex-wrap:wrap"><small class="muted">Marca un pedido y agrega los más cercanos:</small><input type="number" id="nearN" min="1" value="20" style="width:80px" /><button type="button" class="btn sm" id="nearGo">${icon('live')} Seleccionar N más cercanos</button><small class="muted">· al asignar, la ruta se ordena sola por el camino más corto</small></div>
    <div class="table-wrap"><table><thead><tr><th style="width:34px"><input type="checkbox" id="selAll" title="Seleccionar todos los que se pueden asignar" /></th><th>Guía</th><th>Cliente</th><th>Ciudad</th><th>Dirección</th><th>Fecha</th><th>Repartidor</th><th>Parada</th><th>Estado</th></tr></thead><tbody>
    ${data.rows.map((o, ix) => `${sort === 'geo' && o.city_group && (ix === 0 || data.rows[ix - 1].city_group !== o.city_group) ? `<tr class="grp-row" style="background:var(--bg-soft,#f3f6fa)"><td><input type="checkbox" data-citysel="${esc(o.city_group)}" title="Seleccionar toda la ciudad" /></td><td colspan="9"><b>${icon('live')} ${esc(o.city_group)}</b> <small class="muted">· ${data.rows.filter((x) => x.city_group === o.city_group).length} pedidos</small></td></tr>` : ''}${sort === 'geo' && o.col_group && (ix === 0 || data.rows[ix - 1].col_group !== o.col_group || data.rows[ix - 1].city_group !== o.city_group) ? `<tr class="grp-row col-row"><td><input type="checkbox" data-colsel="${esc(o.col_group)}" data-colcity="${esc(o.city_group)}" title="Seleccionar toda la colonia" /></td><td colspan="9" style="padding-left:22px">${icon('building')} <b>${esc(o.col_group)}</b> <small class="muted">· ${data.rows.filter((x) => x.city_group === o.city_group && x.col_group === o.col_group).length} pedido(s)${o.geo_seq == null ? ' · sin ubicación' : ''}</small> <button type="button" class="btn sm ghost" data-colfilt="${esc(o.col_group)}" title="Ver solo esta colonia">Filtrar</button></td></tr>` : ''}<tr class="click" data-id="${o.id}"><td><input type="checkbox" data-sel="${o.id}" data-city="${esc(o.city_group || '')}" data-col="${esc(o.col_group || '')}" data-lat="${o.lat ?? ''}" data-lng="${o.lng ?? ''}" ${['entregado', 'cancelado'].includes(o.status) ? `disabled title="Pedido ${STATUS[o.status].toLowerCase()}"` : ''} /></td><td><b>${esc(o.tracking_code)}</b> ${o.priority === 'alta' ? '<span class="badge b-alta">Urgente</span>' : ''}${o.sn_list ? `<br><small class="mono muted">S/N ${esc(o.sn_list)}</small>` : ''}</td><td>${esc(o.customer_name)}${o.account_name ? `<br><small class="muted">${icon('building')} ${esc(o.account_name)}</small>` : ''}</td><td><b>${esc(o.customer_city || '—')}</b>${o.customer_colonia ? `<br><small class="muted">${esc(o.customer_colonia)}</small>` : ''}</td><td><small>${esc(o.address)}</small>${geoChk(o.geo_quality) && !['entregado', 'cancelado'].includes(o.status) ? `<br><small style="color:#e5612a" title="Ubicación aproximada: revisar">⚠ ubicación por revisar</small>` : ''}</td><td class="num">${esc(o.scheduled_date)}</td><td>${esc(o.driver_name || '—')}</td><td class="num">${o.stop_seq ?? '—'}${o.eta ? ` <small class="muted">${o.eta}</small>` : ''}</td><td>${badge(o.status)}</td></tr>`).join('') || '<tr><td colspan="9" class="empty">Sin pedidos</td></tr>'}
    </tbody></table></div>
  </div>`;
  $('#filt').onsubmit = (e) => { e.preventDefault(); const f = new FormData(e.target); location.hash = `#/orders?${new URLSearchParams(f)}`; };
  ['city', 'office_id'].forEach((n) => $(`#filt [name=${n}]`)?.addEventListener('change', () => { $$('#filt [name=colonia]').forEach((c) => (c.checked = false)); $('#filt').requestSubmit(); }));
  // varias colonias: buscar, marcar y Aplicar
  $('#colQ')?.addEventListener('input', (e) => { const t = e.target.value.toLowerCase().trim(); $$('#colSel .multi-list label').forEach((l) => (l.hidden = !!t && !l.dataset.t.includes(t))); });
  $('#colNone')?.addEventListener('click', () => { $$('#filt [name=colonia]').forEach((c) => (c.checked = false)); $('#filt').requestSubmit(); });
  document.addEventListener('click', (e) => { const d = $('#colSel'); if (d?.open && !d.contains(e.target)) d.open = false; });
  geoPickWire(v);
  // "Filtrar" en el encabezado de una colonia: solo esa colonia
  $$('[data-colfilt]', v).forEach((b) => (b.onclick = (e) => {
    e.stopPropagation();
    const f = $('#filt');
    const want = b.dataset.colfilt.toLowerCase();
    let hit = false;
    $$('[name=colonia]', f).forEach((c) => { c.checked = c.value.toLowerCase() === want; hit ||= c.checked; });
    if (!hit) f.insertAdjacentHTML('beforeend', `<input type="hidden" name="colonia" value="${esc(b.dataset.colfilt)}" />`);
    f.requestSubmit();
  }));
  $('#allDates').onclick = () => { location.hash = `#/orders?date=&status=${st}&office_id=${off}&city=${encodeURIComponent(city)}`; };
  // rangos rápidos de fechas
  $$('[data-rng]', v).forEach((b) => (b.onclick = () => {
    const f = $('#filt'); const d0 = new Date(); const iso = (d) => d.toLocaleDateString('en-CA');
    let a = new Date(d0), z = new Date(d0);
    if (b.dataset.rng === '7') a.setDate(d0.getDate() - 6);
    if (b.dataset.rng === 'sem') { a.setDate(d0.getDate() - ((d0.getDay() + 6) % 7)); z = new Date(a); z.setDate(a.getDate() + 6); }
    if (b.dataset.rng === 'mes') { a = new Date(d0.getFullYear(), d0.getMonth(), 1); z = new Date(d0.getFullYear(), d0.getMonth() + 1, 0); }
    f.date.value = iso(a); f.date_to.value = iso(z); f.requestSubmit();
  }));
  $$('tr[data-id]', v).forEach((tr) => (tr.onclick = () => orderDetail(tr.dataset.id)));
  $('#newOrder').onclick = () => orderForm(() => render());
  bulkAssign(v, 'orders');
  $('#asgX').onclick = () => excelAssign({ mode: 'driver' });
  $('#scanFind').onclick = () => openScanner({ title: 'Buscar pedido por S/N o guía', onCode: async (c) => { const o = await GET('/api/orders/tracking/' + encodeURIComponent(c)); orderDetail(o.id); } });
}

async function orderDetail(id) {
  const o = await GET('/api/orders/' + id);
  const staff = !driverMode();
  const m = modal(`Pedido ${o.tracking_code}`, `
    <div class="grid g2">
      <div class="stack">
        <dl class="kv">
          <dt>Estado</dt><dd>${badge(o.status)} ${o.priority === 'alta' ? '<span class="badge b-alta">Urgente</span>' : ''}</dd>
          ${staff ? `<dt>Mayorista</dt><dd id="oAcc">${o.account_name ? `<b>${esc(o.account_name)}</b>` : '<span class="muted">Sin mayorista</span>'} <button class="btn sm ghost" id="oAccEd">Cambiar</button></dd>` : ''}
          <dt>Cliente</dt><dd><b>${esc(o.customer_name)}</b>${o.customer_phone ? `<br>Móvil: <a href="tel:${esc(o.customer_phone)}">${esc(o.customer_phone)}</a>` : ''}${o.customer_phone_alt ? `<br>Adicional: <a href="tel:${esc(o.customer_phone_alt)}">${esc(o.customer_phone_alt)}</a>` : ''}${o.telnor_phone ? `<br>Telnor: <span class="mono">${esc(o.telnor_phone)}</span>` : ''}</dd>
          <dt>Dirección</dt><dd>${esc(o.address)}${o.customer_colonia && !String(o.address || '').toUpperCase().includes(String(o.customer_colonia).toUpperCase()) ? `, Col. ${esc(o.customer_colonia)}` : ''}${o.customer_city ? `, ${esc(o.customer_city)}` : ''}${o.address_reference ? `<br><small class="muted">${esc(o.address_reference)}</small>` : ''}${staff ? ` <button class="btn sm ghost" id="oAddrEd" title="Editar domicilio y datos del cliente">${icon('edit')} Editar</button>` : ''}</dd>
          <dt>Ventana</dt><dd>${o.appointment_time ? `<b>⏰ ${esc(o.appointment_time)}</b> (hora acordada)` : o.window_start ? `${esc(o.window_start)}–${esc(o.window_end)}` : 'Libre'}</dd>
          <dt>Fecha</dt><dd>${esc(o.scheduled_date)}</dd>
          <dt>Repartidor</dt><dd id="oDrv">${esc(o.driver_name || '—')} ${o.stop_seq ? `· parada ${o.stop_seq} · ETA ${esc(o.eta || '—')}` : ''}${staff && ['pendiente', 'asignado'].includes(o.status) ? ` <button class="btn sm ghost" id="oDrvEd">${icon('truck')} ${o.driver_id ? 'Cambiar' : 'Asignar'}</button>` : ''}</dd>
          ${o.shipment_type && o.shipment_type !== 'general' || o.temp_min != null || o.temp_max != null || o.requires_seal ? `<dt>Tipo de envío</dt><dd><b>${esc(SHIP_TYPES[o.shipment_type] || 'General')}</b>${fmtRange(o.temp_min, o.temp_max) ? ` · ${fmtRange(o.temp_min, o.temp_max)}` : ''}${o.requires_seal ? ` · sello ${esc(o.seal_number || '')} a verificar` : ''}</dd>` : ''}
          <dt>Cobro (COD)</dt><dd>${money(o.cod_amount)}</dd>
          <dt>Intentos</dt><dd>${o.attempts}</dd>
          ${o.notes ? `<dt>Notas</dt><dd>${esc(o.notes)}</dd>` : ''}
        </dl>
        <div><h3>Contenido</h3><table><tbody>${o.items.map((i) => `<tr><td>${esc(i.name)}${i.serialized ? ` <span class="chip">${icon('tag')} S/N</span>` : ''}<br><small class="muted">${esc(i.sku)}</small></td><td class="r num">× ${i.qty}</td></tr>`).join('') || '<tr><td class="muted">Sin artículos</td></tr>'}</tbody></table></div>
        ${o.serial_needs?.length ? `<div><div class="row between"><h3 style="margin:0">Números de serie</h3>${o.serials_missing ? `<span class="chip warn">Faltan ${o.serials_missing}</span>` : '<span class="chip ok">Completos</span>'}</div>
          <div class="sn-list" style="margin:8px 0">${o.serials.map((x) => `<span class="chip sn-chip"><span class="mono" data-snview="${esc(x.serial)}">${esc(x.serial)}</span>${staff && x.status === 'asignado' ? `<button type="button" class="x" data-snrm="${x.id}" aria-label="Quitar ${esc(x.serial)}">×</button>` : ''}</span>`).join('') || '<small class="muted">Sin series asignadas</small>'}</div>
          ${o.serials_missing && o.status !== 'cancelado' && (staff || o.status !== 'entregado') ? `<div class="row" style="gap:6px;flex-wrap:wrap">${o.status !== 'entregado' ? `<button class="btn sm primary" id="snAssign">${icon('scan')} Escanear números de serie</button>` : ''}${staff ? `<button class="btn sm ${o.status === 'entregado' ? 'primary' : ''}" id="snManual">${icon('tag')} Asignar S/N manualmente</button>` : ''}</div>` : ''}</div>` : ''}
        <div class="label-print printable" id="lbl"><b>${esc(SETTINGS.company_name)}</b><svg id="bc"></svg><div>${esc(o.customer_name)}</div><small>${esc(o.address)}</small></div>
      </div>
      <div class="stack">
        ${o.lat != null || staff ? `<div id="omap" class="map sm"></div>${staff ? `<small class="muted">${o.lat != null ? 'Arrastra el pin <b>C</b> o toca el mapa en el domicilio correcto para corregir la ubicación del cliente.' : '<b style="color:var(--warn)">Cliente sin ubicación:</b> toca el mapa en su domicilio para ubicarlo.'}${['calle', 'colonia', 'ciudad'].includes(o.geo_quality) ? ` <span class="chip warn">${GEO_Q[o.geo_quality][0]}</span>` : ''}</small>` : ''}` : '<p class="muted">Cliente sin geolocalización</p>'}
        <div><h3>Evidencias</h3>${o.evidences.length ? o.evidences.map((e) => `
          <div class="card" style="padding:12px;margin-bottom:10px">
            <div class="row between">${badge(e.result)}<small class="muted">${fmtDT(e.created_at)}</small></div>
            ${e.receiver_name ? `<p style="margin:8px 0 4px">Recibió: <b>${esc(e.receiver_name)}</b> ${e.receiver_relation ? `(${esc(e.receiver_relation)})` : ''}</p>` : ''}
            ${e.reason ? `<p style="margin:8px 0 4px">Motivo: <b>${esc(e.reason)}</b></p>` : ''}
            <small class="muted">${e.barcode_verified ? '✅ Código verificado' : '⚠️ Sin escaneo'} · GPS ${e.distance_to_customer_m != null ? `a ${fmtN(e.distance_to_customer_m)} m del cliente` : 'no disponible'}</small>
            ${e.notes ? `<p style="margin:6px 0 0"><small>${esc(e.notes)}</small></p>` : ''}
            ${e.compliance_json ? `<dl class="kv" style="margin-top:6px">${complianceHTML(JSON.parse(e.compliance_json))}</dl>` : ''}
            ${e.kind === 'mostrador' ? '<span class="chip">Entregado en mostrador</span>' : ''}${e.receiver_id_doc ? ` <small class="muted">ID: ${esc(e.receiver_id_doc)}</small>` : ''}
            <div class="grid g2" style="margin-top:8px">
              ${e.photo_path ? `<a href="/uploads/${esc(e.photo_path)}" target="_blank"><img class="evid-img" src="/uploads/${esc(e.photo_path)}" alt="Foto de entrega" /></a>` : ''}
              ${e.signature_path ? `<img class="evid-img" src="/uploads/${esc(e.signature_path)}" alt="Firma" />` : ''}
            </div>
            ${staff ? `<div class="row" style="margin-top:8px;gap:6px"><button class="btn sm" data-rcpt="${e.id}">${icon('sign')} Comprobante</button><label class="btn sm">${icon('camera')} ${e.photo_path ? 'Cambiar foto' : 'Agregar foto'}<input type="file" accept="image/*" data-evph="${e.id}" data-has="${e.photo_path ? 1 : 0}" hidden /></label></div>` : ''}
          </div>`).join('') : '<p class="muted">Aún no hay evidencias</p>'}</div>
        ${staff ? `<div><div class="row between"><h3 style="margin:0">Comunicación con el cliente</h3>${sheetChip(o.sheet?.status)}</div>
          <div class="row" style="margin:8px 0"><button class="btn sm" id="cpLink">${icon('copy')} Copiar enlace de rastreo</button><a class="btn sm" target="_blank" href="${esc(o.public_link)}">${icon('ext')} Ver como cliente</a><button class="btn sm primary" id="ntf">${icon('send')} Enviar aviso</button></div>
          ${o.messages?.length ? `<div class="msg-mini">${o.messages.slice(0, 8).map((x) => `<div>${icon(x.channel === 'email' ? 'mail' : x.channel === 'whatsapp' ? 'chat' : 'phone')}<span class="grow">${EVENT_LABEL[x.event] || esc(x.event)} <small class="muted">· ${CH_LABEL[x.channel]} · ${fmtDT(x.created_at)}</small></span>${msgChip(x.status, x.gw_state)}</div>`).join('')}</div>` : '<p class="muted"><small>Sin mensajes enviados.</small></p>'}</div>` : ''}
      </div>
    </div>`, {
    wide: true,
    footer: `${staff && ['fallido', 'pendiente', 'asignado'].includes(o.status) ? '<button class="btn" id="resch">Reprogramar</button>' : ''}
             ${staff && o.status !== 'cancelado' && (o.status !== 'entregado' || store.user.role === 'admin') ? '<button class="btn" id="chgSt">Cambiar estado</button>' : ''}
             ${staff && !['entregado', 'cancelado'].includes(o.status) ? '<button class="btn bad" id="cancel">Cancelar pedido</button>' : ''}
             <button class="btn" id="print">Imprimir etiqueta</button><button class="btn primary" data-close>Cerrar</button>`,
  });
  try { JsBarcode($('#bc', m.el), o.tracking_code, { format: 'CODE128', height: 60, fontSize: 16, margin: 4 }); } catch {}
  $('#print', m.el).onclick = () => printEl($('#lbl', m.el));
  $('#snAssign', m.el)?.addEventListener('click', () => ensureSerials(o, () => { m.close(); orderDetail(o.id); }));
  $('#snManual', m.el)?.addEventListener('click', () => { m.close(); assignSerialManual(o); });
  // la oficina agrega la foto de la recepción (p. ej. la que mandó el repartidor)
  $$('[data-evph]', m.el).forEach((inp) => (inp.onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (inp.dataset.has === '1' && !(await confirmDlg('Esta evidencia ya tiene foto. ¿Reemplazarla por la nueva?'))) { inp.value = ''; return; }
    try {
      const photo = await compressImage(f, 1600, 0.8);
      await POST(`/api/evidences/${inp.dataset.evph}/photo`, { photo });
      toast('Foto agregada a la evidencia', 'ok'); m.close(); orderDetail(o.id);
    } catch (er) { toast(er.message, 'bad'); }
  }));
  $$('[data-snview]', m.el).forEach((x) => (x.onclick = () => serialDetail(x.dataset.snview).catch((e) => toast(e.message, 'bad'))));
  $$('[data-snrm]', m.el).forEach((b) => (b.onclick = async () => {
    try { await api('DELETE', `/api/orders/${o.id}/serials/${b.dataset.snrm}`); toast('Serie liberada', 'ok'); m.close(); orderDetail(o.id); } catch (e) { toast(e.message, 'bad'); }
  }));
  $('#cpLink', m.el)?.addEventListener('click', () => copyText(o.public_link));
  $('#ntf', m.el)?.addEventListener('click', () => notifyDialog(o));
  $$('[data-rcpt]', m.el).forEach((b) => (b.onclick = () => {
    const e = o.evidences.find((x) => String(x.id) === b.dataset.rcpt);
    openReceipt({ ...e, tracking_code: o.tracking_code, customer_name: o.customer_name, address: o.address, customer_phone: o.customer_phone, cod_amount: o.cod_amount, public_link: o.public_link, driver_name: e.kind === 'mostrador' ? '' : o.driver_name, serials_text: e.result === 'entregado' ? o.serials.map((x) => x.serial).join(', ') : '' });
  }));
  if (o.lat != null || staff) {
    const has = o.lat != null;
    const map = makeMap($('#omap', m.el), has ? [o.lat, o.lng] : depotLatLng(), has ? 15 : 12);
    const pin = has ? L.marker([o.lat, o.lng], { icon: pinIcon('C', '#1d5a96'), draggable: staff }).addTo(map).bindPopup('Cliente') : null;
    for (const e of o.evidences) if (e.lat) L.circleMarker([e.lat, e.lng], { radius: 8, color: e.result === 'entregado' ? '#1f8a4c' : '#c0392b' }).addTo(map).bindPopup('GPS del repartidor');
    if (staff) {
      // corregir la ubicación del cliente: arrastrando el pin o tocando el mapa
      const savePin = async (ll) => {
        if (!(await confirmDlg(`¿Guardar la nueva ubicación de ${o.customer_name}? Se usará en todas sus entregas${o.route_id ? ' y se reordenará la ruta' : ''}.`))) { if (pin && has) pin.setLatLng([o.lat, o.lng]); return; }
        try {
          await api('PUT', '/api/customers/' + o.customer_id, { lat: ll.lat, lng: ll.lng });
          if (o.route_id) await POST(`/api/routes/${o.route_id}/optimize`, {}).catch(() => {});
          toast('Ubicación guardada', 'ok'); m.close(); orderDetail(o.id);
        } catch (er) { toast(er.message, 'bad'); if (pin && has) pin.setLatLng([o.lat, o.lng]); }
      };
      pin?.on('dragend', () => savePin(pin.getLatLng()));
      map.on('click', (ev) => savePin(ev.latlng));
    }
  }
  // editar domicilio / datos del cliente
  $('#oAddrEd', m.el)?.addEventListener('click', async () => {
    const c = await GET('/api/customers/' + o.customer_id);
    m.close();
    customerForm(c, async () => { if (o.route_id) await POST(`/api/routes/${o.route_id}/optimize`, {}).catch(() => {}); render(); orderDetail(o.id); });
  });
  // cambiar (o asignar) repartidor: el pedido pasa a la ruta de ese repartidor en la fecha elegida y se reordena
  $('#oDrvEd', m.el)?.addEventListener('click', async () => {
    let drivers = (await GET('/api/users?role=repartidor')).filter((d) => d.active);
    if (store.user.role !== 'repartidor') { drivers = drivers.filter((d) => d.id !== store.user.id); drivers.unshift({ id: store.user.id, name: `Yo (${store.user.name})` }); }
    $('#oDrv', m.el).innerHTML = `<div class="row" style="gap:6px;flex-wrap:wrap"><select id="oDrvSel"><option value="">Elige repartidor…</option>${drivers.map((d) => `<option value="${d.id}" ${d.id === o.driver_id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select>
      <input type="date" id="oDrvDate" value="${esc(o.scheduled_date && o.scheduled_date >= today() ? o.scheduled_date : today())}" style="width:auto" />
      <button class="btn sm primary" id="oDrvOk">Guardar</button>${o.driver_id ? '<button class="btn sm ghost" id="oDrvRm" title="Quitar de la ruta: vuelve a pendiente">Quitar repartidor</button>' : ''}</div>`;
    $('#oDrvOk', m.el).onclick = async () => {
      const id = $('#oDrvSel', m.el).value;
      if (!id) return toast('Elige el repartidor', 'bad');
      try {
        const r = await POST('/api/routes/assign', { driver_id: id, date: $('#oDrvDate', m.el).value, order_ids: [o.id] });
        if (r.skipped?.length) return toast(`No se movió: ${r.skipped[0].reason}`, 'bad');
        toast(`Pedido asignado a ${r.driver}`, 'ok'); m.close(); render(); orderDetail(o.id);
      } catch (er) { toast(er.message, 'bad'); }
    };
    $('#oDrvRm', m.el)?.addEventListener('click', async () => {
      try { await POST('/api/orders/bulk-status', { status: 'pendiente', order_ids: [o.id] }); toast('Pedido sin repartidor (pendiente)', 'ok'); m.close(); render(); orderDetail(o.id); }
      catch (er) { toast(er.message, 'bad'); }
    });
  });
  $('#oAccEd', m.el)?.addEventListener('click', async () => {
    const { rows } = await GET('/api/accounts');
    $('#oAcc', m.el).innerHTML = `<div class="row"><select id="oAccSel"><option value="">— Sin mayorista —</option>${rows.filter((a) => a.active || a.id === o.account_id).map((a) => `<option value="${a.id}" ${a.id === o.account_id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select><button class="btn sm primary" id="oAccOk">Guardar</button></div>`;
    $('#oAccOk', m.el).onclick = async () => { try { await api('PUT', `/api/orders/${o.id}/account`, { account_id: $('#oAccSel', m.el).value || null }); toast('Mayorista actualizado', 'ok'); m.close(); orderDetail(o.id); } catch (e) { toast(e.message, 'bad'); } };
  });
  $('#chgSt', m.el)?.addEventListener('click', () => { m.close(); statusPicker(o, () => { render(); orderDetail(o.id); }); });
  $('#cancel', m.el)?.addEventListener('click', async () => {
    if (!(await confirmDlg('¿Cancelar el pedido? El stock regresará al inventario.'))) return;
    await POST(`/api/orders/${o.id}/cancel`); toast('Pedido cancelado', 'ok'); m.close(); render();
  });
  $('#resch', m.el)?.addEventListener('click', async () => {
    const d = prompt('Nueva fecha (AAAA-MM-DD):', today());
    if (!d) return;
    await POST(`/api/orders/${o.id}/reschedule`, { date: d }); toast('Pedido reprogramado', 'ok'); m.close(); render();
  });
}

async function orderForm(done) {
  const items = [];
  let customer = null;
  const m = modal('Nuevo pedido', `
    <div class="stack">
      <div><label class="f">Cliente final</label>
        <div class="row"><input id="custQ" class="grow" placeholder="Buscar por nombre, teléfono o dirección" autocomplete="off" /><button type="button" class="btn" id="newCust">${icon('plus')} Nuevo</button></div>
        <div id="custRes"></div><div id="custSel" style="margin-top:6px"></div>
      </div>
      <label class="f">Mayorista (empresa que nos envía el pedido)<select id="oacc"><option value="">— Sin mayorista —</option></select></label>
      <div class="grid g3">
        <label class="f">Fecha de entrega<input type="date" id="odate" value="${today()}" /></label>
        <label class="f">Prioridad<select id="oprio"><option value="normal">Normal</option><option value="alta">Urgente</option></select></label>
        <label class="f">Cobro contra entrega<input type="number" id="ocod" min="0" step="0.01" placeholder="0.00" /></label>
      </div>
      <fieldset class="ship-box"><legend>${icon('shield')} Tipo de envío</legend><div class="grid g3">
        <label class="f">Tipo<select id="oship">${Object.entries(SHIP_TYPES).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
        <label class="f">Temperatura requerida<select id="otemp">${Object.entries(TEMP_PRESETS).map(([k, [l]]) => `<option value="${k}">${l}</option>`).join('')}<option value="custom">Otro rango…</option></select></label>
        <label class="f">Sello / precinto<input id="oseal" placeholder="Número (opcional)" /></label></div>
        <div class="grid g3" id="otempCustom" hidden><label class="f">Mínima (°C)<input id="otmin" type="number" step="0.1" /></label><label class="f">Máxima (°C)<input id="otmax" type="number" step="0.1" /></label></div>
        <label class="row"><input type="checkbox" id="oreqseal" /> Verificar sello / precinto íntegro al entregar</label></fieldset>
      <label class="f">Guía (opcional, si ya trae etiqueta)<input id="ocode" placeholder="Se genera automáticamente" /></label>
      <div><div class="row between"><label class="f">Productos</label><div class="row"><input id="prodQ" placeholder="Buscar producto" style="max-width:200px" /><button type="button" class="btn sm" id="scanProd">${icon('scan')} Escanear</button></div></div>
        <div id="prodRes"></div><table style="margin-top:6px"><tbody id="itemsT"></tbody></table></div>
      <label class="f">Notas<textarea id="onotes" placeholder="Instrucciones para el repartidor"></textarea></label>
    </div>`, { wide: true, footer: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="saveOrder">Crear pedido</button>' });
  const shipPreset = { medicamento: 'amb', refrigerado: 'ref', muestra: 'ref' };
  $('#oship', m.el).onchange = (e) => { $('#otemp', m.el).value = shipPreset[e.target.value] || ''; $('#otemp', m.el).onchange(); if (e.target.value !== 'general') $('#oreqseal', m.el).checked = true; };
  $('#otemp', m.el).onchange = (e) => { $('#otempCustom', m.el).hidden = $('#otemp', m.el).value !== 'custom'; };
  const tempRange = () => { const k = $('#otemp', m.el).value; if (k === 'custom') return [$('#otmin', m.el).value, $('#otmax', m.el).value]; const p = TEMP_PRESETS[k] || ['', '', '']; return [p[1], p[2]]; };
  const showCust = () => ($('#custSel', m.el).innerHTML = customer ? `<div class="card" style="padding:10px"><b>${esc(customer.name)}</b> · ${esc(customer.phone || '')}<br><small>${esc(customer.address)}</small> ${customer.lat == null ? '<span class="badge b-fallido">Sin ubicación</span>' : ''}</div>` : '');
  const drawItems = () => ($('#itemsT', m.el).innerHTML = items.map((it, i) => `<tr><td>${esc(it.name)}<br><small class="muted">Stock ${it.stock}</small></td><td style="width:110px"><input type="number" min="1" value="${it.qty}" data-i="${i}" class="qty" /></td><td style="width:40px"><button class="btn ghost sm" data-del="${i}">${icon('x')}</button></td></tr>`).join('') || '<tr><td class="muted">Agrega productos (opcional)</td></tr>');
  drawItems();
  const addProd = (p) => { const ex = items.find((x) => x.product_id === p.id); if (ex) ex.qty++; else items.push({ product_id: p.id, name: p.name, stock: p.stock, qty: 1 }); drawItems(); };
  $('#itemsT', m.el).addEventListener('input', (e) => { if (e.target.classList.contains('qty')) items[e.target.dataset.i].qty = Number(e.target.value); });
  $('#itemsT', m.el).addEventListener('click', (e) => { const b = e.target.closest('[data-del]'); if (b) { items.splice(b.dataset.del, 1); drawItems(); } });
  let t1, t2;
  $('#custQ', m.el).oninput = (e) => { clearTimeout(t1); t1 = setTimeout(async () => {
    const q = e.target.value.trim(); if (q.length < 2) return ($('#custRes', m.el).innerHTML = '');
    const r = await GET('/api/customers?limit=8&q=' + encodeURIComponent(q));
    $('#custRes', m.el).innerHTML = `<table>${r.rows.map((c) => `<tr class="click" data-c='${esc(JSON.stringify(c))}'><td>${esc(c.name)}</td><td><small>${esc(c.address)}</small></td></tr>`).join('') || '<tr><td class="muted">Sin resultados</td></tr>'}</table>`;
  }, 250); };
  $('#custRes', m.el).onclick = (e) => { const tr = e.target.closest('[data-c]'); if (!tr) return; customer = JSON.parse(tr.dataset.c); $('#custRes', m.el).innerHTML = ''; $('#custQ', m.el).value = ''; showCust(); };
  $('#newCust', m.el).onclick = () => customerForm(null, async (id) => { customer = await GET('/api/customers/' + id); showCust(); });
  $('#prodQ', m.el).oninput = (e) => { clearTimeout(t2); t2 = setTimeout(async () => {
    const q = e.target.value.trim(); if (q.length < 2) return ($('#prodRes', m.el).innerHTML = '');
    const r = await GET('/api/products?limit=8&q=' + encodeURIComponent(q));
    $('#prodRes', m.el).innerHTML = `<table>${r.rows.map((p) => `<tr class="click" data-p='${esc(JSON.stringify(p))}'><td>${esc(p.name)}</td><td class="r num">${p.stock}</td></tr>`).join('')}</table>`;
  }, 250); };
  $('#prodRes', m.el).onclick = (e) => { const tr = e.target.closest('[data-p]'); if (!tr) return; addProd(JSON.parse(tr.dataset.p)); $('#prodRes', m.el).innerHTML = ''; $('#prodQ', m.el).value = ''; };
  GET('/api/accounts').then(({ rows }) => { const act = rows.filter((a) => a.active); $('#oacc', m.el).insertAdjacentHTML('beforeend', act.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join('')); if (act.length === 1) $('#oacc', m.el).value = act[0].id; }).catch(() => {});
  $('#scanProd', m.el).onclick = () => openScanner({ title: 'Escanear productos', continuous: true, onCode: async (c) => { const p = await GET('/api/products/barcode/' + encodeURIComponent(c)); addProd(p); return p.name; } });
  $('#saveOrder', m.el).onclick = async () => {
    if (!customer) return toast('Selecciona o registra el cliente', 'bad');
    try {
      const o = await POST('/api/orders', { account_id: $('#oacc', m.el).value || null, customer_id: customer.id, items: items.map(({ product_id, qty }) => ({ product_id, qty })), scheduled_date: $('#odate', m.el).value, priority: $('#oprio', m.el).value, cod_amount: $('#ocod', m.el).value, notes: $('#onotes', m.el).value, tracking_code: $('#ocode', m.el).value,
        shipment_type: $('#oship', m.el).value, temp_min: tempRange()[0], temp_max: tempRange()[1], requires_seal: $('#oreqseal', m.el).checked, seal_number: $('#oseal', m.el).value });
      toast(`Pedido ${o.tracking_code} creado`, 'ok'); m.close(); done?.(o); orderDetail(o.id);
    } catch (e) { toast(e.message, 'bad'); }
  };
}

// ================= Clientes =================
function customerForm(c, done) {
  c = c || {};
  GET('/api/warehouses').then((ws) => {
    const sel = document.querySelector('#cfOff');
    if (sel) sel.insertAdjacentHTML('beforeend', ws.filter((w) => w.active || w.id === c.office_id).map((w) => `<option value="${w.id}" ${w.id === c.office_id ? 'selected' : ''}>${esc(w.name)}${w.city ? ' · ' + esc(w.city) : ''}</option>`).join(''));
  }).catch(() => {});
  const m = modal(c.id ? 'Editar cliente' : 'Registrar cliente final', `
    <form id="cf" class="stack">
      <div class="grid g2">
        <label class="f">Nombre completo *<input name="name" required value="${esc(c.name)}" /></label>
        <label class="f">Correo<input name="email" type="email" value="${esc(c.email)}" /></label>
      </div>
      <div class="grid g2">
        <label class="f"><span>Teléfono móvil <small class="muted">(WhatsApp y SMS se envían solo a este número)</small></span><input name="phone" type="tel" inputmode="tel" value="${esc(c.phone)}" placeholder="10 dígitos" /><small id="mobWarn" style="color:var(--warn)" hidden>Es el mismo número que la línea Telnor (fija): no se enviarán SMS ni WhatsApp. Captura el celular del cliente.</small></label>
        <label class="f">Teléfono adicional<input name="phone_alt" type="tel" inputmode="tel" value="${esc(c.phone_alt)}" placeholder="Casa, trabajo o familiar" /></label>
      </div>
      <label class="f"><span>Teléfono Telnor <small class="muted">(número de la línea / servicio)</small></span><input name="external_id" type="tel" inputmode="tel" value="${esc(c.external_id)}" placeholder="10 dígitos de la línea Telnor" /></label>
      <label class="f">Dirección *<div class="row"><input name="address" required class="grow" value="${esc(c.address)}" placeholder="Calle, número, colonia" /><button type="button" class="btn" id="geo">Ubicar</button></div></label>
      <div class="grid g3">
        <label class="f">Colonia o fraccionamiento<input name="colonia" value="${esc(c.colonia || '')}" placeholder="Si no se encuentra el domicilio, se ubica en su colonia" /></label>
        <label class="f">Ciudad<input name="city" value="${esc(c.city || SETTINGS.default_city || 'Tijuana')}" /></label>
        <label class="f">Oficina que lo atiende<select name="office_id" id="cfOff"><option value="">Según la ciudad</option></select></label>
        <label class="f">C.P.<input name="zip" value="${esc(c.zip)}" /></label>
        <label class="f">Referencias<input name="reference" value="${esc(c.reference)}" placeholder="Portón azul…" /></label>
      </div>
      <div class="grid g2">
        <label class="f">Recibe desde<input type="time" name="window_start" value="${esc(c.window_start)}" /></label>
        <label class="f">Recibe hasta<input type="time" name="window_end" value="${esc(c.window_end)}" /></label>
      </div>
      ${c.id && !driverMode() ? `<fieldset id="schedBox"><legend>${icon('truck')} Programar entrega</legend><div id="schedBody"><small class="muted">Cargando pedidos…</small></div></fieldset>` : ''}
      <div><div class="row between"><small class="muted">Toca el mapa para fijar la ubicación exacta</small><button type="button" class="btn sm" id="here">📍 Estoy aquí</button></div>
        <div id="cmap" class="map sm" style="margin-top:6px"></div><small class="muted num" id="coords"></small></div>
      <input type="hidden" name="lat" value="${c.lat ?? ''}" /><input type="hidden" name="lng" value="${c.lng ?? ''}" /><input type="hidden" name="geo_quality" value="" />
      <label class="f">Notas<textarea name="notes">${esc(c.notes)}</textarea></label>
      <fieldset><legend>${icon('chat')} Avisos sobre sus envíos</legend><div class="row">
        ${[['notify_whatsapp', 'WhatsApp'], ['notify_sms', 'SMS'], ['notify_email', 'Correo']].map(([k, l]) => `<label class="check-pill"><input type="checkbox" name="${k}" ${c[k] === 0 ? '' : 'checked'} /> ${l}</label>`).join('')}
      </div><small class="muted">Recibe avisos cuando su pedido se registra, va en camino, está por llegar y al entregarse (con su comprobante).</small></fieldset>
    </form>`, { wide: true, footer: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="saveC">Guardar</button>' });
  const f = $('#cf', m.el);
  const mobChk = () => { const d = (x) => String(x || '').replace(/\D/g, '').slice(-10); $('#mobWarn', m.el).hidden = !(d(f.phone.value) && d(f.phone.value) === d(f.external_id.value)); };
  f.phone.addEventListener('input', mobChk); f.external_id.addEventListener('input', mobChk); mobChk();
  const map = makeMap($('#cmap', m.el), c.lat ? [c.lat, c.lng] : null, c.lat ? 16 : 12);
  let mk = null;
  const setPt = (lat, lng, pan, q = '') => {
    f.lat.value = lat.toFixed(6); f.lng.value = lng.toFixed(6);
    f.geo_quality.value = q; // si viene de "Ubicar" y es aproximada, se guarda marcada "por revisar"; si se movió a mano, es manual
    $('#coords', m.el).textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    if (mk) mk.setLatLng([lat, lng]); else mk = L.marker([lat, lng], { draggable: true }).addTo(map).on('dragend', (e) => setPt(e.target.getLatLng().lat, e.target.getLatLng().lng));
    if (pan) map.setView([lat, lng], 16);
  };
  if (c.lat) setPt(c.lat, c.lng);
  map.on('click', (e) => setPt(e.latlng.lat, e.latlng.lng));
  $('#here', m.el).onclick = async () => { const p = await getPosition(); if (p) setPt(p.lat, p.lng, true); else toast('No se obtuvo GPS', 'bad'); };
  const geoQ = () => `address=${encodeURIComponent(f.address.value)}&colonia=${encodeURIComponent(f.colonia?.value || '')}&city=${encodeURIComponent(f.city.value)}`;
  $('#geo', m.el).onclick = async (e) => {
    const btn = e.currentTarget;
    if (!f.address.value.trim()) return toast('Escribe el domicilio', 'bad');
    btn.disabled = true; btn.textContent = 'Buscando…';
    try {
      const r = await GET('/api/geocode?' + geoQ());
      if (r.quality === 'exacta') { setPt(r.lat, r.lng, true, 'exacta'); toast('Ubicado. Revisa el pin y arrástralo si hace falta', 'ok'); }
      else if (r.quality === 'calle' || r.quality === 'colonia') { setPt(r.lat, r.lng, true, r.quality); toast(`Ubicación aproximada (${r.quality}): arrastra el pin al domicilio exacto`, ''); }
      else if (r.quality === 'ciudad') { map.setView([r.lat, r.lng], 14); toast('No se encontró el número: toca el mapa en el domicilio correcto', 'bad'); }
      else toast('No se encontró: toca el mapa en el domicilio correcto', 'bad');
    } catch (er) { toast(er.message || 'No se pudo buscar; marca en el mapa', 'bad'); }
    btn.disabled = false; btn.textContent = 'Ubicar';
  };
  // sin ubicación: acerca el mapa a su ciudad para marcarlo fácil
  if (!c.lat && c.city && !driverMode()) GET('/api/geocode?city=' + encodeURIComponent(c.city)).then((r) => { if (r.lat && !f.lat.value) map.setView([r.lat, r.lng], 13); }).catch(() => {});
  // Programar entrega del pedido abierto: día, hora acordada y repartidor
  let sched = null;
  if ($('#schedBody', m.el)) (async () => {
    const box = $('#schedBody', m.el);
    const open = (c.orders || []).filter((o) => ['pendiente', 'asignado', 'cargado', 'fallido'].includes(o.status));
    if (!open.length) { box.innerHTML = '<small class="muted">Este cliente no tiene pedidos abiertos. Crea uno en Pedidos → Nuevo pedido.</small>'; return; }
    const drivers = (await GET('/api/users?role=repartidor').catch(() => [])).filter((d) => d.active);
    box.innerHTML = `${open.length > 1 ? `<label class="f">Pedido<select id="scO">${open.map((o) => `<option value="${o.id}">${esc(o.tracking_code)} · ${STATUS[o.status]}</option>`).join('')}</select></label>` : `<p style="margin:0 0 6px"><b class="mono">${esc(open[0].tracking_code)}</b> · ${badge(open[0].status)}</p>`}
      <div class="grid g3"><label class="f">Día de entrega<input type="date" id="scD" /></label><label class="f">Hora acordada<input type="time" id="scT" /></label>
        <label class="f">Repartidor<select id="scR"><option value="">— Sin asignar —</option>${drivers.map((d) => `<option value="${d.id}">${esc(d.name)}${d.vehicle ? ' · ' + esc(d.vehicle) : ''}</option>`).join('')}</select></label></div>
      <small class="muted">La ruta del repartidor se reordena respetando la hora acordada (±30 min).</small>
      <div class="row" style="margin-top:8px;gap:8px"><span class="muted">Estado del pedido:</span><span id="scSt"></span><button type="button" class="btn sm" id="scChg">${icon('check')} Cambiar estado</button></div>`;
    const fill = () => {
      const o = open.find((x) => String(x.id) === String($('#scO', box)?.value || open[0].id));
      $('#scD', box).value = o.scheduled_date || today(); $('#scT', box).value = o.appointment_time || ''; $('#scR', box).value = o.driver_id || '';
      sched = { o, d: $('#scD', box).value, t: $('#scT', box).value, r: $('#scR', box).value };
    };
    $('#scO', box)?.addEventListener('change', fill);
    fill();
    const showSt = () => { $('#scSt', box).innerHTML = badge(sched.o.status); };
    showSt();
    $('#scO', box)?.addEventListener('change', showSt);
    $('#scChg', box).onclick = () => statusPicker(sched.o, async () => { m.close(); render(); const c2 = await GET('/api/customers/' + c.id); customerForm(c2, done); });
  })();
  const applySchedule = async () => {
    if (!sched) return '';
    const box = $('#schedBody', m.el);
    const d = $('#scD', box).value, t = $('#scT', box).value, r = $('#scR', box).value, o = sched.o;
    if (d === sched.d && t === sched.t && r === String(sched.r || '')) return '';
    if (o.status === 'cargado' && r !== String(o.driver_id || '')) throw new Error('Ese pedido ya va cargado en una unidad; descárgalo antes de cambiar de repartidor');
    await PUT(`/api/orders/${o.id}/schedule`, { date: d, time: t || null });
    if (r && (r !== String(o.driver_id || '') || d !== sched.d)) {
      const res = await POST('/api/routes/assign', { driver_id: r, date: d, order_ids: [o.id] });
      if (res.skipped?.length && res.skipped[0].reason && !/ya lo tiene/.test(res.skipped[0].reason)) throw new Error(res.skipped[0].reason);
    } else if (!r && o.driver_id) await POST('/api/orders/bulk-status', { status: 'pendiente', order_ids: [o.id], date: d });
    return ` · entrega ${d}${t ? ' ' + t : ''}${r ? ' con ' + $('#scR', box).selectedOptions[0].text.split(' · ')[0] : ''}`;
  };
  $('#saveC', m.el).onclick = async (e) => {
    const btn = e.currentTarget;
    if (!f.reportValidity()) return;
    const body = Object.fromEntries(new FormData(f));
    for (const k of ['notify_sms', 'notify_email', 'notify_whatsapp']) body[k] = f[k].checked ? 1 : 0;
    if (!body.lat && !(await confirmDlg('El cliente no tiene ubicación en el mapa; no podrá optimizarse su ruta. ¿Guardar así?'))) return;
    btn.disabled = true;
    try {
      let id = c.id;
      if (id) await PUT('/api/customers/' + id, body); else id = (await POST('/api/customers', body)).id;
      const extra = await applySchedule();
      toast('Cliente guardado' + extra, 'ok'); m.close(); done?.(id);
    } catch (er) { toast(er.message, 'bad'); btn.disabled = false; }
  };
}

async function viewCustomers(v) {
  const q = new URLSearchParams(location.hash.split('?')[1] || '').get('q') || '';
  const offF = new URLSearchParams(location.hash.split('?')[1] || '').get('office_id') || '';
  const r = await GET(`/api/customers?limit=200000&q=${encodeURIComponent(q)}&office_id=${offF}`);
  const staffC = !driverMode();
  const offList = staffC ? await GET('/api/warehouses').catch(() => []) : [];
  const geoSt = staffC ? await GET('/api/customers/geocode').catch(() => null) : null;
  const pend = geoSt ? (geoSt.stats.pendiente || 0) : 0;
  const notFound = geoSt ? (geoSt.stats.no_encontrada || 0) : 0;
  v.innerHTML = topbar('Clientes', `${staffC ? `<button class="btn" id="impC">${icon('upload')} Importar Excel</button><button class="btn" id="asgX">${icon('truck')} Asignar por Excel</button>` : ''}<button class="btn primary" id="newC">${icon('plus')} Registrar cliente</button>`) + `
  ${pend ? `<div class="info-bar">${icon('live')} Ubicando ${pend} domicilio(s) en el mapa… (≈1 por segundo; puedes seguir trabajando)</div>` : ''}
  ${notFound || r.rows.some((c) => geoChk(c.geo_quality)) ? `<div class="offline-bar row between"><span>${notFound ? `${notFound} domicilio(s) no se encontraron · ` : ''}${r.rows.filter((c) => geoChk(c.geo_quality)).length} ubicación(es) aproximada(s) por revisar: ábrelas y mueve el pin al domicilio, o espera a que el repartidor la confirme al entregar.</span><span class="row" style="gap:6px"><button class="btn sm" id="geoList">Ver y ubicar</button><button class="btn sm" id="geoRetry">Reintentar</button></span></div>` : ''}
  <div class="grid g-main">
    <div class="card"><form class="row" id="cq" style="margin-bottom:10px"><input name="q" value="${esc(q)}" placeholder="Número de serie o número de pedido (o nombre, teléfono)" class="grow" />${store.user.role === 'admin' && offList.length > 1 ? `<select name="office_id" style="max-width:190px"><option value="">Todas las oficinas</option>${offList.map((w) => `<option value="${w.id}" ${String(w.id) === offF ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}</select>` : ''}<button class="btn">Buscar</button><small class="muted">${r.total} clientes</small></form>
      <div class="table-wrap"><table><thead><tr>${staffC ? '<th style="width:34px"><input type="checkbox" id="selAll" title="Seleccionar los que tienen pedidos abiertos" /></th>' : ''}<th>Nombre</th><th>Teléfonos</th><th>Dirección</th><th>Ventana</th><th class="r">Pedidos</th></tr></thead><tbody>
      ${r.rows.map((c) => `<tr class="click" data-id="${c.id}">${staffC ? `<td><input type="checkbox" data-sel="${c.id}" ${c.active_orders ? '' : 'disabled title="Sin pedidos activos"'} /></td>` : ''}<td><b>${esc(c.name)}</b>${c.match_txt ? `<br><small class="mono" style="color:var(--ok)">${esc(c.match_txt)}</small>` : ''}${c.driver_name ? `<br><small class="muted">${icon('truck')} ${esc(c.driver_name)}</small>` : ''}${c.lat == null ? ` <span class="badge b-fallido">${c.geo_quality === 'no_encontrada' ? 'sin ubicación' : c.geo_quality ? 'sin GPS' : 'ubicando…'}</span>` : ['calle', 'colonia', 'ciudad'].includes(c.geo_quality) ? ` <span class="chip warn" title="Ubicación aproximada: revísala">${GEO_Q[c.geo_quality][0]}</span>` : ''}</td><td>${c.phone ? `${icon('phone')} ${esc(c.phone)}` : ''}${c.phone_alt ? `<br><small class="muted">Adicional: ${esc(c.phone_alt)}</small>` : ''}${c.external_id ? `<br><small class="muted">Telnor: ${esc(c.external_id)}</small>` : ''}</td><td><small>${esc(c.address)} ${esc(c.zip || '')}</small></td><td class="num">${c.window_start ? `${c.window_start}–${c.window_end}` : '—'}</td><td class="r num">${c.orders_count}${c.last_status ? `<br>${badge(c.last_status)}` : ''}</td></tr>`).join('')}
      </tbody></table></div></div>
    <div class="card"><h2>Mapa de clientes</h2><div id="cmapall" class="map tall"></div></div>
  </div>`;
  $('#cq').onsubmit = (e) => { e.preventDefault(); location.hash = `#/customers?q=${encodeURIComponent(e.target.q.value)}&office_id=${e.target.office_id?.value || ''}`; };
  $('#newC').onclick = () => customerForm(null, () => render());
  $('#impC')?.addEventListener('click', () => importCustomers());
  $('#asgX')?.addEventListener('click', () => excelAssign({ mode: 'driver' }));
  if (staffC) bulkAssign(v, 'customers');
  $('#geoList')?.addEventListener('click', () => unlocatedCustomers(new URLSearchParams(location.hash.split('?')[1] || '').get('office_id')));
  $('#geoRetry')?.addEventListener('click', async () => { await POST('/api/customers/geocode', { retry_failed: true }); toast('Reintentando…', 'ok'); setTimeout(render, 1500); });
  if (pend) setTimeout(() => { if (location.hash.startsWith('#/customers') && !(v.bulkPicked?.().length)) render(); }, 15000);
  $$('tr[data-id]', v).forEach((tr) => (tr.onclick = async () => customerForm(await GET('/api/customers/' + tr.dataset.id), () => render())));
  const map = makeMap($('#cmapall'));
  L.marker(depotLatLng(), { icon: depotIcon() }).addTo(map);
  const pts = r.rows.filter((c) => c.lat != null).map((c) => { const lyr = L.circleMarker([c.lat, c.lng], { radius: 6, color: ['calle', 'colonia', 'ciudad'].includes(c.geo_quality) ? '#e5612a' : '#1d5a96', fillOpacity: 0.6 }).addTo(map);
    editableCustomerPin(map, lyr, { id: c.id, name: c.name, address: c.address, extra: ['calle', 'colonia', 'ciudad'].includes(c.geo_quality) ? `<br><small style="color:#e5612a">Ubicación aproximada (${c.geo_quality})</small>` : '' }); return [c.lat, c.lng]; });
  if (pts.length) map.fitBounds(pts, { padding: [20, 20] });
}

// ================= Rutas =================
async function viewRoutes(v) {
  const p = new URLSearchParams(location.hash.split('?')[1] || '');
  const date = p.get('date') || today();
  const aCity = p.get('city') || '', aOff = p.get('office_id') || '';
  const aFrom = p.get('pfrom') || '', aTo = p.get('pto') || '';
  const [routes, pend, drivers, pick, cities, offList] = await Promise.all([GET(`/api/routes?date=${date}`), GET(`/api/orders?status=pendiente&unrouted=1&limit=500`), GET('/api/users?role=repartidor'),
    GET(`/api/orders?status=pendiente,fallido&unrouted=1&sort=geo&limit=200000&city=${encodeURIComponent(aCity)}&office_id=${aOff}${aFrom ? `&date=${aFrom}&date_to=${aTo || aFrom}` : ''}`),
    GET(`/api/dashboard/breakdown?office_id=${aOff}`).then((r) => r.city_list).catch(() => []), GET('/api/warehouses').catch(() => [])]);
  const pending = pend.rows.filter((o) => o.scheduled_date <= date);
  const totKm = routes.reduce((a, r) => a + (r.distance_km || 0), 0);
  const totOrig = routes.reduce((a, r) => a + (r.original_distance_km || 0), 0);
  v.innerHTML = topbar('Planificación de rutas', `<input type="date" id="rdate" value="${date}" style="width:auto" /><button class="btn" id="xlsAll" title="Descarga un Excel con lo asignado a cada repartidor en esta fecha">${icon('download')} Excel por repartidor</button><button class="btn" id="manual">${icon('route')} Ruta manual</button><button class="btn primary" id="auto">⚡ Auto-planificar (${pending.length})</button>`) + `
  <div class="grid g4">
    <div class="card kpi"><div class="label">Rutas</div><div class="value">${routes.length}</div><div class="sub">${routes.reduce((a, r) => a + r.stops, 0)} paradas</div></div>
    <div class="card kpi"><div class="label">Km planificados</div><div class="value">${fmtN(totKm, 1)}</div><div class="sub">vs ${fmtN(totOrig, 1)} km sin optimizar</div></div>
    <div class="card kpi"><div class="label">Ahorro por optimización</div><div class="value" style="color:var(--ok)">${totOrig ? fmtN(((totOrig - totKm) / totOrig) * 100, 1) + '%' : '—'}</div><div class="sub">${fmtN(totOrig - totKm, 1)} km menos</div></div>
    <div class="card kpi"><div class="label">Sin ruta</div><div class="value" style="color:${pending.length ? 'var(--warn)' : 'inherit'}">${pending.length}</div><div class="sub">pedidos pendientes</div></div>
  </div>
  <div class="grid g-main" style="margin-top:14px">
    <div class="card"><div class="row map-tools" style="margin-bottom:8px">
        <button class="btn sm" id="selLasso" title="Encierra con el dedo o el ratón las entregas que quieras">${icon('edit')} Dibujar zona</button>
        <button class="btn sm" id="selTap" title="Toca cada pin para agregarlo o quitarlo">${icon('check')} Tocar pines</button>
        <button class="btn sm ghost" id="selClear" hidden>Quitar selección</button>
        <small class="muted grow" id="selHint">Selecciona entregas en el mapa para asignarlas y optimizar su ruta.</small></div>
      <div id="rmap" class="map tall"></div>
      <div id="mapSelBar" class="bulk-bar" hidden></div><div class="legend" style="margin-top:8px">${routes.map((r, i) => `<span><i style="background:${ROUTE_COLORS[i % ROUTE_COLORS.length]}"></i>${esc(r.driver_name)}</span>`).join('')}<span><i style="background:#7b8a85"></i>Pendiente sin ruta</span></div></div>
    <div class="stack">${routes.map((r, i) => {
      const done = r.delivered + r.failed;
      return `<div class="card" style="border-left:5px solid ${ROUTE_COLORS[i % ROUTE_COLORS.length]}">
        <div class="row between"><b>${esc(r.driver_name || 'Sin repartidor')}</b>${badge(r.status)}</div>
        <div class="row" style="margin:6px 0;gap:14px"><small class="num">📦 ${r.stops} paradas</small><small class="num">🛣️ ${fmtN(r.distance_km, 1)} km</small><small class="num">⏱️ ${fmtN(r.est_minutes / 60, 1)} h</small>${r.original_distance_km ? (() => { const sv = ((r.original_distance_km - r.distance_km) / r.original_distance_km) * 100; return sv >= 0.5 ? `<small class="num" style="color:var(--ok)" title="Ahorro contra el orden original">−${fmtN(sv, 0)}%</small>` : sv <= -0.5 ? `<small class="num" style="color:var(--warn)" title="Más km que el plan original: se agregaron o movieron paradas">+${fmtN(-sv, 0)}%</small>` : ''; })() : ''}</div>
        <div class="progress"><i style="width:${r.stops ? (r.delivered / r.stops) * 100 : 0}%;background:var(--ok)"></i><i style="width:${r.stops ? (r.failed / r.stops) * 100 : 0}%;background:var(--bad)"></i></div>
        <div class="row between" style="margin-top:8px"><small class="muted">${done}/${r.stops} visitadas · ${r.loaded} en vehículo</small><button class="btn sm" data-route="${r.id}">Ver detalle</button></div></div>`;
    }).join('') || '<div class="card empty">No hay rutas para esta fecha.<br>Usa <b>Auto-planificar</b> para repartir los pedidos entre tus repartidores.</div>'}</div>
  </div>
  <div class="card" id="asgCard" style="margin-top:14px">
    <div class="row between" style="margin-bottom:8px"><h3 style="margin:0">${icon('truck')} Asignar pedidos por ciudad y ubicación</h3><small class="muted">${pick.total} pedido(s) sin ruta (pendientes o fallidos${aFrom ? `, programados ${aFrom === (aTo || aFrom) ? 'el ' + aFrom : `del ${aFrom} al ${aTo}`}` : ', de cualquier fecha'})</small></div>
    <form class="row" id="afilt" style="margin-bottom:8px;flex-wrap:wrap">
      ${store.user.role === 'admin' && offList.length > 1 ? `<select name="office_id" style="max-width:200px"><option value="">Todas las oficinas</option>${offList.map((w) => `<option value="${w.id}" ${String(w.id) === aOff ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}</select>` : ''}
      <select name="city" style="max-width:200px"><option value="">Todas las ciudades</option>${cities.map((c) => `<option ${c.toLowerCase() === aCity.toLowerCase() ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
      <label class="row" style="gap:4px" title="Fecha de entrega programada de los pedidos"><small class="muted">Programados del</small><input type="date" name="pfrom" value="${esc(aFrom)}" style="max-width:150px" /><small class="muted">al</small><input type="date" name="pto" value="${esc(aTo || aFrom)}" style="max-width:150px" /></label>
      <button type="button" class="btn sm ghost" id="aDay" title="Solo los programados para la fecha de la planificación">Del día</button><button type="button" class="btn sm ghost" id="aAll">Todas las fechas</button>
      <button class="btn">Filtrar</button>
      <span class="bulk-sep"></span>
      <small class="muted">Marca un pedido y agrega los más cercanos:</small><input type="number" id="nearN" min="1" value="20" style="width:80px" /><button type="button" class="btn sm" id="nearGo">${icon('live')} Seleccionar N más cercanos</button>
    </form>
    <small class="muted">Marca una ciudad completa, pedidos sueltos o los más cercanos y elige el repartidor en la barra de abajo. La ruta se ordena sola por el camino más corto; los marcados se resaltan en azul en el mapa.</small>
    <div class="table-wrap" style="max-height:520px;margin-top:8px"><table><thead><tr><th style="width:34px"><input type="checkbox" id="selAll" title="Seleccionar todos" /></th><th>#</th><th>Guía</th><th>Cliente</th><th>Colonia</th><th>Dirección</th><th>Fecha</th><th>Estado</th></tr></thead><tbody>
    ${pick.rows.map((o, ix) => `${o.city_group && (ix === 0 || pick.rows[ix - 1].city_group !== o.city_group) ? `<tr class="grp-row" style="background:var(--bg-soft,#f3f6fa)"><td><input type="checkbox" data-citysel="${esc(o.city_group)}" title="Seleccionar toda la ciudad" /></td><td colspan="7"><b>${icon('live')} ${esc(o.city_group)}</b> <small class="muted">· ${pick.rows.filter((x) => x.city_group === o.city_group).length} pedidos, por colonia y cercanía desde la oficina</small></td></tr>` : ''}${o.col_group && (ix === 0 || pick.rows[ix - 1].col_group !== o.col_group || pick.rows[ix - 1].city_group !== o.city_group) ? `<tr class="grp-row col-row"><td><input type="checkbox" data-colsel="${esc(o.col_group)}" data-colcity="${esc(o.city_group)}" title="Seleccionar toda la colonia" /></td><td colspan="7" style="padding-left:22px">${icon('building')} <b>${esc(o.col_group)}</b> <small class="muted">· ${pick.rows.filter((x) => x.city_group === o.city_group && x.col_group === o.col_group).length} pedido(s)</small></td></tr>` : ''}<tr class="click" data-oid="${o.id}"><td><input type="checkbox" data-sel="${o.id}" data-city="${esc(o.city_group || '')}" data-col="${esc(o.col_group || '')}" data-lat="${o.lat ?? ''}" data-lng="${o.lng ?? ''}" /></td><td class="num muted">${o.geo_seq ?? '<span title="Sin ubicación en el mapa">—</span>'}</td><td><b>${esc(o.tracking_code)}</b> ${o.priority === 'alta' ? '<span class="badge b-alta">Urgente</span>' : ''}</td><td>${esc(o.customer_name)}</td><td><small>${esc(o.customer_colonia || '')}</small></td><td><small>${esc(o.address)}</small></td><td class="num">${esc(o.scheduled_date)}</td><td>${badge(o.status)}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">No hay pedidos sin ruta</td></tr>'}
    </tbody></table></div>
  </div>`;
  $('#rdate').onchange = (e) => (location.hash = `#/routes?date=${e.target.value}&city=${encodeURIComponent(aCity)}&office_id=${aOff}&pfrom=${aFrom}&pto=${aTo}`);
  $('#afilt').onsubmit = (e) => { e.preventDefault(); location.hash = `#/routes?date=${date}&${new URLSearchParams(new FormData(e.target))}`; };
  $('#aDay').onclick = () => { const f = $('#afilt'); f.pfrom.value = date; f.pto.value = date; f.requestSubmit(); };
  $('#aAll').onclick = () => { const f = $('#afilt'); f.pfrom.value = ''; f.pto.value = ''; f.requestSubmit(); };
  $('#xlsAll').onclick = () => exportAssignedExcel(date);
  const map = makeMap($('#rmap'));
  const all = [depotLatLng()];
  L.marker(depotLatLng(), { icon: depotIcon() }).addTo(map).bindPopup(esc(SETTINGS.depot_name));
  const dets = await Promise.all(routes.map((r) => GET('/api/routes/' + r.id)));
  const pinsSel = [];
  dets.forEach((d, i) => all.push(...drawRoute(map, d.stops, ROUTE_COLORS[i % ROUTE_COLORS.length], { depot: false, fit: false, onEdit: () => render(), collect: pinsSel })));
  for (const o of pending) if (o.lat != null) {
    const mk = L.marker([o.lat, o.lng], { icon: pinIcon('•', '#7b8a85') }).addTo(map).bindPopup(`<b>${esc(o.customer_name)}</b><br>${esc(o.address || '')}<br>${esc(o.tracking_code)} · sin ruta${stopEditButtons()}`);
    wireStopEdit(map, mk, o, () => render());
    pinsSel.push({ s: o, mk });
    all.push([o.lat, o.lng]);
  }
  mapSelection(v, map, pinsSel, drivers, date);
  if (all.length > 1) map.fitBounds(all, { padding: [30, 30] });
  // Panel "Asignar por ciudad y ubicación": los marcados se ven en azul en el mapa, con su orden de cercanía
  const pickLayer = L.layerGroup().addTo(map);
  const pickById = new Map(pick.rows.map((r) => [r.id, r]));
  const syncPick = () => {
    pickLayer.clearLayers();
    const pts = $$('#asgCard [data-sel]', v).filter((x) => x.checked && x.dataset.lat).map((x) => {
      const o = pickById.get(Number(x.dataset.sel));
      L.marker([o.lat, o.lng], { icon: pinIcon(String(o.geo_seq ?? '•'), '#2563eb'), zIndexOffset: 500 }).addTo(pickLayer).bindPopup(`<b>${esc(o.customer_name)}</b><br>${esc(o.address || '')}<br>${esc(o.tracking_code)}`);
      return [o.lat, o.lng];
    });
    if (pts.length) map.fitBounds(pts, { padding: [40, 40], maxZoom: 15 });
  };
  bulkAssign(v, 'orders');
  geoPickWire($('#asgCard', v), syncPick);
  $$('#asgCard [data-sel]', v).forEach((c) => c.addEventListener('change', syncPick));
  $('#selAll', v)?.addEventListener('change', syncPick);
  $$('#asgCard tr[data-oid]', v).forEach((tr) => (tr.onclick = () => orderDetail(tr.dataset.oid)));
  $$('[data-route]', v).forEach((b) => (b.onclick = () => routeDetail(b.dataset.route)));

  $('#auto').onclick = () => {
    if (!pending.length) return toast('No hay pedidos pendientes', 'bad');
    const m = modal('Auto-planificar rutas', `
      <p class="muted" style="margin-top:0">Se repartirán <b>${pending.length}</b> pedidos pendientes con la misma lógica de Pedidos: cada oficina con sus propios repartidores, por <b>ciudad y cercanía</b> desde la oficina (una zona compacta por repartidor, según su capacidad). Se agregan a la ruta del día de cada repartidor y se optimiza el camino (vecino más cercano + 2-opt, urgentes primero y ventanas horarias).</p>
      <h3 style="margin-top:14px">Repartidores disponibles</h3>
      ${drivers.filter((d) => d.active).map((d) => `<label class="row" style="padding:6px 0"><input type="checkbox" value="${d.id}" checked /> <span class="grow">${esc(d.name)} <small class="muted">${esc(d.vehicle || '')}</small></span><small class="muted">cap. ${d.capacity}</small></label>`).join('')}`,
      { footer: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="go">Generar rutas</button>' });
    $('#go', m.el).onclick = async () => {
      const ids = $$('input[type=checkbox]:checked', m.el).map((x) => Number(x.value));
      if (!ids.length) return toast('Elige al menos un repartidor', 'bad');
      try {
        const r = await POST('/api/routes/auto', { date, driver_ids: ids });
        const saved = r.created.reduce((a, x) => a + (x.original_distance_km - x.distance_km), 0);
        toast(`${r.created.length} ruta(s) · ${r.created.reduce((a, x) => a + x.stops, 0)} pedidos asignados · ${fmtN(saved, 1)} km ahorrados${r.overflow.length ? ` · ${r.overflow.length} sin asignar (capacidad, sin ubicación o sin repartidor en su oficina)` : ''}`, 'ok');
        m.close(); render();
      } catch (e) { toast(e.message, 'bad'); }
    };
  };
  $('#manual').onclick = () => {
    const m = modal('Crear ruta manual', `
      <div class="grid g2"><label class="f">Repartidor<select id="mdrv">${drivers.filter((d) => d.active).map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}</select></label>
      <label class="f">Hora de salida<input type="time" id="mtime" value="${esc(SETTINGS.start_time || '09:00')}" /></label></div>
      <div class="row between" style="margin:12px 0 6px"><h3 style="margin:0">Pedidos pendientes</h3><label class="row"><input type="checkbox" id="mall" /> Todos</label></div>
      <div class="table-wrap" style="max-height:340px"><table><tbody>${pending.map((o) => `<tr><td style="width:30px"><input type="checkbox" value="${o.id}" class="mo" /></td><td><b>${esc(o.tracking_code)}</b> ${o.priority === 'alta' ? '<span class="badge b-alta">Urgente</span>' : ''}<br><small>${esc(o.customer_name)} · ${esc(o.address)}</small></td></tr>`).join('') || '<tr><td class="muted">No hay pendientes</td></tr>'}</tbody></table></div>`,
      { wide: true, footer: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="mgo">Crear y optimizar</button>' });
    $('#mall', m.el).onchange = (e) => $$('.mo', m.el).forEach((x) => (x.checked = e.target.checked));
    $('#mgo', m.el).onclick = async () => {
      const ids = $$('.mo:checked', m.el).map((x) => Number(x.value));
      if (!ids.length) return toast('Selecciona pedidos', 'bad');
      try {
        const r = await POST('/api/routes', { driver_id: Number($('#mdrv', m.el).value), date, order_ids: ids, start_time: $('#mtime', m.el).value });
        toast(`Ruta creada: ${r.distance_km} km (${r.saving_pct}% menos que sin optimizar)`, 'ok'); m.close(); render();
      } catch (e) { toast(e.message, 'bad'); }
    };
  };
}

async function routeDetail(id) {
  const [r, drivers] = await Promise.all([GET('/api/routes/' + id), GET('/api/users?role=repartidor')]);
  const late = r.stops.filter((s) => s.eta && s.window_end && s.eta > s.window_end).length;
  const m = modal(r.name, `
    <div class="grid g2">
      <div><div id="rdmap" class="map"></div>
        <div class="grid g3" style="margin-top:10px">
          <div class="kpi"><div class="label">Distancia</div><div class="value" style="font-size:1.3rem">${fmtN(r.distance_km, 1)} km</div><div class="sub">sin optimizar ${fmtN(r.original_distance_km, 1)}</div></div>
          <div class="kpi"><div class="label">Duración est.</div><div class="value" style="font-size:1.3rem">${fmtN(r.est_minutes / 60, 1)} h</div><div class="sub">${r.stops.length} paradas</div></div>
          <div class="kpi"><div class="label">Fuera de ventana</div><div class="value" style="font-size:1.3rem;color:${late ? 'var(--bad)' : 'var(--ok)'}">${late}</div><div class="sub">paradas</div></div>
        </div>
        <div class="row" style="margin-top:10px;gap:6px;align-items:flex-end"><label class="f grow" style="margin:0">Fecha de la ruta<input type="date" id="rdate2" value="${esc(r.date)}" /></label><button class="btn" id="rdateGo" title="Mueve la ruta completa a otra fecha (si aún no tiene entregas)">📅 Cambiar fecha</button></div>
        <label class="f" style="margin-top:10px">Reasignar repartidor<select id="rdrv">${drivers.map((d) => `<option value="${d.id}" ${d.id === r.driver_id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select></label>
      </div>
      <div class="table-wrap" style="max-height:520px"><table><thead><tr><th>#</th><th>Cliente</th><th>ETA</th><th>Estado</th><th></th></tr></thead><tbody>
        ${r.stops.map((s) => `<tr><td class="num"><b>${s.stop_seq}</b><br><small class="muted">${s.leg_km ?? ''} km</small></td><td>${esc(s.customer_name)} ${s.priority === 'alta' ? '<span class="badge b-alta">!</span>' : ''}<br><small>${esc(s.address)}</small>${s.appointment_time ? `<br><small><b>⏰ ${esc(s.appointment_time)}</b> acordada</small>` : s.window_start ? `<br><small class="muted">Ventana ${s.window_start}–${s.window_end}</small>` : ''}</td><td class="num" style="${s.window_end && s.eta > s.window_end ? 'color:var(--bad)' : ''}">${esc(s.eta || '—')}</td><td>${badge(s.status)}</td>
          <td>${['asignado', 'cargado'].includes(s.status) ? `<button class="btn ghost sm" data-rm="${s.id}" title="Quitar de la ruta">${icon('x')}</button>` : ''}</td></tr>`).join('')}
      </tbody></table></div>
    </div>`, {
    wide: true,
    footer: `${r.status !== 'completada' && r.stops.some((x) => ['entregado', 'fallido'].includes(x.status)) ? `<button class="btn bad" id="rclose" title="El repartidor ya no sigue: se cierra como está y lo que falta regresa a pendientes">${icon('x')} Cerrar ruta</button>` : ''}${r.stops.some((x) => ['entregado', 'fallido'].includes(x.status)) ? '' : '<button class="btn bad" id="rdel">Eliminar ruta</button>'}<button class="btn" id="rxls">${icon('download')} Excel</button><button class="btn" id="ropt">Re-optimizar</button><a class="btn" target="_blank" href="${gmapsUrl(r.stops.filter((s) => ['asignado', 'cargado'].includes(s.status)))}">${icon('nav')} Google Maps</a><button class="btn primary" data-close>Cerrar</button>`,
    onClose: () => render(),
  });
  const map = makeMap($('#rdmap', m.el));
  drawRoute(map, r.stops, undefined, { depotLL: r.depot_lat != null ? [r.depot_lat, r.depot_lng] : null, onEdit: () => { m.el.remove(); routeDetail(r.id); } });
  if (r.last_lat) L.marker([r.last_lat, r.last_lng], { icon: truckIcon() }).addTo(map).bindPopup('Última posición ' + fmtDT(r.last_seen));
  $('#rdateGo', m.el).onclick = async () => {
    const d = $('#rdate2', m.el).value;
    if (!d || d === r.date) return toast('Elige otra fecha', 'bad');
    if (!(await confirmDlg(`¿Mover la ruta completa al ${new Date(d + 'T12:00:00').toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })}? Si el repartidor ya tiene ruta ese día, se juntan y se reordena.`))) return;
    try { const o = await POST(`/api/routes/${r.id}/date`, { date: d }); toast(`Ruta movida al ${d}: ${o.assigned} pedido(s)`, 'ok'); m.close(); render(); }
    catch (er) { toast(er.message, 'bad'); }
  };
  $('#rdrv', m.el).onchange = async (e) => { await PUT('/api/routes/' + r.id, { driver_id: Number(e.target.value) }); toast('Repartidor reasignado', 'ok'); };
  $('#rxls', m.el).onclick = () => exportAssignedExcel(r.date, r.driver_id);
  $('#ropt', m.el).onclick = async () => { const o = await POST(`/api/routes/${r.id}/optimize`); toast(`Re-optimizada: ${o.distance_km} km`, 'ok'); m.el.remove(); routeDetail(r.id); };
  $('#rclose', m.el)?.addEventListener('click', () => {
    const left = r.stops.filter((x) => ['asignado', 'cargado'].includes(x.status));
    const del = r.stops.filter((x) => x.status === 'entregado').length, fail = r.stops.filter((x) => x.status === 'fallido').length;
    const loaded = left.filter((x) => x.status === 'cargado').length;
    const tom = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toLocaleDateString('en-CA'); })();
    const d = modal('Cerrar ruta del día', `<form id="rcF" class="stack">
      <p style="margin:0">Se cierra la ruta de <b>${esc(r.driver_name || 'el repartidor')}</b> tal como está:</p>
      <ul style="margin:0"><li><b>${del}</b> entregados y <b>${fail}</b> no entregados quedan registrados.</li>
        <li><b>${left.length}</b> parada(s) sin visitar regresan a <b>pendientes</b>, sin repartidor.</li></ul>
      ${loaded ? `<div class="offline-bar">${loaded} paquete(s) ya estaban cargados en la unidad: recógelos o regístralos de vuelta en el almacén.</div>` : ''}
      <fieldset class="ch-line"><legend>¿Qué hacer con las ${left.length} sin visitar?</legend>
        <label class="row" style="gap:8px"><input type="radio" name="mode" value="re" checked /> <span class="grow">Reprogramar para</span><input type="date" name="date" value="${tom}" style="width:auto" /></label>
        <label class="row" style="gap:8px"><input type="radio" name="mode" value="keep" /> <span>Cerrar sin reprogramar <small class="muted">(quedan pendientes con su fecha actual, para asignarlas después)</small></span></label>
      </fieldset>
      <label class="f">Motivo (opcional)<input name="reason" placeholder="Ej. el repartidor se retiró por enfermedad" /></label>
    </form>`, { footer: '<button class="btn" data-close>Cancelar</button><button class="btn bad" id="rcGo">Cerrar ruta</button>' });
    $('#rcGo', d.el).onclick = async () => {
      const f = $('#rcF', d.el);
      try {
        const x = await POST(`/api/routes/${r.id}/close`, { date: f.mode.value === 're' ? f.date.value : null, reason: f.reason.value });
        toast(`Ruta cerrada: ${x.delivered} entregados · ${x.returned} regresan a pendientes${x.date ? ' para el ' + x.date : ''}`, 'ok');
        d.close(); m.close(); render();
      } catch (er) { toast(er.message, 'bad'); }
    };
  });
  $('#rdel', m.el)?.addEventListener('click', async () => { if (!(await confirmDlg('¿Eliminar la ruta? Los pedidos regresarán a pendientes.'))) return; try { await api('DELETE', '/api/routes/' + r.id); toast('Ruta eliminada', 'ok'); m.close(); } catch (e) { toast(e.message, 'bad'); } });
  $$('[data-rm]', m.el).forEach((b) => (b.onclick = async () => { await PUT('/api/routes/' + r.id, { remove_order_ids: [Number(b.dataset.rm)] }); m.el.remove(); routeDetail(r.id); }));
}

// ================= Inventario =================
// ================= Cumplimiento (unidades, recurso confiable, checklist, prácticas médicas, certificado) =================
const DOC_STATE = { vigente: ['Vigente', 'ok'], por_vencer: ['Por vencer', 'warn'], vencido: ['Vencido', 'off'], sin_dato: ['Sin dato', ''] };
const docChip = (st) => `<span class="chip ${DOC_STATE[st]?.[1] || ''}">${DOC_STATE[st]?.[0] || esc(st)}</span>`;
const VTYPES = { moto: 'Motocicleta', auto: 'Automóvil', van: 'Van / camioneta', camion: 'Camión', refrigerada: 'Unidad refrigerada', bici: 'Bicicleta' };
const SHIP_TYPES = { general: 'General', medicamento: 'Medicamento', muestra: 'Muestra biológica', dispositivo: 'Dispositivo médico', refrigerado: 'Refrigerado (cadena de frío)' };
const TEMP_PRESETS = { '': ['Sin control', '', ''], amb: ['Ambiente controlado 15–25 °C', 15, 25], ref: ['Refrigerado 2–8 °C', 2, 8], cong: ['Congelado ≤ -15 °C', '', -15] };
const fmtD = (d) => (d ? new Date(d + 'T12:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const fmtRange = (a, b) => (a == null && b == null ? '' : a != null && b != null ? `${a} a ${b} °C` : a != null ? `≥ ${a} °C` : `≤ ${b} °C`);
// Documento (foto o PDF) a data URL, sin sello de fecha
function fileToDataURL(file) {
  return new Promise((ok, fail) => {
    if (file.type === 'application/pdf') {
      if (file.size > 8 * 1024 * 1024) return fail(new Error('El PDF es demasiado grande (máx. 8 MB)'));
      const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = fail; r.readAsDataURL(file); return;
    }
    if (!file.type.startsWith('image/')) return fail(new Error('Sube una foto o un PDF'));
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 1800 / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src); ok(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = fail; img.src = URL.createObjectURL(file);
  });
}
const docLink = (f, label = 'Ver documento') => (f ? `<a href="/uploads/${esc(f)}" target="_blank" rel="noopener" class="doc-link">${icon(String(f).endsWith('.pdf') ? 'sheet' : 'camera')} ${label}</a>` : '');
const docInput = (name, label, current) => `<label class="f">${label}<span class="row"><label class="btn sm">${icon('upload')} Subir foto o PDF<input type="file" accept="image/*,application/pdf" data-doc="${name}" hidden /></label><small class="muted" data-docname="${name}">${current ? docLink(current) : 'Sin archivo'}</small></span></label>`;
function wireDocs(root, files) {
  $$('[data-doc]', root).forEach((inp) => (inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    try { files[inp.dataset.doc] = await fileToDataURL(f); $(`[data-docname="${inp.dataset.doc}"]`, root).textContent = `✅ ${f.name}`; }
    catch (e) { toast(e.message, 'bad'); }
  }));
}

function vehicleForm(v, drivers, done) {
  v = v || { type: 'van', active: 1 };
  const files = {};
  const m = modal(v.id ? `Unidad ${v.name}` : 'Nueva unidad', `<form id="vf" class="stack">
    <div class="grid g3"><label class="f">Nombre interno <b class="req">*</b><input name="name" required value="${esc(v.name)}" placeholder="Van 01" /></label>
      <label class="f">Placas <b class="req">*</b><input name="plates" required value="${esc(v.plates)}" style="text-transform:uppercase" /></label>
      <label class="f">Tipo<select name="type">${Object.entries(VTYPES).map(([k, l]) => `<option value="${k}" ${v.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
    <div class="grid g4"><label class="f">Marca<input name="brand" value="${esc(v.brand)}" /></label><label class="f">Modelo<input name="model" value="${esc(v.model)}" /></label>
      <label class="f">Año<input name="year" type="number" value="${esc(v.year)}" /></label><label class="f">Color<input name="color" value="${esc(v.color)}" /></label></div>
    <fieldset><legend>${icon('shield')} Seguro</legend><div class="grid g3">
      <label class="f">Aseguradora<input name="insurer" value="${esc(v.insurer)}" /></label><label class="f">Póliza<input name="policy_no" value="${esc(v.policy_no)}" /></label>
      <label class="f">Vigencia hasta<input name="insurance_expires" type="date" value="${esc(v.insurance_expires)}" /></label></div>${docInput('insurance_file', 'Póliza', v.insurance_file)}</fieldset>
    <fieldset><legend>${icon('sheet')} Tarjeta de circulación</legend><div class="grid g2"><label class="f">Número / folio<input name="circulation_card" value="${esc(v.circulation_card)}" /></label>${docInput('circulation_file', 'Documento', v.circulation_file)}</div></fieldset>
    <fieldset><legend>${icon('check')} Certificado de fumigación</legend><div class="grid g4">
      <label class="f">Fecha<input name="fumigation_date" type="date" value="${esc(v.fumigation_date)}" /></label><label class="f">Vigencia hasta<input name="fumigation_expires" type="date" value="${esc(v.fumigation_expires)}" /></label>
      <label class="f">Proveedor<input name="fumigation_provider" value="${esc(v.fumigation_provider)}" /></label><label class="f">No. de certificado<input name="fumigation_cert" value="${esc(v.fumigation_cert)}" /></label></div>${docInput('fumigation_file', 'Certificado', v.fumigation_file)}</fieldset>
    <fieldset><legend>${icon('info')} Temperatura</legend>
      <label class="row"><input type="checkbox" name="refrigerated" ${v.refrigerated ? 'checked' : ''} /> Unidad o caja refrigerada</label>
      <div class="grid g4"><label class="f">Mínima (°C)<input name="temp_min" type="number" step="0.1" value="${esc(v.temp_min)}" placeholder="2" /></label><label class="f">Máxima (°C)<input name="temp_max" type="number" step="0.1" value="${esc(v.temp_max)}" placeholder="8" /></label>
      <label class="f">Termómetro / registrador (ID)<input name="thermometer_id" value="${esc(v.thermometer_id)}" /></label><label class="f">Calibración vigente hasta<input name="thermometer_calibrated" type="date" value="${esc(v.thermometer_calibrated)}" /></label></div>${docInput('thermometer_file', 'Certificado de calibración', v.thermometer_file)}</fieldset>
    <div class="grid g3"><label class="row"><input type="checkbox" name="branded" ${v.branded ? 'checked' : ''} /> Unidad rotulada</label>
      <label class="f">Repartidor habitual<select name="driver_id"><option value="">—</option>${drivers.map((d) => `<option value="${d.id}" ${v.driver_id === d.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select></label>
      <label class="row"><input type="checkbox" name="active" ${v.active ? 'checked' : ''} /> Activa</label></div>
    <label class="f">Notas<textarea name="notes">${esc(v.notes)}</textarea></label></form>`, { wide: true, footer: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="saveV">Guardar unidad</button>' });
  const f = $('#vf', m.el);
  wireDocs(f, files);
  $('#saveV', m.el).onclick = async () => {
    if (!f.reportValidity()) return;
    const b = { ...Object.fromEntries(new FormData(f)), ...files };
    for (const k of ['refrigerated', 'branded', 'active']) b[k] = f[k].checked;
    try { if (v.id) await PUT('/api/vehicles/' + v.id, b); else await POST('/api/vehicles', b); toast('Unidad guardada', 'ok'); m.close(); done?.(); }
    catch (e) { toast(e.message, 'bad'); }
  };
}
function personnelForm(p, vehicles, done) {
  const files = {};
  let trainings = (p.trainings || []).slice();
  const m = modal(`Recurso confiable · ${p.name}`, `<form id="pfc" class="stack">
    <fieldset><legend>${icon('shield')} Certificado de recurso confiable</legend>
      <div class="grid g3"><label class="f">Folio<input name="trusted_cert_folio" value="${esc(p.trusted_cert_folio)}" /></label>
        <label class="f">Emitido por<input name="trusted_cert_issuer" value="${esc(p.trusted_cert_issuer)}" placeholder="Empresa certificadora / autoridad" /></label>
        <label class="f">Vigente hasta<input name="trusted_cert_expires" type="date" value="${esc(p.trusted_cert_expires)}" /></label></div>
      ${docInput('trusted_cert_file', 'Certificado', p.trusted_cert_file)}</fieldset>
    <label class="f">Unidad asignada<select name="vehicle_id"><option value="">—</option>${vehicles.map((v) => `<option value="${v.id}" ${p.vehicle_id === v.id ? 'selected' : ''}>${esc(v.name)} · ${esc(v.plates)}</option>`).join('')}</select></label>
    <fieldset><legend>${icon('check')} Capacitaciones</legend><div id="trs" class="stack"></div>
      <button type="button" class="btn sm" id="addTr">${icon('plus')} Agregar capacitación</button>
      <small class="muted">Ej.: Manejo de medicamentos y cadena de frío, Manejo de muestras biológicas (UN3373), Primeros auxilios, Manejo defensivo.</small></fieldset></form>`,
  { wide: true, footer: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="saveP">Guardar</button>' });
  const f = $('#pfc', m.el);
  wireDocs(f, files);
  const drawTr = () => {
    $('#trs', m.el).innerHTML = trainings.map((t, i) => `<div class="grid g4 tr-row"><input placeholder="Capacitación" value="${esc(t.name)}" data-k="name" data-i="${i}" />
      <input type="date" value="${esc(t.date)}" data-k="date" data-i="${i}" title="Fecha" /><input type="date" value="${esc(t.expires)}" data-k="expires" data-i="${i}" title="Vigencia" />
      <button type="button" class="btn sm ghost" data-del="${i}">${icon('x')}</button></div>`).join('') || '<small class="muted">Sin capacitaciones registradas</small>';
  };
  drawTr();
  $('#trs', m.el).oninput = (e) => { const t = e.target; if (t.dataset.i != null) trainings[t.dataset.i][t.dataset.k] = t.value; };
  $('#trs', m.el).onclick = (e) => { const b = e.target.closest('[data-del]'); if (b) { trainings.splice(b.dataset.del, 1); drawTr(); } };
  $('#addTr', m.el).onclick = () => { trainings.push({ name: '', date: '', expires: '' }); drawTr(); };
  $('#saveP', m.el).onclick = async () => {
    try { await PUT(`/api/users/${p.id}/compliance`, { ...Object.fromEntries(new FormData(f)), ...files, trainings }); toast('Guardado', 'ok'); m.close(); done?.(); }
    catch (e) { toast(e.message, 'bad'); }
  };
}

async function viewCompliance(v) {
  const tab = new URLSearchParams(location.hash.split('?')[1] || '').get('tab') || 'resumen';
  const isAdmin = store.user.role === 'admin';
  const c = await GET('/api/compliance');
  const t = c.totals;
  const tabs = [['resumen', 'Resumen', 'dash'], ['unidades', 'Unidades', 'truck'], ['personal', 'Recurso confiable', 'users'], ['checklists', 'Checklists', 'check'],
    ['practicas', 'Prácticas médicas', 'shield'], ...(isAdmin ? [['empresa', 'Datos de la empresa', 'cog'], ['certificado', 'Certificado', 'sign']] : [])];
  v.innerHTML = topbar('Cumplimiento', '', 'Unidades con placas, seguro y fumigación; personal confiable; checklist diario y prácticas para empresas médicas.') +
    `<div class="tabs">${tabs.map(([k, l, i]) => `<a href="#/compliance?tab=${k}" class="${k === tab ? 'on' : ''}">${icon(i)} ${l}</a>`).join('')}</div><div id="ctab"></div>`;
  const box = $('#ctab');
  const pct = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '—');
  const reload = () => render();
  const drivers = c.personnel_full.filter((p) => p.role === 'repartidor' && p.active);

  if (tab === 'resumen') {
    box.innerHTML = `<div class="grid g4">
      <div class="card kpi"><div class="label">Unidades con seguro vigente</div><div class="value">${t.insured}/${t.vehicles}</div><div class="sub">${t.branded} rotuladas · ${t.refrigerated} refrigeradas</div></div>
      <div class="card kpi"><div class="label">Fumigación vigente</div><div class="value">${t.fumigated}/${t.vehicles}</div></div>
      <div class="card kpi"><div class="label">Repartidores recurso confiable</div><div class="value">${t.trusted}/${t.drivers}</div></div>
      <div class="card kpi"><div class="label">Checklists hoy</div><div class="value">${t.checks_today}</div><div class="sub">${t.checks_today_ok} aprobados · ${t.checks_30d} en 30 días (${pct(t.checks_passed_30d, t.checks_30d)} ok)</div></div></div>
    <div class="grid g2" style="margin-top:14px">
      <div class="card"><h2>Envíos médicos (90 días)</h2><dl class="kv"><dt>Entregados</dt><dd>${t.medical_deliveries_90d}</dd>
        <dt>Temperatura en rango</dt><dd>${t.temp_records ? `${t.temp_in_range}/${t.temp_records} (${pct(t.temp_in_range, t.temp_records)})` : 'Sin registros'}</dd>
        <dt>Sellos íntegros</dt><dd>${t.seal_records ? `${t.seal_ok}/${t.seal_records} (${pct(t.seal_ok, t.seal_records)})` : 'Sin registros'}</dd>
        <dt>Prácticas adoptadas</dt><dd>${c.practices.length} de ${c.med_practices.length}</dd></dl></div>
      <div class="card"><h2>Pendientes</h2>${c.alerts.length ? `<ul class="alert-list">${c.alerts.map((a) => `<li>${icon('info')} ${esc(a)}</li>`).join('')}</ul>` : `<p class="muted">${t.vehicles ? 'Todo en orden ✅' : 'Registra tus unidades para empezar.'}</p>`}</div></div>`;
  }

  if (tab === 'unidades') {
    const full = await GET('/api/vehicles');
    box.innerHTML = `<div class="card"><div class="row between" style="margin-bottom:10px"><h2 style="margin:0">Unidades</h2><button class="btn primary" id="newV">${icon('plus')} Nueva unidad</button></div>
      <div class="table-wrap"><table><thead><tr><th>Unidad</th><th>Placas</th><th>Seguro</th><th>Fumigación</th><th>Temp.</th><th>Rotulada</th><th>Repartidor</th></tr></thead><tbody>
      ${full.map((x) => `<tr class="click" data-v="${x.id}"><td><b>${esc(x.name)}</b><br><small class="muted">${esc(VTYPES[x.type] || x.type)} ${esc([x.brand, x.model, x.year].filter(Boolean).join(' '))}</small></td>
        <td class="mono">${esc(x.plates)}</td><td>${docChip(x.insurance_state)}<br><small class="muted">${esc(x.insurer || '')} ${x.insurance_expires ? '· ' + fmtD(x.insurance_expires) : ''}</small></td>
        <td>${docChip(x.fumigation_state)}<br><small class="muted">${x.fumigation_expires ? fmtD(x.fumigation_expires) : ''}</small></td>
        <td>${x.refrigerated ? `❄️ ${fmtRange(x.temp_min, x.temp_max)}` : '—'}</td><td>${x.branded ? '✅' : '—'}</td>
        <td>${esc(x.driver_name || '')}${x.active ? '' : ' <span class="chip off">Inactiva</span>'}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">Sin unidades registradas</td></tr>'}
      </tbody></table></div></div>`;
    $('#newV').onclick = () => vehicleForm(null, drivers, reload);
    $$('[data-v]', box).forEach((tr) => (tr.onclick = () => vehicleForm(full.find((x) => x.id === Number(tr.dataset.v)), drivers, reload)));
  }

  if (tab === 'personal') {
    const vehicles = await GET('/api/vehicles');
    box.innerHTML = `<div class="card"><h2>Recurso confiable y capacitación</h2><div class="table-wrap"><table><thead><tr><th>Colaborador</th><th>Certificado</th><th>Vigencia</th><th>Capacitaciones</th><th>Unidad</th></tr></thead><tbody>
      ${c.personnel_full.filter((p) => p.active).map((p) => `<tr class="click" data-p="${p.id}"><td>${avatar(p)} <b>${esc(p.name)}</b><br><small class="muted">${ROLE[p.role]}</small></td>
        <td>${p.trusted_cert_folio ? `<span class="mono">${esc(p.trusted_cert_folio)}</span><br><small class="muted">${esc(p.trusted_cert_issuer || '')}</small> ${docLink(p.trusted_cert_file, 'Ver')}` : '<small class="muted">Sin certificado</small>'}</td>
        <td>${docChip(p.trusted_state)}${p.trusted_cert_expires ? `<br><small class="muted">${fmtD(p.trusted_cert_expires)}</small>` : ''}</td>
        <td>${p.trainings.length ? p.trainings.map((x) => `<small>• ${esc(x.name)}</small>`).join('<br>') : '<small class="muted">—</small>'}</td>
        <td><small>${esc(vehicles.find((x) => x.id === p.vehicle_id)?.plates || '—')}</small></td></tr>`).join('') || '<tr><td colspan="5" class="empty">Da de alta a tus repartidores en Usuarios</td></tr>'}
      </tbody></table></div></div>`;
    $$('[data-p]', box).forEach((tr) => (tr.onclick = () => personnelForm(c.personnel_full.find((x) => x.id === Number(tr.dataset.p)), vehicles, reload)));
  }

  if (tab === 'checklists') {
    const r = await GET('/api/vehicle-checks');
    box.innerHTML = `<div class="card"><h2>Checklists de unidad (30 días)</h2><div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Unidad</th><th>Repartidor</th><th>Resultado</th><th>Combustible</th><th>Temp.</th></tr></thead><tbody>
      ${r.rows.map((x, i) => `<tr class="click" data-i="${i}"><td>${fmtDT(x.created_at)}</td><td><b>${esc(x.vehicle_name)}</b> <span class="mono">${esc(x.plates)}</span></td><td>${esc(x.driver_name || '')}</td>
        <td>${x.passed ? '<span class="chip ok">Aprobado</span>' : '<span class="chip off">Con observaciones</span>'}</td><td>${esc(x.fuel || '—')}</td><td>${x.temp_c != null ? x.temp_c + ' °C' : '—'}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">Aún no hay checklists. Los repartidores los llenan en su app antes de salir.</td></tr>'}
      </tbody></table></div></div>`;
    $$('[data-i]', box).forEach((tr) => (tr.onclick = () => {
      const x = r.rows[tr.dataset.i];
      modal(`Checklist · ${x.vehicle_name} ${x.plates}`, `<div class="stack"><div class="row between"><span>${fmtDT(x.created_at)} · ${esc(x.driver_name || '')}</span>${x.passed ? '<span class="chip ok">Aprobado</span>' : '<span class="chip off">Con observaciones</span>'}</div>
        <table><tbody>${r.items.map(([k, l]) => `<tr><td>${l}</td><td class="r">${{ ok: '✅ Sí', no: '❌ No', na: '— N/A' }[x.items[k]] || '—'}</td></tr>`).join('')}
        <tr><td>Combustible</td><td class="r">${esc(x.fuel || '—')}</td></tr>${x.odometer ? `<tr><td>Kilometraje</td><td class="r">${x.odometer}</td></tr>` : ''}${x.temp_c != null ? `<tr><td>Temperatura de la caja</td><td class="r">${x.temp_c} °C</td></tr>` : ''}</tbody></table>
        ${x.notes ? `<p><b>Comentarios:</b> ${esc(x.notes)}</p>` : ''}<div class="grid g2">${x.photo_path ? `<img class="evid-img" src="/uploads/${esc(x.photo_path)}" alt="Foto de la unidad" />` : ''}${x.signature_path ? `<img class="evid-img" src="/uploads/${esc(x.signature_path)}" alt="Firma" />` : ''}</div></div>`, { wide: true });
    }));
  }

  if (tab === 'practicas') {
    const s = await GET('/api/settings');
    let adopted = [];
    try { adopted = JSON.parse(s.medical_practices || '[]'); } catch {}
    box.innerHTML = `<div class="grid g-main"><form class="card stack" id="mpf"><h2>Prácticas para empresas médicas</h2>
      <p class="muted" style="margin:0">Marca las prácticas que tu empresa aplica. Aparecerán en el certificado.</p>
      ${c.med_practices.map(([k, l]) => `<label class="radio"><input type="checkbox" name="mp" value="${k}" ${adopted.includes(k) ? 'checked' : ''} ${isAdmin ? '' : 'disabled'} /> <span>${esc(l)}</span></label>`).join('')}
      <h3 style="margin-top:8px">En la operación</h3>
      <label class="switch"><input type="checkbox" name="compliance_in_delivery" ${s.compliance_in_delivery === '1' ? 'checked' : ''} ${isAdmin ? '' : 'disabled'} /><span></span><div><b>Rubro de cumplimiento en la entrega</b><br><small class="muted">Temperatura, sello y empaque al entregar (opcional en envíos generales, obligatorio en médicos con rango de temperatura o sello).</small></div></label>
      <label class="switch"><input type="checkbox" name="require_vehicle_check" ${s.require_vehicle_check === '1' ? 'checked' : ''} ${isAdmin ? '' : 'disabled'} /><span></span><div><b>Checklist de unidad obligatorio</b><br><small class="muted">El repartidor no puede cargar paquetes sin llenar el checklist del día.</small></div></label>
      ${isAdmin ? '<div><button class="btn primary">Guardar</button></div>' : ''}</form>
      <div class="card stack guide"><h2>Guía rápida para envíos médicos</h2>
        <p><b>Al crear el pedido</b> elige el tipo (medicamento, muestra biológica, dispositivo médico o refrigerado), el rango de temperatura y si lleva sello o precinto.</p>
        <p><b>Antes de salir</b> el repartidor llena el checklist: limpieza y desinfección, revisión mecánica, llantas, combustible, EPP, documentos y, en unidades refrigeradas, la temperatura de la caja.</p>
        <p><b>Al entregar</b> registra la temperatura, revisa que el sello y el empaque estén íntegros y entrega solo a la persona autorizada con identificación. Si algo falla, la app exige describir la incidencia.</p>
        <p><b>Rangos de referencia:</b> refrigerado 2–8 °C, ambiente controlado 15–25 °C, congelado −15 °C o menos. Usa siempre el rango que indique el fabricante o tu cliente.</p>
        <p><b>Muestras biológicas:</b> triple embalaje (recipiente primario hermético, secundario y exterior rígido) con la etiqueta UN3373 cuando aplique.</p>
        <p class="muted"><small>Referencias de consulta: NOM-059-SSA1 y Suplemento para Establecimientos de la FEUM (buenas prácticas de almacenamiento y distribución), guía modelo de la OMS para almacenamiento y transporte de productos sensibles a la temperatura e instrucciones ONU/IATA para UN3373. Confirma los requisitos aplicables con tu responsable sanitario.</small></p></div></div>`;
    if (isAdmin) $('#mpf').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      SETTINGS = await PUT('/api/settings', { medical_practices: JSON.stringify($$('input[name=mp]:checked', f).map((x) => x.value)), compliance_in_delivery: f.compliance_in_delivery.checked ? '1' : '0', require_vehicle_check: f.require_vehicle_check.checked ? '1' : '0' });
      toast('Guardado', 'ok');
    };
  }

  if (tab === 'empresa' && isAdmin) {
    const s = await GET('/api/settings');
    box.innerHTML = `<form class="card stack" id="cf2" style="max-width:860px"><h2>Datos de la empresa para el certificado</h2>
      <div class="grid g2"><label class="f">Razón social<input name="company_legal_name" value="${esc(s.company_legal_name)}" /></label><label class="f">RFC<input name="company_rfc" value="${esc(s.company_rfc)}" style="text-transform:uppercase" /></label></div>
      <label class="f">Domicilio<input name="company_address" value="${esc(s.company_address)}" /></label>
      <div class="grid g2"><label class="f">Teléfono<input name="company_phone" value="${esc(s.company_phone)}" /></label><label class="f">Correo<input name="company_email" type="email" value="${esc(s.company_email)}" /></label></div>
      <div class="grid g2"><label class="f">Responsable que firma<input name="company_responsible" value="${esc(s.company_responsible)}" /></label><label class="f">Cargo<input name="company_responsible_title" value="${esc(s.company_responsible_title)}" /></label></div>
      <div class="grid g2"><label class="f">Licencia sanitaria / aviso de funcionamiento (si aplica)<input name="company_sanitary_license" value="${esc(s.company_sanitary_license)}" /></label>
        <label class="f">Vigencia del certificado (días)<input name="cert_validity_days" type="number" min="7" max="365" value="${esc(s.cert_validity_days)}" /></label></div>
      <div><button class="btn primary">Guardar</button></div></form>`;
    $('#cf2').onsubmit = async (e) => { e.preventDefault(); SETTINGS = await PUT('/api/settings', Object.fromEntries(new FormData(e.target))); toast('Datos guardados', 'ok'); };
  }

  if (tab === 'certificado' && isAdmin) {
    const list = await GET('/api/certificates');
    box.innerHTML = `<div class="grid g-main"><div class="card stack"><h2>Generar certificado de la empresa</h2>
      <p class="muted" style="margin:0">Se genera con los datos actuales: unidades con placas, seguro y fumigación, personal confiable, checklists, cadena de frío y prácticas adoptadas. Lleva folio y un QR para que tu cliente verifique que está vigente.</p>
      <label class="f">Dirigido a (opcional)<input id="cTo" placeholder="Ej. Laboratorios XYZ, S.A. de C.V." /></label>
      <label class="f">Alcance del servicio (opcional)<textarea id="cScope" rows="2" placeholder="Ej. Recolección y entrega de medicamentos y muestras biológicas en Tijuana y zona metropolitana"></textarea></label>
      ${c.alerts.length ? `<div class="offline-bar">${c.alerts.length} pendiente(s): ${esc(c.alerts.slice(0, 2).join('; '))}${c.alerts.length > 2 ? '…' : ''}. Quedarán reflejados en el certificado.</div>` : ''}
      <div><button class="btn primary" id="genC">${icon('sign')} Generar certificado</button></div></div>
      <div class="card"><h2>Emitidos</h2>${list.map((x) => {
        const st = x.revoked ? ['Revocado', 'off'] : Date.parse(x.valid_until + 'T23:59:59') < Date.now() ? ['Vencido', 'off'] : ['Vigente', 'ok'];
        return `<div class="cert-row"><div><b class="mono">${esc(x.folio)}</b> <span class="chip ${st[1]}">${st[0]}</span><br><small class="muted">${fmtDT(x.issued_at)} · vence ${fmtD(x.valid_until)}${x.data.addressed_to ? ' · ' + esc(x.data.addressed_to) : ''}</small></div>
          <div class="row"><button class="btn sm" data-print="${x.id}">${icon('print')} Ver / imprimir</button>${x.revoked ? '' : `<button class="btn sm bad" data-rev="${x.id}">Revocar</button>`}</div></div>`;
      }).join('') || '<p class="muted">Aún no se emite ninguno.</p>'}</div></div>`;
    $('#genC').onclick = async () => {
      try { const r = await POST('/api/certificates', { addressed_to: $('#cTo').value, scope: $('#cScope').value }); toast(`Certificado ${r.folio} emitido`, 'ok'); await render(); const l2 = await GET('/api/certificates'); openCertificate(l2.find((x) => x.id === r.id)); }
      catch (e) { toast(e.message, 'bad'); }
    };
    $$('[data-print]', box).forEach((b) => (b.onclick = () => openCertificate(list.find((x) => x.id === Number(b.dataset.print)))));
    $$('[data-rev]', box).forEach((b) => (b.onclick = async () => { if (await confirmDlg('¿Revocar este certificado? Al escanear su QR aparecerá como revocado.')) { await POST(`/api/certificates/${b.dataset.rev}/revoke`); toast('Revocado', 'ok'); render(); } }));
  }
}

async function openCertificate(x) {
  const d = x.data;
  const t = d.totals;
  const co = d.company;
  const qr = await GET(`/api/certificates/${x.id}/qr`).catch(() => null);
  const yes = (b) => (b ? '✔' : '✘');
  const m = modal(`Certificado ${x.folio}`, `<div class="certificate" id="certDoc">
    <div class="cert-head">${logo()}<div class="r"><small>Folio</small><b class="mono">${esc(x.folio)}</b><small>Emitido ${fmtDT(x.issued_at)}</small><small>Vigente hasta <b>${fmtD(x.valid_until)}</b></small></div></div>
    <h1 class="cert-title">Certificado de Cumplimiento Operativo</h1>
    <p class="cert-sub">Constancia que emite <b>${esc(co.legal_name || co.name)}</b>${co.rfc ? ` (RFC ${esc(co.rfc)})` : ''} con base en los registros de su sistema de gestión de entregas${d.addressed_to ? `, a solicitud de <b>${esc(d.addressed_to)}</b>` : ''}.</p>
    ${d.scope ? `<p><b>Alcance del servicio:</b> ${esc(d.scope)}</p>` : ''}
    <div class="cert-kpis"><div><b>${t.insured}/${t.vehicles}</b><small>unidades con placas y seguro vigente</small></div><div><b>${t.fumigated}/${t.vehicles}</b><small>con fumigación vigente</small></div>
      <div><b>${t.trusted}/${t.drivers}</b><small>repartidores recurso confiable</small></div><div><b>${t.checks_30d}</b><small>checklists de unidad en 30 días (${t.checks_30d ? Math.round((t.checks_passed_30d / t.checks_30d) * 100) : 0}% aprobados)</small></div></div>
    <h3>Unidades</h3><table class="cert-table"><thead><tr><th>Unidad</th><th>Placas</th><th>Seguro</th><th>Fumigación</th><th>Rotulada</th><th>Temperatura</th></tr></thead><tbody>
      ${d.vehicles.map((v) => `<tr><td>${esc(v.name)}<br><small>${esc([VTYPES[v.type], v.brand, v.model, v.year].filter(Boolean).join(' '))}</small></td><td class="mono">${esc(v.plates)}</td>
        <td>${esc(v.insurer || '—')}${v.policy_no ? `<br><small>Póliza ${esc(v.policy_no)}</small>` : ''}<br><small>${DOC_STATE[v.insurance_state][0]}${v.insurance_expires ? ' · ' + fmtD(v.insurance_expires) : ''}</small></td>
        <td>${esc(v.fumigation_provider || '—')}${v.fumigation_cert ? `<br><small>Cert. ${esc(v.fumigation_cert)}</small>` : ''}<br><small>${DOC_STATE[v.fumigation_state][0]}${v.fumigation_expires ? ' · ' + fmtD(v.fumigation_expires) : ''}</small></td>
        <td class="c">${yes(v.branded)}</td><td>${v.refrigerated ? `Refrigerada ${fmtRange(v.temp_min, v.temp_max)}${v.thermometer_id ? `<br><small>Termómetro ${esc(v.thermometer_id)}${v.thermometer_calibrated ? ' · calibrado a ' + fmtD(v.thermometer_calibrated) : ''}</small>` : ''}` : 'Ambiente'}</td></tr>`).join('')}</tbody></table>
    <h3>Personal</h3><table class="cert-table"><thead><tr><th>Colaborador</th><th>Recurso confiable</th><th>Capacitación</th></tr></thead><tbody>
      ${d.personnel.map((p) => `<tr><td>${esc(p.name)}<br><small>${ROLE[p.role]}</small></td><td>${p.trusted_cert_folio ? `Folio ${esc(p.trusted_cert_folio)}${p.trusted_cert_issuer ? ' · ' + esc(p.trusted_cert_issuer) : ''}<br><small>${DOC_STATE[p.trusted_state][0]}${p.trusted_cert_expires ? ' · ' + fmtD(p.trusted_cert_expires) : ''}</small>` : '<small>Sin certificado</small>'}</td>
        <td><small>${p.trainings.map((x) => esc(x.name)).join(', ') || '—'}</small></td></tr>`).join('') || '<tr><td colspan="3">—</td></tr>'}</tbody></table>
    <h3>Prácticas aplicadas</h3>${d.practices.length ? `<ul class="cert-list">${d.practices.map((p) => `<li>${esc(p.label)}</li>`).join('')}</ul>` : '<p>—</p>'}
    ${t.medical_deliveries_90d ? `<p><b>Envíos médicos (últimos 90 días):</b> ${t.medical_deliveries_90d} entregados; temperatura en rango ${t.temp_in_range}/${t.temp_records}; sellos íntegros ${t.seal_ok}/${t.seal_records}.</p>` : ''}
    <div class="cert-foot"><div class="cert-sign"><div class="line"></div><b>${esc(co.responsible || '')}</b><small>${esc(co.responsible_title || '')}</small><small>${esc(co.legal_name || co.name)}</small></div>
      <div class="cert-qr">${qr?.qr ? `<img src="${qr.qr}" alt="QR de verificación" />` : ''}<small>Verifica su vigencia escaneando el código</small></div></div>
    <p class="cert-legal">${esc(co.address || '')}${co.phone ? ' · ' + esc(co.phone) : ''}${co.email ? ' · ' + esc(co.email) : ''}${co.sanitary_license ? ` · Licencia/aviso sanitario: ${esc(co.sanitary_license)}` : ''}<br>
      Documento emitido por la empresa como autodeclaración con base en sus registros internos a la fecha de emisión; no sustituye certificaciones o permisos otorgados por autoridades u organismos acreditados.</p>
  </div>`, { wide: true, footer: `${qr?.url ? `<button class="btn" id="cpC">${icon('copy')} Copiar enlace de verificación</button>` : ''}<button class="btn primary" id="prC">${icon('print')} Imprimir / guardar PDF</button>` });
  $('#prC', m.el).onclick = () => printEl($('#certDoc', m.el));
  $('#cpC', m.el)?.addEventListener('click', () => copyText(qr.url));
}

// ---------- Repartidor: checklist de la unidad antes de salir ----------
async function viewCheck(v) {
  const r = await GET('/api/my/check');
  if (r.check) {
    v.innerHTML = topbar('Checklist de unidad', '<a href="#/my" class="btn sm">Mi ruta</a>') + `<div class="card stack"><div class="row between"><b>${esc(r.check.vehicle_name)} · <span class="mono">${esc(r.check.plates)}</span></b>${r.check.passed ? '<span class="chip ok">Aprobado</span>' : '<span class="chip off">Con observaciones</span>'}</div>
      <p class="muted" style="margin:0">Ya llenaste el checklist de hoy (${fmtDT(r.check.created_at)}).</p>
      <table><tbody>${r.items.map(([k, l]) => `<tr><td>${l}</td><td class="r">${{ ok: '✅', no: '❌', na: '—' }[r.check.items[k]]}</td></tr>`).join('')}</tbody></table>
      ${r.check.notes ? `<p><b>Comentarios:</b> ${esc(r.check.notes)}</p>` : ''}<a href="#/my" class="btn primary block">Ir a mi ruta</a></div>`;
    return;
  }
  if (!r.vehicles.length) { v.innerHTML = topbar('Checklist de unidad') + '<div class="card empty">Aún no hay unidades registradas. Pide al despacho que las dé de alta en Cumplimiento → Unidades.</div>'; return; }
  let photo = null;
  v.innerHTML = topbar('Checklist de unidad', '<a href="#/my" class="btn sm">Volver</a>') + `<form class="card stack" id="ckf">
    <p class="muted" style="margin:0">Revisa tu unidad antes de salir. Toca Sí, No o N/A en cada punto.</p>
    <label class="f">Unidad<select name="vehicle_id">${r.vehicles.map((x) => `<option value="${x.id}" ${x.id === r.suggested_vehicle ? 'selected' : ''} data-ref="${x.refrigerated ? 1 : 0}">${esc(x.name)} · ${esc(x.plates)}</option>`).join('')}</select></label>
    <div class="ck-list">${r.items.map(([k, l, crit]) => `<div class="ck-item"><span>${esc(l)}${crit ? ' <b class="req">*</b>' : ''}</span>
      <div class="ck-opts" role="radiogroup">${[['ok', 'Sí'], ['no', 'No'], ...(crit ? [] : [['na', 'N/A']])].map(([val, lab]) => `<label><input type="radio" name="ck_${k}" value="${val}" /><span class="ck-${val}">${lab}</span></label>`).join('')}</div></div>`).join('')}</div>
    <div class="grid g3"><label class="f">Combustible<select name="fuel"><option>Lleno</option><option>3/4</option><option>1/2</option><option>1/4</option><option>Reserva</option></select></label>
      <label class="f">Kilometraje<input name="odometer" type="number" inputmode="numeric" /></label>
      <label class="f" id="tempBox" hidden>Temperatura de la caja (°C) <b class="req">*</b><input name="temp_c" type="number" step="0.1" inputmode="decimal" /></label></div>
    <div><label class="f">Foto de la unidad</label><label class="btn block" style="margin-top:4px">${icon('camera')} Tomar foto<input type="file" accept="image/*" capture="environment" id="ckPhoto" hidden /></label><img id="ckPrev" class="photo-prev" hidden alt="" /></div>
    <div><label class="f">Firma del repartidor</label><div class="sig-wrap" style="margin-top:4px"><canvas id="ckSig"></canvas><button type="button" class="btn sm clear" id="ckClr">Borrar</button></div></div>
    <label class="f">Comentarios<textarea name="notes" placeholder="Obligatorio si algún punto no se cumple"></textarea></label>
    <button class="btn ok lg block">${icon('check')} Guardar checklist</button></form>`;
  const f = $('#ckf');
  const sig = signaturePad($('#ckSig'));
  $('#ckClr').onclick = () => sig.clear();
  const upd = () => { $('#tempBox').hidden = f.vehicle_id.selectedOptions[0].dataset.ref !== '1'; };
  f.vehicle_id.onchange = upd; upd();
  $('#ckPhoto').onchange = async (e) => { const fl = e.target.files[0]; if (fl) { photo = await compressImage(fl); $('#ckPrev').src = photo; $('#ckPrev').hidden = false; } };
  f.onsubmit = async (e) => {
    e.preventDefault();
    const items = {};
    for (const [k, l] of r.items) { const sel = $(`input[name=ck_${k}]:checked`, f); if (!sel) return toast(`Falta: ${l}`, 'bad'); items[k] = sel.value; }
    try {
      const res = await POST('/api/my/check', { vehicle_id: f.vehicle_id.value, items, fuel: f.fuel.value, odometer: f.odometer.value, temp_c: f.temp_c.value, notes: f.notes.value, photo, signature: sig.data() });
      toast(res.passed ? 'Checklist aprobado ✅' : 'Checklist guardado con observaciones: avisa al despacho', res.passed ? 'ok' : '');
      location.hash = '#/my';
    } catch (er) { toast(er.message, 'bad'); }
  };
}

// Rubro de cumplimiento en la entrega (opcional; obligatorio en envíos médicos con rango o sello)
function complianceFields(o) {
  if (SETTINGS.compliance_in_delivery !== '1') return '';
  const med = o.shipment_type && o.shipment_type !== 'general';
  const range = fmtRange(o.temp_min, o.temp_max);
  const needT = med && range;
  return `<details class="comp-box" ${med || o.requires_seal ? 'open' : ''}><summary>${icon('shield')} Cumplimiento ${med ? `· ${esc(SHIP_TYPES[o.shipment_type])}` : '(opcional)'}${range ? ` · ${range}` : ''}</summary>
    <div class="grid g2" style="margin-top:10px">
      <label class="f">Temperatura al entregar (°C) ${needT ? '<b class="req">*</b>' : ''}<input id="cTemp" type="number" step="0.1" inputmode="decimal" /><small class="muted" id="cTempMsg"></small></label>
      <label class="f">Sello / precinto ${o.requires_seal ? '<b class="req">*</b>' : ''}<input id="cSeal" value="${esc(o.seal_number || '')}" placeholder="Número de sello" /></label></div>
    <div class="grid g2"><div class="f"><span>¿Sello íntegro?</span><div class="ck-opts"><label><input type="radio" name="cSealOk" value="1" /><span class="ck-ok">Sí</span></label><label><input type="radio" name="cSealOk" value="0" /><span class="ck-no">No</span></label></div></div>
      <div class="f"><span>¿Empaque íntegro?</span><div class="ck-opts"><label><input type="radio" name="cPkgOk" value="1" /><span class="ck-ok">Sí</span></label><label><input type="radio" name="cPkgOk" value="0" /><span class="ck-no">No</span></label></div></div></div>
    <small class="muted">Se registran también la unidad (placas, seguro y fumigación), el checklist del día y tu certificado de recurso confiable.</small></details>`;
}
function wireCompliance(root, o) {
  const t = $('#cTemp', root);
  if (!t) return () => ({});
  t.oninput = () => {
    const v = Number(t.value);
    const msg = $('#cTempMsg', root);
    if (t.value === '' || (o.temp_min == null && o.temp_max == null)) { msg.textContent = ''; return; }
    const ok = !((o.temp_min != null && v < o.temp_min) || (o.temp_max != null && v > o.temp_max));
    msg.innerHTML = ok ? '<span style="color:var(--ok)">✅ Dentro del rango</span>' : '<span style="color:var(--bad)">⚠️ Fuera de rango: describe la incidencia en comentarios</span>';
  };
  return () => {
    const r = (n) => $(`input[name=${n}]:checked`, root)?.value;
    return { temp_c: t.value, seal_number: $('#cSeal', root).value, seal_ok: r('cSealOk') ?? '', package_ok: r('cPkgOk') ?? '' };
  };
}
const complianceHTML = (c) => {
  if (!c) return '';
  const yn = (v) => (v == null ? '—' : v ? '✅ Sí' : '❌ No');
  return `<dt>Cumplimiento</dt><dd>${c.shipment_type && c.shipment_type !== 'general' ? `<b>${esc(SHIP_TYPES[c.shipment_type])}</b><br>` : ''}
    ${c.temp_c != null ? `Temperatura ${c.temp_c} °C ${fmtRange(c.temp_min, c.temp_max) ? `(rango ${fmtRange(c.temp_min, c.temp_max)}: ${c.temp_in_range ? 'en rango' : 'FUERA DE RANGO'})` : ''}<br>` : ''}
    ${c.seal_number || c.seal_ok != null ? `Sello ${esc(c.seal_number || '')} íntegro: ${yn(c.seal_ok)}<br>` : ''}${c.package_ok != null ? `Empaque íntegro: ${yn(c.package_ok)}<br>` : ''}
    ${c.vehicle ? `Unidad ${esc(c.vehicle.name)} · <span class="mono">${esc(c.vehicle.plates)}</span> · seguro ${yn(c.vehicle.insured)} · fumigación ${yn(c.vehicle.fumigated)}<br>` : ''}
    ${c.check ? `Checklist de unidad ${fmtD(c.check.date)}: ${c.check.passed ? 'aprobado' : 'con observaciones'}<br>` : ''}
    ${c.trusted ? `Recurso confiable: folio ${esc(c.trusted.folio)}${c.trusted.valid ? '' : ' (vencido)'}` : ''}</dd>`;
};

// ================= Guía del administrador (en vivo) =================
async function viewGuide(v) {
  const r = await fetch('/api/guide', { headers: { Authorization: 'Bearer ' + store.token } });
  if (!r.ok) throw new Error('No se pudo cargar la guía');
  const html = await r.text();
  v.innerHTML = topbar('Guía del administrador', `<button class="btn" id="gOpen">${icon('ext')} Abrir en ventana</button><button class="btn primary" id="gPrint">${icon('print')} Imprimir / PDF</button>`,
    'Panorama general de la operación, con los datos de este momento.') + '<iframe id="gFrame" class="guide-frame" title="Guía del administrador"></iframe>';
  const f = $('#gFrame');
  f.srcdoc = html;
  f.onload = () => { try { f.style.height = f.contentDocument.documentElement.scrollHeight + 20 + 'px'; } catch {} };
  $('#gPrint').onclick = () => f.contentWindow.print();
  $('#gOpen').onclick = () => { const u = URL.createObjectURL(new Blob([html], { type: 'text/html' })); window.open(u, '_blank'); setTimeout(() => URL.revokeObjectURL(u), 60000); };
}

// ================= Números de serie =================
const SN_STATUS = { disponible: ['En almacén', 'ok'], asignado: ['Asignado a pedido', 'warn'], entregado: ['Entregado', ''], baja: ['Baja', 'off'] };
const snChip = (st) => `<span class="chip ${SN_STATUS[st]?.[1] || ''}">${SN_STATUS[st]?.[0] || esc(st)}</span>`;
const SN_EVENT = { recibido: 'Recibido en almacén', alta: 'Registrado al asignar', asignado: 'Asignado al pedido', liberado: 'Liberado del pedido', entregado: 'Entregado al cliente', baja: 'Dado de baja', reingreso: 'Reingresado', devolucion: 'Devuelto por el cliente', repartidor: 'Entregado a repartidor', almacen: 'Devuelto al almacén por el repartidor', abierto: 'Abierto para cualquier repartidor' };

// Asignar S/N a mano: escribir / escanear o elegir de los disponibles (también para pedidos ya entregados)
async function assignSerialManual(o) {
  const pids = (o.serial_needs || []).filter((n) => n.missing).map((n) => n.product_id);
  const lists = await Promise.all(pids.map((pid) => GET(`/api/serials?status=disponible&product_id=${pid}&limit=500`).then((r) => r.rows).catch(() => [])));
  const avail = lists.flat();
  const where = (x) => (x.holder_name ? `Lo trae ${x.holder_name}` : x.open_pool ? 'Abierto (cualquier repartidor)' : x.warehouse_name || 'Almacén');
  const m = modal(`Asignar S/N · ${o.tracking_code}`, `<div class="stack">
    ${o.status === 'entregado' ? '<div class="info-bar">El pedido ya está entregado: el equipo que asignes queda como <b>entregado</b> a este cliente y se actualiza la hoja de Google.</div>' : ''}
    <p style="margin:0">${(o.serial_needs || []).filter((n) => n.missing).map((n) => `${esc(n.name)}: falta${n.missing === 1 ? '' : 'n'} <b>${n.missing}</b>`).join(' · ')}</p>
    <div class="row"><input id="msnIn" class="grow mono" placeholder="Escribe o escanea el S/N (ej. HWTCDE3E15BA)" autocomplete="off" style="text-transform:uppercase" /><button class="btn" id="msnScan">${icon('scan')}</button><button class="btn primary" id="msnGo">Asignar</button></div>
    <h3 style="margin:6px 0 0">…o elige de los disponibles (${avail.length})</h3>
    <input id="msnQ" placeholder="Buscar S/N, almacén o repartidor" />
    <div class="table-wrap" style="max-height:300px"><table><tbody>${avail.map((x) => `<tr data-r="${esc((x.serial + ' ' + where(x)).toLowerCase())}"><td class="mono">${esc(x.serial)}</td><td><small>${esc(x.product_name)}</small></td><td><small class="muted">${esc(where(x))}</small></td><td class="r"><button class="btn sm" data-pick="${esc(x.serial)}">Usar</button></td></tr>`).join('') || '<tr><td class="muted">No hay equipos disponibles de este producto.</td></tr>'}</tbody></table></div></div>`,
    { wide: true, footer: '<button class="btn" data-close>Cancelar</button>' });
  const go = async (sn) => {
    sn = String(sn || '').trim().toUpperCase();
    if (!sn) return toast('Escribe el número de serie', 'bad');
    try {
      const r = await POST(`/api/orders/${o.id}/serials`, { serial: sn });
      toast(`S/N ${r.serial} asignado a ${o.tracking_code}${r.missing ? ` · faltan ${r.missing}` : ''}`, 'ok');
      m.close(); render(); orderDetail(o.id);
    } catch (e) { toast(e.message, 'bad'); }
  };
  $('#msnGo', m.el).onclick = () => go($('#msnIn', m.el).value);
  $('#msnIn', m.el).onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); go(e.target.value); } };
  $('#msnScan', m.el).onclick = () => openScanner({ title: 'Escanear S/N', onCode: async (c) => { $('#msnIn', m.el).value = c; await go(c); } });
  $('#msnQ', m.el).oninput = (e) => { const q = e.target.value.toLowerCase().trim(); $$('tr[data-r]', m.el).forEach((tr) => (tr.hidden = !!q && !tr.dataset.r.includes(q))); };
  $$('[data-pick]', m.el).forEach((b) => (b.onclick = async () => { if (await confirmDlg(`¿Asignar ${b.dataset.pick} al pedido ${o.tracking_code}?`)) go(b.dataset.pick); }));
  setTimeout(() => $('#msnIn', m.el)?.focus(), 100);
}
// Escanear los S/N que le faltan a un pedido (despacho, mostrador o repartidor)
function ensureSerials(order, onDone) {
  const draw = (needs, serials) => {
    const box = $('#snNeeds', m.el);
    if (!box) return;
    box.innerHTML = needs.map((n) => `<div class="row between"><span>${esc(n.name)}</span><b class="${n.missing ? '' : 'ok-txt'}">${n.qty - n.missing}/${n.qty}</b></div>`).join('') +
      (serials.length ? `<div class="sn-list">${serials.map((x) => `<span class="chip">${esc(x.serial)}</span>`).join('')}</div>` : '');
  };
  const m = openScanner({
    title: `Números de serie · ${order.tracking_code}`, continuous: true,
    hint: 'Escanea el S/N de cada equipo que va en este pedido (normalmente viene en la etiqueta de la caja).',
    onCode: async (code) => {
      const r = await POST(`/api/orders/${order.id}/serials`, { serial: code });
      const o2 = await GET('/api/orders/' + order.id);
      draw(o2.serial_needs, o2.serials);
      if (!r.missing) { toast('Series completas ✅', 'ok'); setTimeout(() => { m.close(); onDone?.(o2); }, 600); }
      return r.already ? 'ya estaba asignado' : `${r.product} · ${r.missing ? `faltan ${r.missing}` : 'completo'}`;
    },
  });
  m.el.querySelector('.body').insertAdjacentHTML('afterbegin', '<div class="sn-needs card" id="snNeeds"></div>');
  GET('/api/orders/' + order.id).then((o2) => draw(o2.serial_needs, o2.serials)).catch(() => {});
  return m;
}
// Si el servidor responde que faltan series, abre el escáner de series y luego reintenta la acción
async function withSerials(fn, orderHint) {
  try { return await fn(); }
  catch (e) {
    if (e.data?.code !== 'serials_required') throw e;
    toast(e.message, 'bad');
    await new Promise((ok) => ensureSerials({ id: e.data.order_id, tracking_code: e.data.tracking_code || orderHint }, ok));
    return fn();
  }
}

async function serialDetail(sn) {
  const s = await GET('/api/serials/lookup/' + encodeURIComponent(sn));
  if (s.mine === false) return modal(`S/N ${s.serial}`, `<p>${esc(s.product_name)} · ${snChip(s.status)}</p><p class="muted">Este equipo no pertenece a tus pedidos.</p>`);
  const staff = !driverMode();
  const acts = staff ? {
    disponible: `<button class="btn bad" data-act="baja">Dar de baja</button>`,
    baja: `<button class="btn" data-act="reingreso">Reingresar al almacén</button>`,
    entregado: `<button class="btn" data-act="devolucion">Registrar devolución del cliente</button>`,
  }[s.status] || '' : '';
  const m = modal(`S/N ${s.serial}`, `<div class="stack">
    <div class="row between"><div><b>${esc(s.product_name)}</b><br><small class="muted">${esc(s.sku)}</small></div>${snChip(s.status)}</div>
    <div class="label-print"><svg id="snbc"></svg></div>
    ${s.tracking_code ? `<div class="sn-order"><small class="muted">Pedido</small><b class="mono">${esc(s.tracking_code)}</b> ${badge(s.order_status)}<br>${esc(s.customer_name || '')}<br><small class="muted">${esc(s.address || '')}</small>
      <div class="row" style="margin-top:6px">${staff ? `<button class="btn sm" id="snOrd">${icon('box')} Ver pedido</button>` : ''}${s.public_link && s.status === 'entregado' ? `<a class="btn sm" target="_blank" href="${esc(s.public_link)}">${icon('sign')} Comprobante</a>` : ''}</div></div>` : ''}
    <div><h3>Historial</h3><div class="timeline">${(s.events || []).map((e) => `<div><b>${SN_EVENT[e.event] || esc(e.event)}</b>${e.tracking_code ? ` <span class="mono">${esc(e.tracking_code)}</span>` : ''} <small class="muted">· ${fmtDT(e.created_at)}${e.user_name ? ' · ' + esc(e.user_name) : ''}</small>${e.detail ? `<br><small>${esc(e.detail)}</small>` : ''}</div>`).join('') || '<p class="muted">Sin movimientos</p>'}</div></div>
  </div>`, { footer: `${acts}<button class="btn primary" data-close>Cerrar</button>` });
  try { JsBarcode($('#snbc', m.el), s.serial, { format: 'CODE128', height: 50, fontSize: 14 }); } catch {}
  $('#snOrd', m.el)?.addEventListener('click', () => { m.close(); orderDetail(s.order_id); });
  $$('[data-act]', m.el).forEach((b) => (b.onclick = async () => {
    const act = b.dataset.act;
    let notes = '';
    if (act === 'baja') { notes = prompt('Motivo de la baja (dañado, extraviado, garantía…):') || ''; if (!notes.trim()) return; }
    else if (!(await confirmDlg(act === 'devolucion' ? `¿Registrar que el cliente devolvió el equipo ${s.serial}? Volverá al almacén.` : `¿Reingresar ${s.serial} al almacén?`))) return;
    try { await POST(`/api/serials/${s.id}/action`, { action: act, notes }); toast('Listo', 'ok'); m.close(); if (location.hash.startsWith('#/serials') || location.hash.startsWith('#/inventory')) render(); }
    catch (e) { toast(e.message, 'bad'); }
  }));
}

// Opciones de repartidor para "entregar al recibir"
async function fillDriverSelect(sel) {
  try {
    const ds = (await GET('/api/users?role=repartidor')).filter((d) => d.active);
    sel.insertAdjacentHTML('beforeend', ds.map((d) => `<option value="${d.id}">${esc(d.name)}${d.vehicle ? ' · ' + esc(d.vehicle) : ''}</option>`).join(''));
  } catch {}
}
function receiveSerials(products, preselect) {
  if (!products.length) return toast('Primero activa "Controlar por número de serie" en algún producto (Inventario → editar producto)', 'bad');
  const m = modal('Recibir equipos por número de serie', `<div class="stack">
    <div class="grid g2"><label class="f">Producto<select id="rsP">${products.map((p) => `<option value="${p.id}" ${String(p.id) === String(preselect) ? 'selected' : ''}>${esc(p.name)} (${esc(p.sku)})</option>`).join('')}</select></label>
      <label class="f">Referencia<input id="rsRef" placeholder="Factura, remisión, lote…" maxlength="80" /></label></div>
    <div class="grid g2"><label class="f">Almacén<select id="rsWh"></select></label>
    <label class="f"><span>${icon('truck')} Entregar de inmediato a repartidor <small class="muted">(opcional)</small></span><select id="rsDrv"><option value="">— Dejar en almacén —</option></select></label></div>
    <div class="row"><button class="btn primary grow" id="rsScan">${icon('scan')} Escanear series</button></div>
    <label class="f">…o pega una lista (una serie por línea, p. ej. desde Excel)<textarea id="rsList" rows="5" placeholder="HWTCDE3D40BA&#10;HWTCDE3D40BB"></textarea></label>
    <div class="row"><button class="btn" id="rsPaste">Registrar lista</button><small class="muted" id="rsCount"></small></div>
    <div class="scan-log" id="rsLog"></div></div>`, { wide: true, footer: '<button class="btn primary" data-close>Listo</button>', onClose: () => render() });
  const send = async (serials) => {
    const r = await POST('/api/serials/receive', { product_id: $('#rsP', m.el).value, serials, reference: $('#rsRef', m.el).value, driver_id: $('#rsDrv', m.el).value || null, warehouse_id: $('#rsWh', m.el).value || null });
    const log = $('#rsLog', m.el);
    for (const x of r.results) log.insertAdjacentHTML('afterbegin', `<div style="${x.ok ? '' : 'color:var(--bad)'}">${x.ok ? '✅' : '⛔'} <b>${esc(x.serial)}</b>${x.ok && r.driver ? ` → ${icon('truck')} ${esc(r.driver)}` : ''}${x.error ? ' · ' + esc(x.error) : ''}</div>`);
    $('#rsCount', m.el).textContent = `Existencia actual: ${r.stock}`;
    return r;
  };
  fillDriverSelect($('#rsDrv', m.el));
  fillWarehouseSelect($('#rsWh', m.el));
  $('#rsList', m.el).oninput = (e) => { const n = e.target.value.split(/[\r\n,;\t]+/).filter((x) => x.trim()).length; $('#rsCount', m.el).textContent = n ? `${n} series en la lista` : ''; };
  excelSerialsInto($('#rsList', m.el));
  $('#rsPaste', m.el).onclick = async () => {
    const list = $('#rsList', m.el).value.split(/[\r\n,;\t]+/).map((x) => x.trim()).filter(Boolean);
    if (!list.length) return toast('Pega al menos una serie', 'bad');
    try { const r = await send(list); toast(`${r.received} equipos recibidos${r.errors.length ? `, ${r.errors.length} con error` : ''}`, r.errors.length ? '' : 'ok'); $('#rsList', m.el).value = ''; }
    catch (e) { toast(e.message, 'bad'); }
  };
  $('#rsScan', m.el).onclick = () => openScanner({
    title: 'Recibir series', continuous: true,
    hint: `Producto: ${$('#rsP', m.el).selectedOptions[0].text}. Cada lectura registra un equipo y suma 1 a la existencia.`,
    onCode: async (code) => { const r = await send([code]); if (!r.received) throw new Error(r.errors[0]?.error || 'No registrado'); return `existencia ${r.stock}`; },
  });
}

// ================= Asignación masiva a repartidor =================
// Barra que aparece al marcar pedidos o clientes: elige repartidor y fecha, y asigna todo de un jalón.
// Selección por ciudad (casilla del encabezado) y "N más cercanos" en listas de pedidos agrupadas por ciudad
function geoPickWire(v, onPick) {
  const changed = () => { $('[data-sel]', v)?.dispatchEvent(new Event('change')); onPick?.(); };
  $$('[data-citysel]', v).forEach((cb) => (cb.onchange = () => {
    $$(`[data-sel][data-city="${CSS.escape(cb.dataset.citysel)}"]`, v).filter((x) => !x.disabled).forEach((x) => (x.checked = cb.checked));
    $$(`[data-colsel][data-colcity="${CSS.escape(cb.dataset.citysel)}"]`, v).forEach((x) => (x.checked = cb.checked));
    changed();
  }));
  $$('[data-colsel]', v).forEach((cb) => (cb.onchange = () => {
    $$(`[data-sel][data-city="${CSS.escape(cb.dataset.colcity)}"][data-col="${CSS.escape(cb.dataset.colsel)}"]`, v).filter((x) => !x.disabled).forEach((x) => (x.checked = cb.checked));
    changed();
  }));
  // los N más cercanos a lo ya marcado (o desde el primero de la lista)
  $('#nearGo', v)?.addEventListener('click', () => {
    const n = Math.max(1, Number($('#nearN', v).value) || 0);
    const all = $$('[data-sel]', v).filter((x) => !x.disabled && x.dataset.lat);
    let sel = all.filter((x) => x.checked);
    let extra = n;
    if (!sel.length) { const first = all[0]; if (!first) return toast('No hay pedidos con ubicación para seleccionar', 'bad'); first.checked = true; sel = [first]; extra = n - 1; }
    const pts = sel.map((x) => [Number(x.dataset.lat), Number(x.dataset.lng)]);
    const kx = Math.cos((pts[0][0] * Math.PI) / 180);
    const dist = (x) => Math.min(...pts.map(([la, ln]) => ((Number(x.dataset.lng) - ln) * kx) ** 2 + (Number(x.dataset.lat) - la) ** 2));
    all.filter((x) => !x.checked).sort((a, b) => dist(a) - dist(b)).slice(0, extra).forEach((x) => (x.checked = true));
    changed();
    toast(`${$$('[data-sel]', v).filter((x) => x.checked).length} pedidos seleccionados (los más cercanos entre sí)`, 'ok');
  });
}

async function bulkAssign(v, kind) {
  const boxes = () => $$(`[data-sel]`, v).filter((c) => !c.disabled);
  const picked = () => boxes().filter((c) => c.checked).map((c) => Number(c.dataset.sel));
  let bar = $('#bulkBar', v);
  if (!bar) { v.insertAdjacentHTML('beforeend', '<div id="bulkBar" class="bulk-bar" hidden></div>'); bar = $('#bulkBar', v); }
  let drivers = null;
  const draw = async () => {
    const ids = picked();
    const all = $('#selAll', v);
    if (all) { all.checked = ids.length && ids.length === boxes().length; all.indeterminate = ids.length > 0 && ids.length < boxes().length; }
    bar.hidden = !ids.length;
    if (!ids.length) return;
    if (!drivers) {
      drivers = (await GET('/api/users?role=repartidor')).filter((d) => d.active);
      // el despachador o admin puede asignarse a sí mismo (primera opción)
      if (store.user.role !== 'repartidor') { drivers = drivers.filter((d) => d.id !== store.user.id); drivers.unshift({ id: store.user.id, name: `Yo (${store.user.name})`, self: true }); }
    }
    const prev = { d: $('#bkDrv', bar)?.value, f: $('#bkDate', bar)?.value, multi: $('#bkMulti', bar)?.checked, t: $('#bkTo', bar)?.value, pd: $('#bkPer', bar)?.value, sun: $('#bkSun', bar)?.checked ?? true };
    bar.innerHTML = `<b>${ids.length} ${kind === 'customers' ? 'cliente' : 'pedido'}${ids.length === 1 ? '' : 's'}</b>
      <select id="bkDrv"><option value="">Asignar a…</option>${drivers.map((d) => `<option value="${d.id}">${esc(d.name)}${d.vehicle ? ' · ' + esc(d.vehicle) : ''}</option>`).join('')}</select>
      <input type="date" id="bkDate" value="${prev.f || today()}" title="Fecha de la ruta (o inicio del rango)" />
      <label class="row" style="gap:4px" title="Reparte los pedidos en varios días, por zonas cercanas"><input type="checkbox" id="bkMulti" ${prev.multi ? 'checked' : ''} /> Varios días</label>
      <span id="bkRange" class="row" style="gap:6px" ${prev.multi ? '' : 'hidden'}><small>hasta</small><input type="date" id="bkTo" value="${prev.t || (() => { const d = new Date(); d.setDate(d.getDate() + 4); return d.toLocaleDateString('en-CA'); })()}" />
        <input type="number" id="bkPer" min="1" placeholder="Por día" title="Pedidos por día (vacío = repartir parejo)" value="${prev.pd || ''}" style="width:90px" />
        <label class="row" style="gap:4px"><input type="checkbox" id="bkSun" ${prev.sun ? 'checked' : ''} /> Sin domingos</label></span>
      <button class="btn primary" id="bkGo">${icon('truck')} Asignar</button>
      <button class="btn" id="bkSched" title="Cambia la fecha de entrega de lo marcado a la fecha elegida. Si ya tienen repartidor, pasan a su ruta de ese día">📅 Programar fecha</button>
      <span class="bulk-sep"></span>
      <select id="bkSt"><option value="">Cambiar estado…</option><option value="pendiente">Pendiente (quitar de ruta / reprogramar)</option><option value="fallido">Fallido (intento no exitoso)</option>${store.user.role === 'admin' ? '<option value="entregado">Entregado (registro manual)</option>' : ''}<option value="cancelado">Cancelado</option></select>
      <button class="btn" id="bkStGo">Aplicar</button>
      <button class="btn ghost" id="bkClr">Quitar selección</button>`;
    $('#bkStGo', bar).onclick = () => bulkStatus($('#bkSt', bar).value, kind, picked());
    $('#bkSched', bar).onclick = async (e) => {
      const btn = e.currentTarget;
      const d = $('#bkDate', bar).value;
      if (!d) return toast('Elige la fecha', 'bad');
      const n = picked().length;
      if (!(await confirmDlg(`¿Programar ${n} ${kind === 'customers' ? 'cliente(s) (sus pedidos abiertos)' : 'pedido(s)'} para el ${new Date(d + 'T12:00:00').toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })}? Los que no tienen repartidor solo cambian de fecha; los que ya tienen pasan a su ruta de ese día.`))) return;
      btn.disabled = true;
      try {
        const r = await POST('/api/orders/bulk-schedule', { date: d, [kind === 'customers' ? 'customer_ids' : 'order_ids']: picked() });
        toast(`${r.moved} pedido(s) programados para el ${d}${r.skipped.length ? ` · ${r.skipped.length} no se movieron` : ''}`, r.skipped.length ? '' : 'ok');
        if (r.skipped.length) modal('Pedidos que no se movieron', `<div class="table-wrap"><table><tbody>${r.skipped.map((x) => `<tr><td class="mono">${esc(x.tracking_code)}</td><td>${esc(x.reason)}</td></tr>`).join('')}</tbody></table></div>`, { footer: '<button class="btn primary" data-close>Entendido</button>', onClose: () => render() });
        else render();
      } catch (er) { toast(er.message, 'bad'); btn.disabled = false; }
    };
    if (prev.d) $('#bkDrv', bar).value = prev.d;
    $('#bkMulti', bar).onchange = (e) => { $('#bkRange', bar).hidden = !e.target.checked; };
    $('#bkClr', bar).onclick = () => { boxes().forEach((c) => (c.checked = false)); draw(); };
    $('#bkGo', bar).onclick = async (e) => {
      const btn = e.currentTarget; // después de un await, e.currentTarget ya es null
      const drv = $('#bkDrv', bar);
      if (!drv.value) return toast('Elige el repartidor', 'bad');
      const name = drv.selectedOptions[0].text.split(' · ')[0];
      const n = picked().length;
      if ($('#bkMulti', bar).checked) {
        const from = $('#bkDate', bar).value, to = $('#bkTo', bar).value, per = Number($('#bkPer', bar).value) || null;
        if (!(await confirmDlg(`¿Programar ${n} ${kind === 'customers' ? 'cliente(s) (sus pedidos abiertos)' : 'pedido(s)'} con ${name} del ${from} al ${to}${per ? `, ${per} por día` : ', repartidos parejo'}${$('#bkSun', bar).checked ? ', sin domingos' : ''}? Se agrupan por cercanía: cada día queda en una zona.`))) return;
        btn.disabled = true;
        try {
          const r = await POST('/api/routes/assign-range', { driver_id: drv.value, date_from: from, date_to: to, per_day: per, skip_sunday: $('#bkSun', bar).checked, [kind === 'customers' ? 'customer_ids' : 'order_ids']: picked() });
          if (Number(drv.value) === store.user.id && !store.user.can_deliver) { store.user = { ...store.user, can_deliver: 1 }; setTimeout(() => toast('Te asignaste pedidos: usa el botón "Modo repartidor" para verlos en tu ruta y entregarlos', ''), 1500); }
          modal(`Programación de ${esc(r.driver)}`, `<p style="margin-top:0">${r.assigned} pedido(s) programados · ${r.per_day} por día${r.not_scheduled ? ` · <b style="color:var(--warn)">${r.not_scheduled} no cupieron en el rango</b> (siguen pendientes)` : ''}</p>
            <div class="table-wrap"><table><thead><tr><th>Día</th><th class="r">Pedidos</th><th></th></tr></thead><tbody>${r.days.map((d) => `<tr><td>${new Date(d.date + 'T12:00:00').toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'short' })}</td><td class="r num"><b>${d.assigned}</b></td><td><small class="muted">${d.unlocated ? d.unlocated + ' sin ubicación' : ''}</small></td></tr>`).join('')}</tbody></table></div>
            ${r.skipped.length ? `<h3>No se movieron</h3><div class="table-wrap"><table><tbody>${r.skipped.map((x) => `<tr><td class="mono">${esc(x.tracking_code)}</td><td>${esc(x.reason)}</td></tr>`).join('')}</tbody></table></div>` : ''}`,
            { footer: '<button class="btn primary" data-close>Entendido</button>', onClose: () => render() });
        } catch (er) { toast(er.message, 'bad'); btn.disabled = false; }
        return;
      }
      if (!(await confirmDlg(`¿Asignar ${n} ${kind === 'customers' ? 'cliente(s) (sus pedidos abiertos)' : 'pedido(s)'} a ${name} para el ${$('#bkDate', bar).value}? Se agregan a su ruta y se reordenan las paradas.`))) return;
      btn.disabled = true;
      try {
        const body = { driver_id: drv.value, date: $('#bkDate', bar).value, [kind === 'customers' ? 'customer_ids' : 'order_ids']: picked() };
        const r = await POST('/api/routes/assign', body);
        if (Number(drv.value) === store.user.id && !store.user.can_deliver) { store.user = { ...store.user, can_deliver: 1 }; setTimeout(() => toast('Te asignaste pedidos: usa el botón "Modo repartidor" para verlos en tu ruta y entregarlos', ''), 1500); }
        toast(`${r.assigned} pedido(s) asignados a ${r.driver}${r.skipped.length ? ` · ${r.skipped.length} no se movieron` : ''}${r.unlocated ? ` · ${r.unlocated} sin ubicación en el mapa` : ''}`, r.skipped.length ? '' : 'ok');
        if (r.skipped.length) {
          const m = modal('Pedidos que no se movieron', `<div class="table-wrap"><table><tbody>${r.skipped.map((x) => `<tr><td class="mono">${esc(x.tracking_code)}</td><td>${esc(x.reason)}</td></tr>`).join('')}</tbody></table></div>`, { footer: '<button class="btn primary" data-close>Entendido</button>', onClose: () => render() });
          void m;
        } else render();
      } catch (er) { toast(er.message, 'bad'); btn.disabled = false; }
    };
  };
  $$('[data-sel]', v).forEach((c) => { c.onclick = (e) => e.stopPropagation(); c.onchange = draw; });
  $('#selAll', v)?.addEventListener('change', (e) => { boxes().forEach((c) => (c.checked = e.target.checked)); draw(); });
  v.bulkPicked = picked;
}

// Cambiar el estado de un pedido desde cualquier pantalla: elegir el estado y luego sus datos (motivo, quién recibió…)
function statusPicker(order, onDone) {
  const admin = store.user.role === 'admin';
  const opts = [['pendiente', 'Pendiente', 'Quitar de la ruta / reprogramar'], ['fallido', 'Fallido', 'Intento no exitoso, con motivo'],
    ...(admin ? [['entregado', 'Entregado', 'Registro manual (sin foto ni firma)']] : []), ['cancelado', 'Cancelado', 'Regresa la pieza al inventario']]
    .filter(([k]) => k !== order.status);
  const m = modal(`Estado del pedido ${order.tracking_code}`, `<p style="margin-top:0">Estado actual: ${badge(order.status)}</p>
    <div class="stack">${opts.map(([k, l, d]) => `<button class="btn block" data-st="${k}" style="justify-content:flex-start;text-align:left"><span><b>${l}</b><br><small class="muted">${d}</small></span></button>`).join('')}</div>`,
    { footer: '<button class="btn" data-close>Cerrar</button>' });
  $$('[data-st]', m.el).forEach((b) => (b.onclick = () => { m.close(); bulkStatus(b.dataset.st, 'orders', [order.id], onDone); }));
}
function bulkStatus(status, kind, ids, onDone) {
  if (!status) return toast('Elige el nuevo estado', 'bad');
  if (!ids.length) return;
  const what = `${ids.length} ${kind === 'customers' ? `cliente${ids.length === 1 ? '' : 's'} (sus pedidos activos)` : `pedido${ids.length === 1 ? '' : 's'}`}`;
  const T = {
    pendiente: ['Regresar a pendiente', `Los pedidos de ${what} salen de su ruta y quedan pendientes para volver a asignarse.`],
    fallido: ['Registrar intento fallido', `Se registra un intento no exitoso para ${what}.`],
    entregado: ['Registrar entrega manual', `Se marcan como entregados ${what}. Úsalo cuando la entrega ocurrió y no se registró en la app (puedes adjuntar la foto que te mandó el repartidor); queda en la bitácora con tu nombre.`],
    cancelado: ['Cancelar pedidos', `Se cancelan los pedidos de ${what}. Las piezas regresan al inventario y se liberan los números de serie.`],
  }[status];
  const m = modal(T[0], `<form id="bsF" class="stack"><p style="margin:0">${T[1]}</p>
    ${status === 'pendiente' ? `<label class="f"><span>Nueva fecha de entrega <small class="muted">(opcional)</small></span><input type="date" name="date" /></label>` : ''}
    ${status === 'fallido' ? `<label class="f">Motivo *<select name="reason" required>${FAIL_REASONS.map((r) => `<option>${esc(r)}</option>`).join('')}</select></label>` : ''}
    ${status === 'entregado' ? `<label class="f">¿Quién recibió? *<input name="receiver_name" required placeholder="Nombre de quien recibió" /></label>` : ''}
    ${['fallido', 'entregado'].includes(status) ? `<div><label class="btn block">${icon('camera')} Adjuntar foto de evidencia <small class="muted">(opcional)</small><input type="file" accept="image/*" id="bsPhoto" hidden /></label><img id="bsPrev" class="photo-prev" hidden alt="Foto" /></div>
      <label class="f">Nota<input name="note" maxlength="300" placeholder="Detalle para la bitácora" /></label>
      <label class="row"><input type="checkbox" name="notify" /> Avisar a los clientes (WhatsApp / SMS / correo según la configuración)</label>` : ''}</form>`,
    { footer: `<button class="btn" data-close>Volver</button><button class="btn ${status === 'cancelado' ? 'bad' : 'primary'}" id="bsGo">${T[0]}</button>` });
  let bsPhoto = null;
  $('#bsPhoto', m.el)?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    bsPhoto = await compressImage(file, 1600, 0.8);
    $('#bsPrev', m.el).src = bsPhoto; $('#bsPrev', m.el).hidden = false;
  });
  $('#bsGo', m.el).onclick = async (e) => {
    const f = $('#bsF', m.el);
    if (!f.reportValidity()) return;
    const btn = e.currentTarget;
    const fd = Object.fromEntries(new FormData(f));
    if (bsPhoto) fd.photo = bsPhoto;
    btn.disabled = true;
    try {
      const r = await POST('/api/orders/bulk-status', { status, ...fd, notify: !!f.notify?.checked, [kind === 'customers' ? 'customer_ids' : 'order_ids']: ids });
      toast(`${r.changed} pedido(s) ahora están ${STATUS[status].toLowerCase()}${r.skipped.length ? ` · ${r.skipped.length} no cambiaron` : ''}`, r.skipped.length ? '' : 'ok');
      m.close();
      const after = () => (onDone ? onDone(r) : render());
      if (r.skipped.length) modal('Pedidos que no cambiaron', `<div class="table-wrap"><table><tbody>${r.skipped.map((x) => `<tr><td class="mono">${esc(x.tracking_code)}</td><td>${esc(x.reason)}</td></tr>`).join('')}</tbody></table></div>`, { footer: '<button class="btn primary" data-close>Entendido</button>', onClose: after });
      else after();
    } catch (er) { toast(er.message, 'bad'); btn.disabled = false; }
  };
}

// ================= Selección de entregas en el mapa (lazo o toque) =================
// Solo se pueden mover las que aún no salen: pendientes o asignadas (no cargadas, entregadas ni fallidas).
function mapSelection(v, map, pins, drivers, date) {
  const movable = pins.filter((p) => ['pendiente', 'asignado'].includes(p.s.status));
  const sel = new Set();
  let mode = null;
  const bar = $('#mapSelBar', v);
  const box = map.getContainer();
  const mark = (p, on) => { if (p.mk._icon) p.mk._icon.classList.toggle('pin-sel', on); };
  const draw = () => {
    movable.forEach((p) => mark(p, sel.has(p.s.id)));
    $('#selClear', v).hidden = !sel.size;
    bar.hidden = !sel.size;
    if (!sel.size) return;
    const act = drivers.filter((d) => d.active);
    const prev = { d: $('#msDrv', bar)?.value, f: $('#msDate', bar)?.value };
    const list = movable.filter((p) => sel.has(p.s.id));
    const from = [...new Set(list.map((p) => p.s.driver_name || 'sin ruta'))];
    bar.innerHTML = `<b>${sel.size} entrega${sel.size === 1 ? '' : 's'}</b><small class="muted">${esc(from.join(', '))}</small>
      <select id="msDrv"><option value="">Asignar a…</option>${act.map((d) => `<option value="${d.id}">${esc(d.name)}${d.vehicle ? ' · ' + esc(d.vehicle) : ''}</option>`).join('')}</select>
      <input type="date" id="msDate" value="${prev.f || date}" />
      <button class="btn primary" id="msGo">${icon('route')} Asignar y optimizar</button>`;
    if (prev.d) $('#msDrv', bar).value = prev.d;
    $('#msGo', bar).onclick = async (e) => {
      const btn = e.currentTarget;
      const drv = $('#msDrv', bar);
      if (!drv.value) return toast('Elige el repartidor', 'bad');
      btn.disabled = true;
      try {
        const r = await POST('/api/routes/assign', { driver_id: drv.value, date: $('#msDate', bar).value, order_ids: [...sel] });
        toast(`${r.assigned} entrega(s) a ${r.driver}; ruta optimizada${r.skipped.length ? ` · ${r.skipped.length} no se movieron` : ''}`, r.skipped.length ? '' : 'ok');
        render();
      } catch (er) { toast(er.message, 'bad'); btn.disabled = false; }
    };
  };
  const setMode = (m) => {
    mode = mode === m ? null : m;
    $('#selLasso', v).classList.toggle('primary', mode === 'lasso');
    $('#selTap', v).classList.toggle('primary', mode === 'tap');
    box.classList.toggle('lasso-on', mode === 'lasso');
    if (mode === 'lasso') { map.dragging.disable(); map.closePopup(); } else map.dragging.enable();
    $('#selHint', v).textContent = mode === 'lasso' ? 'Encierra con el dedo o el ratón las entregas que quieras (puedes dibujar varias zonas).'
      : mode === 'tap' ? 'Toca cada pin para agregarlo o quitarlo.' : 'Selecciona entregas en el mapa para asignarlas y optimizar su ruta.';
  };
  $('#selLasso', v).onclick = () => setMode('lasso');
  $('#selTap', v).onclick = () => setMode('tap');
  $('#selClear', v).onclick = () => { sel.clear(); draw(); };
  // tocar pines
  for (const p of movable) p.mk.on('click', (e) => {
    if (mode !== 'tap') return;
    e.target.closePopup();
    sel.has(p.s.id) ? sel.delete(p.s.id) : sel.add(p.s.id);
    draw();
  });
  // lazo: se dibuja con el puntero y se toman los pines que quedan adentro
  const inside = (pt, poly) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = [poly[i].lng, poly[i].lat], [xj, yj] = [poly[j].lng, poly[j].lat];
      if (yi > pt.lat !== yj > pt.lat && pt.lng < ((xj - xi) * (pt.lat - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  let path = null, line = null;
  box.addEventListener('pointerdown', (e) => {
    if (mode !== 'lasso' || e.button > 0) return;
    e.preventDefault(); e.stopPropagation();
    box.setPointerCapture?.(e.pointerId);
    path = [map.mouseEventToLatLng(e)];
    line = L.polyline(path, { color: '#ef7d2d', weight: 3, dashArray: '6 6' }).addTo(map);
  }, true);
  box.addEventListener('pointermove', (e) => {
    if (!path) return;
    e.preventDefault();
    path.push(map.mouseEventToLatLng(e));
    line.setLatLngs(path);
  }, true);
  const finish = () => {
    if (!path) return;
    const poly = path; path = null;
    map.removeLayer(line); line = null;
    if (poly.length < 3) return;
    const shape = L.polygon(poly, { color: '#ef7d2d', weight: 2, fillOpacity: 0.08 }).addTo(map);
    setTimeout(() => map.removeLayer(shape), 1200);
    let n = 0;
    for (const p of movable) if (inside(p.mk.getLatLng(), poly) && !sel.has(p.s.id)) { sel.add(p.s.id); n++; }
    const skipped = pins.filter((p) => !movable.includes(p) && inside(p.mk.getLatLng(), poly)).length;
    toast(`${n} entrega(s) agregadas${skipped ? ` · ${skipped} ya cargadas o cerradas no se pueden mover` : ''}`, n ? 'ok' : '');
    draw();
  };
  box.addEventListener('pointerup', finish, true);
  box.addEventListener('pointercancel', finish, true);
}

// ================= Almacenes y existencias =================
async function fillWarehouseSelect(sel, { located = false } = {}) {
  try {
    const ws = (await GET('/api/warehouses')).filter((w) => w.active && (!located || w.lat != null));
    sel.innerHTML = ws.map((w) => `<option value="${w.id}" ${w.is_default ? 'selected' : ''}>${esc(w.name)}${w.is_default ? ' (principal)' : ''}</option>`).join('');
  } catch {}
}
function stockBreakdown(bd) {
  const whs = bd.warehouses.filter((w) => w.active);
  modal('Existencias: dónde está cada unidad', `<p class="muted" style="margin-top:0">Para equipos con número de serie se cuenta cada equipo por almacén. "Apartado" son unidades ya comprometidas en pedidos abiertos.</p>
    <div class="table-wrap"><table><thead><tr><th>Producto</th>${whs.map((w) => `<th class="r">${esc(w.name)}</th>`).join('')}<th class="r">Con repartidores</th><th class="r">🔓 Abierto</th><th class="r"><b>Total</b></th><th class="r">Apartado en pedidos</th></tr></thead><tbody>
    ${bd.products.map((p) => `<tr><td><b>${esc(p.name)}</b><br><small class="muted">${esc(p.sku)}${p.serialized ? ' · S/N' : ''}</small></td>
      ${whs.map((w, i) => `<td class="r num">${p.warehouses ? p.warehouses.find((x) => x.id === w.id)?.n || 0 : i === 0 ? `${p.in_warehouses}<br><small class="muted">sin desglose</small>` : '—'}</td>`).join('')}
      <td class="r num">${p.drivers}</td><td class="r num">${p.open}</td><td class="r num"><b>${p.total}</b></td><td class="r num">${p.reserved}</td></tr>`).join('')}
    </tbody></table></div>
    <small class="muted">Los productos sin número de serie se llevan como una sola existencia (se muestran en el almacén principal).</small>`, { wide: true, footer: '<button class="btn primary" data-close>Cerrar</button>' });
}
function warehouseForm(w) {
  w = w || {};
  const m = modal(w.id ? `Editar ${w.name}` : 'Nueva oficina / almacén', `<form id="whF" class="stack">
    <div class="grid g3"><label class="f">Nombre *<input name="name" required value="${esc(w.name)}" placeholder="Oficina Mexicali" /></label><label class="f">Ciudades que atiende<input name="city" value="${esc(w.city)}" placeholder="Mexicali, San Luis Río Colorado" /></label><label class="f">Encargado<input name="manager" value="${esc(w.manager)}" /></label></div>
    <small class="muted">Separa las ciudades con comas. Los clientes nuevos de esas ciudades quedan automáticamente en esta oficina.</small>
    <div class="grid g2"><label class="f">Domicilio de la oficina<div class="row"><input name="address" class="grow" value="${esc(w.address)}" placeholder="Calle, número, colonia" /><button type="button" class="btn" id="whGeo">${icon('live')} Ubicar</button></div></label><label class="f">Teléfono<input name="phone" type="tel" value="${esc(w.phone)}" /></label></div>
    <small class="muted">Escribe el domicilio y toca <b>Ubicar</b>, o toca el mapa para fijar el punto exacto. Es la referencia de los mapas de esta oficina y el punto de salida de las rutas de sus repartidores.</small>
    <div id="whMap" class="map sm"></div><small class="muted num" id="whCoords">${w.lat ? `${w.lat.toFixed(5)}, ${w.lng.toFixed(5)}` : 'Sin ubicación'}</small>
    <input type="hidden" name="lat" value="${w.lat ?? ''}" /><input type="hidden" name="lng" value="${w.lng ?? ''}" />
    ${w.id ? `<label class="row"><input type="checkbox" name="is_default" ${w.is_default ? 'checked disabled' : ''} /> Almacén principal (punto de salida por omisión)</label>
      ${w.is_default ? '' : `<label class="row"><input type="checkbox" name="active" ${w.active ? 'checked' : ''} /> Activo</label>`}` : ''}</form>`,
    { footer: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="whSave">Guardar</button>' });
  const f = $('#whF', m.el);
  const map = makeMap($('#whMap', m.el), w.lat ? [w.lat, w.lng] : null, w.lat ? 15 : 12);
  let mk = w.lat ? L.marker([w.lat, w.lng]).addTo(map) : null;
  const setWh = (ll, zoom) => { f.lat.value = ll.lat.toFixed(6); f.lng.value = ll.lng.toFixed(6); $('#whCoords', m.el).textContent = `${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}`; if (mk) mk.setLatLng(ll); else mk = L.marker(ll).addTo(map); if (zoom) map.setView(ll, 16); };
  map.on('click', (e) => setWh(e.latlng));
  $('#whGeo', m.el).onclick = async () => {
    const q = [f.address.value, f.city.value, 'Baja California'].filter((x) => String(x).trim()).join(', ');
    if (!f.address.value.trim()) return toast('Escribe el domicilio', 'bad');
    try {
      const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=mx&q=' + encodeURIComponent(q)).then((r) => r.json());
      if (r[0]) { setWh({ lat: Number(r[0].lat), lng: Number(r[0].lon) }, true); toast('Ubicado: revisa el punto y ajústalo tocando el mapa si hace falta', 'ok'); }
      else toast('No se encontró el domicilio: toca el mapa para marcarlo', 'bad');
    } catch { toast('Geocodificador no disponible: toca el mapa para marcarlo', 'bad'); }
  };
  setTimeout(() => map.invalidateSize(), 200);
  $('#whSave', m.el).onclick = async () => {
    if (!f.reportValidity()) return;
    const b = Object.fromEntries(new FormData(f));
    if (w.id) { b.is_default = !!f.is_default?.checked && !w.is_default; if (!w.is_default) b.active = !!f.active?.checked; }
    try { if (w.id) await PUT('/api/warehouses/' + w.id, b); else await POST('/api/warehouses', b); toast('Almacén guardado', 'ok'); m.close(); render(); }
    catch (e) { toast(e.message, 'bad'); }
  };
}
// Traspaso entre almacenes: origen → destino, elegir equipos (lista, búsqueda, pegar o escanear) y referencia
async function transferDialog(whs, fromId) {
  const act = whs.filter((w) => w.active);
  const mine = store.user.role === 'admin' ? null : (await GET('/api/offices').catch(() => []))[0]?.id;
  if (mine) fromId = mine;
  if (act.length < 2) return toast('Da de alta otro almacén para poder hacer traspasos', 'bad');
  const opt = (sel) => act.map((w) => `<option value="${w.id}" ${w.id === sel ? 'selected' : ''}>${esc(w.name)}${w.is_default ? ' (principal)' : ''}</option>`).join('');
  const from0 = fromId || (act.find((w) => w.is_default) || act[0]).id;
  const to0 = (act.find((w) => w.id !== from0) || {}).id;
  const m = modal('Traspaso entre almacenes', `<div class="stack">
    <div class="grid g2"><label class="f">Sale de<select id="xFrom" ${mine ? 'disabled' : ''}>${opt(from0)}</select></label><label class="f">Entra a<select id="xTo">${opt(to0)}</select></label></div>
    <label class="f">Referencia<input id="xRef" maxlength="80" placeholder="Ej. Traspaso del ${today()}, vale, quién lo lleva…" /></label>
    <div class="row"><input id="xQ" class="grow" placeholder="Buscar S/N o producto" autocomplete="off" /><button class="btn sm primary" id="xAll">${icon('check')} Seleccionar todo</button><button class="btn sm" id="xNone">Quitar selección</button><button class="btn sm" id="xScan">${icon('scan')} Escanear</button></div>
    <div class="table-wrap" style="max-height:300px" id="xList"><p class="muted">Cargando…</p></div>
    <label class="f">…o pega los números de serie (uno por línea)<textarea id="xPaste" rows="3" placeholder="HWTCDE658DM1003&#10;HWTCDE659AM1196"></textarea></label>
    <details><summary class="muted">Traspasos recientes</summary><div id="xHist" class="table-wrap" style="max-height:220px"></div></details>
  </div>`, { wide: true, footer: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="xGo">Traspasar</button>', onClose: () => render() });
  const $m = (s) => $(s, m.el);
  excelSerialsInto($m('#xPaste'));
  const picked = new Set();
  let rows = [];
  const count = () => {
    const extra = $m('#xPaste').value.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean).length;
    const n = picked.size + extra;
    $m('#xGo').textContent = n ? `Traspasar ${n} equipo${n === 1 ? '' : 's'}` : 'Traspasar';
  };
  const draw = () => {
    const q = $m('#xQ').value.trim().toLowerCase();
    const vis = rows.filter((s) => !q || (s.serial + ' ' + s.product_name).toLowerCase().includes(q));
    $m('#xList').innerHTML = rows.length ? `<table><thead><tr><th style="width:30px"></th><th>S/N</th><th>Producto</th><th>Pedido</th></tr></thead><tbody>${vis.map((s) => `<tr><td><input type="checkbox" data-x="${esc(s.serial)}" ${picked.has(s.serial) ? 'checked' : ''} /></td><td class="mono">${esc(s.serial)}</td><td><small>${esc(s.product_name)}</small></td><td><small class="muted">${s.tracking_code ? esc(s.tracking_code) : 'Libre'}</small></td></tr>`).join('') || '<tr><td colspan="4" class="muted">Nada coincide con la búsqueda</td></tr>'}</tbody></table><small class="muted" id="xSum">${rows.length} equipos en este almacén · ${picked.size} seleccionados</small>`
      : '<p class="muted">Este almacén no tiene equipos con S/N.</p>';
    $$('[data-x]', m.el).forEach((c) => (c.onchange = () => { c.checked ? picked.add(c.dataset.x) : picked.delete(c.dataset.x); const sm = $m('#xSum'); if (sm) sm.textContent = `${rows.length} equipos en este almacén · ${picked.size} seleccionados`; count(); }));
    count();
  };
  const load = async () => { picked.clear(); $m('#xList').innerHTML = '<p class="muted">Cargando…</p>'; rows = await GET(`/api/warehouses/${$m('#xFrom').value}/serials`); draw(); };
  const hist = async () => {
    const h = await GET('/api/warehouse-transfers').catch(() => []);
    $m('#xHist').innerHTML = h.length ? `<table><tbody>${h.map((x) => `<tr><td><small>${fmtDT(x.created_at)}</small><br><small class="muted">${esc(x.user_name || '')}</small></td><td><b>${esc(x.detail)}</b><br><small class="mono muted">${esc(x.serials.length > 120 ? x.serials.slice(0, 120) + '…' : x.serials)}</small></td><td class="r num"><b>${x.n}</b></td></tr>`).join('')}</tbody></table>` : '<p class="muted">Aún no hay traspasos.</p>';
  };
  $m('#xFrom').onchange = () => { if ($m('#xFrom').value === $m('#xTo').value) $m('#xTo').value = String((act.find((w) => String(w.id) !== $m('#xFrom').value) || {}).id); load(); };
  $m('#xTo').onchange = () => { if ($m('#xFrom').value === $m('#xTo').value) toast('Elige un almacén de destino distinto al de origen', 'bad'); };
  $m('#xQ').oninput = draw;
  $m('#xPaste').oninput = count;
  $m('#xAll').onclick = () => { const q = $m('#xQ').value.trim().toLowerCase(); rows.filter((s) => !q || (s.serial + ' ' + s.product_name).toLowerCase().includes(q)).forEach((s) => picked.add(s.serial)); draw(); };
  $m('#xNone').onclick = () => { picked.clear(); draw(); };
  $m('#xScan').onclick = () => openScanner({ title: 'Escanear equipos a traspasar', continuous: true, onCode: async (c) => {
    const sn = c.trim().replace(/^S\/?N[:\s]*/i, '').toUpperCase();
    const hit = rows.find((s) => s.serial.toUpperCase() === sn);
    if (!hit) throw new Error(`${sn} no está en ${$m('#xFrom').selectedOptions[0].text}`);
    picked.add(hit.serial); draw(); return hit.product_name;
  } });
  $m('#xGo').onclick = async (e) => {
    const btn = e.currentTarget;
    const from = $m('#xFrom'), to = $m('#xTo');
    if (from.value === to.value) return toast('El almacén de origen y el de destino son el mismo', 'bad');
    const serials = [...picked, ...$m('#xPaste').value.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean)];
    if (!serials.length) return toast('Marca, escanea o pega los equipos a traspasar', 'bad');
    if (!(await confirmDlg(`¿Traspasar ${serials.length} equipo(s) de ${from.selectedOptions[0].text} a ${to.selectedOptions[0].text}?`))) return;
    btn.disabled = true;
    try {
      const r = await POST(`/api/warehouses/${to.value}/transfer`, { serials, from_id: Number(from.value), reference: $m('#xRef').value });
      toast(`${r.moved} equipo(s) traspasados a ${to.selectedOptions[0].text}`, r.moved ? 'ok' : 'bad');
      if (r.errors.length) modal('Equipos que no se traspasaron', `<div class="table-wrap"><table><tbody>${r.errors.map((x) => `<tr><td class="mono">${esc(x.serial)}</td><td>${esc(x.error)}</td></tr>`).join('')}</tbody></table></div>`, { footer: '<button class="btn primary" data-close>Entendido</button>' });
      $m('#xPaste').value = ''; btn.disabled = false; await load(); hist();
    } catch (er) { toast(er.message, 'bad'); btn.disabled = false; }
  };
  load(); hist();
}
// ================= Oficinas foráneas por ciudad =================
async function viewOffices(v) {
  const offs = await GET('/api/offices');
  const admin = store.user.role === 'admin';
  v.innerHTML = topbar('Oficinas', `${offs.filter((o) => o.active).length > 1 ? `<button class="btn" id="ofXfer">${icon('truck')} Traspaso entre oficinas</button>` : ''}${admin ? `<button class="btn primary" id="ofNew">${icon('plus')} Nueva oficina</button>` : ''}`,
    'Cada oficina atiende una ciudad: tiene su inventario, sus clientes finales y su personal.') + `
  <div class="grid g3">${offs.map((o) => `<a class="card kpi-btn" href="#/offices/${o.id}" style="text-align:left;padding:14px;text-decoration:none;color:inherit;${o.active ? '' : 'opacity:.55'}">
      <div class="row between"><b style="font-size:17px">${esc(o.name)}</b>${o.is_default ? '<span class="chip ok">Principal</span>' : ''}${o.active ? '' : '<span class="chip off">Inactiva</span>'}</div>
      <small class="muted">${icon('live')} ${esc(o.city || 'Sin ciudad')}${o.manager ? ' · ' + esc(o.manager) : ''}</small>
      <br><small class="muted">${o.address ? esc(o.address) : ''}${o.lat ? '' : `${o.address ? ' · ' : ''}<span style="color:var(--warn)">sin ubicación en el mapa</span>`}</small>
      <div style="margin-top:6px">${o.supervisor_name ? `<span class="chip ok">${icon('shield')} Supervisor: ${esc(o.supervisor_name)}</span>` : '<span class="chip warn">Sin supervisor operativo</span>'}</div>
      <div class="grid g2" style="margin-top:10px;gap:8px">
        <div><small class="muted">Equipos</small><div class="num" style="font-size:20px;font-weight:700">${fmtN(o.units)}</div></div>
        <div><small class="muted">Clientes</small><div class="num" style="font-size:20px;font-weight:700">${fmtN(o.customers)}</div></div>
        <div><small class="muted">Pedidos abiertos</small><div class="num" style="font-size:20px;font-weight:700;color:${o.open_orders ? 'var(--warn)' : 'inherit'}">${fmtN(o.open_orders)}</div></div>
        <div><small class="muted">Entregados este mes</small><div class="num" style="font-size:20px;font-weight:700;color:var(--ok)">${fmtN(o.delivered_month)}</div></div>
      </div>
      <small class="muted">${icon('users')} ${o.staff} persona${o.staff === 1 ? '' : 's'} · ver oficina ›</small></a>`).join('')}</div>`;
  $('#ofNew')?.addEventListener('click', () => warehouseForm(null));
  $('#ofXfer')?.addEventListener('click', async () => transferDialog(await GET('/api/warehouses')));
}

async function viewOffice(v, id) {
  const tab = new URLSearchParams(location.hash.split('?')[1] || '').get('tab') || 'inv';
  const [o, whs] = await Promise.all([GET('/api/offices/' + id), GET('/api/warehouses')]);
  const admin = store.user.role === 'admin';
  const others = whs.filter((w) => w.active && w.id !== id);
  const tabs = [['inv', 'Inventario', 'inv'], ['map', 'Mapa', 'live'], ['cli', 'Clientes', 'person'], ['ped', 'Pedidos', 'box'], ['per', 'Personal', 'users']];
  v.innerHTML = topbar(esc(o.name), `<a class="btn" href="#/offices">‹ Oficinas</a>${others.length ? `<button class="btn" id="ofX">${icon('truck')} Traspaso</button>` : ''}${admin ? `<button class="btn" id="ofEd">${icon('cog')} Editar</button>` : ''}`,
    `${o.city ? 'Atiende ' + esc(o.city) : 'Sin ciudad asignada'}${o.address ? ' · ' + esc(o.address) : ''}${o.manager ? ' · Encargado: ' + esc(o.manager) : ''}${o.phone ? ' · ' + esc(o.phone) : ''}`) + `
  <div class="card row between" style="margin-bottom:12px;padding:10px 14px"><span>${icon('shield')} <b>Supervisor operativo:</b> ${o.supervisor_name ? esc(o.supervisor_name) : '<span style="color:var(--warn)">sin asignar</span>'}</span>${admin ? `<button class="btn sm" id="ofSup">${o.supervisor_name ? 'Cambiar' : 'Asignar supervisor'}</button>` : ''}</div>
  <div class="row" style="gap:6px;margin-bottom:12px;flex-wrap:wrap">${tabs.map(([k, l, i]) => `<a class="btn ${k === tab ? 'primary' : ''}" href="#/offices/${id}?tab=${k}">${icon(i)} ${l}</a>`).join('')}</div>
  <div id="ofBody"><div class="card">Cargando…</div></div>`;
  $('#ofEd')?.addEventListener('click', () => warehouseForm(whs.find((w) => w.id === id)));
  $('#ofX')?.addEventListener('click', () => transferDialog(whs, id));
  $('#ofSup')?.addEventListener('click', () => officeSupervisor(o));
  const body = $('#ofBody');

  if (tab === 'inv') {
    const list = await GET(`/api/warehouses/${id}/serials`);
    const tot = o.inventory.reduce((a, x) => a + x.n, 0);
    body.innerHTML = `<div class="grid g-main">
      <div class="card"><div class="row between"><h2>Existencias</h2><small class="muted">${fmtN(tot)} equipos con S/N</small></div>
        <div class="table-wrap"><table><thead><tr><th>Producto</th><th class="r">En oficina</th><th class="r">Apartados en pedido</th><th class="r">Libres</th></tr></thead><tbody>
        ${o.inventory.map((p) => `<tr><td><b>${esc(p.name)}</b><br><small class="muted">${esc(p.sku || '')}</small></td><td class="r num"><b>${p.n}</b></td><td class="r num">${p.reserved}</td><td class="r num" style="color:var(--ok)">${p.n - p.reserved}</td></tr>`).join('')
          + o.plain.map((p) => `<tr><td><b>${esc(p.name)}</b><br><small class="muted">${esc(p.sku || '')} · sin S/N</small></td><td class="r num"><b>${p.n}</b></td><td class="r num">—</td><td class="r num">—</td></tr>`).join('')
          || '<tr><td colspan="4" class="muted">Esta oficina no tiene inventario. Usa <b>Traspaso</b> para enviarle equipos desde otra oficina.</td></tr>'}</tbody></table></div></div>
      <div class="card"><div class="row between"><h2>Números de serie</h2><small class="muted">${list.length}</small></div>
        <input id="ofSnQ" placeholder="Buscar S/N, producto o pedido" style="margin-bottom:8px" />
        <div class="table-wrap" style="max-height:520px"><table><tbody>${list.map((s) => `<tr data-r="${esc((s.serial + ' ' + s.product_name + ' ' + (s.tracking_code || '')).toLowerCase())}"><td class="mono">${esc(s.serial)}</td><td><small>${esc(s.product_name)}</small></td><td><small class="muted">${s.tracking_code ? 'Pedido ' + esc(s.tracking_code) : 'Libre'}</small></td></tr>`).join('') || '<tr><td class="muted">Sin equipos</td></tr>'}</tbody></table></div></div></div>`;
    $('#ofSnQ').oninput = (e) => { const q = e.target.value.toLowerCase().trim(); $$('tr[data-r]', body).forEach((r) => (r.hidden = !!q && !r.dataset.r.includes(q))); };
  }

  if (tab === 'map') {
    const r = await GET(`/api/customers?limit=200000&office_id=${id}`);
    const pts = r.rows.filter((c) => c.lat != null);
    const act = pts.filter((c) => c.active_orders).length;
    body.innerHTML = `<div class="card">
      ${o.lat ? '' : `<div class="offline-bar row between"><span>Esta oficina no tiene ubicación: el mapa usa la principal como referencia.</span>${admin ? '<button class="btn sm" id="ofLoc">Fijar domicilio</button>' : ''}</div>`}
      <div class="row between" style="margin-bottom:8px"><b>${icon('building')} ${esc(o.name)}${o.address ? ' · ' + esc(o.address) : ''}</b><small class="muted">${pts.length} clientes en el mapa · ${act} con pedido activo${r.total - pts.length ? ` · ${r.total - pts.length} sin ubicar` : ''}</small></div>
      <div id="ofMap" class="map tall"></div>
      <div class="legend" style="margin-top:8px"><span><i style="background:#1f2a44"></i>Oficina</span><span><i style="background:#e5612a"></i>Con pedido activo</span><span><i style="background:#1d5a96"></i>Sin pedido activo</span></div></div>`;
    $('#ofLoc')?.addEventListener('click', () => warehouseForm(whs.find((w) => w.id === id)));
    const ref = o.lat ? [o.lat, o.lng] : depotLatLng();
    const map = makeMap($('#ofMap'), ref, 13);
    if (o.lat) L.marker(ref, { icon: depotIcon() }).addTo(map).bindPopup(`<b>${esc(o.name)}</b><br>${esc(o.address || '')}`).openPopup();
    pts.forEach((c) => editableCustomerPin(map, L.circleMarker([c.lat, c.lng], { radius: 6, color: c.active_orders ? '#e5612a' : '#1d5a96', fillOpacity: 0.7 }).addTo(map),
      { id: c.id, name: c.name, address: c.address, extra: c.active_orders ? `<br>${c.active_orders} pedido(s) activo(s)` : '' }));
    if (r.total - pts.length) $('#ofMap').insertAdjacentHTML('beforebegin', `<div class="row" style="justify-content:flex-end;margin-bottom:6px"><button class="btn sm" id="ofUnl">${icon('live')} Ubicar ${r.total - pts.length} sin ubicación</button></div>`);
    $('#ofUnl')?.addEventListener('click', () => unlocatedCustomers(id));
    if (pts.length) map.fitBounds([ref, ...pts.map((c) => [c.lat, c.lng])], { padding: [24, 24], maxZoom: 15 });
  }

  if (tab === 'cli') {
    const q = new URLSearchParams(location.hash.split('?')[1] || '').get('q') || '';
    const r = await GET(`/api/customers?limit=200000&office_id=${id}&q=${encodeURIComponent(q)}`);
    body.innerHTML = `<div class="card">
      <form class="row" id="ofCq" style="margin-bottom:10px"><input name="q" value="${esc(q)}" class="grow" placeholder="Número de serie o número de pedido (o nombre, teléfono)" /><button class="btn">Buscar</button>
        <button type="button" class="btn" id="ofImpC">${icon('upload')} Importar Excel</button><button type="button" class="btn" id="ofAsgX">${icon('truck')} Asignar por Excel</button>${admin ? `<button type="button" class="btn" id="ofAddC">${icon('plus')} Pasar clientes a esta oficina</button><button type="button" class="btn" id="ofMovX">${icon('upload')} Pasar por Excel</button>` : ''}<button type="button" class="btn primary" id="ofNewC">${icon('plus')} Nuevo cliente</button></form>
      <small class="muted">${r.total} clientes finales${q ? ' coinciden' : ' en esta oficina'}</small>
      <div class="table-wrap"><table><thead><tr><th>Cliente</th><th>Teléfonos</th><th>Dirección</th><th class="r">Pedidos activos</th></tr></thead><tbody>
      ${r.rows.map((c) => `<tr class="click" data-c="${c.id}"><td><b>${esc(c.name)}</b>${c.match_txt ? `<br><small class="mono" style="color:var(--ok)">${esc(c.match_txt)}</small>` : ''}${c.driver_name ? `<br><small class="muted">${icon('truck')} ${esc(c.driver_name)}</small>` : ''}</td>
        <td><small>${esc(c.phone || '')}${c.phone_alt ? '<br>' + esc(c.phone_alt) : ''}${c.external_id ? '<br>Telnor ' + esc(c.external_id) : ''}</small></td><td><small>${esc(c.address || '')}${c.city ? ', ' + esc(c.city) : ''}</small></td><td class="r num">${c.active_orders || ''}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Sin clientes.</td></tr>'}
      </tbody></table></div></div>`;
    $('#ofCq').onsubmit = (e) => { e.preventDefault(); location.hash = `#/offices/${id}?tab=cli&q=${encodeURIComponent(e.target.q.value)}`; };
    $$('[data-c]', body).forEach((tr) => (tr.onclick = async () => customerForm(await GET('/api/customers/' + tr.dataset.c), () => render())));
    $('#ofNewC').onclick = () => customerForm({ office_id: id, city: o.city || '' }, () => render());
    $('#ofAddC')?.addEventListener('click', () => officeMoveCustomers(o));
    $('#ofMovX')?.addEventListener('click', () => excelAssign({ mode: 'office', office: o }));
    $('#ofImpC').onclick = () => importCustomers({ office_id: id, office_name: o.name });
    $('#ofAsgX').onclick = () => excelAssign({ mode: 'driver' });
  }

  if (tab === 'ped') {
    const r = await GET(`/api/orders?limit=200000&date=&office_id=${id}&status=pendiente,asignado,cargado,fallido`);
    body.innerHTML = `<div class="card"><div class="row between"><h2>Pedidos abiertos</h2><a class="btn sm" href="#/orders?date=&office_id=${id}">Ver todos en Pedidos ›</a></div>
      <div class="table-wrap"><table><thead><tr><th>Pedido</th><th>Cliente</th><th>Fecha</th><th>Repartidor</th><th>Estado</th></tr></thead><tbody>
      ${r.rows.map((x) => `<tr class="click" data-o="${x.id}"><td><b>${esc(x.tracking_code)}</b>${x.sn_list ? `<br><small class="mono muted">S/N ${esc(x.sn_list)}</small>` : ''}</td><td>${esc(x.customer_name)}<br><small class="muted">${esc(x.address || '')}</small></td><td>${esc(x.scheduled_date || '')}${x.appointment_time ? ' ' + esc(x.appointment_time) : ''}</td><td>${esc(x.driver_name || '—')}</td><td>${badge(x.status)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No hay pedidos abiertos en esta oficina.</td></tr>'}
      </tbody></table></div></div>`;
    $$('[data-o]', body).forEach((tr) => (tr.onclick = () => orderDetail(tr.dataset.o)));
  }

  if (tab === 'per') {
    body.innerHTML = `<div class="card"><div class="row between"><h2>Personal de la oficina</h2>${admin ? `<button class="btn primary" id="ofAddP">${icon('plus')} Asignar personal</button>` : ''}</div>
      <div class="table-wrap"><table><thead><tr><th>Nombre</th><th>Puesto</th><th>Teléfono</th><th>Vehículo</th><th class="r">Trae (unidades)</th></tr></thead><tbody>
      ${o.staff.map((u) => `<tr><td><b>${esc(u.name)}</b>${u.id === o.supervisor_id ? ' <span class="chip ok">Supervisor operativo</span>' : ''}${u.office_id ? '' : ' <small class="muted">(sin oficina: principal)</small>'}</td><td>${esc(ROLE[u.role] || u.role)}</td><td>${esc(u.phone || '')}</td><td>${esc(u.vehicle || '')}</td><td class="r num">${u.holding || ''}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Sin personal asignado.</td></tr>'}
      </tbody></table></div></div>`;
    $('#ofAddP')?.addEventListener('click', () => officeAssignStaff(o));
  }
}

async function officeSupervisor(o) {
  const ur = await GET('/api/users?limit=500');
  const users = (Array.isArray(ur) ? ur : ur.rows || []).filter((u) => u.active && u.role !== 'repartidor');
  const m = modal(`Supervisor operativo · ${o.name}`, `<div class="stack">
    <p class="muted" style="margin:0">El supervisor opera la oficina: ve y maneja solo su inventario, sus clientes, pedidos, rutas y repartidores. Debe ser despachador (o administrador). Al nombrarlo queda asignado a esta oficina.</p>
    <label class="f">Supervisor<select id="supU"><option value="">— Sin supervisor —</option>${users.map((u) => `<option value="${u.id}" ${u.id === o.supervisor_id ? 'selected' : ''}>${esc(u.name)} · ${esc(ROLE[u.role] || u.role)}</option>`).join('')}</select></label>
    ${users.length ? '' : '<small class="muted">No hay despachadores activos: créalo primero en Usuarios con el rol Despachador.</small>'}</div>`,
    { footer: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="supGo">Guardar</button>' });
  $('#supGo', m.el).onclick = async (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    try { await PUT(`/api/offices/${o.id}/supervisor`, { user_id: $('#supU', m.el).value || null }); toast('Supervisor guardado', 'ok'); m.close(); render(); }
    catch (er) { toast(er.message, 'bad'); btn.disabled = false; }
  };
}
function officeMoveCustomers(o) {
  const m = modal(`Pasar clientes a ${o.name}`, `<div class="stack">
    <div class="row"><input id="omQ" class="grow" placeholder="Buscar por S/N, pedido, nombre, teléfono o ciudad" autocomplete="off" /><button class="btn sm" id="omAll">Seleccionar todo</button></div>
    <div id="omList" class="table-wrap" style="max-height:380px"><p class="muted">Escribe para buscar.</p></div></div>`,
    { wide: true, footer: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="omGo">Pasar a esta oficina</button>' });
  const picked = new Set();
  let t;
  const search = async () => {
    const q = $('#omQ', m.el).value.trim();
    if (q.length < 2) return;
    const r = await GET('/api/customers?limit=200&q=' + encodeURIComponent(q));
    const rows = r.rows.filter((c) => c.office_name !== o.name);
    $('#omList', m.el).innerHTML = rows.length ? `<table><tbody>${rows.map((c) => `<tr><td style="width:30px"><input type="checkbox" data-mc="${c.id}" ${picked.has(c.id) ? 'checked' : ''} /></td><td><b>${esc(c.name)}</b><br><small class="muted">${esc(c.address || '')}${c.city ? ', ' + esc(c.city) : ''}</small></td><td><small class="muted">Hoy en: ${esc(c.office_name || '—')}</small></td></tr>`).join('')}</tbody></table>` : '<p class="muted">Nada que pasar con esa búsqueda.</p>';
    $$('[data-mc]', m.el).forEach((c) => (c.onchange = () => { c.checked ? picked.add(Number(c.dataset.mc)) : picked.delete(Number(c.dataset.mc)); $('#omGo', m.el).textContent = `Pasar ${picked.size} a esta oficina`; }));
  };
  $('#omQ', m.el).oninput = () => { clearTimeout(t); t = setTimeout(search, 350); };
  $('#omAll', m.el).onclick = () => { $$('[data-mc]', m.el).forEach((c) => { c.checked = true; picked.add(Number(c.dataset.mc)); }); $('#omGo', m.el).textContent = `Pasar ${picked.size} a esta oficina`; };
  $('#omGo', m.el).onclick = async (e) => {
    const btn = e.currentTarget;
    if (!picked.size) return toast('Marca los clientes', 'bad');
    if (!(await confirmDlg(`¿Pasar ${picked.size} cliente(s) a ${o.name}?`))) return;
    btn.disabled = true;
    try { const r = await POST(`/api/offices/${o.id}/customers`, { ids: [...picked] }); toast(`${r.moved} clientes pasados a ${o.name}`, 'ok'); m.close(); render(); }
    catch (er) { toast(er.message, 'bad'); btn.disabled = false; }
  };
}

async function officeAssignStaff(o) {
  const ur = await GET('/api/users?limit=500'); const users = Array.isArray(ur) ? ur : ur.rows || [];
  const cur = new Set(o.staff.filter((u) => u.office_id === o.id).map((u) => u.id));
  const list = users.filter((u) => u.active && !cur.has(u.id));
  const m = modal(`Asignar personal a ${o.name}`, list.length ? `<div class="table-wrap" style="max-height:400px"><table><tbody>${list.map((u) => `<tr><td style="width:30px"><input type="checkbox" data-su="${u.id}" /></td><td><b>${esc(u.name)}</b><br><small class="muted">${esc(ROLE[u.role] || u.role)}${u.vehicle ? ' · ' + esc(u.vehicle) : ''}</small></td></tr>`).join('')}</tbody></table></div>`
    : '<p class="muted">Todo el personal activo ya está en esta oficina.</p>', { footer: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="suGo">Asignar</button>' });
  $('#suGo', m.el).onclick = async (e) => {
    const btn = e.currentTarget;
    const ids = $$('[data-su]:checked', m.el).map((c) => Number(c.dataset.su));
    if (!ids.length) return toast('Marca al personal', 'bad');
    btn.disabled = true;
    try { const r = await POST(`/api/offices/${o.id}/staff`, { ids }); toast(`${r.moved} persona(s) asignadas a ${o.name}`, 'ok'); m.close(); render(); }
    catch (er) { toast(er.message, 'bad'); btn.disabled = false; }
  };
}

async function warehouseDetail(id, whs) {
  const w = whs.find((x) => x.id === id);
  const list = await GET(`/api/warehouses/${id}/serials`);
  const others = whs.filter((x) => x.id !== id && x.active);
  const m = modal(w.name, `<div class="stack">
    <div class="row between"><div>${w.is_default ? '<span class="chip ok">Principal</span> ' : ''}<small class="muted">${esc(w.address || '')}${w.manager ? ' · ' + esc(w.manager) : ''}${w.phone ? ' · ' + esc(w.phone) : ''}</small></div>
      <div class="row">${others.length ? `<button class="btn sm" id="whXf">${icon('truck')} Traspaso</button>` : ''}${store.user.role === 'admin' ? `<button class="btn sm" id="whEdit">${icon('cog')} Editar</button>` : ''}</div></div>
    <div class="row between"><b>${list.length} equipos con S/N en este almacén</b>${list.length ? `<label class="row"><input type="checkbox" id="whAll" /> Todos</label>` : ''}</div>
    <input id="whQ" placeholder="Buscar S/N o producto" />
    <div class="table-wrap" style="max-height:340px"><table><tbody>${list.map((s) => `<tr data-row="${esc(s.serial + ' ' + s.product_name).toLowerCase()}"><td style="width:30px"><input type="checkbox" data-ws="${esc(s.serial)}" /></td><td class="mono">${esc(s.serial)}</td><td><small>${esc(s.product_name)}</small></td><td><small class="muted">${s.tracking_code ? 'Pedido ' + esc(s.tracking_code) : 'Libre'}</small></td></tr>`).join('') || '<tr><td class="muted">Sin equipos</td></tr>'}</tbody></table></div>
    ${others.length && list.length ? `<div class="row"><select id="whTo">${others.map((o) => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}</select><button class="btn primary" id="whMove">${icon('truck')} Traspasar seleccionados</button><small class="muted" id="whN"></small></div>`
      : !others.length ? '<small class="muted">Da de alta otro almacén para poder hacer traspasos.</small>' : ''}</div>`, { wide: true, footer: '<button class="btn primary" data-close>Cerrar</button>', onClose: () => render() });
  const cnt = () => { const n = $$('[data-ws]:checked', m.el).length; const el = $('#whN', m.el); if (el) el.textContent = n ? `${n} seleccionados` : ''; };
  $$('[data-ws]', m.el).forEach((c) => (c.onchange = cnt));
  $('#whAll', m.el)?.addEventListener('change', (e) => { $$('tr[data-row]', m.el).filter((r) => !r.hidden).forEach((r) => (r.querySelector('input').checked = e.target.checked)); cnt(); });
  $('#whQ', m.el).oninput = (e) => { const q = e.target.value.toLowerCase(); $$('tr[data-row]', m.el).forEach((r) => (r.hidden = !r.dataset.row.includes(q))); };
  $('#whEdit', m.el)?.addEventListener('click', () => { m.close(); warehouseForm(w); });
  $('#whXf', m.el)?.addEventListener('click', () => { m.close(); transferDialog(whs, id); });
  $('#whMove', m.el)?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const serials = $$('[data-ws]:checked', m.el).map((c) => c.dataset.ws);
    if (!serials.length) return toast('Marca los equipos a traspasar', 'bad');
    const to = $('#whTo', m.el);
    if (!(await confirmDlg(`¿Traspasar ${serials.length} equipo(s) de ${w.name} a ${to.selectedOptions[0].text}?`))) return;
    btn.disabled = true;
    try { const r = await POST(`/api/warehouses/${to.value}/transfer`, { serials }); toast(`${r.moved} equipos traspasados${r.errors.length ? ` · ${r.errors.length} con error` : ''}`, 'ok'); m.close(); }
    catch (er) { toast(er.message, 'bad'); btn.disabled = false; }
  });
}

// ================= Documentos del expediente =================
const DOC_ST = { aprobado: ['Aprobado', 'ok'], pendiente: ['En revisión', 'warn'], rechazado: ['Rechazado', 'off'] };
function staffDocChip(d) {
  if (!d) return '';
  const venc = d.expires && d.expires < today();
  if (venc) return '<span class="chip off">Vencido</span>';
  const st = DOC_ST[d.status] || (d.ok ? DOC_ST.aprobado : null);
  return st ? `<span class="chip ${st[1]}">${st[0]}</span>` : '';
}
// Foto (reducida) o PDF como data URL
function fileToDataUrl(file) {
  if (file.size > 12 * 1024 * 1024) return Promise.reject(new Error('El archivo es muy grande (máx. 12 MB)'));
  if (file.type === 'application/pdf') return new Promise((ok, fail) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => fail(new Error('No se pudo leer el PDF')); r.readAsDataURL(file); });
  if (!file.type.startsWith('image/')) return Promise.reject(new Error('Sube una foto o un PDF'));
  return new Promise((ok, fail) => {
    const img = new Image();
    img.onload = () => { const k = Math.min(1, 1800 / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(img.src); ok(c.toDataURL('image/jpeg', 0.85)); };
    img.onerror = () => fail(new Error('No se pudo leer la imagen'));
    img.src = URL.createObjectURL(file);
  });
}
async function openDocFile(userId, doc) {
  const w = window.open('', '_blank');
  try {
    const r = await fetch(`/api/users/${userId}/documents/${doc}/file`, { headers: { Authorization: 'Bearer ' + store.token } });
    if (!r.ok) throw new Error('No se pudo abrir el documento');
    const url = URL.createObjectURL(await r.blob());
    if (w) w.location = url; else window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  } catch (e) { w?.close(); toast(e.message, 'bad'); }
}
// Colaborador: sube sus propios documentos desde Mi perfil
async function myDocuments(box, u) {
  const r = await GET('/api/me/documents');
  const need = r.doc_list.filter((d) => !d.optional);
  const done = need.filter((d) => r.docs[d.key]?.ok && !(r.docs[d.key]?.expires && r.docs[d.key].expires < today())).length;
  box.innerHTML = `<h2>Mis documentos</h2>
    <p class="muted" style="margin:0">Sube una foto clara o el PDF de cada documento. El administrador lo revisa y queda en tu expediente.</p>
    <div class="row"><b>${done}/${need.length} aprobados</b><div class="progress grow"><i style="width:${need.length ? (done / need.length) * 100 : 0}%;background:var(--ok)"></i></div></div>
    ${r.doc_list.map((d) => { const x = r.docs[d.key] || {}; return `<div class="doc-row stack" style="gap:6px">
      <div class="row between"><span><b>${esc(d.label)}</b>${d.optional ? ' <small class="muted">(opcional)</small>' : ''}</span>${staffDocChip(x) || '<span class="chip">Falta</span>'}</div>
      ${x.status === 'rechazado' && x.note ? `<small style="color:var(--bad)">${esc(x.note)}</small>` : ''}
      <div class="row" style="gap:6px;flex-wrap:wrap">
        <label class="btn sm ${x.has_file ? '' : 'primary'}">${icon('camera')} ${x.has_file ? 'Reemplazar' : 'Subir foto o PDF'}<input type="file" accept="image/*,application/pdf" data-mup="${d.key}" hidden /></label>
        ${x.has_file ? `<button type="button" class="btn sm" data-mview="${d.key}">${icon('ext')} Ver</button>` : ''}
        <label class="row"><small class="muted">Vence</small><input type="date" data-mexp="${d.key}" value="${esc(x.expires || '')}" style="width:auto" /></label></div></div>`; }).join('')}`;
  $$('[data-mview]', box).forEach((b) => (b.onclick = () => openDocFile(u.id, b.dataset.mview)));
  $$('[data-mup]', box).forEach((i) => (i.onchange = async () => {
    const f = i.files[0];
    if (!f) return;
    const k = i.dataset.mup;
    toast('Subiendo…', '');
    try {
      await POST('/api/me/documents/' + k, { file: await fileToDataUrl(f), expires: $(`[data-mexp="${k}"]`, box).value || undefined });
      toast('Documento enviado a revisión', 'ok');
      myDocuments(box, u);
    } catch (e) { toast(e.message, 'bad'); }
  }));
}

// ================= Expediente del personal (interno o externo) =================
async function staffProfile(box, u) {
  const p = await GET(`/api/users/${u.id}/profile`);
  const first = today().slice(0, 8) + '01';
  let photo;
  box.innerHTML = `<form id="pf2" class="stack">
    <div class="row" style="gap:14px;align-items:flex-start">
      <div class="staff-photo">${p.photo_path ? `<img src="/uploads/${esc(p.photo_path)}" alt="Fotografía de ${esc(u.name)}" />` : `<span class="muted">${icon('person')}</span>`}
        <label class="btn sm block" style="margin-top:6px">${icon('camera')} Fotografía<input type="file" accept="image/*" id="pfPhoto" hidden /></label></div>
      <div class="grow stack">
        <div class="row">${p.complete ? '<span class="chip ok">Expediente completo</span>' : `<span class="chip warn">Faltan ${p.missing.length} documento(s)</span>`}${p.expired.length ? ` <span class="chip off">${p.expired.length} vencido(s)</span>` : ''}</div>
        <div class="grid g3"><label class="f">Tipo de contratación<select name="hire_type"><option value="externo" ${p.hire_type !== 'interno' ? 'selected' : ''}>Externo (por servicio)</option><option value="interno" ${p.hire_type === 'interno' ? 'selected' : ''}>Interno (nómina)</option></select></label>
          <label class="f">Fecha de alta<input type="date" name="hire_date" value="${esc(p.hire_date)}" /></label><label class="f">Fecha de baja<input type="date" name="end_date" value="${esc(p.end_date)}" /></label></div></div></div>
    <fieldset><legend>${icon('person')} Datos personales</legend><div class="grid g3">
      <label class="f">Fecha de nacimiento<input type="date" name="birth_date" value="${esc(p.birth_date)}" /></label>
      <label class="f">RFC<input name="rfc" value="${esc(p.rfc)}" maxlength="13" style="text-transform:uppercase" placeholder="XAXX010101000" /></label>
      <label class="f">CURP<input name="curp" value="${esc(p.curp)}" maxlength="18" style="text-transform:uppercase" /></label></div>
      <div class="grid g3"><label class="f"><span>NSS <small class="muted">(si aplica)</small></span><input name="nss" value="${esc(p.nss)}" maxlength="11" /></label>
      <label class="f">Contacto de emergencia<input name="emergency_name" value="${esc(p.emergency_name)}" /></label>
      <label class="f">Teléfono de emergencia<input name="emergency_phone" type="tel" value="${esc(p.emergency_phone)}" /></label></div>
      <label class="f">Domicilio<input name="address" value="${esc(p.address)}" /></label></fieldset>
    <fieldset><legend>${icon('key')} Datos bancarios</legend><div class="grid g2">
      <label class="f">Banco<input name="bank_name" value="${esc(p.bank_name)}" /></label><label class="f">Titular de la cuenta<input name="account_holder" value="${esc(p.account_holder)}" /></label>
      <label class="f">CLABE (18 dígitos)<input name="clabe" value="${esc(p.clabe)}" inputmode="numeric" maxlength="18" /></label><label class="f">Número de cuenta / tarjeta<input name="account_number" value="${esc(p.account_number)}" inputmode="numeric" /></label></div></fieldset>
    <fieldset><legend>💲 Pago</legend><div class="grid g3">
      <label class="f">Pago por entrega exitosa ($)<input type="number" name="pay_per_delivery" min="0" step="0.01" value="${p.pay_per_delivery || ''}" placeholder="0.00" /></label>
      <label class="f">Pago por intento fallido ($)<input type="number" name="pay_per_failed" min="0" step="0.01" value="${p.pay_per_failed || ''}" placeholder="0.00" /></label>
      <label class="f">Periodo de pago<select name="pay_period">${['semanal', 'quincenal', 'mensual'].map((x) => `<option ${p.pay_period === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label></div>
      <div class="row" style="margin-top:6px"><input type="date" id="payFrom" value="${first}" style="width:auto" /><input type="date" id="payTo" value="${today()}" style="width:auto" /><button type="button" class="btn sm" id="payGo">Calcular pago</button></div>
      <div id="payOut" class="muted" style="margin-top:6px"></div></fieldset>
    <fieldset><legend>${icon('shield')} Cumplimiento mínimo (documentos)</legend>
      ${p.pending_docs ? `<div class="info-bar">${icon('info')} ${p.pending_docs} documento(s) subido(s) por el colaborador esperan tu revisión.</div>` : ''}
      ${p.doc_list.map(([k, l]) => { const d = p.docs[k] || {}; return `<div class="row doc-row"><label class="row grow"><input type="checkbox" data-doc="${k}" ${d.ok ? 'checked' : ''} /> ${esc(l)}${k === 'seguro' || (k === 'licencia' && u.role !== 'repartidor') ? ' <small class="muted">(opcional)</small>' : ''} ${staffDocChip(d)}</label>
        <div class="row" style="gap:6px">${d.has_file ? `<button type="button" class="btn sm" data-view="${k}">${icon('ext')} Ver</button>` : ''}
          ${d.status === 'pendiente' ? `<button type="button" class="btn sm ok" data-ok="${k}">Aprobar</button><button type="button" class="btn sm bad" data-no="${k}">Rechazar</button>` : ''}
          <label class="btn sm">${icon('upload')} Subir<input type="file" accept="image/*,application/pdf" data-up="${k}" hidden /></label>
          <label class="row"><small class="muted">Vence</small><input type="date" data-exp="${k}" value="${esc(d.expires || '')}" style="width:auto" /></label></div></div>`; }).join('')}
      ${p.missing.length ? `<small class="muted">Faltan: ${p.missing.map(esc).join(', ')}</small>` : ''}</fieldset>
    <label class="f">Notas<textarea name="notes">${esc(p.notes)}</textarea></label>
    <div class="row" style="justify-content:flex-end"><button type="button" class="btn primary" id="pfSave">Guardar expediente</button></div>
    <small class="muted">🔒 Estos datos solo los ve el administrador.</small></form>`;
  const f = $('#pf2', box);
  $('#pfPhoto', box).onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    // reducir sin sello de fecha (es una foto de identificación)
    photo = await new Promise((ok, fail) => {
      const img = new Image();
      img.onload = () => { const k = Math.min(1, 800 / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(img.src); ok(c.toDataURL('image/jpeg', 0.85)); };
      img.onerror = () => fail(new Error('No se pudo leer la imagen'));
      img.src = URL.createObjectURL(file);
    }).catch((er) => { toast(er.message, 'bad'); return null; });
    if (!photo) return;
    box.querySelector('.staff-photo').firstElementChild.outerHTML = `<img src="${photo}" alt="Fotografía nueva" />`;
  };
  const pay = async () => {
    try {
      const r = await GET(`/api/users/${u.id}/pay?from=${$('#payFrom', box).value}&to=${$('#payTo', box).value}`);
      $('#payOut', box).innerHTML = `${r.delivered} entregas × ${mxn(r.rate_delivery)}${r.failed ? ` + ${r.failed} fallidos × ${mxn(r.rate_failed)}` : ''} = <b style="color:var(--text);font-size:1.1rem">${mxn(r.amount)}</b>`;
    } catch (e) { $('#payOut', box).textContent = e.message; }
  };
  $('#payGo', box).onclick = pay;
  pay();
  // documentos: ver, subir (queda aprobado), aprobar o rechazar lo que subió el colaborador
  const docAct = async (k, body, msg) => { try { await POST(`/api/users/${u.id}/documents/${k}`, body); toast(msg, 'ok'); staffProfile(box, u); } catch (e) { toast(e.message, 'bad'); } };
  $$('[data-view]', box).forEach((b) => (b.onclick = () => openDocFile(u.id, b.dataset.view)));
  $$('[data-ok]', box).forEach((b) => (b.onclick = () => docAct(b.dataset.ok, { status: 'aprobado', expires: $(`[data-exp="${b.dataset.ok}"]`, box).value || undefined }, 'Documento aprobado')));
  $$('[data-no]', box).forEach((b) => (b.onclick = () => { const note = prompt('Motivo del rechazo (lo verá el colaborador):', 'Ilegible, vuelve a subirlo'); if (note !== null) docAct(b.dataset.no, { status: 'rechazado', note }, 'Documento rechazado'); }));
  $$('[data-up]', box).forEach((i) => (i.onchange = async () => { const f = i.files[0]; if (!f) return; try { docAct(i.dataset.up, { file: await fileToDataUrl(f), expires: $(`[data-exp="${i.dataset.up}"]`, box).value || undefined }, 'Documento guardado'); } catch (e) { toast(e.message, 'bad'); } }));
  $('#pfSave', box).onclick = async (e) => {
    const btn = e.currentTarget;
    const b = Object.fromEntries(new FormData(f));
    b.docs = Object.fromEntries($$('[data-doc]', box).map((c) => [c.dataset.doc, { ok: c.checked, expires: $(`[data-exp="${c.dataset.doc}"]`, box).value || null }]));
    if (photo) b.photo = photo;
    btn.disabled = true;
    try { await PUT(`/api/users/${u.id}/profile`, b); toast('Expediente guardado', 'ok'); staffProfile(box, u); }
    catch (er) { toast(er.message, 'bad'); btn.disabled = false; }
  };
}

// ================= Excel de lo asignado a cada repartidor =================
async function exportAssignedExcel(date, driverId) {
  toast('Preparando Excel…', '');
  try {
    const [X, r] = await Promise.all([loadXLSX(), GET(`/api/assigned/export?date=${date}${driverId ? '&driver_id=' + driverId : ''}`)]);
    const list = r.drivers.filter((d) => driverId || d.orders.length || d.inventory.length);
    if (!list.length) return toast('No hay nada asignado a repartidores en esa fecha', 'bad');
    const wb = X.utils.book_new();
    const fecha = new Date(date + 'T12:00:00').toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const company = SETTINGS.company_name || 'Sovime Mensajería';
    const invUnits = (d) => d.inventory.reduce((a, x) => a + x.qty, 0);
    if (!driverId) {
      const rows = [[`${company} · Lo asignado a repartidores`], [`Fecha: ${fecha}`], [],
        ['Repartidor', 'Vehículo', 'Pedidos', 'Entregados', 'Fallidos', 'Por entregar', 'Unidades que trae']];
      for (const d of list) rows.push([d.name, d.vehicle || '', d.orders.length, d.orders.filter((o) => o.status === 'entregado').length, d.orders.filter((o) => o.status === 'fallido').length,
        d.orders.filter((o) => ['asignado', 'cargado', 'pendiente'].includes(o.status)).length, invUnits(d)]);
      rows.push(['Total', '', ...[2, 3, 4, 5, 6].map((i) => rows.slice(4).reduce((a, x) => a + (x[i] || 0), 0))]);
      const ws = X.utils.aoa_to_sheet(rows);
      ws['!cols'] = [{ wch: 26 }, { wch: 18 }, { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 13 }, { wch: 18 }];
      X.utils.book_append_sheet(wb, ws, 'Resumen');
    }
    const used = new Set(['Resumen']);
    for (const d of list) {
      const rows = [[`${company} · Hoja de ruta y carga`], [`Repartidor: ${d.name}`, '', `Vehículo: ${d.vehicle || '—'}`], [`Fecha: ${fecha}`, '', `Pedidos: ${d.orders.length}`], [],
        ['#', 'Guía', 'Cliente', 'Teléfono Telnor', 'Teléfono móvil', 'Teléfono adicional', 'Dirección', 'Colonia', 'Referencias', 'Horario', 'Llegada estimada', 'Productos', 'Números de serie', 'Cobrar', 'Estado', 'Notas', 'Nombre y firma de quien recibe']];
      d.orders.forEach((o, i) => rows.push([o.stop_seq && o.stop_seq < 999 ? o.stop_seq : i + 1, o.tracking_code, o.customer, o.telnor || '', o.phone || '', o.phone_alt || '', o.address || '', o.colonia || '', o.reference || '',
        o.appointment_time ? `${o.appointment_time} (acordada)` : o.window_start ? `${o.window_start}–${o.window_end}` : '', o.eta || '', o.items || '', o.serials || '', o.cod_amount ? Number(o.cod_amount) : '', STATUS[o.status] || o.status, o.notes || '', '']));
      if (!d.orders.length) rows.push(['', 'Sin pedidos asignados en esta fecha']);
      rows.push([], ['Inventario que trae'], ['Producto', 'Cantidad', 'Números de serie']);
      for (const it of d.inventory) rows.push([it.name, it.qty, it.serials.map((x) => x.serial + (x.order ? ` (${x.order})` : '')).join(', ')]);
      if (!d.inventory.length) rows.push(['Sin inventario asignado']);
      rows.push([], [], ['Entregó (almacén): ____________________', '', '', 'Recibió (repartidor): ____________________']);
      const ws = X.utils.aoa_to_sheet(rows);
      ws['!cols'] = [{ wch: 6 }, { wch: 16 }, { wch: 30 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 34 }, { wch: 18 }, { wch: 20 }, { wch: 11 }, { wch: 10 }, { wch: 24 }, { wch: 26 }, { wch: 9 }, { wch: 12 }, { wch: 24 }, { wch: 30 }];
      let name = d.name.replace(/[\\/?*[\]:]/g, '').slice(0, 28) || 'Repartidor';
      while (used.has(name)) name = name.slice(0, 26) + '_' + used.size;
      used.add(name);
      X.utils.book_append_sheet(wb, ws, name);
    }
    const file = driverId ? `asignado-${list[0].name.replace(/\s+/g, '_')}-${date}.xlsx` : `asignado-repartidores-${date}.xlsx`;
    X.writeFile(wb, file);
    toast('Excel descargado', 'ok');
  } catch (e) { toast(e.message || 'No se pudo generar el Excel', 'bad'); }
}

// ================= Clientes mayoristas =================
const mxn = (n) => '$' + Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
async function viewAccounts(v) {
  const { rows, unassigned } = await GET('/api/accounts');
  const admin = store.user.role === 'admin';
  const pct = (a) => (a.delivered + a.failed ? Math.round((a.delivered / (a.delivered + a.failed)) * 100) + '%' : '—');
  v.innerHTML = topbar('Clientes mayoristas', admin ? `<button class="btn primary" id="accNew">${icon('plus')} Mayorista</button>` : '', 'Empresas a las que les damos el servicio de entrega: sus pedidos, resultados y estado de cuenta.') + `
    ${unassigned && rows.length ? `<div class="info-bar">${icon('info')} Hay <b>${unassigned}</b> pedidos sin mayorista. Abre un mayorista y usa <b>Ligar pedidos</b> para asignárselos.</div>` : ''}
    ${rows.length ? `<div class="grid g3" style="margin-top:10px">${rows.map((a) => `<button class="card kpi-btn acc-card" data-acc="${a.id}" style="text-align:left;${a.active ? '' : 'opacity:.6'}">
      <div class="row between"><b style="font-size:17px">${icon('building')} ${esc(a.name)}</b>${a.active ? '' : '<span class="chip off">Inactivo</span>'}</div>
      <small class="muted">${esc(a.contact_name || '')}${a.phone ? ' · ' + esc(a.phone) : ''}</small>
      <div class="grid g4" style="margin-top:10px;gap:6px">
        <div><small class="muted">Pedidos</small><br><b>${fmtN(a.orders_total)}</b></div>
        <div><small class="muted">Abiertos</small><br><b>${fmtN(a.open || 0)}</b></div>
        <div><small class="muted">Entregados</small><br><b style="color:var(--ok)">${fmtN(a.delivered || 0)}</b></div>
        <div><small class="muted">Éxito</small><br><b>${pct(a)}</b></div></div>
      <small class="muted">Tarifa: ${mxn(a.rate_delivery)} por entrega${a.rate_failed ? ` · ${mxn(a.rate_failed)} por intento fallido` : ''}</small></button>`).join('')}</div>`
      : `<div class="card empty">${icon('building')}<br>Aún no hay mayoristas.<br><small class="muted">Da de alta a las empresas que te envían entregas (p. ej. Telnor / Anderns) para separar sus pedidos y sacar su estado de cuenta.</small></div>`}`;
  $('#accNew')?.addEventListener('click', () => accountForm(null));
  $$('[data-acc]', v).forEach((b) => (b.onclick = () => accountDetail(Number(b.dataset.acc))));
}

function accountForm(a) {
  a = a || { active: 1 };
  const m = modal(a.id ? `Editar ${a.name}` : 'Nuevo mayorista', `<form id="accF" class="stack">
    <div class="grid g2"><label class="f">Nombre comercial *<input name="name" required value="${esc(a.name)}" placeholder="Telnor / Anderns" /></label>
      <label class="f">Razón social<input name="legal_name" value="${esc(a.legal_name)}" /></label></div>
    <div class="grid g3"><label class="f">RFC<input name="rfc" value="${esc(a.rfc)}" style="text-transform:uppercase" /></label>
      <label class="f">Contacto<input name="contact_name" value="${esc(a.contact_name)}" /></label>
      <label class="f">Teléfono<input name="phone" type="tel" value="${esc(a.phone)}" /></label></div>
    <div class="grid g2"><label class="f">Correo<input name="email" type="email" value="${esc(a.email)}" /></label>
      <label class="f">Condiciones de pago<input name="payment_terms" value="${esc(a.payment_terms)}" placeholder="Semanal, 15 días…" /></label></div>
    <label class="f">Domicilio<input name="address" value="${esc(a.address)}" /></label>
    <fieldset><legend>Tarifas del servicio</legend><div class="grid g2">
      <label class="f">Por entrega exitosa ($)<input name="rate_delivery" type="number" min="0" step="0.01" value="${a.rate_delivery ?? ''}" placeholder="0.00" /></label>
      <label class="f">Por intento fallido ($)<input name="rate_failed" type="number" min="0" step="0.01" value="${a.rate_failed ?? ''}" placeholder="0.00" /></label></div>
      <small class="muted">Se usan para calcular el estado de cuenta del periodo.</small></fieldset>
    <label class="f">Notas<textarea name="notes">${esc(a.notes)}</textarea></label>
    ${a.id ? `<label class="row"><input type="checkbox" name="active" ${a.active ? 'checked' : ''} /> Activo</label>` : ''}</form>`,
    { footer: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="accSave">Guardar</button>' });
  $('#accSave', m.el).onclick = async () => {
    const f = $('#accF', m.el);
    if (!f.reportValidity()) return;
    const b = Object.fromEntries(new FormData(f));
    if (a.id) b.active = !!f.active?.checked;
    try {
      if (a.id) await PUT('/api/accounts/' + a.id, b); else await POST('/api/accounts', b);
      toast('Mayorista guardado', 'ok'); m.close(); render();
    } catch (e) { toast(e.message, 'bad'); }
  };
}

async function accountDetail(id) {
  const a = await GET('/api/accounts/' + id);
  const admin = store.user.role === 'admin';
  const first = today().slice(0, 8) + '01';
  const m = modal(a.name, `<div class="stack">
    <div class="row between"><div><small class="muted">${esc(a.legal_name || '')}${a.rfc ? ' · RFC ' + esc(a.rfc) : ''}</small><br>${esc(a.contact_name || '')} ${a.phone ? `· <a href="tel:${esc(a.phone)}">${esc(a.phone)}</a>` : ''} ${a.email ? `· <a href="mailto:${esc(a.email)}">${esc(a.email)}</a>` : ''}</div>
      <div class="row">${admin ? `<button class="btn sm" id="adEdit">${icon('cog')} Editar</button>` : ''}<a class="btn sm" href="#/orders?date=&account_id=${a.id}">${icon('box')} Ver pedidos</a><button class="btn sm" id="adLink">${icon('plus')} Ligar pedidos</button></div></div>
    <div class="grid g4">
      <div class="card kpi"><div class="label">Pedidos</div><div class="value">${fmtN(a.orders_total)}</div></div>
      <div class="card kpi"><div class="label">Abiertos</div><div class="value">${fmtN(a.open || 0)}</div></div>
      <div class="card kpi"><div class="label">Entregados</div><div class="value" style="color:var(--ok)">${fmtN(a.delivered || 0)}</div></div>
      <div class="card kpi"><div class="label">Fallidos</div><div class="value" style="color:var(--bad)">${fmtN(a.failed || 0)}</div></div></div>
    ${a.by_day.length ? `<div><h3>Por día</h3><div class="table-wrap" style="max-height:200px"><table><thead><tr><th>Fecha</th><th class="r">Pedidos</th><th class="r">Entregados</th><th class="r">Fallidos</th></tr></thead><tbody>
      ${a.by_day.map((d) => `<tr><td class="num">${esc(d.day)}</td><td class="r num">${d.total}</td><td class="r num">${d.delivered || 0}</td><td class="r num">${d.failed || 0}</td></tr>`).join('')}</tbody></table></div></div>` : ''}
    <div class="card" style="padding:12px"><h3 style="margin-top:0">${icon('chart')} Estado de cuenta</h3>
      <div class="row"><label class="f">Desde<input type="date" id="stFrom" value="${first}" /></label><label class="f">Hasta<input type="date" id="stTo" value="${today()}" /></label>
        <button class="btn" id="stGo">Calcular</button><button class="btn" id="stCsv">${icon('download')} Excel (CSV)</button></div>
      <div id="stOut" style="margin-top:8px"></div></div>
    ${a.notes ? `<p class="muted">${esc(a.notes)}</p>` : ''}</div>`, { wide: true, footer: '<button class="btn primary" data-close>Cerrar</button>' });
  $('#adEdit', m.el)?.addEventListener('click', () => { m.close(); accountForm(a); });
  const stmt = async () => {
    const r = await GET(`/api/accounts/${a.id}/statement?from=${$('#stFrom', m.el).value}&to=${$('#stTo', m.el).value}`);
    const t = r.totals;
    $('#stOut', m.el).innerHTML = `<div class="grid g3">
        <div><small class="muted">Entregas exitosas</small><br><b>${t.delivered}</b> × ${mxn(r.account.rate_delivery)} = <b>${mxn(t.amount_delivered)}</b></div>
        <div><small class="muted">Intentos fallidos</small><br><b>${t.failed}</b> × ${mxn(r.account.rate_failed)} = <b>${mxn(t.amount_failed)}</b></div>
        <div><small class="muted">Total del periodo</small><br><b style="font-size:20px">${mxn(t.total)}</b></div></div>
      ${r.rows.length ? `<div class="table-wrap" style="max-height:260px;margin-top:8px"><table><thead><tr><th>Guía</th><th>Fecha</th><th>Cliente</th><th>Resultado</th><th class="r">Importe</th></tr></thead><tbody>
        ${r.rows.map((x) => `<tr><td class="mono">${esc(x.tracking_code)}</td><td class="num">${esc(x.scheduled_date)}</td><td>${esc(x.customer)}${x.serials ? `<br><small class="muted mono">${esc(x.serials)}</small>` : ''}</td><td>${badge(x.status)}${x.reason ? `<br><small class="muted">${esc(x.reason)}</small>` : ''}</td><td class="r num">${mxn(x.amount)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Sin entregas ni intentos fallidos en este periodo.</p>'}`;
  };
  $('#stGo', m.el).onclick = () => stmt().catch((e) => toast(e.message, 'bad'));
  $('#stCsv', m.el).onclick = async () => {
    try {
      const res = await fetch(`/api/accounts/${a.id}/statement?format=csv&from=${$('#stFrom', m.el).value}&to=${$('#stTo', m.el).value}`, { headers: { Authorization: 'Bearer ' + store.token } });
      if (!res.ok) throw new Error('No se pudo generar el archivo');
      const blob = await res.blob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = (res.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1] || 'estado-de-cuenta.csv';
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 5000);
    } catch (e) { toast(e.message, 'bad'); }
  };
  stmt().catch(() => {});
  $('#adLink', m.el).onclick = async () => {
    const { unassigned } = await GET('/api/accounts');
    const m2 = modal(`Ligar pedidos a ${a.name}`, `<div class="stack">
      <label class="radio"><input type="radio" name="lk" value="date" checked /> <span>Los pedidos sin mayorista de la fecha <input type="date" id="lkDate" value="${today()}" style="width:auto" /></span></label>
      <label class="radio"><input type="radio" name="lk" value="all" /> <span>Todos los pedidos sin mayorista <small class="muted">(${unassigned})</small></span></label>
      <small class="muted">Los pedidos que ya tienen otro mayorista no se cambian. Para cambiar uno en particular, ábrelo en Pedidos.</small></div>`,
      { footer: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="lkGo">Ligar</button>' });
    $('#lkGo', m2.el).onclick = async () => {
      const mode = $('input[name=lk]:checked', m2.el).value;
      try {
        const r = await POST(`/api/accounts/${a.id}/orders`, mode === 'all' ? { all_unassigned: true } : { date: $('#lkDate', m2.el).value });
        toast(`${r.updated} pedidos ligados a ${a.name}`, 'ok'); m2.close(); m.close(); accountDetail(a.id);
      } catch (e) { toast(e.message, 'bad'); }
    };
  };
}

// ================= Inventario asignado a repartidores =================
function assignToDriver(drivers, products, preDriver) {
  const act = drivers.filter((d) => d.active);
  if (!act.length) return toast('Primero da de alta repartidores en Usuarios', 'bad');
  const m = modal('Asignar inventario a repartidor', `<div class="stack">
    <div class="grid g2"><label class="f">Repartidor<select id="adDrv">${act.filter((d) => !d.open).map((d) => `<option value="${d.id}" ${d.id === preDriver ? 'selected' : ''}>${esc(d.name)}${d.total ? ` (ya trae ${d.total})` : ''}</option>`).join('')}
        <option value="open" ${preDriver === 'open' ? 'selected' : ''}>🔓 Abierto · lo entrega cualquier repartidor${(drivers.find((d) => d.open)?.total) ? ` (ya hay ${drivers.find((d) => d.open).total})` : ''}</option></select></label>
      <label class="f">Referencia<input id="adRef" placeholder="Salida del ${today()}, turno…" maxlength="80" /></label></div>
    <div class="pill-tabs" id="adMode"><button class="on" data-m="pick">${icon('check')} Elegir del almacén</button><button data-m="sn">${icon('scan')} Escanear o pegar S/N</button></div>
    <div data-p="pick" class="stack">
      <div class="row"><input id="adQ" class="grow" placeholder="Buscar producto, S/N, pedido o cliente" /><button class="btn sm primary" id="adAll" title="Marca todos los equipos y productos que se ven en la lista (respeta la búsqueda)">${icon('check')} Seleccionar todo</button><button class="btn sm" id="adNone">Quitar selección</button></div>
      <div id="adAvail" class="stack" style="max-height:48vh;overflow:auto"><p class="muted">Cargando inventario disponible…</p></div>
      <div class="row between assign-bar" style="position:sticky;bottom:0;background:var(--surface);padding-top:8px;border-top:1px solid var(--border)">
        <small id="adSel" class="muted">Nada seleccionado</small><button class="btn primary" id="adPick" disabled>${icon('truck')} Asignar</button></div></div>
    <div data-p="sn" class="stack" hidden>
      <div class="row"><button class="btn primary grow" id="adScan">${icon('scan')} Escanear equipos</button></div>
      <label class="f">…o pega los números de serie (uno por línea, desde Excel)<textarea id="adList" rows="5" placeholder="HWTCDE3CE28A&#10;HWTCDE31818A"></textarea></label>
      <div class="row"><button class="btn" id="adPaste">Asignar lista</button><small class="muted" id="adCount"></small></div></div>
    <div class="scan-log" id="adLog"></div></div>`, { wide: true, footer: '<button class="btn primary" data-close>Listo</button>', onClose: () => render() });
  const drv = () => $('#adDrv', m.el).value;
  const drvName = () => ($('#adDrv', m.el).value === 'open' ? 'Abierto' : $('#adDrv', m.el).selectedOptions[0].text.replace(/ \(ya trae.*$/, ''));
  const ref = () => $('#adRef', m.el).value;
  const log = (ok, txt) => $('#adLog', m.el).insertAdjacentHTML('afterbegin', `<div style="${ok ? '' : 'color:var(--bad)'}">${ok ? '✅' : '⛔'} ${txt}</div>`);
  $$('#adMode button', m.el).forEach((b) => (b.onclick = () => { $$('#adMode button', m.el).forEach((x) => x.classList.toggle('on', x === b)); $$('[data-p]', m.el).forEach((p) => (p.hidden = p.dataset.p !== b.dataset.m)); }));

  // --- Elegir del almacén: varios productos y equipos a la vez ---
  let avail = { serialized: [], plain: [] };
  const box = $('#adAvail', m.el);
  const selSN = new Set();
  const selQty = new Map(); // product_id -> qty
  let vis = { ser: [], pl: [], q: '' }; // lo que se ve en la lista (según la búsqueda)
  const updateBar = () => {
    const nP = [...selQty.values()].reduce((a, q) => a + q, 0);
    const parts = [selSN.size ? `${selSN.size} equipo${selSN.size === 1 ? '' : 's'} con S/N` : '', nP ? `${nP} pieza${nP === 1 ? '' : 's'} de ${selQty.size} producto${selQty.size === 1 ? '' : 's'}` : ''].filter(Boolean);
    $('#adSel', m.el).innerHTML = parts.length ? `<b>${parts.join(' + ')}</b>` : 'Nada seleccionado';
    const btn = $('#adPick', m.el);
    btn.disabled = !parts.length;
    btn.innerHTML = `${icon('truck')} Asignar a ${esc(drvName())}`;
  };
  const draw = () => {
    const q = normH($('#adQ', m.el).value);
    const hit = (...t) => !q || t.some((x) => normH(x).includes(q));
    const ser = avail.serialized.map((p) => ({ ...p, list: hit(p.name, p.sku) ? p.serials : p.serials.filter((s) => hit(s.serial, s.tracking_code, s.customer)) })).filter((p) => p.list.length);
    const pl = avail.plain.filter((p) => hit(p.name, p.sku));
    vis = { ser, pl, q };
    box.innerHTML = (ser.map((p) => {
      const on = p.list.filter((s) => selSN.has(s.serial)).length;
      return `<div class="card" style="padding:10px 12px"><div class="row between"><label class="row"><input type="checkbox" data-allp="${p.id}" ${on === p.list.length ? 'checked' : ''} /> <b>${esc(p.name)}</b> <small class="muted">${esc(p.sku)}</small></label>
        <div class="row"><small class="muted">${on}/${p.list.length}</small><input type="number" min="1" max="${p.list.length}" placeholder="Cant." style="width:80px" data-firstn="${p.id}" title="Seleccionar los primeros N" /><button class="btn sm" data-firstgo="${p.id}">Elegir</button></div></div>
        <div style="max-height:220px;overflow:auto;margin-top:6px">${p.list.map((s) => `<label class="row" style="padding:5px 0;border-top:1px solid var(--border)"><input type="checkbox" data-sn="${esc(s.serial)}" ${selSN.has(s.serial) ? 'checked' : ''} /> <span class="mono grow">${esc(s.serial)}</span>
          <small class="muted">${s.status === 'asignado' ? `Pedido ${esc(s.tracking_code || '')}${s.customer ? ' · ' + esc(s.customer) : ''}` : 'Libre'}</small></label>`).join('')}</div></div>`;
    }).join('') + (pl.length ? `<div class="card" style="padding:10px 12px"><b>Productos por cantidad</b><div class="table-wrap"><table><tbody>${pl.map((p) => `<tr><td><label class="row"><input type="checkbox" data-pp="${p.id}" ${selQty.has(p.id) ? 'checked' : ''} /> <span><b>${esc(p.name)}</b><br><small class="muted">${esc(p.sku)} · disponibles: ${p.available} ${esc(p.unit || 'pza')}</small></span></label></td>
        <td class="r"><input type="number" min="1" max="${p.available}" value="${selQty.get(p.id) || 1}" style="width:90px" data-pq="${p.id}" /></td></tr>`).join('')}</tbody></table></div></div>` : '')) ||
      `<p class="muted">${q ? 'Nada coincide con la búsqueda.' : 'No hay inventario disponible en el almacén para asignar.'}</p>`;
    $$('[data-sn]', box).forEach((c) => (c.onchange = () => { c.checked ? selSN.add(c.dataset.sn) : selSN.delete(c.dataset.sn); draw(); }));
    $$('[data-allp]', box).forEach((c) => (c.onchange = () => { const p = ser.find((x) => x.id === Number(c.dataset.allp)); p.list.forEach((s) => (c.checked ? selSN.add(s.serial) : selSN.delete(s.serial))); draw(); }));
    $$('[data-firstgo]', box).forEach((b) => (b.onclick = () => {
      const p = ser.find((x) => x.id === Number(b.dataset.firstgo));
      const n = Math.min(p.list.length, Number($(`[data-firstn="${p.id}"]`, box).value) || 0);
      if (!n) return toast('Escribe cuántos equipos', 'bad');
      p.list.forEach((s) => selSN.delete(s.serial));
      // primero los libres, luego los ya ligados a un pedido
      [...p.list].sort((a, z) => (a.status === 'disponible' ? 0 : 1) - (z.status === 'disponible' ? 0 : 1)).slice(0, n).forEach((s) => selSN.add(s.serial));
      draw();
    }));
    const setQ = (id) => { const pr = avail.plain.find((x) => x.id === id); const inp = $(`[data-pq="${id}"]`, box); let v = Math.trunc(Number(inp.value)) || 1; v = Math.max(1, Math.min(pr.available, v)); inp.value = v; return v; };
    $$('[data-pp]', box).forEach((c) => (c.onchange = () => { const id = Number(c.dataset.pp); c.checked ? selQty.set(id, setQ(id)) : selQty.delete(id); updateBar(); }));
    $$('[data-pq]', box).forEach((i) => (i.oninput = () => { const id = Number(i.dataset.pq); if (!selQty.has(id)) { selQty.set(id, 1); $(`[data-pp="${id}"]`, box).checked = true; } selQty.set(id, setQ(id)); updateBar(); }));
    updateBar();
  };
  const load = async () => { try { avail = await GET('/api/custody/available'); draw(); } catch (e) { box.innerHTML = `<p class="muted">⚠️ ${esc(e.message)}</p>`; } };
  $('#adQ', m.el).oninput = draw;
  $('#adNone', m.el).onclick = () => { selSN.clear(); selQty.clear(); draw(); };
  // todo lo visible: todos los S/N y cada producto por cantidad con todo lo disponible
  $('#adAll', m.el).onclick = () => {
    vis.ser.forEach((p) => p.list.forEach((x) => selSN.add(x.serial)));
    vis.pl.forEach((p) => selQty.set(p.id, p.available));
    draw();
    const n = selSN.size + [...selQty.values()].reduce((a, q) => a + q, 0);
    if (n) toast(`${n} unidades seleccionadas${vis.q ? ' (según la búsqueda)' : ''}`, 'ok');
  };
  $('#adDrv', m.el).onchange = updateBar;
  $('#adPick', m.el).onclick = async (e) => {
    const btn = e.currentTarget;
    const nTot = selSN.size + [...selQty.values()].reduce((a, q) => a + q, 0);
    if (!(await confirmDlg(`¿Asignar ${nTot} unidad${nTot === 1 ? '' : 'es'} a ${drvName()}?`))) return;
    btn.disabled = true;
    try {
      const r = await POST('/api/custody/assign', { driver_id: drv(), serials: [...selSN], items: [...selQty].map(([product_id, qty]) => ({ product_id, qty })), reference: ref() });
      for (const x of r.results) log(x.ok, x.serial ? `<b class="mono">${esc(x.serial)}</b>${x.ok ? ` → ${esc(r.driver)}${x.note ? ' · ' + esc(x.note) : ''}` : ' · ' + esc(x.error)}` : `${x.qty} × ${esc(x.product)} → ${esc(r.driver)}`);
      toast(`${r.assigned} unidades asignadas a ${r.driver}${r.errors.length ? `, ${r.errors.length} con error` : ''}`, r.errors.length ? '' : 'ok');
      selSN.clear(); selQty.clear();
      await load();
    } catch (er) { toast(er.message, 'bad'); updateBar(); }
  };
  load();

  // --- Escanear o pegar S/N ---
  const sendSN = async (list) => {
    const r = await POST('/api/custody/assign', { driver_id: drv(), serials: list, reference: ref() });
    for (const x of r.results) log(x.ok, `<b class="mono">${esc(x.serial)}</b>${x.ok ? ` → ${esc(r.driver)}${x.note ? ' · ' + esc(x.note) : ''}` : ' · ' + esc(x.error)}`);
    load();
    return r;
  };
  $('#adList', m.el).oninput = (e) => { const n = e.target.value.split(/[\r\n,;\t]+/).filter((x) => x.trim()).length; $('#adCount', m.el).textContent = n ? `${n} series en la lista` : ''; };
  excelSerialsInto($('#adList', m.el));
  $('#adPaste', m.el).onclick = async () => {
    const list = $('#adList', m.el).value.split(/[\r\n,;\t]+/).map((x) => x.trim()).filter(Boolean);
    if (!list.length) return toast('Pega al menos una serie', 'bad');
    try { const r = await sendSN(list); toast(`${r.assigned} equipos asignados a ${r.driver}${r.errors.length ? `, ${r.errors.length} con error` : ''}`, r.errors.length ? '' : 'ok'); $('#adList', m.el).value = ''; $('#adCount', m.el).textContent = ''; }
    catch (e) { toast(e.message, 'bad'); }
  };
  $('#adScan', m.el).onclick = () => openScanner({
    title: 'Asignar equipos', continuous: true,
    hint: `Repartidor: ${drvName()}. Cada lectura le asigna un equipo.`,
    onCode: async (code) => { const r = await sendSN([code]); if (!r.assigned) throw new Error(r.errors[0]?.error || 'No asignado'); return `asignado a ${r.driver}`; },
  });
}

function custodyDetail(d) {
  const m = modal(`Inventario de ${d.name}`, `<div class="stack">
    <div class="row between"><b>${d.total} unidades</b><div class="row">${d.open ? '' : `<button class="btn sm" id="cdXls">${icon('download')} Excel</button>`}<button class="btn sm" id="cdAdd">${icon('plus')} Asignar más</button>${d.open ? '' : `<button class="btn sm" id="cdOpen" title="Lo podrá entregar cualquier repartidor">🔓 Pasar a abierto</button>`}<button class="btn sm bad" id="cdAll">Devolver todo al almacén</button></div></div>
    ${d.items.map((it) => `<div class="card" style="padding:12px"><div class="row between"><div><b>${esc(it.name)}</b> <small class="muted">${esc(it.sku)}</small></div><b>${it.qty}</b></div>
      ${it.serialized ? `<div class="table-wrap" style="max-height:220px"><table><tbody>${it.serials.map((s) => `<tr><td class="mono">${esc(s.serial)}</td><td><small class="muted">${s.order ? 'Pedido ' + esc(s.order) : 'Sin pedido'} · desde ${fmtDT(s.since)}</small></td><td class="r"><button class="btn sm" data-ret-sn="${esc(s.serial)}">Devolver</button></td></tr>`).join('')}</tbody></table></div>`
        : `<div class="row" style="margin-top:8px"><input type="number" min="1" max="${it.qty}" value="${it.qty}" style="width:90px" data-ret-qty="${it.product_id}" /><button class="btn sm" data-ret-p="${it.product_id}">Devolver al almacén</button></div>`}</div>`).join('')}
    <div><h3>Movimientos</h3><div class="timeline" id="cdLog"><p class="muted">Cargando…</p></div></div></div>`, { wide: true, footer: '<button class="btn primary" data-close>Cerrar</button>', onClose: () => render() });
  const ret = async (body, msg) => { try { const r = await POST('/api/custody/return', { driver_id: d.id, ...body }); toast(`${r.returned} ${msg}`, 'ok'); m.close(); } catch (e) { toast(e.message, 'bad'); } };
  $('#cdOpen', m.el)?.addEventListener('click', async () => {
    if (!(await confirmDlg(`¿Pasar a "abierto" lo que trae ${d.name} y que aún no está ligado a un pedido? Lo podrá entregar cualquier repartidor.`))) return;
    try {
      const serials = d.items.flatMap((it) => it.serials.filter((x) => !x.order).map((x) => x.serial));
      const plain = d.items.filter((it) => !it.serialized && it.qty > 0);
      let n = 0;
      if (serials.length) n += (await POST('/api/custody/assign', { driver_id: 'open', serials, reference: `Liberado por ${d.name}` })).assigned;
      for (const it of plain) {
        await POST('/api/custody/return', { driver_id: d.id, product_id: it.product_id, qty: it.qty });
        n += (await POST('/api/custody/assign', { driver_id: 'open', items: [{ product_id: it.product_id, qty: it.qty }], reference: `Liberado por ${d.name}` })).assigned;
      }
      toast(`${n} unidades ahora están abiertas para cualquier repartidor`, 'ok'); m.close();
    } catch (e) { toast(e.message, 'bad'); }
  });
  $('#cdXls', m.el)?.addEventListener('click', () => exportAssignedExcel(today(), d.id));
  $('#cdAll', m.el).onclick = async () => { if (await confirmDlg(`¿${d.name} devolvió al almacén todo lo que traía (${d.total} unidades)?`)) ret({ all: true }, 'unidades devueltas al almacén'); };
  $('#cdAdd', m.el).onclick = async () => { m.close(); const [c, p] = await Promise.all([GET('/api/custody'), GET('/api/products?limit=500')]); assignToDriver(c.drivers, p.rows, d.id); };
  $$('[data-ret-sn]', m.el).forEach((b) => (b.onclick = () => ret({ serials: [b.dataset.retSn] }, 'equipo devuelto al almacén')));
  $$('[data-ret-p]', m.el).forEach((b) => (b.onclick = () => ret({ product_id: b.dataset.retP, qty: $(`[data-ret-qty="${b.dataset.retP}"]`, m.el).value }, 'unidades devueltas al almacén')));
  GET(`/api/custody/${d.id}/log`).then((l) => { $('#cdLog', m.el).innerHTML = custodyLogHtml(l); }).catch(() => {});
}
const CUST_ACT = { asignado: ['Recibió', 'ok'], devuelto: ['Devolvió al almacén', ''], entregado: ['Entregó al cliente', 'warn'] };
const custodyLogHtml = (l) => l.map((x) => `<div><b>${CUST_ACT[x.action]?.[0] || esc(x.action)}</b> ${x.serial ? `<span class="mono">${esc(x.serial)}</span>` : `${x.qty} ×`} ${esc(x.product_name)}${x.tracking_code ? ` · pedido <span class="mono">${esc(x.tracking_code)}</span>` : ''}<br><small class="muted">${fmtDT(x.created_at)}${x.by_name ? ' · ' + esc(x.by_name) : ''}${x.reference ? ' · ' + esc(x.reference) : ''}</small></div>`).join('') || '<p class="muted">Sin movimientos</p>';

// Repartidor: lo que trae consigo
async function viewMyStock(v) {
  const r = await GET('/api/my/custody');
  v.innerHTML = topbar('Mi inventario', '', 'Equipos y productos que te entregó el almacén. Al entregar un pedido se descuentan solos.') + `
    <div class="card"><h2 style="margin-top:0">${icon('search')} Buscar producto</h2>
      <form class="row" id="msQ"><input name="q" class="grow" placeholder="Nombre, SKU, código de barras o S/N" autocomplete="off" /><button type="button" class="btn" id="msScan">${icon('scan')}</button><button class="btn primary">Buscar</button></form>
      <div id="msRes" style="margin-top:8px"></div></div>`;
  v.insertAdjacentHTML('beforeend', `
    <div class="grid g2"><div class="card kpi"><div class="label">Unidades que traes</div><div class="value">${r.total || 0}</div></div>
      <div class="card kpi"><div class="label">Productos</div><div class="value">${r.items?.length || 0}</div></div></div>
    ${(r.items || []).map((it) => `<div class="card" style="margin-top:12px"><div class="row between"><div><b>${esc(it.name)}</b><br><small class="muted">${esc(it.sku)}</small></div><b style="font-size:22px">${it.qty}</b></div>
      ${it.serialized ? `<div class="sn-list" style="margin-top:8px">${it.serials.map((s) => `<div class="row between" style="padding:6px 0;border-top:1px solid var(--border)"><span class="mono">${esc(s.serial)}</span><small class="muted">${s.order ? 'Pedido ' + esc(s.order) : 'Libre'}</small></div>`).join('')}</div>` : ''}</div>`).join('') || '<div class="card empty" style="margin-top:12px">No traes inventario asignado. El almacén te lo asigna antes de salir.</div>'}
    ${(r.open_items || []).length ? `<div class="card" style="margin-top:12px"><h2>🔓 Abierto · cualquier repartidor</h2><p class="muted" style="margin-top:0">Inventario que puede entregar cualquiera. Al usarlo en una entrega pasa a ser tuyo.</p>
      ${r.open_items.map((it) => `<div class="row between" style="padding:6px 0;border-top:1px solid var(--border)"><span><b>${esc(it.name)}</b>${it.serialized ? `<br><small class="muted mono">${it.serials.map((x) => esc(x.serial)).join(' · ')}</small>` : ''}</span><b>${it.qty}</b></div>`).join('')}</div>` : ''}
    <div class="card" style="margin-top:12px"><h2>Movimientos</h2><div class="timeline">${custodyLogHtml(r.log || [])}</div></div>`);
  wireStockSearch(v);
}
// Repartidor: buscar producto o S/N y ver dónde está (contigo, abierto, almacén, otro repartidor o entregado)
const SN_WHERE = { tuyo: ['Lo traes tú', 'ok'], abierto: ['🔓 Abierto (puedes entregarlo)', 'ok'], almacen: ['📦 En almacén', ''], otro: ['Lo trae otro repartidor', 'warn'], entregado: ['Entregado', 'off'], baja: ['Dado de baja', 'off'] };
function wireStockSearch(v) {
  const out = $('#msRes', v);
  let t;
  const run = async (q) => {
    q = String(q || '').trim();
    if (q.length < 2) { out.innerHTML = ''; return; }
    out.innerHTML = '<small class="muted">Buscando…</small>';
    try {
      const r = await GET('/api/my/lookup?q=' + encodeURIComponent(q));
      out.innerHTML = (r.serials.map((s) => { const w = SN_WHERE[s.where] || [s.where, '']; return `<div class="row between" style="padding:8px 0;border-top:1px solid var(--border);gap:8px">
          <span><b class="mono">${esc(s.serial)}</b><br><small class="muted">${esc(s.product)}${s.order ? ' · pedido ' + esc(s.order) : ''}${s.customer ? ' · ' + esc(s.customer) : ''}${s.holder ? ' · ' + esc(s.holder) : ''}</small></span>
          <span class="chip ${w[1]}">${w[0]}</span></div>`; }).join('') +
        r.products.map((p) => `<div style="padding:8px 0;border-top:1px solid var(--border)"><div class="row between"><b>${esc(p.name)}</b><small class="muted">${esc(p.sku)}${p.serialized ? ' · con S/N' : ''}</small></div>
          <div class="row" style="gap:6px;margin-top:4px;flex-wrap:wrap"><span class="chip ${p.mine ? 'ok' : ''}">Traes ${p.mine}</span><span class="chip">🔓 Abiertos ${p.open}</span><span class="chip">📦 Almacén ${p.warehouse}</span></div></div>`).join(''))
        || '<p class="muted" style="margin:6px 0 0">No se encontró ningún producto ni número de serie con eso.</p>';
    } catch (e) { out.innerHTML = `<small style="color:var(--bad)">${esc(e.message)}</small>`; }
  };
  const f = $('#msQ', v);
  f.onsubmit = (e) => { e.preventDefault(); run(f.q.value); };
  f.q.oninput = () => { clearTimeout(t); t = setTimeout(() => run(f.q.value), 350); };
  $('#msScan', v).onclick = () => openScanner({ title: 'Buscar producto o S/N', onCode: async (c) => { f.q.value = c; run(c); return 'buscando'; } });
}

const snState = { q: '', status: '', product_id: '' };
async function viewSerials(v) {
  const r = await GET('/api/serials?' + new URLSearchParams({ ...snState, limit: 200 }));
  const st = Object.fromEntries(r.stats.map((x) => [x.status, x.n]));
  v.innerHTML = topbar('Números de serie', `<button class="btn" id="snFind">${icon('search')} Buscar S/N</button><button class="btn primary" id="snRecv">${icon('scan')} Recibir equipos</button>`,
    'Cada equipo por su número de serie: cuándo llegó, a qué pedido se asignó y a quién se entregó.') + `
  <div class="grid g4">${Object.entries(SN_STATUS).map(([k, [l]]) => `<button class="card kpi kpi-btn" data-st="${k}"><div class="label">${l}</div><div class="value">${st[k] || 0}</div></button>`).join('')}</div>
  ${r.products.length ? `<div class="card" style="margin-top:14px"><h2>Productos con control de serie</h2><div class="table-wrap"><table><thead><tr><th>Producto</th><th class="r">Existencia</th><th class="r">Con S/N en almacén</th><th class="r">Sin S/N registrado</th><th></th></tr></thead><tbody>
    ${r.products.map((p) => `<tr><td><b>${esc(p.name)}</b><br><small class="muted">${esc(p.sku)}</small></td><td class="r num">${p.stock}</td><td class="r num">${p.disponibles || 0}</td>
      <td class="r num">${Math.max(0, p.stock - (p.disponibles || 0)) ? `<span class="chip warn">${Math.max(0, p.stock - (p.disponibles || 0))}</span>` : '0'}</td><td class="r"><button class="btn sm" data-recv="${p.id}">Recibir</button></td></tr>`).join('')}
    </tbody></table></div><small class="muted">"Sin S/N registrado" es existencia anterior al control por serie: su número se registra al asignarlo a un pedido.</small></div>`
    : `<div class="info-bar" style="margin-top:14px">${icon('info')} Ningún producto usa número de serie todavía. En <a href="#/inventory">Inventario</a> abre el producto (p. ej. el módem) y activa <b>Controlar por número de serie</b>.</div>`}
  <div class="card" style="margin-top:14px">
    <form class="toolbar" id="snF"><label class="search">${icon('search')}<input name="q" type="search" placeholder="S/N, guía o cliente…" value="${esc(snState.q)}" /></label>
      <select name="product_id"><option value="">Todos los productos</option>${r.products.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>
      <select name="status"><option value="">Todos los estados</option>${Object.entries(SN_STATUS).map(([k, [l]]) => `<option value="${k}">${l}</option>`).join('')}</select></form>
    <div class="table-wrap"><table><thead><tr><th>S/N</th><th>Producto</th><th>Estado</th><th>Pedido / cliente</th><th>Último movimiento</th></tr></thead><tbody>
    ${r.rows.map((s) => `<tr class="click" data-sn="${esc(s.serial)}"><td><b class="mono">${esc(s.serial)}</b></td><td>${esc(s.product_name)}</td><td>${snChip(s.status)}${s.holder_name ? `<br><small class="muted">${icon('truck')} ${esc(s.holder_name)}</small>` : ''}</td>
      <td>${s.tracking_code ? `<span class="mono">${esc(s.tracking_code)}</span><br><small class="muted">${esc(s.customer_name || '')}</small>` : '—'}</td><td><small>${fmtDT(s.updated_at)}</small></td></tr>`).join('') || '<tr><td colspan="5" class="empty">Sin equipos con estos filtros</td></tr>'}
    </tbody></table></div><div class="pager"><small class="muted">${r.rows.length} de ${r.total}</small></div></div>`;
  const f = $('#snF');
  f.product_id.value = snState.product_id; f.status.value = snState.status;
  let t;
  f.oninput = (e) => { clearTimeout(t); t = setTimeout(() => { Object.assign(snState, Object.fromEntries(new FormData(f))); render(); }, e.target.name === 'q' ? 350 : 0); };
  f.onsubmit = (e) => e.preventDefault();
  $$('[data-st]', v).forEach((b) => (b.onclick = () => { snState.status = snState.status === b.dataset.st ? '' : b.dataset.st; render(); }));
  $$('[data-sn]', v).forEach((tr) => (tr.onclick = () => serialDetail(tr.dataset.sn).catch((e) => toast(e.message, 'bad'))));
  $$('[data-recv]', v).forEach((b) => (b.onclick = () => receiveSerials(r.products, b.dataset.recv)));
  $('#snRecv').onclick = () => receiveSerials(r.products);
  $('#snFind').onclick = () => openScanner({ title: 'Buscar número de serie', onCode: async (c) => { await serialDetail(c); } });
  if (snState.q) { const i = f.q; i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
}

// ================= Importación de clientes (Excel / CSV / Sheets) =================
const CUST_FIELDS = [
  ['name', 'Nombre', ['nombre completo', 'nombre', 'cliente', 'razon social', 'titular linea', 'titular']],
  ['phone', 'Teléfono móvil (WhatsApp/SMS)', ['contacto sugerido', 'celular', 'cel registro', 'movil', 'whatsapp', 'telefono celular']],
  ['phone2', 'Celular 2 (si falta el 1)', ['cel registro', 'cel ivr', 'cel queja']],
  ['phone_line', 'Teléfono fijo (se usa como adicional)', ['telefono', 'tel registro', 'linea', 'telefono fijo']],
  ['phone_alt', 'Teléfono adicional', ['contacto alterno', 'telefono alterno']],
  ['email', 'Correo', ['correo sugerido', 'correo', 'email', 'e mail']],
  ['street', 'Calle', ['calle']],
  ['number', 'Número', ['numero', 'num', 'no exterior', 'numero exterior']],
  ['colonia', 'Colonia', ['colonia', 'colonia bdci', 'colonia p c']],
  ['address', 'Domicilio completo (si viene en una sola columna)', ['domicilio', 'direccion', 'address']],
  ['city', 'Ciudad', ['ciudad nombre', 'ciudad', 'municipio']],
  ['zip', 'C.P.', ['cp', 'codigo postal', 'c p']],
  ['reference', 'Referencias', ['referencia', 'referencias', 'entre calles']],
  ['external_id', 'Teléfono Telnor (identifica al cliente)', ['telefono', 'linea', 'cuenta', 'id cliente', 'folio']],
  ['lat', 'Latitud', ['latitud', 'lat']],
  ['lng', 'Longitud', ['longitud', 'lng', 'lon']],
];
const NOTE_HINTS = ['modem serie', 'modem modelo', 'paquete', 'ont inc', 'telefono', 'wifi apagado', 'modelo actual', 'quejas'];
function guessCustMap(headers) {
  const n = headers.map(normH);
  const map = {};
  const used = new Set();
  for (const pass of ['exact', 'partial']) for (const [k, , syn] of CUST_FIELDS) {
    if (map[k] != null) continue;
    const i = n.findIndex((h, idx) => (!used.has(idx) || k === 'external_id' || k === 'phone_line') && h && syn.some((sy) => (pass === 'exact' ? h === sy : h.startsWith(sy) && sy.length > 3)));
    if (i >= 0) { map[k] = i; if (!['external_id', 'phone_line'].includes(k)) used.add(i); }
  }
  return map;
}

// Lee un Excel/CSV y regresa la primera hoja con datos como filas (arreglo de arreglos de texto)
async function readTableFile(file) {
  if (/\.(csv|txt)$/i.test(file.name)) return parseCSVFull(await file.text());
  const X = await loadXLSX();
  const wb = X.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  for (const nm of wb.SheetNames) {
    const t = X.utils.sheet_to_json(wb.Sheets[nm], { header: 1, raw: true, defval: '', blankrows: false }).map((r) => r.map(cellStr));
    if (t.some((r) => r.some((x) => String(x).trim()))) return t;
  }
  return [];
}
const pickFile = (accept = '.xlsx,.xls,.xlsm,.ods,.csv,.txt') => new Promise((ok) => { const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.onchange = () => ok(i.files[0] || null); i.click(); });
// Botón "Subir Excel" junto a una lista de números de serie: toma la columna de S/N (o la primera) y la pega en el cuadro
function excelSerialsInto(textarea) {
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'btn sm'; btn.innerHTML = `${icon('upload')} Subir Excel con S/N`;
  btn.onclick = async () => {
    const f = await pickFile(); if (!f) return;
    try {
      const t = (await readTableFile(f)).filter((r) => r.some((x) => String(x).trim()));
      if (!t.length) return toast('El archivo está vacío', 'bad');
      let col = t[0].findIndex((h) => /serie|s\/?n|serial/i.test(String(h)));
      let rows = t.slice(1);
      if (col < 0) { // sin encabezado: la columna con más valores tipo serie
        const score = (c) => t.filter((r) => /^[A-Z0-9-]{8,}$/i.test(String(r[c] || '').trim())).length;
        col = [...Array(Math.max(...t.map((r) => r.length))).keys()].sort((a, b) => score(b) - score(a))[0] || 0;
        rows = t;
      }
      const list = [...new Set(rows.map((r) => String(r[col] || '').trim()).filter((x) => /^[A-Z0-9-]{6,}$/i.test(x)))];
      if (!list.length) return toast('No encontré números de serie en el archivo', 'bad');
      textarea.value = (textarea.value.trim() ? textarea.value.trim() + '\n' : '') + list.join('\n');
      textarea.dispatchEvent(new Event('input'));
      toast(`${list.length} números de serie tomados de ${f.name}`, 'ok');
    } catch (e) { toast(e.message || 'No se pudo leer el archivo', 'bad'); }
  };
  textarea.closest('label').insertAdjacentElement('afterend', btn);
}

// Asignar (a repartidor) o pasar (a oficina) clientes desde un Excel
async function excelAssign({ mode = 'driver', office = null } = {}) {
  const dr = await GET('/api/users?role=repartidor&active=1&limit=500').catch(() => []);
  const drivers = (Array.isArray(dr) ? dr : dr.rows || []).filter((u) => (u.role === 'repartidor' || u.can_deliver) && u.active);
  const title = mode === 'office' ? `Pasar clientes por Excel a ${office.name}` : 'Asignar a repartidor por Excel';
  const m = modal(title, '<div class="stack" id="eaB"></div>', { wide: true, onClose: () => render() });
  const B = $('#eaB', m.el);
  B.innerHTML = `<label class="drop" id="eaDrop">${icon('upload')}<b>Arrastra el Excel o toca para elegirlo</b>
      <small class="muted">Una fila por cliente. Columna con <b>número de pedido, S/N, teléfono Telnor/móvil o nombre</b>${mode === 'driver' ? ' y, opcional, columna <b>Repartidor</b>' : ''}.</small>
      <input type="file" id="eaF" accept=".xlsx,.xls,.xlsm,.ods,.csv,.txt" hidden /></label>`;
  const drop = $('#eaDrop', B);
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) load(e.dataTransfer.files[0]); };
  $('#eaF', B).onchange = (e) => e.target.files[0] && load(e.target.files[0]);
  let table = [], hr = 0;
  async function load(f) {
    try { table = (await readTableFile(f)).filter((r) => r.some((x) => String(x).trim())); } catch (e) { return toast(e.message || 'No se pudo leer el archivo', 'bad'); }
    if (!table.length) return toast('El archivo está vacío', 'bad');
    const H = table[hr].map((h) => String(h));
    const find = (re) => H.findIndex((h) => re.test(h));
    const refGuess = [/pedido|gu[ií]a|rastreo|tracking/i, /serie|s\/?n|serial/i, /telnor|l[ií]nea|servicio/i, /tel|cel|m[oó]vil/i, /cliente|nombre/i].map(find).find((i) => i >= 0) ?? 0;
    const drvGuess = find(/repartidor|chofer|driver|mensajero/i);
    const opts = (sel) => H.map((h, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>${esc(h || 'Columna ' + (i + 1))}</option>`).join('');
    B.innerHTML = `<p style="margin:0"><b>${esc(f.name)}</b> · ${table.length - 1} filas</p>
      <div class="grid g2"><label class="f">Columna para identificar al cliente<select id="eaRef">${opts(refGuess)}</select></label>
      ${mode === 'driver' ? `<label class="f">Columna del repartidor<select id="eaDrv"><option value="-1">— No viene en el archivo —</option>${opts(drvGuess)}</select></label>` : ''}</div>
      ${mode === 'driver' ? `<div class="grid g2"><label class="f">Repartidor para filas sin repartidor<select id="eaDef"><option value="">— Ninguno —</option>${drivers.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}</select></label>
        <label class="f">Fecha de entrega<input type="date" id="eaDate" value="${today()}" /></label></div>` : ''}
      <label class="row"><input type="checkbox" id="eaHdr" checked /> La primera fila son encabezados</label>
      <div class="row"><button class="btn primary" id="eaChk">Revisar</button></div><div id="eaRes"></div>`;
    $('#eaHdr', B).onchange = () => { hr = $('#eaHdr', B).checked ? 0 : -1; };
    $('#eaChk', B).onclick = check;
  }
  async function check() {
    const rc = Number($('#eaRef', B).value), dc = mode === 'driver' ? Number($('#eaDrv', B).value) : -1;
    const first = $('#eaHdr', B).checked ? 1 : 0;
    const rows = table.slice(first).map((r, i) => ({ line: i + 1 + first, ref: r[rc], driver: dc >= 0 ? r[dc] : '' }));
    let res;
    try { res = await POST('/api/assign/resolve', { rows }); } catch (e) { return toast(e.message, 'bad'); }
    const defId = mode === 'driver' ? Number($('#eaDef', B).value) || null : null;
    const defName = defId ? drivers.find((d) => d.id === defId)?.name : '';
    const R = res.rows.map((r) => (mode === 'driver' && !r.driver_id && !r.driver_error && defId ? { ...r, driver_id: defId, driver_name: defName } : r));
    const ok = R.filter((r) => !r.error && (mode === 'office' || (r.driver_id && r.order_ids.length)));
    const why = (r) => r.error || r.driver_error || (mode === 'driver' && !r.driver_id ? 'Sin repartidor' : mode === 'driver' && !r.order_ids.length ? 'Sin pedidos abiertos' : '');
    $('#eaRes', B).innerHTML = `<div class="row" style="gap:8px;margin:6px 0"><span class="chip ok">${ok.length} listos</span>${R.length - ok.length ? `<span class="chip off">${R.length - ok.length} con problema</span>` : ''}</div>
      <div class="table-wrap" style="max-height:340px"><table><thead><tr><th>Fila</th><th>Referencia</th><th>Cliente</th>${mode === 'driver' ? '<th>Pedidos</th><th>Repartidor</th>' : ''}<th></th></tr></thead><tbody>
      ${R.map((r) => `<tr><td class="num">${r.line}</td><td class="mono">${esc(r.ref)}${r.match ? `<br><small class="muted">por ${esc(r.match)}</small>` : ''}</td><td>${esc(r.customer_name || '')}</td>${mode === 'driver' ? `<td><small>${esc(r.tracking || '')}</small></td><td>${esc(r.driver_name || '')}</td>` : ''}<td>${why(r) ? `<small style="color:var(--bad)">${esc(why(r))}</small>` : '✅'}</td></tr>`).join('')}</tbody></table></div>
      ${ok.length ? `<div class="row" style="margin-top:8px"><button class="btn primary" id="eaGo">${mode === 'driver' ? `Asignar ${ok.length} cliente(s)` : `Pasar ${ok.length} cliente(s) a ${esc(office.name)}`}</button></div>` : ''}`;
    $('#eaGo', B)?.addEventListener('click', async (e) => {
      const btn = e.currentTarget; btn.disabled = true;
      try {
        if (mode === 'office') {
          const r = await POST(`/api/offices/${office.id}/customers`, { ids: [...new Set(ok.map((x) => x.customer_id))] });
          toast(`${r.moved} clientes pasados a ${office.name}`, 'ok');
        } else {
          const by = new Map();
          for (const r of ok) { if (!by.has(r.driver_id)) by.set(r.driver_id, []); by.get(r.driver_id).push(...r.order_ids); }
          const msgs = [];
          for (const [did, ids] of by) {
            try { const r = await POST('/api/routes/assign', { driver_id: did, order_ids: [...new Set(ids)], date: $('#eaDate', B).value }); msgs.push(`${drivers.find((d) => d.id === did)?.name || 'Repartidor'}: ${r.assigned ?? ids.length}`); }
            catch (er) { msgs.push(`${drivers.find((d) => d.id === did)?.name || 'Repartidor'}: ${er.message}`); }
          }
          modal('Asignación por Excel', `<ul>${msgs.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`, { footer: '<button class="btn primary" data-close>Entendido</button>' });
        }
        m.close();
      } catch (er) { toast(er.message, 'bad'); btn.disabled = false; }
    });
  }
}

function importCustomers(opts) {
  const office = opts && opts.office_id ? opts : null;
  let table = null;
  let sourceName = '';
  const m = modal(office ? `Importar clientes a ${office.office_name}` : 'Importar clientes', '<div class="stack" id="ciBody"></div>', { wide: true });
  const body = $('#ciBody', m.el);
  const filled = (r) => r && r.some((x) => String(x ?? '').trim() !== '');
  const step1 = () => {
    body.innerHTML = `<label class="drop" id="ciDrop">${icon('upload')}<b>Arrastra aquí el Excel de clientes o toca para elegirlo</b><small class="muted">Excel (.xlsx, .xls), CSV o la base que te envían · hasta 3,000 clientes</small>
      <input type="file" id="ciFile" accept=".xlsx,.xls,.xlsm,.ods,.csv,.txt" hidden /></label><div id="ciSheet"></div>
      <small class="muted">Los clientes se identifican por la columna que elijas como identificador (p. ej. el teléfono de la línea) para no duplicarlos si vuelves a cargar la base.</small>`;
    const drop = $('#ciDrop', body);
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) read(e.dataTransfer.files[0]); };
    $('#ciFile', body).onchange = (e) => e.target.files[0] && read(e.target.files[0]);
  };
  async function read(file) {
    sourceName = file.name;
    try {
      if (/\.(csv|txt)$/i.test(file.name)) { table = parseCSVFull(await file.text()); return step2(); }
      const X = await loadXLSX();
      const wb = X.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      const pick = (nm) => { table = X.utils.sheet_to_json(wb.Sheets[nm], { header: 1, raw: true, defval: '', blankrows: true }).map((r) => r.map(cellStr)); sourceName = `${file.name} · ${nm}`; step2(); };
      if (wb.SheetNames.length === 1) return pick(wb.SheetNames[0]);
      $('#ciSheet', body).innerHTML = `<label class="f">¿Qué hoja tiene los clientes?<select id="ciSel">${wb.SheetNames.map((s) => `<option>${esc(s)}</option>`).join('')}</select></label><div><button class="btn primary" id="ciGo">Continuar</button></div>`;
      $('#ciGo', body).onclick = () => pick($('#ciSel', body).value);
    } catch (e) { toast(e.message || 'No se pudo leer el archivo', 'bad'); }
  }
  const step2 = async () => {
    if (!table || table.filter(filled).length < 2) return toast('No se encontraron datos', 'bad');
    let hr = table.findIndex(filled);
    for (let i = 0; i < Math.min(12, table.length); i++) if (filled(table[i]) && Object.keys(guessCustMap(table[i])).length >= 3) { hr = i; break; }
    const headers = table[hr];
    const map = guessCustMap(headers);
    const data = table.slice(hr + 1);
    const nh = headers.map(normH);
    const noteCols = nh.map((h, i) => (NOTE_HINTS.includes(h) ? i : -1)).filter((i) => i >= 0);
    const products = (await GET('/api/products?limit=500')).rows;
    const accounts = (await GET('/api/accounts').catch(() => ({ rows: [] }))).rows.filter((a) => a.active);
    const tomorrow = new Date(Date.now() + 864e5).toLocaleDateString('en-CA');
    const opt = (k) => `<option value="">— No usar —</option>${headers.map((h, i) => `<option value="${i}" ${map[k] === i ? 'selected' : ''}>${esc(h || 'Columna ' + (i + 1))}</option>`).join('')}`;
    body.innerHTML = `<div class="row between"><div><b>${esc(sourceName)}</b><br><small class="muted">${data.filter(filled).length} clientes · encabezados en la fila ${hr + 1}</small></div><button class="btn sm" id="ciBack">Cambiar archivo</button></div>
      <h3 style="margin:4px 0 0">¿Qué columna corresponde a cada dato?</h3>
      <div class="map-grid">${CUST_FIELDS.map(([k, l]) => `<label class="f">${l}<select data-cm="${k}">${opt(k)}</select></label>`).join('')}</div>
      <details class="card" style="padding:10px 12px"><summary><b>Columnas que se guardan en notas del cliente</b> <small class="muted">(${noteCols.length} elegidas)</small></summary>
        <div class="note-cols">${headers.map((h, i) => (h ? `<label class="check-pill"><input type="checkbox" data-note="${i}" ${noteCols.includes(i) ? 'checked' : ''} /> ${esc(h)}</label>` : '')).join('')}</div></details>
      <fieldset><legend>${icon('box')} Pedido de entrega para cada cliente</legend>
        <label class="row"><input type="checkbox" id="ciOrd" checked /> Crear un pedido por cliente</label>
        <div class="grid g3" id="ciOrdBox">
          <label class="f">Producto a entregar<select id="ciProd"><option value="">— Sin producto —</option>${products.map((p) => `<option value="${p.id}">${esc(p.name)}${p.serialized ? ' (con S/N)' : ''} · existencia ${p.stock}</option>`).join('')}</select></label>
          <label class="f">Cantidad por cliente<input id="ciQty" type="number" min="1" value="1" /></label>
          <label class="f">Fecha de entrega<input id="ciDate" type="date" value="${tomorrow}" /></label></div>
        <label class="f">Mayorista (empresa que nos envía estas entregas)<select id="ciAcc"><option value="">— Sin mayorista —</option>${accounts.map((a) => `<option value="${a.id}" ${accounts.length === 1 ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>
        <label class="f">Nota para el repartidor<input id="ciNote" placeholder="Ej. Cambio de módem: recoger el equipo anterior" /></label>
        <label class="switch"><input type="checkbox" id="ciNotify" /><span></span><div><b>Avisar a los clientes ahora</b><br><small class="muted">Apagado: no se envía nada al crear; reciben sus avisos cuando el repartidor cargue y salga a entregar. Recomendado para cargas grandes o fuera de horario.</small></div></label></fieldset>
      <div class="row" style="justify-content:flex-end"><button class="btn primary" id="ciPrev">${icon('search')} Revisar antes de importar</button></div>`;
    $('#ciBack', body).onclick = step1;
    $('#ciOrd', body).onchange = (e) => ($('#ciOrdBox', body).hidden = !e.target.checked);
    $('#ciPrev', body).onclick = async (e) => {
      const mp = Object.fromEntries($$('[data-cm]', body).filter((s) => s.value !== '').map((s) => [s.dataset.cm, Number(s.value)]));
      if (mp.name == null) return toast('Elige la columna del nombre', 'bad');
      if (mp.street == null && mp.address == null) return toast('Elige la columna de calle o de domicilio', 'bad');
      const notesIdx = $$('[data-note]:checked', body).map((x) => Number(x.dataset.note));
      const rows = data.map((r, i) => {
        if (!filled(r)) return null;
        const o = { __line: hr + i + 2 };
        for (const [k, idx] of Object.entries(mp)) o[k] = r[idx] ?? '';
        const extra = notesIdx.map((idx) => (String(r[idx] ?? '').trim() ? `${headers[idx]}: ${String(r[idx]).trim()}` : '')).filter(Boolean);
        if (extra.length) o.notes = extra.join(' · ');
        return o;
      }).filter(Boolean);
      const orders = $('#ciOrd', body).checked ? { create: true, account_id: $('#ciAcc', body).value || null, product_id: $('#ciProd', body).value || null, qty: $('#ciQty', body).value, scheduled_date: $('#ciDate', body).value, notes: $('#ciNote', body).value, notify: $('#ciNotify', body).checked } : { create: false };
      const btn = e.currentTarget;
      btn.disabled = true;
      try { step3(rows, orders, await POST('/api/customers/import', { rows, orders, dry_run: true, office_id: office?.office_id })); }
      catch (er) { toast(er.message, 'bad'); btn.disabled = false; }
    };
  };
  const ACT = { nuevo: ['Nuevo', 'ok'], actualizado: ['Actualizar', 'warn'], existente: ['Ya existe', ''], error: ['Error', 'off'] };
  const step3 = (rows, orders, r, done = false) => {
    const s = r.summary;
    const shortStock = orders.product_id && s.stock_disponible != null && done === false && s.stock_disponible < 0;
    body.innerHTML = `${done ? `<div class="info-bar" style="background:var(--ok-soft);color:var(--ok)">${icon('check')} <b>Importación terminada.</b> ${s.sin_ubicacion ? `Se están ubicando en el mapa ${s.sin_ubicacion} domicilio(s) en segundo plano (≈1 por segundo).` : ''}</div>` : `<div class="info-bar">${icon('info')} Vista previa: todavía no se ha guardado nada.</div>`}
      <div class="imp-sum"><div class="kpi card"><div class="label">Filas</div><div class="value">${s.total}</div></div><div class="kpi card"><div class="label">Nuevos</div><div class="value" style="color:var(--ok)">${s.nuevos}</div></div>
        <div class="kpi card"><div class="label">Actualizar</div><div class="value" style="color:var(--warn)">${s.actualizados}</div></div><div class="kpi card"><div class="label">Pedidos</div><div class="value">${s.pedidos}</div></div>
        <div class="kpi card"><div class="label">Errores</div><div class="value" style="color:${s.errores ? 'var(--bad)' : 'inherit'}">${s.errores}</div></div></div>
      ${orders.create && orders.product_id ? `<small class="muted">Existencia del producto después de importar: <b>${s.stock_disponible}</b> (se usan ${s.stock_necesario}).</small>` : ''}
      ${orders.create && !orders.notify ? '<small class="muted">🔕 No se avisará a los clientes al crear los pedidos.</small>' : ''}
      <div class="table-wrap" style="max-height:320px"><table><thead><tr><th>Fila</th><th>Cliente</th><th>Domicilio</th><th>Resultado</th><th>Pedido</th></tr></thead><tbody>
        ${r.results.slice(0, 300).map((x) => `<tr><td class="num">${x.line}</td><td><b>${esc(x.name || '')}</b><br><small class="muted">${esc(x.phone || '')}</small></td><td><small>${esc(x.address || '')}</small></td>
          <td><span class="chip ${ACT[x.action][1]}">${ACT[x.action][0]}</span>${x.error ? `<br><small style="color:var(--bad)">${esc(x.error)}</small>` : ''}</td><td><small class="mono">${esc(x.order || '')}</small></td></tr>`).join('')}
      </tbody></table></div>
      <div class="row" style="justify-content:flex-end">${done ? '<button class="btn primary" data-close>Listo</button>' : `<button class="btn" id="ciBack2">Volver</button><button class="btn primary" id="ciDo" ${s.nuevos + s.actualizados + s.pedidos ? '' : 'disabled'}>${icon('upload')} Importar</button>`}</div>`;
    $('#ciBack2', body)?.addEventListener('click', step2);
    $('#ciDo', body)?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true; btn.textContent = 'Importando…';
      try { const res = await POST('/api/customers/import', { rows, orders, dry_run: false, office_id: office?.office_id }); toast(`${res.summary.nuevos} clientes nuevos, ${res.summary.pedidos} pedidos`, 'ok'); step3(rows, orders, res, true); m.el.dataset.done = '1'; }
      catch (er) { toast(er.message, 'bad'); btn.disabled = false; btn.textContent = 'Importar'; }
    });
    if (shortStock) toast('La existencia del producto no alcanza', 'bad');
  };
  m.el.addEventListener('click', (e) => { if (m.el.dataset.done && (e.target === m.el || e.target.closest('[data-close]'))) setTimeout(render, 50); });
  step1();
}
const GEO_Q = { exacta: ['Ubicación exacta', 'ok'], calle: ['Aprox. por calle', 'warn'], colonia: ['Aprox. por colonia', 'warn'], repartidor: ['Confirmada por el repartidor', 'ok'], ciudad: ['Aprox. centro de la ciudad (corrígela)', 'warn'], gps_entrega: ['GPS de la entrega', 'ok'], no_encontrada: ['No encontrada', 'off'], archivo: ['Del archivo', 'ok'], manual: ['Manual', 'ok'], pendiente: ['Buscando…', ''] };

// ================= Importación masiva de inventario =================
const IMP_FIELDS = [
  ['serial', 'Número de serie (S/N)', ['numero de serie', 'num serie', 'no serie', 'no de serie', 'n serie', 'serie', 's n', 'sn', 'serial', 'serial number', 'serie equipo', 'ns']],
  ['sku', 'SKU / clave', ['sku', 'clave', 'codigo interno', 'cve', 'clave producto', 'id producto', 'codigo producto', 'numero de parte', 'no parte', 'codigo', 'material']],
  ['barcode', 'Código de barras', ['codigo de barras', 'cod barras', 'codigobarras', 'barcode', 'ean', 'upc', 'ean13', 'gtin']],
  ['name', 'Nombre', ['nombre', 'producto', 'nombre producto', 'articulo', 'name', 'descripcion corta', 'modelo', 'texto breve', 'equipo']],
  ['description', 'Descripción', ['descripcion', 'detalle', 'description', 'descripcion larga']],
  ['unit', 'Unidad', ['unidad', 'um', 'u m', 'unidad de medida', 'unit']],
  ['stock', 'Existencia', ['existencia', 'existencias', 'stock', 'cantidad', 'inventario', 'qty', 'piezas', 'disponible', 'stock actual']],
  ['min_stock', 'Mínimo', ['minimo', 'stock minimo', 'min', 'punto de reorden', 'reorden', 'existencia minima']],
  ['location', 'Ubicación', ['ubicacion', 'almacen', 'rack', 'pasillo', 'location', 'anaquel']],
  ['weight_kg', 'Peso (kg)', ['peso', 'peso kg', 'kg', 'weight', 'peso unitario']],
];
// prefijos de fabricante de ONT/módems (Huawei, ZTE, Nokia/Alcatel, FiberHome, TP-Link, Sercomm…)
const ONT_SN = /^(S\/?N[:\s]*)?(HWTC|ZTEG|ZTE|ALCL|NOKG|FHTT|TPLG|SCOM|GPON|ZNTS|MSTC|CIOT|DSNW|ITBS|UBNT|VSOL|HALN)[A-Z0-9-]{4,}$/i;
const SN_LIKE =/^(S\/?N[:\s]*)?[A-Z0-9]{2,}[A-Z0-9._/-]{4,62}$/i;
const normH = (h) => String(h ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
function guessMap(headers) {
  const n = headers.map(normH);
  const map = {};
  const used = new Set();
  // primero coincidencias exactas, luego parciales (y "código de barras" antes que "código")
  for (const pass of ['exact', 'partial']) {
    for (const [k, , syn] of [...IMP_FIELDS].sort((a, b) => ({ serial: 0, barcode: 1 }[a[0]] ?? 2) - ({ serial: 0, barcode: 1 }[b[0]] ?? 2))) {
      if (map[k] != null) continue;
      const i = n.findIndex((h, idx) => !used.has(idx) && h && syn.some((sy) => (pass === 'exact' ? h === sy : sy.length > 2 && (' ' + h + ' ').includes(' ' + sy + ' '))));
      if (i >= 0) { map[k] = i; used.add(i); }
    }
  }
  return map;
}
// CSV con comillas, comas o tabuladores (lo que exporta Excel y Google Sheets)
function parseCSVFull(text) {
  text = String(text).replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0] || '';
  const sep = first.includes('\t') ? '\t' : (first.split(';').length > first.split(',').length ? ';' : ',');
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
let xlsxLib = null;
function loadXLSX() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (xlsxLib) return xlsxLib;
  xlsxLib = new Promise((ok, fail) => {
    const sc = document.createElement('script');
    sc.src = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
    sc.onload = () => ok(window.XLSX);
    sc.onerror = () => { xlsxLib = null; fail(new Error('No se pudo cargar el lector de Excel. Revisa tu conexión o guarda el archivo como CSV.')); };
    document.head.appendChild(sc);
  });
  return xlsxLib;
}
const cellStr = (v) => (v == null ? '' : typeof v === 'number' && Number.isInteger(v) ? String(v) : v instanceof Date ? v.toISOString().slice(0, 10) : String(v));
function downloadTemplate() {
  const rows = [['SKU', 'Código de barras', 'Nombre', 'Descripción', 'Unidad', 'Existencia', 'Mínimo', 'Ubicación', 'Peso (kg)'],
    ['MOD-ONT-01', '7501234567890', 'Módem ONT fibra', 'Equipo para instalación', 'pza', '25', '5', 'A1-01', '0.6'],
    ['CAB-UTP-5', '7501234567891', 'Cable UTP 5 m', '', 'pza', '120', '30', 'B2-03', '0.2']];
  const csv = '﻿' + rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = 'plantilla_inventario.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function importInventory() {
  let table = null; // array de filas (arrays)
  let workbook = null;
  let sourceName = '';
  const m = modal('Importar inventario', `<div class="stack" id="impBody"></div>`, { wide: true });
  const body = $('#impBody', m.el);

  const step1 = () => {
    body.innerHTML = `
      <div class="pill-tabs" id="impSrc"><button class="on" data-s="file">${icon('upload')} Excel o CSV</button><button data-s="gs">${icon('sheet')} Google Sheets</button><button data-s="paste">${icon('copy')} Pegar</button></div>
      <div data-p="file" class="stack">
        <label class="drop" id="drop">${icon('upload')}<b>Arrastra aquí tu archivo o toca para elegirlo</b><small class="muted">Excel (.xlsx, .xls), OpenDocument (.ods) o CSV · hasta 5,000 productos</small>
          <input type="file" id="impFile" accept=".xlsx,.xls,.xlsm,.ods,.csv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" hidden /></label>
        <div id="sheetPick"></div></div>
      <div data-p="gs" class="stack" hidden>
        <label class="f">Enlace de la hoja de Google Sheets<input id="gsUrl" value="${esc(SETTINGS.inventory_sheet_url || '')}" placeholder="https://docs.google.com/spreadsheets/d/…/edit#gid=0" /></label>
        <small class="muted">Abre la pestaña con tu inventario y copia el enlace (incluye <code>#gid=</code> de esa pestaña). La hoja debe estar en <b>Compartir → Cualquier persona con el enlace → Lector</b>. El enlace se recuerda para que puedas volver a sincronizar.</small>
        <div><button class="btn primary" id="gsGo">${icon('sheet')} Leer hoja</button></div></div>
      <div data-p="paste" class="stack" hidden>
        <textarea id="impPaste" rows="8" placeholder="Copia las celdas en Excel o Sheets (con la fila de encabezados) y pégalas aquí"></textarea>
        <div><button class="btn primary" id="pasteGo">Continuar</button></div></div>
      <div class="row between"><small class="muted">Columnas reconocidas: SKU, código de barras, nombre, descripción, unidad, existencia, mínimo, ubicación, peso.</small><button class="btn sm" id="tpl">${icon('download')} Plantilla</button></div>`;
    $$('#impSrc button', body).forEach((b) => (b.onclick = () => {
      $$('#impSrc button', body).forEach((x) => x.classList.toggle('on', x === b));
      $$('[data-p]', body).forEach((p) => (p.hidden = p.dataset.p !== b.dataset.s));
    }));
    $('#tpl', body).onclick = downloadTemplate;
    const fileIn = $('#impFile', body);
    const drop = $('#drop', body);
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]); };
    fileIn.onchange = () => fileIn.files[0] && readFile(fileIn.files[0]);
    $('#gsGo', body).onclick = async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true; btn.textContent = 'Leyendo…';
      try {
        const r = await POST('/api/products/import/gsheet', { url: $('#gsUrl', body).value });
        SETTINGS.inventory_sheet_url = $('#gsUrl', body).value;
        table = parseCSVFull(r.csv);
        sourceName = 'Google Sheets';
        step2();
      } catch (er) { toast(er.message, 'bad'); btn.disabled = false; btn.innerHTML = `${icon('sheet')} Leer hoja`; }
    };
    $('#pasteGo', body).onclick = () => {
      table = parseCSVFull($('#impPaste', body).value);
      sourceName = 'Pegado';
      if (table.filter((r) => r.some((x) => String(x).trim() !== '')).length < 2) return toast('Pega al menos la fila de encabezados y una fila de datos', 'bad');
      step2();
    };
  };

  async function readFile(file) {
    if (file.size > 15 * 1024 * 1024) return toast('El archivo es muy grande (máx. 15 MB)', 'bad');
    sourceName = file.name;
    try {
      if (/\.(csv|txt)$/i.test(file.name)) { table = parseCSVFull(await file.text()); return step2(); }
      const X = await loadXLSX();
      workbook = X.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      const names = workbook.SheetNames;
      const pick = (name) => {
        table = X.utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: true, defval: '', blankrows: true }).map((r) => r.map(cellStr));
        sourceName = `${file.name} · ${name}`;
        step2();
      };
      if (names.length === 1) return pick(names[0]);
      $('#sheetPick', body).innerHTML = `<label class="f">Este archivo tiene ${names.length} hojas. ¿Cuál tiene el inventario?<select id="shSel">${names.map((n) => `<option>${esc(n)}</option>`).join('')}</select></label><div><button class="btn primary" id="shGo">Continuar</button></div>`;
      const guess = names.find((n) => /invent|product|existenc|stock|articul/i.test(n));
      if (guess) $('#shSel', body).value = guess;
      $('#shGo', body).onclick = () => pick($('#shSel', body).value);
    } catch (e) { toast(e.message || 'No se pudo leer el archivo', 'bad'); }
  }

  // Paso 2: encabezados y columnas
  const step2 = () => {
    const filled = (r) => r && r.some((x) => String(x).trim() !== '');
    if (!table || table.filter(filled).length < 2) return toast('No se encontraron datos (se necesita encabezado + al menos una fila)', 'bad');
    // fila de encabezados: la primera con al menos 2 columnas reconocidas, dentro de las primeras 10
    let hr = 0;
    hr = table.findIndex(filled);
    for (let i = 0; i < Math.min(12, table.length); i++) if (filled(table[i]) && Object.keys(guessMap(table[i])).length >= 2) { hr = i; break; }
    let headers = table[hr];
    const map = guessMap(headers);
    let data = table.slice(hr + 1);
    // lista de S/N sin encabezado (p. ej. HWTCDE411BBA en la primera fila): todo son datos
    const only = headers.filter((x) => String(x).trim());
    if (!Object.keys(map).length && only.length === 1 && SN_LIKE.test(String(only[0]).trim())) {
      map.serial = headers.findIndex((x) => String(x).trim());
      data = table.slice(hr);
      headers = headers.map((_, i) => 'Columna ' + (i + 1));
      hr = -1;
    }
    // columna de S/N reconocida por su contenido (HWTC…, ZTEG…): valores únicos con prefijo de fabricante de ONT
    if (map.serial == null) {
      const rowsF = data.filter(filled);
      for (let i = 0; i < headers.length && rowsF.length >= 2; i++) {
        const vals = rowsF.map((r) => String(r[i] ?? '').trim()).filter(Boolean);
        if (vals.length < Math.max(2, rowsF.length * 0.8)) continue;
        const sn = vals.filter((x) => ONT_SN.test(x)).length;
        if (sn >= vals.length * 0.8 && new Set(vals).size >= vals.length * 0.9) {
          map.serial = i;
          for (const k of Object.keys(map)) if (k !== 'serial' && map[k] === i) delete map[k];
          break;
        }
      }
    }
    // producto al que pertenecen las series: el valor más común de "Categoría" / "Producto" / nombre
    const catIdx = headers.findIndex((h) => /\b(categoria|producto|tipo de equipo)\b/.test(normH(h)));
    const catCol = catIdx >= 0 ? catIdx : map.name;
    const catGuess = catCol == null ? '' : Object.entries(data.filter(filled).reduce((a, r) => { const v = normH(r[catCol]); if (v) a[v] = (a[v] || 0) + 1; return a; }, {})).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    const colOpts = (k) => `<option value="">— No importar —</option>${headers.map((h, i) => `<option value="${i}" ${map[k] === i ? 'selected' : ''}>${esc(h || 'Columna ' + (i + 1))}</option>`).join('')}`;
    body.innerHTML = `
      <div class="row between"><div><b>${esc(sourceName)}</b><br><small class="muted">${data.filter(filled).length} filas de datos · ${hr < 0 ? 'lista sin encabezados' : `encabezados en la fila ${hr + 1}`}</small></div><button class="btn sm" id="back">Cambiar archivo</button></div>
      <h3 style="margin:4px 0 0">¿Qué columna corresponde a cada dato?</h3>
      <div class="map-grid">${IMP_FIELDS.map(([k, l]) => `<label class="f"><span>${l}${k === 'name' ? ' <small class="muted">(obligatorio en nuevos)</small>' : k === 'sku' ? ' <small class="muted">(o código de barras)</small>' : ''}</span><select data-map="${k}">${colOpts(k)}</select></label>`).join('')}</div>
      <fieldset id="snBox" hidden><legend>${icon('tag')} Números de serie</legend>
        <p class="muted" style="margin:0">Cada S/N se registra como un equipo en el almacén y suma 1 a la existencia del producto.</p>
        <label class="f">¿A qué producto pertenecen estas series?<select id="snProd"></select></label>
        <label class="f">Referencia<input id="snRef" value="Importación ${esc(sourceName.split(' · ')[0]).slice(0, 40)} ${today()}" maxlength="80" /></label>
        <div class="grid g2"><label class="f">Almacén<select id="snWh"></select></label>
        <label class="f"><span>${icon('truck')} Entregar de inmediato a repartidor <small class="muted">(opcional)</small></span><select id="snDrv"><option value="">— Dejar en almacén —</option></select></label></div></fieldset>
      <fieldset id="stBox"><legend>${icon('inv')} Existencias</legend>
        <label class="radio"><input type="radio" name="sm" value="reemplazar" checked /> <span><b>Reemplazar</b> por la cantidad del archivo <small class="muted">(conteo físico; se registra un ajuste por la diferencia)</small></span></label>
        <label class="radio"><input type="radio" name="sm" value="sumar" /> <span><b>Sumar</b> la cantidad del archivo <small class="muted">(llegada de mercancía; se registra una entrada)</small></span></label>
        <label class="radio"><input type="radio" name="sm" value="ignorar" /> <span><b>No tocar</b> existencias <small class="muted">(solo catálogo: nombres, ubicaciones, mínimos…)</small></span></label>
        <label class="row" style="margin-top:4px"><input type="checkbox" id="updEx" checked /> Actualizar los productos que ya existen (se buscan por SKU o código de barras)</label>
        <label class="f">Referencia del movimiento<input id="impRef" value="Importación ${esc(sourceName.split(' · ')[0]).slice(0, 40)} ${today()}" maxlength="80" /></label></fieldset>
      <div class="row" style="justify-content:flex-end"><button class="btn primary" id="prev">${icon('search')} Revisar antes de importar</button></div>`;
    $('#back', body).onclick = step1;
    // modo series: si hay columna de S/N, se reciben equipos en vez de crear productos
    const snSel = $('[data-map=serial]', body);
    const syncMode = async () => {
      const on = snSel.value !== '';
      $('#snBox', body).hidden = !on; $('#stBox', body).hidden = on;
      $('#prev', body).innerHTML = on ? `${icon('search')} Revisar series` : `${icon('search')} Revisar antes de importar`;
      if (on && $('#snDrv', body).options.length === 1) fillDriverSelect($('#snDrv', body));
      if (on && !$('#snWh', body).options.length) fillWarehouseSelect($('#snWh', body));
      if (on && !$('#snProd', body).options.length) {
        const ps = (await GET('/api/products?limit=500')).rows;
        const list = [...ps.filter((p) => p.serialized), ...ps.filter((p) => !p.serialized && !p.stock)];
        $('#snProd', body).innerHTML = list.map((p) => `<option value="${p.id}">${esc(p.name)} (${esc(p.sku)})${p.serialized ? '' : ' · se activará el control por S/N'}</option>`).join('');
        const hit = catGuess && list.find((p) => normH(p.name) === catGuess || normH(p.sku) === catGuess);
        if (hit) $('#snProd', body).value = hit.id;
      }
    };
    snSel.onchange = syncMode;
    syncMode();
    $('#prev', body).onclick = async (e) => {
      const mp = Object.fromEntries($$('[data-map]', body).filter((s) => s.value !== '').map((s) => [s.dataset.map, Number(s.value)]));
      if (mp.serial != null) {
        const serials = data.map((r) => String(r[mp.serial] ?? '').trim()).filter(Boolean);
        if (!serials.length) return toast('La columna de S/N está vacía', 'bad');
        const opts = { product_id: $('#snProd', body).value, reference: $('#snRef', body).value, enable_serial: true, driver_id: $('#snDrv', body).value || null, warehouse_id: $('#snWh', body).value || null };
        const btn = e.currentTarget;
        btn.disabled = true;
        try { stepSerials(serials, opts, await POST('/api/serials/receive', { serials, ...opts, dry_run: true })); }
        catch (er) { toast(er.message, 'bad'); btn.disabled = false; }
        return;
      }
      if (mp.sku == null && mp.barcode == null) return toast('Elige la columna de SKU o la de código de barras (o la de número de serie si es una lista de equipos)', 'bad');
      const rows = data.map((r, i) => {
        const o = { __line: hr + i + 2 };
        for (const [k, idx] of Object.entries(mp)) o[k] = r[idx] ?? '';
        return o;
      }).filter((o) => Object.entries(o).some(([k, v]) => k !== '__line' && String(v).trim() !== ''));
      const opts = { stock_mode: $('input[name=sm]:checked', body).value, update_existing: $('#updEx', body).checked, reference: $('#impRef', body).value };
      const btn = e.currentTarget;
      btn.disabled = true;
      try { step3(rows, opts, await POST('/api/products/import', { rows, ...opts, dry_run: true })); }
      catch (er) { toast(er.message, 'bad'); btn.disabled = false; }
    };
  };

  // Paso 3 (series): vista previa y recepción de equipos
  const stepSerials = (serials, opts, r, done = false) => {
    const bad = r.results.filter((x) => !x.ok);
    const okN = r.results.length - bad.length;
    body.innerHTML = `
      ${done ? `<div class="info-bar" style="background:var(--ok-soft);color:var(--ok)">${icon('check')} <b>Listo: ${r.received} equipos recibidos${r.driver ? ` y entregados a ${esc(r.driver)}` : ''}.</b> Existencia actual de ${esc(r.product)}: <b>${r.stock}</b>.</div>` : `<div class="info-bar">${icon('info')} Vista previa: todavía no se ha guardado nada.</div>`}
      <div class="imp-sum"><div class="kpi card"><div class="label">Series en el archivo</div><div class="value">${r.results.length}</div></div>
        <div class="kpi card"><div class="label">${done ? 'Recibidas' : 'Se recibirán'}</div><div class="value" style="color:var(--ok)">${done ? r.received : okN}</div></div>
        <div class="kpi card"><div class="label">Con error</div><div class="value" style="color:${bad.length ? 'var(--bad)' : 'inherit'}">${bad.length}</div></div></div>
      <p class="muted" style="margin:0">Producto: <b>${esc(r.product)}</b>${r.will_enable ? ' · se activará el control por número de serie' : ''}${r.driver ? ` · ${icon('truck')} se entregarán a <b>${esc(r.driver)}</b>` : ' · quedan en el almacén'}</p>
      ${bad.length ? `<div class="table-wrap" style="max-height:260px"><table><thead><tr><th>S/N</th><th>Motivo</th></tr></thead><tbody>${bad.slice(0, 300).map((x) => `<tr><td class="mono">${esc(x.serial)}</td><td style="color:var(--bad)">${esc(x.error)}</td></tr>`).join('')}</tbody></table></div>` : ''}
      <div class="row" style="justify-content:flex-end">${done ? `${r.driver ? '' : `<button class="btn" id="toDrvNow">${icon('truck')} Asignar a repartidor</button>`}<button class="btn primary" data-close>Listo</button>` : `<button class="btn" id="back3">Volver</button><button class="btn primary" id="doSn" ${okN ? '' : 'disabled'}>${icon('upload')} Recibir ${okN} equipo${okN === 1 ? '' : 's'}</button>`}</div>`;
    $('#back3', body)?.addEventListener('click', step2);
    $('#toDrvNow', body)?.addEventListener('click', async () => { m.close(); const [c, ps] = await Promise.all([GET('/api/custody'), GET('/api/products?limit=500')]); assignToDriver(c.drivers, ps.rows); });
    $('#doSn', body)?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true; btn.textContent = 'Registrando…';
      try {
        const res = await POST('/api/serials/receive', { serials, ...opts });
        toast(`${res.received} equipos recibidos`, 'ok');
        stepSerials(serials, opts, res, true);
        m.onDone = true;
      } catch (er) { toast(er.message, 'bad'); btn.disabled = false; }
    });
  };

  // Paso 3: vista previa calculada por el servidor (sin guardar) y confirmación
  const ACT = { nuevo: ['Nuevo', 'ok'], actualizado: ['Actualizar', 'warn'], 'sin cambios': ['Sin cambios', ''], error: ['Error', 'off'] };
  const step3 = (rows, opts, r, done = false) => {
    const s = r.summary;
    let filter = s.errores ? 'error' : '';
    const draw = () => {
      const list = r.results.filter((x) => !filter || x.action === filter);
      $('#impRows', body).innerHTML = list.slice(0, 300).map((x) => `<tr><td class="num">${x.line}</td><td><b class="mono">${esc(x.sku || '')}</b></td><td>${esc(x.name || '')}</td>
        <td><span class="chip ${ACT[x.action][1]}">${ACT[x.action][0]}</span>${x.error ? `<br><small style="color:var(--bad)">${esc(x.error)}</small>` : x.note ? `<br><small class="muted">${esc(x.note)}</small>` : ''}</td>
        <td class="r num">${x.action === 'error' ? '—' : x.stock_before === x.stock_after ? x.stock_after ?? '—' : `${x.stock_before} → <b>${x.stock_after}</b>`}</td></tr>`).join('') +
        (list.length > 300 ? `<tr><td colspan="5" class="muted center">… y ${list.length - 300} filas más</td></tr>` : '') ||
        '<tr><td colspan="5" class="muted center">Sin filas en este filtro</td></tr>';
      $$('[data-f]', body).forEach((b) => b.classList.toggle('on', b.dataset.f === filter));
    };
    body.innerHTML = `
      ${done ? `<div class="info-bar" style="background:var(--ok-soft);color:var(--ok)">${icon('check')} <b>Importación terminada.</b> Los movimientos quedaron registrados con la referencia "${esc(opts.reference)}".</div>` : `<div class="info-bar">${icon('info')} Vista previa: todavía no se ha guardado nada.</div>`}
      <div class="imp-sum">
        <button class="kpi card" data-f=""><div class="label">Filas</div><div class="value">${s.total}</div></button>
        <button class="kpi card" data-f="nuevo"><div class="label">Nuevos</div><div class="value" style="color:var(--ok)">${s.nuevos}</div></button>
        <button class="kpi card" data-f="actualizado"><div class="label">${done ? 'Actualizados' : 'A actualizar'}</div><div class="value" style="color:var(--warn)">${s.actualizados}</div></button>
        <button class="kpi card" data-f="sin cambios"><div class="label">Sin cambios</div><div class="value">${s.sin_cambios}</div></button>
        <button class="kpi card" data-f="error"><div class="label">Con error</div><div class="value" style="color:${s.errores ? 'var(--bad)' : 'inherit'}">${s.errores}</div></button>
      </div>
      <div class="table-wrap" style="max-height:340px"><table><thead><tr><th>Fila</th><th>SKU</th><th>Producto</th><th>Resultado</th><th class="r">Existencia</th></tr></thead><tbody id="impRows"></tbody></table></div>
      ${s.errores && !done ? '<small class="muted">Las filas con error no se importan; el resto sí. Corrige el archivo y vuelve a cargarlo si las necesitas.</small>' : ''}
      <div class="row" style="justify-content:flex-end">${done ? `<button class="btn" id="toDrvNow2">${icon('truck')} Asignar a repartidor</button><button class="btn primary" data-close>Listo</button>` : `<button class="btn" id="back2">Volver</button><button class="btn primary" id="doImp" ${s.nuevos + s.actualizados ? '' : 'disabled'}>${icon('upload')} Importar ${s.nuevos + s.actualizados} producto${s.nuevos + s.actualizados === 1 ? '' : 's'}</button>`}</div>`;
    $$('[data-f]', body).forEach((b) => (b.onclick = () => { filter = b.dataset.f; draw(); }));
    draw();
    $('#back2', body)?.addEventListener('click', step2);
    $('#toDrvNow2', body)?.addEventListener('click', async () => { m.close(); const [c, ps] = await Promise.all([GET('/api/custody'), GET('/api/products?limit=500')]); assignToDriver(c.drivers, ps.rows); });
    $('#doImp', body)?.addEventListener('click', async (e) => {
      const btn = e.currentTarget; // después de confirmar (await), e.currentTarget ya es null
      if (opts.stock_mode === 'reemplazar' && !(await confirmDlg('Las existencias de los productos del archivo se reemplazarán por las cantidades del archivo. ¿Continuar?'))) return;
      btn.disabled = true;
      btn.textContent = 'Importando…';
      try {
        const res = await POST('/api/products/import', { rows, ...opts, dry_run: false });
        toast(`Inventario actualizado: ${res.summary.nuevos} nuevos, ${res.summary.actualizados} actualizados`, 'ok');
        step3(rows, opts, res, true);
        m.onDone = true;
      } catch (er) { toast(er.message, 'bad'); btn.disabled = false; btn.textContent = 'Importar'; }
    });
  };
  const close0 = m.close;
  m.el.addEventListener('click', (e) => { if (m.onDone && (e.target === m.el || e.target.closest('[data-close]'))) setTimeout(render, 50); });
  step1();
  return close0;
}

// Inventario en listado: una fila por equipo, con filtros y descarga a Excel
const LOC_TYPES = { almacen: ['Almacén', 'ok'], repartidor: ['Con repartidor', 'warn'], abierto: ['Abierto', 'warn'], entregado: ['Entregado', ''], baja: ['Baja', 'off'] };
async function viewInventoryList(v) {
  const { rows } = await GET('/api/inventory/list');
  const st = { q: '', prod: '', loc: '', place: '', status: '' };
  const prods = [...new Map(rows.map((r) => [r.product_id, r.product])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const places = [...new Set(rows.filter((r) => r.loc_type !== 'entregado').map((r) => r.location))].sort();
  v.innerHTML = topbar('Inventario', `<a class="btn" href="#/inventory">${icon('inv')} Vista resumen</a><button class="btn primary" id="ilXls">${icon('upload')} Descargar Excel</button>`, 'Listado de todo el inventario: un renglón por equipo con número de serie.') + `
  <div class="card">
    <div class="row" style="gap:8px;flex-wrap:wrap;margin-bottom:10px">
      <input id="ilQ" class="grow" placeholder="Número de serie, producto, pedido o cliente" style="min-width:220px" autocomplete="off" />
      <select id="ilP" style="max-width:220px"><option value="">Todos los productos</option>${prods.map(([id, n]) => `<option value="${id}">${esc(n)}</option>`).join('')}</select>
      <select id="ilL" style="max-width:180px"><option value="">Todas las ubicaciones</option>${Object.entries(LOC_TYPES).map(([k, [l]]) => `<option value="${k}" ${k === 'entregado' ? '' : ''}>${l}</option>`).join('')}</select>
      <select id="ilW" style="max-width:220px"><option value="">Cualquier lugar</option>${places.map((x) => `<option>${esc(x)}</option>`).join('')}</select>
      <label class="row"><input type="checkbox" id="ilDone" /> Incluir entregados</label>
    </div>
    <div class="row" id="ilSum" style="gap:8px;flex-wrap:wrap;margin-bottom:8px"></div>
    <div class="table-wrap" style="max-height:70vh"><table><thead><tr><th>#</th><th>Número de serie</th><th>Producto</th><th>Ubicación</th><th>Estado</th><th>Pedido / cliente</th><th class="r">Cant.</th><th>Actualizado</th></tr></thead><tbody id="ilBody"></tbody></table></div>
    <small class="muted" id="ilMore"></small>
  </div>`;
  const filt = () => {
    const q = st.q.toLowerCase();
    return rows.filter((r) => (!st.prod || String(r.product_id) === st.prod) && (!st.loc || r.loc_type === st.loc) && (!st.place || r.location === st.place)
      && (st.done || st.loc === 'entregado' || r.loc_type !== 'entregado')
      && (!q || `${r.serial} ${r.product} ${r.sku || ''} ${r.order || ''} ${r.customer || ''} ${r.location}`.toLowerCase().includes(q)));
  };
  const draw = () => {
    const list = filt();
    const by = {}; list.forEach((r) => (by[r.loc_type] = (by[r.loc_type] || 0) + r.qty));
    $('#ilSum').innerHTML = `<span class="chip"><b>${fmtN(list.reduce((a, r) => a + r.qty, 0))}</b>&nbsp;unidades</span>` + Object.entries(by).map(([k, n]) => `<span class="chip ${LOC_TYPES[k]?.[1] || ''}">${LOC_TYPES[k]?.[0] || k}: <b>${fmtN(n)}</b></span>`).join('');
    const MAX = 1500;
    $('#ilBody').innerHTML = list.slice(0, MAX).map((r, i) => `<tr><td class="num muted">${i + 1}</td><td class="mono">${esc(r.serial || '—')}</td><td>${esc(r.product)}${r.sku ? `<br><small class="muted">${esc(r.sku)}</small>` : ''}</td>
      <td><span class="chip ${LOC_TYPES[r.loc_type]?.[1] || ''}">${LOC_TYPES[r.loc_type]?.[0] || ''}</span><br><small>${esc(r.location)}</small></td>
      <td>${r.serial ? snChip(r.status) : '<small class="muted">sin S/N</small>'}</td><td>${r.order ? `<b>${esc(r.order)}</b><br><small class="muted">${esc(r.customer || '')}</small>` : '<small class="muted">Libre</small>'}</td>
      <td class="r num">${r.qty}</td><td><small class="muted">${r.updated_at ? fmtDT(r.updated_at) : ''}</small></td></tr>`).join('') || '<tr><td colspan="8" class="muted">Nada coincide con los filtros.</td></tr>';
    $('#ilMore').textContent = list.length > MAX ? `Se muestran los primeros ${MAX} de ${list.length}; usa los filtros o descarga el Excel para verlos todos.` : `${list.length} renglones`;
  };
  let t;
  $('#ilQ').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { st.q = e.target.value.trim(); draw(); }, 200); };
  $('#ilP').onchange = (e) => { st.prod = e.target.value; draw(); };
  $('#ilL').onchange = (e) => { st.loc = e.target.value; draw(); };
  $('#ilW').onchange = (e) => { st.place = e.target.value; draw(); };
  $('#ilDone').onchange = (e) => { st.done = e.target.checked; draw(); };
  $('#ilXls').onclick = async () => {
    try {
      const X = await loadXLSX();
      const list = filt();
      const aoa = [['Número de serie', 'Producto', 'SKU', 'Ubicación', 'Lugar', 'Estado', 'Pedido', 'Cliente', 'Cantidad', 'Actualizado'],
        ...list.map((r) => [r.serial, r.product, r.sku || '', LOC_TYPES[r.loc_type]?.[0] || r.loc_type, r.location, r.serial ? SN_STATUS[r.status]?.[0] || r.status : 'Sin S/N', r.order || '', r.customer || '', r.qty, r.updated_at ? fmtDT(r.updated_at) : ''])];
      const ws = X.utils.aoa_to_sheet(aoa);
      ws['!cols'] = [18, 30, 14, 16, 28, 18, 16, 30, 9, 16].map((w) => ({ wch: w }));
      const wb = X.utils.book_new(); X.utils.book_append_sheet(wb, ws, 'Inventario');
      X.writeFile(wb, `inventario-${today()}.xlsx`);
      toast(`${list.length} renglones descargados`, 'ok');
    } catch (e) { toast(e.message || 'No se pudo generar el Excel', 'bad'); }
  };
  draw();
}

async function viewInventory(v) {
  const p = new URLSearchParams(location.hash.split('?')[1] || '');
  if (p.get('view') === 'list') return viewInventoryList(v);
  const q = p.get('q') || '';
  const low = p.get('low') === '1';
  const [r, movs, cust, bd, whs] = await Promise.all([GET(`/api/products?limit=500&q=${encodeURIComponent(q)}&low=${low ? 1 : ''}`), GET('/api/inventory/movements?limit=25'), GET('/api/custody'), GET('/api/inventory/breakdown'), GET('/api/warehouses')]);
  const totalUnits = bd.products.reduce((a, x) => a + x.in_warehouses, 0);
  const outUnits = bd.products.reduce((a, x) => a + x.drivers + x.open, 0);
  const withDrv = cust.drivers.filter((d) => d.total);
  v.innerHTML = topbar('Inventario', `<a class="btn primary" href="#/inventory?view=list">${icon('inv')} Ver en listado</a><button class="btn" id="toDrv">${icon('truck')} Asignar a repartidor</button><button class="btn" id="whXfer">${icon('building')} Traspaso entre almacenes</button><button class="btn" id="scanIn">${icon('scan')} Entrada por escaneo</button><button class="btn" id="scanOut">${icon('scan')} Salida / ajuste</button><a class="btn" href="#/serials">${icon('tag')} Números de serie</a><button class="btn" id="impInv">${icon('upload')} Importar Excel / Sheets</button><button class="btn primary" id="newP">${icon('plus')} Producto</button>`) + `
  <div class="grid g3"><div class="card kpi"><div class="label">Productos</div><div class="value">${r.total}</div></div>
    <button class="card kpi kpi-btn" id="kpiWh" title="Ver dónde está cada unidad"><div class="label">Unidades en almacén</div><div class="value">${fmtN(totalUnits)}</div><div class="sub">${fmtN(outUnits)} fuera · ver detalle ›</div></button>
    <div class="card kpi"><div class="label">Bajo mínimo</div><div class="value" style="color:var(--bad)">${r.rows.filter((x) => x.stock <= x.min_stock).length}</div></div></div>
  <div class="card" style="margin-top:14px"><div class="row between"><h2>${icon('building')} Almacenes</h2><div class="row"><button class="btn sm" id="whStock">${icon('inv')} Existencias por almacén</button><button class="btn sm" id="whXfer2">${icon('truck')} Traspaso</button>${store.user.role === 'admin' ? `<button class="btn sm primary" id="whNew">${icon('plus')} Almacén</button>` : ''}</div></div>
    <div class="grid g3" style="margin-top:8px">${whs.map((w) => `<button class="card kpi-btn" data-wh="${w.id}" style="text-align:left;padding:12px;${w.active ? '' : 'opacity:.55'}"><b>${esc(w.name)}</b>${w.is_default ? ' <span class="chip ok">Principal</span>' : ''}${w.active ? '' : ' <span class="chip off">Inactivo</span>'}
      <br><small class="muted">${esc(w.address || (w.lat ? 'Ubicado en el mapa' : 'Sin ubicación'))}</small><div style="font-size:22px;font-weight:700;margin-top:4px">${fmtN(w.units)} <small class="muted" style="font-size:12px">equipos con S/N</small></div></button>`).join('')}</div></div>
  <div class="card" style="margin-top:14px"><div class="row between"><h2>${icon('truck')} Con repartidores</h2><small class="muted">${fmtN(withDrv.reduce((a, d) => a + d.total, 0))} unidades fuera del almacén</small></div>
    ${withDrv.length ? `<div class="table-wrap"><table><thead><tr><th>Repartidor</th><th>Trae</th><th class="r">Unidades</th><th></th></tr></thead><tbody>
      ${withDrv.map((d) => `<tr class="click" data-cust="${d.id}"><td><b>${esc(d.name)}</b>${d.vehicle ? `<br><small class="muted">${esc(d.vehicle)}</small>` : ''}</td><td><small>${d.items.map((it) => `${esc(it.name)}: <b>${it.qty}</b>`).join(' · ')}</small></td><td class="r num"><b>${d.total}</b></td><td class="r"><button class="btn sm">Ver / devolver</button></td></tr>`).join('')}
    </tbody></table></div>` : '<p class="muted" style="margin:0">Ningún repartidor trae inventario. Usa <b>Asignar a repartidor</b> para entregarle equipos antes de salir.</p>'}</div>
  <div class="grid g-main" style="margin-top:14px">
    <div class="card"><form class="row" id="iq" style="margin-bottom:10px"><input name="q" value="${esc(q)}" placeholder="Número de serie (o nombre, SKU, código de barras)" class="grow" /><label class="row"><input type="checkbox" name="low" value="1" ${low ? 'checked' : ''} /> Solo stock bajo</label><button class="btn">Buscar</button></form>
      <div class="table-wrap"><table><thead><tr><th>Producto</th><th>SKU / Código</th><th>Ubicación</th><th class="r">Stock</th><th class="r">Mín.</th></tr></thead><tbody>
      ${r.rows.map((x) => `<tr class="click" data-p='${esc(JSON.stringify(x))}'><td><b>${esc(x.name)}</b>${x.serialized ? ` <span class="chip" title="Control por número de serie">${icon('tag')} S/N · ${x.serials_available}</span>` : ''}</td><td><small>${esc(x.sku)}<br>${esc(x.barcode || '')}</small></td><td>${esc(x.location || '—')}</td><td class="r num" style="font-weight:700;color:${x.stock <= x.min_stock ? 'var(--bad)' : 'inherit'}">${x.stock}</td><td class="r num">${x.min_stock}</td></tr>`).join('')}
      </tbody></table></div></div>
    <div class="card"><h2>Últimos movimientos</h2><div class="table-wrap" style="max-height:600px"><table><tbody>${movs.map((mv) => `<tr><td><b>${esc(mv.product_name)}</b><br><small class="muted">${esc(mv.type)} · ${esc(mv.reference || '')} · ${fmtDT(mv.created_at)}</small></td><td class="r num" style="color:${mv.qty < 0 ? 'var(--bad)' : 'var(--ok)'};font-weight:700">${mv.qty > 0 ? '+' : ''}${mv.qty}</td></tr>`).join('')}</tbody></table></div></div>
  </div>`;
  $('#iq').onsubmit = (e) => { e.preventDefault(); const f = new FormData(e.target); location.hash = `#/inventory?q=${encodeURIComponent(f.get('q'))}&low=${f.get('low') || ''}`; };
  $('#newP').onclick = () => productForm(null);
  $('#impInv').onclick = importInventory;
  $('#kpiWh').onclick = $('#whStock').onclick = () => stockBreakdown(bd);
  $('#whNew')?.addEventListener('click', () => warehouseForm(null));
  $('#whXfer').onclick = $('#whXfer2').onclick = () => transferDialog(whs);
  $$('[data-wh]', v).forEach((b) => (b.onclick = () => warehouseDetail(Number(b.dataset.wh), whs)));
  $('#toDrv').onclick = () => assignToDriver(cust.drivers, r.rows);
  $$('[data-cust]', v).forEach((tr) => (tr.onclick = () => custodyDetail(cust.drivers.find((d) => String(d.id) === tr.dataset.cust))));
  $$('tr[data-p]', v).forEach((tr) => (tr.onclick = () => productForm(JSON.parse(tr.dataset.p))));
  const snProducts = r.rows.filter((x) => x.serialized);
  const scanMove = (type) => {
    let qtyEl;
    const m = openScanner({
      title: type === 'entrada' ? 'Entrada de mercancía' : 'Salida / ajuste de inventario', continuous: true,
      hint: 'Cada lectura registra el movimiento con la cantidad indicada. Códigos no registrados ofrecen dar de alta el producto.',
      onCode: async (code) => {
        const qty = Number(qtyEl.value) || 1;
        const t = type === 'entrada' ? 'entrada' : $('#mtype', m.el).value;
        try {
          const res = await POST('/api/inventory/movements', { barcode: code, type: t, qty: t === 'ajuste' ? qty : Math.abs(qty), reference: $('#mref', m.el).value || 'Escaneo' });
          return `stock: ${res.stock}`;
        } catch (e) {
          // un número de serie (HWTC…): en entradas se recibe como equipo del producto elegido
          const snProd = $('#msnP', m.el)?.value;
          if (e.status === 404 && type === 'entrada' && snProd && (ONT_SN.test(code) || SN_LIKE.test(code))) {
            const r = await POST('/api/serials/receive', { product_id: snProd, serials: [code], warehouse_id: $('#msnW', m.el)?.value || null, reference: $('#mref', m.el).value || 'Entrada por escaneo' });
            if (!r.received) throw new Error(r.errors[0]?.error || 'No se pudo registrar el equipo');
            return `equipo recibido (${r.product}) · existencia ${r.stock}`;
          }
          if (e.status === 404 && ONT_SN.test(code)) throw new Error(type === 'entrada' ? 'Es un número de serie: activa "Controlar por número de serie" en el producto del módem' : 'Es un número de serie: para sacarlo usa Números de serie (baja) o asígnalo a un repartidor');
          if (e.status === 404) { productForm({ barcode: code }); throw new Error('No registrado: da de alta el producto'); }
          throw e;
        }
      },
      onClose: () => render(),
    });
    m.el.querySelector('.body').insertAdjacentHTML('afterbegin', `<div class="grid g3" style="margin-bottom:12px">
      ${type === 'entrada' ? '' : '<label class="f">Tipo<select id="mtype"><option value="salida">Salida</option><option value="ajuste">Ajuste (+/-)</option><option value="devolucion">Devolución</option></select></label>'}
      <label class="f">Cantidad por lectura<input type="number" id="mqty" value="1" /></label>
      <label class="f">Referencia<input id="mref" placeholder="Factura, OC, motivo…" /></label></div>
      ${type === 'entrada' && snProducts.length ? `<div class="grid g2" style="margin-bottom:12px"><label class="f">Si lees un número de serie, entra como<select id="msnP">${snProducts.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label>
        <label class="f">Almacén<select id="msnW"></select></label></div>` : ''}`);
    qtyEl = $('#mqty', m.el);
    if ($('#msnW', m.el)) fillWarehouseSelect($('#msnW', m.el));
  };
  $('#scanIn').onclick = () => scanMove('entrada');
  $('#scanOut').onclick = () => scanMove('salida');
}

function productForm(p) {
  p = p || {};
  const m = modal(p.id ? 'Editar producto' : 'Nuevo producto', `
    <form id="pf" class="stack">
      <label class="f">Nombre *<input name="name" required value="${esc(p.name)}" /></label>
      <div class="grid g2"><label class="f">SKU *<input name="sku" required value="${esc(p.sku)}" /></label>
        <label class="f">Código de barras<div class="row"><input name="barcode" class="grow" value="${esc(p.barcode)}" /><button type="button" class="btn" id="pscan">${icon('scan')}</button></div></label></div>
      <div class="grid g3">${p.id ? '' : '<label class="f">Stock inicial<input type="number" name="stock" value="0" min="0" /></label>'}
        <label class="f">Stock mínimo<input type="number" name="min_stock" value="${p.min_stock ?? 5}" min="0" /></label>
        <label class="f">Ubicación<input name="location" value="${esc(p.location)}" placeholder="Pasillo-Rack" /></label></div>
      <div class="grid g2"><label class="f">Unidad<input name="unit" value="${esc(p.unit || 'pza')}" /></label><label class="f">Peso (kg)<input type="number" step="0.1" name="weight_kg" value="${p.weight_kg ?? 1}" /></label></div>
      <label class="switch"><input type="checkbox" name="serialized" ${p.serialized ? 'checked' : ''} /><span></span><div><b>Controlar por número de serie</b><br><small class="muted">Para equipos como módems: cada unidad se registra por su S/N al recibirla y se liga al pedido y al cliente que la recibe.</small></div></label>
      ${p.id ? `<p class="muted">Stock actual: <b>${p.stock}</b>${p.serialized ? ` · con S/N en almacén: <b>${p.serials_available ?? 0}</b>` : ''}. Para cambiarlo usa entradas/salidas (queda registro).</p>` : ''}
      ${p.barcode ? '<div class="label-print"><svg id="pbc"></svg></div>' : ''}
    </form>`, { footer: `${p.id ? `<button class="btn bad" id="delP" style="margin-right:auto">${icon('trash')} Eliminar</button>` : ''}<button class="btn" data-close>Cancelar</button><button class="btn primary" id="saveP">Guardar</button>` });
  const f = $('#pf', m.el);
  $('#delP', m.el)?.addEventListener('click', async () => {
    if (!(await confirmDlg(`¿Eliminar el producto "${p.name}" (${p.sku})? Esta acción no se puede deshacer.`))) return;
    try { await api('DELETE', '/api/products/' + p.id); toast('Producto eliminado', 'ok'); m.close(); render(); }
    catch (e) { toast(e.message, 'bad'); }
  });
  if (p.barcode) try { JsBarcode($('#pbc', m.el), p.barcode, { format: /^\d{13}$/.test(p.barcode) ? 'EAN13' : 'CODE128', height: 50 }); } catch {}
  $('#pscan', m.el).onclick = () => openScanner({ title: 'Leer código del producto', onCode: async (c) => { f.barcode.value = c; } });
  $('#saveP', m.el).onclick = async () => {
    if (!f.reportValidity()) return;
    const b = Object.fromEntries(new FormData(f));
    b.serialized = f.serialized.checked;
    try { if (p.id) await PUT('/api/products/' + p.id, b); else await POST('/api/products', b); toast('Producto guardado', 'ok'); m.close(); if (location.hash.startsWith('#/inventory')) render(); }
    catch (e) { toast(e.message, 'bad'); }
  };
}

// ================= Análisis =================
async function viewAnalytics(v) {
  const p = new URLSearchParams(location.hash.split('?')[1] || '');
  const to = p.get('to') || today();
  const from = p.get('from') || new Date(Date.now() - 13 * 864e5).toLocaleDateString('en-CA');
  const a = await GET(`/api/analytics?from=${from}&to=${to}`);
  const t = a.totals;
  const closed = (t.delivered || 0) + (t.failed || 0);
  const maxDay = Math.max(1, ...a.daily.map((d) => d.total));
  const maxDrv = Math.max(1, ...a.byDriver.map((d) => d.assigned));
  const maxReason = Math.max(1, ...a.reasons.map((r) => r.n));
  const saving = a.routes.original_km ? ((a.routes.original_km - a.routes.km) / a.routes.original_km) * 100 : null;
  v.innerHTML = topbar('Análisis y eficiencia', `<form class="row" id="af"><input type="date" name="from" value="${from}" style="width:auto" /><input type="date" name="to" value="${to}" style="width:auto" /><button class="btn">Aplicar</button></form>`) + `
  <div class="grid g4">
    <div class="card kpi"><div class="label">Tasa de éxito</div><div class="value" style="color:var(--ok)">${closed ? fmtN((t.delivered / closed) * 100, 1) + '%' : '—'}</div><div class="sub">${fmtN(t.delivered)} entregados de ${fmtN(closed)} intentos</div></div>
    <div class="card kpi"><div class="label">A tiempo (ventana)</div><div class="value">${a.onTime.n ? fmtN((a.onTime.on_time / a.onTime.n) * 100, 1) + '%' : '—'}</div><div class="sub">de ${fmtN(a.onTime.n)} entregas</div></div>
    <div class="card kpi"><div class="label">Km recorridos (plan)</div><div class="value">${fmtN(a.routes.km, 0)}</div><div class="sub">${fmtN(a.routes.routes)} rutas · ${closed ? fmtN(a.routes.km / closed, 2) : '—'} km/parada</div></div>
    <div class="card kpi"><div class="label">Ahorro por optimización</div><div class="value" style="color:var(--ok)">${saving != null ? fmtN(saving, 1) + '%' : '—'}</div><div class="sub">${fmtN((a.routes.original_km || 0) - (a.routes.km || 0), 0)} km evitados</div></div>
  </div>
  <div class="card" style="margin-top:14px"><div class="row between"><h2>Entregas por día</h2><div class="legend"><span><i style="background:var(--ok)"></i>Entregado</span><span><i style="background:var(--bad)"></i>Fallido</span><span><i style="background:var(--border)"></i>Abierto</span></div></div>
    <div class="cols">${a.daily.map((d) => `<div class="c" title="${d.day}: ${d.delivered} entregados, ${d.failed} fallidos, ${d.total} total">
      <div class="stackbar" style="height:${(d.total / maxDay) * 100}%"><i style="flex:${d.delivered};background:var(--ok)"></i><i style="flex:${d.failed};background:var(--bad)"></i><i style="flex:${d.total - d.delivered - d.failed};background:var(--border)"></i></div>
      <small class="muted num">${d.day.slice(5)}</small></div>`).join('') || '<p class="muted">Sin datos</p>'}</div></div>
  <div class="card" style="margin-top:14px"><h2>Desempeño por repartidor</h2><div class="table-wrap"><table><thead><tr><th>Repartidor</th><th>Volumen</th><th class="r">Entregados</th><th class="r">Fallidos</th><th class="r">Éxito</th><th class="r">Entregas/h</th><th class="r">Km</th><th class="r">Km/entrega</th><th class="r">Desv. GPS</th></tr></thead><tbody>
    ${a.byDriver.map((d) => `<tr><td><b>${esc(d.name)}</b></td><td style="min-width:140px"><div class="progress" style="height:12px"><i style="width:${(d.delivered / maxDrv) * 100}%;background:var(--ok)"></i><i style="width:${(d.failed / maxDrv) * 100}%;background:var(--bad)"></i></div></td>
      <td class="r num">${d.delivered ?? 0}</td><td class="r num">${d.failed ?? 0}</td><td class="r num" style="font-weight:700;color:${d.success_rate != null && d.success_rate < 85 ? 'var(--bad)' : 'var(--ok)'}">${d.success_rate != null ? d.success_rate + '%' : '—'}</td>
      <td class="r num">${fmtN(d.per_hour, 2)}</td><td class="r num">${fmtN(d.km, 1)}</td><td class="r num">${fmtN(d.km_per_delivery, 2)}</td><td class="r num">${d.avg_gps_dev_m != null ? fmtN(d.avg_gps_dev_m) + ' m' : '—'}</td></tr>`).join('')}
  </tbody></table></div><small class="muted">Desv. GPS: distancia promedio entre el punto donde se registró la evidencia y la ubicación del cliente (control de entregas reales).</small></div>
  <div class="grid g2" style="margin-top:14px">
    <div class="card"><h2>Motivos de entrega fallida</h2><div class="bars">${a.reasons.map((r) => `<div class="bar-row"><span>${esc(r.reason)}</span><div class="track"><i style="width:${(r.n / maxReason) * 100}%;background:var(--bad)"></i></div><span class="num r">${r.n}</span></div>`).join('') || '<p class="muted">Sin fallos 🎉</p>'}</div></div>
    <div class="card"><h2>Zonas (código postal)</h2><div class="table-wrap"><table><thead><tr><th>C.P.</th><th class="r">Pedidos</th><th class="r">Éxito</th></tr></thead><tbody>${a.zones.map((z) => { const c = z.delivered + z.failed; return `<tr><td>${esc(z.zone)}</td><td class="r num">${z.total}</td><td class="r num">${c ? fmtN((z.delivered / c) * 100, 1) + '%' : '—'}</td></tr>`; }).join('')}</tbody></table></div></div>
  </div>`;
  $('#af').onsubmit = (e) => { e.preventDefault(); const f = new FormData(e.target); location.hash = `#/analytics?from=${f.get('from')}&to=${f.get('to')}`; };
}

// ================= ADMINISTRACIÓN: Usuarios =================
const PERMS = [
  ['Tablero, pedidos y rutas', 1, 1, 0],
  ['Inventario y clientes', 1, 1, 0],
  ['Análisis y reportes', 1, 1, 0],
  ['Usuarios, actividad y configuración', 1, 0, 0],
  ['Su ruta, carga y entregas (móvil)', 0, 0, 1],
  ['Registrar clientes en campo', 1, 1, 1],
];
const uState = { q: '', role: '', status: '1', page: 0 };
const PAGE = 20;

async function viewUsers(v) {
  const users = await GET('/api/users');
  const me = store.user;
  const isAdmin = me.role === 'admin';
  const cnt = (f) => users.filter(f).length;
  const draw = () => {
    const q = uState.q.toLowerCase();
    const list = users.filter((u) =>
      (!uState.role || u.role === uState.role) &&
      (uState.status === '' || String(u.active) === uState.status) &&
      (!q || `${u.name} ${u.email} ${u.phone || ''} ${u.vehicle || ''}`.toLowerCase().includes(q)));
    const pages = Math.max(1, Math.ceil(list.length / PAGE));
    uState.page = Math.min(uState.page, pages - 1);
    const rows = list.slice(uState.page * PAGE, uState.page * PAGE + PAGE);
    const statusBadge = (u) => u.active ? (u.must_change_password ? '<span class="chip warn">Invitado</span>' : '<span class="chip ok">Activo</span>') : '<span class="chip off">Inactivo</span>';
    $('#uList').innerHTML = !rows.length
      ? `<div class="empty">${icon('users')}<p><b>Sin resultados</b><br>Prueba con otro nombre o quita los filtros.</p></div>`
      : `<div class="table-wrap desk-only"><table><thead><tr><th>Usuario</th><th>Rol</th><th>Teléfono</th><th>Vehículo</th><th class="r">Entregas</th><th>Último acceso</th><th>Estado</th></tr></thead><tbody>
        ${rows.map((u) => `<tr class="click" data-id="${u.id}"><td><div class="ucell">${avatar(u)}<div><b>${esc(u.name)}</b>${u.id === me.id ? ' <small class="muted">(tú)</small>' : ''}<br><small class="muted">${esc(u.email)}</small></div></div></td>
          <td>${roleChip(u.role)}</td><td>${esc(u.phone || '—')}</td><td>${u.role === 'repartidor' ? `${esc(u.vehicle || '—')}<br><small class="muted">${u.capacity} paquetes</small>` : '—'}</td>
          <td class="r num">${u.role === 'repartidor' ? u.delivered : '—'}</td><td><small>${ago(u.last_login)}</small></td><td>${statusBadge(u)}</td></tr>`).join('')}
        </tbody></table></div>
        <div class="ucards mob-only">${rows.map((u) => `<button class="ucard" data-id="${u.id}">${avatar(u, 'lg')}<span class="grow"><b>${esc(u.name)}</b><small class="muted">${esc(u.email)}</small><span class="row" style="margin-top:4px">${roleChip(u.role)} ${statusBadge(u)}</span></span>${icon('chev')}</button>`).join('')}</div>`;
    $('#uPager').innerHTML = list.length > PAGE
      ? `<small class="muted">${uState.page * PAGE + 1}–${Math.min(list.length, (uState.page + 1) * PAGE)} de ${list.length}</small><span class="row"><button class="btn sm" data-pg="-1" ${uState.page ? '' : 'disabled'}>Anterior</button><button class="btn sm" data-pg="1" ${uState.page < pages - 1 ? '' : 'disabled'}>Siguiente</button></span>`
      : `<small class="muted">${list.length} usuario${list.length === 1 ? '' : 's'}</small>`;
    $$('[data-pg]', v).forEach((b) => (b.onclick = () => { uState.page += Number(b.dataset.pg); draw(); }));
    $$('[data-id]', $('#uList')).forEach((el) => (el.onclick = () => (isAdmin ? userPanel(Number(el.dataset.id)) : null)));
  };
  v.innerHTML = topbar('Usuarios', isAdmin ? `<button class="btn" id="impU">${icon('upload')} Importar</button><button class="btn primary" id="newU">${icon('plus')} Nuevo usuario</button>` : '',
    'Da de alta a tu equipo, asigna roles y controla el acceso.') + `
  <div class="grid g4">
    <button class="card kpi kpi-btn" data-f="role:"><div class="label">Total</div><div class="value">${users.length}</div><div class="sub">${cnt((u) => u.active)} activos</div></button>
    <button class="card kpi kpi-btn" data-f="role:repartidor"><div class="label">Repartidores</div><div class="value">${cnt((u) => u.role === 'repartidor' && u.active)}</div><div class="sub">activos</div></button>
    <button class="card kpi kpi-btn" data-f="role:despachador"><div class="label">Despacho y admin</div><div class="value">${cnt((u) => u.role !== 'repartidor' && u.active)}</div><div class="sub">${cnt((u) => u.role === 'admin' && u.active)} administradores</div></button>
    <button class="card kpi kpi-btn" data-f="status:0"><div class="label">Inactivos</div><div class="value">${cnt((u) => !u.active)}</div><div class="sub">${cnt((u) => u.active && u.must_change_password)} sin primer acceso</div></button>
  </div>
  <div class="card" style="margin-top:14px">
    <div class="toolbar">
      <label class="search">${icon('search')}<input id="uq" type="search" placeholder="Buscar por nombre, correo, teléfono…" value="${esc(uState.q)}" /></label>
      <div class="pill-tabs" id="uRole">${[['', 'Todos'], ['admin', 'Admin'], ['despachador', 'Despacho'], ['repartidor', 'Repartidores']].map(([k, l]) => `<button data-r="${k}" class="${uState.role === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <select id="uSt" aria-label="Estado"><option value="1">Activos</option><option value="0">Inactivos</option><option value="">Todos los estados</option></select>
    </div>
    <div id="uList"></div>
    <div class="pager" id="uPager"></div>
  </div>
  <details class="card perms" style="margin-top:14px"><summary>${icon('shield')} ¿Qué puede hacer cada rol?</summary>
    <div class="table-wrap"><table class="perm-table"><thead><tr><th></th><th>${roleChip('admin')}</th><th>${roleChip('despachador')}</th><th>${roleChip('repartidor')}</th></tr></thead><tbody>
    ${PERMS.map(([l, ...p]) => `<tr><td>${l}</td>${p.map((x) => `<td class="c">${x ? `<span class="yes">${icon('check')}</span>` : '<span class="no">—</span>'}</td>`).join('')}</tr>`).join('')}
    </tbody></table></div></details>`;
  $('#uSt').value = uState.status;
  let t;
  $('#uq').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { uState.q = e.target.value; uState.page = 0; draw(); }, 150); };
  $$('#uRole button').forEach((b) => (b.onclick = () => { uState.role = b.dataset.r; uState.page = 0; $$('#uRole button').forEach((x) => x.classList.toggle('on', x === b)); draw(); }));
  $('#uSt').onchange = (e) => { uState.status = e.target.value; uState.page = 0; draw(); };
  $$('[data-f]', v).forEach((b) => (b.onclick = () => {
    const [k, val] = b.dataset.f.split(':');
    if (k === 'role') { uState.role = val; uState.status = '1'; } else { uState.role = ''; uState.status = val; }
    uState.page = 0; render();
  }));
  if (isAdmin) {
    $('#newU').onclick = () => userForm();
    $('#impU').onclick = importUsers;
  }
  draw();
}

function roleCards(sel) {
  return `<div class="role-cards">${Object.keys(ROLE).map((r) => `<label class="role-card"><input type="radio" name="role" value="${r}" ${r === sel ? 'checked' : ''} />
    <span>${icon(r === 'admin' ? 'shield' : r === 'despachador' ? 'dash' : 'truck')}<b>${ROLE[r]}</b><small>${ROLE_DESC[r]}</small></span></label>`).join('')}</div>`;
}
function userFields(u) {
  return `${roleCards(u.role)}
    <div class="grid g2"><label class="f">Nombre completo<input name="name" required value="${esc(u.name)}" autocomplete="off" /></label>
    <label class="f">Correo (usuario para entrar)<input name="email" type="email" required value="${esc(u.email)}" autocomplete="off" /></label></div>
    <div class="grid g2"><label class="f">Teléfono<input name="phone" type="tel" value="${esc(u.phone)}" /></label><span></span></div>
    <label class="row staff-only" style="gap:8px"><input type="checkbox" name="can_deliver" ${u.can_deliver ? 'checked' : ''} /> <span><b>También reparte</b><br><small class="muted">Supervisor o despachador que además entrega: aparece en las listas de repartidores y puede cambiar a modo repartidor en la app.</small></span></label>
    <fieldset class="driver-only"><legend>${icon('truck')} Datos del vehículo</legend><div class="grid g2">
      <label class="f">Vehículo / placas<input name="vehicle" value="${esc(u.vehicle)}" placeholder="Moto · ABC-123" /></label>
      <label class="f">Capacidad (paquetes)<input type="number" min="1" name="capacity" value="${u.capacity || 30}" /></label></div></fieldset>
    <label class="f">Notas internas<textarea name="notes" placeholder="Turno, zona, contacto de emergencia…">${esc(u.notes)}</textarea></label>`;
}
function wireRole(f) {
  // los datos del vehículo solo aplican a repartidores: ocultos se desactivan para que no bloqueen el "Guardar"
  const upd = () => {
    const isDrv = f.role.value === 'repartidor';
    const d = isDrv || !!f.can_deliver?.checked;
    f.classList.toggle('is-driver', d);
    $$('.driver-only', f).forEach((x) => { x.disabled = !d; x.hidden = !d; });
    $$('.staff-only', f).forEach((x) => (x.hidden = isDrv));
  };
  $$('input[name=role]', f).forEach((r) => (r.onchange = upd));
  if (f.can_deliver) f.can_deliver.onchange = upd;
  upd();
}
function userForm() {
  const u = { role: 'repartidor', capacity: 30 };
  const m = modal('Nuevo usuario', `<form id="uf" class="stack">${userFields(u)}
    <fieldset><legend>${icon('key')} Acceso</legend>
      <label class="radio"><input type="radio" name="pmode" value="temp" checked /> <span><b>Generar contraseña temporal</b><br><small class="muted">Recomendado. Se le pedirá cambiarla al entrar.</small></span></label>
      <label class="radio"><input type="radio" name="pmode" value="set" /> <span><b>Definir contraseña ahora</b></span></label>
      <div id="pset" hidden>${pwdField('password', 'Contraseña', { meter: true, required: false })}</div>
    </fieldset></form>`, { wide: true, footer: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="saveU">Crear usuario</button>' });
  const f = $('#uf', m.el);
  wireRole(f); wirePwd(f);
  $$('input[name=pmode]', f).forEach((r) => (r.onchange = () => { $('#pset', f).hidden = f.pmode.value !== 'set'; f.password.required = f.pmode.value === 'set'; }));
  $('#saveU', m.el).onclick = async () => {
    if (!f.reportValidity()) return;
    const b = Object.fromEntries(new FormData(f));
    if (b.pmode !== 'set') b.password = '';
    delete b.pmode;
    try {
      const r = await POST('/api/users', b);
      m.close();
      toast('Usuario creado', 'ok');
      await render();
      if (r.temp_password) showCredentials(b.name, b.email, r.temp_password, 'Usuario creado');
    } catch (e) { toast(e.message, 'bad'); }
  };
}

async function userPanel(id) {
  const u = await GET('/api/users/' + id);
  const me = store.user;
  const self = u.id === me.id;
  const s = u.stats || {};
  const done = (s.delivered || 0) + (s.failed || 0);
  const m = modal('Usuario', `
    <div class="uhead">${avatar(u, 'xl')}<div class="grow"><h2 style="margin:0">${esc(u.name)}</h2><div class="muted">${esc(u.email)}</div>
      <div class="row" style="margin-top:6px">${roleChip(u.role)} ${u.active ? '<span class="chip ok">Activo</span>' : '<span class="chip off">Inactivo</span>'} ${u.must_change_password ? '<span class="chip warn">Debe cambiar contraseña</span>' : ''}</div></div></div>
    <div class="mini-stats">
      <div><small>Último acceso</small><b>${ago(u.last_login)}</b></div>
      <div><small>Alta</small><b>${fmtDT(u.created_at).split(',')[0]}</b></div>
      ${u.role === 'repartidor' ? `<div><small>Entregas</small><b>${s.delivered || 0}</b></div><div><small>Éxito</small><b>${done ? fmtN(((s.delivered || 0) / done) * 100, 0) + '%' : '—'}</b></div>` : ''}
    </div>
    <div class="pill-tabs" id="uTabs"><button class="on" data-t="datos">Datos</button><button data-t="exp">Expediente y pago</button><button data-t="seg">Seguridad</button><button data-t="act">Actividad</button></div>
    <div data-pane="exp" hidden><div id="expBox" style="margin-top:14px"><p class="muted">Cargando…</p></div></div>
    <div data-pane="datos"><form id="uf" class="stack" style="margin-top:14px">${userFields(u)}</form></div>
    <div data-pane="seg" hidden><div class="stack" style="margin-top:14px">
      <div class="sec-row"><div>${icon('key')}</div><div class="grow"><b>Restablecer contraseña</b><br><small class="muted">Genera una contraseña temporal y cierra sus sesiones abiertas.</small></div><button class="btn" id="rst">Restablecer</button></div>
      <div class="sec-row"><div>${icon('logout')}</div><div class="grow"><b>Cerrar todas sus sesiones</b><br><small class="muted">Útil si perdió el teléfono. Tendrá que volver a entrar.</small></div><button class="btn" id="kick" ${self ? 'disabled' : ''}>Cerrar sesiones</button></div>
      <div class="sec-row"><div>${icon(u.active ? 'pause' : 'check')}</div><div class="grow"><b>${u.active ? 'Desactivar cuenta' : 'Reactivar cuenta'}</b><br><small class="muted">${u.active ? 'Ya no podrá entrar. Su historial se conserva.' : 'Podrá volver a entrar con su contraseña.'}</small></div><button class="btn ${u.active ? 'bad' : 'ok'}" id="tog" ${self ? 'disabled' : ''}>${u.active ? 'Desactivar' : 'Reactivar'}</button></div>
      <div class="sec-row danger"><div>${icon('trash')}</div><div class="grow"><b>Eliminar usuario</b><br><small class="muted">Solo si nunca operó (sin pedidos, rutas ni movimientos). Si tiene historial, desactívalo.</small></div><button class="btn bad" id="del" ${self ? 'disabled' : ''}>Eliminar</button></div>
      ${self ? '<p class="muted" style="margin:0"><small>No puedes desactivar, cerrar sesiones ni eliminar tu propia cuenta.</small></p>' : ''}
    </div></div>
    <div data-pane="act" hidden><div class="timeline" style="margin-top:14px">${u.activity.length ? u.activity.map((a) => `<div><b>${esc(ACTION[a.action] || a.action)}</b> <small class="muted">${fmtDT(a.created_at)}</small>${a.detail ? `<br><small>${esc(a.detail)}</small>` : ''}</div>`).join('') : '<p class="muted">Sin actividad registrada.</p>'}</div></div>`,
    { wide: true, footer: '<button class="btn" data-close>Cerrar</button><button class="btn primary" id="saveU">Guardar cambios</button>' });
  const f = $('#uf', m.el);
  wireRole(f);
  if (self) $$('input[name=role]', f).forEach((r) => (r.disabled = r.value !== 'admin'));
  $$('#uTabs button', m.el).forEach((b) => (b.onclick = () => {
    $$('#uTabs button', m.el).forEach((x) => x.classList.toggle('on', x === b));
    $$('[data-pane]', m.el).forEach((p) => (p.hidden = p.dataset.pane !== b.dataset.t));
    $('#saveU', m.el).hidden = b.dataset.t !== 'datos';
    if (b.dataset.t === 'exp' && !$('#pf2', m.el)) staffProfile($('#expBox', m.el), u);
  }));
  const reload = async () => { m.close(); await render(); userPanel(id); };
  $('#saveU', m.el).onclick = async () => {
    if (!f.reportValidity()) return;
    try { await PUT('/api/users/' + id, { ...Object.fromEntries(new FormData(f)), can_deliver: !!f.can_deliver?.checked, active: u.active }); toast('Cambios guardados', 'ok'); m.close(); render(); }
    catch (e) { toast(e.message, 'bad'); }
  };
  $('#rst', m.el).onclick = async () => {
    if (!(await confirmDlg(`¿Restablecer la contraseña de ${u.name}? Sus sesiones abiertas se cerrarán.`))) return;
    try { const r = await POST(`/api/users/${id}/reset-password`); m.close(); render(); showCredentials(u.name, u.email, r.temp_password); }
    catch (e) { toast(e.message, 'bad'); }
  };
  $('#kick', m.el).onclick = async () => {
    try { await POST(`/api/users/${id}/logout`); toast('Sesiones cerradas', 'ok'); } catch (e) { toast(e.message, 'bad'); }
  };
  $('#tog', m.el).onclick = async () => {
    if (u.active && !(await confirmDlg(`¿Desactivar a ${u.name}? No podrá entrar hasta que lo reactives.`))) return;
    try { await PUT('/api/users/' + id, { active: !u.active }); toast(u.active ? 'Cuenta desactivada' : 'Cuenta reactivada', 'ok'); reload(); }
    catch (e) { toast(e.message, 'bad'); }
  };
  $('#del', m.el).onclick = async () => {
    if (!(await confirmDlg(`¿Eliminar definitivamente a ${u.name}? Esta acción no se puede deshacer.`))) return;
    try { await api('DELETE', '/api/users/' + id); toast('Usuario eliminado', 'ok'); m.close(); render(); }
    catch (e) { toast(e.message, 'bad'); }
  };
}

// Importación masiva desde CSV / Excel (copiar y pegar)
function parseCSV(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const sep = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ',';
  const split = (l) => l.split(sep).map((x) => x.trim().replace(/^"|"$/g, ''));
  let head = split(lines[0]).map((h) => h.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''));
  const hasHead = head.some((h) => ['nombre', 'name', 'correo', 'email'].includes(h));
  if (!hasHead) head = ['nombre', 'correo', 'rol', 'telefono', 'vehiculo', 'capacidad'];
  const map = { nombre: 'name', name: 'name', correo: 'email', email: 'email', rol: 'role', role: 'role', telefono: 'phone', phone: 'phone', vehiculo: 'vehicle', vehicle: 'vehicle', capacidad: 'capacity', capacity: 'capacity' };
  const roleMap = { administrador: 'admin', admin: 'admin', despachador: 'despachador', despacho: 'despachador', repartidor: 'repartidor', chofer: 'repartidor', '': 'repartidor' };
  return lines.slice(hasHead ? 1 : 0).map((l) => {
    const cells = split(l);
    const o = {};
    head.forEach((h, i) => { if (map[h]) o[map[h]] = cells[i] || ''; });
    o.role = roleMap[String(o.role || '').toLowerCase()] || o.role;
    return o;
  });
}
function importUsers() {
  const m = modal('Importar usuarios', `<div class="stack">
    <p style="margin:0">Pega desde Excel o sube un archivo CSV con las columnas:<br><code>nombre, correo, rol, telefono, vehiculo, capacidad</code></p>
    <p class="muted" style="margin:0"><small>El rol puede ser <b>repartidor</b>, <b>despachador</b> o <b>administrador</b> (vacío = repartidor). Cada persona recibe una contraseña temporal.</small></p>
    <label class="btn">${icon('upload')} Elegir archivo CSV<input type="file" accept=".csv,.txt,text/csv" id="csvF" hidden /></label>
    <textarea id="csvT" rows="7" placeholder="nombre,correo,rol,telefono,vehiculo,capacidad&#10;Ana López,ana@empresa.com,repartidor,5512345678,Moto,25"></textarea>
    <div id="csvP" class="muted"></div></div>`, { wide: true, footer: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="doImp" disabled>Importar</button>' });
  const ta = $('#csvT', m.el);
  let rows = [];
  const prev = () => {
    rows = parseCSV(ta.value);
    const bad = rows.filter((r) => !r.name || !r.email).length;
    $('#csvP', m.el).innerHTML = rows.length ? `<b>${rows.length}</b> fila(s) detectadas${bad ? ` · <span style="color:var(--bad)">${bad} sin nombre o correo</span>` : ''}` : '';
    $('#doImp', m.el).disabled = !rows.length;
  };
  ta.oninput = prev;
  $('#csvF', m.el).onchange = async (e) => { const file = e.target.files[0]; if (file) { ta.value = await file.text(); prev(); } };
  $('#doImp', m.el).onclick = async () => {
    try {
      const r = await POST('/api/users/bulk', { rows });
      m.close();
      await render();
      const csv = 'nombre,correo,contraseña temporal\n' + r.created.map((c) => `${c.name},${c.email},${c.temp_password}`).join('\n');
      const rm = modal('Resultado de la importación', `<div class="stack">
        <p style="margin:0"><b style="color:var(--ok)">${r.created.length} creados</b>${r.errors.length ? ` · <b style="color:var(--bad)">${r.errors.length} con error</b>` : ''}</p>
        ${r.errors.length ? `<div class="table-wrap"><table><thead><tr><th>Fila</th><th>Correo</th><th>Problema</th></tr></thead><tbody>${r.errors.map((x) => `<tr><td>${x.line}</td><td>${esc(x.email)}</td><td>${esc(x.error)}</td></tr>`).join('')}</tbody></table></div>` : ''}
        ${r.created.length ? '<p class="muted" style="margin:0">Descarga las contraseñas temporales ahora: <b>no se volverán a mostrar</b>.</p>' : ''}</div>`,
        { wide: true, footer: `<button class="btn" data-close>Cerrar</button>${r.created.length ? `<button class="btn primary" id="dl">${icon('download')} Descargar credenciales</button>` : ''}` });
      $('#dl', rm.el)?.addEventListener('click', () => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
        a.download = `credenciales_${today()}.csv`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      });
    } catch (e) { toast(e.message, 'bad'); }
  };
}

// ================= ADMINISTRACIÓN: Actividad =================
const ACTION = {
  login: 'Inició sesión', perfil: 'Actualizó su perfil', password: 'Cambió su contraseña', 'usuario.alta': 'Creó usuario', 'usuario.importar': 'Importó usuarios',
  'usuario.edicion': 'Editó usuario', 'usuario.reset': 'Restableció contraseña', 'usuario.cerrar_sesion': 'Cerró sesiones de', 'usuario.baja': 'Eliminó usuario',
  'pedido.cancelar': 'Canceló pedido', 'clientes.importar': 'Importó clientes', 'unidad.alta': 'Registró unidad', 'unidad.edicion': 'Editó unidad', 'personal.confiable': 'Actualizó recurso confiable', 'checklist.unidad': 'Llenó checklist de unidad', 'certificado.emitir': 'Emitió certificado', 'certificado.revocar': 'Revocó certificado', 'series.recibir': 'Recibió equipos por S/N', 'series.baja': 'Dio de baja un S/N', 'series.reingreso': 'Reingresó un S/N', 'series.devolucion': 'Registró devolución de S/N', 'inventario.importar': 'Importó inventario', configuracion: 'Cambió configuración', 'recepcion.mostrador': 'Entregó en mostrador',
  'notificacion.manual': 'Envió aviso al cliente', 'whatsapp.vincular': 'Vinculó WhatsApp por QR', 'whatsapp.desvincular': 'Desvinculó WhatsApp', integraciones: 'Cambió notificaciones / Sheets', 'sheets.reenviar': 'Reenvió filas a Google Sheets',
};
async function viewActivity(v) {
  let offset = 0;
  let q = '';
  v.innerHTML = topbar('Actividad', '', 'Quién hizo qué y cuándo: accesos, cambios de usuarios y configuración.') + `
    <div class="card"><div class="toolbar"><label class="search">${icon('search')}<input id="aq" type="search" placeholder="Buscar por usuario o acción…" /></label></div>
    <div class="timeline big" id="aList"></div><div class="pager" id="aMore"></div></div>`;
  const load = async (reset) => {
    if (reset) { offset = 0; $('#aList').innerHTML = ''; }
    const r = await GET(`/api/audit?limit=40&offset=${offset}&q=${encodeURIComponent(q)}`);
    offset += r.rows.length;
    $('#aList').insertAdjacentHTML('beforeend', r.rows.map((a) => `<div>${avatar({ id: a.user_name?.length || 0, name: a.user_name || '?' })}<div class="grow"><b>${esc(a.user_name || 'Usuario eliminado')}</b> <span>${esc(ACTION[a.action] || a.action)}</span>${a.detail ? ` <span class="muted">· ${esc(a.detail)}</span>` : ''}<br><small class="muted">${fmtDT(a.created_at)}${a.ip ? ' · ' + esc(a.ip) : ''}</small></div></div>`).join('') || (offset ? '' : '<p class="muted center">Sin actividad.</p>'));
    $('#aMore').innerHTML = `<small class="muted">${offset} de ${r.total}</small>${offset < r.total ? '<button class="btn sm" id="more">Ver más</button>' : ''}`;
    $('#more')?.addEventListener('click', () => load(false));
  };
  let t;
  $('#aq').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { q = e.target.value; load(true); }, 250); };
  await load(true);
}

// ================= Mi perfil (todos los roles) =================
async function viewProfile(v) {
  const u = await GET('/api/me');
  store.user = { ...store.user, ...u };
  const th = theme.get();
  v.innerHTML = topbar('Mi perfil') + `
  <div class="grid g-main">
    <div class="stack">
      <div class="card profile-card">${avatar(u, 'xl')}<div><h2 style="margin:0">${esc(u.name)}</h2><div class="muted">${esc(u.email)}</div><div class="row" style="margin-top:6px">${roleChip(u.role)}${u.vehicle ? `<span class="chip">${icon('truck')} ${esc(u.vehicle)}</span>` : ''}</div></div></div>
      <form class="card stack" id="pf"><h2>Mis datos</h2>
        <div class="grid g2"><label class="f">Nombre<input name="name" required value="${esc(u.name)}" /></label><label class="f">Teléfono<input name="phone" type="tel" value="${esc(u.phone)}" /></label></div>
        <label class="f">Correo<input value="${esc(u.email)}" disabled /><small class="muted">Para cambiar tu correo o rol, pídeselo a un administrador.</small></label>
        <div><button class="btn primary">Guardar</button></div></form>
      <form class="card stack" id="pw"><h2>Cambiar contraseña</h2>
        ${pwdField('current', 'Contraseña actual', { auto: 'current-password', min: 0 })}
        <div class="grid g2">${pwdField('password', 'Nueva contraseña', { meter: true })}${pwdField('confirm', 'Repite la nueva')}</div>
        <div><button class="btn primary">Actualizar contraseña</button></div></form>
      ${u.role !== 'admin' ? '<div class="card stack" id="myDocs"><h2>Mis documentos</h2><p class="muted" style="margin:0">Cargando…</p></div>' : ''}
    </div>
    <div class="stack">
      <div class="card stack"><h2>Apariencia</h2>
        <div class="pill-tabs" id="thm">${[['auto', 'Automático'], ['light', 'Claro'], ['dark', 'Oscuro']].map(([k, l]) => `<button data-th="${k}" class="${th === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <div class="card stack"><h2>Aplicación</h2>
        <p class="muted" style="margin:0">Instálala en tu teléfono o computadora para abrirla como una app, incluso sin señal.</p>
        <button class="btn" id="inst">${icon('download')} Instalar app</button>
        <small class="muted">En iPhone: botón Compartir → “Agregar a pantalla de inicio”.</small>
        <small class="muted">Último acceso: ${ago(u.last_login)}</small></div>
      <button class="btn bad lg block" id="out">${icon('logout')} Cerrar sesión</button>
    </div>
  </div>`;
  wirePwd(v);
  if ($('#myDocs')) myDocuments($('#myDocs'), u);
  $('#pf').onsubmit = async (e) => {
    e.preventDefault();
    try { const r = await PUT('/api/me', Object.fromEntries(new FormData(e.target))); store.user = { ...store.user, ...r }; toast('Datos guardados', 'ok'); render(); }
    catch (err) { toast(err.message, 'bad'); }
  };
  $('#pw').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.password.value !== f.confirm.value) return toast('Las contraseñas no coinciden', 'bad');
    try {
      const r = await POST('/api/me/password', { current: f.current.value, password: f.password.value });
      store.token = r.token; store.user = r.user;
      f.reset(); toast('Contraseña actualizada. Tus otras sesiones se cerraron.', 'ok');
    } catch (err) { toast(err.message, 'bad'); }
  };
  $$('#thm button').forEach((b) => (b.onclick = () => { theme.set(b.dataset.th); $$('#thm button').forEach((x) => x.classList.toggle('on', x === b)); }));
  $('#inst').onclick = async () => {
    if (installPrompt) { installPrompt.prompt(); installPrompt = null; }
    else toast('Usa el menú del navegador → “Instalar app” o “Agregar a pantalla de inicio”.');
  };
  $('#out').onclick = logout;
}

// ================= Mapa en vivo (posición + recorrido GPS) =================
let liveTimer = null;
async function viewLive(v) {
  v.innerHTML = topbar('Mapa en vivo', '<small class="muted">Actualiza cada 15 s</small>', 'Ubicación GPS de cada repartidor y su recorrido del día.') +
    `<div class="grid g-main"><div class="card"><div id="lmap" class="map tall"></div></div><div class="card" id="llist"></div></div>`;
  const map = makeMap($('#lmap'));
  L.marker(depotLatLng(), { icon: depotIcon() }).addTo(map);
  const layer = L.layerGroup().addTo(map);
  const trailLayer = L.layerGroup().addTo(map);
  let first = true;
  let selected = null;
  let trailInfo = null;
  async function drawTrail(fit) {
    trailLayer.clearLayers();
    if (!selected) { trailInfo = null; return; }
    const t = await GET('/api/tracking/trail/' + selected);
    trailInfo = t;
    drawRoute(map, t.stops, '#e5612a', { depot: false, fit: false, into: L.layerGroup().addTo(trailLayer), onEdit: () => drawTrail(false) });
    const pts = t.points.map((p) => [p.lat, p.lng]);
    if (pts.length > 1) L.polyline(pts, { color: '#1d5a96', weight: 5, opacity: 0.85 }).addTo(trailLayer);
    if (pts.length) L.circleMarker(pts[0], { radius: 6, color: '#1d5a96', fillColor: '#fff', fillOpacity: 1 }).addTo(trailLayer).bindPopup('Inicio del recorrido');
    const all = [...pts, ...t.stops.filter((s) => s.lat != null).map((s) => [s.lat, s.lng])];
    if (fit && all.length) map.fitBounds(all, { padding: [40, 40], maxZoom: 15 });
  }
  async function tick(fit) {
    if (!$('#lmap')) { clearInterval(liveTimer); return; }
    const ds = await GET('/api/tracking/drivers');
    layer.clearLayers();
    const pts = [];
    for (const d of ds) if (d.last_lat) {
      L.marker([d.last_lat, d.last_lng], { icon: truckIcon(), zIndexOffset: 1000 }).addTo(layer).bindPopup(`<b>${esc(d.name)}</b><br>${d.delivered} entregados · ${d.pending} pendientes<br>${ago(d.last_seen)}`).on('click', () => select(d.id));
      pts.push([d.last_lat, d.last_lng]);
    }
    if (first && pts.length && !selected) { map.fitBounds([...pts, depotLatLng()], { padding: [40, 40], maxZoom: 14 }); first = false; }
    const editing = (map._popup && map._popup.isOpen && map._popup.isOpen()) || document.querySelector('#lmap .leaflet-marker-draggable') || map.getContainer().style.cursor === 'crosshair';
    if (selected && (!editing || fit)) await drawTrail(fit);
    $('#llist').innerHTML = `<h2>Repartidores</h2><p class="muted" style="margin-top:-6px"><small>Toca uno para ver su recorrido de hoy.</small></p>` + ds.map((d) => {
      const mins = d.last_seen ? (Date.now() - Date.parse(d.last_seen.replace(' ', 'T') + 'Z')) / 60000 : null;
      const st = mins == null ? ['Sin señal', ''] : mins < 5 ? ['En línea', 'ok'] : mins < 30 ? [`Hace ${Math.round(mins)} min`, 'warn'] : ['Desconectado', 'off'];
      const sel = selected === d.id;
      return `<button class="live-row ${sel ? 'on' : ''}" data-d="${d.id}">${avatar(d)}<span class="grow"><b>${esc(d.name)}</b><small class="muted">${esc(d.vehicle || '')} · ${d.delivered} ✓ · ${d.pending} pend.</small>
        ${sel && trailInfo ? `<small>${icon('route')} ${fmtN(trailInfo.km, 1)} km recorridos · ${trailInfo.points.length} puntos GPS</small>` : ''}</span><span class="chip ${st[1]}">${st[0]}</span></button>`;
    }).join('') + (selected ? '<button class="btn sm block" id="clrTrail" style="margin-top:10px">Ver todos</button>' : '');
    $$('[data-d]', $('#llist')).forEach((b) => (b.onclick = () => select(Number(b.dataset.d))));
    $('#clrTrail')?.addEventListener('click', () => select(null));
  }
  async function select(id) { selected = selected === id ? null : id; await tick(true); if (!selected && pts0()) map.fitBounds([...pts0(), depotLatLng()], { padding: [40, 40], maxZoom: 14 }); }
  const pts0 = () => { const a = []; layer.eachLayer((l) => l.getLatLng && a.push(l.getLatLng())); return a.length ? a : null; };
  await tick();
  clearInterval(liveTimer);
  liveTimer = setInterval(() => tick(false), 15000);
}

// ================= Configuración =================
const TPL_VARS = ['{cliente}', '{guia}', '{empresa}', '{fecha}', '{eta}', '{repartidor}', '{minutos}', '{recibio}', '{fecha_entrega}', '{motivo}', '{link}'];

async function viewSettings(v) {
  const tab = new URLSearchParams(location.hash.split('?')[1] || '').get('tab') || 'general';
  const [s, it] = await Promise.all([GET('/api/settings'), GET('/api/integrations')]);
  const tabs = [['general', 'General', 'cog'], ['entrega', 'Entrega y evidencia', 'sign'], ['notif', 'Notificaciones', 'chat'], ['sheets', 'Google Sheets', 'sheet']];
  v.innerHTML = topbar('Configuración') + `<div class="tabs">${tabs.map(([k, l, i]) => `<a href="#/settings?tab=${k}" class="${k === tab ? 'on' : ''}">${icon(i)} ${l}</a>`).join('')}</div><div id="stab"></div>`;
  const box = $('#stab');
  const saveInt = async (body, msg = 'Guardado') => { try { const r = await PUT('/api/integrations', body); Object.assign(it, r); toast(msg, 'ok'); return r; } catch (e) { toast(e.message, 'bad'); throw e; } };
  const test = async (channel, to, btn) => {
    btn.disabled = true;
    try { const r = await POST('/api/integrations/test', { channel, to }); toast(r.detail, 'ok'); } catch (e) { toast(e.message, 'bad'); } finally { btn.disabled = false; }
  };

  if (tab === 'general') {
    box.innerHTML = `<div class="grid g2"><form class="card stack" id="sf">
      <label class="f">Nombre de la empresa<input name="company_name" value="${esc(s.company_name)}" /></label>
      <label class="f">Nombre del almacén<input name="depot_name" value="${esc(s.depot_name)}" /></label>
      <div class="grid g2"><label class="f">Latitud almacén<input name="depot_lat" value="${esc(s.depot_lat)}" /></label><label class="f">Longitud almacén<input name="depot_lng" value="${esc(s.depot_lng)}" /></label></div>
      <h3>Parámetros de ruteo</h3>
      <div class="grid g2"><label class="f">Velocidad promedio (km/h)<input type="number" name="avg_speed_kmh" value="${esc(s.avg_speed_kmh)}" /></label><label class="f">Tiempo por parada (min)<input type="number" name="service_minutes" value="${esc(s.service_minutes)}" /></label></div>
      <div class="grid g2"><label class="f">Factor de calle (×línea recta)<input type="number" step="0.05" name="road_factor" value="${esc(s.road_factor)}" /></label><label class="f">Hora de salida por defecto<input type="time" name="start_time" value="${esc(s.start_time)}" /></label></div>
      <button class="btn primary">Guardar</button></form>
      <div class="card"><h2>Ubicación del almacén</h2><p class="muted">Toca el mapa para moverlo.</p><div id="smap" class="map"></div></div></div>`;
    const f = $('#sf');
    const map = makeMap($('#smap'), [Number(s.depot_lat), Number(s.depot_lng)], 13);
    const mk = L.marker([Number(s.depot_lat), Number(s.depot_lng)], { icon: depotIcon(), draggable: true }).addTo(map);
    const set = (ll) => { f.depot_lat.value = ll.lat.toFixed(6); f.depot_lng.value = ll.lng.toFixed(6); mk.setLatLng(ll); };
    map.on('click', (e) => set(e.latlng));
    mk.on('dragend', () => set(mk.getLatLng()));
    f.onsubmit = async (e) => { e.preventDefault(); SETTINGS = await PUT('/api/settings', Object.fromEntries(new FormData(f))); toast('Configuración guardada', 'ok'); };
  }

  if (tab === 'entrega') {
    box.innerHTML = `<form class="card stack" id="ef" style="max-width:760px">
      <h2>Evidencia de recepción</h2>
      <label class="switch"><input type="checkbox" name="require_signature" ${s.require_signature === '1' ? 'checked' : ''} /><span></span><div><b>Firma obligatoria</b><br><small class="muted">Quien recibe firma en la pantalla del teléfono o en el mostrador.</small></div></label>
      <label class="switch"><input type="checkbox" name="require_photo" ${s.require_photo === '1' ? 'checked' : ''} /><span></span><div><b>Fotografía obligatoria</b><br><small class="muted">Foto del paquete entregado con fecha y hora impresas.</small></div></label>
      <h2 style="margin-top:8px">Navegación del repartidor</h2>
      <label class="f">Servidor de rutas (OSRM)<input name="osrm_url" value="${esc(s.osrm_url)}" placeholder="https://router.project-osrm.org" />
        <small class="muted">Traza el camino por calles e indicaciones paso a paso. El servidor público de demostración sirve para pruebas; para producción usa uno propio. Déjalo vacío para usar línea recta.</small></label>
      <div><button class="btn primary">Guardar</button></div></form>`;
    $('#ef').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      SETTINGS = await PUT('/api/settings', { require_signature: f.require_signature.checked ? '1' : '0', require_photo: f.require_photo.checked ? '1' : '0', osrm_url: f.osrm_url.value.trim() });
      toast('Guardado', 'ok');
    };
  }

  if (tab === 'notif') {
    let mx = {};
    try { mx = JSON.parse(it.notif_matrix || '{}'); } catch {}
    const prov = (k) => it[k] || 'simulacion';
    box.innerHTML = `<form id="nf" class="stack">
      <div class="card stack">
        <label class="switch"><input type="checkbox" name="notif_enabled" ${it.notif_enabled === '1' ? 'checked' : ''} /><span></span><div><b>Avisos automáticos activados</b><br><small class="muted">Se envían al registrar el pedido, al cargarlo en la camioneta, cuando el repartidor va en camino, al entregar y si no se pudo entregar.</small></div></label>
        <div class="grid g2"><label class="f">URL pública de la app<input name="public_url" value="${esc(it.public_url)}" placeholder="${esc(location.origin)}" />
          <small class="muted">Se usa en los enlaces de rastreo y comprobante que recibe el cliente. Debe ser accesible desde internet (https).</small></label>
          <label class="f">Código de país para teléfonos<input name="phone_country" value="${esc(it.phone_country)}" inputmode="numeric" /><small class="muted">52 = México. Los teléfonos de 10 dígitos se completan con este código.</small></label></div>
        <fieldset class="test-mode"><legend>${icon('shield')} Modo de prueba</legend>
          <small class="muted">Mientras haya un teléfono o correo aquí, <b>ningún cliente recibe mensajes</b>: todos los avisos llegan a estos datos, con la nota de a quién iban. Bórralos para empezar a avisar a los clientes reales.</small>
          <div class="grid g2"><label class="f">Teléfono de prueba (SMS y WhatsApp)<input name="notif_test_to" value="${esc(it.notif_test_to)}" inputmode="tel" placeholder="10 dígitos" /></label>
          <label class="f">Correo de prueba<input name="notif_test_email" type="email" value="${esc(it.notif_test_email)}" /></label></div></fieldset>
      </div>
      <div class="card"><h2>¿Qué aviso sale por cada canal?</h2><div class="table-wrap"><table class="mx"><thead><tr><th>Momento</th>${Object.entries(CH_LABEL).map(([k, l]) => `<th class="c">${l}</th>`).join('')}</tr></thead><tbody>
        ${Object.entries(EVENT_LABEL).map(([ev, l]) => `<tr><td>${l}</td>${Object.keys(CH_LABEL).map((ch) => `<td class="c"><input type="checkbox" data-mx="${ev}.${ch}" ${Number(mx[ev]?.[ch]) ? 'checked' : ''} aria-label="${l} por ${CH_LABEL[ch]}" /></td>`).join('')}</tr>`).join('')}
      </tbody></table></div><small class="muted">Cada cliente puede además desactivar canales en su ficha.</small></div>
      <div class="card stack"><h2>Textos de los mensajes</h2>
        <small class="muted">Variables: ${TPL_VARS.map((x) => `<code>${x}</code>`).join(' ')}</small>
        ${Object.entries(EVENT_LABEL).map(([ev, l]) => `<label class="f">${l}<textarea name="tpl_${ev}" rows="2">${esc(it['tpl_' + ev])}</textarea><small class="muted" data-len="tpl_${ev}"></small></label>`).join('')}
      </div>
      <div class="grid g3 prov">
        <div class="card stack"><h2>${icon('phone')} SMS</h2>
          <label class="f">Proveedor<select name="sms_provider"><option value="simulacion">Simulación (no envía)</option><option value="android">Mi teléfono Android (SMS Gateway)</option><option value="twilio">Twilio</option></select></label>
          <div data-show="sms_provider=android" class="stack">
            <div class="qr-row"><img id="smsQr" alt="QR para descargar SMS Gateway" /><small>1. Escanea con el <b>teléfono Android</b> que enviará los SMS para descargar e instalar <b>SMS Gateway for Android</b> (código abierto).<br>2. Ábrela, concede permiso de SMS y activa <b>Cloud server</b>.<br>3. Copia aquí el <b>usuario</b> y la <b>contraseña</b> que muestra la app.</small></div>
            <label class="f">Tope de SMS por teléfono al día<input name="sms_daily_cap_per_device" inputmode="numeric" value="${esc(it.sms_daily_cap_per_device || '300')}" /></label>
            <fieldset class="ch-line"><legend>Línea 1</legend>
            <label class="f">Nombre<input name="sms_android_name" value="${esc(it.sms_android_name || '')}" placeholder="Ej. MAXON FreedomPop" /></label>
            <label class="f">Modo<select name="sms_android_mode"><option value="cloud">Nube (el teléfono solo necesita internet)</option><option value="local">Red local (IP del teléfono)</option></select></label>
            <label class="f" data-show="sms_android_mode=local">Dirección del teléfono<input name="sms_android_url" value="${esc(it.sms_android_url)}" placeholder="http://192.168.1.50:8080" /></label>
            <div class="grid g2"><label class="f">Usuario<input name="sms_android_user" value="${esc(it.sms_android_user)}" autocomplete="off" /></label>
            <label class="f">Contraseña<input name="sms_android_pass" type="password" value="${esc(it.sms_android_pass)}" autocomplete="new-password" /></label></div></fieldset>
            ${[2, 3].map((i) => `<fieldset class="ch-line"><legend><label class="row" style="gap:6px"><input type="checkbox" name="sms${i}_enabled" ${it[`sms${i}_enabled`] === '1' ? 'checked' : ''} /> Línea ${i}</label></legend>
              <div data-line="sms${i}" class="stack">
              <label class="f">Nombre<input name="sms${i}_name" value="${esc(it[`sms${i}_name`] || '')}" placeholder="Ej. Telcel 664…" /></label>
              <label class="f">Modo<select name="sms${i}_mode"><option value="cloud">Nube</option><option value="local">Red local</option></select></label>
              <label class="f" data-show="sms${i}_mode=local">Dirección del teléfono<input name="sms${i}_url" value="${esc(it[`sms${i}_url`] || '')}" placeholder="http://192.168.1.51:8080" /></label>
              <div class="grid g2"><label class="f">Usuario<input name="sms${i}_user" value="${esc(it[`sms${i}_user`] || '')}" autocomplete="off" /></label>
              <label class="f">Contraseña<input name="sms${i}_pass" type="password" value="${esc(it[`sms${i}_pass`] || '')}" autocomplete="new-password" /></label></div></div></fieldset>`).join('')}
            <small class="muted">Cada línea es un teléfono (o una cuenta) de SMS Gateway con su chip. El servidor reparte los SMS entre los teléfonos conectados, el que lleva menos primero, sin pasar el tope. También puedes agregar teléfonos a la Línea 1 entrando en SMS Gateway con el mismo usuario y contraseña.</small>
            <small class="muted">Los SMS salen del chip del teléfono con la tarifa de tu plan. Mantenlo cargando y con la app abierta en segundo plano.</small></div>
          <div data-show="sms_provider=twilio" class="stack">
            <label class="f">Account SID<input name="twilio_sid" value="${esc(it.twilio_sid)}" autocomplete="off" /></label>
            <label class="f">Auth token<input name="twilio_token" type="password" value="${esc(it.twilio_token)}" autocomplete="new-password" /></label>
            <label class="f">Número remitente<input name="twilio_from" value="${esc(it.twilio_from)}" placeholder="+1555…" /></label></div>
          <div class="row"><input class="grow" placeholder="Tel. de prueba" data-to="sms" /><button type="button" class="btn sm" data-test="sms">Probar</button></div></div>
        <div class="card stack"><h2>${icon('chat')} WhatsApp</h2>
          <label class="f">Proveedor<select name="wa_provider"><option value="simulacion">Simulación (no envía)</option><option value="qr">Mi número de WhatsApp (QR)</option><option value="meta">WhatsApp Cloud API (Meta)</option><option value="twilio">Twilio WhatsApp</option></select></label>
          <div data-show="wa_provider=qr" class="stack">
            <label class="f">Tope de mensajes por número al día<input name="wa_daily_cap" inputmode="numeric" value="${esc(it.wa_daily_cap || '200')}" /></label>
            ${[1, 2, 3].map((i) => `<fieldset class="ch-line"><legend>${i === 1 ? 'Número 1' : `<label class="row" style="gap:6px"><input type="checkbox" name="wa${i}_enabled" ${it[`wa${i}_enabled`] === '1' ? 'checked' : ''} /> Número ${i}</label>`}</legend>
              <div data-line="wa${i}" class="stack"><label class="f">Nombre<input name="wa${i}_name" value="${esc(it[`wa${i}_name`] || '')}" placeholder="Ej. WhatsApp oficina Tijuana" /></label>
              <div class="wa-box" data-wabox="${i}"></div></div></fieldset>`).join('')}
            <small class="warn-note">${icon('info')} Conexión no oficial (como WhatsApp Web). Usa un número dedicado al negocio y envía solo avisos que el cliente espera: WhatsApp puede restringir números que mandan mensajes masivos.</small></div>
          <div data-show="wa_provider=meta" class="stack">
            <label class="f">Token de acceso<input name="wa_token" type="password" value="${esc(it.wa_token)}" autocomplete="new-password" /></label>
            <label class="f">Phone number ID<input name="wa_phone_id" value="${esc(it.wa_phone_id)}" /></label></div>
          <div data-show="wa_provider=twilio" class="stack">
            <small class="muted">Usa el SID y token de la tarjeta SMS.</small>
            <label class="f">Número WhatsApp remitente<input name="twilio_wa_from" value="${esc(it.twilio_wa_from)}" placeholder="whatsapp:+1415…" /></label></div>
          <small class="muted" data-show="wa_provider=meta">WhatsApp Cloud API solo permite mensajes libres si el cliente escribió en las últimas 24 h; fuera de esa ventana Meta exige plantillas aprobadas.</small>
          <div class="row"><input class="grow" placeholder="Tel. de prueba" data-to="whatsapp" /><button type="button" class="btn sm" data-test="whatsapp">Probar</button></div></div>
        <div class="card stack"><h2>${icon('mail')} Correo</h2>
          <label class="f">Proveedor<select name="email_provider"><option value="simulacion">Simulación (no envía)</option><option value="smtp">SMTP (Gmail, Outlook, propio…)</option></select></label>
          <div data-show="email_provider=smtp" class="stack">
            <div class="grid g2"><label class="f">Servidor<input name="smtp_host" value="${esc(it.smtp_host)}" placeholder="smtp.gmail.com" /></label><label class="f">Puerto<input name="smtp_port" value="${esc(it.smtp_port)}" inputmode="numeric" /></label></div>
            <label class="row"><input type="checkbox" name="smtp_secure" ${it.smtp_secure === '1' ? 'checked' : ''} /> Conexión SSL directa (puerto 465)</label>
            <label class="f">Usuario<input name="smtp_user" value="${esc(it.smtp_user)}" autocomplete="off" /></label>
            <label class="f">Contraseña / clave de app<input name="smtp_pass" type="password" value="${esc(it.smtp_pass)}" autocomplete="new-password" /></label>
            <label class="f">Remitente<input name="smtp_from" value="${esc(it.smtp_from)}" placeholder="Sovime Mensajería &lt;avisos@tuempresa.com&gt;" /></label></div>
          <div class="row"><input class="grow" placeholder="Correo de prueba" data-to="email" /><button type="button" class="btn sm" data-test="email">Probar</button></div></div>
      </div>
      <div class="savebar"><span class="muted">Guarda antes de probar un canal.</span><button class="btn primary">Guardar notificaciones</button></div>
    </form>`;
    const f = $('#nf');
    for (const k of ['sms_provider', 'wa_provider', 'email_provider']) f[k].value = prov(k);
    f.sms_android_mode.value = it.sms_android_mode || 'cloud';
    GET('/api/qr/smsgate').then((r) => { const im = $('#smsQr'); if (im) im.src = r.qr; }).catch(() => {});
    let waTimer = null;
    const waDraw = (action, slot) => (slot ? [Number(slot)] : [1, 2, 3]).forEach((i) => waDraw1(i, slot ? action : null));
    const waDraw1 = async (slot, action) => {
      const box = $(`[data-wabox="${slot}"]`);
      if (!$('[data-wabox]')) return clearInterval(waTimer);
      if (!box || box.closest('[data-line]')?.hidden) return;
      let st;
      try { st = action ? await POST(`/api/whatsapp/${action}?slot=${slot}`, { slot }) : await GET(`/api/whatsapp/status?slot=${slot}`); } catch (e) { toast(e.message, 'bad'); return; }
      const label = { conectado: ['Conectado', 'ok'], esperando_qr: ['Esperando escaneo', 'warn'], conectando: ['Conectando…', 'warn'], desconectado: ['Sin vincular', 'off'] }[st.status] || [st.status, ''];
      box.innerHTML = `<div class="row between"><b>Estado</b><span class="chip ${label[1]}">${label[0]}</span></div>
        ${st.status === 'conectado' ? `<div class="wa-me">${icon('chat')}<div><b>${esc(st.me?.number || '')}</b><br><small class="muted">${esc(st.me?.name || '')}${st.since ? ' · vinculado ' + fmtDT(st.since.replace('T', ' ').slice(0, 19)) : ''}</small></div></div>
          <button type="button" class="btn sm bad" data-wa="logout">Desvincular</button>` :
        st.qr ? `<img class="wa-qr" src="${st.qr}" alt="Código QR de WhatsApp" /><ol class="steps-list"><li>Abre WhatsApp en el teléfono del negocio.</li><li>Toca <b>⋮ / Configuración → Dispositivos vinculados → Vincular un dispositivo</b>.</li><li>Escanea este código. Se renueva solo cada pocos segundos.</li></ol>` :
        st.status === 'conectando' ? '<p class="muted">Preparando el código QR…</p>' :
        `<button type="button" class="btn primary" data-wa="connect">${icon('scan')} Mostrar QR para vincular</button>`}
        ${st.error && st.status !== 'conectado' ? `<small style="color:var(--bad)">${esc(st.error)}</small>` : ''}`;
      $$('[data-wa]', box).forEach((b) => (b.onclick = async () => {
        if (b.dataset.wa === 'logout' && !(await confirmDlg('¿Desvincular este número? Los avisos por WhatsApp dejarán de salir hasta que vuelvas a escanear el QR.'))) return;
        b.disabled = true; waDraw(b.dataset.wa, slot);
      }));
    };
    waDraw();
    waTimer = setInterval(() => { if (!$('[data-wabox]')) return clearInterval(waTimer); if (f.wa_provider.value === 'qr') waDraw(); }, 2500);
    // líneas 2 y 3: se muestran solo si están activadas
    const lines = () => { $$('[data-line]', f).forEach((d) => { const k = d.dataset.line; const cb = f[k.replace(/^(sms|wa)(\d)$/, '$1$2_enabled')]; d.hidden = cb ? !cb.checked : false; }); };
    lines(); f.addEventListener('change', lines);
    for (const i of [2, 3]) if (f[`sms${i}_mode`]) f[`sms${i}_mode`].value = it[`sms${i}_mode`] || 'cloud';
    const showHide = () => $$('[data-show]', f).forEach((d) => { const [k, val] = d.dataset.show.split('='); d.hidden = f[k].value !== val; });
    showHide();
    f.addEventListener('change', showHide);
    const lens = () => $$('[data-len]', f).forEach((el) => { const n = f[el.dataset.len].value.length; el.textContent = `${n} caracteres${n > 160 ? ' · el SMS se enviará en ' + Math.ceil(n / 153) + ' partes' : ''}`; });
    f.addEventListener('input', lens); lens();
    $$('[data-test]', f).forEach((b) => (b.onclick = () => test(b.dataset.test, $(`[data-to="${b.dataset.test}"]`, f).value, b)));
    f.onsubmit = async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(f));
      body.notif_enabled = f.notif_enabled.checked ? '1' : '0';
      body.smtp_secure = f.smtp_secure.checked ? '1' : '0';
      for (const k of ['sms2_enabled', 'sms3_enabled', 'wa2_enabled', 'wa3_enabled']) if (f[k]) body[k] = f[k].checked ? '1' : '0';
      const m2 = {};
      $$('[data-mx]', f).forEach((c) => { const [ev, ch] = c.dataset.mx.split('.'); (m2[ev] ||= {})[ch] = c.checked ? 1 : 0; });
      body.notif_matrix = m2;
      await saveInt(body, 'Notificaciones guardadas');
      SETTINGS.phone_country = body.phone_country;
    };
  }

  if (tab === 'sheets') {
    const draw = async () => {
      const stats = Object.fromEntries((it.sheet_stats || []).map((x) => [x.status, x.n]));
      const { script, has_secret } = await GET('/api/integrations/sheets/script');
      box.innerHTML = `<div class="grid g-main">
        <form class="card stack" id="shf">
          <label class="switch"><input type="checkbox" name="sheets_enabled" ${it.sheets_enabled === '1' ? 'checked' : ''} /><span></span><div><b>Registrar cada entrega en Google Sheets</b><br><small class="muted">Al registrar una entrega o un intento fallido se escribe en la pestaña <b>Entregas</b>: ID de Rastreo, Fecha y Hora, Cliente, Teléfono, Dirección, Zona, Estatus, Repartidor y Notas, más la evidencia (quién recibió, foto, firma, comprobante y GPS) desde la columna J. Si la guía ya está en la hoja, se actualiza su fila.</small></div></label>
          <label class="f">URL de la aplicación web (Apps Script)<input name="sheets_url" value="${esc(it.sheets_url)}" placeholder="https://script.google.com/macros/s/…/exec" /></label>
          <label class="f">Clave compartida<div class="row"><input class="grow" value="${has_secret ? 'Clave configurada (oculta)' : 'Sin clave: toca Generar'}" disabled /><button type="button" class="btn" id="gen">${icon('key')} ${has_secret ? 'Cambiar clave' : 'Generar'}</button></div>
            <small class="muted">Impide que otros escriban en tu hoja. Si la cambias, vuelve a pegar el script en Apps Script.</small></label>
          <div class="row"><button class="btn primary">Guardar</button><button type="button" class="btn" id="tst">${icon('send')} Probar conexión</button></div>
          <div class="mini-stats"><div><small>Enviadas</small><b>${stats.enviado || 0}</b></div><div><small>En cola</small><b>${stats.pendiente || 0}</b></div><div><small>Con error</small><b style="${stats.error ? 'color:var(--bad)' : ''}">${stats.error || 0}</b></div><div><small>Sin enviar (desactivado)</small><b>${stats.desactivado || 0}</b></div></div>
          ${(it.sheet_errors || []).length ? `<div class="login-err" style="font-weight:600">Último error (${esc(it.sheet_errors[0].tracking_code)}): ${esc(it.sheet_errors[0].error)}</div>` : ''}
          <div class="row"><button type="button" class="btn sm" id="rt" title="Incluye las entregas registradas mientras el registro estaba apagado">Reenviar pendientes, errores y no enviadas</button><button type="button" class="btn sm" id="bf">Enviar también entregas anteriores</button></div>
        </form>
        <div class="card stack"><h2>Cómo conectarla</h2>
          <ol class="steps-list">
            <li>${has_secret ? '✅ Clave generada.' : 'Toca <b>Generar</b> para crear la clave.'}</li>
            <li>Toca <b>Copiar script</b>.</li>
            <li>En tu hoja: <b>Extensiones → Apps Script</b>. Borra el contenido de <code>Código.gs</code>, pega el script y guarda (💾).</li>
            <li><b>Implementar → Nueva implementación</b> → ⚙️ <b>Aplicación web</b>. Ejecutar como: <b>Yo</b>. Quién tiene acceso: <b>Cualquier persona</b>. Toca <b>Implementar</b> y autoriza los permisos.</li>
            <li>Copia la <b>URL de la aplicación web</b> (termina en <code>/exec</code>), pégala aquí, activa el interruptor, guarda y toca <b>Probar conexión</b>.</li></ol>
          <div class="code-box"><pre id="scr">${esc(has_secret ? script : '// Genera la clave primero')}</pre><button type="button" class="btn sm" id="cpS" ${has_secret ? '' : 'disabled'}>${icon('copy')} Copiar script</button></div>
          <small class="muted">Las fotos, firmas y comprobantes se abren desde la hoja solo si la <b>URL pública</b> de la app (Configuración → Notificaciones) es accesible desde internet.</small></div></div>`;
      const f = $('#shf');
      $('#gen').onclick = async () => {
        if (has_secret && !(await confirmDlg('Al cambiar la clave deberás pegar de nuevo el script en Apps Script y volver a implementarlo. ¿Continuar?'))) return;
        const a = new Uint8Array(18); crypto.getRandomValues(a);
        await saveInt({ sheets_secret: Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('') }, 'Clave generada y guardada');
        draw();
      };
      $('#cpS').onclick = () => copyText(script);
      f.onsubmit = async (e) => {
        e.preventDefault();
        await saveInt({ sheets_enabled: f.sheets_enabled.checked ? '1' : '0', sheets_url: f.sheets_url.value.trim() }, 'Google Sheets guardado');
        draw();
      };
      $('#tst').onclick = (e) => test('sheets', '', e.currentTarget);
      $('#rt').onclick = async () => { const r = await POST('/api/integrations/sheets/retry', {}); toast(`${r.requeued} filas reenviadas a la cola`, 'ok'); };
      $('#bf').onclick = async () => {
        if (!(await confirmDlg('Se enviarán a la hoja todas las entregas registradas que aún no estén en ella. ¿Continuar?'))) return;
        const r = await POST('/api/integrations/sheets/retry', { backfill: true }); toast(`${r.backfill} entregas anteriores en cola`, 'ok');
      };
    };
    await draw();
  }
}

// ================= Comunicación con el cliente =================
const EVENT_LABEL = { registrado: 'Pedido registrado', en_camino: 'En camino', proximo: 'Repartidor cerca', entregado: 'Entregado', fallido: 'No entregado' };
const CH_LABEL = { sms: 'SMS', whatsapp: 'WhatsApp', email: 'Correo' };
const MSG_STATUS = { pendiente: ['En cola', 'warn'], enviado: ['Enviado', 'ok'], simulado: ['Simulado', ''], error: ['Error', 'off'] };
const GW_STATE = { Pending: ['En el teléfono, por salir', 'warn'], Processed: ['En el teléfono, por salir', 'warn'], Sent: ['Enviado por el teléfono', 'ok'], Delivered: ['Entregado al cliente ✓', 'ok'], Failed: ['El teléfono no lo envió', 'off'] };
const msgChip = (st, gw) => (gw && st === 'enviado' && GW_STATE[gw] ? `<span class="chip ${GW_STATE[gw][1]}" title="Estado real del SMS en el teléfono">${GW_STATE[gw][0]}</span>` : `<span class="chip ${MSG_STATUS[st]?.[1] || ''}">${MSG_STATUS[st]?.[0] || esc(st)}</span>`);
const SHEET_STATUS = { pendiente: ['Sheets: en cola', 'warn'], enviado: ['Sheets ✓', 'ok'], error: ['Sheets: error', 'off'], desactivado: ['Sheets desactivado', ''] };
const sheetChip = (st) => (st ? `<span class="chip ${SHEET_STATUS[st]?.[1] || ''}">${SHEET_STATUS[st]?.[0] || esc(st)}</span>` : '');
// SMS desde el celular del repartidor (su propio plan): abre la app de Mensajes con el texto listo.
// "sms:NUM?&body=" funciona en iPhone y Android.
function smsLink(phone, text = '') {
  const d = String(phone || '').replace(/\D/g, '').slice(-10);
  return `sms:+${SETTINGS.phone_country || '52'}${d}?&body=${encodeURIComponent(text)}`;
}
const arrivingText = (s) => `Hola ${firstName(s.customer_name || '')}, soy ${firstName(store.user.name)} de ${SETTINGS.company_name || 'Sovime Mensajería'}. Estamos llegando a su domicilio ahora con su paquete ${s.tracking_code}.`;
const smsBtn = (s, cls = 'sm') => (s.customer_phone ? `<a class="btn ${cls}" href="${esc(smsLink(s.customer_phone, arrivingText(s)))}" aria-label="Enviar SMS" title="SMS desde tu celular: «Estamos llegando a su domicilio ahora»">${icon('mail')} SMS</a>` : '');
function waLink(phone, text = '') {
  const d = String(phone || '').replace(/\D/g, '');
  const n = d.length === 10 ? (SETTINGS.phone_country || '52') + d : d;
  return `https://wa.me/${n}${text ? '?text=' + encodeURIComponent(text) : ''}`;
}
function printEl(el) {
  el.classList.add('print-target');
  document.body.classList.add('print-one');
  const done = () => { el.classList.remove('print-target'); document.body.classList.remove('print-one'); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  window.print();
  setTimeout(done, 1500);
}
function notifyDialog(o) {
  const m = modal('Avisar al cliente', `<form id="nf" class="stack">
    <p class="muted" style="margin:0">${esc(o.customer_name)} · ${esc(o.customer_phone || 'sin teléfono')}</p>
    <label class="f">Mensaje<select name="event">${Object.entries(EVENT_LABEL).map(([k, l]) => `<option value="${k}" ${k === suggestedEvent(o.status) ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <div class="row">${Object.entries(CH_LABEL).map(([k, l]) => `<label class="check-pill"><input type="checkbox" name="ch" value="${k}" checked /> ${l}</label>`).join('')}</div>
    <small class="muted">Se usa la plantilla configurada en Configuración → Notificaciones.</small></form>`,
  { footer: `${o.customer_phone ? `<a class="btn" target="_blank" id="waMan" href="#">${icon('chat')} WhatsApp manual</a>` : ''}<button class="btn" data-close>Cancelar</button><button class="btn primary" id="sendN">${icon('send')} Enviar</button>` });
  const f = $('#nf', m.el);
  const manual = () => {
    const ev = f.event.value;
    const txt = { registrado: `Hola, registramos tu envío ${o.tracking_code}.`, en_camino: `Hola, tu paquete ${o.tracking_code} va en camino.`, proximo: `Hola, tu repartidor está por llegar con el paquete ${o.tracking_code}.`, entregado: `Hola, tu paquete ${o.tracking_code} fue entregado.`, fallido: `Hola, no pudimos entregar tu paquete ${o.tracking_code}.` }[ev];
    return `${txt} Detalle: ${o.public_link || ''}`;
  };
  const wa = $('#waMan', m.el);
  if (wa) { const upd = () => (wa.href = waLink(o.customer_phone, manual())); f.event.onchange = upd; upd(); }
  $('#sendN', m.el).onclick = async () => {
    const channels = $$('input[name=ch]:checked', f).map((x) => x.value);
    if (!channels.length) return toast('Elige al menos un canal', 'bad');
    try { const r = await POST(`/api/orders/${o.id}/notify`, { event: f.event.value, channels }); toast(`${r.queued} mensaje(s) en cola`, 'ok'); m.close(); }
    catch (e) { toast(e.message, 'bad'); }
  };
}
const suggestedEvent = (st) => ({ pendiente: 'registrado', asignado: 'registrado', cargado: 'en_camino', entregado: 'entregado', fallido: 'fallido' }[st] || 'registrado');

// ================= Recepciones (evidencia de firma y foto) =================
function receiptHTML(e) {
  const ok = e.result === 'entregado';
  return `<div class="receipt" id="rcpt">
    <div class="rc-head">${logo()}<div class="r"><b>${ok ? 'Comprobante de entrega' : 'Constancia de visita'}</b><br><small>Guía <b class="mono">${esc(e.tracking_code)}</b></small><br><small>${fmtDT(e.created_at)}</small></div></div>
    <dl class="kv">
      <dt>Resultado</dt><dd>${badge(e.result)} ${e.kind === 'mostrador' ? '<span class="chip">Entregado en mostrador</span>' : ''}</dd>
      <dt>Destinatario</dt><dd><b>${esc(e.customer_name)}</b><br><small>${esc(e.address || '')}</small></dd>
      ${ok ? `<dt>Recibió</dt><dd><b>${esc(e.receiver_name || '—')}</b>${e.receiver_relation ? ` · ${esc(e.receiver_relation)}` : ''}${e.receiver_id_doc ? `<br><small>Identificación: ${esc(e.receiver_id_doc)}</small>` : ''}</dd>` : `<dt>Motivo</dt><dd><b>${esc(e.reason || '—')}</b></dd>`}
      <dt>${e.kind === 'mostrador' ? 'Atendió' : 'Repartidor'}</dt><dd>${esc(e.driver_name || '—')}</dd>
      ${e.kind !== 'mostrador' ? `<dt>Ubicación</dt><dd>${e.lat != null ? `${Number(e.lat).toFixed(5)}, ${Number(e.lng).toFixed(5)}${e.distance_to_customer_m != null ? ` · a ${fmtN(e.distance_to_customer_m)} m del domicilio` : ''}` : 'Sin GPS'}</dd>` : ''}
      ${e.serials_text ? `<dt>Números de serie</dt><dd class="mono">${esc(e.serials_text)}</dd>` : ''}
      ${(() => { try { return complianceHTML(e.compliance || JSON.parse(e.compliance_json || 'null')); } catch { return ''; } })()}
      <dt>Verificación</dt><dd>${e.barcode_verified ? '✅ Paquete escaneado' : 'Sin escaneo'}</dd>
      ${e.cod_amount ? `<dt>Cobro</dt><dd>${money(e.cod_amount)}</dd>` : ''}
      ${e.notes ? `<dt>Comentarios</dt><dd>${esc(e.notes)}</dd>` : ''}
    </dl>
    <div class="rc-evid">
      <figure>${e.signature_path ? `<img src="/uploads/${esc(e.signature_path)}" alt="Firma" class="rc-sigimg" />` : '<div class="rc-noimg">Sin firma</div>'}<figcaption>Firma de quien recibe</figcaption></figure>
      <figure>${e.photo_path ? `<a href="/uploads/${esc(e.photo_path)}" target="_blank"><img src="/uploads/${esc(e.photo_path)}" alt="Fotografía de la entrega" /></a>` : '<div class="rc-noimg">Sin fotografía</div>'}<figcaption>Fotografía de la entrega</figcaption></figure>
    </div>
  </div>`;
}
function openReceipt(e) {
  const m = modal('Comprobante', receiptHTML(e), {
    wide: true,
    footer: `${e.public_link ? `<button class="btn" id="cpL">${icon('copy')} Copiar enlace</button><a class="btn" target="_blank" href="${esc(e.public_link)}">${icon('ext')} Ver como cliente</a>` : ''}
      ${e.customer_phone && e.public_link ? `<a class="btn" target="_blank" href="${esc(waLink(e.customer_phone, `Hola, este es el comprobante de entrega de tu paquete ${e.tracking_code}: ${e.public_link}`))}">${icon('chat')} Enviar por WhatsApp</a>` : ''}
      ${e.serials_text && !driverMode() ? `<button class="btn" id="fixSN" title="Corregir un número de serie capturado por error">${icon('edit')} Corregir S/N</button>` : ''}
      <button class="btn primary" id="prR">${icon('print')} Imprimir</button>`,
  });
  $('#cpL', m.el)?.addEventListener('click', () => copyText(e.public_link));
  // corregir S/N mal capturado: el correcto queda en el pedido, el comprobante y la hoja de Google
  $('#fixSN', m.el)?.addEventListener('click', () => {
    const list = String(e.serials_text).split(',').map((x) => x.trim()).filter(Boolean);
    const d = modal('Corregir número de serie', `<form id="fxF" class="stack">
      <p class="muted" style="margin:0">Escribe el S/N correcto del equipo que se entregó. Si no existe en el sistema se corrige el texto; si está en el inventario, pasa a este pedido y el equivocado regresa al inventario.</p>
      ${list.map((sn, i) => `<label class="f"><span>Capturado: <b class="mono">${esc(sn)}</b></span><input name="n${i}" data-old="${esc(sn)}" class="mono" value="${esc(sn)}" autocomplete="off" style="text-transform:uppercase" /></label>`).join('')}
    </form>`, { footer: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="fxGo">Guardar corrección</button>' });
    $('#fxGo', d.el).onclick = async () => {
      const ch = $$('[data-old]', d.el).map((x) => ({ old_serial: x.dataset.old, new_serial: x.value.trim().toUpperCase() })).filter((x) => x.new_serial && x.new_serial !== x.old_serial);
      if (!ch.length) return toast('No cambiaste ningún número', 'bad');
      if (!(await confirmDlg(`¿Corregir ${ch.map((x) => `${x.old_serial} → ${x.new_serial}`).join(', ')} en el pedido ${e.tracking_code}?`))) return;
      try {
        let r;
        for (const x of ch) r = await POST(`/api/orders/${e.order_id}/serials/fix`, x);
        e.serials_text = r.serials_text;
        $('#rcpt', m.el).outerHTML = receiptHTML(e);
        toast(`S/N corregido${r.how === 'intercambiado' ? ' (el capturado regresó al inventario)' : ''}. La hoja de Google se actualiza sola.`, 'ok');
        d.close();
      } catch (er) { toast(er.message, 'bad'); }
    };
  });
  $('#prR', m.el).onclick = () => printEl($('#rcpt', m.el));
}

const rcState = { q: '', from: '', to: '', kind: '', result: 'entregado', office_id: '', city: '', driver_id: '' };
async function viewReceipts(v) {
  if (!rcState.from) { rcState.from = new Date(Date.now() - 6 * 864e5).toLocaleDateString('en-CA'); rcState.to = today(); }
  const [rcOffs, rcCities, rcDrivers] = await Promise.all([
    store.user.role === 'admin' ? GET('/api/warehouses').catch(() => []) : [],
    GET(`/api/dashboard/breakdown?office_id=${rcState.office_id}`).then((r) => r.city_list || []).catch(() => []),
    GET('/api/users?role=repartidor').catch(() => []),
  ]);
  v.innerHTML = topbar('Recepciones', `<button class="btn primary" id="ctrBtn">${icon('sign')} Recepción en mostrador</button>`,
    'Quién recibió cada paquete, con firma, fotografía, hora y ubicación.') + `
  <div class="card">
    <form class="toolbar" id="rcF">
      <label class="search">${icon('search')}<input name="q" type="search" placeholder="Guía, cliente o quien recibió…" value="${esc(rcState.q)}" /></label>
      <input type="date" name="from" value="${rcState.from}" aria-label="Desde" style="width:auto" />
      <input type="date" name="to" value="${rcState.to}" aria-label="Hasta" style="width:auto" />
      <select name="kind" aria-label="Tipo"><option value="">Ruta y mostrador</option><option value="ruta">En ruta</option><option value="mostrador">En mostrador</option></select>
      <select name="result" aria-label="Resultado"><option value="entregado">Entregados</option><option value="fallido">No entregados</option><option value="">Todos</option></select>
      ${rcOffs.length > 1 ? `<select name="office_id" aria-label="Oficina"><option value="">Todas las oficinas</option>${rcOffs.map((w) => `<option value="${w.id}">${esc(w.name)}</option>`).join('')}</select>` : ''}
      <select name="city" aria-label="Ciudad"><option value="">Todas las ciudades</option>${rcCities.map((c) => `<option>${esc(c)}</option>`).join('')}</select>
      <select name="driver_id" aria-label="Repartidor"><option value="">Todos los repartidores</option>${rcDrivers.map((d) => `<option value="${d.id}">${esc(d.name)}${d.active ? '' : ' (inactivo)'}</option>`).join('')}</select>
    </form>
    <div id="rcList" class="rc-grid"></div>
    <div class="pager" id="rcMore"></div>
  </div>`;
  const f = $('#rcF');
  f.kind.value = rcState.kind; f.result.value = rcState.result;
  if (f.office_id) f.office_id.value = rcState.office_id;
  if (rcState.city && !rcCities.some((c) => c.toLowerCase() === rcState.city.toLowerCase())) rcState.city = '';
  f.city.value = rcCities.find((c) => c.toLowerCase() === rcState.city.toLowerCase()) || '';
  f.driver_id.value = rcState.driver_id;
  // al cambiar de oficina se recargan sus ciudades
  f.office_id?.addEventListener('change', (e) => { e.stopPropagation(); Object.assign(rcState, Object.fromEntries(new FormData(f)), { city: '' }); render(); });
  let offset = 0;
  let rows = [];
  const load = async (reset) => {
    if (reset) { offset = 0; rows = []; $('#rcList').innerHTML = ''; }
    const p = new URLSearchParams({ ...rcState, limit: 24, offset });
    const r = await GET('/api/evidences?' + p);
    const start = rows.length;
    rows.push(...r.rows);
    offset += r.rows.length;
    $('#rcList').insertAdjacentHTML('beforeend', r.rows.map((e, i) => `<button class="rc-card" data-i="${start + i}">
      <div class="rc-media">${e.photo_path ? `<img loading="lazy" src="/uploads/${esc(e.photo_path)}" alt="" />` : `<div class="rc-noimg">${icon('camera')}</div>`}
        ${e.signature_path ? `<img loading="lazy" class="rc-sig" src="/uploads/${esc(e.signature_path)}" alt="Firma" />` : ''}</div>
      <div class="rc-body">
        <div class="row between"><b class="mono">${esc(e.tracking_code)}</b>${e.kind === 'mostrador' ? '<span class="chip">Mostrador</span>' : badge(e.result)}</div>
        <span>${esc(e.customer_name)}</span>
        ${e.result === 'entregado' ? `<small>Recibió <b>${esc(e.receiver_name || '—')}</b>${e.receiver_relation ? ` · ${esc(e.receiver_relation)}` : ''}</small>` : `<small>Motivo: <b>${esc(e.reason || '—')}</b></small>`}
        <small class="muted">${fmtDT(e.created_at)} · ${esc(e.driver_name || '')}</small>
        <span class="row" style="gap:4px">${!e.signature_path && e.result === 'entregado' ? '<span class="chip warn">Sin firma</span>' : ''}${!e.photo_path ? '<span class="chip warn">Sin foto</span>' : ''}${sheetChip(e.sheet_status)}</span>
      </div></button>`).join('') || (start ? '' : `<div class="empty" style="grid-column:1/-1">${icon('sign')}<p><b>Sin recepciones en este periodo</b></p></div>`));
    $('#rcMore').innerHTML = `<small class="muted">${offset} de ${r.total}</small>${offset < r.total ? '<button class="btn sm" id="rcNext">Ver más</button>' : ''}`;
    $('#rcNext')?.addEventListener('click', () => load(false));
  };
  $('#rcList').onclick = (ev) => { const b = ev.target.closest('[data-i]'); if (b) openReceipt(rows[b.dataset.i]); };
  let t;
  const apply = () => { Object.assign(rcState, Object.fromEntries(new FormData(f))); load(true); };
  f.oninput = (e) => { clearTimeout(t); t = setTimeout(apply, e.target.name === 'q' ? 300 : 0); };
  f.onsubmit = (e) => { e.preventDefault(); apply(); };
  $('#ctrBtn').onclick = () => counterReception(() => load(true));
  await load(true);
}

// Captura de evidencia reutilizable: foto (cámara del teléfono, archivo o cámara web) + firma
function evidenceCapture(root, { photoRequired, signatureRequired }) {
  root.innerHTML = `
    <div class="ev-photo"><label class="f">Fotografía ${photoRequired ? '<b class="req">*</b>' : '(opcional)'}</label>
      <div class="row" style="margin-top:4px"><label class="btn grow">${icon('camera')} Tomar o elegir foto<input type="file" accept="image/*" capture="environment" hidden data-file /></label>
      ${navigator.mediaDevices?.getUserMedia ? `<button type="button" class="btn" data-webcam>${icon('video')} Cámara web</button>` : ''}</div>
      <div class="webcam" hidden><video playsinline muted></video><button type="button" class="btn primary" data-snap>${icon('camera')} Capturar</button></div>
      <img class="photo-prev" hidden alt="Vista previa de la foto" /></div>
    <div><label class="f">Firma de quien recibe ${signatureRequired ? '<b class="req">*</b>' : '(opcional)'}</label>
      <div class="sig-wrap" style="margin-top:4px"><canvas></canvas><button type="button" class="btn sm clear" data-clear>Borrar</button><span class="sig-hint">Firme aquí</span></div></div>`;
  let photo = null;
  let stream = null;
  const prev = $('.photo-prev', root);
  const setPhoto = (d) => { photo = d; prev.src = d; prev.hidden = false; };
  $('[data-file]', root).onchange = async (e) => { const fl = e.target.files[0]; if (fl) setPhoto(await compressImage(fl)); };
  const stop = () => { stream?.getTracks().forEach((t) => t.stop()); stream = null; $('.webcam', root).hidden = true; };
  $('[data-webcam]', root)?.addEventListener('click', async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false });
      const vid = $('.webcam video', root);
      vid.srcObject = stream; await vid.play();
      $('.webcam', root).hidden = false;
    } catch { toast('No se pudo abrir la cámara. Usa "Tomar o elegir foto".', 'bad'); }
  });
  $('[data-snap]', root).onclick = () => {
    const vid = $('.webcam video', root);
    const c = document.createElement('canvas');
    c.width = vid.videoWidth; c.height = vid.videoHeight;
    c.getContext('2d').drawImage(vid, 0, 0);
    c.toBlob(async (b) => { setPhoto(await compressImage(b)); stop(); }, 'image/jpeg', 0.9);
  };
  const canvas = $('canvas', root);
  const sig = signaturePad(canvas);
  const hint = $('.sig-hint', root);
  canvas.addEventListener('pointerdown', () => (hint.hidden = true));
  $('[data-clear]', root).onclick = () => { sig.clear(); hint.hidden = false; };
  return {
    photo: () => photo,
    signature: () => sig.data(),
    stop,
    validate() {
      if (photoRequired && !photo) return 'Toma la fotografía de la entrega';
      if (signatureRequired && sig.empty) return 'Falta la firma de quien recibe';
      if (!photo && sig.empty) return 'Toma una foto o captura la firma';
      return null;
    },
  };
}

// Entrega en mostrador: el cliente pasa por su paquete
function counterReception(done) {
  const m = modal('Recepción en mostrador', `<div class="stack">
    <form id="ctrFind" class="row"><input class="grow" name="code" placeholder="Escanea o escribe la guía" autocomplete="off" required />
      <button class="btn" type="button" id="ctrScan">${icon('scan')}</button><button class="btn primary">Buscar</button></form>
    <div id="ctrBody" class="muted">Busca el paquete para registrar quién lo recibe.</div></div>`,
  { wide: true, onClose: () => cap?.stop() });
  let cap = null;
  const find = async (code) => {
    try {
      const o = await GET('/api/orders/tracking/' + encodeURIComponent(code.trim()));
      if (['entregado', 'cancelado'].includes(o.status)) { $('#ctrBody', m.el).innerHTML = `<div class="offline-bar">El paquete ${esc(o.tracking_code)} ya está ${STATUS[o.status].toLowerCase()}.</div>`; return; }
      $('#ctrBody', m.el).innerHTML = `<form id="ctrF" class="stack">
        <div class="ctr-sum"><div><b class="mono">${esc(o.tracking_code)}</b> ${badge(o.status)}<br><b>${esc(o.customer_name)}</b><br><small class="muted">${esc(o.address)}</small></div>
          <div class="r"><small class="muted">${o.items.map((i) => `${i.qty}× ${esc(i.name)}`).join('<br>') || 'Sin artículos'}</small>${o.cod_amount ? `<div class="offline-bar" style="margin:6px 0 0">Cobrar ${money(o.cod_amount)}</div>` : ''}</div></div>
        <div class="grid g3"><label class="f">Nombre de quien recibe <b class="req">*</b><input name="receiver_name" required value="${esc(o.customer_name)}" /></label>
          <label class="f">Relación<select name="receiver_relation"><option>Titular</option><option>Familiar</option><option>Representante</option><option>Mensajero autorizado</option><option>Otro</option></select></label>
          <label class="f">Identificación<input name="receiver_id_doc" placeholder="INE, pasaporte… (últimos 4)" /></label></div>
        <div class="grid g2" id="ctrCap"></div>
        ${complianceFields(o)}
        <label class="f">Comentarios<textarea name="notes" placeholder="Observaciones de la entrega…"></textarea></label>
        <button class="btn ok lg block" id="ctrOk">${icon('check')} Confirmar recepción</button></form>`;
      cap = evidenceCapture($('#ctrCap', m.el), { photoRequired: SETTINGS.require_photo === '1', signatureRequired: SETTINGS.require_signature === '1' });
      const getComp = wireCompliance(m.el, o);
      $('#ctrF', m.el).onsubmit = async (e) => {
        e.preventDefault();
        const f = e.target;
        if (!f.reportValidity()) return;
        const err = cap.validate();
        if (err) return toast(err, 'bad');
        const b = { ...Object.fromEntries(new FormData(f)), ...getComp(), kind: 'mostrador', photo: cap.photo(), signature: cap.signature(), barcode_verified: true, captured_at: new Date().toISOString() };
        $('#ctrOk', m.el).disabled = true;
        try {
          const r = await withSerials(() => POST(`/api/orders/${o.id}/deliver`, b), o.tracking_code);
          toast('Recepción registrada ✅', 'ok');
          m.close();
          done?.();
          const ev = r.order.evidences[0];
          openReceipt({ ...ev, tracking_code: r.order.tracking_code, customer_name: r.order.customer_name, address: r.order.address, customer_phone: r.order.customer_phone, cod_amount: r.order.cod_amount, driver_name: store.user.name, public_link: (await GET('/api/orders/' + o.id)).public_link });
        } catch (er) { $('#ctrOk', m.el).disabled = false; toast(er.message, 'bad'); }
      };
    } catch (e) { $('#ctrBody', m.el).innerHTML = `<div class="login-err">${esc(e.message)}</div>`; }
  };
  $('#ctrFind', m.el).onsubmit = (e) => { e.preventDefault(); find(e.target.code.value); };
  $('#ctrScan', m.el).onclick = () => openScanner({ title: 'Escanear guía', onCode: async (c) => { $('#ctrFind', m.el).code.value = c; find(c); } });
  setTimeout(() => $('#ctrFind', m.el)?.code.focus(), 100);
}

// ================= Mensajes enviados a clientes =================
const msgState = { q: '', status: '', channel: '', event: '' };
async function viewMessages(v) {
  v.innerHTML = topbar('Mensajes a clientes', store.user.role === 'admin' ? `<a class="btn" href="#/settings?tab=notif">${icon('cog')} Configurar canales</a>` : '',
    'SMS, WhatsApp y correos automáticos durante el envío y la entrega.') + `
  <div id="msgBanner"></div>
  <div class="grid g4" id="msgStats"></div>
  <div class="card" style="margin-top:14px">
    <form class="toolbar" id="msF">
      <label class="search">${icon('search')}<input name="q" type="search" placeholder="Guía, cliente, teléfono o correo…" value="${esc(msgState.q)}" /></label>
      <select name="channel"><option value="">Todos los canales</option>${Object.entries(CH_LABEL).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
      <select name="event"><option value="">Todos los avisos</option>${Object.entries(EVENT_LABEL).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
      <select name="status"><option value="">Todos los estados</option>${Object.entries(MSG_STATUS).map(([k, l]) => `<option value="${k}">${l[0]}</option>`).join('')}</select>
    </form>
    <div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Guía / cliente</th><th>Aviso</th><th>Canal</th><th>Destinatario</th><th>Estado</th><th></th></tr></thead><tbody id="msRows"></tbody></table></div>
    <div class="pager" id="msMore"></div></div>`;
  const f = $('#msF');
  for (const k of ['channel', 'event', 'status']) f[k].value = msgState[k];
  let offset = 0;
  let rows = [];
  const load = async (reset) => {
    if (reset) { offset = 0; rows = []; $('#msRows').innerHTML = ''; }
    const r = await GET('/api/messages?' + new URLSearchParams({ ...msgState, limit: 40, offset }));
    const st = Object.fromEntries(r.stats.map((x) => [x.status, x.n]));
    $('#msgStats').innerHTML = [['enviado', 'Enviados (24 h)'], ['simulado', 'Simulados (24 h)'], ['pendiente', 'En cola'], ['error', 'Con error']].map(([k, l]) => `<div class="card kpi"><div class="label">${l}</div><div class="value" style="${k === 'error' && st[k] ? 'color:var(--bad)' : ''}">${st[k] || 0}</div></div>`).join('');
    GET('/api/messages/devices').then((ds) => {
      if (!ds.length || !$('#msgStats')) return;
      $('#msgDev')?.remove();
      $('#msgStats').insertAdjacentHTML('afterend', `<div class="card" id="msgDev" style="margin-top:12px"><div class="row between"><h3 style="margin:0">${icon('phone')} Teléfonos que envían SMS</h3><small class="muted">tope ${ds[0].cap} por línea al día · se reparte entre los conectados</small></div>
        <div class="grid g3" style="margin-top:8px">${ds.map((d) => `<div><div class="row between"><b>${esc(d.name || d.id)}</b><span class="chip ${d.online ? 'ok' : 'off'}">${d.online ? 'Conectado' : 'Sin conexión'}</span></div>
          <div class="progress" style="margin:6px 0"><i style="width:${Math.min(100, (d.today / d.cap) * 100)}%;background:${d.today >= d.cap ? 'var(--bad)' : d.today >= d.cap * 0.8 ? 'var(--warn)' : 'var(--ok)'}"></i></div>
          <small class="muted">${d.today} de ${d.cap} SMS hoy${d.lastSeen ? ' · visto ' + fmtDT(d.lastSeen) : ''}</small></div>`).join('')}</div></div>`);
    }).catch(() => {});
    $('#msgBanner').innerHTML = !st.enviado && st.simulado ? `<div class="info-bar">${icon('info')} Los canales están en <b>modo simulación</b>: los mensajes se registran pero no salen. ${store.user.role === 'admin' ? '<a href="#/settings?tab=notif">Configura SMS, WhatsApp y correo</a>.' : 'Pide al administrador que configure los proveedores.'}</div>` : '';
    const start = rows.length;
    rows.push(...r.rows);
    offset += r.rows.length;
    $('#msRows').insertAdjacentHTML('beforeend', r.rows.map((x, i) => `<tr class="click" data-i="${start + i}"><td><small>${fmtDT(x.created_at)}</small></td>
      <td><b class="mono">${esc(x.tracking_code || '—')}</b><br><small class="muted">${esc(x.customer_name || '')}</small></td><td>${EVENT_LABEL[x.event] || esc(x.event)}</td>
      <td>${icon(x.channel === 'email' ? 'mail' : x.channel === 'whatsapp' ? 'chat' : 'phone')} ${CH_LABEL[x.channel]}</td><td><small>${esc(x.recipient)}</small></td>
      <td>${msgChip(x.status, x.gw_state)}${x.error ? `<br><small style="color:var(--bad)">${esc(x.error.slice(0, 60))}</small>` : ''}</td>
      <td class="r">${['error', 'simulado'].includes(x.status) ? `<button class="btn sm" data-retry="${x.id}">Reintentar</button>` : ''}</td></tr>`).join('') || (start ? '' : '<tr><td colspan="7" class="empty">Aún no hay mensajes</td></tr>'));
    $('#msMore').innerHTML = `<small class="muted">${offset} de ${r.total}</small>${offset < r.total ? '<button class="btn sm" id="msNext">Ver más</button>' : ''}`;
    $('#msNext')?.addEventListener('click', () => load(false));
  };
  $('#msRows').onclick = async (ev) => {
    const rb = ev.target.closest('[data-retry]');
    if (rb) { ev.stopPropagation(); try { await POST(`/api/messages/${rb.dataset.retry}/retry`); toast('Reenviando…', 'ok'); setTimeout(() => load(true), 1500); } catch (e) { toast(e.message, 'bad'); } return; }
    const tr = ev.target.closest('[data-i]');
    if (!tr) return;
    const x = rows[tr.dataset.i];
    modal(`${CH_LABEL[x.channel]} · ${EVENT_LABEL[x.event]}`, `<div class="stack"><div class="row">${msgChip(x.status)}<small class="muted">Para ${esc(x.recipient)} · ${fmtDT(x.created_at)}</small></div>
      ${x.subject ? `<b>${esc(x.subject)}</b>` : ''}<div class="msg-bubble ${x.channel}">${esc(x.body)}</div>
      ${x.error ? `<div class="login-err">${esc(x.error)}</div>` : ''}${x.provider_ref ? `<small class="muted">Referencia del proveedor: ${esc(x.provider_ref)}</small>` : ''}</div>`);
  };
  let t;
  f.oninput = (e) => { clearTimeout(t); t = setTimeout(() => { Object.assign(msgState, Object.fromEntries(new FormData(f))); load(true); }, e.target.name === 'q' ? 300 : 0); };
  f.onsubmit = (e) => e.preventDefault();
  await load(true);
}

// ================= REPARTIDOR =================
// Rastreo GPS: envía la posición cada 20 s o al moverse 60 m (cada 8 s mínimo); en navegación, cada 10 s.
const GPS = { state: 'off', acc: null, at: 0, sentAt: 0, last: null, sentPos: null, fast: false };
let watchId = null;
function gpsLabel() {
  if (!navigator.geolocation) return ['Este dispositivo no tiene GPS', 'off'];
  if (GPS.state === 'denied') return ['Ubicación bloqueada: actívala en los permisos del navegador', 'off'];
  if (GPS.state === 'on') return [`GPS activo · ±${Math.round(GPS.acc || 0)} m · enviado ${GPS.sentAt ? ago(new Date(GPS.sentAt).toISOString().replace('T', ' ').slice(0, 19)) : 'pendiente'}`, 'ok'];
  if (GPS.state === 'wait') return ['Buscando señal GPS…', 'warn'];
  return ['GPS apagado', 'off'];
}
function paintGps() {
  const [t, c] = gpsLabel();
  $$('[data-gps]').forEach((el) => { el.className = 'gps-pill ' + c; el.textContent = t; });
  $$('.gps-dot').forEach((el) => (el.dataset.s = c));
}
function sendLocation(force) {
  const p = GPS.last;
  if (!p || !navigator.onLine) return;
  const now = Date.now();
  const moved = GPS.sentPos ? haversineM(GPS.sentPos, p) : Infinity;
  const every = GPS.fast ? 10000 : 20000;
  if (!force && now - GPS.sentAt < 8000) return;
  if (!force && now - GPS.sentAt < every && moved < 60) return;
  GPS.sentAt = now;
  GPS.sentPos = { lat: p.lat, lng: p.lng };
  POST('/api/my/location', p).then(paintGps).catch(() => {});
}
function haversineM(a, b) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const gpsListeners = new Set();
function startTracking() {
  if (watchId != null || !navigator.geolocation || !driverMode()) return;
  GPS.state = 'wait'; paintGps();
  watchId = navigator.geolocation.watchPosition((p) => {
    GPS.state = 'on';
    GPS.acc = p.coords.accuracy;
    GPS.at = Date.now();
    GPS.last = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, speed: p.coords.speed, heading: p.coords.heading };
    sendLocation();
    paintGps();
    gpsListeners.forEach((fn) => fn(GPS.last));
  }, (err) => { GPS.state = err.code === 1 ? 'denied' : 'wait'; paintGps(); }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
}
function stopTracking() { if (watchId != null) navigator.geolocation.clearWatch(watchId); watchId = null; GPS.state = 'off'; }
setInterval(() => { if (watchId != null) { sendLocation(); paintGps(); } }, 15000);

function checkBanner() {
  GET('/api/my/check').then((r) => {
    const b = $('#ckBanner');
    if (!b || !r.vehicles.length) return;
    b.innerHTML = r.check
      ? `<a class="ck-banner ok" href="#/check">${icon('check')} Checklist de hoy: ${esc(r.check.vehicle_name)} · ${r.check.passed ? 'aprobado' : 'con observaciones'}</a>`
      : `<a class="ck-banner ${r.required ? 'bad' : 'warn'}" href="#/check">${icon('truck')} <span><b>Llena el checklist de tu unidad</b>${r.required ? ' · obligatorio antes de cargar' : ''}</span>${icon('chev')}</a>`;
  }).catch(() => {});
}
async function viewMyRoute(v) {
  const r = await GET('/api/my/route');
  const queued = outbox.list();
  const queuedIds = new Set(queued.map((q) => Number(q.url.split('/')[3])));
  startTracking();
  checkBanner();
  if (!r) { v.innerHTML = topbar('Mi ruta') + `<span data-gps></span><div id="ckBanner"></div>${queued.length ? `<div class="offline-bar">${queued.length} evidencias pendientes de enviar</div>` : ''}<div class="card empty">${icon('truck')}<p>No tienes ruta asignada para hoy.</p></div>`; paintGps(); return; }
  const open = r.stops.filter((s) => ['asignado', 'cargado'].includes(s.status) && !queuedIds.has(s.id));
  const done = r.stops.filter((s) => s.status === 'entregado').length;
  const fail = r.stops.filter((s) => s.status === 'fallido').length;
  const notLoaded = r.stops.filter((s) => s.status === 'asignado').length;
  const next = open[0];
  v.innerHTML = topbar('Mi ruta', `<button class="btn sm" id="reopt">⚡ Re-optimizar desde aquí</button>`) + `
  <span data-gps></span><div id="ckBanner"></div>
  ${!navigator.onLine ? '<div class="offline-bar">Sin conexión. Puedes seguir registrando entregas.</div>' : ''}
  ${queued.length ? `<div class="offline-bar">${queued.length} evidencias en cola de envío</div>` : ''}
  ${r.status === 'planificada' && open.length ? `<div class="card" style="margin-bottom:12px;border:2px solid var(--brand,#1d5a96)"><div class="row between"><div><b style="font-size:17px">Ruta lista: ${open.length} parada${open.length === 1 ? '' : 's'}</b><br><small class="muted">Al iniciar se avisa a tus clientes que vas en camino y a la primera parada que llegas pronto.</small></div>
      <button class="btn primary lg" id="startRoute">▶ Iniciar ruta</button></div></div>`
    : r.started_at ? `<div class="info-bar" style="margin-bottom:12px">${icon('route')} Ruta en curso desde las ${new Date(r.started_at.replace(' ', 'T') + 'Z').toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</div>` : ''}
  ${next ? `<div class="card next-card">
    <small class="muted">Siguiente parada · ${next.stop_seq} de ${r.stops.length}${next.eta ? ' · llegada estimada ' + esc(next.eta) : ''}</small>
    <h2 style="margin:4px 0 2px">${esc(next.customer_name)}</h2><div>${esc(next.address)}</div>${next.address_reference ? `<small class="muted">${esc(next.address_reference)}</small>` : ''}
    <div class="tels">${phonesLine(next)}</div>
    ${geoChk(next.geo_quality) ? `<div style="margin-top:6px">${geoWarn(next.geo_quality)}<br><small class="muted">Al llegar al domicilio toca <b>📍 Estoy aquí</b> para dejar la ubicación correcta.</small> <button class="btn sm" data-here="${next.id}">📍 Estoy aquí</button></div>` : ''}
    ${next.cod_amount ? `<div class="offline-bar" style="margin:8px 0 0">Cobrar ${money(next.cod_amount)}</div>` : ''}
    <div class="row" style="margin-top:12px"><a class="btn primary lg grow" data-nav="${next.id}" href="#/nav/${next.id}">${icon('nav')} Navegar</a><a class="btn ok lg" href="#/deliver/${next.id}">${icon('check')} Entregar</a></div>
    ${next.customer_phone ? `<div class="row" style="margin-top:8px;gap:6px"><a class="btn grow" href="tel:${esc(next.customer_phone)}">${icon('phone')} Llamar</a>${smsBtn(next, 'grow')}<a class="btn grow" target="_blank" rel="noopener" href="${esc(waLink(next.customer_phone, arrivingText(next)))}">${icon('chat')} WhatsApp</a></div>` : ''}
  </div>` : `<div class="card empty">${icon('check')}<p><b>¡Ruta terminada!</b><br>No quedan paradas por visitar.</p></div>`}
  <div class="card" style="margin:12px 0">
    <div class="row between"><b>${r.stops.length} paradas · ${fmtN(r.distance_km, 1)} km · ~${fmtN(r.est_minutes / 60, 1)} h</b>${badge(r.status)}</div>
    <div class="progress" style="margin:10px 0 6px"><i style="width:${(done / r.stops.length) * 100}%;background:var(--ok)"></i><i style="width:${(fail / r.stops.length) * 100}%;background:var(--bad)"></i></div>
    <small class="muted">${done} entregadas · ${fail} fallidas · ${open.length} por visitar</small>
    ${notLoaded ? `<a href="#/load" class="btn block" style="margin-top:10px;background:var(--warn-soft);color:var(--warn);border-color:transparent">${icon('truck')} Faltan ${notLoaded} paquetes por escanear al vehículo</a>` : ''}
    ${open.length > 1 ? `<div class="row" style="margin-top:10px"><a class="btn grow" target="_blank" rel="noopener" href="${gmapsUrl(open)}">${icon('route')} Ruta completa en Google Maps</a></div>` : ''}
  </div>
  <div id="mymap" class="map sm" style="margin-bottom:12px"></div>
  <div class="card" style="padding:0">${r.stops.map((s) => {
    const q = queuedIds.has(s.id);
    const cls = s.status === 'entregado' || q ? 'done' : s.status === 'fallido' ? 'fail' : s === next ? 'next' : '';
    const actionable = ['asignado', 'cargado'].includes(s.status) && !q;
    return `<div class="stop ${cls}"><div class="n">${s.status === 'entregado' || q ? '✓' : s.status === 'fallido' ? '✕' : s.stop_seq}</div><div>
      <div class="row between"><span class="addr">${esc(s.customer_name)}</span><span class="num muted">${esc(s.eta || '')}</span></div>
      <div>${esc(s.address)}</div>${s.address_reference ? `<small class="muted">${esc(s.address_reference)}</small><br>` : ''}${geoChk(s.geo_quality) && actionable ? `${geoWarn(s.geo_quality)}<br>` : ''}<div class="tels">${phonesLine(s)}</div>
      <small class="muted">${esc(s.tracking_code)} ${s.appointment_time ? `· <b>⏰ ${esc(s.appointment_time)}</b>` : s.window_start ? `· recibe ${s.window_start}–${s.window_end}` : ''} ${s.cod_amount ? `· <b style="color:var(--warn)">Cobrar ${money(s.cod_amount)}</b>` : ''}</small>
      ${s.priority === 'alta' ? ' <span class="badge b-alta">Urgente</span>' : ''} ${q ? '<span class="badge b-cargado">En cola</span>' : badge(s.status)}
      ${actionable ? `<div class="acts">
        ${s.lat != null || s.address ? `<a class="btn sm" data-nav="${s.id}" href="#/nav/${s.id}">${icon('nav')} Navegar</a>` : ''}
        ${s.customer_phone ? `<a class="btn sm" href="tel:${esc(s.customer_phone)}" aria-label="Llamar">${icon('phone')}</a><a class="btn sm" target="_blank" rel="noopener" href="${esc(waLink(s.customer_phone, arrivingText(s)))}">${icon('chat')}</a>${smsBtn(s)}` : ''}${s.customer_phone_alt ? `<a class="btn sm" href="tel:${esc(s.customer_phone_alt)}" aria-label="Llamar al teléfono adicional" title="Teléfono adicional">${icon('phone')}2</a>` : ''}
        ${geoChk(s.geo_quality) ? `<button class="btn sm" data-here="${s.id}" title="Estoy en el domicilio: guardar mi ubicación como la del cliente">📍 Estoy aquí</button>` : ''}<a class="btn sm ok" href="#/deliver/${s.id}">${icon('check')} Entregar</a><a class="btn sm bad" href="#/fail/${s.id}">No entregado</a></div>` : ''}
    </div></div>`;
  }).join('')}</div>`;
  paintGps();
  const map = makeMap($('#mymap'));
  drawRoute(map, r.stops, undefined, { depotLL: r.depot_lat != null ? [r.depot_lat, r.depot_lng] : null });
  let meMk = null;
  const showMe = (p) => { if (!$('#mymap')) return gpsListeners.delete(showMe); if (meMk) meMk.setLatLng([p.lat, p.lng]); else meMk = L.marker([p.lat, p.lng], { icon: meIcon(), zIndexOffset: 1000 }).addTo(map); };
  if (GPS.last) showMe(GPS.last);
  gpsListeners.add(showMe);
  $('#startRoute')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (!(await confirmDlg(`¿Iniciar tu ruta? Se avisará a tus ${open.length} cliente(s) que vas en camino.`))) return;
    btn.disabled = true;
    try {
      const x = await POST('/api/my/route/start', {});
      toast(`Ruta iniciada · ${x.notified} cliente(s) avisados${x.first_notified ? ' · la primera parada sabe que llegas pronto' : ''}`, 'ok');
      render();
    } catch (er) {
      btn.disabled = false;
      toast(er.message, 'bad');
      if (/checklist/i.test(er.message)) location.hash = '#/check';
    }
  });
  // Navegar: abre Google Maps (o Waze) directo; "Mapa de la app" usa el navegador interno
  $('#topbar-nav-pref')?.remove();
  $('.topbar .actions', v)?.insertAdjacentHTML('afterbegin', `<label class="row" id="topbar-nav-pref" style="gap:4px" title="Con qué app navegar en este teléfono"><small class="muted">Navegar con</small><select id="navSel" style="width:auto"><option value="google">Google Maps</option><option value="waze">Waze</option><option value="app">Mapa de la app</option></select></label>`);
  if ($('#navSel')) { $('#navSel').value = navPref(); $('#navSel').onchange = (e) => { try { localStorage.setItem('navApp', e.target.value); } catch {} toast(`Navegarás con ${e.target.selectedOptions[0].text}`, 'ok'); }; }
  $$('[data-nav]', v).forEach((a) => (a.onclick = (e) => {
    const app = navPref();
    if (app === 'app') return; // navegador interno
    e.preventDefault();
    const st = r.stops.find((x) => String(x.id) === a.dataset.nav);
    // aviso "tu repartidor está cerca" (si ya va cargado), con tiempo estimado desde la ubicación actual
    if (st.status === 'cargado') {
      const p = GPS.last;
      const mins = p && st.lat != null ? Math.max(3, Math.round((haversineM(p, st) * (Number(SETTINGS.road_factor) || 1.35)) / 1000 / (Number(SETTINGS.avg_speed_kmh) || 22) * 60)) : 15;
      POST(`/api/orders/${st.id}/arriving`, { minutes: mins }).catch(() => {});
    }
    window.open(navUrl(st, app), '_blank', 'noopener');
  }));
  // "Estoy aquí": el repartidor fija la ubicación del cliente con su GPS
  $$('[data-here]', v).forEach((b) => (b.onclick = async () => {
    const st = r.stops.find((x) => String(x.id) === b.dataset.here);
    b.disabled = true;
    const p = await getPosition(12000) || GPS.last;
    if (!p) { b.disabled = false; return toast('No se obtuvo tu ubicación GPS. Activa la ubicación del teléfono.', 'bad'); }
    if (!(await confirmDlg(`¿Estás en el domicilio de ${st.customer_name}? Se guardará tu ubicación actual como la del cliente${p.acc ? ` (precisión ±${Math.round(p.acc)} m)` : ''}.`))) { b.disabled = false; return; }
    try { await POST(`/api/orders/${st.id}/location`, { lat: p.lat, lng: p.lng }); toast('Ubicación del cliente guardada. ¡Gracias!', 'ok'); render(); }
    catch (er) { b.disabled = false; toast(er.message, 'bad'); }
  }));
  $('#reopt').onclick = async () => {
    const p = GPS.last || (await getPosition());
    try { const o = await POST(`/api/routes/${r.id}/optimize`, p ? { lat: p.lat, lng: p.lng } : {}); toast(`Ruta re-optimizada: ${o.distance_km} km restantes`, 'ok'); render(); } catch (e) { toast(e.message, 'bad'); }
  };
}
const meIcon = (heading) => L.divIcon({ className: '', html: `<div class="me-pin"${heading != null && !isNaN(heading) ? ` style="--h:${heading}deg"` : ''}><i></i></div>`, iconSize: [26, 26], iconAnchor: [13, 13] });

// ---------- Navegación a la parada (mapa en vivo + indicaciones por calles) ----------
let navWatch = null;
let wakeLock = null;
function stopNav() {
  gpsListeners.forEach((fn) => fn.__nav && gpsListeners.delete(fn));
  GPS.fast = false;
  try { wakeLock?.release(); } catch {}
  wakeLock = null;
}
const MOD = { left: 'a la izquierda', right: 'a la derecha', 'slight left': 'ligeramente a la izquierda', 'slight right': 'ligeramente a la derecha', 'sharp left': 'cerrado a la izquierda', 'sharp right': 'cerrado a la derecha', straight: 'derecho', uturn: 'en U' };
function stepText(st) {
  const m = st.maneuver || {};
  const on = st.name ? ` por ${st.name}` : '';
  const md = MOD[m.modifier] || '';
  switch (m.type) {
    case 'depart': return `Avanza${on}`;
    case 'arrive': return 'Llegas a tu destino';
    case 'roundabout': case 'rotary': case 'roundabout turn': return `En la glorieta toma la ${m.exit || 1}.ª salida${on}`;
    case 'merge': return `Incorpórate${on}`;
    case 'on ramp': return `Toma la entrada${on}`;
    case 'off ramp': return `Toma la salida${on}`;
    case 'fork': return `En la bifurcación mantente ${md}${on}`;
    case 'end of road': return `Al final de la calle gira ${md}${on}`;
    case 'continue': case 'new name': return m.modifier && m.modifier !== 'straight' ? `Continúa ${md}${on}` : `Sigue derecho${on}`;
    default: return m.modifier === 'uturn' ? `Da vuelta en U${on}` : m.modifier === 'straight' ? `Sigue derecho${on}` : `Gira ${md}${on}`;
  }
}
const stepIcon = (st) => { const md = st.maneuver?.modifier || ''; return st.maneuver?.type === 'arrive' ? '🏁' : md.includes('left') ? '↰' : md.includes('right') ? '↱' : md === 'uturn' ? '⤺' : '↑'; };
const fmtDist = (m) => (m == null ? '—' : m >= 1000 ? `${fmtN(m / 1000, 1)} km` : `${Math.max(10, Math.round(m / 10) * 10)} m`);

async function viewNavigate(v, id) {
  const r = await GET('/api/my/route');
  const stops = r?.stops || [];
  const open = stops.filter((s) => ['asignado', 'cargado'].includes(s.status));
  const s = stops.find((x) => String(x.id) === String(id)) || open[0];
  if (!s || s.lat == null) { v.innerHTML = topbar('Navegación', '<a href="#/my" class="btn sm">Volver</a>') + `<div class="card empty">${s ? `Este cliente no tiene ubicación en el mapa.<br><br><a class="btn primary" target="_blank" rel="noopener" href="${esc(navUrl(s, 'google'))}">${icon('nav')} Ir con Google Maps por dirección</a> <a class="btn" target="_blank" rel="noopener" href="${esc(navUrl(s, 'waze'))}">Waze</a>` : 'No hay paradas pendientes.'}</div>`; return; }
  const after = open[open.indexOf(s) + 1];
  const dest = { lat: s.lat, lng: s.lng };
  v.innerHTML = `<div class="nav-wrap">
    <div id="navmap" class="navmap"></div>
    <div class="nav-top"><div class="nav-step"><span class="nav-ico" id="nIco">↑</span><div class="grow"><b id="nInstr">Buscando tu ubicación…</b><small id="nStepDist"></small></div></div>
      <div class="nav-sum"><b id="nDist">—</b><span id="nEta"></span></div></div>
    <button class="btn nav-fab" id="recenter" aria-label="Centrar en mi ubicación">${icon('target')}</button>
    <div class="nav-sheet">
      <div class="row between"><div class="grow"><small class="muted">Parada ${s.stop_seq} de ${stops.length} · ${esc(s.tracking_code)}</small>
        <h2 style="margin:2px 0">${esc(s.customer_name)}</h2><div>${esc(s.address)}</div><div class="tels">${phonesLine(s)}</div>${s.address_reference ? `<small class="muted">${esc(s.address_reference)}</small>` : ''}</div>
        <a href="#/my" class="btn sm ghost" aria-label="Cerrar navegación">${icon('x')}</a></div>
      ${s.cod_amount ? `<div class="offline-bar" style="margin:8px 0 0">Cobrar ${money(s.cod_amount)}</div>` : ''}
      <div class="arrive" id="arrive" hidden>${icon('live')} Llegaste al domicilio</div>
      <div class="row" style="margin-top:10px">
        <a class="btn ok lg grow" href="#/deliver/${s.id}">${icon('check')} Entregar</a>
        ${s.customer_phone ? `<a class="btn lg" href="tel:${esc(s.customer_phone)}" aria-label="Llamar">${icon('phone')}</a><a class="btn lg" target="_blank" rel="noopener" href="${esc(waLink(s.customer_phone, `Hola, soy ${firstName(store.user.name)} de ${SETTINGS.company_name}. Voy en camino con tu paquete ${s.tracking_code}.`))}" aria-label="WhatsApp">${icon('chat')}</a>${smsBtn(s, 'lg')}` : ''}
        ${s.customer_phone_alt ? `<a class="btn lg" href="tel:${esc(s.customer_phone_alt)}" aria-label="Llamar al teléfono adicional" title="Teléfono adicional: ${esc(s.customer_phone_alt)}">${icon('phone')} 2</a>` : ''}
      </div>
      <div class="row" style="margin-top:8px">
        <a class="btn sm grow primary" target="_blank" rel="noopener" href="${esc(navUrl(s, 'google'))}" title="Con tráfico en tiempo real">${icon('nav')} Google Maps</a>
        <a class="btn sm grow" target="_blank" rel="noopener" href="${esc(navUrl(s, 'waze'))}">Waze</a>
        <a class="btn sm bad" href="#/fail/${s.id}">No entregado</a></div>
      <details class="nav-steps"><summary>Indicaciones paso a paso</summary><ol id="nSteps"><li class="muted">Calculando…</li></ol></details>
      ${after ? `<small class="muted">Después: ${esc(after.customer_name)} · ${esc(after.address)}</small>` : ''}
    </div></div>`;
  startTracking();
  GPS.fast = true;
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {}
  const map = makeMap($('#navmap'), [dest.lat, dest.lng], 15);
  L.marker([dest.lat, dest.lng], { icon: pinIcon(s.stop_seq || '★', '#e5612a') }).addTo(map);
  const lineLayer = L.layerGroup().addTo(map);
  let me = null;
  let meMk = null;
  let follow = true;
  let route = null;
  let routeFrom = null;
  let routeAt = 0;
  let arrived = false;
  let notified = false;
  map.on('dragstart', () => (follow = false));
  $('#recenter').onclick = () => { follow = true; if (me) map.setView([me.lat, me.lng], Math.max(map.getZoom(), 16)); };
  const osrm = (/router\.project-osrm\.org/.test(SETTINGS.osrm_url || '') || !SETTINGS.osrm_url ? 'https://routing.openstreetmap.de/routed-car' : SETTINGS.osrm_url).replace(/\/+$/, '');
  async function fetchRoute(p) {
    routeFrom = p; routeAt = Date.now();
    if (!osrm) { route = null; return; }
    try {
      const u = `${osrm}/route/v1/driving/${p.lng},${p.lat};${dest.lng},${dest.lat}?overview=full&geometries=geojson&steps=true`;
      const j = await fetch(u, { signal: AbortSignal.timeout(8000) }).then((x) => x.json());
      route = j.code === 'Ok' ? j.routes[0] : null;
    } catch { route = null; }
  }
  function paint() {
    if (!$('#navmap')) return;
    lineLayer.clearLayers();
    const straight = me ? haversineM(me, dest) : null;
    let dist, mins, steps = [];
    if (route) {
      L.polyline(route.geometry.coordinates.map(([x, y]) => [y, x]), { color: '#1d5a96', weight: 7, opacity: 0.85 }).addTo(lineLayer);
      steps = route.legs[0].steps;
      dist = route.distance;
      mins = Math.max(1, Math.round((route.duration / 60) * 1.25)); // tráfico urbano
    } else if (me) {
      L.polyline([[me.lat, me.lng], [dest.lat, dest.lng]], { color: '#1d5a96', weight: 5, opacity: 0.7, dashArray: '8 8' }).addTo(lineLayer);
      dist = straight * (Number(SETTINGS.road_factor) || 1.35);
      mins = Math.max(1, Math.round((dist / 1000 / (Number(SETTINGS.avg_speed_kmh) || 22)) * 60));
    }
    if (me) {
      $('#nDist').textContent = fmtDist(dist);
      $('#nEta').textContent = `${mins} min · llegada ${new Date(Date.now() + mins * 60000).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`;
      const nx = steps[1] || steps[0];
      if (nx) {
        const d = haversineM(me, { lat: nx.maneuver.location[1], lng: nx.maneuver.location[0] });
        $('#nInstr').textContent = stepText(nx); $('#nIco').textContent = stepIcon(nx); $('#nStepDist').textContent = `en ${fmtDist(d)}`;
      } else { $('#nInstr').textContent = 'Dirígete al punto naranja'; $('#nIco').textContent = '↑'; $('#nStepDist').textContent = osrm ? 'Sin indicaciones por calles (sin conexión al servidor de rutas)' : 'Distancia en línea recta'; }
      $('#nSteps').innerHTML = steps.length ? steps.map((st) => `<li><span>${stepIcon(st)}</span> ${esc(stepText(st))} <small class="muted">${st.distance ? fmtDist(st.distance) : ''}</small></li>`).join('') : '<li class="muted">Sin indicaciones disponibles</li>';
      if (straight < 70 && !arrived) { arrived = true; $('#arrive').hidden = false; navigator.vibrate?.([120, 80, 120]); beep(true); }
      if (!notified && s.status === 'cargado') { notified = true; POST(`/api/orders/${s.id}/arriving`, { minutes: mins }).catch(() => {}); }
    }
  }
  const onPos = async (p) => {
    if (!$('#navmap')) return;
    me = p;
    if (meMk) { meMk.setLatLng([p.lat, p.lng]); meMk.setIcon(meIcon(p.heading)); } else meMk = L.marker([p.lat, p.lng], { icon: meIcon(p.heading), zIndexOffset: 1000 }).addTo(map);
    if (follow) {
      if (!routeFrom) map.fitBounds([[p.lat, p.lng], [dest.lat, dest.lng]], { padding: [60, 60], maxZoom: 17 });
      else map.panTo([p.lat, p.lng], { animate: true });
    }
    if (!routeFrom || haversineM(routeFrom, p) > 120 || Date.now() - routeAt > 60000) await fetchRoute(p);
    paint();
  };
  onPos.__nav = true;
  gpsListeners.add(onPos);
  if (GPS.last) onPos(GPS.last);
  else getPosition(8000).then((p) => p && !me && onPos(p));
}

async function viewLoad(v) {
  const r = await GET('/api/my/route');
  if (!r) { v.innerHTML = topbar('Cargar vehículo') + '<div class="card empty">No tienes ruta asignada hoy.</div>'; return; }
  const draw = () => {
    const loaded = r.stops.filter((s) => s.status !== 'asignado').length;
    $('#loadList').innerHTML = `<div class="row between" style="padding:12px 14px"><b>${loaded}/${r.stops.length} cargados</b><div class="progress grow" style="max-width:50%"><i style="width:${(loaded / r.stops.length) * 100}%;background:var(--ok)"></i></div></div>` +
      r.stops.map((s) => `<div class="stop ${s.status !== 'asignado' ? 'done' : ''}"><div class="n">${s.status !== 'asignado' ? '✓' : s.stop_seq}</div><div><b>${esc(s.tracking_code)}</b><br><small>${esc(s.customer_name)} · ${esc(s.address)}</small></div></div>`).join('');
  };
  checkBanner();
  v.innerHTML = topbar('Cargar vehículo') + `<div id="ckBanner"></div><p class="muted" style="margin-top:0">Escanea cada paquete al subirlo. El sistema avisa si un paquete no pertenece a tu ruta.</p>
    <button class="btn primary lg block" id="startScan">${icon('scan')} Escanear paquetes</button><div class="card" style="padding:0;margin-top:12px" id="loadList"></div>`;
  draw();
  let pendingSN = null;
  $('#startScan').onclick = () => openScanner({
    title: 'Carga de paquetes', continuous: true,
    hint: 'Escanea la guía o el número de serie del equipo. Si el pedido lleva equipos con S/N, escanéalos cuando se te pidan.',
    onCode: async (code) => {
      const load = async (c) => {
        const res = await POST('/api/scan/load', { code: c });
        const s = r.stops.find((x) => x.id === res.order.id);
        if (s) s.status = res.order.status;
        draw();
        return res.already ? 'ya estaba cargado' : `parada ${res.order.stop_seq} · ${res.order.customer_name}`;
      };
      if (pendingSN) {
        try {
          const a = await POST(`/api/orders/${pendingSN.order_id}/serials`, { serial: code });
          if (a.missing) return `S/N de ${a.product} ✓ · faltan ${a.missing}`;
          const t = pendingSN.tracking_code;
          pendingSN = null;
          return `S/N ✓ · ${await load(t)}`;
        } catch (eSN) {
          try { const res = await load(code); pendingSN = null; return res; } catch { throw eSN; }
        }
      }
      try { return await load(code); }
      catch (e) {
        if (e.data?.code === 'serials_required') { pendingSN = e.data; throw new Error(`${e.message}. Escanea ahora el S/N del equipo`); }
        throw e;
      }
    },
  });
}

async function viewScan(v) {
  v.innerHTML = topbar('Buscar', '', 'Busca tus pedidos por número de serie del equipo o, si lo tienes, por número de pedido.') + `<div class="stack">
    <div class="card"><form class="row" id="fsF"><input name="q" class="grow" placeholder="Número de serie o número de pedido" autocomplete="off" autocapitalize="characters" spellcheck="false" style="text-transform:uppercase" /><button class="btn primary">${icon('search')} Buscar</button></form>
      <div id="fsRes" style="margin-top:8px"></div></div>
    <button class="btn lg block" id="sc1">${icon('scan')} Escanear S/N o guía</button></div>`;
  const open = (o) => (['asignado', 'cargado'].includes(o.status) ? (location.hash = '#/deliver/' + o.id + '?scanned=1') : orderDetail(o.id));
  const search = async (q) => {
    q = q.trim();
    if (q.length < 3) return ($('#fsRes').innerHTML = '<p class="muted">Escribe al menos 3 letras o números del S/N o del pedido.</p>');
    const r = await GET('/api/orders?limit=30&date=&q=' + encodeURIComponent(q));
    $('#fsRes').innerHTML = r.rows.map((o) => `<button class="live-row" data-o="${o.id}" style="width:100%;text-align:left"><span class="grow"><b>${esc(o.customer_name)}</b><br><small class="mono">${o.sn_list ? 'S/N ' + esc(o.sn_list) + ' · ' : ''}${esc(o.tracking_code)}</small><br><small class="muted">${esc(o.address || '')} · ${esc(o.scheduled_date || '')}</small>${o.telnor_phone ? `<br><small>Telnor: <b class="mono">${esc(fmtTel(o.telnor_phone))}</b></small>` : ''}</span>${badge(o.status)}</button>`).join('')
      || '<p class="muted">No tienes pedidos con ese número de serie o número de pedido. Para ver un equipo de tu inventario usa <a href="#/stock">Inventario</a>.</p>';
    $$('[data-o]', v).forEach((b) => (b.onclick = () => open(r.rows.find((o) => o.id === Number(b.dataset.o)))));
  };
  let t;
  $('#fsF').onsubmit = (e) => { e.preventDefault(); search(e.target.q.value); };
  $('#fsF').q.oninput = (e) => { clearTimeout(t); t = setTimeout(() => search(e.target.value), 400); };
  $('#sc1').onclick = () => openScanner({ title: 'Escanear S/N o guía', onCode: async (c) => open(await GET('/api/orders/tracking/' + encodeURIComponent(c))) });
}

async function viewDeliver(v, id, mode) {
  const o = await GET('/api/orders/' + id);
  const scannedParam = new URLSearchParams(location.hash.split('?')[1] || '').get('scanned') === '1';
  // entrega armada en campo por el mismo repartidor: no trae etiqueta impresa; el equipo ya se eligió por su S/N
  let verified = scannedParam || (o.created_by === store.user.id && driverMode());
  let photo = null;
  const isFail = mode === 'fail';
  const needPhoto = !isFail && SETTINGS.require_photo === '1';
  const needSig = !isFail && SETTINGS.require_signature === '1';
  startTracking();
  v.innerHTML = topbar(isFail ? 'Entrega no realizada' : 'Recepción del cliente', `<a href="#/my" class="btn sm">Volver</a>`) + `
  <div class="card stack">
    <div><b>${esc(o.customer_name)}</b> · <span class="mono">${esc(o.tracking_code)}</span><br><small>${esc(o.address)}</small><div class="tels">${phonesLine(o)}</div>
      ${o.items.length ? `<br><small class="muted">${o.items.map((i) => `${i.qty}× ${esc(i.name)}`).join(', ')}</small>` : ''}
      ${o.cod_amount && !isFail ? `<div class="offline-bar" style="margin:8px 0 0">Cobrar ${money(o.cod_amount)} al cliente</div>` : ''}</div>
    <div class="row between" id="verifyRow"><span id="verifyTxt">${verified ? '✅ Paquete verificado por escaneo' : '⚠️ Escanea la etiqueta para verificar el paquete'}</span>${verified ? '' : `<button class="btn sm" id="verify">${icon('scan')} Verificar</button>`}</div>
    ${isFail ? `
      <label class="f">Motivo <b class="req">*</b><select id="reason"><option value="">Selecciona…</option>${FAIL_REASONS.map((r) => `<option>${r}</option>`).join('')}</select></label>` : `
      <div class="grid g3"><label class="f">Nombre de quien recibe <b class="req">*</b><input id="rname" value="${esc(o.customer_name)}" autocomplete="off" /></label>
      <label class="f">Relación<select id="rrel"><option>Titular</option><option>Familiar</option><option>Vecino</option><option>Recepción / vigilancia</option><option>Otro</option></select></label>
      <label class="f">Identificación<input id="rdoc" placeholder="INE, gafete… (opcional)" autocomplete="off" /></label></div>`}
    <div><label class="f">Fotografía ${isFail ? '(fachada / lugar)' : '(paquete entregado)'} ${needPhoto ? '<b class="req">*</b>' : ''}</label>
      <label class="btn block" style="margin-top:4px">${icon('camera')} Tomar foto<input type="file" accept="image/*" capture="environment" id="photo" hidden /></label>
      <img id="photoPrev" class="photo-prev" hidden alt="Vista previa" /></div>
    ${isFail ? '' : `<div><label class="f">Firma de quien recibe ${needSig ? '<b class="req">*</b>' : ''}</label><div class="sig-wrap" style="margin-top:4px"><canvas id="sig"></canvas><button type="button" class="btn sm clear" id="sigClear">Borrar</button><span class="sig-hint" id="sigHint">Firme aquí</span></div></div>`}
    ${isFail ? '' : complianceFields(o)}
    <label class="f">Comentarios<textarea id="notes" placeholder="${isFail ? 'Detalle del intento…' : 'Se dejó en recepción…'}"></textarea></label>
    <small class="muted" id="gpsTxt">📍 Obteniendo ubicación…</small>
    <button class="btn ${isFail ? 'bad' : 'ok'} lg block" id="submit">${isFail ? 'Registrar intento fallido' : `${icon('check')} Confirmar recepción`}</button>
  </div>`;
  let pos = GPS.last && Date.now() - GPS.at < 60000 ? GPS.last : null;
  const showPos = () => $('#gpsTxt') && ($('#gpsTxt').textContent = pos ? `📍 Ubicación capturada (±${Math.round(pos.accuracy || pos.acc || 0)} m)` : '📍 Sin GPS: activa la ubicación');
  if (pos) showPos(); else getPosition().then((p) => { pos = p; showPos(); });
  const sig = isFail ? null : signaturePad($('#sig'));
  const getComp = isFail ? () => ({}) : wireCompliance(v, o);
  $('#sig')?.addEventListener('pointerdown', () => ($('#sigHint').hidden = true));
  $('#sigClear')?.addEventListener('click', () => { sig.clear(); $('#sigHint').hidden = false; });
  $('#photo').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    photo = await compressImage(f);
    $('#photoPrev').src = photo;
    $('#photoPrev').hidden = false;
  };
  // Verificar: la guía del paquete o el S/N del módem (si es un S/N disponible, se asigna a este pedido)
  $('#verify')?.addEventListener('click', () => openScanner({ title: 'Verificar paquete', hint: 'Escanea la guía o el número de serie del módem', onCode: async (c) => {
    const code = String(c).trim();
    if (code.toUpperCase() === String(o.tracking_code).toUpperCase()) {
      verified = true;
      $('#verifyRow').innerHTML = '<span>✅ Paquete verificado por escaneo</span>';
      return 'guía';
    }
    const sn = code.replace(/^S\/?N[:\s]*/i, '').toUpperCase();
    if ((o.serials || []).some((x) => String(x.serial).toUpperCase() === sn)) {
      verified = true;
      $('#verifyRow').innerHTML = `<span>✅ Verificado · S/N <b class="mono">${esc(sn)}</b></span>`;
      return 'S/N del pedido';
    }
    if (!(o.serial_needs || []).some((r) => r.missing)) throw new Error('El código no coincide con este pedido');
    const r = await POST(`/api/orders/${o.id}/serials`, { serial: sn });
    o.serials = r.serials;
    o.serial_needs = (o.serial_needs || []).map((x) => ({ ...x, missing: 0 }));
    verified = true;
    $('#verifyRow').innerHTML = `<span>✅ S/N <b class="mono">${esc(r.serial)}</b> asignado a este pedido</span>`;
    return `${r.product} asignado`;
  } }));
  $('#submit').onclick = async () => {
    const btn = $('#submit');
    const body = { photo, lat: pos?.lat ?? null, lng: pos?.lng ?? null, notes: $('#notes').value, barcode_verified: verified, captured_at: new Date().toISOString() };
    if (isFail) {
      body.reason = $('#reason').value;
      if (!body.reason) return toast('Selecciona el motivo', 'bad');
    } else {
      body.receiver_name = $('#rname').value.trim();
      body.receiver_relation = $('#rrel').value;
      body.receiver_id_doc = $('#rdoc').value.trim();
      body.signature = sig.data();
      Object.assign(body, getComp());
      if (!body.receiver_name) return toast('Indica quién recibe', 'bad');
      if (needPhoto && !body.photo) return toast('Toma la fotografía de la entrega', 'bad');
      if (needSig && !body.signature) return toast('Falta la firma de quien recibe', 'bad');
      if (!body.photo && !body.signature) return toast('Toma una foto o captura la firma', 'bad');
    }
    if (!verified && !(await confirmDlg('No escaneaste el paquete. ¿Registrar de todos modos?'))) return;
    btn.disabled = true;
    try {
      const r = await withSerials(() => postOrQueue(`/api/orders/${o.id}/${isFail ? 'fail' : 'deliver'}`, body, o.tracking_code), o.tracking_code);
      if (!r.queued) toast(isFail ? 'Intento registrado' : 'Recepción registrada ✅ Se avisó al cliente', 'ok');
      if (r.distance_to_customer_m > 300) toast(`Atención: registraste a ${Math.round(r.distance_to_customer_m)} m del domicilio`, '');
      location.hash = '#/my';
    } catch (e) { btn.disabled = false; toast(e.message, 'bad'); }
  };
}

async function viewHistory(v) {
  const r = await GET('/api/orders?status=entregado,fallido&limit=100');
  v.innerHTML = topbar('Historial') + `<div class="card" style="padding:0">${r.rows.map((o) => `<div class="stop ${o.status === 'entregado' ? 'done' : 'fail'}" data-id="${o.id}" style="cursor:pointer"><div class="n">${o.status === 'entregado' ? '✓' : '✕'}</div><div><div class="row between"><b>${esc(o.customer_name)}</b><small class="muted">${fmtDT(o.delivered_at)}</small></div><small>${esc(o.tracking_code)} · ${esc(o.address)}</small></div></div>`).join('') || '<div class="empty">Sin entregas aún</div>'}</div>`;
  $$('[data-id]', v).forEach((el) => (el.onclick = () => orderDetail(el.dataset.id)));
}

// Repartidor: buscar (o registrar) al cliente final y entregarle productos de lo que trae
function viewNewCustomer(v) {
  v.innerHTML = topbar('Cliente', '', 'Busca al cliente, elige lo que le vas a entregar de tu inventario y registra la entrega.') + `
    <div class="card"><form class="row" id="dcq"><input name="q" class="grow" placeholder="Número de serie o número de pedido (o nombre, teléfono)" autocomplete="off" style="text-transform:uppercase" /><button class="btn primary">${icon('search')} Buscar</button></form>
      <div id="dcRes" style="margin-top:8px"></div></div>
    <div id="dcPick"></div>`;
  const search = async (q) => {
    if (q.trim().length < 2) return ($('#dcRes').innerHTML = '<p class="muted">Escribe al menos 2 letras o números.</p>');
    const r = await GET('/api/customers?limit=30&q=' + encodeURIComponent(q.trim()));
    $('#dcRes').innerHTML = r.rows.map((c) => `<button class="live-row" data-c="${c.id}" style="width:100%;text-align:left"><span class="grow"><b>${esc(c.name)}</b>${c.match_txt ? `<br><small class="mono" style="color:var(--ok)">${esc(c.match_txt)}</small>` : ''}<br><small class="muted">${esc(c.address || '')}${c.phone ? ' · ' + esc(c.phone) : ''}${c.external_id ? ' · Telnor ' + esc(c.external_id) : ''}</small></span>${c.active_orders ? `<span class="chip">${c.active_orders} pedido${c.active_orders === 1 ? '' : 's'}</span>` : ''}</button>`).join('') || '<p class="muted">No se encontró. Revisa el número de serie, el pedido o el nombre; si es un cliente nuevo, pide al despacho que lo registre.</p>';
    $$('[data-c]', v).forEach((b) => (b.onclick = () => pickForCustomer(Number(b.dataset.c))));
  };
  let t;
  $('#dcq').onsubmit = (e) => { e.preventDefault(); search(e.target.q.value); };
  $('#dcq').q.oninput = (e) => { clearTimeout(t); t = setTimeout(() => search(e.target.value), 350); };

  async function pickForCustomer(cid) {
    const [c, mine, myRoute, av] = await Promise.all([GET('/api/customers/' + cid), GET('/api/my/custody'), GET('/api/my/route').catch(() => null), GET('/api/my/available').catch(() => ({ serialized: [], plain: [] }))]);
    const mineOpen = (myRoute?.stops || []).filter((s) => s.customer_id === c.id && ['asignado', 'cargado'].includes(s.status));
    // lo suyo + lo abierto (cualquier repartidor puede entregarlo)
    const items = (mine.items || []).map((it) => ({ ...it, serials: it.serials.map((x) => ({ ...x, pool: false })), own: it.qty, pool: 0 }));
    for (const op of mine.open_items || []) {
      let it = items.find((x) => x.product_id === op.product_id);
      if (!it) { it = { ...op, serials: [], qty: 0, own: 0, pool: 0 }; items.push(it); }
      it.serials.push(...op.serials.map((x) => ({ ...x, pool: true })));
      it.pool += op.qty; it.qty += op.qty;
    }
    // sin inventario asignado (o si le falta): puede elegir lo disponible en almacén que trae en su unidad
    const assigned = items.reduce((a, it) => a + it.qty, 0);
    for (const w of [...av.serialized.filter((x) => x.serials.length), ...av.plain]) {
      let it = items.find((x) => x.product_id === w.product_id);
      if (!it) { it = { product_id: w.product_id, name: w.name, sku: w.sku, serialized: !!w.serials, serials: [], qty: 0, own: 0, pool: 0 }; items.push(it); }
      it.wh = w.serials ? w.serials.length : w.available;
      it.qty += it.wh;
      if (w.serials) it.serials.push(...w.serials.map((x) => ({ serial: x, wh: true })));
    }
    const snProducts = av.serialized;
    const box = $('#dcPick');
    box.innerHTML = `<div class="card" style="margin-top:12px">
      <div class="row between"><div><b style="font-size:18px">${esc(c.name)}</b><br><small class="muted">${esc(c.address || '')}</small><br>
        <div class="row" style="margin-top:6px;gap:6px">${c.phone ? `<a class="btn sm" href="tel:${esc(c.phone)}">${icon('phone')} ${esc(c.phone)}</a>` : ''}${c.phone_alt ? `<a class="btn sm" href="tel:${esc(c.phone_alt)}">${icon('phone')} ${esc(c.phone_alt)}</a>` : ''}</div></div>
</div>
      ${mineOpen.length ? `<div class="info-bar" style="margin-top:10px">${icon('box')} Ya tienes ${mineOpen.length === 1 ? 'un pedido' : mineOpen.length + ' pedidos'} para este cliente en tu ruta: ${mineOpen.map((s) => `<button class="btn sm primary" data-dlv="${s.id}">Entregar ${esc(s.tracking_code)}</button>`).join(' ')}</div>` : ''}
      <h3>¿Qué le vas a entregar?</h3>
      ${!assigned ? `<div class="info-bar" style="margin-bottom:8px">${icon('info')} No tienes inventario asignado. Elige lo que traes en tu unidad de lo disponible en almacén 📦, o escribe/escanea el S/N del equipo.</div>` : ''}
      ${items.length ? `<div class="row" style="margin-bottom:8px"><input id="dcPq" class="grow" placeholder="Buscar producto o S/N" autocomplete="off" /></div>
        <div id="dcSel" class="muted" style="margin-bottom:6px">Nada seleccionado</div>` : ''}
      ${items.length ? items.map((it) => `<div class="card dc-item" data-name="${esc(normH(it.name + ' ' + it.sku))}" style="padding:10px 12px;margin-bottom:8px"><div class="row between"><b>${esc(it.name)}</b><small class="muted">${[it.own ? `traes ${it.own}` : '', it.pool ? `🔓 abiertos ${it.pool}` : '', it.wh ? `📦 almacén ${it.wh}` : ''].filter(Boolean).join(' · ')}</small></div>
        ${it.serialized ? (it.serials.filter((s) => !s.order).map((s) => `<label class="row dc-sn" data-s="${esc(normH(s.serial))}" style="padding:6px 0;border-top:1px solid var(--border)"><input type="checkbox" data-sn="${esc(s.serial)}" /> <span class="mono">${esc(s.serial)}</span>${s.pool ? ' <small class="chip">🔓 abierto</small>' : s.wh ? ' <small class="chip">📦 almacén</small>' : ''}</label>`).join('') || '<small class="muted">Todos los que traes ya están ligados a pedidos.</small>')
          : `<div class="row" style="margin-top:6px"><label class="row"><input type="checkbox" data-pp="${it.product_id}" /> Entregar</label><input type="number" min="1" max="${it.qty}" value="1" data-pq="${it.product_id}" style="width:90px" /></div>`}</div>`).join('')
        : '<div class="card empty">No hay inventario disponible. Escribe o escanea el S/N del equipo que traes.</div>'}
      <div class="card" id="dcNewBox" style="padding:10px 12px;margin-bottom:8px" ${snProducts.length ? '' : 'hidden'}><b>¿Traes un equipo que no aparece?</b>
        <div class="row" style="margin-top:6px;gap:6px;flex-wrap:wrap"><input id="dcNew" class="grow" placeholder="Escribe el S/N (ej. HWTCDE3CE28A)" autocomplete="off" style="text-transform:uppercase" />
          ${snProducts.length > 1 ? `<select id="dcNewP">${snProducts.map((x) => `<option value="${x.product_id}">${esc(x.name)}</option>`).join('')}</select>` : ''}
          <button type="button" class="btn" id="dcAdd">${icon('plus')} Agregar</button></div>
        <div id="dcNewList"></div><small class="muted">Se registra en el inventario al crear la entrega.</small></div>
      ${snProducts.length ? `<button class="btn block" id="dcScan">${icon('scan')} Escanear el S/N del equipo</button>` : ''}
      <label class="f" style="margin-top:8px">Nota<input id="dcNote" maxlength="300" placeholder="Ej. instalación, cambio de equipo…" /></label>
      <button class="btn primary lg block" id="dcGo" style="margin-top:10px">${icon('sign')} Crear entrega y registrar</button></div>`;
    box.scrollIntoView({ behavior: 'smooth' });
    $$('[data-dlv]', box).forEach((b) => (b.onclick = () => (location.hash = '#/deliver/' + b.dataset.dlv)));
    // buscar dentro de lo que trae: por nombre / SKU del producto o por número de serie
    const updSel = () => {
      const nSn = $$('[data-sn]', box).filter((x) => x.checked).length;
      const nP = $$('[data-pp]', box).filter((x) => x.checked).reduce((a, x) => a + (Number($(`[data-pq="${x.dataset.pp}"]`, box).value) || 1), 0);
      const el = $('#dcSel', box);
      if (el) el.innerHTML = nSn || nP ? `<b>Seleccionado: ${[nSn ? `${nSn} equipo${nSn === 1 ? '' : 's'} con S/N` : '', nP ? `${nP} pieza${nP === 1 ? '' : 's'}` : ''].filter(Boolean).join(' + ')}</b>` : 'Nada seleccionado';
    };
    $$('[data-sn], [data-pp], [data-pq]', box).forEach((x) => x.addEventListener(x.matches('[data-pq]') ? 'input' : 'change', () => {
      if (x.matches('[data-pq]')) { const cb = $(`[data-pp="${x.dataset.pq}"]`, box); if (cb) cb.checked = true; }
      updSel();
    }));
    $('#dcPq')?.addEventListener('input', (e) => {
      const q = normH(e.target.value);
      $$('.dc-item', box).forEach((card) => {
        const byName = !q || card.dataset.name.includes(q);
        const sns = $$('.dc-sn', card);
        let anySn = false;
        sns.forEach((l) => { const hit = byName || l.dataset.s.includes(q); l.hidden = !hit; anySn ||= hit; });
        card.hidden = !(byName || anySn);
      });
    });
    // equipos que trae y no estaban registrados
    let newProduct = null;
    const addNew = (raw) => {
      const sn = String(raw || '').trim().replace(/^S\/?N[:\s]*/i, '').toUpperCase();
      if (!/^[A-Z0-9][A-Z0-9._/-]{3,63}$/.test(sn)) return toast('Escribe un S/N válido', 'bad');
      if ($$('[data-sn]', box).some((x) => x.dataset.sn === sn)) { const cb = $$('[data-sn]', box).find((x) => x.dataset.sn === sn); cb.checked = true; updSel(); return; }
      newProduct = Number($('#dcNewP', box)?.value || snProducts[0]?.product_id) || null;
      $('#dcNewList', box).insertAdjacentHTML('beforeend', `<label class="row dc-sn" style="padding:6px 0;border-top:1px solid var(--border)"><input type="checkbox" data-sn="${esc(sn)}" checked /> <span class="mono">${esc(sn)}</span> <small class="chip warn">nuevo</small></label>`);
      $$('[data-sn]', $('#dcNewList', box)).forEach((x) => (x.onchange = updSel));
      $('#dcNew', box).value = '';
      updSel();
    };
    $('#dcAdd', box)?.addEventListener('click', () => addNew($('#dcNew', box).value));
    $('#dcNew', box)?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addNew(e.target.value); } });
    $('#dcScan')?.addEventListener('click', () => openScanner({
      title: 'Escanear S/N a entregar',
      onCode: async (code) => {
        const sn = String(code).trim().replace(/^S\/?N[:\s]*/i, '').toUpperCase();
        const cb = $$('[data-sn]', box).find((x) => x.dataset.sn.toUpperCase() === sn);
        if (!cb) { addNew(sn); return sn + ' agregado (equipo nuevo)'; }
        cb.checked = true;
        cb.closest('.dc-item')?.removeAttribute('hidden'); cb.closest('.dc-sn')?.removeAttribute('hidden');
        updSel();
        return sn + ' seleccionado';
      },
    }));
    $('#dcGo').onclick = async (e) => {
      const btn = e.currentTarget;
      const serials = $$('[data-sn]', box).filter((x) => x.checked).map((x) => x.dataset.sn);
      const its = $$('[data-pp]', box).filter((x) => x.checked).map((x) => ({ product_id: Number(x.dataset.pp), qty: Number($(`[data-pq="${x.dataset.pp}"]`, box).value) || 1 }));
      if (!serials.length && !its.length) return toast('Marca lo que vas a entregar', 'bad');
      btn.disabled = true;
      try {
        const o = await POST('/api/my/orders', { customer_id: c.id, serials, items: its, notes: $('#dcNote').value, new_serial_product_id: newProduct });
        toast(`Entrega ${o.tracking_code} creada`, 'ok');
        location.hash = '#/deliver/' + o.id;
      } catch (er) { toast(er.message, 'bad'); btn.disabled = false; }
    };
  }
}

// ================= Router =================
async function render() {
  clearInterval(liveTimer);
  stopNav();
  if (!store.token || !store.user) return viewLogin();
  if (store.user.must_change_password) return viewForcePassword();
  try { if (!SETTINGS.depot_lat) SETTINGS = await GET('/api/settings'); } catch { if (!store.token) return; }
  const [path] = location.hash.slice(2).split('?');
  const [view, param] = path.split('/');
  if (store.user.can_deliver === undefined) { try { store.user = { ...store.user, ...(await GET('/api/me')) }; } catch {} }
  const driver = driverMode();
  const routes = driver
    ? { profile: viewProfile, check: viewCheck, my: viewMyRoute, nav: (v) => viewNavigate(v, param), load: viewLoad, stock: viewMyStock, scan: viewScan, deliver: (v) => viewDeliver(v, param, 'deliver'), fail: (v) => viewDeliver(v, param, 'fail'), history: viewHistory, 'new-customer': viewNewCustomer }
    : { profile: viewProfile, guide: viewGuide, activity: viewActivity, compliance: viewCompliance, serials: viewSerials, accounts: viewAccounts, receipts: viewReceipts, messages: viewMessages, dashboard: viewDashboard, orders: viewOrders, routes: viewRoutes, live: viewLive, offices: (v) => (param ? viewOffice(v, Number(param)) : viewOffices(v)), inventory: viewInventory, customers: viewCustomers, analytics: viewAnalytics, users: viewUsers, settings: viewSettings };
  const key = routes[view] ? view : driver ? 'my' : 'dashboard';
  const navKey = ['deliver', 'fail', 'nav', 'check'].includes(key) ? 'my' : key;
  const v = shell(navKey, skeleton());
  window.scrollTo(0, 0);
  try { await routes[key](v); } catch (e) { if (store.token) v.innerHTML = `<div class="card empty">⚠️ ${esc(e.message)}<br><br><button class="btn" onclick="render()">Reintentar</button></div>`; }
}
window.addEventListener('hashchange', () => { $$('.modal-bg').forEach((m) => m.querySelector('[data-close]')?.click()); render(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $$('.modal-bg').pop()?.querySelector('[data-close]')?.click(); });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
detectLogo().finally(render);
outbox.flush();

function baseTiles(map) {
  // Mosaicos servidos por nuestro servidor (caché de OpenStreetMap). Si nuestro servidor no responde, directo de OSM.
  const own = L.tileLayer('/tiles/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' });
  let fails = 0;
  own.on('tileload', () => { fails = 0; });
  own.on('tileerror', () => {
    if (++fails !== 8) return;
    map.removeLayer(own);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, referrerPolicy: 'strict-origin-when-cross-origin', attribution: '© OpenStreetMap' }).addTo(map);
  });
  return own.addTo(map);
}
