let currentSessionUser = null;
let editingUserEmail = '';
let allUsers = [];
let hasLoadedUsers = false;
let usersLoading = false;   // 중복 API 호출 방지
let orgBinder = null;

// ★ 페이지네이션 state
const USER_LIST_PAGE_SIZE = 10;
let userListPage    = 1;
let userListAllPage = 1;   // 사용자 목록 탭 페이지

document.addEventListener('DOMContentLoaded', async () => {
  const user = window.auth?.requireAuth?.();
  if (!user) return;

  currentSessionUser = user;

  if (String(user.role || '').trim().toLowerCase() !== 'admin') {
    alert('관리자만 접근할 수 있습니다.');
    location.replace(`${CONFIG.SITE_BASE_URL}/portal.html`);
    return;
  }

  bindEvents();

  showGlobalLoading('초기 정보를 불러오는 중...');
  try {
    await initializeOrgData();
    // 페이지 진입 시 사용자 데이터 선제 로드 (백그라운드)
    loadUsers().catch(() => {});
  } catch (error) {
    setAdminMessage(error.message || '초기화 중 오류가 발생했습니다.', 'error');
  } finally {
    hideGlobalLoading();
  }
});

function bindEvents() {
  document.getElementById('logoutBtn')?.addEventListener('click', () => {
    showGlobalLoading('로그아웃 중...');
    window.auth.logout();
  });

  document.getElementById('saveUserBtn')?.addEventListener('click', handleSaveUser);
  document.getElementById('cancelEditBtn')?.addEventListener('click', () => resetEditMode());

  // 등록 탭 — 검색창
  document.getElementById('searchUsersBtn')?.addEventListener('click', searchUsers);
  document.getElementById('userSearchKeyword')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') searchUsers();
  });

  // 사용자 목록 탭 — 그리드 검색
  document.getElementById('searchUsersListBtn')?.addEventListener('click', searchUsersAll);
  document.getElementById('userFilterKeyword')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') searchUsersAll();
  });

  // 사용자 목록 탭 — 테이블 행 버튼 클릭
  document.getElementById('userListAll')?.addEventListener('click', async (event) => {
    const editBtn = event.target.closest('.js-edit-user');
    if (editBtn) {
      const email = editBtn.dataset.email;
      if (email) {
        await editUser(email);
        switchToTab('user-form');
        document.querySelector('.panel-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      return;
    }
    const resetBtn = event.target.closest('.js-reset-password');
    if (resetBtn) {
      const email = resetBtn.dataset.email;
      if (email) await resetUserPassword(email);
      return;
    }
    const activeBtn = event.target.closest('.js-toggle-active');
    if (activeBtn) {
      const email = activeBtn.dataset.email;
      const active = activeBtn.dataset.active;
      if (email) await setUserActive(email, active);
    }
  });

  // 검색 결과 모달 닫기
  document.getElementById('closeUserSearchModalBtn')?.addEventListener('click', closeUserSearchModal);
  document.getElementById('userSearchModal')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('userSearchModal')) closeUserSearchModal();
  });

  document.getElementById('loadPendingBtn')?.addEventListener('click', loadPendingRegistrations);

  // 가입신청 목록 이벤트 위임 (승인 / 거절)
  document.getElementById('pendingList')?.addEventListener('click', async (event) => {
    const approveBtn = event.target.closest('.js-approve');
    if (approveBtn) {
      await handleApprove(approveBtn.dataset.id);
      return;
    }
    const rejectBtn = event.target.closest('.js-reject');
    if (rejectBtn) {
      await handleReject(rejectBtn.dataset.id);
    }
  });

  document.getElementById('userSearchKeyword')?.addEventListener('input', () => {
    if (hasLoadedUsers) renderUserList(true);
  });

  document.getElementById('userFilterActive')?.addEventListener('change', () => {
    if (hasLoadedUsers) renderUserList(true);
  });

  document.getElementById('userFilterRole')?.addEventListener('change', () => {
    if (hasLoadedUsers) renderUserList(true);
  });

  document.getElementById('userFilterClinic')?.addEventListener('change', () => {
    if (hasLoadedUsers) renderUserList(true);
  });

  document.getElementById('clinic_code')?.addEventListener('change', () => {
    clearFieldInvalid();
  });

  // 이메일 입력 시 허용되지 않는 문자 실시간 제거 (허용: 영문 소문자·숫자·점·하이픈·언더바·@)
  document.getElementById('userEmail')?.addEventListener('input', (e) => {
    const raw = e.target.value;
    const cleaned = raw.toLowerCase().replace(/[^a-z0-9.@_-]/g, '');
    if (raw !== cleaned) e.target.value = cleaned;
    e.target.classList.remove('is-invalid');
  });

  // ★ 좌측 탭 전환 이벤트
  document.querySelectorAll('.left-tab-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      switchToTab(btn.dataset.tab);
    });
  });

  document.getElementById('userList')?.addEventListener('click', async (event) => {
    const editBtn = event.target.closest('.js-edit-user');
    if (editBtn) {
      const email = editBtn.dataset.email;
      if (email) {
        await editUser(email);
        closeUserSearchModal();     // 검색 결과 모달 닫기
        switchToTab('user-form');   // 등록/수정 폼 탭으로 이동
        document.querySelector('.panel-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      return;
    }

    const resetBtn = event.target.closest('.js-reset-password');
    if (resetBtn) {
      const email = resetBtn.dataset.email;
      if (email) await resetUserPassword(email);
      return;
    }

    const activeBtn = event.target.closest('.js-toggle-active');
    if (activeBtn) {
      const email = activeBtn.dataset.email;
      const active = activeBtn.dataset.active;
      if (email && active) await setUserActive(email, active);
    }
  });
}

function getRequestUserEmail() {
  return String(currentSessionUser?.email || currentSessionUser?.user_email || '')
    .trim()
    .toLowerCase();
}

async function initializeOrgData() {
  await window.orgSelect.loadOrgData();

  window.orgSelect.fillSelectOptions(
    document.getElementById('clinic_code'),
    window.orgSelect.getClinics(),
    { emptyText: '의원을 선택하세요' }
  );

  window.orgSelect.fillSelectOptions(
    document.getElementById('userFilterClinic'),
    window.orgSelect.getClinics(),
    { emptyText: '전체 의원' }
  );

  window.orgSelect.fillSelectOptions(
    document.getElementById('team_code'),
    [],
    { emptyText: '팀을 선택하세요' }
  );

  orgBinder = window.orgSelect.bindClinicTeamSelects({
    clinicSelect: document.getElementById('clinic_code'),
    teamSelect: document.getElementById('team_code')
  });

  await renderPermissionCards();
}

// 권한 표시 라벨(value -> 화면 표시 텍스트). app_registry.permission_levels는
// 'view'/'edit'/'manager'/'admin' 같은 원시 값만 담고 있어, 라디오 버튼
// 라벨은 그 값을 그대로 보여준다(기존 정적 마크업도 동일하게 'view'/'edit'/
// 'admin' 원문을 라벨로 썼음 — portal.js의 관리자/팀장/편집/조회 한글 라벨은
// 카드가 아니라 부여된 뱃지 표시용이라 여기엔 적용하지 않는다).

/**
 * 단일 진실 소스화(2026-06) — app_registry(getAppRegistry API)에서 앱 목록을
 * 가져와 권한 카드를 동적으로 그린다. 기존엔 11개 앱의 카드(이름/설명/등급별
 * 라디오 버튼)가 users.html에 정적으로 하드코딩되어 있어 앱 하나 추가할
 * 때마다 이 파일을 포함해 3곳을 사람이 맞춰 고쳐야 했다. 이제 앱 추가는
 * app_registry 테이블에 행 하나 넣는 것으로 끝나고, 이 함수는 손댈 필요가 없다.
 *
 * collectPermissions()/setPermissionValues()는 .app-permission 클래스와
 * data-app-id/value 속성에만 의존하므로, 마크업을 동적으로 그려도 기존
 * 로직이 그대로 동작한다(별도 수정 불필요).
 */
/**
 * 조회범위 세분화(2026-06) — equipment/lj_chart처럼 app_registry.has_scope가
 * true인 앱은 "권한 등급" 라디오 외에 "조회범위"(전체/소속의원/소속부서) 라디오를
 * 추가로 보여준다. 권한이 '없음'이면 scope는 의미가 없으므로 같이 비활성화한다.
 */
const SCOPE_LABELS = { all: '전체 의원·부서', clinic: '소속 의원 전체', team: '소속 의원·부서만' };

async function renderPermissionCards() {
  const gridEl = document.getElementById('permissionGrid');
  if (!gridEl) return;

  try {
    const result = await apiGet('getAppRegistry', { request_user_email: currentSessionUser?.email || currentSessionUser?.user_email });
    const apps = Array.isArray(result.data) ? result.data : [];

    gridEl.innerHTML = apps.map((app) => {
      const radios = ['', ...(app.permission_levels || [])].map((value) => {
        const isNone = value === '';
        const id = `perm-${app.app_id.replace(/_/g, '-')}-${isNone ? 'none' : value}`;
        const label = isNone ? '없음' : escapeHtml(value);
        return `<span class="perm-opt${isNone ? ' perm-opt-none' : ''}">` +
          `<input type="radio" class="app-permission" id="${id}" name="perm-${app.app_id.replace(/_/g, '-')}" ` +
          `data-app-id="${escapeHtml(app.app_id)}" value="${escapeHtml(value)}"${isNone ? ' checked' : ''}>` +
          `<label for="${id}">${label}</label></span>`;
      }).join('');

      const scopeBlock = app.has_scope ? `
          <div class="perm-scope-group" data-scope-for="${escapeHtml(app.app_id)}">
            <p class="permission-scope-label">조회범위</p>
            ${['all', 'clinic', 'team'].map((value) => {
              const id = `scope-${app.app_id.replace(/_/g, '-')}-${value}`;
              return `<span class="perm-opt">` +
                `<input type="radio" class="app-scope" id="${id}" name="scope-${app.app_id.replace(/_/g, '-')}" ` +
                `data-app-id="${escapeHtml(app.app_id)}" value="${value}">` +
                `<label for="${id}">${escapeHtml(SCOPE_LABELS[value])}</label></span>`;
            }).join('')}
          </div>` : '';

      return `
        <div class="permission-card">
          <div class="permission-card-head">
            <p class="permission-title">${escapeHtml(app.app_name)}</p>
            <p class="permission-desc">${escapeHtml(app.app_desc)}</p>
          </div>
          <div class="perm-radio-group">${radios}</div>
          ${scopeBlock}
        </div>
      `;
    }).join('');

    bindScopeVisibilityToggles();
  } catch (error) {
    gridEl.innerHTML = `<p class="form-help" style="color:#dc2626">앱 목록을 불러오지 못했습니다: ${escapeHtml(error.message || '')}</p>`;
  }
}

/**
 * 권한이 '없음'이면 scope 라디오 그룹을 비활성화(흐리게) 처리해
 * 의미 없는 선택을 막는다. 권한 라디오가 바뀔 때마다 다시 평가한다.
 */
function bindScopeVisibilityToggles() {
  document.querySelectorAll('.perm-scope-group').forEach((scopeGroup) => {
    const appId = scopeGroup.dataset.scopeFor;
    const update = () => {
      const checked = document.querySelector(`input.app-permission[data-app-id="${appId}"]:checked`);
      const hasPermission = !!(checked && checked.value);
      scopeGroup.classList.toggle('perm-scope-group--disabled', !hasPermission);
      scopeGroup.querySelectorAll('input.app-scope').forEach((el) => { el.disabled = !hasPermission; });
    };
    document.querySelectorAll(`input.app-permission[data-app-id="${appId}"]`).forEach((el) => {
      el.addEventListener('change', update);
    });
    update();
  });
}

function buildDepartmentText(clinicName, teamName) {
  const clinic = normalize(clinicName);
  const team = normalize(teamName);

  if (clinic && team) return `${clinic} / ${team}`;
  if (team) return team;
  if (clinic) return clinic;
  return '';
}

function setAdminMessage(message, type = '') {
  const el = document.getElementById('adminUserMessage');
  if (!el) return;

  el.textContent = message || '';
  el.className = 'message-box';

  if (type) {
    el.classList.add(type);
  }
}

function clearAdminMessage() {
  setAdminMessage('');
}

function clearFieldInvalid() {
  document.querySelectorAll('.is-invalid').forEach((el) => {
    el.classList.remove('is-invalid');
  });
}

function markFieldInvalid(fieldId) {
  const el = document.getElementById(fieldId);
  if (!el) return;
  el.classList.add('is-invalid');
  el.focus();
}

function normalize(value) {
  return String(value || '').trim();
}

function collectPermissions() {
  // ★ radio 버튼 방식: 각 app_id별 checked된 값 수집
  const permissions = [];
  const seen = {};

  document.querySelectorAll('.app-permission').forEach((el) => {
    const appId = normalize(el.dataset.appId);
    if (!appId || seen[appId]) return;
    seen[appId] = true;

    // radio: name="perm-{app_id}" 중 checked 된 것
    const checked = document.querySelector(`input.app-permission[data-app-id="${appId}"]:checked`);
    const permission = checked ? normalize(checked.value) : '';

    if (!permission) return; // 권한 없음은 제외

    // 조회범위 세분화(2026-06) — has_scope 앱은 scope 라디오도 같이 수집한다.
    // 이 카드에 .app-scope 요소가 있다는 것 자체가 has_scope=true라는 뜻이므로
    // app_registry를 다시 조회할 필요 없이 DOM 존재 여부로 판단한다.
    const scopeEls = document.querySelectorAll(`input.app-scope[data-app-id="${appId}"]`);
    let scope;
    if (scopeEls.length > 0) {
      const scopeChecked = document.querySelector(`input.app-scope[data-app-id="${appId}"]:checked`);
      scope = scopeChecked ? normalize(scopeChecked.value) : '';
      if (!scope) {
        throw new Error(`${appId}의 조회범위(전체/소속의원/소속부서)를 선택해 주세요.`);
      }
    }

    const item = { app_id: appId, permission, active: 'Y' };
    if (scope) item.scope = scope;
    permissions.push(item);
  });

  return permissions;
}

function buildUserOrgPayload() {
  const clinicEl = document.getElementById('clinic_code');
  const teamEl = document.getElementById('team_code');

  return {
    clinic_code: normalize(clinicEl?.value),
    team_code: normalize(teamEl?.value)
  };
}

function validateUserForm(data) {
  clearFieldInvalid();

  if (!data.user_email) {
    markFieldInvalid('userEmail');
    throw new Error('이메일을 입력해 주세요.');
  }

  // 이메일 형식 검증
  if (!/^[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(data.user_email)) {
    markFieldInvalid('userEmail');
    throw new Error('이메일 형식으로 입력해 주세요. (예: name@example.com)');
  }

  if (!data.user_name) {
    markFieldInvalid('userName');
    throw new Error('이름을 입력해 주세요.');
  }

  if (!data.clinic_code) {
    markFieldInvalid('clinic_code');
    throw new Error('의원을 선택해 주세요.');
  }

  if (!data.team_code) {
    markFieldInvalid('team_code');
    throw new Error('팀을 선택해 주세요.');
  }
}

async function handleSaveUser() {
  clearAdminMessage();

  try {
    if (editingUserEmail) {
      await updateUser();
    } else {
      await createUser();
    }
  } catch (error) {
    setAdminMessage(error.message || '사용자 저장 중 오류가 발생했습니다.', 'error');
  }
}

async function createUser() {
  const org = buildUserOrgPayload();
  const payload = {
    request_user_email: getRequestUserEmail(),
    user_email: normalize(document.getElementById('userEmail')?.value).toLowerCase(),
    user_name: normalize(document.getElementById('userName')?.value),

    clinic_code: org.clinic_code,
    team_code: org.team_code,

    phone: normalize(document.getElementById('phone')?.value),
    role: normalize(document.getElementById('globalRole')?.value) || 'user',
    active: normalize(document.getElementById('userActive')?.value) || 'Y',
    permissions: collectPermissions()
  };

  validateUserForm(payload);

  const saveBtn = document.getElementById('saveUserBtn');
  if (saveBtn) saveBtn.disabled = true;

  showGlobalLoading('사용자 등록 중...');
  try {
    const result = await apiPost('createUser', payload);
    setAdminMessage(result.message || '사용자가 등록되었습니다. 초기 비밀번호는 1111입니다.', 'success');

    resetEditMode(false);

    // 캐시 강제 갱신 후 목록 재렌더
    await loadUsers(true);
    renderUserList(true);
    setAdminMessage(result.message || '사용자가 등록되었습니다. 초기 비밀번호는 1111입니다.', 'success');
  } finally {
    if (saveBtn) saveBtn.disabled = false;
    hideGlobalLoading();
  }
}

async function updateUser() {
  const org = buildUserOrgPayload();
  const payload = {
    request_user_email: getRequestUserEmail(),
    user_email: editingUserEmail,
    user_name: normalize(document.getElementById('userName')?.value),

    clinic_code: org.clinic_code,
    team_code: org.team_code,

    phone: normalize(document.getElementById('phone')?.value),
    role: normalize(document.getElementById('globalRole')?.value) || 'user',
    active: normalize(document.getElementById('userActive')?.value) || 'Y',
    permissions: collectPermissions()
  };

  validateUserForm(payload);

  const saveBtn = document.getElementById('saveUserBtn');
  if (saveBtn) saveBtn.disabled = true;

  showGlobalLoading('사용자 정보 수정 중...');
  try {
    const result = await apiPost('updateUser', payload);
    setAdminMessage(result.message || '사용자 정보가 수정되었습니다.', 'success');

    resetEditMode(false);

    await loadUsers(true);
    renderUserList(true);
  } finally {
    if (saveBtn) saveBtn.disabled = false;
    hideGlobalLoading();
  }
}

// ─────────────────────────────────────────────
// 검색 결과 모달 오픈 / 닫기
// ─────────────────────────────────────────────
function openUserSearchModal() {
  const modal = document.getElementById('userSearchModal');
  if (modal) {
    modal.classList.add('is-open');
    document.body.style.overflow = 'hidden';
  }
}

function closeUserSearchModal() {
  const modal = document.getElementById('userSearchModal');
  if (modal) {
    modal.classList.remove('is-open');
    document.body.style.overflow = '';
  }
}
// ─────────────────────────────────────────────
function switchToTab(tabId) {
  document.querySelectorAll('.left-tab-btn').forEach((b) => b.classList.remove('is-active'));
  document.querySelectorAll('.left-tab-panel').forEach((p) => { p.style.display = 'none'; });
  const btn = document.querySelector(`.left-tab-btn[data-tab="${tabId}"]`);
  const panel = document.getElementById(`tab-${tabId}`);
  if (btn) btn.classList.add('is-active');
  if (panel) panel.style.display = 'block';
}



// ─────────────────────────────────────────────
// 등록/수정 탭 검색 → 결과를 모달로 표시
// ─────────────────────────────────────────────
async function searchUsers() {
  const searchBtn = document.getElementById('searchUsersBtn');
  if (searchBtn) searchBtn.disabled = true;
  try {
    if (!hasLoadedUsers) {
      showGlobalLoading('목록을 불러오는 중입니다');
      await loadUsers();
      hideGlobalLoading();
    }
    renderUserList(true);
    openUserSearchModal();
  } catch (error) {
    hideGlobalLoading();
    setAdminMessage(error.message || '사용자 목록 조회 중 오류가 발생했습니다.', 'error');
  } finally {
    if (searchBtn) searchBtn.disabled = false;
  }
}

// ─────────────────────────────────────────────
// 사용자 목록 탭 — 테이블 그리드로 페이지에 직접 출력
// ─────────────────────────────────────────────
async function searchUsersAll() {
  const searchBtn = document.getElementById('searchUsersListBtn');
  if (searchBtn) searchBtn.disabled = true;

  try {
    if (!hasLoadedUsers) {
      showGlobalLoading('목록을 불러오는 중입니다');
      await loadUsers();
      hideGlobalLoading();
    }

    userListAllPage = 1;   // 새 검색 시 1페이지로 초기화

    const countEl = document.getElementById('userListAllCount');
    const listEl  = document.getElementById('userListAll');

    const keyword      = normalize(document.getElementById('userFilterKeyword')?.value).toLowerCase();
    const activeFilter = normalize(document.getElementById('userFilterActive')?.value).toUpperCase();
    const roleFilter   = normalize(document.getElementById('userFilterRole')?.value).toLowerCase();
    const clinicFilter = normalize(document.getElementById('userFilterClinic')?.value);

    const filtered = allUsers.filter((user) => {
      const matchKeyword = !keyword ||
        normalize(user.user_name).toLowerCase().includes(keyword) ||
        normalize(user.user_email).toLowerCase().includes(keyword) ||
        normalize(user.clinic_name).toLowerCase().includes(keyword) ||
        normalize(user.team_name).toLowerCase().includes(keyword);
      const matchActive = !activeFilter || normalize(user.active).toUpperCase() === activeFilter;
      const matchRole   = !roleFilter   || normalize(user.role).toLowerCase() === roleFilter;
      const matchClinic = !clinicFilter || normalize(user.clinic_code) === clinicFilter;
      return matchKeyword && matchActive && matchRole && matchClinic;
    });

    if (countEl) countEl.textContent = `총 ${filtered.length}명 / 전체 ${allUsers.length}명`;

    // 페이지네이션 계산
    const totalCount = filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalCount / USER_LIST_PAGE_SIZE));
    if (userListAllPage > totalPages) userListAllPage = totalPages;
    const start     = (userListAllPage - 1) * USER_LIST_PAGE_SIZE;
    const pagedList = filtered.slice(start, start + USER_LIST_PAGE_SIZE);

    if (listEl) {
      if (!filtered.length) {
        listEl.innerHTML = '<div class="user-list-empty">조건에 맞는 사용자가 없습니다.</div>';
      } else {
        listEl.innerHTML = `
          <table class="user-tbl">
            <thead>
              <tr>
                <th class="user-tbl-th user-tbl-th--name">이름 / 이메일</th>
                <th class="user-tbl-th user-tbl-th--org">소속</th>
                <th class="user-tbl-th user-tbl-th--role">역할</th>
                <th class="user-tbl-th user-tbl-th--status">상태</th>
                <th class="user-tbl-th user-tbl-th--actions">관리</th>
              </tr>
            </thead>
            <tbody>${pagedList.map(renderUserRow).join('')}</tbody>
          </table>
        `;
      }
    }

    renderUserListAllPagination(totalCount, totalPages, filtered);
  } catch (error) {
    hideGlobalLoading();
    setAdminMessage(error.message || '사용자 목록 조회 중 오류가 발생했습니다.', 'error');
  } finally {
    if (searchBtn) searchBtn.disabled = false;
  }
}

