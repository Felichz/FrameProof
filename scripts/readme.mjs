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
/** One scroll down at 4x before the fix, frame by frame (true: late), from the golden trace. */
const before = readFrames(readTrace(fixture.events, fixture.mainFrame)).map((f) => f.bad);
/** The same scroll after the fix, from data.json (measured on the fixed build). */
const after = [...data.after.strip].map((c) => c === 'x');

const SANS = `-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif`;
const MONO = `ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace`;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The palette, as GitHub's own: light by default, dark when the reader's system is. */
const STYLE = `<style>
svg { --bg:#ffffff; --card:#f6f8fa; --card2:#ffffff; --ink:#1f2328; --muted:#59636e; --faint:#818b98; --line:#d1d9e0; --line2:#e8ecf0;
  --good:#1a7f37; --goodsoft:#dafbe1; --bad:#cf222e; --badsoft:#ffebe9; --accent:#8250df; --accentsoft:#fbefff;
  --warn:#9a6700; --warnsoft:#fff8c5; --blue:#0969da; --bluesoft:#ddf4ff; --shadow: rgba(31,35,40,0.08); }
@media (prefers-color-scheme: dark) { svg { --bg:#0d1117; --card:#151b23; --card2:#0d1117; --ink:#f0f6fc; --muted:#9198a1; --faint:#656c76;
  --line:#3d444d; --line2:#262c36; --good:#3fb950; --goodsoft:#12261e; --bad:#f85149; --badsoft:#2d1418; --accent:#ab7df8; --accentsoft:#231631;
  --warn:#d29922; --warnsoft:#272115; --blue:#4493f8; --bluesoft:#121d2f; --shadow: rgba(0,0,0,0.4); } }
.card { fill: var(--card); stroke: var(--line); }
.card2 { fill: var(--card2); stroke: var(--line); }
.ink { fill: var(--ink); } .muted { fill: var(--muted); } .faint { fill: var(--faint); }
.good { fill: var(--good); } .bad { fill: var(--bad); } .accent { fill: var(--accent); } .warn { fill: var(--warn); } .blue { fill: var(--blue); }
.goodsoft { fill: var(--goodsoft); } .badsoft { fill: var(--badsoft); } .accentsoft { fill: var(--accentsoft); } .warnsoft { fill: var(--warnsoft); } .bluesoft { fill: var(--bluesoft); }
.ontime { fill: var(--good); opacity: 0.24; }
.line { stroke: var(--line); } .line2 { stroke: var(--line2); } .sline { stroke: var(--muted); } .sfaint { stroke: var(--faint); }
.sgood { stroke: var(--good); } .sbad { stroke: var(--bad); } .saccent { stroke: var(--accent); } .swarn { stroke: var(--warn); } .sblue { stroke: var(--blue); } .sink { stroke: var(--ink); }
.sans { font-family: ${SANS}; } .mono { font-family: ${MONO}; }
.lift { filter: drop-shadow(0 1px 2px var(--shadow)) drop-shadow(0 6px 16px var(--shadow)); }
.play { animation: sweep 5.5s cubic-bezier(.45,.05,.55,.95) infinite; }
@keyframes sweep { 0% { transform: translateX(0); opacity: 0; } 6% { opacity: 1; } 88% { opacity: 1; } 100% { transform: translateX(var(--run)); opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .play { animation: none; opacity: 0; } }
</style>`;

const DEFS = `<defs>
<marker id="arrow" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M1 1 L9 5 L1 9" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="sfaint"/></marker>
<marker id="arrowgood" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M1 1 L9 5 L1 9" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="sgood"/></marker>
<pattern id="dots" width="18" height="18" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1" class="faint" opacity="0.28"/></pattern>
</defs>`;

