#!/usr/bin/env node
'use strict';

// Stand-in for the adb binary: records every invocation to $FAKE_ADB_LOG
// and returns canned output, so the panel can be tested without phones.

const fs = require('node:fs');

const args = process.argv.slice(2);
if (process.env.FAKE_ADB_LOG) fs.appendFileSync(process.env.FAKE_ADB_LOG, JSON.stringify(args) + '\n');

const serial = args[0] === '-s' ? args[1] : null;
const rest = serial ? args.slice(2) : args;

if (serial === 'offline-phone') {
  process.stderr.write("error: device 'offline-phone' not found\n");
  process.exit(1);
}

switch (rest[0]) {
  case 'devices':
    process.stdout.write(
      'List of devices attached\n' +
        '127.0.0.1:5555         device product:redroid model:redroid12 device:redroid transport_id:1\n' +
        'emulator-5554          offline transport_id:2\n\n',
    );
    break;
  case 'root':
    process.stdout.write('adbd is already running as root\n');
    break;
  case 'connect':
    process.stdout.write(`connected to ${rest[1]}\n`);
    break;
  case 'shell':
    if (rest[1].startsWith('sqlite3')) process.stdout.write('3912345678901234567\n');
    if (rest[1] === 'settings get secure default_input_method') {
      process.stdout.write(serial === 'kb-active' ? 'com.android.adbkeyboard/.AdbIME\n' : 'com.android.inputmethod.latin/.LatinIME\n');
    }
    if (rest[1].startsWith('pm list packages')) {
      process.stdout.write(serial === 'no-kb' ? '' : 'package:com.android.adbkeyboard\n');
    }
    if (rest[1] === 'wm size') {
      process.stdout.write(serial === 'big-phone' ? 'Physical size: 1440x2560\nOverride size: 1080x1920\n' : 'Physical size: 720x1280\n');
    }
    break;
  case 'exec-out':
    process.stdout.write(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    break;
  case 'install':
    process.stdout.write('Performing Streamed Install\nSuccess\n');
    break;
}
