/**
 * closing.js
 * GC녹십자아이메드 월마감 자동화 앱
 *
 * 기능
 *  - Raw 입고 / 사용현황 엑셀 업로드 → GC케어 / 아이메드 자동 분류
 *  - 산출물 6종 엑셀 다운로드 (ExcelJS 서식 완전 적용)
 *  - 거래처 마스터 관리 (API 연동 → 서버 저장)
 */

'use strict';

// ═══════════════════════════════════════════════════════════
// 0. 진입점
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  try {
    showGlobalLoading('월마감 앱 초기화 중...');

    // 로그인 체크
    const user = window.auth?.getSession?.();
    if (!user) { location.replace(`${CONFIG.SITE_BASE_URL}/index.html`); return; }

    // 로그아웃
    document.getElementById('logoutBtn')?.addEventListener('click', () => {
      window.auth?.logout?.();
      location.replace(`${CONFIG.SITE_BASE_URL}/index.html`);
    });

    // 마감월 초기값: 전월 자동 설정
    const now = new Date();
    const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const yy = prevMonth.getFullYear();
    const mm = String(prevMonth.getMonth() + 1).padStart(2, '0');
    document.getElementById('inputMonth').value = `${yy}-${mm}`;

    // 지점명 드롭다운: ORG_CLINIC 로드 후 소속 의원 기본 선택
    await loadBranchOptions(user);

    // 권한 체크 (closing: view 이상)
    const ok = await window.appPermission?.requirePermission?.('closing', ['admin', 'edit', 'view']);
    if (ok === false) {
      document.getElementById('permissionDenied').style.display = '';
      return;
    }

    // 관리자 여부 저장
    const isAdmin = String(user?.role || '').trim().toLowerCase() === 'admin';
    const editPerm = await window.appPermission?.getPermission?.('closing');
    App.canEdit = isAdmin || ['admin', 'edit'].includes(editPerm);

    document.getElementById('appBody').style.display = '';

    // 모바일에서 자재코드 탭 자동 활성화
    if (window.innerWidth <= 768) {
      switchTab('item');
    }

    // 해상도 변화 감지
    const mobileQuery = window.matchMedia('(max-width: 768px)');
    mobileQuery.addEventListener('change', e => {
      if (e.matches) switchTab('item');
    });

    // 거래처·자재 데이터 로드 (처리 시작 전 반드시 완료되어야 함, 최대 10초)
    const timeout = ms => new Promise(r => setTimeout(r, ms));
    await Promise.all([
      Promise.race([loadVendorsFromServer(), timeout(10000)]).catch(() => {}),
      Promise.race([loadItemsFromServer(),   timeout(10000)]).catch(() => {}),
      Promise.race([loadRoundModes(),        timeout(5000)]).catch(() => {}),
    ]);

  } catch (e) {
    showMessage('앱 초기화 중 오류가 발생했습니다: ' + e.message, 'error');
  } finally {
    await hideGlobalLoading();
  }
});

// ═══════════════════════════════════════════════════════════
// 1. 앱 상태
// ═══════════════════════════════════════════════════════════
const App = {
  canEdit: false,
  ipgoRaw: null,
  usageRaw: null,
  ipgoData: [],
  usageData: [],
  R: {},             // 처리 결과
  vendors: [],       // 거래처 마스터 (서버에서 로드)
  items: [],         // 자재코드 마스터 (서버에서 로드)
  vendorsDirty: false,
  itemsDirty: false,
};

// ═══════════════════════════════════════════════════════════
// 2. 탭 전환
// ═══════════════════════════════════════════════════════════
function switchTab(tab) {
  ['closing', 'vendor', 'item', 'history'].forEach(t => {
    document.getElementById(`tab${t.charAt(0).toUpperCase() + t.slice(1)}`)
      ?.classList.toggle('active', t === tab);
    document.getElementById(`tab${t.charAt(0).toUpperCase() + t.slice(1)}Content`)
      ?.classList.toggle('active', t === tab);
  });
  if (tab === 'vendor') {
    if (App.vendors.length) {
      renderVendorTable();
    } else {
      showGlobalLoading('거래처 정보 로드 중...');
      loadVendorsFromServer()
        .then(() => renderVendorTable())
        .finally(() => hideGlobalLoading());
    }
  }
  if (tab === 'history') {
    initHistoryTab();
  }
  if (tab === 'item') {
    if (App.items.length) {
      renderItemTable();
    } else {
      showGlobalLoading('자재코드 로드 중...');
      loadItemsFromServer()
        .then(() => renderItemTable())
        .finally(() => hideGlobalLoading());
    }
    initStockInitUI();
    initUsageInitUI();
  }
}

// ═══════════════════════════════════════════════════════════
// 3. 파일 업로드
// ═══════════════════════════════════════════════════════════
function dragOver(e, id) { e.preventDefault(); document.getElementById(id).classList.add('dragover'); }
function dragLeave(id)   { document.getElementById(id).classList.remove('dragover'); }
function dropFile(e, type) {
  e.preventDefault();
  document.getElementById('zone-' + type).classList.remove('dragover');
  if (e.dataTransfer.files[0]) processFile(e.dataTransfer.files[0], type);
}
function handleFile(input, type) {
  if (input.files[0]) processFile(input.files[0], type);
}
function processFile(file, type) {
  const reader = new FileReader();
  reader.onload = e => {
    const wb = XLSX.read(e.target.result, { type: 'array' });

    try {
      validateClosingFileHeaders_(wb, type);
    } catch (err) {
      clog(err.message, 'error');
      alert(err.message);
      document.getElementById('zone-' + type).classList.remove('uploaded');
      document.getElementById('status-' + type).textContent = '';
      return;
    }

    App[type + 'Raw'] = { wb, name: file.name };
    document.getElementById('zone-' + type).classList.add('uploaded');
    document.getElementById('status-' + type).textContent = '✓ ' + file.name;
    if (App.ipgoRaw && App.usageRaw) {
      document.getElementById('btnNext1').disabled = false;
    }
  };
  reader.readAsArrayBuffer(file);
}

// ═══════════════════════════════════════════════════════════
// 4. 스텝 내비게이션
// ═══════════════════════════════════════════════════════════
function goStep(n) {
  [1, 2, 3, 4].forEach(i => {
    document.getElementById('sec' + i)?.classList.toggle('active', i === n);
    const el = document.getElementById('step' + i);
    if (!el) return;
    el.classList.remove('active', 'done');
    if (i < n) el.classList.add('done');
    else if (i === n) el.classList.add('active');
    el.querySelector('.cl-step-num').textContent = i < n ? '✓' : i;
  });
}
function startProcessing() {
  goStep(3);
  // 버튼 초기화
  const btnGo = document.getElementById('btnGoResult');
  if (btnGo) {
    btnGo.disabled = true;
    btnGo.style.opacity = '0.4';
    btnGo.style.cursor = 'not-allowed';
    btnGo.style.background = '';
    btnGo.textContent = '산출물 확인 →';
  }
  setTimeout(runProcessing, 200);
}

// ═══════════════════════════════════════════════════════════
// 5. 로그 / 진행
// ═══════════════════════════════════════════════════════════
function clog(msg, cls = 'info') {
  const box = document.getElementById('logBox');
  if (!box) return;
  const t = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  box.innerHTML += `<div class="cl-log-line ${cls}"><span class="cl-log-time">[${t}]</span>${msg}</div>`;
  box.scrollTop = box.scrollHeight;
}
function prog(pct, label) {
  document.getElementById('progressFill').style.width = pct + '%';
  document.getElementById('progressPct').textContent = pct + '%';
  document.getElementById('progressLabel').textContent = label;
}
// 속도 개선 점검(2026-06) — 아래 sleep 호출들은 파싱/집계 같은 클라이언트
// 동기 연산 사이에 진행률 단계 전환을 보여주기 위한 순수 UX 장식이었음
// (실제 처리 시간과 무관). 원래 150~300ms씩 박혀 있어 화면 하나에서만
// 2초 이상 순수 대기가 발생했던 것을 발견, 단계 전환은 느껴지되 체감
// 지연은 거의 없는 수준(20ms)으로 축소.
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ═══════════════════════════════════════════════════════════
// 6. 파싱
// ═══════════════════════════════════════════════════════════
function toN(v) { const n = parseFloat(String(v || 0).replace(/,/g, '')); return isNaN(n) ? 0 : n; }
const sumF = (arr, k) => arr.reduce((s, r) => s + toN(r[k]), 0);

