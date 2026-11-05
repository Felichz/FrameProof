// What a comparison compares: builds named the way a person names them.
//
//   worktree        the files as they are now, uncommitted changes included (built in place)
//   HEAD, main, a1b2c3d, HEAD~2 ...
//                   a commit: its files exported with `git archive` into a cache, the project's
//                   node_modules linked in when the lockfile is the same (installed otherwise), built
//                   there; cached by commit, so a ref is built once
//   dir:<path>      a folder that is already built
//   url:<url>       a site that is already up; nothing is built or served
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { dirOf, ensure } from './store.mjs';

const git = (root, args, opts = {}) => execFileSync('git', args, { cwd: root, encoding: opts.encoding ?? 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28, ...opts });

export function isGit(root) {
  try {
    return git(root, ['rev-parse', '--is-inside-work-tree']).trim() === 'true';
  } catch {
    return false;
  }
}

export function resolveRef(root, ref) {
  return git(root, ['rev-parse', '--verify', `${ref}^{commit}`]).trim();
}

/** Uncommitted changes that could change what a build serves (the tool's own files aside). */
export function dirtyFiles(root) {
  if (!isGit(root)) return [];
  return git(root, ['status', '--porcelain', '--untracked-files=all'])
    .split('\n')
    .filter(Boolean)
    .map((l) => l.slice(3).replace(/^"|"$/g, '').split(' -> ').at(-1))
    .filter((f) => !ignoredForBuild(f));
}

const ignoredForBuild = (f) => /^(perf\/|\.frameproof\/|frameproof\.config\.m?js$|AGENTS\.md$|CLAUDE\.md$|\.claude\/)/.test(f);

/** A key for the files as they are: HEAD, and each changed file's size and time. */
/** How a build is made, as part of its cache key: the same files built with another command or another
    environment (SOURCEMAP=1, say) are another build (ADR 0001 D3). */
function recipe(config) {
  const b = config.build ?? {};
  return JSON.stringify({ command: b.command ?? null, env: b.env ?? {}, out: b.out ?? config.out ?? null });
}

function worktreeKey(root, config) {
  const h = createHash('sha1');
  h.update(recipe(config));
  if (isGit(root)) {
    h.update(git(root, ['rev-parse', 'HEAD']).trim());
    for (const f of dirtyFiles(root)) {
      const p = join(root, f);
      h.update(f);
      if (existsSync(p)) {
        const s = statSync(p);
        h.update(`${s.size}:${s.mtimeMs}`);
      }
    }
  } else h.update(String(Date.now()));
  return `wt-${h.digest('hex').slice(0, 10)}`;
}

const WATCHDOG = fileURLToPath(new URL('./build-watchdog.mjs', import.meta.url));

/** A build command, under a watchdog that ends it if frameproof goes away (ADR 0001 D12). */
function run(command, cwd, env, log) {
  const r = spawnSync(process.execPath, [WATCHDOG, String(process.pid), command], { cwd, env: { ...process.env, ...env }, encoding: 'utf8', maxBuffer: 1 << 26 });
  writeFileSync(log, `$ ${command}\n${r.stdout ?? ''}\n${r.stderr ?? ''}`);
  if (r.status !== 0) {
    const tail = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split('\n').slice(-12).join('\n');
    throw new Error(`\`${command}\` failed in ${cwd} (exit ${r.status}). Last lines:\n${tail}\nFull log: ${log}`);
  }
}

const LOCKS = [
  ['package-lock.json', 'npm ci --no-audit --no-fund'],
  ['pnpm-lock.yaml', 'pnpm install --frozen-lockfile'],
  ['yarn.lock', 'yarn install --frozen-lockfile'],
  ['bun.lockb', 'bun install --frozen-lockfile'],
];

/** The project's dependencies in an exported tree: linked when its lockfile is the project's, else installed. */
function dependencies(root, dir, log) {
  if (!existsSync(join(dir, 'package.json'))) return 'none';
  for (const [lock, install] of LOCKS) {
    if (!existsSync(join(dir, lock))) continue;
    const same = existsSync(join(root, lock)) && readFileSync(join(root, lock)).equals(readFileSync(join(dir, lock)));
    if (same && existsSync(join(root, 'node_modules'))) {
      symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
      return 'linked';
    }
    run(install, dir, {}, log);
    return 'installed';
  }
  if (existsSync(join(root, 'node_modules'))) {
    symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    return 'linked';
  }
  return 'none';
}

