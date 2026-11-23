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
      report_next   INTEGER,
      briefing_day    INTEGER,
      briefing_minute INTEGER,
      briefing_next   INTEGER,
      place           TEXT,
      lat             REAL,
      lon             REAL,
      pending         TEXT,
      calendar_alert  INTEGER
    );
    CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, at INTEGER NOT NULL, body TEXT);
    CREATE TABLE IF NOT EXISTS trash (user TEXT PRIMARY KEY, body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS purchases (
      id       INTEGER PRIMARY KEY,
      user     TEXT NOT NULL,
      title    TEXT NOT NULL,
      url      TEXT NOT NULL,
      paid     INTEGER NOT NULL,
      start    INTEGER NOT NULL,
      currency TEXT NOT NULL,
      at       INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
    -- nr is what the user types. It is per user, so the numbers stay small.
    CREATE TABLE IF NOT EXISTS reminders (
      id       INTEGER PRIMARY KEY,
      user     TEXT NOT NULL,
      nr       INTEGER NOT NULL,
      text     TEXT NOT NULL,
      due      INTEGER,
      repeat   TEXT,
      fired_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS reminders_due ON reminders(due);
    CREATE TABLE IF NOT EXISTS items (
      id   INTEGER PRIMARY KEY,
      user TEXT NOT NULL,
      list TEXT NOT NULL,
      nr   INTEGER NOT NULL,
      text TEXT NOT NULL,
      at   INTEGER NOT NULL
    );
    -- url is a secret link to the user's calendar, it never leaves this PC except to the calendar provider.
    CREATE TABLE IF NOT EXISTS calendars (
      id    INTEGER PRIMARY KEY,
      user  TEXT NOT NULL,
      nr    INTEGER NOT NULL,
      url   TEXT NOT NULL,
      name  TEXT NOT NULL,
      error TEXT,
      UNIQUE (user, url)
    );
    -- Which events were already announced before they start.
    CREATE TABLE IF NOT EXISTS calendar_alerts (user TEXT NOT NULL, key TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (user, key));
    CREATE TABLE IF NOT EXISTS expenses (
      id       INTEGER PRIMARY KEY,
      user     TEXT NOT NULL,
      nr       INTEGER NOT NULL,
      cents    INTEGER NOT NULL,
      currency TEXT NOT NULL,
      category TEXT NOT NULL,
      note     TEXT,
      at       INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS expenses_user ON expenses(user, at);
    -- category '' is the budget for the whole month
    CREATE TABLE IF NOT EXISTS budgets (user TEXT NOT NULL, category TEXT NOT NULL, cents INTEGER NOT NULL, PRIMARY KEY (user, category));
    CREATE TABLE IF NOT EXISTS birthdays (
      id    INTEGER PRIMARY KEY,
      user  TEXT NOT NULL,
      nr    INTEGER NOT NULL,
      name  TEXT NOT NULL,
      day   INTEGER NOT NULL,
      month INTEGER NOT NULL,
      year  INTEGER
    );
    -- Messages that must go out only once, e.g. "birthday:3:2026:day"
    CREATE TABLE IF NOT EXISTS once (user TEXT NOT NULL, key TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (user, key));
    CREATE TABLE IF NOT EXISTS notes (
      id   INTEGER PRIMARY KEY,
      user TEXT NOT NULL,
      nr   INTEGER NOT NULL,
      text TEXT NOT NULL,
      at   INTEGER NOT NULL
    );
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
    moveToTrash(product, purchase) {
      const history = store.allHistory(product.id);
      store.transaction(() => {
        run('INSERT OR REPLACE INTO trash VALUES (?, ?)', product.user, JSON.stringify({ product, history, purchase }));
        store.remove(product.id);
      });
    },
    /** Records the purchase and removes the product, undoable together. */
    buy(product, { title, paid, start, currency, at }) {
      const history = store.allHistory(product.id);
      store.transaction(() => {
        const purchase = Number(run('INSERT INTO purchases (user, title, url, paid, start, currency, at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          product.user, title, product.url, paid, start, currency, at).lastInsertRowid);
        run('INSERT OR REPLACE INTO trash VALUES (?, ?)', product.user, JSON.stringify({ product, history, purchase }));
        store.remove(product.id);
      });
    },
    purchases: (user) => all('SELECT * FROM purchases WHERE user = ? ORDER BY at DESC, id DESC', user),
    trashed(user) {
      const row = get('SELECT body FROM trash WHERE user = ?', user);
      return row ? JSON.parse(row.body) : null;
    },
    restore(user, { product, history, purchase }) {
      const columns = Object.keys(product);
      store.transaction(() => {
        // Ids are never reused (AUTOINCREMENT), so the old number is still free.
        run(`INSERT INTO products (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`, ...Object.values(product));
        for (const row of history) store.record(product.id, row.at, row.price, row.currency);
        run('DELETE FROM trash WHERE user = ?', user);
        if (purchase) run('DELETE FROM purchases WHERE id = ? AND user = ?', purchase, user);
      });
    },

    settings: (user) => get('SELECT * FROM settings WHERE user = ?', user),
    saveSettings(user, fields) {
      run('INSERT OR IGNORE INTO settings (user) VALUES (?)', user);
      const keys = Object.keys(fields);
      run(`UPDATE settings SET ${keys.map((key) => `${key} = ?`).join(', ')} WHERE user = ?`, ...Object.values(fields), user);
    },
    dueReports: (now) => all('SELECT * FROM settings WHERE report_next <= ?', now),
    dueBriefings: (now) => all('SELECT * FROM settings WHERE briefing_next <= ?', now),

    // Reminders. due is null once a one-off reminder has fired; it stays a while for "später".
    reminders: (user) => all('SELECT * FROM reminders WHERE user = ? AND due IS NOT NULL ORDER BY due, nr', user),
    reminder: (user, nr) => get('SELECT * FROM reminders WHERE user = ? AND nr = ? AND due IS NOT NULL', user, nr),
    addReminder(user, { text, due, repeat }) {
      const nr = (get('SELECT MAX(nr) AS nr FROM reminders WHERE user = ? AND due IS NOT NULL', user).nr ?? 0) + 1;
      run('INSERT INTO reminders (user, nr, text, due, repeat) VALUES (?, ?, ?, ?, ?)', user, nr, text, due, repeat ? JSON.stringify(repeat) : null);
      return store.reminder(user, nr);
    },
    updateReminder(id, fields) {
      const keys = Object.keys(fields);
      run(`UPDATE reminders SET ${keys.map((key) => `${key} = ?`).join(', ')} WHERE id = ?`, ...Object.values(fields), id);
    },
    removeReminder: (id) => run('DELETE FROM reminders WHERE id = ?', id),
    dueReminders: (now) => all('SELECT * FROM reminders WHERE due <= ? ORDER BY due', now),
    lastFired: (user, since) =>
      get('SELECT * FROM reminders WHERE user = ? AND fired_at >= ? ORDER BY fired_at DESC, id DESC LIMIT 1', user, since),
    pruneReminders: (before) => run('DELETE FROM reminders WHERE due IS NULL AND fired_at < ?', before),

    // Shopping list and to-dos share the numbers, so "erledigt 3" is never ambiguous.
    items: (user, list) => (list
      ? all('SELECT * FROM items WHERE user = ? AND list = ? ORDER BY nr', user, list)
      : all('SELECT * FROM items WHERE user = ? ORDER BY nr', user)),
    addItems(user, list, texts, at) {
      store.transaction(() => {
        let nr = get('SELECT MAX(nr) AS nr FROM items WHERE user = ?', user).nr ?? 0;
        for (const text of texts) run('INSERT INTO items (user, list, nr, text, at) VALUES (?, ?, ?, ?, ?)', user, list, ++nr, text, at);
      });
    },
    removeItems: (ids) => store.transaction(() => ids.forEach((id) => run('DELETE FROM items WHERE id = ?', id))),
    restoreItems(rows) {
      store.transaction(() => {
        for (const row of rows) {
          const taken = get('SELECT 1 FROM items WHERE user = ? AND nr = ?', row.user, row.nr);
          const nr = taken ? (get('SELECT MAX(nr) AS nr FROM items WHERE user = ?', row.user).nr ?? 0) + 1 : row.nr;
          run('INSERT INTO items (user, list, nr, text, at) VALUES (?, ?, ?, ?, ?)', row.user, row.list, nr, row.text, row.at);
        }
      });
    },

    calendars: (user) => all('SELECT * FROM calendars WHERE user = ? ORDER BY nr', user),
    calendarUsers: () => all('SELECT DISTINCT user FROM calendars').map((row) => row.user),
    addCalendar(user, url, name) {
      const nr = (get('SELECT MAX(nr) AS nr FROM calendars WHERE user = ?', user).nr ?? 0) + 1;
      run('INSERT INTO calendars (user, nr, url, name) VALUES (?, ?, ?, ?)', user, nr, url, name);
      return get('SELECT * FROM calendars WHERE user = ? AND nr = ?', user, nr);
    },
    calendarByUrl: (user, url) => get('SELECT * FROM calendars WHERE user = ? AND url = ?', user, url),
    calendarError: (id, error) => run('UPDATE calendars SET error = ? WHERE id = ?', error, id),
    removeCalendar: (id) => run('DELETE FROM calendars WHERE id = ?', id),
    /** Returns false if this event was announced before. */
    claimAlert: (user, key, at) => Number(run('INSERT OR IGNORE INTO calendar_alerts VALUES (?, ?, ?)', user, key, at).changes) === 1,
    pruneAlerts: (before) => run('DELETE FROM calendar_alerts WHERE at < ?', before),
    claimOnce: (user, key, at) => Number(run('INSERT OR IGNORE INTO once VALUES (?, ?, ?)', user, key, at).changes) === 1,
    pruneOnce: (before) => run('DELETE FROM once WHERE at < ?', before),

    expenses: (user, from, to) => all('SELECT * FROM expenses WHERE user = ? AND at >= ? AND at < ? ORDER BY at DESC, id DESC', user, from, to),
    expense: (user, nr) => get('SELECT * FROM expenses WHERE user = ? AND nr = ?', user, nr),
    addExpense(user, { cents, currency, category, note, at }) {
      const nr = (get('SELECT MAX(nr) AS nr FROM expenses WHERE user = ?', user).nr ?? 0) + 1;
      run('INSERT INTO expenses (user, nr, cents, currency, category, note, at) VALUES (?, ?, ?, ?, ?, ?, ?)', user, nr, cents, currency, category, note || null, at);
      return store.expense(user, nr);
    },
    removeExpense: (id) => run('DELETE FROM expenses WHERE id = ?', id),
    restoreExpense(row) {
      const nr = store.expense(row.user, row.nr) ? (get('SELECT MAX(nr) AS nr FROM expenses WHERE user = ?', row.user).nr ?? 0) + 1 : row.nr;
      run('INSERT INTO expenses (user, nr, cents, currency, category, note, at) VALUES (?, ?, ?, ?, ?, ?, ?)', row.user, nr, row.cents, row.currency, row.category, row.note, row.at);
      return store.expense(row.user, nr);
    },
    expenseTotal: (user, from, to, currency, category = null) => get(
      `SELECT COALESCE(SUM(cents), 0) AS total FROM expenses WHERE user = ? AND at >= ? AND at < ? AND currency = ?${category ? ' AND category = ?' : ''}`,
      ...[user, from, to, currency, ...(category ? [category] : [])],
    ).total,
    expenseCategories: (user) => all('SELECT DISTINCT category FROM expenses WHERE user = ?', user).map((row) => row.category),
    expenseUsers: (from, to) => all('SELECT DISTINCT user FROM expenses WHERE at >= ? AND at < ?', from, to).map((row) => row.user),
    budgets: (user) => all('SELECT * FROM budgets WHERE user = ? ORDER BY category', user),
    setBudget(user, category, cents) {
      if (cents == null) run('DELETE FROM budgets WHERE user = ? AND category = ?', user, category);
      else run('INSERT OR REPLACE INTO budgets VALUES (?, ?, ?)', user, category, cents);
    },

    birthdays: (user) => all('SELECT * FROM birthdays WHERE user = ? ORDER BY nr', user),
    allBirthdays: () => all('SELECT * FROM birthdays'),
    birthday: (user, nr) => get('SELECT * FROM birthdays WHERE user = ? AND nr = ?', user, nr),
    addBirthday(user, { name, day, month, year }) {
      const nr = (get('SELECT MAX(nr) AS nr FROM birthdays WHERE user = ?', user).nr ?? 0) + 1;
      run('INSERT INTO birthdays (user, nr, name, day, month, year) VALUES (?, ?, ?, ?, ?, ?)', user, nr, name, day, month, year);
      return store.birthday(user, nr);
    },
    updateBirthday(id, { day, month, year }) {
      run('UPDATE birthdays SET day = ?, month = ?, year = ? WHERE id = ?', day, month, year, id);
      return get('SELECT * FROM birthdays WHERE id = ?', id);
    },
    removeBirthday: (id) => run('DELETE FROM birthdays WHERE id = ?', id),
    restoreBirthday(row) {
      const nr = store.birthday(row.user, row.nr) ? (get('SELECT MAX(nr) AS nr FROM birthdays WHERE user = ?', row.user).nr ?? 0) + 1 : row.nr;
      return store.addBirthdayAt(row, nr);
    },
    addBirthdayAt(row, nr) {
      run('INSERT INTO birthdays (user, nr, name, day, month, year) VALUES (?, ?, ?, ?, ?, ?)', row.user, nr, row.name, row.day, row.month, row.year);
      return store.birthday(row.user, nr);
    },

    notes: (user) => all('SELECT * FROM notes WHERE user = ? ORDER BY nr DESC', user),
    note: (user, nr) => get('SELECT * FROM notes WHERE user = ? AND nr = ?', user, nr),
    addNote(user, text, at) {
      const nr = (get('SELECT MAX(nr) AS nr FROM notes WHERE user = ?', user).nr ?? 0) + 1;
      run('INSERT INTO notes (user, nr, text, at) VALUES (?, ?, ?, ?)', user, nr, text, at);
      return store.note(user, nr);
    },
    removeNote: (id) => run('DELETE FROM notes WHERE id = ?', id),
    restoreNote(row) {
      const taken = store.note(row.user, row.nr);
      const nr = taken ? (get('SELECT MAX(nr) AS nr FROM notes WHERE user = ?', row.user).nr ?? 0) + 1 : row.nr;
      run('INSERT INTO notes (user, nr, text, at) VALUES (?, ?, ?, ?)', row.user, nr, row.text, row.at);
      return store.note(row.user, nr);
    },
    /** For "rückgängig": the last deleted thing of each user, of any kind. */
    keepInTrash: (user, body) => run('INSERT OR REPLACE INTO trash VALUES (?, ?)', user, JSON.stringify(body)),
    clearTrash: (user) => run('DELETE FROM trash WHERE user = ?', user),

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
    settings: { briefing_day: 'INTEGER', briefing_minute: 'INTEGER', briefing_next: 'INTEGER', place: 'TEXT', lat: 'REAL', lon: 'REAL', pending: 'TEXT', calendar_alert: 'INTEGER' },
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
