'use strict';

const { platformOf } = require('./social');

// Publishes due posts. A post is marked "publishing" before the API call so a
// slow request is never picked up twice by the next tick.
async function publishDue(store, now = new Date()) {
  const due = store
    .list('posts')
    .filter((p) => p.status === 'scheduled' && new Date(p.scheduledAt) <= now);

  for (const post of due) {
    store.update('posts', post.id, { status: 'publishing' });
    const channel = store.get('channels', post.channelId);
    try {
      if (!channel) throw new Error('Channel was deleted');
      const { remoteId } = await platformOf(channel).publish(channel, post);
      store.update('posts', post.id, { status: 'published', remoteId, publishedAt: new Date().toISOString(), error: null });
    } catch (err) {
      store.update('posts', post.id, { status: 'failed', error: err.message });
    }
  }
  return due.length;
}

// A crash mid-publish leaves posts in "publishing"; we cannot know whether the
// platform accepted them, so surface them as failed instead of re-posting.
function recoverInterrupted(store) {
  for (const p of store.list('posts')) {
    if (p.status === 'publishing') {
      store.update('posts', p.id, { status: 'failed', error: 'Interrupted while publishing; check the channel before retrying' });
    }
  }
}

function startScheduler(store, intervalMs = 30000) {
  recoverInterrupted(store);
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await publishDue(store);
    } catch (err) {
      console.error('scheduler:', err);
    } finally {
      running = false;
    }
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

module.exports = { publishDue, recoverInterrupted, startScheduler };
