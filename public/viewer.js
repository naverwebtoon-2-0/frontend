// R3 웹툰 감상 플레이어: 화면해설과 대사를 순서대로 재생하고, 장면 이미지와 자막을 함께 보여 준다.
// 큐의 audio_url이 있으면 종류별 볼륨·속도를 적용해 실제 음원을 재생한다.
import { apiErrorMessage, getPublicEpisode, getPublicTranscript } from './api.js';
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
  audioTracks: new Map(),
  audioPlayPending: new WeakSet(),
  audioErrorReported: false,
};

let toastTimer;
let transcriptLoaded = false;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2500);
}

function announce(message) {
  $('#playback-status').textContent = message;
}

function audioVolume(cue) {
  const key = `${cue.kind}Volume`;
  const readerVolume = (state.settings[key] ?? 100) / 100;
  const cueVolume = cue.kind === 'sfx' ? cue.volume ?? 1 : 1;
  return Math.max(0, Math.min(1, readerVolume * cueVolume));
}

function hasAudio() {
  return state.episode?.cues.some((cue) => Boolean(cue.audioUrl)) ?? false;
}

function updateAudioStatus() {
  $('#audio-status').textContent = hasAudio()
    ? '음원 재생 가능 · 재생 속도와 종류별 볼륨 설정이 적용됩니다.'
    : '이 회차는 음원이 준비되지 않아 자막과 장면 미리보기로 진행됩니다.';
}

function pauseAudioTracks() {
  for (const audio of state.audioTracks.values()) audio.pause();
}

