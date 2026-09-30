#!/usr/bin/env node
/**
 * Serve apps/site/public locally, the way GitHub Pages will.
 *
 * The site is static files with no build step, so a dependency-free file server
 * is all the local loop needs: `pnpm site:dev`, then the site checks and media
 * scripts run against http://localhost:8788. Like Pages, a directory serves its
 * index.html and anything missing gets 404.html with a 404 status.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../apps/site/public', import.meta.url));
const PORT = Number(process.env['PORT'] ?? 8788);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function resolvePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0] ?? '/');
  const path = normalize(join(ROOT, decoded));
  // Refuse anything that climbs out of the site root.
  if (path !== ROOT && !path.startsWith(ROOT + sep)) return null;
  if (existsSync(path) && statSync(path).isDirectory()) {
    const index = join(path, 'index.html');
    return existsSync(index) ? index : null;
  }
  return existsSync(path) ? path : null;
}

createServer((req, res) => {
  const found = resolvePath(req.url ?? '/');
  const file = found ?? join(ROOT, '404.html');
  res.writeHead(found ? 200 : 404, {
    'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
    'cache-control': 'no-store',
  });
  createReadStream(file).pipe(res);
}).listen(PORT, () => {
  console.log(`site on http://localhost:${PORT}`);
});