// ─────────────────────────────────────────────
// 사용자 데이터 로드 (API 1회 호출 → allUsers 캐시)
// 이미 로드됐으면 재사용, forceReload=true면 강제 갱신
// ─────────────────────────────────────────────
async function loadUsers(forceReload = false) {
  // 로딩 중이면 완료될 때까지 대기
  if (usersLoading) {
    await new Promise((resolve) => {
      const interval = setInterval(() => {
        if (!usersLoading) { clearInterval(interval); resolve(); }
      }, 100);
    });
    if (!forceReload) return;
  }
  if (hasLoadedUsers && !forceReload) return;      // 캐시 있으면 재사용

  usersLoading = true;
  try {
    const result = await apiGet('listUsers', {
      request_user_email: getRequestUserEmail()
    });
    allUsers = Array.isArray(result.data) ? result.data : [];
    hasLoadedUsers = true;
  } catch (error) {
    allUsers = [];
    hasLoadedUsers = false;
    throw error;
  } finally {
    usersLoading = false;
  }
}

function renderUserListAllPagination(totalCount, totalPages, filtered) {
  const area = document.getElementById('userListAllPagination');
  if (!area) return;

  if (totalPages <= 1) { area.innerHTML = ''; return; }

  const page = userListAllPage;
  let btns = '';
  btns += `<button type="button" class="user-pg-btn" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>&#8249;</button>`;
  const start = Math.max(1, page - 2);
  const end   = Math.min(totalPages, page + 2);
  for (let i = start; i <= end; i++) {
    btns += `<button type="button" class="user-pg-btn ${i === page ? 'is-active' : ''}" data-page="${i}">${i}</button>`;
  }
  btns += `<button type="button" class="user-pg-btn" data-page="${page + 1}" ${page >= totalPages ? 'disabled' : ''}>&#8250;</button>`;
  area.innerHTML = btns;

  area.querySelectorAll('.user-pg-btn[data-page]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      const next = Number(btn.dataset.page);
      if (!next || next === userListAllPage || btn.disabled) return;
      userListAllPage = next;
      // 현재 필터 기준으로 해당 페이지 렌더
      const countEl = document.getElementById('userListAllCount');
      const listEl  = document.getElementById('userListAll');
      const totalCount2 = filtered.length;
      const totalPages2 = Math.max(1, Math.ceil(totalCount2 / USER_LIST_PAGE_SIZE));
      const s = (userListAllPage - 1) * USER_LIST_PAGE_SIZE;
      const paged = filtered.slice(s, s + USER_LIST_PAGE_SIZE);
      if (countEl) countEl.textContent = `총 ${totalCount2}명 / 전체 ${allUsers.length}명`;
      if (listEl && paged.length) {
        listEl.innerHTML = `
          <table class="user-tbl">
            <thead><tr>
              <th class="user-tbl-th user-tbl-th--name">이름 / 이메일</th>
              <th class="user-tbl-th user-tbl-th--org">소속</th>
              <th class="user-tbl-th user-tbl-th--role">역할</th>
              <th class="user-tbl-th user-tbl-th--status">상태</th>
              <th class="user-tbl-th user-tbl-th--actions">관리</th>
            </tr></thead>
            <tbody>${paged.map(renderUserRow).join('')}</tbody>
          </table>`;
      }
      renderUserListAllPagination(totalCount2, totalPages2, filtered);
    });
  });
}

