const DASHBOARD_SESSION_KEY          = CONFIG.CACHE_KEYS.DASHBOARD_SESSION;
const DASHBOARD_SESSION_TTL          = 1000 * 60 * 5;

const DASHBOARD_PERMISSION_CACHE_KEY = CONFIG.CACHE_KEYS.DASHBOARD_PERMISSION;
const DASHBOARD_PERMISSION_CACHE_TTL = 1000 * 60 * 5;

let DASHBOARD_BOOTSTRAPPED = false;
let DASHBOARD_PERMISSION = { canView: false, canEdit: false, canDelete: false };

function dq(selector) {
  return document.querySelector(selector);
}

function textSafe(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatNumberLocal(value) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num.toLocaleString('ko-KR') : '0';
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
    return `${yyyy}-${mm}-${dd}`;
  }

  return raw;
}

function getCurrentUserEmail() {
  const user = window.auth?.getSession?.() || {};
  return String(user.email || user.user_email || '').trim().toLowerCase();
}

function getDashboardSessionCache() {
  try {
    const raw = sessionStorage.getItem(DASHBOARD_SESSION_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.savedAt) return null;
    if (Date.now() - parsed.savedAt > DASHBOARD_SESSION_TTL) return null;

    return parsed.data || null;
  } catch (error) {
    return null;
  }
}

function setDashboardSessionCache(data) {
  try {
    sessionStorage.setItem(
      DASHBOARD_SESSION_KEY,
      JSON.stringify({
        savedAt: Date.now(),
        data
      })
    );
  } catch (error) {}
}

function invalidateDashboardSessionCache() {
  try {
    sessionStorage.removeItem(DASHBOARD_SESSION_KEY);
  } catch (error) {}
}

window.invalidateDashboardSessionCache = invalidateDashboardSessionCache;

function getDashboardPermissionCache() {
  try {
    const raw = sessionStorage.getItem(DASHBOARD_PERMISSION_CACHE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.savedAt) return null;
    if (Date.now() - parsed.savedAt > DASHBOARD_PERMISSION_CACHE_TTL) return null;

    return parsed.data || null;
  } catch (error) {
    return null;
  }
}

function setDashboardPermissionCache(data) {
  try {
    sessionStorage.setItem(
      DASHBOARD_PERMISSION_CACHE_KEY,
      JSON.stringify({
        savedAt: Date.now(),
        data
      })
    );
  } catch (error) {}
}

function invalidateDashboardPermissionCache() {
  try {
    sessionStorage.removeItem(DASHBOARD_PERMISSION_CACHE_KEY);
  } catch (error) {}
}

async function getEquipmentPermissionContext() {
  const user = window.auth?.getSession?.() || null;
  const userEmail = getCurrentUserEmail();

  if (!user || !userEmail) {
    return { canView: false, canEdit: false, canDelete: false };
  }

  const cached = getDashboardPermissionCache();
  if (cached) {
    return cached;
  }

  const role = String(user.role || '').trim().toLowerCase();
  if (role === 'admin') {
    const adminPermission = { canView: true, canEdit: true, canDelete: true };
    setDashboardPermissionCache(adminPermission);
    return adminPermission;
  }

  try {
    const result = await apiGet('getUserAppPermission', {
      user_email: userEmail,
      app_id: 'equipment',
      request_user_email: userEmail
    });

    const permission = String(result?.data?.permission || '').trim().toLowerCase();

    const normalized = {
      canView: ['view', 'edit', 'admin'].includes(permission),
      canEdit: ['edit', 'admin'].includes(permission),
      canDelete: false
    };

    setDashboardPermissionCache(normalized);
    return normalized;
  } catch (error) {
    return { canView: false, canEdit: false, canDelete: false };
  }
}

