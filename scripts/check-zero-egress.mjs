#!/usr/bin/env node
/**
 * Zero-egress guard.
 *
 * The project's whole claim against three closed-source competitors is that it
 * can be verified rather than trusted: no network, no telemetry, no accounts,
 * no host permissions. A promise in a README decays the first time someone
 * adds a "quick" version check. This makes it a build failure instead.
 *
 * Three independent checks:
 *   1. Our own source contains no network API usage.
 *   2. The generated manifest requests nothing beyond activeTab + scripting.
 *   3. The shipped bundles contain no network API usage either — which also
 *      covers anything a dependency might have dragged in.
 *
 * Exits non-zero on any violation.
 */

import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUTPUT_DIR = join(ROOT, '.output');

const SOURCE_ROOTS = ['packages', 'apps'];
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.jsx']);
const SKIP_DIRS = new Set(['node_modules', 'dist', '.output', '.wxt', 'coverage', '.git']);

/**
 * Network primitives. Anything reaching the outside world goes through one of
 * these; there is no way to make a request in a browser without one.
 */
const NETWORK_PATTERNS = [
  { name: 'fetch()', pattern: /\bfetch\s*\(/ },
  // Aliasing gets past a call-shaped pattern (`const f = fetch; f(url)`), so a
  // bare reference in value position counts too.
  { name: 'fetch reference', pattern: /(?:[=(,:?]|\breturn)\s*(?:globalThis\.|window\.|self\.)?fetch\b(?!\s*\()/ },
  { name: 'XMLHttpRequest', pattern: /\bXMLHttpRequest\b/ },
  { name: 'WebSocket', pattern: /\bnew\s+WebSocket\b/ },
  { name: 'EventSource', pattern: /\bnew\s+EventSource\b/ },
  { name: 'navigator.sendBeacon', pattern: /\bsendBeacon\s*\(/ },
  { name: 'dynamic remote import', pattern: /\bimport\s*\(\s*['"`]https?:/ },
  { name: 'WebTransport', pattern: /\bnew\s+WebTransport\b/ },
  { name: 'RTCPeerConnection', pattern: /\bRTCPeerConnection\b/ },
  { name: 'new Image()', pattern: /\bnew\s+Image\s*\(/ },
  { name: 'window.open()', pattern: /\bwindow\.open\s*\(/ },
];

/**
 * Manifest keys that would grant access we have promised not to take.
 *
 * The `optional_*` keys matter as much as the required ones: they let a later
 * version ask at run time for exactly what the install screen said it would
 * never need.
 */
const FORBIDDEN_MANIFEST_KEYS = [
  'host_permissions',
  'optional_permissions',
  'optional_host_permissions',
  'externally_connectable',
  'web_accessible_resources',
];

/**
 * The complete list of permissions this extension may request.
 *
 * An allowlist, not a denylist: a denylist is only as good as the day it was
 * written, and Chrome keeps adding permissions. Anything new has to be added
 * here, in review, on purpose.
 */
const ALLOWED_PERMISSIONS = new Set(['activeTab', 'scripting']);

const violations = [];

function record(file, detail) {
  violations.push({ file, detail });
}

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.output') continue;
    if (SKIP_DIRS.has(entry.name)) continue;

    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

function scanText(text, label, file) {
  for (const { name, pattern } of NETWORK_PATTERNS) {
    const lines = text.split('\n');
    for (const [index, line] of lines.entries()) {
      // An explicit, reviewed exemption. Grep for it to audit every use.
      if (line.includes('zero-egress-allow')) continue;
      if (!pattern.test(line)) continue;
      record(file, `${label}: ${name} on line ${index + 1}`);
      break;
    }
  }
}

async function checkSource() {
  for (const root of SOURCE_ROOTS) {
    const dir = join(ROOT, root);
    if (!existsSync(dir)) continue;

    for await (const file of walk(dir)) {
      if (!SOURCE_EXTENSIONS.has(extname(file))) continue;
      const text = await readFile(file, 'utf8');
      scanText(text, 'source', relative(ROOT, file));
    }
  }
}

async function checkManifests() {
  if (!existsSync(OUTPUT_DIR)) return { checked: 0 };

  let checked = 0;

  for await (const file of walk(OUTPUT_DIR)) {
    if (!file.endsWith('manifest.json')) continue;
    checked += 1;

    const relativePath = relative(ROOT, file);
    let manifest;
    try {
      manifest = JSON.parse(await readFile(file, 'utf8'));
    } catch (error) {
      record(relativePath, `manifest is not valid JSON: ${error.message}`);
      continue;
    }

    for (const key of FORBIDDEN_MANIFEST_KEYS) {
      if (key in manifest) {
        record(relativePath, `manifest declares "${key}": ${JSON.stringify(manifest[key])}`);
      }
    }

    for (const permission of manifest.permissions ?? []) {
      if (!ALLOWED_PERMISSIONS.has(permission)) {
        record(relativePath, `manifest requests permission "${permission}", which is not on the allowlist`);
      }
    }

    for (const script of manifest.content_scripts ?? []) {
      record(
        relativePath,
        `manifest declares a static content script for ${JSON.stringify(script.matches)} — ` +
          `this grants access before the user asks. Use registration: 'runtime' instead.`,
      );
    }
  }

  return { checked };
}

async function checkBundles() {
  if (!existsSync(OUTPUT_DIR)) return { checked: 0 };

  let checked = 0;

  for await (const file of walk(OUTPUT_DIR)) {
    if (extname(file) !== '.js') continue;
    checked += 1;
    const text = await readFile(file, 'utf8');
    scanText(text, 'bundle', relative(ROOT, file));
  }

  return { checked };
}

async function main() {
  await checkSource();
  const manifests = await checkManifests();
  const bundles = await checkBundles();

  const builtAnything = manifests.checked > 0 || bundles.checked > 0;

  if (violations.length > 0) {
    console.error('\n  Zero-egress check FAILED\n');
    for (const { file, detail } of violations) {
      console.error(`    ${file}\n      ${detail}\n`);
    }
    console.error(
      '  This project promises it never talks to a network. If a change genuinely\n' +
        '  needs an exemption, annotate the line with `zero-egress-allow` and say why\n' +
        '  in the pull request — it will show up in every future audit.\n',
    );
    process.exit(1);
  }

  console.log('  Zero-egress check passed');
  console.log(`    source trees scanned : ${SOURCE_ROOTS.join(', ')}`);
  console.log(`    manifests checked    : ${manifests.checked}`);
  console.log(`    bundles checked      : ${bundles.checked}`);

  if (!builtAnything) {
    console.log('\n    Note: no build output found, so only source was checked.');
    console.log('    Run `pnpm build` first to verify the shipped bundles too.');
  }
}

await main();
