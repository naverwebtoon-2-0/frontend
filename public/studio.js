// A4 제작 스튜디오: 장면 목록 · 원고 미리보기 · 장면 편집 · 오디오 타임라인
// 데이터는 api.js의 getStudio()가 명세 §6 응답을 바꿔 준다. 장면 = 원고 이미지 한 장.
import {
  completeSceneReview,
  createCharacter,
  getScene,
  characterNameKey,
  deleteLeftoverCharacter,
  getStudio,
  reassignLines,
  renameCharacterGroup,
  updateLine,
} from './api.js';
import { fillSlots, formatDuration, setProgress } from './common.js';
import { setupModals } from './studio-modals.js';

const $ = (selector) => document.querySelector(selector);
const params = new URLSearchParams(location.search);
const episodeId = params.get('episode');

const SCENE_STATUS = {
  done: { label: '검수 완료', badge: '✓ 완료' },
  review_required: { label: '재생성 필요' },
  voice_ready: { label: '음성 생성됨', badge: '확인' },
  analyzing: { label: '음성 생성 중', badge: '대기' },
};
const TYPE_LABEL = { narration: '원문 나레이션', description: '화면해설', dialogue: '대사', sfx: '효과음', ignore: '읽지 않음' };
const SOURCE_LABEL = { manuscript: '원고 텍스트', drawn: '그려진 글자', alt: '이미지 설명', preset: '효과음 프리셋' };
const LINE_KIND_LABEL = { narration: '원문 나레이션', sfx_text: '효과음 글자', ignore: '읽지 않음' };
const DIALOGUE_TYPE_OPTIONS = [
  ['dialogue', '대사'],
  ['narration', LINE_KIND_LABEL.narration],
  ['sfx_text', LINE_KIND_LABEL.sfx_text],
  ['ignore', LINE_KIND_LABEL.ignore],
];
// 어두운 스튜디오 화면에서 서로 충분히 구분되는 화자 색상.
// 동일 인물이 여러 character ID로 감지돼도 이름이 같으면 같은 색을 사용한다.
const SPEAKER_COLORS = ['#f2a65a', '#5c8dff', '#f472b6', '#4fd1c5', '#c084fc', '#facc15', '#fb7185', '#a3e635'];
const TABS = [
  { key: 'all', label: '전체', types: ['narration', 'description', 'dialogue', 'sfx', 'ignore'] },
  { key: 'text', label: '텍스트', types: ['narration', 'dialogue'] },
  { key: 'description', label: '화면해설', types: ['description'] },
  { key: 'sfx', label: '효과음', types: ['sfx'] },
];
const WAVEFORM = [8, 14, 10, 18, 12, 16, 8, 13];
// 텍스트 탭의 세부 필터: 나레이션 + 화자별 대사
const SUB_FILTERS = () => [
  { key: 'narration', label: '나레이션', match: (i) => i.type === 'narration' },
  ...state.speakers.map((s) => ({
    key: s.id,
    label: `${s.name}_대사`,
    match: (i) => i.type === 'dialogue' && i.speakerId === s.id,
  })),
];
const PREVIEW_ZOOMS = [50, 75, 100, 125, 150];
const TIMELINE_ZOOMS = [50, 75, 100, 150, 200];

