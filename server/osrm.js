// Motor de rutas propio (OSRM en el mismo servidor, mapa de Baja California): tiempos y distancias reales por calle,
// sin costo por uso. Si no está disponible, la app sigue con Google (si hay cupo) o con la estimación en línea recta.
const { haversine } = require('./routing');

const BASE = (process.env.OSRM_URL || '').replace(/\/$/, '');
let downUntil = 0;
let lastError = null;
const stats = { table: 0, route: 0, fail: 0 };

async function call(path, ms = 15000) {
  if (!BASE || Date.now() < downUntil) return null;
  try {
    const r = await fetch(BASE + path, { signal: AbortSignal.timeout(ms) });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || j.code !== 'Ok') { lastError = j?.message || `HTTP ${r.status}`; stats.fail++; return null; }
    lastError = null;
    return j;
  } catch (e) {
    // sin respuesta: se deja de intentar 1 minuto para no frenar la app
    lastError = e.message; stats.fail++; downUntil = Date.now() + 60000;
    return null;
  }
}
const coord = (p) => `${Number(p.lng).toFixed(6)},${Number(p.lat).toFixed(6)}`;

// matriz de km y minutos entre todos los puntos (mismo formato que la de Google)
async function table(points) {
  if (!BASE || points.length < 2 || points.length > 500) return null;
  const j = await call(`/table/v1/driving/${points.map(coord).join(';')}?annotations=duration,distance`, 30000);
  if (!j) return null;
  stats.table++;
  const n = points.length;
  const km = Array.from({ length: n }, () => new Float64Array(n));
  const min = Array.from({ length: n }, () => new Float64Array(n));
  for (let i = 0; i < n; i++)
    for (let k = 0; k < n; k++) {
      if (i === k) continue;
      const dist = j.distances?.[i]?.[k], dur = j.durations?.[i]?.[k];
      if (dist == null || dur == null) { const h = haversine(points[i], points[k]) * 1.4; km[i][k] = h; min[i][k] = (h / 25) * 60; }
      else { km[i][k] = dist / 1000; min[i][k] = dur / 60; }
    }
  return { km, min };
}

// camino por calles (y, si se pide, las indicaciones vuelta a vuelta en formato OSRM)
async function route(points, { steps = false } = {}) {
  if (!BASE || points.length < 2) return null;
  const j = await call(`/route/v1/driving/${points.map(coord).join(';')}?overview=full&geometries=geojson&steps=${steps ? 'true' : 'false'}`);
  const rt = j?.routes?.[0];
  if (!rt) return null;
  stats.route++;
  return {
    coords: (rt.geometry?.coordinates || []).map(([lng, lat]) => [lat, lng]),
    distance: rt.distance || 0,
    duration: rt.duration || 0,
    legs: rt.legs || [],
  };
}

async function status() {
  if (!BASE) return { configured: false };
  const j = await call('/nearest/v1/driving/-117.0382,32.5149', 5000);
  return { configured: true, ok: !!j, last_error: lastError, ...stats };
}

module.exports = { enabled: () => !!BASE && Date.now() >= downUntil, table, route, status };
