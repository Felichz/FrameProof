// Is the display free? A blank page runs an animation the compositor draws alone, with nothing on the
// page's main thread, and its frames are read as any step's are. On a free machine none is late. When
// other apps keep the GPU busy (on the Mac where this was found: a chat app's renderer at 50% and the
// window server at 46%), this page drops frames too, and every scenario's frames would be about them:
// the scroll read GPU freezes in 4 of 4 repetitions on a commit that had none the day before.
import { launch, sleep, vsyncOf } from './browser.mjs';
import { CATEGORIES, countFrames, readFrames, readTrace } from './core/trace.mjs';

const PAGE = `<!doctype html><style>
html,body{margin:0;height:100%;overflow:hidden;background:#0b0b0f}
.a{position:fixed;inset:-25%;background:radial-gradient(circle at 30% 30%,#3fbf9a,transparent 60%),radial-gradient(circle at 70% 60%,#ff7a45,transparent 55%);animation:m 1.2s linear infinite alternate;will-change:transform}
@keyframes m{to{transform:translate3d(12%,8%,0) rotate(6deg)}}
</style><div class="a"></div>`;

/** The share of a quiet animation's frames that came late: over `limit`, the display is busy. */
export async function displayProbe({ headless = false, limit = 0.05 } = {}) {
  if (headless) return { ok: true, skipped: 'headless draws no frames to the screen' };
  const b = await launch({});
  try {
    const page = await b.newPage();
    await page.goto('about:blank');
    const vsync = await vsyncOf(page);
    await page.setContent(PAGE);
    await sleep(500);
    await page.tracing.start({ categories: CATEGORIES.work });
    await sleep(150);
    await page.evaluate(() => performance.mark('perf:act'));
    await sleep(1500);
    const raw = JSON.parse(Buffer.from(await page.tracing.stop()).toString());
    const t = readTrace(raw.traceEvents ?? raw, page.mainFrame()._id);
    const counts = countFrames(readFrames(t), vsync.ms);
    const share = counts.frames ? counts.late / counts.frames : 0;
    return { ok: share <= limit, late: counts.late, frames: counts.frames, share: +share.toFixed(3), longestMs: counts.longestFreezeMs, hz: vsync.snapped };
  } finally {
    await b.close();
  }
}
