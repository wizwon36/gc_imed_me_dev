/**
 * qc/items.js
 * 정도관리 — 검사항목 관리 + 그룹 관리 페이지
 */

document.addEventListener('DOMContentLoaded', async () => {
  const user = window.auth?.getSession?.();
  if (!user) {
    alert('로그인 세션이 만료되었습니다.\n다시 로그인해 주세요.');
    location.replace(`${CONFIG.SITE_BASE_URL}/index.html`);
    return;
  }

  showGlobalLoading('불러오는 중...');

  try {
    const { hasAccess, orgResult } = await ljInitCommon(user);

    // org 필터 UI 세팅 (변경 시 항목 목록 갱신)
    ljSetupOrgFilter(orgResult, () => {
      state.activeItemId  = null;
      state.activeGroupId = null;
      renderGroupFilterSelect();
      renderItemSelect();
    });

    if (!hasAccess) {
      await hideGlobalLoading(true);
      const d = $('permissionDenied');
      if (d) d.style.display = '';
      return;
    }

    // 항목 없음 버튼 비활성화
    if (!state.canEdit) {
      const addBtn = $('addItemTabBtn');
      if (addBtn) { addBtn.disabled = true; addBtn.style.opacity = '0.4'; addBtn.style.cursor = 'not-allowed'; }
    }

    renderGroupFilterSelect();
    renderItemSelect();

    bindItemsEvents();
    await hideGlobalLoading(true);
  } catch (e) {
    await hideGlobalLoading(true);
    showMessage(e.message || '불러오는 중 오류가 발생했습니다.', 'error');
  }
});

function bindItemsEvents() {
  $('addItemTabBtn')?.addEventListener('click', () => openItemModal(null));

  $('editItemBtn')?.addEventListener('click', () => {
    const item = getActiveItem();
    if (item) openItemModal(item);
  });

  $('deleteItemBtn')?.addEventListener('click', deleteActiveItem);

  $('itemSelect')?.addEventListener('change', e => {
    if (e.target.value) selectItem(e.target.value);
  });

  $('groupFilterSelect')?.addEventListener('change', e => onGroupFilterChange(e.target.value));

  $('itemModalClose')?.addEventListener('click', closeItemModal);
  $('itemModalCancel')?.addEventListener('click', closeItemModal);
  $('itemModalSave')?.addEventListener('click', saveItem);
  $('modalItemType')?.addEventListener('change', onModalTypeChange);
  $('modalItemPreset')?.addEventListener('change', updateExpectedOptions);

  $('itemModal')?.addEventListener('click', e => {
    if (e.target === $('itemModal')) closeItemModal();
  });
}

// ── 이하: 기존 qc 소스 파일 에서 groups/items 관련 함수 전체 ──
function renderGroupTabs() {
  // 하위 호환 — groupTabsWrap이 있으면 비움
  const wrap = $('groupTabsWrap');
  if (wrap) wrap.innerHTML = '';

  renderGroupFilterSelect();
}

function renderGroupFilterSelect() {
  const sel = $('groupFilterSelect');
  if (!sel) return;

  const filterTeam   = $('teamFilterSelect')?.value   || '';
  const filterClinic = $('clinicFilterSelect')?.value || '';

  // 현재 팀/의원 필터에 맞는 그룹만 표시
  const visibleGroups = state.groups.filter(g => {
    if (filterTeam   && g.team_code   && g.team_code   !== filterTeam)   return false;
    if (filterClinic && g.clinic_code && g.clinic_code !== filterClinic) return false;
    return true;
  });

  sel.innerHTML = '<option value="">전체 그룹</option>' +
    visibleGroups.map(g =>
      `<option value="${escHtml(g.group_id)}" ${g.group_id === state.activeGroupId ? 'selected' : ''}>${escHtml(g.group_name)}</option>`
    ).join('') +
    '<option value="__ungrouped__" ' + (state.activeGroupId === '__ungrouped__' ? 'selected' : '') + '>미분류</option>';

  // 현재 선택된 그룹이 필터에 안 맞으면 초기화
  if (state.activeGroupId && state.activeGroupId !== '__ungrouped__') {
    const still = visibleGroups.find(g => g.group_id === state.activeGroupId);
    if (!still) {
      state.activeGroupId = null;
      sel.value = '';
    }
  }
}

