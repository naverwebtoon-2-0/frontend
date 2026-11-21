// API 명세가 정해지기 전까지 쓰는 목데이터.
// 필드 이름은 화면에 필요한 값 기준의 초안이며, 명세가 나오면 api.js에서 변환한다.

const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();

export const me = {
  id: 'author-1',
  name: '서윤',
  role: 'author',
};

export const dashboard = {
  stats: {
    reviewRequired: { count: 3, problemScenes: 5 },
    processing: { count: 1, remainingSeconds: 240 },
    published: { count: 24, thisMonth: 4 },
  },
  currentWork: {
    id: 'work-1',
    title: '별빛 아래 우리',
    genre: '로맨스',
    status: 'serializing',
    episodeCount: 12,
    review: { episodeNumber: 12, progress: 62 },
  },
  recentEpisodes: [
    {
      id: 'ep-12',
      number: 12,
      title: '빗속의 약속',
      status: 'review_required',
      durationSeconds: 760,
      updatedAt: minutesAgo(10),
    },
    {
      id: 'ep-11',
      number: 11,
      title: '새로운 단서',
      status: 'published',
      durationSeconds: 618,
      updatedAt: minutesAgo(60 * 24),
    },
    {
      id: 'ep-10',
      number: 10,
      title: '오래된 편지',
      status: 'published',
      durationSeconds: 594,
      updatedAt: minutesAgo(60 * 24 * 3),
    },
  ],
};

export const uploadDraft = {
  workId: 'work-1',
  episodeNumber: 12,
  title: '12화 · 빗속의 약속',
  language: 'ko',
  pages: [
    { id: 'page-1', name: 'page-01.png' },
    { id: 'page-2', name: 'page-02.png' },
    { id: 'page-3', name: 'page-03.png' },
    { id: 'page-4', name: 'page-04.png' },
    { id: 'page-5', name: 'page-05.png' },
  ],
};

export const languages = [
  { code: 'ko', label: '한국어' },
  { code: 'en', label: '영어' },
  { code: 'ja', label: '일본어' },
];

// AI 처리 작업: 페이지를 연 뒤 지난 시간에 따라 진행 상황을 만들어 낸다.
// 디자인 기준 상태(58%, OCR 12/18)에서 시작해 약 30초 뒤 완료된다.
const jobStartedAt = Date.now();
const SCENES = 18;

export function processingJob(jobId) {
  const elapsed = (Date.now() - jobStartedAt) / 1000;
  const ocrDone = Math.min(SCENES, 12 + Math.floor(elapsed / 2));
  const narrationDone = Math.min(SCENES, Math.max(0, Math.floor((elapsed - 12) * 1.5)));
  const audioDone = Math.min(SCENES, Math.max(0, Math.floor((elapsed - 24) * 3)));
  const stepState = (done, started) => (done >= SCENES ? 'done' : started ? 'running' : 'pending');

  const steps = [
    { key: 'upload', status: 'done', pageCount: 5 },
    { key: 'scene_split', status: 'done', sceneCount: SCENES },
    { key: 'ocr', status: stepState(ocrDone, true), processed: ocrDone, total: SCENES },
    { key: 'narration', status: stepState(narrationDone, elapsed >= 12), processed: narrationDone, total: SCENES },
    { key: 'audio', status: stepState(audioDone, elapsed >= 24), processed: audioDone, total: SCENES },
  ];
  const progress = Math.min(100, Math.round(58 + ((ocrDone - 12) + narrationDone + audioDone) * (42 / (6 + SCENES * 2))));
  const completed = steps.every((step) => step.status === 'done');

  return {
    jobId,
    episode: { id: 'ep-12', number: 12, title: '빗속의 약속' },
    status: completed ? 'completed' : 'running',
    progress: completed ? 100 : progress,
    remainingSeconds: completed ? 0 : Math.max(30, Math.round(240 * (1 - elapsed / 30))),
    errorCount: 0,
    steps,
  };
}