const svg = (w, h, title, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="t">
<title id="t">${esc(title)}</title>
${STYLE}
${DEFS}
${body}
</svg>
`;
const text = (x, y, s, { size = 16, cls = 'ink', weight = 400, font = 'sans', anchor = 'start', ls = 0, opacity } = {}) =>
  `<text x="${x}" y="${y}" xml:space="preserve" class="${cls} ${font}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}"${ls ? ` letter-spacing="${ls}"` : ''}${opacity ? ` opacity="${opacity}"` : ''}>${esc(s)}</text>`;
const width = (s, size, font = 'sans') => s.length * size * (font === 'mono' ? 0.61 : 0.57);
const pill = (x, y, label, tone, { size = 13, pad = 11, h = 26, font = 'sans', weight = 600, icon } = {}) => {
  const iw = icon ? size + 6 : 0;
  const w = Math.round(width(label, size, font) + pad * 2 + iw);
  return {
    w,
    el: `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" class="${tone}soft"/>${icon ? text(x + pad + size / 2 - 1, y + h / 2 + size * 0.36, icon, { size, cls: tone, weight: 700, anchor: 'middle' }) : ''}${text(x + pad + iw + (w - pad * 2 - iw) / 2, y + h / 2 + size * 0.36, label, { size, cls: tone, weight, font, anchor: 'middle' })}`,
  };
};
const eyebrow = (x, y, s) => text(x, y, s.toUpperCase(), { size: 12, cls: 'muted', weight: 700, ls: 1.4 });
const panel = (W, H) => `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="20" class="card"/><rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="20" fill="url(#dots)"/>`;
const frames = (x, y, list, { w = 7, h = 30, gap = 2 } = {}) => list.map((bad, i) => `<rect x="${x + i * (w + gap)}" y="${y}" width="${w}" height="${h}" rx="2" class="${bad ? 'bad' : 'ontime'}"/>`).join('');
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

// Icons, drawn on a 20 x 20 grid with strokes.
const ICON = {
  compass: '<circle cx="10" cy="10" r="7.5"/><path d="M13 7 l-2 4.2 -4 1.8 2-4.2z"/>',
  person: '<circle cx="10" cy="6.5" r="3.2"/><path d="M3.8 17 c0.8-3.6 3.3-5.4 6.2-5.4 s5.4 1.8 6.2 5.4"/>',
  freeze: '<path d="M10 2.5 v15 M3.5 6.25 l13 7.5 M3.5 13.75 l13-7.5 M7.8 3.6 l2.2 1.7 2.2-1.7 M7.8 16.4 l2.2-1.7 2.2 1.7"/>',
  tag: '<path d="M3 10.6 V3.5 h7.1 l7 7 -7.1 7.1z"/><circle cx="6.8" cy="7.2" r="1.3"/>',
  pencil: '<path d="M4 16 l0.8-3.6 8.6-8.6 2.8 2.8 -8.6 8.6z M11.6 5.6 l2.8 2.8"/>',
  scale: '<path d="M10 3 v14 M5 17 h10 M4 6 h12 M4 6 l-2.4 5.2 a2.4 2.4 0 0 0 4.8 0z M16 6 l-2.4 5.2 a2.4 2.4 0 0 0 4.8 0z"/>',
  doc: '<path d="M5 2.8 h6.6 l3.6 3.6 V17.2 H5z M11.4 2.8 v3.8 h3.8 M7.6 10.4 h4.8 M7.6 13.4 h4.8"/>',
};
const icon = (name, x, y, tone, s = 1) => `<g transform="translate(${x} ${y}) scale(${s})" fill="none" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" class="s${tone}">${ICON[name]}</g>`;

