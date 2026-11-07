# frameproof guide

Frame-level performance evidence for web apps. You drive; frameproof measures and says what the data
supports, and no more.

Start every session with `frameproof next`: it reads the project and the machine and returns the one
thing to do now, with its command. Run it, then `next` again.

## Topics

- `frameproof guide scenarios`: writing the steps a person takes, and checking them
- `frameproof guide verdicts`: what each status means and what you may say
- `frameproof guide compare`: judging a change, and pricing one before making it
- `frameproof guide freezes`: reading a freeze's dossier, the journey, and queries
- `frameproof guide bisect`: when a dossier can't name a cause, which part of the page (or which commit) holds the frames
- `frameproof guide budgets`: counted work, the ledger, and `check` in CI
- `frameproof guide goals`: GOALS.md and JOURNAL.md, the person's part
- `frameproof guide machine`: doctor, calibration, busy machines, where it can't run
- `frameproof guide config`: frameproof.config.js, builds, refs and servers
- `frameproof guide statistics`: how a verdict is reached

## The loop

1. Know what matters: `perf/GOALS.md`. If it's unanswered, ask the person.
2. Read `perf/JOURNAL.md`: don't repeat a dead end without a new reason.
3. Find the cost: `freezes`, then `show` and `query`. Don't open traces or write parsers.
4. Price it when you can: `price --inject`.
5. Change one thing.
6. Judge it with `compare --note "<hypothesis>"`.
7. Report with `report`.

## Output

Every command prints one JSON object: `status`, `summary`, `machine`, `run`, `evidence`, `next`. The
default output stays near 400 tokens; `--full` lifts the cut, and `truncated` says what was cut. Long
commands take `--background` and return a run id; `frameproof wait <run>` blocks until it's done.

Exit codes: 0 a verdict or done, 1 a regression, a broken budget or an invalid run, 2 not measurable,
3 usage.
