// Documentos legales complementarios del prestador. TODOS SON BORRADORES redactados para revisión del abogado de Anderns:
// no se muestran a los prestadores hasta que el administrador publica una versión. El texto se edita desde Configuración → Firma electrónica.
const NOTA = '<p><strong>BORRADOR PARA REVISIÓN LEGAL.</strong> Este documento debe ser revisado y aprobado por el abogado de ANDERNS SERVICIOS INTEGRALES, S.C. antes de publicarse.</p>';

const ANEXO_A = `<h1>ANEXO A · TARIFARIO</h1>
${NOTA}
<p>Este Anexo forma parte del Contrato Mercantil de Prestación de Servicios Independientes de Logística y Reparto celebrado entre <strong>ANDERNS SERVICIOS INTEGRALES, S.C.</strong> (“ANDERNS”) y <strong>{{prestador_nombre}}</strong> (“EL PRESTADOR”).</p>
<h2>1. Tarifas vigentes para EL PRESTADOR</h2>
<ul>
<li><strong>Servicio entregado:</strong> {{tarifa_entrega}} por cada entrega concluida y confirmada con evidencia digital (fotografía, firma de quien recibe o código de confirmación) en la Plataforma.</li>
<li><strong>Visita sin entrega:</strong> {{tarifa_visita}} por cada visita registrada en el domicilio del destinatario cuando la entrega no pudo realizarse por causas ajenas a EL PRESTADOR, con la evidencia que solicite la Plataforma.</li>
<li><strong>Coordinación de otros prestadores (si aplica):</strong> {{tarifa_coordinacion}}.</li>
</ul>
<h2>2. Forma de cálculo</h2>
<p>La contraprestación se calcula por evento (servicio) y no por tiempo. No existe pago por horas, jornada ni disponibilidad. El importe de cada liquidación es la suma de los servicios concluidos en el periodo, más los bonos que, en su caso, ANDERNS ofrezca de manera expresa, menos las incidencias operativas documentadas conforme a la cláusula QUINTA del Contrato.</p>
<h2>3. Conocimiento y aceptación previa</h2>
<p>EL PRESTADOR conoce estas tarifas, que se muestran en la Plataforma antes de iniciar cada ruta o servicio. EL PRESTADOR puede rechazar cualquier servicio sin penalización alguna; al iniciar un servicio acepta la tarifa aplicable al mismo. ANDERNS podrá modificar las tarifas para servicios futuros, notificándolo en la Plataforma antes de su aplicación; los servicios ya realizados se liquidan con la tarifa vigente al momento de realizarlos.</p>
<h2>4. Liquidación</h2>
<p>El corte es semanal, de lunes a domingo. La Plataforma muestra el estado de cuenta del periodo cerrado; EL PRESTADOR emite el CFDI correspondiente y el pago se realiza conforme a la cláusula CUARTA del Contrato.</p>`;

const AVISO = `<h1>AVISO DE PRIVACIDAD INTEGRAL PARA PRESTADORES DE SERVICIOS</h1>
${NOTA}
<h2>1. Responsable</h2>
<p><strong>ANDERNS SERVICIOS INTEGRALES, S.C.</strong> (“ANDERNS”), con domicilio en Blvd. Aguacaliente 9031-13D, Colonia Madero, C.P. 22040, Tijuana, Baja California, es responsable del tratamiento de los datos personales de las personas que prestan servicios independientes de logística y reparto a través de su Plataforma, conforme a la legislación mexicana en materia de protección de datos personales en posesión de los particulares.</p>
<h2>2. Datos personales que se recaban</h2>
<ul>
<li><strong>Identificación y contacto:</strong> nombre, CURP, identificación oficial (INE o pasaporte), domicilio, teléfono y correo electrónico.</li>
<li><strong>Fiscales:</strong> RFC, régimen fiscal, Constancia de Situación Fiscal y comprobantes fiscales (CFDI).</li>
<li><strong>Financieros:</strong> institución bancaria, CLABE, titular de la cuenta y carátula del estado de cuenta.</li>
<li><strong>Vehiculares:</strong> licencia de conducir, tarjeta de circulación, placas, póliza de seguro y su comprobante de pago.</li>
<li><strong>Imagen y biométricos:</strong> fotografía tipo selfie tomada al firmar, utilizada para verificar la identidad contra la identificación oficial.</li>
<li><strong>Geolocalización:</strong> ubicación del dispositivo mientras EL PRESTADOR está conectado a la Plataforma realizando servicios, y en el momento de registrar entregas y de firmar documentos.</li>
<li><strong>Datos del dispositivo y de la firma electrónica:</strong> dirección IP, modelo del dispositivo, navegador, fecha y hora.</li>
</ul>
<p>Los datos biométricos y la geolocalización se tratan con el consentimiento expreso que EL PRESTADOR otorga al aceptar este Aviso.</p>
<h2>3. Finalidades</h2>
<p><strong>Necesarias para la relación contractual:</strong> verificar la identidad y la documentación de EL PRESTADOR; celebrar y firmar electrónicamente el Contrato y sus Anexos; asignar, dar seguimiento y comprobar los servicios de reparto; calcular la liquidación semanal; validar los CFDI y realizar los pagos; cumplir obligaciones fiscales y legales; atender reclamaciones de clientes o destinatarios; y defender los derechos de ANDERNS ante autoridades o tribunales.</p>
<p><strong>No necesarias:</strong> enviar avisos sobre nuevas zonas, tarifas o programas. EL PRESTADOR puede negarse a estas finalidades sin que ello afecte la relación contractual, escribiendo al correo indicado en el punto 6.</p>
<h2>4. Transferencias</h2>
<p>ANDERNS podrá transferir datos, sin requerir consentimiento adicional cuando la ley lo permita, a: el Servicio de Administración Tributaria (validación de CFDI y obligaciones fiscales); instituciones bancarias (pagos); prestadores de servicios de certificación (constancia NOM-151-SCFI-2016); proveedores tecnológicos que alojan la Plataforma y envían mensajes; aseguradoras; y autoridades competentes cuando así lo requieran. A los clientes y destinatarios solo se comparten el nombre de pila y la ubicación aproximada de EL PRESTADOR durante un servicio en curso.</p>
<h2>5. Conservación</h2>
<p>Los datos se conservan durante la vigencia del Contrato y, después, por el plazo necesario para cumplir obligaciones legales, fiscales y probatorias (al menos cinco años), tras lo cual se bloquean y suprimen.</p>
<h2>6. Derechos ARCO y revocación del consentimiento</h2>
<p>EL PRESTADOR puede acceder, rectificar, cancelar u oponerse al tratamiento de sus datos (derechos ARCO), así como revocar su consentimiento o limitar su uso, mediante solicitud al correo <strong>{{correo_privacidad}}</strong> o en el domicilio de ANDERNS, indicando su nombre, el derecho que ejerce, los datos de que se trate y adjuntando identificación. ANDERNS responderá en los plazos que establezca la ley. La revocación del consentimiento para finalidades necesarias puede impedir continuar con la relación contractual.</p>
<h2>7. Cambios a este Aviso</h2>
<p>Cualquier cambio se publicará en la Plataforma y, cuando la ley lo requiera, se solicitará nuevamente la aceptación de EL PRESTADOR.</p>`;

