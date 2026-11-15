// Contrato de prestación de servicios con firma electrónica: plantilla, llenado con los datos de cada persona y PDF con su certificado de firma.
// El texto del contrato lo proporcionó Anderns Servicios Integrales, S.C.; se puede reemplazar desde Configuración (contract_template).
const PDFDocument = require('pdfkit');

const DEFAULT_TEMPLATE = `<h1>CONTRATO MERCANTIL DE PRESTACIÓN DE SERVICIOS INDEPENDIENTES DE LOGÍSTICA Y REPARTO</h1>
<p><strong>CONTRATO MERCANTIL DE PRESTACIÓN DE SERVICIOS INDEPENDIENTES DE LOGÍSTICA Y REPARTO</strong> (en lo sucesivo el “Contrato”) que celebran, por una parte, <strong>ANDERNS SERVICIOS INTEGRALES, S.C.</strong>, representada en este acto por su Socio Administrador, el <strong>C. César Andrés Miranda Valadez</strong>, a quien en lo sucesivo se le denominará como <strong>“LA CONTRATANTE”</strong> o <strong>“ANDERNS”</strong>; y por la otra parte, <strong>{{prestador_nombre_o_razon_social}}</strong>{{bloque_representante_moral}}, a quien en lo sucesivo se le denominará como <strong>“EL PRESTADOR”</strong>, y de manera conjunta se les denominará como <strong>“LAS PARTES”</strong>, al tenor de las siguientes Declaraciones y Cláusulas:</p>
<h2>D E C L A R A C I O N E S</h2>
<p><strong>I. Declara “LA CONTRATANTE” (ANDERNS), a través de su representante legal, que:</strong></p>
<p>a) Es una <strong>Sociedad Civil</strong> legalmente constituida conforme a las leyes de los Estados Unidos Mexicanos y del Estado de Baja California, según consta en el Primer Testimonio de la <strong>Escritura Pública número 62,615 (sesenta y dos mil seiscientos quince)</strong>, del <strong>Volumen 1,281 (un mil doscientos ochenta y uno)</strong>, de fecha <strong>25 de febrero de 2005</strong> (ratificada el 4 de marzo de 2005), otorgada ante la fe de la <strong>Lic. Alma E. Andrade Marín</strong>, Titular de la Notaría Pública Número Seis de la ciudad de Tijuana, Baja California, debidamente inscrita en el Registro Público de la Propiedad y de Comercio de Tijuana, Baja California, bajo la <strong>Partida número 5421818</strong>, Sección Civil, de fecha <strong>25 de mayo de 2005</strong>.</p>
<p>b) Dentro de su objeto social se encuentra la operación de toda clase de empresas civiles o mercantiles, la celebración de toda clase de contratos y convenios para la prestación y contratación por cuenta propia o de terceros de servicios técnicos y operativos, así como la realización de toda clase de actos civiles y de comercio permitidos por la ley.</p>
<p>c) Su representante legal, el <strong>C. César Andrés Miranda Valadez</strong>, acredita su personalidad en su carácter de <strong>Socio Administrador</strong>, contando con facultades amplísimas para Actos de Administración y para celebrar todo tipo de contratos civiles y mercantiles en los términos de las Cláusulas Vigésima Octava y Segunda Transitoria del instrumento constitutivo citado, mismas que a la fecha no le han sido revocadas, modificadas ni limitadas en forma alguna.</p>
<p>d) Se encuentra debidamente inscrita en el Registro Federal de Contribuyentes (RFC) con la clave <strong>ASI050304FIA</strong>, y señala como domicilio convencional y fiscal para oír y recibir toda clase de notificaciones el ubicado en <strong>Blvd. Aguacaliente 9031-13D, Colonia Madero, C.P. 22040, en la ciudad de Tijuana, Baja California</strong>.</p>
<p>e) Para el cumplimiento de diversos proyectos operativos y comerciales requiere contratar de manera independiente y no exclusiva los servicios especializados de logística, recolección, transporte y entrega de mercancías.</p>
<p><strong>II. Declara “EL PRESTADOR” (bajo protesta de decir verdad) que:</strong></p>
<p>a) Es una persona <strong>{{prestador_tipo_persona}}</strong> de nacionalidad mexicana, con plena capacidad jurídica para contratar y obligarse, inscrita ante el Servicio de Administración Tributaria (SAT) bajo el Régimen Fiscal de <strong>{{prestador_regimen_fiscal}}</strong>, con Registro Federal de Contribuyentes (RFC) <strong>{{prestador_rfc}}</strong>, CURP <strong>{{prestador_curp}}</strong>, acreditando su identidad con documento oficial <strong>{{prestador_tipo_identificacion}}</strong> folio <strong>{{prestador_numero_identificacion}}</strong>{{bloque_escritura_moral}}.</p>
<p>b) Cuenta con la experiencia técnica, capacidad operativa, infraestructura, permisos, licencias de conducir vigentes, pólizas de seguro y vehículos propios o legítimamente poseídos (Tipo: <strong>{{vehiculo_tipo}}</strong>, Marca/Modelo: <strong>{{vehiculo_marca_modelo}}</strong>, Placas: <strong>{{vehiculo_placas}}</strong>) necesarios para ejecutar los servicios objeto de este Contrato de manera totalmente autónoma e independiente.</p>
<p>c) Su actividad preponderante es la prestación de servicios de logística, mensajería y reparto al público en general, por lo que <strong>NO depende económicamente de ANDERNS</strong>, prestándole sus servicios a diversos clientes de manera simultánea.</p>
<p>d) Señala como domicilio convencional el ubicado en <strong>{{prestador_domicilio_completo}}</strong>, como teléfono móvil <strong>{{prestador_telefono}}</strong>, y como correo electrónico oficial para efectos de notificaciones y validación de identidad en la plataforma digital el siguiente: <strong>{{prestador_email}}</strong>.</p>
<p><strong>III. Declaran “LAS PARTES” que:</strong></p>
<p>a) Se reconocen mutuamente la personalidad con la que comparecen y manifiestan que en la celebración del presente Contrato no existe error, dolo, lesión, mala fe ni vicio alguno del consentimiento.</p>
<p>b) Reconocen expresamente la validez jurídica de los medios electrónicos, mensajes de datos, firma electrónica y constancias de conservación conforme al Código de Comercio, Código Civil Federal, Código Civil para el Estado de Baja California y la Norma Oficial Mexicana <strong>NOM-151-SCFI-2016</strong>.</p>
<h2>C L Á U S U L A S</h2>
<p><strong>PRIMERA. OBJETO DEL CONTRATO.</strong> “EL PRESTADOR” se obliga a prestar de manera independiente, autónoma y por cuenta propia a favor de “ANDERNS”, los servicios de logística, recolección, traslado y entrega de paquetes, bienes o mercancías (en lo sucesivo los “Servicios”) en las rutas, puntos de origen y destinos que le sean solicitados o asignados a través de la aplicación móvil, plataforma tecnológica o medios electrónicos designados por “ANDERNS” (en lo sucesivo la “Plataforma”).</p>
<p><strong>SEGUNDA. AUTONOMÍA Y AUSENCIA DE SUBORDINACIÓN LABORAL (BLINDAJE LABORAL).</strong> “LAS PARTES” convienen expresamente que el presente Contrato es de naturaleza estrictamente <strong>mercantil</strong> (y civil supletoriamente) y no genera relación laboral alguna ni subordinación entre “ANDERNS” y “EL PRESTADOR”, ni respecto del personal, choferes, repartidores o auxiliares que “EL PRESTADOR” utilice para la ejecución de los Servicios. En consecuencia:</p>
<ul>
<li>“EL PRESTADOR” goza de plena libertad operativa y autonomía para decidir cómo, cuándo y en qué horarios conectarse a la Plataforma o aceptar solicitudes de reparto, sin estar sujeto a jornadas laborales, horarios fijos, listas de asistencia, exclusividad ni órdenes directas de carácter patronal.</li>
<li>“EL PRESTADOR” ejecuta los Servicios utilizando sus propios medios, herramientas, dispositivos móviles, planes de datos, combustible, mantenimiento y vehículos.</li>
<li>“ANDERNS” queda eximido de cualquier obligación derivada de la Ley Federal del Trabajo, Ley del Seguro Social (IMSS), INFONAVIT o cualquier otra disposición en materia laboral o de seguridad social respecto de “EL PRESTADOR” y su personal.</li>
</ul>
<p><strong>TERCERA. CUMPLIMIENTO EN MATERIA DE SUBCONTRATACIÓN (REPSE).</strong> En caso de que “EL PRESTADOR” sea una persona moral o física que ponga trabajadores propios a disposición de “ANDERNS” para ejecutar los Servicios, “EL PRESTADOR” se obliga a contar con su registro vigente en el <strong>Padrón Público de Contratistas de Servicios Especializados u Obras Especializadas (REPSE)</strong> ante la Secretaría del Trabajo y Previsión Social (STPS), conforme a los artículos 13, 14 y 15 de la Ley Federal del Trabajo. “EL PRESTADOR” deberá entregar mensualmente a “ANDERNS” copia de los Comprobantes Fiscales Digitales por Internet (CFDI) de pago de salarios de sus trabajadores, recibo de pago de cuotas obrero-patronales al IMSS, aportaciones al INFONAVIT y declaración del IVA correspondiente. El incumplimiento de esta obligación facultará a “ANDERNS” para suspender de inmediato cualquier pago pendiente sin responsabilidad alguna y rescindir el Contrato.</p>
<p><strong>CUARTA. CONTRAPRESTACIÓN, CORTE SEMANAL Y FACTURACIÓN.</strong> Como contraprestación por los Servicios efectivamente realizados y confirmados mediante evidencia digital de entrega en la Plataforma, “ANDERNS” pagará a “EL PRESTADOR” las tarifas variables o por evento estipuladas en el <strong>Anexo A (Tarifario)</strong> o aceptadas previamente por “EL PRESTADOR” en la Plataforma antes de iniciar cada servicio:</p>
<ul>
<li><strong>Corte y Fecha de Pago:</strong> Se realizará un corte semanal de lunes a domingo, efectuándose el pago correspondiente al periodo cerrado el día sábado de la semana inmediata siguiente (o el día hábil bancario inmediato anterior en caso de ser inhábil), previa validación de los servicios concluidos y recepción del comprobante fiscal correspondiente.</li>
<li><strong>Facturación:</strong> “EL PRESTADOR” deberá emitir el CFDI correspondiente a nombre de ANDERNS SERVICIOS INTEGRALES, S.C. (RFC: ASI050304FIA), cumpliendo con todos los requisitos fiscales vigentes (incluyendo el Complemento Carta Porte cuando la legislación fiscal aplicable así lo exija).</li>
<li><strong>Forma de pago:</strong> Los pagos se realizarán mediante transferencia electrónica de fondos a la cuenta bancaria CLABE <strong>{{prestador_clabe}}</strong> de la institución financiera <strong>{{prestador_banco}}</strong>, cuyo titular es <strong>{{prestador_titular_cuenta}}</strong>.</li>
<li><strong>Impuestos:</strong> Cada parte será responsable del cumplimiento y entero de sus propios impuestos federales o locales (ISR, IVA y retenciones aplicables).</li>
</ul>
<p><strong>QUINTA. RESPONSABILIDAD POR MERCANCÍAS, ROBO O DAÑOS (INDEMNIZACIÓN).</strong> Desde el momento en que “EL PRESTADOR” recolecta el paquete o mercancía y firma o valida su recepción en la Plataforma, asume la guarda, custodia y responsabilidad total sobre la integridad de dichos bienes hasta su entrega formal al destinatario final. “EL PRESTADOR” responderá ante “ANDERNS” por el valor comercial íntegro de la mercancía en caso de pérdida, extravío, daño, avería, merma, abuso de confianza o robo (salvo caso fortuito o fuerza mayor debidamente acreditado con denuncia ministerial ante la Fiscalía General del Estado correspondiente). “ANDERNS” queda expresamente facultado para descontar o compensar de los pagos pendientes del corte semanal de “EL PRESTADOR” el monto de los daños o mercancías extraviadas, sin perjuicio de ejercer las acciones civiles o penales que correspondan.</p>
<p><strong>SEXTA. VEHÍCULOS, PERMISOS, SEGUROS Y ACCIDENTES VIALES.</strong> “EL PRESTADOR” se obliga a mantener vigentes durante toda la duración del Contrato:</p>
<ul>
<li>Licencia de conducir acorde al tipo de vehículo utilizado (Número: <strong>{{vehiculo_licencia_numero}}</strong>, Vigencia: <strong>{{vehiculo_licencia_vigencia}}</strong>).</li>
<li>Tarjeta de circulación, placas y verificación vehicular al corriente.</li>
<li>Póliza de seguro de vehículo con cobertura amplia o de responsabilidad civil por daños a terceros y uso comercial, vigente y pagada (Aseguradora: <strong>{{seguro_aseguradora}}</strong>, Póliza: <strong>{{seguro_poliza_numero}}</strong>).</li>
</ul>
<p>“EL PRESTADOR” libera a “ANDERNS” de toda responsabilidad civil, penal, administrativa o de tránsito derivada de infracciones, multas, corralones, choques, atropellamientos, lesiones o daños a terceros ocasionados durante la prestación de los Servicios, obligándose a sacar en paz y a salvo a “ANDERNS” de cualquier reclamación o demanda judicial o extrajudicial.</p>
<p><strong>SÉPTIMA. PROHIBICIÓN DE TRANSPORTAR MERCANCÍA ILÍCITA.</strong> Queda estrictamente prohibido a “EL PRESTADOR” transportar sustancias psicotrópicas, estupefacientes, armas, explosivos, dinero en efectivo no autorizado o cualquier bien de procedencia ilícita. En caso de inspección por autoridades, “EL PRESTADOR” asume la responsabilidad penal exclusiva, deslindando totalmente a “ANDERNS”.</p>
<p><strong>OCTAVA. CONFIDENCIALIDAD Y PROTECCIÓN DE DATOS PERSONALES.</strong> Toda información comercial, logística, tarifas, bases de datos, nombres, teléfonos y domicilios de clientes o destinatarios de “ANDERNS” a los que tenga acceso “EL PRESTADOR” tiene el carácter de Información Confidencial y Secreto Industrial en términos de la Ley Federal de Protección a la Propiedad Industrial. Asimismo, “EL PRESTADOR” actuará como Encargado del Tratamiento de Datos Personales conforme a la Ley Federal de Protección de Datos Personales en Posesión de los Particulares (LFPDPPP), obligándose a utilizar los datos de los destinatarios única y exclusivamente para realizar la entrega, quedando prohibido contactarlos posteriormente, almacenar sus datos o compartirlos con terceros. Esta obligación subsistirá por 5 (cinco) años posteriores a la terminación del Contrato.</p>
<p><strong>NOVENA. VIGENCIA Y TERMINACIÓN ANTICIPADA.</strong> El presente Contrato tendrá una vigencia indefinida a partir de la fecha de su firma electrónica (<strong>{{contrato_fecha_firma}}</strong>). No obstante, cualquiera de “LAS PARTES” podrá darlo por terminado de manera anticipada, sin necesidad de declaración judicial y sin responsabilidad o penalización alguna, mediante simple aviso por escrito o notificación dentro de la Plataforma con al menos 5 (cinco) días naturales de anticipación.</p>
<p><strong>DÉCIMA. RESCISIÓN INMEDIATA Y PENA CONVENCIONAL.</strong> “ANDERNS” podrá rescindir el presente Contrato de pleno derecho y de manera inmediata, bloqueando el acceso a la Plataforma, cuando “EL PRESTADOR” incurra en: a) Robo, sustracción, apertura o alteración de paquetes; b) Suplantación de identidad o cesión de su cuenta de usuario a terceros no autorizados; c) Falsificación de documentación oficial, fiscal o pólizas de seguro; o d) Incumplimiento a la cláusula de Confidencialidad y Protección de Datos Personales. En caso de incumplimiento a las obligaciones de confidencialidad o sustracción de mercancía, “EL PRESTADOR” pagará a “ANDERNS” una pena convencional equivalente a <strong>$50,000.00 MXN (Cincuenta mil pesos 00/100 M.N.)</strong>, independientemente de la reparación íntegra del daño y las acciones penales aplicables.</p>
<p><strong>DÉCIMA PRIMERA. CONSENTIMIENTO ELECTRÓNICO Y FIRMA REMOTA (VALIDEZ LEGAL).</strong> De conformidad con lo dispuesto por los artículos 89, 89 bis, 90, 93, 97 y demás relativos del Código de Comercio, los artículos 1803 y 1834 bis del Código Civil Federal, así como sus correlativos del Código Civil para el Estado de Baja California, “LAS PARTES” acuerdan expresamente que la celebración, aceptación y firma del presente Contrato se realizará a través de medios electrónicos mediante firma electrónica simple, firma electrónica avanzada (e.firma) o aceptación biométrica/OTP dentro de la Plataforma o proveedor de firma digital designado por “ANDERNS”. “LAS PARTES” reconocen que el mensaje de datos generado, junto con su Constancia de Conservación de Mensajes de Datos emitida conforme a la NOM-151-SCFI-2016, produce los mismos efectos jurídicos que las leyes otorgan a los documentos firmados de manera autógrafa, teniendo pleno valor probatorio en juicio. “EL PRESTADOR” acepta que cualquier acción realizada mediante sus credenciales de acceso, correo electrónico, número celular registrado o firma digital le será plenamente atribuible.</p>
<p><strong>DÉCIMA SEGUNDA. LEGISLACIÓN APLICABLE Y JURISDICCIÓN.</strong> Para la interpretación, cumplimiento y ejecución del presente Contrato, “LAS PARTES” se someten expresamente a las leyes federales mercantiles aplicables y supletoriamente a la legislación del Estado de Baja California, sometiéndose a la jurisdicción de los Tribunales competentes de la ciudad de Tijuana, Baja California, renunciando expresamente a cualquier otro fuero que pudiera corresponderles por razón de sus domicilios presentes o futuros.</p>
<p>Leído que fue el presente Contrato y enteradas “LAS PARTES” de su contenido y alcance legal, lo firman de manera electrónica en la ciudad de Tijuana, Baja California, en la fecha y hora registradas en el sello digital de tiempo correspondiente (<strong>{{contrato_fecha_firma}}</strong>).</p>`;

