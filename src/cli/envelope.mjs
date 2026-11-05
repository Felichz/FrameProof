// Every command answers with the same envelope, on stdout, as one JSON object:
//
//   { status, summary, machine, run, evidence, next }
//
// `status` is a verdict (better, worse, same, inconclusive, invalid, not-measurable) for the commands that
// judge, and `ok`, `failed` (a budget broke) or `error` (the tool was called wrong) for the rest. The
// default output stays under a budget, about 400 tokens: what doesn't fit is cut, and the envelope says so
// and how to get it (`--full`, or a handle for `show`).

export const VERDICTS = ['better', 'worse', 'same', 'inconclusive', 'invalid', 'not-measurable'];
export const STATUSES = [...VERDICTS, 'ok', 'running', 'partial', 'failed', 'error'];

/** 0 a verdict was reached (or the command did its job), 1 a budget or a regression failed (or the steps
    didn't do what they claim), 2 not measurable, 3 usage. */
export function exitCode(status) {
  if (status === 'worse' || status === 'failed' || status === 'invalid') return 1;
  if (status === 'not-measurable') return 2;
  if (status === 'error') return 3;
  return 0;
}

/** About 400 tokens of JSON. */
export const BUDGET_CHARS = 1800;

export function envelope({ status, summary, machine = null, run = null, evidence = [], next = [], ...rest }) {
  if (!STATUSES.includes(status)) throw new Error(`unknown status ${status}`);
  return { status, summary, machine, run, evidence, next, ...rest };
}

/**
 * Cuts an envelope down to the budget. Evidence goes first, from the end, then long strings inside what is
 * left. The cut is said in `truncated`, with the command that gives the rest.
 */
export function fit(env, { full = false, budget = BUDGET_CHARS, rest } = {}) {
  if (full) return env;
  const size = (x) => JSON.stringify(x).length;
  if (size(env) <= budget) return env;
  const out = structuredClone(env);
  const more = rest ?? (out.run ? `frameproof show ${out.run} --full` : 'the same command with --full');
  const cut = { dropped: 0, more };
  out.truncated = cut;
  const lists = Object.keys(out).filter((k) => Array.isArray(out[k]) && k !== 'next');
  // Long lists inside evidence items first: the items stay, their tails go.
  for (const item of out.evidence ?? []) shortenInside(item, () => size(out) > budget, cut);
  for (const k of ['evidence', ...lists.filter((k) => k !== 'evidence')]) {
    while (size(out) > budget && out[k].length > 1) {
      out[k].pop();
      cut.dropped++;
    }
  }
  if (size(out) > budget) for (const k of Object.keys(out)) if (typeof out[k] === 'string' && out[k].length > 400 && k !== 'summary') out[k] = out[k].slice(0, 400) + ' ...';
  return out;
}

function shortenInside(item, over, cut) {
  if (!item || typeof item !== 'object') return;
  for (const k of Object.keys(item)) {
    const v = item[k];
    if (Array.isArray(v)) {
      while (over() && v.length > 2) {
        v.pop();
        cut.dropped++;
      }
    } else if (v && typeof v === 'object') shortenInside(v, over, cut);
  }
}

/** One key a line, one evidence item a line: readable, and still one JSON object. */
export function format(env) {
  const lines = Object.entries(env)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => {
      if (Array.isArray(v) && v.length && k !== 'next') return ` ${JSON.stringify(k)}: [\n${v.map((x) => `  ${JSON.stringify(x)}`).join(',\n')}\n ]`;
      return ` ${JSON.stringify(k)}: ${JSON.stringify(v)}`;
    });
  return `{\n${lines.join(',\n')}\n}`;
}

export function print(env, opts) {
  const out = fit(env, opts);
  process.stdout.write((opts?.compact ? JSON.stringify(out) : format(out)) + '\n');
  return exitCode(env.status);
}
