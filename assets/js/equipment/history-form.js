let currentEquipmentId = '';
let currentEquipment = null;
let currentHistoryId = '';
let currentHistory = null;
let isEditMode = false;

function normalizeText(value) {
  return String(value || '').trim();
}

function getCurrentUserSafe() {
  if (window.auth && typeof window.auth.getSession === 'function') {
    return window.auth.getSession() || {};
  }
  return {};
}

function setPageMode() {
  const titleEl = document.querySelector('.page-title');
  const descEl = document.querySelector('.page-desc');
  const submitBtn = qs('#submitBtn');

  if (isEditMode) {
    if (titleEl) titleEl.textContent = '이력 수정';
    if (descEl) descEl.textContent = '등록된 수리 및 점검 이력을 수정합니다.';
    if (submitBtn) submitBtn.textContent = '수정 저장';
  } else {
    if (titleEl) titleEl.textContent = '이력 등록';
    if (descEl) descEl.textContent = '수리 및 점검 이력을 기록합니다.';
    if (submitBtn) submitBtn.textContent = '저장';
  }
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
    this.value = formatNumberWithComma(this.value);
    requestAnimationFrame(() => {
      try { this.setSelectionRange(this.value.length, this.value.length); } catch (e) {}
    });
  });

  el.addEventListener('blur', function() {
    this.value = formatNumberWithComma(this.value);
  });
}

function getTodayYmd() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

async function loadEquipmentInfo() {
  const equipmentId = getQueryParam('equipment_id');
  currentEquipmentId = equipmentId;

  if (!equipmentId) {
    showMessage('equipment_id가 없습니다.', 'error');
    return;
  }

  const backBtn = qs('#backToDetailBtn');
  if (backBtn) backBtn.href = 'detail.html?id=' + encodeURIComponent(equipmentId);

  const user = getCurrentUserSafe();

  try {
    const result = await apiGet('getEquipment', {
      id: equipmentId,
      request_user_email: user.email || user.user_email || ''
    });

    const item = result.data || {};
    currentEquipment = item;

    const equipmentIdEl = qs('#equipment_id');
    if (equipmentIdEl) equipmentIdEl.value = item.equipment_id || '';

    const equipmentNameEl = qs('#equipment_name');
    if (equipmentNameEl) equipmentNameEl.value = item.equipment_name || '';

    const requestDeptEl = qs('#request_department');
    if (requestDeptEl) {
      requestDeptEl.value = item.department_display || item.department || '';
      requestDeptEl.readOnly = true;
    }
  } catch (error) {
    showMessage(error.message || '장비 정보를 불러오지 못했습니다.', 'error');
  }
}

function fillHistoryForm(item) {
  if (!item) return;

  currentHistory = item;

  const historyTypeEl = qs('#history_type');
  if (historyTypeEl) historyTypeEl.value = item.history_type || '';

  const requestDeptEl = qs('#request_department');
  if (requestDeptEl) {
    requestDeptEl.value =
      item.request_department_display ||
      item.request_department ||
      (currentEquipment && (currentEquipment.department_display || currentEquipment.department)) ||
      '';
  }

  const requesterEl = qs('#requester');
  if (requesterEl) requesterEl.value = item.requester || '';

  const workDateEl = qs('#work_date');
  if (workDateEl) workDateEl.value = item.work_date || '';

  const amountEl = qs('#amount');
  if (amountEl) {
    amountEl.value =
      item.amount === null || item.amount === undefined
        ? ''
        : formatNumberWithComma(item.amount);
  }

  const vendorEl = qs('#vendor_name');
  if (vendorEl) vendorEl.value = item.vendor_name || '';

  const descEl = qs('#description');
  if (descEl) descEl.value = item.description || '';

  const resultEl = qs('#result_status');
  if (resultEl) resultEl.value = item.result_status || '';

  const nextDateEl = qs('#next_action_date');
  if (nextDateEl) nextDateEl.value = item.next_action_date || '';

  const statusEl = qs('#update_equipment_status');
  if (statusEl) statusEl.value = '';
}

