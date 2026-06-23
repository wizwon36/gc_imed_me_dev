/**
 * stats-main.js
 * 구매·사용 통계 앱 진입점
 */

'use strict';

document.addEventListener('DOMContentLoaded', async () => {
  try {
    showGlobalLoading('통계 앱 초기화 중...');

    // 로그인 체크
    const user = window.auth?.getSession?.();
    if (!user) { location.replace(`${CONFIG.SITE_BASE_URL}/index.html`); return; }

    // 로그아웃
    document.getElementById('logoutBtn')?.addEventListener('click', () => {
      window.auth?.logout?.();
      location.replace(`${CONFIG.SITE_BASE_URL}/index.html`);
    });

    // 권한 체크 (statistics: view 이상) — 기존 closing과 동일 패턴
    const ok = await window.appPermission?.requirePermission?.('statistics', ['admin', 'edit', 'view']);
    if (ok === false) {
      document.getElementById('permissionDenied').style.display = '';
      return;
    }

    // 거래처 관리(저장)는 edit 이상만 가능 — StatsApp.canEdit으로 stats-vendor.js에서 참조
    const isAdmin = String(user?.role || '').trim().toLowerCase() === 'admin';
    const editPerm = await window.appPermission?.getPermission?.('statistics');
    window.StatsApp = window.StatsApp || {};
    StatsApp.canEdit = isAdmin || ['admin', 'edit'].includes(editPerm);

    // 데이터 업로드도 edit 이상만 가능 — view 권한자는 버튼/파일선택을 처음부터 막아 보여줌
    if (!StatsApp.canEdit) {
      const uploadBtn = document.getElementById('btnStatsUpload');
      if (uploadBtn) uploadBtn.disabled = true;
      ['zone-purchase', 'zone-usage'].forEach(zoneId => {
        const zone = document.getElementById(zoneId);
        const fileInput = zone?.querySelector('input[type=file]');
        if (fileInput) fileInput.disabled = true;
        if (zone) zone.classList.add('cl-upload-zone--disabled');
      });
      const uploadNotice = document.getElementById('statsUploadPermNotice');
      if (uploadNotice) uploadNotice.style.display = '';
    }

    document.getElementById('appBody').style.display = '';

    // 연도 선택 옵션 생성: 2016 ~ 올해
    const yearSelect = document.getElementById('statsYear');
    if (yearSelect) {
      const curYear = new Date().getFullYear();
      let opts = '';
      for (let y = curYear; y >= 2016; y--) {
        opts += `<option value="${y}">${y}년</option>`;
      }
      yearSelect.innerHTML = opts;
    }

    // 의원 드롭다운 기본값: 본인 소속 의원 (업로드/조회 탭 둘 다)
    // "전체"(value="") 옵션은 건너뜀 — 빈 문자열은 모든 문자열에 포함된 것으로 판정되어
    // 항상 가장 먼저 매칭되는 버그가 있었음
    ['statsBranch', 'statDashBranch'].forEach(id => {
      const sel = document.getElementById(id);
      if (sel && user.clinic_name) {
        const matched = Array.from(sel.options).find(o => o.value && user.clinic_name.includes(o.value));
        if (matched) sel.value = matched.value;
      }
    });

    // 통계 조회 기본 기간: 지난달
    const now = new Date();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthStr = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}`;
    const ymFromEl = document.getElementById('statDashYmFrom');
    const ymToEl   = document.getElementById('statDashYmTo');
    if (ymFromEl) ymFromEl.value = lastMonthStr;
    if (ymToEl)   ymToEl.value   = lastMonthStr;

    // 업로드 현황 최초 로드
    await loadUploadStatus();

    // 거래처 필터(자동완성)용으로 거래처 마스터 미리 로드
    await loadVendorsFromServer();
    populateVendorDatalist();

    // 상세검색 패널 기본 행 1개 준비
    addAdvancedConditionRow();
    updateSearchKeywordSuggestions();

    // 의원별 탭이 기본 활성 탭 — 상단 검색바 의원 선택 비활성화 등 부수효과를 최초 로드 시에도 적용
    setActiveSubtab_('branch');

    // 통계 조회 탭이 기본 활성 탭이므로, 지난달 기준으로 최초 조회 자동 실행
    await runStatsDashboard();

  } catch (error) {
    console.error(error);
    showMessage?.(error.message || '초기화 중 오류가 발생했습니다.', 'error');
  } finally {
    hideGlobalLoading();
  }
});

// ── 탭 전환 ────────────────────────────────────────────────
function switchStatsTab(tab) {
  const tabs = ['upload', 'dashboard', 'vendor'];
  tabs.forEach(t => {
    document.getElementById(`tab${capitalize(t)}`)?.classList.toggle('active', t === tab);
    document.getElementById(`tab${capitalize(t)}Content`)?.classList.toggle('active', t === tab);
  });
  if (tab === 'vendor') {
    ensureVendorTabLoaded();
  }
}
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// ── 업로드 현황 조회/렌더링 ────────────────────────────────
const ALL_MONTHS = ['01','02','03','04','05','06','07','08','09','10','11','12'];

async function loadUploadStatus() {
  const branch = document.getElementById('statsBranch').value;
  const year = document.getElementById('statsYear').value;
  const area = document.getElementById('uploadStatusArea');
  area.innerHTML = '<div class="stat-loading-row"><span class="stat-mini-spinner"></span>불러오는 중...</div>';

  try {
    const status = await window.statsClient.getUploadStatus(branch);
    const yearStatus = status.find(s => s.year === year);

    if (!yearStatus || (!yearStatus.purchaseMonths.length && !yearStatus.usageMonths.length)) {
      area.innerHTML = `<p style="color:var(--text-muted,#7b8794);font-size:12px;">${year}년에 업로드된 데이터가 없습니다.</p>`;
      return;
    }

    const renderMonths = (months, allLabel) => {
      if (!months.length) return '<span style="color:#d1d5db;">없음</span>';
      if (months.length === 12) return `<span style="color:#2fa36b;font-weight:600;">${allLabel} (1~12월 전체)</span>`;
      const last = months[months.length - 1];
      return `<span style="color:var(--blue,#2f6df6);">${months.length}개월 (~${last}월)</span>`;
    };

    area.innerHTML = `
      <table style="width:100%;border-collapse:collapse;">
        <tbody>
          <tr>
            <td style="padding:6px 10px;font-size:12px;font-weight:600;border-bottom:1px solid var(--border-soft,#eaeff5);">${year}년</td>
            <td style="padding:6px 10px;font-size:12px;border-bottom:1px solid var(--border-soft,#eaeff5);">입고: ${renderMonths(yearStatus.purchaseMonths, '완료')}</td>
            <td style="padding:6px 10px;font-size:12px;border-bottom:1px solid var(--border-soft,#eaeff5);">사용현황: ${renderMonths(yearStatus.usageMonths, '완료')}</td>
          </tr>
        </tbody>
      </table>`;
  } catch (error) {
    console.error(error);
    area.innerHTML = `<p style="color:#dc2626;font-size:12px;">오류: ${error.message}</p>`;
  }
}

// ── 검색어 추천(datalist): 검색구분에 따라 실제 데이터의 distinct 값을 보여줌 ──
const _searchSuggestionCache = {};

// 거래처 마스터가 갱신될 때(최초 로드/저장 후) 검색어 추천 캐시를 무효화
function populateVendorDatalist() {
  delete _searchSuggestionCache.vendor;
  // 현재 검색구분이 업체명이면 추천 목록을 바로 새로 채움
  if (document.getElementById('statSearchType')?.value === 'vendor') {
    updateSearchKeywordSuggestions();
  }
}

async function getSuggestionsFor(type) {
  if (_searchSuggestionCache[type]) return _searchSuggestionCache[type];

  let values = [];
  try {
    if (type === 'vendor') {
      // 거래처 마스터(StatsApp.vendors)가 아닌, 실제 거래 데이터의 distinct 값을 사용
      // — 마스터에 등록 안 된 거래처도 통계 표/검색에는 나타날 수 있어 마스터만 쓰면 자동완성이 비어 보이는 문제가 있었음
      values = await window.statsClient.getDistinctValues('vendor_name');

      // 상호 변경 대응(2026-06) — 같은 사업자번호로 여러 이름이 등록된 경우
      // (예: "GC메디아이"/"주식회사 유비케어"), 자동완성에 둘 다 따로 보이면
      // 사용자가 둘 중 하나만 골라 검색해 데이터가 쪼개져 보이는 문제가
      // 있었다(실측 확인). 마스터에 등록된 구 상호명(is_current!=='Y')은
      // 목록에서 제외해 대표 이름(현재 상호) 하나만 보이게 한다. 마스터에
      // 없는 거래처는 그대로 노출(기존 동작 유지).
      const outdatedNames = new Set(
        (window.StatsApp?.vendors || [])
          .filter(v => v.biz_no && v.is_current !== 'Y')
          .map(v => v.vendor_name)
      );
      if (outdatedNames.size) {
        values = values.filter(v => !outdatedNames.has(v));
      }
    } else if (type === 'dept') {
      values = await window.statsClient.getDistinctValues('dept');
    } else if (type === 'itemType') {
      values = await window.statsClient.getDistinctValues('item_type');
    } else if (type === 'itemName') {
      values = await window.statsClient.getDistinctValues('item_name');
    } else if (type === 'itemCode') {
      values = await window.statsClient.getDistinctValues('item_code');
    }
  } catch (e) {
    console.error('[검색어 자동완성] 후보 목록 조회 실패 (type=' + type + '):', e);
    values = [];
  }
  values = Array.from(new Set(values)).sort((a, b) => a.localeCompare(b, 'ko'));
  _searchSuggestionCache[type] = values;
  return values;
}

// ── 커스텀 자동완성 드롭다운 (입력한 글자에 맞는 후보만 표시, 빈 입력일 땐 아무것도 안 보임) ──
function hideAllSuggestionDropdowns_() {
  document.querySelectorAll('.stat-suggest-dropdown').forEach(el => {
    el.innerHTML = '';
    el.style.display = 'none';
  });
}

function renderSuggestDropdown_(dropdownEl, inputEl, values) {
  if (!dropdownEl || !inputEl) return;
  const kw = (inputEl.value || '').trim().toLowerCase();
  if (!kw) { dropdownEl.innerHTML = ''; dropdownEl.style.display = 'none'; return; }

  const matched = values.filter(v => String(v).toLowerCase().includes(kw)).slice(0, 30);
  if (!matched.length) { dropdownEl.innerHTML = ''; dropdownEl.style.display = 'none'; return; }

  dropdownEl.innerHTML = matched.map(v => {
    const safe = String(v).replace(/"/g, '&quot;');
    return `<div class="stat-suggest-item" onmousedown="event.preventDefault();this.closest('.stat-suggest-dropdown').__pick('${safe.replace(/'/g, "\\'")}')">${safe}</div>`;
  }).join('');
  dropdownEl.__pick = (val) => {
    inputEl.value = val;
    hideAllSuggestionDropdowns_();
    inputEl.focus();
  };
  dropdownEl.style.display = 'block';
}

