'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const COLLECTIONS = ['groups', 'channels', 'posts', 'templates'];

// Small JSON-file store. The panel is a single process, so an in-memory copy
// flushed with an atomic rename is enough; no database to install.
class Store {
  constructor(file = process.env.DB_FILE || path.join(__dirname, '..', 'state', 'db.json')) {
    this.file = file;
    this.data = Object.fromEntries(COLLECTIONS.map((c) => [c, []]));
    if (fs.existsSync(file)) Object.assign(this.data, JSON.parse(fs.readFileSync(file, 'utf8')));
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    // mode 600: the file holds social channel access tokens.
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  list(col) {
    return this.data[col];
  }

  get(col, id) {
    return this.data[col].find((x) => x.id === id) || null;
  }

  insert(col, doc) {
    const row = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...doc };
    this.data[col].push(row);
    this.save();
    return row;
  }

  update(col, id, patch) {
    const row = this.get(col, id);
    if (!row) throw new Error(`${col}/${id} not found`);
    Object.assign(row, patch, { id, updatedAt: new Date().toISOString() });
    this.save();
    return row;
  }

  remove(col, id) {
    const before = this.data[col].length;
    this.data[col] = this.data[col].filter((x) => x.id !== id);
    if (this.data[col].length === before) throw new Error(`${col}/${id} not found`);
    this.save();
  }
}

module.exports = { Store };
