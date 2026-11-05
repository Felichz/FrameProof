# Config

`frameproof init` writes it with the framework's defaults. Everything has a default; with no config the
built-in scenarios still run on a static folder.

```js
// frameproof.config.js
export default {
  build: { command: '<the project build command>', out: 'dist', env: {} }, // or null: serve as is
  out: '.',                     // with build: null, the folder to serve
  serve: 'static',              // or { static: true, host: '::1' }: the same, on another local address
                                // or { command: '<start a server on {port}>', url: 'http://localhost:{port}' }
                                // or { url: 'https://staging.example.com' } for a site already up
  path: '/',                    // where scenarios start
  scenarios: './perf/scenarios',
  budgets: './perf/budgets.js',
  goals: './perf/GOALS.md',
  journal: './perf/JOURNAL.md',
  viewport: { width: 1280, height: 800 },
  episodeMs: 100,               // a freeze this long makes a repetition an episode
  margin: 2,                    // late frames for `same`, until calibrate sets one per cell
};
```

Source maps give real names in every output: turn them on in the build (Vite: `build.sourcemap: true`;
Next: `productionBrowserSourceMaps: true`; webpack: `devtool: 'source-map'`). Without them names are the
built files'.

Builds of git refs are made in `.frameproof/builds/<commit>/`, with the project's node_modules linked when
the lockfile is the same (installed otherwise). `.frameproof/` holds runs, builds, profiles and
calibrations; `init` adds it to `.gitignore`.
