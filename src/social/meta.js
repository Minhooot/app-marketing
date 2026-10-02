'use strict';

// Facebook Pages + Instagram Graph API (official). The channel token is a
// Page access token; Instagram uses the same token with the IG business id.

const graphBase = () => `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || 'v24.0'}`;

async function graph(method, pathname, token, params = {}) {
  const url = new URL(`${graphBase()}/${pathname}`);
  const body = new URLSearchParams({ ...params, access_token: token });
  let res;
  if (method === 'GET') {
    url.search = body.toString();
    res = await fetch(url);
  } else {
    res = await fetch(url, { method, body });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(`Meta API: ${data.error?.message || res.statusText}`);
  return data;
}

const facebook = {
  async publish(ch, post) {
    if (post.mediaUrl) {
      const r = await graph('POST', `${ch.accountId}/photos`, ch.token, { url: post.mediaUrl, caption: post.text || '' });
      return { remoteId: r.post_id || r.id };
    }
    if (!post.text && !post.link) throw new Error('Facebook post needs text, link or image');
    const params = {};
    if (post.text) params.message = post.text;
    if (post.link) params.link = post.link;
    const r = await graph('POST', `${ch.accountId}/feed`, ch.token, params);
    return { remoteId: r.id };
  },

  async recentPosts(ch, limit = 10) {
    const r = await graph('GET', `${ch.accountId}/posts`, ch.token, {
      fields: 'id,message,created_time,permalink_url,shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)',
      limit,
    });
    return r.data.map((p) => ({
      id: p.id,
      text: p.message || '',
      createdAt: p.created_time,
      url: p.permalink_url,
      likes: p.reactions?.summary?.total_count ?? 0,
      comments: p.comments?.summary?.total_count ?? 0,
      shares: p.shares?.count ?? 0,
    }));
  },

  async comments(ch, postId) {
    const r = await graph('GET', `${postId}/comments`, ch.token, { fields: 'id,message,from,created_time', limit: 50 });
    return r.data.map((c) => ({ id: c.id, text: c.message, author: c.from?.name || '', createdAt: c.created_time }));
  },

  async reply(ch, commentId, message) {
    const r = await graph('POST', `${commentId}/comments`, ch.token, { message });
    return { id: r.id };
  },
};

const instagram = {
  async publish(ch, post) {
    if (!post.mediaUrl) throw new Error('Instagram post needs a public image URL');
    const container = await graph('POST', `${ch.accountId}/media`, ch.token, {
      image_url: post.mediaUrl,
      caption: post.text || '',
    });
    const r = await graph('POST', `${ch.accountId}/media_publish`, ch.token, { creation_id: container.id });
    return { remoteId: r.id };
  },

  async recentPosts(ch, limit = 10) {
    const r = await graph('GET', `${ch.accountId}/media`, ch.token, {
      fields: 'id,caption,timestamp,permalink,like_count,comments_count',
      limit,
    });
    return r.data.map((m) => ({
      id: m.id,
      text: m.caption || '',
      createdAt: m.timestamp,
      url: m.permalink,
      likes: m.like_count ?? 0,
      comments: m.comments_count ?? 0,
      shares: null,
    }));
  },

  async comments(ch, mediaId) {
    const r = await graph('GET', `${mediaId}/comments`, ch.token, { fields: 'id,text,username,timestamp', limit: 50 });
    return r.data.map((c) => ({ id: c.id, text: c.text, author: c.username || '', createdAt: c.timestamp }));
  },

  async reply(ch, commentId, message) {
    const r = await graph('POST', `${commentId}/replies`, ch.token, { message });
    return { id: r.id };
  },
};

module.exports = { facebook, instagram, graphBase };
