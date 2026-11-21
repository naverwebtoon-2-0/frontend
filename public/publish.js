// A5 게시 전 확인: 독자 화면 미리보기 + 게시 전 확인 + 경고 상세 · 게시 확인 · 게시 완료
// 검수 항목은 스튜디오 데이터(getStudio)로 계산한다. 명세상 필수는 "음성이 최신 상태"뿐이다(§8: stale이면 409).
import { getPublishPreview, getStudio, publishEpisode } from './api.js';
import { episodeLabel, fillSlots, formatDuration, renderHeader } from './common.js';

const $ = (selector) => document.querySelector(selector);
const episodeId = new URLSearchParams(location.search).get('episode');

const LANGUAGE = { ko: '한국어', en: '영어', ja: '일본어' };
const SPEEDS = [1, 1.25, 1.5, 0.75];
const LOUD_SFX_VOLUME = 70; // 이 이상이면 대사가 묻힐 수 있다고 본다(임시 기준).

const state = {
  studio: null,
  preview: null,
  checks: [],
  time: 0,
  playing: false,
  speed: 1,
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

const sceneName = (number) => `장면 ${String(number).padStart(2, '0')}`;
const studioHref = (sceneId) => `/studio?episode=${encodeURIComponent(episodeId)}${sceneId ? `&scene=${encodeURIComponent(sceneId)}` : ''}`;

function totalLabel(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m ? `총 ${m}분 ${s}초` : `총 ${s}초`;
}

function bindDialog(dialog) {
  for (const close of dialog.querySelectorAll('[data-close]')) close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
}

// ── 검수 항목 ─────────────────────────────────────────

/**
 * @returns {{ key: string, label: string, level: 'done'|'warning'|'required', status: string,
 *   warnings: { title: string, explanation: string, sceneId: string, location: string }[] }[]}
 */
function buildChecks(studio) {
  const scenes = studio.scenes.map((scene) => ({ ...scene, items: studio.sceneDetails[scene.id].items }));
  const where = (scene, part) => `이동 위치  ·  제작 스튜디오 > ${sceneName(scene.number)}${part ? ` > ${part}` : ''}`;
  const checks = [];

  // 1) 장면 검수 (권장)
  const unreviewed = scenes.filter((s) => s.status !== 'done');
  checks.push({
    key: 'review',
    label: '모든 장면 검수 완료',
    level: unreviewed.length ? 'warning' : 'done',
    status: unreviewed.length ? `권장 · ${unreviewed.length}장면 남음` : '완료',
    warnings: unreviewed.map((scene) => ({
      title: `${sceneName(scene.number)} · 검수 전`,
      explanation: '작가가 아직 확인하지 않은 장면입니다. 대사와 음성을 들어 보고 검수 완료를 눌러 주세요.',
      sceneId: scene.id,
      location: where(scene),
    })),
  });

  // 2) 화자와 음성 지정 (필수)
  const noSpeaker = scenes.flatMap((scene) => scene.items
    .filter((i) => i.type === 'dialogue' && !studio.speakers.some((s) => s.id === i.speakerId))
    .map((item) => ({ scene, item })));
  const noVoice = studio.characters.filter((c) => !c.voiceId);
  const speakerIssues = [
    ...noSpeaker.map(({ scene, item }) => ({
      title: `${sceneName(scene.number)} · 화자 미지정`,
      explanation: `${item.number}번 대사 “${item.text}”의 화자가 정해지지 않았습니다.`,
      sceneId: scene.id,
      location: where(scene, `${item.number}번 대사`),
    })),
    ...noVoice.map((c) => ({
      title: `${c.name} · 음성 미지정`,
      explanation: `${c.name}의 목소리가 정해지지 않아 음성을 만들 수 없습니다.`,
      sceneId: scenes[0]?.id,
      location: '이동 위치  ·  제작 스튜디오 > 대사 카드 ⋯ > 음성 설정',
    })),
  ];
  checks.push({
    key: 'speaker',
    label: '화자와 음성 지정',
    level: speakerIssues.length ? 'required' : 'done',
    status: speakerIssues.length ? `필수 · ${speakerIssues.length}건` : '완료',
    warnings: speakerIssues,
  });

  // 3) 음성이 최신 상태 (필수: stale·생성 중이면 게시 불가)
  const staleItems = scenes.flatMap((scene) => scene.items
    .filter((i) => i.ttsStale || ['pending', 'generating'].includes(i.audioStatus))
    .map((item) => ({ scene, item })));
  checks.push({
    key: 'audio',
    label: '음성 최신 상태',
    level: staleItems.length ? 'required' : 'done',
    status: staleItems.length ? `필수 · ${staleItems.length}개 재생성` : '완료',
    warnings: staleItems.map(({ scene, item }) => ({
      title: `${sceneName(scene.number)} · ${item.number}번 음성 재생성 필요`,
      explanation: item.audioStatus === 'pending' || item.audioStatus === 'generating'
        ? '음성을 아직 만드는 중입니다. 생성이 끝나야 게시할 수 있습니다.'
        : '텍스트나 음성 설정이 바뀌어 음성을 다시 만들어야 합니다. 스튜디오의 일괄 재생성을 이용하세요.',
      sceneId: scene.id,
      location: where(scene, `${item.number}번 항목`),
    })),
  });

  // 4) 효과음 볼륨 (권장)
  const loud = scenes.flatMap((scene) => scene.items
    .filter((i) => i.editable === 'cue' && i.sfx?.volume >= LOUD_SFX_VOLUME)
    .map((item) => ({ scene, item })));
  checks.push({
    key: 'sfx',
    label: '효과음 볼륨 확인',
    level: loud.length ? 'warning' : 'done',
    status: loud.length ? `권장 · ${loud.length}건` : '완료',
    warnings: loud.map(({ scene, item }) => ({
      title: `${sceneName(scene.number)} · 효과음 볼륨 확인`,
      explanation: `${item.sfx.preset} 볼륨이 ${item.sfx.volume}%입니다. 독자 청취 환경에서 대사가 묻힐 수 있습니다.`,
      sceneId: scene.id,
      location: where(scene, '효과음'),
    })),
  });

  // 5) 원문·화면해설 구성 (권장: 이미지 설명이 없으면 스크린 리더 사용자가 장면을 알기 어렵다)
  const noDescription = scenes.filter((s) => !s.items.some((i) => i.type === 'description'));
  checks.push({
    key: 'description',
    label: '원문·화면해설 구성',
    level: noDescription.length ? 'warning' : 'done',
    status: noDescription.length ? `권장 · ${noDescription.length}장면 설명 없음` : '완료',
    warnings: noDescription.map((scene) => ({
      title: `${sceneName(scene.number)} · 화면해설 없음`,
      explanation: '이미지 설명이 없어 스크린 리더 사용자가 장면을 이해하기 어렵습니다.',
      sceneId: scene.id,
      location: where(scene, '화면해설'),
    })),
  });

  return checks;
}

const MARK = { done: '✓', warning: '!', required: '!' };

function renderChecks() {
  const { checks, studio } = state;
  const required = checks.filter((c) => c.level === 'required').flatMap((c) => c.warnings);
  const warnings = checks.filter((c) => c.level === 'warning');
  const published = studio.episode.state === 'published';

  $('#checklist').replaceChildren(...checks.map((check) => {
    const row = document.getElementById('check-row').content.firstElementChild.cloneNode(true);
    row.dataset.level = check.level;
    fillSlots(row, { mark: MARK[check.level], label: check.label });
    const status = row.querySelector('[data-slot="status"]');
    if (check.level === 'done') {
      status.textContent = check.status;
    } else {
      const open = document.createElement('button');
      open.type = 'button';
      open.textContent = check.status;
      open.dataset.check = check.key;
      open.setAttribute('aria-haspopup', 'dialog');
      status.append(open);
    }
    return row;
  }));

  const summary = $('#issue-summary');
  if (published) {
    summary.dataset.state = 'published';
    fillSlots(summary, { 'summary-title': '이미 게시된 회차입니다.', 'summary-sub': '수정한 내용은 다시 게시해야 독자에게 반영됩니다.' });
  } else if (required.length) {
    summary.dataset.state = 'blocked';
    fillSlots(summary, {
      'summary-title': `필수 항목 ${required.length}건이 남았습니다.`,
      'summary-sub': `해결해야 게시할 수 있습니다${warnings.length ? ` · 권장 경고 ${warnings.length}건` : ''}`,
    });
  } else {
    summary.dataset.state = 'ready';
    fillSlots(summary, {
      'summary-title': '필수 검수 항목을 확인했습니다.',
      'summary-sub': warnings.length ? `남은 경고 ${warnings.length}건 · 게시 가능` : '경고 없음 · 게시 가능',
    });
  }
  const link = $('#open-warnings');
  link.hidden = published || !(required.length || warnings.length);
  link.textContent = required.length ? '필수 항목 보기 →' : '경고 상세 보기 →';

  const confirm = $('#open-confirm');
  confirm.disabled = published || required.length > 0 || studio.episode.state !== 'needs_review';
  confirm.textContent = published ? '게시됨' : '최종 게시하기';
}

// ── 경고 상세 ─────────────────────────────────────────

const warningModal = $('#warning-modal');
bindDialog(warningModal);

/** level: 'required' | 'warning' | 특정 항목 key */
function openWarnings(filter) {
  const checks = state.checks.filter((c) => c.level !== 'done' && (filter === c.key || filter === c.level || !filter));
  const items = checks.flatMap((c) => c.warnings.map((w) => ({ ...w, level: c.level })));
  if (!items.length) return;
  const isRequired = items.some((w) => w.level === 'required');
  fillSlots(warningModal, { 'warning-status': isRequired ? '필수 · 게시 불가' : '권장 · 게시 가능' });
  $('#warning-list').replaceChildren(...items.map((w) => {
    const block = document.createElement('section');
    block.className = 'warning-item';
    const title = document.createElement('h3');
    title.textContent = w.title;
    const text = document.createElement('p');
    text.textContent = w.explanation;
    const loc = document.createElement('a');
    loc.className = 'warning-item__location';
    loc.href = studioHref(w.sceneId);
    loc.textContent = w.location;
    block.append(title, text, loc);
    return block;
  }));
  $('#warning-go').href = studioHref(items[0].sceneId);
  warningModal.showModal();
}

// ── 게시 확인 · 완료 ───────────────────────────────────

const confirmModal = $('#confirm-modal');
const doneModal = $('#done-modal');
bindDialog(confirmModal);
bindDialog(doneModal);

function visibility() {
  const scheduled = document.querySelector('[name="visibility"]:checked').value === 'scheduled';
  const value = document.querySelector('[name="publishAt"]').value;
  const at = scheduled && value ? new Date(value) : null;
  return { scheduled, at };
}

function formatSchedule(date) {
  return date.toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

function openConfirm() {
  const { episode } = state.studio;
  const { scheduled, at } = visibility();
  if (scheduled && (!at || at <= new Date())) {
    toast('예약 게시 시각을 지금 이후로 정해 주세요.');
    document.querySelector('[name="publishAt"]').focus();
    return;
  }
  // 경고 수는 장면별 건수가 아니라 경고가 있는 검수 항목 수로 센다.
  const warnings = state.checks.filter((c) => c.level === 'warning');
  fillSlots(confirmModal, {
    'confirm-title': scheduled ? '예약 게시할까요?' : '최종 게시할까요?',
    'confirm-sub': scheduled ? '정한 시각에 독자 화면에 공개됩니다.' : '게시 후에는 독자 화면에 즉시 노출됩니다.',
    'confirm-episode': `${episode.workTitle} · ${episodeLabel(episode.number, episode.title)}`,
    'confirm-visibility': scheduled ? `예약 · ${formatSchedule(at)}` : '즉시 공개',
    'confirm-language': LANGUAGE[episode.language] ?? episode.language,
    'confirm-note': `권장 경고 ${warnings.length}건은 게시 후에도 수정할 수 있습니다.`,
  });
  confirmModal.querySelector('[data-slot="confirm-note"]').hidden = warnings.length === 0;
  confirmModal.querySelector('.modal__error').hidden = true;
  confirmModal.showModal();
}

confirmModal.querySelector('form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const submit = confirmModal.querySelector('[type="submit"]');
  const error = confirmModal.querySelector('.modal__error');
  const { scheduled, at } = visibility();
  submit.disabled = true;
  error.hidden = true;
  try {
    await publishEpisode(episodeId, { publishAt: scheduled ? at.toISOString() : null });
    confirmModal.close();
    const { episode } = state.studio;
    fillSlots(doneModal, {
      'done-title': scheduled ? `✓  ${episode.number}화 게시를 예약했습니다` : `✓  ${episode.number}화가 게시되었습니다`,
      'done-sub': scheduled ? `${formatSchedule(at)}에 독자 화면에 공개됩니다.` : '이제 독자 화면에서 음성 웹툰을 감상할 수 있습니다.',
      'done-episode': `${episode.workTitle} · ${episodeLabel(episode.number, episode.title)}`,
      'done-meta': `${scheduled ? `예약 · ${formatSchedule(at)}` : '즉시 공개'} · ${LANGUAGE[episode.language] ?? episode.language}`,
    });
    doneModal.showModal();
    await load();
  } catch (err) {
    const stale = err.details?.stale_line_ids?.length;
    error.textContent = stale
      ? `다시 만들어야 하는 음성이 ${stale}개 있습니다. 스튜디오에서 일괄 재생성한 뒤 게시하세요.`
      : err.message || '게시하지 못했습니다.';
    error.hidden = false;
  } finally {
    submit.disabled = false;
  }
});

// ── 독자 화면 미리보기 ─────────────────────────────────

const CUE_LABEL = { narration: '나레이션', dialogue: '대사', sfx: '효과음' };

/** 지금 들리는 말(대사·나레이션)을 우선하고, 없으면 효과음, 그것도 없으면 직전 큐를 보여 준다. */
function currentCue() {
  const { cues } = state.preview;
  const active = cues.filter((c) => state.time >= c.start && state.time < c.start + c.duration);
  return active.find((c) => c.kind !== 'sfx') ?? active[0]
    ?? [...cues].reverse().find((c) => c.start <= state.time) ?? cues[0];
}

function renderPreview() {
  const { preview } = state;
  const cue = currentCue();
  const img = $('#preview-image');
  const caption = $('#preview-caption');
  fillSlots(document, {
    'total-duration': totalLabel(preview.durationSeconds),
    'preview-time': `${formatDuration(state.time)} / ${formatDuration(preview.durationSeconds)}`,
    'preview-empty': cue ? '' : '미리 들을 내용이 없습니다.',
  });
  $('[data-slot="preview-empty"]').hidden = Boolean(cue);
  if (!cue) {
    img.hidden = true;
    caption.hidden = true;
    return;
  }
  const image = preview.images.get(cue.imageIndex);
  if (image?.url && img.getAttribute('src') !== image.url) img.src = image.url;
  img.hidden = !image?.url;
  img.alt = image?.alt || `${sceneName(cue.imageIndex + 1)} 원고`;
  caption.hidden = false;
  fillSlots(caption, {
    'caption-speaker': `${sceneName(cue.imageIndex + 1)} · ${cue.speaker ?? CUE_LABEL[cue.kind] ?? ''}`,
    'caption-text': cue.kind === 'sfx' ? `[${cue.text}]` : cue.text,
  });
  $('#preview-play').setAttribute('aria-pressed', String(state.playing));
  $('#preview-play').setAttribute('aria-label', state.playing ? '일시정지' : '재생');
}

// 음원 URL(audio_url)이 오면 <audio>로 바꾼다. 지금은 재생 위치만 움직인다.
let lastFrame;
function tick(now) {
  if (!state.playing) return;
  state.time = Math.min(state.preview.durationSeconds, state.time + ((now - lastFrame) / 1000) * state.speed);
  lastFrame = now;
  if (state.time >= state.preview.durationSeconds) state.playing = false;
  renderPreview();
  if (state.playing) requestAnimationFrame(tick);
}

function setPlaying(playing) {
  state.playing = playing;
  if (playing) {
    if (state.time >= state.preview.durationSeconds) state.time = 0;
    lastFrame = performance.now();
    requestAnimationFrame(tick);
  }
  renderPreview();
}

// ── 이벤트 ───────────────────────────────────────────

$('#preview-play').addEventListener('click', () => setPlaying(!state.playing));
$('#preview-all').addEventListener('click', () => {
  state.time = 0;
  setPlaying(true);
});
$('#preview-speed').addEventListener('click', (event) => {
  state.speed = SPEEDS[(SPEEDS.indexOf(state.speed) + 1) % SPEEDS.length];
  event.currentTarget.textContent = `${state.speed === 1 ? '1.0' : state.speed}×`;
});

$('#checklist').addEventListener('click', (event) => {
  const button = event.target.closest('[data-check]');
  if (button) openWarnings(button.dataset.check);
});
$('#open-warnings').addEventListener('click', () => {
  openWarnings(state.checks.some((c) => c.level === 'required') ? 'required' : 'warning');
});
$('#open-confirm').addEventListener('click', openConfirm);

for (const radio of document.querySelectorAll('[name="visibility"]')) {
  radio.addEventListener('change', () => {
    const scheduled = radio.value === 'scheduled' && radio.checked;
    $('#schedule-field').hidden = !scheduled;
    if (scheduled) {
      const input = document.querySelector('[name="publishAt"]');
      const toLocal = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
      const next = new Date(Date.now() + 60 * 60_000);
      next.setMinutes(0, 0, 0);
      input.min = toLocal(new Date());
      if (!input.value) input.value = toLocal(next);
    }
  });
}

$('#done-reader').addEventListener('click', (event) => {
  event.preventDefault();
  toast('독자 화면은 다음 단계에서 연결됩니다.');
});
$('#retry').addEventListener('click', () => void load());

// ── 시작 ─────────────────────────────────────────────

async function load() {
  const main = $('#publish');
  main.setAttribute('aria-busy', 'true');
  $('#load-error').hidden = true;
  try {
    const [studio, preview] = await Promise.all([getStudio(episodeId), getPublishPreview(episodeId)]);
    state.studio = studio;
    state.preview = preview;
    state.checks = buildChecks(studio);
    fillSlots(document, {
      'heading-sub': `${studio.episode.workTitle} · ${episodeLabel(studio.episode.number, studio.episode.title)} · 독자가 듣게 될 최종 결과를 확인하세요.`,
      language: `공개 언어 · ${LANGUAGE[studio.episode.language] ?? studio.episode.language}`,
    });
    $('#back-to-studio').href = studioHref();
    document.title = `게시 전 확인 · ${studio.episode.number}화 · 울림툰`;
    renderChecks();
    renderPreview();
  } catch {
    $('#load-error').hidden = false;
  } finally {
    main.setAttribute('aria-busy', 'false');
  }
}

void renderHeader();
if (episodeId) {
  void load();
} else {
  fillSlots(document, { 'load-error': '게시할 회차를 찾을 수 없습니다.' });
  $('#retry').hidden = true;
  $('#load-error').hidden = false;
}
