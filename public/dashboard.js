// A1 작가 대시보드: API 데이터로 화면을 채운다.
// 명세에 없는 값(null)은 대체 문구를 쓰거나 숨긴다.
import { ApiError, apiErrorMessage, createSeries, getDashboard } from './api.js';
import { episodeLabel, fillSlots, formatApproxMinutes, formatDuration, formatRelative, renderHeader, setProgress } from './common.js';

// 회차 상태별 표시 문구와 다음 행동
const EPISODE_STATUS = {
  review_required: { label: '검수 필요', updated: (t) => `마지막 수정 ${t}`, action: '계속 편집 ›' },
  processing: { label: 'AI 처리 중', updated: (t) => `${t} 업로드`, action: '진행 보기 ›' },
  published: { label: '게시 완료', updated: (t) => `${t} 게시`, action: '통계 보기 ›' },
  scheduled: { label: '예약 게시', updated: (t) => `${t} 예약`, action: '예약 확인 ›' },
  failed: { label: '처리 실패', updated: (t) => `${t} 실패`, action: '다시 시도 ›' },
  draft: { label: '작성 중', updated: (t) => `${t} 생성`, action: '업로드 ›' },
};

const main = document.querySelector('#dashboard');
const loadError = document.querySelector('#load-error');
const dashboardStatus = document.querySelector('#dashboard-status');
const firstSeries = document.querySelector('#first-series');
const firstSeriesForm = document.querySelector('#first-series-form');
const firstSeriesError = document.querySelector('#first-series-error');
const createSeriesButton = document.querySelector('#create-series');
const seriesTitle = document.querySelector('#series-title');
const seriesDescription = document.querySelector('#series-description');
const descriptionCount = document.querySelector('#description-count');
const dashboardStats = document.querySelector('#dashboard-stats');
const dashboardWork = document.querySelector('#dashboard-work');
const primaryAction = document.querySelector('#dashboard-primary-action');
const rowTemplate = document.querySelector('#episode-row');
const studioHref = (episodeId) => `/studio?episode=${encodeURIComponent(episodeId)}`;

function showFirstSeries() {
  firstSeries.hidden = false;
  dashboardStats.hidden = true;
  dashboardWork.hidden = true;
  primaryAction.hidden = true;
  seriesTitle.focus();
}

function showDashboard() {
  firstSeries.hidden = true;
  dashboardStats.hidden = false;
  dashboardWork.hidden = false;
  primaryAction.hidden = false;
}

function actionHref(episode) {
  if (episode.status === 'review_required') return studioHref(episode.id);
  if (episode.status === 'draft' || episode.status === 'failed') return `/upload?episode=${encodeURIComponent(episode.id)}`;
  return null;
}

function renderEpisodes(episodes) {
  if (!episodes.length) {
    const empty = document.createElement('li');
    empty.className = 'episode-list__empty';
    empty.textContent = '아직 업로드한 회차가 없습니다.';
    document.querySelector('#recent-episodes').replaceChildren(empty);
    return;
  }
  const rows = episodes.map((episode) => {
    const status = EPISODE_STATUS[episode.status] ?? { label: episode.status, updated: (t) => t, action: '보기 ›' };
    const row = rowTemplate.content.firstElementChild.cloneNode(true);
    fillSlots(row, {
      name: episodeLabel(episode.number, episode.title),
      updated: status.updated(formatRelative(episode.updatedAt)),
      status: status.label,
      duration: episode.durationSeconds == null ? '' : formatDuration(episode.durationSeconds),
      action: status.action,
    });
    row.querySelector('[data-slot="duration"]').hidden = episode.durationSeconds == null;
    row.dataset.status = episode.status;
    const action = row.querySelector('[data-slot="action"]');
    const href = actionHref(episode);
    if (href) {
      action.href = href;
    } else {
      action.removeAttribute('href');
      action.setAttribute('aria-disabled', 'true');
      action.classList.add('episode-row__action--pending');
      action.textContent = `${status.label === '게시 완료' ? '통계' : '진행 보기'} 준비 중`;
    }
    return row;
  });
  document.querySelector('#recent-episodes').replaceChildren(...rows);
}

