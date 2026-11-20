import { cp, mkdir, rm, writeFile } from 'node:fs/promises';

const origin = process.env.NCP_BACKEND_ORIGIN;
const headers = {
  'Content-Security-Policy': "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};
const routes = [{ src: '^/.*$', headers, continue: true }];

// 동일 출처의 상태 API 경로 한 개만 백엔드로 전달한다.
if (origin) {
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.origin !== origin) {
    throw new Error('NCP_BACKEND_ORIGIN에 HTTPS origin을 지정하세요.');
  }
  routes.push({
    src: '^/api/healthz$',
    methods: ['GET', 'HEAD'],
    dest: new URL('/healthz', url).href,
  });
}
routes.push({ src: '^/$', dest: '/index.html' });

const output = new URL('../.vercel/output/', import.meta.url);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(new URL('../public/', import.meta.url), new URL('static/', output), { recursive: true });
await writeFile(new URL('config.json', output), JSON.stringify({ version: 3, routes }, null, 2));