async function updateSearchKeywordSuggestions() {
  const type = document.getElementById('statSearchType')?.value;
  const inputEl = document.getElementById('statSearchKeyword');
  const dropdownEl = document.getElementById('statSearchSuggestions');
  if (!dropdownEl || !type || !inputEl) return;
  const values = await getSuggestionsFor(type);
  renderSuggestDropdown_(dropdownEl, inputEl, values);
}

async function updateAdvancedRowSuggestions(selectEl) {
  const row = selectEl.closest('.stat-advanced-row');
  const inputEl = row?.querySelector('.stat-advanced-keyword');
  const dropdownEl = row?.querySelector('.stat-advanced-suggestions');
  if (!dropdownEl || !inputEl) return;
  const values = await getSuggestionsFor(selectEl.value);
  // 검색구분을 바꾼 직후에는 입력값이 비어 있을 수 있으므로 캐시만 갱신해두고, 실제 표시는 입력 시점에
  dropdownEl.__cachedValues = values;
  renderSuggestDropdown_(dropdownEl, inputEl, values);
}

async function updateAdvancedRowSuggestionsOnInput_(inputEl) {
  const row = inputEl.closest('.stat-advanced-row');
  const fieldEl = row?.querySelector('.stat-advanced-field');
  const dropdownEl = row?.querySelector('.stat-advanced-suggestions');
  if (!dropdownEl || !fieldEl) return;
  const values = dropdownEl.__cachedValues || await getSuggestionsFor(fieldEl.value);
  dropdownEl.__cachedValues = values;
  renderSuggestDropdown_(dropdownEl, inputEl, values);
}

// ── 상세검색 패널 ──────────────────────────────────────────
let advancedRowSeq = 0;

function openAdvancedSearch() {
  const panel = document.getElementById('advancedSearchPanel');
  if (!panel) return;
  panel.style.display = '';
  if (!document.getElementById('advancedConditionRows').children.length) {
    addAdvancedConditionRow();
  }
}

function closeAdvancedSearch() {
  const panel = document.getElementById('advancedSearchPanel');
  if (panel) panel.style.display = 'none';
}

function addAdvancedConditionRow() {
  const wrap = document.getElementById('advancedConditionRows');
  if (!wrap) return;
  const isFirst = wrap.children.length === 0;
  const rowId = `advRow${advancedRowSeq++}`;

  const row = document.createElement('div');
  row.className = 'stat-advanced-row';
  row.id = rowId;
  row.innerHTML = `
    ${isFirst
      ? `<span class="stat-advanced-combinator-placeholder">조건 1</span>`
      : `<select class="stat-advanced-combinator">
           <option value="AND">그리고 (AND)</option>
           <option value="OR">또는 (OR)</option>
         </select>`
    }
    <select class="stat-advanced-field" onchange="updateAdvancedRowSuggestions(this)">
      <option value="vendor">업체명</option>
      <option value="dept">부서명</option>
      <option value="itemType">자재구분</option>
      <option value="itemName">품목명</option>
      <option value="itemCode">품목코드</option>
    </select>
    <div class="stat-advanced-keyword-wrap" style="position:relative;">
      <input type="text" class="stat-advanced-keyword" placeholder="검색어 입력"
        oninput="updateAdvancedRowSuggestionsOnInput_(this)"
        onkeydown="if(event.key==='Enter')applyAdvancedSearch()"
        onblur="setTimeout(()=>hideAllSuggestionDropdowns_(), 150)">
      <div class="stat-suggest-dropdown stat-advanced-suggestions"></div>
    </div>
    <button type="button" class="stat-advanced-remove" onclick="removeAdvancedConditionRow('${rowId}')" title="조건 삭제">✕</button>
  `;
  wrap.appendChild(row);
  updateAdvancedRowSuggestions(row.querySelector('.stat-advanced-field'));
}

