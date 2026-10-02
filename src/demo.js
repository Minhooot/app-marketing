'use strict';

// DEMO=1: answers Meta/TikTok API calls with sample data so the social page
// can be tried end to end without real tokens. Nothing is sent to any network.

const DAY = 24 * 60 * 60 * 1000;
const CAPTIONS = [
  'Flash sale 10.10 giảm 50% áo khoác',
  'Review son mới cực xinh',
  'Mini game tặng voucher 200k',
  'Outfit đi làm thứ 2',
  'Hậu trường buổi chụp lookbook',
  'Combo quà tặng 20/10',
  'Livestream tối nay 8h',
  'Feedback khách hàng tuần này',
];
const LIKES = [820, 410, 1260, 300, 520, 960, 640, 280];
const COMMENTS = [95, 40, 310, 22, 48, 120, 75, 18];
const SHARES = [60, 12, 140, 5, 20, 88, 30, 4];
const VIEWS = [15200, 8400, 30100, 5100, 9900, 21000, 12800, 4300];

const ago = (i) => new Date(Date.now() - i * DAY - 2 * 3600e3);

function graphResponse(url) {
  const p = url.pathname;
  if (p.endsWith('/media')) {
    return { data: CAPTIONS.map((c, i) => ({ id: `ig_${i}`, caption: c, timestamp: ago(i).toISOString(), permalink: 'https://www.instagram.com/', like_count: LIKES[i], comments_count: COMMENTS[i] })) };
  }
  if (p.endsWith('/posts')) {
    return { data: CAPTIONS.map((c, i) => ({ id: `fb_${i}`, message: c, created_time: ago(i).toISOString(), permalink_url: 'https://www.facebook.com/', reactions: { summary: { total_count: LIKES[i] } }, comments: { summary: { total_count: COMMENTS[i] } }, shares: { count: SHARES[i] } })) };
  }
  if (p.endsWith('/comments') && url.searchParams.has('fields')) {
    return { data: [
      { id: 'c1', message: 'Còn size M không shop?', text: 'Còn size M không shop?', from: { name: 'Lan Anh' }, username: 'lananh', created_time: ago(0).toISOString(), timestamp: ago(0).toISOString() },
      { id: 'c2', message: 'Giá bao nhiêu ạ', text: 'Giá bao nhiêu ạ', from: { name: 'Minh Tú' }, username: 'minhtu', created_time: ago(1).toISOString(), timestamp: ago(1).toISOString() },
    ] };
  }
  return { id: `demo_${Date.now()}`, post_id: `demo_${Date.now()}` };
}

function tiktokResponse(url) {
  const p = url.pathname;
  if (p.includes('creator_info')) return { data: { privacy_level_options: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'] }, error: { code: 'ok' } };
  if (p.includes('video/list')) {
    return { data: { videos: CAPTIONS.map((c, i) => ({ id: `tt_${i}`, title: c, create_time: Math.floor(ago(i).getTime() / 1000), share_url: 'https://www.tiktok.com/', view_count: VIEWS[i], like_count: LIKES[i], comment_count: COMMENTS[i], share_count: SHARES[i] })) }, error: { code: 'ok' } };
  }
  return { data: { publish_id: `demo_${Date.now()}` }, error: { code: 'ok' } };
}

function enableDemo() {
  const realFetch = global.fetch;
  global.fetch = async (input, init) => {
    const url = new URL(String(input));
    let body = null;
    if (url.hostname === 'graph.facebook.com') body = graphResponse(url);
    if (url.hostname === 'open.tiktokapis.com') body = tiktokResponse(url);
    if (!body) return realFetch(input, init);
    await new Promise((r) => setTimeout(r, 300)); // feel like a real network call
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  };
}

module.exports = { enableDemo };
