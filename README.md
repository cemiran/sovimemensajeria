# Sovime Mensajería — Plataforma de entregas de última milla

App web + móvil (PWA instalable) para mensajería de última milla: despacho, repartidores, inventario con escaneo, clientes finales, evidencia de entrega y optimización de rutas.

## Arranque rápido

Requiere **Node.js 22.13+** (usa SQLite integrado, sin compilar nada).

```bash
npm install
```

```bash
npm run seed
```

```bash
npm start
```

Abre http://localhost:3000

**En operación real desde el 2026-11-05.** Se borraron los datos de demostración; hay un respaldo en `data/respaldos/antes-de-iniciar_2026-11-05_2126/`.

- La cuenta inicial es `admin@demo.com`. Al entrar por primera vez pide crear una contraseña nueva; luego cambia el correo en *Usuarios*.
- `npm run seed` solo carga datos de demostración en una base vacía.
- `npm run seed:reset` está **bloqueado** en esta base. Para borrar datos reales exige `-- --borrar-datos-reales`.
- **Respaldo**: copia la carpeta `data/` (base, fotos, firmas, sesión de WhatsApp) a diario.

### Logotipo

El logotipo oficial está en **`public/img/logo.png`** (recortado y con fondo transparente a partir del original).
Los íconos de la app instalada (`public/img/icon-*.png`, `apple-touch-icon.png`, `favicon-64.png`) usan la "S" azul con el subrayado naranja de la marca.
Para cambiarlo, reemplaza `public/img/logo.png`. Si el archivo no existe, la app muestra una versión tipográfica del logotipo.

## Administración y usuarios

**Roles**
| | Administrador | Despachador | Repartidor |
|---|:-:|:-:|:-:|
| Tablero, pedidos, rutas, mapa en vivo | ✓ | ✓ | |
| Inventario y clientes | ✓ | ✓ | |
| Análisis | ✓ | ✓ | |
| Usuarios, actividad y configuración | ✓ | | |
| Su ruta, carga y entregas (móvil) | | | ✓ |

**Usuarios (solo administrador)**
- Alta con selector visual de rol; datos del vehículo y capacidad solo para repartidores.
- Contraseña temporal generada automáticamente (recomendado) o definida por el administrador. Se muestra una sola vez, con botón para copiar el mensaje de bienvenida.
- **Importación masiva** desde CSV o pegando desde Excel (`nombre, correo, rol, telefono, vehiculo, capacidad`), con descarga de las credenciales generadas.
- Búsqueda, filtros por rol y estado, paginación; tabla en web y tarjetas en móvil.
- Ficha de cada usuario: último acceso, entregas, % de éxito y actividad reciente.
- Seguridad: restablecer contraseña, cerrar todas sus sesiones (p. ej. teléfono perdido), desactivar/reactivar y eliminar (solo si nunca operó; si tiene historial se desactiva).
- Protecciones: el administrador no puede desactivarse ni quitarse el rol a sí mismo, y siempre debe quedar al menos un administrador activo.

**Mi perfil (todos los usuarios)**: editar nombre y teléfono, cambiar contraseña (con medidor de seguridad), tema claro/oscuro/automático, instalar la app y cerrar sesión.

**Primer acceso**: quien recibe una contraseña temporal debe crear la suya antes de entrar.

**Actividad**: bitácora de accesos, altas, cambios de rol, restablecimientos, cancelaciones y cambios de configuración, con búsqueda.

Al cambiar la contraseña, el rol o desactivar a alguien, sus sesiones abiertas se cierran de inmediato.

## Módulos

**Despacho (web: admin / despachador)**
- **Tablero**: KPIs del día, mapa con todas las rutas y repartidores, avance por repartidor, alertas de stock bajo.
- **Pedidos**: alta con cliente + productos (búsqueda o escaneo), prioridad, cobro contra entrega, guía automática o la que ya trae el paquete. Etiqueta imprimible con código de barras Code128. Detalle con evidencias (foto, firma, GPS, distancia al domicilio). Cancelar (regresa stock) y reprogramar.
- **Rutas**:
  - *Auto-planificar*: reparte todos los pendientes entre los repartidores elegidos por zonas (barrido angular desde el almacén, balanceado por capacidad del vehículo) y optimiza la secuencia de cada ruta.
  - *Ruta manual*: eliges pedidos y repartidor; se optimiza igual.
  - Optimización: vecino más cercano + 2-opt + Or-opt, urgentes primero, ventanas horarias del cliente con penalización por llegar tarde. Calcula ETA por parada, km, duración y % de ahorro contra el orden sin optimizar.
  - Detalle: mapa, reasignar repartidor, quitar paradas, re-optimizar, abrir en Google Maps.
