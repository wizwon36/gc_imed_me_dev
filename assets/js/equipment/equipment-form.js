// ── shell 네비게이션 헬퍼 ──────────────────────────────────────
function shellNav(page, extraQuery) {
  try {
    if (window.parent && window.parent.shellNavigate) {
      window.parent.shellNavigate(page, '', false, extraQuery || null);
    } else {
      var url = CONFIG.SITE_BASE_URL + '/pages/' + page + '.html';
      if (extraQuery) {
        url += '?' + Object.keys(extraQuery).map(function(k) {
          return encodeURIComponent(k) + '=' + encodeURIComponent(extraQuery[k]);
        }).join('&');
      }
      location.href = url;
    }
  } catch(e) {
    location.href = CONFIG.SITE_BASE_URL + '/pages/' + page + '.html';
  }
}

let currentEquipmentId = '';
let isEditMode = false;
let currentEquipment = null;
let orgBinder = null;
let selectedPhotoFile = null;
let removePhotoRequested = false;

const DEFAULT_EQUIPMENT_STATUSES = [
  { value: 'IN_USE', label: '사용중' },
  { value: 'REPAIRING', label: '수리중' },
  { value: 'INSPECTING', label: '점검중' },
  { value: 'STORED', label: '보관중' },
  { value: 'DISPOSED', label: '폐기' }
];

function normalizeText(value) {
  return String(value || '').trim();
}