// variables del contrato y qué dato del expediente las llena
const VARS = [
  ['prestador_tipo_persona', 'Tipo de persona'], ['prestador_nombre_o_razon_social', 'Nombre o razón social'], ['prestador_regimen_fiscal', 'Régimen fiscal'],
  ['prestador_rfc', 'RFC'], ['prestador_curp', 'CURP'], ['prestador_tipo_identificacion', 'Tipo de identificación'], ['prestador_numero_identificacion', 'Número de identificación'],
  ['prestador_domicilio_completo', 'Domicilio'], ['prestador_telefono', 'Teléfono'], ['prestador_email', 'Correo'],
  ['prestador_clabe', 'CLABE'], ['prestador_banco', 'Banco'], ['prestador_titular_cuenta', 'Titular de la cuenta'],
  ['vehiculo_tipo', 'Tipo de vehículo'], ['vehiculo_marca_modelo', 'Marca y modelo'], ['vehiculo_placas', 'Placas'],
  ['vehiculo_licencia_numero', 'Número de licencia'], ['vehiculo_licencia_vigencia', 'Vigencia de la licencia'],
  ['seguro_aseguradora', 'Aseguradora'], ['seguro_poliza_numero', 'Número de póliza'],
];
const OPTIONAL = new Set(['bloque_representante_moral', 'bloque_escritura_moral', 'contrato_fecha_firma', 'prestador_curp']);
const escH = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function fill(tpl, vars) {
  return String(tpl || DEFAULT_TEMPLATE).replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/g, (m, k) => (vars[k] == null || vars[k] === '' ? (k === 'prestador_curp' ? 'No aplica' : OPTIONAL.has(k) ? '' : '______________') : escH(vars[k])));
}
const missingVars = (vars) => VARS.filter(([k]) => !OPTIONAL.has(k) && !String(vars[k] ?? '').trim()).map(([, l]) => l);

