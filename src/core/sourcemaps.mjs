// Real names. Every position in every output goes through here, so an agent never reads a minified one.
// `prepare` finds each script's map before a trace is read (next to the build's file, inline, or over http
// for a server); after that, lookups are synchronous.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import sourceMap from 'source-map-js';

// From the first project folder in the path on: `src/components/A.astro` stays whole (an earlier rule cut
// it to `components/A.astro`, while `src/scripts/x.ts` kept its `src/`).
const ROOTS = /(^|\/)(src|app|pages|lib|components|node_modules)\//;
const clean = (source) => {
  const s = source
    .replace(/^webpack:\/\/[^/]*\//, '')
    .replace(/^\/?@fs\//, '')
    .replace(/\?.*$/, '')
    .replace(/^(\.\.?\/)+/, '');
  const m = ROOTS.exec(s);
  return m ? s.slice(m.index + m[1].length) : s;
};

const MAP_COMMENT = /\/[/*][#@]\s*sourceMappingURL=([^\s*]+)/g;

// A built file by its name, wherever it landed in the build (Astro writes an inline script's map comment
// relative to the page, and puts the map in _astro/).
const builtFiles = new Map();
function findBuilt(dist, name) {
  if (!builtFiles.has(dist)) {
    const all = new Map();
    const walk = (dir, depth) => {
      if (depth > 4) return;
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) walk(join(dir, e.name), depth + 1);
        else if (e.name.endsWith('.map') && !all.has(e.name)) all.set(e.name, join(dir, e.name));
      }
    };
    try {
      walk(dist, 0);
    } catch {}
    builtFiles.set(dist, all);
  }
  return builtFiles.get(dist).get(name) ?? null;
}

/** A page's inline scripts, each with the position its body starts at in the document (0-based) and its
    own map: the page's url alone would name them all by one line, and the last map comment would win. */
function inlineMaps(html, local, dist) {
  const out = [];
  const starts = [0];
  for (let i = html.indexOf('\n'); i >= 0; i = html.indexOf('\n', i + 1)) starts.push(i + 1);
  const at = (offset) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo, col: offset - starts[lo] };
  };
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=/.test(m[1]) || !m[2].trim()) continue;
    const comment = [...m[2].matchAll(MAP_COMMENT)].at(-1)?.[1];
    if (!comment) continue;
    let map = null;
    try {
      if (comment.startsWith('data:')) {
        const [, body] = comment.split(',', 2);
        map = JSON.parse(comment.includes(';base64') ? Buffer.from(body, 'base64').toString() : decodeURIComponent(body));
      } else {
        const beside = join(dirname(local), comment);
        const file = existsSync(beside) ? beside : dist ? findBuilt(dist, comment.split('/').at(-1)) : null;
        if (file) map = JSON.parse(readFileSync(file, 'utf8'));
      }
    } catch {}
    if (!map) continue;
    const bodyAt = m.index + m[0].indexOf('>') + 1;
    out.push({ ...at(bodyAt), end: at(bodyAt + m[2].length), map });
  }
  return out.length ? { inline: out } : null;
}

async function loadMap(url, dist) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(url).pathname);
  } catch {
    return null;
  }
  let local = dist ? join(dist, pathname) : null;
  if (local && existsSync(local) && statSync(local).isDirectory()) local = join(local, 'index.html');
  let text = null;
  if (local && existsSync(local) && /\.html?$/.test(local)) return inlineMaps(readFileSync(local, 'utf8'), local, dist);
  if (local && existsSync(local)) {
    const beside = `${local}.map`;
    if (existsSync(beside)) return JSON.parse(readFileSync(beside, 'utf8'));
    text = readFileSync(local, 'utf8');
  } else if (/^https?:/.test(url)) {
    try {
      const res = await fetch(url);
      if (res.ok) text = await res.text();
    } catch {}
  }
  if (!text) return null;
  const comment = [...text.matchAll(MAP_COMMENT)].at(-1)?.[1];
  if (!comment) return null;
  if (comment.startsWith('data:')) {
    const [, body] = comment.split(',', 2);
    return JSON.parse(comment.includes(';base64') ? Buffer.from(body, 'base64').toString() : decodeURIComponent(body));
  }
  if (local) {
    const file = join(dirname(local), comment);
    if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  }
  try {
    const res = await fetch(new URL(comment, url));
    if (res.ok) return await res.json();
  } catch {}
  return null;
}

