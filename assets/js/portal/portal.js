document.addEventListener('DOMContentLoaded', async () => {
  const nameEl = document.getElementById('portalUserName');
  const subEl = document.getElementById('portalUserSub');
  const gridEl = document.getElementById('portalAppGrid');
  const emptyEl = document.getElementById('portalEmpty');
  const favSectionEl = document.getElementById('portalFavoritesSection');
  const favGridEl = document.getElementById('portalFavoritesGrid');
  const adminSectionEl = document.getElementById('portalAdminAppsSection');
  const adminGridEl = document.getElementById('portalAdminAppGrid');
  const logoutBtn = document.getElementById('logoutBtn');

  logoutBtn?.addEventListener('click', () => {
    try {
      showGlobalLoading('로그아웃 중...');
    } catch (e) {}
    window.auth.logout();
  });

  const user = window.auth?.getSession?.();
  if (!user) {
    alert('로그인 세션이 만료되었습니다.\n다시 로그인해 주세요.');
    location.replace(`${CONFIG.SITE_BASE_URL}/index.html`);
    return;
  }

  if (nameEl) {
    nameEl.textContent = user.name || user.email || '사용자';
  }

  if (subEl) {
    const clinicName = user.clinic_name || '';
    const teamName = user.team_name || '';
    const dept = user.department || ((clinicName && teamName) ? `${clinicName} / ${teamName}` : '소속 없음');
    const role = user.role || 'user';
    subEl.textContent = `${dept} / ${role}`;
  }

  const isAdmin = String(user.role || '').trim().toLowerCase() === 'admin';

  const startedAt = Date.now();

  try {
    showGlobalLoading('앱 목록 불러오는 중...');

    // 단일 진실 소스화(2026-06) — 11개 앱의 이름/설명/아이콘/URL/표시순서를
    // 여기 APP_MAP에 하드코딩하고 있었는데, 같은 정보가 users.html의 정적
    // 라디오 버튼 마크업과 user_app_permissions DB의 CHECK 제약에도 각각
    // 따로 하드코딩되어 있어 앱 하나 추가할 때마다 3곳을 사람이 맞춰
    // 고쳐야 했다. app_registry 테이블(GAS의 getAppRegistry API)을 단일
    // 진실 소스로 두고 동적으로 가져온다 — 이제 앱 추가는 그 테이블에
    // 행 하나 넣는 것으로 끝나고, 이 파일은 손댈 필요가 없다.
    const [registryResult, permissionResult] = await Promise.all([
      apiGet('getAppRegistry', { request_user_email: user.email }),
      apiGet('getUserPermissions', { user_email: user.email, request_user_email: user.email })
    ]);

    const appList = Array.isArray(registryResult.data) ? registryResult.data : [];
    // app_registry는 이미 sort_order로 정렬되어 내려오므로 그 순서를 그대로 표시 순서로 사용

    const permissions = Array.isArray(permissionResult.data) ? [...permissionResult.data] : [];

    // 관리자 전용 앱 자동 추가 (admin_auto_grant=true인 앱은 admin 역할이면 항상 접근 가능)
    if (isAdmin) {
      appList
        .filter(app => app.admin_auto_grant)
        .forEach(app => {
          if (!permissions.some(item => item.app_id === app.app_id)) {
            permissions.push({ app_id: app.app_id, permission: 'admin', active: 'Y' });
          }
        });
    }

    // support / support_admin 은 권한 기반으로만 노출 (강제 노출 제거)

    const grantedAppIds = new Set(
      permissions
        .filter(item => item && item.app_id && String(item.active || 'Y').trim().toUpperCase() === 'Y')
        .map(item => item.app_id)
    );

    // 카드 비활성 표시(2026-06) — 권한이 없는 앱은 기존엔 화면에서 완전히
    // 안 보였는데, 그러면 사용자가 어떤 앱이 있는지조차 몰라 권한 요청을
    // 할 수 없었다. admin_auto_grant=false인 일반 앱(의료장비/사인물/
    // 정도관리/업무일정/월마감/통계/규정/수정요청)은 권한이 없어도 카드를
    // 보여주되 클릭은 막는다(비활성). admin_auto_grant=true인 관리자 전용
    // 4개(사용자관리/시스템로그/수정요청관리/공지사항관리)는 기존처럼 권한
    // 없으면 완전히 숨긴다 — 일반 사용자에게 관리 기능 존재 자체를 노출하지 않기 위함.
    //
    // 컴팩트 재설계(2026-06) — 앱이 11개를 넘어가며 한 줄짜리 큰 카드가
    // 화면을 너무 많이 차지했다. 노션 스타일의 작은 정사각형 카드(아이콘
    // 칩 + 제목만, 설명문 생략)로 바꾸고, admin_auto_grant 플래그를 그대로
    // "업무 도구" / "관리자" 두 섹션 구분에 재사용한다(별도 category 컬럼
    // 추가 없이 기존 데이터로 충분). 즐겨찾기는 서버에 사용자별 테이블을
    // 새로 두지 않고 localStorage로 가볍게 구현한다.
    const workApps = appList.filter(app => !app.admin_auto_grant);
    const adminApps = appList.filter(app => app.admin_auto_grant);

    function isAppGranted(app) {
      return isAdmin || grantedAppIds.has(app.app_id);
    }

    function buildAppCard(app, options = {}) {
      const granted = isAppGranted(app);
      const muted = options.muted ? ' portal-app-card-compact--muted' : '';

      if (!granted) {
        return `
          <div class="portal-app-card-compact portal-app-card-compact--disabled" title="권한이 없습니다. 관리자에게 권한을 요청해 주세요.">
            <div class="portal-app-card-compact__icon"><i class="${escapeHtml(app.app_icon)}" aria-hidden="true"></i></div>
            <span class="portal-app-card-compact__title">${escapeHtml(app.app_name)}</span>
          </div>
        `;
      }

      return `
        <div class="portal-app-card-compact${muted}" role="link" tabindex="0" data-app-id="${escapeHtml(app.app_id)}" data-app-icon="${escapeHtml(app.app_icon)}" data-app-url="${escapeHtml(app.app_url)}">
          <button type="button" class="portal-app-card-compact__fav" data-fav-toggle="${escapeHtml(app.app_id)}" aria-label="즐겨찾기 토글">★</button>
          <div class="portal-app-card-compact__icon"><i class="${escapeHtml(app.app_icon)}" aria-hidden="true"></i></div>
          <span class="portal-app-card-compact__title">${escapeHtml(app.app_name)}</span>
        </div>
      `;
    }

    // 정렬(2026-06) — 기존엔 sort_order 그대로라 권한 있는 앱과 없는(비활성)
    // 앱이 뒤섞여 보였다. admin은 전체가 다 보이니 체감이 안 됐지만, 일반
    // 사용자에게는 권한 있는 앱이 먼저 와야 더 쓰기 편하다는 피드백에 따라
    // "권한 있음" 그룹을 앞으로 정렬한다. Array.sort는 ES2019부터 안정
    // 정렬이 표준이라, 같은 그룹 안에서는 기존 sort_order 순서가 유지된다.
    const sortByGrantedFirst = (a, b) => (isAppGranted(b) ? 1 : 0) - (isAppGranted(a) ? 1 : 0);

    const visibleWorkApps = [...workApps].sort(sortByGrantedFirst); // 업무 도구는 권한 없어도 비활성 카드로 항상 노출
    const visibleAdminApps = adminApps.filter(app => grantedAppIds.has(app.app_id) || isAdmin);

    if (!visibleWorkApps.length && !visibleAdminApps.length) {
      if (gridEl) gridEl.innerHTML = '';
      if (emptyEl) emptyEl.style.display = 'block';
      await delayUntilMinimum(startedAt, 400);
      return;
    }

    if (emptyEl) emptyEl.style.display = 'none';

    if (gridEl) {
      gridEl.innerHTML = visibleWorkApps.map(app => buildAppCard(app)).join('');
    }

    if (adminGridEl && adminSectionEl) {
      if (visibleAdminApps.length) {
        adminSectionEl.style.display = '';
        adminGridEl.innerHTML = visibleAdminApps.map(app => buildAppCard(app, { muted: true })).join('');
      } else {
        adminSectionEl.style.display = 'none';
      }
    }

    // 즐겨찾기(localStorage) — 클릭 가능한 앱(granted) 중 즐겨찾기로
    // 등록된 것만 모아 별도 섹션 맨 위에 보여준다.
    renderFavoritesSection([...workApps, ...adminApps].filter(isAppGranted));
    bindFavoriteToggles();
    bindAppCardNavigation();

    await delayUntilMinimum(startedAt, 400);

    // 공지사항은 앱 카드와 독립적인 영역이라 실패해도 앱 카드 표시에
    // 영향을 주지 않도록 별도로 감싼다.
    try {
      await loadPortalNotices(user.email);
    } catch (noticeError) {
      console.error('공지사항을 불러오지 못했습니다.', noticeError);
    }
  } catch (error) {
    if (gridEl) {
      gridEl.innerHTML = `
        <div class="portal-error-box">
          ${escapeHtml(error.message || '앱 목록을 불러오지 못했습니다.')}
        </div>
      `;
    }
  } finally {
    try {
      hideGlobalLoading();
    } catch (e) {}
  }
});

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function delayUntilMinimum(startedAt, minimumMs) {
  const elapsed = Date.now() - startedAt;
  const remain = Math.max(0, minimumMs - elapsed);
  if (remain > 0) {
    await delay(remain);
  }
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    try {
      hideGlobalLoading();
    } catch (e) {}
  }
});

