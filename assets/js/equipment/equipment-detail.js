let currentEquipmentId = '';
let currentEquipmentData = null;
let detailPermission = { canView: false, canEdit: false, canDelete: false, isAdmin: false, isAppAdmin: false };

function getCurrentUser() {
  if (window.auth && typeof window.auth.getSession === 'function') {
    return window.auth.getSession() || null;
  }
  return null;
}

async function getEquipmentPermissionContext() {
  const user = getCurrentUser();
  if (!user || !user.email) {
    return { canView: false, canEdit: false, canDelete: false, isAdmin: false, isAppAdmin: false };
  }

  const role = String(user.role || '').trim().toLowerCase();
  if (role === 'admin') {
    return { canView: true, canEdit: true, canDelete: true, isAdmin: true, isAppAdmin: false };
  }

  try {
    const result = await apiGet('getUserAppPermission', {
      user_email: user.email,
      app_id: 'equipment',
      request_user_email: user.email
    });

    const permission = String((result && result.data && result.data.permission) || '')
      .trim()
      .toLowerCase();

    return {
      canView: ['view', 'edit', 'admin'].indexOf(permission) > -1,
      canEdit: ['edit', 'admin'].indexOf(permission) > -1,
      canDelete: false,
      isAdmin: false,
      isAppAdmin: permission === 'admin'
    };
  } catch (error) {
    return { canView: false, canEdit: false, canDelete: false, isAdmin: false, isAppAdmin: false };
  }
}

function safeValue(value) {
  return escapeHtml(value || '-');
}

function formatDisplayDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return '-';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const dateOnlyMatch = raw.match(/^(\d{4}-\d{2}-\d{2})[T\s]/);
  if (dateOnlyMatch) return dateOnlyMatch[1];

  const parsed = new Date(raw);
  if (!isNaN(parsed.getTime())) {
    const yyyy = parsed.getFullYear();
    const mm = String(parsed.getMonth() + 1).padStart(2, '0');
    const dd = String(parsed.getDate()).padStart(2, '0');
    return yyyy + '-' + mm + '-' + dd;
  }

  return raw;
}

function formatDisplayDateTime(value) {
  const raw = String(value || '').trim();
  if (!raw) return '-';

  const isoMatch = raw.match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2})/);
  if (isoMatch) {
    return isoMatch[1] + ' ' + isoMatch[2];
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const parsed = new Date(raw);
  if (!isNaN(parsed.getTime())) {
    const yyyy = parsed.getFullYear();
    const mm = String(parsed.getMonth() + 1).padStart(2, '0');
    const dd = String(parsed.getDate()).padStart(2, '0');
    const hh = String(parsed.getHours()).padStart(2, '0');
    const mi = String(parsed.getMinutes()).padStart(2, '0');
    return yyyy + '-' + mm + '-' + dd + ' ' + hh + ':' + mi;
  }

  return raw;
}

function safeNumber(value) {
  if (value === null || value === undefined || value === '') return '-';
  return formatNumber(value);
}

function invalidateDashboardSessionCacheSafe() {
  try {
    if (typeof window.invalidateDashboardSessionCache === 'function') {
      window.invalidateDashboardSessionCache();
    }
  } catch (error) {}
}