function removeAdvancedConditionRow(rowId) {
  const row = document.getElementById(rowId);
  if (!row) return;
  row.remove();

  // 첫 행이 삭제되어 다음 행이 맨 위로 올라온 경우, 그 행의 결합자 선택을 placeholder로 교체
  const wrap = document.getElementById('advancedConditionRows');
  const first = wrap?.firstElementChild;
  if (first && first.querySelector('.stat-advanced-combinator')) {
    const placeholder = document.createElement('span');
    placeholder.className = 'stat-advanced-combinator-placeholder';
    placeholder.textContent = '조건 1';
    first.querySelector('.stat-advanced-combinator').replaceWith(placeholder);
  }
}

function clearAdvancedConditions() {
  const wrap = document.getElementById('advancedConditionRows');
  if (wrap) wrap.innerHTML = '';
  addAdvancedConditionRow();
  updateAdvancedSearchBadge();
}

// ── 전체 검색조건 초기화: 기본 검색바 + 상세검색 조건을 모두 비우고 패널 닫음 ──
function resetAllSearchConditions() {
  const typeEl = document.getElementById('statSearchType');
  const keywordEl = document.getElementById('statSearchKeyword');
  if (typeEl) typeEl.value = 'vendor';
  if (keywordEl) keywordEl.value = '';

  clearAdvancedConditions();
  closeAdvancedSearch();
  updateSearchKeywordSuggestions();
  runStatsDashboard();
}

function getAdvancedConditions() {
  const wrap = document.getElementById('advancedConditionRows');
  if (!wrap) return [];
  return Array.from(wrap.children).map(row => ({
    field: row.querySelector('.stat-advanced-field')?.value,
    keyword: row.querySelector('.stat-advanced-keyword')?.value || '',
    combinator: row.querySelector('.stat-advanced-combinator')?.value || 'AND',
  })).filter(c => c.keyword.trim());
}

function updateAdvancedSearchBadge() {
  const badge = document.getElementById('advancedSearchBadge');
  if (!badge) return;
  const count = getAdvancedConditions().length;
  badge.textContent = String(count);
  badge.style.display = count > 0 ? '' : 'none';
}

function applyAdvancedSearch() {
  updateAdvancedSearchBadge();
  closeAdvancedSearch();
  runStatsDashboard();
}

// ── 통계 조회: 서브탭 전환 ─────────────────────────────────
let currentSubtab = 'branch';
let currentRecordType = 'purchase'; // 'purchase'(입고) | 'usage'(사용)
let currentTrendMode = 'monthly'; // 'monthly'(월별 추이) | 'compare'(구간 비교)

function switchRecordType(type) {
  currentRecordType = type;
  document.getElementById('recordTypePurchase')?.classList.toggle('active', type === 'purchase');
  document.getElementById('recordTypeUsage')?.classList.toggle('active', type === 'usage');
  runStatsDashboard();
}
function setActiveSubtab_(subtab) {
  currentSubtab = subtab;
  ['branch', 'vendor', 'dept', 'item', 'trend'].forEach(t => {
    document.getElementById(`subtab${capitalize(t)}`)?.classList.toggle('active', t === subtab);
  });
  const trendPanel = document.getElementById('trendControlsPanel');
  if (trendPanel) trendPanel.style.display = subtab === 'trend' ? '' : 'none';

  // 의원별 비교 탭은 항상 전체 의원을 동시에 보여주므로, 상단 검색바의 의원 선택은 의미가 없어 비활성화
  const topBranch = document.getElementById('statDashBranch');
  if (topBranch) topBranch.disabled = (subtab === 'branch');

  // 기간비교 탭을 벗어나면 상단 검색바의 기간 입력을 다시 활성화
  if (subtab !== 'trend') {
    const topYmFrom = document.getElementById('statDashYmFrom');
    const topYmTo = document.getElementById('statDashYmTo');
    if (topYmFrom) topYmFrom.disabled = false;
    if (topYmTo) topYmTo.disabled = false;
  } else {
    // 기간비교 탭으로 들어올 때는 현재 트렌드 모드 기준으로 다시 적용
    const topYmFrom = document.getElementById('statDashYmFrom');
    const topYmTo = document.getElementById('statDashYmTo');
    const shouldDisable = currentTrendMode === 'compare';
    if (topYmFrom) topYmFrom.disabled = shouldDisable;
    if (topYmTo) topYmTo.disabled = shouldDisable;
  }
}

function switchStatsSubtab(subtab) {
  setActiveSubtab_(subtab);
  runStatsDashboard();
}

// ── 기간 비교: 모드 전환 (월별 추이 / 구간 비교) ──────────────
function switchTrendMode(mode) {
  currentTrendMode = mode;
  document.getElementById('trendModeMonthly')?.classList.toggle('active', mode === 'monthly');
  document.getElementById('trendModeCompare')?.classList.toggle('active', mode === 'compare');
  const compareFields = document.getElementById('trendCompareFields');
  if (compareFields) compareFields.style.display = mode === 'compare' ? '' : 'none';

  // 구간 비교 모드에서는 상단 검색바의 기간이 의미가 없으므로 비활성화 (혼란의 원인이었음)
  const topYmFrom = document.getElementById('statDashYmFrom');
  const topYmTo = document.getElementById('statDashYmTo');
  if (topYmFrom) topYmFrom.disabled = mode === 'compare';
  if (topYmTo) topYmTo.disabled = mode === 'compare';

  if (mode === 'compare') {
    initTrendComparePeriodsIfEmpty_();
    updateTrendQuickButtonState();
  }

  runStatsDashboard();
}

// 기준 구간/비교 구간이 비어있을 때만 기본값(지난달/지지난달)을 채움 — 사용자가 이미 지정한 값은 보존
function initTrendComparePeriodsIfEmpty_() {
  const baseFromEl = document.getElementById('trendBaseYmFrom');
  const baseToEl = document.getElementById('trendBaseYmTo');
  const compFromEl = document.getElementById('trendCompareYmFrom');
  const compToEl = document.getElementById('trendCompareYmTo');
  if (!baseFromEl || baseFromEl.value) return; // 이미 값이 있으면 건드리지 않음

  const now = new Date();
  const ymOf = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const twoMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, 1);

  baseFromEl.value = ymOf(lastMonth);
  baseToEl.value = ymOf(lastMonth);
  compFromEl.value = ymOf(twoMonthsAgo);
  compToEl.value = ymOf(twoMonthsAgo);
}

// ── 기간 비교: 비교 구간 빠른 선택 (전월 / 전년 동기) ──────────
// 기준 구간이 비어있으면 빠른선택 버튼을 시각적으로 비활성화 (클릭해도 동작 안 함을 사전에 알림)
function updateTrendQuickButtonState() {
  const baseFrom = document.getElementById('trendBaseYmFrom')?.value;
  const baseTo = document.getElementById('trendBaseYmTo')?.value;
  const ready = !!(baseFrom && baseTo);
  document.querySelectorAll('.stat-trend-quick-buttons .btn').forEach(btn => {
    btn.disabled = !ready;
  });
}

