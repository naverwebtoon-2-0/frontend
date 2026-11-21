// A2 원고 업로드: 초기값을 API에서 받고, 원고 선택·검증 후 AI 분석을 시작한다.
import { getLanguages, getUploadDraft, startEpisodeAnalysis } from './api.js';
import { renderHeader } from './common.js';

const MAX_BYTES = 20 * 1024 * 1024;
const ACCEPTED = new Set(['image/jpeg', 'image/png']);

const form = document.querySelector('#upload-form');
const zone = document.querySelector('#upload-zone');
const input = document.querySelector('#manuscript');
const list = document.querySelector('#thumbnails');
const error = document.querySelector('#upload-error');
const estimate = document.querySelector('#estimate');
const language = document.querySelector('#language');
const submit = form.querySelector('[type="submit"]');
const submitStatus = document.querySelector('#submit-status');

// 서버에 이미 있는 페이지({ id, name })와 새로 고른 파일({ file })을 순서대로 담는다.
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
  // 페이지당 약 1.2~1.6분 기준의 임시 계산. 명세가 정해지면 서버 추정치로 바꾼다.
  const count = Math.max(pages.length, 1);
  estimate.textContent = `약 ${Math.round(count * 1.2)}~${Math.round(count * 1.6)}분`;
}

function addFiles(files) {
  const rejected = [];
  for (const file of files) {
    if (!ACCEPTED.has(file.type)) rejected.push(`${file.name}: JPG·PNG만 올릴 수 있습니다.`);
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
  submitStatus.textContent = 'AI 분석을 요청하는 중입니다.';
  try {
    const result = await startEpisodeAnalysis({
      title: title.value.trim(),
      language: language.value,
      pageIds: pages.filter((page) => !page.file).map((page) => page.id),
      files: pages.filter((page) => page.file).map((page) => page.file),
    });
    submitStatus.textContent = 'AI 분석을 시작했습니다.';
    location.assign(`/processing?job=${encodeURIComponent(result.jobId)}`);
  } catch (err) {
    submitStatus.textContent = '';
    showError(err.message);
    submit.disabled = false;
  }
});

async function load() {
  try {
    const [draft, languages] = await Promise.all([getUploadDraft(), getLanguages()]);
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