// ── 파일 헤더 검증: 입고/사용현황 영역에 잘못된 파일이 올라왔는지 확인 ──
const IPGO_REQUIRED_HEADERS  = ['공급업체', '자재구분', '자재명', '공급가액', '부가세', '합계금액'];
const USAGE_REQUIRED_HEADERS = ['부서명', '자재구분', '자재명', '사용공급가', '사용부가세', '사용합계'];

function findHeaderRow_(all, markers) {
  for (let i = 0; i < all.length; i++) {
    const row = all[i].map(v => String(v || '').trim());
    if (markers.some(m => row.includes(m))) return i;
  }
  return -1;
}

function validateClosingFileHeaders_(wb, expectedType) {
  const requiredHeaders = expectedType === 'ipgo' ? IPGO_REQUIRED_HEADERS : USAGE_REQUIRED_HEADERS;
  const otherHeaders    = expectedType === 'ipgo' ? USAGE_REQUIRED_HEADERS : IPGO_REQUIRED_HEADERS;
  const expectedLabel = expectedType === 'ipgo' ? '입고' : '사용현황';
  const otherLabel     = expectedType === 'ipgo' ? '사용현황' : '입고';

  const ws = wb.Sheets[wb.SheetNames[0]];
  const all = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  if (!all.length) {
    throw new Error('파일에 데이터가 없습니다.');
  }

  // 헤더 행 위치를 자동 탐색 ('No.' 또는 '부서명' 마커 기준, 기존 parseIpgo/parseUsage와 동일 방식)
  const headerRowIdx = findHeaderRow_(all, ['No.', '부서명']);
  const headerRow = headerRowIdx >= 0
    ? all[headerRowIdx].map(v => String(v || '').trim())
    : all[0].map(v => String(v || '').trim());

  const missingRequired = requiredHeaders.filter(h => !headerRow.includes(h));
  const matchedOther    = otherHeaders.filter(h => headerRow.includes(h));

  if (missingRequired.length >= 3 && matchedOther.length >= 3) {
    throw new Error(
      `이 파일은 "${expectedLabel}" 파일 형식이 아니라 "${otherLabel}" 파일로 보입니다.\n` +
      `올바른 업로드 영역에 다시 올려주세요.`
    );
  }

  if (missingRequired.length > 0) {
    throw new Error(
      `"${expectedLabel}" 파일에 필요한 컬럼이 없습니다: ${missingRequired.join(', ')}\n` +
      `엑셀 파일의 헤더 행을 확인해주세요.`
    );
  }
}

function parseIpgo(wb) {
  const ws = wb.Sheets[wb.SheetNames[0]];
  const all = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  let hr = 0;
  for (let i = 0; i < all.length; i++) {
    if (String(all[i][0]).trim() === 'No.') { hr = i; break; }
  }
  const hdrs = all[hr].map(h => String(h).trim());
  const data = [];
  for (let i = hr + 1; i < all.length; i++) {
    const row = all[i];
    if (!String(row[0]).trim() || isNaN(parseInt(row[0]))) continue;
    const obj = {};
    hdrs.forEach((h, idx) => { obj[h] = row[idx]; });
    const t = String(obj['자재구분'] || '').trim();
    obj['구분'] = (t === '소모품' || t === '시약') ? 'GC케어' : '아이메드';
    data.push(obj);
  }
  return data;
}

function parseUsage(wb) {
  const ws = wb.Sheets[wb.SheetNames[0]];
  const all = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  let hr = 1;
  for (let i = 0; i < all.length; i++) {
    if (String(all[i][0]).trim() === '부서명' || String(all[i][1]).trim() === '부서명') { hr = i; break; }
  }
  const hdrs = all[hr].map(h => String(h).trim());
  // 자재코드 컬럼 인덱스 찾기
  const codeIdx = hdrs.findIndex(h => h === '자재코드');
  const data = [];
  for (let i = hr + 1; i < all.length; i++) {
    const row = all[i];
    const col0 = String(row[0] || '').trim();
    const col1 = String(row[1] || '').trim();
    // 빈 행 스킵
    if (!col0 && !col1) continue;
    // 합계 행 스킵: 자재코드가 없으면 합계/소계 행
    if (codeIdx >= 0 && !String(row[codeIdx] || '').trim()) continue;
    const obj = {};
    hdrs.forEach((h, idx) => { if (h) obj[h] = row[idx]; });
    data.push(obj);
  }
  return data;
}

// ═══════════════════════════════════════════════════════════
// 7. 집계 헬퍼
// ═══════════════════════════════════════════════════════════
function byVendor(data) {
  const m = {};
  data.forEach(r => {
    const v = String(r['공급업체'] || '').trim(); if (!v) return;
    if (!m[v]) m[v] = { 공급업체: v, 공급가액: 0, 부가세: 0, 합계금액: 0 };
    m[v].공급가액 += toN(r['공급가액']); m[v].부가세 += toN(r['부가세']); m[v].합계금액 += toN(r['합계금액']);
  });
  return Object.values(m).sort((a, b) => b.공급가액 - a.공급가액);
}
function byDeptIpgo(data) {
  const m = {};
  data.forEach(r => {
    const k = String(r['의뢰부서'] || '').trim() + '||' + String(r['자재구분'] || '').trim();
    if (!m[k]) m[k] = { 의뢰부서: String(r['의뢰부서'] || '').trim(), 자재구분: String(r['자재구분'] || '').trim(), 공급가액: 0, 부가세: 0, 합계금액: 0 };
    m[k].공급가액 += toN(r['공급가액']); m[k].부가세 += toN(r['부가세']); m[k].합계금액 += toN(r['합계금액']);
  });
  return Object.values(m);
}

// 입고 + 사용 데이터의 부서 합집합으로 구성 (입고 없는 부서도 포함)
function byDeptIpgoFull(ipgoData, usageData) {
  const m = {};

  // 사용 데이터에서 부서+자재구분 목록 확보 (금액 0으로 초기화)
  usageData.forEach(r => {
    const dept = String(r['부서명'] || '').trim();
    const type = String(r['자재구분'] || '').trim();
    if (!dept) return;
    const k = dept + '||' + type;
    if (!m[k]) m[k] = { 의뢰부서: dept, 자재구분: type, 공급가액: 0, 부가세: 0, 합계금액: 0 };
  });

  // 입고 데이터로 금액 채우기
  ipgoData.forEach(r => {
    const dept = String(r['의뢰부서'] || '').trim();
    const type = String(r['자재구분'] || '').trim();
    if (!dept) return;
    const k = dept + '||' + type;
    if (!m[k]) m[k] = { 의뢰부서: dept, 자재구분: type, 공급가액: 0, 부가세: 0, 합계금액: 0 };
    m[k].공급가액 += toN(r['공급가액']);
    m[k].부가세   += toN(r['부가세']);
    m[k].합계금액 += toN(r['합계금액']);
  });

  return Object.values(m);
}
function byDeptUsage(data) {
  const m = {};
  data.forEach(r => {
    const k = String(r['부서명'] || '').trim() + '||' + String(r['자재구분'] || '').trim();
    if (!m[k]) m[k] = { 부서명: String(r['부서명'] || '').trim(), 자재구분: String(r['자재구분'] || '').trim(), 사용공급가: 0, 사용부가세: 0, 사용합계: 0 };
    m[k].사용공급가 += toN(r['사용공급가']); m[k].사용부가세 += toN(r['사용부가세']); m[k].사용합계 += toN(r['사용합계']);
  });
  return Object.values(m);
}

// CLOSING_DEPT 마스터 기반으로 빠진 부서 보완
function fillMissingDepts(data, deptMaster, types) {
  const result = [...data];
  (deptMaster || []).forEach(d => {
    const deptName = String(d.code_name || '').trim();
    if (!deptName) return;
    (types || []).forEach(type => {
      const exists = result.find(x => x.부서명 === deptName && x.자재구분 === type);
      if (!exists) result.push({
        부서명: deptName, 자재구분: type,
        사용공급가: 0, 사용부가세: 0, 사용합계: 0,
        공5pct: 0, 부5pct: 0, 계5pct: 0,
      });
    });
  });
  return result;
}