function applyDashboardPermissionUi() {
  const createAction = dq('#dashboardCreateEquipmentAction');
  if (createAction) {
    createAction.style.display = DASHBOARD_PERMISSION.canEdit ? '' : 'none';
  }

  const exportAction = dq('#dashboardExportBtn');
  if (exportAction) {
    exportAction.style.display = DASHBOARD_PERMISSION.canEdit ? '' : 'none';
    exportAction.addEventListener('click', exportAllEquipmentsExcel);
  }

  const exportActionBar = dq('#dashboardActionBarExport');
  if (exportActionBar) {
    exportActionBar.style.display = DASHBOARD_PERMISSION.canEdit ? '' : 'none';
    exportActionBar.addEventListener('click', exportAllEquipmentsExcel);
  }

  const createActionBar = dq('#dashboardActionBarCreate');
  if (createActionBar) {
    createActionBar.style.display = DASHBOARD_PERMISSION.canEdit ? '' : 'none';
  }

  // ── 의원별 조회 접근 제한 ──
  // 서울숲의원 외 의원은 조회/목록 버튼 비활성화
  const user = window.auth?.getSession?.() || null;
  const clinicAllowed = isEquipmentClinicAllowed(user);

  if (!clinicAllowed) {
    const BLOCK_MSG = '현재 의료장비 관리는 서울숲의원만 사용 가능합니다.\n다른 의원은 순차적으로 오픈될 예정입니다.';

    // 장비목록 (헤더 nav)
    const navList = dq('a[href="list.html"].portal-header-btn');
    if (navList) {
      navList.removeAttribute('href');
      navList.style.opacity = '0.4';
      navList.style.cursor = 'not-allowed';
      navList.style.pointerEvents = 'none';
    }

    // 장비 조회 (PC 액션바)
    const listActionBar = dq('#dashboardActionBarList');
    if (listActionBar) {
      listActionBar.removeAttribute('href');
      listActionBar.style.opacity = '0.4';
      listActionBar.style.cursor = 'not-allowed';
      listActionBar.style.pointerEvents = 'none';
      listActionBar.addEventListener('click', function(e) {
        e.preventDefault();
        alert(BLOCK_MSG);
      });
    }

    // 장비 조회 (모바일 액션카드)
    const listActionCard = dq('#dashboardActionCardList');
    if (listActionCard) {
      listActionCard.removeAttribute('href');
      listActionCard.style.opacity = '0.4';
      listActionCard.style.cursor = 'not-allowed';
      listActionCard.style.pointerEvents = 'none';
      listActionCard.addEventListener('click', function(e) {
        e.preventDefault();
        alert(BLOCK_MSG);
      });
    }

    // 안내 메시지 표시
    if (typeof showMessage === 'function') {
      showMessage('현재 의료장비 관리는 서울숲의원만 사용 가능합니다. 다른 의원은 순차적으로 오픈될 예정입니다.', 'info');
    }
  }
}

// ─────────────────────────────────────────────
// 빠른 검색 (액션 바)
// ─────────────────────────────────────────────

function initDashboardQuickSearch() {
  const user = window.auth?.getSession?.() || null;
  const clinicAllowed = isEquipmentClinicAllowed(user);

  // ── 공통: 권한별 검색 URL 생성 ──
  function buildSearchUrl(keyword) {
    const session = window.auth?.getSession?.() || {};
    const isAdmin = String(session.role || '').trim().toLowerCase() === 'admin';
    const url = new URL('list.html', location.href);
    url.searchParams.set('keyword', keyword);
    if (!isAdmin) {
      const teamCode = String(session.team_code || '').trim();
      if (teamCode) url.searchParams.set('team_code', teamCode);
    }
    return url.toString();
  }

  // ── 공통: 검색 실행 ──
  function executeSearch(inputEl) {
    const keyword = inputEl.value.trim();
    if (!keyword) { inputEl.focus(); return; }
    location.href = buildSearchUrl(keyword);
  }

  // ── PC 액션바 검색창 ──
  (function initPcSearch() {
    const wrap      = document.getElementById('dashboardActionBarSearchWrap');
    const input     = document.getElementById('dashboardQuickSearch');
    const clearBtn  = document.getElementById('dashboardQuickSearchClear');
    const searchBtn = document.getElementById('dashboardQuickSearchBtn');
    if (!wrap || !input) return;

    if (!clinicAllowed) {
      wrap.style.opacity = '0.4';
      wrap.style.pointerEvents = 'none';
      input.placeholder = '이용 불가 (미오픈 의원)';
      return;
    }

    input.addEventListener('input', function () {
      clearBtn.style.display = input.value ? '' : 'none';
    });
    clearBtn.addEventListener('click', function () {
      input.value = '';
      clearBtn.style.display = 'none';
      input.focus();
    });
    if (searchBtn) searchBtn.addEventListener('click', function () { executeSearch(input); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); executeSearch(input); }
    });
  })();

  // ── 모바일 빠른 작업 패널 검색창 ──
  (function initMobileSearch() {
    const wrap      = document.getElementById('dashboardMobileSearchWrap');
    const input     = document.getElementById('dashboardMobileSearch');
    const clearBtn  = document.getElementById('dashboardMobileSearchClear');
    const searchBtn = document.getElementById('dashboardMobileSearchBtn');
    if (!wrap || !input) return;

    if (!clinicAllowed) {
      wrap.style.opacity = '0.4';
      wrap.style.pointerEvents = 'none';
      input.placeholder = '이용 불가 (미오픈 의원)';
      return;
    }

    input.addEventListener('input', function () {
      clearBtn.style.display = input.value ? '' : 'none';
    });
    clearBtn.addEventListener('click', function () {
      input.value = '';
      clearBtn.style.display = 'none';
      input.focus();
    });
    if (searchBtn) searchBtn.addEventListener('click', function () { executeSearch(input); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); executeSearch(input); }
    });
  })();
}

