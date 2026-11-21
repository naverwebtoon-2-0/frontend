// A4 제작 스튜디오: 장면 목록 · 원고 미리보기 · 장면 편집 · 오디오 타임라인
import {
  completeSceneReview,
  getScene,
  getSpeakers,
  getStudio,
  saveStudioDraft,
  updateSceneItem,
} from './api.js';
import { fillSlots, formatDuration, setProgress } from './common.js';

const $ = (selector) => document.querySelector(selector);
const params = new URLSearchParams(location.search);
const episodeId = params.get('episode');

const SCENE_STATUS = {
  done: { label: '검수 완료', badge: '✓ 완료' },
  review_required: { label: '확인 필요' },
  voice_ready: { label: '음성 생성됨' },
  sfx_check: { label: '효과음 확인' },
  analyzing: { label: '분석 중', badge: '대기' },
};
const TYPE_LABEL = { narration: '원문 나레이션', description: '화면해설', dialogue: '대사', sfx: '효과음' };
const SOURCE_LABEL = { manuscript: '원고 텍스트', ai: 'AI 생성', drawn: '그려진 글자' };
const TABS = [
  { key: 'all', label: '전체', types: ['narration', 'description', 'dialogue', 'sfx'] },
  { key: 'text', label: '텍스트', types: ['narration', 'dialogue'] },
  { key: 'description', label: '화면해설', types: ['description'] },
  { key: 'sfx', label: '효과음', types: ['sfx'] },
];
const WAVEFORM = [8, 14, 10, 18, 12, 16, 8, 13];
const TIMELINE_WINDOW = 36; // 눈금 00:00~00:35가 들어가는 표시 구간(초)
const PREVIEW_ZOOMS = [50, 75, 100, 125, 150];
const TIMELINE_ZOOMS = [50, 75, 100, 150, 200];

const state = {
  studio: null,
  speakers: [],
  scene: null,
  sceneId: null,
  itemId: null,
  tab: 'all',
  time: 0,
  playing: false,
  previewZoom: 75,
  timelineZoom: 100,
};

// ── 공통 ─────────────────────────────────────────────

let toastTimer;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2500);
}

function clone(templateId) {
  return document.getElementById(templateId).content.firstElementChild.cloneNode(true);
}

function button(label, className = 'button', attrs = {}) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = className;
  el.textContent = label;
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  return el;
}

