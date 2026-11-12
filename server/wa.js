// WhatsApp vinculado por QR (como WhatsApp Web, en "Dispositivos vinculados") usando Baileys.
// Hasta 3 números del negocio, cada uno con su propia sesión y su QR (líneas 1, 2 y 3).
// Es un cliente NO oficial: úsalo con números dedicados al negocio y volúmenes moderados;
// WhatsApp puede restringir números que envían mensajes masivos a contactos que no los esperan.
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const { DATA_DIR } = require('./db');

const SLOTS = [1, 2, 3];
const MIN_GAP_MS = 4000; // separación mínima entre mensajes de un mismo número (más jitter) para no parecer envío masivo
// la línea 1 conserva la carpeta de siempre para no perder el número ya vinculado
const sessionDir = (slot) => path.join(DATA_DIR, slot === 1 ? 'wa-session' : `wa-session-${slot}`);

let lib = null;
let msgRetryCache = null;
const silentLogger = { level: 'silent', child() { return silentLogger; }, trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {} };
async function load() {
  if (!lib) lib = await import('@whiskeysockets/baileys');
  return lib;
}

function makeSession(slot) {
  const SESSION_DIR = sessionDir(slot);
  const tag = `[WhatsApp ${slot}]`;
  const state = { slot, status: 'desconectado', qr: null, qrAt: null, me: null, error: null, since: null, lastClose: null };
  let sock = null;
  let starting = null;
  let wantRunning = false;
  let retry = 0;
  let lastSend = 0;
  let chain = Promise.resolve();
  const hasSession = () => fs.existsSync(path.join(SESSION_DIR, 'creds.json'));

  async function start() {
    wantRunning = true;
    if (sock || starting) return starting;
    starting = (async () => {
      const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers, makeCacheableSignalKeyStore, isJidBroadcast } = await load();
      const NodeCache = (await import('@cacheable/node-cache')).default;
      msgRetryCache ||= new NodeCache({ stdTTL: 600, useClones: false });
      fs.mkdirSync(SESSION_DIR, { recursive: true });
      const { state: auth, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
      let version;
      try { ({ version } = await fetchLatestBaileysVersion()); } catch {}
      state.status = 'conectando';
      state.error = null;
      // Configuración de escritorio estable (evita "Stream Errored (conflict)" tras vincular):
      // permite la sincronización inicial que espera el teléfono, sin pedir todo el historial.
      const s = makeWASocket({
        auth: { creds: auth.creds, keys: makeCacheableSignalKeyStore(auth.keys, silentLogger) },
        version, logger: silentLogger, printQRInTerminal: false, markOnlineOnConnect: false, syncFullHistory: false,
        browser: Browsers.macOS('Desktop'),
        msgRetryCounterCache: msgRetryCache,
        shouldIgnoreJid: (jid) => isJidBroadcast(jid),
        getMessage: async () => undefined,
      });
      sock = s;
      s.ev.on('creds.update', saveCreds);
      s.ev.on('connection.update', async (u) => {
        if (u.qr) {
          state.status = 'esperando_qr';
          state.qr = await QRCode.toDataURL(u.qr, { margin: 1, width: 300, errorCorrectionLevel: 'M' });
          state.qrAt = Date.now();
        }
        if (u.connection === 'open') {
          console.log(`${tag} conectado`);
          retry = 0;
          state.status = 'conectado';
          state.qr = null;
          state.since = new Date().toISOString();
          const id = s.user?.id || '';
          state.me = { number: '+' + id.split(':')[0].split('@')[0], name: s.user?.name || s.user?.verifiedName || '' };
        }
        if (u.connection === 'close') {
          const err = u.lastDisconnect?.error;
          const code = err?.output?.statusCode;
          const detail = err?.data?.content?.[0]?.attrs?.type || err?.data?.tag || '';
          console.log(`${tag} conexión cerrada: código ${code ?? '-'} ${err?.message || ''} ${detail}`.trim());
          state.lastClose = { code: code ?? null, message: err?.message || null, detail: detail || null, at: new Date().toISOString() };
          sock = null;
          if (code === DisconnectReason.loggedOut) {
            fs.rmSync(SESSION_DIR, { recursive: true, force: true });
            state.me = null;
            state.status = 'desconectado';
            state.error = `WhatsApp cerró la sesión (código ${code}${detail ? ', ' + detail : ''}). Revisa "Dispositivos vinculados" en el teléfono y vuelve a escanear el QR.`;
            wantRunning = false;
            return;
          }
          state.status = 'conectando';
          state.error = u.lastDisconnect?.error?.message || null;
          if (wantRunning) {
            retry++;
            // Sin sesión y sin escanear: no insistir para siempre
            if (!hasSession() && retry > 5) { wantRunning = false; state.status = 'desconectado'; state.qr = null; state.error = 'El QR expiró. Toca "Mostrar QR" de nuevo.'; return; }
            setTimeout(() => start().catch(() => {}), Math.min(30000, 1500 * retry));
          }
        }
      });
    })();
    try { await starting; } catch (e) { sock = null; state.status = 'desconectado'; state.error = e.message; throw e; } finally { starting = null; }
  }

  async function logout() {
    wantRunning = false;
    try { await sock?.logout(); } catch {}
    try { sock?.end?.(); } catch {}
    sock = null;
    fs.rmSync(SESSION_DIR, { recursive: true, force: true });
    Object.assign(state, { status: 'desconectado', qr: null, me: null, error: null, since: null });
  }

  function status() {
    // el QR de WhatsApp caduca en ~20 s y se renueva solo; no exponemos uno viejo
    const qr = state.qr && Date.now() - state.qrAt < 60000 ? state.qr : null;
    return { ...state, qr, has_session: hasSession() };
  }

  /** Envía texto a un teléfono E.164. Serializa los envíos de este número y los espacia para cuidarlo. */
  function sendText(e164, text) {
    const job = chain.then(async () => {
      if (!sock || state.status !== 'conectado') {
        if (hasSession() && !sock) start().catch(() => {});
        throw new Error(`WhatsApp ${slot} no está conectado: vincula el número escaneando el QR en Configuración`);
      }
      const wait = lastSend + MIN_GAP_MS + Math.random() * 2000 - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      const digits = String(e164).replace(/\D/g, '');
      const [r] = (await sock.onWhatsApp(digits)) || [];
      if (!r?.exists) throw new Error(`El número +${digits} no tiene WhatsApp`);
      const sent = await sock.sendMessage(r.jid, { text });
      lastSend = Date.now();
      return { ref: sent?.key?.id };
    });
    chain = job.catch(() => {});
    return job;
  }

  return { start, logout, status, sendText, hasSession };
}

const sessions = new Map(SLOTS.map((n) => [n, makeSession(n)]));
const sl = (slot) => sessions.get(SLOTS.includes(Number(slot)) ? Number(slot) : 1);

// Al arrancar el servidor, reconecta los números que ya estaban vinculados
function boot(enabled) {
  if (!enabled) return;
  for (const s of sessions.values()) if (s.hasSession()) s.start().catch((e) => console.error('WhatsApp', e.message));
}

module.exports = {
  SLOTS,
  start: (slot = 1) => sl(slot).start(),
  logout: (slot = 1) => sl(slot).logout(),
  status: (slot = 1) => sl(slot).status(),
  sendText: (e164, text, slot = 1) => sl(slot).sendText(e164, text),
  boot,
};