// ─────────────────────────────────────────────
// 공지사항(2026-06)
// ─────────────────────────────────────────────

const NOTICE_DISMISS_STORAGE_KEY_PREFIX = 'portal_notice_dismissed';

/**
 * "오늘 하루 안 보기" 상태를 localStorage에 보관한다. 서버에 사용자별
 * 상태 테이블을 두지 않는 가벼운 방식 — 날짜가 바뀌면 자동으로 무효화된다.
 * 형태: { [notice_id]: 'yyyy-mm-dd' }
 *
 * (2026-06: "다시 보지 않음"(영구)으로 바꿨다가 사용자 확인 결과 원래
 * 의도가 "오늘 하루만"이 맞아 되돌림. 카드의 닫기뿐 아니라 상세 모달에도
 * 같은 옵션을 추가함 — 기존엔 모달에는 닫기 수단이 전혀 없었음.)
 *
 * (2026-06 추가 수정) — localStorage는 사용자가 아니라 브라우저 단위라,
 * A 계정에서 공지를 닫으면 같은 브라우저에서 로그아웃 후 B 계정으로
 * 로그인해도 그 공지가 안 보이는 문제가 있었다(사용자 확인). 키에 현재
 * 로그인 이메일을 포함시켜 계정별로 닫음 상태를 분리한다.
 */