function onGroupFilterChange(val) {
  state.activeGroupId = val || null;
  state.activeItemId  = null;
  renderItemSelect();
}

function selectGroup(groupId) {
  state.activeGroupId = groupId;
  state.activeItemId  = null;
  renderGroupFilterSelect();
  renderItemSelect();
}

function showGroupSpinner(text) {
  const el = $('groupModalSpinner');
  if (!el) return;
  $('groupModalSpinnerText').textContent = text || '';
  el.style.display = 'flex';
}

function hideGroupSpinner() {
  const el = $('groupModalSpinner');
  if (el) el.style.display = 'none';
}

function openGroupManageModal() {
  state._editingGroupId = null;
  renderGroupManageList();
  renderAssignPanel(null);
  $('groupManageModal').classList.add('open');
}

function closeGroupManageModal() {
  $('groupManageModal').classList.remove('open');
  resetGroupForm();
  state._editingGroupId = null;
}

// ── 그룹 목록 ──────────────────────────────
function renderGroupManageList() {
  const list = $('groupManageList');
  if (!list) return;

  const filterTeam   = $('teamFilterSelect')?.value   || '';
  const filterClinic = $('clinicFilterSelect')?.value || '';

  const visibleGroups = state.groups.filter(g => {
    if (filterTeam   && g.team_code   && g.team_code   !== filterTeam)   return false;
    if (filterClinic && g.clinic_code && g.clinic_code !== filterClinic) return false;
    return true;
  });

  if (visibleGroups.length === 0) {
    list.innerHTML = '<p style="font-size:12px;color:#94a3b8;text-align:center;padding:12px 0;">그룹이 없습니다</p>';
    return;
  }

  list.innerHTML = visibleGroups.map(g => {
    const isActive = g.group_id === state._editingGroupId;
    const cnt = state.items.filter(it => it.group_id === g.group_id).length;
    return `
      <div class="lj-gm-group-row${isActive ? ' is-active' : ''}"
        onclick="selectGroupForAssign('${escHtml(g.group_id)}')">
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(g.group_name)}</div>
          <div style="font-size:10px;color:#94a3b8;margin-top:1px;">항목 ${cnt}개</div>
        </div>
        <div style="display:flex;gap:2px;flex-shrink:0;">
          <button class="task-icon-btn" title="수정"
            onclick="event.stopPropagation();editGroup('${escHtml(g.group_id)}','${escHtml(g.group_name)}','${escHtml(g.memo||'')}')">✎</button>
          <button class="task-icon-btn danger" title="삭제"
            onclick="event.stopPropagation();deleteGroup('${escHtml(g.group_id)}','${escHtml(g.group_name)}')">🗑</button>
        </div>
      </div>`;
  }).join('');
}

// ── 그룹 선택 → 오른쪽 패널 갱신 ──────────
function selectGroupForAssign(groupId) {
  state._editingGroupId = groupId;
  renderGroupManageList();
  renderAssignPanel(groupId);
}