function applyActionVisibility() {
  const editBtn = qs('#editEquipmentBtn');
  const deleteBtn = qs('#deleteBtn');
  const addHistoryBtn = qs('#addHistoryBtn');
  const addInventoryBtn = qs('#addInventoryBtn');
  const printLabelBtn = qs('#printLabelBtn');
  const inspectionCertBtn = qs('#inspectionCertBtn');

  const isDeleted =
    String((currentEquipmentData && currentEquipmentData.deleted_yn) || 'N')
      .trim()
      .toUpperCase() === 'Y';

  // ★ user이면 본인 소속 팀 장비만 수정/이력/재고 버튼 표시
  // app:admin이면 타 팀 장비도 수정/이력/재고 버튼 표시
  const currentUser = getCurrentUser();
  const isAdmin = detailPermission.isAdmin;
  const isAppAdmin = detailPermission.isAppAdmin;
  const canEditThisItem = detailPermission.canEdit && (
    isAdmin ||
    isAppAdmin ||
    (
      currentEquipmentData &&
      currentUser &&
      String(currentEquipmentData.team_code || '').trim() === String(currentUser.team_code || '').trim()
    )
  );

  if (editBtn) editBtn.style.display = canEditThisItem && !isDeleted ? '' : 'none';
  if (deleteBtn) deleteBtn.style.display = detailPermission.canDelete ? '' : 'none';
  if (addHistoryBtn) addHistoryBtn.style.display = canEditThisItem && !isDeleted ? '' : 'none';
  if (addInventoryBtn) addInventoryBtn.style.display = canEditThisItem && !isDeleted ? '' : 'none';
  const isMobile = window.innerWidth <= 768;
  if (printLabelBtn) printLabelBtn.style.display = (detailPermission.canView && !isMobile) ? '' : 'none';
  if (inspectionCertBtn) inspectionCertBtn.style.display = (isAdmin || isAppAdmin) ? '' : 'none';

  if (typeof applyTopActionsColClass === 'function') applyTopActionsColClass();
}

function buildEquipmentDetailUrl(equipmentId) {
  return CONFIG.SITE_BASE_URL + '/pages/equipment/public-detail.html?id=' + encodeURIComponent(equipmentId);
}

function renderDetailSkeleton() {
  const detailInfoGrid = qs('#detailInfoGrid');
  const qrBox = qs('#qrBox');
  const qrText = qs('#qrText');
  const photoImg = qs('#detailPhotoImage');
  const photoEmpty = qs('#detailPhotoEmpty');

  if (detailInfoGrid) {
    detailInfoGrid.innerHTML = '';
  }

  if (qrBox) {
    qrBox.innerHTML = '';
  }

  if (qrText) {
    qrText.innerHTML = '';
  }

  if (photoImg) {
    photoImg.src = '';
    photoImg.classList.add('is-hidden');
  }

  if (photoEmpty) {
    photoEmpty.classList.remove('is-hidden');
    photoEmpty.textContent = '불러오는 중...';
  }
}

function renderSectionLoading(areaSelector, countSelector) {
  const area = qs(areaSelector);
  const countEl = qs(countSelector);

  if (countEl) countEl.textContent = '불러오는 중...';
  if (area) {
    area.innerHTML = '<div class="empty-box">불러오는 중...</div>';
  }
}

function renderSectionError(areaSelector, countSelector, message) {
  const area = qs(areaSelector);
  const countEl = qs(countSelector);

  if (countEl) countEl.textContent = '로드 실패';
  if (area) {
    area.innerHTML =
      '<div class="empty-box">' +
      escapeHtml(message || '불러오기에 실패했습니다.') +
      '</div>';
  }
}

function renderHero(item) {
  const heroEquipmentName = qs('#heroEquipmentName');
  const heroEquipmentId = qs('#heroEquipmentId');
  const badge = qs('#heroStatusBadge');

  if (heroEquipmentName) heroEquipmentName.textContent = item.equipment_name || '장비명';
  if (heroEquipmentId) heroEquipmentId.textContent = item.equipment_id || '-';

  if (badge) {
    badge.textContent = statusLabel(item.status);
    badge.className = 'status-badge ' + statusClass(item.status);
  }
}

function renderPhoto(item) {
  const imgEl = qs('#detailPhotoImage');
  const emptyEl = qs('#detailPhotoEmpty');
  const openBtn = qs('#photoOpenBtn');
  const deleteBtn = qs('#photoDeleteBtn');

  if (!imgEl || !emptyEl) return;

  const inlineUrl = String((item && item.photo_inline_url) || '').trim();
  const directUrl = String((item && item.photo_url) || '').trim();
  const finalUrl = inlineUrl || directUrl;
  const hasPhoto = !!finalUrl;

  imgEl.onerror = function() {
    imgEl.src = '';
    imgEl.classList.add('is-hidden');
    emptyEl.classList.remove('is-hidden');
    emptyEl.textContent = '사진을 불러오지 못했습니다. 네트워크 또는 파일 접근 경로를 확인하세요.';
    if (openBtn) openBtn.style.display = 'none';
    if (deleteBtn) deleteBtn.style.display = 'none';
  };

  imgEl.onload = function() {
    emptyEl.classList.add('is-hidden');
  };

  if (hasPhoto) {
    imgEl.src = finalUrl;
    imgEl.classList.remove('is-hidden');
    emptyEl.classList.add('is-hidden');
    emptyEl.textContent = '등록된 사진이 없습니다.';
  } else {
    imgEl.src = '';
    imgEl.classList.add('is-hidden');
    emptyEl.classList.remove('is-hidden');
    emptyEl.textContent = '등록된 사진이 없습니다.';
  }

  if (openBtn) {
    openBtn.style.display = hasPhoto ? '' : 'none';
  }

  if (deleteBtn) {
    deleteBtn.style.display = hasPhoto && detailPermission.canEdit ? '' : 'none';
  }
}

