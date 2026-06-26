/**
 * qc/items.js
 * 정도관리 — 검사항목 관리 + 그룹 관리 페이지
 */

document.addEventListener('DOMContentLoaded', async () => {
  const user = window.auth?.getSession?.();
  if (!user) {
    alert('로그인 세션이 만료됐습니다.\n다시 로그인해 주세요.');
    location.replace(`${CONFIG.SITE_BASE_URL}/index.html`);
    return;
  }

  showGlobalLoading('불러오는 중...');

  try {
    const { hasAccess } = await ljInitCommon(user);

    if (!hasAccess) {
      await hideGlobalLoading(true);
      const d = document.getElementById('permissionDenied');
      if (d) d.style.display = '';
      return;
    }

    // 권한에 따라 추가 버튼 표시
    const addBtn = document.getElementById('addItemTabBtn');
    if (addBtn) addBtn.style.display = state.canEdit ? '' : 'none';
    const groupSaveBtn = document.getElementById('groupSaveBtn');
    if (groupSaveBtn && !state.canEdit) {
      groupSaveBtn.disabled = true;
      groupSaveBtn.style.opacity = '0.4';
      groupSaveBtn.style.cursor = 'not-allowed';
    }

    // 초기 렌더링
    _renderGroupTable();
    _renderItemGrid();

    // 모달 이벤트 바인딩
    document.getElementById('itemModalClose')?.addEventListener('click', closeItemModal);
    document.getElementById('itemModalCancel')?.addEventListener('click', closeItemModal);
    document.getElementById('itemModalSave')?.addEventListener('click', saveItem);
    document.getElementById('modalItemType')?.addEventListener('change', onModalTypeChange);
    document.getElementById('modalItemPreset')?.addEventListener('change', updateExpectedOptions);
    document.getElementById('itemModal')?.addEventListener('click', e => {
      if (e.target === document.getElementById('itemModal')) closeItemModal();
    });

    await hideGlobalLoading(true);
  } catch (e) {
    await hideGlobalLoading(true);
    showMessage(e.message || '불러오는 중 오류가 발생했습니다.', 'error');
  }
});

// ── 그룹 테이블 렌더링 ───────────────────────────────────────
function _renderGroupTable() {
  const wrap = document.getElementById('groupManageList');
  const list = state.groups || [];
  const ct = document.getElementById('groupCountText');
  if (ct) ct.textContent = list.length + '개';

  if (!list.length) {
    wrap.innerHTML = '<div class="qc-empty"><i class="ti ti-folder-off"></i><span>그룹이 없습니다</span></div>';
    _refreshGroupSelect();
    return;
  }

  wrap.innerHTML = list.map(g => `
    <div class="qc-group-row">
      <div class="qc-group-row-info">
        <span class="qc-group-row-name">${escHtml(g.group_name)}</span>
        ${g.memo ? `<span class="qc-group-row-memo">${escHtml(g.memo)}</span>` : ''}
      </div>
      ${state.canEdit ? `<div class="qc-group-row-actions">
        <button class="btn btn-sm" onclick="editGroup('${escHtml(g.group_id)}','${escHtml(g.group_name)}','${escHtml(g.memo||'')}')">
          <i class="ti ti-pencil"></i>
        </button>
        <button class="btn btn-sm btn-danger" onclick="deleteGroup('${escHtml(g.group_id)}','${escHtml(g.group_name)}')">
          <i class="ti ti-trash"></i>
        </button>
      </div>` : ''}
    </div>`).join('');

  _refreshGroupSelect();
}

function _refreshGroupSelect() {
  const sel = document.getElementById('modalItemGroup');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">미분류 (그룹 없음)</option>' +
    (state.groups || []).map(g =>
      `<option value="${escHtml(g.group_id)}">${escHtml(g.group_name)}</option>`).join('');
  if (cur) sel.value = cur;
}

// ── AG Grid 렌더링 ───────────────────────────────────────────
let _itemGrid = null;

