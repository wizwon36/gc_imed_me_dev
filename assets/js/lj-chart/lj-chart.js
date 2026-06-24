/**
 * lj-chart.js
 * 정도관리 시스템 앱 - 프론트엔드
 * app_id: 'lj_chart'
 */

const APP_ID = 'lj_chart';

// 로컬 날짜 헬퍼 — toISOString()은 UTC 기준이라 UTC+9(KST) 환경에서
// 오전 9시 이전에 하루 전 날짜가 반환되는 버그가 있음. 이 함수로 대체.
function todayYmd() {
  const d = new Date();
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}
function dateToYmd(d) {
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

// 소수점 자리수 헬퍼
function getDecimals(item) {
  const d = parseInt(item?.decimal_places ?? 3);
  return isNaN(d) ? 4 : Math.min(Math.max(d, 0), 4);
}
function fmt(value, item) {
  return Number(value).toFixed(getDecimals(item));
}

// ─────────────────────────────────────────────
// 정성적 프리셋 정의
// ─────────────────────────────────────────────
const QUALITATIVE_PRESETS = {
  pos_neg:      { label: 'Positive / Negative',                          values: ['Negative', 'Positive'] },
  reactive:     { label: 'Reactive / Non-Reactive',                      values: ['Non-Reactive', 'Reactive'] },
  detected:     { label: 'Detected / Not Detected',                      values: ['Not Detected', 'Detected'] },
  neg_plus:     { label: 'Negative / Trace / 1+ / 2+ / 3+ / 4+',        values: ['Negative', 'Trace', '1+', '2+', '3+', '4+'] },
  weak_reactive:{ label: 'Non-Reactive / Weakly Reactive / Reactive',    values: ['Non-Reactive', 'Weakly Reactive', 'Reactive'] },
  weak_pos:     { label: 'Negative / Weak Positive / Positive / Strong Positive', values: ['Negative', 'Weak Positive', 'Positive', 'Strong Positive'] }
};

// ─────────────────────────────────────────────
// 상태
// ─────────────────────────────────────────────
let state = {
  groups: [],          // 그룹 목록
  activeGroupId: null, // 선택된 그룹 ID (null = 전체)
  items: [],
  activeItemId: null,
  entries: {},
  chart: null,
  orgData: null,
  dateFrom: '',
  dateTo: '',
  canEdit: false       // edit 이상 권한 여부
};

// ─────────────────────────────────────────────
// DOM 참조
// ─────────────────────────────────────────────
const $ = id => document.getElementById(id);

// ─────────────────────────────────────────────
// 초기화
// ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const user = window.auth?.getSession?.();
  if (!user) {
    alert('로그인 세션이 만료되었습니다.\n다시 로그인해 주세요.');
    location.replace(`${CONFIG.SITE_BASE_URL}/index.html`);
    return;
  }

  $('skeletonBody').style.display = 'block';
  showGlobalLoading('불러오는 중...');
  bindEvents();

  try {
    const isAdmin = String(user.role || '').trim().toLowerCase() === 'admin';

    const permissionPromise = isAdmin
      ? Promise.resolve(true)
      : window.appPermission.hasPermission(APP_ID);

    const groupsPromise = apiGet('ljGetGroups', { request_user_email: user.email })
      .then(r => Array.isArray(r.data) ? r.data : [])
      .catch(() => []);

    const itemsPromise = apiGet('ljGetItems', { request_user_email: user.email })
      .then(r => Array.isArray(r.data) ? r.data : [])
      .catch(() => null);

    // 조회범위 세분화(2026-06) — RLS가 이미 DB 레벨에서 scope(all/clinic/team)에
    // 맞는 행만 내려주므로, 필터 UI도 admin 한정이 아니라 모든 사용자가 호출해
    // scope에 맞게 보여줄지/고정할지를 결정한다. 기존엔 isAdmin일 때만 org
    // 데이터를 가져와 필터 select를 보여줬는데, 그 결과 일반 사용자는 필터
    // 자체가 없는 채로 "받은 데이터를 그냥 다 보여주는" 화면이었다(RLS 적용
    // 전이라 전체 데이터가 다 내려왔으니 필터가 없어도 문제가 안 됐던 것).
    const orgPromise = apiGet('getScopedOrgOptions', { request_user_email: user.email, app_id: APP_ID })
      .catch(() => null);

    const [hasAccess, groupsResult, itemsResult, orgResult] = await Promise.all([permissionPromise, groupsPromise, itemsPromise, orgPromise]);

    // edit / admin 권한이면 편집 가능
    if (isAdmin) {
      state.canEdit = true;
    } else {
      const perm = await window.appPermission?.getPermission?.(APP_ID).catch(() => null);
      state.canEdit = (perm === 'edit' || perm === 'admin');
    }

    state.groups = groupsResult;
    renderGroupTabs();

    if (orgResult?.data) {
      state.orgData = orgResult.data;
      const clinics = orgResult.data.clinics || [];
      const teams   = orgResult.data.teams   || [];
      const scope   = orgResult.data.scope; // 'all' | 'clinic' | 'team' | null(admin)
      const clinicSel = $('clinicFilterSelect');
      const teamSel   = $('teamFilterSelect');

      if (scope === 'team') {
        // 소속 의원 + 소속 부서만: 선택지가 어차피 1개뿐이라 필터 자체가
        // 무의미하므로 행을 숨긴다(기존엔 일반 사용자에게 필터가 전혀
        // 없었던 것과 동일한 모양이 되지만, 이제는 RLS가 실제로 그 범위로
        // 데이터를 제한해 줘서 의미가 같다).
        if ($('deptFilterRow')) $('deptFilterRow').style.display = 'none';

      } else if (clinicSel && clinics.length > 0) {
        $('deptFilterRow').style.display = 'flex';

        const updateTeams = (clinicCode) => {
          const filtered = clinicCode
            ? teams.filter(t => t.parent_code === clinicCode)
            : teams;
          teamSel.innerHTML = '<option value="">전체 팀</option>' +
            filtered.map(t => `<option value="${escHtml(t.code_value)}">${escHtml(t.code_name)}</option>`).join('');
          teamSel.disabled = !clinicCode;
        };

        if (scope === 'clinic') {
          // 소속 의원 + 전체 부서: 의원은 본인 소속 1개로 고정, 팀은 그
          // 의원 산하 전체 중 자유 선택
          clinicSel.innerHTML = clinics.map(c => `<option value="${escHtml(c.code_value)}">${escHtml(c.code_name)}</option>`).join('');
          clinicSel.value = clinics[0]?.code_value || '';
          clinicSel.disabled = true;
          updateTeams(clinicSel.value);
        } else {
          // scope === 'all'(또는 admin=null): 기존처럼 전체 의원 자유 선택
          clinicSel.disabled = false;
          clinicSel.innerHTML = '<option value="">전체 의원</option>' +
            clinics.map(c => `<option value="${escHtml(c.code_value)}">${escHtml(c.code_name)}</option>`).join('');
          updateTeams('');
        }

        clinicSel.addEventListener('change', () => {
          updateTeams(clinicSel.value);
          state.activeItemId  = null;
          state.activeGroupId = null;
          renderGroupFilterSelect();
          renderItemSelect();
          showItemEmptyState();
        });
      }
    }

    if (!hasAccess) {
      $('skeletonBody').style.display = 'none';
      await hideGlobalLoading();
      $('permissionDenied').style.display = '';
      return;
    }

    $('appBody').style.display = '';

    if (itemsResult === null || itemsResult.length === 0) {
      state.items = itemsResult || [];
      renderItemSelect();
      showItemEmptyState();
    } else {
      state.items = itemsResult;
      renderItemSelect();
      showItemEmptyState(); // 항목 선택 전까지 빈 상태 표시
    }

    $('skeletonBody').style.display = 'none';
    await hideGlobalLoading();
  } catch (e) {
    $('skeletonBody').style.display = 'none';
    await hideGlobalLoading();
    showMessage(e.message || '불러오는 중 오류가 발생했습니다.', 'error');
  }
});
// ─────────────────────────────────────────────
// 이벤트 바인딩
// ─────────────────────────────────────────────
function bindEvents() {
  $('logoutBtn')?.addEventListener('click', () => window.auth.logout());
  // 항목 추가 버튼 (항목 있을 때 / 없을 때 둘 다)
  $('addItemTabBtn').addEventListener('click', () => openItemModal(null));
  $('addItemTabBtnEmpty').addEventListener('click', () => openItemModal(null));

  $('editItemBtn').addEventListener('click', () => {
    const item = getActiveItem();
    if (item) openItemModal(item);
  });
  $('deleteItemBtn').addEventListener('click', deleteActiveItem);

  // 팀 필터 변경 (admin 전용)
  $('teamFilterSelect')?.addEventListener('change', () => {
    state.activeItemId  = null;
    state.activeGroupId = null;
    renderGroupFilterSelect();
    renderItemSelect();
    showItemEmptyState();
  });

  // 셀렉트 변경 시 항목 전환
  $('itemSelect').addEventListener('change', e => {
    if (e.target.value) selectItem(e.target.value);
  });

  $('itemModalClose').addEventListener('click', closeItemModal);
  $('itemModalCancel').addEventListener('click', closeItemModal);
  $('itemModalSave').addEventListener('click', saveItem);

  // 타입 변경 시 필드 전환
  $('modalItemType').addEventListener('change', onModalTypeChange);
  // 프리셋 변경 시 기대값 옵션 업데이트
  $('modalItemPreset').addEventListener('change', updateExpectedOptions);

  $('addEntryBtn').addEventListener('click', addEntry);
  $('entryValue').addEventListener('keydown', e => { if (e.key === 'Enter') addEntry(); });
  $('sampleDataBtn').addEventListener('click', loadSampleData);

  // 샘플 데이터 버튼 — admin만 표시
  const user = window.auth.getSession();
  if (String(user?.role || '').trim().toLowerCase() === 'admin') {
    $('sampleDataBtn').style.display = '';
  }
  $('chartDateApplyBtn').addEventListener('click', applyDateFilter);
  $('chartDateFrom').addEventListener('keydown', e => { if (e.key === 'Enter') applyDateFilter(); });
  $('chartDateTo').addEventListener('keydown',   e => { if (e.key === 'Enter') applyDateFilter(); });

  document.querySelectorAll('.lj-date-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const days = parseInt(btn.dataset.days, 10);
      applyDatePreset(days);
    });
  });

  $('exportCsvBtn').addEventListener('click', exportCsv);
  $('exportExcelBtn').addEventListener('click', exportExcel);
  $('exportPdfBtn').addEventListener('click', exportPdf);

  $('itemModal').addEventListener('click', e => {
    if (e.target === $('itemModal')) closeItemModal();
  });

  $('entryDate').value = todayYmd();

  // 날짜 필터 기본값: 최근 30일
  applyDatePreset(30, false);
}