- **Mapa en vivo**: posición GPS de cada repartidor (se actualiza cada 20 s).
- **Inventario**: productos con SKU / código de barras / ubicación / mínimo. Entradas, salidas, ajustes y devoluciones **por escaneo continuo** (cámara o lector USB/Bluetooth). Kardex de movimientos. Códigos no registrados ofrecen alta inmediata. Los pedidos descuentan stock y las cancelaciones lo regresan.
- **Clientes**: registro de cliente final con ubicación exacta (geocodificación, clic en mapa o GPS del teléfono), referencias, ventana de recepción e historial de pedidos.
- **Análisis**: tasa de éxito, entregas a tiempo, km y km/parada, ahorro por optimización, entregas por día, desempeño por repartidor (entregas/hora, km/entrega, desviación GPS), motivos de fallo, éxito por código postal.
- **Configuración** (almacén, velocidad promedio, tiempo por parada, factor de calle, hora de salida).

**Repartidor (móvil)**
- **Mi ruta**: paradas en orden con ETA, mapa, navegación (Google Maps), llamada y WhatsApp al cliente, re-optimizar desde la posición actual.
- **Cargar**: escaneo de paquetes al subirlos al vehículo; avisa si un paquete no es de su ruta.
- **Entregar**: verificación por escaneo, nombre y relación de quien recibe, foto (con sello de fecha y hora), firma en pantalla, GPS automático y comentarios. **No entregado**: motivo + foto.
- **Sin señal**: las evidencias se guardan en el teléfono y se envían solas al recuperar conexión.
- Registro de nuevos clientes en campo e historial.

Para instalar en el teléfono: abrir la URL en Chrome/Safari → "Agregar a pantalla de inicio". La cámara y el GPS **requieren HTTPS** (excepto en `localhost`).

## Recepción del cliente (evidencia de firma y fotografía)

- **En ruta**: el repartidor registra la recepción con nombre, relación e identificación de quien recibe, **firma en pantalla** y **fotografía** (con fecha y hora impresas), más su GPS y la distancia al domicilio.
- **En mostrador**: en *Recepciones → Recepción en mostrador*, el despacho escanea o escribe la guía y registra la entrega al cliente que pasa por su paquete, con firma y foto. En computadora se puede usar la cámara web.
- **Firma y foto obligatorias**: se configuran en *Configuración → Entrega y evidencia* (activadas por defecto). El servidor también las exige.
- **Recepciones**: galería de todas las entregas con foto y firma, con filtros por fecha, tipo y resultado. Cada una tiene **comprobante imprimible**, enlace para el cliente y botón para enviarlo por WhatsApp.

## Rastreo GPS y navegación del repartidor

- El teléfono del repartidor envía su posición cada 20 s, o cada 10 s mientras navega. La barra superior muestra el estado del GPS.
- **Navegar** (desde *Mi ruta* o cada parada) abre un mapa en vivo con tu posición, el camino por calles, distancia, hora de llegada e **indicaciones paso a paso** en español.
  - Avisa al llegar al domicilio.
  - Mantiene la pantalla encendida.
  - Tiene accesos directos a Google Maps y Waze.
- El trazado por calles usa OSRM (`router.project-osrm.org` por defecto, servidor público de demostración). Para producción usa un servidor OSRM propio, o deja el campo vacío para usar línea recta.
- **Mapa en vivo** (despacho): posición de cada repartidor; al tocar uno se ve su **recorrido GPS del día**, los km recorridos y sus paradas.
- Limitación de las apps web: el GPS se envía mientras la app esté abierta en pantalla. Si el repartidor la cierra o bloquea el teléfono, se reanuda al volver.

## Avisos al cliente: SMS, WhatsApp y correo

| Momento | Cuándo se envía |
|---|---|
| Pedido registrado | Al dar de alta el pedido |
| En camino | Al escanear el paquete al cargar el vehículo |
| Repartidor cerca | Cuando el repartidor inicia la navegación hacia esa parada o entrega la parada anterior (una sola vez) |
| Entregado | Al registrar la recepción, con enlace al comprobante con firma y foto |
| No entregado | Al registrar un intento fallido, con el motivo |

