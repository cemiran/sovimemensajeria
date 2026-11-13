// Google Maps Platform (opcional): ubicar domicilios (Geocoding API) y tiempos reales entre paradas (Routes API).
// Sin clave, o al llegar al tope diario, la app sigue con OpenStreetMap como antes.
const { db, getSettings } = require('./db');

db.exec(`CREATE TABLE IF NOT EXISTS gm_usage (day TEXT NOT NULL, kind TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, kind));
CREATE TABLE IF NOT EXISTS gm_legs (a TEXT NOT NULL, b TEXT NOT NULL, km REAL NOT NULL, min REAL NOT NULL, at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (a, b));`);

const day = () => new Date().toLocaleDateString('en-CA');
const key = () => String(getSettings().google_maps_key || '').trim();
const enabled = () => !!key() && getSettings().practice_mode !== '1';
const used = (kind) => db.prepare('SELECT n FROM gm_usage WHERE day=? AND kind=?').get(day(), kind)?.n || 0;
const add = (kind, n) => db.prepare('INSERT INTO gm_usage (day, kind, n) VALUES (?,?,?) ON CONFLICT(day, kind) DO UPDATE SET n = n + excluded.n').run(day(), kind, n);
const cap = (kind) => Number(getSettings()[kind === 'geocode' ? 'google_daily_geocode' : 'google_daily_elements']) || (kind === 'geocode' ? 300 : 3000);
const left = (kind) => Math.max(0, cap(kind) - used(kind));
let lastError = null;

