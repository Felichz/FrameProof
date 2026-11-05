// The project: where it is, how it builds and serves, where its scenarios and budgets live. Everything has
// a default, so the built-in scenarios run on a project with no config at all.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const CONFIG_FILES = ['frameproof.config.js', 'frameproof.config.mjs'];

/** The project's root: the nearest folder up with a config, else with a package.json or .git, else here. */
export function findRoot(from = process.cwd()) {
  let dir = resolve(from);
  let fallback = null;
  for (;;) {
    if (CONFIG_FILES.some((f) => existsSync(join(dir, f)))) return dir;
    if (!fallback && (existsSync(join(dir, 'package.json')) || existsSync(join(dir, '.git')))) fallback = dir;
    const up = dirname(dir);
    if (up === dir) return fallback ?? resolve(from);
    dir = up;
  }
}

export const DEFAULTS = {
  build: null,
  serve: 'static',
  path: '/',
  scenarios: './perf/scenarios',
  budgets: './perf/budgets.js',
  goals: './perf/GOALS.md',
  journal: './perf/JOURNAL.md',
  viewport: { width: 1280, height: 800 },
  /** A step's freeze counts as an episode, for the rare-stall test, from this long. */
  episodeMs: 100,
  /** The margin `same` needs, in late frames a step, when calibrate hasn't set one. */
  margin: 2,
  journey: null,
};

export async function loadConfig(root) {
  const file = CONFIG_FILES.map((f) => join(root, f)).find(existsSync);
  let user = {};
  if (file) {
    const mod = await import(`${pathToFileURL(file).href}?t=${Date.now()}`);
    user = mod.default ?? {};
  }
  const config = { ...DEFAULTS, ...user, viewport: { ...DEFAULTS.viewport, ...user.viewport } };
  if (typeof config.build === 'string') config.build = { command: config.build };
  if (config.build && !config.build.out) config.build.out = guessOut(root);
  config.out = config.build?.out ?? user.out ?? guessOut(root);
  config.file = file ?? null;
  config.root = root;
  return config;
}

/** Where a static project's files are, without a build: the usual folders, else the root. */
function guessOut(root) {
  for (const d of ['dist', 'build', 'out', 'public']) if (existsSync(join(root, d, 'index.html'))) return d;
  return '.';
}

export const at = (config, rel) => resolve(config.root, rel);

/** What the project is built with, from its package.json: the defaults `init` writes. */
export function detectFramework(root) {
  const pkgFile = join(root, 'package.json');
  if (!existsSync(pkgFile)) {
    return { name: 'static', build: null, out: existsSync(join(root, 'public', 'index.html')) ? 'public' : '.', serve: 'static', maps: 'none needed: the files are the sources' };
  }
  const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const has = (n) => n in deps;
  const script = pkg.scripts?.build ? 'npm run build' : null;
  if (has('next')) return { name: 'next', build: script ?? 'npx next build', out: '.next', serve: { command: 'npx next start -p {port}', url: 'http://localhost:{port}' }, maps: "set productionBrowserSourceMaps: true in next.config" };
  if (has('@sveltejs/kit')) return { name: 'sveltekit', build: script, out: 'build', serve: { command: 'npx vite preview --port {port} --strictPort', url: 'http://localhost:{port}' }, maps: 'set build.sourcemap: true in vite.config' };
  if (has('astro')) return { name: 'astro', build: script ?? 'npx astro build', out: 'dist', serve: 'static', maps: 'set vite.build.sourcemap: true in astro.config' };
  if (has('vite')) return { name: 'vite', build: script ?? 'npx vite build', out: 'dist', serve: 'static', maps: 'set build.sourcemap: true in vite.config' };
  if (has('react-scripts')) return { name: 'create-react-app', build: script, out: 'build', serve: 'static', maps: 'on by default' };
  if (has('@angular/core')) return { name: 'angular', build: script, out: 'dist', serve: 'static', maps: 'set sourceMap: true in angular.json' };
  if (has('webpack')) return { name: 'webpack', build: script, out: 'dist', serve: 'static', maps: "set devtool: 'source-map'" };
  if (script) return { name: 'node', build: script, out: guessOut(root), serve: 'static', maps: 'enable source maps in the build' };
  return { name: 'static', build: null, out: guessOut(root), serve: 'static', maps: 'none needed: the files are the sources' };
}