- En *Configuración → Notificaciones* eliges qué aviso sale por cada canal y editas los textos (variables `{cliente}`, `{guia}`, `{eta}`, `{link}`…).
- Cada cliente puede desactivar canales en su ficha. El despacho puede reenviar un aviso desde el detalle del pedido.
- **Proveedores**:
  - SMS: **Twilio**.
  - WhatsApp: **WhatsApp Cloud API (Meta)** o **Twilio WhatsApp**. Meta solo permite texto libre si el cliente escribió en las últimas 24 h; para avisos fuera de esa ventana necesitas plantillas aprobadas.
  - Correo: **SMTP** (Gmail con clave de aplicación, Outlook, servidor propio). El correo lleva el logotipo y un botón "Ver mi envío".
- **WhatsApp con tu propio número (QR)**: en *Configuración → Notificaciones* elige "Mi número de WhatsApp (QR)", toca **Mostrar QR** y escanéalo desde WhatsApp → *Dispositivos vinculados*.
  - La sesión se guarda en `data/wa-session` y se reconecta sola al reiniciar.
  - Los mensajes salen espaciados (4–6 s) y solo a números que tienen WhatsApp.
  - Es una conexión **no oficial**, como WhatsApp Web, hecha con Baileys. Usa un número dedicado al negocio y volúmenes moderados.
- **SMS desde tu teléfono Android**: instala *SMS Gateway for Android* (la app muestra un QR para descargarla) y activa *Cloud server*. Copia el usuario y la contraseña de la app en la configuración. Los SMS salen del chip del teléfono.
- **Modo de prueba**: mientras haya un teléfono o correo de prueba configurado, ningún cliente recibe mensajes. Todos los avisos llegan a esos datos con la nota "[PRUEBA · era para …]". Bórralos para avisar a clientes reales.
- Sin credenciales, cada canal trabaja en **modo simulación**: el mensaje queda registrado en *Mensajes* pero no sale.
- Los envíos pasan por una cola con reintentos automáticos (hasta 4). Las credenciales solo las ve el administrador, enmascaradas.
- Cada aviso incluye el enlace **/t/…**, una página pública para el cliente. Muestra:
  - el estado del envío
  - la hora estimada y cuántas entregas faltan antes de la suya
  - la ubicación del repartidor en el mapa
  - al entregarse, el comprobante con firma y foto

  El enlace usa un código aleatorio y no muestra teléfono ni datos de otros clientes. Configura la **URL pública** (https) para que los enlaces funcionen fuera de tu red.

## Registro de entregas en Google Sheets

Cada entrega o intento fallido agrega **una fila en línea** a una hoja de Google con:
- fecha, guía, resultado y tipo
- cliente, teléfono y dirección
- quién recibió, parentesco e identificación
- motivo, repartidor y ruta
- GPS y distancia al domicilio
- cobro y comentarios
- enlaces a la foto, la firma y el comprobante

Para conectarla, en *Configuración → Google Sheets* (la app trae el script listo para copiar):
1. Crea una hoja en sheets.new.
2. *Extensiones → Apps Script*: pega el script que da la app. Toca **Generar** antes para crear la clave compartida.
3. *Implementar → Nueva implementación → Aplicación web*. Ejecutar como: **Yo**. Acceso: **Cualquier persona**.
4. Pega la URL `/exec` en la app, activa el interruptor y usa **Enviar fila de prueba**.

Si Google no responde, las filas quedan en cola y se reintentan. Con **Enviar también entregas anteriores** subes el historial.

## Escáner de códigos: cámara, lector o manual

Todos los escaneos de la app (carga al vehículo, verificar paquete, inventario, buscar guía, mostrador, alta de productos) abren el mismo escáner con tres modos. El elegido se recuerda en cada dispositivo:

- **Cámara**: lectura en vivo con la cámara trasera del teléfono.
  - Lee QR, EAN-13/8, UPC, Code 128/39/93, ITF, Codabar, Data Matrix y PDF417.
  - Si hay varias cámaras, puedes elegir cuál; si el teléfono tiene linterna, aparece un botón para encenderla.
  - La cámara en vivo **requiere https** (o `localhost`). Si la app se abre por la red local con http, o si no hay permiso de cámara, aparece **"Tomar foto del código"**: la cámara del teléfono toma la foto y la app la lee.