// ─────────────────────────────────────────────
// API 연동 — 검사 항목
// ─────────────────────────────────────────────
async function loadItems() {
  const user = window.auth.getSession();
  try {
    showGlobalLoading('불러오는 중...');
    const result = await apiGet('ljGetItems', { request_user_email: user.email });
    state.items = Array.isArray(result.data) ? result.data : [];
    renderItemSelect();
    if (state.items.length > 0) {
      selectItem(state.items[0].item_id);
    } else {
      showItemEmptyState();
    }
  } catch (e) {
    showMessage(e.message || '항목을 불러오지 못했습니다.', 'error');
  } finally {
    hideGlobalLoading();
  }
}

async function loadEntriesForItem(itemId, isInitial = false) {
  const user = window.auth.getSession();

  // 초기 로딩이 아닐 때만 테이블 스켈레톤 행 표시
  if (!isInitial) {
    $('dataEmptyState').style.display = 'none';
    $('dataTable').style.display = '';
    $('dataTableBody').innerHTML = Array(4).fill(0).map(() => `
      <tr>
        <td><div class="skeleton" style="height:14px;width:90px;border-radius:6px;"></div></td>
        <td><div class="skeleton" style="height:14px;width:50px;border-radius:6px;margin:0 auto;"></div></td>
        <td><div class="skeleton" style="height:20px;width:52px;border-radius:6px;margin:0 auto;"></div></td>
        <td><div class="skeleton" style="height:20px;width:60px;border-radius:6px;margin:0 auto;"></div></td>
        <td><div class="skeleton" style="height:14px;width:80px;border-radius:6px;"></div></td>
        <td></td>
      </tr>
    `).join('');
  }

  try {
    const result = await apiGet('ljGetEntries', {
      item_id: itemId,
      request_user_email: user.email,
      date_from: state.dateFrom,
      date_to:   state.dateTo
    });
    state.entries[itemId] = (Array.isArray(result.data) ? result.data : []).map(e => ({
      ...e,
      date: normalizeDate(e.date)
    })).sort((a, b) => a.date.localeCompare(b.date));
    renderDataTable();
    renderStats();
    renderChart();
  } catch (e) {
    showMessage(e.message || '데이터를 불러오지 못했습니다.', 'error');
    $('dataTable').style.display = 'none';
    $('dataEmptyState').style.display = '';
  }
}

