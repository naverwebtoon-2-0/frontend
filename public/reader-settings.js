// 감상 설정 폼 (Figma 33:940). 홈의 감상 설정 모달과 플레이어 옆 패널에서 같이 쓴다.
import { getSettings, saveSettings } from './reader-store.js';

const SPEEDS = [0.75, 1, 1.25, 1.5];
const VOLUMES = [
  ['narrationVolume', '원문 나레이션 볼륨'],
  ['descriptionVolume', '화면해설 볼륨'],
  ['dialogueVolume', '대사 볼륨'],
  ['sfxVolume', '효과음 볼륨'],
];
const TOGGLES = [
  ['autoNextScene', '자동 다음 장면'],
  ['autoNextEpisode', '자동 다음 화'],
  ['highContrast', '고대비 포커스 표시'],
];

const speedLabel = (v) => `${v === 1 ? '1.0' : v}×`;

/**
 * @param {HTMLElement} container
 * @param {(settings: object) => void} [onChange] 설정이 바뀔 때마다 호출
 */
export function renderSettings(container, onChange) {
  const s = getSettings();
  const uid = Math.random().toString(36).slice(2, 7);
  container.innerHTML = '';
  container.classList.add('reader-settings');

  const row = (labelText, control) => {
    const label = document.createElement('label');
    label.className = 'reader-settings__row';
    const span = document.createElement('span');
    span.textContent = labelText;
    label.append(span, control);
    return label;
  };

  const select = (name, options, value) => {
    const wrap = document.createElement('span');
    wrap.className = 'reader-select';
    const el = document.createElement('select');
    el.name = name;
    for (const [v, text] of options) el.append(new Option(text, String(v), false, String(v) === String(value)));
    wrap.append(el);
    return wrap;
  };

  container.append(
    row('재생 속도', select('playbackRate', SPEEDS.map((v) => [v, speedLabel(v)]), s.playbackRate)),
    row('내레이션 구성', select('narrationMode', [['separate', '구분 재생'], ['original', '원문만']], s.narrationMode)),
  );

  for (const [name, text] of VOLUMES) {
    const label = document.createElement('label');
    label.className = 'reader-settings__volume';
    const caption = document.createElement('span');
    const output = document.createElement('output');
    output.id = `${name}-${uid}`;
    output.textContent = `${s[name]}%`;
    caption.append(`${text} `, output);
    const range = document.createElement('input');
    Object.assign(range, { type: 'range', name, min: 0, max: 100, step: 5, value: s[name] });
    range.setAttribute('aria-describedby', output.id);
    label.append(caption, range);
    container.append(label);
  }

  const toggles = document.createElement('fieldset');
  toggles.className = 'reader-settings__toggles';
  const legend = document.createElement('legend');
  legend.className = 'visually-hidden';
  legend.textContent = '자동 재생과 표시';
  toggles.append(legend);
  for (const [name, text] of TOGGLES) {
    const label = document.createElement('label');
    const box = document.createElement('input');
    Object.assign(box, { type: 'checkbox', name, checked: s[name] });
    label.append(box, ` ${text}`);
    toggles.append(label);
  }
  container.append(toggles);

  container.addEventListener('input', (event) => {
    const el = event.target;
    if (!el.name) return;
    let value;
    if (el.type === 'checkbox') value = el.checked;
    else if (el.type === 'range') {
      value = Number(el.value);
      container.querySelector(`#${el.name}-${uid}`).textContent = `${value}%`;
    } else if (el.name === 'playbackRate') value = Number(el.value);
    else value = el.value;
    const next = saveSettings({ [el.name]: value });
    onChange?.(next, el.name);
  });
}