function renderDashboardSkeleton() {
  ['#maintenanceAlertList', '#recentRepairList', '#recentRegisteredList'].forEach(function (selector) {
    const el = dq(selector);
    if (!el) return;
    el.innerHTML = '<div class="empty-box">불러오는 중...</div>';
  });
}

function renderKpis(summary) {
  const kpis = summary?.kpis || {};
  if (dq('#totalCount')) dq('#totalCount').textContent = formatNumberLocal(kpis.total || 0);
  if (dq('#inUseCount')) dq('#inUseCount').textContent = formatNumberLocal(kpis.in_use || 0);
  if (dq('#repairingCount')) dq('#repairingCount').textContent = formatNumberLocal(kpis.repairing || 0);
  if (dq('#inspectingCount')) dq('#inspectingCount').textContent = formatNumberLocal(kpis.inspecting || 0);
  if (dq('#recentRepairCount')) dq('#recentRepairCount').textContent = formatNumberLocal(kpis.recent_repairs || 0);
  if (dq('#recentRegisterCount')) dq('#recentRegisterCount').textContent = formatNumberLocal(kpis.recent_registrations || 0);
}

function renderRecordList(containerSelector, emptySelector, items, options) {
  const container = dq(containerSelector);
  const emptyEl   = dq(emptySelector);
  if (!container) return;

  const list       = Array.isArray(items) ? items : [];
  const hasSide    = typeof options.sideRenderer === 'function';
  const showDept   = options.showDept !== false;
  const showDate   = options.showDate !== false;
  const showStatus = options.showStatus === true;
  const hasExtra   = !!options.extraField;
  const isMobile   = window.innerWidth <= 700;

  // 별도 theadContainer 완전히 숨김
  const theadMap = {
    'maintenanceAlertList':  'maintenanceAlertThead',
    'recentRepairList':      'recentRepairThead',
    'recentRegisteredList':  'recentRegisteredThead'
  };
  const theadContainer = document.getElementById(theadMap[container.id] || '');
  if (theadContainer) theadContainer.style.display = 'none';

  // 컬럼 너비 — colgroup으로 thead/tbody 동시 적용
  const cols = (function() {
    const id = container.id;
    if (id === 'maintenanceAlertList') {
      return isMobile
        ? ['40%', '34%', '26%']
        : (hasExtra ? ['28%', '26%', '22%', '24%'] : ['36%', '36%', '28%']);
    }
    if (id === 'recentRepairList') {
      return isMobile
        ? ['24%', '24%', '26%', '26%']
        : ['32%', '28%', '22%', '18%'];
    }
    return ['38%', '36%', '26%']; // registered
  })();

  const colgroup = `<colgroup>${cols.map(w => `<col style="width:${w};">`).join('')}</colgroup>`;

  // th — text-align 인라인 직접 지정
  const th = (label, align, extraStyle) =>
    `<th style="text-align:${align || 'center'};padding:9px 8px;${align === 'left' ? 'padding-left:18px;' : ''}position:sticky;top:0;background:#f7f9fd;border-bottom:1.5px solid #e0e7f2;z-index:2;font-size:10px;line-height:1;font-weight:800;color:#3d5068;letter-spacing:.04em;text-transform:uppercase;white-space:nowrap;${extraStyle || ''}">${label}</th>`;

  const theadRow = [
    th('장비명', 'left'),
    showDept              ? th('부서')                       : '',
    showDate              ? th(options.dateLabel || '')      : '',
    hasExtra && !isMobile ? th(options.extraLabel || '')     : '',
    showStatus            ? th('상태')                       : '',
    hasSide               ? th(options.sideLabel || '')      : ''
  ].join('');

  if (!list.length) {
    container.style.display = 'block';
    container.setAttribute('data-empty', 'true');
    if (emptyEl) emptyEl.style.display = 'block';
    container.innerHTML = `<table style="width:100%;table-layout:fixed;border-collapse:separate;border-spacing:0;">${colgroup}<thead><tr>${theadRow}</tr></thead></table>`;
    return;
  }

  container.removeAttribute('data-empty');

  if (emptyEl) emptyEl.style.display = 'none';

  const rows = list.map(function(item) {
    const title    = textSafe(item.equipment_name || '-');
    const model    = textSafe(item.model_name || '-');
    const dateText = textSafe(formatDisplayDate(item[options.dateField]));
    const deptRaw  = item.department_display || item.department || '-';
    const dept     = textSafe(deptRaw);
    const deptMobile = dept.replace(' / ', '<br>');
    const eid      = encodeURIComponent(item.equipment_id || '');

    const cellFs  = isMobile ? '11px' : '12px';
    const subFs   = isMobile ? '9px'  : '10px';

    const td = (content, align) =>
      `<td class="dash-tbl-cell" style="padding:10px 8px;font-size:${cellFs};border-bottom:1px solid #edf1f7;vertical-align:middle;overflow:hidden;text-overflow:ellipsis;text-align:${align || 'center'};">${content}</td>`;

    const tdName = `<td class="dash-tbl-cell dash-tbl-cell--name" style="padding:10px 8px;padding-left:18px;font-size:${cellFs};border-bottom:1px solid #edf1f7;vertical-align:middle;text-align:left;">
      <div class="dash-tbl-name">${title}</div>
      <div class="dash-tbl-sub" style="font-size:${subFs};">${model}</div>
    </td>`;

    const tdDept = showDept ? td(
      `<span class="dept-pc">${dept}</span><span class="dept-mobile">${deptMobile}</span>`
    ) : '';

    const tdDate = showDate ? td(dateText) : '';

    let tdExtra = '';
    if (hasExtra && !isMobile) {
      const rawVal  = item[options.extraField] || '-';
      const dispVal = textSafe(formatDisplayDate(rawVal) || rawVal);
      tdExtra = td(dispVal);
    }

    let tdStatus = '';
    if (showStatus) {
      const st     = item.status || '';
      const labels = { IN_USE:'사용중', REPAIRING:'수리중', INSPECTING:'점검중', STORED:'보관', DISPOSED:'폐기' };
      const classes = { IN_USE:'is-in-use', REPAIRING:'is-repairing', INSPECTING:'is-inspecting', STORED:'is-stored', DISPOSED:'is-disposed' };
      const label  = labels[st] || textSafe(st) || '-';
      const cls    = 'status-badge ' + (classes[st] || '');
      tdStatus = td(`<span class="${cls}">${label}</span>`);
    }

    const tdSide = hasSide
      ? `<td style="padding:6px 4px;border-bottom:1px solid #edf1f7;vertical-align:middle;">${options.sideRenderer(item) || ''}</td>`
      : '';

    return `<tr class="dash-tbl-row" onclick="location.href='detail.html?id=${eid}'" style="cursor:pointer;">${tdName}${tdDept}${tdDate}${tdExtra}${tdStatus}${tdSide}</tr>`;
  }).join('');

  container.style.display = 'block';
  container.innerHTML = `<table style="width:100%;table-layout:fixed;border-collapse:separate;border-spacing:0;">${colgroup}<thead><tr>${theadRow}</tr></thead><tbody>${rows}</tbody></table>`;
}