function getNoticeDismissStorageKey() {
  const user = window.auth?.getSession?.();
  const email = (user && user.email) ? user.email.toLowerCase() : 'anonymous';
  return `${NOTICE_DISMISS_STORAGE_KEY_PREFIX}::${email}`;
}

function getDismissedNoticeMap() {
  try {
    return JSON.parse(localStorage.getItem(getNoticeDismissStorageKey()) || '{}');
  } catch (e) {
    return {};
  }
}

function todayDateString() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function isDismissedToday(noticeId) {
  const map = getDismissedNoticeMap();
  return map[noticeId] === todayDateString();
}

function dismissNoticeForToday(noticeId) {
  const map = getDismissedNoticeMap();
  map[noticeId] = todayDateString();
  try {
    localStorage.setItem(getNoticeDismissStorageKey(), JSON.stringify(map));
  } catch (e) {}
}

/**
 * 서버가 더 이상 내려주지 않는(노출기간이 끝났거나 삭제된) 공지 ID는
 * localStorage에 남겨둘 필요가 없으므로, 매번 서버 응답 기준으로 정리해
 * 무한히 쌓이는 것을 방지한다.
 */
function pruneDismissedNoticeMap(activeNoticeIds) {
  const map = getDismissedNoticeMap();
  const next = {};
  activeNoticeIds.forEach(id => {
    if (map[id]) next[id] = map[id];
  });
  try {
    localStorage.setItem(getNoticeDismissStorageKey(), JSON.stringify(next));
  } catch (e) {}
}

