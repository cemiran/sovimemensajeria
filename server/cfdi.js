// CFDI 4.0: lectura del XML y consulta del estado en el servicio público del SAT (ConsultaCFDIService)
const attr = (tag, name, xml) => { const m = xml.match(new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*?\\s${name}="([^"]*)"`)); return m ? m[1] : null; };

function parseCfdi(xml) {
  const x = String(xml || '');
  if (!/<(?:\w+:)?Comprobante\b/.test(x)) throw new Error('El archivo no es un CFDI (XML del SAT)');
  const out = {
    version: attr('Comprobante', 'Version', x),
    tipo: attr('Comprobante', 'TipoDeComprobante', x),
    subtotal: Number(attr('Comprobante', 'SubTotal', x)),
    total: Number(attr('Comprobante', 'Total', x)),
    moneda: attr('Comprobante', 'Moneda', x),
    fecha: attr('Comprobante', 'Fecha', x),
    rfc_emisor: (attr('Emisor', 'Rfc', x) || '').toUpperCase(),
    nombre_emisor: attr('Emisor', 'Nombre', x),
    rfc_receptor: (attr('Receptor', 'Rfc', x) || '').toUpperCase(),
    uuid: (attr('TimbreFiscalDigital', 'UUID', x) || '').toUpperCase(),
    fecha_timbrado: attr('TimbreFiscalDigital', 'FechaTimbrado', x),
  };
  if (!out.uuid) throw new Error('El CFDI no está timbrado (no tiene UUID)');
  return out;
}

// estado del CFDI ante el SAT: Vigente / Cancelado / No Encontrado
async function satStatus(c) {
  const expr = `?re=${c.rfc_emisor}&rr=${c.rfc_receptor}&tt=${Number(c.total).toFixed(6)}&id=${c.uuid}`;
  const body = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tem="http://tempuri.org/"><soap:Header/><soap:Body><tem:Consulta><tem:expresionImpresa><![CDATA[${expr}]]></tem:expresionImpresa></tem:Consulta></soap:Body></soap:Envelope>`;
  const r = await fetch('https://consultaqr.facturaelectronica.sat.gob.mx/ConsultaCFDIService.svc', {
    method: 'POST', headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: 'http://tempuri.org/IConsultaCFDIService/Consulta' }, body, signal: AbortSignal.timeout(20000),
  });
  const t = await r.text();
  const g = (k) => (t.match(new RegExp(`<(?:\\w+:)?${k}>([^<]*)</`)) || [])[1] || null;
  return { estado: g('Estado'), codigo: g('CodigoEstatus'), cancelable: g('EsCancelable'), cancelacion: g('EstatusCancelacion'), validacion_efos: g('ValidacionEFOS') };
}
module.exports = { parseCfdi, satStatus };
