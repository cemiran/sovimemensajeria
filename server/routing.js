// Motor de optimización de rutas (sin dependencias externas).
// - Distancia: Haversine x factor de calle (aprox. distancia real en ciudad).
// - Secuencia: vecino más cercano + mejora 2-opt + Or-opt, respetando prioridad alta primero.
// - Ventanas horarias: penalización por llegar fuera de ventana.
// - Reparto entre repartidores: barrido polar (sweep) balanceado por carga + capacidad.

const R = 6371;
function haversine(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function buildMatrix(points, roadFactor) {
  const n = points.length;
  const m = Array.from({ length: n }, () => new Float64Array(n));
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const d = haversine(points[i], points[j]) * roadFactor;
      m[i][j] = d;
      m[j][i] = d;
    }
  return m;
}

function pathLength(order, m, returnToDepot) {
  let d = 0;
  let prev = 0;
  for (const i of order) {
    d += m[prev][i];
    prev = i;
  }
  if (returnToDepot && order.length) d += m[prev][0];
  return d;
}

function toMin(hhmm) {
  if (!hhmm) return null;
  const [h, mm] = String(hhmm).split(':').map(Number);
  return h * 60 + (mm || 0);
}
function fmtTime(mins) {
  mins = Math.round(mins);
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Costo = km + penalización por violar ventanas (equivalente en km).
function cost(order, m, stops, opts) {
  let d = 0;
  let t = opts.startMin;
  let prev = 0;
  let penalty = 0;
  for (const i of order) {
    const leg = m[prev][i];
    d += leg;
    t += (leg / opts.speed) * 60;
    const s = stops[i - 1];
    const ws = toMin(s.window_start);
    const we = toMin(s.window_end);
    if (ws != null && t < ws) t = ws; // espera
    if (we != null && t > we) penalty += (t - we) * 0.5; // 0.5 km por minuto tarde
    t += opts.service;
    prev = i;
  }
  if (opts.returnToDepot && order.length) d += m[prev][0];
  return d + penalty;
}

function nearestNeighbor(nodes, m, start = 0) {
  const left = new Set(nodes);
  const out = [];
  let cur = start;
  while (left.size) {
    let best = null;
    let bd = Infinity;
    for (const j of left)
      if (m[cur][j] < bd) {
        bd = m[cur][j];
        best = j;
      }
    out.push(best);
    left.delete(best);
    cur = best;
  }
  return out;
}

function twoOpt(order, evalFn, fixedPrefix = 0) {
  let best = order.slice();
  let bestCost = evalFn(best);
  let improved = true;
  let iter = 0;
  while (improved && iter++ < 60) {
    improved = false;
    for (let i = fixedPrefix; i < best.length - 1; i++) {
      for (let k = i + 1; k < best.length; k++) {
        const cand = best.slice(0, i).concat(best.slice(i, k + 1).reverse(), best.slice(k + 1));
        const c = evalFn(cand);
        if (c + 1e-9 < bestCost) {
          best = cand;
          bestCost = c;
          improved = true;
        }
      }
    }
  }
  return best;
}

function orOpt(order, evalFn) {
  let best = order.slice();
  let bestCost = evalFn(best);
  let improved = true;
  let iter = 0;
  while (improved && iter++ < 30) {
    improved = false;
    for (let len = 1; len <= 3; len++) {
      for (let i = 0; i + len <= best.length; i++) {
        const seg = best.slice(i, i + len);
        const rest = best.slice(0, i).concat(best.slice(i + len));
        for (let j = 0; j <= rest.length; j++) {
          if (j === i) continue;
          const cand = rest.slice(0, j).concat(seg, rest.slice(j));
          const c = evalFn(cand);
          if (c + 1e-9 < bestCost) {
            best = cand;
            bestCost = c;
            improved = true;
          }
        }
      }
    }
  }
  return best;
}

/**
 * Optimiza una ruta.
 * @param depot {lat,lng}
 * @param stops [{id, lat, lng, priority, window_start, window_end}]
 * @param settings {avg_speed_kmh, service_minutes, road_factor, start_time}
 */
function optimizeRoute(depot, stops, settings = {}, { returnToDepot = false, startTime } = {}) {
  const opts = {
    speed: Number(settings.avg_speed_kmh) || 22,
    service: Number(settings.service_minutes) || 6,
    roadFactor: Number(settings.road_factor) || 1.35,
    startMin: toMin(startTime || settings.start_time || '09:00'),
    returnToDepot,
  };
  const valid = stops.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng));
  const invalid = stops.filter((s) => !(Number.isFinite(s.lat) && Number.isFinite(s.lng)));
  const points = [depot, ...valid];
  const m = buildMatrix(points, opts.roadFactor);

  // Distancia en el orden original (como llegaron los pedidos) para medir el ahorro.
  const originalOrder = valid.map((_, i) => i + 1);
  const originalKm = pathLength(originalOrder, m, returnToDepot);

  // Prioridad alta va primero; dentro de cada grupo se optimiza.
  const high = originalOrder.filter((i) => valid[i - 1].priority === 'alta');
  const normal = originalOrder.filter((i) => valid[i - 1].priority !== 'alta');
  const evalFn = (o) => cost(o, m, valid, opts);

  let seqHigh = high.length ? twoOpt(nearestNeighbor(high, m, 0), evalFn) : [];
  const startNormal = seqHigh.length ? seqHigh[seqHigh.length - 1] : 0;
  let seqNormal = nearestNeighbor(normal, m, startNormal);
  let full = seqHigh.concat(seqNormal);
  full = twoOpt(full, evalFn, seqHigh.length);
  // Or-opt sólo en la parte normal para no romper la prioridad
  if (seqHigh.length === 0) full = orOpt(full, evalFn);

  // Calcular ETAs y tramos
  let t = opts.startMin;
  let prev = 0;
  let totalKm = 0;
  let late = 0;
  const sequence = full.map((i, idx) => {
    const leg = m[prev][i];
    totalKm += leg;
    t += (leg / opts.speed) * 60;
    const s = valid[i - 1];
    const ws = toMin(s.window_start);
    const we = toMin(s.window_end);
    if (ws != null && t < ws) t = ws;
    const onTime = we == null || t <= we;
    if (!onTime) late++;
    const eta = fmtTime(t);
    t += opts.service;
    prev = i;
    return { id: s.id, seq: idx + 1, leg_km: +leg.toFixed(2), eta, on_time: onTime };
  });
  if (returnToDepot && full.length) totalKm += m[prev][0];
  const estMinutes = t - opts.startMin;

  return {
    sequence,
    unlocated: invalid.map((s) => s.id),
    distance_km: +totalKm.toFixed(2),
    original_distance_km: +originalKm.toFixed(2),
    saving_pct: originalKm > 0 ? +(((originalKm - totalKm) / originalKm) * 100).toFixed(1) : 0,
    est_minutes: Math.round(estMinutes),
    late_stops: late,
  };
}

