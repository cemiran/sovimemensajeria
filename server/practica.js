// Copia de práctica: misma app con una base aparte (data/practica) en el puerto 3100.
// Sirve para capacitar y probar sin tocar la operación real. Sin WhatsApp, SMS, correo ni Google Sheets reales.
const path = require('path');
process.env.DATA_DIR = path.join(__dirname, '..', 'data', 'practica');
process.env.PORT = process.env.PRACTICA_PORT || '3100';
const fs = require('fs');
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });

const { db } = require('./db');
// Candado: en la copia los canales externos siempre quedan en simulación
const up = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
for (const [k, v] of [['practice_mode', '1'], ['sheets_enabled', '0'], ['sheets_url', ''], ['wa_provider', 'simulacion'], ['sms_provider', 'simulacion'], ['email_provider', 'simulacion']]) up.run(k, v);

const app = require('./index');
require('./notify').start();
// la geolocalización arranca sola con el servidor de producción; en práctica se llama al importar
app.listen(Number(process.env.PORT), () => console.log(`COPIA DE PRÁCTICA en http://localhost:${process.env.PORT} (datos en data/practica)`));
