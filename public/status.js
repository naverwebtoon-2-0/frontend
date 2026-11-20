const status = document.querySelector('#health');
const retry = document.querySelector('#retry');

async function checkBackend() {
  retry.hidden = true;
  status.textContent = '백엔드 연결 확인 중';

  try {
    const response = await fetch('/api/healthz', {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok || (await response.json()).status !== 'ok') {
      throw new Error('상태 API 응답 오류');
    }
    status.textContent = '백엔드 연결 정상';
  } catch {
    status.textContent = '백엔드에 연결할 수 없습니다.';
    retry.hidden = false;
  }
}

retry.addEventListener('click', checkBackend);
void checkBackend();