async function loadHistoryInfoIfEditMode() {
  currentHistoryId = getQueryParam('history_id');
  isEditMode = !!currentHistoryId;
  setPageMode();

  if (!isEditMode) return;

  const user = getCurrentUserSafe();

  try {
    showGlobalLoading('이력 정보를 불러오는 중...');

    const result = await apiGet('getHistory', {
      history_id: currentHistoryId,
      request_user_email: user.email || user.user_email || ''
    });

    const item = result.data || {};

    if (!currentEquipmentId) currentEquipmentId = item.equipment_id || '';

    fillHistoryForm(item);
    // ★ item.updated_at 이 currentHistory 에 보관됨 → buildHistoryPayload() 에서 client_updated_at 으로 전송

    const backBtn = qs('#backToDetailBtn');
    if (backBtn && currentEquipmentId) backBtn.href = 'detail.html?id=' + encodeURIComponent(currentEquipmentId);
  } catch (error) {
    showMessage(error.message || '이력 정보를 불러오지 못했습니다.', 'error');
  } finally {
    hideGlobalLoading();
  }
}

function buildHistoryPayload() {
  const currentUser = getCurrentUserSafe();
  const actor = currentUser.email || currentUser.user_email || currentUser.name || 'system';

  const fallbackOrg = {
    request_clinic_code:
      (isEditMode ? currentHistory?.request_clinic_code : '') || currentEquipment?.clinic_code || '',
    request_clinic_name:
      (isEditMode ? currentHistory?.request_clinic_name : '') || currentEquipment?.clinic_name || '',
    request_team_code:
      (isEditMode ? currentHistory?.request_team_code : '') || currentEquipment?.team_code || '',
    request_team_name:
      (isEditMode ? currentHistory?.request_team_name : '') || currentEquipment?.team_name || '',
    request_department:
      (isEditMode
        ? (currentHistory?.request_department_display || currentHistory?.request_department)
        : '') ||
      currentEquipment?.department_display ||
      currentEquipment?.department ||
      qs('#request_department')?.value.trim() ||
      ''
  };

  const payload = {
    equipment_id: qs('#equipment_id')?.value.trim() || '',
    history_type: qs('#history_type')?.value || '',
    requester: qs('#requester')?.value.trim() || '',
    work_date: qs('#work_date')?.value || '',
    amount: unformatNumber(qs('#amount')?.value || ''),
    vendor_name: qs('#vendor_name')?.value.trim() || '',
    description: qs('#description')?.value.trim() || '',
    result_status: qs('#result_status')?.value || '',
    next_action_date: qs('#next_action_date')?.value || '',
    created_by: actor,
    updated_by: actor,
    update_equipment_status: qs('#update_equipment_status').value || '',
    request_clinic_code: fallbackOrg.request_clinic_code,
    request_clinic_name: fallbackOrg.request_clinic_name,
    request_team_code: fallbackOrg.request_team_code,
    request_team_name: fallbackOrg.request_team_name,
    request_department: fallbackOrg.request_department
  };

  if (isEditMode && currentHistoryId) {
    payload.history_id = currentHistoryId;
    // ★ 낙관적 락: 내가 조회했을 때의 updated_at 을 서버로 전송
    // 서버가 현재 시트의 updated_at 과 비교해, 다른 사람이 먼저 수정했으면 오류를 반환합니다.
    payload.client_updated_at = normalizeText(currentHistory?.updated_at);
  }

  return payload;
}

function validateHistoryPayload(payload) {
  if (!payload.equipment_id) { showMessage('장비번호가 없습니다.', 'error'); return false; }
  if (!payload.history_type) { showMessage('이력 구분을 선택하세요.', 'error'); qs('#history_type')?.focus(); return false; }
  if (!payload.work_date) { showMessage('작업일을 입력하세요.', 'error'); qs('#work_date')?.focus(); return false; }
  if (!payload.description) { showMessage('작업내용을 입력하세요.', 'error'); qs('#description')?.focus(); return false; }
  return true;
}