function applyTrendQuickRange(type) {
  const baseFrom = document.getElementById('trendBaseYmFrom')?.value;
  const baseTo = document.getElementById('trendBaseYmTo')?.value;
  if (!baseFrom || !baseTo) { showMessage('먼저 기준 구간을 선택해주세요.', 'error'); return; }

  const addMonths = (ym, delta) => {
    const [y, m] = ym.split('-').map(Number);
    const total = y * 12 + (m - 1) + delta;
    const newY = Math.floor(total / 12);
    const newM = (total % 12) + 1;
    return `${newY}-${String(newM).padStart(2, '0')}`;
  };

  // 기준 구간의 길이(월 수)를 그대로 유지해서 비교 구간을 계산
  const [fy, fm] = baseFrom.split('-').map(Number);
  const [ty, tm] = baseTo.split('-').map(Number);
  const spanMonths = (ty * 12 + tm) - (fy * 12 + fm); // 0이면 1개월

  let compareFrom, compareTo;
  if (type === 'prevMonth') {
    compareFrom = addMonths(baseFrom, -(spanMonths + 1));
    compareTo = addMonths(baseTo, -(spanMonths + 1));
  } else if (type === 'prevYear') {
    compareFrom = addMonths(baseFrom, -12);
    compareTo = addMonths(baseTo, -12);
  }

  document.getElementById('trendCompareYmFrom').value = compareFrom;
  document.getElementById('trendCompareYmTo').value = compareTo;
  runStatsDashboard();
}

// ── 통계 조회: 실행 ────────────────────────────────────────
async function runStatsDashboard() {
  const resultArea = document.getElementById('statsResultArea');
  const summaryGrid = document.getElementById('statsSummaryGrid');
  const branch = document.getElementById('statDashBranch').value;
  const ymFrom = document.getElementById('statDashYmFrom').value;
  const ymTo   = document.getElementById('statDashYmTo').value;

  // 기본 검색바: 검색구분 + 키워드 (LIKE 검색, 서브탭과 무관하게 항상 동일 적용)
  const basicSearch = {
    type: document.getElementById('statSearchType')?.value,
    keyword: document.getElementById('statSearchKeyword')?.value || '',
  };

  const filters = {
    branch, ymFrom: ymFrom || null, ymTo: ymTo || null,
    basicSearch,
    advancedConditions: getAdvancedConditions(),
  };

  resultArea.innerHTML = '<div class="stat-loading-row"><span class="stat-mini-spinner"></span>조회 중...</div>';
  summaryGrid.innerHTML = '';

  const startedAt = Date.now();
  const MIN_LOADING_MS = 300;

  try {
    let renderFn;

    const recLabel = currentRecordType === 'usage' ? '사용' : '구매';

    if (currentSubtab === 'branch') {
      const { data, summary, itemTypes } = await window.statsClient.getBranchStats(filters, currentRecordType);
      renderFn = () => {
        renderSummaryCards(summaryGrid, summary, '의원', recLabel);
        const itemTypeColumns = (itemTypes || []).map(t => ({
          key: `byItemType.${t}`, label: t, numeric: true, isItemType: true, clickable: false,
        }));
        renderStatsTable(resultArea, data, 'amount', [
          { key: 'branch',  label: '의원' },
          { key: 'supply',  label: '공급가액(부가세 별도)', numeric: true },
          { key: 'vat',     label: '부가세',   numeric: true },
          ...itemTypeColumns,
          { key: 'amount',  label: '합계금액(부가세 포함)', numeric: true, withBar: true },
          { key: 'record_count', label: '건수', numeric: true },
        ]);
      };
    } else if (currentSubtab === 'vendor') {
      const { data, summary, itemTypes } = await window.statsClient.getVendorStats(filters, currentRecordType);
      renderFn = () => {
        renderSummaryCards(summaryGrid, summary, '거래처', recLabel);
        const itemTypeColumns = (itemTypes || []).map(t => ({
          key: `byItemType.${t}`, label: t, numeric: true, isItemType: true,
        }));
        renderStatsTable(resultArea, data, 'amount', [
          { key: 'vendor_name', label: '거래처' },
          { key: 'supply',      label: '공급가액(부가세 별도)', numeric: true },
          { key: 'vat',         label: '부가세',   numeric: true },
          ...itemTypeColumns,
          { key: 'amount',      label: '합계금액(부가세 포함)', numeric: true, withBar: true },
          { key: 'record_count', label: '건수',    numeric: true },
        ]);
      };
    } else if (currentSubtab === 'dept') {
      const { data, summary, itemTypes } = await window.statsClient.getDeptStats(filters, currentRecordType);
      renderFn = () => {
        renderSummaryCards(summaryGrid, summary, '부서', recLabel);
        const itemTypeColumns = (itemTypes || []).map(t => ({
          key: `byItemType.${t}`, label: t, numeric: true, isItemType: true,
        }));
        renderStatsTable(resultArea, data, 'amount', [
          { key: 'dept',   label: '부서' },
          { key: 'supply', label: '공급가액(부가세 별도)', numeric: true },
          { key: 'vat',    label: '부가세',   numeric: true },
          ...itemTypeColumns,
          { key: 'amount', label: '합계금액(부가세 포함)', numeric: true, withBar: true },
          { key: 'record_count', label: '건수', numeric: true },
        ]);
      };
    } else if (currentSubtab === 'item') {
      const { data, summary } = await window.statsClient.getItemStats(filters, currentRecordType);
      renderFn = () => {
        renderSummaryCards(summaryGrid, summary, '품목', recLabel);
        renderStatsTable(resultArea, data, 'amount', [
          { key: 'item_name', label: '자재명' },
          { key: 'qty',        label: '수량',     numeric: true },
          { key: 'supply',     label: '공급가액(부가세 별도)', numeric: true },
          { key: 'vat',        label: '부가세',   numeric: true },
          { key: 'amount',     label: '합계금액(부가세 포함)', numeric: true, withBar: true },
          { key: 'record_count', label: '건수',   numeric: true },
        ], 'openItemDetailModal');
      };
    } else if (currentSubtab === 'trend' && currentTrendMode === 'monthly') {
      const { data, summary, itemTypes } = await window.statsClient.getMonthlyTrend(filters, currentRecordType);
      renderFn = () => {
        renderSummaryCards(summaryGrid, summary, '월', recLabel);
        renderMonthlyTrendChart_(data, itemTypes);
        const itemTypeColumns = (itemTypes || []).map(t => ({
          key: `byItemType.${t}`, label: t, numeric: true, isItemType: true, clickable: false,
        }));
        renderStatsTable(resultArea, data, 'amount', [
          { key: 'ym',     label: '연월' },
          { key: 'qty',    label: '수량',     numeric: true },
          { key: 'supply', label: '공급가액(부가세 별도)', numeric: true },
          { key: 'vat',    label: '부가세',   numeric: true },
          ...itemTypeColumns,
          { key: 'amount', label: '합계금액(부가세 포함)', numeric: true, withBar: true },
          { key: 'record_count', label: '건수', numeric: true },
        ]);
      };
    } else if (currentSubtab === 'trend' && currentTrendMode === 'compare') {
      const baseYmFrom = document.getElementById('trendBaseYmFrom')?.value;
      const baseYmTo = document.getElementById('trendBaseYmTo')?.value;
      const compareYmFrom = document.getElementById('trendCompareYmFrom')?.value;
      const compareYmTo = document.getElementById('trendCompareYmTo')?.value;
      if (!baseYmFrom || !baseYmTo || !compareYmFrom || !compareYmTo) {
        renderFn = () => {
          summaryGrid.innerHTML = '';
          hideStatsChart_();
          resultArea.innerHTML = '<p style="color:#9ca3af;font-size:13px;">기준 구간과 비교 구간을 모두 선택한 뒤 조회해주세요.</p>';
        };
      } else {
        // 구간 비교는 상단 검색바의 기간이 아니라, 전용으로 지정한 기준/비교 구간을 사용
        const compareFilters = { ...filters, ymFrom: baseYmFrom, ymTo: baseYmTo };
        const comparison = await window.statsClient.getPeriodComparison(compareFilters, currentRecordType, compareYmFrom, compareYmTo);
        renderFn = () => {
          summaryGrid.innerHTML = '';
          renderPeriodComparisonChart_(comparison);
          renderPeriodComparisonTable(resultArea, comparison);
        };
      }
    } else {
      renderFn = () => {
        resultArea.innerHTML = '<p style="color:#9ca3af;font-size:13px;">🚧 준비 중인 기능입니다.</p>';
      };
    }

    // 최소 로딩 표시 시간 보장 (너무 빠르면 스피너가 깜빡임처럼 느껴짐)
    const elapsed = Date.now() - startedAt;
    if (elapsed < MIN_LOADING_MS) {
      await new Promise(r => setTimeout(r, MIN_LOADING_MS - elapsed));
    }
    // 기간비교 탭이 아니면 그래프 영역은 항상 숨김 (각 분기에서 별도 처리 불필요)
    if (currentSubtab !== 'trend') hideStatsChart_();
    renderFn();
  } catch (error) {
    console.error(error);
    resultArea.innerHTML = `<p style="color:#dc2626;font-size:13px;">오류: ${error.message}</p>`;
  }
}