function renderAssignPanel(groupId) {
  const empty  = $('assignPanelEmpty');
  const panel  = $('assignPanel');
  if (!empty || !panel) return;

  if (!groupId) {
    empty.style.display = '';
    panel.style.display = 'none';
    return;
  }

  const group = state.groups.find(g => g.group_id === groupId);
  if (!group) return;

  empty.style.display = 'none';
  panel.style.display = 'flex';
  $('assignPanelTitle').textContent = group.group_name;

  const filterTeam   = $('teamFilterSelect')?.value   || '';
  const filterClinic = $('clinicFilterSelect')?.value || '';

  // 같은 팀 항목만 + 현재 팀/의원 필터도 적용
  const sameTeamItems = state.items.filter(it => {
    if (filterTeam   && (it.team_code   || '') !== filterTeam)   return false;
    if (filterClinic && (it.clinic_code || '') !== filterClinic) return false;
    if (group.team_code && it.team_code && it.team_code !== group.team_code) return false;
    return true;
  });
  const assigned   = sameTeamItems.filter(it => it.group_id === groupId);
  const unassigned = sameTeamItems.filter(it => !it.group_id || it.group_id === '');

  $('assignedCount').textContent   = assigned.length ? `(${assigned.length})` : '';
  $('unassignedCount').textContent = unassigned.length ? `(${unassigned.length})` : '';

  const makeChip = (it, toGroup) => `
    <div class="lj-assign-chip" title="${toGroup ? '그룹에서 제거' : '그룹에 추가'}"
      onclick="toggleItemGroup('${escHtml(it.item_id)}','${toGroup ? '' : escHtml(groupId)}')">
      <span>${escHtml(it.item_name)}</span>
      <span style="font-size:10px;opacity:.6;">${toGroup ? '✕' : '＋'}</span>
    </div>`;

  $('assignedItems').innerHTML   = assigned.length
    ? assigned.map(it => makeChip(it, true)).join('')
    : '<p style="font-size:12px;color:#94a3b8;padding:12px;text-align:center;">배정된 항목 없음</p>';

  $('unassignedItems').innerHTML = unassigned.length
    ? unassigned.map(it => makeChip(it, false)).join('')
    : '<p style="font-size:12px;color:#94a3b8;padding:12px;text-align:center;">미배정 항목 없음</p>';
}

