#!/usr/bin/env node
/**
 * Bundle size budget.
 *
 * The inspector script is injected into other people's pages. Every kilobyte
 * is latency the user did not ask for, and size regressions arrive quietly —
 * one convenience dependency at a time. This turns that into a build failure.
 *
 * Budgets are gzipped, because that is what the browser actually transfers.
 */

import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUTPUT_DIR = join(ROOT, '.output');

/** Matched against the path, longest match wins. Sizes in kilobytes, gzipped. */
const BUDGETS_KB = [
  { match: 'content-scripts/inspector.js', limit: 150, label: 'inspector content script' },
  { match: 'background.js', limit: 40, label: 'background worker' },
];

const SKIP_DIRS = new Set(['node_modules', '.git']);

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

function budgetFor(path) {
  return BUDGETS_KB.filter((budget) => path.includes(budget.match)).sort(
    (a, b) => b.match.length - a.match.length,
  )[0];
}

async function main() {
  if (!existsSync(OUTPUT_DIR)) {
    console.error('  No build output found. Run `pnpm build` first.');
    process.exit(1);
  }

  const rows = [];
  const failures = [];

  for await (const file of walk(OUTPUT_DIR)) {
    if (!file.endsWith('.js')) continue;

    const budget = budgetFor(file);
    if (!budget) continue;

    const gzippedKb = gzipSync(await readFile(file)).length / 1024;
    const withinBudget = gzippedKb <= budget.limit;

    rows.push({
      path: relative(OUTPUT_DIR, file),
      label: budget.label,
      gzippedKb,
      limit: budget.limit,
      withinBudget,
    });

    if (!withinBudget) failures.push(rows.at(-1));
  }

  if (rows.length === 0) {
    console.error('  No budgeted bundles found in build output. Did the build change layout?');
    process.exit(1);
  }

  console.log('  Bundle sizes (gzipped)\n');
  for (const row of rows) {
    const mark = row.withinBudget ? 'ok  ' : 'OVER';
    const used = ((row.gzippedKb / row.limit) * 100).toFixed(0);
    console.log(
      `    ${mark} ${row.gzippedKb.toFixed(1).padStart(6)} KB / ${String(row.limit).padStart(3)} KB  ` +
        `(${used.padStart(3)}%)  ${row.path}`,
    );
  }

  if (failures.length > 0) {
    console.error('\n  Bundle size budget exceeded.\n');
    console.error('  Either trim the bundle or raise the budget deliberately in');
    console.error('  scripts/check-bundle-size.mjs — but raising it should be a decision,');
    console.error('  not a reflex.\n');
    process.exit(1);
  }

  console.log('\n  All bundles within budget');
}

await main();