/**
 * A build ready to serve: { ref, key, label, dir, out, url? }. `fresh` rebuilds a cached ref. Building the
 * worktree runs the project's build in place, as a person would, and copies its output to the cache.
 */
export function prepareBuild(config, ref = 'worktree', { fresh = false } = {}) {
  const root = config.root;
  if (ref.startsWith('url:')) return { ref, key: ref, label: ref.slice(4), url: ref.slice(4), out: null, dir: null };
  if (ref.startsWith('dir:')) {
    const out = resolve(root, ref.slice(4));
    if (!existsSync(out)) throw new Error(`no folder at ${out}`);
    return { ref, key: `dir-${createHash('sha1').update(out).digest('hex').slice(0, 8)}`, label: relative(root, out) || '.', out, dir: out };
  }
  const cacheRoot = ensure(join(dirOf(root), 'builds'));
  const outRel = config.build?.out ?? config.out ?? '.';

  if (ref === 'worktree' || ref === '.') {
    if (!config.build?.command) return { ref: 'worktree', key: worktreeKey(root, config), label: 'worktree', dir: root, out: resolve(root, outRel) };
    const key = worktreeKey(root, config);
    const cache = join(cacheRoot, key);
    const out = join(cache, 'out');
    if (!fresh && existsSync(join(cache, 'done'))) return { ref: 'worktree', key, label: 'worktree', dir: root, out, cached: true };
    ensure(cache);
    run(config.build.command, root, config.build.env, join(cache, 'build.log'));
    rmSync(out, { recursive: true, force: true });
    cpSync(resolve(root, outRel), out, { recursive: true, dereference: true });
    writeFileSync(join(cache, 'done'), new Date().toISOString());
    return { ref: 'worktree', key, label: 'worktree', dir: root, out };
  }

  if (!isGit(root)) throw new Error(`"${ref}" is a git ref, and ${root} is not a git repository: use worktree, dir:<path> or url:<url>`);
  const sha = resolveRef(root, ref);
  const key = `${sha.slice(0, 12)}-${createHash('sha1').update(recipe(config)).digest('hex').slice(0, 6)}`;
  const cache = join(cacheRoot, key);
  const dir = join(cache, 'src');
  const label = `${ref}${ref === sha ? '' : ` (${sha.slice(0, 7)})`}`;
  const out = resolve(dir, outRel);
  if (!fresh && existsSync(join(cache, 'done'))) return { ref, sha, key, label, dir, out, cached: true };
  rmSync(cache, { recursive: true, force: true });
  ensure(dir);
  const tar = git(root, ['archive', '--format=tar', sha], { encoding: 'buffer' });
  // Extracted with cwd, not `-C <path>`: Git's tar on Windows reads `C:\...` as a remote host and fails.
  // Checked: a failed export used to leave an empty folder, and npm then built the project it sat in.
  const untar = spawnSync('tar', ['-x'], { cwd: dir, input: tar, encoding: 'utf8' });
  if (untar.status !== 0 || (config.build?.command && !existsSync(join(dir, 'package.json')))) {
    throw new Error(`exporting ${sha.slice(0, 7)} failed (tar exit ${untar.status}): ${(untar.stderr ?? '').trim().slice(0, 300)}`);
  }
  const log = join(cache, 'build.log');
  if (config.build?.command) {
    const deps = dependencies(root, dir, log);
    run(config.build.command, dir, config.build.env, log);
    writeFileSync(join(cache, 'deps'), deps);
  }
  if (!existsSync(out)) throw new Error(`building ${label} left no ${outRel} folder (see ${log})`);
  writeFileSync(join(cache, 'done'), new Date().toISOString());
  return { ref, sha, key, label, dir, out };
}

/** Files changed between two refs (worktree counts as one). */
export function changedFiles(root, base, head) {
  if (!isGit(root)) return [];
  const args = head === 'worktree' || head === '.' ? ['diff', '--name-only', base] : ['diff', '--name-only', base, head];
  const files = new Set(git(root, args).split('\n').filter(Boolean));
  if (head === 'worktree' || head === '.') for (const f of git(root, ['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean)) files.add(f);
  return [...files];
}