async function toggleItemGroup(itemId, groupId) {
  const user = window.auth?.getSession?.();
  const item = state.items.find(it => it.item_id === itemId);
  if (!item) return;

  const prevGroupId = item.group_id || '';

  // 즉시 state 업데이트 → UI 먼저 반영 (낙관적 업데이트)
  state.items = state.items.map(it =>
    it.item_id === itemId ? { ...it, group_id: groupId } : it
  );
  renderGroupManageList();
  renderAssignPanel(state._editingGroupId);
  renderGroupFilterSelect();
  renderItemSelect();

  try {
    await apiPost('ljUpdateItem', {
      request_user_email: user.email,
      item_id:   itemId,
      item_name: item.item_name,
      item_type: item.item_type,
      unit:      item.unit || '',
      mean:      item.mean !== '' ? item.mean : '',
      sd:        item.sd   !== '' ? item.sd   : '',
      preset:    item.preset || '',
      expected_value: item.expected_value || '',
      memo:      item.memo || '',
      group_id:  groupId,
      clinic_code: item.clinic_code || '',
      team_code:   item.team_code   || ''
    });
  } catch (err) {
    // 실패 시 롤백
    state.items = state.items.map(it =>
      it.item_id === itemId ? { ...it, group_id: prevGroupId } : it
    );
    renderGroupManageList();
    renderAssignPanel(state._editingGroupId);
    renderGroupFilterSelect();
    renderItemSelect();
    alert(err.message || '변경에 실패했습니다.');
  }
}

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
    renderGroupManageList();
    renderGroupFilterSelect();
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
    renderGroupFilterSelect();
    renderGroupManageList();
    renderAssignPanel(state._editingGroupId);
    if (!isEdit) resetGroupForm();
  } catch (err) {
    if (isEdit) {
      state.groups = prevGroups;
      renderGroupManageList();
      renderGroupFilterSelect();
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
  renderGroupFilterSelect();
  renderGroupManageList();
  renderItemSelect();

  try {
    await apiPost('ljDeleteGroup', { request_user_email: user.email, group_id: groupId });
    const res = await apiGet('ljGetGroups', { request_user_email: user.email });
    state.groups = Array.isArray(res.data) ? res.data : [];
    renderGroupTabs();
    renderGroupFilterSelect();
    renderGroupManageList();
  } catch (err) {
    state.groups = prevGroups;
    state.items  = prevItems;
    renderGroupTabs();
    renderGroupFilterSelect();
    renderGroupManageList();
    renderItemSelect();
    alert(err.message || '삭제에 실패했습니다.');
  }
}

function renderItemSelect() {
  const selectEl = $('itemSelect');
  if (!selectEl) return;

  const filterClinic  = $('clinicFilterSelect')?.value || '';
  const filterTeam    = $('teamFilterSelect')?.value   || '';

  const filteredItems = state.items.filter(it => {
    if (filterTeam   && (it.team_code   || '') !== filterTeam)   return false;
    if (filterClinic && (it.clinic_code || '') !== filterClinic) return false;
    if (state.activeGroupId === '__ungrouped__') return !(it.group_id);
    if (state.activeGroupId) return (it.group_id || '') === state.activeGroupId;
    return true;
  });

  selectEl.innerHTML = '<option value="">검사 항목을 선택하세요</option>' +
    filteredItems.map(item =>
      `<option value="${escHtml(item.item_id)}" ${item.item_id === state.activeItemId ? 'selected' : ''}>${escHtml(item.item_name)}</option>`
    ).join('');

  // 빈 상태 메시지 처리
  const emptyState = $('itemEmptyState');
  if (emptyState) {
    emptyState.style.display = filteredItems.length === 0 ? '' : 'none';
  }
}

function selectItem(itemId) {
  state.activeItemId = itemId;
  renderItemSelect();

  const item = getActiveItem();
  if (!item) return;

  // 스피너 + 스켈레톤 표시
  showGlobalLoading('불러오는 중...');
  $('skeletonBody').style.display = 'block';
  $('appBody').style.display = 'none';

  // 비동기로 처리 (UI 블로킹 방지)
  (async () => {
    try {
      if (!state.entries[itemId]) {
        await loadEntriesForItem(itemId, true);
      }

      // 렌더링
      $('itemEmptyState').style.display = 'none';
      $('settingsSection').style.display = '';
      $('dataEntrySection').style.display = state.canEdit ? '' : 'none';
      $('dateFilterSection').style.display = '';
      $('editItemBtn').style.display   = state.canEdit ? '' : 'none';
      $('deleteItemBtn').style.display = state.canEdit ? '' : 'none';
      $('settingsSectionTitle').textContent = item.item_name;
      $('chartSectionTitle').textContent = `L-J 차트 — ${item.item_name}`;

      // 타입에 따라 입력 UI / 테이블 헤더 전환
      const isQual = item.item_type === 'qualitative';
      $('entryValueField').style.display  = isQual ? 'none' : '';
      $('entryResultField').style.display = isQual ? '' : 'none';
      // 소수점 자리수에 맞게 step 설정
      if (!isQual) {
        const dec = getDecimals(item);
        $('entryValue').step        = dec === 0 ? '1' : '0.' + '0'.repeat(dec - 1) + '1';
        $('entryValue').placeholder = dec === 0 ? '0' : '0.' + '0'.repeat(dec);
      }
      if (isQual) {
        const preset = QUALITATIVE_PRESETS[item.preset];
        if (preset) {
          $('entryResult').innerHTML = preset.values.map(v =>
            `<option value="${escHtml(v)}">${escHtml(v)}</option>`
          ).join('');
        }
      }
      $('dataTableHead').innerHTML = isQual
        ? `<tr>
            <th style="width:140px;text-align:center;">측정일</th>
            <th style="width:140px;">결과값</th>
            <th style="width:100px;">판정</th>
            <th class="col-memo">메모</th>
            <th style="width:120px;"></th>
           </tr>`
        : `<tr>
            <th style="width:140px;text-align:center;">측정일</th>
            <th style="width:110px;">측정값</th>
            <th style="width:80px;">SDI</th>
            <th style="width:190px;">Westgard 판정</th>
            <th class="col-memo">메모</th>
            <th style="width:120px;"></th>
           </tr>`;
      // 정성적이면 차트 섹션 숨김
      $('chartSection').style.display = isQual ? 'none' : '';

      renderSettingsDisplay(item);
      renderItemSelect();
      updateDateFilterInfo();
      renderDataTable();
      renderStats();
      if (!isQual) renderChart();
    } finally {
      $('skeletonBody').style.display = 'none';
      $('appBody').style.display = '';
      await hideGlobalLoading();
    }
  })();
}

function showItemEmptyState() {
  $('itemEmptyState').style.display = '';
  $('settingsSection').style.display = 'none';
  $('dataEntrySection').style.display = 'none';
  $('dateFilterSection').style.display = 'none';
  $('statsSection').style.display = 'none';
  $('chartSection').style.display = 'none';
  $('editItemBtn').style.display = 'none';
  $('deleteItemBtn').style.display = 'none';

  // 항목이 있으면 "선택하세요", 없으면 "추가하세요"
  const hasItems = state.items.length > 0;
  const titleEl = $('itemEmptyTitle');
  const descEl  = $('itemEmptyDesc');
  if (titleEl) titleEl.textContent = hasItems ? '검사 항목을 선택하세요' : '등록된 검사 항목이 없습니다';
  if (descEl)  descEl.innerHTML    = hasItems
    ? '위의 셀렉트에서 검사 항목을 선택하세요.'
    : '<strong>+ 항목 추가</strong> 버튼을 눌러 첫 번째 검사 항목을 추가하세요.';
}

function getActiveItem() {
  return state.items.find(it => it.item_id === state.activeItemId) || null;
}

// ─────────────────────────────────────────────
// 설정 표시
// ─────────────────────────────────────────────
function renderSettingsDisplay(item) {
  $('settingsSectionTitle').textContent = item.item_name;
  const descEl = $('settingsSection').querySelector('.sub-text');
  if (descEl) descEl.textContent = '목표 평균과 표준편차 기준입니다.';

  if (item.item_type === 'qualitative') {
    const preset = QUALITATIVE_PRESETS[item.preset] || {};
    const values = preset.values || [];
    $('settingsDisplay').innerHTML = `
      <div class="kpi-card">
        <div class="kpi-label">관리 유형</div>
        <div style="font-size:18px;font-weight:900;color:#0b1f44;line-height:1;letter-spacing:-0.02em;">정성적 (Qualitative)</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">기대 결과값 (정상)</div>
        <div style="font-size:18px;font-weight:900;color:#15803d;line-height:1;letter-spacing:-0.02em;">${escHtml(item.expected_value || '-')}</div>
      </div>
      <div class="kpi-card" style="grid-column:1/-1;max-height:none;">
        <div class="kpi-label" style="margin-bottom:8px;">결과값 프리셋</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${values.map(v => `<span style="padding:4px 12px;border-radius:20px;background:${v===item.expected_value?'#dcfce7':'#f1f5f9'};color:${v===item.expected_value?'#15803d':'#64748b'};font-size:13px;font-weight:${v===item.expected_value?'800':'600'};border:1.5px solid ${v===item.expected_value?'#86efac':'#e2e8f0'};">${escHtml(v)}</span>`).join('')}
        </div>
      </div>
    `;
    return;
  }

  const mean = Number(item.mean);
  const sd   = Number(item.sd);
  const tiles = [
    { label: '목표 평균 (Mean)', value: fmt(mean,         item), unit: item.unit },
    { label: '표준편차 (SD)',    value: fmt(sd,            item), unit: item.unit },
    { label: '+2SD 상한',        value: fmt(mean + 2*sd,   item), unit: item.unit },
    { label: '-2SD 하한',        value: fmt(mean - 2*sd,   item), unit: item.unit }
  ];

  let html = tiles.map(t => `
    <div class="kpi-card">
      <div class="kpi-label">${escHtml(t.label)}</div>
      <div style="font-size:22px;font-weight:900;color:#0b1f44;line-height:1;letter-spacing:-0.03em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(t.value)} <span style="font-size:13px;font-weight:600;color:#8494aa;">${escHtml(t.unit)}</span></div>
    </div>
  `).join('');

  if (item.memo) {
    html += `<div class="kpi-card full-span"><div class="kpi-label">메모</div><div style="font-size:14px;font-weight:600;color:#334155;">${escHtml(item.memo)}</div></div>`;
  }
  $('settingsDisplay').innerHTML = html;
}

// ─────────────────────────────────────────────
// 검사 항목 모달
// ─────────────────────────────────────────────
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
      await selectItem(targetId);
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

    renderItemSelect();
    if (state.items.length > 0) {
      selectItem(state.items[0].item_id);
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