// 단일 사용자 행 HTML 생성 — renderUserList와 searchUsersAll에서 공유
function renderUserRow(user) {
  const isActive = normalize(user.active || 'Y').toUpperCase() === 'Y';
  const statusClass = isActive ? 'active' : 'inactive';
  const statusText  = isActive ? '활성' : '비활성';
  const clinicText  = normalize(user.clinic_name) || '';
  const teamText    = normalize(user.team_name) || '';
  const orgLine = clinicText && teamText
    ? `${clinicText} / ${teamText}`
    : (normalize(user.department) || '-');
  const orgHtml = `<div class="user-tbl-org-main">${escapeHtml(orgLine)}</div>`;

  return `
    <tr class="user-tbl-row">
      <td class="user-tbl-cell user-tbl-cell--name">
        <div class="user-tbl-name">${escapeHtml(user.user_name || '-')}</div>
        <div class="user-tbl-sub">${escapeHtml(user.user_email || '')}</div>
      </td>
      <td class="user-tbl-cell user-tbl-cell--org">${orgHtml}</td>
      <td class="user-tbl-cell user-tbl-cell--role">${escapeHtml(user.role || 'user')}</td>
      <td class="user-tbl-cell user-tbl-cell--status">
        <span class="status-chip ${statusClass}">${statusText}</span>
      </td>
      <td class="user-tbl-cell user-tbl-cell--actions">
        <div class="user-tbl-actions">
          <button type="button" class="user-tbl-btn js-edit-user" data-email="${escapeHtml(user.user_email || '')}">수정</button>
          <button type="button" class="user-tbl-btn js-reset-password" data-email="${escapeHtml(user.user_email || '')}">PW초기화</button>
          <button type="button" class="user-tbl-btn ${isActive ? 'danger' : ''} js-toggle-active"
            data-email="${escapeHtml(user.user_email || '')}" data-active="${isActive ? 'N' : 'Y'}">
            ${isActive ? '비활성화' : '활성화'}
          </button>
        </div>
      </td>
    </tr>
  `;
}

