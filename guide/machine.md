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
