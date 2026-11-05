# Freezes, show and query

## freezes

```
frameproof freezes -s journey,scroll --throttle 4 -n 4 --min 50
```

Runs the scenarios with deep tracing, finds every run of late frames of `--min` ms or more, and gives each
a dossier and a verdict. Freezes are grouped by cause across repetitions: `in: 4/4` comes back every time
(the page's), `1/4` may be the machine. Handles: `f1`, `f2`, ... for `show`.

A verdict names what held the frame, with the source line when the build has source maps:

- `layout forced 120 of 4342 objects at src/list.js:6, from script at src/list.js:4`: a read
  (offsetTop, getBoundingClientRect) after a write, in a loop or a handler.
- `style forced 2908 elements at src/cart.js:28`: a class change that restyles most of the page.
- `style 2896 elements, after style: BODY (class change)`: a restyle in a frame, and what invalidated it.
- `page main thread waiting on the GPU process 900 ms (linking shaders: GetProgramiv) at src/hero.js:19`:
  WebGL asking for a link status synchronously.
- `waiting on <site>'s frame (a frame, FrameSinkId(...))`: another frame (an iframe, a video) held it.
- `GPU busy ...`, `no work held it on the main thread or the GPU (...)`: the stage that took longest.

The journey (`-s journey,...`) adds long tasks outside every step: in a setup, or between steps. "No step
measures it" means a cost no comparison would have seen.

## show

`frameproof show f1` gives the dossier of a group's longest freeze: stages, the main thread's top task
split into script, style, layout and paint by source line, V8's samples (`js`), other threads, the GPU,
surfaces, invalidations, marks. `frameproof show f1 main` (or `js`, `threads`, `gpu`, `surfaces`,
`invalidations`, `marks`, `stages`, `shaders`) prints one section. `frameproof show <run>` prints a run.

## query

`frameproof query <run|latest> <what>` answers from what a run kept, with real names:

- `forced`: style and layout forced from script, by source line, a step on average
- `askers`: who asks for frames (rAF) and timers, by source line
- `hot`: self time by function, per thread
- `threads`: time per thread (main, workers, compositor, raster, GPU, other sites)
- `long-tasks`, `failures`, `steps`

Filter with `--scenario` and `--step`. If a question has no query, say so: don't parse a trace.