/** Every script url a trace mentions. */
export function scriptUrls(events) {
  const urls = new Set();
  const add = (u) => u && /^https?:/.test(u) && urls.add(u);
  for (const e of events) {
    const d = e.args?.data;
    add(d?.url);
    for (const s of d?.stackTrace ?? []) add(s.url);
    for (const s of e.args?.beginData?.stackTrace ?? []) add(s.url);
    for (const n of d?.cpuProfile?.nodes ?? []) add(n.callFrame?.url);
  }
  return urls;
}

export function placer({ dist, base = '' } = {}) {
  const consumers = new Map();
  const place = (url, line, col, name) => {
    if (!url) return { file: '(native)', where: name || '(native)', mapped: false };
    if (url.startsWith('pptr:')) return { file: '(frameproof)', where: '(frameproof)', mapped: false, tool: true };
    let c = line >= 0 ? consumers.get(url) : null;
    // A page's inline script: its own map, at the position inside the script.
    if (c?.inline) {
      const seg = c.inline.find((x) => (line > x.line || (line === x.line && col >= x.col)) && (line < x.end.line || (line === x.end.line && col <= x.end.col)));
      if (seg) {
        const genLine = line - seg.line;
        col = genLine === 0 ? col - seg.col : col;
        line = genLine;
      }
      c = seg?.consumer ?? null;
    }
    if (c) {
      const o = c.originalPositionFor({ line: line + 1, column: col ?? 0 });
      if (o.source) {
        const file = clean(o.source);
        const fn = o.name || name;
        // An Astro component's <script> blocks are numbered from 0 and their lines count from the block:
        // without the block's number, `Work.astro:36` is in any of them, and none is line 36 of the file.
        const block = /\.astro\?astro&type=script&index=(\d+)/.exec(o.source)?.[1];
        const at = block ? `${file} script ${block}, line ${o.line}` : `${file}:${o.line}`;
        return { file, where: `${at}${fn ? ' ' + fn : ''}`, mapped: true };
      }
    }
    const short = url.replace(base, '').replace(/\?.*$/, '') || url;
    return { file: short, where: `${short}:${line + 1}${name ? ' ' + name : ''}`, mapped: false };
  };
  return {
    place,
    /** A trace's positions are 1-based, a CPU profile's 0-based. */
    placeTrace: (s) => place(s.url, (s.lineNumber ?? 1) - 1, (s.columnNumber ?? 1) - 1, s.functionName),
    async prepare(urls) {
      await Promise.all(
        [...urls].filter((u) => !consumers.has(u)).map(async (u) => {
          consumers.set(u, null);
          try {
            const map = await loadMap(u, dist);
            if (map?.inline) {
              for (const seg of map.inline) seg.consumer = new sourceMap.SourceMapConsumer(seg.map);
              consumers.set(u, map);
            } else if (map) consumers.set(u, new sourceMap.SourceMapConsumer(map));
          } catch {}
        }),
      );
    },
    /** How many scripts of the page have maps: a build without them names no source lines. */
    coverage: () => ({ scripts: consumers.size, mapped: [...consumers.values()].filter(Boolean).length }),
    // (A page's inline scripts have one map each: there is no single consumer for the page.)
    consumer: (url) => {
      const c = consumers.get(url) ?? null;
      return c?.inline ? null : c;
    },
  };
}

/** The source files a script's used ranges come from. `text` is the script, `ranges` character offsets. */
export function sourcesUsed(consumer, text, ranges) {
  const starts = [0];
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const used = (offset) => {
    let lo = 0;
    let hi = sorted.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (offset < sorted[mid].start) hi = mid - 1;
      else if (offset >= sorted[mid].end) lo = mid + 1;
      else return true;
    }
    return false;
  };
  const files = new Set();
  consumer.eachMapping((m) => {
    if (m.source && used((starts[m.generatedLine - 1] ?? 0) + m.generatedColumn)) files.add(clean(m.source));
  });
  return files;
}
