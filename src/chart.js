// Price history as an image. Labels are numbers only; names go into the caption.
import { createCanvas } from './png.js';

export const WIDTH = 800;
export const HEIGHT = 420;
const LEFT = 110;
const RIGHT = 24;
const TOP = 24;
const BOTTOM = 48;

const COLORS = {
  grid: [229, 231, 235],
  label: [107, 114, 128],
  price: [37, 99, 235],
  target: [22, 163, 74],
  low: [220, 38, 38],
};

const amount = (cents, whole) => {
  const digits = whole ? 0 : 2;
  return new Intl.NumberFormat('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(cents / 100);
};

/** Round grid steps (1, 2, 2.5 or 5 times a power of ten), about four of them, in cents. */
export function axis(min, max) {
  const range = Math.max(max - min, max * 0.04, 4);
  const rough = range / 4;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = Math.max(1, [1, 2, 2.5, 5, 10].map((factor) => factor * power).find((candidate) => candidate >= rough && Number.isInteger(candidate)));
  const low = Math.max(0, Math.floor((min - step / 4) / step) * step);
  const high = Math.ceil((max + step / 4) / step) * step;
  return { low, high, step };
}
const day = (at) => new Date(at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });

/** series: rows { at, price }, oldest first, at least one. */
export function priceChart(series, { now, target } = {}) {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const start = series[0].at;
  const end = Math.max(now, series.at(-1).at + 1, start + 1);

  const values = series.map((row) => row.price);
  if (target != null) values.push(target);
  const { low, high, step } = axis(Math.min(...values), Math.max(...values));

  const plotWidth = WIDTH - LEFT - RIGHT;
  const plotHeight = HEIGHT - TOP - BOTTOM;
  const x = (at) => LEFT + ((at - start) / (end - start)) * plotWidth;
  const y = (price) => TOP + (1 - (price - low) / (high - low)) * plotHeight;

  // Grid with price labels
  for (let price = low; price <= high; price += step) {
    const lineY = Math.round(y(price));
    canvas.line(LEFT, lineY, WIDTH - RIGHT, lineY, COLORS.grid);
    const label = amount(price, step % 100 === 0);
    canvas.text(LEFT - 12 - canvas.textWidth(label), lineY - 7, label, COLORS.label);
  }
  canvas.text(LEFT, HEIGHT - BOTTOM + 16, day(start), COLORS.label);
  const today = day(end);
  canvas.text(WIDTH - RIGHT - canvas.textWidth(today), HEIGHT - BOTTOM + 16, today, COLORS.label);

  if (target != null) {
    const targetY = Math.round(y(target));
    canvas.line(LEFT, targetY, WIDTH - RIGHT, targetY, COLORS.target, 2, [10, 8]);
  }

  // Prices hold until the next change, so the line is drawn in steps.
  let lowest = series[0];
  series.forEach((row, i) => {
    const next = series[i + 1];
    const toX = next ? x(next.at) : x(end);
    canvas.line(x(row.at), y(row.price), toX, y(row.price), COLORS.price, 4);
    if (next) canvas.line(toX, y(row.price), toX, y(next.price), COLORS.price, 4);
    if (row.price < lowest.price) lowest = row;
  });
  canvas.circle(x(lowest.at), y(lowest.price), 7, COLORS.low);

  return canvas.png();
}
