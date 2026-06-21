// scripts/live-block-loader.mjs — Node --loader hook for the Phase 8 live test.
//
// Lets scripts/live-block-test.mjs reuse the app's real router code path
// (src/server/router/index.ts → AsusWrtProvider) from plain Node by:
//   • mapping the `@/...` path alias to <repo>/src, and
//   • adding the implicit `.ts`/`.tsx`/`.js`/`.mjs` extension to extensionless
//     relative/alias value imports that Node's ESM resolver would otherwise reject.
// Used ONLY on the live (asus) path, together with --conditions=react-server.
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(REPO_ROOT, 'src');
const exts = ['.ts', '.tsx', '.js', '.mjs'];

function tryFiles(base) {
  try { if (existsSync(base) && statSync(base).isFile()) return base; } catch {}
  for (const e of exts) if (existsSync(base + e)) return base + e;
  for (const e of exts) if (existsSync(path.join(base, 'index' + e))) return path.join(base, 'index' + e);
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const hit = tryFiles(path.join(SRC, specifier.slice(2)));
    if (hit) return { url: pathToFileURL(hit).href, shortCircuit: true };
  }
  if (specifier.startsWith('.') && context.parentURL) {
    const abs = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
    if (!path.extname(abs) || !existsSync(abs)) {
      const hit = tryFiles(abs);
      if (hit) return { url: pathToFileURL(hit).href, shortCircuit: true };
    }
  }
  return nextResolve(specifier, context);
}