function renderUserList(resetPage) {
  const listEl = document.getElementById('userList');
  const countEl = document.getElementById('userListCount');
  if (!listEl) return;

  if (resetPage) userListPage = 1;

  const keyword = normalize(document.getElementById('userSearchKeyword')?.value).toLowerCase();
  const activeFilter = normalize(document.getElementById('userFilterActive')?.value).toUpperCase();
  const roleFilter = normalize(document.getElementById('userFilterRole')?.value).toLowerCase();
  const clinicFilter = normalize(document.getElementById('userFilterClinic')?.value);

  const filteredUsers = allUsers.filter((user) => {
    const name = normalize(user.user_name).toLowerCase();
    const email = normalize(user.user_email).toLowerCase();
    const department = normalize(user.department).toLowerCase();
    const clinicName = normalize(user.clinic_name).toLowerCase();
    const teamName = normalize(user.team_name).toLowerCase();
    const active = normalize(user.active).toUpperCase();
    const role = normalize(user.role).toLowerCase();
    const clinicCode = normalize(user.clinic_code);

    const matchesKeyword =
      !keyword ||
      name.includes(keyword) ||
      email.includes(keyword) ||
      department.includes(keyword) ||
      clinicName.includes(keyword) ||
      teamName.includes(keyword);

    const matchesActive = !activeFilter || active === activeFilter;
    const matchesRole = !roleFilter || role === roleFilter;
    const matchesClinic = !clinicFilter || clinicCode === clinicFilter;

    return matchesKeyword && matchesActive && matchesRole && matchesClinic;
  });

  const totalCount = filteredUsers.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / USER_LIST_PAGE_SIZE));
  if (userListPage > totalPages) userListPage = totalPages;

  const start = (userListPage - 1) * USER_LIST_PAGE_SIZE;
  const pagedUsers = filteredUsers.slice(start, start + USER_LIST_PAGE_SIZE);

  if (countEl) {
    countEl.textContent = `총 ${totalCount}명 / 전체 ${allUsers.length}명`;
  }

  if (!filteredUsers.length) {
    listEl.innerHTML = `<div class="user-list-empty">조건에 맞는 사용자가 없습니다.</div>`;
    renderUserListPagination(0, 1);
    return;
  }

  const rows = pagedUsers.map(renderUserRow).join('');

  listEl.innerHTML = `
    <table class="user-tbl">
      <thead>
        <tr>
          <th class="user-tbl-th user-tbl-th--name">이름 / 이메일</th>
          <th class="user-tbl-th user-tbl-th--org">소속</th>
          <th class="user-tbl-th user-tbl-th--role">역할</th>
          <th class="user-tbl-th user-tbl-th--status">상태</th>
          <th class="user-tbl-th user-tbl-th--actions">관리</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
  renderUserListPagination(totalCount, totalPages);
}

function renderUserListPagination(totalCount, totalPages) {
  const area = document.getElementById('userListPagination');
  if (!area) return;

  if (totalPages <= 1) {
    area.innerHTML = '';
    return;
  }

  const page = userListPage;
  let btns = '';

  btns += `<button type="button" class="user-pg-btn" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>&#8249;</button>`;

  const start = Math.max(1, page - 2);
  const end   = Math.min(totalPages, page + 2);
  for (let i = start; i <= end; i++) {
    btns += `<button type="button" class="user-pg-btn ${i === page ? 'is-active' : ''}" data-page="${i}">${i}</button>`;
  }

  btns += `<button type="button" class="user-pg-btn" data-page="${page + 1}" ${page >= totalPages ? 'disabled' : ''}>&#8250;</button>`;

  area.innerHTML = btns;

  area.querySelectorAll('.user-pg-btn[data-page]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var next = Number(btn.dataset.page);
      if (!next || next === userListPage || btn.disabled) return;
      userListPage = next;
      renderUserList(false);
    });
  });
}