const state = {
  studio: null,
  speakers: [],
  scene: null,
  sceneId: null,
  itemId: null,
  tab: 'all',
  subFilter: null, // 텍스트 탭 세부 필터: 'narration' 또는 화자 id
  time: 0,
  window: 36,
  playing: false,
  stopAt: null, // 개별 항목 재생일 때 멈출 시각(초). null이면 끝까지 재생
  audioTracks: new Map(),
  audioPlayPending: new WeakSet(),
  audioErrorReported: false,
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

const sceneName = (number) => `장면 ${String(number).padStart(2, '0')}`;

function itemLabel(item) {
  if (item.type !== 'dialogue') return TYPE_LABEL[item.type];
  const speaker = state.speakers.find((s) => s.id === item.speakerId);
  return `${speaker?.name ?? '화자 미지정'} · 대사`;
}

function itemText(item) {
  if (item.editable === 'cue' && item.sfx) return `프리셋 · ${item.sfx.preset} · 볼륨 ${item.sfx.volume}%`;
  return item.text;
}

function speakerColor(speakerId) {
  const speaker = state.speakers.find((candidate) => candidate.id === speakerId);
  if (!speaker) return SPEAKER_COLORS[0];
  const normalizedName = speaker.name.trim().toLocaleLowerCase('ko-KR');
  const names = [...new Set(state.speakers.map((candidate) => candidate.name.trim().toLocaleLowerCase('ko-KR')))];
  const index = names.indexOf(normalizedName);
  return SPEAKER_COLORS[(index < 0 ? 0 : index) % SPEAKER_COLORS.length];
}

function applySpeakerColor(element, item) {
  if (item?.type === 'dialogue') element.style.setProperty('--track', speakerColor(item.speakerId));
}

function isProvisionalSpeaker(speaker) {
  return Boolean(speaker?.autoNamed) || /^인물\s*\d+$/.test(speaker?.name?.trim() ?? '');
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
  setProgress($('#scene-progress'), scenes.length ? Math.round((review.reviewedCount / scenes.length) * 100) : 0);

  $('#scene-list').replaceChildren(...scenes.map((scene) => {
    const li = clone('scene-card');
    const card = li.querySelector('.scene-card');
    const status = SCENE_STATUS[scene.status] ?? { label: scene.status };
    fillSlots(li, {
      name: sceneName(scene.number),
      title: scene.title,
      status: status.label,
      badge: scene.status !== 'done' && scene.issueCount ? `수정 ${scene.issueCount}` : status.badge ?? '',
    });
    card.dataset.sceneId = scene.id;
    if (scene.id === state.sceneId) card.setAttribute('aria-current', 'true');
    return li;
  }));
}

// ── 원고 미리보기: 원고 이미지 위에 감지 영역(bbox)을 번호로 표시 ─────────

function renderPreview() {
  const { image, items } = state.scene;
  const page = document.createElement('div');
  page.className = 'page';

  if (image?.url) {
    const img = document.createElement('img');
    img.src = image.url;
    img.alt = `${sceneName(state.scene.number)} 원고`;
    img.width = image.width;
    img.height = image.height;
    page.append(img);
  }

  for (const item of items) {
    if (!item.bbox) continue;
    const marker = document.createElement('button');
    marker.type = 'button';
    marker.className = item.editable === 'cue' ? 'ocr-marker ocr-marker--cue' : 'ocr-marker';
    marker.dataset.type = item.type;
    marker.dataset.itemId = item.id;
    applySpeakerColor(marker, item);
    marker.setAttribute('aria-label', `${item.number}번 ${itemLabel(item)}: ${itemText(item)}`);
    if (item.id === state.itemId) marker.setAttribute('aria-current', 'true');
    Object.assign(marker.style, {
      left: `${item.bbox.x * 100}%`,
      top: `${item.bbox.y * 100}%`,
      width: `${item.bbox.w * 100}%`,
      height: `${item.bbox.h * 100}%`,
    });
    const badge = document.createElement('span');
    badge.className = 'number-badge';
    badge.textContent = item.number;
    marker.append(badge);
    page.append(marker);
  }

  $('#manuscript').replaceChildren(page);
  applyPreviewZoom();
}

function applyPreviewZoom() {
  $('#manuscript').style.transform = `scale(${state.previewZoom / 75})`;
  $('#preview-zoom').textContent = `${state.previewZoom}%`;
  $('#preview-zoom-out').disabled = state.previewZoom === PREVIEW_ZOOMS[0];
  $('#preview-zoom-in').disabled = state.previewZoom === PREVIEW_ZOOMS.at(-1);
}

// ── 장면 편집 ─────────────────────────────────────────

function itemActions(item) {
  if (item.editable === 'cue') {
    return [
      button('프리셋 변경', 'button', { 'data-action': 'edit-sfx', 'aria-haspopup': 'dialog' }),
      button('볼륨 조절', 'button', { 'data-action': 'edit-volume', 'aria-haspopup': 'dialog' }),
      button('삭제', 'button', { 'data-action': 'delete-sfx' }),
    ];
  }
  if (item.editable === 'alt') {
    return [button('설명 수정', 'button', { 'data-action': 'edit-text', 'aria-haspopup': 'dialog' })];
  }
  const actions = [button('텍스트 수정', 'button', { 'data-action': 'edit-text', 'aria-haspopup': 'dialog' })];
  if (item.ttsStale) {
    // 목소리가 없는 인물은 기본 음성으로 만들지 않고 목소리부터 고르게 한다.
    const character = state.studio.characters.find((c) => c.id === item.characterId);
    const needsVoice = Boolean(character) && !character.voiceId;
    const hasAudio = item.durationMs != null || Boolean(item.audioUrl);
    const stale = button('', 'stale-button', needsVoice
      ? { 'data-action': 'select-voice', 'aria-haspopup': 'dialog' }
      : { 'data-action': 'regenerate' });
    const dot = document.createElement('img');
    Object.assign(dot, { src: '/icons/dot-stale.svg', width: 6, height: 6, alt: '' });
    stale.append(dot, needsVoice || !hasAudio ? '음성 생성' : 'TTS 재생성');
    actions.push(stale);
  }
  actions.push(button('⋯', 'more-button', {
    'data-action': 'menu',
    'aria-label': '더 보기',
    'aria-haspopup': 'menu',
    'aria-expanded': 'false',
  }));
  return actions;
}


/** 회차 전체의 재생성 대상 수로 일괄 재생성 버튼을 갱신한다. */
function renderBatchButton() {
  const count = state.studio.scenes.reduce((sum, scene) => sum + state.studio.sceneDetails[scene.id].items.filter((i) => i.ttsStale).length, 0);
  $('#batch-regenerate').hidden = count === 0;
  fillSlots(document, { 'stale-label': `변경된 항목 일괄 재생성 (${count})` });
}

function renderItem(item) {
  const li = clone('editor-item');
  li.dataset.type = item.type;
  li.dataset.itemId = item.id;
  applySpeakerColor(li, item);
  if (item.id === state.itemId) li.setAttribute('aria-current', 'true');

  fillSlots(li, {
    number: item.number,
    source: SOURCE_LABEL[item.source] ?? '',
    start: item.start == null ? '' : formatDuration(item.start),
    text: itemText(item),
  });

  const kind = li.querySelector('[data-field="kind"]');
  if (item.editable === 'line') {
    // 드롭다운에서는 종류만 고른다. 화자는 대사로 바꾼 뒤 옆의 이름 입력칸에서 지정한다.
    for (const [value, label] of DIALOGUE_TYPE_OPTIONS) kind.append(new Option(label, value));
    kind.value = item.kind;
    if (item.kind === 'dialogue') {
      const speaker = state.speakers.find((candidate) => candidate.id === item.speakerId);
      const input = document.createElement('input');
      input.className = 'speaker-name-input';
      input.type = 'text';
      input.maxLength = 100;
      input.autocomplete = 'off';
      input.placeholder = '인물명 입력';
      input.value = speaker?.name ?? '';
      input.dataset.field = 'speaker';
      input.setAttribute('list', 'studio-speaker-options');
      input.setAttribute('aria-label', '화자 이름');
      kind.closest('.pill-select').insertAdjacentElement('afterend', input);
    }
  } else {
    kind.append(new Option(TYPE_LABEL[item.type], item.type));
    kind.disabled = true;
  }

  li.querySelector('[data-action="play"]').hidden = item.start == null;
  li.querySelector('.editor-item__actions').append(...itemActions(item));
  return li;
}

function renderInspector() {
  const { scene } = state;
  fillSlots(document, { 'inspector-title': `${sceneName(scene.number)} 편집` });
  $('#studio-speaker-options').replaceChildren(...state.speakers.map((speaker) => (
    Object.assign(document.createElement('option'), { value: speaker.name })
  )));

  $('#item-tabs').replaceChildren(...TABS.map((tab) => {
    const count = scene.items.filter((item) => tab.types.includes(item.type)).length;
    const el = button(tab.label, 'tab', {
      id: `item-tab-${tab.key}`,
      role: 'tab',
      'aria-selected': String(tab.key === state.tab),
      'aria-controls': 'item-list',
      tabindex: tab.key === state.tab ? '0' : '-1',
      'data-tab': tab.key,
    });
    const badge = document.createElement('span');
    badge.className = 'tab__count';
    badge.textContent = count;
    el.append(badge);
    return el;
  }));

  // 텍스트 세부 필터: "텍스트" 탭에서만 보이고, 누르면 나레이션·화자별 대사만 남긴다. 다시 누르면 해제.
  const subFilter = $('#sub-filter');
  subFilter.hidden = state.tab !== 'text';
  if (state.tab === 'text') {
    const chips = SUB_FILTERS().map(({ key, label, match }) => {
      const count = scene.items.filter(match).length;
      const chip = button(`${label} ${count}`, count ? 'sub-pill' : 'sub-pill sub-pill--empty', {
        'data-sub-filter': key,
        'aria-pressed': String(state.subFilter === key),
      });
      if (key !== 'narration') {
        chip.classList.add('sub-pill--speaker');
        chip.style.setProperty('--speaker-color', speakerColor(key));
      }
      chip.disabled = count === 0;
      return chip;
    });
    subFilter.replaceChildren(Object.assign(document.createElement('span'), { textContent: '텍스트 세부 ·' }), ...chips);
  }

  const types = TABS.find((tab) => tab.key === state.tab).types;
  const sub = state.tab === 'text' ? SUB_FILTERS().find((f) => f.key === state.subFilter) : null;
  const visible = scene.items.filter((item) => types.includes(item.type) && (!sub || sub.match(item)));
  const panel = $('#item-list');
  panel.setAttribute('aria-labelledby', `item-tab-${state.tab}`);
  panel.replaceChildren(...visible.map(renderItem));

  const narration = scene.items.find((i) => i.type === 'narration');
  const description = scene.items.find((i) => i.type === 'description');
  $('#combine-card').hidden = !(narration && description);
  if (narration && description) {
    fillSlots(document, { 'combine-label': `${narration.number}·${description.number}번 내레이션을 합칠까요?` });
  }

  renderBatchButton();

  const current = state.studio.scenes.find((s) => s.id === state.sceneId);
  const done = current?.status === 'done';
  const staleCount = scene.items.filter((item) => item.ttsStale).length;
  const completeReview = $('#complete-review');
  completeReview.disabled = done || staleCount > 0;
  completeReview.textContent = done
    ? '검수 완료된 장면'
    : staleCount ? '음성 재생성 후 검수 완료' : '이 장면 검수 완료';
  completeReview.title = staleCount ? `변경된 항목 ${staleCount}개의 음성을 재생성한 뒤 검수를 완료할 수 있습니다.` : '';
}

function selectItem(itemId) {
  state.itemId = itemId;
  for (const el of document.querySelectorAll('[data-item-id]')) {
    if (el.dataset.itemId === itemId) el.setAttribute('aria-current', 'true');
    else el.removeAttribute('aria-current');
  }
  renderClipsCurrent();
  updatePlayback();
}

let modals;
const currentItem = (itemId = state.itemId) => state.scene?.items.find((i) => i.id === itemId);

async function selectScene(sceneId, { keepItem = false } = {}) {
  state.sceneId = sceneId;
  renderScenes();
  try {
    state.scene = await getScene(episodeId, sceneId);
  } catch {
    toast('장면을 불러오지 못했습니다.');
    return;
  }
  if (!keepItem || !state.scene.items.some((i) => i.id === state.itemId)) {
    state.itemId = state.scene.items[0]?.id ?? null;
    state.tab = 'all';
    state.subFilter = null;
  }
  const url = new URL(location.href);
  url.searchParams.set('scene', sceneId);
  history.replaceState(null, '', url);
  renderPreview();
  renderInspector();
  renderClipsCurrent();
  updatePlayback();
}

/** 서버 데이터를 다시 받아 전체를 다시 그린다. 수정 직후 상태(stale 등)를 서버 기준으로 맞춘다. */
async function reloadStudio() {
  resetAudioTracks();
  state.studio = await getStudio(episodeId);
  state.speakers = state.studio.speakers;
  renderHeader();
  renderTimeline();
  await selectScene(state.sceneId, { keepItem: true });
  preloadAudio();
}

async function changeLine(lineId, patch) {
  try {
    const previous = state.studio.characters.find((c) => c.id === currentItem(lineId)?.speakerId);
    await updateLine(lineId, patch);
    if ('character_id' in patch && patch.character_id !== previous?.id) {
      await deleteLeftoverCharacter(state.studio, previous, [lineId]);
    }
    await reloadStudio();
    toast('저장했습니다. 음성을 다시 만들어야 합니다.');
  } catch (err) {
    toast(err.message || '항목을 변경하지 못했습니다.');
    renderInspector();
  }
}

async function changeSpeakerName(field, itemId) {
  if (field.dataset.saving === 'true') return;
  const name = field.value.trim();
  if (!name) {
    field.setCustomValidity('인물명을 입력해주세요.');
    field.reportValidity();
    return;
  }
  field.setCustomValidity('');
  const item = currentItem(itemId);
  const currentSpeaker = state.studio.characters.find((character) => character.id === item?.speakerId);
  if (currentSpeaker && characterNameKey(currentSpeaker.name) === characterNameKey(name)) return;

  field.dataset.saving = 'true';
  field.disabled = true;
  try {
    const existing = state.studio.characters.find((character) => (
      character.kind !== 'narration'
      && character.id !== currentSpeaker?.id
      && characterNameKey(character.name) === characterNameKey(name)
    ));
    if (currentSpeaker && isProvisionalSpeaker(currentSpeaker)) {
      // 아직 이름을 확정하지 않은 동일 화자 ID의 대사에만 이름을 일괄 적용한다.
      const affectedLineIds = state.studio.scenes.flatMap((scene) => (
        state.studio.sceneDetails[scene.id].items
          .filter((candidate) => candidate.editable === 'line' && candidate.speakerId === currentSpeaker.id)
          .map((candidate) => candidate.id)
      ));
      if (existing) {
        // 이미 같은 이름의 인물이 있으면 새 인물을 만들지 않고 그 인물로 합친다.
        await reassignLines(affectedLineIds, existing.id);
        await deleteLeftoverCharacter(state.studio, currentSpeaker, affectedLineIds);
        await reloadStudio();
        toast(`대사 ${affectedLineIds.length}개를 기존 인물 ‘${existing.name}’에 합쳤습니다.`);
        return;
      }
      await renameCharacterGroup(currentSpeaker, name);
      await reloadStudio();
      toast(`같은 인물로 인식된 대사 ${affectedLineIds.length}개에 ‘${name}’ 이름을 적용했습니다.`);
      return;
    }
    // 새 인물에게는 이전 화자의 목소리를 복사하지 않는다. 같은 목소리면 화자가 구분되지 않는다.
    const character = existing ?? await createCharacter(state.studio.episode.seriesId, name);
    await updateLine(itemId, { kind: 'dialogue', character_id: character.id });
    await deleteLeftoverCharacter(state.studio, currentSpeaker, [itemId]);
    await reloadStudio();
    toast(`이 대사의 인물명만 ‘${name}’ 이름으로 변경했습니다.${existing ? '' : ' 목소리를 골라 음성을 생성해주세요.'}`);
  } catch (error) {
    toast(error.message || '화자를 저장하지 못했습니다.');
    renderInspector();
  } finally {
    field.dataset.saving = 'false';
    if (field.isConnected) field.disabled = false;
  }
}

// ── 타임라인 ─────────────────────────────────────────

const percent = (seconds) => `${(seconds / state.window) * 100}%`;

function renderTimeline() {
  const { tracks, durationSeconds } = state.studio.timeline;
  // 5초 단위 눈금이 끝까지 들어가도록 표시 구간을 잡는다.
  const lastTick = Math.max(5, Math.ceil(durationSeconds / 5) * 5);
  state.window = lastTick + 1;

  $('#track-labels').replaceChildren(...tracks.map((track) => {
    const label = document.createElement('span');
    label.textContent = TYPE_LABEL[track.type];
    return label;
  }));

  $('#ruler').replaceChildren(...Array.from({ length: lastTick / 5 + 1 }, (_, i) => {
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
    for (let seconds = 10; seconds < lastTick; seconds += 10) {
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
      const clipItem = clip.itemId ? itemContext(clip.itemId)?.item : null;
      applySpeakerColor(el, clipItem);
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
    if (clip.dataset.clipItem === state.itemId) clip.setAttribute('aria-current', 'true');
    else clip.removeAttribute('aria-current');
  }
}

function applyTimelineZoom() {
  $('#timeline-lane').style.width = `${state.timelineZoom}%`;
  $('#timeline-zoom').textContent = `${state.timelineZoom}%`;
  $('#timeline-zoom-out').disabled = state.timelineZoom === TIMELINE_ZOOMS[0];
  $('#timeline-zoom-in').disabled = state.timelineZoom === TIMELINE_ZOOMS.at(-1);
}

const allClips = () => state.studio.timeline.tracks.flatMap((t) => t.clips);

/** 현재 시각에 재생 중인 클립 중 가장 늦게 시작한 것 */
function activeClip() {
  return allClips()
    .filter((c) => state.time >= c.start && state.time < c.start + c.duration)
    .sort((a, b) => b.start - a.start)[0];
}

function itemContext(itemId) {
  const scene = state.studio.scenes.find((candidate) => state.studio.sceneDetails[candidate.id]?.items.some((item) => item.id === itemId));
  const item = scene && state.studio.sceneDetails[scene.id].items.find((candidate) => candidate.id === itemId);
  return item ? { scene, item } : null;
}

function updatePlayback() {
  const { durationSeconds } = state.studio.timeline;
  $('#playhead').style.left = percent(state.time);
  // 맨 앞에서는 시간 표시가 레인 밖으로 잘리지 않게 오른쪽으로 붙인다.
  $('#playhead').classList.toggle('playhead--start', state.time / state.window < 0.03);
  const current = state.playing ? itemContext(activeClip()?.itemId) : itemContext(state.itemId);
  fillSlots(document, {
    time: `${formatDuration(state.time)} / ${formatDuration(durationSeconds)}`,
    'playhead-time': formatDuration(state.time),
    'now-playing': current ? `${sceneName(current.scene.number)} · 항목 ${current.item.number} ${state.playing ? '재생 중' : '선택됨'}` : '',
  });
  $('#timeline-play').setAttribute('aria-pressed', String(state.playing));
  $('#timeline-play').setAttribute('aria-label', state.playing ? '일시정지' : '재생');
}

function resetAudioTracks() {
  state.playing = false;
  state.stopAt = null;
  for (const audio of state.audioTracks.values()) {
    audio.pause();
    audio.dataset.disposed = 'true';
    audio.removeAttribute('src');
    audio.load();
  }
  state.audioTracks.clear();
  state.audioErrorReported = false;
}

function pauseAudioTracks() {
  for (const audio of state.audioTracks.values()) audio.pause();
}

/** 재생 위치 기준 이만큼(초) 앞까지 시작하는 음원은 미리 받아 둔다. */
const PRELOAD_AHEAD_SECONDS = 15;

function activeAudioClips() {
  return allClips().filter((clip) => clip.audioUrl
    && state.time >= clip.start && state.time < clip.start + clip.duration);
}

function ensureAudio(clip) {
  let audio = state.audioTracks.get(clip.id);
  if (audio) return audio;
  audio = new Audio(clip.audioUrl);
  audio.preload = 'auto';
  audio.addEventListener('error', () => {
    if (audio.dataset.disposed || state.audioErrorReported) return;
    state.audioErrorReported = true;
    setPlaying(false);
    toast('음원을 불러오지 못했습니다. 음원 URL 또는 스토리지 CORS 설정을 확인해주세요.');
  });
  state.audioTracks.set(clip.id, audio);
  return audio;
}

/** 지금부터 곧 들릴 클립의 음원을 미리 만들어 재생 버튼을 누르기 전에 연결·버퍼링을 끝낸다. */
function preloadAudio() {
  if (!state.studio) return;
  const until = state.time + PRELOAD_AHEAD_SECONDS;
  for (const clip of allClips()) {
    if (clip.audioUrl && clip.start < until && clip.start + clip.duration > state.time) ensureAudio(clip);
  }
}

/** 음원이 아직 재생할 만큼 준비되지 않았으면 true. 에러가 난 음원은 기다리지 않는다. */
function audioWaiting(audio) {
  return !audio.error && !audio.ended
    && (audio.readyState < HTMLMediaElement.HAVE_FUTURE_DATA || state.audioPlayPending.has(audio));
}

/** 지금 들려야 할 음원 중 하나라도 버퍼링 중이면 재생 시계를 멈춰 둔다. */
function waitingForAudio() {
  return activeAudioClips().some((clip) => {
    const audio = state.audioTracks.get(clip.id);
    return audio && audioWaiting(audio);
  });
}

function syncAudioTracks({ seeked = false } = {}) {
  const active = activeAudioClips();
  const activeIds = new Set(active.map((clip) => clip.id));

  for (const [clipId, audio] of state.audioTracks) {
    if (!state.playing || !activeIds.has(clipId)) audio.pause();
  }
  preloadAudio();
  if (!state.playing) return;

  for (const clip of active) {
    const audio = ensureAudio(clip);
    audio.volume = Math.max(0, Math.min(1, clip.volume ?? 1));
    const position = Math.max(0, state.time - clip.start);
    if (audio.readyState >= 1 && !state.audioPlayPending.has(audio)
      && (seeked || Math.abs(audio.currentTime - position) > 0.7)) {
      try { audio.currentTime = position; } catch { /* 메타데이터 로드를 기다린다. */ }
    }
    if (audio.paused && !audio.ended && !state.audioPlayPending.has(audio)) {
      state.audioPlayPending.add(audio);
      audio.play().catch((error) => {
        // 탐색·일시정지로 재생 요청이 취소되는 AbortError는 정상 흐름이다.
        if (error?.name === 'AbortError') return;
        if (audio.dataset.disposed || state.audioErrorReported) return;
        state.audioErrorReported = true;
        setPlaying(false);
        toast('음원을 재생하지 못했습니다. 재생 버튼을 다시 눌러주세요.');
      }).finally(() => state.audioPlayPending.delete(audio));
    }
  }
}

let lastFrame;
function unfinishedSpeechClip(nextTime) {
  const clip = allClips().find((candidate) => candidate.kind !== 'sfx'
    && candidate.audioUrl
    && state.time >= candidate.start
    && state.time < candidate.start + candidate.duration
    && nextTime >= candidate.start + candidate.duration);
  if (!clip) return null;
  const audio = state.audioTracks.get(clip.id);
  return audio && !audio.ended ? clip : null;
}

function tick(now) {
  if (!state.playing) return;
  if (waitingForAudio()) {
    // 음원이 준비될 때까지 시계를 세워 둬야 재생바와 소리가 어긋나지 않는다.
    lastFrame = now;
    syncAudioTracks();
    requestAnimationFrame(tick);
    return;
  }
  const end = state.stopAt ?? state.studio.timeline.durationSeconds;
  const nextTime = Math.min(end, state.time + (now - lastFrame) / 1000);
  const unfinished = unfinishedSpeechClip(nextTime);
  state.time = unfinished ? unfinished.start + unfinished.duration - 0.001 : nextTime;
  lastFrame = now;
  if (state.time >= end) {
    state.playing = false;
    state.stopAt = null;
    pauseAudioTracks();
  }
  updatePlayback();
  syncAudioTracks();
  if (state.playing) requestAnimationFrame(tick);
}

/** stopAt을 주면 그 시각(초)에서 멈춘다. 개별 항목 재생에 쓴다. */
function setPlaying(playing, { stopAt = null } = {}) {
  if (playing && !allClips().some((clip) => clip.audioUrl)) {
    toast('재생할 음원이 없습니다. TTS 생성 상태와 audio URL을 확인해주세요.');
    return;
  }
  const wasPlaying = state.playing;
  state.playing = playing;
  state.stopAt = playing ? stopAt : null;
  if (playing) {
    if (state.time >= state.studio.timeline.durationSeconds) state.time = 0;
    lastFrame = performance.now();
    // 이미 재생 중이면 기존 루프가 이어 돈다. 루프를 하나 더 돌리면 두 배속이 된다.
    if (!wasPlaying) requestAnimationFrame(tick);
  }
  syncAudioTracks({ seeked: playing });
  updatePlayback();
}

function seek(seconds) {
  state.time = Math.max(0, Math.min(state.studio.timeline.durationSeconds, seconds));
  syncAudioTracks({ seeked: true });
  updatePlayback();
}

// ── 이벤트 ───────────────────────────────────────────

function step(list, current, direction) {
  const index = list.indexOf(current) + direction;
  return list[Math.max(0, Math.min(list.length - 1, index))];
}

function bindEvents() {
  $('#scene-list').addEventListener('click', (event) => {
    const card = event.target.closest('[data-scene-id]');
    if (card && card.dataset.sceneId !== state.sceneId) void selectScene(card.dataset.sceneId);
  });

  $('#sub-filter').addEventListener('click', (event) => {
    const chip = event.target.closest('[data-sub-filter]');
    if (!chip || chip.disabled) return;
    state.subFilter = state.subFilter === chip.dataset.subFilter ? null : chip.dataset.subFilter;
    renderInspector();
  });

  $('#item-tabs').addEventListener('click', (event) => {
    const tab = event.target.closest('[data-tab]');
    if (!tab) return;
    selectTab(tab.dataset.tab);
  });

  $('#item-tabs').addEventListener('keydown', (event) => {
    const tab = event.target.closest('[role="tab"]');
    if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = [...$('#item-tabs').querySelectorAll('[role="tab"]')];
    const current = tabs.indexOf(tab);
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? tabs.length - 1
        : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    event.preventDefault();
    selectTab(tabs[next].dataset.tab, { focus: true });
  });

  $('#item-list').addEventListener('click', (event) => {
    const el = event.target.closest('[data-item-id]');
    if (!el || event.target.closest('select')) return;
    selectItem(el.dataset.itemId);
    const item = currentItem(el.dataset.itemId);
    const trigger = event.target.closest('[data-action]');
    switch (trigger?.dataset.action) {
      case 'play': {
        const clip = allClips().find((c) => c.itemId === item.id);
        if (!clip) break;
        if (!clip.audioUrl) {
          toast('이 항목의 음원이 아직 준비되지 않았습니다. TTS를 생성한 뒤 다시 시도해주세요.');
          break;
        }
        const end = clip.start + clip.duration;
        // 같은 항목을 재생 중이면 일시정지, 아니면 그 항목 구간만 재생한다.
        if (state.playing && state.stopAt === end) {
          setPlaying(false);
          break;
        }
        seek(clip.start);
        setPlaying(true, { stopAt: end });
        break;
      }
      case 'edit-text': modals.openText(item); break;
      case 'edit-sfx': modals.openSfx(item); break;
      case 'edit-volume': modals.openSfx(item, { focusVolume: true }); break;
      case 'delete-sfx': void modals.removeSfx(item, trigger); break;
      case 'regenerate': void modals.regenerate(item, trigger); break;
      case 'select-voice': modals.openVoice(item); break;
      case 'menu': modals.openMenu(item, trigger); break;
      default: break;
    }
  });

  $('#batch-regenerate').addEventListener('click', () => modals.openBatch());
  $('#add-dialogue').addEventListener('click', () => modals.openDialogue());
  $('#add-sfx').addEventListener('click', () => modals.openAddSfx());
  $('#manage-speakers').addEventListener('click', () => modals.openSpeakerNames());

  $('#item-list').addEventListener('change', (event) => {
    const field = event.target.closest('[data-field]');
    const item = event.target.closest('[data-item-id]');
    if (!field || !item) return;
    if (field.dataset.field === 'speaker') {
      void changeSpeakerName(field, item.dataset.itemId);
      return;
    }
    // 종류를 바꾸면 화자를 비운다.
    void changeLine(item.dataset.itemId, { kind: field.value, character_id: null });
  });

  $('#item-list').addEventListener('keydown', (event) => {
    const input = event.target.closest('[data-field="speaker"]');
    if (input && event.key === 'Enter') {
      event.preventDefault();
      const item = input.closest('[data-item-id]');
      if (item) void changeSpeakerName(input, item.dataset.itemId);
      input.blur();
    }
  });

  $('#manuscript').addEventListener('click', (event) => {
    const marker = event.target.closest('[data-item-id]');
    if (marker) selectItem(marker.dataset.itemId);
  });

  $('#complete-review').addEventListener('click', async () => {
    if (state.scene.items.some((item) => item.ttsStale)) {
      toast('변경된 항목의 음성을 재생성한 뒤 검수를 완료할 수 있습니다.');
      return;
    }
    $('#complete-review').disabled = true;
    try {
      await completeSceneReview(episodeId, state.sceneId);
      await reloadStudio();
      toast(`${sceneName(state.scene.number)} 검수를 완료했습니다.`);
    } catch (err) {
      $('#complete-review').disabled = false;
      toast(err.message || '검수 완료를 저장하지 못했습니다.');
    }
  });

  // 명세상 수정은 항목마다 바로 저장된다. 버튼은 저장 상태를 다시 확인한다.
  $('#save-draft').addEventListener('click', async () => {
    try {
      await reloadStudio();
      toast('수정 내용은 바로 저장됩니다.');
    } catch {
      toast('저장 상태를 확인하지 못했습니다.');
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

  // 레인을 누르면 그 위치로 이동, 클립을 누르면 해당 장면·항목을 선택
  $('#timeline-lane').addEventListener('click', async (event) => {
    const clip = event.target.closest('.clip');
    if (!clip) {
      const rect = event.currentTarget.getBoundingClientRect();
      seek(((event.clientX - rect.left) / rect.width) * state.window);
      return;
    }
    seek(Number(clip.dataset.start));
    const itemId = clip.dataset.clipItem;
    const scene = state.studio.scenes.find((s) => state.studio.sceneDetails[s.id]?.items.some((i) => i.id === itemId));
    if (scene && scene.id !== state.sceneId) await selectScene(scene.id);
    if (itemId) selectItem(itemId);
  });

  document.addEventListener('keydown', (event) => {
    if (event.code !== 'Space' || event.target.closest('button, select, input, textarea, dialog')) return;
    event.preventDefault();
    setPlaying(!state.playing);
  });
}

function selectTab(tab, { focus = false } = {}) {
  state.tab = tab;
  state.subFilter = null;
  renderInspector();
  if (focus) document.getElementById(`item-tab-${tab}`)?.focus();
}

// ── 시작 ─────────────────────────────────────────────

async function init() {
  modals = setupModals({ state, episodeId, reload: reloadStudio, toast, sceneName, itemLabel });
  bindEvents();
  if (!episodeId) {
    toast('편집할 회차를 찾을 수 없습니다.');
    return;
  }
  try {
    state.studio = await getStudio(episodeId);
  } catch (err) {
    toast(err.code === 'EPISODE_STATE_INVALID' ? '아직 검수할 수 없는 회차입니다.' : '스튜디오를 불러오지 못했습니다. 새로고침해 주세요.');
    return;
  }
  state.speakers = state.studio.speakers;
  state.time = state.studio.timeline.lastPlayheadSeconds ?? 0;
  $('#publish-review').href = `/publish?episode=${encodeURIComponent(state.studio.episode.id)}`;
  renderHeader();
  renderTimeline();
  const requested = params.get('scene');
  const scenes = state.studio.scenes;
  const first = scenes.find((s) => s.status === 'review_required') ?? scenes.find((s) => s.status !== 'done') ?? scenes[0];
  if (!first) {
    toast('원고 이미지가 없습니다.');
    return;
  }
  await selectScene(scenes.some((s) => s.id === requested) ? requested : first.id);
  preloadAudio();
  $('#workspace').setAttribute('aria-busy', 'false');
}

void init();