function render({ stats, currentWork, recentEpisodes }) {
  const { review } = currentWork;
  fillSlots(main, {
    'review-count': stats.reviewRequired.count,
    'review-note': stats.reviewRequired.problemScenes == null ? '작가 확인 대기' : `문제 장면 ${stats.reviewRequired.problemScenes}개`,
    'processing-count': stats.processing.count,
    'processing-note': stats.processing.remainingSeconds == null ? '분석·음성 생성' : `${formatApproxMinutes(stats.processing.remainingSeconds)} 남음`,
    'published-count': stats.published.count,
    'published-note': `이번 달 ${stats.published.thisMonth}개`,
    'work-title': currentWork.title,
    'work-meta': currentWork.meta,
    'review-label': !review ? '검수할 회차 없음' : review.progress == null ? `${review.episodeNumber}화 검수 대기` : `${review.episodeNumber}화 검수 진행률`,
    'review-percent': review?.progress == null ? '' : `${review.progress}%`,
    'review-detail': !review
      ? '현재 검수할 회차가 없습니다.'
      : '장면과 음성을 확인한 뒤 게시 전 확인을 완료하세요.',
  });

  // 검수 진행률은 명세에 아직 없어 값이 있을 때만 막대를 보인다.
  const bar = document.querySelector('#review-progress');
  bar.hidden = review?.progress == null;
  if (review?.progress != null) setProgress(bar, review.progress);

  if (review) {
    const href = studioHref(review.episodeId);
    primaryAction.href = href;
    primaryAction.textContent = `${review.episodeNumber}화 검수 계속하기`;
    primaryAction.setAttribute('aria-label', `${review.episodeNumber}화 검수 계속하기`);
  } else {
    primaryAction.href = '/upload';
    primaryAction.textContent = '＋ 새 회차 업로드';
    primaryAction.setAttribute('aria-label', '새 회차 업로드');
  }

  renderEpisodes(recentEpisodes);
}

async function load() {
  main.setAttribute('aria-busy', 'true');
  loadError.hidden = true;
  try {
    const data = await getDashboard();
    showDashboard();
    render(data);
  } catch (error) {
    if (error instanceof ApiError && error.code === 'NO_SERIES') {
      showFirstSeries();
    } else {
      loadError.hidden = false;
    }
  } finally {
    main.setAttribute('aria-busy', 'false');
  }
}

async function handleFirstSeriesSubmit(event) {
  event.preventDefault();
  if (!firstSeriesForm.reportValidity()) return;

  const formData = new FormData(firstSeriesForm);
  const title = String(formData.get('title')).trim();
  if (!title) {
    seriesTitle.setCustomValidity('작품명을 입력해주세요.');
    seriesTitle.reportValidity();
    return;
  }

  firstSeriesError.hidden = true;
  createSeriesButton.disabled = true;
  createSeriesButton.textContent = '작품 만드는 중…';
  firstSeriesForm.setAttribute('aria-busy', 'true');

  try {
    await createSeries({
      title,
      genre: String(formData.get('genre')),
      description: String(formData.get('description')).trim(),
    });
    dashboardStatus.textContent = '첫 작품이 생성되었습니다. 이제 첫 회차를 업로드해보세요.';
    dashboardStatus.hidden = false;
    showDashboard();
    await load();
  } catch (error) {
    firstSeriesError.textContent = apiErrorMessage(error, '작품을 만들지 못했습니다. 잠시 후 다시 시도해주세요.');
    firstSeriesError.hidden = false;
    firstSeriesError.focus();
  } finally {
    firstSeriesForm.removeAttribute('aria-busy');
    createSeriesButton.disabled = false;
    createSeriesButton.textContent = '첫 작품 만들기';
  }
}

document.querySelector('#retry').addEventListener('click', load);
firstSeriesForm.addEventListener('submit', handleFirstSeriesSubmit);
seriesTitle.addEventListener('input', () => seriesTitle.setCustomValidity(''));
seriesDescription.addEventListener('input', () => {
  descriptionCount.textContent = `${seriesDescription.value.length.toLocaleString('ko-KR')} / 5,000자`;
});
void renderHeader();
void load();
