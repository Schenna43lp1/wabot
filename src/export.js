const HEADER = ['Nr.', 'Produkt', 'Link', 'Zeitpunkt', 'Preis', 'Währung', 'Aktueller Zielpreis'];

// Semicolons, decimal commas and a BOM: what a German Excel opens correctly.
function text(value) {
  let cell = String(value ?? '');
  // Shop titles are untrusted and must never become spreadsheet formulas.
  if (/^[\s]*[=+\-@]|^[\t\r\n]/.test(cell)) cell = `'${cell}`;
  return `"${cell.replace(/"/g, '""')}"`;
}

const amount = (cents) => (cents == null ? '' : (cents / 100).toFixed(2).replace('.', ','));

function localTime(at) {
  const d = new Date(at);
  const two = (n) => String(n).padStart(2, '0');
  return `${two(d.getDate())}.${two(d.getMonth() + 1)}.${d.getFullYear()} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

export function exportCsv(db, user) {
  const lines = [HEADER.map(text).join(';')];
  for (const product of db.products(user)) {
    const history = db.allHistory(product.id);
    const start = [product.id, text(product.name ?? product.title), text(product.url)];
    for (const row of history.length ? history : [null]) {
      lines.push([
        ...start,
        row ? localTime(row.at) : '',
        amount(row?.price),
        text(row?.currency ?? ''),
        amount(product.target),
      ].join(';'));
    }
  }
  return Buffer.from(`﻿${lines.join('\r\n')}\r\n`, 'utf8');
}