- **Lector**: pistolas USB o Bluetooth en modo teclado (HID).
  - Queda escuchando sin tocar nada y no abre el teclado en pantalla.
  - Acepta lectores que envían Enter o Tab al final, y también los que no envían nada (detecta la ráfaga de teclas).
  - Distingue el tecleo humano, que es lento.
- **Escribir**: registro manual del código, SKU o guía, con opción de teclado numérico.

Cada lectura da aviso con sonido, vibración y color. En modo continuo queda una lista con lo leído y por qué medio.

## Cumplimiento y prácticas para empresas médicas

Menú *Calidad → Cumplimiento* (administrador y despacho):

- **Unidades**:
  - Nombre, placas, tipo, marca, modelo y año.
  - **Seguro**: aseguradora, póliza, vigencia y documento.
  - **Tarjeta de circulación**.
  - **Certificado de fumigación**: fecha, vigencia, proveedor, folio y documento.
  - Unidad **rotulada**.
  - **Refrigerada**: rango de temperatura, termómetro o registrador y su calibración.
  - Repartidor habitual.

  Los documentos pueden ser foto o PDF. La vigencia se marca como *vigente*, *por vencer* (30 días) o *vencido*.
- **Recurso confiable**: folio, emisor, vigencia y documento del certificado de cada colaborador, más sus capacitaciones.
- **Checklist de unidad** (lo llena el repartidor antes de salir, desde *Mi ruta*):
  - Combustible, limpieza y desinfección, revisión mecánica, llantas, EPP, botiquín y extintor, documentos a bordo, caja de carga sin plagas ni químicos, termómetro, contenedores y rotulación.
  - También kilometraje, temperatura de la caja (obligatoria si es refrigerada), foto y firma.
  - Si un punto crítico no se cumple, exige comentario.
  - Opcionalmente es **obligatorio para poder cargar**.
- **Pedido**: tipo de envío (general, medicamento, muestra biológica, dispositivo médico, refrigerado), rango de temperatura (2–8 °C, 15–25 °C, ≤ −15 °C u otro) y sello o precinto.
- **Rubro de cumplimiento en la entrega**:
  - Se llena temperatura al entregar (con aviso si está fuera de rango), sello y empaque íntegros.
  - Es opcional en envíos generales y obligatorio en médicos con rango o sello.
  - Si hay incidencia, exige describirla.
  - Se guarda automáticamente la unidad (placas, seguro, fumigación), el checklist del día y el recurso confiable del repartidor.
  - Aparece en el comprobante, en la página del cliente (placas parciales) y en Google Sheets, en las columnas *Tipo de envío*, *Temperatura (°C)*, *En rango*, *Sello / precinto*, *Unidad (placas)*, *Checklist de unidad* y *Recurso confiable*.
- **Prácticas médicas**: cadena de frío, registro de temperatura, manejo de desviaciones, triple embalaje UN3373, precintos, separación de productos, limpieza, control de plagas, capacitación, recurso confiable, trazabilidad y cadena de custodia. Las que se marcan aparecen en el certificado.
- **Certificado de la empresa** (administrador):
  - Es un *Certificado de Cumplimiento Operativo* con folio (`SOV-AAAA-0001`), vigencia configurable y datos de la empresa (razón social, RFC, domicilio, responsable, licencia sanitaria).
  - Incluye unidades, personal, checklists, indicadores de cadena de frío y prácticas.
  - Se imprime o se guarda en PDF.
  - Su **QR** abre `/c/<código>` para que el cliente verifique si está **vigente, vencido o revocado**, sin datos personales.
  - Es una **autodeclaración** basada en los registros de la empresa y lo indica en el documento.

## Control por número de serie (módems y equipos)

1. En *Inventario*, abre el producto y activa **Controlar por número de serie**.
2. **Recibir equipos** (*Números de serie → Recibir equipos*): escanea el S/N de cada caja o pega una lista desde Excel. Cada serie suma 1 a la existencia y queda "En almacén". Se rechazan duplicados y formatos no válidos; el prefijo "S/N:" se quita solo.
3. **Asignar al pedido**: un pedido con equipos de serie no se puede cargar ni entregar hasta tener todos sus S/N.
   - El repartidor los escanea al cargar: la app se los pide en el mismo escáner. También se pueden escanear desde el detalle del pedido o en mostrador.
   - Si el S/N no estaba registrado (existencia anterior al control por serie), se registra al asignarlo.
