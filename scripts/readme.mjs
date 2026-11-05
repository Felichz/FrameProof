// The README's pictures, drawn from real runs (docs/readme/data.json and a golden trace), as SVG that follows
// GitHub's light and dark themes. Regenerate after changing the data:
//
//   node scripts/readme.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { readFrames, readTrace } from '../src/core/trace.mjs';

const at = (p) => fileURLToPath(new URL(p, import.meta.url));
const data = JSON.parse(readFileSync(at('../docs/readme/data.json'), 'utf8'));
const fixture = JSON.parse(gunzipSync(readFileSync(at('../test/fixtures/scroll-forced-layout-chrome156.json.gz'))));
const strip = readFrames(readTrace(fixture.events, fixture.mainFrame)).map((f) => f.bad);

const SANS = `-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif`;
const MONO = `ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace`;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The palette, as GitHub's own: light by default, dark when the reader's system is. */
const STYLE = `<style>
svg { --card:#f6f8fa; --card2:#ffffff; --ink:#1f2328; --muted:#59636e; --faint:#818b98; --line:#d1d9e0;
  --good:#1a7f37; --goodsoft:#dafbe1; --bad:#cf222e; --badsoft:#ffebe9; --accent:#8250df; --accentsoft:#fbefff;
  --warn:#9a6700; --warnsoft:#fff8c5; --blue:#0969da; --bluesoft:#ddf4ff; }
@media (prefers-color-scheme: dark) { svg { --card:#151b23; --card2:#0d1117; --ink:#f0f6fc; --muted:#9198a1; --faint:#656c76;
  --line:#3d444d; --good:#3fb950; --goodsoft:#12261e; --bad:#f85149; --badsoft:#2d1418; --accent:#ab7df8; --accentsoft:#231631;
  --warn:#d29922; --warnsoft:#272115; --blue:#4493f8; --bluesoft:#121d2f; } }
.card { fill: var(--card); stroke: var(--line); }
.card2 { fill: var(--card2); stroke: var(--line); }
.ink { fill: var(--ink); } .muted { fill: var(--muted); } .faint { fill: var(--faint); }
.good { fill: var(--good); } .bad { fill: var(--bad); } .accent { fill: var(--accent); } .warn { fill: var(--warn); } .blue { fill: var(--blue); }
.goodsoft { fill: var(--goodsoft); } .ontime { fill: var(--good); opacity: 0.22; } .badsoft { fill: var(--badsoft); } .accentsoft { fill: var(--accentsoft); } .warnsoft { fill: var(--warnsoft); } .bluesoft { fill: var(--bluesoft); }
.line { stroke: var(--line); } .sline { stroke: var(--muted); } .sgood { stroke: var(--good); } .sbad { stroke: var(--bad); } .saccent { stroke: var(--accent); } .swarn { stroke: var(--warn); }
.sans { font-family: ${SANS}; } .mono { font-family: ${MONO}; }
</style>`;

const svg = (w, h, title, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="t">
<title id="t">${esc(title)}</title>
${STYLE}
${body}
</svg>
`;
const text = (x, y, s, { size = 16, cls = 'ink', weight = 400, font = 'sans', anchor = 'start', ls = 0 } = {}) =>
  `<text x="${x}" y="${y}" xml:space="preserve" class="${cls} ${font}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}"${ls ? ` letter-spacing="${ls}"` : ''}>${esc(s)}</text>`;
const pill = (x, y, label, tone, { size = 13, pad = 10, h = 24, font = 'sans', weight = 600 } = {}) => {
  const w = Math.round(label.length * size * (font === 'mono' ? 0.62 : 0.6) + pad * 2);
  return { w, el: `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" class="${tone}soft"/>${text(x + w / 2, y + h / 2 + size * 0.36, label, { size, cls: tone, weight, font, anchor: 'middle' })}` };
};
const frames = (x, y, list, { w = 8, h = 34, gap = 2, n = list.length } = {}) =>
  list.slice(0, n).map((bad, i) => `<rect x="${x + i * (w + gap)}" y="${y}" width="${w}" height="${h}" rx="2" class="${bad ? 'bad' : 'ontime'}"/>`).join('');

