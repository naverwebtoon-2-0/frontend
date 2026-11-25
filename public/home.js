// R1 독자 홈: 검색, 이어 듣기, 새로 올라온 오디오 웹툰, 접근성 빠른 설정
import { apiErrorMessage, getPublicEpisodes, getPublicSeriesList } from './api.js';
import { episodeLabel, fillSlots, formatDuration, seriesCountLabel } from './common.js';
import { applyPreferences, getLatestProgress, getSettings, saveSettings } from './reader-store.js';
import { renderSettings } from './reader-settings.js';

const $ = (selector) => document.querySelector(selector);
const TEXT_SCALES = [100, 112, 125];

applyPreferences();

const seriesHref = (id) => `/series?id=${encodeURIComponent(id)}`;
const viewerHref = (episodeId) => `/viewer?episode=${encodeURIComponent(episodeId)}`;

function coverText(el, series) {
  el.textContent = series.title;
  if (series.coverUrl) {
    const img = document.createElement('img');
    img.src = series.coverUrl;
    img.alt = '';
    el.replaceChildren(img);
  }
}

function renderCards(list) {
  $('#webtoon-grid').replaceChildren(...list.map((series) => {
    const li = document.getElementById('webtoon-card').content.firstElementChild.cloneNode(true);
    const card = li.querySelector('a');
    card.href = seriesHref(series.id);
    const completed = series.status === 'completed';
    fillSlots(li, {
      title: series.title,
      meta: [series.genre, completed ? '완결' : series.features.join('·')].filter(Boolean).join(' · '),
      count: seriesCountLabel(series),
    });
    coverText(li.querySelector('[data-slot="cover"]'), series);
    card.setAttribute('aria-label', `${series.title}, ${li.querySelector('[data-slot="meta"]').textContent}, ${li.querySelector('[data-slot="count"]').textContent}`);
    return li;
  }));
  $('#empty').hidden = list.length > 0;
}

/** 이어 듣기: 이 브라우저에서 듣던 회차. 없으면 최신 작품의 1화를 권한다. */
async function renderContinue(list) {
  const section = $('#continue');
  const progress = getLatestProgress();
  const bar = $('#continue-progress');
  if (progress) {
    const percent = progress.duration ? Math.round((progress.time / progress.duration) * 100) : 0;
    fillSlots(section, {
      'continue-label': '이어 듣기',
      'continue-title': `${progress.seriesTitle} · ${episodeLabel(progress.number, progress.title)}`,
      'continue-detail': `장면 ${progress.sceneIndex + 1}/${progress.sceneCount} · ${formatDuration(progress.time)}부터`,
      'continue-action': '계속 듣기',
    });
    bar.hidden = false;
    bar.setAttribute('aria-valuenow', String(percent));
    bar.querySelector('span').style.width = `${percent}%`;
    $('#continue-link').href = viewerHref(progress.episodeId);
    coverText($('#continue-cover'), { title: progress.seriesTitle });
    section.hidden = false;
    return;
  }
  const pick = list[0];
  if (!pick) {
    section.hidden = true;
    return;
  }
  const [first] = await getPublicEpisodes(pick.id);
  if (!first) return;
  fillSlots(section, {
    'continue-label': '처음 들어 보기',
    'continue-title': pick.title,
    'continue-detail': `${pick.genre ?? ''} · ${pick.description}`,
    'continue-action': '1화 듣기',
  });
  bar.hidden = true;
  $('#continue-link').href = viewerHref(first.id);
  coverText($('#continue-cover'), pick);
  section.hidden = false;
}

async function load() {
  const q = new URLSearchParams(location.search).get('q') ?? '';
  $('#search-input').value = q;
  $('#home').setAttribute('aria-busy', 'true');
  $('#load-error').hidden = true;
  try {
    const list = await getPublicSeriesList({ q });
    renderCards(list);
    fillSlots(document, { 'list-title': q ? `‘${q}’ 검색 결과 ${list.length}개` : '새로 올라온 오디오 웹툰' });
    $('#clear-search').hidden = !q;
    if (q) $('#continue').hidden = true;
    else await renderContinue(list);
  } catch (error) {
    fillSlots(document, { 'load-error': apiErrorMessage(error, '작품 목록을 불러오지 못했습니다.') });
    $('#load-error').hidden = false;
  } finally {
    $('#home').setAttribute('aria-busy', 'false');
  }
}

// ── 검색 ─────────────────────────────────────────────

$('#search-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const q = $('#search-input').value.trim();
  const url = new URL('/search', location.origin);
  if (q) url.searchParams.set('q', q);
  location.assign(url);
});
$('#clear-search').addEventListener('click', () => {
  history.pushState(null, '', '/');
  void load();
  $('#search-input').focus();
});
window.addEventListener('popstate', () => void load());

// ── 접근성 빠른 설정 ─────────────────────────────────────

function renderQuickActions() {
  const s = getSettings();
  $('#toggle-contrast').setAttribute('aria-pressed', String(s.highContrast));
  $('#text-scale').textContent = `${s.textScale}%`;
}

$('#toggle-contrast').addEventListener('click', () => {
  saveSettings({ highContrast: !getSettings().highContrast });
  renderQuickActions();
});
$('#cycle-text').addEventListener('click', () => {
  const current = getSettings().textScale;
  saveSettings({ textScale: TEXT_SCALES[(TEXT_SCALES.indexOf(current) + 1) % TEXT_SCALES.length] });
  renderQuickActions();
});

const settingsModal = $('#settings-modal');
$('#open-settings').addEventListener('click', () => {
  renderSettings($('#settings-form'), renderQuickActions);
  settingsModal.showModal();
});
settingsModal.querySelector('[data-close]').addEventListener('click', () => settingsModal.close());
settingsModal.addEventListener('click', (event) => {
  if (event.target === settingsModal) settingsModal.close();
});

$('#retry').addEventListener('click', () => void load());

renderQuickActions();
void load();