4. **Cargar por S/N**: al cargar el vehículo se puede escanear la guía o el número de serie del equipo.
5. **Entrega**: los S/N quedan como "Entregado". Aparecen en el comprobante, en la página del cliente, en Recepciones y en la columna **Números de serie** de Google Sheets.
6. **Historial por equipo**: recibido → asignado → entregado, con fecha y usuario. Acciones:
   - **Devolución del cliente**: el equipo vuelve al almacén.
   - **Baja**: dañado o extraviado, con motivo.
   - **Reingreso**.

   Si se cancela el pedido, sus series vuelven a quedar disponibles.

## Importación masiva de inventario (Excel, CSV o Google Sheets)

En *Inventario → Importar Excel / Sheets*:

1. **Origen**:
   - Archivo `.xlsx`, `.xls`, `.ods` o `.csv`. Si el libro tiene varias hojas, eliges cuál.
   - Enlace de Google Sheets. La hoja debe estar en *Compartir → Cualquier persona con el enlace → Lector*; el enlace se recuerda para volver a sincronizar.
   - Celdas pegadas desde Excel.

   Hay una **plantilla** descargable.
2. **Columnas**: se reconocen solas (SKU/clave, código de barras, nombre, descripción, unidad, existencia, mínimo, ubicación, peso) y puedes ajustarlas. Los encabezados pueden estar en cualquiera de las primeras filas.
3. **Existencias**:
   - *Reemplazar*: conteo físico; registra un ajuste por la diferencia.
   - *Sumar*: llegada de mercancía; registra una entrada.
   - *No tocar*: solo actualiza el catálogo.
4. **Vista previa exacta, sin guardar**: nuevos, a actualizar, sin cambios y errores, con la existencia antes y después. Se marcan como error:
   - productos nuevos sin nombre
   - cantidades no numéricas o negativas
   - filas repetidas en el archivo
   - códigos de barras que ya pertenecen a otro SKU
5. **Importar**: se aplica todo en una transacción. Las filas con error se omiten. Cada cambio de existencia queda en el kárdex con la referencia de la importación y en *Actividad*.

Los productos se identifican por SKU o, si no hay SKU, por código de barras. Máximo 5,000 filas por importación.

## Arquitectura

```
server/
  index.js    API REST (Express) + archivos estáticos
  db.js       Esquema SQLite (WAL) e índices
  routing.js  Motor de optimización y reparto de rutas
  notify.js   Avisos SMS / WhatsApp / correo y registro en Google Sheets (cola con reintentos)
  seed.js     Datos de demostración
public/       SPA sin build; track.html = página pública de rastreo y comprobante; (Leaflet, html5-qrcode, JsBarcode por CDN), PWA + service worker
data/         Base de datos, secreto JWT y fotos/firmas (se crea sola)
```

- Autenticación JWT (12 h) con revocación de sesiones, contraseñas con bcrypt, roles `admin` / `despachador` / `repartidor`. Cada repartidor solo ve sus pedidos.
- Rastreo público sin datos personales: `GET /api/public/track/:guia`.

## Escalar a más de 100 usuarios

La configuración incluida (un proceso Node + SQLite en modo WAL, paginación e índices) aguanta sin problema 100–300 usuarios concurrentes con este tipo de carga (lecturas frecuentes, escrituras cortas). Para producción:

1. **HTTPS obligatorio** (Nginx / Caddy delante) para cámara y GPS en móviles.
2. Variables de entorno: `PORT`, `JWT_SECRET` (fija y larga), `DATA_DIR` (disco persistente con respaldo diario).
3. Más allá de ~300 concurrentes o varias instancias: migrar `db.js` a **PostgreSQL** (el SQL es estándar), fotos a **S3/almacenamiento de objetos**, y correr varias instancias detrás del balanceador (`pm2 -i max`).
4. Ruteo con distancias reales por calle: sustituir Haversine × factor por una matriz de **OSRM** u otro servicio de ruteo en `routing.js` (función `buildMatrix`).
5. Las fotos de evidencia se sirven en `/uploads` con nombres aleatorios no adivinables; si necesitas control de acceso estricto, sírvelas mediante un endpoint autenticado o URLs firmadas.
