// Restablece la contraseña de un administrador desde el servidor (por si se olvidó).
// Uso en producción:  docker exec -it sovime node server/restablecer-admin.js
// La contraseña se escribe a mano y no se muestra en pantalla ni queda en el historial.
// Cierra las sesiones abiertas de esa cuenta.
const bcrypt = require('bcryptjs');
const { db } = require('./db');

const lines = [];
let waiting = null;
let buf = '';
const tty = process.stdin.isTTY;
if (tty) process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');
let hidden = false;
process.stdin.on('data', (ch) => {
  for (const c of ch) {
    if (c === '\u0003') { process.stdout.write('\nCancelado.\n'); process.exit(1); }
    if (c === '\r' || c === '\n') {
      if (tty) process.stdout.write('\n');
      lines.push(buf); buf = '';
      if (waiting) { const w = waiting; waiting = null; w(lines.shift()); }
    } else if (c === '\u007f' || c === '\b') {
      if (buf) { buf = buf.slice(0, -1); if (tty && !hidden) process.stdout.write('\b \b'); }
    } else {
      buf += c;
      if (tty) process.stdout.write(hidden ? '' : c);
    }
  }
});
process.stdin.on('end', () => { if (waiting) { waiting(null); } });
const ask = (q, hide = false) => {
  process.stdout.write(q);
  hidden = hide;
  return new Promise((r) => (lines.length ? r(lines.shift()) : (waiting = r)));
};

(async () => {
  const admins = db.prepare("SELECT id, name, email, active FROM users WHERE role='admin' ORDER BY id").all();
  if (!admins.length) { console.log('No hay administradores.'); process.exit(1); }
  console.log('\nAdministradores registrados:');
  admins.forEach((a) => console.log(`  - ${a.email}  (${a.name})${a.active ? '' : '  [desactivado]'}`));
  const email = String((await ask('\nCorreo del administrador: ')) || '').trim();
  const u = admins.find((a) => a.email.toLowerCase() === email.toLowerCase());
  if (!u) { console.log('Ese correo no es de un administrador. No se cambió nada.'); process.exit(1); }
  const p1 = await ask('Nueva contraseña (no se ve al escribir, mínimo 8): ', true);
  if (!p1 || p1.length < 8) { console.log('Debe tener al menos 8 caracteres. No se cambió nada.'); process.exit(1); }
  const p2 = await ask('Escríbela otra vez: ', true);
  if (p1 !== p2) { console.log('No coinciden. No se cambió nada.'); process.exit(1); }
  db.prepare('UPDATE users SET password_hash=?, must_change_password=0, active=1, token_version=token_version+1 WHERE id=?').run(bcrypt.hashSync(p1, 10), u.id);
  db.prepare('INSERT INTO audit_log (user_id, action, detail) VALUES (?, ?, ?)').run(u.id, 'usuario.reset', 'Contraseña restablecida desde el servidor');
  console.log(`\nListo: ${u.email} ya puede entrar con la nueva contraseña. Sus sesiones abiertas se cerraron.\n`);
  process.exit(0);
})();
