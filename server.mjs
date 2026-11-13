import { createReadStream } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWeldStatus } from './scripts/weld-status.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const publicDir = resolve(root, 'public');
const port = Number(process.env.PORT || 4173);
const weldDatabasePath = process.env.WELD_DB_PATH || resolve(root, 'data', '动力站焊接数据库-云端同步.xlsx');

const mimeTypes = {
  '.b3dm': 'application/octet-stream',
  '.bin': 'application/octet-stream',
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.glb': 'model/gltf-binary',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
  '.xml': 'application/xml; charset=utf-8'
};

function requestPath(url) {
  const pathname = decodeURIComponent(new URL(url, 'http://localhost').pathname);
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^[/\\]+/, '');
  return resolve(publicDir, normalize(relative));
}

const server = createServer(async (req, res) => {
  if (!['GET', 'HEAD'].includes(req.method || '')) {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    res.end();
    return;
  }

  const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
  if (pathname === '/api/weld-status') {
    try {
      const status = await loadWeldStatus(weldDatabasePath);
      const body = JSON.stringify(status);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      if (req.method !== 'HEAD') res.end(body); else res.end();
    } catch (error) {
      res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: `焊接数据库不可用：${error.message}` }));
    }
    return;
  }

  const filePath = requestPath(req.url || '/');
  if (!filePath.startsWith(publicDir + '\\') && filePath !== publicDir) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  try {
    await access(filePath);
    const file = await stat(filePath);
    if (file.isDirectory()) {
      res.writeHead(301, { Location: `${req.url?.replace(/\/$/, '')}/` });
      res.end();
      return;
    }
    const extension = extname(filePath).toLowerCase();
    const isModelResource = ['.b3dm', '.json', '.glb', '.bin'].includes(extension);
    res.writeHead(200, {
      'Content-Type': mimeTypes[extension] || 'application/octet-stream',
      'Content-Length': file.size,
      'Cache-Control': isModelResource ? 'public, max-age=86400' : 'no-cache',
      'Cross-Origin-Resource-Policy': 'same-origin'
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`模型管理平台已启动： http://localhost:${port}`);
  console.log(`局域网访问：       http://<本机IP>:${port}`);
});
