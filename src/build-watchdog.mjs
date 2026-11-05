// Runs a build command for frameproof and dies with it: the command gets a process group of its own, and
// if frameproof goes away (stopped, killed) the whole group is ended, so no build outlives its run and
// holds the cache folder (`EBUSY` on the next run, seen on Windows). Usage: node build-watchdog.mjs <pid> <command>
import { spawn, spawnSync } from 'node:child_process';

const [parent, command] = process.argv.slice(2);
const win = process.platform === 'win32';
const child = spawn(command, { shell: true, stdio: 'inherit', detached: !win });

const end = () => {
  try {
    if (win) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
    else process.kill(-child.pid, 'SIGTERM');
  } catch {}
};
const parentAlive = () => {
  try {
    process.kill(Number(parent), 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};
const watch = setInterval(() => {
  if (!parentAlive()) {
    end();
    process.exit(130);
  }
}, 500);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => (end(), process.exit(130)));
child.on('exit', (code, signal) => {
  clearInterval(watch);
  process.exit(code ?? (signal ? 1 : 0));
});
