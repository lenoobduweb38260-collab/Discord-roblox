// Adaptateur : expose l'API de better-sqlite3 par-dessus node:sqlite, afin de
// faire tourner le VRAI code de src/database.js sans le paquet natif.
const { DatabaseSync } = require('node:sqlite');

class Statement {
  constructor(db, sql) { this.db = db; this.sql = sql; this._st = db.prepare(sql); }
  get(...a) { return this._st.get(...a); }
  all(...a) { return this._st.all(...a); }
  run(...a) {
    const r = this._st.run(...a);
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
  }
}

class Database {
  constructor(file) { this._db = new DatabaseSync(file); }
  exec(sql) { this._db.exec(sql); return this; }
  prepare(sql) { return new Statement(this._db, sql); }
  pragma(p) { this._db.exec(`PRAGMA ${p}`); }
  transaction(fn) {
    return (...args) => {
      this._db.exec('BEGIN');
      try { const r = fn(...args); this._db.exec('COMMIT'); return r; }
      catch (e) { this._db.exec('ROLLBACK'); throw e; }
    };
  }
  close() { this._db.close(); }
}

module.exports = Database;
