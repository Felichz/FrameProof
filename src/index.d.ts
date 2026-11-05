// Types for the files a project writes: scenarios and budgets.
import type { Page } from 'puppeteer-core';

export interface Context {
  /** A Puppeteer page in a hidden Chrome window. */
  page: Page;
  /** The served build plus the config's `path`. */
  url: string;
  /** The served build's origin. */
  base: string;
  /** Shared between setup and the steps of one repetition. */
  state: Record<string, unknown>;
  sleep(ms: number): Promise<void>;
}

export interface Step {
  name: string;
  act(ctx: Context): unknown | Promise<unknown>;
  /** Resolves, or returns true, once the step really happened; false or a reason string means not yet. */
  done(ctx: Context): unknown | Promise<unknown>;
  /** ms traced after done (1200). */
  settle?: number;
  /** ms of quiet before the step (400). */
  before?: number;
  /** ms act may take (20000). */
  timeout?: number;
  /** ms done may take to come true (15000). */
  doneTimeout?: number;
}

export interface Scenario {
  name?: string;
  description?: string;
  /** Before each repetition, in a fresh page, unmeasured. */
  setup?(ctx: Context): unknown | Promise<unknown>;
  steps: Step[];
  /** Late frames a step that `same` needs: one number, or one per step. */
  margin?: number | Record<string, number>;
}

export interface WorkRun {
  rafs: number;
  timers: number;
  forced: number;
  styles: number;
  layouts: number;
  paints: number;
  scriptMs: number;
  styleMs: number;
  layoutMs: number;
  paintMs: number;
  gcMs: number;
  busyMs: number;
  styleElements: number;
  layoutObjects: number;
  /** Frames ('rAF') or timers ('timer') asked for from a source location matching `where`. */
  asked(kind?: 'rAF' | 'timer', where?: RegExp): number;
  /** Style or layout forced from script at a source location matching `where`. */
  forced(kind?: 'style' | 'layout', where?: RegExp): number;
  threads: Record<string, number>;
}

export interface Budget {
  scenario: string;
  step?: string;
  says: string;
  count(run: WorkRun): number;
  max: number;
}

export function scenario(name: string, definition: Omit<Scenario, 'name'>): Scenario;
export function sleep(ms: number): Promise<void>;
