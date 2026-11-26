// 여러 화면에서 쓰는 표시 형식과 공통 렌더링
import { getMe } from './api.js';

const relativeTime = new Intl.RelativeTimeFormat('ko', { numeric: 'auto' });
const UNITS = [
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
];

/** ISO 시각 → "10분 전", "어제", "3일 전" */
export function formatRelative(iso) {
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000;
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return relativeTime.format(Math.round(seconds / size), unit);
  }
  return '방금';
}

/** 초 → "12:40" */
export function formatDuration(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(Math.round(totalSeconds % 60)).padStart(2, '0');
  return `${String(minutes).padStart(2, '0')}:${seconds}`;
}

/** 초 → "약 4분" */
export function formatApproxMinutes(totalSeconds) {
  return `약 ${Math.max(1, Math.round(totalSeconds / 60))}분`;
}

/** 공개 작품 카드의 회차 수. 최신 회차 번호가 없으면 API가 제공하는 게시 회차 수를 쓴다. */
export function seriesCountLabel(series) {
  if (series.status === 'completed' || series.latestEpisodeNumber == null) return `총 ${series.episodeCount}화`;
  return `최신 ${series.latestEpisodeNumber}화`;
}

/** data-slot="name" 요소에 텍스트를 채운다. */
export function fillSlots(root, values) {
  for (const [name, value] of Object.entries(values)) {
    for (const el of root.querySelectorAll(`[data-slot="${name}"]`)) el.textContent = value;
  }
}

/** 진행률 막대를 갱신한다. CSP가 인라인 style 속성을 막아 JS로 너비를 지정한다. */
export function setProgress(bar, percent) {
  const value = Math.min(100, Math.max(0, percent));
  bar.setAttribute('aria-valuenow', String(value));
  bar.querySelector('.progress__value').style.width = `${value}%`;
}

/** 헤더의 작가 이름 */
export async function renderHeader() {
  try {
    const me = await getMe();
    fillSlots(document, { 'author-name': me.name });
  } catch {
    fillSlots(document, { 'author-name': '' });
  }
}

/** "12화 · 빗속의 약속". 제목이 "12화"처럼 번호와 같으면 한 번만 쓴다. */
export function episodeLabel(number, title) {
  const prefix = `${number}화`;
  return !title || title.trim() === prefix ? prefix : `${prefix} · ${title}`;
}