// 기본으로 펼쳐서 보여줄 일반(고정 아님) 공지 개수. 고정 공지는 이 제한과
// 무관하게 항상 전부 펼쳐서 보여준다(2026-06, 사용자 확인).
const NOTICE_DEFAULT_VISIBLE_COUNT = 3;

function buildNoticeRowHtml(n) {
  return `
    <div class="portal-notice-row${n.is_pinned ? ' portal-notice-row--pinned' : ''}" data-notice-id="${escapeHtml(n.notice_id)}">
      ${n.is_pinned ? '<span class="portal-notice-pin">📌</span>' : ''}
      <div class="portal-notice-row__main" data-open-notice="${escapeHtml(n.notice_id)}">
        <span class="portal-notice-row__title">${escapeHtml(n.title)}</span>
        <span class="portal-notice-row__date">${escapeHtml(n.created_at.slice(0, 10))}</span>
      </div>
      <button type="button" class="portal-notice-row__close" data-close-notice="${escapeHtml(n.notice_id)}" aria-label="오늘 하루 안 보기" title="오늘 하루 안 보기">×</button>
    </div>
  `;
}

async function loadPortalNotices(userEmail) {
  const sectionEl = document.getElementById('portalNoticeSection');
  const gridEl = document.getElementById('portalNoticeGrid');
  if (!sectionEl || !gridEl) return;

  const result = await apiGet('getActiveNotices', { request_user_email: userEmail });
  const allNotices = Array.isArray(result.data) ? result.data : [];

  // 서버가 더 이상 내려주지 않는 공지 ID는 dismiss 기록에서 정리한다.
  pruneDismissedNoticeMap(allNotices.map(n => n.notice_id));

  const notices = allNotices.filter(n => !isDismissedToday(n.notice_id));

  if (!notices.length) {
    sectionEl.style.display = 'none';
    return;
  }

  sectionEl.style.display = '';

  // 공지가 많아지면 화면 상단이 길게 늘어져 업무 도구 카드가 아래로 밀려나는
  // 문제(2026-06, 사용자 확인)를 막기 위해 일정 개수 넘으면 접는다. 서버가
  // is_pinned desc, created_at desc로 정렬해 내려주므로(고정 먼저, 그 안에서
  // 최신순), 고정 공지는 항상 모두 보여주고 일반 공지만 개수 제한을 둔다.
  const pinnedNotices = notices.filter(n => n.is_pinned);
  const normalNotices = notices.filter(n => !n.is_pinned);

  const visibleNormal = normalNotices.slice(0, NOTICE_DEFAULT_VISIBLE_COUNT);
  const hiddenNormal = normalNotices.slice(NOTICE_DEFAULT_VISIBLE_COUNT);

  const rowsHtml = [...pinnedNotices, ...visibleNormal].map(buildNoticeRowHtml).join('');
  const hiddenRowsHtml = hiddenNormal.map(buildNoticeRowHtml).join('');

  const toggleHtml = hiddenNormal.length
    ? `<button type="button" class="portal-notice-toggle" id="portalNoticeToggle">공지 ${hiddenNormal.length}건 더보기 ▾</button>`
    : '';

  gridEl.innerHTML = rowsHtml +
    (hiddenRowsHtml ? `<div id="portalNoticeHidden" class="portal-notice-hidden" style="display:none;">${hiddenRowsHtml}</div>` : '') +
    toggleHtml;

  document.getElementById('portalNoticeToggle')?.addEventListener('click', (event) => {
    const hiddenEl = document.getElementById('portalNoticeHidden');
    const toggleBtn = event.currentTarget;
    if (!hiddenEl) return;

    const isExpanded = hiddenEl.style.display !== 'none';
    hiddenEl.style.display = isExpanded ? 'none' : '';
    const remainingCount = hiddenEl.querySelectorAll('.portal-notice-row').length;
    toggleBtn.textContent = isExpanded
      ? `공지 ${remainingCount}건 더보기 ▾`
      : '접기 ▴';
  });

  gridEl.querySelectorAll('[data-open-notice]').forEach(el => {
    el.addEventListener('click', () => {
      const notice = notices.find(n => n.notice_id === el.dataset.openNotice);
      if (notice) openNoticeModal(notice);
    });
  });

  gridEl.querySelectorAll('[data-close-notice]').forEach(el => {
    el.addEventListener('click', (event) => {
      event.stopPropagation();
      dismissNoticeRow(event.currentTarget.dataset.closeNotice);
    });
  });
}