function _renderItemGrid() {
  const list = state.items || [];
  const ct = document.getElementById('itemCountText');
  if (ct) ct.textContent = list.length + '건';

  const gm = {};
  (state.groups || []).forEach(g => { gm[g.group_id] = g.group_name; });

  const rowData = list.map(item => ({
    item_id:    item.item_id,
    item_name:  item.item_name,
    group_name: item.group_id ? (gm[item.group_id] || '미분류') : '미분류',
    item_type:  item.item_type === 'qualitative' ? '정성' : '정량',
    unit:       item.item_type === 'qualitative'
                  ? (QUALITATIVE_PRESETS[item.preset]?.label?.split('/')[0]?.trim() || '-')
                  : (item.unit || '-'),
    mean_sd:    item.item_type !== 'qualitative' && item.mean != null
                  ? `${item.mean} / ${item.sd}` : '-',
    _raw: item
  }));

  const colDefs = [
    { field: 'item_name',  headerName: '항목명',      flex: 1, minWidth: 80 },
    { field: 'group_name', headerName: '그룹',        width: 140,
      cellRenderer: p => p.value === '미분류'
        ? `<span style="color:#9ca3af;font-size:11px;">미분류</span>`
        : `<span style="display:inline-flex;padding:1px 7px;border-radius:999px;font-size:10px;font-weight:600;background:#eff6ff;color:#2563eb;border:1px solid #bfdbfe;">${escHtml(p.value)}</span>`
    },
    { field: 'item_type', headerName: '유형', width: 70,
      cellRenderer: p => p.value === '정성'
        ? `<span style="display:inline-flex;padding:1px 7px;border-radius:4px;font-size:10px;font-weight:700;background:#fdf4ff;color:#7e22ce;border:1px solid #e9d5ff;">정성</span>`
        : `<span style="display:inline-flex;padding:1px 7px;border-radius:4px;font-size:10px;font-weight:700;background:#f0fdf4;color:#166534;border:1px solid #bbf7d0;">정량</span>`
    },
    { field: 'unit',    headerName: '단위 / 프리셋', width: 130 },
    { field: 'mean_sd', headerName: 'Mean / SD',    width: 130, cellStyle: { textAlign: 'right' } },
    { headerName: '', width: 80, sortable: false, filter: false, suppressMovable: true,
      cellRenderer: p => state.canEdit ? `
        <div style="display:flex;gap:4px;align-items:center;height:100%;justify-content:flex-end;">
          <button class="btn btn-sm" onclick="_qcOpenEdit('${escHtml(p.data.item_id)}')"><i class="ti ti-pencil"></i></button>
          <button class="btn btn-sm btn-danger" onclick="_qcDeleteItem('${escHtml(p.data.item_id)}')"><i class="ti ti-trash"></i></button>
        </div>` : ''
    }
  ];

  if (_itemGrid) {
    _itemGrid.setGridOption('rowData', rowData);
    return;
  }

  const el = document.getElementById('itemGrid');
  if (!el) return;

  _itemGrid = agGrid.createGrid(el, {
    columnDefs: colDefs,
    rowData: rowData,
    rowHeight: 36,
    headerHeight: 34,
    defaultColDef: { sortable: true, resizable: true },
    suppressHorizontalScroll: true,
    overlayNoRowsTemplate: '<div style="padding:32px;color:#9ca3af;font-size:12px;">등록된 검사항목이 없습니다</div>',
  });
}

function _qcOpenEdit(itemId) {
  const item = (state.items || []).find(i => i.item_id === itemId);
  if (item) openItemModal(item);
}

async function _qcDeleteItem(itemId) {
  state.activeItemId = itemId;
  await deleteActiveItem();
  const res = await apiGet('ljGetItems', { request_user_email: window.auth.getSession().email });
  state.items = Array.isArray(res.data) ? res.data : [];
  _renderItemGrid();
}

// ── 그룹 관련 함수 (기존 유지) ──────────────────────────────
function resetGroupForm() {
  $('groupModalGroupId').value   = '';
  $('groupModalGroupName').value = '';
  $('groupModalMemo').value      = '';
  $('groupSaveBtn').textContent  = '추가';
  $('groupFormTitle').textContent = '새 그룹 추가';
  const cancelBtn = $('groupCancelEditBtn');
  if (cancelBtn) cancelBtn.style.display = 'none';
}

function editGroup(groupId, groupName, memo) {
  $('groupModalGroupId').value   = groupId;
  $('groupModalGroupName').value = groupName;
  $('groupModalMemo').value      = memo || '';
  $('groupSaveBtn').textContent  = '수정';
  $('groupFormTitle').textContent = '그룹 수정';
  const cancelBtn = $('groupCancelEditBtn');
  if (cancelBtn) cancelBtn.style.display = '';
  $('groupModalGroupName').focus();
}

