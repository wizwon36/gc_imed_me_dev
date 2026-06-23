var equipmentListState = {
  user: null,
  page: 1,
  pageSize: 20,
  totalCount: 0,
  totalPages: 1,
  hasNext: false,
  hasPrev: false,
  loading: false,
  canEdit: false,
  isRecentMode: false,
  isAdmin: false,
  isAppAdmin: false,
  userClinicCode: '',
  userTeamCode: '',
  _initialLoad: true   // ★ 최초 로딩 여부 — URL params 직접 사용
};

function el(selector) {
  return document.querySelector(selector);
}

function getListQueryParams() {
  var params = new URLSearchParams(location.search);

  return {
    keyword: params.get('keyword') || '',
    clinic_code: params.get('clinic_code') || '',
    team_code: params.get('team_code') || '',
    status: params.get('status') || '',
    manufacturer: params.get('manufacturer') || '',
    page: Number(params.get('page') || 1) || 1,
    page_size: Number(params.get('page_size') || 20) || 20
  };
}

function setListQueryParams(next) {
  var url = new URL(location.href);
  var key;

  for (key in next) {
    if (!Object.prototype.hasOwnProperty.call(next, key)) continue;

    if (next[key] === '' || next[key] === null || next[key] === undefined) {
      url.searchParams.delete(key);
    } else {
      url.searchParams.set(key, String(next[key]));
    }
  }

  history.replaceState({}, '', url.toString());
}

function setValue(id, value) {
  var target = document.getElementById(id);
  if (!target) return;
  target.value = value == null ? '' : value;
}

function getValue(id) {
  var target = document.getElementById(id);
  return target ? String(target.value || '').trim() : '';
}

function formatNumberLocal(value) {
  var num = Number(value || 0);
  return Number.isFinite(num) ? num.toLocaleString('ko-KR') : '0';
}

function formatDisplayDate(value) {
  var raw = String(value || '').trim();
  var dateOnlyMatch;
  var parsed;
  var yyyy;
  var mm;
  var dd;

  if (!raw) return '-';

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }

  dateOnlyMatch = raw.match(/^(\d{4}-\d{2}-\d{2})[T\s]/);
  if (dateOnlyMatch) {
    return dateOnlyMatch[1];
  }

  parsed = new Date(raw);
  if (!isNaN(parsed.getTime())) {
    yyyy = parsed.getFullYear();
    mm = String(parsed.getMonth() + 1).padStart(2, '0');
    dd = String(parsed.getDate()).padStart(2, '0');
    return yyyy + '-' + mm + '-' + dd;
  }

  return raw;
}

function getCurrentFilters() {
  return {
    keyword: getValue('keyword'),
    clinic_code: getValue('clinic_code'),
    team_code: getValue('team_code'),
    status: getValue('status'),
    manufacturer: getValue('manufacturer')
  };
}

function hasMeaningfulFilter(filters) {
  return Boolean(
    filters.keyword ||
    filters.clinic_code ||
    filters.team_code ||
    filters.status ||
    filters.manufacturer
  );
}

function fillStatusFilterOptions() {
  var target = document.getElementById('status');
  if (!target) return;

  target.innerHTML =
    '<option value="">전체 상태</option>' +
    '<option value="IN_USE">사용중</option>' +
    '<option value="REPAIRING">수리중</option>' +
    '<option value="INSPECTING">점검중</option>' +
    '<option value="STORED">보관</option>' +
    '<option value="DISPOSED">폐기</option>';
}

function fillPageSizeOptions() {
  var target = document.getElementById('page_size');
  if (!target || target.type === 'hidden') return; // hidden이면 무시
  if (!target) return;

  target.innerHTML =
    '<option value="10">10개</option>' +
    '<option value="20">20개</option>' +
    '<option value="50">50개</option>' +
    '<option value="100">100개</option>';

  target.value = String(equipmentListState.pageSize);
}

function renderListSummary() {
  var summaryEl = document.getElementById('listSummary');
  var total;
  var page;
  var totalPages;
  var size;

  if (!summaryEl) return;

  if (equipmentListState.isRecentMode) {
    page = formatNumberLocal(equipmentListState.page || 1);
    size = formatNumberLocal(equipmentListState.pageSize || 20);
    summaryEl.textContent = '최근 등록 장비 보기 · ' + size + '건 단위 · ' + page + '페이지';
    return;
  }

  total = formatNumberLocal(equipmentListState.totalCount || 0);
  page = formatNumberLocal(equipmentListState.page || 1);
  totalPages = formatNumberLocal(equipmentListState.totalPages || 1);

  summaryEl.textContent = '검색 결과 ' + total + '건 · ' + page + ' / ' + totalPages + ' 페이지';
}