// ---- hero ---------------------------------------------------------------------------------------------------
function hero() {
  const W = 1280;
  const H = 440;
  const n = 112;
  const sx = 64;
  const fw = 7;
  const gap = 2;
  const run = n * (fw + gap);
  const b = before.slice(0, n);
  const a = after.slice(0, n);
  const lateB = b.filter(Boolean).length;
  const lateA = a.filter(Boolean).length;
  const c = data.compare.cells[0];
  // The mark: a strip of frames, one of them late.
  const mark = [0, 1, 2, 3, 4].map((i) => `<rect x="${i * 12}" y="${i === 3 ? 0 : 6}" width="9" height="${i === 3 ? 36 : 24}" rx="2.5" class="${i === 3 ? 'bad' : 'good'}" opacity="${i === 3 ? 1 : 0.85}"/>`).join('');
  const strip = (y, list, label, tone, count, note) => `
${text(sx, y - 12, label, { size: 13, cls: tone, weight: 700, ls: 0.4 })}
${text(sx + run, y - 12, `${count} late of ${list.length}  ·  ${note}`, { size: 13, cls: 'muted', anchor: 'end' })}
${frames(sx, y, list, { w: fw, gap })}`;
  return svg(W, H, 'frameproof: frame-level performance evidence for web apps, built for coding agents. One scroll at 4x CPU, frame by frame: 35 late before the fix, 0 after.', `
${panel(W, H)}
<g transform="translate(64 58)">${mark}</g>
${text(136, 92, 'frameproof', { size: 58, weight: 750, ls: -1.5 })}
${text(66, 140, 'Frame-level performance evidence for web apps, built to be used by coding agents.', { size: 21, cls: 'muted' })}
${(() => {
  let x = 64;
  return ['Real Chrome, real GPU, out of sight', 'Verdicts with intervals', '~400 tokens of JSON']
    .map((s) => {
      const p = pill(x, 162, s, 'blue', { size: 13 });
      x += p.w + 10;
      return p.el;
    })
    .join('');
})()}
<g class="lift"><rect x="872" y="52" width="344" height="140" rx="16" class="card2"/></g>
${eyebrow(896, 84, 'scroll down · 4x CPU')}
${text(896, 140, String(median(c.base)), { size: 50, cls: 'bad', weight: 750 })}
<path d="M 970 124 h 30" class="sfaint" stroke-width="2.4" marker-end="url(#arrow)"/>
${text(1016, 140, String(median(c.head)), { size: 50, cls: 'good', weight: 750 })}
${text(1064, 118, 'late frames a step,', { size: 14, cls: 'muted' })}
${text(1064, 138, 'median of 32 runs', { size: 14, cls: 'muted' })}
${pill(896, 154, 'better · confirmed', 'good', { size: 12, h: 24, icon: '✓' }).el}
<line x1="64" x2="${W - 64}" y1="226" y2="226" class="line2" stroke-width="1"/>
${strip(272, b, 'BEFORE', 'bad', lateB, 'a layout forced on every scroll event')}
${strip(352, a, 'AFTER THE FIX', 'good', lateA, 'reads and writes batched once a frame')}
<g class="play" style="--run:${run}px"><rect x="${sx - 1}" y="252" width="2" height="136" rx="1" class="sink" opacity="0.5"/></g>
${text(sx, 414, 'One scroll of the sample app, every frame Chrome meant to show; red ones arrived late. Measured, not drawn: 2020 Intel MacBook, Chrome 156.', { size: 13, cls: 'faint' })}
`);
}

// ---- the loop -----------------------------------------------------------------------------------------------
function loop() {
  const W = 1280;
  const H = 360;
  const steps = [
    ['next', 'the one thing', 'to do now', 'blue', 'compass'],
    ['GOALS', 'asks the person', 'what matters', 'warn', 'person'],
    ['freezes', 'what froze,', 'to the line', 'bad', 'freeze'],
    ['price', 'a fix, before', 'making it', 'accent', 'tag'],
    ['change', 'one thing,', 'uncommitted', 'accent', 'pencil'],
    ['compare', 'alternated A/B,', 'a verdict', 'good', 'scale'],
    ['report', 'for a person,', 'worded to it', 'blue', 'doc'],
  ];
  const bw = 148;
  const gap = 26;
  const x0 = (W - (steps.length * bw + (steps.length - 1) * gap)) / 2;
  const y = 78;
  const ch = 146;
  let body = `${panel(W, H)}${eyebrow(x0, 48, 'The loop an agent follows')}`;
  steps.forEach(([name, l1, l2, tone, ic], i) => {
    const x = x0 + i * (bw + gap);
    body += `<g class="lift"><rect x="${x}" y="${y}" width="${bw}" height="${ch}" rx="14" class="card2"/></g>
<path d="M ${x + 14} ${y + 0.5} h ${bw - 28}" class="s${tone}" stroke-width="3" stroke-linecap="round"/>
<rect x="${x + 16}" y="${y + 20}" width="36" height="36" rx="10" class="${tone}soft"/>${icon(ic, x + 24, y + 28, tone)}
${text(x + bw - 18, y + 42, String(i + 1).padStart(2, '0'), { size: 13, cls: 'faint', weight: 700, anchor: 'end', font: 'mono' })}
${text(x + 18, y + 90, name, { size: 20, weight: 700, font: 'mono' })}
${text(x + 18, y + 114, l1, { size: 13, cls: 'muted' })}
${text(x + 18, y + 132, l2, { size: 13, cls: 'muted' })}`;
    if (i < steps.length - 1) body += `<path d="M ${x + bw + 5} ${y + ch / 2} h ${gap - 10}" class="sfaint" stroke-width="1.8" marker-end="url(#arrow)"/>`;
  });
  const xl = x0 + (steps.length - 1) * (bw + gap) + bw / 2;
  const xf = x0 + bw / 2;
  const yb = y + ch + 26;
  body += `<path d="M ${xl} ${y + ch + 6} V ${yb} H ${xf} V ${y + ch + 10}" fill="none" class="sfaint" stroke-width="1.8" stroke-dasharray="1 6" stroke-linecap="round" marker-end="url(#arrow)"/>
<rect x="${W / 2 - 74}" y="${yb - 12}" width="148" height="24" rx="12" class="card"/>${text(W / 2, yb + 5, 'and next again', { size: 12, cls: 'muted', anchor: 'middle', weight: 600 })}
<rect x="${x0}" y="${yb + 30}" width="${steps.length * bw + (steps.length - 1) * gap}" height="50" rx="14" class="warnsoft"/>
${icon('doc', x0 + 18, yb + 45, 'warn')}
${text(x0 + 50, yb + 61, 'perf/JOURNAL.md', { size: 15, cls: 'warn', weight: 700, font: 'mono' })}
${text(x0 + 212, yb + 61, 'every compare and price lands here, with its hypothesis: the next session starts where this one stopped', { size: 14, cls: 'muted' })}`;
  return svg(W, H, 'The loop: next, goals, freezes, price, change, compare, report, and next again; every compare and price lands in perf/JOURNAL.md', body);
}

