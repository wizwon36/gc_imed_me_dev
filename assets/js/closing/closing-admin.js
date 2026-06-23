// ============================================================
// closing-admin.js
// 거래처 관리 / 자재 관리 / 재고 초기화 / 사용 초기화
// ============================================================

// ═══════════════════════════════════════════════════════════
// 14. 거래처 관리 (API 연동)
// ═══════════════════════════════════════════════════════════
// 의원별 5% 가산 반올림 방식 로드 (CLOSING_ROUND_MODE)
async function loadRoundModes() {
  if (!App.roundMode) App.roundMode = {};
  try {
    const user = window.auth?.getSession?.();
    const res  = await apiGet('getCodes', {
      request_user_email: user?.email,
      code_group: 'CLOSING_ROUND_MODE',
    });
    const data = Array.isArray(res?.data) ? res.data : [];
    data.forEach(c => {
      const branch = String(c.code_name || '').trim();
      const mode   = String(c.extra1 || 'roundup').trim().toLowerCase();
      if (branch) App.roundMode[branch] = mode;
    });
  } catch (e) {
    // 기본값 roundup 사용
  }
}

async function loadVendorsFromServer() {
  try {
    const user = window.auth?.getSession?.();
    const res  = await apiGet('closingGetVendors', { request_user_email: user?.email });
    App.vendors = Array.isArray(res.data) ? res.data : [];
  } catch (e) {
    // 서버 오류 시 빈 배열 유지, 조용히 처리
    App.vendors = [];
  }
}

function renderVendorTable() {
  const tbody = document.getElementById('vendorTbody');
  if (!tbody) return;

  if (!App.vendors.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text-muted);">등록된 거래처가 없습니다. [+ 행 추가] 또는 [엑셀 업로드]를 이용하세요.</td></tr>`;
    return;
  }

  tbody.innerHTML = App.vendors.map((v, i) => `
    <tr>
      <td><input type="text" value="${escHtml(v.vendor_name || '')}" data-idx="${i}" data-field="vendor_name" onchange="vendorEdit(this)"></td>
      <td><input type="text" value="${escHtml(v.biz_no || '')}" data-idx="${i}" data-field="biz_no" onchange="vendorEdit(this)"></td>
      <td style="text-align:center;"><input type="number" value="${v.credit_days ?? 90}" data-idx="${i}" data-field="credit_days" min="0" style="width:70px;text-align:center;" onchange="vendorEdit(this)"></td>
      <td style="text-align:center;">
        <select data-idx="${i}" data-field="pay_method" onchange="vendorEdit(this)">
          <option ${v.pay_method === '현금결제' ? 'selected' : ''}>현금결제</option>
          <option ${v.pay_method === '어음결제' ? 'selected' : ''}>어음결제</option>
          <option ${v.pay_method === '카드결제' ? 'selected' : ''}>카드결제</option>
        </select>
      </td>
      <td style="text-align:center;"><button onclick="deleteVendor(${i})" style="background:none;border:none;cursor:pointer;color:#c0392b;font-size:16px;" title="삭제">🗑</button></td>
    </tr>
  `).join('');
}

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function vendorEdit(el) {
  const idx   = parseInt(el.dataset.idx);
  const field = el.dataset.field;
  const val   = field === 'credit_days' ? (parseInt(el.value) || 0) : el.value;
  App.vendors[idx][field] = val;
  App.vendorsDirty = true;
}

function addVendorRow() {
  App.vendors.push({ vendor_name: '', biz_no: '', credit_days: 90, pay_method: '현금결제' });
  App.vendorsDirty = true;
  renderVendorTable();
  const lastRow = document.getElementById('vendorTbody').lastElementChild;
  lastRow?.querySelector('input')?.focus();
}

// ═══════════════════════════════════════════════════════════
// 13. 거래처 엑셀 업로드
// ═══════════════════════════════════════════════════════════

// 템플릿 다운로드
function downloadVendorTemplate() {
  const wb = XLSX.utils.book_new();
  const headers = ['거래처명 *', '사업자등록번호 *', '여신기간(일)', '결제방법'];
  const sample  = [
    ['GC메디아이', '2018155688', 90, '현금결제'],
    ['녹십자MS(주)', '1358167475', 90, '현금결제'],
  ];
  const ws = XLSX.utils.aoa_to_sheet([headers, ...sample]);
  // 컬럼 너비
  ws['!cols'] = [{ wch: 28 }, { wch: 18 }, { wch: 14 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, ws, '거래처마스터');
  XLSX.writeFile(wb, '거래처마스터_템플릿.xlsx');
}

// 엑셀 파일 선택 시 파싱 → 미리보기
let _uploadedVendorRows = [];

async function handleVendorExcel(input) {
  const file = input.files?.[0];
  if (!file) return;
  input.value = ''; // 같은 파일 재선택 허용

  try {
    showGlobalLoading('파일을 분석하는 중...');
    _uploadedVendorRows = await parseVendorExcel(file);
    renderVendorUploadPreview(_uploadedVendorRows);
  } catch (err) {
    showMessage('파일 읽기 오류: ' + err.message, 'error');
  } finally {
    await hideGlobalLoading();
  }
}

function parseVendorExcel(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb   = XLSX.read(e.target.result, { type: 'array' });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        const raw  = XLSX.utils.sheet_to_json(ws, { defval: '' });
        if (!raw.length) { reject(new Error('데이터가 없습니다.')); return; }

        // 헤더 정규화 (* 제거, 공백 trim)
        const rows = raw.map((rawRow, idx) => {
          const norm = {};
          Object.entries(rawRow).forEach(([k, v]) => {
            norm[k.replace(/\s*\*$/, '').trim()] = String(v || '').trim();
          });
          const errors = [];
          if (!norm['거래처명'])       errors.push('거래처명 누락');
          if (!norm['사업자등록번호']) errors.push('사업자등록번호 누락');
          return {
            _row:       idx + 2,
            _errors:    errors,
            vendor_name:  norm['거래처명']       || '',
            biz_no:       norm['사업자등록번호'] || '',
            credit_days:  parseInt(norm['여신기간(일)']) || 90,
            pay_method:   norm['결제방법']       || '현금결제',
          };
        });
        resolve(rows);
      } catch (err) {
        reject(new Error('엑셀 파일을 읽지 못했습니다: ' + err.message));
      }
    };
    reader.onerror = () => reject(new Error('파일을 읽지 못했습니다.'));
    reader.readAsArrayBuffer(file);
  });
}

