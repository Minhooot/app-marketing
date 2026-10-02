'use strict';

const adb = require('./adb');

const KEYCODES = { home: 3, back: 4, recents: 187, power: 26, enter: 66, delete: 67, volume_up: 24, volume_down: 25 };
const PACKAGE_RE = /^[a-zA-Z][\w]*(\.[a-zA-Z][\w]*)+$/;

const ADB_KEYBOARD_PKG = 'com.android.adbkeyboard';
const ADB_KEYBOARD_IME = 'com.android.adbkeyboard/.AdbIME';

const sizeCache = new Map();

async function ensureAdbKeyboard(serial) {
  const current = (await adb.shell(serial, 'settings get secure default_input_method')).trim();
  if (current === ADB_KEYBOARD_IME) return;
  const installed = await adb.shell(serial, `pm list packages ${ADB_KEYBOARD_PKG}`);
  if (!installed.includes(`package:${ADB_KEYBOARD_PKG}`)) {
    throw new Error('Gõ có dấu cần cài ADBKeyboard (xem README)');
  }
  await adb.shell(serial, `ime enable ${ADB_KEYBOARD_IME}`);
  await adb.shell(serial, `ime set ${ADB_KEYBOARD_IME}`);
}

async function sizeOf(serial) {
  if (!sizeCache.has(serial)) sizeCache.set(serial, await adb.screenSize(serial));
  return sizeCache.get(serial);
}

function clamp01(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) throw new Error('Coordinates must be numbers');
  return Math.min(1, Math.max(0, v));
}

// Coordinates arrive as fractions (0..1) of the screen so the same gesture
// lands on the same spot on devices with different resolutions.
async function toPixels(serial, x, y) {
  const { width, height } = await sizeOf(serial);
  return [Math.round(clamp01(x) * (width - 1)), Math.round(clamp01(y) * (height - 1))];
}

const handlers = {
  async tap(serial, { x, y }) {
    const [px, py] = await toPixels(serial, x, y);
    return adb.shell(serial, `input tap ${px} ${py}`);
  },

  async swipe(serial, { x1, y1, x2, y2, durationMs = 300 }) {
    const [ax, ay] = await toPixels(serial, x1, y1);
    const [bx, by] = await toPixels(serial, x2, y2);
    const ms = Math.min(10000, Math.max(50, Math.round(Number(durationMs) || 300)));
    return adb.shell(serial, `input swipe ${ax} ${ay} ${bx} ${by} ${ms}`);
  },

  async text(serial, { text }) {
    if (typeof text !== 'string' || !text) throw new Error('text is required');
    if (/^[\x20-\x7e]*$/.test(text)) {
      return adb.shell(serial, `input text ${adb.shQuote(adb.encodeInputText(text))}`);
    }
    // `input text` cannot type Unicode (Vietnamese diacritics, emoji), so
    // route it through the ADBKeyboard IME, which accepts base64 broadcasts.
    await ensureAdbKeyboard(serial);
    const b64 = Buffer.from(text, 'utf8').toString('base64');
    return adb.shell(serial, `am broadcast -a ADB_INPUT_B64 --es msg ${adb.shQuote(b64)}`);
  },

  async key(serial, { key }) {
    const code = KEYCODES[key];
    if (code === undefined) throw new Error(`Unknown key "${key}"`);
    return adb.shell(serial, `input keyevent ${code}`);
  },

  async openUrl(serial, { url }) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error('Invalid URL');
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Only http/https URLs are allowed');
    return adb.shell(serial, `am start -a android.intent.action.VIEW -d ${adb.shQuote(parsed.href)}`);
  },

  async launchApp(serial, { pkg }) {
    if (!PACKAGE_RE.test(pkg || '')) throw new Error('Invalid package name');
    return adb.shell(serial, `monkey -p ${pkg} -c android.intent.category.LAUNCHER 1`);
  },

  async stopApp(serial, { pkg }) {
    if (!PACKAGE_RE.test(pkg || '')) throw new Error('Invalid package name');
    return adb.shell(serial, `am force-stop ${pkg}`);
  },
};

// Runs one action on every selected device in parallel and reports a
// per-device result, so one offline phone never blocks the rest.
async function broadcast(serials, action, params = {}) {
  const handler = handlers[action];
  if (!handler) throw new Error(`Unknown action "${action}"`);
  if (!Array.isArray(serials) || !serials.length) throw new Error('Select at least one device');

  const settled = await Promise.allSettled(serials.map((s) => handler(s, params)));
  return serials.map((serial, i) =>
    settled[i].status === 'fulfilled'
      ? { serial, ok: true }
      : { serial, ok: false, error: settled[i].reason.message },
  );
}

module.exports = { broadcast, handlers, KEYCODES, clearSizeCache: () => sizeCache.clear() };