async function editUser(userEmail) {
  if (!userEmail) return;

  clearAdminMessage();
  showGlobalLoading('사용자 정보를 불러오는 중...');

  try {
    const result = await apiGet('getUserDetail', {
      user_email: userEmail,
      request_user_email: getRequestUserEmail()
    });

    const data = result.data || {};
    const user = data.user || {};
    const permissions = Array.isArray(data.permissions) ? data.permissions : [];

    document.getElementById('userEmail').value = user.user_email || '';
    document.getElementById('userName').value = user.user_name || '';
    document.getElementById('phone').value = user.phone || '';
    document.getElementById('globalRole').value = user.role || 'user';
    document.getElementById('userActive').value = user.active || 'Y';

    const clinicSelect = document.getElementById('clinic_code');
    if (clinicSelect) {
      clinicSelect.value = user.clinic_code || '';
    }

    if (orgBinder?.renderTeamsByClinic) {
      orgBinder.renderTeamsByClinic(user.clinic_code || '', user.team_code || '');
    } else {
      window.orgSelect.fillSelectOptions(
        document.getElementById('team_code'),
        [],
        { emptyText: '팀을 선택하세요' }
      );
      document.getElementById('team_code').value = user.team_code || '';
    }

    setPermissionValues(permissions);
    setEditMode(user);

    setAdminMessage(`사용자 ${user.user_name || user.user_email} 정보를 불러왔습니다.`, 'success');
  } catch (error) {
    setAdminMessage(error.message || '사용자 정보를 불러오지 못했습니다.', 'error');
  } finally {
    hideGlobalLoading();
  }
}