function getCurrentPhotoUrl() {
  if (!currentEquipmentData) return '';
  return String(currentEquipmentData.photo_inline_url || currentEquipmentData.photo_url || '').trim();
}

function openPhotoInNewWindow() {
  const imageUrl = getCurrentPhotoUrl();
  if (!imageUrl) {
    showMessage('열 수 있는 사진이 없습니다.', 'error');
    return;
  }

  const win = window.open('', '_blank');
  if (!win) {
    showMessage('새 창을 열 수 없습니다. 팝업 차단을 확인해주세요.', 'error');
    return;
  }

  const title = escapeHtml((currentEquipmentData && currentEquipmentData.equipment_name) || '장비 사진');

  win.document.open();
  win.document.write(
    '<!DOCTYPE html>' +
    '<html lang="ko">' +
    '<head>' +
      '<meta charset="UTF-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
      '<title>' + title + '</title>' +
      '<style>' +
        'html,body{margin:0;padding:0;background:#111;height:100%;}' +
        'body{display:flex;align-items:center;justify-content:center;}' +
        'img{max-width:100vw;max-height:100vh;object-fit:contain;display:block;}' +
      '</style>' +
    '</head>' +
    '<body>' +
      '<img src="' + imageUrl + '" alt="' + title + '">' +
    '</body>' +
    '</html>'
  );
  win.document.close();
}

async function deleteCurrentPhoto() {
  if (!detailPermission.canEdit) {
    showMessage('사진을 삭제할 권한이 없습니다.', 'error');
    return;
  }

  if (!currentEquipmentId) {
    showMessage('장비 정보가 없습니다.', 'error');
    return;
  }

  const confirmed = confirm('현재 등록된 장비 사진을 삭제하시겠습니까?');
  if (!confirmed) return;

  const user = getCurrentUser();
  const userEmail = (user && user.email) || '';

  try {
    showGlobalLoading('장비 사진을 삭제하는 중...');
    await apiPost('deleteEquipmentPhoto', {
      equipment_id: currentEquipmentId,
      request_user_email: userEmail
    });

    await loadEquipmentCore(currentEquipmentId, userEmail, { resetSkeleton: false });
    invalidateDashboardSessionCacheSafe();
    showMessage('장비 사진이 삭제되었습니다.', 'success');
  } catch (error) {
    showMessage(error.message || '장비 사진 삭제 중 오류가 발생했습니다.', 'error');
  } finally {
    if (typeof hideGlobalLoading === 'function') {
      hideGlobalLoading();
    }
  }
}

async function deleteCurrentEquipment() {
  if (!detailPermission.canDelete) {
    showMessage('장비를 삭제할 권한이 없습니다.', 'error');
    return;
  }

  if (!currentEquipmentId) {
    showMessage('장비 정보가 없습니다.', 'error');
    return;
  }

  const confirmed = confirm('이 장비를 삭제하시겠습니까? 삭제 후 목록에서 제외됩니다.');
  if (!confirmed) return;

  const user = getCurrentUser();
  const userEmail = (user && user.email) || '';

  try {
    showGlobalLoading('장비를 삭제하는 중...');
    await apiPost('deleteEquipment', {
      equipment_id: currentEquipmentId,
      request_user_email: userEmail
    });

    invalidateDashboardSessionCacheSafe();
    alert('장비가 삭제되었습니다.');
    location.href = 'list.html';
  } catch (error) {
    showMessage(error.message || '장비 삭제 중 오류가 발생했습니다.', 'error');
  } finally {
    if (typeof hideGlobalLoading === 'function') {
      hideGlobalLoading();
    }
  }
}