/**
 * 충돌 발생 시 서버에서 최신 이력 데이터를 다시 불러옵니다.
 */
async function refreshCurrentHistory() {
  if (!currentHistoryId) return;
  try {
    const user = getCurrentUserSafe();
    const result = await apiGet('getHistory', {
      history_id: currentHistoryId,
      request_user_email: user.email || user.user_email || ''
    });
    currentHistory = result.data || {};
  } catch (_) {
    // 갱신 실패 시 무시
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  clearMessage();

  const payload = buildHistoryPayload();
  if (!validateHistoryPayload(payload)) return;

  const submitBtn = qs('#submitBtn');

  try {
    setLoading(submitBtn, true, isEditMode ? '수정 중...' : '저장 중...');
    showGlobalLoading(isEditMode ? '이력을 수정하는 중...' : '이력을 저장하는 중...');

    if (isEditMode) {
      const updateResult = await apiPost('updateHistory', payload);
      // ★ 서버가 반환한 새 updated_at 으로 즉시 갱신
      if (updateResult?.data?.updated_at && currentHistory) {
        currentHistory.updated_at = updateResult.data.updated_at;
      }
      alert('이력이 수정되었습니다.');
    } else {
      await apiPost('createHistory', payload);
      alert('이력이 등록되었습니다.');
    }

    if (typeof window.invalidateDashboardSessionCache === 'function') {
      window.invalidateDashboardSessionCache();
    }
    location.href = `detail.html?id=${encodeURIComponent(payload.equipment_id)}`;
  } catch (error) {
    const msg = error.message || '이력 저장 중 오류가 발생했습니다.';
    showMessage(msg, 'error');

    // ★ 충돌 감지 시 최신 데이터를 자동으로 다시 불러와서
    //    다음 저장 시도 때 올바른 client_updated_at 이 전송되도록 합니다.
    if (isEditMode && msg.includes('다른 사용자가 이미 수정했습니다')) {
      await refreshCurrentHistory();
    }
  } finally {
    hideGlobalLoading();
    setLoading(submitBtn, false);
  }
}

function applyHistoryFormDefaults() {
  if (!isEditMode) {
    const workDateEl = qs('#work_date');
    if (workDateEl && !workDateEl.value) workDateEl.value = getTodayYmd();
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const user = window.auth?.requireAuth?.();
  if (!user) return;

  // ★ edit 권한 체크: view만 있는 사용자는 이력 등록 폼 접근 불가
  if (window.appPermission && typeof window.appPermission.requirePermission === 'function') {
    const ok = await window.appPermission.requirePermission('equipment', ['edit', 'admin']);
    if (!ok) return;
  }

  try {
    showGlobalLoading('초기 정보를 불러오는 중...');
    await loadEquipmentInfo();

    // ★ user이면 본인 소속 팀 장비만 이력 등록/수정 가능
    // loadEquipmentInfo() 완료 후 currentEquipment에 장비 데이터가 세팅되어 있음
    if (String(user.role || '').trim().toLowerCase() !== 'admin') {
      const userTeamCode      = String(user.team_code || '').trim();
      const equipmentTeamCode = String((currentEquipment && currentEquipment.team_code) || '').trim();
      if (userTeamCode && equipmentTeamCode && userTeamCode !== equipmentTeamCode) {
        showMessage('본인 소속 팀의 장비만 이력을 등록할 수 있습니다.', 'error');
        const submitBtn = document.querySelector('form button[type="submit"]');
        if (submitBtn) submitBtn.disabled = true;
        return;
      }
    }

    await loadHistoryInfoIfEditMode();
    applyHistoryFormDefaults();
    bindCurrencyInput('#amount');
    document.querySelector('form')?.addEventListener('submit', handleSubmit);
  } catch (error) {
    showMessage(error.message || '초기화 중 오류가 발생했습니다.', 'error');
  } finally {
    hideGlobalLoading();
  }
});
