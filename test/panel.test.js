'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const LOG = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fake-adb-')), 'calls.log');
const FAKE = path.join(__dirname, 'fake-adb.js');
fs.chmodSync(FAKE, 0o755);
process.env.ADB_PATH = FAKE;
process.env.FAKE_ADB_LOG = LOG;
process.env.DB_FILE = path.join(path.dirname(LOG), 'db.json');

const adb = require('../src/adb');
const { broadcast, clearSizeCache } = require('../src/actions');
const { createApp } = require('../src/server');

function calls() {
  if (!fs.existsSync(LOG)) return [];
  return fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

test.beforeEach(() => {
  fs.rmSync(LOG, { force: true });
  clearSizeCache();
});

test('listDevices parses serial, state and model', async () => {
  assert.deepStrictEqual(await adb.listDevices(), [
    { serial: '127.0.0.1:5555', state: 'device', model: 'redroid12' },
    { serial: 'emulator-5554', state: 'offline', model: null },
  ]);
});

test('tap is scaled to each device resolution, override size wins', async () => {
  const results = await broadcast(['p1', 'big-phone'], 'tap', { x: 0.5, y: 0.5 });
  assert.ok(results.every((r) => r.ok));
  const taps = calls().filter((c) => c[3].startsWith('input tap')).map((c) => [c[1], c[3]]);
  assert.deepStrictEqual(taps.sort(), [
    ['big-phone', 'input tap 540 960'],
    ['p1', 'input tap 360 640'],
  ]);
});

test('one offline device does not fail the others', async () => {
  const results = await broadcast(['p1', 'offline-phone'], 'key', { key: 'home' });
  assert.deepStrictEqual(results.map((r) => r.ok), [true, false]);
  assert.match(results[1].error, /not found/);
});

test('text and url are shell-quoted', async () => {
  await broadcast(['p1'], 'text', { text: "hi there'; reboot" });
  await broadcast(['p1'], 'openUrl', { url: "https://example.com/?q=a'b" });
  const shellCmds = calls().map((c) => c[3]);
  assert.ok(shellCmds.includes("input text 'hi%sthere'\\'';%sreboot'"));
  assert.ok(shellCmds.includes("am start -a android.intent.action.VIEW -d 'https://example.com/?q=a%27b'"));
});

test('rejects invalid input before reaching adb', async () => {
  for (const [action, params] of [
    ['openUrl', { url: 'javascript:alert(1)' }],
    ['launchApp', { pkg: 'com.x; reboot' }],
    ['key', { key: 'nope' }],
  ]) {
    const [r] = await broadcast(['p1'], action, params);
    assert.strictEqual(r.ok, false);
  }
  assert.deepStrictEqual(calls(), []);
  await assert.rejects(broadcast([], 'tap', { x: 0, y: 0 }), /Select at least one/);
});

test('HTTP API: token, broadcast and install', async (t) => {
  const server = createApp({ token: 'secret' }).listen(0);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  assert.strictEqual((await fetch(`${base}/api/devices`)).status, 401);

  const H = { 'x-panel-token': 'secret', 'content-type': 'application/json' };
  const res = await fetch(`${base}/api/broadcast`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ serials: ['p1', 'p2'], action: 'launchApp', params: { pkg: 'com.android.chrome' } }),
  });
  assert.deepStrictEqual((await res.json()).results, [{ serial: 'p1', ok: true }, { serial: 'p2', ok: true }]);

  const inst = await fetch(`${base}/api/install?serials=p1,p2`, {
    method: 'POST', headers: { 'x-panel-token': 'secret', 'content-type': 'application/octet-stream' },
    body: Buffer.from('PK fake apk'),
  });
  assert.ok((await inst.json()).results.every((r) => r.ok));
  const installs = calls().filter((c) => c[2] === 'install');
  assert.strictEqual(installs.length, 2);
  assert.ok(!fs.existsSync(installs[0][5]), 'temp APK is deleted after install');

  const png = await fetch(`${base}/api/devices/p1/screen.png?token=secret`);
  assert.strictEqual(png.headers.get('content-type'), 'image/png');
});

test('reads GSF Android ID for Play Store registration', async () => {
  assert.strictEqual(await adb.gsfAndroidId('p1'), '3912345678901234567');
  assert.deepStrictEqual(calls()[0], ['-s', 'p1', 'root']);
});

test('expandAddresses turns port ranges into addresses', () => {
  const list = adb.expandAddresses('127.0.0.1:5555-5574, 10.0.0.2:5555');
  assert.strictEqual(list.length, 21);
  assert.strictEqual(list[0], '127.0.0.1:5555');
  assert.strictEqual(list[19], '127.0.0.1:5574');
  assert.strictEqual(list[20], '10.0.0.2:5555');
  assert.deepStrictEqual(adb.expandAddresses(''), []);
  assert.throws(() => adb.expandAddresses('127.0.0.1:5574-5555'), /Invalid port range/);
});

test('Vietnamese text goes through ADBKeyboard, enabling it when needed', async () => {
  await broadcast(['p1'], 'text', { text: 'Xin chào' });
  const shellCmds = calls().map((c) => c[3]);
  assert.deepStrictEqual(shellCmds.slice(-3), [
    'ime enable com.android.adbkeyboard/.AdbIME',
    'ime set com.android.adbkeyboard/.AdbIME',
    `am broadcast -a ADB_INPUT_B64 --es msg '${Buffer.from('Xin chào').toString('base64')}'`,
  ]);

  fs.rmSync(LOG, { force: true });
  await broadcast(['kb-active'], 'text', { text: 'Đẹp' });
  assert.ok(!calls().some((c) => c[3].startsWith('ime ')), 'no IME switch when already active');

  const [r] = await broadcast(['no-kb'], 'text', { text: 'Đẹp' });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /ADBKeyboard/);
});