function bindPhotoActionButtons() {
  const openBtn = qs('#photoOpenBtn');
  const deleteBtn = qs('#photoDeleteBtn');

  if (openBtn) {
    openBtn.onclick = openPhotoInNewWindow;
  }

  if (deleteBtn) {
    deleteBtn.onclick = deleteCurrentPhoto;
  }
}

function renderQrCode(equipmentId) {
  const qrBox = qs('#qrBox');
  const qrText = qs('#qrText');

  if (!qrBox || !qrText) return;

  const qrValue = buildEquipmentDetailUrl(equipmentId);
  qrBox.innerHTML = '';
  qrText.textContent = 'QR 스캔 시 장비 상세 페이지로 이동';
  qrText.title = qrValue;

  if (typeof QRCode === 'function') {
    new QRCode(qrBox, {
      text: qrValue,
      width: 180,
      height: 180
    });
  } else {
    qrBox.innerHTML =
      'QR 라이브러리를 불러오지 못했습니다.<br>아래 링크로 접근하세요.<br>' +
      escapeHtml(qrValue);
  }
}

function renderDetailInfo(item) {
  const detailInfoGrid = qs('#detailInfoGrid');
  if (!detailInfoGrid) return;

  const fields = [
    { label: '장비번호',      value: item.equipment_id },
    { label: '장비명',        value: item.equipment_name },
    { label: '모델명',        value: item.model_name },
    { label: '사용부서',      value: item.department },
    { label: '제조사',        value: item.manufacturer },
    { label: '시리얼번호',    value: item.serial_no },
    { label: '제조일자',      value: formatDisplayDate(item.manufacture_date) },
    { label: '취득일자',      value: formatDisplayDate(item.purchase_date) },
    { label: '구매처',        value: item.vendor },
    { label: '취득가액',      value: safeNumber(item.acquisition_cost) },
    { label: '담당자',        value: item.manager_name },
    { label: '연락처',        value: item.manager_phone },
    { label: '유지보수 종료', value: formatDisplayDate(item.maintenance_end_date) },
    { label: '현재 상태',     value: item.status, isStatus: true },
    { label: '현재 위치',     value: item.location },
    { label: '현재 사용자',   value: item.current_user },
    { label: '등록일시',      value: formatDisplayDateTime(item.created_at) },
    { label: '수정일시',      value: formatDisplayDateTime(item.updated_at) },
    { label: '비고',          value: item.memo || '-', wide: true }
  ];

  function buildInfoCell(field) {
    let valueHtml;
    if (field.isStatus) {
      valueHtml = '<span class="status-badge ' + statusClass(field.value) + '">' +
        escapeHtml(statusLabel(field.value)) + '</span>';
    } else {
      const display = (field.value === null || field.value === undefined || field.value === '')
        ? '-' : field.value;
      valueHtml = nl2br(display);
    }
    return (
      '<div class="info-cell">' +
        '<span class="info-cell-label">' + escapeHtml(field.label) + '</span>' +
        '<span class="info-cell-value">' + valueHtml + '</span>' +
      '</div>'
    );
  }

  const rows = [];
  let i = 0;
  while (i < fields.length) {
    const f = fields[i];
    if (f.wide) {
      rows.push('<div class="info-row info-row--wide">' + buildInfoCell(f) + '</div>');
      i++;
    } else {
      const next = (fields[i + 1] && !fields[i + 1].wide) ? fields[i + 1] : null;
      if (next) {
        rows.push('<div class="info-row">' + buildInfoCell(f) + buildInfoCell(next) + '</div>');
        i += 2;
      } else {
        rows.push('<div class="info-row">' + buildInfoCell(f) + '</div>');
        i++;
      }
    }
  }

  detailInfoGrid.innerHTML = rows.join('');
}

