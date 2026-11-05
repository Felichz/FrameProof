# Freezes, show and query

## freezes

```
frameproof freezes -s journey,scroll --throttle 4 -n 4 --min 50
```

Runs the scenarios with deep tracing, finds every run of late frames of `--min` ms or more, and gives each
a dossier and a verdict. Freezes are grouped by cause across repetitions: `in: 4/4` comes back every time
(the page's), `1/4` may be the machine. Handles: `f1`, `f2`, ... for `show`.

`--min` defaults to 50 ms: a 67 ms freeze is four frames a visitor sees. `compare` counts a repetition as
an episode from the config's `episodeMs` (100 ms), so a shorter freeze shows there in the typical late
frames, not in the episodes; the summary says so when it applies.

Deep tracing slows the page it watches, so the same scenarios then run with light tracing (`--light-n`,
twice `-n` by default; `0` skips it) and each group gets `light: "2/8 at 50 ms"`, the light repetitions of
that step with a run of late frames at the same line. A group no light run has is `seen: deep tracing only`, sorted last and left out of the
summary's count: a visitor likely doesn't get it. `busyAtStart` says how many repetitions began while the
page was still busy from its setup (see `quiet` in `guide scenarios`).

The summary says the serving mode when the page has local subframes: `mode: page on 127.0.0.1; frames
from localhost ran in their own process`. Which local name a page is on can decide which process its
frames run in, and with it what the page costs: check it is the mode the project ships in.

A verdict names what held the frame, with the source line when the build has source maps:

- `layout forced 120 of 4342 objects at src/list.js:6, from script at src/list.js:4`: a read
  (offsetTop, getBoundingClientRect) after a write, in a loop or a handler.
- `style forced 2908 elements at src/cart.js:28`: a class change that restyles most of the page.
- `style 2896 elements, after style: BODY (class change)`: a restyle in a frame, and what invalidated it.
- `page main thread waiting on the GPU process 900 ms (linking shaders: GetProgramiv) at src/hero.js:19`:
  WebGL asking for a link status synchronously.
- `waiting on <site>'s frame (a frame, FrameSinkId(...))`: another frame (an iframe, a video) held it.
- `waiting on a frame that started 190 ms before (live:mount:app; a frame, FrameSinkId(...))`: a frame
  that just committed a document, or a mark of the page's, began right before the freeze. Look at what
  starts that frame, not at the GPU.
- `GPU busy 100 ms, 97 of it in nothing it names (raster 2 ms, composite 1 ms)`: the GPU's named parts
  don't explain it; the time went somewhere the trace doesn't name. `GPU busy ...: raster N ms` when they
  do.
- `no work held it on the main thread or the GPU (...)`: the stage that took longest.

The journey (`-s journey,...`) adds long tasks outside every step: in a setup, or between steps. "No step
measures it" means a cost no comparison would have seen.

## show

`frameproof show f1` gives the dossier of a group's longest freeze: stages, the main thread's top task
split into script, style, layout and paint by source line, V8's samples (`js`), other threads, the GPU,
surfaces, invalidations, marks. `frameproof show f1 main` (or `js`, `threads`, `gpu`, `surfaces`,
`invalidations`, `marks`, `stages`, `shaders`) prints one section. `frameproof show <run>` prints a run;
`frameproof show <run> f1 [section]` is `show <run>/f1`. An argument a command wouldn't use is an error, never
ignored. A run whose process is gone before it finished reads as `stopped`, with its last step.

## query

`frameproof query <run|latest> <what>` answers from what a run kept, with real names:

- `late`: when the late frames fall after the step's act (0-100, 100-300, 300-1000, 1000+ ms), by the
  stage that held them, with the page's marks: a stutter of many slightly late frames, which no freeze
  names. Every run keeps it, light ones too.
- `forced`: style and layout forced from script, by source line, a step on average
- `askers`: who asks for frames (rAF) and timers, by source line
- `hot`: self time by function, per thread
- `threads`: time per thread (main, workers, compositor, raster, GPU, other sites)
- `long-tasks`, `failures`, `steps`

Filter with `--scenario` and `--step`. If a question has no query, say so: don't parse a trace.
