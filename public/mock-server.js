// 백엔드 API 명세(초안)를 흉내 내는 목 서버.
// api.js가 USE_MOCK일 때 fetch 대신 handle()을 호출한다. 응답 형태는 명세(/v1, snake_case)를 따른다.
// 명세에 없는 경로는 '제안'으로 표시했다.

const ago = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();
let seq = 100;
const newId = (prefix) => `${prefix}_${++seq}`;

class MockHttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.body = { error: { code, message, details } };
  }
}
const notFound = () => { throw new MockHttpError(404, 'NOT_FOUND', '리소스를 찾을 수 없습니다.'); };

// ── 데이터 ───────────────────────────────────────────

const db = {
  me: { id: 'us_01', email: 'author@example.com', nickname: '서윤', role: 'author', settings: {} },
  // 내부 목 데이터는 화면 표현에 필요한 값을 보관하고, 공개 API 응답은 실제 백엔드 스키마로 변환한다.
  series: [
    {
      id: 'sr_01', title: '별빛 아래 우리', description: '오랜 친구였던 서윤과 민호가 비 내리는 도시에서 다시 만나는 이야기.', language: 'ko',
      author_name: '서윤', genre: '로맨스', age_rating: '12세 이용가', features: ['description', 'sfx'], status: 'ongoing', cover_url: null,
    },
    {
      id: 'sr_02', title: '용의 기억', description: '잠든 용의 기억을 따라 사라진 왕국을 찾아가는 모험.', language: 'ko',
      author_name: '한결', genre: '판타지', age_rating: '전체 이용가', features: ['description', 'sfx'], status: 'completed', cover_url: null,
    },
    {
      id: 'sr_03', title: '퇴근 후 미스터리', description: '평범한 회사원이 퇴근길마다 마주치는 이상한 사건들.', language: 'ko',
      author_name: '도윤', genre: '스릴러', age_rating: '15세 이용가', features: ['sfx'], status: 'ongoing', cover_url: null,
    },
    {
      id: 'sr_04', title: '우리 동네 히어로', description: '동네를 지키는 평범한 영웅들의 유쾌한 하루.', language: 'ko',
      author_name: '이안', genre: '액션', age_rating: '전체 이용가', features: ['description', 'multilingual'], status: 'ongoing', cover_url: null,
    },
  ],
  episodes: [],
  images: {},
  characters: [
    { id: 'ch_narr', name: '나레이션', kind: 'narration', voice_id: 'nara', voice_params: { speed: 0, pitch: 0 } },
    { id: 'ch_seoyun', name: '', voice_id: 'dain', voice_params: { speed: 0, pitch: 0 } },
    { id: 'ch_minho', name: '', voice_id: 'jinho', voice_params: { speed: 0, pitch: -1 } },
  ],
  lines: [],
  sfxCues: [],
  jobs: {},
  voices: [
    { id: 'nara', name: '차분한 내레이터', gender: 'female', age: 'adult', sample_url: null },
    { id: 'dain', name: '차분한 여성 음성', gender: 'female', age: 'young', sample_url: null },
    { id: 'mijin', name: '또렷한 여성 음성', gender: 'female', age: 'adult', sample_url: null },
    { id: 'jinho', name: '밝은 남성 음성', gender: 'male', age: 'young', sample_url: null },
    { id: 'minsu', name: '낮은 남성 음성', gender: 'male', age: 'adult', sample_url: null },
  ],
  sfxPresets: [
    { tag: 'rain_loop', name: '빗소리 · 반복', category: 'weather' },
    { tag: 'thunder_near', name: '천둥(가까이)', category: 'weather' },
    { tag: 'door_open', name: '문 열림', category: 'object' },
    { tag: 'footsteps', name: '발소리', category: 'human' },
    { tag: 'impact', name: '충격음', category: 'action' },
  ],
};

// 1~11화 게시, 12화 검수 대기
const TITLES = ['첫 만남', '우산', '골목길', '편의점', '비밀', '약속', '기억', '편지', '재회', '오래된 편지', '새로운 단서', '빗속의 약속'];
TITLES.forEach((title, i) => {
  const number = i + 1;
  db.episodes.push({
    id: `ep_${String(number).padStart(2, '0')}`,
    series_id: 'sr_01',
    number,
    title,
    state: number === 12 ? 'needs_review' : 'published',
    image_count: 6,
    updated_at: number === 12 ? ago(10) : ago((12 - number) * 60 * 24 * 3 - 60 * 24 * 2),
  });
});