// ── 결과 표 렌더링 (공통) ──────────────────────────────────
// ── 요약 카드 렌더링 ───────────────────────────────────────
function renderSummaryCards(container, summary, groupLabel, amountLabel) {
  const fmtNum = v => Number(v || 0).toLocaleString('ko-KR');
  const topLabel = groupLabel === '월' ? '최다 매입월' : `최다 ${groupLabel}`;

  container.innerHTML = `
    <div class="stat-summary-card accent-total">
      <div class="stat-summary-label">총 ${amountLabel}액 <span class="stat-summary-vat-tag">부가세 포함</span></div>
      <div class="stat-summary-value">${fmtNum(summary.total)}원</div>
    </div>
    <div class="stat-summary-card accent-count">
      <div class="stat-summary-label">${groupLabel} 수</div>
      <div class="stat-summary-value">${fmtNum(summary.groupCount)}개</div>
      <div class="stat-summary-sub">총 ${fmtNum(summary.totalRecords)}건</div>
    </div>
    <div class="stat-summary-card accent-avg">
      <div class="stat-summary-label">${groupLabel}당 평균</div>
      <div class="stat-summary-value">${fmtNum(Math.round(summary.avgPerGroup))}원</div>
    </div>
    <div class="stat-summary-card accent-top">
      <div class="stat-summary-label">${topLabel}</div>
      <div class="stat-summary-value small">${summary.topName || '-'}</div>
      <div class="stat-summary-sub">${fmtNum(summary.topAmount)}원</div>
    </div>
  `;
}

// ── 결과 표 렌더링: 순위 배지 + 점유율 바 포함 ────────────────
// ── 자재구분 컬럼 클릭: 그 거래처+자재구분 조건으로 상세검색을 채워 표를 다시 조회 ──
function filterByVendorAndItemType(rowIndex, itemTypeLabel) {
  const row = window._statsRowsCache?.[rowIndex];
  if (!row) return;

  // 월별 추이 표(연월 기준 행)에서는 거래처/부서 조건으로 옮길 대상이 없으므로 클릭을 무시
  if (row.vendor_name === undefined && row.dept === undefined) return;

  // 거래처별/부서별 표에서는 합산된 자재구분 금액만 보이므로, 개별 품목 내역을 보려면 품목별 탭으로 전환
  setActiveSubtab_('item');

  // 어느 표에서 클릭했는지에 따라 "업체명=거래처명" 또는 "부서명=부서명" 조건을 채움
  const isDeptRow = row.dept !== undefined && row.vendor_name === undefined;
  const firstConditionField = isDeptRow ? 'dept' : 'vendor';
  const firstConditionValue = isDeptRow ? row.dept : row.vendor_name;

  // 기본 검색바는 비우고, 상세검색에 두 조건을 채움
  const basicKeywordEl = document.getElementById('statSearchKeyword');
  if (basicKeywordEl) basicKeywordEl.value = '';

  clearAdvancedConditions();

  const wrap = document.getElementById('advancedConditionRows');
  const rows = wrap.querySelectorAll('.stat-advanced-row');

  // 첫 행: 업체명/부서명 = 클릭한 행의 이름
  const firstField = rows[0].querySelector('.stat-advanced-field');
  const firstKeyword = rows[0].querySelector('.stat-advanced-keyword');
  firstField.value = firstConditionField;
  firstKeyword.value = firstConditionValue;

  // 두 번째 행 추가: 자재구분 = 레이블 (AND)
  addAdvancedConditionRow();
  const secondRow = wrap.querySelectorAll('.stat-advanced-row')[1];
  secondRow.querySelector('.stat-advanced-combinator').value = 'AND';
  secondRow.querySelector('.stat-advanced-field').value = 'itemType';
  secondRow.querySelector('.stat-advanced-keyword').value = itemTypeLabel;

  updateAdvancedSearchBadge();
  openAdvancedSearch(); // 자동으로 채워진 조건을 사용자가 바로 확인할 수 있도록 패널을 열어둠
  runStatsDashboard(); // 탭 전환 시 조건이 비어있었으므로, 조건을 채운 뒤 다시 조회
}

// ── 품목별 표 행 클릭: 그 자재의 개별 입고/사용 건을 모달로 보여줌 ──
let _itemModalAllRows = []; // 모달 내 재검색의 기준이 되는 전체 원본 행

function openItemDetailModal(rowIndex) {
  const row = window._statsRowsCache?.[rowIndex];
  if (!row || !row._rawRows) return;

  _itemModalAllRows = row._rawRows;

  const modal = document.getElementById('itemDetailModal');
  const title = document.getElementById('itemDetailModalTitle');
  const searchInput = document.getElementById('itemDetailModalSearch');
  if (!modal) return;

  title.textContent = `${row.item_name}${row.item_code ? ' (' + row.item_code + ')' : ''} — 세부내역 (${_itemModalAllRows.length}건)`;
  searchInput.value = '';
  modal.style.display = 'flex';
  renderItemDetailModalTable(_itemModalAllRows);
  searchInput.focus();
}

function closeItemDetailModal() {
  const modal = document.getElementById('itemDetailModal');
  if (modal) modal.style.display = 'none';
}

function filterItemDetailModal() {
  const kw = document.getElementById('itemDetailModalSearch')?.value?.trim().toLowerCase() || '';
  if (!kw) {
    renderItemDetailModalTable(_itemModalAllRows);
    return;
  }
  const filtered = _itemModalAllRows.filter(r => {
    const haystack = [
      r.branch, r.item_name, r.item_code, r.purchase_no, r.spec, r.status,
      r.dept, r.vendor_name, r.vendor_code, r.lot_no, r.requester,
      r.used_by, r.release_requester, r.item_type,
    ].filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(kw);
  });
  renderItemDetailModalTable(filtered);
}

