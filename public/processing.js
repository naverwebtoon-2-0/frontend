// A3 AI 처리 진행: 작업 상태를 주기적으로 조회해 진행률과 단계를 갱신한다.
import { getProcessingJob } from './api.js';
import { episodeLabel, fillSlots, formatApproxMinutes, renderHeader, setProgress } from './common.js';

const POLL_MS = 2000;

// 명세 §5 파이프라인 단계(ocr → structure → dubbing → build_cues). 서버는 key·status와 진행 수만 보낸다.
const progressText = (verb) => (s) => (s.total ? `${s.processed ?? 0}/${s.total} ${verb}` : verb);
const STEPS = {
  upload: { label: '원고 업로드', done: (s) => `${s.pageCount}개 페이지 완료` },
  ocr: { label: '말풍선 글자 인식', running: progressText('페이지 인식 중'), done: () => '인식 완료' },
  structure: { label: '인물·대사 정리', running: progressText('항목 정리 중'), done: () => '정리 완료' },
  dubbing: { label: '음성·효과음 생성', running: progressText('항목 생성 중'), done: () => '생성 완료' },
  build_cues: { label: '재생 타임라인 구성', running: () => '구성 중', done: () => '구성 완료' },
};

const STATUS_TEXT = { pending: '대기 중', running: '처리 중', done: '완료', failed: '오류' };

const card = document.querySelector('#job');
const stepList = document.querySelector('#steps');
const stepTemplate = document.querySelector('#process-step');
const loadError = document.querySelector('#load-error');
const nextAction = document.querySelector('#next-action');
const jobId = new URLSearchParams(location.search).get('job');

let timer;

function marker(step, index) {
  if (step.status === 'done') return '✓';
  if (step.status === 'running') return '●';
  if (step.status === 'failed') return '!';
  return String(index + 1);
}

function renderSteps(steps) {
  const items = steps.map((step, index) => {
    const meta = STEPS[step.key] ?? { label: step.key };
    const item = stepTemplate.content.firstElementChild.cloneNode(true);
    item.dataset.status = step.status;
    if (step.status === 'running') item.setAttribute('aria-current', 'step');
    fillSlots(item, {
      marker: marker(step, index),
      label: meta.label,
      detail: meta[step.status]?.(step) ?? STATUS_TEXT[step.status] ?? step.status,
    });
    return item;
  });
  stepList.replaceChildren(...items);
}

function render(job) {
  const completed = job.status === 'completed';
  const failed = job.status === 'failed';
  fillSlots(card, {
    headline: completed ? '오디오 초안이 준비됐습니다' : failed ? '처리 중 문제가 생겼습니다' : '오디오 초안을 만들고 있습니다',
    episode: episodeLabel(job.episode.number, job.episode.title),
    hint: completed ? '검수를 시작해 결과를 확인하세요.' : '페이지를 닫아도 작업은 계속됩니다.',
    overall: completed ? '100% · 완료' : job.remainingSeconds == null ? `${job.progress}%` : `${job.progress}% · ${formatApproxMinutes(job.remainingSeconds)} 남음`,
    errors: job.errorMessage ? `처리 오류: ${job.errorMessage}` : `처리 오류 ${job.errorCount}건`,
  });
  setProgress(document.querySelector('#overall-progress'), job.progress);
  renderSteps(job.steps);
  nextAction.hidden = !completed;
  nextAction.href = `/studio?episode=${encodeURIComponent(job.episode.id)}`;
  return completed || failed;
}

async function poll() {
  clearTimeout(timer);
  try {
    const finished = render(await getProcessingJob(jobId));
    loadError.hidden = true;
    card.setAttribute('aria-busy', 'false');
    if (!finished) timer = setTimeout(poll, POLL_MS);
  } catch {
    loadError.hidden = false;
    card.setAttribute('aria-busy', 'false');
  }
}

// 탭이 가려지면 조회를 멈추고, 다시 보이면 바로 갱신한다.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) clearTimeout(timer);
  else if (loadError.hidden) void poll();
});

document.querySelector('#retry').addEventListener('click', poll);
void renderHeader();

if (jobId) {
  void poll();
} else {
  fillSlots(card, { error: '처리 중인 작업을 찾을 수 없습니다.' });
  document.querySelector('#retry').hidden = true;
  loadError.hidden = false;
  card.setAttribute('aria-busy', 'false');
}
