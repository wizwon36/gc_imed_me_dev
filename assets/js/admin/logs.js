/**
 * logs.js
 * 시스템 로그 조회 페이지 컨트롤러
 */

const PAGE_SIZE = 50;

let currentPage = 1;
let totalPages  = 1;
let totalCount  = 0;
let allRows     = [];   // 현재 필터 조건으로 불러온 전체 로그
let hasLoaded   = false;

// ─────────────────────────────────────────────
// 초기화
// ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const user = window.auth?.requireAuth?.();
  if (!user) return;

  // 관리자이거나 logs 권한이 있어야 접근 가능
  const ok = await window.appPermission?.requirePermission?.('logs', ['view', 'admin']);
  if (!ok) return;

  document.getElementById('logoutBtn')?.addEventListener('click', () => {
    showGlobalLoading('로그아웃 중...');
    window.auth.logout();
  });

  document.getElementById('searchBtn')?.addEventListener('click', () => {
    currentPage = 1;
    fetchLogs();
  });

  // 날짜 필터 기본값: 오늘 기준 최근 30일
  const today = getTodayYmd();
  const monthAgo = getDateOffsetYmd(-30);
  const fromEl = document.getElementById('filterDateFrom');
  const toEl   = document.getElementById('filterDateTo');
  if (fromEl) fromEl.value = monthAgo;
  if (toEl)   toEl.value   = today;

  // 날짜 범위 제한: 시작일 변경 시 종료일 max를 시작일 + 90일로 설정
  function updateDateConstraints() {
    if (!fromEl || !toEl) return;
    const fromVal = fromEl.value;
    if (!fromVal) return;

    const maxTo = getDateOffsetFromYmd(fromVal, 90);
    toEl.max = maxTo;

    // 종료일이 max를 초과하면 max값으로 자동 조정
    if (toEl.value > maxTo) toEl.value = maxTo;
  }

  if (fromEl) {
    fromEl.max = today;
    fromEl.addEventListener('change', updateDateConstraints);
  }
  if (toEl) {
    toEl.max = today;
  }
  updateDateConstraints();

  // Enter 키로 조회
  ['filterKeyword','filterActionType','filterTargetType','filterDateFrom','filterDateTo']
    .forEach(id => {
      document.getElementById(id)?.addEventListener('keydown', e => {
        if (e.key === 'Enter') { currentPage = 1; fetchLogs(); }
      });
    });

  document.getElementById('prevPageBtn')?.addEventListener('click', () => {
    if (currentPage > 1) { currentPage--; renderPage(); }
  });

  document.getElementById('nextPageBtn')?.addEventListener('click', () => {
    if (currentPage < totalPages) { currentPage++; renderPage(); }
  });
});

// ─────────────────────────────────────────────
// 데이터 조회
// ─────────────────────────────────────────────
async function fetchLogs() {
  const user = window.auth?.getSession?.();
  if (!user) return;

  const keyword    = (document.getElementById('filterKeyword')?.value   || '').trim();
  const actionType = (document.getElementById('filterActionType')?.value || '').trim();
  const targetType = (document.getElementById('filterTargetType')?.value || '').trim();
  const dateFrom   = (document.getElementById('filterDateFrom')?.value  || '').trim();
  const dateTo     = (document.getElementById('filterDateTo')?.value    || '').trim();

  const userEmail = String(user.user_email || user.email || '').trim().toLowerCase();
  
  if (!userEmail) {
    showMessage('로그인 세션에서 사용자 정보를 찾을 수 없습니다. 다시 로그인해 주세요.', 'error');
    return;
  }

  // 기간 필수 체크
  if (!dateFrom || !dateTo) {
    showMessage('조회 기간을 입력해 주세요.', 'error');
    return;
  }

  // 최대 3개월(90일) 제한
  const diffDays = (new Date(dateTo) - new Date(dateFrom)) / (1000 * 60 * 60 * 24);
  if (diffDays < 0) {
    showMessage('종료일이 시작일보다 앞에 있습니다.', 'error');
    return;
  }
  if (diffDays > 90) {
    showMessage('조회 기간은 최대 3개월(90일)까지 가능합니다.', 'error');
    return;
  }

  const params = {
    request_user_email: userEmail,
    keyword,
    action_type: actionType,
    target_type: targetType,
    date_from:   dateFrom,
    date_to:     dateTo
  };

  const searchBtn = document.getElementById('searchBtn');

  try {
    setLoading(searchBtn, true, '조회 중...');
    showGlobalLoading('로그를 불러오는 중...');
    clearMessage();

    const result = await apiGet('listLogs', params);
    allRows = Array.isArray(result.data) ? result.data : [];
    hasLoaded = true;

    currentPage  = 1;
    totalCount   = allRows.length;
    totalPages   = totalCount === 0 ? 1 : Math.ceil(totalCount / PAGE_SIZE);

    renderPage();
  } catch (err) {
    showMessage(err.message || '로그를 불러오지 못했습니다.', 'error');
    renderEmpty('조회 중 오류가 발생했습니다.');
  } finally {
    hideGlobalLoading();
    setLoading(searchBtn, false);
  }
}

