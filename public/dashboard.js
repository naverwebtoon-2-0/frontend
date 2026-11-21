// A1 작가 대시보드: API 데이터로 화면을 채운다.
import { getDashboard } from './api.js';
import { fillSlots, formatApproxMinutes, formatDuration, formatRelative, renderHeader, setProgress } from './common.js';

const WORK_STATUS = { serializing: '연재 중', completed: '완결', paused: '휴재' };

// 회차 상태별 표시 문구와 다음 행동
const EPISODE_STATUS = {
  review_required: { label: '검수 필요', updated: (t) => `마지막 수정 ${t}`, action: '계속 편집 ›' },
  processing: { label: 'AI 처리 중', updated: (t) => `${t} 업로드`, action: '진행 보기 ›' },
  published: { label: '게시 완료', updated: (t) => `${t} 게시`, action: '통계 보기 ›' },
};

const main = document.querySelector('#dashboard');
const loadError = document.querySelector('#load-error');
const rowTemplate = document.querySelector('#episode-row');

function renderEpisodes(episodes) {
  const rows = episodes.map((episode) => {
    const status = EPISODE_STATUS[episode.status] ?? { label: episode.status, updated: (t) => t, action: '보기 ›' };
    const row = rowTemplate.content.firstElementChild.cloneNode(true);
    fillSlots(row, {
      name: `${episode.number}화 · ${episode.title}`,
      updated: status.updated(formatRelative(episode.updatedAt)),
      status: status.label,
      duration: formatDuration(episode.durationSeconds),
      action: status.action,
    });
    row.querySelector('[data-slot="action"]').href = episode.status === 'review_required'
      ? `/studio?episode=${encodeURIComponent(episode.id)}`
      : `#episode-${episode.id}`;
    return row;
  });
  document.querySelector('#recent-episodes').replaceChildren(...rows);
}

function render({ stats, currentWork, recentEpisodes }) {
  fillSlots(main, {
    'review-count': stats.reviewRequired.count,
    'review-note': `문제 장면 ${stats.reviewRequired.problemScenes}개`,
    'processing-count': stats.processing.count,
    'processing-note': `${formatApproxMinutes(stats.processing.remainingSeconds)} 남음`,
    'published-count': stats.published.count,
    'published-note': `이번 달 ${stats.published.thisMonth}개`,
    'work-title': currentWork.title,
    'work-meta': [currentWork.genre, WORK_STATUS[currentWork.status] ?? currentWork.status, `총 ${currentWork.episodeCount}화`].join(' · '),
    'review-label': `${currentWork.review.episodeNumber}화 검수 진행률`,
    'review-percent': `${currentWork.review.progress}%`,
  });
  setProgress(document.querySelector('#review-progress'), currentWork.review.progress);
  renderEpisodes(recentEpisodes);
}

async function load() {
  main.setAttribute('aria-busy', 'true');
  loadError.hidden = true;
  try {
    render(await getDashboard());
  } catch {
    loadError.hidden = false;
  } finally {
    main.setAttribute('aria-busy', 'false');
  }
}

document.querySelector('#retry').addEventListener('click', load);
void renderHeader();
void load();
