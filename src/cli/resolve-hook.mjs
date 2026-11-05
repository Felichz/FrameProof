// Resolves `frameproof` to this package for the scenario files a project writes.
const self = new URL('../index.mjs', import.meta.url).href;

export async function resolve(specifier, context, next) {
  if (specifier === 'frameproof') return { url: self, shortCircuit: true };
  return next(specifier, context);
}