// ─────────────────────────────────────────────
// 화면 렌더링
// ─────────────────────────────────────────────
function renderPage() {
  const startIdx = (currentPage - 1) * PAGE_SIZE;
  const endIdx   = startIdx + PAGE_SIZE;
  const pageRows = allRows.slice(startIdx, endIdx);

  const countEl = document.getElementById('listCount');
  if (countEl) {
    countEl.textContent = totalCount > 0
      ? `총 ${totalCount.toLocaleString()}건 (${currentPage} / ${totalPages} 페이지)`
      : '조회된 로그가 없습니다.';
  }

  const tbody = document.getElementById('logTableBody');
  if (!tbody) return;

  if (pageRows.length === 0) {
    renderEmpty(hasLoaded ? '조건에 맞는 로그가 없습니다.' : '조건을 설정한 뒤 조회 버튼을 눌러 주세요.');
    updatePagination();
    return;
  }

  tbody.innerHTML = pageRows.map((row, i) => buildLogRow(row, (currentPage - 1) * PAGE_SIZE + i)).join('');
  updatePagination();
}

function renderEmpty(message) {
  const tbody = document.getElementById('logTableBody');
  if (!tbody) return;

  tbody.innerHTML = `
    <tr>
      <td colspan="6">
        <div class="empty-state">
          <div class="empty-icon">🧾</div>
          <div>${escapeHtml(message)}</div>
        </div>
      </td>
    </tr>
  `;

  const countEl = document.getElementById('listCount');
  if (countEl && hasLoaded) countEl.textContent = '조회된 로그가 없습니다.';

  updatePagination();
}

function buildLogRow(row, index) {
  const actionType = String(row.action_type || '').trim().toUpperCase();
  const badgeClass = getBadgeClass(actionType);
  const hasDiff = actionType === 'UPDATE' && (row.before_data || row.after_data);
  const detailRowId = `log-detail-${index}`;

  const mainRow = `
    <tr class="log-main-row${hasDiff ? ' has-diff' : ''}" ${hasDiff ? `onclick="toggleLogDetail('${detailRowId}')" style="cursor:pointer;"` : ''}>
      <td>${safeText(row.action_time)}</td>
      <td><span class="action-badge ${badgeClass}">${escapeHtml(actionType || '-')}</span></td>
      <td><span class="target-type">${escapeHtml(row.target_type || '-')}</span></td>
      <td title="${escapeHtml(row.target_id || '')}">${escapeHtml(truncate(row.target_id, 22))}</td>
      <td class="wrap">${escapeHtml(row.action_detail || '-')}${hasDiff ? ' <span class="diff-toggle-hint">▾ 변경 내역</span>' : ''}</td>
      <td>${escapeHtml(row.action_user || '-')}</td>
    </tr>
  `;

  if (!hasDiff) return mainRow;

  const diffHtml = buildDiffHtml(row.before_data, row.after_data);

  const detailRow = `
    <tr id="${detailRowId}" class="log-detail-row" style="display:none;">
      <td colspan="6">
        <div class="diff-wrap">${diffHtml}</div>
      </td>
    </tr>
  `;

  return mainRow + detailRow;
}