function syncAudioTracks({ seeked = false } = {}) {
  if (!state.episode) return;
  const active = state.episode.cues.filter((cue) => cue.audioUrl
    && state.time >= cue.start && state.time < cue.start + cue.duration);
  const activeIds = new Set(active.map((cue) => cue.id));

  for (const [cueId, audio] of state.audioTracks) {
    if (!state.playing || !activeIds.has(cueId)) audio.pause();
  }
  if (!state.playing) return;

  for (const cue of active) {
    let audio = state.audioTracks.get(cue.id);
    if (!audio) {
      const expired = state.episode.audioUrlsExpireAt && Date.now() >= new Date(state.episode.audioUrlsExpireAt).getTime();
      audio = new Audio(expired ? cue.audioRefreshUrl : cue.audioUrl);
      audio.preload = 'auto';
      audio.addEventListener('error', () => {
        if (audio.dataset.refreshed || !cue.audioRefreshUrl) return;
        audio.dataset.refreshed = 'true';
        audio.src = cue.audioRefreshUrl;
        audio.load();
        audio.addEventListener('canplay', () => syncAudioTracks({ seeked: true }), { once: true });
      });
      state.audioTracks.set(cue.id, audio);
    }
    audio.volume = audioVolume(cue);
    audio.playbackRate = state.settings.playbackRate;
    const position = Math.max(0, state.time - cue.start);
    if (audio.readyState >= 1 && !state.audioPlayPending.has(audio)
      && (seeked || Math.abs(audio.currentTime - position) > 0.7)) {
      try { audio.currentTime = position; } catch { /* 메타데이터를 기다린다. */ }
    }
    if (audio.paused && !audio.ended && !state.audioPlayPending.has(audio)) {
      state.audioPlayPending.add(audio);
      audio.play().catch((error) => {
        if (error?.name === 'AbortError' || state.audioErrorReported) return;
        state.audioErrorReported = true;
        setPlaying(false);
        toast('음원을 재생하지 못했습니다. 잠시 후 다시 시도해주세요.');
        announce('음원을 재생하지 못했습니다. 잠시 후 다시 시도해주세요.');
      }).finally(() => state.audioPlayPending.delete(audio));
    }
  }
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
  img.alt = scene?.alt || `장면 ${state.sceneIndex + 1}. 이미지 설명이 제공되지 않았습니다.`;
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
  if (state.settings.announceScenes && cue) {
    announce(`장면 ${state.sceneIndex + 1}. ${cueLabel(cue)}. ${cue.kind === 'sfx' ? cue.text : cue.text}`);
  }
  syncAudioTracks();
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
function unfinishedSpeechCue(nextTime) {
  const cue = state.episode.cues.find((candidate) => candidate.kind !== 'sfx'
    && candidate.audioUrl
    && state.time >= candidate.start
    && state.time < candidate.start + candidate.duration
    && nextTime >= candidate.start + candidate.duration);
  if (!cue) return null;
  const audio = state.audioTracks.get(cue.id);
  return audio && !audio.ended ? cue : null;
}

function tick(now) {
  if (!state.playing) return;
  const { durationSeconds } = state.episode;
  const nextTime = Math.min(durationSeconds, state.time + ((now - lastFrame) / 1000) * state.settings.playbackRate);
  const unfinished = unfinishedSpeechCue(nextTime);
  state.time = unfinished ? unfinished.start + unfinished.duration - 0.001 : nextTime;
  lastFrame = now;
  const before = state.sceneIndex;
  const sceneChanged = render();

  if (sceneChanged && !state.settings.autoNextScene && state.sceneIndex > before) {
    // 자동 다음 장면이 꺼져 있으면 새 장면 시작에서 멈춘다.
    state.time = state.episode.scenes[state.sceneIndex].start;
    setPlaying(false);
    toast('다음 장면에서 멈췄습니다. Space로 이어서 들을 수 있습니다.');
    announce(`장면 ${state.sceneIndex + 1}에서 멈췄습니다. Space를 누르면 이어서 재생합니다.`);
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
  $('#cancel-auto-next').hidden = true;
  if (playing && state.time >= state.episode.durationSeconds) state.time = 0;
  state.playing = playing;
  $('#next-episode').hidden = true;
  if (playing) {
    lastFrame = performance.now();
    state.audioErrorReported = false;
    syncAudioTracks({ seeked: true });
    requestAnimationFrame(tick);
  } else {
    pauseAudioTracks();
    persist();
  }
  renderTime();
}

function seek(time) {
  state.time = Math.max(0, Math.min(state.episode.durationSeconds, time));
  render();
  syncAudioTracks({ seeked: true });
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
  const cancelButton = $('#cancel-auto-next');
  if (!nextEpisodeId) {
    toast('마지막 회차까지 감상했습니다.');
    return;
  }
  nextButton.href = `/viewer?episode=${encodeURIComponent(nextEpisodeId)}`;
  nextButton.hidden = false;
  if (state.settings.autoNextEpisode) {
    toast('3초 후 다음 화를 재생합니다. Space를 누르면 취소합니다.');
    announce('3초 뒤 다음 화로 이동합니다. 다음 화 자동 재생 취소 버튼 또는 Space를 눌러 취소할 수 있습니다.');
    cancelButton.hidden = false;
    state.autoNextTimer = setTimeout(() => location.assign(`${nextButton.href}&autoplay=1`), AUTO_NEXT_DELAY_MS);
  }
}

function cancelAutoNext() {
  if (!state.autoNextTimer) return;
  clearTimeout(state.autoNextTimer);
  state.autoNextTimer = null;
  $('#cancel-auto-next').hidden = true;
  toast('다음 화 자동 재생을 취소했습니다.');
  announce('다음 화 자동 재생을 취소했습니다.');
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
  updateAudioStatus();

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
$('#cancel-auto-next').addEventListener('click', cancelAutoNext);

$('#toggle-shortcuts').addEventListener('click', (event) => {
  const list = $('#shortcuts');
  list.hidden = !list.hidden;
  event.currentTarget.setAttribute('aria-expanded', String(!list.hidden));
  event.currentTarget.textContent = list.hidden ? '키보드 단축키 보기' : '키보드 단축키 숨기기';
});

$('#toggle-transcript').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  const list = $('#transcript-list');
  const willOpen = list.hidden;
  list.hidden = !willOpen;
  button.setAttribute('aria-expanded', String(willOpen));
  button.textContent = willOpen ? '대본 숨기기' : '대본 보기';
  if (!willOpen || transcriptLoaded) return;
  button.disabled = true;
  $('#transcript-error').hidden = true;
  try {
    const items = await getPublicTranscript(episodeId);
    list.replaceChildren(...items.map((item) => {
      const li = document.createElement('li');
      const speaker = item.speaker || KIND_LABEL[item.kind] || '내용';
      const strong = document.createElement('strong');
      strong.textContent = speaker;
      const text = document.createElement('span');
      text.textContent = item.text;
      li.append(strong, text);
      return li;
    }));
    transcriptLoaded = true;
  } catch (error) {
    $('#transcript-error').textContent = apiErrorMessage(error, '전체 대본을 불러오지 못했습니다.');
    $('#transcript-error').hidden = false;
  } finally {
    button.disabled = false;
  }
});

document.addEventListener('keydown', (event) => {
  // 버튼·입력 요소에 포커스가 있으면 그 요소의 기본 동작(Space로 누르기 등)을 따른다.
  if (!state.episode || event.target.closest('input, select, textarea, a, button')) return;
  if (event.code === 'Space' && state.autoNextTimer) {
    event.preventDefault();
    cancelAutoNext();
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
  else if (changed === 'announceScenes') announce(settings.announceScenes ? '장면 전환 안내를 켰습니다.' : '장면 전환 안내를 껐습니다.');
  else syncAudioTracks({ seeked: changed === 'playbackRate' });
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
  } catch (error) {
    fillSlots(document, { 'load-error': apiErrorMessage(error, '공개되지 않았거나 없는 회차입니다.') });
    $('#load-error').hidden = false;
    $('#player').hidden = true;
  } finally {
    $('#viewer').setAttribute('aria-busy', 'false');
  }
}

void init();