function renderItemDetailModalTable(items) {
  const body = document.getElementById('itemDetailModalBody');
  const countEl = document.getElementById('itemDetailModalCount');
  if (!body) return;

  countEl.textContent = `${items.length}건`;

  if (!items.length) {
    body.innerHTML = '<p style="color:var(--text-muted,#7b8794);font-size:13px;padding:24px;text-align:center;">검색 결과가 없습니다.</p>';
    return;
  }

  const fmtNum = v => Number(v || 0).toLocaleString('ko-KR');

  // 입고/사용 레코드는 의미 있는 컬럼이 다르므로 분리 — 핵심 정보만 선별(전체 컬럼 나열은 가독성을 해침)
  const cols = currentRecordType === 'usage'
    ? [
        { key: 'branch',      label: '의원' },
        { key: 'usage_date',  label: '사용일자' },
        { key: 'dept',        label: '부서' },
        { key: 'used_by',     label: '사용자' },
        { key: 'item_type',   label: '자재구분' },
        { key: 'spec',        label: '규격' },
        { key: 'usage_qty',   label: '사용수량', numeric: true },
        { key: 'usage_supply', label: '사용공급가', numeric: true },
        { key: 'usage_vat',   label: '사용부가세', numeric: true },
        { key: 'usage_total', label: '사용합계',   numeric: true },
        { key: 'lot_no',      label: 'LOT No.' },
        { key: 'vendor_name', label: '공급업체' },
        { key: 'purchase_no', label: '구매번호' },
      ]
    : [
        { key: 'branch',        label: '의원' },
        { key: 'received_date', label: '입고일자' },
        { key: 'vendor_name',   label: '공급업체' },
        { key: 'dept',          label: '의뢰부서' },
        { key: 'item_type',     label: '자재구분' },
        { key: 'spec',          label: '규격' },
        { key: 'status',        label: '상태' },
        { key: 'quantity',      label: '수량',     numeric: true },
        { key: 'unit_price',    label: '단가',     numeric: true },
        { key: 'supply_amount', label: '공급가액(부가세 별도)', numeric: true },
        { key: 'vat_amount',    label: '부가세',   numeric: true },
        { key: 'total_amount',  label: '합계금액(부가세 포함)', numeric: true },
        { key: 'purchase_no',   label: '구매번호' },
      ];

  const thead = cols.map(c => `<th class="${c.numeric ? 'num' : ''}">${c.label}</th>`).join('');
  const tbody = items.map(item => {
    const cells = cols.map(c => {
      const v = item[c.key];
      const display = c.numeric ? fmtNum(v) : (v ?? '-');
      return `<td class="${c.numeric ? 'num' : ''}">${display}</td>`;
    }).join('');
    return `<tr>${cells}</tr>`;
  }).join('');

  body.innerHTML = `
    <div style="overflow:auto;max-height:62vh;">
      <table class="stat-table">
        <thead><tr>${thead}</tr></thead>
        <tbody>${tbody}</tbody>
      </table>
    </div>`;
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const modal = document.getElementById('itemDetailModal');
    if (modal && modal.style.display !== 'none') closeItemDetailModal();
  }
});

// 거래처 그룹(사업자번호 동일, 명칭 변경 이력 있음) 펼치기/접기
function toggleStatRowExpand(rowId) {
  const toggle = document.getElementById(`${rowId}_toggle`);
  const breakdownRows = document.querySelectorAll(`tr[data-parent="${rowId}"]`);
  const isExpanded = toggle?.classList.contains('expanded');

  breakdownRows.forEach(r => { r.style.display = isExpanded ? 'none' : ''; });
  if (toggle) {
    toggle.classList.toggle('expanded', !isExpanded);
    toggle.textContent = isExpanded ? '▸' : '▾';
  }
}

// ── 구간 비교 결과 렌더링: 기준 구간 vs 비교 구간을 나란히 표시 ──
// ── 기간 비교 그래프 (자재구분별 시각화) ──────────────────────
let _statsTrendChartInstance = null;

// 자재구분 우선순위와 일관된 고정 색상 — 그 외 자재구분은 순환 팔레트로 배정
const STAT_ITEMTYPE_COLORS = {
  '소모품': '#2f6df6',
  '시약':   '#16a34a',
  '의약품': '#f59e0b',
};
const STAT_ITEMTYPE_FALLBACK_PALETTE = ['#9333ea', '#dc2626', '#0891b2', '#65a30d', '#db2777'];

function getItemTypeColor_(itemType, fallbackIndex) {
  if (STAT_ITEMTYPE_COLORS[itemType]) return STAT_ITEMTYPE_COLORS[itemType];
  return STAT_ITEMTYPE_FALLBACK_PALETTE[fallbackIndex % STAT_ITEMTYPE_FALLBACK_PALETTE.length];
}

function hideStatsChart_() {
  const panel = document.getElementById('statsChartPanel');
  if (panel) panel.style.display = 'none';
  if (_statsTrendChartInstance) {
    _statsTrendChartInstance.destroy();
    _statsTrendChartInstance = null;
  }
}

function renderMonthlyTrendChart_(data, itemTypes) {
  const panel = document.getElementById('statsChartPanel');
  const canvas = document.getElementById('statsTrendChart');
  if (!panel || !canvas || !window.Chart) return;

  if (!data.length || !itemTypes.length) { hideStatsChart_(); return; }

  panel.style.display = '';
  if (_statsTrendChartInstance) { _statsTrendChartInstance.destroy(); _statsTrendChartInstance = null; }

  const labels = data.map(d => d.ym);
  const datasets = itemTypes.map((t, idx) => ({
    label: t,
    data: data.map(d => d.byItemType[t] || 0),
    backgroundColor: getItemTypeColor_(t, idx),
    stack: 'total',
  }));

  _statsTrendChartInstance = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 12 } } },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${Number(ctx.parsed.y || 0).toLocaleString('ko-KR')}원`,
          },
        },
      },
      scales: {
        x: { stacked: true },
        y: {
          stacked: true,
          ticks: { callback: (v) => Number(v).toLocaleString('ko-KR') },
        },
      },
    },
  });
}

function renderPeriodComparisonChart_(comparison) {
  const panel = document.getElementById('statsChartPanel');
  const canvas = document.getElementById('statsTrendChart');
  if (!panel || !canvas || !window.Chart) return;

  const { itemTypeComparison, basePeriod, comparePeriod } = comparison;
  if (!itemTypeComparison || !itemTypeComparison.length) { hideStatsChart_(); return; }

  panel.style.display = '';
  if (_statsTrendChartInstance) { _statsTrendChartInstance.destroy(); _statsTrendChartInstance = null; }

  const compareLabel = `${comparePeriod.ymFrom} ~ ${comparePeriod.ymTo}`;
  const baseLabel = `${basePeriod.ymFrom} ~ ${basePeriod.ymTo}`;
  const labels = itemTypeComparison.map(it => it.itemType);

  _statsTrendChartInstance = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: compareLabel,
          data: itemTypeComparison.map(it => it.compareVal),
          backgroundColor: '#9aa5b1',
        },
        {
          label: baseLabel,
          data: itemTypeComparison.map(it => it.baseVal),
          backgroundColor: '#2f6df6',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 12 } } },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${Number(ctx.parsed.y || 0).toLocaleString('ko-KR')}원`,
          },
        },
      },
      scales: {
        y: { ticks: { callback: (v) => Number(v).toLocaleString('ko-KR') } },
      },
    },
  });
}

