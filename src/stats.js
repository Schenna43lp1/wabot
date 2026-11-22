// History holds only changes, so a price is valid until the next row.
const BARS = '▁▂▃▄▅▆▇█';

/** The rows since the last currency change, oldest first. */
export function currentSeries(rows, currency) {
  let start = rows.length;
  while (start > 0 && rows[start - 1].currency === currency) start--;
  return rows.slice(start);
}

export function priceAt(series, at) {
  let price = series[0]?.price;
  for (const row of series) {
    if (row.at > at) break;
    price = row.price;
  }
  return price;
}

/** Lowest and time-weighted average price of the last `days` days. */
export function periodStats(series, now, days) {
  if (!series.length) return null;
  const start = Math.max(series[0].at, now - days * 86_400_000);
  let price = priceAt(series, start);
  let low = price;
  let sum = 0;
  let at = start;
  for (const row of series) {
    if (row.at <= start || row.at > now) continue;
    sum += price * (row.at - at);
    ({ price, at } = row);
    low = Math.min(low, price);
  }
  sum += price * (now - at);
  const span = now - start;
  return { low, average: span > 0 ? Math.round(sum / span) : price, span };
}

export function sparkline(series, now, width = 20) {
  if (series.length < 2 || now <= series[0].at) return '';
  const first = series[0].at;
  const prices = Array.from({ length: width }, (_, i) => priceAt(series, first + ((now - first) * i) / (width - 1)));
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  if (low === high) return '';
  return prices.map((price) => BARS[Math.round(((price - low) / (high - low)) * (BARS.length - 1))]).join('');
}