const TERMINOS = `<h1>TÉRMINOS Y CONDICIONES DE USO DE LA PLATAFORMA PARA PRESTADORES</h1>
${NOTA}
<h2>1. Cuenta</h2>
<p>La cuenta es personal e intransferible. EL PRESTADOR es responsable de resguardar sus credenciales; toda acción realizada con ellas le es atribuible. Ceder o prestar la cuenta es causa de rescisión conforme al Contrato.</p>
<h2>2. Conexión y servicios</h2>
<ul>
<li>EL PRESTADOR decide libremente cuándo conectarse y qué servicios realizar. No existen horarios, turnos ni metas obligatorias, y no conectarse no genera consecuencia alguna.</li>
<li>EL PRESTADOR puede <strong>rechazar cualquier servicio</strong> desde la Plataforma sin penalización.</li>
<li>Las rutas sugeridas por la Plataforma son una herramienta de optimización; EL PRESTADOR conserva la libertad de organizar su recorrido.</li>
</ul>
<h2>3. Recolección y custodia</h2>
<p>Al registrar la recolección o carga de un paquete en la Plataforma, EL PRESTADOR asume su guarda y custodia hasta la entrega, conforme a la cláusula QUINTA del Contrato.</p>
<h2>4. Evidencia de entrega</h2>
<p>Cada entrega se confirma con la evidencia que solicite la Plataforma: fotografía, nombre y firma de quien recibe, identificación cuando aplique, número de serie del equipo entregado o código de confirmación. Las visitas sin entrega se registran en el domicilio del destinatario. La información debe ser veraz; registrar evidencia falsa es causa de rescisión.</p>
<h2>5. Datos de destinatarios</h2>
<p>Los datos de clientes y destinatarios se usan únicamente para realizar la entrega; queda prohibido copiarlos, conservarlos o contactarlos fuera del servicio, conforme a la cláusula OCTAVA del Contrato.</p>
<h2>6. Documentación vigente</h2>
<p>EL PRESTADOR mantiene vigentes y cargados en la Plataforma su identificación, Constancia de Situación Fiscal, datos bancarios, licencia, tarjeta de circulación y póliza de seguro. La Plataforma avisa 15 días antes de un vencimiento; mientras un documento obligatorio esté vencido no se asignan nuevos servicios.</p>
<h2>7. Incidencias operativas</h2>
<p>Las pérdidas, daños o faltantes documentados se registran como incidencias operativas y se aplican en la liquidación conforme al Contrato, con derecho de EL PRESTADOR a aclararlas.</p>
<h2>8. Artículos con marca</h2>
<p>Mochilas, playeras u otros artículos con marca son opcionales, y se ofrecen en comodato o venta.</p>
<h2>9. Cambios</h2>
<p>ANDERNS podrá actualizar estos Términos publicándolos en la Plataforma; las nuevas versiones requieren la aceptación de EL PRESTADOR para seguir usándola.</p>`;

const DEFAULTS = [
  ['anexo_a', 'Anexo A · Tarifario', ANEXO_A],
  ['aviso', 'Aviso de Privacidad Integral', AVISO],
  ['terminos', 'Términos y Condiciones de la Plataforma', TERMINOS],
];
const escH = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fillLegal = (html, vars) => String(html).replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/g, (m, k) => escH(vars[k] ?? '______________'));
module.exports = { DEFAULTS, fillLegal };
