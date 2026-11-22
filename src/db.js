import { DatabaseSync } from 'node:sqlite';

export function openDatabase(file) {
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS products (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user          TEXT NOT NULL,
      url           TEXT NOT NULL,
      title         TEXT NOT NULL,
      selector      TEXT,
      target        INTEGER,
      target_hit    INTEGER NOT NULL DEFAULT 0,
      price         INTEGER,
      baseline      INTEGER,
      pending       INTEGER,
      currency      TEXT,
      available     INTEGER,
      is_from       INTEGER NOT NULL DEFAULT 0,
      failures      INTEGER NOT NULL DEFAULT 0,
      error         TEXT,
      checked_at    INTEGER,
      next_check_at INTEGER NOT NULL DEFAULT 0,
      name          TEXT,
      paused        INTEGER NOT NULL DEFAULT 0,
      min_drop      REAL,
      UNIQUE (user, url)
    );
    CREATE TABLE IF NOT EXISTS history (
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      at         INTEGER NOT NULL,
      price      INTEGER NOT NULL,
      currency   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS history_product ON history(product_id, at);
    CREATE TABLE IF NOT EXISTS outbox (
      id     INTEGER PRIMARY KEY,
      user   TEXT NOT NULL,
      text   TEXT NOT NULL,
      at     INTEGER NOT NULL DEFAULT 0,
      urgent INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS settings (
      user          TEXT PRIMARY KEY,
      quiet_from    INTEGER,
      quiet_to      INTEGER,
      report_day    INTEGER,
      report_minute INTEGER,
      report_next   INTEGER
    );
    CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, at INTEGER NOT NULL, body TEXT);
    CREATE TABLE IF NOT EXISTS trash (user TEXT PRIMARY KEY, body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
  `);
  addMissingColumns(db);
  db.prepare("INSERT OR IGNORE INTO meta VALUES ('installed_at', ?)").run(Date.now());

  const get = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);

  const store = {
    close: () => db.close(),
    backupTo: (path) => run('VACUUM INTO ?', path),
    transaction(work) {
      db.exec('BEGIN IMMEDIATE');
      try {
        work();
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },

    installedAt: () => get("SELECT value FROM meta WHERE key = 'installed_at'").value,

    product: (id) => get('SELECT * FROM products WHERE id = ?', id),
    byUrl: (user, url) => get('SELECT * FROM products WHERE user = ? AND url = ?', user, url),
    products: (user) => all('SELECT * FROM products WHERE user = ? ORDER BY id', user),
    due: (now) => all('SELECT * FROM products WHERE next_check_at <= ? AND paused = 0 ORDER BY next_check_at', now),
    add(user, url, target) {
      const result = run('INSERT INTO products (user, url, title, target) VALUES (?, ?, ?, ?)',
        user, url, provisionalTitle(url), target ?? null);
      return this.product(Number(result.lastInsertRowid));
    },
    // Field names always come from our own code, never from user input.
    update(id, fields) {
      const keys = Object.keys(fields);
      run(`UPDATE products SET ${keys.map((key) => `${key} = ?`).join(', ')} WHERE id = ?`, ...Object.values(fields), id);
    },
    remove: (id) => run('DELETE FROM products WHERE id = ?', id),

    record: (id, at, price, currency) => run('INSERT INTO history VALUES (?, ?, ?, ?)', id, at, price, currency),
    history: (id, limit) => all('SELECT * FROM history WHERE product_id = ? ORDER BY at DESC, rowid DESC LIMIT ?', id, limit),
    allHistory: (id) => all('SELECT at, price, currency FROM history WHERE product_id = ? ORDER BY at, rowid', id),
    stats: (id, currency) => get('SELECT MIN(price) AS low, MAX(price) AS high FROM history WHERE product_id = ? AND currency = ?', id, currency),
    firstPrice: (id, currency) =>
      get('SELECT price FROM history WHERE product_id = ? AND currency = ? ORDER BY at, rowid LIMIT 1', id, currency ?? '')?.price,
    clearHistory: (id) => run('DELETE FROM history WHERE product_id = ?', id),

    // Keeps the last deleted product of each user, for "rückgängig".
    moveToTrash(product) {
      const history = store.allHistory(product.id);
      store.transaction(() => {
        run('INSERT OR REPLACE INTO trash VALUES (?, ?)', product.user, JSON.stringify({ product, history }));
        store.remove(product.id);
      });
    },
    trashed(user) {
      const row = get('SELECT body FROM trash WHERE user = ?', user);
      return row ? JSON.parse(row.body) : null;
    },
    restore(user, { product, history }) {
      const columns = Object.keys(product);
      store.transaction(() => {
        // Ids are never reused (AUTOINCREMENT), so the old number is still free.
        run(`INSERT INTO products (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`, ...Object.values(product));
        for (const row of history) store.record(product.id, row.at, row.price, row.currency);
        run('DELETE FROM trash WHERE user = ?', user);
      });
    },

    settings: (user) => get('SELECT * FROM settings WHERE user = ?', user),
    saveSettings(user, fields) {
      run('INSERT OR IGNORE INTO settings (user) VALUES (?)', user);
      const keys = Object.keys(fields);
      run(`UPDATE settings SET ${keys.map((key) => `${key} = ?`).join(', ')} WHERE user = ?`, ...Object.values(fields), user);
    },
    dueReports: (now) => all('SELECT * FROM settings WHERE report_next <= ?', now),

    // urgent = an answer to the user, which quiet hours must not hold back.
    queue: (user, text, { at = Date.now(), urgent = false } = {}) =>
      run('INSERT INTO outbox (user, text, at, urgent) VALUES (?, ?, ?, ?)', user, text, at, Number(urgent)),
    queued: () => all('SELECT * FROM outbox ORDER BY id'),
    dequeue: (id) => run('DELETE FROM outbox WHERE id = ?', id),

    /** Returns false if the incoming message was handled before. */
    claimMessage: (id) => Number(run('INSERT OR IGNORE INTO messages (id, at) VALUES (?, ?)', `in:${id}`, Date.now()).changes) === 1,
    saveSent: (id, body) => run('INSERT OR REPLACE INTO messages VALUES (?, ?, ?)', `out:${id}`, Date.now(), body),
    sent: (id) => get('SELECT body FROM messages WHERE id = ?', `out:${id}`)?.body,
    pruneMessages: () => run('DELETE FROM messages WHERE at < ?', Date.now() - 3 * 86_400_000),
  };
  return store;
}

/** Databases from older versions lack these. */
function addMissingColumns(db) {
  const wanted = {
    products: { name: 'TEXT', paused: 'INTEGER NOT NULL DEFAULT 0', min_drop: 'REAL' },
    outbox: { at: 'INTEGER NOT NULL DEFAULT 0', urgent: 'INTEGER NOT NULL DEFAULT 0' },
  };
  for (const [table, columns] of Object.entries(wanted)) {
    const present = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name));
    for (const [name, type] of Object.entries(columns)) {
      if (!present.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
    }
  }
}

/** "billy buecherregal weiss (ikea.com)" until the shop tells us the real name. */
function provisionalTitle(link) {
  const { hostname, pathname } = new URL(link);
  const host = hostname.replace(/^www\./, '');
  const name = pathname.split('/')
    .map((part) => part.replace(/\.html?$/i, '').replace(/[-_+]+/g, ' ').replace(/%[0-9a-f]{2}/gi, ' ').replace(/\b\d{5,}\b/g, '').trim())
    .filter((part) => /[a-z]{3}/i.test(part))
    .sort((a, b) => b.length - a.length)[0];
  return name ? `${name.slice(0, 45)} (${host})` : host;
}
