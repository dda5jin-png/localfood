import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = process.cwd();

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
};

// 클린 URL 지원: /saved → saved.html
const cleanUrlMap = {
  '/saved': 'saved.html',
};

function resolvePath(pathname) {
  const decoded = decodeURIComponent(pathname);
  const safePath = normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  const mapped = cleanUrlMap[safePath] ?? null;
  const resolved = mapped ?? (safePath === '/' ? 'index.html' : safePath);
  const filePath = join(ROOT, resolved);
  if (!filePath.startsWith(ROOT)) return null;
  return filePath;
}

export default async function handler(request, response) {
  const url = new URL(request.url, `https://${request.headers.host}`);

  if (url.pathname === '/api/kakao-login') {
    const { default: kakaoLoginHandler } = await import('./api/kakao-login.js');
    await kakaoLoginHandler(request, response);
    return;
  }

  const filePath = resolvePath(url.pathname);
  if (!filePath) {
    response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Forbidden');
    return;
  }

  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error('Not a file');

    response.writeHead(200, {
      'Content-Type': mimeTypes[extname(filePath)] || 'application/octet-stream'
    });
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
}