// ─────────────────────────────────────────────
// 검사 항목 탭 렌더링
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// 그룹 필터 콤보박스
// ─────────────────────────────────────────────
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
async function addEntry() {
  const date = $('entryDate').value;
  const memo = $('entryMemo').value.trim();
  const item = getActiveItem();
  if (!item || !state.activeItemId) return;
  if (!date) { alert('측정일을 선택하세요.'); $('entryDate').focus(); return; }

  const isQual = item.item_type === 'qualitative';
  let value;
  if (isQual) {
    value = $('entryResult').value;
    if (!value) { alert('결과값을 선택하세요.'); return; }
  } else {
    value = parseFloat($('entryValue').value);
    if (isNaN(value)) { alert('측정값을 입력하세요.'); $('entryValue').focus(); return; }

    const dec = getDecimals(item);
    const valueStr = String($('entryValue').value);
    const dotIdx   = valueStr.indexOf('.');
    const actualDec = dotIdx === -1 ? 0 : valueStr.length - dotIdx - 1;

    // 소수점 자리수 초과 — 차단
    if (actualDec > dec) {
      const msg = dec === 0
        ? '정수만 입력할 수 있습니다.'
        : `소수점 ${dec}자리까지만 입력할 수 있습니다. (예: ${Number(value).toFixed(dec)})`;
      alert(msg);
      $('entryValue').focus();
      return;
    }

    // 소수점 자리수 부족 — 경고 후 자동 패딩
    if (dec > 0 && actualDec < dec) {
      const paddedStr = Number(value).toFixed(dec);
      const confirmed = confirm(
        `소수점 ${dec}자리보다 적게 입력되었습니다.
` +
        `입력값: ${valueStr}  →  ${paddedStr} 으로 저장됩니다.

` +
        `계속 저장하시겠습니까?`
      );
      if (!confirmed) { $('entryValue').focus(); return; }
      value = parseFloat(paddedStr);
    }
  }

  const user = window.auth.getSession();
  try {
    showGlobalLoading('데이터 저장 중...');
    await apiPost('ljCreateEntry', {
      item_id: state.activeItemId, date, value, memo,
      item_type: item.item_type || 'quantitative',
      request_user_email: user.email
    });

    // 서버에서 최신 entries 재조회
    const entryResult = await apiGet('ljGetEntries', {
      item_id: state.activeItemId,
      request_user_email: user.email,
      date_from: state.dateFrom,
      date_to:   state.dateTo
    });
    state.entries[state.activeItemId] = (Array.isArray(entryResult.data) ? entryResult.data : []).map(e => ({
      ...e, date: normalizeDate(e.date)
    })).sort((a, b) => a.date.localeCompare(b.date));

    if (!isQual) $('entryValue').value = '';
    $('entryMemo').value = '';
    $('entryDate').value = todayYmd();

    renderDataTable();
    renderStats();
    if (!isQual) renderChart();
  } catch (e) {
    showMessage(e.message || '저장에 실패했습니다.', 'error');
  } finally {
    hideGlobalLoading();
  }
}

// ─────────────────────────────────────────────
// QC 데이터 인라인 수정
// ─────────────────────────────────────────────
function startEditEntry(entryId) {
  const item = getActiveItem();
  const entries = state.entries[state.activeItemId] || [];
  const entry = entries.find(e => e.entry_id === entryId);
  if (!entry) return;

  // data-entry-id 속성으로 tr 탐색 (querySelector 특수문자 이슈 방지)
  const tbody = $('dataTableBody');
  let tr = null;
  for (const row of tbody.querySelectorAll('tr')) {
    if (row.dataset.entryId === entryId) { tr = row; break; }
  }
  if (!tr) return;

  const isQual = item.item_type === 'qualitative';
  const dec    = getDecimals(item);

  const qualOptions = isQual
    ? (QUALITATIVE_PRESETS[item.preset]?.values || [])
    : [];

  const valueCell = isQual
    ? `<select class="lj-edit-input" id="editVal_${entryId}">
        ${qualOptions.map(v => `<option value="${escHtml(v)}" ${v === entry.value ? 'selected' : ''}>${escHtml(v)}</option>`).join('')}
       </select>`
    : `<input type="number" class="lj-edit-input" id="editVal_${entryId}"
         step="${dec === 0 ? '1' : '0.' + '0'.repeat(dec - 1) + '1'}"
         value="${escHtml(String(entry.value))}" />`;

  // 정량: 측정일/측정값/SDI/Westgard/메모/버튼 = 6열
  // 정성: 측정일/결과값/판정/메모/버튼 = 5열
  tr.innerHTML = isQual
    ? `<td><input type="date" class="lj-edit-input" id="editDate_${entryId}" value="${escHtml(entry.date)}" /></td>
       <td colspan="2">${valueCell}</td>
       <td class="lj-edit-memo-cell col-memo"><input type="text" class="lj-edit-input" id="editMemo_${entryId}" value="${escHtml(entry.memo || '')}" placeholder="메모" /></td>
       <td class="lj-action-cell">
         <button type="button" class="lj-save-btn" onclick="confirmEditEntry('${entryId}')">완료</button>
         <button type="button" class="lj-cancel-btn" onclick="renderDataTable()">취소</button>
       </td>`
    : `<td style="width:120px;"><input type="date" class="lj-edit-input" id="editDate_${entryId}" value="${escHtml(entry.date)}" /></td>
       <td style="width:90px;"><input type="number" class="lj-edit-input" id="editVal_${entryId}"
           step="${dec === 0 ? '1' : '0.' + '0'.repeat(dec - 1) + '1'}"
           value="${escHtml(String(entry.value))}" /></td>
       <td colspan="2" style="width:270px;color:#94a3b8;font-size:12px;padding-left:12px;">저장 후 재계산</td>
       <td class="lj-edit-memo-cell col-memo"><input type="text" class="lj-edit-input" id="editMemo_${entryId}" value="${escHtml(entry.memo || '')}" placeholder="메모" /></td>
       <td class="lj-action-cell" style="width:120px;">
         <button type="button" class="lj-save-btn" onclick="confirmEditEntry('${entryId}')">완료</button>
         <button type="button" class="lj-cancel-btn" onclick="renderDataTable()">취소</button>
       </td>`;

  document.getElementById(`editVal_${entryId}`)?.focus();
}

async function confirmEditEntry(entryId) {
  const item    = getActiveItem();
  const entries = state.entries[state.activeItemId] || [];
  const entry   = entries.find(e => e.entry_id === entryId);
  if (!entry) return;

  const isQual = item.item_type === 'qualitative';
  const dec    = getDecimals(item);

  const newDate = document.getElementById(`editDate_${entryId}`)?.value?.trim();
  const newMemo = document.getElementById(`editMemo_${entryId}`)?.value?.trim() ?? '';
  let   newValue;

  if (!newDate) { alert('측정일을 입력하세요.'); return; }

  if (isQual) {
    newValue = document.getElementById(`editVal_${entryId}`)?.value;
    if (!newValue) { alert('결과값을 선택하세요.'); return; }
  } else {
    newValue = parseFloat(document.getElementById(`editVal_${entryId}`)?.value);
    if (isNaN(newValue)) { alert('측정값을 입력하세요.'); return; }

    const valStr    = String(document.getElementById(`editVal_${entryId}`).value);
    const dotIdx    = valStr.indexOf('.');
    const actualDec = dotIdx === -1 ? 0 : valStr.length - dotIdx - 1;

    if (actualDec > dec) {
      alert(dec === 0 ? '정수만 입력할 수 있습니다.' : `소수점 ${dec}자리까지만 입력할 수 있습니다.`);
      return;
    }
    if (dec > 0 && actualDec < dec) {
      const paddedStr = newValue.toFixed(dec);
      if (!confirm(`소수점 ${dec}자리보다 적게 입력되었습니다.\n${valStr} → ${paddedStr} 으로 저장됩니다.\n\n계속 저장하시겠습니까?`)) return;
      newValue = parseFloat(paddedStr);
    }
  }

  const user = window.auth.getSession();
  try {
    showGlobalLoading('수정 중...');
    await apiPost('ljUpdateEntry', {
      entry_id:           entryId,
      item_id:            state.activeItemId,
      date:               newDate,
      value:              String(newValue),
      memo:               newMemo,
      request_user_email: user.email
    });

    // 로컬 state 업데이트
    const idx = entries.findIndex(e => e.entry_id === entryId);
    if (idx !== -1) {
      state.entries[state.activeItemId][idx] = {
        ...entry, date: newDate, value: String(newValue), memo: newMemo
      };
      state.entries[state.activeItemId].sort((a, b) => a.date.localeCompare(b.date));
    }

    renderDataTable();
    renderStats();
    if (!isQual) renderChart();
    showMessage('수정되었습니다.', 'success');
  } catch (e) {
    showMessage(e.message || '수정에 실패했습니다.', 'error');
    renderDataTable();
  } finally {
    hideGlobalLoading();
  }
}

