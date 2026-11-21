// R3 웹툰 감상 플레이어: 화면해설과 대사를 순서대로 재생하고, 장면 이미지와 자막을 함께 보여 준다.
// 음원 URL(audio_url)이 아직 없어 재생 위치만 움직인다. 음원이 오면 큐마다 <audio>를 재생하면 된다.
import { getPublicEpisode } from './api.js';
import { episodeLabel, fillSlots, formatDuration } from './common.js';
import { applyPreferences, getProgress, getSettings, saveProgress } from './reader-store.js';
import { renderSettings } from './reader-settings.js';

const $ = (selector) => document.querySelector(selector);
const episodeId = new URLSearchParams(location.search).get('episode');
const SEEK_STEP = 10;
const SAVE_EVERY_MS = 5000;
const AUTO_NEXT_DELAY_MS = 3000;
const KIND_LABEL = { description: '화면해설', narration: '원문 나레이션', dialogue: '대사', sfx: '효과음' };

applyPreferences();

const state = {
  episode: null,
  settings: getSettings(),
  time: 0,
  playing: false,
  cueId: null,
  sceneIndex: 0,
  lastSaved: 0,
  autoNextTimer: null,
};

let toastTimer;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2500);
}

// ── 현재 위치 계산 ────────────────────────────────────

/** 지금 들리는 말(화면해설·나레이션·대사)을 우선하고, 없으면 효과음, 그것도 없으면 직전 큐 */
function currentCue() {
  const { cues } = state.episode;
  const active = cues.filter((c) => state.time >= c.start && state.time < c.start + c.duration);
  return active.find((c) => c.kind !== 'sfx') ?? active[0]
    ?? [...cues].reverse().find((c) => c.start <= state.time) ?? cues[0] ?? null;
}

function sceneIndexAt(time) {
  const { scenes } = state.episode;
  let index = 0;
  scenes.forEach((scene, i) => {
    if (scene.start != null && scene.start <= time + 0.001) index = i;
  });
  return index;
}

function nextSpeechCue(cue) {
  const { cues } = state.episode;
  return cues.find((c) => c.kind !== 'sfx' && c.start > (cue?.start ?? -1));
}

function cueLabel(cue) {
  if (!cue) return '';
  if (cue.kind === 'dialogue') return cue.speaker ?? '대사';
  return KIND_LABEL[cue.kind] ?? '';
}

// ── 그리기 ────────────────────────────────────────────

function renderScene() {
  const { scenes } = state.episode;
  const scene = scenes[state.sceneIndex];
  fillSlots(document, { 'scene-count': `장면 ${state.sceneIndex + 1} / ${scenes.length}` });
  const img = $('#scene-image');
  if (scene?.url && img.getAttribute('src') !== scene.url) img.src = scene.url;
  img.hidden = !scene?.url;
  img.alt = scene?.alt || `장면 ${state.sceneIndex + 1}`;
}

/** 자막은 큐가 바뀔 때만 갱신한다(스크린 리더가 매 프레임 읽지 않도록). */
function renderCue(force = false) {
  const cue = currentCue();
  if (!force && cue?.id === state.cueId) return;
  state.cueId = cue?.id ?? null;
  const next = nextSpeechCue(cue);
  const box = $('#now-playing');
  box.dataset.kind = cue?.kind ?? '';
  fillSlots(box, {
    kind: cueLabel(cue),
    text: cue ? (cue.kind === 'sfx' ? `[${cue.text}]` : cue.text) : '재생할 내용이 없습니다.',
    next: next ? `다음: ${cueLabel(next)} “${next.text}”` : '마지막 장면입니다.',
  });
}

function renderTime() {
  const { durationSeconds } = state.episode;
  const seek = $('#seek');
  seek.value = String(state.time);
  seek.setAttribute('aria-valuetext', `${formatDuration(state.time)} / ${formatDuration(durationSeconds)}`);
  fillSlots(document, { 'time-current': formatDuration(state.time) });
  $('#play').setAttribute('aria-pressed', String(state.playing));
  $('#play').setAttribute('aria-label', state.playing ? '일시정지' : '재생');
  $('#prev-scene').disabled = state.sceneIndex === 0;
  $('#next-scene').disabled = state.sceneIndex >= state.episode.scenes.length - 1;
}

