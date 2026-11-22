import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

export function readConfig(env) {
  const number = (key, fallback, min) => {
    if (!env[key]) return fallback;
    const value = Number(env[key].replace(',', '.'));
    if (!Number.isFinite(value) || value < min) {
      throw new Error(`${key} muss eine Zahl ab ${min} sein (ist: "${env[key]}").`);
    }
    return value;
  };

  const allowed = (env.ALLOWED_NUMBERS ?? '').split(',').filter((s) => s.trim()).map((raw) => {
    const digits = raw.replace(/[\s+()/-]/g, '').replace(/^00/, '');
    if (!/^[1-9]\d{6,14}$/.test(digits)) {
      throw new Error(`ALLOWED_NUMBERS: "${raw.trim()}" braucht die Ländervorwahl, z. B. 49... statt 0...`);
    }
    return digits;
  });

  return {
    allowed: new Set(allowed),
    intervalMs: number('CHECK_INTERVAL_MINUTES', 180, 15) * 60_000,
    minDropPercent: number('MIN_DROP_PERCENT', 1, 0),
    notifyIncrease: env.NOTIFY_INCREASE === 'true',
    currency: env.DEFAULT_CURRENCY || 'EUR',
    maxProducts: number('MAX_PRODUCTS_PER_USER', 50, 1),
    dataDir: resolve(root, env.DATA_DIR || 'data'),
  };
}

export function loadConfig() {
  const file = resolve(root, '.env');
  if (existsSync(file)) process.loadEnvFile(file);
  return readConfig(process.env);
}
