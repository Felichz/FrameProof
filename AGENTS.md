# frameproof, for agents

You were probably given this repo and asked to make a web project smoother, or to find out why it stutters. This page is all you need.

> **Status: 0.1.0, not on npm yet.** Run it from GitHub: wherever this page says `npx frameproof`, use `npx -y github:Felichz/FrameProof`. If you are here to work on the tool itself, read [PLAN.md](PLAN.md).

## Start

You don't need to clone this repo. From the root of the project you are working on:

```bash
npx -y github:Felichz/FrameProof next
```

`next` looks at the project and the machine and tells you the one thing to do now, with the exact command. Run what it says, then run `next` again. It covers setup, so don't plan the steps yourself. Everything prints JSON with a `status`, a `summary` and a `next` list.

Where the output says `frameproof <command>`, run it the way you started it (`npx -y github:Felichz/FrameProof <command>`). Long commands take `--background` and return a run id; `wait <run>` blocks until they're done.

For the details of any command, ask the tool, not this page: `npx -y github:Felichz/FrameProof guide [topic]`. Its answers match the installed version.

## The loop

1. **Know what matters.** `perf/GOALS.md` says which interactions matter to this project's people and what they accept giving up. If it's empty, ask the person; it's the one thing the tool can't work out.
2. **Read the journal.** `perf/JOURNAL.md` lists what was already tried. Don't repeat a dead end without a new reason.
3. **Find the cost.** `freezes` and `query` name it, down to the source line. Don't open trace files or write parsers: if a question has no command, say so.
4. **Price it, when you can.** `price` injects a change to see what it's worth before you make it.
5. **Change one thing.** Leave it uncommitted: `compare` judges the files as they are against the last commit.
6. **Judge it with `compare`.** Pass `--note` with your hypothesis, so it lands in the journal.
7. **Report with `report`**, which writes the result for a person.

## How to read a verdict

| Status | It means | What you may say |
|---|---|---|
| `better` | Confirmed on fresh repetitions | "Improved by X, interval Y" |
| `worse` | Confirmed on fresh repetitions | "Regressed by X" |
| `same` | The interval fits inside the margin | "No change larger than the margin" |
| `inconclusive` | The data can't tell | "Not known". Never "no difference" |
| `invalid` | The steps didn't do what they claim | Nothing yet. Read why: it may be a real bug in the app |
| `not-measurable` | This machine can't measure now | "Unmeasured", and why |
| `partial` | The browser was lost twice; the cells cover what was measured before | The cells' own verdicts, and that the run was cut |

Counts of work (`ledger`) say where work went, not whether frames improved. Only `compare` judges a change. Work reported as `moved` didn't go away.

## Rules

- Don't kill processes you didn't start. If the machine is busy, say so and wait.
- Don't open visible browser windows. The tool keeps Chrome out of sight by itself (off screen, or against the screen's edge on macOS) and never takes the focus.
- Don't compare numbers from different machines or different days, or from two runs: only the two builds within one run compare. A cell whose base reads unlike the last run says so.
- Check the `mode` line: it says when the page's local frames ran in a process of their own. Measure the mode the project ships in.
- A change that alters what a visitor sees or when it happens is the person's call: describe it, keep it uncommitted, ask.
- The tool gives evidence. It doesn't decide trade-offs, and neither does a p-value.

## Leaving a review

After using frameproof on a project, leave a review of the tool in this repo: it is how the next version learns what got in the way.

- **Where:** `docs/reviews/`, one file for each stretch of work, named `YYYY-MM-DD-<project>-on-<machine>.md` (for example [`2026-11-05-portfolio-on-mac.md`](docs/reviews/2026-11-05-portfolio-on-mac.md)). If you ran it through `npx`, clone `github.com/Felichz/FrameProof` to write it.
- **What:** what worked, then what to change, most important first. Each point with the runs behind it: the command, the run id, the numbers it printed. End with a table of the changes judged on the project and their verdicts.
- **How it's written:** facts and the tool's own numbers, nothing estimated. A problem you fixed in the tool says so, with its commit.
- **Committing:** on `main`, one commit with the review alone (`docs: a review of frameproof on <project>, on <machine>`). The push is the repo owner's: leave the commit and say it's there.
