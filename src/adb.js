'use strict';

const { execFile } = require('node:child_process');

const ADB = process.env.ADB_PATH || 'adb';
const TIMEOUT_MS = Number(process.env.ADB_TIMEOUT_MS || 30000);

function run(args, { encoding = 'utf8', timeout = TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    execFile(ADB, args, { encoding, timeout, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        err.message = `adb ${args.join(' ')} failed: ${String(stderr || err.message).trim()}`;
        return reject(err);
      }
      resolve(stdout);
    });
  });
}

// `adb shell` joins its args into one string for the device shell, so any
// user-provided value must be quoted for /system/bin/sh.
function shQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

// `input text` treats %s as a space and cannot take raw spaces.
function encodeInputText(text) {
  return String(text).replace(/%/g, '%%').replace(/ /g, '%s');
}

function shell(serial, command) {
  return run(['-s', serial, 'shell', command]);
}

async function listDevices() {
  const out = await run(['devices', '-l']);
  return out
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [serial, state, ...rest] = line.split(/\s+/);
      const info = Object.fromEntries(
        rest.filter((kv) => kv.includes(':')).map((kv) => kv.split(/:(.*)/s).slice(0, 2)),
      );
      return { serial, state, model: info.model || null };
    });
}

async function screenSize(serial) {
  const out = await shell(serial, 'wm size');
  // "Override size" wins over "Physical size" when present.
  const matches = [...out.matchAll(/(\d+)x(\d+)/g)];
  if (!matches.length) throw new Error(`Cannot read screen size of ${serial}: ${out.trim()}`);
  const [, w, h] = matches[matches.length - 1];
  return { width: Number(w), height: Number(h) };
}

// Google Services Framework ID, needed to register an uncertified (e.g. Redroid
// + GApps) device at https://www.google.com/android/uncertified so Play works.
async function gsfAndroidId(serial) {
  await run(['-s', serial, 'root']);
  const out = await shell(
    serial,
    `sqlite3 /data/data/com.google.android.gsf/databases/gservices.db "select value from main where name = 'android_id';"`,
  );
  const id = out.trim();
  if (!/^\d+$/.test(id)) throw new Error(`GSF ID not found (GApps installed and booted once?): ${id}`);
  return id;
}

module.exports = {
  gsfAndroidId,
  run,
  shell,
  shQuote,
  encodeInputText,
  listDevices,
  screenSize,
  connect: (address) => run(['connect', address]),
  disconnect: (address) => run(['disconnect', address]),
  screencap: (serial) => run(['-s', serial, 'exec-out', 'screencap', '-p'], { encoding: 'buffer' }),
  install: (serial, apkPath) => run(['-s', serial, 'install', '-r', '-g', apkPath], { timeout: 5 * 60 * 1000 }),
};
