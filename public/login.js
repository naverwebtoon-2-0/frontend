import { apiErrorMessage, getMe, isMockMode, loginAuthor } from './api.js';

const form = document.querySelector('#login-form');
const error = document.querySelector('#login-error');
const mock = document.querySelector('#mock-login');
const params = new URLSearchParams(location.search);
const requestedNext = params.get('next');
const next = requestedNext?.startsWith('/') && !requestedNext.startsWith('//') ? requestedNext : '/dashboard';

document.querySelector('#mock-continue').href = next;

async function init() {
  if (isMockMode()) {
    form.hidden = true;
    mock.hidden = false;
    return;
  }
  try {
    const me = await getMe();
    if (me.role === 'author') location.replace(next);
  } catch {
    // 로그인되지 않은 상태가 이 화면의 기본 상태다.
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  error.hidden = true;
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  submit.textContent = '로그인 중…';
  try {
    await loginAuthor({ email: form.elements.email.value.trim(), password: form.elements.password.value });
    location.replace(next);
  } catch (caught) {
    error.textContent = apiErrorMessage(caught, '로그인하지 못했습니다.');
    error.hidden = false;
    submit.disabled = false;
    submit.textContent = '로그인';
    form.elements.email.focus();
  }
});

void init();