function render(force = false) {
  const scene = sceneIndexAt(state.time);
  const sceneChanged = scene !== state.sceneIndex;
  state.sceneIndex = scene;
  if (sceneChanged || force) renderScene();
  renderCue(force);
  renderTime();
  return sceneChanged;
}

// ── 진행 저장 (이 브라우저) ─────────────────────────────

function persist({ completed = false } = {}) {
  const { episode } = state;
  if (!episode) return;
  saveProgress({
    episodeId: episode.id,
    seriesId: episode.series.id,
    seriesTitle: episode.series.title,
    number: episode.number,
    title: episode.title,
    time: completed ? 0 : state.time,
    duration: episode.durationSeconds,
    sceneIndex: completed ? episode.scenes.length - 1 : state.sceneIndex,
    sceneCount: episode.scenes.length,
    completed,
  });
  state.lastSaved = Date.now();
}

// ── 재생 ─────────────────────────────────────────────

let lastFrame;
function tick(now) {
  if (!state.playing) return;
  const { durationSeconds } = state.episode;
  state.time = Math.min(durationSeconds, state.time + ((now - lastFrame) / 1000) * state.settings.playbackRate);
  lastFrame = now;
  const before = state.sceneIndex;
  const sceneChanged = render();

  if (sceneChanged && !state.settings.autoNextScene && state.sceneIndex > before) {
    // 자동 다음 장면이 꺼져 있으면 새 장면 시작에서 멈춘다.
    state.time = state.episode.scenes[state.sceneIndex].start;
    setPlaying(false);
    toast('다음 장면에서 멈췄습니다. Space로 이어서 들을 수 있습니다.');
    return;
  }
  if (state.time >= durationSeconds) {
    finish();
    return;
  }
  if (Date.now() - state.lastSaved > SAVE_EVERY_MS) persist();
  requestAnimationFrame(tick);
}

function setPlaying(playing) {
  if (!state.episode) return;
  clearTimeout(state.autoNextTimer);
  state.autoNextTimer = null;
  if (playing && state.time >= state.episode.durationSeconds) state.time = 0;
  state.playing = playing;
  $('#next-episode').hidden = true;
  if (playing) {
    lastFrame = performance.now();
    requestAnimationFrame(tick);
  } else {
    persist();
  }
  renderTime();
}

function seek(time) {
  state.time = Math.max(0, Math.min(state.episode.durationSeconds, time));
  render();
  persist();
}

function goScene(delta) {
  const { scenes } = state.episode;
  const target = scenes[Math.max(0, Math.min(scenes.length - 1, state.sceneIndex + delta))];
  if (target?.start != null) seek(target.start);
}

function replayDescription() {
  const cue = state.episode.cues.find((c) => c.kind === 'description' && c.imageIndex === state.episode.scenes[state.sceneIndex].index);
  if (!cue) {
    toast('이 장면에는 화면해설이 없습니다.');
    return;
  }
  seek(cue.start);
  setPlaying(true);
}

function finish() {
  state.playing = false;
  state.time = state.episode.durationSeconds;
  render(true);
  persist({ completed: true });
  const { nextEpisodeId } = state.episode;
  const nextButton = $('#next-episode');
  if (!nextEpisodeId) {
    toast('마지막 회차까지 감상했습니다.');
    return;
  }
  nextButton.href = `/viewer?episode=${encodeURIComponent(nextEpisodeId)}`;
  nextButton.hidden = false;
  if (state.settings.autoNextEpisode) {
    toast('3초 후 다음 화를 재생합니다. Space를 누르면 취소합니다.');
    state.autoNextTimer = setTimeout(() => location.assign(`${nextButton.href}&autoplay=1`), AUTO_NEXT_DELAY_MS);
  }
}

// ── 불러오기 ──────────────────────────────────────────

