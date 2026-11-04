# frameproof

Frame-level performance evidence for web apps, built to be used by coding agents.

> **Status: plan.** There is no code in this repo yet. The design is in [PLAN.md](PLAN.md). Everything below describes what is being built; the commands don't run today. The tooling it comes from exists and works, inside one project.

## Use it

Tell your agent:

> Use github.com/Felichz/frameproof to find out why scrolling stutters here, and fix it.

That's the whole setup. The agent reads [AGENTS.md](AGENTS.md), runs `npx frameproof@latest next` in your project, and the tool walks it through the rest, one step at a time. It will come back to you for one thing: which interactions matter most and what you won't trade away.

It works with any agent that has a shell, on a machine with a display and a GPU. Without those (a cloud container, most CI), it can still count work and hold budgets, and it says it can't judge frames.

## The problem

An agent can change code in seconds and has no reliable way of knowing whether the page got smoother. The usual signals fail in specific ways:

- **Average FPS** moves with the machine's load and hides the one 300 ms freeze a visitor actually feels.
- **Lighthouse and Web Vitals** describe page load and single interactions, not whether the frames of a scroll or an animation arrived on time.
- **A DevTools trace** holds the answer, in a file of tens of megabytes that doesn't fit in a context window and was designed for a person with a flame chart.
- **One before and one after** is an anecdote. On a laptop, two runs of the same build differ more than most real fixes do.

So agents either skip measuring or report a number they can't defend.

## What it does

frameproof drives a real Chrome through scenarios you describe, reads the frames Chrome's compositor reports, and answers three questions in a few hundred tokens of JSON:

| Question | Command | Answer |
|---|---|---|
| Did this change make frames better? | `frameproof compare` | A verdict with an effect size and an interval, from alternated builds |
| What exactly froze, and why? | `frameproof freezes`, `frameproof show` | Each freeze with its stage, its cause and its source line, grouped across repetitions |
| Where does the work go, and did a rule break? | `frameproof ledger`, `frameproof check` | Counted work per scenario, and budgets that fail CI |

```console
$ frameproof compare --base main --head HEAD --scenario scroll --throttle 1,4 --json
```

```json
{
  "status": "inconclusive",
  "scenario": "scroll",
  "steps": [
    {
      "step": "up", "throttle": 4, "verdict": "inconclusive",
      "effect": { "lateFrames": 0.8, "ci95": [-0.4, 1.9] },
      "reason": "first run p=0.020 did not survive the confirmation run",
      "typical": { "base": 1, "head": 1 },
      "episodes": { "base": "3/40", "head": "6/40", "p": 0.48 }
    }
  ],
  "next": ["frameproof freezes --ref HEAD --scenario scroll --min 100"]
}
```

*(Illustrative output: the shape is the proposed contract, and the figures echo a real case described in the plan.)*

## What makes it different

- **The verdict can be "I don't know".** `better`, `worse`, `same`, `inconclusive` and `invalid` are separate results. "Not significant" is never reported as "same": that takes an interval inside a stated margin.
- **It checks itself.** Before trusting a comparison it can run the same build against itself, and inject a known cost to prove it would have seen one.
- **Typical frames and rare freezes are measured apart.** A median and a rate of episodes answer different questions, and averaging them together is how a single stall hides or fakes a result.
- **Output is built for a context window.** A short summary first, and a handle to drill into. Traces stay on disk.
- **It refuses to measure a busy machine.** A loaded laptop gives a `not measurable` result, not a bad number.
- **It keeps a journal.** Every experiment, including the ones that failed, lands in a file in your repo, so the next session doesn't try the same dead end.

## Where it comes from

It is extracted from the tooling used to make [my portfolio](https://portfolio-felix-teal.vercel.app/) fluid, where a Claude agent ran the measuring and I decided the trade-offs. Some results from that work, measured with the A/B described here:

- A video page checking the clock on every frame: opening a window went from 17.4 to 11.0 late frames at 4x CPU throttle, closing it from 15.6 to 6.6, both p < 0.001.
- A third-party frame making the page wait on its first paint: 6.7 to 1.3 late frames a step, p < 0.001.
- A 3D model linking its shaders on the main thread as the visitor arrived: 860 ms of script down to 25 ms in the same scene, after moving it to a worker.
- A redesign that looked like an obvious win, flying a window with a transform: measured worse (17.6 to 22.5 late frames, p = 0.008) and dropped.

The tooling also got things wrong, and those cases shaped this design. See [what the original got wrong](PLAN.md#what-the-original-got-wrong).

## Scope

Chromium only, because the data comes from Chrome's compositor trace. Desktop first; Android over remote debugging is a later question. It measures on your machine and compares only within one machine: it is not a monitoring product and doesn't collect field data.

## License

Not chosen yet.