function renderMaintenanceAlerts(items) {
  renderRecordList('#maintenanceAlertList', '#maintenanceAlertEmpty', items, {
    dateField: 'maintenance_end_date',
    dateLabel: '',
    sideLabel: 'D-Day',
    showDept: true,
    showDate: false,
    extraField: 'maintenance_end_date',
    extraLabel: '만료일',   // 날짜 제거 — D-Day 뱃지로 충분
    sideRenderer: function (item) {
      const dday = Number(item.dday || 0);
      const ddayText =
        dday < 0 ? `D+${Math.abs(dday)}`
        : dday === 0 ? 'D-DAY'
        : `D-${dday}`;

      const badgeClass =
        dday < 0
          ? 'dashboard-dday-badge is-overdue'
          : dday <= 30
          ? 'dashboard-dday-badge'
          : 'dashboard-dday-badge is-normal';

      return `
        <div class="dashboard-record-side">
          <span class="${badgeClass}">${textSafe(ddayText)}</span>
        </div>
      `;
    }
  });
}

function renderRecentRepairList(items) {
  renderRecordList('#recentRepairList', '#recentRepairEmpty', items, {
    dateField: 'work_date',
    dateLabel: '수리일',
    showDept: true,
    showDate: true,
    showStatus: true
  });
}

