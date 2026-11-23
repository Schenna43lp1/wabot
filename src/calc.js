// "rechne 12,5*3+7", "250 + 19%", "19% von 250", "trinkgeld 47,80". Never uses eval.

const MAX_LENGTH = 200;

/** German numbers: "12,5", "1.250" (thousands), "1.250,75", but also "12.5". */
function toNumber(raw) {
  if (raw.includes(',')) return Number(raw.replace(/\./g, '').replace(',', '.'));
  if (/^\d{1,3}(\.\d{3})+$/.test(raw)) return Number(raw.replace(/\./g, ''));
  return Number(raw);
}

function tokenize(input) {
  const text = input
    .toLowerCase()
    .replace(/(\d)\s*%\s*von\s*/g, '$1%*')
    .replace(/wurzel|√/g, 'sqrt')
    .replace(/[×·]/g, '*')
    .replace(/[÷:]/g, '/')
    .replace(/(\d|\))\s*x\s*(?=[\d(])/g, '$1*')
    .replace(/[−–]/g, '-')
    .replace(/€|eur(?:o)?\b/g, '');
  const tokens = [];
  const pattern = /\s*(?:(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?)|(sqrt)|([-+*/^()%]))/y;
  let match;
  let at = 0;
  while (at < text.length) {
    pattern.lastIndex = at;
    match = pattern.exec(text);
    if (!match) {
      if (!text.slice(at).trim()) break;
      return null;
    }
    if (match[1]) tokens.push({ number: toNumber(match[1]) });
    else tokens.push({ op: match[2] ?? match[3] });
    at = pattern.lastIndex;
  }
  return tokens;
}

/** Recursive descent. Values are { value, percent }: "+ 19%" means "plus 19 % of it". */
function evaluate(tokens) {
  let pos = 0;
  const peek = () => tokens[pos]?.op;
  const fail = (message = 'Das kann ich nicht ausrechnen.') => {
    throw new Error(message);
  };

  function primary() {
    const token = tokens[pos++];
    if (!token) fail();
    if (token.number != null) return token.number;
    if (token.op === '(') {
      const value = expression();
      if (tokens[pos++]?.op !== ')') fail('Eine Klammer fehlt.');
      return value;
    }
    if (token.op === 'sqrt') {
      const value = unary().value;
      if (value < 0) fail('Die Wurzel einer negativen Zahl gibt es nicht.');
      return Math.sqrt(value);
    }
    return fail();
  }

  function postfix() {
    const value = primary();
    if (peek() === '%') {
      pos++;
      return { value: value / 100, percent: true };
    }
    return { value, percent: false };
  }

  function unary() {
    if (peek() === '-') {
      pos++;
      const inner = unary();
      return { value: -inner.value, percent: inner.percent };
    }
    if (peek() === '+') pos++;
    return postfix();
  }

  function power() {
    const base = unary();
    if (peek() !== '^') return base;
    pos++;
    return { value: base.value ** power().value, percent: false };
  }

  function term() {
    let left = power();
    while (peek() === '*' || peek() === '/') {
      const op = tokens[pos++].op;
      const right = power();
      if (op === '/' && right.value === 0) fail('Durch null kann ich nicht teilen.');
      left = { value: op === '*' ? left.value * right.value : left.value / right.value, percent: false };
    }
    return left;
  }

  function expression() {
    let left = term().value;
    while (peek() === '+' || peek() === '-') {
      const op = tokens[pos++].op;
      const right = term();
      const amount = right.percent ? left * right.value : right.value;
      left = op === '+' ? left + amount : left - amount;
    }
    return left;
  }

  const result = expression();
  if (pos !== tokens.length) fail();
  if (!Number.isFinite(result)) fail('Das Ergebnis ist zu groß.');
  return result;
}

/** Returns { value } or { error }, or null if it is not a calculation at all. */
export function calculate(input) {
  if (!input || input.length > MAX_LENGTH) return null;
  const tokens = tokenize(input);
  if (!tokens?.length || !tokens.some((token) => token.number != null)) return null;
  try {
    return { value: evaluate(tokens) };
  } catch (error) {
    return { error: error.message };
  }
}

export function formatNumber(value) {
  if (Math.abs(value) >= 1e15 || (value !== 0 && Math.abs(value) < 1e-6)) {
    return value.toExponential(6).replace('.', ',').replace('e', ' × 10^');
  }
  return new Intl.NumberFormat('de-DE', { maximumFractionDigits: 10 }).format(Number(value.toPrecision(15)));
}

const money = (value) => new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);

/** "trinkgeld 47,80" or "trinkgeld 47,80 10%" */
export function tipText(input) {
  const match = input.trim().replace(/€|eur(?:o)?\b/gi, '').trim().match(/^(\d[\d.,]*)\s*(?:(\d{1,2}(?:[.,]\d)?)\s*%)?$/);
  if (!match) return null;
  const bill = toNumber(match[1]);
  if (!(bill > 0) || bill > 1e7) return null;
  const percents = match[2] ? [toNumber(match[2])] : [5, 10, 15];
  const lines = percents.map((percent) => {
    const tip = bill * (percent / 100);
    // Round the total up to the next half or full euro, as people do.
    const step = bill + tip >= 20 ? 1 : 0.5;
    const rounded = Math.ceil((bill + tip) / step) * step;
    return `${formatNumber(percent)} %: ${money(tip)} € → *${money(bill + tip)} €*, aufgerundet ${money(rounded)} €`;
  });
  return `💶 *Trinkgeld für ${money(bill)} €*\n${lines.join('\n')}`;
}
