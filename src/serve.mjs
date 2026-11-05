// Serving a build: a static folder on a free local port, a project's own server started for the run, or a
// site that is already up (a URL), which nothing here starts or stops.
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createServer as netServer } from 'node:net';
import { extname, join, normalize, resolve } from 'node:path';
import { sleep } from './browser.mjs';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.cjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.map': 'application/json', '.webp': 'image/webp', '.avif': 'image/avif', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webm': 'video/webm', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.ico': 'image/x-icon', '.pdf': 'application/pdf', '.txt': 'text/plain', '.xml': 'application/xml', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.glsl': 'text/plain' };

export function freePort() {
  return new Promise((done, fail) => {
    const s = netServer();
    s.once('error', fail);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => done(port));
    });
  });
}

/** A static folder on 127.0.0.1 (or `host`), with ranges (video) and a single-page app's fallback to
    index.html. The host is the site the page is on: a page that loads parts of itself from another
    local name (localhost against 127.0.0.1) runs them in another process, so it matters which one. */
export async function serveStatic(dir, host = '127.0.0.1') {
  const root = resolve(dir);
  const fallback = join(root, 'index.html');
  const server = createServer((req, res) => {
    let p;
    try {
      p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    } catch {
      return res.writeHead(400).end();
    }
    let f = normalize(join(root, p));
    if (!f.startsWith(root)) return res.writeHead(403).end();
    if (existsSync(f) && statSync(f).isDirectory()) f = join(f, 'index.html');
    if (!existsSync(f)) {
      if (extname(p) || !existsSync(fallback)) return res.writeHead(404).end();
      f = fallback;
    }
    const size = statSync(f).size;
    const type = TYPES[extname(f).toLowerCase()] ?? 'application/octet-stream';
    const headers = { 'content-type': type, 'accept-ranges': 'bytes', 'cache-control': 'no-cache' };
    const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
    if (range) {
      const start = range[1] ? +range[1] : 0;
      const end = range[2] ? +range[2] : size - 1;
      res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
      return createReadStream(f, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...headers, 'content-length': size });
    createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(0, host, r));
  const name = host.includes(':') ? `[${host}]` : host;
  return { base: `http://${name}:${server.address().port}`, dist: root, close: () => new Promise((r) => server.close(r)) };
}

/** The project's own server, started in `cwd` for the run: `{port}` in its command and url is filled in. */
export async function serveCommand({ command, url, env = {}, timeoutMs = 60_000 }, cwd) {
  const port = await freePort();
  const fill = (s) => String(s).replaceAll('{port}', port);
  const child = spawn(fill(command), { cwd, shell: true, env: { ...process.env, PORT: String(port), ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
  let log = '';
  child.stdout.on('data', (d) => (log = (log + d).slice(-4000)));
  child.stderr.on('data', (d) => (log = (log + d).slice(-4000)));
  const base = fill(url ?? 'http://127.0.0.1:{port}').replace(/\/$/, '');
  const end = Date.now() + timeoutMs;
  let up = false;
  while (Date.now() < end && child.exitCode === null) {
    try {
      const r = await fetch(base, { signal: AbortSignal.timeout(2000) });
      if (r.status < 500) {
        up = true;
        break;
      }
    } catch {}
    await sleep(300);
  }
  const close = async () => {
    try {
      if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']);
      else process.kill(-child.pid, 'SIGTERM');
    } catch {}
  };
  if (!up) {
    await close();
    throw new Error(`the server never answered at ${base} (command: ${fill(command)}). Its last output: ${log.slice(-600)}`);
  }
  return { base, dist: cwd, close };
}

/** How a build is reached, from the config's `serve`. */
export async function serveBuild(config, build) {
  const s = config.serve ?? 'static';
  // A site already up (url:<url>): nothing is built or served here, so there is no folder to serve.
  if (build.url) return { base: build.url.replace(/\/$/, ''), dist: null, close: async () => {}, remote: true };
  if (s === 'static') return serveStatic(build.out);
  if (s.static) return serveStatic(build.out, s.host);
  if (s.url && !s.command) return { base: s.url.replace(/\/$/, ''), dist: null, close: async () => {}, remote: true };
  if (s.command) return serveCommand(s, build.dir);
  throw new Error(`serve must be 'static', { static: true, host }, { command, url } or { url }, got ${JSON.stringify(s)}`);
}