/* ── 카드 (모바일용) ── */
function buildEquipmentCard(item) {
  var leftActions = '';
  var rightActions = '';

  leftActions += '<a class="btn" href="detail.html?id=' + encodeURIComponent(item.equipment_id || '') + '">상세</a>';

  if (equipmentListState.canEdit && canEditItem(item)) {
    leftActions += '<a class="btn btn-primary" href="form.html?id=' + encodeURIComponent(item.equipment_id || '') + '">수정</a>';
  }

  rightActions = window.innerWidth > 768
    ? '<a class="btn" href="label-print.html?equipment_id=' + encodeURIComponent(item.equipment_id || '') + '">라벨출력</a>'
    : '';

  return (
    '<article class="equipment-card">' +
      '<div class="equipment-card-head">' +
        '<div class="equipment-card-title-wrap">' +
          '<h3 class="equipment-card-title">' + escapeHtml(item.equipment_name || '-') + '</h3>' +
          '<div class="equipment-card-sub">' + escapeHtml(item.equipment_id || '') + '</div>' +
        '</div>' +
        '<span class="status-badge ' + statusClass(item.status || '') + '">' +
          escapeHtml(statusLabel(item.status || '')) +
        '</span>' +
      '</div>' +
      '<div class="equipment-card-grid">' +
        '<div class="equipment-card-row">' +
          '<span class="equipment-card-label">모델명</span>' +
          '<span class="equipment-card-value">' + escapeHtml(item.model_name || '-') + '</span>' +
        '</div>' +
        '<div class="equipment-card-row">' +
          '<span class="equipment-card-label">부서</span>' +
          '<span class="equipment-card-value">' + escapeHtml(item.department || '-') + '</span>' +
        '</div>' +
        '<div class="equipment-card-row">' +
          '<span class="equipment-card-label">제조사</span>' +
          '<span class="equipment-card-value">' + escapeHtml(item.manufacturer || '-') + '</span>' +
        '</div>' +
        '<div class="equipment-card-row">' +
          '<span class="equipment-card-label">시리얼</span>' +
          '<span class="equipment-card-value">' + escapeHtml(item.serial_no || '-') + '</span>' +
        '</div>' +
        '<div class="equipment-card-row">' +
          '<span class="equipment-card-label">위치</span>' +
          '<span class="equipment-card-value">' + escapeHtml(item.location || '-') + '</span>' +
        '</div>' +
        '<div class="equipment-card-row">' +
          '<span class="equipment-card-label">유지보수 종료</span>' +
          '<span class="equipment-card-value">' + escapeHtml(formatDisplayDate(item.maintenance_end_date || '')) + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="equipment-card-actions">' +
        leftActions +
        rightActions +
      '</div>' +
    '</article>'
  );
}

/* ── 테이블 행 (PC용) ── */
function buildEquipmentRow(item) {
  var actions = '';

  actions += '<a class="tbl-btn" href="detail.html?id=' + encodeURIComponent(item.equipment_id || '') + '">상세</a>';

  if (equipmentListState.canEdit && canEditItem(item)) {
    actions += '<a class="tbl-btn tbl-btn--primary" href="form.html?id=' + encodeURIComponent(item.equipment_id || '') + '">수정</a>';
  }

  if (window.innerWidth > 768) {
    actions += '<a class="tbl-btn" href="label-print.html?equipment_id=' + encodeURIComponent(item.equipment_id || '') + '">라벨</a>';
  }

  return (
    '<tr class="equipment-tbl-row">' +
      '<td class="equipment-tbl-cell equipment-tbl-cell--name">' + escapeHtml(item.equipment_name || '-') + '</td>' +
      '<td class="equipment-tbl-cell equipment-tbl-cell--id">' + escapeHtml(item.equipment_id || '-') + '</td>' +
      '<td class="equipment-tbl-cell">' + escapeHtml(item.model_name || '-') + '</td>' +
      '<td class="equipment-tbl-cell">' + escapeHtml(item.department || '-') + '</td>' +
      '<td class="equipment-tbl-cell">' + escapeHtml(item.manufacturer || '-') + '</td>' +
      '<td class="equipment-tbl-cell equipment-tbl-cell--serial">' + escapeHtml(item.serial_no || '-') + '</td>' +
      '<td class="equipment-tbl-cell">' + escapeHtml(item.location || '-') + '</td>' +
      '<td class="equipment-tbl-cell equipment-tbl-cell--status">' +
        '<span class="status-badge ' + statusClass(item.status || '') + '">' +
          escapeHtml(statusLabel(item.status || '')) +
        '</span>' +
      '</td>' +
      '<td class="equipment-tbl-cell equipment-tbl-cell--actions">' +
        '<div class="equipment-tbl-actions">' + actions + '</div>' +
      '</td>' +
    '</tr>'
  );
}

function renderEquipmentList(items) {
  var container = document.getElementById('equipmentList');
  if (!container) return;

  items = Array.isArray(items) ? items : [];

  if (!items.length) {
    var emptyMsg = equipmentListState.isRecentMode
      ? '최근 등록 장비가 없습니다.'
      : '조회된 장비가 없습니다.';
    container.innerHTML = '<div class="empty-box">' + emptyMsg + '</div>';
    return;
  }

  /* 카드 영역 (모바일에서 표시) */
  var cardsHtml =
    '<div class="equipment-cards-wrap">' +
      items.map(buildEquipmentCard).join('') +
    '</div>';

  /* 테이블 영역 (PC에서 표시) */
  var tableHtml =
    '<div class="equipment-table-wrap">' +
      '<table class="equipment-table">' +
        '<thead>' +
          '<tr>' +
            '<th class="equipment-tbl-th equipment-tbl-th--name">장비명</th>' +
            '<th class="equipment-tbl-th equipment-tbl-th--id">장비번호</th>' +
            '<th class="equipment-tbl-th equipment-tbl-th--model">모델명</th>' +
            '<th class="equipment-tbl-th equipment-tbl-th--dept">부서</th>' +
            '<th class="equipment-tbl-th equipment-tbl-th--mfr">제조사</th>' +
            '<th class="equipment-tbl-th equipment-tbl-th--serial">시리얼</th>' +
            '<th class="equipment-tbl-th equipment-tbl-th--loc">위치</th>' +
            '<th class="equipment-tbl-th equipment-tbl-th--status">상태</th>' +
            '<th class="equipment-tbl-th equipment-tbl-th--actions">액션</th>' +
          '</tr>' +
        '</thead>' +
        '<tbody>' +
          items.map(buildEquipmentRow).join('') +
        '</tbody>' +
      '</table>' +
    '</div>';

  container.innerHTML = cardsHtml + tableHtml;

}

