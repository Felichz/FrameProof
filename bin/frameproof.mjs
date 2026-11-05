#!/usr/bin/env node
// frameproof: frame-level performance evidence for web apps, built to be used by coding agents.
import { register } from 'node:module';
import { main } from '../src/cli/main.mjs';

// Scenario files may `import { scenario } from 'frameproof'` even when the tool runs through npx and is not
// installed in the project: the name resolves to this package.
register('../src/cli/resolve-hook.mjs', import.meta.url);

process.exitCode = await main(process.argv.slice(2));