function formatClock(iso) {
  return new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function itemLabel(item) {
  if (item.type !== 'dialogue') return TYPE_LABEL[item.type];
  const speaker = state.speakers.find((s) => s.id === item.speakerId);
  return `${speaker?.name ?? '화자 미지정'} · 대사`;
}

function itemText(item) {
  if (item.type === 'sfx' && item.sfx) return `프리셋 · ${item.sfx.preset} · 볼륨 ${item.sfx.volume}%`;
  return item.text;
}

// ── 헤더 ─────────────────────────────────────────────

function renderHeader() {
  const { episode, lastSavedAt } = state.studio;
  fillSlots(document, {
    'episode-name': `${episode.workTitle} · ${episode.number}화`,
    'saved-at': `마지막 저장 ${formatClock(lastSavedAt)}`,
  });
  document.title = `제작 스튜디오 · ${episode.number}화 · 울림툰`;
}

// ── 장면 목록 ─────────────────────────────────────────

function renderScenes() {
  const { scenes, review } = state.studio;
  fillSlots(document, {
    'scene-count': `${scenes.length}개`,
    'review-summary': `검수 ${review.reviewedCount}/${scenes.length} · 문제 장면 ${review.problemCount}개`,
  });
  setProgress($('#scene-progress'), Math.round((review.reviewedCount / scenes.length) * 100));

  $('#scene-list').replaceChildren(...scenes.map((scene) => {
    const li = clone('scene-card');
    const card = li.querySelector('.scene-card');
    const status = SCENE_STATUS[scene.status] ?? { label: scene.status };
    fillSlots(li, {
      name: `장면 ${String(scene.number).padStart(2, '0')}`,
      title: scene.title,
      status: status.label,
      badge: status.badge ?? `수정 ${scene.issueCount}`,
    });
    card.dataset.sceneId = scene.id;
    if (scene.id === state.sceneId) card.setAttribute('aria-current', 'true');
    return li;
  }));
}

// ── 원고 미리보기 ──────────────────────────────────────

function renderPreview() {
  const items = new Map(state.scene.items.map((item) => [item.id, item]));
  const panels = state.scene.panels.map((panel) => {
    const el = document.createElement('div');
    el.className = 'manuscript__panel';
    if (panel.caption) {
      const caption = document.createElement('span');
      caption.textContent = panel.caption;
      el.append(caption);
    }
    if (panel.character) {
      el.classList.add('manuscript__panel--character');
      const figure = document.createElement('span');
      figure.className = 'manuscript__character';
      figure.setAttribute('aria-hidden', 'true');
      el.append(figure);
    }
    for (const id of panel.items) {
      const item = items.get(id);
      if (!item) continue;
      const ocr = clone('ocr-item');
      ocr.dataset.type = item.type;
      ocr.dataset.itemId = item.id;
      if (item.id === state.itemId) ocr.setAttribute('aria-current', 'true');
      const text = item.type === 'dialogue' ? `“${item.text}”` : item.text;
      fillSlots(ocr, { number: item.number, label: itemLabel(item), text });
      el.append(ocr);
    }
    return el;
  });
  $('#manuscript').replaceChildren(...panels);
  applyPreviewZoom();
}

function applyPreviewZoom() {
  $('#manuscript').style.transform = `scale(${state.previewZoom / 75})`;
  $('#preview-zoom').textContent = `${state.previewZoom}%`;
  $('#preview-zoom-out').disabled = state.previewZoom === PREVIEW_ZOOMS[0];
  $('#preview-zoom-in').disabled = state.previewZoom === PREVIEW_ZOOMS.at(-1);
}

// ── 장면 편집 ─────────────────────────────────────────

function kindOptions() {
  return [
    ['narration', TYPE_LABEL.narration],
    ['description', TYPE_LABEL.description],
    ...state.speakers.map((s) => [`dialogue:${s.id}`, `${s.name} · 대사`]),
    ['sfx', TYPE_LABEL.sfx],
  ];
}

function itemActions(item) {
  const actions = [];
  if (item.type === 'sfx') {
    actions.push(button('프리셋 변경', 'button', { 'data-pending': '효과음 설정', 'aria-haspopup': 'dialog' }));
    actions.push(button('볼륨 조절', 'button', { 'data-pending': '효과음 설정', 'aria-haspopup': 'dialog' }));
    return actions;
  }
  actions.push(button('텍스트 수정', 'button', { 'data-pending': '텍스트 수정', 'aria-haspopup': 'dialog' }));
  if (item.ttsStale) {
    const stale = button('', 'stale-button', { 'data-pending': 'TTS 재생성' });
    const dot = document.createElement('img');
    Object.assign(dot, { src: '/icons/dot-stale.svg', width: 6, height: 6, alt: '' });
    stale.append(dot, 'TTS 재생성');
    actions.push(stale);
  }
  actions.push(button('⋯', 'more-button', { 'data-pending': '항목 메뉴', 'aria-label': '더 보기' }));
  return actions;
}

function renderItem(item) {
  const li = clone('editor-item');
  li.dataset.type = item.type;
  li.dataset.itemId = item.id;
  if (item.id === state.itemId) li.setAttribute('aria-current', 'true');

  fillSlots(li, {
    number: item.number,
    source: SOURCE_LABEL[item.source] ?? '',
    start: formatDuration(item.start),
    text: itemText(item),
  });

  const kind = li.querySelector('[data-field="kind"]');
  for (const [value, label] of kindOptions()) kind.append(new Option(label, value));
  kind.value = item.type === 'dialogue' ? `dialogue:${item.speakerId}` : item.type;

  const mode = li.querySelector('[data-role="mode"]');
  mode.hidden = !['narration', 'description'].includes(item.type);
  li.querySelector('[data-field="playMode"]').value = item.playMode ?? 'separate';

  li.querySelector('.editor-item__actions').append(...itemActions(item));
  return li;
}

function renderInspector() {
  const { scene } = state;
  fillSlots(document, {
    'inspector-title': `장면 ${String(scene.number).padStart(2, '0')} 편집`,
    'voice-label': scene.voice.label,
  });

  // 탭과 개수
  $('#item-tabs').replaceChildren(...TABS.map((tab) => {
    const count = scene.items.filter((item) => tab.types.includes(item.type)).length;
    return button(`${tab.label} ${count}`, 'tab', {
      role: 'tab',
      'aria-selected': String(tab.key === state.tab),
      'data-tab': tab.key,
    });
  }));

  // 텍스트 세부: 나레이션과 화자별 대사 수
  const pills = [
    ['나레이션', scene.items.filter((i) => i.type === 'narration').length],
    ...state.speakers.map((s) => [`${s.name}_대사`, scene.items.filter((i) => i.type === 'dialogue' && i.speakerId === s.id).length]),
  ].map(([label, count]) => {
    const pill = document.createElement('span');
    pill.className = count ? 'sub-pill' : 'sub-pill sub-pill--empty';
    pill.textContent = `${label} ${count}`;
    return pill;
  });
  $('#sub-filter').replaceChildren('텍스트 세부 ·', ...pills);

  // 항목 목록
  const types = TABS.find((tab) => tab.key === state.tab).types;
  $('#item-list').replaceChildren(...scene.items.filter((item) => types.includes(item.type)).map(renderItem));

  // 나레이션 + 화면해설 통합 제안
  const narration = scene.items.find((i) => i.type === 'narration');
  const description = scene.items.find((i) => i.type === 'description');
  $('#combine-card').hidden = !(narration && description);
  if (narration && description) {
    fillSlots(document, { 'combine-label': `${narration.number}번과 ${description.number}번을 하나의 내레이션으로` });
  }

  // 일괄 재생성
  const staleCount = scene.items.filter((i) => i.ttsStale).length;
  $('#batch-regenerate').hidden = staleCount === 0;
  fillSlots(document, { 'stale-label': `변경된 항목 일괄 재생성 (${staleCount})` });

  const current = state.studio.scenes.find((s) => s.id === state.sceneId);
  const done = current?.status === 'done';
  $('#complete-review').disabled = done;
  $('#complete-review').textContent = done ? '검수 완료된 장면' : '이 장면 검수 완료';
}

function selectItem(itemId) {
  state.itemId = itemId;
  for (const el of document.querySelectorAll('[data-item-id]')) {
    el.toggleAttribute('aria-current', el.dataset.itemId === itemId);
    if (el.dataset.itemId === itemId) el.setAttribute('aria-current', 'true');
  }
  renderClipsCurrent();
}

async function selectScene(sceneId) {
  state.sceneId = sceneId;
  renderScenes();
  try {
    state.scene = await getScene(episodeId, sceneId);
  } catch {
    toast('장면을 불러오지 못했습니다.');
    return;
  }
  state.itemId = state.scene.items[0]?.id ?? null;
  state.tab = 'all';
  const url = new URL(location.href);
  url.searchParams.set('scene', sceneId);
  history.replaceState(null, '', url);
  renderPreview();
  renderInspector();
  renderClipsCurrent();
  updatePlayback();
}

async function changeItem(itemId, patch) {
  try {
    const updated = await updateSceneItem(episodeId, state.sceneId, itemId, patch);
    const index = state.scene.items.findIndex((i) => i.id === itemId);
    state.scene.items[index] = { ...state.scene.items[index], ...updated, ...patch, ttsStale: true };
    renderPreview();
    renderInspector();
  } catch {
    toast('항목을 변경하지 못했습니다.');
    renderInspector();
  }
}

// ── 타임라인 ─────────────────────────────────────────

const percent = (seconds) => `${(seconds / TIMELINE_WINDOW) * 100}%`;

function renderTimeline() {
  const { tracks } = state.studio.timeline;
  $('#track-labels').replaceChildren(...tracks.map((track) => {
    const label = document.createElement('span');
    label.textContent = TYPE_LABEL[track.type];
    return label;
  }));

  $('#ruler').replaceChildren(...Array.from({ length: 8 }, (_, i) => {
    const tick = document.createElement('span');
    tick.style.left = percent(i * 5);
    tick.textContent = formatDuration(i * 5);
    return tick;
  }));

  $('#tracks').replaceChildren(...tracks.map((track) => {
    const row = document.createElement('div');
    row.className = 'track';
    row.dataset.type = track.type;
    row.setAttribute('aria-label', `${TYPE_LABEL[track.type]} 트랙`);
    for (const seconds of [10, 20, 30]) {
      const grid = document.createElement('span');
      grid.className = 'track__grid';
      grid.style.left = percent(seconds);
      row.append(grid);
    }
    for (const clip of track.clips) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'clip';
      el.dataset.clipId = clip.id;
      el.dataset.start = clip.start;
      if (clip.itemId) el.dataset.clipItem = clip.itemId;
      el.style.left = percent(clip.start);
      el.style.width = percent(clip.duration);
      el.setAttribute('aria-label', `${clip.label}, ${formatDuration(clip.start)}부터`);
      const label = document.createElement('span');
      label.textContent = clip.label;
      const wave = document.createElement('span');
      wave.className = 'waveform';
      wave.setAttribute('aria-hidden', 'true');
      for (const h of WAVEFORM) {
        const bar = document.createElement('i');
        bar.style.height = `${h}px`;
        wave.append(bar);
      }
      el.append(label, wave);
      row.append(el);
    }
    return row;
  }));
  applyTimelineZoom();
}

