'use strict';

// TikTok Content Posting API (official). Token is a user access token with
// video.publish (posting) and video.list (stats) scopes.

const BASE = 'https://open.tiktokapis.com/v2';

async function call(pathname, token, body, query = '') {
  const res = await fetch(`${BASE}${pathname}${query}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || (data.error && data.error.code !== 'ok')) {
    throw new Error(`TikTok API: ${data.error?.message || data.error?.code || res.statusText}`);
  }
  return data.data;
}

const tiktok = {
  async publish(ch, post) {
    if (!post.mediaUrl) throw new Error('TikTok post needs a video URL on a domain verified in TikTok for Developers');
    // Privacy must be one the creator currently allows; apps that have not
    // passed TikTok's audit can only post SELF_ONLY.
    const creator = await call('/post/publish/creator_info/query/', ch.token);
    const options = creator.privacy_level_options || [];
    const privacy = post.privacy || (options.includes('SELF_ONLY') ? 'SELF_ONLY' : options[0]);
    if (!options.includes(privacy)) throw new Error(`Privacy "${privacy}" not allowed; options: ${options.join(', ')}`);

    const r = await call('/post/publish/video/init/', ch.token, {
      post_info: { title: post.text || '', privacy_level: privacy },
      source_info: { source: 'PULL_FROM_URL', video_url: post.mediaUrl },
    });
    return { remoteId: r.publish_id };
  },

  async recentPosts(ch, limit = 10) {
    const r = await call(
      '/video/list/',
      ch.token,
      { max_count: Math.min(20, limit) },
      '?fields=id,title,create_time,share_url,view_count,like_count,comment_count,share_count',
    );
    return (r.videos || []).map((v) => ({
      id: v.id,
      text: v.title || '',
      createdAt: new Date(v.create_time * 1000).toISOString(),
      url: v.share_url,
      views: v.view_count ?? 0,
      likes: v.like_count ?? 0,
      comments: v.comment_count ?? 0,
      shares: v.share_count ?? 0,
    }));
  },

  async comments() {
    throw new Error('TikTok public API does not support reading or replying to comments');
  },

  async reply() {
    throw new Error('TikTok public API does not support reading or replying to comments');
  },
};

module.exports = { tiktok };