// ---------- Ubicar un domicilio ----------
// Devuelve { lat, lng, quality: 'exacta' | 'calle' | 'colonia' | 'ciudad', partial } o null
async function geocode(text) {
  if (!enabled() || left('geocode') < 1) return null;
  add('geocode', 1);
  const p = new URLSearchParams({ address: text, region: 'mx', language: 'es', components: 'country:MX', key: key() });
  const r = await fetch('https://maps.googleapis.com/maps/api/geocode/json?' + p, { signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  if (j.status && !['OK', 'ZERO_RESULTS'].includes(j.status)) { lastError = `${j.status}: ${j.error_message || ''}`.trim(); return null; }
  lastError = null;
  const g = j.results?.[0];
  if (!g) return null;
  const t = g.types || [];
  const lt = g.geometry?.location_type;
  // ROOFTOP = el domicilio; RANGE_INTERPOLATED = el número sobre la calle; GEOMETRIC_CENTER/APPROXIMATE = calle, colonia o ciudad
  const quality = lt === 'ROOFTOP' || lt === 'RANGE_INTERPOLATED' || t.includes('street_address') || t.includes('premise') || t.includes('subpremise')
    ? 'exacta'
    : t.includes('route') || t.includes('intersection') ? 'calle'
    : t.some((x) => ['sublocality', 'sublocality_level_1', 'neighborhood', 'political'].includes(x)) && !t.includes('locality') ? 'colonia' : 'ciudad';
  return { lat: g.geometry.location.lat, lng: g.geometry.location.lng, quality, partial: !!g.partial_match, address: g.formatted_address };
}

// ---------- Tiempos y distancias por calle entre puntos ----------
const pk = (p) => `${Number(p.lat).toFixed(5)},${Number(p.lng).toFixed(5)}`;
const getLeg = db.prepare("SELECT km, min FROM gm_legs WHERE a=? AND b=? AND at > datetime('now','-60 days')");
// Matriz de lo que ya está guardado; null si falta algún tramo
function cachedMatrix(points) {
  const n = points.length;
  const km = Array.from({ length: n }, () => new Float64Array(n));
  const min = Array.from({ length: n }, () => new Float64Array(n));
  const keys = points.map(pk);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      if (i === j || keys[i] === keys[j]) continue;
      const l = getLeg.get(keys[i], keys[j]);
      if (!l) return null;
      km[i][j] = l.km;
      min[i][j] = l.min;
    }
  return { km, min };
}
// Pide a Google los tramos que falten (en bloques de 25 x 25). Devuelve true si la matriz quedó completa.
async function fillMatrix(points) {
  if (!enabled()) return false;
  const keys = [...new Set(points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)).map(pk))];
  if (keys.length < 2) return false;
  const missing = [];
  for (const a of keys) for (const b of keys) if (a !== b && !getLeg.get(a, b)) missing.push([a, b]);
  if (!missing.length) return true;
  // orígenes que tienen algún tramo pendiente, contra todos los destinos
  const origins = [...new Set(missing.map((m) => m[0]))];
  const need = origins.length * keys.length;
  if (need > left('elements')) { lastError = `Tope diario de Google alcanzado (${used('elements')} de ${cap('elements')} tramos)`; return false; }
  const wp = (k) => { const [lat, lng] = k.split(',').map(Number); return { waypoint: { location: { latLng: { latitude: lat, longitude: lng } } } }; };
  const save = db.prepare("INSERT INTO gm_legs (a, b, km, min, at) VALUES (?,?,?,?,datetime('now')) ON CONFLICT(a, b) DO UPDATE SET km=excluded.km, min=excluded.min, at=excluded.at");
  for (let i = 0; i < origins.length; i += 25)
    for (let j = 0; j < keys.length; j += 25) {
      const O = origins.slice(i, i + 25);
      const D = keys.slice(j, j + 25);
      add('elements', O.length * D.length);
      const r = await fetch('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key(), 'X-Goog-FieldMask': 'originIndex,destinationIndex,distanceMeters,duration,condition' },
        body: JSON.stringify({ origins: O.map(wp), destinations: D.map(wp), travelMode: 'DRIVE', routingPreference: 'TRAFFIC_UNAWARE', languageCode: 'es-MX', regionCode: 'MX' }),
        signal: AbortSignal.timeout(30000),
      });
      const j2 = await r.json().catch(() => null);
      if (!r.ok || !Array.isArray(j2)) { lastError = j2?.error?.message || j2?.[0]?.error?.message || `Google respondió ${r.status}`; return false; }
      for (const e of j2) {
        if (e.condition !== 'ROUTE_EXISTS' || e.distanceMeters == null) continue;
        save.run(O[e.originIndex], D[e.destinationIndex], e.distanceMeters / 1000, parseFloat(e.duration) / 60 || 0);
      }
    }
  lastError = null;
  return !!cachedMatrix(keys.map((k) => { const [lat, lng] = k.split(',').map(Number); return { lat, lng }; }));
}

// Prueba de la clave: un domicilio conocido y un tramo corto
async function test() {
  if (!key()) throw new Error('Primero guarda la clave de Google Maps');
  if (getSettings().practice_mode === '1') throw new Error('En la copia de práctica Google Maps está desactivado');
  const g = await geocode('Boulevard Agua Caliente 10535, Aviación, Tijuana, Baja California');
  if (!g) throw new Error('Ubicar domicilios (Geocoding API) no respondió: ' + (lastError || 'sin resultado'));
  const pts = [{ lat: 32.5149, lng: -117.0382 }, { lat: g.lat, lng: g.lng }];
  const ok = await fillMatrix(pts);
  if (!ok) throw new Error('Tiempos entre paradas (Routes API) no respondió: ' + (lastError || 'sin resultado'));
  const m = cachedMatrix(pts);
  return { geocode: g, leg: { km: +m.km[0][1].toFixed(2), min: +m.min[0][1].toFixed(1) } };
}
const status = () => ({ configured: !!key(), enabled: enabled(), today: { geocode: used('geocode'), elements: used('elements') }, caps: { geocode: cap('geocode'), elements: cap('elements') }, last_error: lastError });

module.exports = { enabled, geocode, cachedMatrix, fillMatrix, test, status };