function renderRecentRegisteredList(items) {
  renderRecordList('#recentRegisteredList', '#recentRegisteredEmpty', items, {
    dateField: 'created_at',
    dateLabel: '등록일',
    showDept: true,
    showDate: true
  });
}

function renderDashboardData(summary) {
  renderKpis(summary || {});
  renderMaintenanceAlerts(summary?.maintenance_alerts || []);
  renderRecentRepairList(summary?.recent_repairs || []);
  renderRecentRegisteredList(summary?.recent_registrations || []);
  renderHeatmap(summary?.department_summary || []);
}

async function fetchDashboardData() {
  const userEmail = getCurrentUserEmail();

  const summaryResult = await apiGet('getEquipmentDashboardSummary', {
    request_user_email: userEmail
  });

  return {
    summary: summaryResult?.data || {}
  };
}

function renderDeptChart(data) {
  const wrap  = document.getElementById('deptChartWrap');
  const empty = document.getElementById('deptChartEmpty');
  if (!wrap) return;

  if (!data || data.length === 0) { if (empty) empty.style.display = ''; return; }
  if (empty) empty.style.display = 'none';

  const COLORS = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4'];
  const total  = data.reduce((s, d) => s + Number(d.count || 0), 0);
  if (total === 0) { if (empty) empty.style.display = ''; return; }

  const rows = data.map(function (d, i) {
    const count  = Number(d.count || 0);
    const pct    = Math.round((count / total) * 100);
    const color  = COLORS[i % COLORS.length];
    const name   = textSafe(d.department_display || d.department || '-');
    const barPct = Math.max(pct, 8);
    return `
      <div class="dept-cbar-row">
        <div class="dept-cbar-label" title="${name}">${name}</div>
        <div class="dept-cbar-track">
          <div class="dept-cbar-fill" style="width:${barPct}%;background:${color};">
            <span class="dept-cbar-inline">${count}대&nbsp;&nbsp;${pct}%</span>
          </div>
        </div>
      </div>`;
  }).join('');

  wrap.innerHTML = `<div class="dept-cbar-list">${rows}</div>`;
}

function renderHeatmap(data) {
  const wrap  = document.getElementById('heatmapWrap');
  const empty = document.getElementById('heatmapEmpty');
  if (!wrap) return;

  if (!data || data.length === 0) { if (empty) empty.style.display = ''; return; }
  if (empty) empty.style.display = 'none';

  const STATUS_KEYS = {
    in_use:     'IN_USE',
    repairing:  'REPAIRING',
    inspecting: 'INSPECTING',
    stored:     'STORED'
  };

  const COLS = [
    { key: 'in_use',     label: '사용중', bg: '#dbeafe', fg: '#1d4ed8' },
    { key: 'repairing',  label: '수리중', bg: '#fee2e2', fg: '#dc2626' },
    { key: 'inspecting', label: '점검중', bg: '#fef9c3', fg: '#ca8a04' },
    { key: 'stored',     label: '보관',   bg: '#dcfce7', fg: '#16a34a' }
  ];

  const headerCells = COLS.map(c => `<div class="hm-th">${c.label}</div>`).join('');

  const thead = document.getElementById('heatmapThead');
  if (thead) {
    thead.innerHTML = `<div class="hm-header-row"><div class="hm-dept-th">의원 / 부서명</div>${headerCells}</div>`;
    thead.style.display = '';
  }

  const dataRows = data.map(function (dept) {
    const name       = textSafe(dept.department_display || dept.department || '-');
    const teamCode   = encodeURIComponent(dept.team_code || '');
    const clinicCode = encodeURIComponent(dept.clinic_code || '');

    const cells = COLS.map(function (c) {
      const val = Number(dept[c.key] || 0);
      if (val === 0) return `<div class="hm-cell hm-cell--empty">—</div>`;

      const statusKey = STATUS_KEYS[c.key];
      const url = `list.html?clinic_code=${clinicCode}&team_code=${teamCode}&status=${statusKey}`;
      return `<div class="hm-cell hm-cell--link" style="background:${c.bg};color:${c.fg};cursor:pointer;" onclick="location.href='${url}'" title="${name} ${c.label} 조회">${val}</div>`;
    }).join('');

    return `<div class="hm-row"><div class="hm-dept" title="${name}">${name}</div>${cells}</div>`;
  }).join('');

  wrap.innerHTML = `
    <div class="hm-table">
      ${dataRows}
    </div>`;
}

