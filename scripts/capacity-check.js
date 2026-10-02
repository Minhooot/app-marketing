#!/usr/bin/env node
'use strict';

// Measures what the running phones actually use and estimates how many more
// fit on this server. Run it while the phones have real apps open.
// Usage: node scripts/capacity-check.js [--headroom 0.2]

const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const PHONE_RE = /^phone\d+$|[-_]phone\d+[-_]\d+$/;

function parseSize(s) {
  const m = String(s).trim().match(/^([\d.]+)\s*([KMGT]?i?B)$/i);
  if (!m) return 0;
  const mult = { B: 1, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12, KIB: 1024, MIB: 1024 ** 2, GIB: 1024 ** 3, TIB: 1024 ** 4 };
  return Number(m[1]) * (mult[m[2].toUpperCase()] || 1);
}

// Lines from `docker stats --no-stream --format '{{json .}}'`.
function parseDockerStats(text) {
  return text
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((r) => PHONE_RE.test(r.Name))
    .map((r) => ({
      name: r.Name,
      memBytes: parseSize(String(r.MemUsage).split('/')[0]),
      cpuPct: parseFloat(r.CPUPerc) || 0,
    }));
}

function memAvailableBytes(meminfo) {
  const m = meminfo.match(/^MemAvailable:\s+(\d+) kB/m);
  return m ? Number(m[1]) * 1024 : os.freemem();
}

function estimate({ phones, availBytes, totalBytes, cpus, headroom = 0.2 }) {
  if (!phones.length) return null;
  const avgMem = phones.reduce((s, p) => s + p.memBytes, 0) / phones.length;
  const avgCpu = phones.reduce((s, p) => s + p.cpuPct, 0) / phones.length;
  const usable = Math.max(0, availBytes - totalBytes * headroom);
  const moreByMem = avgMem > 0 ? Math.floor(usable / avgMem) : Infinity;
  // docker reports CPU% per core (100% = one full core).
  const cpuBudget = cpus * 100 * (1 - headroom);
  const totalCpuNow = phones.reduce((s, p) => s + p.cpuPct, 0);
  const moreByCpu = avgCpu > 0 ? Math.max(0, Math.floor((cpuBudget - totalCpuNow) / avgCpu)) : Infinity;
  const more = Math.min(moreByMem, moreByCpu);
  return { running: phones.length, avgMem, avgCpu, moreByMem, moreByCpu, more, limitedBy: moreByMem <= moreByCpu ? 'RAM' : 'CPU' };
}

const gb = (b) => `${(b / 1e9).toFixed(1)} GB`;

if (require.main === module) {
  const i = process.argv.indexOf('--headroom');
  const headroom = i > 0 ? Number(process.argv[i + 1]) : 0.2;
  let raw;
  try {
    raw = execFileSync('docker', ['stats', '--no-stream', '--format', '{{json .}}'], { encoding: 'utf8' });
  } catch (err) {
    console.error(`Cannot run docker stats: ${err.message}`);
    process.exit(1);
  }
  const phones = parseDockerStats(raw);
  const meminfo = fs.existsSync('/proc/meminfo') ? fs.readFileSync('/proc/meminfo', 'utf8') : '';
  const r = estimate({ phones, availBytes: memAvailableBytes(meminfo), totalBytes: os.totalmem(), cpus: os.cpus().length, headroom });
  if (!r) {
    console.log('No phone containers running. Start a few (docker compose up -d phone001 ... phone005) and open real apps first.');
    process.exit(0);
  }
  console.log(`Phones running:        ${r.running}`);
  console.log(`Average RAM per phone: ${gb(r.avgMem)}`);
  console.log(`Average CPU per phone: ${r.avgCpu.toFixed(0)}% of one core`);
  console.log(`Server:                ${gb(os.totalmem())} RAM, ${os.cpus().length} cores (keeping ${headroom * 100}% free)`);
  console.log(`Can add about:         ${r.more === Infinity ? 'n/a' : r.more} more phones (limited by ${r.limitedBy})`);
  console.log(`=> Recommended total:  ${r.more === Infinity ? 'n/a' : r.running + r.more} phones`);
}

module.exports = { parseSize, parseDockerStats, memAvailableBytes, estimate };
