#!/usr/bin/env node
/**
 * Run shotkit without making it a dependency of this repo.
 *
 * shotkit lives in a private repository, so listing it in package.json broke
 * `pnpm install` for CI and for anyone who clones this one. It is only needed to
 * regenerate marketing screenshots, never to build, test or ship the extension,
 * so it is looked up at run time instead, in this order:
 *
 *   1. `$SHOTKIT_HOME` — a checkout anywhere on disk
 *   2. `../shotkit` — a checkout next to this repo
 *   3. an installed `shotkit` package, if one happens to resolve
 *
 * Usage mirrors the CLI: `node scripts/shotkit.mjs <command> [...args]`.
 * Import `resolveShotkit()` to get the entry point from another script.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ENTRY = 'scripts/shotkit.mjs';

export function resolveShotkit() {
  const candidates = [
    process.env['SHOTKIT_HOME'] && join(resolve(process.env['SHOTKIT_HOME']), ENTRY),
    join(ROOT, '..', 'shotkit', ENTRY),
  ].filter(Boolean);

  for (const path of candidates) if (existsSync(path)) return path;

  try {
    return createRequire(import.meta.url).resolve(`shotkit/${ENTRY}`);
  } catch {
    console.error(
      'shotkit not found. Clone it next to this repo (../shotkit) or set SHOTKIT_HOME.\n' +
        'It is only needed to regenerate screenshots.',
    );
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    execFileSync('node', [resolveShotkit(), ...process.argv.slice(2)], { stdio: 'inherit' });
  } catch (error) {
    process.exit(typeof error.status === 'number' ? error.status : 1);
  }
}
