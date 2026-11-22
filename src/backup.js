import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const KEEP = 7;
const OWN_FILE = /^tracker-\d{4}-\d\d-\d\d\.db$/;

/** One copy of the database per day. The WhatsApp session is deliberately not copied. */
export function dailyBackup(db, dataDir, now = new Date()) {
  const dir = join(dataDir, 'backup');
  const two = (n) => String(n).padStart(2, '0');
  const file = join(dir, `tracker-${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}.db`);
  if (existsSync(file)) return false;

  mkdirSync(dir, { recursive: true });
  const unfinished = `${file}.tmp`;
  rmSync(unfinished, { force: true });
  db.backupTo(unfinished);
  renameSync(unfinished, file);

  // Only files with our own name pattern are ever removed.
  const copies = readdirSync(dir).filter((name) => OWN_FILE.test(name)).sort();
  for (const name of copies.slice(0, -KEEP)) rmSync(join(dir, name));
  return true;
}