/**
 * Reparte pedidos entre repartidores con barrido polar alrededor del almacén,
 * balanceando número de paradas y respetando la capacidad de cada uno.
 */
function splitAmongDrivers(depot, stops, drivers) {
  const withAngle = stops
    .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng))
    .map((s) => ({ ...s, ang: Math.atan2(s.lat - depot.lat, s.lng - depot.lng) }))
    .sort((a, b) => a.ang - b.ang);
  const noCoords = stops.filter((s) => !(Number.isFinite(s.lat) && Number.isFinite(s.lng)));
  if (!withAngle.length || !drivers.length)
    return { assignments: drivers.map((d) => ({ driver: d, stops: [] })), overflow: stops };

  // Inicio del barrido en el mayor hueco angular (evita partir un grupo de clientes)
  let gapIdx = 0;
  let maxGap = -1;
  for (let i = 0; i < withAngle.length; i++) {
    const a = withAngle[i].ang;
    const b = i + 1 < withAngle.length ? withAngle[i + 1].ang : withAngle[0].ang + 2 * Math.PI;
    if (b - a > maxGap) {
      maxGap = b - a;
      gapIdx = (i + 1) % withAngle.length;
    }
  }
  const rotated = withAngle.slice(gapIdx).concat(withAngle.slice(0, gapIdx));

  const totalCap = drivers.reduce((a, d) => a + (d.capacity || 40), 0);
  const n = rotated.length;
  const result = [];
  let idx = 0;
  drivers.forEach((d, k) => {
    const share = k === drivers.length - 1 ? n - idx : Math.round((n * (d.capacity || 40)) / totalCap);
    const take = Math.min(share, d.capacity || 40, n - idx);
    result.push({ driver: d, stops: rotated.slice(idx, idx + take) });
    idx += take;
  });
  const overflow = rotated.slice(idx).concat(noCoords);
  return { assignments: result, overflow };
}

module.exports = { haversine, optimizeRoute, splitAmongDrivers };