// 다른 작품: 모두 게시된 회차. 독자 화면용
for (const [seriesId, count, daysAgo] of [['sr_02', 48, 30], ['sr_03', 8, 1], ['sr_04', 21, 2]]) {
  for (let number = 1; number <= count; number += 1) {
    db.episodes.push({
      id: `${seriesId}_ep_${String(number).padStart(2, '0')}`,
      series_id: seriesId,
      number,
      title: `${number}화`,
      state: 'published',
      image_count: 6,
      updated_at: ago(((count - number) * 7 + daysAgo) * 60 * 24),
    });
  }
}

// 12화 원고 이미지 6장과 분석 결과
const PAGE = { url: '/mock/page.svg', width: 800, height: 1100 };
db.images.ep_12 = [
  { id: 'img_01', index: 0, ...PAGE, alt: '가로등 하나가 비 내리는 골목을 비춘다.', reviewed: true },
  { id: 'img_02', index: 1, ...PAGE, alt: '서윤이 우산 없이 골목 끝을 바라본다.', reviewed: false },
  { id: 'img_03', index: 2, ...PAGE, alt: '', reviewed: false },
  { id: 'img_04', index: 3, ...PAGE, alt: '굵어진 빗줄기 속에서 서윤이 우산을 접는다.', reviewed: false },
  { id: 'img_05', index: 4, ...PAGE, alt: '', reviewed: true },
  { id: 'img_06', index: 5, ...PAGE, alt: '', reviewed: false },
];

const audio = (id, ms, status = 'ready') => ({ asset_id: `au_${id}`, url: null, duration_ms: ms, status });
const line = (id, imageId, order, kind, characterId, text, bbox, ms, status, emotion = 'neutral') => ({
  id, image_id: imageId, order, text, bbox, kind, character_id: characterId, emotion, audio: audio(id, ms, status),
});
db.lines.push(
  line('ln_01', 'img_01', 1, 'narration', 'ch_narr', '골목에는 가로등 하나만 켜져 있었다.', { x: 0.08, y: 0.06, w: 0.6, h: 0.05 }, 3200, 'ready'),
  line('ln_02', 'img_02', 1, 'narration', 'ch_narr', '비가 세차게 내리던 밤이었다.', { x: 0.08, y: 0.07, w: 0.55, h: 0.05 }, 3000, 'ready'),
  line('ln_03', 'img_02', 2, 'dialogue', 'ch_seoyun', '민호야?', { x: 0.55, y: 0.42, w: 0.3, h: 0.05 }, 1500, 'stale', 'surprised'),
  line('ln_04', 'img_02', 3, 'sfx_text', null, '쾅!', { x: 0.08, y: 0.78, w: 0.22, h: 0.06 }, 900, 'stale'),
  line('ln_05', 'img_03', 1, 'dialogue', 'ch_minho', '왜?', { x: 0.6, y: 0.2, w: 0.2, h: 0.05 }, 1200, 'stale'),
  line('ln_06', 'img_04', 1, 'narration', 'ch_narr', '빗줄기가 점점 굵어졌다.', { x: 0.08, y: 0.08, w: 0.5, h: 0.05 }, 2600, 'stale'),
  line('ln_07', 'img_04', 2, 'dialogue', 'ch_seoyun', '이제 가야 해.', { x: 0.5, y: 0.5, w: 0.35, h: 0.05 }, 1800, 'stale', 'sad'),
  line('ln_08', 'img_05', 1, 'narration', 'ch_narr', '낡은 문이 삐걱 소리를 내며 열렸다.', { x: 0.08, y: 0.1, w: 0.65, h: 0.05 }, 3400, 'ready'),
  line('ln_09', 'img_06', 1, 'narration', 'ch_narr', '그날의 기억이 떠올랐다.', { x: 0.08, y: 0.1, w: 0.5, h: 0.05 }, null, 'pending'),
);
// 제안 필드: OCR 원문(original_text). "원문으로 되돌리기" 메뉴에 쓴다. 명세에 없음
db.lines.find((l) => l.id === 'ln_03').original_text = '민호아?';