function buildHistoryActionButtons(item) {
  if (!detailPermission.canEdit) return '';

  // 등록자 본인 또는 admin / isAppAdmin만 수정/완료 처리 가능
  const currentUser = window.auth && typeof window.auth.getSession === 'function'
    ? window.auth.getSession()
    : null;
  const currentEmail = String((currentUser && currentUser.email) || '').trim().toLowerCase();
  const createdBy    = String(item.created_by || '').trim().toLowerCase();
  const isOwner      = currentEmail && createdBy && currentEmail === createdBy;
  const isAdmin      = detailPermission.isAdmin;
  const isAppAdmin   = detailPermission.isAppAdmin;

  if (!isOwner && !isAdmin && !isAppAdmin) return '';

  const buttons = [];
  const historyId  = item.history_id || '';
  const equipmentId = item.equipment_id || currentEquipmentId || '';

  if (String(item.result_status || '') !== 'COMPLETED') {
    buttons.push(
      '<button type="button" class="btn btn-light btn-sm js-edit-history" ' +
        'data-history-id="' + escapeHtml(historyId) + '" ' +
        'data-status="' + escapeHtml(item.result_status) + '">' +
        '수정</button>'
    );
  }

  if (String(item.history_type || '') === 'REPAIR' && String(item.result_status || '') === 'IN_PROGRESS') {
    buttons.push(
      '<button type="button" class="btn btn-primary btn-sm js-complete-history" data-history-id="' +
        escapeHtml(historyId) +
        '" data-equipment-id="' +
        escapeHtml(equipmentId) +
        '">완료 처리</button>'
    );
  }

  return buttons.length
    ? '<div class="timeline-actions">' + buttons.join('') + '</div>'
    : '';
}

function renderHistories(items) {
  const area = qs('#historyArea');
  const countText = qs('#historyCountText');
  const list = Array.isArray(items) ? items : [];

  if (countText) countText.textContent = formatNumber(list.length) + '건';
  if (!area) return;

  if (!list.length) {
    area.innerHTML = '<div class="empty-box">등록된 이력이 없습니다.</div>';
    return;
  }

  const rows = list.map(function(item) {
    const actionBtns = buildHistoryActionButtons(item);
    return (
      '<tr class="det-tbl-row">' +
        '<td class="det-tbl-cell det-tbl-cell--type">' +
          '<div class="det-tbl-main">' + escapeHtml(historyTypeLabel(item.history_type)) + '</div>' +
          '<div class="det-tbl-sub">' + safeValue(formatDisplayDate(item.work_date)) + '</div>' +
        '</td>' +
        '<td class="det-tbl-cell" style="text-align:center;">' +
          '<span class="timeline-badge ' + ResultStatusClass(item.result_status) + '">' +
            escapeHtml(resultStatusLabel(item.result_status)) +
          '</span>' +
        '</td>' +
        '<td class="det-tbl-cell det-tbl-cell--desc" style="text-align:center;">' + nl2br(item.description || '-') + '</td>' +
        (actionBtns
          ? '<td class="det-tbl-cell det-tbl-cell--actions">' + actionBtns + '</td>'
          : '') +
      '</tr>'
    );
  }).join('');

  const actionHeader = detailPermission.canEdit
    ? '<th class="det-tbl-th det-tbl-th--actions" style="text-align:center;">처리</th>'
    : '';

  area.innerHTML =
    '<div class="det-tbl-scroll">' +
      '<table class="det-tbl">' +
        '<thead><tr>' +
          '<th class="det-tbl-th det-tbl-th--type">구분 / 날짜</th>' +
          '<th class="det-tbl-th" style="text-align:center;">상태</th>' +
          '<th class="det-tbl-th det-tbl-th--desc" style="text-align:center;">내용</th>' +
          actionHeader +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>' +
    '</div>';

  bindHistoryActionButtons();
}