function renderPeriodComparisonTable(container, comparison) {
  const { basePeriod, comparePeriod, metrics, itemTypeComparison } = comparison;
  const fmtNum = v => Number(v || 0).toLocaleString('ko-KR');
  const metricLabels = {
    qty: '수량',
    supply: '공급가액',
    vat: '부가세',
    amount: '합계금액',
    record_count: '건수',
  };
  const compareLabel = `${comparePeriod.ymFrom} ~ ${comparePeriod.ymTo}`;
  const baseLabel = `${basePeriod.ymFrom} ~ ${basePeriod.ymTo}`;

  const rows = metrics.map(m => {
    const diffClass = m.diff > 0 ? 'stat-trend-up' : m.diff < 0 ? 'stat-trend-down' : '';
    const diffSign = m.diff > 0 ? '+' : '';
    const pctText = m.pct === null ? '-' : `${m.pct > 0 ? '+' : ''}${m.pct.toFixed(1)}%`;
    return `
      <tr>
        <td>${metricLabels[m.key] || m.key}</td>
        <td class="num">${fmtNum(m.compareVal)}</td>
        <td class="num">${fmtNum(m.baseVal)}</td>
        <td class="num ${diffClass}">${diffSign}${fmtNum(m.diff)}</td>
        <td class="num ${diffClass}">${pctText}</td>
      </tr>`;
  }).join('');

  const itemTypeRows = (itemTypeComparison || []).map(it => {
    const diffClass = it.diff > 0 ? 'stat-trend-up' : it.diff < 0 ? 'stat-trend-down' : '';
    const diffSign = it.diff > 0 ? '+' : '';
    const pctText = it.pct === null ? '-' : `${it.pct > 0 ? '+' : ''}${it.pct.toFixed(1)}%`;
    return `
      <tr>
        <td>${it.itemType}</td>
        <td class="num">${fmtNum(it.compareVal)}</td>
        <td class="num">${fmtNum(it.baseVal)}</td>
        <td class="num ${diffClass}">${diffSign}${fmtNum(it.diff)}</td>
        <td class="num ${diffClass}">${pctText}</td>
      </tr>`;
  }).join('');

  container.innerHTML = `
    <div class="stat-compare-period-labels">
      <span class="stat-compare-period-chip stat-compare-period-chip--compare">비교 구간 ${compareLabel}</span>
      <span style="color:var(--text-muted,#9aa5b1);">→</span>
      <span class="stat-compare-period-chip stat-compare-period-chip--base">기준 구간 ${baseLabel}</span>
    </div>
    <div class="stat-table-wrap">
      <div style="overflow-x:auto;">
        <table class="stat-table">
          <thead><tr>
            <th>지표</th>
            <th class="num">${compareLabel}</th>
            <th class="num">${baseLabel}</th>
            <th class="num">증감</th>
            <th class="num">증감률</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>

    <p class="stat-compare-subheading">자재구분별 합계금액 비교</p>
    <div class="stat-table-wrap">
      <div style="overflow-x:auto;">
        <table class="stat-table">
          <thead><tr>
            <th>자재구분</th>
            <th class="num">${compareLabel}</th>
            <th class="num">${baseLabel}</th>
            <th class="num">증감</th>
            <th class="num">증감률</th>
          </tr></thead>
          <tbody>${itemTypeRows}</tbody>

        </table>
      </div>
    </div>`;
}

function renderStatsTable(container, rows, barKey, columns, onRowClick) {
  if (!rows.length) {
    container.innerHTML = '<p style="color:#6b7280;font-size:13px;">조회 결과가 없습니다.</p>';
    return;
  }

  // 자재구분 컬럼 드릴다운 모달에서 원본 행을 찾기 위해 현재 표의 rows를 전역에 캐시
  window._statsRowsCache = rows;

  const fmtNum = v => Number(v || 0).toLocaleString('ko-KR');
  // 'byItemType.소모품' 같은 점 표기 키도 읽을 수 있게 하는 헬퍼
  const getVal = (row, key) => key.includes('.')
    ? key.split('.').reduce((obj, k) => (obj == null ? obj : obj[k]), row)
    : row[key];
  const maxVal = Math.max(...rows.map(r => Number(r[barKey]) || 0), 1);
  const rankClass = i => i === 0 ? 'top1' : i === 1 ? 'top2' : i === 2 ? 'top3' : '';

  const thead = columns.map(c =>
    `<th class="${c.numeric ? 'num' : ''}">${c.label}</th>`
  ).join('');

  const tbody = rows.map((row, i) => {
    const expandable = !!row.hasMultipleNames;
    const rowId = `statRow${i}_${Math.random().toString(36).slice(2, 7)}`;

    const cells = columns.map(c => {
      if (c.key === columns[0].key) {
        // 첫 번째(이름) 컬럼: 순위 배지 + 이름 + 사업자번호(있는 경우) + (미등록 거래처는 경고 표시)
        const unmatchedBadge = row.unmatched
          ? ` <span title="거래처 마스터에 등록되지 않음" style="color:#d97706;font-size:11px;">⚠ 미등록</span>`
          : '';
        const bizNoText = row.vendor_biz_no
          ? `<div class="stat-vendor-bizno">${row.vendor_biz_no}</div>`
          : '';
        const expandToggle = expandable
          ? `<span class="stat-expand-toggle" id="${rowId}_toggle">▸</span>`
          : '';
        const nameCell = `
          <span class="stat-name-cell">
            <span class="stat-rank-badge ${rankClass(i)}">${i + 1}</span>
            ${expandToggle}
            <span>
              <div>${row[c.key] || '-'}${unmatchedBadge}</div>
              ${bizNoText}
            </span>
          </span>`;
        return `<td>${nameCell}</td>`;
      }
      if (c.withBar) {
        const val = Number(getVal(row, c.key)) || 0;
        const pct = (val / maxVal) * 100;
        return `<td class="num stat-bar-cell" style="--bar-pct:${pct}%;">${fmtNum(val)}</td>`;
      }
      const raw = getVal(row, c.key);
      const val = c.numeric ? fmtNum(raw) : (raw || '-');
      if (c.isItemType) {
        const numVal = Number(raw) || 0;
        if (numVal > 0 && c.clickable !== false) {
          return `<td class="num stat-itemtype-cell stat-itemtype-clickable" onclick="event.stopPropagation();filterByVendorAndItemType(${i}, '${c.label.replace(/'/g, "\\'")}')">${val}</td>`;
        }
        return `<td class="num stat-itemtype-cell">${val}</td>`;
      }
      const cellClass = c.numeric ? 'num' : '';
      return `<td class="${cellClass}">${val}</td>`;
    }).join('');

    const mainRow = expandable
      ? `<tr class="stat-expandable-row" onclick="toggleStatRowExpand('${rowId}')">${cells}</tr>`
      : onRowClick
        ? `<tr class="stat-expandable-row" onclick="${onRowClick}(${i})">${cells}</tr>`
        : `<tr>${cells}</tr>`;

    if (!expandable) return mainRow;

    // 펼쳐지는 세부 내역: 사업자번호는 같지만 실제 데이터에 등장한 이름별로 나눠 보여줌
    // 헤더와 정확히 같은 컬럼 수를 만들어야 라인이 맞으므로, colspan 대신 컬럼별로 1:1 매칭
    const breakdownRows = row.breakdown.map(b => {
      const bCells = columns.map((c, ci) => {
        if (ci === 0) return `<td class="stat-breakdown-name">└ ${b.vendor_name}</td>`;
        if (c.withBar) return `<td class="num">${fmtNum(b.amount)}</td>`;
        if (ci === columns.length - 1) return `<td class="num">${fmtNum(b.record_count)}</td>`;
        return `<td></td>`;
      }).join('');
      return `<tr class="stat-breakdown-row" data-parent="${rowId}" style="display:none;">${bCells}</tr>`;
    }).join('');

    return mainRow + breakdownRows;
  }).join('');

  container.innerHTML = `
    <div class="stat-table-wrap">
      <div style="overflow-x:auto;">
        <table class="stat-table">
          <thead><tr>${thead}</tr></thead>
          <tbody>${tbody}</tbody>
        </table>
      </div>
    </div>
    <p style="color:var(--text-muted,#7b8794);font-size:11px;margin-top:10px;">총 ${rows.length}건</p>
  `;
}
// ── 로그 출력 (closing 모듈의 clog와 동일한 패턴) ─────────────
function statsLog(msg, cls = 'info') {
  const box = document.getElementById('statsUploadResult');
  if (!box) return;
  const t = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  box.innerHTML += `<div class="cl-log-line ${cls}"><span class="cl-log-time">[${t}]</span>${msg}</div>`;
  box.scrollTop = box.scrollHeight;
}