// ---- hero ---------------------------------------------------------------------------------------------------
function hero() {
  const W = 1280;
  const H = 350;
  const shown = strip.slice(0, 112);
  const sx = 64;
  const sy = 262;
  const late = shown.filter(Boolean).length;
  const c = data.compare.cells[0];
  const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  return svg(W, H, 'frameproof: frame-level performance evidence for web apps, built for coding agents', `
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="18" class="card"/>
${text(64, 118, 'frameproof', { size: 76, weight: 700, ls: -2 })}
${text(68, 162, 'Frame-level performance evidence for web apps,', { size: 24, cls: 'muted' })}
${text(68, 194, 'built to be used by coding agents.', { size: 24, cls: 'muted' })}
<g transform="translate(860 64)">
  <rect x="0" y="0" width="356" height="160" rx="14" class="card2"/>
  ${text(24, 38, 'SCROLL DOWN · 4x CPU', { size: 12, cls: 'muted', weight: 600, ls: 1.2 })}
  ${text(24, 98, `${med(c.base)}`, { size: 54, cls: 'bad', weight: 700 })}
  ${text(98, 90, '→', { size: 34, cls: 'faint' })}
  ${text(140, 98, `${med(c.head)}`, { size: 54, cls: 'good', weight: 700 })}
  ${text(184, 78, 'late frames a step,', { size: 15, cls: 'muted' })}
  ${text(184, 98, 'median of 32 runs', { size: 15, cls: 'muted' })}
  ${pill(24, 116, 'better · confirmed on fresh repetitions', 'good', { size: 12 }).el}
</g>
${text(sx, sy - 16, `ONE SCROLL OF THE SAMPLE APP, FRAME BY FRAME: ${late} LATE (RED) OF ${shown.length}`, { size: 12, cls: 'muted', weight: 600, ls: 1.2 })}
${frames(sx, sy, shown)}
${text(sx, sy + 64, 'Real Chrome, real GPU, kept out of sight. Verdicts with intervals, in a few hundred tokens of JSON.', { size: 15, cls: 'faint' })}
`);
}

// ---- the loop -----------------------------------------------------------------------------------------------
function loop() {
  const W = 1280;
  const H = 330;
  const steps = [
    ['next', 'the one thing', 'to do now', 'blue'],
    ['GOALS', 'asks the person', 'what matters', 'warn'],
    ['freezes', 'what froze,', 'to the line', 'bad'],
    ['price', 'a fix, before', 'making it', 'accent'],
    ['change', 'one thing,', 'uncommitted', 'accent'],
    ['compare', 'alternated A/B,', 'a verdict', 'good'],
    ['report', 'for a person,', 'worded to it', 'blue'],
  ];
  const bw = 150;
  const gap = 24;
  const x0 = (W - (steps.length * bw + (steps.length - 1) * gap)) / 2;
  const y = 70;
  let body = `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="18" class="card"/>
${text(48, 44, 'THE LOOP AN AGENT FOLLOWS', { size: 12, cls: 'muted', weight: 600, ls: 1.2 })}
<defs><marker id="a" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" class="faint"/></marker></defs>`;
  steps.forEach(([name, a, b, tone], i) => {
    const x = x0 + i * (bw + gap);
    body += `<rect x="${x}" y="${y}" width="${bw}" height="132" rx="14" class="card2"/>
<circle cx="${x + 26}" cy="${y + 28}" r="13" class="${tone}soft"/>${text(x + 26, y + 33, String(i + 1), { size: 13, cls: tone, weight: 700, anchor: 'middle' })}
${text(x + 18, y + 76, name, { size: 21, weight: 700, font: 'mono' })}
${text(x + 18, y + 102, a, { size: 13, cls: 'muted' })}
${text(x + 18, y + 120, b, { size: 13, cls: 'muted' })}`;
    if (i < steps.length - 1) body += `<line x1="${x + bw + 3}" y1="${y + 66}" x2="${x + bw + gap - 3}" y2="${y + 66}" class="sline" stroke-width="1.6" marker-end="url(#a)"/>`;
  });
  const jx = x0;
  const jw = steps.length * bw + (steps.length - 1) * gap;
  const jy = y + 168;
  body += `<path d="M ${x0 + jw - bw / 2} ${y + 132} v 16 M ${x0 + bw / 2} ${y + 148} v -12" class="sline" stroke-width="1.6" fill="none" marker-end="url(#a)"/>
<path d="M ${x0 + jw - bw / 2} ${y + 148} H ${x0 + bw / 2}" class="sline" stroke-width="1.6" fill="none" stroke-dasharray="4 4"/>
<rect x="${jx}" y="${jy}" width="${jw}" height="44" rx="12" class="warnsoft"/>
${text(jx + 20, jy + 28, 'perf/JOURNAL.md', { size: 15, cls: 'warn', weight: 700, font: 'mono' })}
${text(jx + 190, jy + 28, 'every compare and price lands here, with its hypothesis: the next session starts where this one stopped', { size: 14, cls: 'muted' })}`;
  return svg(W, H, 'The loop: next, goals, freezes, price, change, compare, report, with a journal', body);
}

