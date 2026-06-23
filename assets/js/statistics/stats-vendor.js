/**
 * stats-vendor.js
 * 거래처 마스터 관리 — closing-admin.js의 거래처 관리 로직을 통계 페이지에서 재사용
 * 동일한 GAS 액션(closingGetVendors / closingSaveVendors)을 호출하므로
 * 월마감 모듈과 거래처 데이터를 완전히 공유합니다.
 */

'use strict';

// StatsApp에 거래처 관련 상태 추가 (StatsApp 자체는 stats-main.js에서 선언됨)
window.StatsApp = window.StatsApp || {};
StatsApp.vendors = [];
StatsApp.vendorsDirty = false;

async function loadVendorsFromServer() {
  try {
    const user = window.auth?.getSession?.();
    const res  = await apiGet('closingGetVendors', { request_user_email: user?.email });
    StatsApp.vendors = Array.isArray(res.data) ? res.data : [];
  } catch (e) {
    StatsApp.vendors = [];
  }
}

function renderVendorTable() {
  const tbody = document.getElementById('vendorTbody');
  if (!tbody) return;

  if (!StatsApp.vendors.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--text-muted);">등록된 거래처가 없습니다. [+ 행 추가] 또는 [엑셀 업로드]를 이용하세요.</td></tr>`;
    return;
  }

  // 사업자번호별 그룹 크기 계산 (2개 이상인 그룹만 대표 선택 라디오가 의미 있음)
  const bizNoCounts = {};
  StatsApp.vendors.forEach(v => {
    const biz = (v.biz_no || '').trim();
    if (biz) bizNoCounts[biz] = (bizNoCounts[biz] || 0) + 1;
  });

  tbody.innerHTML = StatsApp.vendors.map((v, i) => {
    const biz = (v.biz_no || '').trim();
    const groupSize = biz ? (bizNoCounts[biz] || 0) : 0;
    let currentCell;
    if (groupSize >= 2) {
      currentCell = `<input type="radio" name="vendorCurrent_${vendorEscHtml(biz)}" data-idx="${i}" ${v.is_current ? 'checked' : ''} onchange="vendorSetCurrent(${i})" title="이 사업자번호의 현재 사용 명칭으로 지정">`;
    } else {
      // 사업자번호가 비어있거나 그룹에 거래처가 하나뿐이면 대표 지정이 필요 없음
      currentCell = `<span style="color:#d1d5db;" title="동일 사업자번호 거래처가 2개 이상일 때만 선택 가능">—</span>`;
    }
    return `
    <tr>
      <td><input type="text" value="${vendorEscHtml(v.vendor_name || '')}" data-idx="${i}" data-field="vendor_name" onchange="vendorEdit(this)"></td>
      <td><input type="text" value="${vendorEscHtml(v.biz_no || '')}" data-idx="${i}" data-field="biz_no" onchange="vendorEdit(this)"></td>
      <td style="text-align:center;">${currentCell}</td>
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
  `;
  }).join('');
}

// 사업자번호가 같은 그룹 내에서 대표(현재 사용 명칭)를 하나로만 지정
function vendorSetCurrent(idx) {
  const biz = (StatsApp.vendors[idx].biz_no || '').trim();
  StatsApp.vendors.forEach(v => {
    if ((v.biz_no || '').trim() === biz) v.is_current = false;
  });
  StatsApp.vendors[idx].is_current = true;
  StatsApp.vendorsDirty = true;
}

function vendorEscHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function vendorEdit(el) {
  const idx   = parseInt(el.dataset.idx);
  const field = el.dataset.field;
  const val   = field === 'credit_days' ? (parseInt(el.value) || 0) : el.value;
  StatsApp.vendors[idx][field] = val;
  StatsApp.vendorsDirty = true;
  // 사업자번호가 바뀌면 그룹 구성이 달라지므로 대표 선택 UI를 다시 그려야 함
  if (field === 'biz_no') renderVendorTable();
}

function addVendorRow() {
  StatsApp.vendors.push({ vendor_name: '', biz_no: '', credit_days: 90, pay_method: '현금결제', is_current: true });
  StatsApp.vendorsDirty = true;
  renderVendorTable();
  const lastRow = document.getElementById('vendorTbody').lastElementChild;
  lastRow?.querySelector('input')?.focus();
}

