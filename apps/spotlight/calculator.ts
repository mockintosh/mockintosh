/**
 * Spotlight's calculator: an arithmetic expression typed into the search
 * field is answered as the top hit. A small recursive-descent parser, never
 * `eval`: numbers, + − × ÷ (also * / x), ^ and **, %, parentheses, unary
 * minus, `pi` and `e`, and a few functions (sqrt, sin, cos, tan, ln, log,
 * abs, round, floor, ceil).
 */

const FUNCTIONS: Readonly<Record<string, (x: number) => number>> = {
  sqrt: Math.sqrt,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  ln: Math.log,
  log: Math.log10,
  abs: Math.abs,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
};

const CONSTANTS: Readonly<Record<string, number>> = { pi: Math.PI, e: Math.E };

type Token = { type: "number"; value: number } | { type: "op"; value: string } | { type: "name"; value: string };

function tokenize(text: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const number = /^(\d+(?:[.,]\d+)?|[.,]\d+)/.exec(text.slice(i));
    if (number) {
      tokens.push({ type: "number", value: Number(number[1].replace(",", ".")) });
      i += number[1].length;
      continue;
    }
    if (text.startsWith("**", i)) {
      tokens.push({ type: "op", value: "^" });
      i += 2;
      continue;
    }
    if ("+-−*×x/÷^%()".includes(ch)) {
      const op = ch === "−" ? "-" : ch === "×" || ch === "x" ? "*" : ch === "÷" ? "/" : ch;
      // An `x` is multiplication only between operands ("3x4"); anywhere else it's a name.
      if (ch !== "x" || tokens.at(-1)?.type === "number" || tokens.at(-1)?.value === ")") {
        tokens.push({ type: "op", value: op });
        i++;
        continue;
      }
    }
    const name = /^[a-z]+/i.exec(text.slice(i));
    if (name) {
      tokens.push({ type: "name", value: name[0].toLowerCase() });
      i += name[0].length;
      continue;
    }
    return null;
  }
  return tokens;
}

/** The value of `text` as arithmetic, or null when it isn't any (or is just a number). */
export function evaluate(text: string): number | null {
  const parsed = tokenize(text.trim().replace(/=$/, ""));
  if (!parsed || parsed.length < 2) return null;
  const tokens = parsed;
  // A bare number or name ("42", "pi") is a search, not a sum.
  if (!tokens.some((t) => t.type === "op" && t.value !== "(" && t.value !== ")") && !tokens.some((t) => t.type === "name" && t.value in FUNCTIONS)) {
    return null;
  }
  let pos = 0;
  const peek = () => tokens[pos];
  const isOp = (value: string) => peek()?.type === "op" && peek()!.value === value;

  function expression(): number {
    let value = term();
    while (isOp("+") || isOp("-")) {
      const op = tokens[pos++].value;
      value = op === "+" ? value + term() : value - term();
    }
    return value;
  }

  function term(): number {
    let value = power();
    for (;;) {
      if (isOp("*") || isOp("/")) {
        const op = tokens[pos++].value;
        value = op === "*" ? value * power() : value / power();
      } else if (peek()?.type === "number" || peek()?.type === "name" || isOp("(")) {
        value *= power(); // implicit: 2pi, 3(4+1)
      } else {
        return value;
      }
    }
  }

  function power(): number {
    const base = unary();
    if (isOp("^")) {
      pos++;
      return base ** power();
    }
    return base;
  }

  function unary(): number {
    if (isOp("-")) {
      pos++;
      return -unary();
    }
    if (isOp("+")) {
      pos++;
      return unary();
    }
    return postfix();
  }

  function postfix(): number {
    let value = primary();
    while (isOp("%")) {
      pos++;
      value /= 100;
    }
    return value;
  }

  function primary(): number {
    const token = tokens[pos++];
    if (!token) throw new Error("end");
    if (token.type === "number") return token.value;
    if (token.type === "name") {
      if (token.value in CONSTANTS) return CONSTANTS[token.value];
      const fn = FUNCTIONS[token.value];
      if (!fn) throw new Error("name");
      return fn(primary());
    }
    if (token.value === "(") {
      const value = expression();
      if (isOp(")")) pos++;
      return value;
    }
    throw new Error("token");
  }

  try {
    const value = expression();
    if (pos !== tokens.length || !Number.isFinite(value)) return null;
    return value;
  } catch {
    return null;
  }
}

/** A result as the calculator shows it: up to 10 significant digits, without float noise. */
export function formatNumber(value: number): string {
  if (Number.isInteger(value) && Math.abs(value) < 1e15) return String(value);
  const text = String(Number(value.toPrecision(10)));
  return text.includes("e") ? value.toExponential(6).replace(/\.?0+e/, "e") : text;
}