db.sfxCues.push(
  { id: 'cu_01', image_id: 'img_01', y_ratio: 0.05, sfx_tag: 'rain_loop', volume: 0.5, duration_ms: 9000, asset_id: 'au_sfx_01', url: null },
  { id: 'cu_02', image_id: 'img_02', y_ratio: 0.8, sfx_tag: 'thunder_near', volume: 0.7, duration_ms: 2500, asset_id: 'au_sfx_02', url: null },
  { id: 'cu_03', image_id: 'img_05', y_ratio: 0.08, sfx_tag: 'door_open', volume: 0.8, duration_ms: 2000, asset_id: 'au_sfx_03', url: null },
);

// ── 작업(파이프라인) 진행 시뮬레이션: 약 30초 ──────────────────

const STEPS = [
  { step: 'ocr', seconds: 8 },
  { step: 'structure', seconds: 8 },
  { step: 'dubbing', seconds: 10 },
  { step: 'build_cues', seconds: 4 },
];

// 재생성 작업: 항목당 약 1초 뒤 대상 대사를 ready로 바꾼다.
function regenerateJobView(job) {
  const total = job.line_ids.length;
  const done = Math.min(total, Math.floor((Date.now() - job.started) / 1000));
  if (done < total) {
    return { ...job.base, status: 'running', step: 'dubbing', progress: { done, total }, finished_at: null };
  }
  for (const l of db.lines.filter((it) => job.line_ids.includes(it.id))) {
    l.audio.status = 'ready';
    l.audio.asset_id ??= newId('au');
    l.audio.duration_ms ??= Math.max(1200, l.text.length * 120);
  }
  return { ...job.base, status: 'succeeded', step: 'done', progress: { done: total, total }, finished_at: new Date().toISOString() };
}

function jobView(job) {
  if (job.base.kind === 'regenerate') return regenerateJobView(job);
  const elapsed = (Date.now() - job.started) / 1000;
  const episode = db.episodes.find((e) => e.id === job.episode_id);
  const totals = { ocr: episode.image_count, structure: 18, dubbing: 18, build_cues: 1 };
  let offset = 0;
  for (const { step, seconds } of STEPS) {
    if (elapsed < offset + seconds) {
      const total = totals[step];
      return {
        ...job.base,
        status: 'running',
        step,
        progress: { done: Math.floor(((elapsed - offset) / seconds) * total), total },
        finished_at: null,
      };
    }
    offset += seconds;
  }
  if (episode.state !== 'needs_review') {
    episode.state = 'needs_review';
    episode.updated_at = new Date().toISOString();
    // 새 회차는 분석 결과를 지어낼 수 없으니 12화의 분석 결과를 그대로 보여 준다.
    const ids = new Set((db.images[episode.id] ?? []).map((img) => img.id));
    if (!db.lines.some((l) => ids.has(l.image_id))) {
      db.images[episode.id] = structuredClone(db.images.ep_12).map((img) => ({ ...img, reviewed: false }));
      episode.image_count = db.images[episode.id].length;
    }
  }
  return { ...job.base, status: 'succeeded', step: 'done', progress: { done: 1, total: 1 }, finished_at: new Date().toISOString() };
}

// ── 라우트 ───────────────────────────────────────────

const episodeOf = (id) => db.episodes.find((e) => e.id === id) ?? notFound();
const imagesOf = (episodeId) => db.images[episodeId] ?? [];

/** 명세 §9.2 형식의 images + playback. 원고 데이터가 없는 회차는 12화 내용으로 대신 보여 준다. */
function buildPlayback(episodeId) {
  const own = imagesOf(episodeId);
  const images = [...(own.length ? own : imagesOf('ep_12'))].sort((a, b) => a.index - b.index);
  const characters = new Map(db.characters.map((c) => [c.id, c]));
  const presets = new Map(db.sfxPresets.map((p) => [p.tag, p.name]));
  const cues = [];
  for (const image of images) {
    for (const l of db.lines.filter((it) => it.image_id === image.id && !['ignore', 'sfx_text'].includes(it.kind))) {
      cues.push({
        id: `cu_${l.id}`,
        image_index: image.index,
        y_ratio: l.bbox?.y ?? 0,
        kind: l.kind,
        text: l.text,
        speaker: l.kind === 'dialogue' ? characters.get(l.character_id)?.name ?? null : null,
        audio_url: null,
        duration_ms: l.audio.duration_ms,
      });
    }
    for (const c of db.sfxCues.filter((it) => it.image_id === image.id)) {
      cues.push({
        id: c.id,
        image_index: image.index,
        y_ratio: c.y_ratio,
        kind: 'sfx',
        label: presets.get(c.sfx_tag) ?? c.sfx_tag,
        audio_url: null,
        volume: c.volume,
        duration_ms: c.duration_ms,
      });
    }
  }
  cues.sort((a, b) => a.image_index - b.image_index || a.y_ratio - b.y_ratio);
  return {
    images: images.map((img) => ({ index: img.index, url: img.url, width: img.width, height: img.height, alt: img.alt })),
    playback: { version: 0, urls_expire_at: new Date(Date.now() + 6 * 60 * 60_000).toISOString(), cues },
  };
}