async function deleteEntry(entryId) {
  if (!confirm('이 데이터를 삭제하시겠습니까?')) return;
  const user = window.auth.getSession();
  try {
    showGlobalLoading('삭제 중...');
    await apiPost('ljDeleteEntry', {
      entry_id: entryId,
      item_id: state.activeItemId,
      request_user_email: user.email
    });

    // 서버에서 최신 entries 재조회
    const entryResult = await apiGet('ljGetEntries', {
      item_id: state.activeItemId,
      request_user_email: user.email,
      date_from: state.dateFrom,
      date_to:   state.dateTo
    });
    state.entries[state.activeItemId] = (Array.isArray(entryResult.data) ? entryResult.data : []).map(e => ({
      ...e, date: normalizeDate(e.date)
    })).sort((a, b) => a.date.localeCompare(b.date));

    renderDataTable();
    renderStats();
    renderChart();
  } catch (e) {
    showMessage(e.message || '삭제에 실패했습니다.', 'error');
  } finally {
    hideGlobalLoading();
  }
}

// ─────────────────────────────────────────────
// 날짜 필터 유틸
// ─────────────────────────────────────────────
function dateOffsetYmd(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return dateToYmd(d);
}

function applyDatePreset(days, rerender = true) {
  const today = todayYmd();
  if (days === 0) {
    state.dateFrom = '';
    state.dateTo   = '';
    $('chartDateFrom').value = '';
    $('chartDateTo').value   = '';
  } else {
    state.dateFrom = dateOffsetYmd(days);
    state.dateTo   = today;
    $('chartDateFrom').value = state.dateFrom;
    $('chartDateTo').value   = state.dateTo;
  }
  // 활성 프리셋 버튼 스타일 반영
  document.querySelectorAll('.lj-date-preset-btn').forEach(btn => {
    const active = parseInt(btn.dataset.days, 10) === days;
    btn.style.background    = active ? '#2563eb' : '';
    btn.style.color         = active ? '#fff'    : '';
    btn.style.borderColor   = active ? '#2563eb' : '';
  });
  if (rerender) rerenderWithFilter();
}

function applyDateFilter() {
  state.dateFrom = $('chartDateFrom').value;
  state.dateTo   = $('chartDateTo').value;
  // 프리셋 버튼 활성 해제 (직접 입력이므로)
  document.querySelectorAll('.lj-date-preset-btn').forEach(btn => {
    btn.style.background  = '';
    btn.style.color       = '';
    btn.style.borderColor = '';
  });
  rerenderWithFilter();
}

async function rerenderWithFilter() {
  const item = getActiveItem();
  if (!item) return;
  // 날짜 범위가 바뀌면 캐시를 무효화하고 서버에서 재조회
  delete state.entries[state.activeItemId];
  showGlobalLoading('데이터를 불러오는 중...');
  try {
    await loadEntriesForItem(state.activeItemId);
    updateDateFilterInfo(); // 데이터 로드 완료 후 건수 표시
  } finally {
    hideGlobalLoading();
  }
}

function updateDateFilterInfo() {
  const infoEl = $('dateFilterInfo');
  if (!infoEl) return;
  const count = getFilteredEntries().length;
  if (state.dateFrom || state.dateTo) {
    const from = state.dateFrom || '-';
    const to   = state.dateTo   || '-';
    infoEl.textContent = `${from} ~ ${to} · ${count}건`;
  } else {
    infoEl.textContent = `전체 ${count}건`;
  }
}

/** 서버에서 이미 날짜 필터링된 entries 반환 */
function getFilteredEntries() {
  return state.entries[state.activeItemId] || [];
}