// ---- what it found ------------------------------------------------------------------------------------------
function found() {
  const W = 1280;
  const rows = data.found;
  const rh = 58;
  const top = 104;
  const H = top + (rows.length + 1) * (rh + 10) + 34;
  // Each cause's cost, on a log scale so a 67 ms freeze and a 1.7 s block both read.
  const maxLog = Math.log10(2000);
  let body = `${panel(W, H)}${eyebrow(48, 48, 'What it found in the sample app, with no hints')}
${text(48, 76, 'examples/janky-shop plants four causes and a red herring. Each was named by its file and line.', { size: 15, cls: 'muted' })}`;
  rows.forEach((r, i) => {
    const y = top + i * (rh + 10);
    const bar = r.ms ? (Math.log10(r.ms) / maxLog) * 120 : 0;
    body += `<g class="lift"><rect x="48" y="${y}" width="${W - 96}" height="${rh}" rx="14" class="card2"/></g>
<circle cx="80" cy="${y + rh / 2}" r="13" class="goodsoft"/><path d="M73.5 ${y + rh / 2} l4.5 4.5 l9 -10" class="sgood" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
${pill(108, y + 16, r.where, 'blue', { size: 12, font: 'mono' }).el}
${text(232, y + 35, r.cause, { size: 16, weight: 650 })}
${text(640, y + 35, r.at, { size: 14.5, cls: 'bad', font: 'mono', weight: 600 })}
<rect x="880" y="${y + 24}" width="120" height="10" rx="5" class="badsoft"/><rect x="880" y="${y + 24}" width="${Math.max(10, bar)}" height="10" rx="5" class="bad" opacity="0.85"/>
${text(1012, y + 34, r.cost, { size: 13, cls: 'ink', weight: 650, font: 'mono' })}
${text(W - 70, y + 34, r.how, { size: 12.5, cls: 'faint', font: 'mono', anchor: 'end' })}`;
  });
  const y = top + rows.length * (rh + 10);
  body += `<rect x="48" y="${y}" width="${W - 96}" height="${rh}" rx="14" class="card2" stroke-dasharray="6 5"/>
<circle cx="80" cy="${y + rh / 2}" r="13" class="goodsoft"/><path d="M73.5 ${y + rh / 2} l4.5 4.5 l9 -10" class="sgood" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
${pill(108, y + 16, 'red herring', 'warn', { size: 12, font: 'mono' }).el}
${text(232, y + 35, 'a sorted copy of the catalog and a JSON snapshot: they look costly, measure as nothing, and were not blamed', { size: 15, cls: 'muted' })}`;
  body += text(48, H - 20, 'Cost bars on a log scale. freezes names what held a frame; journey covers setups and gaps no step measures; check + query count work at rest.', { size: 13, cls: 'faint' });
  return svg(W, H, 'What frameproof found in the sample app: four planted causes by file and line, with their cost, and the red herring not blamed', body);
}