function renderClipsCurrent() {
  for (const clip of document.querySelectorAll('.clip')) {
    clip.toggleAttribute('aria-current', clip.dataset.clipItem === state.itemId);
    if (clip.dataset.clipItem === state.itemId) clip.setAttribute('aria-current', 'true');
  }
}

function applyTimelineZoom() {
  $('#timeline-lane').style.width = `${state.timelineZoom}%`;
  $('#timeline-zoom').textContent = `${state.timelineZoom}%`;
  $('#timeline-zoom-out').disabled = state.timelineZoom === TIMELINE_ZOOMS[0];
  $('#timeline-zoom-in').disabled = state.timelineZoom === TIMELINE_ZOOMS.at(-1);
}

/** 현재 시각에 재생 중인 클립 중 가장 늦게 시작한 것 */
function activeClip() {
  const clips = state.studio.timeline.tracks.flatMap((t) => t.clips);
  return clips
    .filter((c) => state.time >= c.start && state.time < c.start + c.duration)
    .sort((a, b) => b.start - a.start)[0];
}

function updatePlayback() {
  const { durationSeconds } = state.studio.timeline;
  $('#playhead').style.left = percent(state.time);
  const clip = activeClip();
  const item = clip?.itemId && state.scene?.items.find((i) => i.id === clip.itemId);
  const sceneName = state.scene ? `장면 ${String(state.scene.number).padStart(2, '0')}` : '';
  fillSlots(document, {
    time: `${formatDuration(state.time)} / ${formatDuration(durationSeconds)}`,
    'playhead-time': formatDuration(state.time),
    'now-playing': item ? `${sceneName} · 항목 ${item.number} ${state.playing ? '재생 중' : '선택됨'}` : '',
  });
  $('#timeline-play').setAttribute('aria-pressed', String(state.playing));
  $('#timeline-play').setAttribute('aria-label', state.playing ? '일시정지' : '재생');
}

