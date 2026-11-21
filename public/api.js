// 화면은 이 모듈의 함수만 호출한다.
// 백엔드 API 명세(초안, /v1)를 호출하고, 응답을 화면에서 쓰는 형태로 변환한다.
// USE_MOCK이면 fetch 대신 mock-server.js가 명세와 같은 형태로 응답한다.
import { handle as mockHandle } from './mock-server.js';

const USE_MOCK = true;
const MOCK_DELAY_MS = 250;
const TIMEOUT_MS = 10_000;
// 프런트 프록시가 /api/v1/* 를 백엔드 /v1/* 로 전달한다 (scripts/build.mjs).
const API_BASE = '/api';
const TOKEN_KEY = 'naverwebtoon.access_token';

export class ApiError extends Error {
  constructor(message, status, code = 'UNKNOWN', details = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function accessToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function toApiError(status, body) {
  const error = body?.error;
  return new ApiError(error?.message ?? `요청을 처리하지 못했습니다. (${status})`, status, error?.code, error?.details);
}

/**
 * @param {string} path '/v1/...' 형태의 명세 경로
 * @param {{ method?: string, body?: unknown, idempotent?: boolean }} options
 */
async function request(path, { method = 'GET', body, idempotent = false } = {}) {
  if (USE_MOCK) {
    await new Promise((resolve) => setTimeout(resolve, MOCK_DELAY_MS));
    const result = mockHandle(method, path, body);
    if (result.status >= 400) throw toApiError(result.status, result.body);
    return result.body;
  }

  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json; charset=utf-8';
  const token = accessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (idempotent) headers['Idempotency-Key'] = crypto.randomUUID();

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new ApiError('서버에 연결할 수 없습니다.', 0, 'NETWORK_ERROR');
  }
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw toApiError(response.status, data);
  return data;
}

const enc = encodeURIComponent;

/** presign으로 받은 Object Storage URL에 파일을 직접 올린다. */
async function putToStorage(upload, file) {
  if (USE_MOCK || upload.url.startsWith('mock://')) return;
  let response;
  try {
    response = await fetch(upload.url, { method: upload.method, headers: upload.headers, body: file });
  } catch {
    throw new ApiError(`${file.name}을(를) 올리지 못했습니다.`, 0, 'NETWORK_ERROR');
  }
  if (!response.ok) throw new ApiError(`${file.name}을(를) 올리지 못했습니다. (${response.status})`, response.status, 'UPLOAD_FAILED');
}

// ── 공통 ─────────────────────────────────────────────

/** GET /v1/me */
export async function getMe() {
  const me = await request('/v1/me');
  return { id: me.id, name: me.nickname, role: me.role };
}

/** 작가의 첫 작품. 작품 선택 화면이 생기기 전까지 대시보드·업로드는 이 작품을 기준으로 한다. */
async function currentSeries(seriesId) {
  if (seriesId) return request(`/v1/series/${enc(seriesId)}`);
  const { items } = await request('/v1/series');
  if (!items.length) throw new ApiError('등록된 작품이 없습니다.', 404, 'NOT_FOUND');
  return items[0];
}

const EPISODE_STATUS = {
  needs_review: 'review_required',
  analyzing: 'processing',
  synthesizing: 'processing',
  uploaded: 'processing',
  published: 'published',
  failed: 'failed',
  draft: 'draft',
};

// ── A1 작가 대시보드 ───────────────────────────────────

/**
 * GET /v1/series + GET /v1/series/{id}/episodes 를 묶어 대시보드를 만든다.
 * 명세에 없는 값(문제 장면 수, 남은 시간, 검수 진행률, 회차 길이)은 null.
 */
export async function getDashboard() {
  const series = await currentSeries();
  const { items: episodes } = await request(`/v1/series/${enc(series.id)}/episodes`);
  const byState = (...states) => episodes.filter((e) => states.includes(e.state));
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const published = byState('published');
  const reviewTarget = byState('needs_review').sort((a, b) => b.number - a.number)[0];

  return {
    stats: {
      reviewRequired: { count: byState('needs_review').length, problemScenes: null },
      processing: { count: byState('uploaded', 'analyzing', 'synthesizing').length, remainingSeconds: null },
      // 게시 시각 필드가 없어 updated_at으로 이번 달 게시 수를 추정한다.
      published: { count: published.length, thisMonth: published.filter((e) => new Date(e.updated_at) >= monthStart).length },
    },
    currentWork: {
      id: series.id,
      title: series.title,
      meta: [`총 ${episodes.length}화`, `게시 ${published.length}화`].join(' · '),
      review: reviewTarget ? { episodeId: reviewTarget.id, episodeNumber: reviewTarget.number, progress: null } : null,
    },
    recentEpisodes: [...episodes]
      .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
      .slice(0, 3)
      .map((e) => ({
        id: e.id,
        number: e.number,
        title: e.title,
        status: EPISODE_STATUS[e.state] ?? e.state,
        durationSeconds: null,
        updatedAt: e.updated_at,
      })),
  };
}

// ── A2 새 회차 업로드 ──────────────────────────────────

/** OCR 언어. 명세에 목록 API가 없어 프런트에서 정한다. */
const OCR_LANGUAGES = [
  { code: 'ko', label: '한국어' },
  { code: 'en', label: '영어' },
  { code: 'ja', label: '일본어' },
];

export async function getLanguages() {
  return OCR_LANGUAGES;
}

/**
 * 업로드 화면 초기값. episodeId가 있으면 그 회차와 이미 올린 이미지를, 없으면 새 회차 기본값을 준다.
 */
export async function getUploadDraft({ seriesId, episodeId } = {}) {
  if (episodeId) {
    const [episode, { items }] = await Promise.all([
      request(`/v1/episodes/${enc(episodeId)}`),
      request(`/v1/episodes/${enc(episodeId)}/images`),
    ]);
    return {
      seriesId: episode.series_id,
      episodeId: episode.id,
      title: episode.title,
      language: 'ko',
      pages: items.map((img) => ({ id: img.id, name: `이미지 ${img.index + 1}` })),
    };
  }
  const series = await currentSeries(seriesId);
  const { items } = await request(`/v1/series/${enc(series.id)}/episodes`);
  const next = Math.max(0, ...items.map((e) => e.number)) + 1;
  return { seriesId: series.id, episodeId: null, title: `${next}화`, language: series.language ?? 'ko', pages: [] };
}

/**
 * 회차 생성 → presign → Object Storage 업로드 → 업로드 확정 → 분석 시작
 * @param {{ seriesId: string, episodeId: string|null, title: string, language: string, files: File[] }} input
 * @returns {Promise<{ episodeId: string, jobId: string }>}
 */
export async function startEpisodeAnalysis({ seriesId, episodeId, title, language, files }) {
  let id = episodeId;
  if (!id) {
    const episode = await request(`/v1/series/${enc(seriesId)}/episodes`, { method: 'POST', body: { title }, idempotent: true });
    id = episode.id;
  } else {
    await request(`/v1/episodes/${enc(id)}`, { method: 'PATCH', body: { title } }).catch(() => {});
  }

  if (files.length) {
    const { uploads } = await request(`/v1/episodes/${enc(id)}/images/presign`, {
      method: 'POST',
      body: { files: files.map((f) => ({ filename: f.name, content_type: f.type, size: f.size })) },
    });
    await Promise.all(uploads.map((upload, i) => putToStorage(upload, files[i])));
    await request(`/v1/episodes/${enc(id)}/images/complete`, {
      method: 'POST',
      body: { image_ids: uploads.map((u) => u.image_id) },
    });
  }

  const { job } = await request(`/v1/episodes/${enc(id)}/process`, {
    method: 'POST',
    body: { options: { ocr_language: language, narration: true, sfx: true } },
    idempotent: true,
  });
  return { episodeId: id, jobId: job.id };
}

// ── A3 AI 처리 진행 ───────────────────────────────────

const PIPELINE = ['ocr', 'structure', 'dubbing', 'build_cues'];
const episodeCache = new Map();

/** GET /v1/jobs/{id} (+ 처음 한 번 GET /v1/episodes/{id}) */
export async function getProcessingJob(jobId) {
  const job = await request(`/v1/jobs/${enc(jobId)}`);
  if (!episodeCache.has(job.episode_id)) {
    episodeCache.set(job.episode_id, await request(`/v1/episodes/${enc(job.episode_id)}`));
  }
  const episode = episodeCache.get(job.episode_id);
  const completed = job.status === 'succeeded';
  const current = completed ? PIPELINE.length : Math.max(0, PIPELINE.indexOf(job.step));
  const fraction = job.progress?.total ? job.progress.done / job.progress.total : 0;

  const steps = [
    { key: 'upload', status: 'done', pageCount: episode.image_count },
    ...PIPELINE.map((key, i) => {
      let status = 'pending';
      if (i < current) status = 'done';
      else if (i === current) status = job.status === 'failed' ? 'failed' : 'running';
      return {
        key,
        status,
        processed: i === current ? job.progress?.done : undefined,
        total: i === current ? job.progress?.total : undefined,
      };
    }),
  ];

  return {
    jobId: job.id,
    episode: { id: episode.id, number: episode.number, title: episode.title },
    status: completed ? 'completed' : job.status === 'failed' || job.status === 'canceled' ? 'failed' : 'running',
    progress: completed ? 100 : Math.round(((current + fraction) / PIPELINE.length) * 100),
    remainingSeconds: null,
    errorCount: job.error ? 1 : 0,
    errorMessage: job.error?.message ?? null,
    steps,
  };
}

// ── A4 제작 스튜디오 ──────────────────────────────────

const studioCache = new Map();
const CLIP_GAP = 0.3;
const DEFAULT_SFX_SECONDS = 3;

function truncate(text, max = 9) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * GET /v1/episodes/{id}/studio 응답을 스튜디오 화면 형태로 바꾼다.
 * - 장면 = 원고 이미지 한 장
 * - 항목 = 대사(lines) + 효과음 큐(sfx_cues) + 이미지 설명(alt, 화면해설)
 * - 타임라인 = 이미지 순서·대사 순서대로 음성 길이를 이어 붙인 시간축
 */
function adaptStudio({ studio, episode, series, voices, presets }) {
  const characters = new Map(studio.characters.map((c) => [c.id, c]));
  const presetName = new Map(presets.map((p) => [p.tag, p.name]));
  const voiceName = new Map(voices.map((v) => [v.id, v.name]));
  const narrator = studio.characters.find((c) => c.kind === 'narration');
  const images = [...studio.images].sort((a, b) => a.index - b.index);

  // 1) 시간축: 이미지 순서 → 대사 순서
  const clips = { narration: [], description: [], dialogue: [], sfx: [] };
  const startOf = new Map();
  let cursor = 0;
  for (const image of images) {
    const imageStart = cursor;
    const lines = studio.lines.filter((l) => l.image_id === image.id && l.kind !== 'ignore').sort((a, b) => a.order - b.order);
    for (const l of lines) {
      if (!l.audio?.duration_ms) continue;
      const duration = l.audio.duration_ms / 1000;
      startOf.set(l.id, cursor);
      const track = l.kind === 'sfx_text' ? 'sfx' : l.kind;
      const speaker = characters.get(l.character_id);
      const label = l.kind === 'dialogue' ? `${speaker?.name ?? '화자 미지정'} · ${l.text}` : l.kind === 'narration' ? `원문 · ${truncate(l.text, 12)}` : l.text;
      clips[track]?.push({ id: `clip_${l.id}`, itemId: l.id, label, start: cursor, duration });
      cursor += duration + CLIP_GAP;
    }
    // 효과음 큐: 큐 위치(y_ratio) 이후 첫 대사와 함께 시작
    for (const cue of studio.sfx_cues.filter((c) => c.image_id === image.id)) {
      const after = lines.find((l) => l.bbox && l.bbox.y >= cue.y_ratio && startOf.has(l.id));
      const start = after ? startOf.get(after.id) : imageStart;
      startOf.set(cue.id, start);
      clips.sfx.push({
        id: `clip_${cue.id}`,
        itemId: cue.id,
        label: presetName.get(cue.sfx_tag) ?? cue.sfx_tag,
        start,
        duration: (cue.duration_ms ?? DEFAULT_SFX_SECONDS * 1000) / 1000,
      });
    }
  }
  const durationSeconds = Math.max(cursor - CLIP_GAP, ...Object.values(clips).flat().map((c) => c.start + c.duration), 0);

  // 2) 장면(이미지)별 항목
  const sceneDetails = {};
  const scenes = images.map((image) => {
    const lines = studio.lines.filter((l) => l.image_id === image.id).sort((a, b) => a.order - b.order);
    const items = [];
    for (const l of lines) {
      items.push({
        id: l.id,
        editable: 'line',
        type: l.kind === 'sfx_text' ? 'sfx' : l.kind,
        kind: l.kind,
        source: l.kind === 'sfx_text' ? 'drawn' : 'manuscript',
        speakerId: l.character_id,
        characterId: l.character_id ?? (l.kind === 'narration' ? narrator?.id : null),
        // 제안 필드: OCR 원문. 명세에 없어 없으면 null
        originalText: l.original_text ?? null,
        durationMs: l.audio?.duration_ms ?? null,
        text: l.text,
        bbox: l.bbox,
        start: startOf.get(l.id) ?? null,
        audioStatus: l.audio?.status ?? 'none',
        ttsStale: l.audio?.status === 'stale',
      });
      // 화면해설(이미지 설명)은 첫 나레이션 뒤에 둔다.
      if (image.alt && l.kind === 'narration' && !items.some((it) => it.type === 'description')) {
        items.push({ id: `alt_${image.id}`, editable: 'alt', type: 'description', source: 'alt', text: image.alt, start: null, ttsStale: false });
      }
    }
    if (image.alt && !items.some((it) => it.type === 'description')) {
      items.unshift({ id: `alt_${image.id}`, editable: 'alt', type: 'description', source: 'alt', text: image.alt, start: null, ttsStale: false });
    }
    for (const cue of studio.sfx_cues.filter((c) => c.image_id === image.id)) {
      items.push({
        id: cue.id,
        editable: 'cue',
        type: 'sfx',
        source: 'preset',
        text: presetName.get(cue.sfx_tag) ?? cue.sfx_tag,
        sfx: { tag: cue.sfx_tag, preset: presetName.get(cue.sfx_tag) ?? cue.sfx_tag, volume: Math.round((cue.volume ?? 1) * 100) },
        bbox: { x: 0.02, y: cue.y_ratio, w: 0, h: 0 },
        start: startOf.get(cue.id) ?? null,
        ttsStale: false,
      });
    }
    items.forEach((it, i) => { it.number = i + 1; });

    const staleCount = items.filter((it) => it.ttsStale).length;
    const pending = items.some((it) => ['pending', 'generating'].includes(it.audioStatus));
    let status = 'voice_ready';
    if (image.reviewed) status = 'done';
    else if (pending) status = 'analyzing';
    else if (staleCount) status = 'review_required';

    const firstText = lines.find((l) => ['narration', 'dialogue'].includes(l.kind))?.text;
    sceneDetails[image.id] = {
      id: image.id,
      number: image.index + 1,
      voice: { label: narrator ? `나레이션 · ${voiceName.get(narrator.voice_id) ?? narrator.voice_id}` : '나레이션 음성 미지정' },
      image: { url: image.url, width: image.width, height: image.height },
      items,
    };
    return {
      id: image.id,
      number: image.index + 1,
      title: firstText ? truncate(firstText) : `이미지 ${image.index + 1}`,
      status,
      issueCount: staleCount,
    };
  });

  return {
    episode: { id: episode.id, number: episode.number, title: episode.title, workTitle: series.title, state: episode.state, language: series.language ?? 'ko' },
    lastSavedAt: episode.updated_at,
    review: {
      reviewedCount: scenes.filter((s) => s.status === 'done').length,
      problemCount: scenes.filter((s) => s.status !== 'done' && s.issueCount > 0).length,
    },
    scenes,
    sceneDetails,
    speakers: studio.characters.filter((c) => c.kind !== 'narration').map((c) => ({ id: c.id, name: c.name })),
    characters: studio.characters.map((c) => ({
      id: c.id,
      name: c.name,
      kind: c.kind ?? 'character',
      voiceId: c.voice_id,
      voiceName: voiceName.get(c.voice_id) ?? c.voice_id,
      speed: c.voice_params?.speed ?? 0,
    })),
    voices: voices.map((v) => ({ id: v.id, name: v.name, sampleUrl: v.sample_url ?? null })),
    presets: presets.map((p) => ({ tag: p.tag, name: p.name, sampleUrl: p.sample_url ?? null })),
    timeline: {
      durationSeconds,
      lastPlayheadSeconds: 0,
      tracks: ['narration', 'description', 'dialogue', 'sfx'].map((type) => ({ type, clips: clips[type] })),
    },
  };
}

/** 스튜디오 전체 데이터. GET studio · episode · series · voices · sfx-presets */
export async function getStudio(episodeId) {
  const [studio, episode, voices, presets] = await Promise.all([
    request(`/v1/episodes/${enc(episodeId)}/studio`),
    request(`/v1/episodes/${enc(episodeId)}`),
    request('/v1/voices'),
    request('/v1/sfx-presets'),
  ]);
  const series = await request(`/v1/series/${enc(episode.series_id)}`);
  const view = adaptStudio({ studio, episode, series, voices: voices.items, presets: presets.items });
  studioCache.set(episodeId, view);
  return view;
}

/** 장면(이미지) 상세. getStudio로 이미 받은 데이터에서 꺼낸다. */
export async function getScene(episodeId, sceneId) {
  const view = studioCache.get(episodeId) ?? (await getStudio(episodeId));
  const scene = view.sceneDetails[sceneId];
  if (!scene) throw new ApiError('장면을 찾을 수 없습니다.', 404, 'NOT_FOUND');
  return scene;
}

/**
 * 대사 수정. PATCH /v1/lines/{id}
 * @param {{ kind?: string, character_id?: string|null, text?: string, emotion?: string }} patch
 */
export async function updateLine(lineId, patch) {
  return request(`/v1/lines/${enc(lineId)}`, { method: 'PATCH', body: patch });
}

/** 이미지 수정. 명세에 없는 제안 경로: PATCH /v1/episodes/{id}/images/{image_id} { reviewed, alt } */
function updateImage(episodeId, imageId, patch) {
  return request(`/v1/episodes/${enc(episodeId)}/images/${enc(imageId)}`, { method: 'PATCH', body: patch });
}

/** 장면(이미지) 검수 완료 */
export async function completeSceneReview(episodeId, sceneId) {
  return updateImage(episodeId, sceneId, { reviewed: true });
}

/** 화면해설(이미지 설명, alt) 수정 */
export async function updateImageDescription(episodeId, imageId, alt) {
  return updateImage(episodeId, imageId, { alt });
}

/**
 * 인물 목소리 변경. PATCH /v1/characters/{id}
 * 그 인물의 모든 대사가 stale이 된다(명세 §6.3).
 * @param {{ voiceId: string, speed: number }} input speed는 voice_params.speed (-1·0·1로 가정)
 */
export async function updateCharacterVoice(characterId, { voiceId, speed }) {
  return request(`/v1/characters/${enc(characterId)}`, {
    method: 'PATCH',
    body: { voice_id: voiceId, voice_params: { speed } },
  });
}

/** 효과음 큐 수정. PATCH /v1/sfx-cues/{id} (volume 0~1) */
export async function updateSfxCue(cueId, { tag, volume }) {
  return request(`/v1/sfx-cues/${enc(cueId)}`, { method: 'PATCH', body: { sfx_tag: tag, volume: volume / 100 } });
}

/** 대사 하나 재생성. POST /v1/lines/{id}/regenerate → 200 { audio } 또는 202 { job } */
export async function regenerateLine(lineId) {
  const result = await request(`/v1/lines/${enc(lineId)}/regenerate`, { method: 'POST', body: { force: false }, idempotent: true });
  if (result.job) await waitForJob(result.job.id);
}

/** stale 대사 일괄 재생성. POST /v1/episodes/{id}/regenerate { scope: "stale" } 후 작업 완료까지 기다린다. */
export async function regenerateStale(episodeId, onProgress) {
  const { job } = await request(`/v1/episodes/${enc(episodeId)}/regenerate`, {
    method: 'POST',
    body: { scope: 'stale' },
    idempotent: true,
  });
  await waitForJob(job.id, onProgress);
}

// ── A5 게시 전 검수 ──────────────────────────────────

/**
 * 게시 전 미리보기. GET /v1/episodes/{id}/preview (명세 §6.6, §9.2 playback 형식)
 * 말하는 큐(대사·나레이션)는 순서대로 이어 붙이고, 효과음 큐는 그 자리에서 겹쳐 시작한다.
 */
export async function getPublishPreview(episodeId) {
  const preview = await request(`/v1/episodes/${enc(episodeId)}/preview`);
  const images = new Map(preview.images.map((img) => [img.index, img]));
  let cursor = 0;
  const cues = preview.playback.cues.map((cue) => {
    const duration = (cue.duration_ms ?? 0) / 1000;
    const start = cursor;
    if (cue.kind !== 'sfx') cursor += duration + CLIP_GAP;
    return {
      id: cue.id,
      kind: cue.kind,
      imageIndex: cue.image_index,
      text: cue.kind === 'sfx' ? cue.label ?? cue.text : cue.text,
      speaker: cue.speaker ?? null,
      audioUrl: cue.audio_url,
      start,
      duration,
    };
  });
  const durationSeconds = Math.max(0, cursor - CLIP_GAP, ...cues.map((c) => c.start + c.duration));
  return { images, cues, durationSeconds };
}

/**
 * 게시. POST /v1/episodes/{id}/publish { publish_at }
 * stale 대사가 남으면 409 EPISODE_STATE_INVALID + details.stale_line_ids
 */
export async function publishEpisode(episodeId, { publishAt = null } = {}) {
  return request(`/v1/episodes/${enc(episodeId)}/publish`, {
    method: 'POST',
    body: { publish_at: publishAt },
    idempotent: true,
  });
}

const JOB_POLL_MS = 1000;

/** 작업이 끝날 때까지 GET /v1/jobs/{id}를 조회한다. 실패·취소면 ApiError */
async function waitForJob(jobId, onProgress) {
  for (;;) {
    const job = await request(`/v1/jobs/${enc(jobId)}`);
    onProgress?.(job.progress ?? null);
    if (job.status === 'succeeded') return job;
    if (job.status === 'failed' || job.status === 'canceled') {
      throw new ApiError(job.error?.message ?? '음성을 다시 만들지 못했습니다.', 0, 'JOB_FAILED');
    }
    await new Promise((resolve) => setTimeout(resolve, JOB_POLL_MS));
  }
}
