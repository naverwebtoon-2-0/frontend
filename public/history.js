import { episodeLabel, fillSlots, formatDuration, formatRelative } from './common.js';
import { applyPreferences, getAllProgress } from './reader-store.js';

const $ = (selector) => document.querySelector(selector);
applyPreferences();
const viewerHref = (id) => `/viewer?episode=${encodeURIComponent(id)}`;

const entries = getAllProgress();
$('#history-list').replaceChildren(...entries.map((entry) => {
  const item = $('#history-item').content.firstElementChild.cloneNode(true);
  const completed = Boolean(entry.completed);
  fillSlots(item, {
    title: `${entry.seriesTitle} · ${episodeLabel(entry.number, entry.title)}`,
    detail: completed ? `${formatRelative(entry.updatedAt)} · 감상 완료` : `${formatRelative(entry.updatedAt)} · ${formatDuration(entry.time)}까지 감상`,
    state: completed ? '완료' : '듣는 중',
    action: completed ? '다시 듣기' : '계속 듣기',
  });
  const link = item.querySelector('a');
  link.href = viewerHref(entry.episodeId);
  link.setAttribute('aria-label', `${entry.seriesTitle} ${entry.number}화 ${completed ? '다시 듣기' : '계속 듣기'}`);
  return item;
}));
$('#history-count').textContent = entries.length ? `${entries.length}개 회차` : '';
$('#empty').hidden = entries.length > 0;