// 오디오 파일이 아직 없어 재생 위치만 움직인다. 음성 URL이 생기면 <audio>로 바꾼다.
let lastFrame;
function tick(now) {
  if (!state.playing) return;
  state.time = Math.min(state.studio.timeline.durationSeconds, state.time + (now - lastFrame) / 1000);
  lastFrame = now;
  if (state.time >= state.studio.timeline.durationSeconds) state.playing = false;
  updatePlayback();
  if (state.playing) requestAnimationFrame(tick);
}

function setPlaying(playing) {
  state.playing = playing;
  if (playing) {
    if (state.time >= state.studio.timeline.durationSeconds) state.time = 0;
    lastFrame = performance.now();
    requestAnimationFrame(tick);
  }
  updatePlayback();
}

function seek(seconds) {
  state.time = Math.max(0, Math.min(state.studio.timeline.durationSeconds, seconds));
  updatePlayback();
}

// ── 이벤트 ───────────────────────────────────────────

function step(list, current, direction) {
  const index = list.indexOf(current) + direction;
  return list[Math.max(0, Math.min(list.length - 1, index))];
}

function bindEvents() {
  // 아직 만들지 않은 화면(모달)으로 이어지는 버튼
  document.addEventListener('click', (event) => {
    const pending = event.target.closest('[data-pending]');
    if (pending) {
      event.stopPropagation();
      toast(`‘${pending.dataset.pending}’ 화면은 다음 단계에서 연결됩니다.`);
    }
  }, true);

  $('#scene-list').addEventListener('click', (event) => {
    const card = event.target.closest('[data-scene-id]');
    if (card && card.dataset.sceneId !== state.sceneId) void selectScene(card.dataset.sceneId);
  });

  $('#item-tabs').addEventListener('click', (event) => {
    const tab = event.target.closest('[data-tab]');
    if (!tab) return;
    state.tab = tab.dataset.tab;
    renderInspector();
  });

  $('#item-list').addEventListener('click', (event) => {
    const item = event.target.closest('[data-item-id]');
    if (!item || event.target.closest('select')) return;
    selectItem(item.dataset.itemId);
    if (event.target.closest('[data-action="play"]')) {
      const clip = state.studio.timeline.tracks.flatMap((t) => t.clips).find((c) => c.itemId === item.dataset.itemId);
      if (clip) seek(clip.start);
      setPlaying(true);
    }
  });

  $('#item-list').addEventListener('change', (event) => {
    const select = event.target.closest('select');
    const item = event.target.closest('[data-item-id]');
    if (!select || !item) return;
    if (select.dataset.field === 'kind') {
      const [type, speakerId] = select.value.split(':');
      void changeItem(item.dataset.itemId, speakerId ? { type, speakerId } : { type });
    } else {
      void changeItem(item.dataset.itemId, { playMode: select.value });
    }
  });

  $('#manuscript').addEventListener('click', (event) => {
    const ocr = event.target.closest('[data-item-id]');
    if (ocr) selectItem(ocr.dataset.itemId);
  });

  $('#complete-review').addEventListener('click', async () => {
    $('#complete-review').disabled = true;
    try {
      const { review } = await completeSceneReview(episodeId, state.sceneId);
      const scene = state.studio.scenes.find((s) => s.id === state.sceneId);
      Object.assign(scene, { status: 'done', issueCount: 0 });
      state.studio.review = review;
      renderScenes();
      renderInspector();
      toast(`장면 ${String(scene.number).padStart(2, '0')} 검수를 완료했습니다.`);
    } catch {
      $('#complete-review').disabled = false;
      toast('검수 완료를 저장하지 못했습니다.');
    }
  });

  $('#save-draft').addEventListener('click', async () => {
    try {
      const { savedAt } = await saveStudioDraft(episodeId);
      state.studio.lastSavedAt = savedAt;
      renderHeader();
      toast('임시 저장했습니다.');
    } catch {
      toast('임시 저장하지 못했습니다.');
    }
  });

  $('#preview-zoom-out').addEventListener('click', () => { state.previewZoom = step(PREVIEW_ZOOMS, state.previewZoom, -1); applyPreviewZoom(); });
  $('#preview-zoom-in').addEventListener('click', () => { state.previewZoom = step(PREVIEW_ZOOMS, state.previewZoom, 1); applyPreviewZoom(); });
  $('#timeline-zoom-out').addEventListener('click', () => { state.timelineZoom = step(TIMELINE_ZOOMS, state.timelineZoom, -1); applyTimelineZoom(); });
  $('#timeline-zoom-in').addEventListener('click', () => { state.timelineZoom = step(TIMELINE_ZOOMS, state.timelineZoom, 1); applyTimelineZoom(); });

  $('#timeline-play').addEventListener('click', () => setPlaying(!state.playing));
  $('#seek-back').addEventListener('click', () => seek(state.time - 5));
  $('#seek-forward').addEventListener('click', () => seek(state.time + 5));

  $('#timeline-collapse').addEventListener('click', (event) => {
    const body = $('#timeline-body');
    body.hidden = !body.hidden;
    event.currentTarget.textContent = body.hidden ? '펼치기' : '접기';
    event.currentTarget.setAttribute('aria-expanded', String(!body.hidden));
  });

  // 레인을 누르면 그 위치로 이동, 클립을 누르면 해당 항목을 선택
  $('#timeline-lane').addEventListener('click', (event) => {
    const clip = event.target.closest('.clip');
    if (clip) {
      seek(Number(clip.dataset.start));
      if (clip.dataset.clipItem && state.scene.items.some((i) => i.id === clip.dataset.clipItem)) {
        selectItem(clip.dataset.clipItem);
      }
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    seek(((event.clientX - rect.left) / rect.width) * TIMELINE_WINDOW);
  });

  document.addEventListener('keydown', (event) => {
    if (event.code !== 'Space' || event.target.closest('button, select, input, textarea')) return;
    event.preventDefault();
    setPlaying(!state.playing);
  });
}

// ── 시작 ─────────────────────────────────────────────

async function init() {
  bindEvents();
  if (!episodeId) {
    toast('편집할 회차를 찾을 수 없습니다.');
    return;
  }
  try {
    [state.studio, state.speakers] = await Promise.all([getStudio(episodeId), getSpeakers(episodeId)]);
  } catch {
    toast('스튜디오를 불러오지 못했습니다. 새로고침해 주세요.');
    return;
  }
  state.time = state.studio.timeline.lastPlayheadSeconds ?? 0;
  $('#publish-review').href = `#publish-review-${state.studio.episode.id}`;
  renderHeader();
  renderTimeline();
  const requested = params.get('scene');
  const first = state.studio.scenes.find((s) => s.status !== 'done') ?? state.studio.scenes[0];
  await selectScene(state.studio.scenes.some((s) => s.id === requested) ? requested : first.id);
  $('#workspace').setAttribute('aria-busy', 'false');
}

void init();
