// Real names. Every position in every output goes through here, so an agent never reads a minified one.
// `prepare` finds each script's map before a trace is read (next to the build's file, inline, or over http
// for a server); after that, lookups are synchronous.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import sourceMap from 'source-map-js';

const clean = (source) =>
  source
    .replace(/^webpack:\/\/[^/]*\//, '')
    .replace(/^\/?@fs\//, '')
    .replace(/\?.*$/, '')
    .replace(/^(\.\.?\/)+/, '')
    .replace(/^.*?\/(src\/|app\/|pages\/|lib\/|components\/|node_modules\/)/, '$1');

const MAP_COMMENT = /\/[/*][#@]\s*sourceMappingURL=([^\s*]+)/g;

async function loadMap(url, dist) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(url).pathname);
  } catch {
    return null;
  }
  const local = dist ? join(dist, pathname) : null;
  let text = null;
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
    const c = line >= 0 ? consumers.get(url) : null;
    if (c) {
      const o = c.originalPositionFor({ line: line + 1, column: col ?? 0 });
      if (o.source) {
        const file = clean(o.source);
        const fn = o.name || name;
        return { file, where: `${file}:${o.line}${fn ? ' ' + fn : ''}`, mapped: true };
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
            if (map) consumers.set(u, new sourceMap.SourceMapConsumer(map));
          } catch {}
        }),
      );
    },
    /** How many scripts of the page have maps: a build without them names no source lines. */
    coverage: () => ({ scripts: consumers.size, mapped: [...consumers.values()].filter(Boolean).length }),
    consumer: (url) => consumers.get(url) ?? null,
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