// 5% 가산 요약: 행별 ROUNDUP 후 부서별 합산 (합산 후 ROUNDUP과 다름)
// roundFn: Math.ceil(ROUNDUP) 또는 Math.round(ROUND) — 의원별 설정
function byDeptUsage5pct(data, roundFn = Math.ceil) {
  const m = {};
  data.forEach(r => {
    const k = String(r['부서명'] || '').trim() + '||' + String(r['자재구분'] || '').trim();
    if (!m[k]) m[k] = { 부서명: String(r['부서명'] || '').trim(), 자재구분: String(r['자재구분'] || '').trim(), 사용공급가: 0, 사용부가세: 0, 사용합계: 0 };
    const sup5 = roundFn(toN(r['사용공급가']) * 1.05);
    const vat5 = roundFn(toN(r['사용부가세']) * 1.05);
    m[k].사용공급가 += sup5;
    m[k].사용부가세 += vat5;
    m[k].사용합계  += sup5 + vat5;
  });
  return Object.values(m);
}
function byItem(data, codeKey, nameKey, qtyKey, amtKey) {
  const m = {};
  data.forEach(r => {
    const code = String(r[codeKey] || '').trim(); if (!code) return;
    if (!m[code]) m[code] = { 코드: code, 명: String(r[nameKey] || ''), 구분: String(r['자재구분'] || ''), 수량: 0, 금액: 0 };
    m[code].수량 += toN(r[qtyKey]); m[code].금액 += toN(r[amtKey]);
  });
  return Object.values(m);
}