function renderRecentPagination() {
  var container = document.getElementById('paginationArea');
  var page = equipmentListState.page;
  if (!container) return;

  container.innerHTML =
    '<button type="button" class="pagination-btn" data-page="' + Math.max(1, page - 1) + '" ' + (page <= 1 ? 'disabled' : '') + '>이전</button>' +
    '<button type="button" class="pagination-btn is-active" disabled>' + page + '</button>' +
    '<button type="button" class="pagination-btn" data-page="' + (page + 1) + '" ' + (equipmentListState.hasNext ? '' : 'disabled') + '>다음</button>';

  Array.prototype.forEach.call(container.querySelectorAll('.pagination-btn[data-page]'), function(btn) {
    btn.addEventListener('click', async function() {
      var nextPage = Number(btn.dataset.page || page);
      if (!nextPage || nextPage === equipmentListState.page) return;
      await loadEquipmentList(nextPage);
    });
  });
}

function renderFullPagination() {
  var container = document.getElementById('paginationArea');
  var page = equipmentListState.page;
  var totalPages = equipmentListState.totalPages;
  var i, html = '';

  if (!container) return;
  if (totalPages <= 1) { container.innerHTML = ''; return; }

  // 10개씩 묶어서 현재 페이지가 속한 블록 표시
  var BLOCK = 10;
  var blockStart = Math.floor((page - 1) / BLOCK) * BLOCK + 1;
  var blockEnd   = Math.min(blockStart + BLOCK - 1, totalPages);

  html += '<button type="button" class="pagination-btn" data-page="' + Math.max(1, blockStart - 1) + '" ' + (blockStart <= 1 ? 'disabled' : '') + '>이전</button>';

  for (i = blockStart; i <= blockEnd; i++) {
    html += '<button type="button" class="pagination-btn ' + (i === page ? 'is-active' : '') + '" data-page="' + i + '">' + i + '</button>';
  }

  html += '<button type="button" class="pagination-btn" data-page="' + Math.min(totalPages, blockEnd + 1) + '" ' + (blockEnd >= totalPages ? 'disabled' : '') + '>다음</button>';

  container.innerHTML = html;

  Array.prototype.forEach.call(container.querySelectorAll('.pagination-btn'), function(btn) {
    btn.addEventListener('click', async function() {
      var nextPage = Number(btn.dataset.page || page);
      if (!nextPage || nextPage === equipmentListState.page) return;
      await loadEquipmentList(nextPage);
    });
  });
}

function renderPagination() {
  if (equipmentListState.isRecentMode) {
    renderRecentPagination();
    return;
  }
  renderFullPagination();
}

// ★ 개별 장비에 대해 수정 가능 여부 판단
// admin이면 모든 장비 수정 가능, user이면 본인 소속 팀 장비만 수정 가능
function canEditItem(item) {
  if (equipmentListState.isAdmin) return true;
  var itemTeamCode = String(item.team_code || '').trim();
  var userTeamCode = equipmentListState.userTeamCode;
  return !!userTeamCode && itemTeamCode === userTeamCode;
}

function applyListPermissionUi() {
  var createBtn = document.getElementById('createEquipmentBtn');
  if (createBtn) {
    createBtn.style.display = equipmentListState.canEdit ? '' : 'none';
  }

  // ★ user 권한이면 엑셀 다운로드 버튼 숨김
  var exportBtn = document.getElementById('exportExcelBtn');
  if (exportBtn) {
    if (equipmentListState.canEdit || equipmentListState.isAdmin) {
      exportBtn.style.display = 'inline-flex';
    } else {
      exportBtn.style.display = 'none';
    }
  }

  if (typeof applyTopActionsColClass === 'function') applyTopActionsColClass();
}

function buildListRequestParams(filters, nextPage) {
  var hasFilter = hasMeaningfulFilter(filters);

  equipmentListState.isRecentMode = !hasFilter;

  var base = {
    request_user_email: equipmentListState.user && equipmentListState.user.email ? equipmentListState.user.email : '',
    keyword:      filters.keyword,
    clinic_code:  filters.clinic_code,
    team_code:    filters.team_code,
    status:       filters.status,
    manufacturer: filters.manufacturer,
    page:         nextPage,
    page_size:    equipmentListState.pageSize
  };

  if (!hasFilter) {
    base.recent_only = 'Y';
    base.include_total = 'N';
    return base;
  }

  base.include_total = 'Y';
  return base;
}

function syncListQueryParams(filters) {
  setListQueryParams({
    keyword: filters.keyword,
    clinic_code: filters.clinic_code,
    team_code: filters.team_code,
    status: filters.status,
    manufacturer: filters.manufacturer,
    page: equipmentListState.page,
    page_size: equipmentListState.pageSize
  });
}

var EQUIPMENT_LIST_CACHE_KEY = 'gc_imed_equipment_list_state';

function saveListState() {
  try {
    var state = {
      filters: getCurrentFilters(),
      page:    equipmentListState.page,
      ts:      Date.now()
    };
    sessionStorage.setItem(EQUIPMENT_LIST_CACHE_KEY, JSON.stringify(state));
  } catch(e) {}
}

function loadListState() {
  try {
    var raw = sessionStorage.getItem(EQUIPMENT_LIST_CACHE_KEY);
    if (!raw) return null;
    var state = JSON.parse(raw);
    // 30분 이상 지난 캐시는 무시
    if (Date.now() - state.ts > 30 * 60 * 1000) {
      sessionStorage.removeItem(EQUIPMENT_LIST_CACHE_KEY);
      return null;
    }
    return state;
  } catch(e) { return null; }
}

function clearListState() {
  try { sessionStorage.removeItem(EQUIPMENT_LIST_CACHE_KEY); } catch(e) {}
}

