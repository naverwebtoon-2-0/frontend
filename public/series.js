// R2 작품 상세·회차 목록
import { getPublicEpisodes, getPublicSeries } from './api.js';
import { episodeLabel, fillSlots, formatDuration } from './common.js';
import { applyPreferences, getProgress, getSeriesProgress, isFavorite, toggleFavorite } from './reader-store.js';

const $ = (selector) => document.querySelector(selector);
const seriesId = new URLSearchParams(location.search).get('id');
const NEW_DAYS = 7;

applyPreferences();

const viewerHref = (episodeId) => `/viewer?episode=${encodeURIComponent(episodeId)}`;

let episodes = [];

let toastTimer;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2000);
}

/** 회차의 감상 상태: listening(듣는 중) · done(완료) · new(최근 게시) · none */
function episodeState(episode) {
  const progress = getProgress(episode.id);
  if (progress?.completed) return { state: 'done', label: '완료', note: '감상 완료', action: '다시 듣기 ›' };
  if (progress) {
    return {
      state: 'listening',
      label: '이어 듣기',
      note: `장면 ${progress.sceneIndex + 1}/${progress.sceneCount}까지 감상`,
      action: '재생 ›',
    };
  }
  const fresh = episode.publishedAt && Date.now() - new Date(episode.publishedAt) < NEW_DAYS * 86_400_000;
  return { state: fresh ? 'new' : 'none', label: fresh ? '새 회차' : '', note: '미감상', action: '재생 ›' };
}

function renderEpisodes() {
  const order = $('#sort').value;
  const list = [...episodes].sort((a, b) => (order === 'first' ? a.number - b.number : b.number - a.number));
  $('#episode-list').replaceChildren(...list.map((episode) => {
    const row = document.getElementById('episode-row').content.firstElementChild.cloneNode(true);
    const info = episodeState(episode);
    row.dataset.state = info.state;
    fillSlots(row, {
      name: episodeLabel(episode.number, episode.title),
      progress: info.note,
      state: info.label,
      duration: episode.durationSeconds == null ? '' : formatDuration(episode.durationSeconds),
      action: info.action,
    });
    row.querySelector('[data-slot="state"]').hidden = !info.label;
    const action = row.querySelector('[data-slot="action"]');
    action.href = viewerHref(episode.id);
    action.setAttribute('aria-label', `${episodeLabel(episode.number, episode.title)} ${info.action.replace(' ›', '')}`);
    return row;
  }));
}

function renderFavorite() {
  const on = isFavorite(seriesId);
  const button = $('#favorite');
  button.setAttribute('aria-pressed', String(on));
  button.textContent = on ? '♥ 보관함에 있음' : '♡ 보관함';
}

async function load() {
  try {
    const [series, list] = await Promise.all([getPublicSeries(seriesId), getPublicEpisodes(seriesId)]);
    episodes = list;
    document.title = `${series.title} · 울림툰`;
    const cover = $('#cover');
    cover.textContent = series.title;
    fillSlots(document, {
      title: series.title,
      meta: [series.author && `${series.author} 작가`, series.genre, series.ageRating].filter(Boolean).join(' · '),
      description: series.description,
      features: [...series.features.map((f) => `${f} 제공`), `${series.status === 'completed' ? '완결 · ' : ''}총 ${series.episodeCount}화`].join(' · '),
    });

    const first = [...list].sort((a, b) => a.number - b.number)[0];
    $('#from-first').href = first ? viewerHref(first.id) : '#';
    const progress = getSeriesProgress(seriesId);
    const resume = $('#resume');
    resume.hidden = !progress;
    if (progress) {
      resume.href = viewerHref(progress.episodeId);
      fillSlots(document, { resume: progress.completed ? `▶ ${progress.number}화 다시 듣기` : `▶ ${progress.number}화 이어 듣기` });
    }
    renderFavorite();
    renderEpisodes();
  } catch {
    fillSlots(document, { 'load-error': '작품을 찾을 수 없습니다.' });
    $('#load-error').hidden = false;
    $('.detail-hero').hidden = true;
    $('.episodes').hidden = true;
  } finally {
    $('#series').setAttribute('aria-busy', 'false');
  }
}

$('#sort').addEventListener('change', renderEpisodes);
$('#favorite').addEventListener('click', () => {
  const on = toggleFavorite(seriesId);
  renderFavorite();
  toast(on ? '보관함에 담았습니다.' : '보관함에서 뺐습니다.');
});

if (seriesId) {
  void load();
} else {
  $('#load-error').hidden = false;
  $('.detail-hero').hidden = true;
  $('.episodes').hidden = true;
  $('#series').setAttribute('aria-busy', 'false');
}