/**
 * 카드 목록에서 해당 공지 행을 제거하고, 더 이상 보일 공지가 없으면
 * 섹션 전체를 숨긴다(카드 닫기 버튼과 모달의 "오늘 하루 안 보기" 둘 다
 * 이 함수를 공유한다).
 */
function dismissNoticeRow(noticeId) {
  dismissNoticeForToday(noticeId);
  const gridEl = document.getElementById('portalNoticeGrid');
  const sectionEl = document.getElementById('portalNoticeSection');
  const hiddenEl = document.getElementById('portalNoticeHidden');
  const toggleBtn = document.getElementById('portalNoticeToggle');
  const row = gridEl?.querySelector(`[data-notice-id="${noticeId}"]`);
  if (row) row.remove();

  // 숨김 영역(더보기로 접힌 공지)이 전부 닫혀 비었으면 토글 버튼 자체를
  // 제거한다 — "공지 0건 더보기"라는 어색한 문구가 남는 것을 방지.
  if (hiddenEl && !hiddenEl.querySelector('.portal-notice-row')) {
    hiddenEl.remove();
    toggleBtn?.remove();
  } else if (toggleBtn && hiddenEl) {
    const isExpanded = hiddenEl.style.display !== 'none';
    toggleBtn.textContent = isExpanded
      ? '접기 ▴'
      : `공지 ${hiddenEl.querySelectorAll('.portal-notice-row').length}건 더보기 ▾`;
  }

  if (gridEl && !gridEl.querySelector('.portal-notice-row')) {
    if (sectionEl) sectionEl.style.display = 'none';
  }
}

function openNoticeModal(notice) {
  const modal = document.getElementById('noticeDetailModal');
  const titleEl = document.getElementById('noticeModalTitle');
  const metaEl = document.getElementById('noticeModalMeta');
  const contentEl = document.getElementById('noticeModalContent');
  const dismissCheckbox = document.getElementById('noticeModalDismissToday');
  if (!modal || !titleEl || !contentEl) return;

  modal.dataset.noticeId = notice.notice_id;
  titleEl.textContent = notice.title;

  if (metaEl) {
    const authorName = notice.created_by_name || notice.created_by || '';
    const writtenAt = (notice.created_at || '').replace(/-/g, '.').slice(0, 16);
    metaEl.innerHTML = `
      <span class="notice-modal__meta-item"><i class="ti ti-user" aria-hidden="true"></i>${escapeHtml(authorName)}</span>
      <span class="notice-modal__meta-item"><i class="ti ti-clock" aria-hidden="true"></i>${escapeHtml(writtenAt)}</span>
    `;
  }

  // 공지 내용은 관리자(admin)만 작성 가능한 신뢰된 입력이지만, 그래도
  // 줄바꿈만 허용하고 나머지는 escapeHtml로 이스케이프해 XSS를 방지한다.
  contentEl.innerHTML = escapeHtml(notice.content).replace(/\n/g, '<br>');
  if (dismissCheckbox) dismissCheckbox.checked = false;
  modal.style.display = '';
}