// ---- a freeze's dossier -------------------------------------------------------------------------------------
function dossier() {
  const W = 1280;
  const H = 430;
  const d = data.dossier;
  const shown = before.slice(0, 104);
  const sx = 48;
  const sy = 110;
  const fw = 9;
  const gap = 2;
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
  const bx = sx + best[0] * (fw + gap);
  const bwid = (best[1] - best[0]) * (fw + gap) - gap;
  const total = d.task.reduce((s, t) => s + t.ms, 0);
  const barX = 48;
  const barW = W - 96;
  const barY = 226;
  const tone = { script: 'accent', layout: 'bad', paint: 'faint', style: 'warn' };
  let cx = barX;
  let segs = '';
  let legend = '';
  let lx = barX;
  for (const t of d.task) {
    const w = (t.ms / total) * barW;
    segs += `<rect x="${cx}" y="${barY}" width="${Math.max(4, w - 4)}" height="44" rx="8" class="${tone[t.kind]}" opacity="${t.kind === 'paint' ? 0.5 : 0.92}"/>`;
    if (w > width(`${t.ms} ms`, 14) + 24) segs += `<text x="${cx + 14}" y="${barY + 28}" class="sans" font-size="14" font-weight="700" fill="#ffffff">${t.ms} ms</text>`;
    cx += w;
    const label = `${t.label}${t.where ? '  ' : ''}`;
    legend += `<rect x="${lx}" y="${barY + 66}" width="12" height="12" rx="3" class="${tone[t.kind]}" opacity="${t.kind === 'paint' ? 0.5 : 0.92}"/>${text(lx + 20, barY + 77, `${t.label} ${t.ms} ms`, { size: 13.5, weight: 600 })}${t.where ? text(lx + 20 + width(`${t.label} ${t.ms} ms `, 13.5) + 8, barY + 77, t.where, { size: 13, cls: tone[t.kind], font: 'mono', weight: 600 }) : ''}`;
    lx += width(`${label}${t.label} ${t.ms} ms`, 13.5) + (t.where ? width(t.where, 13, 'mono') : 0) + 56;
  }
  return svg(W, H, `A freeze's dossier: ${d.verdict}`, `
${panel(W, H)}
${eyebrow(48, 48, 'freezes · one dossier')}
${text(48, 84, `f1 · ${d.where}`, { size: 24, weight: 700, font: 'mono' })}
${pill(300, 63, `in ${d.in} repetitions`, 'bad', { size: 12.5 }).el}
${text(W - 48, 84, 'frameproof show f1', { size: 14, cls: 'faint', font: 'mono', anchor: 'end' })}
${frames(sx, sy, shown, { w: fw, h: 40, gap })}
<rect x="${bx - 5}" y="${sy - 7}" width="${bwid + 10}" height="54" rx="8" fill="none" class="saccent" stroke-width="2.2"/>
<path d="M ${bx + bwid / 2} ${sy + 50} V ${barY - 12}" class="saccent" stroke-width="1.8" marker-end="url(#arrow)"/>
<rect x="${bx + bwid / 2 + 14}" y="${sy + 58}" width="${width(`${d.ms} ms with no new frame: the page's main thread, split by source line`, 14) + 26}" height="28" rx="14" class="accentsoft"/>
${text(bx + bwid / 2 + 27, sy + 77, `${d.ms} ms with no new frame: the page's main thread, split by source line`, { size: 14, cls: 'accent', weight: 600 })}
${segs}${legend}
<g class="lift"><rect x="48" y="${barY + 102}" width="${W - 96}" height="62" rx="14" class="card2"/></g>
<rect x="48" y="${barY + 102}" width="6" height="62" rx="3" class="bad"/>
${text(74, barY + 128, 'VERDICT', { size: 11, cls: 'muted', weight: 700, ls: 1.4 })}
${text(74, barY + 150, d.verdict, { size: 15, font: 'mono', weight: 500 })}
`);
}

// ---- compare ------------------------------------------------------------------------------------------------
function compare() {
  const W = 1280;
  const H = 500;
  const cells = data.compare.cells;
  const pw = (W - 96 - 24) / 2;
  let body = `${panel(W, H)}${eyebrow(48, 48, 'compare · the fix against the last commit, alternated in one session')}`;
  const maxV = 40;
  cells.forEach((c, k) => {
    const px = 48 + k * (pw + 24);
    const py = 70;
    const ph = 370;
    const top = py + 104;
    const bottom = py + ph - 52;
    const yOf = (v) => bottom - (v / maxV) * (bottom - top);
    body += `<g class="lift"><rect x="${px}" y="${py}" width="${pw}" height="${ph}" rx="16" class="card2"/></g>
${text(px + 26, py + 40, c.cell, { size: 19, weight: 700, font: 'mono' })}
${pill(px + 26, py + 52, 'better · confirmed on fresh repetitions', 'good', { size: 12, h: 24, icon: '✓' }).el}`;
    for (const v of [0, 10, 20, 30, 40]) body += `<line x1="${px + 58}" x2="${px + 360}" y1="${yOf(v)}" y2="${yOf(v)}" class="line2" stroke-width="1"/>${text(px + 46, yOf(v) + 4, String(v), { size: 11, cls: 'faint', anchor: 'end', font: 'mono' })}`;
    // Dots in rows: equal values side by side, wrapped so a tall column stays narrow.
    const col = (vals, cxm, tone, label) => {
      const seen = {};
      let dots = '';
      for (const v of vals) {
        const n = (seen[v] = (seen[v] ?? 0) + 1) - 1;
        const perRow = 11;
        const row = Math.floor(n / perRow);
        const i = n % perRow;
        const off = (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 7.2;
        dots += `<circle cx="${cxm + off}" cy="${yOf(v) - row * 7}" r="3.3" class="${tone}" opacity="0.85"/>`;
      }
      const med = median(vals);
      return `${dots}<line x1="${cxm - 48}" x2="${cxm + 48}" y1="${yOf(med)}" y2="${yOf(med)}" class="s${tone}" stroke-width="2.4" stroke-linecap="round"/>${text(cxm, bottom + 30, label, { size: 13, cls: 'muted', anchor: 'middle', weight: 600 })}`;
    };
    const ax = px + 140;
    const bx = px + 290;
    body += col(c.base, ax, 'bad', 'before') + col(c.head, bx, 'good', 'after');
    const mA = median(c.base);
    const mB = median(c.head);
    body += `<path d="M ${ax + 54} ${yOf(mA)} L ${bx - 54} ${yOf(mB) - 6}" class="sgood" stroke-width="2" fill="none" marker-end="url(#arrowgood)"/>
<rect x="${px + 380}" y="${py + 104}" width="${pw - 404}" height="${ph - 156}" rx="14" class="goodsoft" opacity="0.7"/>
${text(px + 400, py + 162, `${c.effect}`, { size: 54, cls: 'good', weight: 750 })}
${text(px + 400, py + 188, 'late frames a step', { size: 13.5, cls: 'muted' })}
${text(px + 400, py + 226, '95% interval', { size: 12, cls: 'faint', weight: 600 })}
${text(px + 400, py + 246, `[${c.interval[0]}, ${c.interval[1]}]`, { size: 14, font: 'mono', weight: 600 })}
${text(px + 400, py + 280, 'medians', { size: 12, cls: 'faint', weight: 600 })}
${text(px + 400, py + 300, `${mA} → ${mB}`, { size: 14, font: 'mono', weight: 600 })}`;
  });
  body += text(48, H - 22, 'Each dot is one repetition at 4x CPU, 32 a build. A first look that seems different only earns a confirmation run; the fresh 24 + 24 decide.', { size: 13, cls: 'faint' });
  return svg(W, H, 'Compare: the forced-layout fix is better by 24 and 19 late frames a step at 4x CPU, confirmed on fresh repetitions', body);
}

// ---- verdicts -----------------------------------------------------------------------------------------------
function verdicts() {
  const W = 1280;
  const H = 360;
  const list = [
    ['better', 'good', '↑', 'confirmed on fresh repetitions', '"Improved by X, interval Y"'],
    ['worse', 'bad', '↓', 'confirmed on fresh repetitions', '"Regressed by X"'],
    ['same', 'blue', '=', 'the interval fits inside the margin', '"No change larger than ±margin"'],
    ['inconclusive', 'warn', '?', "the data can't tell", '"Not known". Never "no difference"'],
    ['invalid', 'bad', '!', "the steps didn't do what they claim", 'Nothing yet: it may be a real bug'],
    ['not-measurable', 'accent', '×', "this machine can't measure now", '"Unmeasured", and why'],
  ];
  const cw = (W - 96 - 2 * 20) / 3;
  let body = `${panel(W, H)}${eyebrow(48, 48, 'Six verdicts, and what each lets you say')}`;
  list.forEach(([name, tone, glyph, means, say], i) => {
    const x = 48 + (i % 3) * (cw + 20);
    const y = 70 + Math.floor(i / 3) * 136;
    body += `<g class="lift"><rect x="${x}" y="${y}" width="${cw}" height="118" rx="16" class="card2"/></g>
<rect x="${x + 20}" y="${y + 20}" width="34" height="34" rx="10" class="${tone}soft"/>${text(x + 37, y + 43, glyph, { size: 19, cls: tone, weight: 800, anchor: 'middle' })}
${text(x + 66, y + 43, name, { size: 17, cls: tone, weight: 700, font: 'mono' })}
${text(x + 22, y + 78, means, { size: 14, cls: 'muted' })}
${text(x + 22, y + 100, say, { size: 14.5, weight: 650 })}`;
  });
  return svg(W, H, 'Six verdicts: better, worse, same, inconclusive, invalid, not-measurable', body);
}

// ---- terminal -----------------------------------------------------------------------------------------------
function terminal() {
  const W = 1280;
  const lines = [
    ['prompt', '$ ', 'npx -y github:Felichz/FrameProof next'],
    ['json', '', '{'],
    ['json', '', ' "status": "ok",'],
    ['json', '', ' "summary": "this machine isn\'t calibrated for open-cart, load: find its'],
    ['json', '', '   noise floor and what it can see, once (about 15 minutes; --background'],
    ['json', '', '   to keep working)",'],
    ['json', '', ' "machine": "darwin-i5-1038ng7-8c-chrome156-95adeb",'],
    ['next', '', ' "next": ["frameproof calibrate -s open-cart,load --throttle 1,4 --background"]'],
    ['json', '', '}'],
  ];
  const H = 96 + lines.length * 28 + 44;
  let body = `<g class="lift"><rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="18" class="card2"/></g>
<path d="M 0.5 18.5 a 18 18 0 0 1 18 -18 h ${W - 37} a 18 18 0 0 1 18 18 v 32 h -${W - 1} z" class="card"/>
<line x1="0.5" x2="${W - 0.5}" y1="50.5" y2="50.5" class="line"/>
<circle cx="30" cy="25.5" r="6.5" fill="#ff5f57"/><circle cx="52" cy="25.5" r="6.5" fill="#febc2e"/><circle cx="74" cy="25.5" r="6.5" fill="#28c840"/>
${text(W / 2, 31, 'your project — zsh', { size: 13, cls: 'muted', anchor: 'middle' })}`;
  lines.forEach(([kind, pre, s], i) => {
    const y = 96 + i * 28;
    if (kind === 'prompt') body += text(40, y, pre, { size: 17, cls: 'good', font: 'mono', weight: 700 }) + text(62, y, s, { size: 17, font: 'mono', weight: 600 });
    else if (kind === 'next') body += `<rect x="32" y="${y - 20}" width="${W - 64}" height="29" rx="7" class="bluesoft"/><rect x="32" y="${y - 20}" width="4" height="29" rx="2" class="blue"/>` + text(40, y, s, { size: 16, cls: 'blue', font: 'mono', weight: 650 });
    else body += text(40, y, s, { size: 16, cls: 'muted', font: 'mono' });
  });
  body += text(40, H - 24, 'next reads the project and the machine, and answers with the one thing to do now and its exact command.', { size: 14, cls: 'faint' });
  return svg(W, H, 'A terminal: next says the one thing to do now, with its exact command', body);
}

const out = { hero, loop, found, dossier, compare, verdicts, terminal };
for (const [name, make] of Object.entries(out)) {
  const file = at(`../docs/readme/${name}.svg`);
  writeFileSync(file, make());
  console.log('wrote', file);
}
