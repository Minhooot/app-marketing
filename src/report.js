'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;

// Calendar date (YYYY-MM-DD) of an instant in the viewer's timezone.
// tzOffsetMin follows Date#getTimezoneOffset (Vietnam = -420).
function localDay(date, tzOffsetMin) {
  return new Date(new Date(date).getTime() - tzOffsetMin * 60000).toISOString().slice(0, 10);
}

const engagementOf = (p) => (p.likes || 0) + (p.comments || 0) + (p.shares || 0);

// Summarises the posts published in the last `days` local days (today included).
function buildReport(posts, { days = 7, tzOffsetMin = 0, now = new Date(), fetchLimit = 25 } = {}) {
  const dayKeys = Array.from({ length: days }, (_, i) =>
    localDay(now.getTime() - (days - 1 - i) * DAY_MS, tzOffsetMin));
  const inWindow = posts.filter((p) => dayKeys.includes(localDay(p.createdAt, tzOffsetMin)));

  const byDay = Object.fromEntries(dayKeys.map((d) => [d, { date: d, posts: 0, engagement: 0 }]));
  for (const p of inWindow) {
    const d = byDay[localDay(p.createdAt, tzOffsetMin)];
    d.posts += 1;
    d.engagement += engagementOf(p);
  }

  const sum = (k) => inWindow.reduce((s, p) => s + (p[k] || 0), 0);
  // Instagram has no share count and only TikTok has views: report "unknown"
  // (null) rather than a misleading 0.
  const known = (k) => inWindow.some((p) => p[k] !== undefined && p[k] !== null);
  const engagement = inWindow.reduce((s, p) => s + engagementOf(p), 0);

  return {
    from: dayKeys[0],
    to: dayKeys[dayKeys.length - 1],
    totals: {
      posts: inWindow.length,
      likes: sum('likes'),
      comments: sum('comments'),
      shares: known('shares') ? sum('shares') : null,
      views: known('views') ? sum('views') : null,
      engagement,
      avgEngagementPerPost: inWindow.length ? Math.round(engagement / inWindow.length) : 0,
    },
    daily: dayKeys.map((d) => byDay[d]),
    top: [...inWindow]
      .sort((a, b) => engagementOf(b) - engagementOf(a))
      .slice(0, 3)
      .map((p) => ({ ...p, engagement: engagementOf(p) })),
    // Only the latest `fetchLimit` posts are fetched. If we got a full page and
    // all of it falls inside the window, older posts in the window may be missing.
    truncated: posts.length >= fetchLimit && inWindow.length === posts.length,
  };
}

module.exports = { buildReport, localDay };
