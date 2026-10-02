'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { parseSize, parseDockerStats, memAvailableBytes, estimate } = require('../scripts/capacity-check');

test('parses docker stats and keeps only phone containers', () => {
  const lines = [
    { Name: 'app-marketing-phone001-1', MemUsage: '2.5GiB / 62.8GiB', CPUPerc: '35.2%' },
    { Name: 'phone002', MemUsage: '1.5GiB / 62.8GiB', CPUPerc: '24.8%' },
    { Name: 'postgres', MemUsage: '300MiB / 62.8GiB', CPUPerc: '1%' },
  ].map((x) => JSON.stringify(x)).join('\n');
  const phones = parseDockerStats(lines);
  assert.deepStrictEqual(phones.map((p) => p.name), ['app-marketing-phone001-1', 'phone002']);
  assert.strictEqual(phones[0].memBytes, 2.5 * 1024 ** 3);
  assert.strictEqual(parseSize('512MiB'), 512 * 1024 ** 2);
  assert.strictEqual(memAvailableBytes('MemTotal: 1 kB\nMemAvailable:   1000 kB\n'), 1024000);
});

test('estimate is limited by whichever of RAM or CPU runs out first', () => {
  const GiB = 1024 ** 3;
  const phones = Array.from({ length: 5 }, () => ({ memBytes: 2 * GiB, cpuPct: 50 }));
  // 64 GiB box, 40 GiB available, keep 20% (12.8 GiB) free -> 27.2 GiB usable -> 13 phones by RAM.
  // 16 cores -> 1280% budget, 250% used -> 20 phones by CPU.
  const r = estimate({ phones, availBytes: 40 * GiB, totalBytes: 64 * GiB, cpus: 16, headroom: 0.2 });
  assert.strictEqual(r.moreByMem, 13);
  assert.strictEqual(r.moreByCpu, 20);
  assert.strictEqual(r.more, 13);
  assert.strictEqual(r.limitedBy, 'RAM');
  assert.strictEqual(estimate({ phones: [], availBytes: 1, totalBytes: 1, cpus: 1 }), null);
});