function renderVendorUploadPreview(rows) {
  const preview  = document.getElementById('vendorUploadPreview');
  const table    = document.getElementById('vendorUploadTable');
  const countEl  = document.getElementById('vendorUploadCount');
  const errorEl  = document.getElementById('vendorUploadError');
  const applyBtn = document.getElementById('btnApplyUpload');
  if (!preview || !table) return;

  // 기존 거래처 맵 (신규/업데이트 구분용)
  const existingMap = {};
  App.vendors.forEach(v => { existingMap[v.vendor_name] = true; });

  const errRows  = rows.filter(r => r._errors.length > 0);
  const newCount = rows.filter(r => !r._errors.length && !existingMap[r.vendor_name]).length;
  const updCount = rows.filter(r => !r._errors.length &&  existingMap[r.vendor_name]).length;

  countEl.textContent = `총 ${rows.length}건 (신규 ${newCount} / 업데이트 ${updCount})`;
  errorEl.textContent = errRows.length ? `오류 ${errRows.length}건 — 수정 후 다시 업로드해 주세요.` : '';
  if (applyBtn) applyBtn.style.display = errRows.length ? 'none' : '';

  const cols = ['거래처명', '사업자등록번호', '여신기간(일)', '결제방법'];
  const thead = `<thead><tr>${cols.map(c => `<th>${c}</th>`).join('')}<th>구분</th><th>검증</th></tr></thead>`;
  const tbody = `<tbody>${rows.map(r => {
    const hasErr = r._errors.length > 0;
    const isNew  = !existingMap[r.vendor_name];
    const badge  = hasErr ? '' : isNew
      ? `<span style="background:#e8effd;color:#1a56db;font-size:11px;font-weight:700;padding:2px 7px;border-radius:4px;">신규</span>`
      : `<span style="background:#f0fdf4;color:#0e7c3a;font-size:11px;font-weight:700;padding:2px 7px;border-radius:4px;">업데이트</span>`;
    return `<tr style="${hasErr ? 'background:#fff5f5;' : ''}">
      <td>${escHtml(r.vendor_name)}</td>
      <td>${escHtml(r.biz_no)}</td>
      <td class="num">${r.credit_days}</td>
      <td>${escHtml(r.pay_method)}</td>
      <td style="text-align:center;">${badge}</td>
      <td>${hasErr ? `<span style="color:#c0392b;font-size:11px;">${escHtml(r._errors.join(', '))}</span>` : '✓'}</td>
    </tr>`;
  }).join('')}</tbody>`;

  table.innerHTML = thead + tbody;
  preview.style.display = '';
  preview.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function applyVendorUpload() {
  const validRows = _uploadedVendorRows.filter(r => r._errors.length === 0);

  // 기존 데이터를 거래처명 기준 맵으로 변환
  const existingMap = {};
  App.vendors.forEach(v => { existingMap[v.vendor_name] = v; });

  let updated = 0, added = 0;

  validRows.forEach(({ vendor_name, biz_no, credit_days, pay_method }) => {
    if (existingMap[vendor_name]) {
      // 기존 거래처 → 업데이트
      existingMap[vendor_name] = { ...existingMap[vendor_name], biz_no, credit_days, pay_method };
      updated++;
    } else {
      // 신규 거래처 → 추가
      existingMap[vendor_name] = { vendor_name, biz_no, credit_days, pay_method };
      added++;
    }
  });

  App.vendors = Object.values(existingMap);
  App.vendorsDirty = true;
  cancelVendorUpload();
  renderVendorTable();

  const msg = [];
  if (updated) msg.push(`${updated}건 업데이트`);
  if (added)   msg.push(`${added}건 신규 추가`);
  showMessage(msg.join(', ') + ' 됐습니다. 저장 버튼을 눌러 반영하세요.', 'success');
}

function cancelVendorUpload() {
  _uploadedVendorRows = [];
  const preview = document.getElementById('vendorUploadPreview');
  if (preview) preview.style.display = 'none';
}

function deleteVendor(i) {
  App.vendors.splice(i, 1);
  App.vendorsDirty = true;
  renderVendorTable();
}

async function saveVendors() {
  if (!App.canEdit) { showMessage('저장 권한이 없습니다.', 'error'); return; }

  const btn = document.getElementById('btnSaveVendors');
  btn.disabled = true;
  btn.textContent = '저장 중...';

  try {
    showGlobalLoading('거래처 정보 저장 중...');
    const user = window.auth?.getSession?.();
    await apiPost('closingSaveVendors', {
      request_user_email: user?.email,
      vendors: App.vendors,
    });
    App.vendorsDirty = false;
    showMessage('거래처 정보가 저장됐습니다.', 'success');
    btn.textContent = '✓ 저장됨';
    setTimeout(() => { btn.textContent = '💾 저장'; btn.disabled = false; }, 2000);
  } catch (e) {
    showMessage('저장 중 오류: ' + e.message, 'error');
    btn.textContent = '💾 저장';
    btn.disabled = false;
  } finally {
    await hideGlobalLoading();
  }
}

// ═══════════════════════════════════════════════════════════
// 15. 자재코드 관리 (API 연동)
// ═══════════════════════════════════════════════════════════

async function loadItemsFromServer() {
  try {
    const user = window.auth?.getSession?.();
    const res  = await apiGet('closingGetItems', { request_user_email: user?.email });
    App.items = Array.isArray(res.data) ? res.data : [];
  } catch (e) {
    App.items = [];
  }
}

// ── 자재코드 테이블 (검색 + 페이지네이션) ─────────────────
const ITEM_PAGE_SIZE = 20;
let _itemCurrentPage = 1;
let _itemFiltered    = [];

// 탭 진입 / 데이터 로드 완료 시 호출 → 요약 통계 + 첫 페이지 렌더
function renderItemTable() {
  _updateItemSummary();
  _itemCurrentPage = 1;
  _applyItemFilter();
}

// 검색/필터 변경 시
function onItemSearch() {
  _itemCurrentPage = 1;
  _applyItemFilter();
}

// 통계 카드 업데이트
function _updateItemSummary() {
  const all = App.items;
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('itemCntTotal',   all.length);
  set('itemCntSiyak',   all.filter(i => i.item_type === '시약').length);
  set('itemCntSomoum',  all.filter(i => i.item_type === '소모품').length);
  set('itemCntUiyak',   all.filter(i => i.item_type === '의약품').length);
  set('itemCntDisused', all.filter(i => (i.item_status || '사용') === '폐기').length);
}

// 필터 적용 → _itemFiltered 갱신 → 현재 페이지 렌더
function _applyItemFilter() {
  const keyword      = (document.getElementById('itemSearchInput')?.value || '').trim().toLowerCase();
  const typeFilter   = document.getElementById('itemFilterType')?.value   || 'all';
  const statusFilter = document.getElementById('itemFilterStatus')?.value || 'all';

  _itemFiltered = App.items.filter(it => {
    if (typeFilter   !== 'all' && it.item_type !== typeFilter) return false;
    if (statusFilter !== 'all' && (it.item_status || '사용') !== statusFilter) return false;
    if (keyword) {
      const codeMatch = it.item_code.toLowerCase().includes(keyword);
      const nameMatch = it.item_name.toLowerCase().includes(keyword);
      if (!codeMatch && !nameMatch) return false;
    }
    return true;
  });

  const resultEl = document.getElementById('itemSearchResult');
  if (resultEl) resultEl.textContent = keyword || typeFilter !== 'all' || statusFilter !== 'all'
    ? `검색 결과 ${_itemFiltered.length}건`
    : '';

  _renderItemPage(_itemCurrentPage);
  _renderItemPagination();
}

// 현재 페이지 테이블 렌더
function _renderItemPage(page) {
  _itemCurrentPage = page;
  const tbody = document.getElementById('itemTbody');
  if (!tbody) return;

  if (!_itemFiltered.length) {
    tbody.innerHTML = App.items.length === 0
      ? `<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--text-muted);">등록된 자재가 없습니다. 자재관리 파일을 업로드해 주세요.</td></tr>`
      : `<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--text-muted);">검색 결과가 없습니다.</td></tr>`;
    return;
  }

  const start = (page - 1) * ITEM_PAGE_SIZE;
  const pageData = _itemFiltered.slice(start, start + ITEM_PAGE_SIZE);

  tbody.innerHTML = pageData.map((it, i) => {
    const typeColor = it.item_type === '시약' ? '#0e7c3a' : it.item_type === '의약품' ? '#b45309' : '#1a56db';
    const typeBg    = it.item_type === '시약' ? '#e6f4ec' : it.item_type === '의약품' ? '#fef3e2' : '#e8effd';
    const isDisused = (it.item_status || '사용') === '폐기';
    const rowFill   = (start + i) % 2 === 0 ? '' : 'background:#f8fafc;';
    const fmtPrice  = v => v ? Number(v).toLocaleString() : '-';
    return `<tr style="${isDisused ? 'opacity:.45;' : rowFill}">
      <td style="font-family:monospace;font-size:12px;">${escHtml(it.item_code)}</td>
      <td>${escHtml(it.item_name)}</td>
      <td style="text-align:center;">
        <span style="background:${typeBg};color:${typeColor};font-size:11px;font-weight:700;padding:2px 8px;border-radius:4px;">
          ${escHtml(it.item_type)}
        </span>
      </td>
      <td style="text-align:right;font-variant-numeric:tabular-nums;font-size:12px;">${fmtPrice(it.purchase_price)}</td>
      <td style="text-align:right;font-variant-numeric:tabular-nums;font-size:12px;">${fmtPrice(it.calc_price)}</td>
      <td style="text-align:center;">
        <select data-code="${escHtml(it.item_code)}" onchange="itemStatusEdit(this)"
          style="border:1px solid var(--border-input);border-radius:5px;padding:3px 6px;font-size:12px;">
          <option ${(it.item_status||'사용')==='사용'?'selected':''}>사용</option>
          <option ${(it.item_status||'사용')==='폐기'?'selected':''}>폐기</option>
        </select>
      </td>
      <td style="text-align:center;">
        <button onclick="deleteItem('${escHtml(it.item_code)}')"
          style="background:none;border:none;cursor:pointer;color:#c0392b;font-size:16px;" title="삭제">🗑</button>
      </td>
    </tr>`;
  }).join('');
}

// 페이지네이션 버튼 렌더
function _renderItemPagination() {
  const wrap = document.getElementById('itemPagination');
  if (!wrap) return;

  const total     = _itemFiltered.length;
  const totalPages = Math.ceil(total / ITEM_PAGE_SIZE);

  if (totalPages <= 1) { wrap.innerHTML = ''; return; }

  const cur = _itemCurrentPage;
  const btnStyle = (active) =>
    `style="padding:5px 11px;border-radius:5px;border:1px solid ${active ? '#1a56db' : 'var(--border)'};
     background:${active ? '#1a56db' : '#fff'};color:${active ? '#fff' : 'var(--text-primary)'};
     font-size:12px;font-weight:${active ? '700' : '400'};cursor:pointer;"`;

  // 표시할 페이지 범위 계산 (현재 페이지 기준 최대 10개)
  const half = 5;
  let rangeStart = Math.max(1, cur - half);
  let rangeEnd   = Math.min(totalPages, rangeStart + 9);
  if (rangeEnd - rangeStart < 9) rangeStart = Math.max(1, rangeEnd - 9);
  const pages = [];
  for (let p = rangeStart; p <= rangeEnd; p++) pages.push(p);

  let html = '';
  // 이전
  html += `<button onclick="_renderItemPage(${cur - 1});_renderItemPagination()"
    ${cur === 1 ? 'disabled' : ''} ${btnStyle(false)}>‹</button>`;
  // 첫 페이지
  if (pages[0] > 1) {
    html += `<button onclick="_renderItemPage(1);_renderItemPagination()" ${btnStyle(false)}>1</button>`;
    if (pages[0] > 2) html += `<span style="padding:0 4px;color:var(--text-muted);">…</span>`;
  }
  // 페이지 번호 (최대 10개)
  pages.forEach(p => {
    html += `<button onclick="_renderItemPage(${p});_renderItemPagination()" ${btnStyle(p === cur)}>${p}</button>`;
  });
  // 마지막 페이지
  if (pages[pages.length - 1] < totalPages) {
    if (pages[pages.length - 1] < totalPages - 1) html += `<span style="padding:0 4px;color:var(--text-muted);">…</span>`;
    html += `<button onclick="_renderItemPage(${totalPages});_renderItemPagination()" ${btnStyle(false)}>${totalPages}</button>`;
  }
  // 다음
  html += `<button onclick="_renderItemPage(${cur + 1});_renderItemPagination()"
    ${cur === totalPages ? 'disabled' : ''} ${btnStyle(false)}>›</button>`;

  // 페이지 정보 (별도 줄)
  const start = (cur - 1) * ITEM_PAGE_SIZE + 1;
  const end   = Math.min(cur * ITEM_PAGE_SIZE, total);
  html = `<div style="display:flex;align-items:center;justify-content:center;gap:3px;flex-wrap:nowrap;">${html}</div>`
       + `<div style="width:100%;text-align:center;font-size:12px;color:var(--text-muted);margin-top:4px;">${start}–${end} / ${total}건</div>`;

  wrap.innerHTML = html;
}

function itemStatusEdit(sel) {
  const code = sel.dataset.code;
  const it   = App.items.find(i => i.item_code === code);
  if (it) { it.item_status = sel.value; App.itemsDirty = true; }
}

function deleteItem(code) {
  App.items = App.items.filter(i => i.item_code !== code);
  App.itemsDirty = true;
  renderItemTable();
}

async function saveItems() {
  if (!App.canEdit) { showMessage('저장 권한이 없습니다.', 'error'); return; }
  const btn = document.getElementById('btnSaveItems');
  btn.disabled = true; btn.textContent = '저장 중...';
  try {
    showGlobalLoading('자재코드 저장 중...');
    const user = window.auth?.getSession?.();
    await apiPost('closingSaveItems', {
      request_user_email: user?.email,
      items: App.items,
    });
    App.itemsDirty = false;
    showMessage(`자재코드 ${App.items.length}건이 저장됐습니다.`, 'success');
    btn.textContent = '✓ 저장됨';
    setTimeout(() => { btn.textContent = '💾 저장'; btn.disabled = false; }, 2000);
  } catch (e) {
    showMessage('저장 중 오류: ' + e.message, 'error');
    btn.textContent = '💾 저장'; btn.disabled = false;
  } finally {
    await hideGlobalLoading();
  }
}

// ── 자재관리 파일 업로드 ──────────────────────────────────
let _uploadedItemRows = [];

async function handleItemExcel(input) {
  const file = input.files?.[0];
  if (!file) return;
  input.value = '';
  try {
    showGlobalLoading('자재관리 파일 분석 중...');
    _uploadedItemRows = await parseItemExcel(file);
    renderItemUploadPreview(_uploadedItemRows);
  } catch (err) {
    showMessage('파일 읽기 오류: ' + err.message, 'error');
  } finally {
    await hideGlobalLoading();
  }
}

function parseItemExcel(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb  = XLSX.read(e.target.result, { type: 'array' });
        const ws  = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json(ws, { defval: '' });
        if (!raw.length) { reject(new Error('데이터가 없습니다.')); return; }

        const rows = raw.map((r, idx) => {
          const errors = [];
          const code = String(r['자재코드'] || '').trim();
          const name = String(r['자재명']   || '').trim();
          const type = String(r['구분']     || '').trim();
          if (!code) errors.push('자재코드 누락');
          if (!name) errors.push('자재명 누락');
          if (!['시약','소모품','의약품'].includes(type)) errors.push(`구분 오류(${type||'없음'})`);
          const toPrice = v => {
            const n = parseFloat(String(v || '').replace(/,/g, ''));
            return isNaN(n) ? 0 : n;
          };
          return {
            _row: idx + 2, _errors: errors,
            item_code:      code,
            item_name:      name,
            item_type:      type,
            item_status:    String(r['상태'] || '사용').trim(),
            purchase_price: toPrice(r['입고단가']),
            calc_price:     toPrice(r['산출단가']),
          };
        });
        resolve(rows);
      } catch (err) {
        reject(new Error('파일을 읽지 못했습니다: ' + err.message));
      }
    };
    reader.onerror = () => reject(new Error('파일을 읽지 못했습니다.'));
    reader.readAsArrayBuffer(file);
  });
}

