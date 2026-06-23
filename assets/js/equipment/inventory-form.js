let currentEquipmentId = '';
let currentEquipment = null;
let isSubmitting = false; // ★ 중복 제출 방지 플래그

function getNowDateTimeString() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

function getCurrentUserSafe() {
  return window.auth?.getSession?.() || {};
}

function getEquipmentDepartmentDisplay(item) {
  if (!item) return '';
  return (
    item.department_display ||
    item.department ||
    [item.clinic_name, item.team_name].filter(Boolean).join(' / ')
  );
}

async function loadEquipmentInfo() {
  const equipmentId = getQueryParam('equipment_id');
  currentEquipmentId = equipmentId;

  showGlobalLoading('장비 정보를 불러오는 중...');

  if (!equipmentId) {
    hideGlobalLoading();
    showMessage('equipment_id가 없습니다.', 'error');
    return;
  }

  const backBtn = qs('#backToDetailBtn');
  if (backBtn) backBtn.href = `detail.html?id=${encodeURIComponent(equipmentId)}`;

  const checkedAtEl = qs('#checked_at');
  if (checkedAtEl) checkedAtEl.value = getNowDateTimeString();

  const user = getCurrentUserSafe();

  try {
    const result = await apiGet('getEquipment', {
      id: equipmentId,
      request_user_email: user.email || user.user_email || ''
    });

    const item = result.data || {};
    currentEquipment = item;

    qs('#equipment_id').value = item.equipment_id || '';
    qs('#equipment_name').value = item.equipment_name || '';
    qs('#department_at_check').value = getEquipmentDepartmentDisplay(item);
    qs('#location_at_check').value = item.location || '';

    const checkedByEl = qs('#checked_by');
    if (checkedByEl && !checkedByEl.value) {
      checkedByEl.value = user.name || user.user_name || '';
    }
  } catch (error) {
    showMessage(error.message || '장비 정보를 불러오지 못했습니다.', 'error');
  } finally {
    hideGlobalLoading();
  }
}

async function buildInventoryPayload() {
  const item = currentEquipment || {};
  const currentUser = getCurrentUserSafe();
  const checkedByInput = qs('#checked_by')?.value.trim() || '';

  return {
    equipment_id: qs('#equipment_id').value.trim(),
    checked_at: qs('#checked_at').value.trim(),

    // 백엔드 검증용: 이메일 저장
    checked_by: currentUser.email || currentUser.user_email || '',

    // 화면 표시용 보조값
    checked_by_name: checkedByInput,

    clinic_code_at_check: item.clinic_code || '',
    clinic_name_at_check: item.clinic_name || '',
    team_code_at_check: item.team_code || '',
    team_name_at_check: item.team_name || '',
    department_at_check: getEquipmentDepartmentDisplay(item),

    location_at_check: qs('#location_at_check').value.trim(),
    condition_status: qs('#condition_status').value,
    qr_scan_yn: qs('#qr_scan_yn').value,
    memo: qs('#memo').value.trim()
  };
}

function validateInventoryForm(payload) {
  if (!payload.equipment_id) { showMessage('장비번호가 없습니다.', 'error'); return false; }
  if (!payload.checked_at) { showMessage('점검일시를 입력하세요.', 'error'); qs('#checked_at')?.focus(); return false; }
  if (!payload.checked_by) { showMessage('로그인 사용자 정보가 없습니다.', 'error'); return false; }
  if (!payload.clinic_code_at_check) { showMessage('장비의 의원 정보가 없습니다.', 'error'); return false; }
  if (!payload.team_code_at_check) { showMessage('장비의 사용부서 정보가 없습니다.', 'error'); return false; }
  if (!payload.condition_status) { showMessage('상태를 선택하세요.', 'error'); qs('#condition_status')?.focus(); return false; }
  return true;
}

async function handleSubmitInventory(event) {
  event.preventDefault();
  clearMessage();

  // ★ 중복 제출 방지: 이미 요청 중이면 무시
  if (isSubmitting) return;

  const submitBtn = qs('#submitBtn');

  try {
    const payload = await buildInventoryPayload();
    if (!validateInventoryForm(payload)) return;

    isSubmitting = true;
    setLoading(submitBtn, true, '저장 중...');
    showGlobalLoading('재고조사 이력을 저장하는 중...');

    await apiPost('createInventoryLog', payload);

    alert('재고조사 이력이 등록되었습니다.');
    if (typeof window.invalidateDashboardSessionCache === 'function') {
      window.invalidateDashboardSessionCache();
    }
    location.href = `detail.html?id=${encodeURIComponent(payload.equipment_id)}`;
  } catch (error) {
    showMessage(error.message || '재고조사 저장 중 오류가 발생했습니다.', 'error');
    isSubmitting = false; // 오류 시에만 플래그 해제 (성공 시엔 페이지 이동)
  } finally {
    hideGlobalLoading();
    setLoading(submitBtn, false);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  showGlobalLoading('재고조사 화면을 준비하는 중...');

  try {
    const user = window.auth?.requireAuth?.();
    if (!user) return;

    const ok = await window.appPermission?.requirePermission?.('equipment', ['edit', 'admin']);
    if (!ok) return;

    await loadEquipmentInfo();

    // ★ user이면 본인 소속 팀 장비만 재고조사 등록 가능
    // loadEquipmentInfo() 완료 후 currentEquipment에 장비 데이터가 세팅되어 있음
    if (String(user.role || '').trim().toLowerCase() !== 'admin') {
      const userTeamCode      = String(user.team_code || '').trim();
      const equipmentTeamCode = String((currentEquipment && currentEquipment.team_code) || '').trim();
      if (userTeamCode && equipmentTeamCode && userTeamCode !== equipmentTeamCode) {
        showMessage('본인 소속 팀의 장비만 재고조사를 등록할 수 있습니다.', 'error');
        const submitBtn = qs('#inventoryForm button[type="submit"]');
        if (submitBtn) submitBtn.disabled = true;
        return;
      }
    }

    qs('#inventoryForm')?.addEventListener('submit', handleSubmitInventory);
  } catch (error) {
    showMessage(error.message || '재고조사 화면을 불러오는 중 오류가 발생했습니다.', 'error');
  } finally {
    hideGlobalLoading();
  }
});