async function resetUserPassword(userEmail) {
  if (!userEmail) return;

  const confirmed = confirm(`"${userEmail}" 계정의 비밀번호를 1111로 초기화하시겠습니까?`);
  if (!confirmed) return;

  showGlobalLoading('비밀번호를 초기화하는 중...');

  try {
    const result = await apiPost('resetUserPassword', {
      request_user_email: getRequestUserEmail(),
      user_email: userEmail
    });

    setAdminMessage(result.message || '비밀번호가 초기화되었습니다.', 'success');

    await loadUsers(true);
    renderUserList(true);
  } catch (error) {
    setAdminMessage(error.message || '비밀번호 초기화 중 오류가 발생했습니다.', 'error');
  } finally {
    hideGlobalLoading();
  }
}

async function setUserActive(userEmail, active) {
  if (!userEmail) return;

  const actionLabel = active === 'Y' ? '활성화' : '비활성화';
  const confirmed = confirm(`"${userEmail}" 사용자를 ${actionLabel}하시겠습니까?`);
  if (!confirmed) return;

  showGlobalLoading(`사용자 ${actionLabel} 처리 중...`);

  try {
    const result = await apiPost('setUserActive', {
      request_user_email: getRequestUserEmail(),
      user_email: userEmail,
      active
    });

    setAdminMessage(result.message || `사용자 ${actionLabel} 처리가 완료되었습니다.`, 'success');

    if (editingUserEmail && editingUserEmail === userEmail && active === 'N') {
      resetEditMode(false);
    }

    await loadUsers(true);
    renderUserList(true);
    // 사용자 목록 탭도 갱신
    await searchUsersAll();
  } catch (error) {
    setAdminMessage(error.message || `사용자 ${actionLabel} 중 오류가 발생했습니다.`, 'error');
  } finally {
    hideGlobalLoading();
  }
}

