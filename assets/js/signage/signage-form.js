/**
 * signage-form.js
 * 사인물 / 명판 제작 신청 폼 컨트롤러
 */

const NAMEPLATE_SIZES = {
  A: '높이 5cm (20cm / 16cm)',
  B: '높이 4cm (20cm / 18cm)',
  C: '높이 3cm (20cm / 18cm)',
  D: '높이 2.5cm (20cm)'
};

const MAX_SINGLE_FILE_MB = 10;
const MAX_TOTAL_FILE_MB  = 20;
const MAX_SINGLE_BYTES   = MAX_SINGLE_FILE_MB * 1024 * 1024;
const MAX_TOTAL_BYTES    = MAX_TOTAL_FILE_MB  * 1024 * 1024;

const uploadedFileIds   = { main: [], location: [], reference: [] };
const uploadedFileSizes = { main: [], location: [], reference: [] };
let pendingUploads = 0;
let isSubmitting = false;

// ─────────────────────────────────────────────
// 초기화
// ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // 스피너는 HTML 인라인 스크립트에서 이미 표시 중

  const user = window.auth?.requireAuth?.();
  if (!user) {
    hideGlobalLoading();
    return;
  }

  try {
    await window.orgSelect.loadOrgData();
    prefillUserInfo(user);

    bindTypeSelector();
    bindUrgentToggle();
    bindFileDropzones();
    bindNameplateTypeSelector();

    if (typeof NAMEPLATE_IMAGES !== 'undefined') {
      const el = document.getElementById('layoutImg');
      if (el) el.src = NAMEPLATE_IMAGES.layout || '';
    }

    document.getElementById('signageForm').addEventListener('submit', handleSubmit);
  } catch (err) {
    showMessage(err.message || '초기화 중 오류가 발생했습니다.', 'error');
  } finally {
    hideGlobalLoading();
  }
});

// ─────────────────────────────────────────────
// 로그인 유저 정보 자동 입력
// ─────────────────────────────────────────────
function prefillUserInfo(user) {
  setVal('clinic_code', user.clinic_code || '');
  setVal('team_code',   user.team_code   || '');

  const clinics = window.orgSelect.getClinics();
  const teams   = window.orgSelect.getTeams();

  const clinicName = resolveOrgName(user.clinic_name, user.clinic_code, clinics);
  const teamName   = resolveOrgName(user.team_name,   user.team_code,   teams);

  setVal('clinic_name_display', clinicName);
  setVal('team_name_display',   teamName);
  setVal('requester_name', user.name      || user.user_name  || '');
  setVal('contact',        user.phone     || '');
}

function resolveOrgName(sessionName, code, list) {
  if (sessionName && String(sessionName).trim()) return String(sessionName).trim();
  if (!code || !Array.isArray(list) || !list.length) return '';
  const found = list.find(item =>
    String(item.code_value || '').trim() === String(code || '').trim()
  );
  return found ? String(found.code_name || '').trim() : '';
}

// ─────────────────────────────────────────────
// 제작 종류 선택
// ─────────────────────────────────────────────
function bindTypeSelector() {
  document.querySelectorAll('input[name="type"]').forEach(radio => {
    radio.addEventListener('change', handleTypeChange);
  });
}