async function saveGroup() {
  const user      = window.auth?.getSession?.();
  const groupId   = $('groupModalGroupId').value.trim();
  const groupName = $('groupModalGroupName').value.trim();
  const memo      = $('groupModalMemo').value.trim();

  if (!groupName) { $('groupModalGroupName').focus(); return; }

  const isEdit  = !!groupId;
  const action  = isEdit ? 'ljUpdateGroup' : 'ljCreateGroup';
  const payload = { request_user_email: user.email, group_name: groupName, memo };
  if (isEdit) payload.group_id = groupId;

  // 수정은 낙관적 업데이트, 신규 추가는 서버 응답 후 반영 (임시ID 문제 방지)
  const prevGroups = [...state.groups];
  if (isEdit) {
    state.groups = state.groups.map(g =>
      g.group_id === groupId ? { ...g, group_name: groupName, memo } : g
    );
    _renderGroupTable();
    
    resetGroupForm();
  }

  const btn = $('groupSaveBtn');
  try {
    btn.disabled    = true;
    btn.textContent = isEdit ? '수정 중...' : '추가 중...';
    if (!isEdit) showGroupSpinner('그룹 추가 중...');
    await apiPost(action, payload);
    const res = await apiGet('ljGetGroups', { request_user_email: user.email });
    state.groups = Array.isArray(res.data) ? res.data : [];
    renderGroupTabs();
    
    _renderGroupTable();
    renderAssignPanel(state._editingGroupId);
    if (!isEdit) resetGroupForm();
  } catch (err) {
    if (isEdit) {
      state.groups = prevGroups;
      _renderGroupTable();
      
    }
    alert(err.message || '저장에 실패했습니다.');
  } finally {
    btn.disabled    = false;
    btn.textContent = isEdit ? '수정' : '추가';
    if (!isEdit) hideGroupSpinner();
  }
}

async function deleteGroup(groupId, groupName) {
  if (!confirm(`"${groupName}" 그룹을 삭제하시겠습니까?\n하위 항목은 미분류로 이동됩니다.`)) return;

  const user = window.auth?.getSession?.();

  // 낙관적 업데이트 — 즉시 제거
  const prevGroups = [...state.groups];
  const prevItems  = state.items.map(it => ({ ...it }));
  state.groups = state.groups.filter(g => g.group_id !== groupId);
  state.items  = state.items.map(it => it.group_id === groupId ? { ...it, group_id: '' } : it);
  if (state.activeGroupId === groupId)  { state.activeGroupId  = null; }
  if (state._editingGroupId === groupId){ state._editingGroupId = null; renderAssignPanel(null); }
  renderGroupTabs();
  
  _renderGroupTable();
  _renderItemGrid();

  try {
    await apiPost('ljDeleteGroup', { request_user_email: user.email, group_id: groupId });
    const res = await apiGet('ljGetGroups', { request_user_email: user.email });
    state.groups = Array.isArray(res.data) ? res.data : [];
    renderGroupTabs();
    
    _renderGroupTable();
  } catch (err) {
    state.groups = prevGroups;
    state.items  = prevItems;
    renderGroupTabs();
    
    _renderGroupTable();
    _renderItemGrid();
    alert(err.message || '삭제에 실패했습니다.');
  }
}


function getActiveItem() {
  return state.items.find(it => it.item_id === state.activeItemId) || null;
}