// ---- what it found ------------------------------------------------------------------------------------------
function found() {
  const W = 1280;
  const rows = data.found;
  const H = 96 + rows.length * 62 + 70;
  let body = `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="18" class="card"/>
${text(48, 44, 'WHAT IT FOUND IN THE SAMPLE APP, WITH NO HINTS', { size: 12, cls: 'muted', weight: 600, ls: 1.2 })}
${text(48, 74, 'examples/janky-shop has four planted causes and a red herring. Each was named by its file and line.', { size: 15, cls: 'muted' })}`;
  rows.forEach((r, i) => {
    const y = 96 + i * 62;
    body += `<rect x="48" y="${y}" width="${W - 96}" height="50" rx="12" class="card2"/>
<circle cx="76" cy="${y + 25}" r="11" class="goodsoft"/><path d="M70 ${y + 25} l4 4 l8 -9" class="sgood" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
${pill(100, y + 13, r.where, 'blue', { size: 12, font: 'mono' }).el}
${text(230, y + 31, r.cause, { size: 16, weight: 600 })}
${text(760, y + 31, r.at, { size: 15, cls: 'bad', font: 'mono' })}
${text(W - 72, y + 31, r.how, { size: 13, cls: 'faint', font: 'mono', anchor: 'end' })}`;
  });
  const y = 96 + rows.length * 62;
  body += `<rect x="48" y="${y}" width="${W - 96}" height="50" rx="12" class="card2" stroke-dasharray="5 4"/>
<circle cx="76" cy="${y + 25}" r="11" class="goodsoft"/><path d="M70 ${y + 25} l4 4 l8 -9" class="sgood" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
${pill(100, y + 13, 'red herring', 'warn', { size: 12, font: 'mono' }).el}
${text(230, y + 31, 'a sorted copy of the catalog and a JSON snapshot: they look costly, measure as nothing, and were not blamed', { size: 15, cls: 'muted' })}`;
  return svg(W, H, 'What frameproof found in the sample app: four planted causes by file and line, and the red herring not blamed', body);
}