async function loadEquipmentList(nextPage) {
  var filters;
  var requestParams;
  var result;

  if (equipmentListState.loading) return;

  equipmentListState.loading = true;

  try {
    if (typeof clearMessage === 'function') clearMessage();
    if (typeof showGlobalLoading === 'function') {
      showGlobalLoading('장비 목록을 불러오는 중...');
    }

    if (equipmentListState._initialLoad) {
      var urlParams = getListQueryParams();
      // URL에 필터가 없으면 소속 의원/팀으로 기본 필터 적용
      if (!urlParams.keyword && !urlParams.clinic_code && !urlParams.team_code && !urlParams.status && !urlParams.manufacturer) {
        urlParams.clinic_code = equipmentListState.userClinicCode || '';
        // admin은 팀 필터 없이 의원 전체 조회, 일반 user만 팀 필터 적용
        if (!equipmentListState.isAdmin) {
          urlParams.team_code = equipmentListState.userTeamCode || '';
        }
      }
      filters = urlParams;
    } else {
      filters = getCurrentFilters();
    }

    equipmentListState._initialLoad = false;
    requestParams = buildListRequestParams(filters, nextPage || equipmentListState.page);

    equipmentListState.page = nextPage || equipmentListState.page;

    result = await apiGet('listEquipments', requestParams);

    // GAS result.page는 항상 1을 반환할 수 있으므로 신뢰하지 않고
    // 요청한 nextPage 값을 그대로 유지
    // equipmentListState.page = Number(result.page || 1);
    equipmentListState.hasNext = Boolean(result.has_next);
    equipmentListState.hasPrev = Boolean(result.has_prev);

    if (equipmentListState.isRecentMode) {
      equipmentListState.totalCount = 0;
      equipmentListState.totalPages = equipmentListState.hasNext
        ? equipmentListState.page + 1
        : equipmentListState.page;
    } else {
      equipmentListState.totalCount = Number(result.total_count || result.count || result.totalCount || 0);
      // GAS API가 total_pages / totalPages / pageCount 등 다양한 키로 내려올 수 있음
      var rawTotal = result.total_pages || result.totalPages || result.page_count || result.pageCount || 0;
      if (!rawTotal && equipmentListState.totalCount > 0) {
        rawTotal = Math.ceil(equipmentListState.totalCount / equipmentListState.pageSize);
      }
      equipmentListState.totalPages = Math.max(1, Number(rawTotal));
    }

    renderEquipmentList(Array.isArray(result.data) ? result.data : []);
    renderListSummary();
    renderPagination();
    syncListQueryParams(filters);
  } catch (error) {
    if (typeof showMessage === 'function') {
      showMessage(error.message || '장비 목록을 불러오는 중 오류가 발생했습니다.', 'error');
    } else {
      console.error(error);
    }
  } finally {
    // 성공/실패 무관하게 반드시 컨텐츠 표시
    document.body.classList.add('is-ready');
    equipmentListState.loading = false;
    if (typeof hideGlobalLoading === 'function') {
      hideGlobalLoading();
    }
  }
}

async function initListFilters() {
  var query = getListQueryParams();
  var clinicEl;
  var teamEl;

  equipmentListState.page = query.page > 0 ? query.page : 1;
  equipmentListState.pageSize = 20; // 고정

  fillStatusFilterOptions();

  clinicEl = document.getElementById('clinic_code');
  teamEl = document.getElementById('team_code');

  if (window.orgSelect && clinicEl && teamEl) {
    // scope='all' 분기에서 getFilteredTeams/bindClinicTeamSelects가 내부
    // orgDataCache(이 호출이 채움)에 의존하므로 그대로 유지한다.
    // loadOrgData + getScopedOrgOptions 병렬 호출
    var orgInitResults = await Promise.all([
      window.orgSelect.loadOrgData(),
      apiGet('getScopedOrgOptions', {
        request_user_email: equipmentListState.user?.email || equipmentListState.user?.user_email,
        app_id: 'equipment'
      })
    ]);
    var scopedResult = orgInitResults[1];
    var scopedData = scopedResult?.data || { clinics: [], teams: [], scope: null };
    var scope = scopedData.scope; // 'all' | 'clinic' | 'team' | null(admin은 'all'로 내려옴)

    if (scope === 'team') {
      // 소속 의원 + 소속 부서만: 의원/팀 둘 다 고정(disabled), 선택지도 1개뿐
      window.orgSelect.fillSelectOptions(clinicEl, scopedData.clinics, { emptyText: '' });
      clinicEl.value = equipmentListState.userClinicCode;
      clinicEl.disabled = true;

      window.orgSelect.fillSelectOptions(teamEl, scopedData.teams, { emptyText: '' });
      // 진입 시 소속 팀 자동 세팅 (URL params 없으면 소속 팀)
      teamEl.value = query.team_code || equipmentListState.userTeamCode;
      teamEl.disabled = true;

    } else if (scope === 'clinic') {
      // 소속 의원 + 전체 부서: 의원은 고정, 팀은 소속 의원 산하 전체 중 자유 선택
      window.orgSelect.fillSelectOptions(clinicEl, scopedData.clinics, { emptyText: '' });
      clinicEl.value = equipmentListState.userClinicCode;
      clinicEl.disabled = true;

      window.orgSelect.fillSelectOptions(teamEl, scopedData.teams, { emptyText: '전체 팀' });
      // 진입 시 소속 팀 자동 세팅
      teamEl.value = query.team_code || equipmentListState.userTeamCode || '';
      teamEl.disabled = false;

    } else {
      // scope === 'all'(admin 포함): 전체 의원 자유 선택
      window.orgSelect.fillSelectOptions(clinicEl, scopedData.clinics, {
        emptyText: '전체 의원'
      });
      window.orgSelect.bindClinicTeamSelects({
        clinicSelect: clinicEl,
        teamSelect: teamEl,
        teamEmptyText: '전체 팀',
        onTeamChanged: null
      });
      var initClinic = query.clinic_code || equipmentListState.userClinicCode || '';
      if (initClinic) {
        clinicEl.value = initClinic;
        window.orgSelect.fillSelectOptions(
          teamEl,
          window.orgSelect.getFilteredTeams(initClinic),
          { emptyText: '전체 팀' }
        );
        teamEl.disabled = false;
        // 진입 시 소속 팀 자동 세팅
        teamEl.value = query.team_code || equipmentListState.userTeamCode || '';
      } else {
        teamEl.innerHTML = '<option value="">의원을 먼저 선택하세요</option>';
        teamEl.disabled = true;
      }
    }
  }

  setValue('keyword', query.keyword || '');
  setValue('status', query.status || '');
  setValue('manufacturer', query.manufacturer || '');
  setValue('page_size', String(equipmentListState.pageSize));
}