function buildDiffHtml(before, after) {
  const b = before || {};
  const a = after  || {};
  const keys = Array.from(new Set([...Object.keys(b), ...Object.keys(a)]));

  if (keys.length === 0) return '<span class="diff-empty">변경 내역 없음</span>';

  const FIELD_LABEL = {
    equipment_name: '장비명', model_name: '모델명', manufacturer: '제조사',
    serial_no: '시리얼번호', status: '상태', location: '위치',
    clinic_code: '의원코드', clinic_name: '의원명', team_code: '팀코드', team_name: '팀명',
    department: '사용부서', purchase_date: '취득일자', manufacture_date: '제조일자',
    maintenance_end_date: '유지보수종료일', acquisition_cost: '취득가액',
    vendor: '구매처', manager_name: '담당자', manager_phone: '연락처',
    current_user: '현재사용자', memo: '비고',
    history_type: '이력유형', work_date: '작업일', amount: '금액',
    vendor_name: '업체명', description: '내용', result_status: '결과상태',
    next_action_date: '다음예정일', requester: '요청자',
    item_name: '검사항목명', item_type: '항목유형', unit: '단위',
    mean: '목표평균', sd: '표준편차', preset: '결과값프리셋',
    expected_value: '기대결과값',
    user_name: '사용자명', role: '역할', phone: '연락처',
    active: '활성여부', department: '부서'
  };

  const rows = keys.map(key => {
    const label = FIELD_LABEL[key] || key;
    const bVal = b[key] !== undefined ? String(b[key]) : '';
    const aVal = a[key] !== undefined ? String(a[key]) : '';
    return `
      <tr>
        <td class="diff-field">${escapeHtml(label)}</td>
        <td class="diff-before">${escapeHtml(bVal || '-')}</td>
        <td class="diff-arrow">→</td>
        <td class="diff-after">${escapeHtml(aVal || '-')}</td>
      </tr>
    `;
  }).join('');

  return `
    <table class="diff-table">
      <thead>
        <tr>
          <th>필드</th>
          <th>변경 전</th>
          <th></th>
          <th>변경 후</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function toggleLogDetail(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const isHidden = el.style.display === 'none';
  el.style.display = isHidden ? 'table-row' : 'none';
}

function getBadgeClass(actionType) {
  const known = [
    'CREATE','UPDATE','DELETE','LOGIN','UPLOAD',
    'UPLOAD_PHOTO','DELETE_PHOTO','RESET_PASSWORD','ACTIVATE','DEACTIVATE'
  ];
  return known.includes(actionType) ? actionType : 'OTHER';
}

function updatePagination() {
  const prevBtn  = document.getElementById('prevPageBtn');
  const nextBtn  = document.getElementById('nextPageBtn');
  const pageInfo = document.getElementById('pageInfo');
  const pagEl    = document.getElementById('pagination');

  if (prevBtn)  prevBtn.disabled  = currentPage <= 1;
  if (nextBtn)  nextBtn.disabled  = currentPage >= totalPages;
  if (pageInfo) pageInfo.textContent = totalCount > 0 ? `${currentPage} / ${totalPages}` : '—';
  if (pagEl)    pagEl.style.display = totalPages > 1 ? 'flex' : 'none';
}

// ─────────────────────────────────────────────
// 유틸
// ─────────────────────────────────────────────
function getTodayYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
}

function getDateOffsetYmd(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
}

function getDateOffsetFromYmd(baseYmd, offsetDays) {
  const d = new Date(baseYmd);
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
}

function pad2(n) { return String(n).padStart(2, '0'); }

function truncate(value, maxLen) {
  const str = String(value || '');
  return str.length > maxLen ? str.slice(0, maxLen) + '…' : str;
}

// clearMessage, showMessage는 utils.js의 전역 함수를 사용합니다.
