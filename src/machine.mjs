// The machine: can it measure frames at all, is it free to right now, and what is it, so numbers from two
// machines are never put side by side.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { arch, cpus, freemem, platform, release, totalmem } from 'node:os';

const CANDIDATES = {
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta', '/Applications/Chromium.app/Contents/MacOS/Chromium'],
  win32: ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`],
  linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
};

/** Chrome's range the trace reader was checked on. Outside it, `doctor` warns: the format is internal. */
export const TESTED_CHROME = { min: 150, max: 160 };

export function chromePath() {
  if (process.env.CHROME_PATH) return existsSync(process.env.CHROME_PATH) ? process.env.CHROME_PATH : null;
  return (CANDIDATES[platform()] ?? CANDIDATES.linux).find((p) => p && existsSync(p)) ?? null;
}

export function chromeVersion(path) {
  if (!path) return null;
  try {
    // Chrome on Windows prints nothing for --version: the folder next to it is named by its version.
    if (platform() === 'win32') {
      const out = execFileSync('powershell', ['-NoProfile', '-Command', `(Get-Item '${path}').VersionInfo.ProductVersion`], { timeout: 8000 }).toString().trim();
      return out || null;
    }
    const out = execFileSync(path, ['--version'], { timeout: 8000 }).toString();
    return /(\d+\.\d+\.\d+\.\d+)/.exec(out)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Whether there is a display and a GPU to measure frames on: a container or a server has neither. */
export function display() {
  if (existsSync('/.dockerenv') || existsSync('/run/.containerenv')) return { ok: false, why: 'running in a container: no display and no GPU' };
  if (platform() === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) return { ok: false, why: 'no DISPLAY or WAYLAND_DISPLAY: no screen to draw frames on' };
  if (process.env.CI) return { ok: true, note: 'CI is set: shared runners are noisy and usually have no GPU, so frame verdicts there are weak' };
  return { ok: true };
}

const snap = () => cpus().map((c) => c.times);

/** The share of the CPU in use over `ms`, from the OS's own counters, and what is using it. */
export async function load(ms = 1000) {
  const a = snap();
  await new Promise((r) => setTimeout(r, ms));
  const b = snap();
  let busy = 0;
  let total = 0;
  b.forEach((t, i) => {
    const d = (k) => t[k] - a[i][k];
    const all = d('user') + d('nice') + d('sys') + d('idle') + d('irq');
    busy += all - d('idle');
    total += all;
  });
  return { busy: total ? busy / total : 0, top: topProcesses() };
}

/** The processes using the most CPU, by name only. Nothing is ever killed: the person is told. */
function topProcesses() {
  if (platform() === 'win32') return [];
  try {
    const out = execFileSync('ps', ['-A', '-o', '%cpu=,comm='], { timeout: 4000 }).toString();
    return out
      .split('\n')
      .map((l) => /^\s*([\d.]+)\s+(.*)$/.exec(l))
      .filter(Boolean)
      .map(([, cpu, comm]) => ({ cpu: Number(cpu), name: comm.split('/').at(-1).trim() }))
      .filter((p) => p.cpu >= 5 && !/^(ps|node)$/.test(p.name))
      .sort((x, y) => y.cpu - x.cpu)
      .slice(0, 4);
  } catch {
    return [];
  }
}

/** Busy over this share of the CPU, a machine gives numbers about its load, not about the page. */
export const BUSY_SHARE = Number(process.env.FRAMEPROOF_BUSY ?? 0.3);

export async function busy() {
  // Two looks, so a spike of a second doesn't send anyone away.
  const first = await load(800);
  if (first.busy < BUSY_SHARE) return { busy: false, share: first.busy };
  const second = await load(1500);
  return second.busy < BUSY_SHARE ? { busy: false, share: second.busy } : { busy: true, share: second.busy, top: second.top };
}

/** What the machine is: two runs are compared only when this is the same. */
export function fingerprint(chrome = chromeVersion(chromePath())) {
  const c = cpus()[0]?.model ?? 'cpu';
  const model = c.replace(/\(R\)|\(TM\)|CPU|Processor|@.*$/g, '').replace(/\s+/g, ' ').trim();
  const parts = {
    os: `${platform()} ${release()} ${arch()}`,
    cpu: model,
    cores: cpus().length,
    memoryGb: Math.round(totalmem() / 2 ** 30),
    chrome: chrome ?? 'none',
  };
  const hash = createHash('sha1').update(JSON.stringify(parts)).digest('hex').slice(0, 6);
  const short = `${platform()}-${model.split(' ').at(-1).toLowerCase()}-${parts.cores}c-chrome${String(chrome ?? '0').split('.')[0]}-${hash}`;
  return { id: short, ...parts, freeMemoryGb: +(freemem() / 2 ** 30).toFixed(1) };
}