// ─────────────────────────────────────────────
// 설정 표시
// ─────────────────────────────────────────────
function renderSettingsDisplay(item) {

function onModalTypeChange() {
  const type = $('modalItemType').value;
  const isQual = type === 'qualitative';
  $('quantitativeFields').style.display = isQual ? 'none' : 'contents';
  $('qualitativeFields').style.display  = isQual ? 'contents' : 'none';
  if (isQual) updateExpectedOptions();
}

function updateExpectedOptions(selectedExpected) {
  const preset = $('modalItemPreset').value;
  const values = QUALITATIVE_PRESETS[preset]?.values || [];
  $('modalItemExpected').innerHTML = values.map(v =>
    `<option value="${escHtml(v)}" ${v === selectedExpected ? 'selected' : ''}>${escHtml(v)}</option>`
  ).join('');
}

function openItemModal(item) {
  const user    = window.auth.getSession();
  const isAdmin = String(user.role || '').trim().toLowerCase() === 'admin';

  $('itemModalTitle').textContent = item ? '검사 항목 수정' : '검사 항목 추가';
  $('modalItemId').value   = item ? item.item_id : '';
  $('modalItemName').value = item ? item.item_name : '';
  $('modalItemMemo').value = item ? (item.memo || '') : '';

  // 현재 부서 필터값 (관리자 전용)
  const filterClinic = $('clinicFilterSelect')?.value || '';
  const filterTeam   = $('teamFilterSelect')?.value   || '';

  // 그룹 셀렉트 — 현재 팀/의원 필터에 맞는 그룹만 표시
  const groupSel = $('modalItemGroup');
  if (groupSel) {
    const visibleGroups = state.groups.filter(g => {
      if (filterTeam   && g.team_code   && g.team_code   !== filterTeam)   return false;
      if (filterClinic && g.clinic_code && g.clinic_code !== filterClinic) return false;
      return true;
    });
    groupSel.innerHTML = '<option value="" selected>미분류 (그룹 없음)</option>' +
      visibleGroups.map(g =>
        `<option value="${escHtml(g.group_id)}" ${item && item.group_id === g.group_id ? 'selected' : ''}>${escHtml(g.group_name)}</option>`
      ).join('');
    // 그룹 탭에서 열면 해당 그룹 자동 선택
    if (!item && state.activeGroupId && state.activeGroupId !== '__ungrouped__') {
      groupSel.value = state.activeGroupId;
    }
  }

  // admin에게만 부서 선택 표시
  if (isAdmin && state.orgData) {
    $('modalOrgFields').style.display = 'contents';
    const clinics = state.orgData.clinics || [];
    const teams   = state.orgData.teams   || [];

    $('modalItemClinic').innerHTML = '<option value="">의원 선택</option>' +
      clinics.map(c => `<option value="${escHtml(c.code_value)}"
        ${(item?.clinic_code || filterClinic) === c.code_value ? 'selected' : ''}
        >${escHtml(c.code_name)}</option>`).join('');

    const appliedClinic = item?.clinic_code || filterClinic || '';

    const filterTeamsFn = (clinicCode) => {
      $('modalItemTeam').innerHTML = '<option value="">팀 선택</option>' +
        teams.filter(t => !clinicCode || t.parent_code === clinicCode)
             .map(t => `<option value="${escHtml(t.code_value)}"
               ${(item?.team_code || filterTeam) === t.code_value ? 'selected' : ''}
               >${escHtml(t.code_name)}</option>`).join('');
    };
    filterTeamsFn(appliedClinic);

    $('modalItemClinic').onchange = () => filterTeamsFn($('modalItemClinic').value);
  } else {
    $('modalOrgFields').style.display = 'none';
  }

  const type = item ? (item.item_type || 'quantitative') : 'quantitative';
  $('modalItemType').value = type;

  if (type === 'qualitative') {
    $('quantitativeFields').style.display = 'none';
    $('qualitativeFields').style.display  = 'contents';
    const preset = item?.preset || 'pos_neg';
    $('modalItemPreset').value = preset;
    updateExpectedOptions(item?.expected_value);
    $('modalItemUnit').value    = '';
    $('modalItemMean').value    = '';
    $('modalItemSd').value      = '';
    $('modalItemDecimal').value = '3';
  } else {
    $('quantitativeFields').style.display = 'contents';
    $('qualitativeFields').style.display  = 'none';
    $('modalItemUnit').value    = item ? item.unit  : '';
    $('modalItemMean').value    = item ? item.mean  : '';
    $('modalItemSd').value      = item ? item.sd    : '';
    $('modalItemDecimal').value = item ? String(item.decimal_places ?? 3) : '3';
  }

  $('itemModal').style.display = '';
  setTimeout(() => $('modalItemName').focus(), 50);
}

function closeItemModal() {
  $('itemModal').style.display = 'none';
}

async function saveItem() {
  const itemId   = $('modalItemId').value.trim();
  const itemName = $('modalItemName').value.trim();
  const itemType = $('modalItemType').value;
  const memo     = $('modalItemMemo').value.trim();

  if (!itemName) { alert('검사 항목명을 입력하세요.'); $('modalItemName').focus(); return; }

  const user = window.auth.getSession();
  const isAdmin = String(user.role || '').trim().toLowerCase() === 'admin';
  const isEdit = !!itemId;
  let payload;

  // admin이면 선택한 org 값 포함
  const clinicCode = isAdmin ? $('modalItemClinic').value : '';
  const teamCode   = isAdmin ? $('modalItemTeam').value   : '';

  if (isAdmin && !teamCode) { alert('팀을 선택하세요.'); return; }

  if (itemType === 'qualitative') {
    const preset        = $('modalItemPreset').value;
    const expectedValue = $('modalItemExpected').value;
    if (!preset)        { alert('결과값 프리셋을 선택하세요.'); return; }
    if (!expectedValue) { alert('기대 결과값을 선택하세요.'); return; }
    payload = { item_name: itemName, item_type: 'qualitative', preset, expected_value: expectedValue, unit: '', mean: '', sd: '', memo, clinic_code: clinicCode, team_code: teamCode, request_user_email: user.email };
  } else {
    const unit = $('modalItemUnit').value.trim();
    const mean = parseFloat($('modalItemMean').value);
    const sd   = parseFloat($('modalItemSd').value);
    if (!unit)           { alert('단위를 입력하세요.');         $('modalItemUnit').focus(); return; }
    if (isNaN(mean))     { alert('목표 평균을 입력하세요.');    $('modalItemMean').focus(); return; }
    if (isNaN(sd)||sd<=0){ alert('표준편차를 올바르게 입력하세요.'); $('modalItemSd').focus(); return; }
    const decimalPlaces = parseInt($('modalItemDecimal').value) || 4;
    payload = { item_name: itemName, item_type: 'quantitative', unit, mean, sd, decimal_places: decimalPlaces, memo, preset: '', expected_value: '', clinic_code: clinicCode, team_code: teamCode, request_user_email: user.email };
  }

  if (isEdit) payload.item_id = itemId;
  payload.group_id = $('modalItemGroup')?.value || '';

  try {
    showGlobalLoading(isEdit ? '항목 수정 중...' : '항목 저장 중...');
    closeItemModal();
    if (isEdit) {
      await apiPost('ljUpdateItem', payload);
    } else {
      await apiPost('ljCreateItem', payload);
    }

    // 서버에서 최신 목록 재조회
    const result = await apiGet('ljGetItems', { request_user_email: user.email });
    state.items = Array.isArray(result.data) ? result.data : [];

    // entries 캐시 전체 초기화 (부서 전환 시 이전 데이터 잔류 방지)
    state.entries = {};
    state.activeItemId = null;

    // 수정이면 같은 항목 유지, 신규면 마지막 항목 선택
    const targetId = isEdit
      ? itemId
      : state.items[state.items.length - 1]?.item_id;

    if (targetId) {
      // entries 캐시 무효화 (설정 변경 반영)
      if (isEdit) delete state.entries[targetId];
      
    }
    showMessage(isEdit ? '항목이 수정되었습니다.' : '항목이 추가되었습니다.', 'success');
  } catch (e) {
    showMessage(e.message || '저장에 실패했습니다.', 'error');
  } finally {
    hideGlobalLoading();
  }
}

async function deleteActiveItem() {
  const item = getActiveItem();
  if (!item) return;
  if (!confirm(`"${item.item_name}" 항목을 삭제하시겠습니까?\n입력된 모든 데이터도 함께 삭제됩니다.`)) return;

  const user = window.auth.getSession();
  try {
    showGlobalLoading('항목 삭제 중...');
    await apiPost('ljDeleteItem', {
      item_id: item.item_id,
      request_user_email: user.email
    });

    state.items = state.items.filter(it => it.item_id !== item.item_id);
    delete state.entries[item.item_id];
    state.activeItemId = null;

    if (state.chart) { state.chart.destroy(); state.chart = null; }

    _renderItemGrid();
    if (state.items.length > 0) {
      
    } else {
      showItemEmptyState();
    }
    showMessage('항목이 삭제되었습니다.', 'success');
  } catch (e) {
    showMessage(e.message || '삭제에 실패했습니다.', 'error');
  } finally {
    hideGlobalLoading();
  }
}

// ─────────────────────────────────────────────
// 데이터 입력 / 삭제
// ─────────────────────────────────────────────
