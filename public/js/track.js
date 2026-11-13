/* Página pública de rastreo para el cliente final: estado, ubicación del repartidor y comprobante de entrega */
'use strict';
(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const token = location.pathname.split('/').pop();
  const dt = (s, opt = { dateStyle: 'medium', timeStyle: 'short' }) => (s ? new Date(s.replace(' ', 'T') + (s.includes('Z') ? '' : 'Z')).toLocaleString('es-MX', opt) : '');
  const day = (d) => (d ? new Date(d + 'T12:00:00').toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' }) : '');
  let map = null;
  let destMk = null;
  let drvMk = null;
  let timer = null;

  const HEAD = {
    pendiente: ['Recibimos tu envío', 'Lo estamos preparando para su entrega.'],
    asignado: ['Preparando tu entrega', 'Tu paquete ya tiene repartidor asignado.'],
    cargado: ['Tu paquete va en camino', 'El repartidor lo lleva en su ruta de hoy.'],
    entregado: ['¡Entregado!', 'Tu paquete fue recibido.'],
    fallido: ['No pudimos entregarlo', 'Te contactaremos para reprogramar la entrega.'],
    cancelado: ['Envío cancelado', 'Comunícate con nosotros si tienes dudas.'],
  };

  function steps(d) {
    const st = d.status;
    const idx = { pendiente: 0, asignado: 1, cargado: 2, entregado: 4, fallido: 3, cancelado: 0 }[st] ?? 0;
    const list = [
      ['Registrado', dt(d.created_at)],
      ['Asignado a ruta', d.scheduled_date ? day(d.scheduled_date) : ''],
      ['En camino', dt(d.loaded_at)],
      [st === 'fallido' ? 'Intento de entrega' : 'Entregado', dt(d.delivered_at)],
    ];
    return `<ol class="trk-steps">${list.map(([l, t], i) => `<li class="${i < idx ? 'done' : i === idx ? (st === 'fallido' && i === 3 ? 'bad' : 'now') : ''}"><b>${l}</b>${i <= idx && t ? `<small>${esc(t)}</small>` : ''}</li>`).join('')}</ol>`;
  }

  async function load() {
    let d;
    try {
      const r = await fetch('/api/public/t/' + encodeURIComponent(token), { cache: 'no-store' });
      d = await r.json();
      if (!r.ok) throw new Error(d.error || 'No encontrado');
    } catch (e) {
      $('#trk').innerHTML = `<div class="card empty"><h2>No encontramos este envío</h2><p class="muted">Revisa que el enlace esté completo.</p></div>`;
      return;
    }
    document.title = `Envío ${d.tracking_code} · ${d.company || 'Sovime Mensajería'}`;
    const [h, sub] = HEAD[d.status] || ['Tu envío', ''];
    const live = d.status === 'cargado';
    $('#trk').innerHTML = `
      <section class="card trk-hero ${d.status}">
        <small class="muted">Hola ${esc(d.customer)} · Guía <b class="mono">${esc(d.tracking_code)}</b></small>
        <h1>${h}</h1><p>${sub}</p>
        ${live && d.eta ? `<div class="trk-eta"><span>Llegada estimada</span><b>${esc(d.eta)}</b></div>` : ''}
        ${live && d.stops_before != null ? `<p class="trk-note">${d.stops_before === 0 ? '🚚 ¡Eres la siguiente entrega!' : `🚚 ${d.stops_before} entrega${d.stops_before === 1 ? '' : 's'} antes de la tuya`}${d.driver ? ` · Te visita <b>${esc(d.driver)}</b>` : ''}</p>` : ''}
        ${d.status === 'fallido' && d.fail_reason ? `<p class="trk-note bad">Motivo: <b>${esc(d.fail_reason)}</b></p>` : ''}
        ${steps(d)}
      </section>
      ${d.destination && ['cargado', 'asignado', 'pendiente'].includes(d.status) ? `<section class="card"><h2>${live && d.driver_position ? 'Tu repartidor en el mapa' : 'Dirección de entrega'}</h2><p class="muted" style="margin-top:-6px">${esc(d.address)}</p><div id="tmap" class="map"></div>
        ${live && d.driver_position ? `<small class="muted">Ubicación del repartidor actualizada ${dt(d.driver_position.at, { timeStyle: 'short' })}</small>` : ''}</section>` : ''}
      ${d.proof ? `<section class="card trk-proof"><h2>Comprobante de entrega</h2>
        <dl class="kv"><dt>Recibió</dt><dd><b>${esc(d.proof.receiver_name || '')}</b>${d.proof.receiver_relation ? ` · ${esc(d.proof.receiver_relation)}` : ''}</dd>
          <dt>Fecha y hora</dt><dd>${dt(d.proof.at)}</dd>${(() => {
            const c = d.proof.compliance; if (!c) return '';
            const yn = (v) => (v == null ? '—' : v ? 'Sí' : 'No');
            const rows = [];
            if (c.shipment_type && c.shipment_type !== 'General') rows.push(`<dt>Tipo de envío</dt><dd>${esc(c.shipment_type)}</dd>`);
            if (c.temp_c != null) rows.push(`<dt>Temperatura</dt><dd>${esc(c.temp_c)} °C${c.temp_in_range == null ? '' : c.temp_in_range ? ' · dentro de rango' : ' · fuera de rango (incidencia registrada)'}</dd>`);
            if (c.seal_ok != null) rows.push(`<dt>Sello</dt><dd>${esc(c.seal_number || '')} íntegro: ${yn(c.seal_ok)}</dd>`);
            if (c.vehicle) rows.push(`<dt>Unidad</dt><dd>Placas ${esc(c.vehicle.plates)} · asegurada: ${yn(c.vehicle.insured)} · fumigada: ${yn(c.vehicle.fumigated)}</dd>`);
            if (c.trusted != null) rows.push(`<dt>Repartidor</dt><dd>Recurso confiable: ${c.trusted ? 'certificado vigente' : 'certificado vencido'}</dd>`);
            return rows.join('');
          })()}${d.proof.serials?.length ? `<dt>Equipos</dt><dd>${d.proof.serials.map((x) => `${esc(x.product)}: <b class="mono">${esc(x.serial)}</b>`).join('<br>')}</dd>` : ''}<dt>Lugar</dt><dd>${d.proof.kind === 'mostrador' ? 'Entregado en sucursal' : esc(d.address)}</dd></dl>
        <div class="rc-evid">
          ${d.proof.signature ? `<figure><img src="${esc(d.proof.signature)}" alt="Firma de quien recibió" /><figcaption>Firma</figcaption></figure>` : ''}
          ${d.proof.photo ? `<figure><a href="${esc(d.proof.photo)}" target="_blank" rel="noopener"><img src="${esc(d.proof.photo)}" alt="Fotografía de la entrega" /></a><figcaption>Fotografía de la entrega</figcaption></figure>` : ''}
        </div>
        <button class="btn block" style="margin-top:12px" onclick="window.print()">Imprimir o guardar comprobante</button></section>` : ''}`;
    if ($('#tmap')) {
      map = L.map('tmap', { zoomControl: true, attributionControl: true }).setView([d.destination.lat, d.destination.lng], 14);
      baseTiles(map);
      destMk = L.marker([d.destination.lat, d.destination.lng], { icon: L.divIcon({ className: '', html: '<div class="pin" style="background:#e5612a"><span>🏠</span></div>', iconSize: [28, 28], iconAnchor: [14, 28] }) }).addTo(map);
      if (d.driver_position) {
        drvMk = L.marker([d.driver_position.lat, d.driver_position.lng], { icon: L.divIcon({ className: '', html: '<div class="truck-pin">🚚</div>', iconSize: [34, 34], iconAnchor: [17, 17] }) }).addTo(map);
        map.fitBounds([[d.destination.lat, d.destination.lng], [d.driver_position.lat, d.driver_position.lng]], { padding: [40, 40], maxZoom: 16 });
      }
    }
    clearTimeout(timer);
    if (!['entregado', 'cancelado'].includes(d.status)) timer = setTimeout(load, live ? 30000 : 120000);
  }
  load();
})();

function baseTiles(map) {
  // Mosaicos servidos por nuestro servidor (caché de OpenStreetMap). Si nuestro servidor no responde, directo de OSM.
  const own = L.tileLayer('/tiles/{z}/{x}/{y}.png', { maxZoom: 19, attribution: 'Mapa © Google · © OpenStreetMap' });
  let fails = 0;
  own.on('tileload', () => { fails = 0; });
  own.on('tileerror', () => {
    if (++fails !== 8) return;
    map.removeLayer(own);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, referrerPolicy: 'strict-origin-when-cross-origin', attribution: '© OpenStreetMap' }).addTo(map);
  });
  return own.addTo(map);
}