function handleTypeChange(e) {
  const type = e.target.value;

  document.querySelectorAll('.signage-type-card').forEach(c => c.classList.remove('is-selected'));
  document.getElementById('typeCard_' + type)?.classList.add('is-selected');

  showEl('sectionCommon');
  showEl('formActions');

  if (type === 'SIGN') {
    showEl('sectionSign');
    hideEl('sectionNameplate');
    setRequired('sign_size', true);
    setRequired('sign_type', true);
    setRequired('install_env', true);
    setRequired('install_location', true);
    setRequired('install_env_nameplate', false);
    setRequired('nameplate_text', false);
  } else {
    hideEl('sectionSign');
    showEl('sectionNameplate');
    setRequired('sign_size', false);
    setRequired('sign_type', false);
    setRequired('install_env', false);
    setRequired('install_location', false);
    setRequired('install_env_nameplate', true);
    setRequired('nameplate_text', true);
  }

  setTimeout(() => {
    document.getElementById('sectionCommon')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 80);
}

// ─────────────────────────────────────────────
// 긴급 여부 토글
// ─────────────────────────────────────────────
function bindUrgentToggle() {
  document.getElementById('is_urgent')?.addEventListener('change', function () {
    const isUrgent = this.value === 'Y';
    const field = document.getElementById('urgentReasonField');
    if (field) field.style.display = isUrgent ? '' : 'none';
    setRequired('urgent_reason', isUrgent);
  });
}

// ─────────────────────────────────────────────
// 명판 타입 선택 → 디자인 이미지 표시
// ─────────────────────────────────────────────
function bindNameplateTypeSelector() {
  document.querySelectorAll('input[name="nameplate_type"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      const type = e.target.value;

      document.querySelectorAll('.signage-np-card').forEach(c => c.classList.remove('is-selected'));
      document.getElementById('npCard_' + type)?.classList.add('is-selected');

      if (typeof NAMEPLATE_IMAGES !== 'undefined') {
        const designImg = document.getElementById('nameplateDesignImg');
        if (designImg) designImg.src = NAMEPLATE_IMAGES[type] || '';
      }

      const sizeText = document.getElementById('selectedSizeText');
      if (sizeText) {
        sizeText.textContent = type + ' 타입 — ' + (NAMEPLATE_SIZES[type] || '');
        sizeText.style.display = '';
      }

      const placeholder = document.getElementById('npDesignPlaceholder');
      const designImg = document.getElementById('nameplateDesignImg');
      if (placeholder) placeholder.style.display = 'none';
      if (designImg) designImg.style.display = '';
    });
  });
}

// ─────────────────────────────────────────────
// 드래그 앤 드롭
// ─────────────────────────────────────────────
function bindFileDropzones() {
  bindDrop('file_main',      'main',      'fileList_main');
  bindDrop('file_location',  'location',  'fileList_location');
  bindDrop('file_reference', 'reference', 'fileList_reference');
}

function bindDrop(inputId, key, listId) {
  const input = document.getElementById(inputId);
  if (!input) return;

  input.addEventListener('change', e => {
    const files = Array.from(e.target.files);
    if (files.length > 0) {
      const fileNameKey = inputId.replace('file_', '');
      const fileNameEl = document.getElementById('fileName_' + fileNameKey);
      if (fileNameEl) {
        fileNameEl.textContent = files.length === 1
          ? files[0].name
          : files.length + '개 파일 선택됨';
      }
    }
    processFiles(files, key, listId);
    input.value = '';
  });
}

// ─────────────────────────────────────────────
// 전체 업로드 용량 합산
// ─────────────────────────────────────────────
function getTotalUploadedBytes() {
  return [
    ...uploadedFileSizes.main,
    ...uploadedFileSizes.location,
    ...uploadedFileSizes.reference
  ].reduce((acc, size) => acc + size, 0);
}

