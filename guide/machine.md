# The machine

## doctor

`frameproof doctor` checks Chrome (and its version against the range the trace reader was checked on),
the display, the load, and runs a self-test: a page with a known 200 ms freeze is traced, and the freeze
must be found. If it isn't, verdicts on this Chrome can't be trusted (its trace format is internal and may
change); `doctor` says so.

## The window

frameproof drives a real Chrome window, since headless composites differently, and keeps it out of the
way: off screen on Windows and Linux; on macOS, which pulls off-screen windows back on screen, it opens
the window in the background against the right edge of the screen, a column of a pixel or two. It never
takes the focus. `--show` puts it on screen; `--headless` runs headless, labeled.

## Busy machines

Before measuring frames, frameproof samples the CPU. Over 30% in use (`FRAMEPROOF_BUSY=0.3`), the result is
`not-measurable`, with what is using it. Don't stop processes you didn't start: tell the person, and wait.
`--ignore-load` skips the check, at your own risk.

## Calibration

`frameproof calibrate -s <scenarios> --throttle 1,4` runs the build against itself (A/A) and with a known
freeze injected. It stores, per machine, each cell's spread and the margin `same` will need; compare uses
them. A false claim in the A/A, or a missed freeze, is reported.

## Where it can't run

A container or a server has no display and no GPU: `doctor` returns `not-measurable` for frames, and
`next` falls back to `ledger` and `check` on counted work, headless, labeled as such. Never compare numbers
from two machines, or two days: compare runs both builds in one session for that reason.

## Staying awake

A machine that sleeps, or dims its display, draws no frames: a run left alone would stop halfway. On
macOS every command that measures keeps the machine and its display awake for as long as it runs
(`caffeinate -dims -w <its pid>`), and declares the user active every 25 seconds (`caffeinate -u`), so a Mac
set to lock after a while idle doesn't lock halfway through a run (a locked screen hides Chrome's window).
It lets go when the command ends, however it ends (the last declaration of activity runs out within 30 s); nothing in the system's settings changes. It can't stop
a lock asked for by hand, or a closed lid. `--no-keep-awake` leaves the machine to its own settings. On Windows and Linux, keep the
machine from sleeping yourself while a long run measures.

A run started with `--background` lives in a process of its own, apart from the agent's session: if the
session ends, the run goes on, and `frameproof wait <run>` or `show <run>` picks it up.
