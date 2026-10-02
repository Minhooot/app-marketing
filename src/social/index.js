'use strict';

const { facebook, instagram } = require('./meta');
const { tiktok } = require('./tiktok');

const platforms = { facebook, instagram, tiktok };

function platformOf(channel) {
  const p = platforms[channel.platform];
  if (!p) throw new Error(`Unsupported platform "${channel.platform}"`);
  return p;
}

// Never send tokens back to the browser.
function publicChannel({ token, ...rest }) {
  return { ...rest, hasToken: Boolean(token) };
}

module.exports = { platforms, platformOf, publicChannel, PLATFORMS: Object.keys(platforms) };
