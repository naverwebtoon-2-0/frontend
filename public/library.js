import { apiErrorMessage, getPublicSeriesList } from './api.js';
import { episodeLabel, fillSlots, formatDuration, seriesCountLabel } from './common.js';
import { applyPreferences, getAllProgress, getFavoriteIds } from './reader-store.js';

const $ = (selector) => document.querySelector(selector);
applyPreferences();
const viewerHref = (id) => `/viewer?episode=${encodeURIComponent(id)}`;
const seriesHref = (id) => `/series?id=${encodeURIComponent(id)}`;

function renderContinue() {
  const entries = getAllProgress().filter((entry) => !entry.completed);
  $('#continue-list').replaceChildren(...entries.map((entry) => {
    const item = $('#continue-item').content.firstElementChild.cloneNode(true);
    const percent = entry.duration ? Math.round((entry.time / entry.duration) * 100) : 0;
    fillSlots(item, { title: `${entry.seriesTitle} · ${episodeLabel(entry.number, entry.title)}`, detail: `${formatDuration(entry.time)}부터 · 장면 ${entry.sceneIndex + 1}/${entry.sceneCount}`, action: '계속 듣기' });
    const bar = item.querySelector('[role="progressbar"]');
    bar.setAttribute('aria-valuenow', String(percent));
    bar.querySelector('span').style.width = `${percent}%`;
    const link = item.querySelector('a');
    link.href = viewerHref(entry.episodeId);
    link.setAttribute('aria-label', `${entry.seriesTitle} ${entry.number}화 계속 듣기`);
    return item;
  }));
  $('#continue-empty').hidden = entries.length > 0;
}

function renderSaved(list) {
  const favoriteIds = new Set(getFavoriteIds());
  const saved = list.filter((series) => favoriteIds.has(series.id));
  $('#saved-grid').replaceChildren(...saved.map((series) => {
    const li = $('#webtoon-card').content.firstElementChild.cloneNode(true);
    const card = li.querySelector('a');
    card.href = seriesHref(series.id);
    fillSlots(li, { cover: series.title, title: series.title, meta: [series.author && `${series.author} 작가`, series.genre].filter(Boolean).join(' · '), count: seriesCountLabel(series) });
    return li;
  }));
  $('#saved-empty').hidden = saved.length > 0;
}

async function load() {
  $('#library').setAttribute('aria-busy', 'true');
  $('#load-error').hidden = true;
  renderContinue();
  try { renderSaved(await getPublicSeriesList()); } catch (error) {
    fillSlots(document, { 'load-error': apiErrorMessage(error, '보관한 작품을 불러오지 못했습니다.') });
    $('#load-error').hidden = false;
  } finally { $('#library').setAttribute('aria-busy', 'false'); }
}

$('#retry').addEventListener('click', () => void load());
void load();
