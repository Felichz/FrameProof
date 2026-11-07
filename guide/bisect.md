# Bisect

When a dossier can't name a cause (`GPU busy ..., in nothing it names`, a layout with no source line),
take parts of the page away and see which one the frames follow. Read the trace first: `show`,
`query <run> late` and `compare`'s `counted` cost seconds and usually name it. Bisect when they don't.

```
frameproof bisect -s scroll 'hide:.ambient' 'hide:video' 'hide:iframe'
frameproof bisect -s scroll --refine '.ambient'
frameproof bisect -s scroll --base v1.2 --head main
```

## Candidates

Each candidate is something to take away, as arguments (or `--candidates`, repeated; never split on
commas, which selectors use):

| Candidate | Takes away |
|---|---|
| `hide:<sel>` | `display: none`: the element and everything about it |
| `invisible:<sel>` | `visibility: hidden`: its painting, its layout kept |
| `still:<sel>` | its animations and transitions |
| `flat:<sel>` | its shadows, filters, blend modes and background images |
| `pause:<sel>` | its videos and audio, paused (by a script, before the page's own) |
| `off:<name>` | code the project lets be switched off (below) |
| `css:<rules>`, `js:<file>` | anything else |

`--refine <sel>` prices `invisible`, `still`, `flat` and `pause` of one selector apart: a `hide:` found the
element, this says which of its costs it is.

`off:<name>` needs one line in the project where it wants a switch:

```js
if (window.__frameproof?.off?.includes('warm')) return;
```

## How it searches

1. All candidates away together. Not `better`: the cost isn't among them, and it stops.
2. Halves, each priced. It follows the half that keeps the gain. Both keep it: more than one cause, and it
   follows both. Neither does: the cost shows only with them together (two causes that cover for each
   other, or one spread across them), and it says so instead of guessing.
3. Each culprit confirmed once more, on a longer run.

Each step is a `price`: the same build, alternated, with and without. `--screen work` judges the splits by
the scenario's counted work instead (main-thread time and the GPU's, about a minute a split, and it holds
on a busy machine); the culprits are still confirmed in frames.

Options: `--minutes 8` (each split), `--confirm-minutes 15`, `--max-steps 12`, `--throttle 1`,
`--resume <run>` (takes up the splits a cut run had measured), `--note`, `--background`.

## Commits

`--base <good> --head <bad>` finds the first commit between them that makes the scenario `worse`, comparing
the good commit with the middle one each step. Each commit is built once and cached.