// ── 독자용 공개 데이터 (명세 §9) ─────────────────────────

const publishedOf = (seriesId) => db.episodes
  .filter((e) => e.series_id === seriesId && e.state === 'published')
  .sort((a, b) => a.number - b.number);

function publicSeries(series) {
  const episodes = publishedOf(series.id);
  const latest = episodes.at(-1);
  const genreCode = { 로맨스: 'romance', 판타지: 'fantasy', 액션: 'action', 스릴러: 'thriller' }[series.genre] ?? series.genre;
  return {
    id: series.id,
    title: series.title,
    description: series.description,
    language: series.language,
    genre: genreCode,
    serial_status: series.status,
    cover_url: series.cover_url,
    episode_count: episodes.length,
    author: { nickname: series.author_name },
    created_at: series.created_at ?? ago(60 * 24 * 365),
    updated_at: latest?.updated_at ?? null,
  };
}

function playbackDurationMs(episodeId) {
  return buildPlayback(episodeId).playback.cues
    .filter((c) => c.kind !== 'sfx')
    .reduce((sum, c) => sum + (c.duration_ms ?? 0) + 300, 0);
}

function publicEpisodeOf(id) {
  const episode = db.episodes.find((e) => e.id === id && e.state === 'published');
  if (!episode) notFound();
  return episode;
}