function closeNoticeModal() {
  const modal = document.getElementById('noticeDetailModal');
  if (!modal) return;

  // 모달 안의 "오늘 하루 안 보기" 체크박스가 켜져 있으면, 모달을 닫을 때
  // 카드 목록에서도 함께 제거한다(닫기 버튼/배경 클릭/체크박스 직접
  // 클릭 중 어떤 경로로 모달이 닫히든 동일하게 처리).
  const dismissCheckbox = document.getElementById('noticeModalDismissToday');
  const noticeId = modal.dataset.noticeId;
  if (dismissCheckbox?.checked && noticeId) {
    dismissNoticeRow(noticeId);
  }

  modal.style.display = 'none';
}

document.getElementById('noticeModalCloseBtn')?.addEventListener('click', closeNoticeModal);
document.getElementById('noticeModalBackdrop')?.addEventListener('click', closeNoticeModal);

// ─────────────────────────────────────────────
// 즐겨찾기(2026-06)
// ─────────────────────────────────────────────

const FAVORITE_APPS_STORAGE_KEY_PREFIX = 'portal_favorite_apps';

/**
 * 계정별 분리(2026-06) — localStorage는 브라우저 단위라, A 계정에서 등록한
 * 즐겨찾기가 같은 브라우저의 B 계정에도 그대로 보이는 문제가 있었다(공지
 * 사항 닫기와 동일한 원인). 키에 현재 로그인 이메일을 포함시켜 분리한다.
 */
function getFavoriteAppsStorageKey() {
  const user = window.auth?.getSession?.();
  const email = (user && user.email) ? user.email.toLowerCase() : 'anonymous';
  return `${FAVORITE_APPS_STORAGE_KEY_PREFIX}::${email}`;
}