function formatNumberWithComma(value) {
  const raw = String(value || '').replace(/[^\d]/g, '');
  if (!raw) return '';
  return raw.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function unformatNumber(value) {
  return String(value || '').replace(/[^\d.-]/g, '');
}

function bindCurrencyInput(selector) {
  const el = qs(selector);
  if (!el) return;

  el.addEventListener('input', function() {
    const active = this === document.activeElement;
    this.value = formatNumberWithComma(this.value);

    if (active) {
      requestAnimationFrame(() => {
        try {
          this.setSelectionRange(this.value.length, this.value.length);
        } catch (e) {}
      });
    }
  });

  el.addEventListener('blur', function() {
    this.value = formatNumberWithComma(this.value);
  });
}

function formatDateInputValue(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const directMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (directMatch) return raw;

  const datePartMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (datePartMatch) {
    return `${datePartMatch[1]}-${datePartMatch[2]}-${datePartMatch[3]}`;
  }

  const parsed = new Date(raw);
  if (!isNaN(parsed.getTime())) {
    const yyyy = parsed.getFullYear();
    const mm = String(parsed.getMonth() + 1).padStart(2, '0');
    const dd = String(parsed.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  return '';
}

function getCurrentUserSafe() {
  return window.auth?.getSession?.() || {};
}

function setPageMode() {
  const titleEl = document.querySelector('.page-title');
  const descEl = document.querySelector('.page-desc');
  const submitBtn = qs('#submitButton');
  const submitBtnText = qs('#submitButtonText');
  const formTabs = qs('#formTabs');

  if (isEditMode) {
    if (titleEl) titleEl.textContent = '장비 수정';
    if (descEl) descEl.textContent = '등록된 장비 정보를 수정합니다.';
    if (submitBtnText) {
      submitBtnText.textContent = '수정 저장';
    } else if (submitBtn) {
      submitBtn.textContent = '수정 저장';
    }
    // 수정 모드에서는 탭 숨김
    if (formTabs) formTabs.style.display = 'none';
  } else {
    if (titleEl) titleEl.textContent = '장비 등록';
    if (descEl) descEl.textContent = '신규 의료장비 정보를 등록합니다.';
    if (submitBtnText) {
      submitBtnText.textContent = '장비 등록';
    } else if (submitBtn) {
      submitBtn.textContent = '장비 등록';
    }
    if (formTabs) formTabs.style.display = '';
  }
}

function getSelectedOrgCodes() {
  return {
    clinic_code: normalizeText(qs('#clinic_code')?.value),
    team_code: normalizeText(qs('#team_code')?.value)
  };
}

function updateDepartmentPreview() {
  const previewEl = qs('#department_preview');
  if (!previewEl) return;

  const { clinic_code, team_code } = getSelectedOrgCodes();
  previewEl.value = window.orgSelect?.getOrgDisplayText?.(clinic_code, team_code) || '';
}

function updateTeamSelectGuide() {
  const clinicSelect = qs('#clinic_code');
  const teamSelect = qs('#team_code');
  if (!teamSelect) return;

  const clinicCode = normalizeText(clinicSelect?.value);

  if (!clinicCode) {
    teamSelect.disabled = true;
    teamSelect.innerHTML = '<option value="">의원을 먼저 선택하세요</option>';
    return;
  }

  teamSelect.disabled = false;

  if (!teamSelect.options.length) {
    teamSelect.innerHTML = '<option value="">팀을 선택하세요</option>';
  } else if (teamSelect.options.length === 1 && !teamSelect.value) {
    const firstText = normalizeText(teamSelect.options[0].text);
    if (!firstText || firstText === '의원을 먼저 선택하세요') {
      teamSelect.innerHTML = '<option value="">팀을 선택하세요</option>';
    }
  }
}

function renderStatusOptions(items, selectedValue) {
  const selectEl = qs('#status');
  if (!selectEl) return;

  const list = Array.isArray(items) && items.length
    ? items.map(function(item) {
        return {
          value: normalizeText(item.code_value || item.value),
          label: normalizeText(item.code_name || item.label || item.code_value || item.value)
        };
      }).filter(function(item) { return !!item.value; })
    : DEFAULT_EQUIPMENT_STATUSES;

  const safeSelected = normalizeText(selectedValue) || 'IN_USE';

  selectEl.innerHTML =
    '<option value="">선택하세요</option>' +
    list.map(function(item) {
      const selected = item.value === safeSelected ? ' selected' : '';
      return '<option value="' + escapeHtml(item.value) + '"' + selected + '>' +
        escapeHtml(item.label) +
      '</option>';
    }).join('');

  if (!selectEl.value) selectEl.value = safeSelected;
}

async function loadStatusOptions(selectedValue) {
  try {
    const result = await apiGet('getCodes', { code_group: 'EQUIPMENT_STATUS' });
    const items = Array.isArray(result?.data) ? result.data : [];
    renderStatusOptions(items, selectedValue);
  } catch (error) {
    renderStatusOptions([], selectedValue);
  }
}

// ★ user role이면 본인 소속 의원으로 고정, admin이면 전체 선택 가능
async function initializeOrgSelectors() {
  await window.orgSelect.loadOrgData();

  const clinicSelect = qs('#clinic_code');
  const teamSelect = qs('#team_code');
  const user = getCurrentUserSafe();
  const isAdmin = String(user.role || '').toLowerCase() === 'admin';

  if (isAdmin) {
    // admin: 전체 의원 목록 표시, 자유 선택
    window.orgSelect.fillSelectOptions(clinicSelect, window.orgSelect.getClinics(), {
      emptyText: '의원을 선택하세요'
    });

    if (teamSelect) {
      teamSelect.disabled = true;
      teamSelect.innerHTML = '<option value="">의원을 먼저 선택하세요</option>';
    }

    orgBinder = window.orgSelect.bindClinicTeamSelects({
      clinicSelect,
      teamSelect,
      onClinicChanged: function() { updateTeamSelectGuide(); updateDepartmentPreview(); },
      onTeamChanged: function() { updateTeamSelectGuide(); updateDepartmentPreview(); }
    });

  } else {
    // ★ user: 본인 소속 의원으로 고정 (disabled), 팀은 소속 의원 하위 팀만 표시
    const userClinicCode = normalizeText(user.clinic_code);
    const userTeamCode   = normalizeText(user.team_code);

    // 의원 셀렉트: 본인 소속 의원 1개만 표시하고 변경 불가
    if (clinicSelect) {
      const clinics = window.orgSelect.getClinics();
      const myClinic = clinics.find(function(c) {
        return normalizeText(c.code_value) === userClinicCode;
      });
      const clinicLabel = myClinic ? normalizeText(myClinic.code_name) : userClinicCode;

      clinicSelect.innerHTML = '<option value="' + escapeHtml(userClinicCode) + '">' +
        escapeHtml(clinicLabel) + '</option>';
      clinicSelect.value = userClinicCode;
      clinicSelect.disabled = true;
    }

    // ★ user: 팀 셀렉트도 본인 소속 팀 1개만 표시하고 변경 불가
    if (teamSelect) {
      const teams = window.orgSelect.getTeams ? window.orgSelect.getTeams() : [];
      const myTeam = teams.find(function(t) {
        return normalizeText(t.code_value) === userTeamCode;
      });
      const teamLabel = myTeam ? normalizeText(myTeam.code_name) : userTeamCode;

      teamSelect.innerHTML = '<option value="' + escapeHtml(userTeamCode) + '">' +
        escapeHtml(teamLabel) + '</option>';
      teamSelect.value = userTeamCode;
      teamSelect.disabled = true;
    }

    // orgBinder는 onTeamChanged 콜백용으로만 바인딩 (의원/팀 모두 고정이므로 렌더링은 불필요)
    orgBinder = window.orgSelect.bindClinicTeamSelects({
      clinicSelect,
      teamSelect,
      onClinicChanged: function() { updateDepartmentPreview(); },
      onTeamChanged: function() { updateDepartmentPreview(); }
    });
  }

  updateTeamSelectGuide();
}

function getPhotoElements() {
  return {
    input: qs('#photoInput'),
    preview: qs('#photoPreviewImage'),
    empty: qs('#photoPreviewEmpty'),
    removeBtn: qs('#removePhotoBtn'),
    fileName: qs('#photoFileName'),
    previewWrap: qs('#photoPreviewWrap'),
    existingMeta: qs('#photoExistingMeta')
  };
}

function renderPhotoPreview(src) {
  const els = getPhotoElements();
  if (!els.preview || !els.empty) return;

  els.preview.onerror = function() {
    els.preview.src = '';
    els.preview.classList.add('is-hidden');
    els.empty.classList.remove('is-hidden');
    els.empty.textContent = '사진을 불러오지 못했습니다.';
    if (els.previewWrap) els.previewWrap.classList.remove('has-image');
    if (els.existingMeta) els.existingMeta.style.display = 'none';
  };

  if (src) {
    els.preview.src = src;
    els.preview.classList.remove('is-hidden');
    els.empty.classList.add('is-hidden');
    els.empty.textContent = '등록된 사진이 없습니다.';
    if (els.previewWrap) els.previewWrap.classList.add('has-image');
  } else {
    els.preview.src = '';
    els.preview.classList.add('is-hidden');
    els.empty.classList.remove('is-hidden');
    els.empty.textContent = '등록된 사진이 없습니다.';
    if (els.previewWrap) els.previewWrap.classList.remove('has-image');
  }
}

function loadExistingPhoto(item) {
  const inlineUrl = normalizeText(item?.photo_inline_url);
  const photoUrl = normalizeText(item?.photo_url);
  const finalUrl = inlineUrl || photoUrl;
  const els = getPhotoElements();

  if (els.fileName) els.fileName.textContent = finalUrl ? '등록된 사진 있음' : '선택된 파일 없음';
  if (els.existingMeta) els.existingMeta.style.display = finalUrl ? '' : 'none';

  renderPhotoPreview(finalUrl || '');
}

function initializePhotoUi() {
  const els = getPhotoElements();
  if (!els.input) return;

  els.input.addEventListener('change', function(event) {
    const file = event.target.files && event.target.files[0];

    if (!file) {
      selectedPhotoFile = null;
      if (els.fileName) els.fileName.textContent = currentEquipment?.photo_file_id ? '등록된 사진 있음' : '선택된 파일 없음';
      if (els.existingMeta) els.existingMeta.style.display = currentEquipment?.photo_file_id ? '' : 'none';
      loadExistingPhoto(currentEquipment || {});
      return;
    }

    selectedPhotoFile = file;
    removePhotoRequested = false;

    if (els.fileName) els.fileName.textContent = file.name || '선택된 파일 없음';
    if (els.existingMeta) { els.existingMeta.style.display = ''; els.existingMeta.textContent = '새로 선택한 사진이 있습니다.'; }

    renderPhotoPreview(URL.createObjectURL(file));
  });

  els.removeBtn?.addEventListener('click', function() {
    selectedPhotoFile = null;
    removePhotoRequested = true;

    if (els.input) els.input.value = '';
    if (els.fileName) els.fileName.textContent = '선택된 파일 없음';
    if (els.existingMeta) { els.existingMeta.style.display = ''; els.existingMeta.textContent = '사진 삭제 예정'; }

    renderPhotoPreview('');
  });
}

function getImageTypeForOutput(file) {
  const type = String(file?.type || '').toLowerCase();
  if (type === 'image/png') return 'image/jpeg';
  if (type === 'image/webp') return 'image/jpeg';
  return 'image/jpeg';
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = function() { resolve(reader.result); };
    reader.onerror = function() { reject(new Error('파일을 읽지 못했습니다.')); };
    reader.readAsDataURL(file);
  });
}

function loadImageFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = function() { resolve(img); };
    img.onerror = function() { reject(new Error('이미지 로드에 실패했습니다.')); };
    img.src = dataUrl;
  });
}