async function load({ keepTime = false } = {}) {
  const previousTime = state.time;
  const previousScene = state.sceneIndex;
  const episode = await getPublicEpisode(episodeId, { includeDescription: state.settings.narrationMode === 'separate' });
  state.episode = episode;
  document.title = `${episode.series.title} · ${episodeLabel(episode.number, episode.title)} · 울림툰`;
  fillSlots(document, {
    title: `${episode.series.title} · ${episodeLabel(episode.number, episode.title)}`,
    subtitle: state.settings.narrationMode === 'separate' ? '화면해설과 대사를 순서대로 재생합니다.' : '원문 나레이션과 대사만 재생합니다.',
    'time-total': formatDuration(episode.durationSeconds),
  });
  $('#episode-list').href = `/series?id=${encodeURIComponent(episode.series.id)}`;
  $('#seek').max = String(episode.durationSeconds);

  if (keepTime) {
    // 화면해설 포함 여부가 바뀌면 시간축이 달라지므로 같은 장면의 처음으로 맞춘다.
    state.time = episode.scenes[previousScene]?.start ?? Math.min(previousTime, episode.durationSeconds);
  } else {
    const progress = getProgress(episode.id);
    state.time = progress && !progress.completed ? Math.min(progress.time, episode.durationSeconds) : 0;
    if (state.time > 0) toast(`${formatDuration(state.time)}부터 이어서 듣습니다.`);
  }
  state.sceneIndex = sceneIndexAt(state.time);
  render(true);
}

// ── 이벤트 ───────────────────────────────────────────

$('#play').addEventListener('click', () => setPlaying(!state.playing));
$('#back').addEventListener('click', () => seek(state.time - SEEK_STEP));
$('#forward').addEventListener('click', () => seek(state.time + SEEK_STEP));
$('#prev-scene').addEventListener('click', () => goScene(-1));
$('#next-scene').addEventListener('click', () => goScene(1));
$('#seek').addEventListener('input', (event) => seek(Number(event.target.value)));

$('#toggle-shortcuts').addEventListener('click', (event) => {
  const list = $('#shortcuts');
  list.hidden = !list.hidden;
  event.currentTarget.setAttribute('aria-expanded', String(!list.hidden));
  event.currentTarget.textContent = list.hidden ? '키보드 단축키 보기' : '키보드 단축키 숨기기';
});

document.addEventListener('keydown', (event) => {
  // 버튼·입력 요소에 포커스가 있으면 그 요소의 기본 동작(Space로 누르기 등)을 따른다.
  if (!state.episode || event.target.closest('input, select, textarea, a, button')) return;
  if (event.code === 'Space' && state.autoNextTimer) {
    event.preventDefault();
    clearTimeout(state.autoNextTimer);
    state.autoNextTimer = null;
    toast('다음 화 자동 재생을 취소했습니다.');
    return;
  }
  if (event.code === 'Space') {
    event.preventDefault();
    setPlaying(!state.playing);
  } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault();
    const dir = event.key === 'ArrowRight' ? 1 : -1;
    if (event.shiftKey) goScene(dir);
    else seek(state.time + dir * SEEK_STEP);
  } else if (event.key === 'n' || event.key === 'N' || event.key === 'ㅜ') {
    replayDescription();
  }
});

window.addEventListener('pagehide', () => persist());

renderSettings($('#settings-form'), (settings, changed) => {
  state.settings = settings;
  if (changed === 'narrationMode') void load({ keepTime: true });
});

async function init() {
  if (!episodeId) {
    fillSlots(document, { 'load-error': '감상할 회차를 찾을 수 없습니다.' });
    $('#load-error').hidden = false;
    $('#player').hidden = true;
    return;
  }
  try {
    await load();
    if (new URLSearchParams(location.search).get('autoplay') === '1') setPlaying(true);
  } catch {
    fillSlots(document, { 'load-error': '공개되지 않았거나 없는 회차입니다.' });
    $('#load-error').hidden = false;
    $('#player').hidden = true;
  } finally {
    $('#viewer').setAttribute('aria-busy', 'false');
  }
}

void init();
