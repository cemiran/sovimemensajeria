// Validación documental del prestador (onboarding): lectura de la Constancia de Situación Fiscal (CSF) del SAT y reglas de documentos obligatorios
const pdfParse = require('pdf-parse/lib/pdf-parse.js');

const MESES = { ENERO: 1, FEBRERO: 2, MARZO: 3, ABRIL: 4, MAYO: 5, JUNIO: 6, JULIO: 7, AGOSTO: 8, SEPTIEMBRE: 9, OCTUBRE: 10, NOVIEMBRE: 11, DICIEMBRE: 12 };
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9Ñ& ]/g, ' ').replace(/\s+/g, ' ').trim();
// regímenes compatibles con la prestación independiente de servicios de reparto
const REGIMENES = [
  ['ACTIVIDADES EMPRESARIALES Y PROFESIONALES', 'Actividades Empresariales y Profesionales'],
  ['SIMPLIFICADO DE CONFIANZA', 'Régimen Simplificado de Confianza (RESICO)'],
  ['PLATAFORMAS TECNOLOGICAS', 'Actividades empresariales a través de Plataformas Tecnológicas'],
  ['GENERAL DE LEY PERSONAS MORALES', 'General de Ley Personas Morales'],
];

// texto de un PDF: prueba dos versiones del lector y, si el índice del PDF está dañado, lo reconstruye
async function readPdfText(buf) {
  const fixed = () => Buffer.from(buf.toString('latin1').replace(/startxref\s+\d+/, 'startxref\n0'), 'latin1');
  for (const [b, v] of [[buf, 'v1.10.100'], [buf, 'v2.0.550'], [null, 'v1.10.100'], [null, 'v2.0.550']]) {
    try { const r = await pdfParse(b || fixed(), { version: v }); if (r.text && r.text.trim()) return r.text; } catch { /* siguiente intento */ }
  }
  return null;
}
// lee la CSF (PDF del SAT) y la compara con el expediente: fecha ≤ 30 días, RFC, estatus ACTIVO, régimen compatible y titular de la cuenta
async function checkCsf(buf, { rfc, holder, name, today }) {
  const text = await readPdfText(buf);
  if (text == null) return { ok: false, manual: true, issues: ['No se pudo leer el PDF: revísala a mano'] };
  const T = norm(text);
  if (!/CONSTANCIA DE SITUACION FISCAL|CEDULA DE IDENTIFICACION FISCAL/.test(T)) return { ok: false, manual: true, issues: ['El PDF no parece una Constancia de Situación Fiscal del SAT'] };
  const out = { issues: [] };
  // RFC
  const rfcs = [...new Set((text.toUpperCase().match(/\b[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}\b/g) || []))];
  out.rfc = rfcs[0] || null;
  if (!out.rfc) out.issues.push('No se encontró el RFC en la constancia');
  else if (rfc && !rfcs.includes(String(rfc).toUpperCase())) out.issues.push(`El RFC de la constancia (${out.rfc}) no coincide con el del expediente (${rfc})`);
  // fecha de emisión (máximo 30 días)
  const m = T.match(/FECHA DE EMISION.{0,80}?(\d{1,2}) DE ([A-Z]+) DE (\d{4})/) || T.match(/(\d{1,2}) DE (ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|SEPTIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE) DE (\d{4})/);
  if (m && MESES[m[2]]) {
    out.fecha = `${m[3]}-${String(MESES[m[2]]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
    const days = Math.round((new Date(today + 'T12:00:00') - new Date(out.fecha + 'T12:00:00')) / 864e5);
    out.dias = days;
    if (days > 30) out.issues.push(`La constancia tiene ${days} días (máximo 30): pide una actualizada`);
  } else out.issues.push('No se encontró la fecha de emisión');
  // estatus en el padrón
  const st = T.match(/ESTATUS EN EL PADRON\s*:?\s*([A-Z]+)/);
  out.estatus = st ? st[1] : null;
  if (out.estatus && out.estatus !== 'ACTIVO') out.issues.push(`Estatus en el padrón: ${out.estatus} (debe estar ACTIVO)`);
  if (!out.estatus) out.issues.push('No se encontró el estatus en el padrón');
  // régimen compatible
  out.regimenes = REGIMENES.filter(([k]) => T.includes(k)).map(([, l]) => l);
  if (!out.regimenes.length) out.issues.push('No tiene un régimen compatible (Actividad Empresarial, RESICO o Plataformas Tecnológicas)');
  // nombre de la constancia vs titular de la cuenta bancaria (y el nombre registrado)
  const nm = T.match(/NOMBRE\s*\(?S\)?\s*:?\s*([A-ZÑ ]+?)\s+PRIMER APELLIDO\s*:?\s*([A-ZÑ ]+?)\s+SEGUNDO APELLIDO\s*:?\s*([A-ZÑ ]*?)\s+(?:FECHA|ESTATUS|NOMBRE COMERCIAL)/)
    || T.match(/DENOMINACION\s*\/?\s*RAZON SOCIAL\s*:?\s*([A-ZÑ0-9& ]+?)\s+(?:REGIMEN CAPITAL|FECHA|ESTATUS)/);
  out.nombre = nm ? nm.slice(1).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim() : null;
  const tokens = (s) => new Set(norm(s).split(' ').filter((w) => w.length > 2));
  const same = (a, b) => { if (!a || !b) return null; const A = tokens(a), B = tokens(b); const inter = [...A].filter((x) => B.has(x)).length; return inter >= Math.min(2, Math.min(A.size, B.size)); };
  if (out.nombre && holder && same(out.nombre, holder) === false) out.issues.push(`El titular de la cuenta (${holder}) no coincide con el nombre de la constancia (${out.nombre})`);
  if (out.nombre && name && same(out.nombre, name) === false) out.issues.push(`El nombre registrado (${name}) no coincide con el de la constancia (${out.nombre})`);
  out.ok = !out.issues.length;
  return out;
}

// documentos del alta del prestador: obligatorios según su perfil; los que vencen se vigilan
const DOCS = [
  ['ine', 'INE / pasaporte (frente)'], ['ine_rev', 'INE (reverso)'], ['csf', 'Constancia de Situación Fiscal (máx. 30 días)'],
  ['banco', 'Carátula del estado de cuenta (CLABE)'], ['licencia', 'Licencia de conducir vigente'], ['tarjeta', 'Tarjeta de circulación'],
  ['seguro', 'Póliza de seguro vigente'], ['seguro_pago', 'Recibo de pago del seguro'], ['repse', 'Aviso de registro REPSE vigente'],
  ['domicilio', 'Comprobante de domicilio'], ['curp', 'CURP'], ['antecedentes', 'Carta de no antecedentes penales'], ['contrato', 'Contrato firmado'],
];
const EXPIRING = ['licencia', 'tarjeta', 'seguro', 'repse'];
// obligatorios para firmar el contrato y operar (conduce = reparte; repse = persona moral o con empleados propios)
function required({ conduce, repse }) {
  return ['ine', 'ine_rev', 'csf', 'banco', ...(conduce ? ['licencia', 'tarjeta', 'seguro', 'seguro_pago'] : []), ...(repse ? ['repse'] : [])];
}
module.exports = { checkCsf, DOCS, EXPIRING, required, REGIMENES };