async function compressImageFile(file) {
  const dataUrl = await readFileAsDataUrl(file);
  const img = await loadImageFromDataUrl(dataUrl);

  const maxSize = 800;
  let width = img.width;
  let height = img.height;

  if (width > height && width > maxSize) {
    height = Math.round((height * maxSize) / width);
    width = maxSize;
  } else if (height >= width && height > maxSize) {
    width = Math.round((width * maxSize) / height);
    height = maxSize;
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(img, 0, 0, width, height);

  const mimeType = getImageTypeForOutput(file);
  return {
    dataUrl: canvas.toDataURL(mimeType, 0.75),
    mimeType,
    fileName: file.name || 'equipment-photo.jpg'
  };
}

async function uploadPhotoIfNeeded(equipmentId) {
  const currentUser = getCurrentUserSafe();
  const requestUserEmail = currentUser.email || currentUser.user_email || '';

  if (!equipmentId) return;

  if (removePhotoRequested && currentEquipment?.photo_file_id) {
    await apiPost('deleteEquipmentPhoto', { equipment_id: equipmentId, request_user_email: requestUserEmail });
    currentEquipment.photo_file_id = '';
    currentEquipment.photo_url = '';
    currentEquipment.photo_inline_url = '';
    removePhotoRequested = false;
  }

  if (!selectedPhotoFile) {
    const els = getPhotoElements();
    if (!currentEquipment?.photo_file_id && els.existingMeta && !removePhotoRequested) {
      els.existingMeta.style.display = 'none';
    }
    return;
  }

  const compressed = await compressImageFile(selectedPhotoFile);
  const result = await apiPost('uploadEquipmentPhoto', {
    equipment_id: equipmentId,
    request_user_email: requestUserEmail,
    data_url: compressed.dataUrl,
    mime_type: compressed.mimeType,
    file_name: compressed.fileName
  });

  const uploaded = result?.data || {};
  currentEquipment = currentEquipment || {};
  currentEquipment.photo_file_id = uploaded.photo_file_id || '';
  currentEquipment.photo_url = uploaded.photo_url || '';
  currentEquipment.photo_inline_url = '';
  selectedPhotoFile = null;
  removePhotoRequested = false;

  const els = getPhotoElements();
  if (els.input) els.input.value = '';
  if (els.fileName) els.fileName.textContent = currentEquipment.photo_file_id ? '등록된 사진 있음' : '선택된 파일 없음';
  if (els.existingMeta) {
    els.existingMeta.textContent = currentEquipment.photo_file_id ? '현재 등록된 사진이 있습니다.' : '';
    els.existingMeta.style.display = currentEquipment.photo_file_id ? '' : 'none';
  }

  loadExistingPhoto(currentEquipment);
}

function fillEquipmentForm(item) {
  if (!item) return;

  qs('#equipment_name').value = item.equipment_name || '';
  qs('#model_name').value = item.model_name || '';
  qs('#manufacturer').value = item.manufacturer || '';
  qs('#manufacture_date').value = formatDateInputValue(item.manufacture_date);
  qs('#purchase_date').value = formatDateInputValue(item.purchase_date);
  qs('#serial_no').value = item.serial_no || '';
  qs('#vendor').value = item.vendor || '';
  qs('#manager_name').value = item.manager_name || '';
  qs('#manager_phone').value = item.manager_phone || '';
  qs('#acquisition_cost').value = formatNumberWithComma(
    item.acquisition_cost === null || item.acquisition_cost === undefined ? '' : item.acquisition_cost
  );
  qs('#maintenance_end_date').value = formatDateInputValue(item.maintenance_end_date);
  qs('#location').value = item.location || '';
  qs('#current_user').value = item.current_user || '';
  qs('#memo').value = item.memo || '';

  const user = getCurrentUserSafe();
  const isAdmin = String(user.role || '').toLowerCase() === 'admin';
  const clinicSelect = qs('#clinic_code');
  const teamSelect = qs('#team_code');

  if (isAdmin) {
    // admin: 장비의 의원/팀으로 자유롭게 설정
    if (clinicSelect) clinicSelect.value = item.clinic_code || '';

    if (orgBinder?.renderTeamsByClinic) {
      orgBinder.renderTeamsByClinic(item.clinic_code || '', item.team_code || '');
    } else if (teamSelect) {
      teamSelect.value = item.team_code || '';
    }
  } else {
    // ★ user: 의원/팀 모두 initializeOrgSelectors에서 이미 고정 — 별도 설정 불필요
  }

  updateTeamSelectGuide();
  renderStatusOptions([], item.status || 'IN_USE');
  updateDepartmentPreview();
  loadExistingPhoto(item);
}

async function loadEquipmentIfEditMode() {
  currentEquipmentId = getQueryParam('id');
  isEditMode = !!currentEquipmentId;
  setPageMode();
  if (!isEditMode) return;

  const user = getCurrentUserSafe();
  showGlobalLoading('장비 정보를 불러오는 중...');

  try {
    const result = await apiGet('getEquipment', {
      id: currentEquipmentId,
      request_user_email: user.email || user.user_email || ''
    });

    currentEquipment = result.data || {};
    // ★ updated_at 이 currentEquipment 에 보관됨 → buildEquipmentPayload() 에서 client_updated_at 으로 전송
    fillEquipmentForm(currentEquipment);
  } catch (error) {
    showMessage(error.message || '장비 정보를 불러오지 못했습니다.', 'error');
  } finally {
    hideGlobalLoading();
  }
}

function buildEquipmentPayload() {
  const currentUser = getCurrentUserSafe();
  const { clinic_code, team_code } = getSelectedOrgCodes();

  const payload = {
    equipment_name: normalizeText(qs('#equipment_name')?.value),
    model_name: normalizeText(qs('#model_name')?.value),
    clinic_code,
    team_code,
    manufacturer: normalizeText(qs('#manufacturer')?.value),
    manufacture_date: normalizeText(qs('#manufacture_date')?.value),
    purchase_date: normalizeText(qs('#purchase_date')?.value),
    serial_no: normalizeText(qs('#serial_no')?.value),
    vendor: normalizeText(qs('#vendor')?.value),
    manager_name: normalizeText(qs('#manager_name')?.value),
    manager_phone: normalizeText(qs('#manager_phone')?.value),
    acquisition_cost: unformatNumber(qs('#acquisition_cost')?.value),
    maintenance_end_date: normalizeText(qs('#maintenance_end_date')?.value),
    status: normalizeText(qs('#status')?.value) || 'IN_USE',
    location: normalizeText(qs('#location')?.value),
    current_user: normalizeText(qs('#current_user')?.value),
    memo: normalizeText(qs('#memo')?.value),
    created_by: currentUser.email || currentUser.user_email || '',
    updated_by: currentUser.email || currentUser.user_email || ''
  };

  if (isEditMode) {
    payload.equipment_id = currentEquipmentId;
    // ★ 낙관적 락: 내가 조회했을 때의 updated_at 을 서버로 전송
    // 서버가 현재 시트의 updated_at 과 비교해, 다른 사람이 먼저 수정했으면 오류를 반환합니다.
    payload.client_updated_at = normalizeText(currentEquipment?.updated_at);
  }

  return payload;
}

// 필드 에러 표시 헬퍼
function setFieldError(fieldId, message) {
  const el = qs('#' + fieldId);
  if (!el) return;
  el.classList.add('is-field-error');

  // 기존 에러 메시지 제거 후 재삽입
  const existing = el.parentElement.querySelector('.field-error-msg');
  if (existing) existing.remove();

  const msg = document.createElement('span');
  msg.className = 'field-error-msg';
  msg.textContent = message;
  el.insertAdjacentElement('afterend', msg);
}

function clearFieldErrors() {
  document.querySelectorAll('.input.is-field-error').forEach(el => {
    el.classList.remove('is-field-error');
  });
  document.querySelectorAll('.field-error-msg').forEach(el => el.remove());
}

function validateEquipmentForm(payload) {
  clearFieldErrors();

  const errors = [];

  if (!payload.equipment_name) { setFieldError('equipment_name', '장비명을 입력하세요.'); errors.push('equipment_name'); }
  if (!payload.model_name)     { setFieldError('model_name', '모델명을 입력하세요.');    errors.push('model_name'); }
  if (!payload.serial_no)      { setFieldError('serial_no', '시리얼번호를 입력하세요.'); errors.push('serial_no'); }
  if (!payload.clinic_code)    { setFieldError('clinic_code', '의원을 선택하세요.');     errors.push('clinic_code'); }
  if (!payload.team_code)      { setFieldError('team_code', '팀을 선택하세요.');         errors.push('team_code'); }

  if (!payload.created_by && !payload.updated_by) {
    showMessage('로그인 사용자 정보가 없습니다.', 'error');
    return false;
  }

  if (errors.length > 0) {
    showMessage('필수 항목을 모두 입력해 주세요.', 'error');
    qs('#' + errors[0])?.focus();
    return false;
  }

  return true;
}

/**
 * 충돌 발생 시 서버에서 최신 장비 데이터를 다시 불러옵니다.
 * currentEquipment.updated_at 이 갱신되므로 재시도 시 올바른 client_updated_at 이 전송됩니다.
 */
async function refreshCurrentEquipment() {
  if (!currentEquipmentId) return;
  try {
    const user = getCurrentUserSafe();
    const result = await apiGet('getEquipment', {
      id: currentEquipmentId,
      request_user_email: user.email || user.user_email || ''
    });
    currentEquipment = result.data || {};
  } catch (_) {
    // 갱신 실패 시 무시 — 사용자가 수동으로 새로고침 가능
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  clearMessage();
  clearFieldErrors();

  const submitBtn = qs('#submitButton');
  const payload = buildEquipmentPayload();

  if (!validateEquipmentForm(payload)) return;

  try {
    setLoading(submitBtn, true, isEditMode ? '수정 중...' : '저장 중...');
    showGlobalLoading(isEditMode ? '장비 정보를 수정하는 중...' : '장비를 등록하는 중...');

    let equipmentId = '';

    if (isEditMode) {
      const updateResult = await apiPost('updateEquipment', payload);
      equipmentId = payload.equipment_id;
      // ★ 서버가 반환한 새 updated_at 으로 즉시 갱신
      //    alert → 뒤로가기 등으로 연속 수정 시 오래된 client_updated_at 전송 방지
      if (updateResult?.data?.updated_at && currentEquipment) {
        currentEquipment.updated_at = updateResult.data.updated_at;
      }
    } else {
      const result = await apiPost('createEquipment', payload);
      equipmentId = result?.data?.equipment_id || '';
      currentEquipment = currentEquipment || {};
      currentEquipment.equipment_id = equipmentId;
    }

    await uploadPhotoIfNeeded(equipmentId);

    alert(isEditMode ? '장비 정보가 수정되었습니다.' : '장비가 등록되었습니다.');

    if (typeof window.invalidateDashboardSessionCache === 'function') {
      window.invalidateDashboardSessionCache();
    }

    if (equipmentId) {
      shellNav('equipment/detail', { id: equipmentId });
    } else {
      shellNav('equipment/list');
    }
  } catch (error) {
    const msg = error.message || '장비 저장 중 오류가 발생했습니다.';
    showMessage(msg, 'error');

    // ★ 충돌 감지 시 최신 데이터를 자동으로 다시 불러와서
    //    다음 저장 시도 때 올바른 client_updated_at 이 전송되도록 합니다.
    if (isEditMode && msg.includes('다른 사용자가 이미 수정했습니다')) {
      await refreshCurrentEquipment();
    }
  } finally {
    hideGlobalLoading();
    setLoading(submitBtn, false);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  // 목록으로 버튼
  var cancelBtn = document.getElementById('cancelBtn');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', function() { shellNav('equipment/list'); });
  }

  const user = window.auth?.requireAuth?.();
  if (!user) return;

  // ★ edit 권한 체크: view만 있는 사용자는 폼 페이지 접근 불가
  if (window.appPermission && typeof window.appPermission.requirePermission === 'function') {
    const ok = await window.appPermission.requirePermission('equipment', ['edit', 'admin']);
    if (!ok) return;
  }

  try {
    showGlobalLoading('화면을 준비하는 중...');
    setPageMode();
    await initializeOrgSelectors();
    await loadStatusOptions('IN_USE');
    bindCurrencyInput('#acquisition_cost');
    initializePhotoUi();
    await loadEquipmentIfEditMode();
    updateDepartmentPreview();
    document.querySelector('#equipmentForm')?.addEventListener('submit', handleSubmit);

    // app permission이 'admin'인지 확인해서 일괄등록 탭 노출 여부에 사용
    let isAppAdmin = false;
    if (window.appPermission && typeof window.appPermission.getPermission === 'function') {
      const appPerm = await window.appPermission.getPermission('equipment');
      isAppAdmin = (String(appPerm || '').trim().toLowerCase() === 'admin');
    }
    initBulkSection(user, isAppAdmin);
  } catch (error) {
    showMessage(error.message || '초기화 중 오류가 발생했습니다.', 'error');
  } finally {
    hideGlobalLoading();
  }
});

// ================================================================
// 일괄 등록 (Bulk Import)
// ================================================================

// 탭 전환
function switchFormTab(tab) {
  const singleForm = qs('#equipmentForm');
  const bulkSection = qs('#bulkSection');
  const tabSingle = qs('#tabSingle');
  const tabBulk = qs('#tabBulk');

  if (tab === 'bulk') {
    if (singleForm) singleForm.style.display = 'none';
    if (bulkSection) bulkSection.style.display = '';
    tabSingle?.classList.remove('is-active');
    tabBulk?.classList.add('is-active');
  } else {
    if (singleForm) singleForm.style.display = '';
    if (bulkSection) bulkSection.style.display = 'none';
    tabSingle?.classList.add('is-active');
    tabBulk?.classList.remove('is-active');
  }
  clearMessage();
}

// 엑셀 컬럼 정의
const BULK_COLUMNS = [
  { key: 'equipment_name',     label: '장비명',          required: true  },
  { key: 'model_name',         label: '모델명',          required: true  },
  { key: 'clinic_code',        label: '의원코드',        required: true  },
  { key: 'team_code',          label: '팀코드',          required: true  },
  { key: 'serial_no',          label: '시리얼번호',      required: true  },
  { key: 'manufacturer',       label: '제조사',          required: false },
  { key: 'manufacture_date',   label: '제조일자',        required: false },
  { key: 'purchase_date',      label: '취득일자',        required: false },
  { key: 'vendor',             label: '구매처',          required: false },
  { key: 'acquisition_cost',   label: '취득가액',        required: false },
  { key: 'manager_name',       label: '담당자',          required: false },
  { key: 'manager_phone',      label: '담당자연락처',    required: false },
  { key: 'maintenance_end_date', label: '유지보수종료일', required: false },
  { key: 'status',             label: '상태',            required: false },
  { key: 'location',           label: '위치',            required: false },
  { key: 'current_user',       label: '현재사용자',      required: false },
  { key: 'memo',               label: '메모',            required: false }
];

// 템플릿 다운로드
async function downloadBulkTemplate() {
  if (!window.XLSX) { alert('엑셀 라이브러리를 불러오지 못했습니다.'); return; }

  const btn = qs('#downloadTemplateBtn');
  if (btn) { btn.disabled = true; btn.textContent = '준비 중...'; }

  try {
    // 의원/팀 목록 로드
    const orgData = await apiGet('getOrgData');
    const clinics = Array.isArray(orgData?.data?.clinics) ? orgData.data.clinics : [];
    const teams   = Array.isArray(orgData?.data?.teams)   ? orgData.data.teams   : [];

    const FONT     = { name: '맑은 고딕', sz: 10 };
    const FONT_REQ = { name: '맑은 고딕', sz: 10, bold: true, color: { rgb: '1F3864' } };
    const FILL_REQ = { patternType: 'solid', fgColor: { rgb: 'B8CCE4' } };
    const FILL_OPT = { patternType: 'solid', fgColor: { rgb: 'F1F5F9' } };
    const FILL_ORG = { patternType: 'solid', fgColor: { rgb: 'E2EFDA' } };
    const BORDER = {
      top:    { style: 'thin', color: { rgb: 'BFBFBF' } },
      bottom: { style: 'thin', color: { rgb: 'BFBFBF' } },
      left:   { style: 'thin', color: { rgb: 'BFBFBF' } },
      right:  { style: 'thin', color: { rgb: 'BFBFBF' } }
    };
    const ALIGN_C = { horizontal: 'center', vertical: 'center' };
    const ALIGN_L = { horizontal: 'left',   vertical: 'center' };

    // ── 시트1: 장비일괄등록 ──────────────────────────────────────
    const ws1 = {};

    BULK_COLUMNS.forEach((col, c) => {
      const addr = window.XLSX.utils.encode_cell({ r: 0, c });
      ws1[addr] = {
        v: col.required ? `${col.label} *` : col.label, t: 's',
        s: { font: col.required ? FONT_REQ : FONT, fill: col.required ? FILL_REQ : FILL_OPT, border: BORDER, alignment: ALIGN_C }
      };
    });

    // 예시 행 — 의원/팀 코드를 실제 첫 번째 값으로 채움
    const exampleClinicCode = clinics[0]?.code_value || '';
    const exampleTeamCode   = teams[0]?.code_value   || '';
    const example = {
      equipment_name: '초음파 진단기', model_name: 'US-100',
      clinic_code: exampleClinicCode, team_code: exampleTeamCode,
      serial_no: 'SN-000001', manufacturer: '메디텍',
      manufacture_date: '2023-01-01', purchase_date: '2024-03-01',
      vendor: '(주)의료기기', acquisition_cost: '5000000',
      manager_name: '홍길동', manager_phone: '010-1234-5678',
      maintenance_end_date: '2026-12-31', status: 'IN_USE',
      location: '3층 진료실', current_user: '홍길동', memo: ''
    };

    BULK_COLUMNS.forEach((col, c) => {
      const addr = window.XLSX.utils.encode_cell({ r: 1, c });
      ws1[addr] = { v: example[col.key] || '', t: 's', s: { font: FONT, border: BORDER, alignment: ALIGN_L } };
    });

    ws1['!ref']  = window.XLSX.utils.encode_range({ r: 0, c: 0 }, { r: 1, c: BULK_COLUMNS.length - 1 });
    ws1['!cols'] = BULK_COLUMNS.map(c => ({ wch: c.key === 'memo' ? 24 : 16 }));
    ws1['!rows'] = [{ hpt: 18 }, { hpt: 16 }];

    // ── 시트2: 의원_팀코드 ──────────────────────────────────────
    const ws2 = {};
    const orgHeaders = ['구분', '코드 (clinic_code / team_code 에 입력)', '이름'];

    orgHeaders.forEach((h, c) => {
      const addr = window.XLSX.utils.encode_cell({ r: 0, c });
      ws2[addr] = { v: h, t: 's', s: { font: { ...FONT, bold: true }, fill: FILL_ORG, border: BORDER, alignment: ALIGN_C } };
    });

    let r = 1;

    clinics.forEach(clinic => {
      const row = ['의원', clinic.code_value || '', clinic.code_name || ''];
      row.forEach((v, c) => {
        ws2[window.XLSX.utils.encode_cell({ r, c })] = { v, t: 's', s: { font: FONT, border: BORDER, alignment: ALIGN_L } };
      });
      r++;
    });

    teams.forEach(team => {
      const row = ['팀', team.code_value || '', team.code_name || ''];
      row.forEach((v, c) => {
        ws2[window.XLSX.utils.encode_cell({ r, c })] = { v, t: 's', s: { font: FONT, border: BORDER, alignment: ALIGN_L } };
      });
      r++;
    });

    ws2['!ref']  = window.XLSX.utils.encode_range({ r: 0, c: 0 }, { r: r - 1, c: 2 });
    ws2['!cols'] = [{ wch: 8 }, { wch: 28 }, { wch: 20 }];
    ws2['!rows'] = Array(r).fill({ hpt: 16 });

    // ── 워크북 조합 ─────────────────────────────────────────────
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws1, '장비일괄등록');
    window.XLSX.utils.book_append_sheet(wb, ws2, '의원_팀코드');
    window.XLSX.writeFile(wb, '장비일괄등록_템플릿.xlsx');

  } catch (err) {
    alert('템플릿 생성 중 오류가 발생했습니다: ' + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '템플릿 다운로드'; }
  }
}