function bindListEvents() {
  var searchForm = document.getElementById('searchForm');
  var resetBtn = document.getElementById('resetFilterBtn');
  var pageSizeEl = document.getElementById('page_size');

  if (searchForm) {
    searchForm.addEventListener('submit', async function(event) {
      event.preventDefault();
      await loadEquipmentList(1);
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', async function() {
      setValue('keyword', '');
      // ★ admin이 아니면 의원 선택 초기화 안 함 (고정)
      if (equipmentListState.isAdmin) {
        setValue('clinic_code', '');
        setValue('team_code', '');
        if (window.orgSelect) {
          window.orgSelect.fillSelectOptions(
            document.getElementById('team_code'),
            [],
            { emptyText: '의원을 먼저 선택하세요' }
          );
          document.getElementById('team_code').disabled = true;
        }
      } else {
        // ★ user: 초기화 시 팀을 본인 소속 팀으로 복원 (의원은 disabled 유지, 팀은 변경 가능)
        setValue('team_code', equipmentListState.userTeamCode || '');
        if (window.orgSelect) {
          var teamElReset = document.getElementById('team_code');
          window.orgSelect.fillSelectOptions(
            teamElReset,
            window.orgSelect.getFilteredTeams(equipmentListState.userClinicCode),
            { emptyText: '전체 팀' }
          );
          teamElReset.value = equipmentListState.userTeamCode || '';
          teamElReset.disabled = false;
        }
      }
      setValue('status', '');
      setValue('manufacturer', '');

      // pageSize 고정 — UI 없음

      await loadEquipmentList(1);
    });
  }

  if (pageSizeEl) {
    pageSizeEl.addEventListener('change', async function() {
      equipmentListState.pageSize = Number(pageSizeEl.value || 20) || 20;
      await loadEquipmentList(1);
    });
  }
}

function statusLabelForExport(value) {
  var map = {
    IN_USE: '사용중',
    REPAIRING: '수리중',
    INSPECTING: '점검중',
    STORED: '보관',
    DISPOSED: '폐기'
  };
  return map[String(value || '').trim()] || (value || '');
}