// ── 파일 업로드 (드래그&드롭) ──────────────────────────────
window.StatsApp = window.StatsApp || {};
StatsApp.purchaseRaw = null;
StatsApp.usageRaw = null;

function statsDragOver(e, id) { e.preventDefault(); document.getElementById(id).classList.add('dragover'); }
function statsDragLeave(id)   { document.getElementById(id).classList.remove('dragover'); }
function statsDropFile(e, type) {
  e.preventDefault();
  document.getElementById('zone-' + type).classList.remove('dragover');
  if (e.dataTransfer.files[0]) statsProcessFile(e.dataTransfer.files[0], type);
}
function statsHandleFile(input, type) {
  if (input.files[0]) statsProcessFile(input.files[0], type);
}
function statsProcessFile(file, type) {
  if (!StatsApp.canEdit) { showMessage('업로드 권한이 없습니다. (edit 이상 필요)', 'error'); return; }

  StatsApp[type + 'Raw'] = file;
  document.getElementById('zone-' + type).classList.add('uploaded');
  document.getElementById('status-' + type).textContent = '✓ ' + file.name;

  const btn = document.getElementById('btnStatsUpload');
  if (btn) btn.disabled = !(StatsApp.purchaseRaw || StatsApp.usageRaw);
}

// ── 업로드 실행 ────────────────────────────────────────────
async function handleStatsUpload() {
  if (!StatsApp.canEdit) { showMessage('업로드 권한이 없습니다. (edit 이상 필요)', 'error'); return; }

  const branch = document.getElementById('statsBranch').value;
  const year = document.getElementById('statsYear').value;
  const resultEl = document.getElementById('statsUploadResult');
  const btn = document.getElementById('btnStatsUpload');

  resultEl.innerHTML = '';
  statsLog(`업로드 시작 — ${branch} ${year}년`, 'info');

  // 파일 형식(헤더) 검증 — 잘못된 영역에 올렸거나 형식이 다르면 즉시 중단
  try {
    if (StatsApp.purchaseRaw) {
      await window.validateStatsFileHeaders(StatsApp.purchaseRaw, 'purchase');
    }
    if (StatsApp.usageRaw) {
      await window.validateStatsFileHeaders(StatsApp.usageRaw, 'usage');
    }
  } catch (error) {
    statsLog(`⚠ ${error.message.replace(/\n/g, '<br>')}`, 'err');
    return;
  }

  // 이미 데이터가 있는 월과 겹치는지 사전 확인 → 겹치면 확인창
  try {
    const status = await window.statsClient.getUploadStatus(branch);
    const yearStatus = status.find(s => s.year === year);

    if (yearStatus) {
      const overlapMsgs = [];

      if (StatsApp.purchaseRaw && yearStatus.purchaseMonths.length) {
        const targetMonths = await window.peekStatsFileMonths(StatsApp.purchaseRaw, 'purchase', year);
        const overlap = targetMonths.filter(m => yearStatus.purchaseMonths.includes(m));
        if (overlap.length) overlapMsgs.push(`입고: ${overlap.join(', ')}월`);
      }
      if (StatsApp.usageRaw && yearStatus.usageMonths.length) {
        const targetMonths = await window.peekStatsFileMonths(StatsApp.usageRaw, 'usage', year);
        const overlap = targetMonths.filter(m => yearStatus.usageMonths.includes(m));
        if (overlap.length) overlapMsgs.push(`사용현황: ${overlap.join(', ')}월`);
      }

      if (overlapMsgs.length) {
        const msg = `${branch} ${year}년의 다음 데이터가 이미 존재하며, 새 파일로 덮어쓰게 됩니다.\n\n` +
          overlapMsgs.join('\n') +
          `\n\n계속하시겠습니까?`;
        if (!confirm(msg)) {
          statsLog('사용자가 업로드를 취소했습니다.', 'warn');
          return;
        }
        statsLog(`겹치는 월 확인됨 (${overlapMsgs.join(' / ')}) — 덮어쓰기로 진행`, 'warn');
      }
    }
  } catch (e) {
    console.warn('업로드 현황 사전 확인 실패, 진행을 계속합니다.', e);
  }

  // 진행 단계 가중치 계산: 선택된 파일 수에 따라 50/50 또는 100%
  const fileKinds = [];
  if (StatsApp.purchaseRaw) fileKinds.push({ kind: 'purchase', file: StatsApp.purchaseRaw, label: '입고' });
  if (StatsApp.usageRaw)    fileKinds.push({ kind: 'usage',    file: StatsApp.usageRaw,    label: '사용현황' });

  const progressBox   = document.getElementById('statsProgressBox');
  const progressLabel = document.getElementById('statsProgressLabel');
  const progressPct   = document.getElementById('statsProgressPct');
  const progressFill  = document.getElementById('statsProgressFill');

  const setProgress = (pct, label) => {
    progressFill.style.width = `${pct}%`;
    progressPct.textContent = `${Math.round(pct)}%`;
    if (label) progressLabel.textContent = label;
  };

  progressBox.style.display = '';
  setProgress(0, '준비 중...');
  btn.disabled = true;

  try {
    for (let fi = 0; fi < fileKinds.length; fi++) {
      const { kind, file, label } = fileKinds[fi];
      const baseProgress = (fi / fileKinds.length) * 100;
      const fileWeight = 100 / fileKinds.length;

      statsLog(`${label} 파일 처리 시작: ${file.name}`, 'info');

      const results = await window.uploadStatsFile(file, branch, kind, year, (info) => {
        if (info.phase === 'parsing') {
          setProgress(baseProgress, `${label} 파일 분석 중...`);
        } else if (info.phase === 'uploading') {
          const innerPct = info.total ? (info.current / info.total) : 0;
          setProgress(baseProgress + innerPct * fileWeight,
            `${label} 업로드 중... (${info.current}/${info.total}개월${info.ym ? ', ' + info.ym : ''})`);
        }
      });

      results.forEach(r => statsLog(`${label} ${r.ym}: ${r.count}건 저장`, 'ok'));
    }

    setProgress(100, '완료');
    statsLog('모든 파일 업로드 완료', 'ok');

    // 업로드 완료 후 초기화
    ['purchase', 'usage'].forEach(type => {
      StatsApp[type + 'Raw'] = null;
      document.getElementById('zone-' + type).classList.remove('uploaded');
      document.getElementById('status-' + type).textContent = '';
      const inputEl = document.querySelector(`#zone-${type} input[type=file]`);
      if (inputEl) inputEl.value = '';
    });

    // 업로드 현황 갱신
    await loadUploadStatus();
  } catch (error) {
    console.error(error);
    statsLog(`오류: ${error.message}`, 'err');
  } finally {
    btn.disabled = !(StatsApp.purchaseRaw || StatsApp.usageRaw);
    setTimeout(() => { progressBox.style.display = 'none'; }, 1500);
  }
}