// ─────────────────────────────────────────────
// Westgard Rules 판정
// ─────────────────────────────────────────────
function analyzeEntries(entries, mean, sd) {
  if (!entries || entries.length === 0) return [];

  return entries.map((entry, idx) => {
    const val = Number(entry.value);
    const sdi = (val - mean) / sd;
    const absSDI = Math.abs(sdi);
    const violations = [];

    // 1₃s: 1개 값이 ±3SD 벗어남 → 거부
    if (absSDI >= 3) violations.push({ code: '1₃s', type: 'reject' });

    // 1₂s: 1개 값이 ±2SD 벗어남 → 경고 (거부 아닌 경우만)
    else if (absSDI >= 2) violations.push({ code: '1₂s', type: 'warn' });

    // 2₂s: 연속 2개 값이 같은 방향 ±2SD → 거부
    if (idx >= 1) {
      const prev = entries[idx - 1];
      const prevSDI = (Number(prev.value) - mean) / sd;
      if (sdi >= 2 && prevSDI >= 2) violations.push({ code: '2₂s', type: 'reject' });
      if (sdi <= -2 && prevSDI <= -2) violations.push({ code: '2₂s', type: 'reject' });

      // R₄s: 연속 2개 값의 범위가 4SD 초과 → 거부
      if (Math.abs(sdi - prevSDI) > 4) violations.push({ code: 'R₄s', type: 'reject' });
    }

    // 4₁s: 연속 4개 값이 같은 방향 ±1SD → 거부
    if (idx >= 3) {
      const sdis = [idx - 3, idx - 2, idx - 1, idx].map(i => (Number(entries[i].value) - mean) / sd);
      if (sdis.every(s => s > 1)) violations.push({ code: '4₁s', type: 'reject' });
      if (sdis.every(s => s < -1)) violations.push({ code: '4₁s', type: 'reject' });
    }

    // 10x: 연속 10개 값이 평균 같은 쪽에 → 거부
    if (idx >= 9) {
      const sdis = entries.slice(idx - 9, idx + 1).map(e => (Number(e.value) - mean) / sd);
      if (sdis.every(s => s > 0)) violations.push({ code: '10x', type: 'reject' });
      if (sdis.every(s => s < 0)) violations.push({ code: '10x', type: 'reject' });
    }

    // 중복 제거 (같은 코드 두 번 들어갈 수 있음)
    const seen = new Set();
    const uniqueViolations = violations.filter(v => {
      const key = v.code + v.type;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return { ...entry, sdi, violations: uniqueViolations };
  });
}

// ─────────────────────────────────────────────
// 데이터 테이블 렌더링
// ─────────────────────────────────────────────
function renderDataTable() {
  const itemId = state.activeItemId;
  const item = getActiveItem();
  const entries = getFilteredEntries();

  if (entries.length === 0) {
    $('dataEmptyState').style.display = '';
    $('dataTable').style.display = 'none';
    return;
  }

  $('dataEmptyState').style.display = 'none';
  $('dataTable').style.display = '';
  const tbody = $('dataTableBody');

  // ── 정성적 테이블 ──
  if (item.item_type === 'qualitative') {
    tbody.innerHTML = [...entries].reverse().map(row => {
      const isPass = String(row.value) === String(item.expected_value);
      const rowClass = isPass ? '' : 'lj-row--reject';
      const badge = isPass
        ? `<span style="display:inline-block;padding:2px 10px;border-radius:6px;font-size:12px;font-weight:700;background:#f0fdf4;color:#15803d;border:1px solid #86efac;">Pass</span>`
        : `<span style="display:inline-block;padding:2px 10px;border-radius:6px;font-size:12px;font-weight:700;background:#fef2f2;color:#b42318;border:1px solid #fca5a5;">Fail</span>`;
      return `
        <tr class="${rowClass}" data-entry-id="${escHtml(row.entry_id)}">
          <td>${escHtml(row.date)}</td>
          <td style="font-weight:700;text-align:center;">${escHtml(String(row.value))}</td>
          <td style="text-align:center;">${badge}</td>
          <td class="col-memo" style="font-size:12px;color:#64748b;">${escHtml(row.memo || '')}</td>
          <td class="lj-action-cell">
            ${state.canEdit ? `
              <button type="button" class="lj-edit-btn" onclick="startEditEntry('${escHtml(row.entry_id)}')">수정</button>
              <button type="button" class="lj-del-btn" onclick="deleteEntry('${escHtml(row.entry_id)}')">삭제</button>` : ''}
          </td>
        </tr>`;
    }).join('');
    return;
  }

  // ── 정량적 테이블 ──
  const analyzed = analyzeEntries(entries, Number(item.mean), Number(item.sd));
  tbody.innerHTML = [...analyzed].reverse().map(row => {
    const hasReject = row.violations.some(v => v.type === 'reject');
    const hasWarn = row.violations.some(v => v.type === 'warn');
    const rowClass = hasReject ? 'lj-row--reject' : (hasWarn ? 'lj-row--warn' : '');
    const sdiClass = Math.abs(row.sdi) >= 3 ? 'lj-sdi-badge--reject'
                   : Math.abs(row.sdi) >= 2 ? 'lj-sdi-badge--warn'
                   : 'lj-sdi-badge--normal';
    const badges = row.violations.map(v =>
      `<span class="lj-rule-badge lj-rule-badge--${v.type}">${escHtml(v.code)}</span>`
    ).join('') || '<span style="color:#94a3b8;font-size:12px;">정상</span>';
    return `
      <tr class="${rowClass}" data-entry-id="${escHtml(row.entry_id)}">
        <td>${escHtml(row.date)}</td>
        <td style="font-weight:700;">${fmt(row.value, item)}</td>
        <td><span class="lj-sdi-badge ${sdiClass}">${row.sdi.toFixed(4)}</span></td>
        <td>${badges}</td>
        <td class="col-memo" style="font-size:12px;color:#64748b;">${escHtml(row.memo || '')}</td>
        <td class="lj-action-cell">
          ${state.canEdit ? `
            <button type="button" class="lj-edit-btn" onclick="startEditEntry('${escHtml(row.entry_id)}')">수정</button>
            <button type="button" class="lj-del-btn" onclick="deleteEntry('${escHtml(row.entry_id)}')">삭제</button>` : ''}
        </td>
      </tr>`;
  }).join('');
}

// ─────────────────────────────────────────────
// 통계 렌더링
// ─────────────────────────────────────────────
function renderStats() {
  const itemId = state.activeItemId;
  const item = getActiveItem();
  const entries = getFilteredEntries();

  if (entries.length === 0) {
    $('statsSection').style.display = 'none';
    return;
  }

  $('statsSection').style.display = '';
  const n = entries.length;

  // ── 정성적 통계 ──
  if (item.item_type === 'qualitative') {
    const passCount = entries.filter(e => String(e.value) === String(item.expected_value)).length;
    const failCount = n - passCount;
    const passRate  = ((passCount / n) * 100).toFixed(1);

    // 결과값별 빈도
    const freq = {};
    entries.forEach(e => { const k = String(e.value); freq[k] = (freq[k] || 0) + 1; });
    const preset = QUALITATIVE_PRESETS[item.preset];
    const freqCards = (preset?.values || Object.keys(freq)).map(v => ({
      label: v, value: freq[v] || 0, unit: '건',
      warn: v !== item.expected_value && (freq[v] || 0) > 0
    }));

    const summaryCards = [
      { label: '총 검사 수',   value: n,         unit: '건' },
      { label: 'Pass',         value: passCount,  unit: '건' },
      { label: 'Fail',         value: failCount,  unit: '건', danger: failCount > 0 },
      { label: 'Pass율',       value: `${passRate}`, unit: '%' }
    ];

    $('statGrid').innerHTML = [...summaryCards, ...freqCards].map((c, i) => `
      <div class="kpi-card">
        <div class="kpi-label">${escHtml(c.label)}</div>
        <div style="font-size:22px;font-weight:900;color:${c.danger?'#b42318':c.warn?'#c2410c':'#0b1f44'};line-height:1;letter-spacing:-0.03em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(String(c.value))} <span style="font-size:13px;font-weight:600;color:#8494aa;">${escHtml(c.unit)}</span></div>
      </div>
    `).join('');
    return;
  }

  // ── 정량적 통계 ──
  const numValues = entries.map(e => Number(e.value));
  const actualMean = numValues.reduce((s, v) => s + v, 0) / n;
  const actualSD = Math.sqrt(numValues.reduce((s, v) => s + Math.pow(v - actualMean, 2), 0) / n);
  const cv = (actualSD / actualMean) * 100;

  const analyzed = analyzeEntries(entries, Number(item.mean), Number(item.sd));
  const warnCount   = analyzed.filter(r => r.violations.length > 0 && !r.violations.some(v => v.type === 'reject')).length;
  const rejectCount = analyzed.filter(r => r.violations.some(v => v.type === 'reject')).length;

  const cards = [
    { label: '데이터 수',  value: n,                       unit: '건' },
    { label: '실측 평균',  value: fmt(actualMean, item),    unit: item.unit },
    { label: '실측 SD',    value: fmt(actualSD,    item),    unit: item.unit },
    { label: '%CV',        value: cv.toFixed(1),             unit: '%' },
    { label: '경고 건수',  value: warnCount,    unit: '건', warn: warnCount > 0 },
    { label: '거부 건수',  value: rejectCount,  unit: '건', danger: rejectCount > 0 }
  ];

  $('statGrid').innerHTML = cards.map(c => `
    <div class="kpi-card">
      <div class="kpi-label">${escHtml(c.label)}</div>
      <div style="font-size:22px;font-weight:900;color:${c.danger?'#b42318':c.warn?'#c2410c':'#0b1f44'};line-height:1;letter-spacing:-0.03em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(String(c.value))} <span style="font-size:13px;font-weight:600;color:#8494aa;">${escHtml(c.unit)}</span></div>
    </div>
  `).join('');
}

// ─────────────────────────────────────────────
// L-J 차트 렌더링
// ─────────────────────────────────────────────
function renderChart() {
  const itemId = state.activeItemId;
  const item = getActiveItem();
  const entries = getFilteredEntries();

  if (entries.length === 0) {
    $('chartSection').style.display = 'none';
    return;
  }

  $('chartSection').style.display = '';

  const mean = Number(item.mean);
  const sd = Number(item.sd);
  const analyzed = analyzeEntries(entries, mean, sd);

  const labels = analyzed.map(e => e.date);
  const values = analyzed.map(e => Number(e.value));

  // 포인트 색상
  const pointColors = analyzed.map(e => {
    if (e.violations.some(v => v.type === 'reject')) return '#dc2626';
    if (e.violations.length > 0) return '#d97706';
    return '#2563eb';
  });
  const pointBorderColors = analyzed.map(e => {
    if (e.violations.some(v => v.type === 'reject')) return '#991b1b';
    if (e.violations.length > 0) return '#92400e';
    return '#1d4ed8';
  });
  const pointRadii = analyzed.map(e => (e.violations.length > 0 ? 6 : 4));

  const lineCount = analyzed.length;
  const makeConstLine = val => Array(lineCount).fill(val);

  if (state.chart) { state.chart.destroy(); state.chart = null; }

  const ctx = $('ljChartCanvas').getContext('2d');

  state.chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: item.item_name,
          data: values,
          borderColor: '#2563eb',
          backgroundColor: 'transparent',
          pointBackgroundColor: pointColors,
          pointBorderColor: pointBorderColors,
          pointRadius: pointRadii,
          pointHoverRadius: 8,
          borderWidth: 2,
          tension: 0.1,
          order: 0,
          z: 10
        },
        { label: 'Mean',  data: makeConstLine(mean),       borderColor: '#334155', borderWidth: 1.5, borderDash: [], pointRadius: 0, fill: false, order: 1 },
        { label: '+1SD',  data: makeConstLine(mean + sd),  borderColor: '#94a3b8', borderWidth: 1,   borderDash: [4,3], pointRadius: 0, fill: false, order: 2 },
        { label: '-1SD',  data: makeConstLine(mean - sd),  borderColor: '#94a3b8', borderWidth: 1,   borderDash: [4,3], pointRadius: 0, fill: false, order: 2 },
        { label: '+2SD',  data: makeConstLine(mean + 2*sd),borderColor: '#f59e0b', borderWidth: 1.5, borderDash: [6,3], pointRadius: 0, fill: false, order: 3 },
        { label: '-2SD',  data: makeConstLine(mean - 2*sd),borderColor: '#f59e0b', borderWidth: 1.5, borderDash: [6,3], pointRadius: 0, fill: false, order: 3 },
        { label: '+3SD',  data: makeConstLine(mean + 3*sd),borderColor: '#ef4444', borderWidth: 1.5, borderDash: [8,3], pointRadius: 0, fill: false, order: 4 },
        { label: '-3SD',  data: makeConstLine(mean - 3*sd),borderColor: '#ef4444', borderWidth: 1.5, borderDash: [8,3], pointRadius: 0, fill: false, order: 4 }
      ]
    },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'bottom',
          labels: { font: { size: 11 }, boxWidth: 24, padding: 12 }
        },
        tooltip: {
          callbacks: {
            afterBody(items) {
              const idx = items[0]?.dataIndex;
              if (idx === undefined) return;
              const e = analyzed[idx];
              if (!e.violations.length) return ['판정: 정상'];
              return ['판정: ' + e.violations.map(v => `${v.code}(${v.type === 'reject' ? '거부' : '경고'})`).join(', ')];
            }
          }
        }
      },
      scales: {
        x: {
          ticks: { font: { size: 11 }, maxRotation: 45 },
          grid: { color: '#f1f5f9' }
        },
        y: {
          ticks: { font: { size: 11 } },
          grid: { color: '#f1f5f9' }
        }
      }
    }
  });
}