function clearUserForm() {
  ['userEmail', 'userName', 'phone'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });

  const clinicSelect = document.getElementById('clinic_code');
  const teamSelect = document.getElementById('team_code');

  if (clinicSelect) {
    clinicSelect.value = '';
  }

  if (teamSelect) {
    window.orgSelect.fillSelectOptions(teamSelect, [], {
      emptyText: '팀을 선택하세요'
    });
  }

  const roleEl = document.getElementById('globalRole');
  if (roleEl) roleEl.value = 'user';

  const activeEl = document.getElementById('userActive');
  if (activeEl) activeEl.value = 'Y';

  // radio 권한: value 덮어쓰지 않고 '없음'(value="") radio를 checked로 초기화
  document.querySelectorAll('input.app-permission[value=""]').forEach((el) => {
    el.checked = true;
  });

  clearFieldInvalid();
}

function setPermissionValues(permissions = []) {
  const permissionMap = {};
  const scopeMap = {};

  permissions.forEach((item) => {
    if (item?.app_id && normalize(item.active || 'Y') === 'Y') {
      permissionMap[item.app_id] = item.permission || '';
      if (item.scope) scopeMap[item.app_id] = item.scope;
    }
  });

  // ★ radio 버튼 방식: 각 app_id별로 해당 value의 radio를 checked
  const seen = {};
  document.querySelectorAll('input.app-permission').forEach((el) => {
    const appId = normalize(el.dataset.appId);
    if (!appId) return;

    const targetVal = permissionMap[appId] || '';
    el.checked = (normalize(el.value) === targetVal);

    // 권한이 없으면 '없음'(value="") radio를 checked
    if (!seen[appId]) {
      seen[appId] = true;
      if (!targetVal) {
        const noneRadio = document.querySelector(`input.app-permission[data-app-id="${appId}"][value=""]`);
        if (noneRadio) noneRadio.checked = true;
      }
    }
  });

  // 조회범위 세분화(2026-06) — 기존 scope 값을 복원한다.
  document.querySelectorAll('input.app-scope').forEach((el) => {
    const appId = normalize(el.dataset.appId);
    if (!appId) return;
    const targetScope = scopeMap[appId] || '';
    el.checked = (normalize(el.value) === targetScope);
  });

  // 방금 채운 권한/범위 값에 맞춰 scope 그룹의 활성/비활성 상태를 다시 평가
  document.querySelectorAll('.perm-scope-group').forEach((scopeGroup) => {
    const appId = scopeGroup.dataset.scopeFor;
    const hasPermission = !!permissionMap[appId];
    scopeGroup.classList.toggle('perm-scope-group--disabled', !hasPermission);
    scopeGroup.querySelectorAll('input.app-scope').forEach((el) => { el.disabled = !hasPermission; });
  });
}

function setEditMode(user) {
  editingUserEmail = normalize(user.user_email).toLowerCase();

  const formTitle = document.getElementById('formTitle');
  const formDesc = document.getElementById('formDesc');
  const saveBtn = document.getElementById('saveUserBtn');
  const cancelBtn = document.getElementById('cancelEditBtn');
  const emailInput = document.getElementById('userEmail');
  const passwordHint = document.getElementById('passwordHint');

  if (formTitle) formTitle.textContent = '사용자 수정';
  if (formDesc) formDesc.textContent = '기존 사용자 정보를 수정하고 권한을 다시 저장합니다.';
  if (saveBtn) saveBtn.textContent = '사용자 수정';
  if (cancelBtn) cancelBtn.style.display = 'inline-flex';
  if (emailInput) emailInput.disabled = true;
  if (passwordHint) {
    passwordHint.innerHTML = '수정 모드에서는 이메일을 변경할 수 없습니다. 비밀번호 초기화는 우측 목록에서 진행할 수 있습니다.';
  }

  clearFieldInvalid();
}

