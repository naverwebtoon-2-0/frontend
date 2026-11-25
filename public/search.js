import { apiErrorMessage, getPublicSeriesList, isMockMode } from './api.js';
import { applyPreferences } from './reader-store.js';
import { fillSlots, seriesCountLabel } from './common.js';

const $ = (selector) => document.querySelector(selector);
const state = { genre: '', status: '' };
applyPreferences();

const seriesHref = (id) => `/series?id=${encodeURIComponent(id)}`;

function renderCards(list) {
  $('#webtoon-grid').replaceChildren(...list.map((series) => {
    const li = $('#webtoon-card').content.firstElementChild.cloneNode(true);
    const card = li.querySelector('a');
    card.href = seriesHref(series.id);
    const completed = series.status === 'completed';
    fillSlots(li, {
      cover: series.title,
      title: series.title,
      meta: [series.author && `${series.author} 작가`, series.genre, completed ? '완결' : series.features.join('·')].filter(Boolean).join(' · '),
      count: seriesCountLabel(series),
    });
    card.setAttribute('aria-label', `${series.title}, ${li.querySelector('[data-slot="meta"]').textContent}`);
    return li;
  }));
  $('#empty').hidden = list.length > 0;
}

function queryState() {
  const params = new URLSearchParams(location.search);
  return { q: params.get('q') ?? '', genre: params.get('genre') ?? '', status: params.get('status') ?? '' };
}

function updateUrl() {
  const url = new URL('/search', location.origin);
  const q = $('#search-input').value.trim();
  if (q) url.searchParams.set('q', q);
  if (state.genre) url.searchParams.set('genre', state.genre);
  if (state.status) url.searchParams.set('status', state.status);
  history.pushState(null, '', url);
}

function renderFilters() {
  for (const button of $('#genre-filter').querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.genre === state.genre));
  $('#status-filter').value = state.status;
}

async function load() {
  const { q, genre, status } = queryState();
  state.genre = genre;
  state.status = status;
  $('#search-input').value = q;
  renderFilters();
  $('#search-page').setAttribute('aria-busy', 'true');
  $('#load-error').hidden = true;
  try {
    const list = await getPublicSeriesList({ q, genre: state.genre, serialStatus: state.status });
    renderCards(list);
    $('#result-count').textContent = `${list.length}개 작품`;
    $('#data-source').textContent = isMockMode() ? '미리보기 데이터' : '';
  } catch (error) {
    fillSlots(document, { 'load-error': apiErrorMessage(error, '작품 목록을 불러오지 못했습니다.') });
    $('#load-error').hidden = false;
  } finally {
    $('#search-page').setAttribute('aria-busy', 'false');
  }
}

$('#search-form').addEventListener('submit', (event) => { event.preventDefault(); updateUrl(); void load(); });
$('#genre-filter').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-genre]');
  if (!button) return;
  state.genre = button.dataset.genre;
  updateUrl();
  void load();
});
$('#status-filter').addEventListener('change', (event) => { state.status = event.target.value; updateUrl(); void load(); });
$('#retry').addEventListener('click', () => void load());
window.addEventListener('popstate', () => void load());
void load();