function getFavoriteAppIds() {
  try {
    const raw = JSON.parse(localStorage.getItem(getFavoriteAppsStorageKey()) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch (e) {
    return [];
  }
}

function setFavoriteAppIds(ids) {
  try {
    localStorage.setItem(getFavoriteAppsStorageKey(), JSON.stringify(ids));
  } catch (e) {}
}

function isFavoriteApp(appId) {
  return getFavoriteAppIds().includes(appId);
}

function toggleFavoriteApp(appId) {
  const ids = getFavoriteAppIds();
  const idx = ids.indexOf(appId);
  if (idx > -1) {
    ids.splice(idx, 1);
  } else {
    ids.push(appId);
  }
  setFavoriteAppIds(ids);
}

/**
 * grantedApps(클릭 가능한 앱 전체) 중 즐겨찾기로 등록된 것만 모아
 * portalFavoritesSection에 렌더링한다. 즐겨찾기가 비어 있으면 섹션 자체를
 * 숨긴다.
 */
function renderFavoritesSection(grantedApps) {
  const sectionEl = document.getElementById('portalFavoritesSection');
  const gridEl = document.getElementById('portalFavoritesGrid');
  if (!sectionEl || !gridEl) return;

  const favoriteIds = getFavoriteAppIds();
  const favoriteApps = grantedApps.filter(app => favoriteIds.includes(app.app_id));

  if (!favoriteApps.length) {
    sectionEl.style.display = 'none';
    gridEl.innerHTML = '';
    return;
  }

  sectionEl.style.display = '';
  gridEl.innerHTML = favoriteApps.map(app => `
    <div class="portal-app-card-compact" role="link" tabindex="0" data-app-id="${escapeHtml(app.app_id)}" data-app-icon="${escapeHtml(app.app_icon)}" data-app-url="${escapeHtml(app.app_url)}">
      <button type="button" class="portal-app-card-compact__fav portal-app-card-compact__fav--active" data-fav-toggle="${escapeHtml(app.app_id)}" aria-label="즐겨찾기 해제">★</button>
      <div class="portal-app-card-compact__icon"><i class="${escapeHtml(app.app_icon)}" aria-hidden="true"></i></div>
      <span class="portal-app-card-compact__title">${escapeHtml(app.app_name)}</span>
    </div>
  `).join('');
}

/**
 * 이벤트 위임(2026-06) — 처음엔 그리드를 다시 그릴 때마다
 * querySelectorAll('[data-fav-toggle]').forEach(... addEventListener ...)로
 * 매번 새 리스너를 추가했는데, innerHTML로 그려진 새 버튼에는 리스너가
 * 없는 게 아니라 같은 버튼이 여러 번 다시 그려질 때마다(즐겨찾기 토글 →
 * 재렌더링 → 그 안의 버튼에 또 바인딩) 핸들러가 계속 누적되는 구조적
 * 결함이 있었다. document에 한 번만 위임 리스너를 걸어 해결한다.
 */
let favoriteTogglesBound = false;
function bindFavoriteToggles() {
  if (favoriteTogglesBound) return;
  favoriteTogglesBound = true;

  document.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-fav-toggle]');
    if (!btn) return;

    event.preventDefault();
    event.stopPropagation();
    const appId = btn.dataset.favToggle;
    toggleFavoriteApp(appId);
    btn.classList.toggle('portal-app-card-compact__fav--active', isFavoriteApp(appId));

    const grantedApps = [
      ...document.querySelectorAll('#portalAppGrid [data-app-id], #portalAdminAppGrid [data-app-id]')
    ].map(el => ({
      app_id: el.dataset.appId,
      app_icon: el.dataset.appIcon || '',
      app_name: el.querySelector('.portal-app-card-compact__title')?.textContent || '',
      app_url: el.dataset.appUrl || ''
    }));
    renderFavoritesSection(grantedApps);
  });
}

/**
 * 카드 클릭/Enter키로 앱 페이지 이동(2026-06) — 기존엔 카드 자체가
 * <a href="..."> 였고 즐겨찾기 별표 <button>이 그 안에 중첩되어 있었다.
 * <a> 안에 <button>을 넣는 건 HTML5에서 인터랙티브 콘텐츠 중첩으로
 * 허용되지 않으며, 모바일 브라우저(특히 iOS Safari)는 이런 구조에서
 * 첫 탭을 hover 진입으로만 처리하고 실제 이동은 두 번째 탭에서야
 * 일어나는 경우가 있어 "한 번에 안 눌리는" 증상의 원인이 됐다(사용자
 * 확인). 카드를 <div role="link">로 바꾸고, 별표 클릭은 이동을 막고
 * 토글만 처리, 그 외 카드 영역 클릭/Enter키는 이동을 처리하도록 분리.
 */
let appCardNavigationBound = false;
function bindAppCardNavigation() {
  if (appCardNavigationBound) return;
  appCardNavigationBound = true;

  function navigateIfCard(target) {
    const card = target.closest('.portal-app-card-compact[role="link"]');
    if (!card) return;
    const appUrl = card.dataset.appUrl;
    if (appUrl) location.href = `${CONFIG.SITE_BASE_URL}${appUrl}`;
  }

  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-fav-toggle]')) return; // 별표는 별도 핸들러가 처리
    navigateIfCard(event.target);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (event.target.closest('[data-fav-toggle]')) return;
    const card = event.target.closest('.portal-app-card-compact[role="link"]');
    if (!card) return;
    event.preventDefault();
    navigateIfCard(event.target);
  });
}