function initPanelCarousel() {
  const scrollEl = dq('#dashboardPanelsScroll');
  const dotsWrap = dq('#dashboardPanelDots');
  if (!scrollEl || !dotsWrap) return;

  const dots = Array.from(dotsWrap.querySelectorAll('.dashboard-panel-dot'));

  function setActive(index) {
    dots.forEach(function (dot, i) {
      dot.classList.toggle('is-active', i === index);
    });
  }

  function getPanelWidth() {
    const firstCard = scrollEl.querySelector('.dashboard-panel--portal');
    if (!firstCard) return scrollEl.offsetWidth || 1;
    return firstCard.offsetWidth;
  }

  function getSortedCards() {
    const cards = Array.from(scrollEl.querySelectorAll('.dashboard-panel--portal'));
    return cards.sort(function (a, b) {
      return a.getBoundingClientRect().left - b.getBoundingClientRect().left;
    });
  }

  function updateActiveByScroll() {
    if (window.innerWidth > 768) {
      setActive(0);
      return;
    }

    const width = getPanelWidth();
    const index = Math.round(scrollEl.scrollLeft / width);
    setActive(Math.max(0, Math.min(index, dots.length - 1)));
  }

  dots.forEach(function (dot) {
    dot.addEventListener('click', function () {
      if (window.innerWidth > 768) return;

      const index = Number(dot.dataset.index || 0);
      const width = getPanelWidth();

      scrollEl.scrollTo({
        left: width * index,
        behavior: 'smooth'
      });

      setActive(index);
    });
  });

  scrollEl.addEventListener('scroll', updateActiveByScroll, { passive: true });
  window.addEventListener('resize', updateActiveByScroll);

  // 초기 dot은 항상 0번 — 레이아웃 완성 후 한 번 더 보정
  setActive(0);
  requestAnimationFrame(function () {
    requestAnimationFrame(updateActiveByScroll);
  });
}

async function loadDashboard() {
  if (typeof clearMessage === 'function') clearMessage();

  renderDashboardSkeleton();

  const cached = getDashboardSessionCache();
  if (cached) {
    renderDashboardData(cached.summary || {});
    return;
  }

  const loaded = await fetchDashboardData();
  renderDashboardData(loaded.summary || {});
  setDashboardSessionCache(loaded);
}

// ─────────────────────────────────────────────
// 모바일 카드 높이 고정
// 100dvh 기준으로 상단 요소를 제외한 높이로 카드 고정
// window.innerHeight 대신 dvh를 사용해 iOS 주소창 영향 제거
// ─────────────────────────────────────────────
function setDashboardCardHeight() {
  if (window.innerWidth > 768) return;

  var topbar  = document.querySelector('.dashboard-topbar');
  var kpi     = document.querySelector('.dashboard-kpi-grid--portal');
  var dots    = document.querySelector('.dashboard-panel-dots');
  var section = document.querySelector('.dashboard-panels-section');
  var cards   = document.querySelectorAll('.dashboard-page .dashboard-panel--portal');

  if (!topbar || !kpi || !section || cards.length === 0) return;

  // 100dvh 측정 — iOS 주소창 변화에 흔들리지 않는 안정적인 viewport 높이
  var dvhEl = document.createElement('div');
  dvhEl.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:100dvh;pointer-events:none;visibility:hidden;';
  document.body.appendChild(dvhEl);
  var vh = dvhEl.offsetHeight;
  document.body.removeChild(dvhEl);

  // safe-area-inset-bottom: CSS env() 값을 읽기 위한 측정
  var safeEl = document.createElement('div');
  safeEl.style.cssText = 'position:fixed;bottom:0;height:env(safe-area-inset-bottom,0px);pointer-events:none;visibility:hidden;';
  document.body.appendChild(safeEl);
  var safeBot = safeEl.offsetHeight || 0;
  document.body.removeChild(safeEl);

  var shellPadTop = 16;
  var shellPadBot = Math.max(safeBot, 16);
  var topbarH     = topbar.offsetHeight + 12;  // margin-bottom 12
  var kpiH        = kpi.offsetHeight;
  var dotsH       = dots ? (dots.offsetHeight + 12) : 0;  // margin-bottom 12
  var sectionMT   = 12;

  var cardH = vh - shellPadTop - shellPadBot - topbarH - kpiH - dotsH - sectionMT;
  cardH = Math.max(cardH, 480);

  cards.forEach(function(card) {
    card.style.height    = cardH + 'px';
    card.style.minHeight = cardH + 'px';
  });
}

