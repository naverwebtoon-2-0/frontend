// A2 원고 업로드: 초기값을 API에서 받고, 원고 선택·검증 후 업로드와 AI 분석을 시작한다.
// URL: /upload (작가의 첫 작품에 새 회차) · /upload?series=... · /upload?episode=... (기존 회차에 이어 올리기)
import { getLanguages, getUploadDraft, startEpisodeAnalysis } from './api.js';
import { renderHeader } from './common.js';

// 명세 §4.4 제한(초안): 파일당 20MB, PNG/JPEG/WebP, 회차당 최대 100장
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_PAGES = 100;
const ACCEPTED = new Set(['image/jpeg', 'image/png', 'image/webp']);

const params = new URLSearchParams(location.search);
const form = document.querySelector('#upload-form');
const zone = document.querySelector('#upload-zone');
const input = document.querySelector('#manuscript');
const list = document.querySelector('#thumbnails');
const error = document.querySelector('#upload-error');
const estimate = document.querySelector('#estimate');
const language = document.querySelector('#language');
const submit = form.querySelector('[type="submit"]');
const submitStatus = document.querySelector('#submit-status');

let draft = null;
// 서버에 이미 있는 이미지({ id, name })와 새로 고른 파일({ file })을 순서대로 담는다.
let pages = [];

function showError(message) {
  error.textContent = message;
  error.hidden = !message;
}

function render() {
  list.replaceChildren(
    ...pages.map((page, index) => {
      const item = document.createElement('li');
      item.className = 'thumbnail';
      item.textContent = `페이지 ${index + 1}`;
      item.title = page.file ? page.file.name : page.name;
      return item;
    }),
  );
  // 페이지당 약 1.2~1.6분 기준의 임시 계산. 서버 추정치가 생기면 바꾼다.
  const count = Math.max(pages.length, 1);
  estimate.textContent = `약 ${Math.round(count * 1.2)}~${Math.round(count * 1.6)}분`;
}

function addFiles(files) {
  const rejected = [];
  for (const file of files) {
    if (pages.length >= MAX_PAGES) {
      rejected.push(`회차당 최대 ${MAX_PAGES}장까지 올릴 수 있습니다.`);
      break;
    }
    if (!ACCEPTED.has(file.type)) rejected.push(`${file.name}: JPG·PNG·WebP만 올릴 수 있습니다.`);
    else if (file.size > MAX_BYTES) rejected.push(`${file.name}: 20MB를 넘습니다.`);
    else pages.push({ file });
  }
  showError(rejected.join(' '));
  render();
}

input.addEventListener('change', () => {
  addFiles(input.files);
  input.value = '';
});

for (const type of ['dragenter', 'dragover']) {
  zone.addEventListener(type, (event) => {
    event.preventDefault();
    zone.classList.add('upload-zone--dragover');
  });
}
for (const type of ['dragleave', 'drop']) {
  zone.addEventListener(type, (event) => {
    event.preventDefault();
    if (type === 'dragleave' && zone.contains(event.relatedTarget)) return;
    zone.classList.remove('upload-zone--dragover');
  });
}
zone.addEventListener('drop', (event) => addFiles(event.dataTransfer.files));

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const title = form.elements.title;
  if (!title.value.trim()) {
    title.focus();
    showError('회차 제목을 입력하세요.');
    return;
  }
  if (!pages.length) {
    showError('원고 이미지를 한 장 이상 올리세요.');
    return;
  }
  showError('');
  submit.disabled = true;
  const files = pages.filter((page) => page.file).map((page) => page.file);
  submitStatus.textContent = files.length ? `원고 ${files.length}장을 올리는 중입니다.` : 'AI 분석을 요청하는 중입니다.';
  try {
    const { jobId } = await startEpisodeAnalysis({
      seriesId: draft.seriesId,
      episodeId: draft.episodeId,
      title: title.value.trim(),
      language: language.value,
      files,
    });
    submitStatus.textContent = 'AI 분석을 시작했습니다.';
    location.assign(`/processing?job=${encodeURIComponent(jobId)}`);
  } catch (err) {
    submitStatus.textContent = '';
    showError(err.message);
    submit.disabled = false;
  }
});

async function load() {
  try {
    const [loaded, languages] = await Promise.all([
      getUploadDraft({ seriesId: params.get('series'), episodeId: params.get('episode') }),
      getLanguages(),
    ]);
    draft = loaded;
    form.elements.title.value = draft.title;
    language.replaceChildren(
      ...languages.map(({ code, label }) => new Option(label, code, false, code === draft.language)),
    );
    pages = draft.pages.map(({ id, name }) => ({ id, name }));
    render();
    submit.disabled = false;
  } catch {
    showError('업로드 정보를 불러오지 못했습니다. 새로고침해 주세요.');
  }
}

void renderHeader();
void load();
