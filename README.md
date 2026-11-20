# naverwebtoon 2.0 프런트엔드

Node.js 24에서 `npm run check`와 `npm run build`를 실행한다. 빌드 출력은
`.vercel/output`에 생성된다.

GitHub Actions는 `main`, `dev` 및 두 브랜치 대상 PR에서 빌드한다. `main`에서
성공한 빌드는 `production` 환경을 통해 Vercel에 배포한다. Vercel 프로젝트는
Git 자동 배포 연결 없이 만든다.

- GitHub `production` 환경 Secrets: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`
- GitHub 저장소 Actions 변수: `NCP_BACKEND_ORIGIN` (예: `https://203.0.113.10`)

백엔드 공인 IP의 유효한 TLS 인증서를 확인하고 변수를 설정한 뒤 `main`에서
워크플로를 다시 실행한다. 운영 주소의 `/api/healthz`가 백엔드의 JSON을 반환하면 연동된 상태다.
