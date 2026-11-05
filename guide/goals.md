# Goals and journal

## perf/GOALS.md

What only a person knows: which interactions matter most (named by their scenarios, in backticks), what
counts as a modest machine (`Throttle: 4x`), what they won't trade away, and what was decided. `init`
writes it with an "unanswered" line; `next` sends you to the person until that line is gone. It's the only
place the tool sends you back to them.

When a trade-off comes up (a change makes frames better and changes what a visitor sees), check the goals
first; ask only what they leave open, and write the answer under "Decided so far" with the date.

## perf/JOURNAL.md

Every `compare` and `price` appends an entry: date, kind, status, your hypothesis (`--note`), the change,
the result per cell, the run id and the machine. `frameproof journal` lists the latest. Read it before
starting; a person may edit it freely. Sessions end and contexts get compacted: this is what stops the
next one from retrying a dead end.