// A4 제작 스튜디오
// 항목 type: narration(원문 나레이션) · description(화면해설) · dialogue(대사) · sfx(효과음)
// 항목 source: manuscript(원고 텍스트) · ai(AI 생성) · drawn(그려진 글자)
export const studio = {
  episode: { id: 'ep-12', number: 12, title: '빗속의 약속', workTitle: '별빛 아래 우리' },
  lastSavedAt: new Date(new Date().setHours(14, 32, 0, 0)).toISOString(),
  review: { reviewedCount: 3, problemCount: 2 },
  scenes: [
    { id: 'scene-1', number: 1, title: '골목 전경', status: 'done', issueCount: 0 },
    { id: 'scene-2', number: 2, title: '서윤 등장', status: 'review_required', issueCount: 2 },
    { id: 'scene-3', number: 3, title: '민호와 대화', status: 'voice_ready', issueCount: 1 },
    { id: 'scene-4', number: 4, title: '비가 내림', status: 'sfx_check', issueCount: 2 },
    { id: 'scene-5', number: 5, title: '문이 열림', status: 'done', issueCount: 0 },
    { id: 'scene-6', number: 6, title: '회상 장면', status: 'analyzing', issueCount: 0 },
  ],
  timeline: {
    durationSeconds: 34,
    // 마지막으로 멈춘 재생 위치(초)
    lastPlayheadSeconds: 7,
    tracks: [
      { type: 'narration', clips: [{ id: 'clip-1', itemId: 'item-1', label: '원문 1 · 비가 내리던 밤', start: 0.4, duration: 7 }] },
      { type: 'description', clips: [{ id: 'clip-2', itemId: 'item-2', label: '화면해설 1 · 서윤이 돌아봄', start: 3.7, duration: 6.7 }] },
      {
        type: 'dialogue',
        clips: [
          { id: 'clip-3', itemId: 'item-3', label: '서윤 · 민호야?', start: 10.6, duration: 5.1 },
          { id: 'clip-4', itemId: null, label: '민호 · 왜?', start: 16, duration: 4.3 },
        ],
      },
      {
        type: 'sfx',
        clips: [
          { id: 'clip-5', itemId: null, label: '빗소리 · 반복', start: 0.3, duration: 9.4 },
          { id: 'clip-6', itemId: 'item-4', label: '문 열림', start: 20.7, duration: 4.3 },
        ],
      },
    ],
  },
};

export const speakers = [
  { id: 'seoyun', name: '서윤' },
  { id: 'minho', name: '민호' },
];

const scene2 = {
  id: 'scene-2',
  number: 2,
  voice: { label: '동일 내레이터 · 차분함' },
  items: [
    { id: 'item-1', number: 1, type: 'narration', source: 'manuscript', playMode: 'separate', text: '비가 세차게 내리던 밤이었다.', start: 3, ttsStale: false },
    { id: 'item-2', number: 2, type: 'description', source: 'ai', playMode: 'separate', text: '서윤이 우산 없이 골목 끝을 바라본다.', start: 6, ttsStale: false },
    { id: 'item-3', number: 3, type: 'dialogue', source: 'manuscript', speakerId: 'seoyun', text: '민호야?', start: 9, ttsStale: true },
    { id: 'item-4', number: 4, type: 'sfx', source: 'drawn', text: '쾅!', sfx: { preset: '천둥(가까이)', volume: 70 }, start: 11, ttsStale: false },
  ],
  // 원고 미리보기의 컷과 OCR 감지 영역. items는 위 항목 id
  panels: [
    { caption: '텍스트·화면해설 감지 영역', items: ['item-1', 'item-2'] },
    { character: true, items: ['item-3'] },
    { caption: '효과음 감지 영역', items: ['item-4'] },
  ],
};

// 다른 장면은 아직 데이터가 적다는 가정의 간단한 목데이터
const simpleScene = (number, text) => ({
  id: `scene-${number}`,
  number,
  voice: { label: '동일 내레이터 · 차분함' },
  items: [{ id: `item-${number}-1`, number: 1, type: 'narration', source: 'manuscript', playMode: 'separate', text, start: 0, ttsStale: false }],
  panels: [{ caption: '텍스트·화면해설 감지 영역', items: [`item-${number}-1`] }],
});

export const scenes = {
  'scene-1': simpleScene(1, '골목에는 가로등 하나만 켜져 있었다.'),
  'scene-2': scene2,
  'scene-3': simpleScene(3, '민호가 천천히 고개를 들었다.'),
  'scene-4': simpleScene(4, '빗줄기가 점점 굵어졌다.'),
  'scene-5': simpleScene(5, '낡은 문이 삐걱 소리를 내며 열렸다.'),
  'scene-6': simpleScene(6, '그날의 기억이 떠올랐다.'),
};