function renderItemUploadPreview(rows) {
  const preview  = document.getElementById('itemUploadPreview');
  const table    = document.getElementById('itemUploadTable');
  const countEl  = document.getElementById('itemUploadCount');
  const errorEl  = document.getElementById('itemUploadError');
  const statEl   = document.getElementById('itemUploadStat');
  const applyBtn = document.getElementById('btnApplyItemUpload');
  if (!preview || !table) return;

  const existingMap = {};
  App.items.forEach(it => { existingMap[it.item_code] = true; });

  const errRows  = rows.filter(r => r._errors.length > 0);
  const newCount = rows.filter(r => !r._errors.length && !existingMap[r.item_code]).length;
  const updCount = rows.filter(r => !r._errors.length &&  existingMap[r.item_code]).length;

  countEl.textContent = `총 ${rows.length}건 (신규 ${newCount} / 업데이트 ${updCount})`;
  errorEl.textContent = errRows.length ? `오류 ${errRows.length}건` : '';
  if (statEl) {
    const valid = rows.filter(r => !r._errors.length);
    statEl.textContent =
      `시약 ${valid.filter(r=>r.item_type==='시약').length} · ` +
      `소모품 ${valid.filter(r=>r.item_type==='소모품').length} · ` +
      `의약품 ${valid.filter(r=>r.item_type==='의약품').length}`;
  }
  if (applyBtn) applyBtn.style.display = errRows.length ? 'none' : '';

  const show = rows.slice(0, 20);
  const thead = `<thead><tr><th>자재코드</th><th>자재명</th><th>구분</th><th>상태</th><th>구분</th><th>검증</th></tr></thead>`;
  const tbody = `<tbody>${show.map(r => {
    const hasErr = r._errors.length > 0;
    const isNew  = !existingMap[r.item_code];
    const badge  = hasErr ? '' : isNew
      ? `<span style="background:#e8effd;color:#1a56db;font-size:11px;font-weight:700;padding:2px 7px;border-radius:4px;">신규</span>`
      : `<span style="background:#f0fdf4;color:#0e7c3a;font-size:11px;font-weight:700;padding:2px 7px;border-radius:4px;">업데이트</span>`;
    return `<tr style="${hasErr?'background:#fff5f5;':''}">
      <td style="font-family:monospace;font-size:12px;">${escHtml(r.item_code)}</td>
      <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;">${escHtml(r.item_name)}</td>
      <td>${escHtml(r.item_type)}</td>
      <td>${escHtml(r.item_status)}</td>
      <td style="text-align:center;">${badge}</td>
      <td>${hasErr?`<span style="color:#c0392b;font-size:11px;">${escHtml(r._errors.join(', '))}</span>`:'✓'}</td>
    </tr>`;
  }).join('')}
  ${rows.length > 20 ? `<tr><td colspan="6" class="cl-preview more">외 ${rows.length-20}건 더 있음</td></tr>` : ''}
  </tbody>`;

  table.innerHTML = thead + tbody;
  preview.style.display = '';
  preview.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function applyItemUpload() {
  const validRows = _uploadedItemRows.filter(r => r._errors.length === 0);
  const existingMap = {};
  App.items.forEach(it => { existingMap[it.item_code] = it; });

  let updated = 0, added = 0;
  validRows.forEach(({ item_code, item_name, item_type, item_status, purchase_price, calc_price }) => {
    if (existingMap[item_code]) {
      existingMap[item_code] = { ...existingMap[item_code], item_name, item_type, item_status, purchase_price, calc_price };
      updated++;
    } else {
      existingMap[item_code] = { item_code, item_name, item_type, item_status, purchase_price, calc_price };
      added++;
    }
  });

  App.items = Object.values(existingMap);
  App.itemsDirty = true;
  cancelItemUpload();
  renderItemTable();

  const msg = [];
  if (updated) msg.push(`${updated}건 업데이트`);
  if (added)   msg.push(`${added}건 신규 추가`);
  showMessage(msg.join(', ') + ' 됐습니다. 저장 버튼을 눌러 반영하세요.', 'success');
}

function cancelItemUpload() {
  _uploadedItemRows = [];
  const preview = document.getElementById('itemUploadPreview');
  if (preview) preview.style.display = 'none';
}

// ═══════════════════════════════════════════════════════════
// 16. 초기 재고 업로드 (수불부 파일 → closing_stock 저장)
// ═══════════════════════════════════════════════════════════
let _stockInitWb     = null;  // 업로드된 워크북
let _stockInitParsed = [];    // 파싱된 기말 재고

// 탭 진입 시 지점 드롭다운 동기화
function initStockInitUI() {
  // 지점 드롭다운 → inputBranch와 동일 옵션
  const src = document.getElementById('inputBranch');
  const tgt = document.getElementById('stockInitBranch');
  if (src && tgt) {
    tgt.innerHTML = src.innerHTML;
    tgt.value     = src.value;
  }
  // 저장 연월 기본값: 전월
  const el = document.getElementById('stockInitYm');
  if (el && !el.value) {
    const now = new Date();
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    el.value = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
  }
}

// 수불부 파일 업로드 → 시트 목록 팝업
async function handleStockInitFile(input) {
  const file = input.files?.[0];
  if (!file) return;
  input.value = '';

  try {
    showGlobalLoading('수불부 파일 읽는 중...');
    const buf = await file.arrayBuffer();
    _stockInitWb = XLSX.read(buf, { type: 'array' });

    // 시트 목록 드롭다운 업데이트
    const sel = document.getElementById('stockInitSheet');
    sel.innerHTML = _stockInitWb.SheetNames.map((s, i) =>
      `<option value="${i}">${s}</option>`
    ).join('');

    // 첫 번째 시트 자동 파싱
    parseStockInitSheet(0);
  } catch (e) {
    showMessage('파일 읽기 오류: ' + e.message, 'error');
  } finally {
    await hideGlobalLoading();
  }

  // 시트 선택 변경 시 재파싱
  document.getElementById('stockInitSheet').onchange = function() {
    parseStockInitSheet(parseInt(this.value));
  };
}

// 특정 시트 파싱 → 기말 수량·금액 추출
function parseStockInitSheet(sheetIdx) {
  if (!_stockInitWb) return;
  const ws  = _stockInitWb.Sheets[_stockInitWb.SheetNames[sheetIdx]];
  const all = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  // 4행(index 4)부터 데이터, 0=품목코드, 1=품목명, 2=구분
  // 기말: 10=수량, 12=금액
  const rows = [];
  for (let i = 4; i < all.length; i++) {
    const row  = all[i];
    const code = String(row[0] || '').trim();
    if (!code || code === '총합계' || code === '누계') continue;

    const qty = parseFloat(String(row[10] || '0').replace(/,/g, '')) || 0;
    const amt = parseFloat(String(row[12] || '0').replace(/,/g, '')) || 0;

    // 기말 수량 또는 금액이 있는 품목만
    if (qty === 0 && amt === 0) continue;

    rows.push({
      item_code:      code,
      item_name:      String(row[1] || '').trim(),
      item_type:      String(row[2] || '').trim(),
      closing_qty:    qty,
      closing_amount: amt,
    });
  }

  _stockInitParsed = rows;
  renderStockInitPreview(rows);
}

function renderStockInitPreview(rows) {
  const preview = document.getElementById('stockInitPreview');
  const table   = document.getElementById('stockInitTable');
  const countEl = document.getElementById('stockInitCount');
  if (!preview || !table) return;

  countEl.textContent = `${rows.length}건`;

  if (!rows.length) {
    table.innerHTML = `<thead><tr><th colspan="5">기말 재고가 있는 품목이 없습니다.</th></tr></thead>`;
    preview.style.display = '';
    return;
  }

  const thead = `<thead><tr>
    <th>자재코드</th><th>자재명</th><th>구분</th>
    <th style="text-align:right;">기말 수량</th>
    <th style="text-align:right;">기말 금액</th>
  </tr></thead>`;
  const tbody = `<tbody>${rows.map((r, i) => `
    <tr style="${i % 2 ? 'background:#f8fafc;' : ''}">
      <td style="font-family:monospace;font-size:12px;">${escHtml(r.item_code)}</td>
      <td>${escHtml(r.item_name)}</td>
      <td style="text-align:center;">${escHtml(r.item_type)}</td>
      <td style="text-align:right;font-variant-numeric:tabular-nums;">${Math.round(r.closing_qty).toLocaleString()}</td>
      <td style="text-align:right;font-variant-numeric:tabular-nums;">${Math.round(r.closing_amount).toLocaleString()}</td>
    </tr>`).join('')}
  </tbody>`;

  table.innerHTML = thead + tbody;
  preview.style.display = '';
  preview.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function saveStockInit() {
  if (!_stockInitParsed.length) { showMessage('저장할 데이터가 없습니다.', 'error'); return; }

  const ym     = document.getElementById('stockInitYm')?.value;
  const branch = document.getElementById('stockInitBranch')?.value;
  if (!ym)     { showMessage('저장 연월을 선택해 주세요.', 'error'); return; }
  if (!branch) { showMessage('지점명을 선택해 주세요.', 'error'); return; }

  const btn = document.getElementById('btnSaveStockInit');

  try {
    showGlobalLoading(`${branch} ${ym} 초기 재고 저장 중...`);
    btn.disabled = true;

    // 기존 데이터 있는지 확인
    const user = window.auth?.getSession?.();
    const existing = await apiGet('closingGetStock', {
      request_user_email: user?.email,
      ym, branch,
    });
    await hideGlobalLoading();

    if (Array.isArray(existing.data) && existing.data.length > 0) {
      const ok = confirm(
        `${branch} ${ym} 확정 데이터가 이미 존재합니다.\n덮어쓰시겠습니까?`
      );
      if (!ok) { btn.disabled = false; return; }
    }

    showGlobalLoading('저장 중...');
    await apiPost('closingSaveStock', {
      request_user_email: user?.email,
      branch, ym,
      items: _stockInitParsed,
    });

    showMessage(`${branch} ${ym} 초기 재고 ${_stockInitParsed.length}건이 저장됐습니다.`, 'success');
    cancelStockInit();
  } catch (e) {
    showMessage('저장 중 오류: ' + e.message, 'error');
  } finally {
    await hideGlobalLoading();
    btn.disabled = false;
  }
}

function cancelStockInit() {
  _stockInitWb     = null;
  _stockInitParsed = [];
  const preview = document.getElementById('stockInitPreview');
  if (preview) preview.style.display = 'none';
  const sel = document.getElementById('stockInitSheet');
  if (sel) sel.innerHTML = '<option value="">파일 업로드 후 선택</option>';
  const fi = document.getElementById('stockInitFileInput');
  if (fi) fi.value = '';
}

// ═══════════════════════════════════════════════════════════
// 연간 원재료비 초기 데이터 업로드
// ═══════════════════════════════════════════════════════════
let _usageInitParsed = [];
let _usageInitReportType = '';

function initUsageInitUI() {
  // 지점 드롭다운 동기화
  const src = document.getElementById('inputBranch');
  const tgt = document.getElementById('usageInitBranch');
  if (src && tgt) { tgt.innerHTML = src.innerHTML; tgt.value = src.value; }
}

async function handleUsageInitFile(input, reportType) {
  const file = input.files?.[0];
  if (!file) return;
  input.value = '';

  const branch = document.getElementById('usageInitBranch')?.value?.trim();
  if (!branch) { showMessage('지점명을 선택해 주세요.', 'error'); return; }

  try {
    showGlobalLoading('파일 분석 중...');
    _usageInitReportType = reportType;
    _usageInitParsed = await parseUsageInitFile(file, reportType);
    renderUsageInitPreview(_usageInitParsed);
  } catch (e) {
    showMessage('파일 읽기 오류: ' + e.message, 'error');
  } finally {
    await hideGlobalLoading();
  }
}

// GC케어: A열 납품처 병합 / 비고(P열,idx15)에 "부서명 - 자재구분"
// 아이메드: B열(idx1)=부서명, C열(idx2)=기초, D~O열(idx3~14)=1~12월, P열(idx15)=기말
function parseUsageInitFile(file, reportType) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' });
        const sheetName = wb.SheetNames.find(s =>
          s.includes('원재료비') && (s.includes('년도') || s.includes('연간'))
        ) || wb.SheetNames[wb.SheetNames.length - 1];

        const ws  = wb.Sheets[sheetName];
        const all = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

        // 셀값은 항상 원 단위로 저장됨 (단위표기와 무관)
        const unitMultiplier = 1;

        const rows = [];
        let currentYear = null;
        const months = ['01','02','03','04','05','06','07','08','09','10','11','12'];
        const SKIP = new Set(['구   분','구분','총  계','총    계','소  계','소 계','매  출','매   출','세포치료','특수의약품','납품처']);

        // 1패스: 연도별 마지막 데이터 월 파악 (실제 숫자값 기준)
        const lastMonByYear = {};
        let _scanYear = null;
        all.forEach(row => {
          const c0 = String(row[0]||'').trim();
          const c1 = String(row[1]||'').trim();
          const ymA = c0.match(/(\d{4})년도\s*원재료비/);
          const ymB = c1.match(/(\d{4})년도\s*원재료비/);
          if (ymA) { _scanYear = ymA[1]; return; }
          if (ymB) { _scanYear = ymB[1]; return; }
          if (!_scanYear) return;
          // 부서 데이터행: 헤더/스킵 행 제외
          const dept = c0 === '' ? c1 : c0;
          if (!dept || dept === '구   분' || dept === '매   출' || dept === '총    계') return;
          // 오프셋: c0 비어있으면 서울숲형(monthOff=3), 아니면 강북형(monthOff=2)
          const off = (!c0 || c0 === '') ? 3 : 2;
          months.forEach((mon, mi) => {
            const v = row[mi + off];
            if (v !== '' && v !== null && v !== undefined && !isNaN(Number(v)) && Number(v) !== 0) {
              if (!lastMonByYear[_scanYear] || mon > lastMonByYear[_scanYear])
                lastMonByYear[_scanYear] = mon;
            }
          });
        });

        all.forEach(row => {
          const col0 = String(row[0] || '').trim();
          const col1 = String(row[1] || '').trim();

          // 연도 블록 감지 — GC케어는 A열(idx0), 아이메드는 B열(idx1)
          const yearMatchA = col0.match(/(\d{4})년도\s*원재료비/);
          const yearMatchB = col1.match(/(\d{4})년도\s*원재료비/);
          if (yearMatchA) { currentYear = yearMatchA[1]; return; }
          if (yearMatchB) { currentYear = yearMatchB[1]; return; }
          if (!currentYear) return;

          if (reportType === 'GC케어') {
            if (SKIP.has(col0)) return;
            const bigo = String(row[15] || '').trim();
            if (!bigo || !bigo.includes(' - ')) return;
            const parts = bigo.split(' - ').map(s => s.trim());
            const dept = parts[0]; const itype = parts[1];
            if (!dept || !itype) return;
            const baseVal = (parseFloat(String(row[1]  || '').replace(/,/g, '')) || 0) * unitMultiplier;
            const endVal  = (parseFloat(String(row[14] || '').replace(/,/g, '')) || 0) * unitMultiplier;
            const lastMon = lastMonByYear[currentYear] || '12';
            months.forEach((mon, mi) => {
              const val = (parseFloat(String(row[mi + 2] || '').replace(/,/g, '')) || 0) * unitMultiplier;
              if (!val && mon !== '01' && mon !== lastMon) return;
              rows.push({ ym: `${currentYear}-${mon}`, dept, item_type: itype,
                usage_amount: Math.round(val),
                base_amount: mon === '01'    ? Math.round(baseVal) : 0,
                end_amount:  mon === lastMon ? Math.round(endVal)  : 0 });
            });
          } else {
            // 아이메드: A열(idx0)이 비어있으면 B열(idx1)=부서명 (서울숲 형식)
            //           A열(idx0)에 부서명이 있으면 그대로 사용 (강북 형식)
            const _col0Empty = !col0 || col0 === '';
            const rawDept  = _col0Empty ? col1 : col0;
            const baseIdx  = _col0Empty ? 2  : 1;
            const monthOff = _col0Empty ? 3  : 2;
            const endIdx   = _col0Empty ? 15 : 14;

            // 세포치료 / 특수의약품: A·B열 모두 비어있고 C열(idx2)에 라벨이 있는 행
            // (총    계 다음에 들어오는 강남의원 전용 항목)
            const col2 = String(row[2] || '').trim();
            if (!rawDept && (col2 === '세포치료' || col2 === '특수의약품')) {
              const lastMon = lastMonByYear[currentYear] || '12';
              months.forEach((mon, mi) => {
                const val = parseFloat(String(row[mi + 3] || '').replace(/,/g, '')) || 0;
                if (!val) return;
                rows.push({ ym: `${currentYear}-${mon}`, dept: col2, item_type: col2,
                  usage_amount: Math.round(val),
                  base_amount: 0,
                  end_amount:  0 });
              });
              return;
            }

            if (!rawDept || SKIP.has(rawDept)) return;
            const dept = rawDept
              .replace(/\s*-\s*/g, '(')
              .replace(/\s{2,}/g, ' ')
              .trim()
              .replace(/\(([^)]+)$/, '($1)')
              .replace(/([^)])$/, match =>
                match.includes('(') ? match + ')' : match);

            const _col2 = String(row[baseIdx] || '').trim();
            if (SKIP.has(_col2)) return;
            const baseVal = (parseFloat(String(row[baseIdx] || '').replace(/,/g, '')) || 0) * unitMultiplier;
            const endVal  = (parseFloat(String(row[endIdx]  || '').replace(/,/g, '')) || 0) * unitMultiplier;
            const lastMon = lastMonByYear[currentYear] || '12';
            months.forEach((mon, mi) => {
              const val = (parseFloat(String(row[mi + monthOff] || '').replace(/,/g, '')) || 0) * unitMultiplier;
              if (!val && mon !== '01' && mon !== lastMon) return;
              rows.push({ ym: `${currentYear}-${mon}`, dept, item_type: '의약품',
                usage_amount: Math.round(val),
                base_amount: mon === '01'    ? Math.round(baseVal) : 0,
                end_amount:  mon === lastMon ? Math.round(endVal)  : 0 });
            });
          }
        });

        if (!rows.length) {
          reject(new Error('데이터를 찾을 수 없습니다. 연간 원재료비 시트가 있는 파일인지 확인해 주세요.'));
          return;
        }
        resolve(rows);
      } catch (err) {
        reject(new Error('파일 읽기 실패: ' + err.message));
      }
    };
    reader.onerror = () => reject(new Error('파일을 읽지 못했습니다.'));
    reader.readAsArrayBuffer(file);
  });
}

