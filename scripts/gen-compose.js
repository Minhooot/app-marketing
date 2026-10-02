#!/usr/bin/env node
'use strict';

// Generates docker-compose.yml with N Redroid (Android-in-container) phones.
// Usage: node scripts/gen-compose.js <count> [image]
// Phone i is reachable over ADB at 127.0.0.1:(5555 + i).

const fs = require('node:fs');
const path = require('node:path');

const count = Number(process.argv[2] || 3);
const image = process.argv[3] || 'redroid/redroid:12.0.0_64only-latest';
if (!Number.isInteger(count) || count < 1 || count > 500) {
  console.error('count must be an integer between 1 and 500');
  process.exit(1);
}

let yml = 'services:\n';
for (let i = 0; i < count; i++) {
  const name = `phone${String(i + 1).padStart(3, '0')}`;
  yml += `  ${name}:
    image: ${image}
    privileged: true
    restart: unless-stopped
    ports:
      - "127.0.0.1:${5555 + i}:5555"
    volumes:
      - ./data/${name}:/data
    command:
      - androidboot.redroid_width=720
      - androidboot.redroid_height=1280
      - androidboot.redroid_dpi=320
      - androidboot.redroid_gpu_mode=guest
`;
}

const out = path.join(__dirname, '..', 'docker-compose.yml');
fs.writeFileSync(out, yml);
console.log(`Wrote ${count} phones to ${out}`);
console.log(`ADB addresses: 127.0.0.1:5555 .. 127.0.0.1:${5555 + count - 1}`);
