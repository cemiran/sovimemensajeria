/* Verificación pública de un certificado de cumplimiento (por QR) */
'use strict';
(() => {
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const day = (d) => (d ? new Date(String(d).slice(0, 10) + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' }) : '');
  const box = document.getElementById('cv');
  const token = location.pathname.split('/').pop();
  fetch('/api/public/cert/' + encodeURIComponent(token), { cache: 'no-store' })
    .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; })
    .then((d) => {
      const st = { vigente: ['VIGENTE', 'entregado'], vencido: ['VENCIDO', 'fallido'], revocado: ['REVOCADO', 'fallido'] }[d.status];
      const t = d.totals;
      const yn = (b) => (b ? '✔' : '✘');
      box.innerHTML = `
        <section class="card trk-hero ${st[1]}">
          <small class="muted">Folio <b class="mono">${esc(d.folio)}</b></small>
          <h1>Certificado ${st[0]}</h1>
          <p>Emitido por <b>${esc(d.company.legal_name || d.company.name)}</b>${d.company.rfc ? ` · RFC ${esc(d.company.rfc)}` : ''}</p>
          <p>Emitido el ${day(d.issued_at)} · vigente hasta el <b>${day(d.valid_until)}</b></p>
          ${d.scope ? `<p class="trk-note"><b>Alcance:</b> ${esc(d.scope)}</p>` : ''}
        </section>
        <section class="card"><h2>Resumen al momento de emisión</h2><dl class="kv">
          <dt>Unidades</dt><dd>${t.vehicles} (${t.insured} con seguro vigente, ${t.fumigated} con fumigación vigente, ${t.branded} rotuladas, ${t.refrigerated} refrigeradas)</dd>
          <dt>Repartidores</dt><dd>${t.drivers} (${t.trusted} con certificado de recurso confiable vigente)</dd>
          <dt>Checklists de unidad</dt><dd>${t.checks_30d} en los 30 días previos</dd>
          ${t.medical_deliveries_90d ? `<dt>Envíos médicos (90 días)</dt><dd>${t.medical_deliveries_90d}; temperatura en rango ${t.temp_in_range}/${t.temp_records}; sellos íntegros ${t.seal_ok}/${t.seal_records}</dd>` : ''}
        </dl></section>
        <section class="card"><h2>Unidades</h2><div class="table-wrap"><table><thead><tr><th>Unidad</th><th>Placas</th><th>Seguro</th><th>Fumigación</th><th>Rotulada</th></tr></thead><tbody>
          ${d.vehicles.map((v) => `<tr><td>${esc(v.name)}${v.refrigerated ? ' ❄️' : ''}</td><td class="mono">${esc(v.plates)}</td><td>${yn(v.insured)}</td><td>${yn(v.fumigated)}</td><td>${yn(v.branded)}</td></tr>`).join('')}
        </tbody></table></div></section>
        ${d.practices.length ? `<section class="card"><h2>Prácticas aplicadas</h2><ul class="cert-list">${d.practices.map((p) => `<li>${esc(p.label)}</li>`).join('')}</ul></section>` : ''}
        <p class="trk-foot">Autodeclaración de la empresa con base en sus registros; no sustituye certificaciones de autoridades u organismos acreditados.</p>`;
    })
    .catch(() => { box.innerHTML = '<div class="card empty"><h2>Certificado no encontrado</h2><p class="muted">Revisa que el enlace o el código QR estén completos.</p></div>'; });
})();