function renderUsageInitPreview(rows) {
  const preview  = document.getElementById('usageInitPreview');
  const table    = document.getElementById('usageInitTable');
  const countEl  = document.getElementById('usageInitCount');
  if (!preview || !table) return;

  // 월별 요약
  const byYm = {};
  rows.forEach(r => {
    if (!byYm[r.ym]) byYm[r.ym] = {};
    const k = r.dept + ' - ' + r.item_type;
    byYm[r.ym][k] = (byYm[r.ym][k] || 0) + r.usage_amount;
  });

  const yms = Object.keys(byYm).sort();
  const deptKeys = [...new Set(rows.map(r => r.dept + ' - ' + r.item_type))].sort();

  countEl.textContent = `${yms.length}개월 / ${deptKeys.length}개 부서·구분`;

  // 파일 구분 표시
  const typeInfo = document.getElementById('usageInitTypeInfo');
  if (typeInfo) {
    const types = [...new Set(_usageInitParsed.map(r => r.item_type))].join(', ');
    const isGC   = types.includes('시약') || types.includes('소모품');
    const isImed = types.includes('의약품');
    const label  = isGC && isImed ? 'GC케어 + 아이메드' : isGC ? 'GC케어 (시약·소모품)' : '아이메드 (의약품)';
    typeInfo.textContent = `파일 구분: ${label}`;
  }

  const thead = `<thead><tr><th>연월</th>${deptKeys.map(k => `<th>${escHtml(k)}</th>`).join('')}</tr></thead>`;
  const tbody = `<tbody>${yms.map((ym, i) => `
    <tr style="${i % 2 ? 'background:#f8fafc;' : ''}">
      <td style="font-weight:600;">${ym}</td>
      ${deptKeys.map(k => `<td class="num">${Math.round(byYm[ym][k] || 0).toLocaleString()}</td>`).join('')}
    </tr>`).join('')}
  </tbody>`;

  table.innerHTML = thead + tbody;
  preview.style.display = '';
  preview.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function saveUsageInit() {
  if (!_usageInitParsed.length) { showMessage('저장할 데이터가 없습니다.', 'error'); return; }

  const year   = document.getElementById('usageInitYear')?.value?.trim();
  const branch = document.getElementById('usageInitBranch')?.value?.trim();
  const btn    = document.getElementById('btnSaveUsageInit');

  // 연월별로 그룹핑해서 저장
  const byYm = {};
  _usageInitParsed.forEach(r => {
    if (!byYm[r.ym]) byYm[r.ym] = [];
    byYm[r.ym].push({ dept: r.dept, item_type: r.item_type, usage_amount: r.usage_amount,
                      base_amount: r.base_amount || 0, end_amount: r.end_amount || 0 });
  });

  btn.disabled = true;
  try {
    showGlobalLoading('데이터 저장 중...');
    const user = window.auth?.getSession?.();
    for (const ym of Object.keys(byYm).sort()) {
      await apiPost('closingSaveUsageMonthly', {
        request_user_email: user?.email,
        branch,
        ym,
        report_type: _usageInitReportType,
        items: byYm[ym],
      });
    }
    showMessage(`${Object.keys(byYm).length}개월 데이터가 저장됐습니다.`, 'success');
    cancelUsageInit();
  } catch (e) {
    showMessage('저장 중 오류: ' + e.message, 'error');
  } finally {
    await hideGlobalLoading();
    btn.disabled = false;
  }
}

function cancelUsageInit() {
  _usageInitParsed = [];
  _usageInitReportType = '';
  const preview = document.getElementById('usageInitPreview');
  if (preview) preview.style.display = 'none';
  ['usageInitFileInputGC','usageInitFileInputImed'].forEach(id => {
    const fi = document.getElementById(id);
    if (fi) fi.value = '';
  });
}

// ═══════════════════════════════════════════════════════════
// 마감 현황 탭
// ═══════════════════════════════════════════════════════════

let _historyInited = false;

async function initHistoryTab() {
  // 연도 셀렉트 초기화
  const yearSel = document.getElementById('historyYearSelect');
  if (yearSel && !yearSel.options.length) {
    const curYear = new Date().getFullYear();
    for (let y = curYear; y >= curYear - 3; y--) {
      const opt = document.createElement('option');
      opt.value = y; opt.textContent = y + '년';
      yearSel.appendChild(opt);
    }
  }

  // 지점 셀렉트 초기화 (입고 설정의 inputBranch와 동기)
  const branchSel = document.getElementById('historyBranchSelect');
  if (branchSel && !branchSel.options.length) {
    const srcSel = document.getElementById('inputBranch');
    if (srcSel) {
      Array.from(srcSel.options).forEach(o => {
        const opt = document.createElement('option');
        opt.value = o.value; opt.textContent = o.textContent;
        branchSel.appendChild(opt);
      });
      branchSel.value = srcSel.value;
    }
  }

  await loadClosingHistory();
}

async function loadClosingHistory() {
  const yearSel   = document.getElementById('historyYearSelect');
  const branchSel = document.getElementById('historyBranchSelect');
  const wrap      = document.getElementById('historyTableWrap');
  if (!yearSel || !branchSel || !wrap) return;

  const year   = yearSel.value;
  const branch = branchSel.value;
  if (!year || !branch) return;

  try {
    showGlobalLoading('마감 현황 로드 중...');

    // 카드 영역 스켈레톤 표시
    const wrap = document.getElementById('historyTableWrap');
    if (wrap) {
      wrap.innerHTML = `<div class="hist-grid">${Array(12).fill(0).map(() => `
        <div class="hist-card hist-card--skeleton">
          <div class="skel skel--title"></div>
          <div class="skel skel--badge"></div>
          <div class="skel skel--text"></div>
        </div>`).join('')}</div>`;
    }

    const user = window.auth?.getSession?.();

    const [stockRes, usageRes] = await Promise.all([
      apiGet('closingGetStock',        { request_user_email: user?.email, year, branch }),
      apiGet('closingGetUsageMonthly', { request_user_email: user?.email, year, branch }),
    ]);
    const stockData = Array.isArray(stockRes.data) ? stockRes.data : [];
    const usageData = Array.isArray(usageRes.data) ? usageRes.data : [];

    renderHistoryTable(year, branch, stockData, usageData);
  } catch (e) {
    wrap.innerHTML = `<div style="text-align:center;color:#e74c3c;padding:40px;">로드 실패: ${e.message}</div>`;
  } finally {
    await hideGlobalLoading();
  }
}

function renderHistoryTable(year, branch, stockData, usageData) {
  const wrap = document.getElementById('historyTableWrap');
  const months = ['01','02','03','04','05','06','07','08','09','10','11','12'];
  const DELETABLE_FROM = '2026-05';

  const monthMap = {};
  months.forEach(m => { monthMap[m] = { confirmed_at: null, confirmed_by: null }; });

  stockData.forEach(s => {
    const mon = String(s.ym || '').split('-')[1];
    if (!mon || !monthMap[mon]) return;
    if (!monthMap[mon].confirmed_at && s.confirmed_at) {
      monthMap[mon].confirmed_at = s.confirmed_at;
      monthMap[mon].confirmed_by = s.confirmed_by;
    }
  });

  const fmtDate = v => {
    if (!v) return '-';
    const s = String(v);
    // "Mon Jun 08 2026" → "2026-06-08" 형태로 변환 시도
    const d = new Date(s);
    if (!isNaN(d)) return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;
    return s.length > 10 ? s.slice(0, 10) : s;
  };

  const cards = months.map(m => {
    const d    = monthMap[m];
    const done = !!d.confirmed_at;
    const ym   = `${year}-${m}`;
    const canDelete = done && ym >= DELETABLE_FROM && App.canEdit;
    const mon  = parseInt(m);

    if (done) {
      return `
        <div class="hist-card hist-card--done">
          <div class="hist-card__top">
            <div class="hist-card__month">${mon}월</div>
            ${canDelete ? `<button class="hist-card__del" onclick="deleteClosing('${year}','${m}','${branch}')">🗑</button>` : ''}
          </div>
          <div class="hist-card__badge hist-card__badge--done">✓ 확정</div>
          <div class="hist-card__meta">
            <span class="hist-card__date">${fmtDate(d.confirmed_at)}</span>
            <span class="hist-card__by">${d.confirmed_by || ''}</span>
          </div>
        </div>`;
    } else {
      return `
        <div class="hist-card hist-card--none">
          <div class="hist-card__top">
            <div class="hist-card__month">${mon}월</div>
          </div>
          <div class="hist-card__badge hist-card__badge--none">미완료</div>
        </div>`;
    }
  }).join('');

  wrap.innerHTML = `<div class="hist-grid">${cards}</div>`;
}

async function deleteClosing(year, mon, branch) {
  const ym = `${year}-${mon}`;
  if (!confirm(`${year}년 ${parseInt(mon)}월 ${branch} 마감 데이터를 삭제하시겠습니까?\n\n이 작업은 되돌릴 수 없습니다.`)) return;
  try {
    showGlobalLoading('마감 데이터 삭제 중...');
    const user = window.auth?.getSession?.();
    await apiPost('closingDeleteData', {
      request_user_email: user?.email,
      ym, branch,
    });
    showMessage(`${year}년 ${parseInt(mon)}월 마감 데이터가 삭제됐습니다.`, 'success');
    await loadClosingHistory();
  } catch (e) {
    showMessage('삭제 실패: ' + e.message, 'error');
  } finally {
    await hideGlobalLoading();
  }
}
