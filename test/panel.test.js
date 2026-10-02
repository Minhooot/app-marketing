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