async function exportEquipmentExcel() {
  var exportBtn = document.getElementById('exportExcelBtn');

  if (!window.XLSX) {
    showMessage('엑셀 라이브러리를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.', 'error');
    return;
  }

  var filters = getCurrentFilters();
  var userEmail = equipmentListState.user && equipmentListState.user.email
    ? equipmentListState.user.email : '';

  try {
    if (exportBtn) {
      exportBtn.disabled = true;
      exportBtn.textContent = '다운로드 중...';
    }
    showGlobalLoading('장비 데이터를 불러오는 중...');

    var result = await apiGet('exportEquipments', {
      request_user_email: userEmail,
      keyword: filters.keyword,
      clinic_code: filters.clinic_code,
      team_code: filters.team_code,
      status: filters.status,
      manufacturer: filters.manufacturer
    });

    var data = Array.isArray(result.data) ? result.data : [];

    if (!data.length) {
      showMessage('다운로드할 데이터가 없습니다.', 'error');
      return;
    }

    var headers = [
      '장비번호', '장비명', '모델명', '제조사', '시리얼번호',
      '사용부서', '의원', '팀', '현재위치', '현재상태',
      '담당자', '연락처', '구매처', '취득가액',
      '취득일자', '제조일자', '유지보수종료일', '현재사용자', '비고', '등록일시'
    ];

    // 컬럼 유형 (0-based index)
    var COL_NUM  = new Set([13]);         // 취득가액
    var COL_DATE = new Set([14, 15, 16]); // 취득일자, 제조일자, 유지보수종료일

    var toDateOnly = function(v) { return v ? String(v).substring(0, 10) : ''; };

    var rows = data.map(function(item) {
      return [
        item.equipment_id || '',
        item.equipment_name || '',
        item.model_name || '',
        item.manufacturer || '',
        item.serial_no || '',
        item.department || '',
        item.clinic_name || '',
        item.team_name || '',
        item.location || '',
        statusLabelForExport(item.status),
        item.manager_name || '',
        item.manager_phone || '',
        item.vendor || '',
        item.acquisition_cost !== '' && item.acquisition_cost !== null && item.acquisition_cost !== undefined
          ? Number(item.acquisition_cost) : '',
        toDateOnly(item.purchase_date),
        toDateOnly(item.manufacture_date),
        toDateOnly(item.maintenance_end_date),
        item.current_user || '',
        item.memo || '',
        item.created_at || ''
      ];
    });

    // ── 스타일 정의 ──────────────────────────────────────────────
    var FONT_BASE   = { name: '맑은 고딕', sz: 10 };
    var FONT_HEADER = { name: '맑은 고딕', sz: 10, bold: true, color: { rgb: '1F3864' } };
    var FILL_HEADER = { patternType: 'solid', fgColor: { rgb: 'B8CCE4' } };
    var BORDER = {
      top:    { style: 'thin', color: { rgb: 'BFBFBF' } },
      bottom: { style: 'thin', color: { rgb: 'BFBFBF' } },
      left:   { style: 'thin', color: { rgb: 'BFBFBF' } },
      right:  { style: 'thin', color: { rgb: 'BFBFBF' } }
    };
    var ALIGN_LEFT   = { horizontal: 'left',   vertical: 'center' };
    var ALIGN_CENTER = { horizontal: 'center', vertical: 'center' };
    var ALIGN_RIGHT  = { horizontal: 'right',  vertical: 'center' };
    var FMT_NUM  = '#,##0';
    var FMT_DATE = 'yyyy-mm-dd';

    // ── 워크시트 수동 생성 ───────────────────────────────────────
    var ws = {};
    var totalCols = headers.length;
    var totalRows = rows.length + 1;

    // 헤더 행
    headers.forEach(function(h, c) {
      var addr = window.XLSX.utils.encode_cell({ r: 0, c: c });
      ws[addr] = {
        v: h, t: 's',
        s: { font: FONT_HEADER, fill: FILL_HEADER, border: BORDER, alignment: ALIGN_CENTER }
      };
    });

    // 데이터 행
    rows.forEach(function(row, r) {
      row.forEach(function(val, c) {
        var addr   = window.XLSX.utils.encode_cell({ r: r + 1, c: c });
        var isNum  = COL_NUM.has(c);
        var isDate = COL_DATE.has(c);

        var cell = {
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
      { wch: 14 }, { wch: 20 }, { wch: 16 }, { wch: 14 }, { wch: 16 },
      { wch: 20 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 8 },
      { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 12 },
      { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 10 }, { wch: 20 }, { wch: 18 }
    ];
    ws['!rows'] = Array(totalRows).fill({ hpt: 18 });

    var wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, '장비대장');

    var now = new Date();
    var dateStr = now.getFullYear() +
      String(now.getMonth() + 1).padStart(2, '0') +
      String(now.getDate()).padStart(2, '0');
    var fileName = '장비대장_' + dateStr + '.xlsx';

    window.XLSX.writeFile(wb, fileName);

  } catch (error) {
    showMessage(error.message || '엑셀 다운로드 중 오류가 발생했습니다.', 'error');
  } finally {
    if (exportBtn) {
      exportBtn.disabled = false;
      exportBtn.textContent = '엑셀 다운로드';
    }
    hideGlobalLoading(true);
  }
}

document.addEventListener('DOMContentLoaded', async function() {
  try {
    if (typeof showGlobalLoading === 'function') {
      showGlobalLoading('장비 목록 화면을 준비하는 중...');
    }

    if (window.auth && typeof window.auth.requireAuth === 'function') {
      equipmentListState.user = window.auth.requireAuth();
    }

    if (!equipmentListState.user) {
      if (typeof hideGlobalLoading === 'function') hideGlobalLoading();
      return;
    }

    // ★ admin 여부 및 소속 의원/팀 코드 세팅
    var userRole = String(equipmentListState.user.role || '').trim().toLowerCase();
    equipmentListState.isAdmin = (userRole === 'admin');
    equipmentListState.userClinicCode = String(equipmentListState.user.clinic_code || '').trim();
    equipmentListState.userTeamCode   = String(equipmentListState.user.team_code   || '').trim();

    // 뒤로가기 복귀 감지 — performance.navigation 또는 sessionStorage
    var isBackNav = (
      (window.performance && window.performance.navigation &&
       window.performance.navigation.type === 2) ||
      (window.performance && window.performance.getEntriesByType &&
       window.performance.getEntriesByType('navigation')[0] &&
       window.performance.getEntriesByType('navigation')[0].type === 'back_forward')
    );
    equipmentListState._isBackNav = isBackNav;

    // 권한 3개 + org 데이터 병렬 호출 (기존 순차 → Promise.all)
    var permResults = await Promise.all([
      window.appPermission && typeof window.appPermission.requirePermission === 'function'
        ? window.appPermission.requirePermission('equipment', ['view', 'edit', 'admin'])
        : Promise.resolve(true),
      window.appPermission && typeof window.appPermission.hasPermission === 'function'
        ? window.appPermission.hasPermission('equipment', ['edit', 'admin'])
        : Promise.resolve(false),
      window.appPermission && typeof window.appPermission.getPermission === 'function'
        ? window.appPermission.getPermission('equipment')
        : Promise.resolve(null)
    ]);

    var canView  = permResults[0];
    var canEdit  = permResults[1];
    var appPerm  = permResults[2];

    if (!canView) {
      if (typeof hideGlobalLoading === 'function') hideGlobalLoading();
      return;
    }

    equipmentListState.canEdit     = canEdit;
    equipmentListState.isAppAdmin  = (String(appPerm || '').trim().toLowerCase() === 'admin');

    applyListPermissionUi();
    await initListFilters();
    bindListEvents();

    // 뒤로가기 복귀 시 캐시 필터 복원
    if (equipmentListState._isBackNav) {
      var cached = loadListState();
      if (cached && cached.filters) {
        // 필터 폼에 캐시 값 세팅
        var f = cached.filters;
        if (f.keyword)    setValue('keyword',    f.keyword);
        if (f.status)     setValue('status',     f.status);
        if (f.clinic_code) {
          var clinicEl = document.getElementById('clinic_code');
          if (clinicEl && !clinicEl.disabled) setValue('clinic_code', f.clinic_code);
        }
        if (f.team_code) {
          var teamEl = document.getElementById('team_code');
          if (teamEl && !teamEl.disabled) setValue('team_code', f.team_code);
        }
        equipmentListState.page = cached.page || 1;
      }
    }

    await loadEquipmentList(equipmentListState.page);

    var exportBtn = document.getElementById('exportExcelBtn');
    if (exportBtn) {
      exportBtn.addEventListener('click', exportEquipmentExcel);
    }
  } catch (error) {
    if (typeof showMessage === 'function') {
      showMessage(error.message || '화면 초기화 중 오류가 발생했습니다.', 'error');
    } else {
      console.error(error);
    }
  } finally {
    if (typeof hideGlobalLoading === 'function') {
      hideGlobalLoading();
    }
  }
});

// ================================================================
// 라벨 일괄 출력
// ================================================================

var bulkSelectedIds = new Set();

function initBulkLabelFeature() {
  var bulkBtn    = document.getElementById('bulkLabelBtn');
  var checkAllEl = document.getElementById('bulkCheckAll');

  if (!bulkBtn) return;

  // 라벨 일괄 출력 버튼 클릭 → 오버레이 인쇄
  bulkBtn.addEventListener('click', function() {
    if (!bulkSelectedIds.size) return;
    var ids        = Array.from(bulkSelectedIds);
    var sizeClass  = getSelectedLabelSizeForBulk();
    var layoutSelect = document.getElementById('bulkLayoutSelect');
    var layout     = layoutSelect ? layoutSelect.value : '';
    printLabelsOverlay(ids, sizeClass, layout);
  });

  // 검수확인서 일괄 출력 버튼
  var certBtn = document.getElementById('bulkInspectionCertBtn');
  if (certBtn) {
    certBtn.addEventListener('click', async function() {
      if (!bulkSelectedIds.size) return;
      var ids = Array.from(bulkSelectedIds);

      try {
        showGlobalLoading('장비 정보를 불러오는 중...');

        var user = equipmentListState.user;
        var userEmail = (user && user.email) ? user.email : '';

        var items = await Promise.all(
          ids.map(function(id) {
            return apiGet('getEquipment', {
              id: id,
              request_user_email: userEmail
            }).then(function(result) {
              return result.data || {};
            });
          })
        );

        if (typeof generateInspectionCertPDF === 'function') {
          // 구매처 동일 여부 체크
          var vendors = [...new Set(items.map(function(e) { return String(e.vendor || '').trim(); }).filter(Boolean))];

          if (vendors.length > 1) {
            alert('⚠️ 선택한 장비의 구매처가 다릅니다.\n\n' +
              vendors.join(', ') +
              '\n\n검수확인서는 구매처가 동일한 장비만 함께 출력할 수 있습니다.');
            return;
          }

          generateInspectionCertPDF(items);
        }
      } catch (error) {
        showMessage(error.message || '장비 정보를 불러오는 중 오류가 발생했습니다.', 'error');
      } finally {
        hideGlobalLoading();
      }
    });
  }

  // 사이즈 변경 시 격자 옵션 갱신
  var sizeSelectEl = document.getElementById('bulkLabelSizeSelect');
  if (sizeSelectEl) sizeSelectEl.addEventListener('change', updateLayoutOptions);

  // 전체 선택 체크박스 (헤더)
  document.addEventListener('change', function(e) {
    if (e.target.id !== 'bulkCheckAll') return;
    var checks = document.querySelectorAll('.bulk-item-check');
    checks.forEach(function(cb) {
      cb.checked = e.target.checked;
      var id = cb.dataset.id;
      if (e.target.checked) bulkSelectedIds.add(id);
      else bulkSelectedIds.delete(id);
    });
    updateBulkUI();
  });

  // 개별 체크박스 이벤트 위임
  var listEl = document.getElementById('equipmentList');
  if (listEl) {
    listEl.addEventListener('change', function(e) {
      if (!e.target.classList.contains('bulk-item-check')) return;
      var id = e.target.dataset.id;
      if (e.target.checked) bulkSelectedIds.add(id);
      else bulkSelectedIds.delete(id);

      // 헤더 전체선택 체크박스 상태 동기화
      var checkAll = document.getElementById('bulkCheckAll');
      if (checkAll) {
        var allChecks = document.querySelectorAll('.bulk-item-check');
        var checkedCount = document.querySelectorAll('.bulk-item-check:checked').length;
        checkAll.checked = allChecks.length > 0 && checkedCount === allChecks.length;
        checkAll.indeterminate = checkedCount > 0 && checkedCount < allChecks.length;
      }

      updateBulkUI();
    });
  }
}

function updateBulkUI() {
  var btn                 = document.getElementById('bulkLabelBtn');
  var countEl             = document.getElementById('bulkLabelCount');
  var sizeSelect          = document.getElementById('bulkLabelSizeSelect');
  var layoutSelect        = document.getElementById('bulkLayoutSelect');
  var certBtn             = document.getElementById('bulkInspectionCertBtn');
  var certCountEl         = document.getElementById('bulkInspectionCertCount');
  var count               = bulkSelectedIds.size;

  if (btn)          btn.style.display          = count > 0 ? '' : 'none';
  if (sizeSelect)   sizeSelect.style.display   = count > 0 ? '' : 'none';
  if (layoutSelect) layoutSelect.style.display = count > 0 ? '' : 'none';
  if (countEl)      countEl.textContent        = count;
  if (certBtn)      certBtn.style.display      = (count > 0 && (equipmentListState.isAdmin || equipmentListState.isAppAdmin)) ? '' : 'none';
  if (certCountEl)  certCountEl.textContent    = count;
}

function updateLayoutOptions() {
  var sizeSelect   = document.getElementById('bulkLabelSizeSelect');
  var layoutSelect = document.getElementById('bulkLayoutSelect');
  if (!layoutSelect || !sizeSelect) return;

  var size = sizeSelect.value;
  if (size === 'size-70x40') {
    layoutSelect.innerHTML =
      '<option value="2x6">격자 — 2×6 (12칸)</option>';
  } else {
    layoutSelect.innerHTML =
      '<option value="2x5">격자 — 2×5 (10칸)</option>';
  }
}

function getSelectedLabelSizeForBulk() {
  var sizeSelect = document.getElementById('bulkLabelSizeSelect');
  return sizeSelect ? sizeSelect.value : 'size-90x48';
}

// 목록 렌더링 후 체크 상태 초기화
var _origRenderEquipmentList = renderEquipmentList;
renderEquipmentList = function(items) {
  // 현재 페이지 데이터 저장 (일괄 출력용)
  equipmentListState.currentItems = Array.isArray(items) ? items : [];

  _origRenderEquipmentList(items);
  bulkSelectedIds.clear();
  updateBulkUI();
  var checkAll = document.getElementById('bulkCheckAll');
  if (checkAll) { checkAll.checked = false; checkAll.indeterminate = false; }
};

document.addEventListener('DOMContentLoaded', function() {
  // 기존 DOMContentLoaded 이후 초기화
  setTimeout(initBulkLabelFeature, 100);
});

// ================================================================
// 라벨 인쇄 오버레이 (페이지 이동 없이 직접 출력)
// ================================================================

var GRID_SPECS_LIST = {
  '2x5': { cols: 2, rows: 5, colGap: '3mm', rowGap: '2mm', padT: '10mm', padS: '8mm' },
  '2x6': { cols: 2, rows: 6, colGap: '3mm', rowGap: '1mm', padT: '7mm',  padS: '8mm' }
};

function buildLabelHtmlForList(item, sizeClass, qrId) {
  var showLocation = sizeClass !== 'size-70x40' && sizeClass !== 'size-50x30';
  var showModel    = sizeClass !== 'size-50x30';
  var showDept     = sizeClass !== 'size-50x30';
  var sc           = sizeClass.replace('size-', ''); // '90x48', '70x40', '50x30'

  return (
    '<div class="prlabel prlabel--' + sc + '">' +
      '<div class="prlabel-body">' +
        '<div class="prlabel-hospital">녹십자아이메드 의료장비 관리시스템</div>' +
        '<div class="prlabel-title">' + escapeHtml(item.equipment_name || '-') + '</div>' +
        '<div class="prlabel-rows">' +
          '<div class="prlabel-row">' +
            '<span class="prlabel-key">관리번호</span>' +
            '<span class="prlabel-id">' + escapeHtml(item.equipment_id || '-') + '</span>' +
          '</div>' +
          (showModel ? '<div class="prlabel-row"><span class="prlabel-key">모델명</span><span class="prlabel-val">' + escapeHtml(item.model_name || '-') + '</span></div>' : '') +
          (showDept  ? '<div class="prlabel-row"><span class="prlabel-key">사용부서</span><span class="prlabel-val">' + escapeHtml(item.department || '-') + '</span></div>' : '') +
          (showLocation ? '<div class="prlabel-row"><span class="prlabel-key">위치</span><span class="prlabel-val">' + escapeHtml(item.location || '-') + '</span></div>' : '') +
        '</div>' +
      '</div>' +
      '<div class="prlabel-qr" id="' + escapeHtml(qrId) + '"></div>' +
    '</div>'
  );
}


function printLabelsOverlay(ids, sizeClass, layout) {
  var allItems = equipmentListState.currentItems || [];
  var items = ids.map(function(id) {
    return allItems.find(function(i) { return i.equipment_id === id; }) ||
      { equipment_id: id, equipment_name: id, model_name: '', department: '', location: '', qr_value: id };
  });

  var prev = document.getElementById('printLabelOverlay');
  if (prev) prev.remove();

  var overlay = document.createElement('div');
  overlay.id = 'printLabelOverlay';

  var isGrid  = !!(layout && GRID_SPECS_LIST[layout]);
  var spec    = isGrid ? GRID_SPECS_LIST[layout] : null;
  var perPage = spec ? spec.cols * spec.rows : 1;
  var pagesHtml = '';

  if (isGrid) {
    for (var p = 0; p < items.length; p += perPage) {
      var pageItems = items.slice(p, p + perPage);
      while (pageItems.length < perPage) pageItems.push(null);

      var cells = pageItems.map(function(item, cellIdx) {
        if (!item) return '<div class="plabel-empty"></div>';
        var qrId = 'pqr-g-' + p + '-' + cellIdx;
        return buildLabelHtmlForList(item, sizeClass, qrId);
      }).join('');

      pagesHtml += (
        '<div class="plabel-page plabel-page--grid" style="' +
          'grid-template-columns:repeat(' + spec.cols + ',auto);' +
          'gap:' + spec.rowGap + ' ' + spec.colGap + ';' +
          'padding:' + spec.padT + ' ' + spec.padS + ';' +
        '">' + cells + '</div>'
      );
    }
  } else {
    pagesHtml = items.map(function(item, idx) {
      var qrId = 'pqr-s-' + idx;
      return '<div class="plabel-page plabel-page--single">' +
        buildLabelHtmlForList(item, sizeClass, qrId) +
      '</div>';
    }).join('');
  }

  overlay.innerHTML = pagesHtml;
  document.body.appendChild(overlay);

  var baseUrl = (typeof CONFIG !== 'undefined' ? CONFIG.SITE_BASE_URL : '') +
                '/pages/equipment/public-detail.html?id=';
  var qrSize = sizeClass === 'size-70x40' ? 64 : sizeClass === 'size-50x30' ? 48 : 84;

  items.forEach(function(item, idx) {
    if (!item) return;
    var qrId = isGrid
      ? ('pqr-g-' + (Math.floor(idx / perPage) * perPage) + '-' + (idx % perPage))
      : ('pqr-s-' + idx);
    var qrEl = document.getElementById(qrId);
    if (!qrEl) return;
    var qrValue = item.equipment_id || '';
    if (qrValue && typeof QRCode !== 'undefined') {
      new QRCode(qrEl, { text: baseUrl + encodeURIComponent(qrValue), width: qrSize, height: qrSize });
    }
  });

  setTimeout(function() {
    window.print();
    setTimeout(function() {
      var el = document.getElementById('printLabelOverlay');
      if (el) el.remove();
    }, 500);
  }, 400);
}