const routes = [
  ['GET', /^\/v1\/me$/, () => db.me],

  ['GET', /^\/v1\/series$/, () => ({ items: db.series, next_cursor: null })],
  ['POST', /^\/v1\/series$/, (__, body) => {
    const title = body.title?.trim();
    if (!title) throw new MockHttpError(422, 'VALIDATION_ERROR', '작품명을 입력해주세요.', null);
    if (!body.genre) throw new MockHttpError(422, 'VALIDATION_ERROR', '장르를 선택해주세요.', null);
    const now = new Date().toISOString();
    const series = {
      id: newId('sr'),
      title,
      description: body.description?.trim() ?? '',
      language: body.language ?? 'ko',
      author_name: db.me.nickname,
      genre: body.genre,
      age_rating: null,
      features: [],
      status: body.serial_status ?? 'ongoing',
      cover_url: null,
      created_at: now,
      updated_at: now,
    };
    db.series.unshift(series);
    return { ...series, serial_status: series.status };
  }],
  ['GET', /^\/v1\/series\/([^/]+)$/, ([id]) => db.series.find((s) => s.id === id) ?? notFound()],
  ['DELETE', /^\/v1\/series\/([^/]+)$/, ([id]) => {
    const index = db.series.findIndex((series) => series.id === id);
    if (index < 0) notFound();
    db.series.splice(index, 1);
    db.episodes = db.episodes.filter((episode) => episode.series_id !== id);
    return null;
  }],
  ['GET', /^\/v1\/series\/([^/]+)\/episodes$/, ([id]) => ({
    items: db.episodes.filter((e) => e.series_id === id),
    next_cursor: null,
  })],
  ['GET', /^\/v1\/series\/([^/]+)\/dashboard$/, ([id], __, query) => {
    const series = db.series.find((item) => item.id === id) ?? notFound();
    const month = query.get('month') ?? new Date().toISOString().slice(0, 7);
    const episodes = db.episodes
      .filter((episode) => episode.series_id === id)
      .sort((a, b) => b.number - a.number)
      .map((episode) => {
        const images = imagesOf(episode.id);
        const imageIds = new Set(images.map((image) => image.id));
        const issueCount = db.lines.filter((line) => imageIds.has(line.image_id) && !['ignore', 'sfx_text'].includes(line.kind)
          && ['stale', 'failed'].includes(line.audio?.status)).length;
        const reviewedCount = images.filter((image) => image.reviewed).length;
        const processing = ['analyzing', 'synthesizing'].includes(episode.state)
          ? { job_id: null, step: episode.state === 'analyzing' ? 'structure' : 'dubbing', progress: null, eta_seconds: 95 }
          : null;
        return {
          ...episode,
          published_at: episode.state === 'published' ? episode.updated_at : null,
          scheduled_at: episode.state === 'scheduled' ? episode.updated_at : null,
          stats: {
            reviewed_image_count: reviewedCount,
            review_progress: images.length ? reviewedCount / images.length : 0,
            issue_count: issueCount,
            issue_breakdown: { low_ocr_confidence: 0, speaker_unknown: 0, audio_failed: 0, audio_stale: issueCount },
            audio_duration_ms: episode.state === 'published' ? playbackDurationMs(episode.id) : null,
            processing,
          },
        };
      });
    return {
      series: { id: series.id, title: series.title, genre: series.genre, serial_status: series.status },
      summary: {
        month,
        timezone: 'Asia/Seoul',
        episode_count: episodes.length,
        published_count: episodes.filter((episode) => episode.state === 'published').length,
        published_this_month: episodes.filter((episode) => episode.published_at?.slice(0, 7) === month).length,
        issue_count: episodes.reduce((sum, episode) => sum + episode.stats.issue_count, 0),
        in_progress_count: episodes.filter((episode) => ['analyzing', 'synthesizing'].includes(episode.state)).length,
      },
      episodes,
      next_cursor: null,
    };
  }],
  ['DELETE', /^\/v1\/episodes\/([^/]+)$/, ([id]) => {
    const index = db.episodes.findIndex((episode) => episode.id === id);
    if (index < 0) notFound();
    db.episodes.splice(index, 1);
    delete db.images[id];
    return null;
  }],
  ['POST', /^\/v1\/series\/([^/]+)\/episodes$/, ([id], body) => {
    const number = Math.max(0, ...db.episodes.filter((e) => e.series_id === id).map((e) => e.number)) + 1;
    const episode = { id: newId('ep'), series_id: id, number, title: body.title, state: 'draft', image_count: 0, updated_at: new Date().toISOString() };
    db.episodes.push(episode);
    return episode;
  }],
  ['POST', /^\/v1\/series\/([^/]+)\/characters$/, ([seriesId], body) => {
    if (!db.series.some((series) => series.id === seriesId)) notFound();
    const name = body.name?.trim();
    if (!name) throw new MockHttpError(422, 'VALIDATION_ERROR', '인물 이름을 입력해주세요.', null);
    const character = {
      id: newId('ch'),
      series_id: seriesId,
      name,
      kind: body.kind ?? 'character',
      voice_id: body.voice_id ?? null,
      voice_params: body.voice_params ?? { speed: 0, pitch: 0 },
    };
    db.characters.push(character);
    return character;
  }],

  ['GET', /^\/v1\/episodes\/([^/]+)$/, ([id]) => episodeOf(id)],
  ['PATCH', /^\/v1\/episodes\/([^/]+)$/, ([id], body) => Object.assign(episodeOf(id), body, { updated_at: new Date().toISOString() })],
  ['GET', /^\/v1\/episodes\/([^/]+)\/images$/, ([id]) => ({ items: imagesOf(id), next_cursor: null })],
  ['POST', /^\/v1\/episodes\/([^/]+)\/images\/presign$/, ([id], body) => {
    episodeOf(id);
    const start = imagesOf(id).length;
    return {
      uploads: body.files.map((file, i) => ({
        image_id: newId('img'),
        index: start + i,
        method: 'PUT',
        url: `mock://object-storage/${id}/${file.filename}`,
        headers: { 'Content-Type': file.content_type },
        expires_in: 600,
      })),
    };
  }],
  ['POST', /^\/v1\/episodes\/([^/]+)\/images\/complete$/, ([id], body) => {
    const episode = episodeOf(id);
    const images = (db.images[id] ??= []);
    for (const imageId of body.image_ids) images.push({ id: imageId, index: images.length, ...PAGE, alt: '', reviewed: false });
    Object.assign(episode, { state: 'uploaded', image_count: images.length, updated_at: new Date().toISOString() });
    return { episode: { state: episode.state, image_count: episode.image_count } };
  }],
  ['POST', /^\/v1\/episodes\/([^/]+)\/process$/, ([id]) => {
    const episode = episodeOf(id);
    if (!['uploaded', 'failed'].includes(episode.state)) {
      throw new MockHttpError(409, 'EPISODE_STATE_INVALID', '현재 상태에서는 분석을 시작할 수 없습니다.', { state: episode.state });
    }
    episode.state = 'analyzing';
    const jobId = newId('job');
    db.jobs[jobId] = {
      started: Date.now(),
      episode_id: id,
      base: { id: jobId, episode_id: id, kind: 'process', error: null, started_at: new Date().toISOString() },
    };
    return { job: { id: jobId, status: 'queued', step: 'ocr' }, episode: { state: episode.state } };
  }],
  ['GET', /^\/v1\/jobs\/([^/]+)$/, ([id]) => {
    // 데모용: job_demo는 12화 분석을 처음부터 보여 준다.
    if (id === 'job_demo' && !db.jobs.job_demo) {
      db.jobs.job_demo = { started: Date.now(), episode_id: 'ep_12', base: { id, episode_id: 'ep_12', kind: 'process', error: null, started_at: new Date().toISOString() } };
    }
    return db.jobs[id] ? jobView(db.jobs[id]) : notFound();
  }],

  ['GET', /^\/v1\/episodes\/([^/]+)\/studio$/, ([id]) => {
    const episode = episodeOf(id);
    const images = imagesOf(id);
    const imageIds = new Set(images.map((img) => img.id));
    return {
      episode: { id: episode.id, state: episode.state },
      images,
      characters: db.characters,
      lines: db.lines.filter((l) => imageIds.has(l.image_id)),
      sfx_cues: db.sfxCues.filter((c) => imageIds.has(c.image_id)),
    };
  }],
  ['POST', /^\/v1\/episodes\/([^/]+)\/lines$/, ([episodeId], body) => {
    episodeOf(episodeId);
    const image = imagesOf(episodeId).find((item) => item.id === body.image_id) ?? notFound();
    const text = body.text?.trim();
    if (!text) throw new MockHttpError(422, 'VALIDATION_ERROR', '말풍선 텍스트를 입력해주세요.', null);
    if (body.character_id && !db.characters.some((character) => character.id === body.character_id)) notFound();
    const order = Math.max(0, ...db.lines.filter((line) => line.image_id === image.id).map((line) => line.order)) + 1;
    const id = newId('ln');
    const created = {
      id,
      image_id: image.id,
      order,
      text,
      original_text: null,
      bbox: null,
      y_ratio: 0,
      kind: body.kind ?? 'dialogue',
      character_id: body.character_id ?? null,
      emotion: body.emotion ?? 'neutral',
      ocr_confidence: null,
      audio: { asset_id: null, url: null, duration_ms: null, status: 'stale' },
      flags: [],
    };
    db.lines.push(created);
    return created;
  }],
  ['PATCH', /^\/v1\/lines\/([^/]+)$/, ([id], body) => {
    const target = db.lines.find((l) => l.id === id) ?? notFound();
    const affectsAudio = ['text', 'character_id', 'emotion', 'kind'].some((k) => k in body && body[k] !== target[k]);
    Object.assign(target, body);
    if (affectsAudio) target.audio.status = 'stale';
    return target;
  }],
  // 제안: 이미지(장면) 단위 검수 완료. 명세에 없음
  ['PATCH', /^\/v1\/episodes\/([^/]+)\/images\/([^/]+)$/, ([episodeId, imageId], body) => {
    const image = imagesOf(episodeId).find((img) => img.id === imageId) ?? notFound();
    Object.assign(image, body);
    return image;
  }],

  // 대사가 있는 인물은 삭제할 수 없다.
  ['DELETE', /^\/v1\/characters\/([^/]+)$/, ([id]) => {
    const index = db.characters.findIndex((c) => c.id === id);
    if (index < 0) notFound();
    if (db.lines.some((l) => l.character_id === id)) {
      throw new MockHttpError(409, 'CHARACTER_IN_USE', '대사가 있는 인물은 삭제할 수 없습니다. 먼저 병합하세요.', null);
    }
    db.characters.splice(index, 1);
    return {};
  }],
  ['PATCH', /^\/v1\/characters\/([^/]+)$/, ([id], body) => {
    const character = db.characters.find((c) => c.id === id) ?? notFound();
    const affectsAudio = ('voice_id' in body && body.voice_id !== character.voice_id)
      || ('voice_params' in body && JSON.stringify(body.voice_params) !== JSON.stringify(character.voice_params));
    Object.assign(character, body);
    // 명세 §6.3: 목소리를 바꾸면 그 인물의 모든 대사가 stale
    if (affectsAudio) {
      for (const l of db.lines.filter((it) => it.character_id === id)) l.audio.status = 'stale';
    }
    return character;
  }],
  ['POST', /^\/v1\/episodes\/([^/]+)\/sfx-cues$/, ([episodeId], body) => {
    if (!imagesOf(episodeId).some((img) => img.id === body.image_id)) notFound();
    if (!db.sfxPresets.some((p) => p.tag === body.sfx_tag)) {
      throw new MockHttpError(422, 'VALIDATION_ERROR', '알 수 없는 효과음 프리셋입니다.', null);
    }
    const durations = { rain_loop: 9000, thunder_near: 2500, door_open: 900, footsteps: 1500, impact: 700 };
    const cue = {
      id: newId('cu'),
      image_id: body.image_id,
      y_ratio: body.y_ratio,
      sfx_tag: body.sfx_tag,
      volume: body.volume ?? 1,
      duration_ms: durations[body.sfx_tag],
      asset_id: newId('au'),
      url: null,
    };
    db.sfxCues.push(cue);
    return cue;
  }],
  ['DELETE', /^\/v1\/sfx-cues\/([^/]+)$/, ([id]) => {
    const index = db.sfxCues.findIndex((c) => c.id === id);
    if (index < 0) notFound();
    db.sfxCues.splice(index, 1);
    return {};
  }],
  ['PATCH', /^\/v1\/sfx-cues\/([^/]+)$/, ([id], body) => Object.assign(db.sfxCues.find((c) => c.id === id) ?? notFound(), body)],
  ['POST', /^\/v1\/lines\/([^/]+)\/regenerate$/, ([id]) => {
    const target = db.lines.find((l) => l.id === id) ?? notFound();
    target.audio.status = 'ready';
    target.audio.asset_id ??= newId('au');
    target.audio.duration_ms ??= Math.max(1200, target.text.length * 120);
    // 캐시 적중을 흉내 내 200 + audio로 바로 돌려준다.
    return { audio: target.audio };
  }],
  ['POST', /^\/v1\/episodes\/([^/]+)\/regenerate$/, ([id], body) => {
    const ids = new Set(imagesOf(id).map((img) => img.id));
    const lines = db.lines.filter((l) => ids.has(l.image_id));
    const targets = body.scope === 'lines' ? lines.filter((l) => body.line_ids.includes(l.id))
      // 목 서버에는 생성 완료를 알리는 흐름이 없어, 생성 중(pending)인 대사도 함께 완료시킨다.
      : body.scope === 'all' ? lines : lines.filter((l) => l.audio.status !== 'ready');
    const jobId = newId('job');
    db.jobs[jobId] = {
      started: Date.now(),
      episode_id: id,
      line_ids: targets.map((l) => l.id),
      base: { id: jobId, episode_id: id, kind: 'regenerate', error: null, started_at: new Date().toISOString() },
    };
    return { job: { id: jobId, kind: 'regenerate', status: 'queued' } };
  }],

  // 명세 §6.6: 독자 뷰어와 같은 형식(§9.2 playback)의 게시 전 미리보기
  ['GET', /^\/v1\/episodes\/([^/]+)\/preview$/, ([id]) => ({ id, ...buildPlayback(id) })],
  // 명세 §8 게시: stale 대사가 남으면 409
  ['POST', /^\/v1\/episodes\/([^/]+)\/publish$/, ([id], body) => {
    const episode = episodeOf(id);
    if (episode.state !== 'needs_review') {
      throw new MockHttpError(409, 'EPISODE_STATE_INVALID', '현재 상태에서는 게시할 수 없습니다.', { state: episode.state });
    }
    const ids = new Set(imagesOf(id).map((img) => img.id));
    const stale = db.lines.filter((l) => ids.has(l.image_id) && !['ignore', 'sfx_text'].includes(l.kind) && l.audio.status !== 'ready');
    if (stale.length) {
      throw new MockHttpError(409, 'EPISODE_STATE_INVALID', '다시 만들어야 하는 음성이 남아 있습니다.', { stale_line_ids: stale.map((l) => l.id) });
    }
    Object.assign(episode, { state: 'published', publish_at: body.publish_at ?? null, updated_at: new Date().toISOString() });
    return episode;
  }],
  ['POST', /^\/v1\/episodes\/([^/]+)\/unpublish$/, ([id]) => Object.assign(episodeOf(id), { state: 'needs_review', updated_at: new Date().toISOString() })],

  // ── 명세 §9 독자용 공개 API (비로그인 허용) ──
  ['GET', /^\/v1\/public\/series$/, (_, __, query) => {
    const q = (query.get('q') ?? '').trim().toLowerCase();
    const genre = query.get('genre') ?? '';
    const serialStatus = query.get('serial_status') ?? '';
    const items = db.series
      .map(publicSeries)
      .filter((s) => s.episode_count > 0)
      .filter((s) => !q || s.title.toLowerCase().includes(q))
      .filter((s) => !genre || s.genre === genre)
      .filter((s) => !serialStatus || s.serial_status === serialStatus)
      .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
    return { items, next_cursor: null };
  }],
  ['GET', /^\/v1\/public\/series\/([^/]+)$/, ([id]) => publicSeries(db.series.find((s) => s.id === id) ?? notFound())],
  ['GET', /^\/v1\/public\/series\/([^/]+)\/episodes$/, ([id]) => ({
    items: publishedOf(id).map((e) => ({
      id: e.id,
      number: e.number,
      title: e.title,
      audio_duration_ms: playbackDurationMs(e.id),
      published_at: e.updated_at,
    })),
    next_cursor: null,
  })],
  ['GET', /^\/v1\/public\/episodes\/([^/]+)$/, ([id]) => {
    const episode = publicEpisodeOf(id);
    const siblings = publishedOf(episode.series_id);
    const index = siblings.findIndex((e) => e.id === id);
    return {
      id,
      title: episode.title,
      number: episode.number,
      series_id: episode.series_id,
      language: 'ko',
      ...buildPlayback(id),
      prev_episode_id: siblings[index - 1]?.id ?? null,
      next_episode_id: siblings[index + 1]?.id ?? null,
    };
  }],
  ['GET', /^\/v1\/public\/episodes\/([^/]+)\/transcript$/, ([id]) => {
    const episode = publicEpisodeOf(id);
    return {
      episode_id: id,
      items: buildPlayback(episode.id).playback.cues.map((cue, index) => ({
        index: index + 1,
        image_index: cue.image_index,
        kind: cue.kind,
        speaker: cue.speaker ?? null,
        text: cue.kind === 'sfx' ? `[${cue.label ?? cue.text}]` : cue.text,
      })),
    };
  }],

  ['GET', /^\/v1\/voices$/, () => ({ items: db.voices, next_cursor: null })],
  ['GET', /^\/v1\/sfx-presets$/, () => ({ items: db.sfxPresets, next_cursor: null })],
];