function renderInventoryLogs(items) {
  const area = qs('#inventoryArea');
  const countText = qs('#inventoryCountText');
  const list = Array.isArray(items) ? items : [];

  if (countText) countText.textContent = formatNumber(list.length) + '건';
  if (!area) return;

  if (!list.length) {
    area.innerHTML = '<div class="empty-box">등록된 재고조사 이력이 없습니다.</div>';
    return;
  }

  const rows = list.map(function(item) {
    return (
      '<tr class="det-tbl-row">' +
        '<td class="det-tbl-cell det-tbl-cell--type">' +
          '<div class="det-tbl-main">' + escapeHtml(conditionStatusLabel(item.condition_status)) + '</div>' +
          '<div class="det-tbl-sub">' + safeValue(formatDisplayDate(item.checked_at)) + '</div>' +
        '</td>' +
        '<td class="det-tbl-cell" style="text-align:center;">' + safeValue(item.checked_by_name || item.checked_by) + '</td>' +
        '<td class="det-tbl-cell" style="text-align:center;">' + safeValue(item.department_at_check) + '</td>' +
        '<td class="det-tbl-cell" style="text-align:center;">' + safeValue(item.location_at_check) + '</td>' +
      '</tr>'
    );
  }).join('');

  area.innerHTML =
    '<div class="det-tbl-scroll">' +
      '<table class="det-tbl">' +
        '<thead><tr>' +
          '<th class="det-tbl-th det-tbl-th--type">상태 / 날짜</th>' +
          '<th class="det-tbl-th" style="text-align:center;">점검자</th>' +
          '<th class="det-tbl-th" style="text-align:center;">부서</th>' +
          '<th class="det-tbl-th" style="text-align:center;">위치</th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>' +
    '</div>';
}

async function loadHistorySection(equipmentId, userEmail) {
  try {
    renderSectionLoading('#historyArea', '#historyCountText');

    const result = await apiGet('listHistories', {
      equipment_id: equipmentId,
      request_user_email: userEmail
    });

    renderHistories((result && result.data) || []);
  } catch (error) {
    renderSectionError('#historyArea', '#historyCountText', error.message || '이력 정보를 불러오지 못했습니다.');
  }
}

async function loadInventorySection(equipmentId, userEmail) {
  try {
    renderSectionLoading('#inventoryArea', '#inventoryCountText');

    const result = await apiGet('listInventoryLogs', {
      equipment_id: equipmentId,
      request_user_email: userEmail
    });

    renderInventoryLogs((result && result.data) || []);
  } catch (error) {
    renderSectionError('#inventoryArea', '#inventoryCountText', error.message || '재고조사 이력을 불러오지 못했습니다.');
  }
}

async function loadEquipmentCore(equipmentId, userEmail, options) {
  const opts = options || {};
  const shouldResetSkeleton = opts.resetSkeleton === true;

  if (shouldResetSkeleton) {
    renderDetailSkeleton();
  }

  const detailResult = await apiGet('getEquipment', {
    id: equipmentId,
    request_user_email: userEmail
  });

  currentEquipmentData = detailResult.data || {};

  renderHero(currentEquipmentData);
  renderPhoto(currentEquipmentData);
  renderDetailInfo(currentEquipmentData);
  renderQrCode(currentEquipmentData.equipment_id);
  applyActionVisibility();
  bindPhotoActionButtons();

  return currentEquipmentData;
}

async function reloadDetailSectionsOnly() {
  const user = getCurrentUser();
  const userEmail = (user && user.email) || '';
  if (!currentEquipmentId || !userEmail) return;

  await Promise.all([
    loadHistorySection(currentEquipmentId, userEmail),
    loadInventorySection(currentEquipmentId, userEmail)
  ]);
}

async function loadEquipmentDetail(options) {
  const opts = options || {};
  const forceReset = opts.forceReset === true;

  clearMessage();

  if (forceReset) {
    renderDetailSkeleton();
  }

  renderSectionLoading('#historyArea', '#historyCountText');
  renderSectionLoading('#inventoryArea', '#inventoryCountText');

  const id = getQueryParam('id') || currentEquipmentId;
  currentEquipmentId = id;

  if (!id) {
    throw new Error('장비 ID가 없습니다.');
  }

  const user = getCurrentUser();
  const userEmail = (user && user.email) || '';

  await loadEquipmentCore(id, userEmail, {
    resetSkeleton: forceReset
  });

  await Promise.all([
    loadHistorySection(id, userEmail),
    loadInventorySection(id, userEmail)
  ]);
}

