import { cp, mkdir, rm, writeFile } from 'node:fs/promises';

const origin = process.env.NCP_BACKEND_ORIGIN;
// 원고 업로드(presigned PUT)와 이미지·음원 조회가 가는 Object Storage
const storage = 'https://kr.object.ncloudstorage.com';
const csp = [
  "default-src 'self'",
  `img-src 'self' ${storage}`,
  `media-src 'self' ${storage}`,
  `connect-src 'self' ${storage}`,
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join('; ');
const headers = {
  'Content-Security-Policy': csp,
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};
const routes = [{ src: '^/.*$', headers, continue: true }];

// 동일 출처 /api 아래 두 경로만 백엔드로 전달한다. /api 접두어는 여기서 떼어 낸다.
// - /api/healthz → /healthz (배포 확인)
// - /api/v1/*   → /v1/*     (API 명세 §1)
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
  routes.push({
    src: '^/api/v1/(.*)$',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    dest: `${url.origin}/v1/$1`,
  });
}
// 서비스 첫 화면은 독자 홈. 백엔드 연결 확인 페이지는 /status
routes.push({ src: '^/$', dest: '/home.html' });
routes.push({ src: '^/status$', dest: '/status.html' });
routes.push({ src: '^/series$', dest: '/series.html' });
routes.push({ src: '^/viewer$', dest: '/viewer.html' });
routes.push({ src: '^/dashboard$', dest: '/dashboard.html' });
routes.push({ src: '^/upload$', dest: '/upload.html' });
routes.push({ src: '^/processing$', dest: '/processing.html' });
routes.push({ src: '^/studio$', dest: '/studio.html' });
routes.push({ src: '^/publish$', dest: '/publish.html' });

const output = new URL('../.vercel/output/', import.meta.url);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(new URL('../public/', import.meta.url), new URL('static/', output), { recursive: true });
await writeFile(new URL('config.json', output), JSON.stringify({ version: 3, routes }, null, 2));