// 페이지를 옮겨도 목 데이터(새 회차, 작업 등)가 이어지도록 탭 세션에 보관한다.
// 목 데이터 구조가 바뀌면 버전을 올려 이전 세션 데이터를 버린다.
const STORE_KEY = 'naverwebtoon.mock-db.v4';
try {
  const saved = sessionStorage.getItem(STORE_KEY);
  if (saved) Object.assign(db, JSON.parse(saved).db);
  seq = Math.max(seq, JSON.parse(saved ?? '{}').seq ?? 0);
} catch {
  // 저장소를 쓸 수 없으면 페이지마다 초기 데이터로 시작한다.
}
function persist() {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify({ db, seq }));
  } catch {
    // 무시
  }
}

/** 명세 형태의 응답을 돌려준다. 실패하면 { status, body } 형태로 던진다. */
export function handle(method, path, body) {
  const [pathname, queryString = ''] = path.split('?');
  const query = new URLSearchParams(queryString);
  for (const [m, pattern, handler] of routes) {
    const match = m === method && pathname.match(pattern);
    if (match) {
      try {
        const result = structuredClone(handler(match.slice(1), body ?? {}, query));
        persist();
        const status = method === 'DELETE'
          ? 204
          : method === 'POST' && (/^\/v1\/episodes\/[^/]+\/lines$/.test(pathname)
            || /^\/v1\/series\/[^/]+\/characters$/.test(pathname)
            || /^\/v1\/episodes\/[^/]+\/sfx-cues$/.test(pathname))
            ? 201
            : method === 'POST' && /\/(process|episodes\/[^/]+\/regenerate)$/.test(pathname) ? 202 : 200;
        return { status, body: result };
      } catch (err) {
        if (err instanceof MockHttpError) return { status: err.status, body: err.body };
        throw err;
      }
    }
  }
  return { status: 404, body: { error: { code: 'NOT_FOUND', message: `목 서버에 없는 경로입니다: ${method} ${pathname}` } } };
}
