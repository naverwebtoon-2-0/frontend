// A4 제작 스튜디오의 모달과 항목 메뉴
// - 텍스트 수정(대사 text) · 화면해설 수정(이미지 alt)
// - 음성 설정(인물 voice_id·속도)
// - 효과음 설정(sfx_tag·volume)
// - 일괄 재생성 확인(stale 대사)
// - ⋯ 메뉴(음성 설정 · 원문으로 되돌리기). TTS 재생성은 수정된 대사 카드의 버튼으로만 한다.
import {
  createCharacter,
  createDialogueLine,
  regenerateLine,
  regenerateStale,
  updateCharacterName,
  updateCharacterVoice,
  updateImageDescription,
  updateLine,
  updateSfxCue,
} from './api.js';
import { fillSlots, formatDuration } from './common.js';

const SECONDS_PER_ITEM = 5; // 일괄 재생성 예상 시간(항목당). 서버 추정치가 생기면 바꾼다.

/**
 * @param {{
 *   state: object, episodeId: string,
 *   reload: () => Promise<void>, toast: (message: string) => void,
 *   sceneName: (n: number) => string, itemLabel: (item: object) => string,
 * }} ctx
 */
export function setupModals(ctx) {
  const { state, episodeId, reload, toast, sceneName, itemLabel } = ctx;
  const $ = (selector, root = document) => root.querySelector(selector);

  /** 저장 중 버튼을 막고, 실패하면 모달 안에 오류를 보인다. 성공하면 닫고 다시 불러온다. */
  function bindSubmit(dialog, handler) {
    const form = $('form', dialog);
    const submit = $('[type="submit"]', form);
    const error = $('.modal__error', form);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      error.hidden = true;
      submit.disabled = true;
      try {
        const message = await handler(form);
        if (message === false) return;
        dialog.close();
        await reload();
        if (message) toast(message);
      } catch (err) {
        error.textContent = err.message || '저장하지 못했습니다.';
        error.hidden = false;
      } finally {
        submit.disabled = false;
      }
    });
    for (const close of dialog.querySelectorAll('[data-close]')) close.addEventListener('click', () => dialog.close());
    // 바깥(배경)을 누르면 닫는다.
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
  }

  function open(dialog, focusSelector) {
    $('.modal__error', dialog).hidden = true;
    dialog.showModal();
    if (focusSelector) $(focusSelector, dialog)?.focus();
  }

  const subtitle = (item) => `${sceneName(state.scene.number)} · ${itemLabel(item)}`;

  // ── 말풍선 텍스트 수동 추가 ──────────────────────────

  const dialogueModal = $('#dialogue-modal');
  bindSubmit(dialogueModal, async (form) => {
    const characterName = form.elements.character.value.trim();
    const text = form.elements.dialogue.value.trim();
    if (!characterName) throw new Error('화자 이름을 입력해주세요.');
    if (!text) throw new Error('말풍선 텍스트를 입력해주세요.');
    const speakers = state.studio.characters.filter((character) => character.kind !== 'narration');
    const existing = speakers.find((speaker) => speaker.name.localeCompare(characterName, 'ko', { sensitivity: 'base' }) === 0);
    const character = existing ?? await createCharacter(state.studio.episode.seriesId, characterName);
    await createDialogueLine(episodeId, {
      imageId: state.sceneId,
      text,
      characterId: character.id,
    });
    return '말풍선 대사를 추가했습니다. 음성을 생성해주세요.';
  });

  function openDialogue() {
    const speakers = state.studio?.characters.filter((character) => character.kind !== 'narration') ?? [];
    if (!state.sceneId) {
      toast('먼저 장면을 선택해주세요.');
      return;
    }
    fillSlots(dialogueModal, { 'dialogue-modal-sub': `${sceneName(state.scene.number)}에 새 대사를 추가합니다.` });
    const options = dialogueModal.querySelector('#dialogue-character-options');
    options.replaceChildren(...speakers.map((speaker) => Object.assign(document.createElement('option'), { value: speaker.name })));
    dialogueModal.querySelector('[name="character"]').value = '';
    dialogueModal.querySelector('[name="dialogue"]').value = '';
    open(dialogueModal, '[name="character"]');
  }

  // ── 인물 이름 일괄 관리 ───────────────────────────────

  const speakerModal = $('#speaker-modal');
  const speakerNameList = $('#speaker-name-list');
  bindSubmit(speakerModal, async () => {
    const inputs = [...speakerNameList.querySelectorAll('input[data-character-id]')];
    const names = inputs.map((input) => input.value.trim());
    if (names.some((name) => !name)) throw new Error('모든 인물의 이름을 입력해주세요.');
    if (new Set(names).size !== names.length) throw new Error('인물 이름은 서로 다르게 입력해주세요.');

    const updates = inputs
      .map((input) => ({
        id: input.dataset.characterId,
        name: input.value.trim(),
        previousName: input.dataset.previousName,
      }))
      .filter((character) => character.name !== character.previousName);
    if (!updates.length) return '';
    await Promise.all(updates.map((character) => updateCharacterName(character.id, character.name)));
    return `${updates.length}명의 인물 이름을 저장했습니다.`;
  });

  function openSpeakerNames() {
    const speakers = state.studio.characters.filter((character) => character.kind !== 'narration');
    if (!speakers.length) {
      toast('수정할 인물이 없습니다.');
      return;
    }
    speakerNameList.replaceChildren(...speakers.map((character, index) => {
      const field = document.createElement('label');
      field.className = 'speaker-name-field';
      const label = document.createElement('span');
      label.className = 'speaker-name-field__label';
      label.textContent = `인물 ${index + 1}`;
      const input = document.createElement('input');
      input.className = 'speaker-name-field__input';
      input.type = 'text';
      input.maxLength = 100;
      input.required = true;
      input.value = character.name;
      input.dataset.characterId = character.id;
      input.dataset.previousName = character.name;
      input.setAttribute('aria-label', `인물 ${index + 1} 이름`);
      field.append(label, input);
      if (character.autoNamed) {
        const status = document.createElement('span');
        status.className = 'speaker-name-field__status';
        status.textContent = '자동 지정';
        field.append(status);
      }
      return field;
    }));
    open(speakerModal, 'input');
  }

  // ── 텍스트 수정 · 화면해설 수정 ─────────────────────────

  const textModal = $('#text-modal');
  let textTarget = null;
  bindSubmit(textModal, async (form) => {
    const text = form.elements.text.value.trim();
    if (!text) throw new Error('내용을 입력하세요.');
    if (text === textTarget.text) return '';
    if (textTarget.editable === 'alt') {
      await updateImageDescription(episodeId, state.sceneId, text);
      return '화면해설을 저장했습니다.';
    }
    await updateLine(textTarget.id, { text });
    return '저장했습니다. 음성을 다시 만들어야 합니다.';
  });

  function openText(item) {
    textTarget = item;
    const isAlt = item.editable === 'alt';
    fillSlots(textModal, {
      'text-modal-title': isAlt ? '화면해설 수정' : '텍스트 수정',
      'text-modal-sub': subtitle(item),
      'text-modal-label': isAlt ? '이미지 설명' : '원고 텍스트',
      'text-modal-note': isAlt
        ? '스크린 리더와 자막에 쓰이는 설명입니다.'
        : '저장 후 음성은 필요한 경우에만 생성할 수 있습니다.',
    });
    textModal.querySelector('textarea').value = item.text;
    open(textModal, 'textarea');
  }

  // ── 음성 설정 ─────────────────────────────────────────

  const voiceModal = $('#voice-modal');
  let voiceTarget = null;
  bindSubmit(voiceModal, async (form) => {
    const voiceId = form.elements.voice.value;
    const speed = Number(form.elements.speed.value);
    if (voiceId === voiceTarget.voiceId && speed === voiceTarget.speed) return '';
    await updateCharacterVoice(voiceTarget.id, { voiceId, speed });
    return `${voiceTarget.name} 음성을 바꿨습니다. 해당 대사를 다시 생성해야 합니다.`;
  });

  /** 선택한 항목의 인물(대사는 화자, 그 밖에는 나레이터) 음성을 편집한다. */
  function openVoice(item) {
    const characters = state.studio.characters;
    const character = characters.find((c) => c.id === item?.characterId)
      ?? characters.find((c) => c.kind === 'narration');
    if (!character) {
      toast('음성을 바꿀 인물이 없습니다.');
      return;
    }
    voiceTarget = character;
    const isNarrator = character.kind === 'narration';
    fillSlots(voiceModal, {
      'voice-modal-sub': `${sceneName(state.scene.number)} · ${isNarrator ? '나레이션' : `${character.name} 대사`}`,
      'voice-modal-label': isNarrator ? '나레이터' : '화자',
      'voice-preview': item?.durationMs ? `미리 듣기 (${formatDuration(item.durationMs / 1000)})` : '미리 듣기',
      'voice-current': '현재 음성',
    });
    const select = voiceModal.querySelector('[name="voice"]');
    select.replaceChildren(...state.studio.voices.map((v) => new Option(`${character.name} · ${v.name}`, v.id, false, v.id === character.voiceId)));
    for (const radio of voiceModal.querySelectorAll('[name="speed"]')) radio.checked = Number(radio.value) === character.speed;
    open(voiceModal, 'select');
  }

  // 선택을 바꾸면 "현재 음성" 표시를 지운다.
  voiceModal.addEventListener('change', () => fillSlots(voiceModal, { 'voice-current': '변경됨 · 적용 전' }));

  // ── 효과음 설정 ───────────────────────────────────────

  const sfxModal = $('#sfx-modal');
  let sfxTarget = null;
  const volumeInput = sfxModal.querySelector('[name="volume"]');
  const showVolume = () => fillSlots(sfxModal, { 'sfx-volume': `볼륨 ${volumeInput.value}%` });
  volumeInput.addEventListener('input', showVolume);
  bindSubmit(sfxModal, async (form) => {
    const tag = form.elements.preset.value;
    const volume = Number(form.elements.volume.value);
    if (tag === sfxTarget.sfx.tag && volume === sfxTarget.sfx.volume) return '';
    await updateSfxCue(sfxTarget.id, { tag, volume });
    return '효과음을 바꿨습니다.';
  });

  function openSfx(item, { focusVolume = false } = {}) {
    sfxTarget = item;
    fillSlots(sfxModal, { 'sfx-modal-sub': `${sceneName(state.scene.number)} · ${item.number}번 효과음` });
    const select = sfxModal.querySelector('[name="preset"]');
    select.replaceChildren(...state.studio.presets.map((p) => new Option(p.name, p.tag, false, p.tag === item.sfx.tag)));
    volumeInput.value = item.sfx.volume;
    showVolume();
    open(sfxModal, focusVolume ? '[name="volume"]' : 'select');
  }

  // 미리 듣기: 샘플 음원(sample_url)이 아직 없다.
  for (const button of document.querySelectorAll('[data-preview]')) {
    button.addEventListener('click', () => toast('미리 듣기 음원이 아직 없습니다. 음원 URL이 오면 재생합니다.'));
  }

  // ── 일괄 재생성 ───────────────────────────────────────

  const batchModal = $('#batch-modal');
  const batchButton = $('#batch-regenerate');
  let regenerating = false;

  /** 회차 전체의 재생성 대상(stale 대사) */
  function staleItems() {
    return state.studio.scenes.flatMap((scene) => state.studio.sceneDetails[scene.id].items
      .filter((item) => item.ttsStale)
      .map((item) => ({ scene, item })));
  }

  bindSubmit(batchModal, async () => {
    const count = staleItems().length;
    regenerating = true;
    batchButton.disabled = true;
    batchButton.classList.add('stale-button--busy');
    batchModal.close();
    try {
      await regenerateStale(episodeId, (progress) => {
        if (progress) fillSlots(document, { 'stale-label': `음성 생성 중 (${progress.done}/${progress.total})` });
      });
    } finally {
      regenerating = false;
      batchButton.disabled = false;
      batchButton.classList.remove('stale-button--busy');
    }
    return `${count}개 항목의 음성을 새로 만들었습니다.`;
  });

  function openBatch() {
    if (regenerating) return;
    const targets = staleItems();
    if (!targets.length) {
      toast('다시 만들 항목이 없습니다.');
      return;
    }
    $('#batch-list').replaceChildren(...targets.map(({ scene, item }) => {
      const li = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = `${sceneName(scene.number)} · ${itemLabel(item)} ${item.number}`;
      const kind = document.createElement('span');
      kind.textContent = '음성';
      li.append(label, kind);
      return li;
    }));
    fillSlots(batchModal, {
      'batch-estimate': `예상 소요 시간 · 약 ${targets.length * SECONDS_PER_ITEM}초`,
      'batch-submit': `${targets.length}개 생성하기`,
    });
    open(batchModal, '[type="submit"]');
  }

  // ── TTS 재생성 · ⋯ 메뉴 ─────────────────────────────────

  async function regenerate(item, trigger) {
    if (trigger) trigger.disabled = true;
    try {
      await regenerateLine(item.id);
      await reload();
      toast('음성을 새로 만들었습니다.');
    } catch (err) {
      toast(err.message || '음성을 다시 만들지 못했습니다.');
      if (trigger) trigger.disabled = false;
    }
  }

  const menu = $('#item-menu');
  let menuTarget = null;
  let menuTrigger = null;

  function closeMenu({ restoreFocus = false } = {}) {
    if (menu.hidden) return;
    menu.hidden = true;
    menuTrigger?.setAttribute('aria-expanded', 'false');
    if (restoreFocus) menuTrigger?.focus();
  }

  function openMenu(item, trigger) {
    if (!menu.hidden && menuTarget === item) {
      closeMenu();
      return;
    }
    menuTarget = item;
    menuTrigger = trigger;
    const revert = menu.querySelector('[data-menu="revert"]');
    const canRevert = Boolean(item.originalText) && item.originalText !== item.text;
    revert.disabled = !canRevert;
    fillSlots(menu, { 'menu-original': item.originalText ? `OCR 원본 · “${item.originalText}”` : 'OCR 원본 정보 없음' });

    // 음성 설정: 대사는 화자, 나레이션은 나레이터. 효과음 글자처럼 인물이 없으면 막는다.
    const character = state.studio.characters.find((c) => c.id === item.characterId);
    menu.querySelector('[data-menu="voice"]').disabled = !character;
    fillSlots(menu, { 'menu-voice': character ? `${character.name} · ${character.voiceName}` : '음성을 쓰는 인물이 없습니다' });

    menu.hidden = false;
    const rect = trigger.getBoundingClientRect();
    const width = menu.offsetWidth;
    menu.style.top = `${Math.min(rect.bottom + 4, innerHeight - menu.offsetHeight - 8)}px`;
    menu.style.left = `${Math.max(8, Math.min(rect.right - width, innerWidth - width - 8))}px`;
    trigger.setAttribute('aria-expanded', 'true');
    menu.querySelector('button:not(:disabled)')?.focus();
  }

  menu.addEventListener('click', async (event) => {
    const action = event.target.closest('[data-menu]')?.dataset.menu;
    if (!action) return;
    const item = menuTarget;
    closeMenu();
    if (action === 'voice') {
      openVoice(item);
    } else if (action === 'revert') {
      try {
        await updateLine(item.id, { text: item.originalText });
        await reload();
        toast('OCR 원문으로 되돌렸습니다. 음성을 다시 만들어야 합니다.');
      } catch (err) {
        toast(err.message || '되돌리지 못했습니다.');
      }
    }
  });

  document.addEventListener('click', (event) => {
    if (!menu.hidden && !menu.contains(event.target) && event.target !== menuTrigger) closeMenu();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMenu({ restoreFocus: true });
  });
  document.addEventListener('scroll', () => closeMenu(), true);

  return { openDialogue, openSpeakerNames, openText, openVoice, openSfx, openBatch, openMenu, regenerate, staleItems };
}