// 엑셀 파싱 및 유효성 검사
function parseBulkExcel(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb = window.XLSX.read(e.target.result, { type: 'array', cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw = window.XLSX.utils.sheet_to_json(ws, { defval: '' });

        if (!raw.length) { reject(new Error('데이터가 없습니다.')); return; }

        // 헤더 매핑 (label 또는 label * → key)
        const labelToKey = {};
        BULK_COLUMNS.forEach(c => {
          labelToKey[c.label] = c.key;
          labelToKey[`${c.label} *`] = c.key;
        });

        const rows = raw.map((rawRow, idx) => {
          const row = { _rowNum: idx + 2, _errors: [] };
          Object.entries(rawRow).forEach(([label, val]) => {
            const key = labelToKey[label.trim()];
            if (key) row[key] = String(val || '').trim();
          });

          // 필수값 검사
          BULK_COLUMNS.filter(c => c.required).forEach(c => {
            if (!row[c.key]) row._errors.push(`${c.label} 누락`);
          });

          // 날짜 정규화
          ['manufacture_date', 'purchase_date', 'maintenance_end_date'].forEach(k => {
            if (row[k]) {
              const d = new Date(row[k]);
              if (!isNaN(d)) {
                row[k] = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
              }
            }
          });

          return row;
        });

        resolve(rows);
      } catch (err) {
        reject(new Error('엑셀 파일을 읽지 못했습니다: ' + err.message));
      }
    };
    reader.onerror = () => reject(new Error('파일을 읽지 못했습니다.'));
    reader.readAsArrayBuffer(file);
  });
}

