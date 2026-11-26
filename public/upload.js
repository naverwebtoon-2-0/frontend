// A2 원고 업로드: 초기값을 API에서 받고, 원고 선택·검증 후 업로드와 AI 분석을 시작한다.
// URL: /upload (작가의 첫 작품에 새 회차) · /upload?series=... · /upload?episode=... (기존 회차에 이어 올리기)
import { createSeries, getAuthorSeries, getLanguages, getUploadDraft, startEpisodeAnalysis } from './api.js';
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
const existingMode = document.querySelector('#series-mode-existing');
const newMode = document.querySelector('#series-mode-new');
const existingSeriesFields = document.querySelector('#existing-series-fields');
const newSeriesFields = document.querySelector('#new-series-fields');
const seriesSelect = document.querySelector('#series-select');
const newSeriesTitle = document.querySelector('#new-series-title');
const newSeriesGenre = document.querySelector('#new-series-genre');
const newSeriesDescription = document.querySelector('#new-series-description');
const seriesStatus = document.querySelector('#series-status');
const seriesError = document.querySelector('#series-error');

let draft = null;
let seriesItems = [];
const editingEpisode = Boolean(params.get('episode'));
// 서버에 이미 있는 이미지({ id, name })와 새로 고른 파일({ file })을 순서대로 담는다.
let pages = [];

function showError(message) {
  error.textContent = message;
  error.hidden = !message;
}

function showSeriesError(message) {
  seriesError.textContent = message;
  seriesError.hidden = !message;
}

function selectedSeriesMode() {
  return newMode.checked ? 'new' : 'existing';
}

function setSeriesMode(mode) {
  const isNew = mode === 'new';
  existingMode.checked = !isNew;
  newMode.checked = isNew;
  existingSeriesFields.hidden = isNew;
  newSeriesFields.hidden = !isNew;
  seriesSelect.disabled = isNew || editingEpisode;
  for (const field of newSeriesFields.querySelectorAll('input, select, textarea')) field.disabled = !isNew;
  existingMode.disabled = !seriesItems.length && !editingEpisode;
  newMode.disabled = editingEpisode;
}

function renderSeriesOptions(selectedId) {
  seriesSelect.replaceChildren(
    ...seriesItems.map((series) => new Option(series.title, series.id, false, series.id === selectedId)),
  );
}

async function loadExistingSeries(seriesId, { updateTitle = true } = {}) {
  submit.disabled = true;
  showSeriesError('');
  seriesStatus.textContent = '작품 정보를 불러오는 중입니다.';
  try {
    draft = await getUploadDraft({ seriesId });
    seriesSelect.value = draft.seriesId;
    if (updateTitle) form.elements.title.value = draft.title;
    if ([...language.options].some((option) => option.value === draft.language)) language.value = draft.language;
    seriesStatus.textContent = '선택한 작품에 새 회차를 추가합니다.';
  } catch (err) {
    draft = null;
    showSeriesError(err.message || '작품 정보를 불러오지 못했습니다.');
    seriesStatus.textContent = '';
  } finally {
    submit.disabled = !draft;
  }
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
  const mode = selectedSeriesMode();
  if (mode === 'existing' && !draft?.seriesId) {
    seriesSelect.focus();
    showSeriesError('업로드할 작품을 선택해주세요.');
    return;
  }
  if (mode === 'new' && !newSeriesTitle.value.trim()) {
    newSeriesTitle.focus();
    showSeriesError('새 작품명을 입력해주세요.');
    return;
  }
  if (mode === 'new' && !newSeriesGenre.value) {
    newSeriesGenre.focus();
    showSeriesError('새 작품의 대표 장르를 선택해주세요.');
    return;
  }
  if (!title.value.trim()) {
    title.focus();
    showError('회차 제목을 입력하세요.');
    return;
  }
  if (!pages.length) {
    showError('원고 이미지를 한 장 이상 올리세요.');
    return;
  }
  showSeriesError('');
  showError('');
  submit.disabled = true;
  const files = pages.filter((page) => page.file).map((page) => page.file);
  try {
    if (mode === 'new') {
      submitStatus.textContent = '새 작품을 만드는 중입니다.';
      const created = await createSeries({
        title: newSeriesTitle.value.trim(),
        genre: newSeriesGenre.value,
        description: newSeriesDescription.value.trim(),
        language: language.value,
      });
      seriesItems.unshift(created);
      draft = { seriesId: created.id, episodeId: null, title: title.value.trim(), language: language.value, pages: [] };
      renderSeriesOptions(created.id);
      setSeriesMode('existing');
      seriesStatus.textContent = `‘${created.title}’ 작품을 만들었습니다. 원고 업로드를 계속합니다.`;
    }
    submitStatus.textContent = files.length ? `원고 ${files.length}장을 올리는 중입니다.` : 'AI 분석을 요청하는 중입니다.';
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
    if (!draft?.seriesId) showSeriesError(err.message);
    else showError(err.message);
    submit.disabled = false;
  }
});

existingMode.addEventListener('change', () => {
  if (!existingMode.checked) return;
  setSeriesMode('existing');
  if (seriesSelect.value) void loadExistingSeries(seriesSelect.value);
});

newMode.addEventListener('change', () => {
  if (!newMode.checked) return;
  setSeriesMode('new');
  draft = null;
  form.elements.title.value = '1화';
  language.value = 'ko';
  seriesStatus.textContent = 'AI 분석 시작을 누르면 새 작품과 첫 회차가 함께 생성됩니다.';
  showSeriesError('');
  submit.disabled = false;
  newSeriesTitle.focus();
});

seriesSelect.addEventListener('change', () => {
  if (seriesSelect.value) void loadExistingSeries(seriesSelect.value);
});

async function load() {
  try {
    const [series, languages] = await Promise.all([getAuthorSeries(), getLanguages()]);
    seriesItems = series;
    language.replaceChildren(
      ...languages.map(({ code, label }) => new Option(label, code, false, code === 'ko')),
    );

    if (editingEpisode) {
      draft = await getUploadDraft({ episodeId: params.get('episode') });
      renderSeriesOptions(draft.seriesId);
      setSeriesMode('existing');
      form.elements.title.value = draft.title;
      language.value = draft.language;
      pages = draft.pages.map(({ id, name }) => ({ id, name }));
      seriesStatus.textContent = '기존 회차를 이어서 작업하므로 작품을 변경할 수 없습니다.';
    } else if (seriesItems.length) {
      const requestedId = params.get('series');
      const selectedId = seriesItems.some((item) => item.id === requestedId) ? requestedId : seriesItems[0].id;
      renderSeriesOptions(selectedId);
      setSeriesMode('existing');
      await loadExistingSeries(selectedId);
    } else {
      renderSeriesOptions(null);
      setSeriesMode('new');
      form.elements.title.value = '1화';
      seriesStatus.textContent = '등록된 작품이 없습니다. 새 작품 정보를 입력해주세요.';
      newSeriesTitle.focus();
    }
    render();
    submit.disabled = editingEpisode ? false : selectedSeriesMode() === 'existing' && !draft;
  } catch {
    showError('업로드 정보를 불러오지 못했습니다. 새로고침해 주세요.');
  }
}

void renderHeader();
void load();