// ─────────────────────────────────────────────
// 샘플 데이터
// ─────────────────────────────────────────────
async function loadSampleData() {
  const item = getActiveItem();
  if (!item) return;
  if (!confirm('샘플 데이터 20건을 추가하시겠습니까?\n기존 데이터에 덧붙여집니다.')) return;

  const mean = Number(item.mean);
  const sd = Number(item.sd);
  const user = window.auth.getSession();
  const today = new Date();

  try {
    showGlobalLoading('샘플 데이터 저장 중...');
    const randomNormal = () => {
      let u = 0, v = 0;
      while (u === 0) u = Math.random();
      while (v === 0) v = Math.random();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };

    for (let i = 19; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = dateToYmd(d);
      const value = parseFloat((mean + randomNormal() * sd).toFixed(getDecimals(item)));
      const result = await apiPost('ljCreateEntry', {
        item_id: state.activeItemId, date: dateStr, value, memo: '샘플',
        item_type: item.item_type || 'quantitative',
        request_user_email: user.email
      });
      if (!state.entries[state.activeItemId]) state.entries[state.activeItemId] = [];
      state.entries[state.activeItemId].push({ ...result.data, date: normalizeDate(result.data.date) });
    }
    state.entries[state.activeItemId].sort((a, b) => a.date.localeCompare(b.date));
    renderDataTable();
    renderStats();
    renderChart();
    showMessage('샘플 데이터 20건이 추가되었습니다.', 'success');
  } catch (e) {
    showMessage(e.message || '샘플 데이터 저장에 실패했습니다.', 'error');
  } finally {
    hideGlobalLoading();
  }
}