function formatFileSize(bytes) {
  if (bytes < 1024)         return bytes + ' B';
  if (bytes < 1024 * 1024)  return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ─────────────────────────────────────────────
// 이미지 파일 여부 판별
// ─────────────────────────────────────────────
function isImageFile(file) {
  return file.type.startsWith('image/');
}

// ─────────────────────────────────────────────
// 파일 처리 + 업로드
// ─────────────────────────────────────────────
async function processFiles(files, key, listId) {
  const user      = window.auth?.getSession?.() || {};
  const createdBy = user.user_email || user.email || '';

  for (const file of files) {
    // 개별 파일 용량 체크
    if (file.size > MAX_SINGLE_BYTES) {
      showMessage(
        `파일 용량 초과: "${file.name}" (${formatFileSize(file.size)}) — 개별 파일은 ${MAX_SINGLE_FILE_MB}MB 이하만 가능합니다.`,
        'error'
      );
      continue;
    }

    // 전체 합산 용량 체크
    const currentTotal = getTotalUploadedBytes();
    if (currentTotal + file.size > MAX_TOTAL_BYTES) {
      showMessage(
        `전체 첨부 용량 초과 — 현재 ${formatFileSize(currentTotal)}, 추가 시 ${formatFileSize(currentTotal + file.size)} (최대 ${MAX_TOTAL_FILE_MB}MB)`,
        'error'
      );
      continue;
    }

    pendingUploads++;
    const itemId = 'fi_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const listEl = document.getElementById(listId);

    // ── 썸네일 또는 파일 아이콘 결정 ──
    const isImg = isImageFile(file);
    const thumbHtml = isImg
      ? `<img class="signage-file-thumb" id="thumb_${itemId}" src="" alt="" />`
      : `<span class="signage-file-item-icon">${getFileIcon(file.name)}</span>`;

    if (listEl) {
      listEl.insertAdjacentHTML('beforeend',
        `<div class="signage-file-item ${isImg ? 'has-thumb' : ''} is-uploading" id="${itemId}">
          ${thumbHtml}
          <span class="signage-file-item-name">${escapeHtml(file.name)}</span>
          <span class="signage-file-item-status">업로드 중...</span>
        </div>`
      );

      // 이미지면 FileReader로 썸네일 즉시 표시
      if (isImg) {
        const thumbEl = document.getElementById('thumb_' + itemId);
        if (thumbEl) {
          const reader = new FileReader();
          reader.onload = (ev) => { thumbEl.src = ev.target.result; };
          reader.readAsDataURL(file);
        }
      }
    }

    // 첫 파일 추가 시 빈 상태 텍스트 숨기고 has-files 클래스 부여
    const previewEl = listEl?.closest('.signage-file-preview');
    const emptyEl   = document.getElementById('previewEmpty_' + key);
    if (emptyEl)   emptyEl.style.display = 'none';
    if (previewEl) previewEl.classList.add('has-files');

    try {
      const base64 = await toBase64(file);
      const res    = await apiPost('uploadSignageFile', {
        file_base64: base64,
        file_name:   file.name,
        created_by:  createdBy
      });

      uploadedFileIds[key].push(res.data.file_id);
      uploadedFileSizes[key].push(file.size);

      const el = document.getElementById(itemId);
      if (el) {
        el.classList.replace('is-uploading', 'is-done');
        el.querySelector('.signage-file-item-status').textContent =
          `✓ 완료 (${formatFileSize(file.size)})`;
      }
    } catch (err) {
      const el = document.getElementById(itemId);
      if (el) {
        el.classList.replace('is-uploading', 'is-error');
        el.querySelector('.signage-file-item-status').textContent = '✗ 실패';
      }
      showMessage('업로드 실패: ' + file.name, 'error');
    } finally {
      pendingUploads--;
    }
  }
}

// 확장자 기반 파일 아이콘 이모지
function getFileIcon(name) {
  const ext = name.split('.').pop().toLowerCase();
  const map = { pdf: '📄', ai: '🎨', psd: '🎨', dwg: '📐' };
  return map[ext] || '📎';
}

function toBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ─────────────────────────────────────────────
// 폼 제출
// ─────────────────────────────────────────────
async function handleSubmit(e) {
  e.preventDefault();
  clearMessage();

  if (isSubmitting) return;
  if (pendingUploads > 0) {
    showMessage('파일 업로드가 진행 중입니다. 완료 후 다시 시도해 주세요.', 'error');
    return;
  }

  const totalBytes = getTotalUploadedBytes();
  if (totalBytes > MAX_TOTAL_BYTES) {
    showMessage(
      `전체 첨부 용량(${formatFileSize(totalBytes)})이 최대 ${MAX_TOTAL_FILE_MB}MB를 초과했습니다.`,
      'error'
    );
    return;
  }

  const payload = buildPayload();
  if (!payload) return;
  if (!validatePayload(payload)) return;

  const submitBtn = document.getElementById('submitBtn');

  try {
    isSubmitting = true;
    setLoading(submitBtn, true, '신청 중...');
    showGlobalLoading('사인물 신청을 처리하는 중...');

    await apiPost('createSignageRequest', payload);

    // 성공: 스피너 유지한 채로 페이지 이동
    alert('신청이 완료되었습니다.\n담당자(gcjwchoi3@gccorp.com)에게 알림이 전송되었습니다.');
    location.href = '../../portal.html';

  } catch (err) {
    showMessage(err.message || '신청 중 오류가 발생했습니다.', 'error');
    hideGlobalLoading();
    setLoading(submitBtn, false);
    isSubmitting = false;
  }
}

// ─────────────────────────────────────────────
// Payload 생성
// ─────────────────────────────────────────────
function buildPayload() {
  const user = window.auth?.getSession?.() || {};
  const type = document.querySelector('input[name="type"]:checked')?.value;

  if (!type) {
    showMessage('제작 종류를 선택해 주세요.', 'error');
    document.querySelector('.signage-type-grid')?.scrollIntoView({ behavior: 'smooth' });
    return null;
  }

  const nameplateType = type === 'NAMEPLATE'
    ? (document.querySelector('input[name="nameplate_type"]:checked')?.value || '')
    : '';

  return {
    type,
    clinic_code:        getValue('clinic_code'),
    team_code:          getValue('team_code'),
    requester_name:     getValue('requester_name'),
    contact:            getValue('contact'),
    quantity:           Number(getValue('quantity') || 1),
    text_content:       getValue('text_content'),
    is_urgent:          getValue('is_urgent') || 'N',
    urgent_reason:      getValue('urgent_reason'),
    file_ids:           [...uploadedFileIds.main],
    location_file_ids:  [...uploadedFileIds.location],
    reference_file_ids: [...uploadedFileIds.reference],
    sign_size:          getValue('sign_size'),
    sign_type:          getValue('sign_type'),
    install_location:   getValue('install_location'),
    install_env:        type === 'SIGN' ? getValue('install_env') : getValue('install_env_nameplate'),
    nameplate_type:     nameplateType,
    nameplate_text:     getValue('nameplate_text'),
    created_by:         user.user_email || user.email || ''
  };
}

// ─────────────────────────────────────────────
// 유효성 검증
// ─────────────────────────────────────────────
function validatePayload(p) {
  if (!p.clinic_code)    return fail('의원 정보가 없습니다. 다시 로그인해 주세요.', null);
  if (!p.team_code)      return fail('팀 정보가 없습니다. 다시 로그인해 주세요.', null);
  if (!p.requester_name) return fail('요청자명을 입력해 주세요.', 'requester_name');
  if (!p.contact)        return fail('연락처를 입력해 주세요.', 'contact');
  if (!p.quantity || p.quantity < 1) return fail('수량을 1 이상 입력해 주세요.', 'quantity');
  if (!p.text_content)   return fail('문구를 입력해 주세요.', 'text_content');
  if (p.is_urgent === 'Y' && !p.urgent_reason) return fail('긴급 사유를 입력해 주세요.', 'urgent_reason');
  if (!p.created_by)     return fail('로그인 정보를 찾을 수 없습니다. 다시 로그인해 주세요.', null);

  if (p.type === 'SIGN') {
    if (!p.sign_size)        return fail('사이즈를 입력해 주세요.', 'sign_size');
    if (!p.sign_type)        return fail('형태/종류를 입력해 주세요.', 'sign_type');
    if (!p.install_env)      return fail('설치 환경을 선택해 주세요.', 'install_env');
    if (!p.install_location) return fail('설치 위치를 입력해 주세요.', 'install_location');
    if (uploadedFileIds.location.length  === 0) return fail('설치 위치 사진을 첨부해 주세요.', null);
    if (uploadedFileIds.reference.length === 0) return fail('참고 자료(도면/레퍼런스)를 첨부해 주세요.', null);
  }

  if (p.type === 'NAMEPLATE') {
    if (!p.nameplate_type) return fail('명판 타입을 선택해 주세요.', null);
    if (!p.install_env)    return fail('설치 환경을 선택해 주세요.', 'install_env_nameplate');
    if (!p.nameplate_text) return fail('명판 문구를 입력해 주세요.', 'nameplate_text');
  }

  return true;
}

function fail(msg, focusId) {
  showMessage(msg, 'error');
  if (focusId) document.getElementById(focusId)?.focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  return false;
}

// ─────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────
function getValue(id)      { const el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; }
function setVal(id, val)   { const el = document.getElementById(id); if (el) el.value = val; }
function showEl(id)        { const el = document.getElementById(id); if (el) el.style.display = ''; }
function hideEl(id)        { const el = document.getElementById(id); if (el) el.style.display = 'none'; }
function setRequired(id,v) { const el = document.getElementById(id); if (el) el.required = v; }