// ---------- PDF: el contrato (h1, h2, p, ul/li, strong) + bloque de firmas + certificado de firma y auditoría ----------
const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
function runs(html) {
  const out = [];
  const re = /<strong>([\s\S]*?)<\/strong>|([^<]+)|<[^>]+>/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[1] != null) out.push({ t: decode(m[1].replace(/<[^>]+>/g, '')), b: true });
    else if (m[2] != null) out.push({ t: decode(m[2]), b: false });
  }
  const rs = out.filter((r) => r.t);
  for (let i = 1; i < rs.length; i++) if (/^\s/.test(rs[i].t)) { rs[i - 1].t = rs[i - 1].t.replace(/\s*$/, ' '); rs[i].t = rs[i].t.replace(/^\s+/, ''); }
  return rs.filter((r) => r.t);
}
function blocks(html) {
  const out = [];
  const re = /<(h1|h2|p|li)[^>]*>([\s\S]*?)<\/\1>/g;
  let m;
  while ((m = re.exec(html))) out.push({ tag: m[1], runs: runs(m[2].replace(/\s+/g, ' ').trim()) });
  return out;
}
function writeRuns(doc, rs, opts) {
  rs.forEach((r, i) => doc.font(r.b ? 'Helvetica-Bold' : 'Helvetica').text(r.t, { ...opts, continued: i < rs.length - 1 }));
}
// genera el PDF y regresa un Buffer
function buildPdf({ html, folio, company, signer, cert, images = {}, annexes = [] }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', bufferPages: true, margins: { top: 54, bottom: 60, left: 60, right: 60 }, info: { Title: `Contrato ${folio}`, Author: 'Anderns Servicios Integrales, S.C.', Subject: 'Contrato mercantil de prestación de servicios independientes de logística y reparto' } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    const W = doc.page.width - 120;
    const footer = () => { const keep = { x: doc.x, y: doc.y, b: doc.page.margins.bottom }; doc.page.margins.bottom = 0; const y = doc.page.height - 40; doc.font('Helvetica').fontSize(7.5).fillColor('#666').text(`Folio ${folio} · Documento firmado electrónicamente · Huella SHA-256 del texto: ${cert.text_sha256.slice(0, 32)}…`, 60, y, { width: W, align: 'center', lineBreak: false }); doc.fillColor('#111'); doc.page.margins.bottom = keep.b; doc.x = keep.x; doc.y = keep.y; };
    doc.fontSize(10.5).fillColor('#111');
    const renderHtml = (h) => { for (const b of blocks(h)) {
      if (b.tag === 'h1') { doc.moveDown(0.3); doc.font('Helvetica-Bold').fontSize(12.5).text(b.runs.map((r) => r.t).join(''), { align: 'center' }); doc.moveDown(0.8); doc.fontSize(10.5); }
      else if (b.tag === 'h2') { doc.moveDown(0.6); doc.font('Helvetica-Bold').fontSize(11).text(b.runs.map((r) => r.t).join(''), { align: 'center' }); const y = doc.y + 2; doc.moveTo(60, y).lineTo(60 + W, y).lineWidth(0.6).stroke('#333'); doc.moveDown(0.7); doc.fontSize(10.5); }
      else if (b.tag === 'li') { doc.x = 76; writeRuns(doc, [{ t: '•  ', b: false }, ...b.runs], { align: 'justify', width: W - 16, lineGap: 1.5 }); doc.moveDown(0.35); doc.x = 60; }
      else { doc.x = 60; writeRuns(doc, b.runs, { align: 'justify', width: W, lineGap: 1.5 }); doc.moveDown(0.6); }
    } };
    renderHtml(html);
    // firmas
    if (doc.y > doc.page.height - 260) doc.addPage();
    doc.moveDown(1.5);
    const top = doc.y, colW = W / 2 - 15;
    doc.font('Helvetica-Bold').fontSize(9.5);
    doc.text('ANDERNS SERVICIOS INTEGRALES, S.C.', 60, top, { width: colW, align: 'center' });
    doc.font('Helvetica').fontSize(8.5).text(`${company.signer}\nSocio Administrador\nEmitido electrónicamente el ${company.issued_at}\npor ${company.issued_by}`, 60, top + 52, { width: colW, align: 'center' });
    doc.moveTo(70, top + 48).lineTo(60 + colW - 10, top + 48).lineWidth(0.8).stroke('#000');
    const x2 = 60 + colW + 30;
    if (images.signature) { try { doc.image(images.signature, x2 + 20, top + 2, { fit: [colW - 40, 44], align: 'center' }); } catch { /* firma ilegible: queda solo la aceptación */ } }
    doc.moveTo(x2 + 10, top + 48).lineTo(x2 + colW - 10, top + 48).lineWidth(0.8).stroke('#000');
    doc.font('Helvetica-Bold').fontSize(9.5).text(signer.name, x2, top + 52, { width: colW, align: 'center' });
    doc.font('Helvetica').fontSize(8.5).text(`Aceptación electrónica\n${cert.signed_local}`, x2, doc.y, { width: colW, align: 'center' });
    // anexos aceptados en la misma sesión (Anexo A, Aviso de privacidad, Términos)
    for (const a of annexes) { doc.addPage(); doc.x = 60; doc.y = 54; renderHtml(a.html); }
    // certificado de firma y auditoría
    doc.addPage();
    doc.font('Helvetica-Bold').fontSize(12).text('CERTIFICADO DE FIRMA ELECTRÓNICA Y REGISTRO DE AUDITORÍA', 60, 54, { align: 'center', width: W });
    doc.moveDown(0.4).font('Helvetica').fontSize(8.5).fillColor('#444').text(`Folio del contrato: ${folio}`, { align: 'center', width: W }).fillColor('#111');
    doc.moveDown(0.8);
    const row = (k, v) => { const y = doc.y; doc.font('Helvetica-Bold').fontSize(8.5).text(k, 60, y, { width: 150 }); const h1 = doc.y; doc.font('Helvetica').text(String(v ?? '—'), 215, y, { width: W - 155 }); doc.y = Math.max(h1, doc.y) + 3; };
    const sec = (t) => { doc.moveDown(0.5); doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#1d3f72').text(t, 60, doc.y, { width: W }); doc.fillColor('#111'); doc.moveDown(0.3); };
    sec('Firmante');
    row('Nombre / razón social', signer.name); row('RFC', signer.rfc); row('CURP', signer.curp); row('Identificación', signer.id); row('Correo', signer.email); row('Teléfono', signer.phone);
    sec('Atribución de identidad (doble factor)');
    row('Código de un solo uso (OTP)', cert.otp); row('Validado', cert.otp_verified_at);
    sec('Registro de metadatos');
    row('Fecha y hora (local)', cert.signed_local); row('Fecha y hora (UTC)', cert.signed_utc); row('Dirección IP', cert.ip);
    row('Geolocalización GPS', cert.gps); row('Dispositivo', cert.device); row('Navegador (user agent)', cert.ua);
    sec('Prueba de vida y documentos (KYC) capturados en la sesión de firma');
    for (const e of cert.evidence) row(e.label, `SHA-256 ${e.sha256}`);
    sec('Integridad');
    row('Huella del texto del contrato', `SHA-256 ${cert.text_sha256}`);
    for (const a of annexes) row(`${a.title} (v${a.version})`, `Aceptado · SHA-256 ${a.sha256}`);
    row('Emisión por la contratante', `${company.issued_by} · ${company.issued_at} · SHA-256 ${cert.company_sha256}`);
    row('Constancia NOM-151-SCFI-2016', cert.nom151 || 'Se solicita al Prestador de Servicios de Certificación sobre la huella SHA-256 de este PDF; su folio y archivo de constancia quedan en el expediente.');
    // fotos de la prueba de vida
    const thumbs = [['Selfie', images.selfie], ['INE (frente)', images.ine_front], ['INE (reverso)', images.ine_back]].filter(([, b]) => b);
    if (thumbs.length) {
      if (doc.y > doc.page.height - 230) doc.addPage();
      doc.moveDown(0.8);
      const y = doc.y, w = (W - 20) / 3;
      thumbs.forEach(([l, b], i) => { try { doc.image(b, 60 + i * (w + 10), y, { fit: [w, 140], align: 'center' }); } catch { /* imagen no compatible */ } doc.font('Helvetica').fontSize(8).text(l, 60 + i * (w + 10), y + 144, { width: w, align: 'center' }); });
    }
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) { doc.switchToPage(i); footer(); }
    doc.end();
  });
}
module.exports = { DEFAULT_TEMPLATE, VARS, fill, missingVars, buildPdf };
