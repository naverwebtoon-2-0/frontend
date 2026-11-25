import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)), 'public');
const port = Number(process.env.PORT ?? 4173);
const origin = process.env.NCP_BACKEND_ORIGIN;
const useMock = process.env.NCP_USE_MOCK !== 'false';
let backendOrigin = null;

if (!useMock && !origin) {
  throw new Error('실제 API를 사용하려면 NCP_BACKEND_ORIGIN을 함께 설정하세요.');
}
if (origin) {
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.origin !== origin) {
    throw new Error('NCP_BACKEND_ORIGIN에 HTTPS origin을 지정하세요.');
  }
  backendOrigin = url.origin;
}

const routes = new Map([
  ['/', '/home.html'],
  ['/status', '/status.html'],
  ['/login', '/login.html'],
  ['/search', '/search.html'],
  ['/library', '/library.html'],
  ['/history', '/history.html'],
  ['/series', '/series.html'],
  ['/viewer', '/viewer.html'],
  ['/dashboard', '/dashboard.html'],
  ['/upload', '/upload.html'],
  ['/processing', '/processing.html'],
  ['/studio', '/studio.html'],
  ['/publish', '/publish.html'],
]);
const contentType = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

function backendTarget(url) {
  if (!backendOrigin) return null;
  if (url.pathname === '/api/healthz') return new URL(`/healthz${url.search}`, backendOrigin);
  if (url.pathname.startsWith('/api/v1/')) {
    return new URL(`${url.pathname.slice('/api'.length)}${url.search}`, backendOrigin);
  }
  return null;
}

async function proxyToBackend(request, response, target) {
  const headers = {};
  for (const name of ['accept', 'authorization', 'content-type', 'idempotency-key']) {
    const value = request.headers[name];
    if (value) headers[name] = value;
  }

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const chunks = [];
  if (hasBody) {
    for await (const chunk of request) chunks.push(chunk);
  }

  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body: hasBody && chunks.length ? Buffer.concat(chunks) : undefined,
      redirect: 'manual',
    });
    const responseHeaders = {};
    for (const name of ['cache-control', 'content-type', 'etag', 'location', 'retry-after']) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders[name] = value;
    }
    response.writeHead(upstream.status, responseHeaders);
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    response.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    console.error(`백엔드 프록시 실패: ${target}`, error);
    response.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: { code: 'BAD_GATEWAY', message: '백엔드에 연결할 수 없습니다.' } }));
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);
  if (pathname === '/runtime-config.js') {
    response.writeHead(200, {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    response.end(`export const runtimeConfig = Object.freeze({ useMock: ${useMock} });\n`);
    return;
  }

  const upstreamTarget = backendTarget(url);
  if (upstreamTarget) {
    await proxyToBackend(request, response, upstreamTarget);
    return;
  }

  const staticTarget = routes.get(pathname) ?? pathname;
  const file = resolve(root, `.${staticTarget}`);
  if (!file.startsWith(`${root}${sep}`)) {
    response.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const body = await readFile(file);
    response.writeHead(200, {
      'Content-Type': contentType[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    response.end(body);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
});

export { server };

server.listen(port, '127.0.0.1', () => {
  console.log(`울림툰 개발 서버: http://localhost:${port} (${useMock ? '목업' : '실제 API'} 모드)`);
});
