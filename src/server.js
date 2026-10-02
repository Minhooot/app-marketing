'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const adb = require('./adb');
const { broadcast, KEYCODES } = require('./actions');
const { Store } = require('./store');
const { createRoutes } = require('./routes');
const { startScheduler } = require('./scheduler');

function createApp({ token = process.env.PANEL_TOKEN, store = new Store() } = {}) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // Optional shared secret; required whenever the panel is reachable beyond localhost.
  app.use('/api', (req, res, next) => {
    if (!token) return next();
    const given = req.get('x-panel-token') || req.query.token || '';
    const a = Buffer.from(String(given));
    const b = Buffer.from(token);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return next();
    res.status(401).json({ error: 'Unauthorized' });
  });

  const wrap = (fn) => (req, res) =>
    fn(req, res).catch((err) => res.status(400).json({ error: err.message }));

  app.get('/api/devices', wrap(async (req, res) => {
    res.json({ devices: await adb.listDevices(), keys: Object.keys(KEYCODES) });
  }));

  app.post('/api/devices/connect', wrap(async (req, res) => {
    const addresses = [].concat(req.body.addresses || []);
    const results = await Promise.allSettled(addresses.map((a) => adb.connect(String(a))));
    res.json({
      results: addresses.map((address, i) => ({
        address,
        ok: results[i].status === 'fulfilled' && !/fail|cannot|unable/i.test(results[i].value),
        message: results[i].status === 'fulfilled' ? results[i].value.trim() : results[i].reason.message,
      })),
    });
  }));

  app.get('/api/devices/:serial/screen.png', wrap(async (req, res) => {
    const png = await adb.screencap(req.params.serial);
    res.set('Cache-Control', 'no-store').type('png').send(png);
  }));

  app.get('/api/devices/:serial/gsf-id', wrap(async (req, res) => {
    res.json({ serial: req.params.serial, gsfId: await adb.gsfAndroidId(req.params.serial) });
  }));

  app.post('/api/broadcast', wrap(async (req, res) => {
    const { serials, action, params } = req.body;
    res.json({ results: await broadcast(serials, action, params) });
  }));

  // APK upload: raw body, serial list in the query string (?serials=a,b).
  app.post(
    '/api/install',
    express.raw({ type: '*/*', limit: '500mb' }),
    wrap(async (req, res) => {
      const serials = String(req.query.serials || '').split(',').filter(Boolean);
      if (!serials.length) throw new Error('Select at least one device');
      if (!req.body?.length) throw new Error('Empty APK upload');
      const tmp = path.join(os.tmpdir(), `upload-${crypto.randomUUID()}.apk`);
      fs.writeFileSync(tmp, req.body);
      try {
        const settled = await Promise.allSettled(serials.map((s) => adb.install(s, tmp)));
        res.json({
          results: serials.map((serial, i) =>
            settled[i].status === 'fulfilled' && /Success/.test(settled[i].value)
              ? { serial, ok: true }
              : { serial, ok: false, error: settled[i].reason?.message || settled[i].value.trim() },
          ),
        });
      } finally {
        fs.rmSync(tmp, { force: true });
      }
    }),
  );

  app.use('/api', createRoutes(store, wrap));

  app.use(express.static(path.join(__dirname, '..', 'public')));
  return app;
}

if (require.main === module) {
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT || 8080);
  if (host !== '127.0.0.1' && host !== 'localhost' && !process.env.PANEL_TOKEN) {
    console.error('Refusing to listen on a public interface without PANEL_TOKEN set.');
    process.exit(1);
  }
  if (process.argv.includes('--demo')) process.env.DEMO = '1';
  if (process.env.DEMO === '1') {
    require('./demo').enableDemo();
    console.log('DEMO mode: Meta/TikTok calls return sample data, nothing is posted for real.');
  }
  const store = new Store();
  startScheduler(store);

  // ADB_CONNECT=127.0.0.1:5555-5574 keeps every phone connected, including
  // after a container restart (adb drops the connection when it goes away).
  const autoConnect = adb.expandAddresses(process.env.ADB_CONNECT);
  if (autoConnect.length) {
    const connectAll = () => Promise.allSettled(autoConnect.map((a) => adb.connect(a)));
    connectAll().then(() => console.log(`Auto-connect: ${autoConnect.length} addresses`));
    setInterval(connectAll, 60000).unref();
  }
  createApp({ store }).listen(port, host, () => console.log(`Phone farm panel: http://${host}:${port}`));
}

module.exports = { createApp };