function downloadVendorTemplate() {
  const wb = XLSX.utils.book_new();
  const headers = ['거래처명 *', '사업자등록번호 *', '여신기간(일)', '결제방법'];
  const sample  = [
    ['GC메디아이', '2018155688', 90, '현금결제'],
    ['녹십자MS(주)', '1358167475', 90, '현금결제'],
  ];
  const ws = XLSX.utils.aoa_to_sheet([headers, ...sample]);
  ws['!cols'] = [{ wch: 28 }, { wch: 18 }, { wch: 14 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, ws, '거래처마스터');
  XLSX.writeFile(wb, '거래처마스터_템플릿.xlsx');
}

let _statsUploadedVendorRows = [];

async function handleVendorExcel(input) {
  const file = input.files?.[0];
  if (!file) return;
  input.value = '';

  try {
    showGlobalLoading('파일을 분석하는 중...');
    _statsUploadedVendorRows = await parseVendorExcel(file);
    renderVendorUploadPreview(_statsUploadedVendorRows);
  } catch (err) {
    showMessage(err.message || '파일 읽기 오류', 'error');
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

  const existingMap = {};
  StatsApp.vendors.forEach(v => { existingMap[v.vendor_name] = true; });

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
      <td>${vendorEscHtml(r.vendor_name)}</td>
      <td>${vendorEscHtml(r.biz_no)}</td>
      <td class="num">${r.credit_days}</td>
      <td>${vendorEscHtml(r.pay_method)}</td>
      <td style="text-align:center;">${badge}</td>
      <td>${hasErr ? `<span style="color:#c0392b;font-size:11px;">${vendorEscHtml(r._errors.join(', '))}</span>` : '✓'}</td>
    </tr>`;
  }).join('')}</tbody>`;

  table.innerHTML = thead + tbody;
  preview.style.display = '';
  preview.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function applyVendorUpload() {
  const validRows = _statsUploadedVendorRows.filter(r => r._errors.length === 0);

  const existingMap = {};
  StatsApp.vendors.forEach(v => { existingMap[v.vendor_name] = v; });

  let updated = 0, added = 0;

  validRows.forEach(({ vendor_name, biz_no, credit_days, pay_method }) => {
    if (existingMap[vendor_name]) {
      existingMap[vendor_name] = { ...existingMap[vendor_name], biz_no, credit_days, pay_method };
      updated++;
    } else {
      existingMap[vendor_name] = { vendor_name, biz_no, credit_days, pay_method };
      added++;
    }
  });

  StatsApp.vendors = Object.values(existingMap);
  StatsApp.vendorsDirty = true;
  cancelVendorUpload();
  renderVendorTable();

  const msg = [];
  if (updated) msg.push(`${updated}건 업데이트`);
  if (added)   msg.push(`${added}건 신규 추가`);
  showMessage(msg.join(', ') + ' 됐습니다. 저장 버튼을 눌러 반영하세요.', 'success');
}

function cancelVendorUpload() {
  _statsUploadedVendorRows = [];
  const preview = document.getElementById('vendorUploadPreview');
  if (preview) preview.style.display = 'none';
}

function deleteVendor(i) {
  StatsApp.vendors.splice(i, 1);
  StatsApp.vendorsDirty = true;
  renderVendorTable();
}

async function saveVendors() {
  if (!StatsApp.canEdit) { showMessage('저장 권한이 없습니다. (edit 이상 필요)', 'error'); return; }

  const btn = document.getElementById('btnSaveVendors');
  btn.disabled = true;
  btn.textContent = '저장 중...';

  try {
    showGlobalLoading('거래처 정보 저장 중...');
    const user = window.auth?.getSession?.();
    await apiPost('closingSaveVendors', {
      request_user_email: user?.email,
      vendors: StatsApp.vendors,
    });
    StatsApp.vendorsDirty = false;
    showMessage('거래처 정보가 저장됐습니다.', 'success');
    btn.textContent = '✓ 저장됨';
    if (typeof populateVendorDatalist === 'function') populateVendorDatalist();
    setTimeout(() => { btn.textContent = '💾 저장'; btn.disabled = false; }, 2000);
  } catch (e) {
    showMessage('저장 중 오류: ' + e.message, 'error');
    btn.textContent = '💾 저장';
    btn.disabled = false;
  } finally {
    await hideGlobalLoading();
  }
}

// ── 기존 업로드 데이터의 사업자번호 일회성 재매핑 ──────────────
// 거래처명을 마스터에 추가/수정한 뒤, 이미 Supabase에 저장된 행에도 반영하기 위함
async function backfillVendorBizNo() {
  if (!StatsApp.canEdit) { showMessage('실행 권한이 없습니다. (edit 이상 필요)', 'error'); return; }

  const btn = document.getElementById('btnBackfillBizNo');
  const resultEl = document.getElementById('backfillResult');
  if (!confirm('이미 업로드된 입고/사용현황 데이터 중 사업자번호가 비어있는 행을\n현재 거래처 마스터 기준으로 다시 매핑합니다.\n계속하시겠습니까?')) return;

  btn.disabled = true;
  resultEl.innerHTML = '<span style="color:var(--text-muted);">처리 중...</span>';

  try {
    showGlobalLoading('사업자번호를 재매핑하는 중...');
    const user = window.auth?.getSession?.();
    const res = await apiPost('backfillVendorBizNo', { request_user_email: user?.email });

    const { purchaseUpdated, usageUpdated, stillUnmatched } = res.data || {};
    let html = `<span style="color:#2fa36b;">✓ 입고 ${purchaseUpdated ?? 0}건, 사용현황 ${usageUpdated ?? 0}건 업데이트됐습니다.</span>`;
    if (stillUnmatched && stillUnmatched.length) {
      html += `<br><span style="color:#d97706;">⚠ 여전히 마스터에 없는 거래처: ${stillUnmatched.join(', ')}</span>`;
    }
    resultEl.innerHTML = html;
  } catch (e) {
    resultEl.innerHTML = `<span style="color:#c0392b;">오류: ${e.message}</span>`;
  } finally {
    btn.disabled = false;
    await hideGlobalLoading();
  }
}

// 거래처 탭이 처음 열릴 때만 서버에서 로드 (탭 전환마다 재요청하지 않도록)
let _vendorTabLoaded = false;
async function ensureVendorTabLoaded() {
  if (_vendorTabLoaded) return;
  _vendorTabLoaded = true;
  try {
    showGlobalLoading('거래처 정보를 불러오는 중...');
    await loadVendorsFromServer();
    renderVendorTable();
  } finally {
    await hideGlobalLoading();
  }
}