function resetEditMode(clearMessage = true) {
  editingUserEmail = '';

  const formTitle = document.getElementById('formTitle');
  const formDesc = document.getElementById('formDesc');
  const saveBtn = document.getElementById('saveUserBtn');
  const cancelBtn = document.getElementById('cancelEditBtn');
  const emailInput = document.getElementById('userEmail');
  const passwordHint = document.getElementById('passwordHint');

  if (formTitle) formTitle.textContent = '사용자 등록';
  if (formDesc) formDesc.textContent = '신규 사용자를 등록하고 앱별 권한을 부여합니다.';
  if (saveBtn) saveBtn.textContent = '사용자 등록';
  if (cancelBtn) cancelBtn.style.display = 'none';
  if (emailInput) emailInput.disabled = false;
  if (passwordHint) {
    passwordHint.innerHTML = '신규 사용자는 초기 비밀번호 <strong>1111</strong>로 등록되며, 첫 로그인 후 변경하도록 안내됩니다.';
  }

  clearUserForm();

  if (clearMessage) {
    clearAdminMessage();
  }
}


// ── 가입 신청 관리 ──

function setPendingMessage(message, type = '') {
  const el = document.getElementById('pendingMessage');
  if (!el) return;
  el.textContent = message || '';
  el.className = 'message-box';
  if (type) el.classList.add(type);
}

async function loadPendingRegistrations() {
  const listEl = document.getElementById('pendingList');
  const countEl = document.getElementById('pendingListCount');
  const btn = document.getElementById('loadPendingBtn');

  if (btn) btn.disabled = true;
  setPendingMessage('');
  showGlobalLoading('가입 신청 목록을 불러오는 중...');

  try {
    const result = await apiGet('listPendingRegistrations', {
      request_user_email: getRequestUserEmail()
    });

    const list = Array.isArray(result.data) ? result.data : [];

    if (countEl) {
      countEl.textContent = list.length > 0
        ? `대기 중인 신청 ${list.length}건`
        : '대기 중인 신청이 없습니다.';
    }

    // ★ 탭 배지 업데이트
    const badge = document.getElementById('pendingBadge');
    if (badge) {
      if (list.length > 0) {
        badge.textContent = String(list.length);
        badge.style.display = '';
      } else {
        badge.style.display = 'none';
      }
    }

    if (!list.length) {
      listEl.innerHTML = `
        <div class="user-list-empty" style="text-align:center; padding:28px 16px;">
          ✅ 현재 대기 중인 가입 신청이 없습니다.
        </div>`;
      return;
    }

    listEl.innerHTML = list.map(item => {
      const id = escapeHtml(item.id || item.reg_id || '');
      const name = escapeHtml(item.user_name || '');
      const email = escapeHtml(item.user_email || '');
      const org = escapeHtml(
        item.clinic_name && item.team_name
          ? `${item.clinic_name} / ${item.team_name}`
          : item.clinic_name || item.team_name || '소속 미입력'
      );
      const phone = escapeHtml(item.phone || '연락처 없음');
      const memo = item.memo ? `<div class="pending-item__memo">💬 ${escapeHtml(item.memo)}</div>` : '';
      const appliedAt = escapeHtml(item.created_at || item.applied_at || '');

      return `
        <div class="pending-item" data-id="${id}">
          <div class="pending-item__main">
            <div class="pending-item__title">
              <strong>${name}</strong>
              <span>${email}</span>
            </div>
            <div class="pending-item__meta">
              <span>📍 ${org}</span>
              <span>📞 ${phone}</span>
              ${appliedAt ? `<span>🕐 ${appliedAt}</span>` : ''}
            </div>
            ${memo}
          </div>
          <div class="pending-item__actions">
            <button type="button" class="admin-btn small approve js-approve" data-id="${id}">✅ 승인</button>
            <button type="button" class="admin-btn small danger js-reject" data-id="${id}">❌ 거절</button>
          </div>
        </div>
      `;
    }).join('');

  } catch (err) {
    setPendingMessage(err.message || '신청 목록을 불러오지 못했습니다.', 'error');
    if (listEl) listEl.innerHTML = `<div class="user-list-empty">불러오기 실패. 다시 시도해 주세요.</div>`;
  } finally {
    if (btn) btn.disabled = false;
    hideGlobalLoading();
  }
}

async function handleApprove(regId) {
  if (!regId) return;

  const confirmed = confirm('신청을 승인하시겠습니까?\n초기 비밀번호 1111로 계정이 생성됩니다.');
  if (!confirmed) return;

  showGlobalLoading('승인 처리 중...');
  setPendingMessage('');

  try {
    const result = await apiPost('approveRegistration', {
      request_user_email: getRequestUserEmail(),
      reg_id: regId
    });
    setPendingMessage(result.message || '승인이 완료되었습니다.', 'success');
  } catch (err) {
    setPendingMessage(err.message || '승인 처리 중 오류가 발생했습니다.', 'error');
    return;
  } finally {
    hideGlobalLoading();
  }

  // 사용자 목록 캐시 강제 갱신 (승인된 계정이 즉시 반영되도록)
  await Promise.all([loadPendingRegistrations(), loadUsers(true)]);
}

async function handleReject(regId) {
  if (!regId) return;

  const reason = prompt('거절 사유를 입력하세요 (선택사항):');
  if (reason === null) return;

  showGlobalLoading('거절 처리 중...');
  setPendingMessage('');

  try {
    const result = await apiPost('rejectRegistration', {
      request_user_email: getRequestUserEmail(),
      reg_id: regId,
      reason: String(reason || '').trim()
    });
    setPendingMessage(result.message || '거절 처리가 완료되었습니다.', 'success');
  } catch (err) {
    setPendingMessage(err.message || '거절 처리 중 오류가 발생했습니다.', 'error');
    return;
  } finally {
    hideGlobalLoading();
  }

  // 사용자 목록 캐시 강제 갱신
  await Promise.all([loadPendingRegistrations(), loadUsers(true)]);
}