// 미리보기 테이블 렌더링
function renderBulkPreview(rows) {
  const wrap = qs('#bulkPreviewWrap');
  const table = qs('#bulkPreviewTable');
  const countEl = qs('#bulkPreviewCount');
  const errorEl = qs('#bulkPreviewError');
  const submitBtn = qs('#bulkSubmitBtn');
  if (!wrap || !table) return;

  const errorRows = rows.filter(r => r._errors.length > 0);
  countEl.textContent = `총 ${rows.length}건`;
  errorEl.textContent = errorRows.length ? `오류 ${errorRows.length}건 — 수정 후 다시 업로드해 주세요.` : '';
  submitBtn.style.display = errorRows.length === 0 ? '' : 'none';

  const displayCols = BULK_COLUMNS.slice(0, 8); // 미리보기는 주요 컬럼만

  const thead = `<thead><tr>${displayCols.map(c =>
    `<th class="${c.required ? 'is-required' : ''}">${c.label}${c.required ? ' *' : ''}</th>`
  ).join('')}<th>오류</th></tr></thead>`;

  const tbody = `<tbody>${rows.map(row => {
    const hasErr = row._errors.length > 0;
    const cells = displayCols.map(c => `<td>${escapeHtml(row[c.key] || '-')}</td>`).join('');
    const errCell = `<td>${hasErr ? `<span class="cell-error">${escapeHtml(row._errors.join(', '))}</span>` : '✓'}</td>`;
    return `<tr class="${hasErr ? 'is-row-error' : ''}">${cells}${errCell}</tr>`;
  }).join('')}</tbody>`;

  table.innerHTML = thead + tbody;
  wrap.style.display = '';
}