document.addEventListener('DOMContentLoaded', async function () {
  if (DASHBOARD_BOOTSTRAPPED) return;
  DASHBOARD_BOOTSTRAPPED = true;

  try {
    if (typeof showGlobalLoading === 'function') {
      showGlobalLoading('대시보드를 불러오는 중...');
    }

    const user = window.auth?.requireAuth?.();
    if (!user) return;

    const permissionPromise = getEquipmentPermissionContext();
    const dashboardPromise = fetchDashboardData();

    DASHBOARD_PERMISSION = await permissionPromise;
    if (!DASHBOARD_PERMISSION.canView) {
      throw new Error('장비 메뉴 접근 권한이 없습니다.');
    }

    applyDashboardPermissionUi();
    initDashboardQuickSearch();

    const cached = getDashboardSessionCache();
    if (cached) {
      renderDashboardData(cached.summary || {});
      initPanelCarousel();
      setDashboardCardHeight();
      return;
    }

    const loaded = await dashboardPromise;
    renderDashboardData(loaded.summary || {});
    setDashboardSessionCache(loaded);

    initPanelCarousel();
    setDashboardCardHeight();
  } catch (error) {
    if (typeof showMessage === 'function') {
      showMessage(error.message || '대시보드를 불러오는 중 오류가 발생했습니다.', 'error');
    } else {
      console.error(error);
    }
  } finally {
    if (typeof hideGlobalLoading === 'function') {
      hideGlobalLoading();
    }
  }
});

window.addEventListener('resize', function() {
  if (window.innerWidth > 768) {
    // PC 폭으로 돌아오면 인라인 스타일 제거
    document.querySelectorAll('.dashboard-page .dashboard-panel--portal').forEach(function(card) {
      card.style.height    = '';
      card.style.minHeight = '';
    });
  } else {
    setDashboardCardHeight();
  }
});

