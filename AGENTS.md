# frameproof, for agents

You were probably given this repo and asked to make a web project smoother, or to find out why it stutters. This page is all you need.

> **Status: not built yet.** This is the target for the first release, and none of these commands run today. If you are here to use the tool, stop and tell the person so. If you are here to build it, read [PLAN.md](PLAN.md).

## Start

You don't need to clone this repo. From the root of the project you are working on:

```bash
npx frameproof@latest next
```

`next` looks at the project and the machine and tells you the one thing to do now, with the exact command. Run what it says, then run `next` again. It covers setup, so don't plan the steps yourself. Everything prints JSON with a `status`, a `summary` and a `next` list.

For the details of any command, ask the tool, not this page: `npx frameproof guide [topic]`. Its answers match the installed version.

## The loop

1. **Know what matters.** `perf/GOALS.md` says which interactions matter to this project's people and what they accept giving up. If it's empty, ask the person; it's the one thing the tool can't work out.
2. **Read the journal.** `perf/JOURNAL.md` lists what was already tried. Don't repeat a dead end without a new reason.
3. **Find the cost.** `freezes` and `query` name it, down to the source line. Don't open trace files or write parsers: if a question has no command, say so.
4. **Price it, when you can.** `price` injects a change to see what it's worth before you make it.
5. **Change one thing, on a branch.**
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

Counts of work (`ledger`) say where work went, not whether frames improved. Only `compare` judges a change. Work reported as `moved` didn't go away.

## Rules

- Don't kill processes you didn't start. If the machine is busy, say so and wait.
- Don't open visible browser windows. The tool places Chrome off screen by itself.
- Don't compare numbers from different machines or different days.
- A change that alters what a visitor sees or when it happens is the person's call: describe it, keep it on a branch, ask.
- The tool gives evidence. It doesn't decide trade-offs, and neither does a p-value.
