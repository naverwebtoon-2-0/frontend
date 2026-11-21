// 화면은 이 모듈의 함수만 호출한다.
// API 명세가 정해지면 USE_MOCK을 false로 바꾸고 각 함수의 경로·응답 변환만 맞춘다.
import * as mock from './mock-data.js';

const USE_MOCK = true;
const MOCK_DELAY_MS = 300;
const TIMEOUT_MS = 10_000;

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

function mockResponse(data) {
  return new Promise((resolve) => {
    setTimeout(() => resolve(structuredClone(data)), MOCK_DELAY_MS);
  });
}

async function request(path, { method = 'GET', body } = {}) {
  let response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      body,
      headers: body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : undefined,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new ApiError('서버에 연결할 수 없습니다.', 0);
  }
  if (!response.ok) {
    throw new ApiError(`요청을 처리하지 못했습니다. (${response.status})`, response.status);
  }
  return response.status === 204 ? null : response.json();
}

/** 로그인한 작가 정보 */
export function getMe() {
  if (USE_MOCK) return mockResponse(mock.me);
  return request('/me');
}

/** A1 작가 대시보드 */
export function getDashboard() {
  if (USE_MOCK) return mockResponse(mock.dashboard);
  return request('/author/dashboard');
}

/** A2 업로드 화면 초기값: 작성 중인 회차와 이미 올린 페이지 */
export function getUploadDraft() {
  if (USE_MOCK) return mockResponse(mock.uploadDraft);
  return request('/author/episodes/draft');
}

/** 원고 언어 선택지 */
export function getLanguages() {
  if (USE_MOCK) return mockResponse(mock.languages);
  return request('/languages');
}

/**
 * 회차 생성과 AI 분석 시작
 * @param {{ title: string, language: string, pageIds: string[], files: File[] }} input
 */
export function startEpisodeAnalysis({ title, language, pageIds, files }) {
  if (USE_MOCK) {
    return mockResponse({ episodeId: 'ep-12', jobId: 'job-1', status: 'running' });
  }
  const body = new FormData();
  body.append('title', title);
  body.append('language', language);
  for (const id of pageIds) body.append('pageIds', id);
  for (const file of files) body.append('pages', file);
  return request('/author/episodes', { method: 'POST', body });
}

/** A3 AI 처리 작업 상태. 작업이 끝날 때까지 화면에서 주기적으로 호출한다. */
export function getProcessingJob(jobId) {
  if (USE_MOCK) return mockResponse(mock.processingJob(jobId));
  return request(`/author/jobs/${encodeURIComponent(jobId)}`);
}

// ── A4 제작 스튜디오 ──────────────────────────────────────────

const episodePath = (episodeId) => `/author/episodes/${encodeURIComponent(episodeId)}`;

/** 스튜디오 초기 데이터: 회차 정보, 장면 목록, 타임라인 */
export function getStudio(episodeId) {
  if (USE_MOCK) return mockResponse(mock.studio);
  return request(`${episodePath(episodeId)}/studio`);
}

/** 장면 상세: 편집 항목과 원고 감지 영역 */
export function getScene(episodeId, sceneId) {
  if (USE_MOCK) return mockResponse(mock.scenes[sceneId]);
  return request(`${episodePath(episodeId)}/scenes/${encodeURIComponent(sceneId)}`);
}

/** 대사 화자 선택지 */
export function getSpeakers(episodeId) {
  if (USE_MOCK) return mockResponse(mock.speakers);
  return request(`${episodePath(episodeId)}/speakers`);
}

/** 항목 일부 수정 (종류·화자·재생 방식 등) */
export function updateSceneItem(episodeId, sceneId, itemId, patch) {
  if (USE_MOCK) {
    const item = mock.scenes[sceneId]?.items.find((it) => it.id === itemId);
    if (item) Object.assign(item, patch, { ttsStale: true });
    return mockResponse(item);
  }
  return request(`${episodePath(episodeId)}/scenes/${encodeURIComponent(sceneId)}/items/${encodeURIComponent(itemId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

/** 장면 검수 완료 */
export function completeSceneReview(episodeId, sceneId) {
  if (USE_MOCK) {
    const scene = mock.studio.scenes.find((s) => s.id === sceneId);
    if (scene && scene.status !== 'done') {
      if (scene.issueCount > 0) mock.studio.review.problemCount -= 1;
      scene.status = 'done';
      scene.issueCount = 0;
      mock.studio.review.reviewedCount += 1;
    }
    return mockResponse({ scene, review: mock.studio.review });
  }
  return request(`${episodePath(episodeId)}/scenes/${encodeURIComponent(sceneId)}/review`, { method: 'POST' });
}

/** 임시 저장 */
export function saveStudioDraft(episodeId) {
  if (USE_MOCK) {
    mock.studio.lastSavedAt = new Date().toISOString();
    return mockResponse({ savedAt: mock.studio.lastSavedAt });
  }
  return request(`${episodePath(episodeId)}/draft`, { method: 'POST' });
}
