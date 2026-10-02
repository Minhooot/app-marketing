'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { Store } = require('../src/store');
const { publishDue, recoverInterrupted } = require('../src/scheduler');
const { createApp } = require('../src/server');

const tmpStore = () => new Store(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'store-')), 'db.json'));

// Replaces global fetch with a router of canned responses and records calls.
function mockFetch(t, routes) {
  const calls = [];
  const real = global.fetch;
  global.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.hostname === '127.0.0.1') return real(input, init);
    const body = init.body instanceof URLSearchParams ? Object.fromEntries(init.body)
      : init.body ? JSON.parse(init.body) : Object.fromEntries(url.searchParams);
    calls.push({ method: init.method || 'GET', host: url.hostname, path: url.pathname, body, headers: init.headers || {} });
    const key = Object.keys(routes).find((k) => url.pathname.endsWith(k));
    const [status, json] = key ? routes[key] : [404, { error: { message: 'no route' } }];
    return new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } });
  };
  t.after(() => { global.fetch = real; });
  return calls;
}

test('store persists to disk with mode 600', () => {
  const s = tmpStore();
  const g = s.insert('groups', { name: 'Team A', serials: ['p1'] });
  const again = new Store(s.file);
  assert.strictEqual(again.get('groups', g.id).name, 'Team A');
  assert.strictEqual(fs.statSync(s.file).mode & 0o777, 0o600);
});

test('facebook: link post goes to /feed, image to /photos', async (t) => {
  const calls = mockFetch(t, { '/feed': [200, { id: 'pg_1' }], '/photos': [200, { id: 'ph', post_id: 'pg_2' }] });
  const s = tmpStore();
  const ch = s.insert('channels', { platform: 'facebook', name: 'Page', accountId: '123', token: 'PAGE_TOKEN' });
  const past = new Date(Date.now() - 1000).toISOString();
  s.insert('posts', { channelId: ch.id, text: 'Hello', link: 'https://shop.vn/', status: 'scheduled', scheduledAt: past });
  s.insert('posts', { channelId: ch.id, text: 'Pic', mediaUrl: 'https://cdn.vn/a.jpg', status: 'scheduled', scheduledAt: past });
  s.insert('posts', { channelId: ch.id, text: 'Later', status: 'scheduled', scheduledAt: new Date(Date.now() + 3600e3).toISOString() });

  assert.strictEqual(await publishDue(s), 2);
  assert.deepStrictEqual(calls.map((c) => [c.method, c.path]), [
    ['POST', '/v24.0/123/feed'],
    ['POST', '/v24.0/123/photos'],
  ]);
  assert.deepStrictEqual(calls[0].body, { message: 'Hello', link: 'https://shop.vn/', access_token: 'PAGE_TOKEN' });
  assert.deepStrictEqual(s.list('posts').map((p) => [p.status, p.remoteId || null]), [
    ['published', 'pg_1'], ['published', 'pg_2'], ['scheduled', null],
  ]);
});

test('instagram: container then media_publish; API error marks post failed', async (t) => {
  const calls = mockFetch(t, { '/media': [200, { id: 'container_1' }], '/media_publish': [200, { id: 'ig_9' }] });
  const s = tmpStore();
  const ch = s.insert('channels', { platform: 'instagram', name: 'IG', accountId: '178', token: 'T' });
  const now = new Date().toISOString();
  s.insert('posts', { channelId: ch.id, text: 'cap', mediaUrl: 'https://cdn.vn/a.jpg', status: 'scheduled', scheduledAt: now });
  s.insert('posts', { channelId: ch.id, text: 'no image', status: 'scheduled', scheduledAt: now });

  await publishDue(s);
  assert.deepStrictEqual(calls.map((c) => c.path), ['/v24.0/178/media', '/v24.0/178/media_publish']);
  assert.strictEqual(calls[1].body.creation_id, 'container_1');
  const [ok, bad] = s.list('posts');
  assert.strictEqual(ok.remoteId, 'ig_9');
  assert.strictEqual(bad.status, 'failed');
  assert.match(bad.error, /image URL/);
});

test('tiktok: checks creator privacy options, defaults to SELF_ONLY', async (t) => {
  const calls = mockFetch(t, {
    '/creator_info/query/': [200, { data: { privacy_level_options: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'] }, error: { code: 'ok' } }],
    '/video/init/': [200, { data: { publish_id: 'v_pub_1' }, error: { code: 'ok' } }],
  });
  const s = tmpStore();
  const ch = s.insert('channels', { platform: 'tiktok', name: 'TT', accountId: 'me', token: 'USER_TOKEN' });
  s.insert('posts', { channelId: ch.id, text: 'clip', mediaUrl: 'https://media.shop.vn/v.mp4', status: 'scheduled', scheduledAt: new Date().toISOString() });

  await publishDue(s);
  assert.strictEqual(calls[1].headers.Authorization, 'Bearer USER_TOKEN');
  assert.deepStrictEqual(calls[1].body, {
    post_info: { title: 'clip', privacy_level: 'SELF_ONLY' },
    source_info: { source: 'PULL_FROM_URL', video_url: 'https://media.shop.vn/v.mp4' },
  });
  assert.strictEqual(s.list('posts')[0].remoteId, 'v_pub_1');
});

test('interrupted publishes become failed, never re-posted', () => {
  const s = tmpStore();
  s.insert('posts', { channelId: 'x', status: 'publishing', scheduledAt: new Date().toISOString() });
  recoverInterrupted(s);
  assert.strictEqual(s.list('posts')[0].status, 'failed');
});

test('HTTP: groups, channels hide tokens, posts fan out per channel, comments reply', async (t) => {
  const calls = mockFetch(t, {
    '/c1/comments': [200, { id: 'r1' }],
    '/comments': [200, { data: [{ id: 'c1', message: 'Giá bao nhiêu?', from: { name: 'An' }, created_time: '2026-10-01T00:00:00+0000' }] }],
  });
  const store = tmpStore();
  const server = createApp({ token: '', store }).listen(0);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());

  const g = await post('/groups', { name: 'Chiến dịch Tết', serials: ['p1', 'p2', 'p1'] });
  assert.deepStrictEqual(g.serials, ['p1', 'p2']);

  const fb = await post('/channels', { platform: 'facebook', name: 'Page', accountId: '1', token: 'SECRET' });
  const ig = await post('/channels', { platform: 'instagram', name: 'IG', accountId: '2', token: 'SECRET' });
  const listed = await fetch(base + '/channels').then((r) => r.json());
  assert.ok(!JSON.stringify(listed).includes('SECRET'));
  assert.ok(listed.channels.every((c) => c.hasToken));

  const created = await post('/posts', { channelIds: [fb.id, ig.id], text: 'Sale 10.10', mediaUrl: 'https://cdn.vn/a.jpg', scheduledAt: '2026-10-10T09:00:00+07:00' });
  assert.strictEqual(created.posts.length, 2);
  assert.strictEqual(created.posts[0].scheduledAt, '2026-10-10T02:00:00.000Z');

  const bad = await post('/posts', { channelIds: [fb.id], text: 'x', link: 'javascript:alert(1)' });
  assert.ok(bad.error);

  const comments = await fetch(`${base}/channels/${fb.id}/posts/post_1/comments`).then((r) => r.json());
  assert.strictEqual(comments.comments[0].author, 'An');
  const reply = await post(`/channels/${fb.id}/comments/c1/reply`, { message: 'Dạ 199k ạ' });
  assert.strictEqual(reply.id, 'r1');
  assert.strictEqual(calls.at(-1).body.message, 'Dạ 199k ạ');
});