// ═══════════════════════════════════════════════════════════
// 8. 메인 처리
// ═══════════════════════════════════════════════════════════
async function runProcessing() {
  const branch  = document.getElementById('inputBranch').value.trim();
  const ym      = document.getElementById('inputMonth').value;

  if (!branch) {
    showMessage('의원을 선택해주세요.', 'error');
    goStep(2);
    return;
  }
  const [y, m]  = ym.split('-');
  const mi      = parseInt(m);
  const cc      = document.getElementById('inputCC').value.trim();
  const account = '11301101'; // 계정코드 고정값

  try {
    clog('처리를 시작합니다...', 'info'); await sleep(20);

    // 거래처/자재 로드가 안 된 경우 재시도 (초기화 타임아웃 대비)
    if (!App.vendors.length) {
      clog('거래처 정보 재로드 중...', 'info');
      await loadVendorsFromServer().catch(() => {});
    }
    if (!App.items.length) {
      clog('자재코드 정보 재로드 중...', 'info');
      await loadItemsFromServer().catch(() => {});
    }

    prog(10, '입고 데이터 파싱 중...');
    const ipgoData  = parseIpgo(App.ipgoRaw.wb);
    App.ipgoData    = ipgoData;
    clog(`입고 ${ipgoData.length}건 파싱 완료 (소계행 자동 제거)`, 'ok');

    await sleep(20); prog(22, '사용현황 파싱 중...');
    const usageData = parseUsage(App.usageRaw.wb);
    App.usageData   = usageData;
    clog(`사용현황 ${usageData.length}건 파싱 완료`, 'ok');

    await sleep(20); prog(38, 'GC케어 / 아이메드 분류 중...');
    const gcIpgo    = ipgoData.filter(r => r['구분'] === 'GC케어');
    const imedIpgo  = ipgoData.filter(r => r['구분'] === '아이메드');
    const usageSiyak   = usageData.filter(r => String(r['자재구분'] || '').trim() === '시약');
    const usageSomoum  = usageData.filter(r => String(r['자재구분'] || '').trim() === '소모품');
    const usageGC   = [...usageSiyak, ...usageSomoum];
    const usageImed = usageData.filter(r => String(r['자재구분'] || '').trim() === '의약품');
    clog(`입고 GC케어:${gcIpgo.length}건 / 아이메드:${imedIpgo.length}건`, 'ok');
    clog(`사용 GC케어(시약+소모품):${usageGC.length}건 / 아이메드(의약품):${usageImed.length}건`, 'ok');

    await sleep(20); prog(55, '집계 중...');
    const gcVendors        = byVendor(gcIpgo);
    const imedVendors      = byVendor(imedIpgo);
    const gcDepts   = byDeptIpgoFull(gcIpgo, usageGC);
    const imedDepts = byDeptIpgoFull(imedIpgo, usageImed);
    let gcDeptsRaw   = [...gcDepts.map(d => ({ ...d }))];    // 그룹핑 전 raw 복사본
    let imedDeptsRaw = [...imedDepts.map(d => ({ ...d }))];  // 그룹핑 전 raw 복사본
    let closingDeptMaster = [];   // { code_name, extra1, parent_code } — 전체 부서 마스터

    // CLOSING_DEPT 마스터에서 의원별 부서 목록 로드 → 당월 데이터 없는 부서도 0으로 포함
    try {
      const user2  = window.auth?.getSession?.();
      const clinicRes = await apiGet('getCodes', {
        request_user_email: user2?.email,
        code_group: 'ORG_CLINIC',
      });
      const clinicCode = (clinicRes.data || [])
        .find(c => String(c.code_name || '').trim() === branch)
        ?.code_value || '';

      if (clinicCode) {
        const deptRes = await apiGet('getCodes', {
          request_user_email: user2?.email,
          code_group: 'CLOSING_DEPT',
        });
        const depts = (deptRes.data || [])
          .filter(d => String(d.parent_code || '').trim() === clinicCode);

        closingDeptMaster = depts;

        depts.forEach(d => {
          const deptName = String(d.code_name || '').trim();
          if (!deptName) return;
          ['시약', '소모품'].forEach(type => {
            if (!gcDepts.find(x => x.의뢰부서 === deptName && x.자재구분 === type))
              gcDepts.push({ 의뢰부서: deptName, 자재구분: type, 공급가액: 0, 부가세: 0, 합계금액: 0 });
          });
          if (!imedDepts.find(x => x.의뢰부서 === deptName && x.자재구분 === '의약품'))
            imedDepts.push({ 의뢰부서: deptName, 자재구분: '의약품', 공급가액: 0, 부가세: 0, 합계금액: 0 });
        });

        // imedDepts 그룹핑: extra2 기준으로 합산
        // 마감요약 시트용 raw 복사본 갱신 (마스터로 보완된 후 기준)
        imedDeptsRaw = [...imedDepts.map(d => ({ ...d }))];
        const imedGroupList = buildImedDeptGroups(depts);
        if (imedGroupList.length) {
          const grouped = {};
          imedDepts.forEach(d => {
            const group = imedGroupList.find(g => g.depts.includes(d.의뢰부서));
            const key   = (group ? group.displayName : d.의뢰부서) + '||' + d.자재구분;
            if (!grouped[key]) grouped[key] = { 의뢰부서: group?.displayName || d.의뢰부서, 자재구분: d.자재구분, 공급가액: 0, 부가세: 0, 합계금액: 0 };
            grouped[key].공급가액  += toN(d.공급가액);
            grouped[key].부가세    += toN(d.부가세);
            grouped[key].합계금액  += toN(d.합계금액);
          });
          imedDepts.length = 0;
          Object.values(grouped).forEach(d => imedDepts.push(d));
        }

        // gcDepts 그룹핑: extra2 기준으로 합산 (아이메드와 동일 방식)
        // 마감요약 시트용 raw 복사본 갱신 (마스터로 보완된 후 기준)
        gcDeptsRaw = [...gcDepts.map(d => ({ ...d }))];
        const gcGroupList = buildImedDeptGroups(depts);
        if (gcGroupList.length) {
          const gcGrouped = {};
          gcDepts.forEach(d => {
            const group = gcGroupList.find(g => g.depts.includes(d.의뢰부서));
            const key   = (group ? group.displayName : d.의뢰부서) + '||' + d.자재구분;
            if (!gcGrouped[key]) gcGrouped[key] = { 의뢰부서: group?.displayName || d.의뢰부서, 자재구분: d.자재구분, 공급가액: 0, 부가세: 0, 합계금액: 0 };
            gcGrouped[key].공급가액 += toN(d.공급가액);
            gcGrouped[key].부가세   += toN(d.부가세);
            gcGrouped[key].합계금액 += toN(d.합계금액);
          });
          gcDepts.length = 0;
          Object.values(gcGrouped).forEach(d => gcDepts.push(d));
        }
      }
    } catch (e) {
      clog('부서 마스터 로드 실패: ' + e.message, 'warn');
    }
    const itemIpgoPivot    = byItem(ipgoData, '자재코드', '자재명', '수량', '공급가액')
                              .filter(it => !String(it.코드).startsWith('6'));  // 의약품 제외
    const itemUsagePivot   = byItem(usageGC, '자재코드', '자재명', '사용수량(입)', '사용공급가');
    const siyakPivot       = byDeptUsage(usageSiyak);
    // 5% 가산 반올림 방식: App.roundMode[branch] 기준 (초기화 시 CLOSING_ROUND_MODE 로드)
    const roundFn5 = (App.roundMode?.[branch] === 'round') ? Math.round : Math.ceil;
    const siyakPivot5      = byDeptUsage5pct(usageSiyak, roundFn5);
    const imedSiSoPivot5   = byDeptUsage5pct(usageGC, roundFn5);
    const imedSiSoPivot    = byDeptUsage(usageGC);
    const imedDrugPivot    = byDeptUsage(usageImed);
    clog('집계 완료', 'ok');

    await sleep(20); prog(70, 'SAP 양식 생성 중...');
    // 거래처 맵 (서버 데이터 우선)
    const vendorMap = {};
    App.vendors.forEach(v => { vendorMap[v.vendor_name] = v; });

    const sapRows = gcIpgo.map(r => {
      const vm = vendorMap[String(r['공급업체'] || '').trim()] || {};
      return {
        거래처:    String(r['공급업체'] || ''),
        사업자번호: vm.biz_no       || '',
        공급가액:  toN(r['공급가액']),
        기준일:    String(r['입고일자'] || ''),
        적요:     `(${branch})${r['의뢰부서']}${r['자재명']}${r['수량']}`,
        지급일:   vm.credit_days   != null ? vm.credit_days : 90,
        결제방법:  vm.pay_method   || '현금결제',
        계정:     '11301101',   // 계정코드 고정값
        전표번호:  '',
      };
    });
    clog(`SAP 양식 ${sapRows.length}건 생성`, 'ok');

    await sleep(20); prog(85, '수불 집계 중...');

    // item_master 기반으로 초기 map 구성 (사용 상태만)
    const subulMap = {};
    const activeItems = App.items.filter(it => String(it.item_status || '사용').trim() === '사용');
    if (activeItems.length) {
      activeItems
        .filter(it => String(it.item_type || '').trim() !== '의약품')  // 의약품은 수불 대상 제외
        .forEach(it => {
          subulMap[it.item_code] = {
            code: it.item_code, name: it.item_name,
            type: it.item_type, 기초: 0, 기초수량: 0,
            증가: 0, 증가수량: 0, 감소: 0, 감소수량: 0
          };
        });
      clog(`자재 마스터 ${activeItems.length}건 기준으로 수불 구성`, 'ok');
    } else {
      clog('자재 마스터 미등록 — 입고/사용 데이터 기준으로 수불 구성', 'warn');
    }

    // 사용 집계 (의약품 제외 — 의약품은 부서별 금액으로 별도 관리)
    usageData
      .filter(r => String(r['자재구분'] || '').trim() !== '의약품')
      .forEach(r => {
        const code = String(r['자재코드'] || '').trim(); if (!code) return;
        if (!subulMap[code]) subulMap[code] = { code, name: String(r['자재명'] || ''), type: String(r['자재구분'] || ''), 기초: 0, 기초수량: 0, 증가: 0, 증가수량: 0, 감소: toN(r['사용공급가']), 감소수량: toN(r['사용수량(입)']) };
        else { subulMap[code].감소 += toN(r['사용공급가']); subulMap[code].감소수량 += toN(r['사용수량(입)']); }
      });
    // 입고 집계 (의약품 제외)
    ipgoData
      .filter(r => String(r['자재구분'] || '').trim() !== '의약품')
      .forEach(r => {
        const code = String(r['자재코드'] || '').trim(); if (!code) return;
        if (!subulMap[code]) subulMap[code] = { code, name: String(r['자재명'] || ''), type: String(r['자재구분'] || ''), 기초: 0, 기초수량: 0, 증가: toN(r['공급가액']), 증가수량: toN(r['수량']), 감소: 0, 감소수량: 0 };
        else { subulMap[code].증가 += toN(r['공급가액']); subulMap[code].증가수량 += toN(r['수량']); }
      });

    // 입고 파일에 자재 마스터 미등록 품목 경고
    let unregItems = [];
    if (activeItems.length) {
      const itemCodeSet = new Set(activeItems.map(it => it.item_code));
      unregItems = [...new Set(ipgoData.map(r => ({
        code: String(r['자재코드'] || '').trim(),
        name: String(r['자재명']   || '').trim(),
        type: String(r['자재구분'] || '').trim(),
      })).filter(r => r.code && !itemCodeSet.has(r.code))
        .map(r => JSON.stringify(r)))
      ].map(s => JSON.parse(s));
      if (unregItems.length) clog(`⚠ 자재 마스터 미등록 품목 ${unregItems.length}건`, 'warn');
    }

    // 전월 기말 → 기초값 세팅
    const prevYm = (() => {
      const d = new Date(parseInt(y), mi - 2, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    })();
    clog(`전월(${prevYm}) 기초 재고 로드 중...`, 'info');
    const prevStock = await loadPrevStock(prevYm, branch);
    if (prevStock.length) {
      prevStock.forEach(s => {
        const code = String(s.item_code || '').trim(); if (!code) return;
        if (subulMap[code]) {
          subulMap[code].기초    = toN(s.closing_amount);
          subulMap[code].기초수량 = toN(s.closing_qty);   // 소수점 그대로 유지
        } else {
          subulMap[code] = { code, name: s.item_name || '', type: s.item_type || '',
            기초: toN(s.closing_amount), 기초수량: toN(s.closing_qty), 증가: 0, 감소: 0 };
        }
      });
      clog(`전월 기초 재고 ${prevStock.length}건 반영`, 'ok');
    } else {
      clog('전월 확정 데이터 없음 — 기초값 0으로 처리', 'warn');
    }

    // 미등록 거래처 경고
    const unregVendors = [...new Set(gcIpgo.map(r => String(r['공급업체'] || '').trim()).filter(v => v && !vendorMap[v]))];
    if (unregVendors.length) clog(`⚠ 거래처 관리 미등록: ${unregVendors.join(', ')}`, 'warn');

    App.R = { gcIpgo, imedIpgo, gcVendors, imedVendors, gcDepts, gcDeptsRaw, imedDepts, imedDeptsRaw,
              closingDeptMaster,
              itemIpgoPivot, itemUsagePivot, usageGC, usageImed, usageSiyak, usageSomoum,
              siyakPivot, siyakPivot5, imedSiSoPivot, imedSiSoPivot5, imedDrugPivot,
              sapRows, subulMap, vendorMap, unregItems, unregVendors, y, m: mi, branch, cc, account };

    // 수불부: Drive 파일 로드 + JSZip으로 당월 시트 삽입 → 메모리 보관
    await sleep(20); prog(88, '수불부 준비 중...');
    const user = window.auth?.getSession?.();
    try {
      const fidRes = await apiGet('closingGetSubulFileId', {
        request_user_email: user?.email,
        branch,
        report_type: 'GC케어',
      });
      if (!fidRes.success || !fidRes.data?.file_id) {
        clog('수불부 file_id 없음 — 당월 시트만 다운로드됩니다.', 'warn');
      } else {
        prog(91, '수불부 파일 로드 중...');
        const fileRes = await apiGet('closingGetSubulFile', {
          request_user_email: user?.email,
          file_id: fidRes.data.file_id,
        });
        if (!fileRes.success || !fileRes.data?.base64) {
          clog('수불부 파일 로드 실패', 'warn');
        } else {
          clog(`Drive 파일 수신: ${(fileRes.data.base64.length/1024).toFixed(0)}KB`, 'info');
          prog(94, '수불부 당월 시트 삽입 중...');

          // 당월 시트 xlsx 생성 → sheet XML 추출
          const sheetName = `원가집계표-${y.slice(2)}년 ${mi}월 ${branch}`;
          const singleWb  = new ExcelJS.Workbook();
          writeSubul(singleWb.addWorksheet(sheetName), y, mi, branch,
            Object.values(subulMap).filter(it => it.type !== '의약품'), App.R);

          // 당월 시트 버퍼 저장 (Drive 삽입용)
          const sheetBuf = await singleWb.xlsx.writeBuffer();
          App.R.subulSheetBuf  = sheetBuf;
          App.R.subulSheetName = sheetName;
          App.R.subulFileId    = fidRes.data.file_id;

          // 다운로드용: 기존 파일 + 당월 시트 합친 전체 버퍼
          const existingBytes = Uint8Array.from(atob(fileRes.data.base64), c => c.charCodeAt(0));
          const resultBuf = await insertSheetIntoXlsx_(existingBytes, singleWb, sheetName);
          App.R.subulBuffer = resultBuf;
          clog(`수불부 준비 완료 (${(resultBuf.byteLength/1024).toFixed(0)}KB)`, 'ok');
        }
      }
    } catch (e) {
      clog('수불부 처리 실패: ' + e.message, 'warn');
    }

    clog('모든 처리 완료!', 'ok');
    await sleep(20); prog(100, '완료!');

    // 자동 이동 대신 버튼 활성화
    const btnGo = document.getElementById('btnGoResult');
    if (btnGo) {
      btnGo.disabled = false;
      btnGo.style.opacity = '1';
      btnGo.style.cursor = 'pointer';
      btnGo.textContent = '산출물 확인 →';
    }

  } catch (err) {
    clog('처리 중 오류: ' + err.message, 'err');
    showMessage('처리 중 오류가 발생했습니다: ' + err.message, 'error');
    // 오류 시에도 버튼 활성화 (확인 가능하도록)
    const btnGo = document.getElementById('btnGoResult');
    if (btnGo) {
      btnGo.disabled = false;
      btnGo.style.opacity = '1';
      btnGo.style.cursor = 'pointer';
      btnGo.textContent = '⚠ 오류 — 로그 확인';
      btnGo.style.background = '#dc2626';
    }
  }
}

// ═══════════════════════════════════════════════════════════
// 9. 결과 렌더링
// ═══════════════════════════════════════════════════════════
function renderResults() {
  const R = App.R;
  const gcT  = R.gcVendors.reduce((s, v) => s + v.합계금액, 0);
  const imT  = R.imedVendors.reduce((s, v) => s + v.합계금액, 0);

  document.getElementById('summaryGrid').innerHTML = `
    <div class="cl-stat">
      <div class="cl-stat-label">총 입고 건수</div>
      <div class="cl-stat-val">${(R.gcIpgo.length + R.imedIpgo.length).toLocaleString()}</div>
      <div class="cl-stat-sub">GC케어 ${R.gcIpgo.length} / 아이메드 ${R.imedIpgo.length}</div>
    </div>
    <div class="cl-stat">
      <div class="cl-stat-label">전체 입고금액</div>
      <div class="cl-stat-val">${Math.round(gcT + imT).toLocaleString()}원</div>
      <div class="cl-stat-sub">합계금액 기준</div>
    </div>
    <div class="cl-stat" style="border-left:3px solid #0e7c3a;">
      <div class="cl-stat-label" style="color:#0e7c3a;">GC케어 입고</div>
      <div class="cl-stat-val" style="color:#0e7c3a;">${Math.round(gcT).toLocaleString()}원</div>
      <div class="cl-stat-sub">소모품·시약 ${R.gcVendors.length}개 거래처</div>
    </div>
    <div class="cl-stat" style="border-left:3px solid #b45309;">
      <div class="cl-stat-label" style="color:#b45309;">아이메드 입고</div>
      <div class="cl-stat-val" style="color:#b45309;">${Math.round(imT).toLocaleString()}원</div>
      <div class="cl-stat-sub">의약품 ${R.imedVendors.length}개 거래처</div>
    </div>
  `;

  renderPreview();

  // 미등록 거래처 에러 카드
  const vendorErrCard = document.getElementById('unregVendorsCard');
  if (vendorErrCard) {
    if (R.unregVendors && R.unregVendors.length > 0) {
      vendorErrCard.style.display = '';
      document.getElementById('unregVendorsBody').innerHTML = `
        <p style="font-size:12px;color:#92400e;margin-bottom:10px;">
          아래 거래처는 <strong>거래처 관리</strong>에 등록되지 않았습니다.
          결재 시트에 사업자번호·결제방법·결제기일이 비어있으며 노란색으로 표시됩니다.
        </p>
        <div style="display:flex;flex-wrap:wrap;gap:8px;">
          ${R.unregVendors.map(v =>
            `<span style="background:#fff;border:1px solid #fde68a;border-radius:5px;padding:4px 10px;font-size:12px;font-weight:600;">${escHtml(v)}</span>`
          ).join('')}
        </div>`;
    } else {
      vendorErrCard.style.display = 'none';
    }
  }

  // 미등록 품목 에러 카드
  const errCard = document.getElementById('unregItemsCard');
  if (errCard) {
    if (R.unregItems && R.unregItems.length > 0) {
      errCard.style.display = '';
      document.getElementById('unregItemsBody').innerHTML = `
        <p style="font-size:12px;color:#92400e;margin-bottom:10px;">
          아래 품목은 자재코드 마스터에 등록되지 않았습니다.
          수불 집계표에 포함되어 있으나 <strong>자재코드 관리 탭에서 등록</strong> 후 재처리를 권장합니다.
        </p>
        <div class="cl-preview-wrap">
          <table class="cl-preview">
            <thead><tr><th>자재코드</th><th>자재명</th><th>구분</th></tr></thead>
            <tbody>${R.unregItems.map(it => `
              <tr>
                <td style="font-family:monospace;font-size:12px;">${escHtml(it.code)}</td>
                <td>${escHtml(it.name)}</td>
                <td>${escHtml(it.type)}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>`;
    } else {
      errCard.style.display = 'none';
    }
  }
  const btn = document.getElementById('btnClosingConfirm');
  const statusEl = document.getElementById('closingConfirmStatus');
  if (btn) {
    btn.disabled = false;
    btn.textContent = '✅ 마감 확정';
    btn.style.background = '#1d4ed8';
  }
  if (statusEl) statusEl.textContent = '';

  // 강남의원 전용 세포치료/특수의약품 입력 카드
  const gangnamCard = document.getElementById('gangnamExtraCard');
  if (gangnamCard) {
    const isGangnam = (App.R?.branch || '').includes('강남');
    gangnamCard.style.display = isGangnam ? '' : 'none';
    if (isGangnam) {
      // 산출물 재로드 시 입력값 초기화
      document.getElementById('inputCellTherapy').value = '';
      document.getElementById('inputSpecialMed').value  = '';
    }
  }

  document.getElementById('downloadGrid').innerHTML = `
    <div class="cl-dl-card both" onclick="dlIpgo()">
      <span class="cl-dl-tag both">공통</span>
      <div class="cl-dl-name">입고 (편집본)</div>
      <div class="cl-dl-sheets">거래처 요약 · 입고원본 · GC케어 입고분 · 원가집계표 요약 · GC/아이메드 마감요약</div>
      <button class="btn" style="margin-top:6px;font-size:12px;padding:5px 12px;">⬇ 다운로드</button>
    </div>
    <div class="cl-dl-card both" onclick="dlUsage()">
      <span class="cl-dl-tag both">공통</span>
      <div class="cl-dl-name">사용현황 (편집본)</div>
      <div class="cl-dl-sheets">사용원본 · 시약 · 소모품 · 원가집계표 요약 · 시약 마감요약 · 시약5% · 의약품 · 아이메드 마감요약</div>
      <button class="btn" style="margin-top:6px;font-size:12px;padding:5px 12px;">⬇ 다운로드</button>
    </div>
    <div class="cl-dl-card imed" onclick="dlSubul()">
      <span class="cl-dl-tag imed">GC케어 제출</span>
      <div class="cl-dl-name">★ 수불 집계표 ★</div>
      <div class="cl-dl-sheets">품목별 기초·증가·감소·기말 원가집계표</div>
      <button class="btn" style="margin-top:6px;font-size:12px;padding:5px 12px;">⬇ 다운로드</button>
    </div>
    <div class="cl-dl-card gc" onclick="dlSAP()">
      <span class="cl-dl-tag gc">GC케어</span>
      <div class="cl-dl-name">GC케어 입고분 SAP 입력 양식</div>
      <div class="cl-dl-sheets">SAP 전표 입력 (거래처 관리 자동 반영) · 거래처 관리 시트</div>
      <button class="btn" style="margin-top:6px;font-size:12px;padding:5px 12px;">⬇ 다운로드</button>
    </div>
    <div class="cl-dl-card gc" onclick="dlGCReport()">
      <span class="cl-dl-tag gc">GC케어</span>
      <div class="cl-dl-name">거래처 구매 내역 및 원재료 보고</div>
      <div class="cl-dl-sheets">결재 · 부서별 금액 · 원재료비 · 연간 원재료비</div>
      <button class="btn" style="margin-top:6px;font-size:12px;padding:5px 12px;">⬇ 다운로드</button>
    </div>
    <div class="cl-dl-card imed" onclick="dlImedReport()">
      <span class="cl-dl-tag imed">아이메드</span>
      <div class="cl-dl-name">거래처 구매 내역 및 원재료 보고</div>
      <div class="cl-dl-sheets">결재 · 부서별 금액 · 원재료비 · 연간 원재료비</div>
      <button class="btn" style="margin-top:6px;font-size:12px;padding:5px 12px;">⬇ 다운로드</button>
    </div>
  `;
}

function renderPreview() {
  const filter = document.getElementById('previewFilter').value;
  let data = App.ipgoData;
  if (filter !== 'all') data = data.filter(r => r['구분'] === filter);
  const show = data.slice(0, 15);
  const cols = ['공급업체', '자재구분', '자재명', '입고일자', '수량', '공급가액', '부가세', '합계금액', '의뢰부서', '구분'];
  let html = '<table class="cl-preview"><thead><tr>' + cols.map(c => `<th>${c}</th>`).join('') + '</tr></thead><tbody>';
  show.forEach(r => {
    const tag = r['구분'] === 'GC케어' ? '<span class="cl-tag-gc">GC케어</span>' : '<span class="cl-tag-imed">아이메드</span>';
    html += `<tr>
      <td>${r['공급업체'] || ''}</td>
      <td>${r['자재구분'] || ''}</td>
      <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;">${r['자재명'] || ''}</td>
      <td>${r['입고일자'] || ''}</td>
      <td class="num">${toN(r['수량']).toLocaleString()}</td>
      <td class="num">${toN(r['공급가액']).toLocaleString()}</td>
      <td class="num">${toN(r['부가세']).toLocaleString()}</td>
      <td class="num">${toN(r['합계금액']).toLocaleString()}</td>
      <td>${r['의뢰부서'] || ''}</td>
      <td>${tag}</td>
    </tr>`;
  });
  if (data.length > 15) html += `<tr><td colspan="${cols.length}" class="more">외 ${data.length - 15}건 더 있음</td></tr>`;
  html += '</tbody></table>';
  document.getElementById('previewTable').innerHTML = html;
}

function restart() {
  // Raw 데이터 완전 해제 (메모리 누수 방지)
  if (App.ipgoRaw) { App.ipgoRaw.wb = null; App.ipgoRaw = null; }
  if (App.usageRaw) { App.usageRaw.wb = null; App.usageRaw = null; }
  App.ipgoData = []; App.usageData = [];
  // App.R 내 대용량 데이터 완전 해제
  if (App.R) {
    App.R.gcIpgo = null; App.R.imedIpgo = null;
    App.R.usageGC = null; App.R.usageImed = null;
    App.R.usageSiyak = null; App.R.usageSomoum = null;
    App.R.subulMap = null; App.R.sapRows = null;
    App.R.subulSheetBuf = null; App.R.subulSheetName = null; App.R.subulBuffer = null;
  }
  App.R = {};
  ['ipgo', 'usage'].forEach(t => {
    document.getElementById('status-' + t).textContent = '';
    document.getElementById('zone-' + t).classList.remove('uploaded');
    // file input 초기화 (같은 파일 재선택 시 onchange 재발동)
    const inp = document.querySelector(`input[onchange*="${t}"]`);
    if (inp) inp.value = '';
  });
  document.getElementById('btnNext1').disabled = true;
  document.getElementById('logBox').innerHTML = '';
  document.getElementById('progressFill').style.width = '0%';
  document.getElementById('progressPct').textContent = '0%';
  document.getElementById('progressLabel').textContent = '';
  // 4단계 카드 초기화
  const confirmCard = document.getElementById('unregItemsCard');
  if (confirmCard) confirmCard.style.display = 'none';
  const vendorCard = document.getElementById('unregVendorsCard');
  if (vendorCard) vendorCard.style.display = 'none';
  const confirmBtn = document.getElementById('btnClosingConfirm');
  if (confirmBtn) {
    confirmBtn.disabled = false;
    confirmBtn.textContent = '✅ 마감 확정';
    confirmBtn.style.background = '#1d4ed8';
  }
  goStep(1);
}


// ═══════════════════════════════════════════════════════════
// 11. 다운로드 함수
// ═══════════════════════════════════════════════════════════
function newWb() { return new ExcelJS.Workbook(); }
// ── 수불부 xlsx에 sheet XML 삽입 (JSZip) ─────────────────────
// 수불부 xlsx에 새 시트 추가
// 새 ExcelJS wb 기준으로 생성: 새 시트(서식 완전) 맨 앞 + 기존 시트들 값만 복사
async function insertSheetIntoXlsx_(existingBytes, newSheetWb, sheetName) {
  // 기존 파일 파싱 (값만 읽기)
  const existingWb = new ExcelJS.Workbook();
  await existingWb.xlsx.load(existingBytes.buffer || existingBytes);

  // 새 시트(당월)를 맨 앞에 두고, 기존 시트 중 동일 이름은 제외하고 복사
  for (const srcWs of existingWb.worksheets) {
    if (srcWs.name === sheetName) continue;  // 동일 이름 시트 제외 (재마감 시 중복 방지)
    const dstWs = newSheetWb.addWorksheet(srcWs.name);
    copyWorksheet_(srcWs, dstWs);
  }

  return await newSheetWb.xlsx.writeBuffer();
}

// ── 수불부 시트 복사 헬퍼 ────────────────────────────────────
function copyWorksheet_(src, dst) {
  // 열 너비 복사
  src.columns.forEach((col, i) => {
    if (col.width) dst.getColumn(i + 1).width = col.width;
  });

  // 확대율 복사
  if (src.views && src.views.length > 0) {
    dst.views = src.views.map(v => Object.assign({}, v));
  }

  // 행 복사 (값, 서식, 병합)
  src.eachRow({ includeEmpty: true }, (row, rn) => {
    const dstRow = dst.getRow(rn);
    if (row.height) dstRow.height = row.height;
    try {
      row.eachCell({ includeEmpty: true }, (cell, cn) => {
        const dstCell = dstRow.getCell(cn);
        dstCell.value = cell.value;
        if (cell.numFmt)    dstCell.numFmt    = cell.numFmt;
        if (cell.font)      dstCell.font      = Object.assign({}, cell.font);
        if (cell.fill)      dstCell.fill      = Object.assign({}, cell.fill);
        if (cell.alignment) dstCell.alignment = Object.assign({}, cell.alignment);
        if (cell.border)    dstCell.border    = Object.assign({}, cell.border);
      });
    } catch (_) {}
    dstRow.commit();
  });

  // 병합 셀 복사
  const merges = (src.model && src.model.merges) ? src.model.merges : Object.keys(src._merges || {});
  merges.forEach(range => {
    try {
      if (typeof range === 'string' && /^[A-Z]+\d+:[A-Z]+\d+$/.test(range)) {
        dst.mergeCells(range);
      }
    } catch (_) {}
  });
}

async function saveWb(wb, filename) {
  const buf = await wb.xlsx.writeBuffer();
  saveAs(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
  // 워크북 메모리 해제
  wb.worksheets.forEach(ws => { ws._rows = []; ws._columns = []; });
  wb._worksheets = [];
}

async function dlIpgo() {
  try {
    showGlobalLoading('입고 편집본 생성 중...');
    const R = App.R; const wb = newWb();
    const ic = ['공급업체', '구매번호', '자재구분', '자재코드', '자재명', '상태', '입고일자', '수량', '단가', '공급가액', '부가세', '합계금액', '규격', '산출단위', '입고단위', '의뢰부서', '구분'];
    const iw = [16, 14, 8, 12, 40, 8, 12, 8, 12, 14, 12, 14, 10, 8, 8, 14, 10];
    const in_ = [8, 9, 10, 11, 12];
    writePivotVendor(wb.addWorksheet('거래처 요약'), R.gcVendors, R.imedVendors);
    writeDataSheet(wb.addWorksheet('입고원본'), ic, [...R.gcIpgo, ...R.imedIpgo].map(d => ic.map(c => d[c] || '')), in_, iw);
    writeDataSheet(wb.addWorksheet('GC케어 입고분'), ic, R.gcIpgo.map(d => ic.map(c => d[c] || '')), in_, iw);
    writePivotItem(wb.addWorksheet('원가집계표 요약'), R.itemIpgoPivot, false);
    writePivotDept(wb.addWorksheet('GC케어 마감요약'), (R.gcDeptsRaw || R.gcDepts).filter(d => d.공급가액 || d.부가세 || d.합계금액));
    writeDataSheet(wb.addWorksheet('아이메드 입고분'), ic, R.imedIpgo.map(d => ic.map(c => d[c] || '')), in_, iw);
    writePivotDept(wb.addWorksheet('아이메드 마감요약'), R.imedDeptsRaw.filter(d => d.공급가액 || d.부가세 || d.합계금액));
    await saveWb(wb, `${R.y.slice(2)}년 ${R.m}월 입고 - ${R.branch}.xlsx`);
  } finally {
    await hideGlobalLoading();
  }
}

async function dlUsage() {
  try {
    showGlobalLoading('사용현황 편집본 생성 중...');
    const R = App.R; const wb = newWb();
    const uc  = ['부서명', '자재구분', '자재코드', '자재명', '구매번호', '사용일자', '사용수량(입)', '사용수량(산)', '사용공급가', '사용부가세', '사용합계', '공급업체', '규격'];
    const uw  = [14, 8, 12, 40, 14, 12, 10, 10, 14, 12, 14, 16, 10];
    const un  = [7, 8, 9, 10, 11];
    // 사용원본/의약품: 1행 합계 컬럼 = 사용공급가(9), 사용부가세(10), 사용합계(11)
    const uSumCols = [9, 10, 11];

    const uc5 = ['부서명', '자재구분', '자재코드', '자재명', '구매번호', '사용일자', '사용수량(입)', '사용수량(산)', '사용공급가', '공5%', '사용부가세', '부5%', '사용합계', '계5%', '공급업체', '규격'];
    const uw5 = [14, 8, 12, 40, 14, 12, 10, 10, 14, 12, 12, 10, 14, 12, 16, 10];
    const un5 = [7, 8, 9, 10, 11, 12, 13, 14];
    const roundFn5 = (App.roundMode?.[R.branch] === 'round') ? Math.round : Math.ceil;
    const roundUp = v => roundFn5(toN(v) * 1.05);
    const make5 = d => {
      const sup5 = roundUp(d['사용공급가']);
      const vat5 = roundUp(d['사용부가세']);
      return [d['부서명'], d['자재구분'], d['자재코드'], d['자재명'], d['구매번호'], d['사용일자'],
        toN(d['사용수량(입)']), toN(d['사용수량(산)']),
        toN(d['사용공급가']), sup5,
        toN(d['사용부가세']), vat5,
        toN(d['사용합계']), sup5 + vat5,  // 계5% = 공5% + 부5%
        d['공급업체'], d['규격']];
    };

    const dm = R.closingDeptMaster || [];

    // 사용원본: 1행에 합계
    writeDataSheet(wb.addWorksheet('사용원본'), uc, App.usageData.map(d => uc.map(c => d[c] || '')), un, uw, uSumCols);
    writeUsageWith5pct(wb.addWorksheet('시약, 소모품'), uc5, R.usageGC.map(make5), un5, uw5);
    writePivotItem(wb.addWorksheet('원가집계표 요약'), R.itemUsagePivot, true);
    writeUsageWith5pct(wb.addWorksheet('소모품'), uc5, R.usageSomoum.map(make5), un5, uw5);
    writeUsageWith5pct(wb.addWorksheet('시약'), uc5, R.usageSiyak.map(make5), un5, uw5);
    writePivotUsageDept(wb.addWorksheet('시약 마감요약'),      R.siyakPivot,     ['합계 : 사용공급가', '합계 : 사용부가세', '합계 : 사용합계']);
    writePivotUsageDept(wb.addWorksheet('시약5%'),            R.siyakPivot5,    ['합계 : 공5%',       '합계 : 부5%',       '합계 : 계5%']);
    writeDataSheet(wb.addWorksheet('의약품'), uc, R.usageImed.map(d => uc.map(c => d[c] || '')), un, uw, uSumCols);
    writePivotUsageDept(wb.addWorksheet('아이메드 마감요약(시, 소)'), R.imedSiSoPivot5, ['합계 : 공5%',       '합계 : 부5%',       '합계 : 계5%']);
    writePivotUsageDept(wb.addWorksheet('아이메드 마감요약(의약품)'), R.imedDrugPivot,  ['합계 : 사용공급가', '합계 : 사용부가세', '합계 : 사용합계']);
    await saveWb(wb, `${R.y.slice(2)}년 ${R.m}월 사용현황 - ${R.branch}.xlsx`);
  } finally {
    await hideGlobalLoading();
  }
}

// ── GC케어 보고서 ──────────────────────────────────────────
async function dlGCReport() {
  try {
    showGlobalLoading('GC케어 보고서 생성 중...');
    const R   = App.R;
    const wb  = newWb();
    const label = '시약 및 소모품';
    const filename = `${R.y.slice(2)}년 ${R.m}월 거래처 구매 내역 및 원재료 보고 - GC케어 - ${R.branch}.xlsx`;

    // 1시트: 결재
    writeKyuljai(wb.addWorksheet(`${R.m}월결재`), R.y, R.m, label, R.gcVendors, R.vendorMap, null);

    // 2시트: 부서별 금액 — 시약은 입고금액 있는 부서만 표시, 0그룹 생략
    const gcDeptsForAmount = R.gcDepts.filter(d =>
      String(d.자재구분 || '').trim() !== '시약' || toN(d.공급가액) > 0
    );
    writeDeptAmount(wb.addWorksheet(`${R.m}월 부서별 금액`), R.m, gcDeptsForAmount, true);

    // 3·4시트: 원재료비
    const user = window.auth?.getSession?.();
    const prevDate = new Date(parseInt(R.y), R.m - 2, 1);
    const prevYm   = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
    let prevStockData = await loadPrevStock(prevYm, R.branch);
    if (!prevStockData.length) {
      clog('전월 closing_stock 없음 → closing_usage_monthly end_amount로 대체', 'warn');
      prevStockData = await loadPrevStockFromUsage(prevYm, R.branch, 'GC케어');
    }
    R.prevStockData = prevStockData;
    writeWonjaeryo(wb.addWorksheet(`원재료비 ${R.y.slice(2)}년 ${R.m}월`), R, prevStockData, label);
    const yearUsage = await loadYearUsage(null, R.branch, user, 'GC케어');
    writeWonjaeryoYear(wb.addWorksheet(`${R.y}년도 원재료비`), R, yearUsage, label);

    await saveWb(wb, filename);
  } finally {
    await hideGlobalLoading();
  }
}

// ── 아이메드 보고서 ────────────────────────────────────────
async function dlImedReport() {
  try {
    showGlobalLoading('아이메드 보고서 생성 중...');
    const R   = App.R;
    const wb  = newWb();
    const label = '원재료 및 소모품';
    const filename = `${R.y.slice(2)}년 ${R.m}월 거래처 구매 내역 및 원재료 보고 - 아이메드 - ${R.branch}.xlsx`;

    // 1시트: 결재 — GC케어 금액(아이메드 마감요약 시,소 합계) 포함
    const gcSiSo5 = R.imedSiSoPivot5 || [];
    const gcRow = {
      공급가액: gcSiSo5.reduce((s,d) => s + toN(d.사용공급가||0), 0),
      부가세:   gcSiSo5.reduce((s,d) => s + toN(d.사용부가세||0), 0),
      합계금액: gcSiSo5.reduce((s,d) => s + toN(d.사용합계  ||0), 0),
    };
    writeKyuljai(wb.addWorksheet(`${R.m}월결재`), R.y, R.m, label, R.imedVendors, R.vendorMap, gcRow);

    // 2시트: 부서별 금액 — 시약+소모품(5% 적용) 그룹핑 합산, 0부서도 표시
    const imedGroups = buildImedDeptGroups(R.closingDeptMaster || []);
    const groupedMap = {};
    (R.imedSiSoPivot5 || []).forEach(d => {
      const dept  = String(d.부서명  || '').trim();
      const type  = String(d.자재구분 || '').trim();
      const group = imedGroups.find(g => g.depts.includes(dept));
      const key   = (group ? group.displayName : dept) + '||' + type;
      if (!groupedMap[key]) groupedMap[key] = { 의뢰부서: group?.displayName || dept, 자재구분: type, 공급가액: 0, 부가세: 0, 합계금액: 0 };
      groupedMap[key].공급가액  += Math.round(d.사용공급가 || 0);
      groupedMap[key].부가세    += Math.round(d.사용부가세 || 0);
      groupedMap[key].합계금액  += Math.round(d.사용합계   || 0);
    });
    const siyakDeptNames = new Set(
      (R.closingDeptMaster || [])
        .filter(d => String(d.extra1 || '').trim() === '시약')
        .map(d => String(d.code_name || '').trim())
    );
    const masterKeys = imedGroups.length
      ? imedGroups.flatMap(g => {
          const keys = [g.displayName + '||소모품'];
          if (g.depts.some(dept => siyakDeptNames.has(dept))) keys.push(g.displayName + '||시약');
          return keys;
        })
      : (R.closingDeptMaster || []).flatMap(d => {
          const n = String(d.code_name || '').trim();
          if (!n) return [];
          const keys = [n + '||소모품'];
          if (siyakDeptNames.has(n)) keys.push(n + '||시약');
          return keys;
        });
    masterKeys.forEach(key => {
      if (!groupedMap[key]) {
        const [dept, type] = key.split('||');
        groupedMap[key] = { 의뢰부서: dept, 자재구분: type, 공급가액: 0, 부가세: 0, 합계금액: 0 };
      }
    });
    const imedDeptsForAmount = [...R.imedDepts, ...Object.values(groupedMap)];
    writeDeptAmount(wb.addWorksheet(`${R.m}월 부서별 금액`), R.m, imedDeptsForAmount, false);

    // 3·4시트: 원재료비
    const user = window.auth?.getSession?.();
    const prevDate = new Date(parseInt(R.y), R.m - 2, 1);
    const prevYm   = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
    // 아이메드는 항상 새로 로드 (GC케어 prevStockData와 분리)
    let prevStockData = await loadPrevStock(prevYm, R.branch);
    if (!prevStockData.length) {
      clog('전월 closing_stock 없음 → closing_usage_monthly end_amount로 대체', 'warn');
      prevStockData = await loadPrevStockFromUsage(prevYm, R.branch, '아이메드');
    }
    R.prevStockData = prevStockData;
    writeWonjaeryo(wb.addWorksheet(`원재료비 ${R.y.slice(2)}년 ${R.m}월`), R, prevStockData, label);
    const yearUsage = await loadYearUsage(null, R.branch, user, '아이메드');
    writeWonjaeryoYear(wb.addWorksheet(`${R.y}년도 원재료비`), R, yearUsage, label);

    await saveWb(wb, filename);
  } finally {
    await hideGlobalLoading();
  }
}

async function dlSAP() {
  try {
    showGlobalLoading('SAP 입력 양식 생성 중...');
    const R = App.R; const wb = newWb();
    const totalSup = R.gcIpgo.reduce((s, r) => s + toN(r['공급가액']), 0);
    writeSAP(wb.addWorksheet(`GC케어 SAP 입고 - ${R.y.slice(2)}년 ${R.m}월 - ${R.branch}`),
      R.y, R.m, R.branch, R.sapRows, totalSup, R.cc, R.account, R.vendorMap);
    writeVendorMasterSheet(wb.addWorksheet('거래처 관리'), App.vendors);
    await saveWb(wb, `${R.y.slice(2)}년 ${R.m}월 GC케어 입고분 SAP 입력 양식 - ${R.branch}.xlsx`);
  } finally {
    await hideGlobalLoading();
  }
}

async function dlSubul() {
  try {
    showGlobalLoading('수불 집계표 다운로드 중...');
    const R    = App.R;
    const filename = `★ ${R.y.slice(2)}년도 ${R.m}월 아이메드 수불 - GC케어 제출용 ★ ${R.branch}.xlsx`;

    if (R.subulBuffer) {
      // 파싱 시점에 준비된 전체 파일 (기존 + 당월)
      saveAs(new Blob([R.subulBuffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      }), filename);
    } else {
      // Drive 파일 없는 경우 당월 시트만 생성
      const wb = newWb();
      writeSubul(wb.addWorksheet(`원가집계표-${R.y.slice(2)}년 ${R.m}월 ${R.branch}`),
        R.y, R.m, R.branch,
        Object.values(R.subulMap).filter(it => it.type !== '의약품'), R);
      await saveWb(wb, filename);
    }
  } catch (e) {
    showMessage('수불 집계표 오류: ' + e.message, 'error');
  } finally {
    await hideGlobalLoading();
  }
}

async function downloadAll() {
  try {
    showGlobalLoading('전체 산출물 생성 중...');
    const R = App.R; 
    // 스피너는 유지한 채 순차 생성
    const wb1 = newWb();
    const ic = ['공급업체', '구매번호', '자재구분', '자재코드', '자재명', '상태', '입고일자', '수량', '단가', '공급가액', '부가세', '합계금액', '규격', '산출단위', '입고단위', '의뢰부서', '구분'];
    const iw = [16, 14, 8, 12, 40, 8, 12, 8, 12, 14, 12, 14, 10, 8, 8, 14, 10];
    const in_ = [8, 9, 10, 11, 12];
    writePivotVendor(wb1.addWorksheet('거래처 요약'), R.gcVendors, R.imedVendors);
    writeDataSheet(wb1.addWorksheet('입고원본'), ic, [...R.gcIpgo, ...R.imedIpgo].map(d => ic.map(c => d[c] || '')), in_, iw);
    writeDataSheet(wb1.addWorksheet('GC케어 입고분'), ic, R.gcIpgo.map(d => ic.map(c => d[c] || '')), in_, iw);
    writePivotItem(wb1.addWorksheet('원가집계표 요약'), R.itemIpgoPivot, false);
    writePivotDept(wb1.addWorksheet('GC케어 마감요약'), (R.gcDeptsRaw || R.gcDepts).filter(d => d.공급가액 || d.부가세 || d.합계금액));
    writeDataSheet(wb1.addWorksheet('아이메드 입고분'), ic, R.imedIpgo.map(d => ic.map(c => d[c] || '')), in_, iw);
    writePivotDept(wb1.addWorksheet('아이메드 마감요약'), R.imedDeptsRaw.filter(d => d.공급가액 || d.부가세 || d.합계금액));
    await saveWb(wb1, `${R.y.slice(2)}년 ${R.m}월 입고 - ${R.branch}.xlsx`);
    await sleep(20);

    // 나머지는 개별 함수 재사용 (각 함수 내부 스피너는 hideGlobalLoading 하지 않도록 플래그 없이 직접 호출)
    await hideGlobalLoading();
    await dlUsage();   await sleep(20);
    await dlGCReport(); await sleep(20);
    await dlImedReport(); await sleep(20);
    await dlSAP();     await sleep(20);
    await dlSubul();
  } catch(e) {
    await hideGlobalLoading();
    showMessage('전체 다운로드 중 오류: ' + e.message, 'error');
  }
}

// ═══════════════════════════════════════════════════════════
// 12. 지점명 드롭다운 (ORG_CLINIC)
// ═══════════════════════════════════════════════════════════
async function loadBranchOptions(user) {
  const sel = document.getElementById('inputBranch');
  if (!sel) return;

  let clinics = [];
  try {
    const res = await apiGet('getCodes', {
      request_user_email: user?.email,
      code_group: 'ORG_CLINIC',
    });
    const data = res.data || res || [];
    clinics = Array.isArray(data)
      ? data
          .filter(c => String(c.use_yn || 'Y').toUpperCase() === 'Y')
          .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
          // code_value(GN/GB/SS 등)도 보존해 clinic_code 기반 매칭에 사용
          .map(c => ({ value: c.code_name, label: c.code_name, code_value: c.code_value }))
      : [];
  } catch (e) {
    clinics = [];
  }

  // API 실패 또는 목록 없으면 소속 의원만 표시
  if (!clinics.length) {
    const fallback = user?.clinic_name || user?.org_name || '';
    clinics = [{ value: fallback, label: fallback, code_value: user?.clinic_code || '' }];
  }

  // 소속 의원 기본 선택:
  //   1순위 — 세션의 clinic_name이 있으면 그대로 매칭
  //   2순위 — clinic_name이 없거나 매칭 실패 시 clinic_code로 매칭
  //           (Supabase 이관 후 resolveOrgFields_ 조인 실패 시 clinic_name이
  //            빈 문자열로 내려오는 경우 대비)
  //   3순위 — 둘 다 실패 시 sort_order 첫 번째 의원
  const userClinicName = user?.clinic_name || '';
  const userClinicCode = user?.clinic_code || '';
  const defaultBranch =
    (userClinicName && clinics.find(c => c.value === userClinicName)?.value) ||
    clinics.find(c => c.code_value === userClinicCode)?.value ||
    clinics[0]?.value || '';
  sel.innerHTML = clinics.map(c =>
    `<option value="${c.value}"${c.value === defaultBranch ? ' selected' : ''}>${c.label}</option>`
  ).join('');
}