function bindHistoryActionButtons() {
  document.querySelectorAll('.js-edit-history').forEach(function(btn) {
    btn.addEventListener('click', function() {
      const historyId = this.getAttribute('data-history-id');
      const status = this.getAttribute('data-status');
  
      if (!historyId) return;
  
      if (status === 'COMPLETED') {
        alert('완료된 이력은 수정할 수 없습니다.');
        return;
      }
  
      location.href =
        'history-form.html?equipment_id=' +
        encodeURIComponent(currentEquipmentId) +
        '&history_id=' +
        encodeURIComponent(historyId);
    });
  });

  document.querySelectorAll('.js-complete-history').forEach(function(btn) {
    btn.addEventListener('click', function() {
      const historyId = this.getAttribute('data-history-id');
      const equipmentId = this.getAttribute('data-equipment-id') || currentEquipmentId;
      if (!historyId || !equipmentId) return;
      completeRepairHistory(historyId, equipmentId);
    });
  });
}

async function completeRepairHistory(historyId, equipmentId) {
  if (!detailPermission.canEdit) return;

  const confirmed = confirm('이 수리 이력을 완료 처리하시겠습니까? 장비 상태도 사용중으로 변경됩니다.');
  if (!confirmed) return;

  const user = getCurrentUser();
  const userEmail = (user && user.email) || '';

  try {
    showGlobalLoading('수리 이력을 완료 처리하는 중...');
    await apiPost('updateHistory', {
      history_id: historyId,
      equipment_id: equipmentId,
      result_status: 'COMPLETED',
      update_equipment_status: 'IN_USE',
      updated_by: userEmail
    });

    await loadEquipmentCore(currentEquipmentId, userEmail, { resetSkeleton: false });
    await reloadDetailSectionsOnly();
    invalidateDashboardSessionCacheSafe();
    alert('완료 처리되었습니다.');
  } catch (error) {
    showMessage(error.message || '완료 처리 중 오류가 발생했습니다.', 'error');
  } finally {
    if (typeof hideGlobalLoading === 'function') {
      hideGlobalLoading();
    }
  }
}

document.addEventListener('DOMContentLoaded', async function() {
  const user = window.auth && typeof window.auth.requireAuth === 'function'
    ? window.auth.requireAuth()
    : null;

  if (!user) return;

  try {
    if (typeof showGlobalLoading === 'function') {
      showGlobalLoading('상세 정보를 불러오는 중...');
    }

    detailPermission = await getEquipmentPermissionContext();

    if (!detailPermission.canView) {
      showMessage('장비 정보를 조회할 권한이 없습니다.', 'error');
      applyActionVisibility();
      return;
    }

    await loadEquipmentDetail({ forceReset: true });

    const backBtn = qs('#backToListBtn');
    if (backBtn) {
      backBtn.addEventListener('click', function() {
        location.href = 'list.html';
      });
    }

    const editBtn = qs('#editEquipmentBtn');
    if (editBtn) {
      editBtn.addEventListener('click', function() {
        location.href = 'form.html?id=' + encodeURIComponent(currentEquipmentId);
      });
    }

    const addHistoryBtn = qs('#addHistoryBtn');
    if (addHistoryBtn) {
      addHistoryBtn.addEventListener('click', function() {
        location.href = 'history-form.html?equipment_id=' + encodeURIComponent(currentEquipmentId);
      });
    }

    const addInventoryBtn = qs('#addInventoryBtn');
    if (addInventoryBtn) {
      addInventoryBtn.addEventListener('click', function() {
        location.href = 'inventory-form.html?equipment_id=' + encodeURIComponent(currentEquipmentId);
      });
    }

    const deleteBtn = qs('#deleteBtn');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', function() {
        deleteCurrentEquipment();
      });
    }

    const printLabelBtn = qs('#printLabelBtn');
    if (printLabelBtn) {
      printLabelBtn.addEventListener('click', function() {
        location.href = 'label-print.html?equipment_id=' + encodeURIComponent(currentEquipmentId);
      });
    }

    const inspectionCertBtn = qs('#inspectionCertBtn');
    if (inspectionCertBtn) {
      inspectionCertBtn.addEventListener('click', function() {
        if (typeof generateInspectionCertPDF === 'function' && currentEquipmentData) {
          generateInspectionCertPDF(currentEquipmentData);
        }
      });
    }
  } catch (error) {
    showMessage(error.message || '상세 정보를 불러오지 못했습니다.', 'error');
  } finally {
    if (typeof hideGlobalLoading === 'function') {
      hideGlobalLoading();
    }
  }
});