// ─────────────────────────────────────────────
// 장비대장 전체 엑셀 다운로드
// ─────────────────────────────────────────────
async function exportAllEquipmentsExcel() {
  const btn = document.getElementById('dashboardExportBtn');

  if (!window.XLSX) {
    if (typeof showMessage === 'function') showMessage('엑셀 라이브러리를 불러오지 못했습니다.', 'error');
    return;
  }

  try {
    if (btn) { btn.disabled = true; btn.querySelector('.dashboard-action-desc').textContent = '다운로드 중...'; }
    if (typeof showGlobalLoading === 'function') showGlobalLoading('장비 데이터를 불러오는 중...');

    const userEmail = getCurrentUserEmail();
    const result = await apiGet('exportEquipments', { request_user_email: userEmail });
    const data = Array.isArray(result.data) ? result.data : [];

    if (!data.length) {
      if (typeof showMessage === 'function') showMessage('다운로드할 데이터가 없습니다.', 'error');
      return;
    }

    const statusMap = { IN_USE: '사용중', REPAIRING: '수리중', INSPECTING: '점검중', STORED: '보관', DISPOSED: '폐기' };
    const toStatus   = v => statusMap[String(v || '').trim()] || (v || '');
    const toDateOnly = v => v ? String(v).substring(0, 10) : '';

    const headers = [
      '장비번호', '장비명', '모델명', '제조사', '시리얼번호',
      '사용부서', '의원', '팀', '현재위치', '현재상태',
      '담당자', '연락처', '구매처', '취득가액',
      '취득일자', '제조일자', '유지보수종료일', '현재사용자', '비고', '등록일시'
    ];

    // 컬럼 유형 (0-based index)
    const COL_NUM  = new Set([13]);         // 취득가액
    const COL_DATE = new Set([14, 15, 16]); // 취득일자, 제조일자, 유지보수종료일

    const rows = data.map(item => [
      item.equipment_id || '', item.equipment_name || '', item.model_name || '',
      item.manufacturer || '', item.serial_no || '', item.department || '',
      item.clinic_name || '', item.team_name || '', item.location || '',
      toStatus(item.status), item.manager_name || '', item.manager_phone || '',
      item.vendor || '',
      (item.acquisition_cost !== '' && item.acquisition_cost != null) ? Number(item.acquisition_cost) : '',
      toDateOnly(item.purchase_date), toDateOnly(item.manufacture_date), toDateOnly(item.maintenance_end_date),
      item.current_user || '', item.memo || '', item.created_at || ''
    ]);

    // ── 스타일 정의 ──────────────────────────────────────────────
    const FONT_BASE   = { name: '맑은 고딕', sz: 10 };
    const FONT_HEADER = { name: '맑은 고딕', sz: 10, bold: true, color: { rgb: '1F3864' } };
    const FILL_HEADER = { patternType: 'solid', fgColor: { rgb: 'B8CCE4' } };
    const BORDER = {
      top:    { style: 'thin', color: { rgb: 'BFBFBF' } },
      bottom: { style: 'thin', color: { rgb: 'BFBFBF' } },
      left:   { style: 'thin', color: { rgb: 'BFBFBF' } },
      right:  { style: 'thin', color: { rgb: 'BFBFBF' } }
    };
    const ALIGN_LEFT   = { horizontal: 'left',   vertical: 'center' };
    const ALIGN_CENTER = { horizontal: 'center', vertical: 'center' };
    const ALIGN_RIGHT  = { horizontal: 'right',  vertical: 'center' };
    const FMT_NUM  = '#,##0';
    const FMT_DATE = 'yyyy-mm-dd';

    // ── 워크시트 수동 생성 ───────────────────────────────────────
    const ws = {};
    const totalCols = headers.length;
    const totalRows = rows.length + 1;

    // 헤더 행
    headers.forEach(function(h, c) {
      const addr = window.XLSX.utils.encode_cell({ r: 0, c });
      ws[addr] = {
        v: h, t: 's',
        s: { font: FONT_HEADER, fill: FILL_HEADER, border: BORDER, alignment: ALIGN_CENTER }
      };
    });

    // 데이터 행
    rows.forEach(function(row, r) {
      row.forEach(function(val, c) {
        const addr  = window.XLSX.utils.encode_cell({ r: r + 1, c });
        const isNum  = COL_NUM.has(c);
        const isDate = COL_DATE.has(c);

        const cell = {
          v: val,
          t: isNum && val !== '' ? 'n' : 's',
          s: {
            font:      FONT_BASE,
            border:    BORDER,
            alignment: isNum ? ALIGN_RIGHT : isDate ? ALIGN_CENTER : ALIGN_LEFT
          }
        };

        if (isNum && val !== '') { cell.z = FMT_NUM;  cell.s.numFmt = FMT_NUM;  }
        if (isDate && val)       { cell.z = FMT_DATE; cell.s.numFmt = FMT_DATE; }

        ws[addr] = cell;
      });
    });

    ws['!ref']  = window.XLSX.utils.encode_range({ r: 0, c: 0 }, { r: totalRows - 1, c: totalCols - 1 });
    ws['!cols'] = [
      {wch:14},{wch:20},{wch:16},{wch:14},{wch:16},
      {wch:20},{wch:12},{wch:12},{wch:12},{wch:8},
      {wch:10},{wch:14},{wch:14},{wch:12},
      {wch:12},{wch:12},{wch:14},{wch:10},{wch:20},{wch:18}
    ];
    ws['!rows'] = Array(totalRows).fill({ hpt: 18 });

    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, '장비대장');

    const now = new Date();
    const dateStr = now.getFullYear() + String(now.getMonth()+1).padStart(2,'0') + String(now.getDate()).padStart(2,'0');
    window.XLSX.writeFile(wb, '장비대장_' + dateStr + '.xlsx');

  } catch (error) {
    if (typeof showMessage === 'function') showMessage(error.message || '엑셀 다운로드 중 오류가 발생했습니다.', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.querySelector('.dashboard-action-desc').textContent = '전체 장비 다운로드'; }
    if (typeof hideGlobalLoading === 'function') hideGlobalLoading(true);
  }
}