// 일괄 등록 제출
async function handleBulkSubmit(rows, userEmail) {
  const submitBtn = qs('#bulkSubmitBtn');

  try {
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '등록 중...'; }
    showGlobalLoading(`${rows.length}건을 등록하는 중...`);

    const items = rows.map(row => ({
      equipment_name:       row.equipment_name     || '',
      model_name:           row.model_name         || '',
      clinic_code:          row.clinic_code        || '',
      team_code:            row.team_code          || '',
      serial_no:            row.serial_no          || '',
      manufacturer:         row.manufacturer       || '',
      manufacture_date:     row.manufacture_date   || '',
      purchase_date:        row.purchase_date      || '',
      vendor:               row.vendor             || '',
      acquisition_cost:     row.acquisition_cost   || '',
      manager_name:         row.manager_name       || '',
      manager_phone:        row.manager_phone      || '',
      maintenance_end_date: row.maintenance_end_date || '',
      status:               row.status             || 'IN_USE',
      location:             row.location           || '',
      current_user:         row.current_user       || '',
      memo:                 row.memo               || '',
      created_by:           userEmail
    }));

    const result = await apiPost('bulkCreateEquipments', {
      request_user_email: userEmail,
      items
    });

    alert(`${result.data?.created_count || items.length}건이 등록되었습니다.`);
    shellNav('equipment/list');

  } catch (error) {
    showMessage(error.message || '일괄 등록 중 오류가 발생했습니다.', 'error');
  } finally {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '일괄 등록'; }
    hideGlobalLoading();
  }
}

