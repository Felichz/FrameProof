// Chrome, real and out of the way. A real window keeps the real GPU and the screen's vsync (headless
// composites differently), so the window is placed where nobody sees it, and it never takes the focus:
//
//   Windows, Linux   off every screen, at -10000,-10000 (what the original did, on Windows)
//   macOS            the system pulls an off-screen window back on screen, and a minimized one draws no
//                    frames at all. So Chrome starts with no window, and one is opened in the background
//                    against the right edge of the screen: a column of a pixel or two is all that shows.
//
// `--show` puts it on screen, `--headless` runs true headless (labeled: its frames aren't a screen's).
import puppeteer from 'puppeteer-core';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromePath } from './machine.mjs';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ARGS = [
  '--lang=en-US',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-background-timer-throttling',
  '--disable-features=CalculateNativeWinOcclusion,Translate,MediaRouter',
  '--disable-component-update',
  '--disable-sync',
  '--password-store=basic',
  '--use-mock-keychain',
];

/**
 * A browser and a way to open pages in its hidden window. `profile` keeps a profile across runs (its
 * caches, the GPU's compiled shaders among them, stay warm as in a visitor's browser); without it, a fresh
 * one starts cold.
 */
export async function launch({ profile, show = false, headless = false, viewport = { width: 1280, height: 800 } } = {}) {
  const executablePath = chromePath();
  if (!executablePath) throw new Error('Chrome not found');
  const mac = process.platform === 'darwin';
  const { width, height } = viewport;
  // The window is a little taller than the viewport: its own bar takes the rest.
  const win = { width, height: height + 87 };
  const args = [...ARGS];
  let cold = null;
  if (!headless) {
    if (mac && !show) args.push('--no-startup-window');
    else args.push(`--window-size=${win.width},${win.height}`, `--window-position=${show ? '0,0' : '-10000,-10000'}`);
  }
  const browser = await puppeteer.launch({
    executablePath,
    headless: headless ? true : false,
    defaultViewport: headless ? viewport : null,
    userDataDir: profile ?? (cold = mkdtempSync(join(tmpdir(), 'frameproof-'))),
    args,
    ignoreDefaultArgs: ['--enable-automation'],
    waitForInitialPage: !(mac && !show && !headless),
    protocolTimeout: 120_000,
  });
  let placement = headless ? 'headless' : show ? 'on screen' : mac ? 'right edge of the screen (macOS)' : 'off screen';
  let anchor = null;

  if (mac && !show && !headless) {
    // A window of its own, opened without taking the focus, at the far right. macOS keeps a sliver of it on
    // screen; the first page then reads the screen and pushes it as far as it goes.
    const cdp = await browser.target().createCDPSession();
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', newWindow: true, background: true, left: 100000, top: 100000, ...win });
    const target = await browser.waitForTarget((t) => t._targetId === targetId);
    anchor = await target.page();
    const s = await anchor.evaluate(() => ({ x: screenX, w: screen.availWidth, h: screen.availHeight, left: screen.availLeft ?? 0, top: screen.availTop ?? 0 }));
    const pc = await anchor.createCDPSession();
    const { windowId } = await pc.send('Browser.getWindowForTarget');
    await pc.send('Browser.setWindowBounds', { windowId, bounds: { left: s.left + s.w - 1, top: s.top + s.h - 1, ...win } });
    const now = await anchor.evaluate(() => ({ x: screenX, y: screenY }));
    const visible = Math.max(0, s.left + s.w - now.x);
    placement = `right edge of the screen (macOS keeps ${visible} px of it on screen)`;
  } else if (!headless) {
    [anchor] = await browser.pages();
  }

  /** A fresh page in the hidden window, sized to the viewport. */
  async function newPage() {
    let page;
    if (anchor) {
      // A new tab in the same window, in the background: the window stays where it is.
      const cdp = await browser.target().createCDPSession();
      const { windowId } = await (await anchor.createCDPSession()).send('Browser.getWindowForTarget').catch(() => ({}));
      const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', background: true, ...(windowId ? {} : { newWindow: true }) });
      const target = await browser.waitForTarget((t) => t._targetId === targetId);
      page = await target.page();
      await page.bringToFront().catch(() => {});
    } else page = await browser.newPage();
    if (!headless) await page.setViewport(null).catch(() => {});
    return page;
  }

  // A throwaway profile goes with its browser.
  const close = async () => {
    await browser.close().catch(() => {});
    if (cold) rmSync(cold, { recursive: true, force: true, maxRetries: 3 });
  };
  return { browser, newPage, placement, close };
}

/** The display's refresh, from the page's own frames, snapped to the rate it nearly is. */
export async function vsyncOf(page) {
  const hz = await page.evaluate(
    () =>
      new Promise((done) => {
        const ts = [];
        const tick = (t) => {
          ts.push(t);
          if (ts.length < 61) requestAnimationFrame(tick);
          else done(1000 / [...ts.slice(1).map((x, i) => x - ts[i])].sort((a, b) => a - b)[30]);
        };
        requestAnimationFrame(tick);
      }),
  );
  const rates = [60, 75, 90, 100, 120, 144, 165, 240];
  const near = rates.reduce((best, r) => (Math.abs(r - hz) < Math.abs(best - hz) ? r : best), 60);
  return { hz: Math.round(hz), snapped: near, ms: 1000 / near };
}
