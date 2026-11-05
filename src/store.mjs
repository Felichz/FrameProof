// Runs are plain files: `.frameproof/runs/<id>/run.json` says what was asked and what came of it, and
// `steps.jsonl` holds one line per measured step, written as it is measured, so a partial run can be read
// at any time. Traces are kept gzipped next to them when a later command may need them (`show`, `query`).
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

export const dirOf = (root) => join(root, '.frameproof');

export function ensure(path) {
  mkdirSync(path, { recursive: true });
  return path;
}

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/** Written to a temporary name and renamed, so a reader never sees half a file. */
export function writeJson(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 1));
  renameSync(tmp, file);
}

export function newRunId(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  return `${stamp}-${randomBytes(2).toString('hex')}`;
}

export class Run {
  constructor(root, id, meta) {
    this.root = root;
    this.id = id;
    this.dir = ensure(join(dirOf(root), 'runs', id));
    this.file = join(this.dir, 'run.json');
    this.meta = meta ?? readJson(this.file) ?? {};
  }

  static create(root, meta, id = newRunId()) {
    // The process that measures: a background run's child replaces it. A run whose process is gone and
    // that never finished reads as stopped, never as running forever.
    const run = new Run(root, id, { id, started: new Date().toISOString(), state: 'running', pid: process.pid, ...meta });
    run.save();
    writeFileSync(join(dirOf(root), 'latest'), id);
    return run;
  }

  static open(root, id) {
    const want = id ?? latestRun(root);
    if (!want) return null;
    const file = join(dirOf(root), 'runs', want, 'run.json');
    return existsSync(file) ? new Run(root, want) : null;
  }

  save(patch = {}) {
    Object.assign(this.meta, patch);
    writeJson(this.file, this.meta);
  }

  /** 'running', 'done', or 'stopped' (still marked running, and its process is gone). */
  state() {
    const m = new Run(this.root, this.id).meta;
    if (m.state !== 'running') return m.state ?? 'done';
    return m.pid && !alive(m.pid) ? 'stopped' : 'running';
  }

  finish(result) {
    this.save({ state: 'done', finished: new Date().toISOString(), result });
  }

  addStep(record) {
    appendFileSync(join(this.dir, 'steps.jsonl'), JSON.stringify(record) + '\n');
  }

  steps() {
    const file = join(this.dir, 'steps.jsonl');
    if (!existsSync(file)) return [];
    return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  }

  keepTrace(name, events) {
    const dir = ensure(join(this.dir, 'traces'));
    const file = join(dir, `${name}.json.gz`);
    writeFileSync(file, gzipSync(JSON.stringify(events)));
    return `traces/${name}.json.gz`;
  }

  readTrace(rel) {
    return JSON.parse(gunzipSync(readFileSync(join(this.dir, rel))).toString());
  }
}

export function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM: it exists, under another user.
    return e.code === 'EPERM';
  }
}

export function latestRun(root) {
  try {
    return readFileSync(join(dirOf(root), 'latest'), 'utf8').trim() || null;
  } catch {
    return null;
  }
}

/** Runs, newest first, with their command and state. */
export function listRuns(root) {
  const dir = join(dirOf(root), 'runs');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .sort()
    .reverse()
    .map((id) => readJson(join(dir, id, 'run.json')))
    .filter(Boolean);
}
