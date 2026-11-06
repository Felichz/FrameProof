// doctor: can this machine measure right now? Chrome, its version against the range the trace reader was
// checked on, a display, the load, and a self-test: a page with a known 200 ms freeze is traced, and the
// freeze must be found where it was put. That last part is what catches Chrome changing its trace format.
import { launch, sleep, vsyncOf } from '../browser.mjs';
import { countFrames, CATEGORIES, readFrames, readTrace } from '../core/trace.mjs';
import { findFreezes } from '../core/freezes.mjs';
import { busy, chromePath, chromeVersion, display, TESTED_CHROME, power } from '../machine.mjs';
import { readCalibration } from './_shared.mjs';

const PAGE = `<!doctype html><title>frameproof self-test</title><div id=b style="width:120px;height:120px;background:#c33"></div>
<script>let x=0;(function f(){x=(x+4)%600;b.style.transform='translateX('+x+'px)';requestAnimationFrame(f)})();
window.freeze=()=>setTimeout(function frameproofSelfTest(){const t=performance.now();while(performance.now()-t<200);},300);</script>`;

export async function selfTest({ headless = false } = {}) {
  const b = await launch({ headless });
  try {
    const page = await b.newPage();
    await page.goto('about:blank');
    const vsync = await vsyncOf(page);
    await page.setContent(PAGE);
    await sleep(500);
    await page.tracing.start({ categories: CATEGORIES.work });
    await sleep(300);
    await page.evaluate(() => performance.mark('perf:act'));
    await page.evaluate(() => window.freeze());
    await sleep(1200);
    const raw = JSON.parse(Buffer.from(await page.tracing.stop()).toString());
    const events = raw.traceEvents ?? raw;
    const t = readTrace(events, page.mainFrame()._id);
    const frames = readFrames(t);
    const counts = countFrames(frames, vsync.ms);
    const found = findFreezes(t, frames, { vsyncMs: vsync.ms, minMs: 100, placeTrace: (s) => ({ where: `${s.functionName || '?'}`, file: '', mapped: false }) });
    const ok = frames.length > 10 && found.some((f) => f.ms >= 150 && f.ms <= 320 && /busy/.test(f.verdict));
    return { ok, placement: b.placement, vsync, frames: counts.frames, late: counts.late, freeze: found[0] ? { ms: found[0].ms, verdict: found[0].verdict } : null };
  } finally {
    await b.close();
  }
}

export default async function doctor(ctx) {
  const path = chromePath();
  const version = chromeVersion(path);
  const major = Number(String(version ?? '0').split('.')[0]);
  const d = display();
  const evidence = [];
  const next = [];
  if (!path) {
    return { status: 'not-measurable', summary: 'Chrome is not installed where frameproof looks, and CHROME_PATH is not set', evidence: [{ looked: process.platform }], next: ['npx @puppeteer/browsers install chrome@stable', 'set CHROME_PATH to the executable it prints, then: frameproof doctor'] };
  }
  evidence.push({ chrome: version, path, tested: `${TESTED_CHROME.min}-${TESTED_CHROME.max}`, inRange: major >= TESTED_CHROME.min && major <= TESTED_CHROME.max });
  const load = await busy();
  const pw = power();
  evidence.push({ power: pw.battery ? `battery (${pw.why})` : 'plugged in, or no battery' });
  evidence.push({ cpu: `${Math.round(load.share * 100)}% in use`, busy: load.busy, top: load.top });
  evidence.push({ display: d.ok ? 'yes' : `no: ${d.why}`, note: d.note });
  let test = null;
  if (!ctx.flags.quick) {
    try {
      test = await selfTest({ headless: !d.ok || !!ctx.flags.headless });
      evidence.push({ selfTest: test.ok ? 'a 200 ms freeze was found where it was put' : 'FAILED: the known freeze was not found', window: test.placement, vsync: `${test.vsync.hz} fps measured (${test.vsync.snapped} Hz)`, frames: test.frames, freeze: test.freeze });
    } catch (e) {
      evidence.push({ selfTest: `could not run: ${e.message.split('\n')[0]}` });
    }
  }
  const cal = readCalibration(ctx);
  evidence.push({ machine: ctx.machine.id, calibrated: Object.keys(cal.cells).length ? `${Object.keys(cal.cells).length} cells` : 'no' });

  let status = 'ok';
  let summary;
  if (!d.ok) {
    status = 'not-measurable';
    summary = `frames can't be judged here (${d.why}); counted work can, headless: ledger and check`;
    next.push('frameproof ledger -s idle --headless', 'frameproof check --headless');
  } else if (test && !test.ok) {
    status = 'not-measurable';
    summary = `the self-test failed: a known freeze was not found in Chrome ${version}'s trace${major > TESTED_CHROME.max ? ', which is newer than the range checked: its trace format may have changed' : ''}. Verdicts would not be trustworthy`;
    next.push('report it, with this output, at github.com/Felichz/FrameProof/issues');
  } else if (pw.battery) {
    status = 'not-measurable';
    summary = `the machine runs on its battery (${pw.why}), which slows its CPU and GPU: plug it in to measure frames (or pass --battery to a command, knowing numbers won't compare with other runs)`;
    next.push('plug the machine in, then: frameproof doctor');
  } else if (load.busy) {
    status = 'not-measurable';
    summary = `the machine is busy (${Math.round(load.share * 100)}% CPU${load.top?.length ? `: ${load.top.map((p) => p.name).join(', ')}` : ''}): wait for it to end, and don't stop processes you didn't start`;
    next.push('frameproof doctor');
  } else {
    summary = `this machine can measure: Chrome ${version}${major > TESTED_CHROME.max || major < TESTED_CHROME.min ? ` (outside the checked ${TESTED_CHROME.min}-${TESTED_CHROME.max}, though the self-test passed)` : ''}, ${test ? `window ${test.placement}, ${test.vsync.snapped} Hz` : 'self-test skipped'}`;
    next.push('frameproof next');
  }
  return { status, summary, evidence, next };
}
