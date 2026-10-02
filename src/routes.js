'use strict';

const express = require('express');
const { platformOf, publicChannel, PLATFORMS } = require('./social');
const { buildReport } = require('./report');

const str = (v, field, max = 5000) => {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`${field} is required`);
  if (v.length > max) throw new Error(`${field} is too long`);
  return v.trim();
};

const optionalUrl = (v, field) => {
  if (v === undefined || v === null || v === '') return null;
  const u = new URL(v);
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error(`${field} must be http(s)`);
  return u.href;
};

function createRoutes(store, wrap) {
  const r = express.Router();

  // ---- Device groups ----
  r.get('/groups', (req, res) => res.json({ groups: store.list('groups') }));

  r.post('/groups', wrap(async (req, res) => {
    const serials = [...new Set([].concat(req.body.serials || []).map(String))];
    res.json(store.insert('groups', { name: str(req.body.name, 'name', 100), note: String(req.body.note || ''), serials }));
  }));

  r.put('/groups/:id', wrap(async (req, res) => {
    const patch = {};
    if (req.body.name !== undefined) patch.name = str(req.body.name, 'name', 100);
    if (req.body.note !== undefined) patch.note = String(req.body.note);
    if (req.body.serials !== undefined) patch.serials = [...new Set([].concat(req.body.serials).map(String))];
    res.json(store.update('groups', req.params.id, patch));
  }));

  r.delete('/groups/:id', wrap(async (req, res) => {
    store.remove('groups', req.params.id);
    res.json({ ok: true });
  }));

  // ---- Social channels (official APIs) ----
  r.get('/channels', (req, res) =>
    res.json({ channels: store.list('channels').map(publicChannel), platforms: PLATFORMS }));

  r.post('/channels', wrap(async (req, res) => {
    const platform = req.body.platform;
    if (!PLATFORMS.includes(platform)) throw new Error(`platform must be one of ${PLATFORMS.join(', ')}`);
    const row = store.insert('channels', {
      platform,
      name: str(req.body.name, 'name', 100),
      accountId: platform === 'tiktok' ? 'me' : str(req.body.accountId, 'accountId', 100),
      token: str(req.body.token, 'token', 4000),
    });
    res.json(publicChannel(row));
  }));

  r.delete('/channels/:id', wrap(async (req, res) => {
    store.remove('channels', req.params.id);
    res.json({ ok: true });
  }));

  const channelOr404 = (id) => {
    const ch = store.get('channels', id);
    if (!ch) throw new Error('Channel not found');
    return ch;
  };

  r.get('/channels/:id/posts', wrap(async (req, res) => {
    const ch = channelOr404(req.params.id);
    res.json({ posts: await platformOf(ch).recentPosts(ch, 10) });
  }));

  r.get('/channels/:id/posts/:postId/comments', wrap(async (req, res) => {
    const ch = channelOr404(req.params.id);
    res.json({ comments: await platformOf(ch).comments(ch, req.params.postId) });
  }));

  r.post('/channels/:id/comments/:commentId/reply', wrap(async (req, res) => {
    const ch = channelOr404(req.params.id);
    res.json(await platformOf(ch).reply(ch, req.params.commentId, str(req.body.message, 'message', 8000)));
  }));

  r.get('/channels/:id/report', wrap(async (req, res) => {
    const ch = channelOr404(req.params.id);
    const days = Math.min(30, Math.max(1, Number(req.query.days) || 7));
    const tzOffsetMin = Math.max(-840, Math.min(840, Number(req.query.tz) || 0));
    const posts = await platformOf(ch).recentPosts(ch, 25);
    res.json(buildReport(posts, { days, tzOffsetMin, fetchLimit: 25 }));
  }));

  // ---- Caption templates ----
  r.get('/templates', (req, res) => res.json({ templates: store.list('templates') }));

  r.post('/templates', wrap(async (req, res) => {
    res.json(store.insert('templates', { name: str(req.body.name, 'name', 100), text: str(req.body.text, 'text', 5000) }));
  }));

  r.delete('/templates/:id', wrap(async (req, res) => {
    store.remove('templates', req.params.id);
    res.json({ ok: true });
  }));

  // ---- Post queue ----
  r.get('/posts', (req, res) => {
    const posts = [...store.list('posts')].sort((a, b) => String(b.scheduledAt).localeCompare(String(a.scheduledAt)));
    res.json({ posts });
  });

  // One post per selected channel, so each can succeed or fail on its own.
  r.post('/posts', wrap(async (req, res) => {
    const channelIds = [...new Set([].concat(req.body.channelIds || []))];
    if (!channelIds.length) throw new Error('Select at least one channel');
    channelIds.forEach(channelOr404);
    const when = req.body.scheduledAt ? new Date(req.body.scheduledAt) : new Date();
    if (Number.isNaN(when.getTime())) throw new Error('Invalid scheduledAt');
    const base = {
      text: typeof req.body.text === 'string' ? req.body.text.slice(0, 5000) : '',
      link: optionalUrl(req.body.link, 'link'),
      mediaUrl: optionalUrl(req.body.mediaUrl, 'mediaUrl'),
      privacy: req.body.privacy ? String(req.body.privacy) : null,
      scheduledAt: when.toISOString(),
      status: 'scheduled',
    };
    if (!base.text && !base.link && !base.mediaUrl) throw new Error('Post is empty');
    res.json({ posts: channelIds.map((channelId) => store.insert('posts', { ...base, channelId })) });
  }));

  r.post('/posts/:id/retry', wrap(async (req, res) => {
    const post = store.get('posts', req.params.id);
    if (!post || post.status !== 'failed') throw new Error('Only failed posts can be retried');
    res.json(store.update('posts', post.id, { status: 'scheduled', scheduledAt: new Date().toISOString(), error: null }));
  }));

  r.delete('/posts/:id', wrap(async (req, res) => {
    const post = store.get('posts', req.params.id);
    if (post?.status === 'publishing') throw new Error('Post is being published');
    store.remove('posts', req.params.id);
    res.json({ ok: true });
  }));

  return r;
}

module.exports = { createRoutes };