// 일괄등록 섹션 초기화
function initBulkSection(user, isAppAdmin) {
  const userEmail = user.email || user.user_email || '';
  const isRoleAdmin = String(user.role || '').toLowerCase() === 'admin';

  // role:admin 또는 app:admin이 아니면 탭 자체를 숨김
  if (!isRoleAdmin && !isAppAdmin) {
    const tabBulk = qs('#tabBulk');
    if (tabBulk) tabBulk.style.display = 'none';
    return;
  }

  let parsedRows = [];

  qs('#downloadTemplateBtn')?.addEventListener('click', downloadBulkTemplate);

  qs('#bulkFileInput')?.addEventListener('change', async function() {
    const file = this.files?.[0];
    if (!file) return;
    qs('#bulkFileName').textContent = file.name;
    clearMessage();

    // 파일 재선택 시 미리보기/버튼 초기화
    const previewWrap = qs('#bulkPreviewWrap');
    const submitBtn = qs('#bulkSubmitBtn');
    if (previewWrap) previewWrap.style.display = 'none';
    if (submitBtn) submitBtn.style.display = 'none';
    parsedRows = [];

    try {
      showGlobalLoading('파일을 분석하는 중...');
      parsedRows = await parseBulkExcel(file);
      renderBulkPreview(parsedRows);
    } catch (err) {
      showMessage(err.message, 'error');
    } finally {
      hideGlobalLoading();
    }
  });

  qs('#bulkSubmitBtn')?.addEventListener('click', () => {
    if (!parsedRows.length) return;
    if (!confirm(`${parsedRows.length}건을 일괄 등록하시겠습니까?\n오류 발생 시 전체 롤백됩니다.`)) return;
    handleBulkSubmit(parsedRows, userEmail);
  });
}
