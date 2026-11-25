// 독자 화면의 개인 데이터(이어 듣기, 감상 설정, 보관함)
// 로그인이 아직 없어 이 브라우저의 localStorage에 저장한다.
// 로그인이 생기면 명세 §9.4 GET/PATCH /v1/me/settings, §9.5 PUT/GET /v1/me/progress/{id}로 바꾼다.

const KEYS = {
  settings: 'naverwebtoon.reader.settings',
  progress: 'naverwebtoon.reader.progress',
  favorites: 'naverwebtoon.reader.favorites',
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 저장할 수 없는 환경(사생활 보호 모드 등)이면 이번 방문에만 적용된다.
  }
}

// ── 감상 설정 ─────────────────────────────────────────

export const DEFAULT_SETTINGS = {
  playbackRate: 1,
  narrationMode: 'separate', // separate: 원문과 화면해설 구분 재생 · original: 원문만
  narrationVolume: 100,
  descriptionVolume: 85,
  dialogueVolume: 100,
  sfxVolume: 70,
  autoNextScene: true,
  autoNextEpisode: true,
  announceScenes: true,
  highContrast: false,
  textScale: 100,
};

export function getSettings() {
  return { ...DEFAULT_SETTINGS, ...read(KEYS.settings, {}) };
}

export function saveSettings(patch) {
  const next = { ...getSettings(), ...patch };
  write(KEYS.settings, next);
  applyPreferences(next);
  return next;
}

/** 고대비·글자 크기를 문서에 적용한다. 모든 독자 페이지가 시작할 때 부른다. */
export function applyPreferences(settings = getSettings()) {
  const root = document.documentElement;
  root.classList.toggle('high-contrast', settings.highContrast);
  root.style.setProperty('--reader-scale', String(settings.textScale / 100));
}

// ── 이어 듣기 ─────────────────────────────────────────

/** @returns {Record<string, { episodeId, seriesId, seriesTitle, number, title, time, duration, sceneIndex, sceneCount, completed, updatedAt }>} */
function allProgress() {
  return read(KEYS.progress, {});
}

/** 최근 감상 기록 전체. 최신 활동 순으로 정렬해 내 서재·감상 기록에서 쓴다. */
export function getAllProgress() {
  return Object.values(allProgress())
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

export function getProgress(episodeId) {
  return allProgress()[episodeId] ?? null;
}

export function saveProgress(entry) {
  const all = allProgress();
  all[entry.episodeId] = { ...entry, updatedAt: new Date().toISOString() };
  write(KEYS.progress, all);
}

/** 가장 최근에 듣던(끝나지 않은) 회차 */
export function getLatestProgress() {
  return getAllProgress().find((p) => !p.completed) ?? null;
}

/** 작품에서 마지막으로 들은 회차 */
export function getSeriesProgress(seriesId) {
  return Object.values(allProgress())
    .filter((p) => p.seriesId === seriesId)
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))[0] ?? null;
}

// ── 보관함 ───────────────────────────────────────────

export function isFavorite(seriesId) {
  return read(KEYS.favorites, []).includes(seriesId);
}

export function getFavoriteIds() {
  return read(KEYS.favorites, []);
}

export function toggleFavorite(seriesId) {
  const list = read(KEYS.favorites, []);
  const next = list.includes(seriesId) ? list.filter((id) => id !== seriesId) : [...list, seriesId];
  write(KEYS.favorites, next);
  return next.includes(seriesId);
}
