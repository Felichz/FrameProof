// Arguments, with no library: `--name value`, `--name=value`, `-s value`, and flags that take no value.
// Repeated options collect into a list (`-s scroll -s load`), and so does a comma list (`--throttle 1,4`).

const SHORT = { s: 'scenario', n: 'n', h: 'help' };
const BOOLEAN = new Set(['full', 'background', 'cold', 'help', 'headless', 'keep', 'show', 'json', 'dry-run', 'force', 'light']);

export function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      out._.push(...argv.slice(i + 1));
      break;
    }
    let name = null;
    let value;
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      name = eq > 0 ? a.slice(2, eq) : a.slice(2);
      if (eq > 0) value = a.slice(eq + 1);
    } else if (/^-[a-z]$/i.test(a)) name = SHORT[a[1]] ?? a[1];
    else {
      out._.push(a);
      continue;
    }
    if (value === undefined) {
      if (BOOLEAN.has(name)) value = true;
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) value = argv[++i];
      else value = true;
    }
    const prev = out.flags[name];
    out.flags[name] = prev === undefined ? value : [].concat(prev, value);
  }
  return out;
}

/** A flag as a list: `-s a -s b` and `-s a,b` both give ['a', 'b']. */
export function list(flags, name, fallback = []) {
  const v = flags[name];
  if (v === undefined || v === true) return fallback;
  return [].concat(v).flatMap((x) => String(x).split(',')).map((x) => x.trim()).filter(Boolean);
}

export function number(flags, name, fallback) {
  const v = flags[name];
  if (v === undefined || v === true) return fallback;
  const n = Number(Array.isArray(v) ? v.at(-1) : v);
  if (!Number.isFinite(n)) throw new UsageError(`--${name} takes a number, got "${v}"`);
  return n;
}

export function string(flags, name, fallback) {
  const v = flags[name];
  if (v === undefined || v === true) return fallback;
  return String(Array.isArray(v) ? v.at(-1) : v);
}

/** A mistake in how the tool was called: exit code 3, with what to type instead. */
export class UsageError extends Error {
  constructor(message, next = []) {
    super(message);
    this.next = next;
  }
}