// ─────────────────────────────────────────────
// CSV 내보내기
// ─────────────────────────────────────────────
function exportCsv() {
  const item = getActiveItem();
  const entries = getFilteredEntries();
  if (entries.length === 0) return;

  const analyzed = analyzeEntries(entries, Number(item.mean), Number(item.sd));
  const header = ['측정일', '측정값', 'SDI', 'Westgard 판정', '메모'];
  const rows = analyzed.map(e => [
    e.date,
    e.value,
    e.sdi.toFixed(4),
    e.violations.length ? e.violations.map(v => v.code).join(' / ') : '정상',
    e.memo || ''
  ]);

  const csv = [header, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const bom = '\uFEFF';
  const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `LJ_${item.item_name}_${todayYmd()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────
// 엑셀 내보내기 (SheetJS)
// ─────────────────────────────────────────────
function exportExcel() {
  const item = getActiveItem();
  const entries = getFilteredEntries();
  if (entries.length === 0) { showMessage('데이터가 없습니다.', 'error'); return; }
  if (typeof XLSX === 'undefined') { showMessage('라이브러리 로딩 중입니다. 잠시 후 다시 시도해 주세요.', 'error'); return; }

  const mean = Number(item.mean);
  const sd   = Number(item.sd);
  const analyzed = analyzeEntries(entries, mean, sd);
  const today = todayYmd();

  // ── 시트1: 통계 요약 ──
  const values = entries.map(e => Number(e.value));
  const n = values.length;
  const actualMean = values.reduce((s, v) => s + v, 0) / n;
  const actualSD   = Math.sqrt(values.reduce((s, v) => s + Math.pow(v - actualMean, 2), 0) / n);
  const cv = (actualSD / actualMean) * 100;
  const warnCount   = analyzed.filter(r => r.violations.length > 0 && !r.violations.some(v => v.type === 'reject')).length;
  const rejectCount = analyzed.filter(r => r.violations.some(v => v.type === 'reject')).length;

  const summaryData = [
    ['정도관리 시스템 — 통계 요약'],
    [],
    ['검사 항목', item.item_name],
    ['단위',     item.unit],
    ['출력일',   today],
    [],
    ['항목',       '값'],
    ['목표 평균',  mean],
    ['표준편차',   sd],
    ['+2SD 상한',  mean + 2 * sd],
    ['-2SD 하한',  mean - 2 * sd],
    [],
    ['데이터 수',  n],
    ['실측 평균',  parseFloat(fmt(actualMean, item))],
    ['실측 SD',    parseFloat(fmt(actualSD,    item))],
    ['%CV',        parseFloat(cv.toFixed(1))],
    ['경고 건수',  warnCount],
    ['거부 건수',  rejectCount],
  ];

  // ── 시트2: QC 데이터 ──
  const dataRows = [
    ['측정일', '측정값', `단위(${item.unit})`, 'SDI', 'Westgard 판정', '메모'],
    ...analyzed.map(e => [
      e.date,
      parseFloat(fmt(e.value, item)),
      item.unit,
      parseFloat(e.sdi.toFixed(4)),
      e.violations.length ? e.violations.map(v => v.code).join(' / ') : '정상',
      e.memo || ''
    ])
  ];

  const wb = XLSX.utils.book_new();
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
  const wsData    = XLSX.utils.aoa_to_sheet(dataRows);

  // 열 너비
  wsSummary['!cols'] = [{ wch: 16 }, { wch: 20 }];
  wsData['!cols']    = [{ wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 24 }, { wch: 20 }];

  XLSX.utils.book_append_sheet(wb, wsSummary, '통계 요약');
  XLSX.utils.book_append_sheet(wb, wsData,    'QC 데이터');

  XLSX.writeFile(wb, `LJ_${item.item_name}_${today}.xlsx`);
}

// ─────────────────────────────────────────────
// PDF 내보내기 — HTML 결과지 캡처 방식 (한글 완벽 지원)
// ─────────────────────────────────────────────
async function exportPdf() {
  const item = getActiveItem();
  const entries = getFilteredEntries();
  if (entries.length === 0) { showMessage('데이터가 없습니다.', 'error'); return; }
  if (typeof window.jspdf === 'undefined' || typeof html2canvas === 'undefined') {
    showMessage('라이브러리 로딩 중입니다. 잠시 후 다시 시도해 주세요.', 'error'); return;
  }

  const { jsPDF } = window.jspdf;
  const mean = Number(item.mean);
  const sd   = Number(item.sd);
  const analyzed = analyzeEntries(entries, mean, sd);
  const today = todayYmd();
  const values = entries.map(e => Number(e.value));
  const n = values.length;
  const actualMean = values.reduce((s, v) => s + v, 0) / n;
  const actualSD   = Math.sqrt(values.reduce((s, v) => s + Math.pow(v - actualMean, 2), 0) / n);
  const cv = (actualSD / actualMean) * 100;
  const warnCount   = analyzed.filter(r => r.violations.length > 0 && !r.violations.some(v => v.type === 'reject')).length;
  const rejectCount = analyzed.filter(r => r.violations.some(v => v.type === 'reject')).length;

  // 차트 이미지 캡처 (DOM canvas → dataURL)
  const chartImgData = $('ljChartCanvas')
    ? $('ljChartCanvas').toDataURL('image/png', 1.0)
    : null;

  try {
    showGlobalLoading('PDF 생성 중...');

    // ── 결과지 HTML 동적 생성 ──
    const wrap = document.createElement('div');
    wrap.style.cssText = [
      'position:fixed', 'left:-9999px', 'top:0',
      'width:794px',   // A4 96dpi 기준
      'background:#fff',
      'font-family:Pretendard,"Noto Sans KR","Malgun Gothic",sans-serif',
      'color:#0f172a', 'font-size:13px', 'line-height:1.5'
    ].join(';');

    const statRows = [
      { label: '목표 평균 (Mean)', value: `${mean.toFixed(4)} ${item.unit}` },
      { label: '표준편차 (SD)',    value: `${sd.toFixed(4)} ${item.unit}` },
      { label: '+2SD 상한',        value: `${(mean + 2*sd).toFixed(4)} ${item.unit}` },
      { label: '-2SD 하한',        value: `${(mean - 2*sd).toFixed(4)} ${item.unit}` },
      { label: '데이터 수',        value: `${n}건` },
      { label: '실측 평균',        value: `${actualMean.toFixed(4)} ${item.unit}` },
      { label: '실측 SD',          value: `${actualSD.toFixed(4)} ${item.unit}` },
      { label: '%CV',              value: `${cv.toFixed(1)}%` },
      { label: '경고 건수',        value: `${warnCount}건`, warn: warnCount > 0 },
      { label: '거부 건수',        value: `${rejectCount}건`, danger: rejectCount > 0 },
    ];

    const dataRowsHtml = analyzed.map((e, i) => {
      const hasReject = e.violations.some(v => v.type === 'reject');
      const hasWarn   = e.violations.length > 0 && !hasReject;
      const bg = hasReject ? '#fef2f2' : hasWarn ? '#fffbeb' : (i % 2 === 0 ? '#fff' : '#f8fafc');
      const sdiColor = Math.abs(e.sdi) >= 3 ? '#b42318' : Math.abs(e.sdi) >= 2 ? '#c2410c' : '#15803d';
      const judgment = e.violations.length
        ? e.violations.map(v => `<span style="display:inline-block;padding:1px 6px;border-radius:4px;font-size:11px;font-weight:700;background:${v.type==='reject'?'#fee2e2':'#fef9c3'};color:${v.type==='reject'?'#b91c1c':'#a16207'};border:1px solid ${v.type==='reject'?'#fca5a5':'#fde047'};">${escHtml(v.code)}</span>`).join(' ')
        : '<span style="color:#94a3b8;">정상</span>';
      return `<tr style="background:${bg};">
        <td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;font-family:monospace;font-size:12px;color:#475569;">${escHtml(e.date)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;text-align:center;font-weight:700;">${fmt(e.value, item)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;text-align:center;font-family:monospace;font-weight:700;color:${sdiColor};">${e.sdi.toFixed(4)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;text-align:center;">${judgment}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;font-size:12px;color:#64748b;">${escHtml(e.memo || '')}</td>
      </tr>`;
    }).join('');

    wrap.innerHTML = `
      <div style="padding:32px 36px;">

        <!-- 헤더 -->
        <div style="background:#2563eb;border-radius:12px;padding:16px 20px;margin-bottom:20px;display:flex;align-items:center;justify-content:space-between;">
          <div>
            <div style="font-size:11px;font-weight:700;color:rgba(255,255,255,.7);letter-spacing:.08em;margin-bottom:4px;">L-J LEVEY-JENNINGS QC REPORT</div>
            <div style="font-size:22px;font-weight:900;color:#fff;letter-spacing:-0.02em;">${escHtml(item.item_name)}</div>
          </div>
          <div style="text-align:right;color:rgba(255,255,255,.85);font-size:13px;line-height:1.7;">
            <div>단위: <strong>${escHtml(item.unit)}</strong></div>
            <div>출력일: <strong>${today}</strong></div>
            ${item.memo ? `<div style="font-size:12px;margin-top:2px;">${escHtml(item.memo)}</div>` : ''}
          </div>
        </div>

        <!-- 통계 요약 -->
        <div style="margin-bottom:20px;">
          <div style="font-size:11px;font-weight:800;color:#1d4ed8;letter-spacing:.08em;margin-bottom:10px;padding-left:10px;border-left:3px solid #2563eb;">통계 요약</div>
          <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;">
            ${statRows.map(r => `
              <div style="background:#f8fafc;border:1.5px solid #d0d8e8;border-radius:10px;padding:10px 12px;">
                <div style="font-size:10px;font-weight:700;color:#6b7a90;letter-spacing:.04em;text-transform:uppercase;margin-bottom:4px;">${escHtml(r.label)}</div>
                <div style="font-size:17px;font-weight:900;color:${r.danger?'#b42318':r.warn?'#c2410c':'#0b1f44'};letter-spacing:-0.02em;">${escHtml(r.value)}</div>
              </div>`).join('')}
          </div>
        </div>

        <!-- 차트 -->
        ${chartImgData ? `
        <div style="margin-bottom:20px;">
          <div style="font-size:11px;font-weight:800;color:#1d4ed8;letter-spacing:.08em;margin-bottom:10px;padding-left:10px;border-left:3px solid #2563eb;">L-J 차트</div>
          <div style="border:1.5px solid #d0d8e8;border-radius:12px;padding:12px;background:#fff;">
            <img src="${chartImgData}" style="width:100%;height:auto;display:block;" />
          </div>
        </div>` : ''}

        <!-- QC 데이터 테이블 -->
        <div>
          <div style="font-size:11px;font-weight:800;color:#1d4ed8;letter-spacing:.08em;margin-bottom:10px;padding-left:10px;border-left:3px solid #2563eb;">QC 데이터 (${n}건)</div>
          <table style="width:100%;border-collapse:collapse;border:1.5px solid #d0d8e8;border-radius:10px;overflow:hidden;">
            <thead>
              <tr style="background:#f7f9fd;">
                <th style="padding:9px 10px;text-align:left;font-size:10px;font-weight:800;color:#3d5068;letter-spacing:.04em;text-transform:uppercase;border-bottom:1.5px solid #e0e7f2;">측정일</th>
                <th style="padding:9px 10px;text-align:center;font-size:10px;font-weight:800;color:#3d5068;letter-spacing:.04em;text-transform:uppercase;border-bottom:1.5px solid #e0e7f2;">측정값</th>
                <th style="padding:9px 10px;text-align:center;font-size:10px;font-weight:800;color:#3d5068;letter-spacing:.04em;text-transform:uppercase;border-bottom:1.5px solid #e0e7f2;">SDI</th>
                <th style="padding:9px 10px;text-align:center;font-size:10px;font-weight:800;color:#3d5068;letter-spacing:.04em;text-transform:uppercase;border-bottom:1.5px solid #e0e7f2;">Westgard 판정</th>
                <th style="padding:9px 10px;text-align:left;font-size:10px;font-weight:800;color:#3d5068;letter-spacing:.04em;text-transform:uppercase;border-bottom:1.5px solid #e0e7f2;">메모</th>
              </tr>
            </thead>
            <tbody>${dataRowsHtml}</tbody>
          </table>
        </div>

        <!-- 푸터 -->
        <div style="margin-top:24px;padding-top:12px;border-top:1px solid #e0e7f2;display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:11px;color:#94a3b8;">MSO관리팀 업무지원 시스템 · 정도관리 시스템</span>
          <span style="font-size:11px;color:#94a3b8;">${today}</span>
        </div>
      </div>
    `;

    document.body.appendChild(wrap);

    // html2canvas 캡처
    const canvas = await html2canvas(wrap, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false
    });

    document.body.removeChild(wrap);

    const imgData = canvas.toDataURL('image/png');
    const pdfW = 210;           // A4 가로 mm
    const pageH = 297;          // A4 세로 mm
    const imgW = canvas.width;
    const imgH = canvas.height;

    // canvas 전체 높이를 mm로 환산 (pdfW 기준 비율 유지)
    const totalPdfH = (imgH / imgW) * pdfW;
    const pageCount = Math.ceil(totalPdfH / pageH);

    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    for (let i = 0; i < pageCount; i++) {
      if (i > 0) doc.addPage();

      // 이 페이지에서 보여줄 canvas의 y 시작 픽셀
      const srcY = Math.round((i * pageH / totalPdfH) * imgH);
      // 이 페이지에서 보여줄 canvas 높이 픽셀
      const srcH = Math.round(Math.min(pageH / totalPdfH * imgH, imgH - srcY));

      // 해당 슬라이스만 임시 캔버스에 복사
      const sliceCanvas = document.createElement('canvas');
      sliceCanvas.width  = imgW;
      sliceCanvas.height = srcH;
      const ctx = sliceCanvas.getContext('2d');
      ctx.drawImage(canvas, 0, srcY, imgW, srcH, 0, 0, imgW, srcH);

      const sliceImgData = sliceCanvas.toDataURL('image/png');
      const sliceH = (srcH / imgW) * pdfW; // 이 슬라이스의 mm 높이
      doc.addImage(sliceImgData, 'PNG', 0, 0, pdfW, sliceH);
    }

    doc.save(`LJ_${item.item_name}_${today}.pdf`);
    showMessage('PDF가 저장되었습니다.', 'success');
  } catch (e) {
    showMessage('PDF 생성 중 오류가 발생했습니다: ' + e.message, 'error');
  } finally {
    hideGlobalLoading();
  }
}

function showMessage(text, type = 'error') {
  const box = $('messageBox');
  if (!box) return;
  box.textContent = text;
  box.className = 'message-box is-' + type;
  box.style.display = '';
  setTimeout(() => { box.style.display = 'none'; }, 4000);
}

function escHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// 날짜 정규화 — GAS에서 Date 객체가 문자열로 직렬화된 경우 yyyy-MM-dd로 변환
function normalizeDate(val) {
  if (!val) return '';
  const s = String(val).trim();
  // 이미 yyyy-MM-dd 형식이면 그대로
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // 그 외 Date 문자열 파싱
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

window.deleteEntry = deleteEntry;
window.startEditEntry = startEditEntry;
window.confirmEditEntry = confirmEditEntry;