// ---- a freeze's dossier -------------------------------------------------------------------------------------
function dossier() {
  const W = 1280;
  const H = 470;
  const d = data.dossier;
  const shown = strip.slice(0, 100);
  const sx = 48;
  const sy = 110;
  const fw = 9.6;
  // The longest run of late frames is the freeze this dossier is about.
  let best = [0, 0];
  for (let i = 0; i < shown.length; ) {
    if (!shown[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < shown.length && shown[j]) j++;
    if (j - i > best[1] - best[0]) best = [i, j];
    i = j;
  }
  const bx = sx + best[0] * fw;
  const bwid = (best[1] - best[0]) * fw - 2;
  const total = d.task.reduce((s, t) => s + t.ms, 0);
  const barX = 48;
  const barW = W - 96;
  const barY = 252;
  const tone = { script: 'accent', layout: 'bad', paint: 'faint', style: 'warn' };
  let cx = barX;
  let segs = '';
  let labels = '';
  for (const t of d.task) {
    const w = (t.ms / total) * barW;
    segs += `<rect x="${cx}" y="${barY}" width="${w - 3}" height="38" rx="6" class="${tone[t.kind]}" opacity="${t.kind === 'paint' ? 0.55 : 0.95}"/>`;
    if (w > (t.label.length + 6) * 7.4 + 20) labels += `<text x="${cx + 12}" y="${barY + 25}" class="sans" font-size="13" font-weight="700" fill="#ffffff">${esc(`${t.label} ${t.ms} ms`)}</text>`;
    if (t.where) labels += text(cx + 12, barY + 60, t.where, { size: 13, cls: tone[t.kind], font: 'mono', weight: 600 });
    cx += w;
  }
  return svg(W, H, `A freeze's dossier: ${d.verdict}`, `
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="18" class="card"/>
${text(48, 44, 'FREEZES  ·  ONE DOSSIER', { size: 12, cls: 'muted', weight: 600, ls: 1.2 })}
${text(48, 78, `f1 · ${d.where}`, { size: 22, weight: 700, font: 'mono' })}
${pill(282, 58, `in ${d.in} repetitions`, 'bad', { size: 12 }).el}
${frames(sx, sy, shown, { w: fw - 2, h: 40 })}
<rect x="${bx - 4}" y="${sy - 6}" width="${bwid + 8}" height="52" rx="6" fill="none" class="saccent" stroke-width="2"/>
<path d="M ${bx + bwid / 2} ${sy + 50} V ${barY - 14}" class="saccent" stroke-width="1.6" stroke-dasharray="3 3"/>
${text(bx + bwid / 2 + 10, sy + 76, `${d.ms} ms with no new frame: what ran on the page's main thread`, { size: 14, cls: 'accent', weight: 600 })}
${segs}${labels}
<rect x="48" y="${barY + 90}" width="${W - 96}" height="64" rx="12" class="card2"/>
${text(70, barY + 118, 'VERDICT', { size: 11, cls: 'muted', weight: 700, ls: 1.2 })}
${text(70, barY + 140, d.verdict, { size: 15, font: 'mono' })}
${text(48, H - 22, 'Also in a dossier: stages, V8 samples, every other thread, the GPU process, surfaces, invalidations, marks.  →  frameproof show f1', { size: 13, cls: 'faint' })}
`);
}

// ---- compare ------------------------------------------------------------------------------------------------
function compare() {
  const W = 1280;
  const H = 470;
  const cells = data.compare.cells;
  const pw = (W - 96 - 24) / 2;
  let body = `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="18" class="card"/>
${text(48, 44, 'COMPARE  ·  THE FIX AGAINST THE LAST COMMIT, ALTERNATED IN ONE SESSION', { size: 12, cls: 'muted', weight: 600, ls: 1.2 })}`;
  const maxV = 40;
  cells.forEach((c, k) => {
    const px = 48 + k * (pw + 24);
    const py = 66;
    const ph = 330;
    const top = py + 64;
    const bottom = py + ph - 40;
    const yOf = (v) => bottom - (v / maxV) * (bottom - top);
    body += `<rect x="${px}" y="${py}" width="${pw}" height="${ph}" rx="14" class="card2"/>
${text(px + 24, py + 36, c.cell, { size: 18, weight: 700, font: 'mono' })}
${pill(px + pw - 104, py + 18, 'better', 'good', { size: 13 }).el}`;
    for (const v of [0, 10, 20, 30, 40]) body += `<line x1="${px + 56}" x2="${px + pw - 24}" y1="${yOf(v)}" y2="${yOf(v)}" class="line" stroke-width="1"/>${text(px + 44, yOf(v) + 4, String(v), { size: 11, cls: 'faint', anchor: 'end' })}`;
    const col = (vals, cxm, tone, label) => {
      // A beeswarm: equal values side by side.
      const seen = {};
      let dots = '';
      for (const v of vals) {
        const n = (seen[v] = (seen[v] ?? 0) + 1) - 1;
        const off = (n % 2 ? 1 : -1) * Math.ceil(n / 2) * 9;
        dots += `<circle cx="${cxm + off}" cy="${yOf(v)}" r="4" class="${tone}" opacity="0.8"/>`;
      }
      const med = [...vals].sort((a, b) => a - b)[Math.floor(vals.length / 2)];
      return `${dots}<line x1="${cxm - 46}" x2="${cxm + 46}" y1="${yOf(med)}" y2="${yOf(med)}" class="s${tone}" stroke-width="2.5"/>${text(cxm, bottom + 26, label, { size: 13, cls: 'muted', anchor: 'middle', weight: 600 })}`;
    };
    const ax = px + 150;
    const bx = px + 330;
    body += col(c.base, ax, 'bad', 'base (HEAD)') + col(c.head, bx, 'good', 'head (the fix)');
    const medA = [...c.base].sort((a, b) => a - b)[16];
    const medB = [...c.head].sort((a, b) => a - b)[16];
    body += `<path d="M ${ax + 56} ${yOf(medA)} C ${ax + 120} ${yOf(medA)}, ${bx - 120} ${yOf(medB)}, ${bx - 56} ${yOf(medB) - 2}" class="sline" stroke-width="1.5" fill="none" stroke-dasharray="4 4"/>
${text(px + pw - 40, py + 120, `${c.effect}`, { size: 44, cls: 'good', weight: 700, anchor: 'end' })}
${text(px + pw - 40, py + 146, 'late frames a step', { size: 13, cls: 'muted', anchor: 'end' })}
${text(px + pw - 40, py + 168, `95% interval [${c.interval[0]}, ${c.interval[1]}]`, { size: 13, cls: 'muted', anchor: 'end', font: 'mono' })}
${text(px + pw - 40, py + 190, `${c.base.length} + ${c.head.length} repetitions;`, { size: 13, cls: 'muted', anchor: 'end' })}
${text(px + pw - 40, py + 210, 'the fresh 24 + 24 decide', { size: 13, cls: 'muted', anchor: 'end' })}`;
  });
  body += text(48, H - 22, 'Each dot is one repetition at 4x CPU. A first look that seems different only earns a confirmation run on fresh repetitions; only that run decides.', { size: 13, cls: 'faint' });
  return svg(W, H, 'Compare: the forced-layout fix is better by 24 and 19 late frames a step at 4x CPU, confirmed on fresh repetitions', body);
}

// ---- verdicts -----------------------------------------------------------------------------------------------
function verdicts() {
  const W = 1280;
  const H = 330;
  const list = [
    ['better', 'good', 'confirmed on fresh repetitions', '"Improved by X, interval Y"'],
    ['worse', 'bad', 'confirmed on fresh repetitions', '"Regressed by X"'],
    ['same', 'blue', 'the interval fits inside the margin', '"No change larger than ±margin"'],
    ['inconclusive', 'warn', 'the data can\'t tell', '"Not known". Never "no difference"'],
    ['invalid', 'bad', 'the steps didn\'t do what they claim', 'Nothing yet: it may be a real bug'],
    ['not-measurable', 'accent', 'this machine can\'t measure now', '"Unmeasured", and why'],
  ];
  const cw = (W - 96 - 2 * 20) / 3;
  let body = `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="18" class="card"/>
${text(48, 44, 'SIX VERDICTS, AND WHAT EACH LETS YOU SAY', { size: 12, cls: 'muted', weight: 600, ls: 1.2 })}`;
  list.forEach(([name, tone, means, say], i) => {
    const x = 48 + (i % 3) * (cw + 20);
    const y = 66 + Math.floor(i / 3) * 124;
    body += `<rect x="${x}" y="${y}" width="${cw}" height="108" rx="14" class="card2"/>
${pill(x + 20, y + 18, name, tone, { size: 14, font: 'mono', h: 28 }).el}
${text(x + 22, y + 72, means, { size: 14, cls: 'muted' })}
${text(x + 22, y + 94, say, { size: 14, weight: 600 })}`;
  });
  return svg(W, H, 'Six verdicts: better, worse, same, inconclusive, invalid, not-measurable', body);
}

// ---- terminal -----------------------------------------------------------------------------------------------
function terminal() {
  const W = 1280;
  const lines = [
    ['$ ', 'npx -y github:Felichz/FrameProof next', 'prompt'],
    ['', '{', ''],
    ['', ' "status": "ok",', ''],
    ['', ' "summary": "this machine isn\'t calibrated for open-cart, load: find its', ''],
    ['', '   noise floor and what it can see, once (about 15 minutes; --background', ''],
    ['', '   to keep working)",', ''],
    ['', ' "machine": "darwin-i5-1038ng7-8c-chrome156-95adeb",', ''],
    ['', ' "next": ["frameproof calibrate -s open-cart,load --throttle 1,4 --background"]', 'next'],
    ['', '}', ''],
  ];
  const H = 92 + lines.length * 28 + 40;
  let body = `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="18" class="card2"/>
<path d="M 0.5 18.5 a 18 18 0 0 1 18 -18 h ${W - 37} a 18 18 0 0 1 18 18 v 30 h -${W - 1} z" class="card"/>
<circle cx="30" cy="25" r="7" fill="#ff5f57"/><circle cx="54" cy="25" r="7" fill="#febc2e"/><circle cx="78" cy="25" r="7" fill="#28c840"/>
${text(W / 2, 30, 'your project', { size: 13, cls: 'muted', anchor: 'middle' })}`;
  lines.forEach(([pre, s, kind], i) => {
    const y = 92 + i * 28;
    if (kind === 'prompt') body += text(40, y, pre, { size: 17, cls: 'good', font: 'mono', weight: 700 }) + text(64, y, s, { size: 17, font: 'mono', weight: 600 });
    else if (kind === 'next') body += `<rect x="34" y="${y - 20}" width="${W - 68}" height="28" rx="6" class="bluesoft"/>` + text(40, y, s, { size: 16, cls: 'blue', font: 'mono', weight: 600 });
    else body += text(40, y, s, { size: 16, cls: 'muted', font: 'mono' });
  });
  body += text(40, H - 22, '`next` reads the project and the machine and says the one thing to do now, with its exact command.', { size: 14, cls: 'faint' });
  return svg(W, H, 'A terminal: next says the one thing to do now, with its exact command', body);
}

const out = { hero, loop, found, dossier, compare, verdicts, terminal };
for (const [name, make] of Object.entries(out)) {
  const file = at(`../docs/readme/${name}.svg`);
  writeFileSync(file, make());
  console.log('wrote', file);
}
