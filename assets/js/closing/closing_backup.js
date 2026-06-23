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
  ['closing', 'vendor', 'item'].forEach(t => {
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
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ═══════════════════════════════════════════════════════════
// 6. 파싱
// ═══════════════════════════════════════════════════════════
function toN(v) { const n = parseFloat(String(v || 0).replace(/,/g, '')); return isNaN(n) ? 0 : n; }
const sumF = (arr, k) => arr.reduce((s, r) => s + toN(r[k]), 0);

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
function byDeptUsage5pct(data) {
  const m = {};
  data.forEach(r => {
    const k = String(r['부서명'] || '').trim() + '||' + String(r['자재구분'] || '').trim();
    if (!m[k]) m[k] = { 부서명: String(r['부서명'] || '').trim(), 자재구분: String(r['자재구분'] || '').trim(), 사용공급가: 0, 사용부가세: 0, 사용합계: 0 };
    const sup5 = Math.ceil(toN(r['사용공급가']) * 1.05);
    const vat5 = Math.ceil(toN(r['사용부가세']) * 1.05);
    m[k].사용공급가 += sup5;
    m[k].사용부가세 += vat5;
    m[k].사용합계  += sup5 + vat5;  // 계5% = 공5% + 부5%
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
  const branch  = document.getElementById('inputBranch').value.trim() || '서울숲';
  const ym      = document.getElementById('inputMonth').value;
  const [y, m]  = ym.split('-');
  const mi      = parseInt(m);
  const cc      = document.getElementById('inputCC').value.trim();
  const account = '11301101'; // 계정코드 고정값

  try {
    clog('처리를 시작합니다...', 'info'); await sleep(150);
    prog(10, '입고 데이터 파싱 중...');
    const ipgoData  = parseIpgo(App.ipgoRaw.wb);
    App.ipgoData    = ipgoData;
    clog(`입고 ${ipgoData.length}건 파싱 완료 (소계행 자동 제거)`, 'ok');

    await sleep(150); prog(22, '사용현황 파싱 중...');
    const usageData = parseUsage(App.usageRaw.wb);
    App.usageData   = usageData;
    clog(`사용현황 ${usageData.length}건 파싱 완료`, 'ok');

    await sleep(150); prog(38, 'GC케어 / 아이메드 분류 중...');
    const gcIpgo    = ipgoData.filter(r => r['구분'] === 'GC케어');
    const imedIpgo  = ipgoData.filter(r => r['구분'] === '아이메드');
    const usageSiyak   = usageData.filter(r => String(r['자재구분'] || '').trim() === '시약');
    const usageSomoum  = usageData.filter(r => String(r['자재구분'] || '').trim() === '소모품');
    const usageGC   = [...usageSiyak, ...usageSomoum];
    const usageImed = usageData.filter(r => String(r['자재구분'] || '').trim() === '의약품');
    clog(`입고 GC케어:${gcIpgo.length}건 / 아이메드:${imedIpgo.length}건`, 'ok');
    clog(`사용 GC케어(시약+소모품):${usageGC.length}건 / 아이메드(의약품):${usageImed.length}건`, 'ok');

    await sleep(150); prog(55, '집계 중...');
    const gcVendors        = byVendor(gcIpgo);
    const imedVendors      = byVendor(imedIpgo);
    const gcDepts   = byDeptIpgoFull(gcIpgo, usageGC);
    const imedDepts = byDeptIpgoFull(imedIpgo, usageImed);
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
    const siyakPivot5      = byDeptUsage5pct(usageSiyak);
    const imedSiSoPivot5   = byDeptUsage5pct(usageGC);
    const imedSiSoPivot    = byDeptUsage(usageGC);
    const imedDrugPivot    = byDeptUsage(usageImed);
    clog('집계 완료', 'ok');

    await sleep(150); prog(70, 'SAP 양식 생성 중...');
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

    await sleep(150); prog(85, '수불 집계 중...');

    // item_master 기반으로 초기 map 구성 (사용 상태만)
    const subulMap = {};
    const activeItems = App.items.filter(it => String(it.item_status || '사용').trim() === '사용');
    if (activeItems.length) {
      activeItems.forEach(it => {
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

    // 사용 집계
    usageData.forEach(r => {
      const code = String(r['자재코드'] || '').trim(); if (!code) return;
      if (!subulMap[code]) subulMap[code] = { code, name: String(r['자재명'] || ''), type: String(r['자재구분'] || ''), 기초: 0, 기초수량: 0, 증가: 0, 증가수량: 0, 감소: toN(r['사용공급가']), 감소수량: toN(r['사용수량(입)']) };
      else { subulMap[code].감소 += toN(r['사용공급가']); subulMap[code].감소수량 += toN(r['사용수량(입)']); }
    });
    // 입고 집계
    ipgoData.forEach(r => {
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

    App.R = { gcIpgo, imedIpgo, gcVendors, imedVendors, gcDepts, imedDepts, imedDeptsRaw,
              closingDeptMaster,
              itemIpgoPivot, itemUsagePivot, usageGC, usageImed, usageSiyak, usageSomoum,
              siyakPivot, siyakPivot5, imedSiSoPivot, imedSiSoPivot5, imedDrugPivot,
              sapRows, subulMap, vendorMap, unregItems, unregVendors, y, m: mi, branch, cc, account };

    // 수불부: Drive 파일 로드 + JSZip으로 당월 시트 삽입 → 메모리 보관
    await sleep(150); prog(88, '수불부 준비 중...');
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

          // 기존 파일에 새 시트 추가 (새 wb 기준, 기존 시트는 값만 복사)
          const existingBytes = Uint8Array.from(atob(fileRes.data.base64), c => c.charCodeAt(0));
          const resultBuf = await insertSheetIntoXlsx_(existingBytes, singleWb, sheetName);

          App.R.subulBuffer = resultBuf;
          App.R.subulFileId = fidRes.data.file_id;
          clog(`수불부 준비 완료 (${(resultBuf.byteLength/1024).toFixed(0)}KB)`, 'ok');
        }
      }
    } catch (e) {
      clog('수불부 처리 실패: ' + e.message, 'warn');
    }

    clog('모든 처리 완료!', 'ok');
    await sleep(300); prog(100, '완료!');

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

  document.getElementById('downloadGrid').innerHTML = `
    <div class="cl-dl-card both" onclick="dlIpgo()">
      <span class="cl-dl-tag both">공통</span>
      <div class="cl-dl-name">입고 (편집본)</div>
      <div class="cl-dl-sheets">거래처 요약 · 입고원본 · GC케어 입고분 · 원가집계표 요약 · GC케어 마감요약 · 아이메드 입고분 · 아이메드 마감요약</div>
      <button class="btn" style="margin-top:6px;font-size:12px;padding:5px 12px;">⬇ 다운로드</button>
    </div>
    <div class="cl-dl-card both" onclick="dlUsage()">
      <span class="cl-dl-tag both">공통</span>
      <div class="cl-dl-name">사용현황 (편집본)</div>
      <div class="cl-dl-sheets">사용원본 · 시약,소모품 · 원가집계표 요약 · 소모품 · 시약 · 시약 마감요약 · 시약5% · 의약품 · 아이메드 마감요약(시,소) · 아이메드 마감요약(의약품)</div>
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
// 10. ExcelJS 서식 상수
// ═══════════════════════════════════════════════════════════
const F = {
  base:  { name: 'Calibri', size: 10 },
  bold:  { name: 'Calibri', size: 10, bold: true },
  hdr:   { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF000000' } },
  total: { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF000000' } },
  title: { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF000000' } },
  red:   { name: 'Calibri', size: 10, color: { argb: 'FFC00000' } },
  redb:  { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFC00000' } },
};
const FILL = {
  hdr:    { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4E8D8' } },  // 연한 살구 (헤더)
  total:  { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8C9A8' } },  // 중간 살구 (총합계)
  subtot: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } },  // 흰색 (소계)
  odd:    { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } },  // 흰색
  even:   { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } },  // 흰색
  gc:     { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } },  // 흰색
  imed:   { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } },  // 흰색
  title:  { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4E8D8' } },  // 연한 살구 (제목)
  warn:   { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF99' } },  // 노란 경고 (유지)
};
const BORDER_THIN = {
  top:    { style: 'thin', color: { argb: 'FF000000' } },
  left:   { style: 'thin', color: { argb: 'FF000000' } },
  bottom: { style: 'thin', color: { argb: 'FF000000' } },
  right:  { style: 'thin', color: { argb: 'FF000000' } },
};
// 데이터 행용: 상하는 hair(매우 얇음), 좌우는 thin 유지
const BORDER_DATA = {
  top:    { style: 'hair',  color: { argb: 'FF000000' } },
  left:   { style: 'thin',  color: { argb: 'FF000000' } },
  bottom: { style: 'hair',  color: { argb: 'FF000000' } },
  right:  { style: 'thin',  color: { argb: 'FF000000' } },
};
const BORDER_TOTAL = {
  top:    { style: 'medium', color: { argb: 'FF000000' } },
  left:   { style: 'medium', color: { argb: 'FF000000' } },
  bottom: { style: 'medium', color: { argb: 'FF000000' } },
  right:  { style: 'medium', color: { argb: 'FF000000' } },
};
const NUM_FMT = '#,##0;[Red]-#,##0;"-"';
const TYPE_ORDER = { '소모품': 0, '시약': 1, '의약품': 2 };
const typeSort = (a, b) => {
  const ta = TYPE_ORDER[a] ?? 9; const tb = TYPE_ORDER[b] ?? 9;
  return ta !== tb ? ta - tb : a.localeCompare(b, 'ko');
};
const AL = (h, v) => ({ horizontal: h || 'left', vertical: v || 'middle', wrapText: false });

// ── 셀 스타일 헬퍼 ────────────────────────────────────────
function sc(cell, { value, font, fill, alignment, border, numFmt } = {}) {
  if (value !== undefined) cell.value = value;
  if (font)      cell.font      = font;
  if (fill)      cell.fill      = fill;
  if (alignment) cell.alignment = alignment;
  if (border)    cell.border    = border;
  if (numFmt)    cell.numFmt    = numFmt;
}
function hdrCell(ws, r, c, v, span = 1) {
  const cell = ws.getCell(r, c);
  sc(cell, { value: v, font: F.hdr, fill: FILL.hdr, alignment: AL('center'), border: BORDER_THIN });
  if (span > 1) ws.mergeCells(r, c, r, c + span - 1);
  ws.getRow(r).height = 18;
}
function numCell(ws, r, c, v, fill, bold = false) {
  const nv = Math.round(toN(v));
  const cell = ws.getCell(r, c);
  sc(cell, {
    value: nv,
    font: nv < 0 ? (bold ? F.redb : F.red) : (bold ? F.total : F.base),
    fill: fill || FILL.odd,
    alignment: AL('right'),
    border: BORDER_DATA,
    numFmt: NUM_FMT,
  });
}
function txtCell(ws, r, c, v, fill, bold = false, center = false) {
  sc(ws.getCell(r, c), {
    value: v || null,
    font: bold ? F.bold : F.base,
    fill: fill || FILL.odd,
    alignment: AL(center ? 'center' : 'left'),
    border: BORDER_DATA,
  });
}
function titleRow(ws, r, c, v, span, rowH = 22) {
  const cell = ws.getCell(r, c);
  sc(cell, { value: v, font: F.title, fill: FILL.title, alignment: AL('center', 'center'), border: BORDER_THIN });
  if (span > 1) ws.mergeCells(r, c, r, c + span - 1);
  ws.getRow(r).height = rowH;
}
function totalRow(ws, r, numCols, numVals, textCols, textVals) {
  numCols.forEach((c, i) => {
    const cell = ws.getCell(r, c);
    sc(cell, { value: Math.round(toN(numVals[i])) || null, font: F.total, fill: FILL.total, alignment: AL('right'), border: BORDER_TOTAL, numFmt: NUM_FMT });
  });
  textCols.forEach((c, i) => {
    sc(ws.getCell(r, c), { value: textVals[i] || null, font: F.total, fill: FILL.total, alignment: AL('center'), border: BORDER_TOTAL });
  });
  ws.getRow(r).height = 18;
}
function subtotRow(ws, r, textCols, textVals, numCols, numVals) {
  textCols.forEach((c, i) => sc(ws.getCell(r, c), { value: textVals[i] || null, font: F.bold, fill: FILL.subtot, alignment: AL('center'), border: BORDER_THIN }));
  numCols.forEach((c, i) => { const cell = ws.getCell(r, c); sc(cell, { value: Math.round(toN(numVals[i])) || null, font: F.bold, fill: FILL.subtot, alignment: AL('right'), border: BORDER_THIN, numFmt: NUM_FMT }); });
  ws.getRow(r).height = 18;
}
function cw(ws, arr) { arr.forEach(([c, w]) => ws.getColumn(c).width = w); }

// ── 데이터 시트 공통 ──────────────────────────────────────
function writeDataSheet(ws, headers, rows, numCols, colWidths, sumCols) {
  const hasSumRow = sumCols && sumCols.length > 0;
  const hdrRow    = hasSumRow ? 2 : 1;
  const dataStart = hdrRow + 1;
  const numSet    = new Set(numCols);

  // 헤더
  headers.forEach((h, i) => hdrCell(ws, hdrRow, i + 1, h));

  // 데이터 (먼저 쓰면서 열합계 누적)
  const colTotals = {};
  rows.forEach((row, ri) => {
    const r    = dataStart + ri;
    const fill = ri % 2 === 0 ? FILL.odd : FILL.even;
    row.forEach((v, ci) => {
      const c = ci + 1;
      if (numSet.has(c)) {
        const rounded = Math.round(toN(v));
        if (hasSumRow && sumCols.includes(c)) {
          colTotals[c] = (colTotals[c] || 0) + rounded;
        }
        // 빈셀도 0 표기
        const cell = ws.getCell(r, c);
        cell.value = rounded;
        cell.font  = F.base;
        cell.fill  = fill;
        cell.alignment = AL('right');
        cell.border = BORDER_DATA;
        cell.numFmt = NUM_FMT;
      } else {
        txtCell(ws, r, c, v, fill);
      }
    });
    ws.getRow(r).height = 18;
  });

  // 1행: 반올림된 셀값의 합산
  if (hasSumRow) {
    sumCols.forEach(c => {
      const total = colTotals[c] || 0;
      if (!total) return;
      const cell  = ws.getCell(1, c);
      cell.value  = total;
      cell.font   = F.bold;
      cell.numFmt = NUM_FMT;
      cell.alignment = AL('right');
    });
    ws.getRow(1).height = 18;
  }

  colWidths.forEach((w, i) => ws.getColumn(i + 1).width = w);
  ws.views = [{ state: 'frozen', ySplit: hdrRow }];
}

// ── 피벗: 거래처 ──────────────────────────────────────────
function writePivotVendor(ws, gcVendors, imedVendors) {
  [[1, '구분'], [2, '공급업체'], [3, '합계 : 공급가액'], [4, '합계 : 부가세'], [5, '합계 : 합계금액']]
    .forEach(([c, v]) => hdrCell(ws, 1, c, v));
  let r = 2;
  let firstGC = true;
  gcVendors.forEach(v => {
    const fill = FILL.gc;
    txtCell(ws, r, 1, firstGC ? 'GC케어' : null, fill, firstGC);
    txtCell(ws, r, 2, v.공급업체, fill);
    [3, 4, 5].forEach((c, i) => numCell(ws, r, c, [v.공급가액, v.부가세, v.합계금액][i], fill));
    ws.getRow(r).height = 18; r++; firstGC = false;
  });
  const gcS = [sumF(gcVendors, '공급가액'), sumF(gcVendors, '부가세'), sumF(gcVendors, '합계금액')];
  subtotRow(ws, r, [1, 2], ['GC케어 요약', null], [3, 4, 5], gcS);
  [1,2,3,4,5].forEach(c => { ws.getCell(r, c).fill = FILL.hdr; }); r++;
  let firstIM = true;
  imedVendors.forEach(v => {
    const fill = FILL.imed;
    txtCell(ws, r, 1, firstIM ? '아이메드' : null, fill, firstIM);
    txtCell(ws, r, 2, v.공급업체, fill);
    [3, 4, 5].forEach((c, i) => numCell(ws, r, c, [v.공급가액, v.부가세, v.합계금액][i], fill));
    ws.getRow(r).height = 18; r++; firstIM = false;
  });
  const imS = [sumF(imedVendors, '공급가액'), sumF(imedVendors, '부가세'), sumF(imedVendors, '합계금액')];
  subtotRow(ws, r, [1, 2], ['아이메드 요약', null], [3, 4, 5], imS);
  [1,2,3,4,5].forEach(c => { ws.getCell(r, c).fill = FILL.hdr; }); r++;
  totalRow(ws, r, [3, 4, 5], [gcS[0] + imS[0], gcS[1] + imS[1], gcS[2] + imS[2]], [1, 2], ['총합계', null]);
  cw(ws, [[1, 14], [2, 22], [3, 18], [4, 16], [5, 18]]);
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

// ── 피벗: 부서/자재구분 ───────────────────────────────────
function writePivotDept(ws, data) {
  [[1, '의뢰부서'], [2, '자재구분'], [3, '합계 : 공급가액'], [4, '합계 : 부가세'], [5, '합계 : 합계금액']]
    .forEach(([c, v]) => hdrCell(ws, 1, c, v));

  const sorted = [...data].sort((a, b) => {
    const dc = a.의뢰부서.localeCompare(b.의뢰부서, 'ko');
    return dc !== 0 ? dc : typeSort(a.자재구분, b.자재구분);
  });

  let r = 2, prev = null, groupStartRow = 2;
  sorted.forEach((d, ri) => {
    const fill = ri % 2 === 0 ? FILL.odd : FILL.even;
    const isNewGroup = d.의뢰부서 !== prev;

    // 이전 그룹 병합 + 정렬
    if (isNewGroup && prev !== null) {
      if (r - 1 > groupStartRow) ws.mergeCells(groupStartRow, 1, r - 1, 1);
      ws.getCell(groupStartRow, 1).alignment = { horizontal: 'center', vertical: 'middle' };
    }
    if (isNewGroup) groupStartRow = r;

    txtCell(ws, r, 1, isNewGroup ? d.의뢰부서 : null, fill, true);
    txtCell(ws, r, 2, d.자재구분, fill);
    [3, 4, 5].forEach((c, i) => numCell(ws, r, c, [d.공급가액, d.부가세, d.합계금액][i], fill));
    ws.getRow(r).height = 18; r++; prev = d.의뢰부서;
  });

  // 마지막 그룹 병합 + 정렬
  if (r - 1 > groupStartRow) ws.mergeCells(groupStartRow, 1, r - 1, 1);
  ws.getCell(groupStartRow, 1).alignment = { horizontal: 'center', vertical: 'middle' };

  totalRow(ws, r, [3, 4, 5], [sumF(sorted, '공급가액'), sumF(sorted, '부가세'), sumF(sorted, '합계금액')], [1, 2], ['총합계', null]);
  cw(ws, [[1, 16], [2, 10], [3, 18], [4, 16], [5, 18]]);
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

// ── 피벗: 품목별 ──────────────────────────────────────────
function writePivotItem(ws, data, isUsage = false) {
  const q = isUsage ? '합계 : 사용수량(입)' : '합계 : 수량';
  const a = isUsage ? '합계 : 사용공급가' : '합계 : 공급가액';
  [[1, '자재코드'], [2, '자재명'], [3, q], [4, a]].forEach(([c, v]) => hdrCell(ws, 1, c, v));
  let r = 2;
  data.forEach((d, ri) => {
    const fill = ri % 2 === 0 ? FILL.odd : FILL.even;
    txtCell(ws, r, 1, d.코드, fill); txtCell(ws, r, 2, d.명, fill);
    numCell(ws, r, 3, d.수량, fill); numCell(ws, r, 4, d.금액, fill);
    ws.getRow(r).height = 18; r++;
  });
  totalRow(ws, r, [3, 4], [sumF(data, '수량'), sumF(data, '금액')], [1, 2], ['총합계', null]);
  cw(ws, [[1, 14], [2, 45], [3, 16], [4, 16]]);
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

// ── 피벗: 사용현황 부서별 ─────────────────────────────────
// 주의: 5% 시트는 byDeptUsage5pct로 이미 계산된 데이터를 넘겨야 함
function writePivotUsageDept(ws, data, cols3) {
  [[1, '부서명'], [2, '자재구분'], [3, cols3[0]], [4, cols3[1]], [5, cols3[2]]]
    .forEach(([c, v]) => hdrCell(ws, 1, c, v));

  const sorted = [...data].sort((a, b) => {
    const dc = a.부서명.localeCompare(b.부서명, 'ko');
    return dc !== 0 ? dc : typeSort(a.자재구분, b.자재구분);
  });

  // 행 데이터 쓰면서 합계 누적 (반올림 후 합산)
  let r = 2, prev = null, groupStartRow = 2;
  const totals = { sup: 0, vat: 0, tot: 0 };
  sorted.forEach((d, ri) => {
    const fill = ri % 2 === 0 ? FILL.odd : FILL.even;
    const isNewGroup = d.부서명 !== prev;

    if (isNewGroup && prev !== null) {
      if (r - 1 > groupStartRow) ws.mergeCells(groupStartRow, 1, r - 1, 1);
      ws.getCell(groupStartRow, 1).alignment = { horizontal: 'center', vertical: 'middle' };
    }
    if (isNewGroup) groupStartRow = r;

    txtCell(ws, r, 1, isNewGroup ? d.부서명 : null, fill, true);
    txtCell(ws, r, 2, d.자재구분, fill);
    const supV = d.사용공급가;
    const vatV = d.사용부가세;
    const totV = d.사용합계;
    totals.sup += Math.round(supV);
    totals.vat += Math.round(vatV);
    totals.tot += Math.round(totV);
    numCell(ws, r, 3, supV, fill);
    numCell(ws, r, 4, vatV, fill);
    numCell(ws, r, 5, totV, fill);
    ws.getRow(r).height = 18; r++; prev = d.부서명;
  });

  if (r - 1 > groupStartRow) ws.mergeCells(groupStartRow, 1, r - 1, 1);
  ws.getCell(groupStartRow, 1).alignment = { horizontal: 'center', vertical: 'middle' };

  totalRow(ws, r, [3, 4, 5], [totals.sup, totals.vat, totals.tot], [1, 2], ['총합계', null]);
  cw(ws, [[1, 16], [2, 10], [3, 18], [4, 16], [5, 18]]);
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

// ── 결재 시트 ─────────────────────────────────────────────
function writeKyuljai(ws, year, month, label, vendors, vendorMap, gcRow) {
  const ym = `${year}/${String(month).padStart(2, '0')}/01 ~ ${year}/${String(month).padStart(2, '0')}/31`;

  // 1행: 제목 (A1~I3 병합, 가운데 정렬)
  const titleCell = ws.getCell(1, 1);
  titleCell.value = `${year}년 ${month}월 ${label} 마감내역`;
  titleCell.font      = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FF000000' } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.mergeCells(1, 1, 3, 9);
  ws.getRow(1).height = 28;
  ws.getRow(2).height = 14;
  ws.getRow(3).height = 14;

  // 4행: 기준일
  const c4 = ws.getCell(4, 6); c4.value = `기준: ${ym}`; c4.font = F.base; c4.alignment = AL('right');
  ws.mergeCells(4, 6, 4, 9);
  ws.getRow(4).height = 18;
  [['순번', 1], ['공급업체', 2], ['사업자등록번호', 3], ['구매총액', 4], ['결제방법', 7], ['결제기일', 8], ['비고', 9]]
    .forEach(([v, c]) => hdrCell(ws, 5, c, v));
  ['', '', '', '공급가액', '부가세액', '합계금액', '', '', ''].forEach((v, i) => {
    const cell = ws.getCell(6, i + 1);
    cell.font = F.hdr; cell.fill = FILL.hdr; cell.alignment = AL('center'); cell.border = BORDER_THIN;
    if (v) cell.value = v;
  });
  [1, 2, 3, 7, 8, 9].forEach(c => ws.mergeCells(5, c, 6, c));
  ws.mergeCells(5, 4, 5, 6);
  ws.getRow(5).height = 18; ws.getRow(6).height = 18;
  let r = 7;
  vendors.forEach((v, i) => {
    const fill = i % 2 === 0 ? FILL.odd : FILL.even;
    const vm   = (vendorMap && vendorMap[v.공급업체]) || null;
    const isUnreg = !vm;
    const rowFill = isUnreg ? FILL.warn : fill;

    const bizNo     = vm ? vm.biz_no      : '';
    const payMethod = vm ? vm.pay_method  : '';
    const credit    = vm ? vm.credit_days : '';

    txtCell(ws, r, 1, i + 1, rowFill, false, true);
    txtCell(ws, r, 2, v.공급업체 + (isUnreg ? ' ⚠ 거래처 미등록' : ''), rowFill, isUnreg);
    txtCell(ws, r, 3, bizNo,     rowFill, false, true);
    numCell(ws, r, 4, v.공급가액, rowFill);
    numCell(ws, r, 5, v.부가세,   rowFill);
    numCell(ws, r, 6, v.합계금액, rowFill);
    txtCell(ws, r, 7, payMethod, rowFill, false, true);
    txtCell(ws, r, 8, credit,    rowFill, false, true);
    txtCell(ws, r, 9, '',        rowFill);
    ws.getRow(r).height = 18; r++;
  });
  // GC케어 행 (아이메드 보고서 마지막에 추가)
  if (gcRow) {
    const fill   = vendors.length % 2 === 0 ? FILL.odd : FILL.even;
    const gcVm   = vendorMap?.['GC케어'] || null;
    const gcBiz  = gcVm?.biz_no      || '';
    const gcPay  = gcVm?.pay_method  || '';
    const gcCredit = gcVm?.credit_days != null ? String(gcVm.credit_days) : '';
    txtCell(ws, r, 1, vendors.length + 1, fill, false, true);
    txtCell(ws, r, 2, 'GC케어', fill, false);
    txtCell(ws, r, 3, gcBiz,    fill, false, true);
    numCell(ws, r, 4, gcRow.공급가액, fill);
    numCell(ws, r, 5, gcRow.부가세,   fill);
    numCell(ws, r, 6, gcRow.합계금액, fill);
    txtCell(ws, r, 7, gcPay,    fill, false, true);
    txtCell(ws, r, 8, gcCredit, fill, false, true);
    txtCell(ws, r, 9, '',       fill);
    ws.getRow(r).height = 18; r++;
  }

  ws.mergeCells(r, 1, r, 3);
  totalRow(ws, r, [4, 5, 6],
    [sumF(vendors, '공급가액') + (gcRow?.공급가액||0),
     sumF(vendors, '부가세')   + (gcRow?.부가세  ||0),
     sumF(vendors, '합계금액') + (gcRow?.합계금액||0)],
    [1, 7, 8, 9], ['총합계', '', '', '']);
  cw(ws, [[1, 8], [2, 22], [3, 16], [4, 16], [5, 14], [6, 16], [7, 10], [8, 10], [9, 12]]);
  ws.views = [{ state: 'frozen', ySplit: 6 }];
}

// ── 부서별 금액 시트 ─────────────────────────────────────
function writeDeptAmount(ws, month, depts) {
  // 1행: 제목 (A~E 병합)
  ws.mergeCells(1, 1, 1, 5);
  const tc = ws.getCell(1, 1);
  tc.value = `${month}월 부서별 구매 내역`;
  tc.font      = { name: 'Calibri', size: 14, bold: true };
  tc.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 28;

  // 2행: (단위 : 원) 우측
  ws.getCell(2, 5).value = '(단위 : 원)';
  ws.getCell(2, 5).font = F.base;
  ws.getCell(2, 5).alignment = AL('right');
  ws.getRow(2).height = 16;

  // 3행: 헤더
  [[1,'의뢰부서'],[2,'상태'],[3,'합계: 공급가액'],[4,'합계: 부가세'],[5,'합계: 합계금액']]
    .forEach(([c, v]) => hdrCell(ws, 3, c, v));
  ws.getRow(3).height = 18;

  // 정렬 (의료공통 계열은 맨 아래)
  const isLast = name => /의료공통|의료 공통/i.test(name);
  const sorted = [...depts].sort((a, b) => {
    const aLast = isLast(a.의뢰부서), bLast = isLast(b.의뢰부서);
    if (aLast !== bLast) return aLast ? 1 : -1;
    const dc = a.의뢰부서.localeCompare(b.의뢰부서, 'ko');
    return dc !== 0 ? dc : typeSort(a.자재구분, b.자재구분);
  });

  // 부서별 그룹핑
  const groups = [];
  sorted.forEach(d => {
    const last = groups[groups.length - 1];
    if (last && last.name === d.의뢰부서) last.items.push(d);
    else groups.push({ name: d.의뢰부서, items: [d] });
  });

  const FILL_NONE = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
  const BORDER_DOTTED_BOTTOM = {
    top: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' },
    bottom: { style: 'dotted' }
  };
  const BORDER_SUBTOT = {
    top: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' },
    bottom: { style: 'medium' }
  };

  let r = 4;
  groups.forEach((g, gi) => {
    // GC케어(의약품 없음)에서 값이 모두 0인 그룹 생략
    const groupTotal = sumF(g.items, '합계금액');
    if (!groupTotal) return;
    const groupStart = r;
    g.items.forEach((d, di) => {
      // 데이터 행: 흰 배경, 일반 폰트
      const setCell = (c, v, isNum) => {
        const cell = ws.getCell(r, c);
        if (isNum) {
          cell.value = Math.round(toN(v));
          cell.numFmt = NUM_FMT;
        } else {
          cell.value = v || null;
        }
        cell.font      = di === 0 && c === 1 ? F.bold : F.base;
        cell.fill      = FILL_NONE;
        cell.alignment = isNum ? AL('right') : (c === 1 ? AL('center') : AL('left'));
        cell.border    = BORDER_DOTTED_BOTTOM;
      };
      setCell(1, di === 0 ? d.의뢰부서 : null, false);
      setCell(2, d.자재구분, false);
      setCell(3, d.공급가액, true);
      setCell(4, d.부가세,   true);
      setCell(5, d.합계금액, true);
      ws.getRow(r).height = 18; r++;
    });

    // 부서명 셀 병합
    if (r - 1 > groupStart) ws.mergeCells(groupStart, 1, r - 1, 1);
    ws.getCell(groupStart, 1).alignment = { horizontal: 'center', vertical: 'middle' };

    // 소계 행: 굵은 폰트, 하단 medium 테두리
    ws.mergeCells(r, 1, r, 2);
    const sc1 = ws.getCell(r, 1);
    sc1.value = g.name + ' 소계'; sc1.font = F.bold; sc1.fill = FILL_NONE;
    sc1.alignment = { horizontal: 'center', vertical: 'middle' };
    sc1.border = BORDER_SUBTOT;
    [3, 4, 5].forEach((c, i) => {
      const vals = [sumF(g.items,'공급가액'), sumF(g.items,'부가세'), sumF(g.items,'합계금액')];
      const cell = ws.getCell(r, c);
      cell.value = Math.round(vals[i]); cell.font = F.bold; cell.fill = FILL_NONE;
      cell.alignment = AL('right'); cell.border = BORDER_SUBTOT; cell.numFmt = NUM_FMT;
    });
    ws.getRow(r).height = 18; r++;
  });

  // 총합계 블록: 27~30행 구조
  //  27행: A열(총합계 4행 병합) + B비어있음 + C~E 전체합계
  //  28행: B=의약품 + 금액
  //  29행: B=시약   + 금액
  //  30행: B=소모품 + 금액
  const 소모품data = sorted.filter(d => d.자재구분 === '소모품');
  const 시약data   = sorted.filter(d => d.자재구분 === '시약');
  const 의약품data = sorted.filter(d => d.자재구분 === '의약품');
  const typeRows = [['의약품', 의약품data], ['시약', 시약data], ['소모품', 소모품data]]
    .filter(([, data]) => data.length > 0);

  if (typeRows.length > 0) {
    const totStart = r;

    // 첫 행: B열 비어있음 + C~E 전체합계 금액
    const bc = ws.getCell(r, 2);
    bc.fill = FILL.total; bc.border = BORDER_TOTAL;
    [3, 4, 5].forEach((c, i) => {
      const vals = [sumF(sorted, '공급가액'), sumF(sorted, '부가세'), sumF(sorted, '합계금액')];
      const cell = ws.getCell(r, c);
      cell.value = Math.round(vals[i]); cell.font = F.total; cell.fill = FILL.total;
      cell.alignment = AL('right'); cell.border = BORDER_TOTAL; cell.numFmt = NUM_FMT;
    });
    ws.getRow(r).height = 18; r++;

    // 나머지 행: B열 라벨 + 금액 (색 없음, 내부 가로선 thin)
    typeRows.forEach(([label, data], ti) => {
      const isLast = ti === typeRows.length - 1;
      const rowBorder = {
        top:    { style: 'thin' },
        left:   { style: 'medium' },
        right:  { style: 'medium' },
        bottom: isLast ? { style: 'medium' } : { style: 'thin' },
      };
      const lc2 = ws.getCell(r, 2);
      lc2.value = label; lc2.font = F.base; lc2.fill = FILL.odd;
      lc2.alignment = AL('center'); lc2.border = rowBorder;
      [3, 4, 5].forEach((c, i) => {
        const vals = [sumF(data, '공급가액'), sumF(data, '부가세'), sumF(data, '합계금액')];
        const cell = ws.getCell(r, c);
        cell.value = Math.round(vals[i]); cell.font = F.base; cell.fill = FILL.odd;
        cell.alignment = AL('right'); cell.border = rowBorder; cell.numFmt = NUM_FMT;
      });
      ws.getRow(r).height = 18; r++;
    });

    // A열: 총합계 4행 세로 병합
    const totEnd = r - 1;
    ws.mergeCells(totStart, 1, totEnd, 1);
    const tc = ws.getCell(totStart, 1);
    tc.value = '총합계'; tc.font = F.total; tc.fill = FILL.total;
    tc.alignment = { horizontal: 'center', vertical: 'middle' };
    tc.border = BORDER_TOTAL;
  }

  cw(ws, [[1,20],[2,10],[3,18],[4,16],[5,18]]);
  ws.views = [{ state: 'frozen', ySplit: 3 }];
}

// ── 사용현황 5% 시트 ─────────────────────────────────────
function writeUsageWith5pct(ws, headers, rows, numCols, colWidths) {
  const sumSet = new Set(numCols);

  // 2행: 헤더
  headers.forEach((h, i) => hdrCell(ws, 2, i + 1, h));

  // 3행~: 데이터 (먼저 쓰고 열합계 계산)
  const colTotals = {};
  rows.forEach((row, ri) => {
    const r    = ri + 3;
    const fill = ri % 2 === 0 ? FILL.odd : FILL.even;
    row.forEach((v, ci) => {
      const c = ci + 1;
      if (sumSet.has(c)) {
        const rounded = Math.round(toN(v));
        colTotals[c] = (colTotals[c] || 0) + rounded;
        // 빈셀도 0 표기
        const cell = ws.getCell(r, c);
        cell.value = rounded;
        cell.font  = F.base;
        cell.fill  = fill;
        cell.alignment = AL('right');
        cell.border = BORDER_DATA;
        cell.numFmt = NUM_FMT;
      } else {
        txtCell(ws, r, c, v, fill);
      }
    });
    ws.getRow(r).height = 18;
  });

  // 1행: 반올림된 셀값의 합산 (엑셀 표시값과 일치)
  sumSet.forEach(c => {
    const total = colTotals[c] || 0;
    if (!total) return;
    const cell  = ws.getCell(1, c);
    cell.value  = total;
    cell.font   = F.bold;
    cell.numFmt = NUM_FMT;
    cell.alignment = AL('right');
  });
  ws.getRow(1).height = 18;

  colWidths.forEach((w, i) => ws.getColumn(i + 1).width = w);
  ws.views = [{ state: 'frozen', ySplit: 2 }];
}

// ── SAP 시트 ─────────────────────────────────────────────
function writeSAP(ws, year, month, branch, sapRows, totalSup, cc, account, vendorMap) {
  const BORDER_MEDIUM = {
    top:    { style: 'medium' }, bottom: { style: 'medium' },
    left:   { style: 'medium' }, right:  { style: 'medium' }
  };
  const MEDIUM_BOTTOM = { bottom: { style: 'medium' } };

  // 2행: 요약정보
  ws.getCell(2, 4).value  = account; ws.getCell(2, 4).font = F.bold;
  ws.getCell(2, 7).value  = totalSup; ws.getCell(2, 7).font = F.bold; ws.getCell(2, 7).numFmt = NUM_FMT;
  ws.getCell(2, 10).value = '양식 기준'; ws.getCell(2, 10).font = F.base;
  ws.getCell(2, 12).value = cc; ws.getCell(2, 12).font = F.base;
  ws.getRow(2).height = 18;

  // 3행: 헤더 (빈 컬럼 포함 전체 채우기)
  [
    [1,''], [2,'거래처'], [3,'사업자 번호'], [4,'계정'],
    [5,''], [6,''], [7,'공급가액'], [8,''],
    [9,'기준일'], [10,'적요'], [11,''], [12,'CC'], [13,'지급일'], [14,'전표번호']
  ].forEach(([c,v]) => hdrCell(ws, 3, c, v || ' '));
  ws.getRow(3).height = 18;

  // 데이터 행
  let prevVendor = null;
  let vendorCount = 0;  // 현재 거래처 내 10줄 카운터 (전체 기준)

  sapRows.forEach((r, ri) => {
    const rowNum = ri + 4;
    const isUnreg = vendorMap && !vendorMap[r.거래처];
    const fill    = isUnreg ? FILL.warn : (ri % 2 === 0 ? FILL.odd : FILL.even);

    // 거래처 마스터에서 사업자번호/지급일 가져오기
    const vm      = vendorMap?.[r.거래처];
    const bizNo   = (vm?.biz_no || r.사업자번호 || '').replace(/-/g, '');
    const payDay  = vm?.credit_days != null ? String(vm.credit_days) : (r.지급일 || '');

    // 빈 셀도 테두리/배경 유지 (복붙 시 열 구조 유지)
    const blankCell = (c) => {
      const cell = ws.getCell(rowNum, c);
      cell.fill   = fill;
      cell.border = BORDER_DATA;
    };

    blankCell(1);  // A열 빈
    txtCell(ws, rowNum, 2,  r.거래처,       fill);
    txtCell(ws, rowNum, 3,  bizNo,           fill, false, true);
    txtCell(ws, rowNum, 4,  account,         fill, false, true);
    blankCell(5);  // E열 빈
    blankCell(6);  // F열 빈
    numCell(ws, rowNum, 7,  r.공급가액,     fill);
    blankCell(8);  // H열 빈
    txtCell(ws, rowNum, 9,  r.기준일,       fill, false, true);
    txtCell(ws, rowNum, 10, r.적요,         fill);
    blankCell(11); // K열 빈
    txtCell(ws, rowNum, 12, cc,             fill, false, true);
    txtCell(ws, rowNum, 13, payDay,         fill, false, true);
    txtCell(ws, rowNum, 14, r.전표번호 || '', fill);
    ws.getRow(rowNum).height = 18;

    // 굵은선: 거래처 변경 시 OR 10줄마다 (복붙 범위 D~L 기준)
    const isVendorChange = r.거래처 !== prevVendor;
    if (isVendorChange) { vendorCount = 0; }
    vendorCount++;
    prevVendor = r.거래처;

    const needThickBottom = vendorCount % 10 === 0;  // 10줄마다
    const needThickVendor = isVendorChange && ri > 0; // 거래처 변경 시 이전 행 하단

    if (needThickVendor) {
      // 이전 행 하단에 굵은선
      for (let c = 1; c <= 14; c++) {
        const cell = ws.getCell(rowNum - 1, c);
        const existing = cell.border || {};
        cell.border = { ...existing, bottom: { style: 'medium' } };
      }
    }
    if (needThickBottom) {
      // 현재 행 하단에 굵은선
      for (let c = 1; c <= 14; c++) {
        const cell = ws.getCell(rowNum, c);
        const existing = cell.border || {};
        cell.border = { ...existing, bottom: { style: 'medium' } };
      }
    }
  });

  // 열 너비 원본과 동일
  cw(ws, [
    [1, 6], [2, 18], [3, 14], [4, 12],
    [5, 4], [6, 4], [7, 16], [8, 4],
    [9, 12], [10, 52], [11, 4],
    [12, 12], [13, 8], [14, 14]
  ]);
  ws.views = [{ state: 'frozen', ySplit: 3 }];
}

// ── 거래처 관리 시트 ─────────────────────────────────────
function writeVendorMasterSheet(ws, vendors) {
  [['거래처명', 1], ['사업자등록번호', 2], ['여신기간(일)', 3], ['결제방법', 4]]
    .forEach(([v, c]) => hdrCell(ws, 1, c, v));
  vendors.forEach((v, ri) => {
    const r = ri + 2;
    const fill = ri % 2 === 0 ? FILL.odd : FILL.even;
    txtCell(ws, r, 1, v.vendor_name, fill);
    txtCell(ws, r, 2, v.biz_no, fill);
    numCell(ws, r, 3, v.credit_days, fill);
    txtCell(ws, r, 4, v.pay_method, fill, false, true);
    ws.getRow(r).height = 18;
  });
  cw(ws, [[1, 24], [2, 16], [3, 12], [4, 12]]);
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

// ── 수불 집계표 ───────────────────────────────────────────
function writeSubul(ws, year, month, branch, items, R) {
  // 열 너비 설정
  ws.getColumn(1).width = 11.875;
  ws.getColumn(2).width = 57.25;
  ws.getColumn(3).width = 11.5;
  for (let c = 4; c <= 13; c++) ws.getColumn(c).width = 20;
  ws.getColumn(14).width = 12.625;
  // 확대율 85%
  ws.views = [{ zoomScale: 85 }];
  titleRow(ws, 1, 1, '원가집계표', 13, 30);
  ws.getCell(1, 1).font = { name: 'Calibri', size: 16, bold: true, color: { argb: 'FF000000' } };
  ws.getCell(1, 1).alignment = { horizontal: 'center', vertical: 'middle' };
  txtCell(ws, 2, 1, '회사명 : GC케어', null, true);
  txtCell(ws, 2, 13, '-VAT', null, false, true);  // M열(13)으로 이동
  [['품목코드', 1], ['품목명', 2], ['구분', 3], ['기초', 4], ['증가', 7], ['감소', 9], ['기말', 11]]
    .forEach(([v, c]) => hdrCell(ws, 3, c, v));
  ws.mergeCells(3, 4, 3, 6); ws.mergeCells(3, 7, 3, 8); ws.mergeCells(3, 9, 3, 10); ws.mergeCells(3, 11, 3, 13);
  ['', '', '', '수량', '단가', '금액', '수량', '금액', '수량', '금액', '수량', '단가', '금액']
    .forEach((v, i) => {
      const cell = ws.getCell(4, i + 1);
      cell.font      = F.hdr;
      cell.fill      = FILL.hdr;
      cell.alignment = AL('center');
      cell.border    = BORDER_DATA;
      if (v) cell.value = v;
    });
  [1, 2, 3].forEach(c => ws.mergeCells(3, c, 4, c));
  ws.getRow(3).height = 22; ws.getRow(4).height = 22;

  // 회계 표기는 전역 NUM_FMT 사용

  const sorted = [...items]
    .filter(it => String(it.type || '').trim() !== '의약품')
    .sort((a, b) => {
      const ta = TYPE_ORDER[String(a.type||'')] ?? 9;
      const tb = TYPE_ORDER[String(b.type||'')] ?? 9;
      if (ta !== tb) return ta - tb;
      return String(a.code || '').localeCompare(String(b.code || ''), 'ko');
    });

  let r = 5;
  const FILL_SOMO = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F0F8' } }; // 연한 파란 계열 (소모품)
  const FILL_SIYK = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E8' } }; // 연한 초록 계열 (시약)

  sorted.forEach((it, ri) => {
    const fill    = ri % 2 === 0 ? FILL.odd : FILL.even;
    const typeFill = String(it.type||'').trim() === '시약' ? FILL_SIYK : FILL_SOMO;
    const 기초    = it.기초 || 0;
    const 기초수량  = Math.round(it.기초수량 || 0);
    const 증가수량  = Math.round(it.증가수량 || 0);
    const 감소수량  = Math.round(it.감소수량 || 0);
    const 기말     = 기초 + it.증가 - it.감소;
    const 기말수량  = 기초수량 + 증가수량 - 감소수량;

    const accCell = (c, v) => {
      const cell = ws.getCell(r, c);
      cell.value = Math.round(toN(v));
      cell.font = cell.value < 0 ? F.red : F.base;
      cell.fill = fill || FILL.odd;
      cell.alignment = AL('right');
      cell.border = BORDER_DATA;
      cell.numFmt = NUM_FMT;
    };

    txtCell(ws, r, 1, it.code, FILL.odd);
    txtCell(ws, r, 2, it.name, typeFill);
    txtCell(ws, r, 3, it.type, typeFill, false, true);
    accCell(4,  기초수량);
    accCell(5,  0);  // 기초단가
    accCell(6,  기초);
    accCell(7,  증가수량);
    accCell(8,  it.증가);
    accCell(9,  감소수량);
    accCell(10, it.감소);
    accCell(11, 기말수량);
    accCell(12, 0);  // 기말단가
    accCell(13, 기말);
    ws.getRow(r).height = 18; r++;
  });

  const t기초    = sorted.reduce((s, it) => s + (it.기초 || 0), 0);
  const t기초수량 = sorted.reduce((s, it) => s + Math.round(it.기초수량 || 0), 0);
  const tI       = sorted.reduce((s, it) => s + it.증가, 0);
  const tI수량   = sorted.reduce((s, it) => s + Math.round(it.증가수량 || 0), 0);
  const tD       = sorted.reduce((s, it) => s + it.감소, 0);
  const tD수량   = sorted.reduce((s, it) => s + Math.round(it.감소수량 || 0), 0);
  const t기말    = t기초 + tI - tD;
  const t기말수량 = t기초수량 + tI수량 - tD수량;
  ws.mergeCells(r, 1, r, 3);
  totalRow(ws, r, [4, 6, 7, 8, 9, 10, 11, 13],
    [t기초수량, t기초, tI수량, tI, tD수량, tD, t기말수량, t기말],
    [1], ['총합계']);
  // 단가 컬럼(5, 12) 총합계 색+0 채우기
  [5, 12].forEach(c => {
    const cell = ws.getCell(r, c);
    cell.value = 0; cell.font = F.total; cell.fill = FILL.total;
    cell.alignment = AL('right'); cell.border = BORDER_TOTAL; cell.numFmt = NUM_FMT;
  });
  cw(ws, [[1, 12], [2, 57], [3, 12], [4, 15], [5, 12], [6, 15], [7, 12], [8, 15], [9, 12], [10, 15], [11, 12], [12, 12], [13, 15]]);
  ws.views = [{ state: 'frozen', ySplit: 4 }];

  // ── 하단 요약 블록 (원본 구조 그대로) ──────────────────
  r += 2;

  // 1. 소모품/시약 소계 (C열 라벨, F/H/J/M열 금액)
  const somoItems = sorted.filter(it => String(it.type||'').trim() === '소모품');
  const siyakItems = sorted.filter(it => String(it.type||'').trim() === '시약');
  const subSum = (arr, key) => arr.reduce((s, it) => {
    if (key==='기초') return s+(it.기초||0);
    if (key==='증가') return s+it.증가;
    if (key==='감소') return s+it.감소;
    if (key==='기말') return s+(it.기초||0)+it.증가-it.감소;
    return s;
  }, 0);
  [['소모품', somoItems, FILL.gc], ['시약', siyakItems, FILL.imed]].forEach(([lbl, arr, fill]) => {
    txtCell(ws, r, 3, lbl, fill, true, true);
    numCell(ws, r, 6,  subSum(arr,'기초'), fill);
    numCell(ws, r, 8,  subSum(arr,'증가'), fill);
    numCell(ws, r, 10, subSum(arr,'감소'), fill);
    numCell(ws, r, 13, subSum(arr,'기말'), fill);
    ws.getRow(r).height = 18; r++;
  });

  r += 2;

  // 사용현황 집계값 (총계 박스에서 사용)
  const usageSomo = R.usageSomoum || [];
  const usageSiyk = R.usageSiyak  || [];
  const somo5 = (R.imedSiSoPivot5||[]).filter(d=>d.자재구분==='소모품');
  const siyk5 = R.siyakPivot5 || [];

  const uSup  = (arr) => arr.reduce((s,d)=>s+toN(d['사용공급가']),0);
  const uVat  = (arr) => arr.reduce((s,d)=>s+toN(d['사용부가세']),0);
  const uTot  = (arr) => arr.reduce((s,d)=>s+toN(d['사용합계']),0);
  const u5Sup = (arr) => arr.reduce((s,d)=>s+toN(d.사용공급가||0),0);
  const u5Vat = (arr) => arr.reduce((s,d)=>s+toN(d.사용부가세||0),0);
  const u5Tot = (arr) => arr.reduce((s,d)=>s+toN(d.사용합계||0),0);

  // 2. 총계 박스 — G열 2행 병합 라벨, H/I/J/K열
  // 5% 미적용: 공급가액=사용공급가합계, 부가세=사용부가세합계, 계=합계
  // 5% 적용:  공급가액=5%적용공급가합계, 부가세=5%적용부가세합계, 계=합계
  [[
    uSup(usageSomo)+uSup(usageSiyk),
    uVat(usageSomo)+uVat(usageSiyk),
    uTot(usageSomo)+uTot(usageSiyk),
    '5% 미적용', FILL.gc, null
  ],[
    u5Sup(somo5)+u5Sup(siyk5),
    u5Vat(somo5)+u5Vat(siyk5),
    u5Tot(somo5)+u5Tot(siyk5),
    '5% 적용', FILL.imed, '세금계산서 발행금액'
  ]].forEach(([supV, vatV, totV, bigoText, dataFill, memo]) => {
    const totStart = r;
    // 헤더행
    hdrCell(ws, r, 8, '공급가액');
    hdrCell(ws, r, 9, '부가세액');
    hdrCell(ws, r, 10, '계');
    hdrCell(ws, r, 11, '비고');
    ws.getRow(r).height = 18; r++;
    // 데이터행
    numCell(ws, r, 8,  supV, dataFill);
    numCell(ws, r, 9,  vatV, dataFill);
    numCell(ws, r, 10, totV, dataFill);
    const bc = ws.getCell(r, 11);
    bc.value=bigoText; bc.font=F.bold; bc.fill=FILL.warn; bc.alignment=AL('center'); bc.border=BORDER_THIN;
    if (memo) {
      ws.getCell(r, 12).value=memo; ws.getCell(r, 12).font=F.base; ws.getCell(r, 12).alignment=AL('left');
    }
    ws.getRow(r).height = 18;
    // G열 2행 병합 라벨
    ws.mergeCells(totStart, 7, r, 7);
    const lc = ws.getCell(totStart, 7);
    lc.value='총  계'; lc.font=F.bold; lc.fill=FILL.subtot;
    lc.alignment={horizontal:'center',vertical:'middle'}; lc.border=BORDER_THIN;
    r++;
  });

  r++;

  // 3. 수불부 감소금액 vs 사용현황 공급가액 차이 검증
  // 수불부 감소 합계(총계 5%미적용 공급가액) - 사용현황 공급가액
  const subulSomo = subSum(somoItems,'감소');
  const subulSiyk = subSum(siyakItems,'감소');
  [['소모품', subulSomo, uSup(usageSomo)], ['시약', subulSiyk, uSup(usageSiyk)]].forEach(([lbl, subulVal, usageVal]) => {
    const diffVal = Math.round(subulVal - usageVal);
    txtCell(ws, r, 9, lbl, null, false, false);
    const dc = ws.getCell(r, 10);
    dc.value = diffVal;
    dc.font = diffVal !== 0
      ? { name:'Calibri', size:10, color:{argb:'FFFF0000'}, bold:true }
      : F.base;
    dc.fill = FILL.odd; dc.alignment = AL('right');
    dc.border = BORDER_DATA; dc.numFmt = NUM_FMT;
    ws.getRow(r).height = 18; r++;
  });

  r++;

  // 4. 사용현황자료 블록 (F~J열)
  [[
    '5% 미적용', FILL.hdr,
    [uSup(usageSomo), uVat(usageSomo), uTot(usageSomo)],
    [uSup(usageSiyk), uVat(usageSiyk), uTot(usageSiyk)]
  ],[
    '5% 적용', FILL.warn,
    [u5Sup(somo5), u5Vat(somo5), u5Tot(somo5)],
    [u5Sup(siyk5), u5Vat(siyk5), u5Tot(siyk5)]
  ]].forEach(([tag, tagFill, somoRow, siykRow]) => {
    txtCell(ws, r, 6, '사용현황자료', FILL.subtot, true, true);
    const tc=ws.getCell(r,7); tc.value=tag; tc.font=F.bold; tc.fill=tagFill; tc.alignment=AL('center'); tc.border=BORDER_THIN;
    hdrCell(ws, r, 8, '공급가액');
    hdrCell(ws, r, 9, '부가세액');
    hdrCell(ws, r, 10, '계');
    ws.getRow(r).height = 18; r++;
    [['소모품', somoRow], ['시약', siykRow]].forEach(([lbl,[sup,vat,tot]]) => {
      txtCell(ws, r, 7, lbl, FILL.odd, false, true);
      numCell(ws, r, 8, sup, FILL.odd);
      numCell(ws, r, 9, vat, FILL.odd);
      numCell(ws, r, 10, tot, FILL.odd);
      ws.getRow(r).height = 18; r++;
    });
    r++;
  });
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

  // 새 시트의 데이터/서식을 기존 시트들 앞에 배치
  // newSheetWb의 첫 번째 시트를 그대로 유지하고 기존 시트들을 뒤에 추가
  for (const srcWs of existingWb.worksheets) {
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
    writePivotDept(wb.addWorksheet('GC케어 마감요약'), R.gcDepts.filter(d => d.공급가액 || d.부가세 || d.합계금액));
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
    const roundUp = v => Math.ceil(toN(v) * 1.05);  // ROUNDUP(*1.05, 0)
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

async function dlReport(label, vendors, depts, filename, gcRow) {
  const R = App.R; const wb = newWb();
  const isImed = label.includes('원재료');

  // 아이메드 보고서: 부서별 금액에 시약+소모품(5% 적용) 그룹핑 합산
  let deptsForAmount = depts;
  if (isImed && R.imedSiSoPivot5?.length) {
    const imedGroups = buildImedDeptGroups(R.closingDeptMaster || []);
    // 그룹별로 합산
    const groupedMap = {};
    R.imedSiSoPivot5.forEach(d => {
      const dept  = String(d.부서명  || '').trim();
      const type  = String(d.자재구분 || '').trim();
      // 그룹명 찾기
      const group = imedGroups.find(g => g.depts.includes(dept));
      const key   = (group ? group.displayName : dept) + '||' + type;
      if (!groupedMap[key]) groupedMap[key] = { 의뢰부서: group?.displayName || dept, 자재구분: type, 공급가액: 0, 부가세: 0, 합계금액: 0 };
      groupedMap[key].공급가액  += Math.round(d.사용공급가 || 0);
      groupedMap[key].부가세    += Math.round(d.사용부가세 || 0);
      groupedMap[key].합계금액  += Math.round(d.사용합계   || 0);
    });
    // 값 없어도 CLOSING_DEPT 마스터에 있는 부서는 0행으로 포함
    // 시약은 extra1='시약'인 부서만, 소모품은 전체 부서
    const siyakDeptNames = new Set(
      (R.closingDeptMaster || [])
        .filter(d => String(d.extra1 || '').trim() === '시약')
        .map(d => String(d.code_name || '').trim())
    );
    const masterKeys = imedGroups.length
      ? imedGroups.flatMap(g => {
          const keys = [g.displayName + '||소모품'];
          // 그룹 내 시약 부서가 하나라도 있으면 시약 행 추가
          if (g.depts.some(dept => siyakDeptNames.has(dept))) {
            keys.push(g.displayName + '||시약');
          }
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
    const siSoRows = Object.values(groupedMap);
    deptsForAmount = [...depts, ...siSoRows];
  }

  // GC케어 보고서: gcDepts는 runProcessing에서 이미 extra2 그룹핑 완료
  // writeDeptAmount는 depts(=gcDepts)를 그대로 사용 — 별도 처리 불필요

  writeKyuljai(wb.addWorksheet(`${R.m}월결재`), R.y, R.m, label, vendors, R.vendorMap, gcRow);
  writeDeptAmount(wb.addWorksheet(`${R.m}월 부서별 금액`), R.m, deptsForAmount);

  const user = window.auth?.getSession?.();
  const prevDate = new Date(parseInt(R.y), R.m - 2, 1);
  const prevYm   = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
  const prevStockData = await loadPrevStock(prevYm, R.branch);
  R.prevStockData = prevStockData;  // writeWonjaeryoYear에서 기말 계산에 사용
  writeWonjaeryo(wb.addWorksheet(`원재료비 ${R.y.slice(2)}년 ${R.m}월`), R, prevStockData, label);

  // 연간 사용 데이터 로드 (GC케어/아이메드 분리)
  const reportType  = isImed ? '아이메드' : 'GC케어';
  const yearUsage   = await loadYearUsage(null, R.branch, user, reportType);
  writeWonjaeryoYear(wb.addWorksheet(`${R.y}년도 원재료비`), R, yearUsage, label);

  await saveWb(wb, filename);
}
async function dlGCReport() {
  try {
    showGlobalLoading('GC케어 보고서 생성 중...');
    const R = App.R;
    await dlReport('시약 및 소모품', R.gcVendors, R.gcDepts, `${R.y.slice(2)}년 ${R.m}월 거래처 구매 내역 및 원재료 보고 - GC케어 - ${R.branch}.xlsx`);
  } finally {
    await hideGlobalLoading();
  }
}
async function dlImedReport() {
  try {
    showGlobalLoading('아이메드 보고서 생성 중...');
    const R = App.R;
    // GC케어 금액: 사용현황 아이메드 마감요약(시,소) 합계
    const gcSiSo5 = R.imedSiSoPivot5 || [];
    const gcRow = {
      공급가액: gcSiSo5.reduce((s,d)=>s+toN(d.사용공급가||0),0),
      부가세:   gcSiSo5.reduce((s,d)=>s+toN(d.사용부가세||0),0),
      합계금액: gcSiSo5.reduce((s,d)=>s+toN(d.사용합계  ||0),0),
    };
    await dlReport('원재료 및 소모품', R.imedVendors, R.imedDepts,
      `${R.y.slice(2)}년 ${R.m}월 거래처 구매 내역 및 원재료 보고 - 아이메드 - ${R.branch}.xlsx`,
      gcRow);
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
      // 파싱 시점에 준비된 완성 파일 (이전 월 누적 + 당월)
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
    writePivotDept(wb1.addWorksheet('GC케어 마감요약'), R.gcDepts.filter(d => d.공급가액 || d.부가세 || d.합계금액));
    writeDataSheet(wb1.addWorksheet('아이메드 입고분'), ic, R.imedIpgo.map(d => ic.map(c => d[c] || '')), in_, iw);
    writePivotDept(wb1.addWorksheet('아이메드 마감요약'), R.imedDeptsRaw.filter(d => d.공급가액 || d.부가세 || d.합계금액));
    await saveWb(wb1, `${R.y.slice(2)}년 ${R.m}월 입고 - ${R.branch}.xlsx`);
    await sleep(200);

    // 나머지는 개별 함수 재사용 (각 함수 내부 스피너는 hideGlobalLoading 하지 않도록 플래그 없이 직접 호출)
    await hideGlobalLoading();
    await dlUsage();   await sleep(200);
    await dlGCReport(); await sleep(200);
    await dlImedReport(); await sleep(200);
    await dlSAP();     await sleep(200);
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
          .map(c => ({ value: c.code_name, label: c.code_name }))
      : [];
  } catch (e) {
    clinics = [];
  }

  // API 실패 또는 목록 없으면 소속 의원만 표시
  if (!clinics.length) {
    const fallback = user?.clinic_name || user?.org_name || '서울숲의원';
    clinics = [{ value: fallback, label: fallback }];
  }

  // 소속 의원 기본 선택
  const defaultBranch = user?.clinic_name || clinics[0]?.value || '';
  sel.innerHTML = clinics.map(c =>
    `<option value="${c.value}"${c.value === defaultBranch ? ' selected' : ''}>${c.label}</option>`
  ).join('');
}

// ═══════════════════════════════════════════════════════════
// 13. 수불 기초 재고 (closing_stock API 연동)
// ═══════════════════════════════════════════════════════════

// 전월 기말 재고 로드 → subulMap 기초값으로 세팅
async function loadPrevStock(ym, branch) {
  try {
    const user = window.auth?.getSession?.();
    const res  = await apiGet('closingGetStock', {
      request_user_email: user?.email,
      ym,
      branch,
    });
    const data = Array.isArray(res.data) ? res.data : [];
    clog(`전월 재고 API 응답: ym=${ym}, branch=${branch}, 결과=${data.length}건`, data.length ? 'ok' : 'warn');
    if (!data.length) clog(`전월 재고 없음 — 요청 파라미터 확인: ym="${ym}" branch="${branch}"`, 'warn');
    return data;
  } catch (e) {
    clog(`전월 재고 로드 오류: ${e.message}`, 'error');
    return [];
  }
}

// 당월 부서별 사용 집계 (마감 확정 시 저장용)
function buildDeptUsageForMonthly(R) {
  const gcMap = {}, imedMap = {};
  // GC케어: 시약 + 소모품
  [...R.usageSiyak, ...R.usageSomoum].forEach(r => {
    const dept = String(r['부서명'] || '').trim(); if (!dept) return;
    const type = String(r['자재구분'] || '').trim();
    const k = dept + '||' + type;
    if (!gcMap[k]) gcMap[k] = { dept, item_type: type, report_type: 'GC케어', usage_amount: 0 };
    gcMap[k].usage_amount += toN(r['사용공급가']);
  });
  // 아이메드: 의약품
  R.usageImed.forEach(r => {
    const dept = String(r['부서명'] || '').trim(); if (!dept) return;
    const type = String(r['자재구분'] || '').trim();
    const k = dept + '||' + type;
    if (!imedMap[k]) imedMap[k] = { dept, item_type: type, report_type: '아이메드', usage_amount: 0 };
    imedMap[k].usage_amount += toN(r['사용공급가']);
  });
  return [
    ...Object.values(gcMap),
    ...Object.values(imedMap),
  ].map(v => ({ ...v, usage_amount: Math.round(v.usage_amount) }));
}

// 연도별 사용 데이터 조회
async function loadYearUsage(year, branch, user, reportType) {
  try {
    const params = { request_user_email: user?.email, year, branch };
    if (reportType) params.report_type = reportType;
    const res = await apiGet('closingGetUsageMonthly', params);
    return Array.isArray(res.data) ? res.data : [];
  } catch (e) {
    return [];
  }
}
// 연도 전체 closing_stock 조회
async function loadYearStock(year, branch, user) {
  try {
    const params = { request_user_email: user?.email, branch };
    if (year) params.year = year;
    const res = await apiGet('closingGetStock', params);
    return Array.isArray(res.data) ? res.data : [];
  } catch (e) {
    return [];
  }
}

// ── 3번째 시트: 원재료비 월별 ─────────────────────────────
function writeWonjaeryo(ws, R, prevStockData, label) {
  const isGC = label.includes('시약');  // GC케어=시약, 아이메드=원재료

  // 제목
  const titleCell = ws.getCell(1, 1);
  titleCell.value = isGC
    ? `${R.m}월 원재료비 - ${R.branch} 납품`
    : `${R.m}월 원재료비 계산`;
  titleCell.font = { name: 'Calibri', size: 13, bold: true };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.mergeCells(1, 1, 1, 6); ws.getRow(1).height = 24;

  // (단위) — F2
  const unitCell = ws.getCell(2, 6);
  unitCell.value = isGC ? '(단위:원/ -VAT)' : '(단위: 원)';
  unitCell.font = F.base; unitCell.alignment = AL('right');
  ws.getRow(2).height = 16;

  // 헤더
  const hdrLabel = isGC ? '구분' : '아이메드';
  [[[hdrLabel, 1], ['기초재고', 2], ['당기매입', 3], ['당기사용', 4], ['기말재고', 5], ['비고', 6]]]
    .flat()
    .forEach(([v, c]) => {
      hdrCell(ws, 3, c, v);
      if (c === 4) ws.getCell(3, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDF5EE' } };
    });
  ws.getRow(3).height = 18;

  // 기초재고: 부서별 집계 (아이메드는 그룹핑 적용)
  const targetType = isGC ? '시약' : '의약품';
  const prevDeptStock = {};
  prevStockData
    .filter(s => !s.item_type || s.item_type === targetType)
    .forEach(s => {
      const dept = s.dept || '';
      // GC케어: dept||시약 키로 통일, 아이메드: 그룹핑 전 순수 부서명 키
      const k = isGC ? dept + '||' + targetType : dept;
      if (!prevDeptStock[k]) prevDeptStock[k] = 0;
      prevDeptStock[k] += toN(s.closing_amount);
    });

  // GC케어: extra1='시약' 부서만 필터 후 extra2 그룹핑
  const gcSiyakMaster = isGC
    ? (R.closingDeptMaster || []).filter(d => String(d.extra1 || '').trim() === '시약')
    : [];
  const gcGroups = isGC ? buildImedDeptGroups(gcSiyakMaster) : null;
  // 아이메드: extra2 그룹핑 → 그룹명으로 합산
  const imedGroups = !isGC ? buildImedDeptGroups(R.closingDeptMaster || []) : null;

  const prevDeptStockGrouped = {};
  if (gcGroups) {
    gcGroups.forEach(g => {
      prevDeptStockGrouped[g.displayName + '||' + targetType] =
        g.depts.reduce((s, dept) => s + (prevDeptStock[dept + '||' + targetType] || 0), 0);
    });
  }
  if (imedGroups) {
    imedGroups.forEach(g => {
      prevDeptStockGrouped[g.displayName + '||' + targetType] =
        g.depts.reduce((s, dept) => s + (prevDeptStock[dept] || 0), 0);
    });
  }

  // 부서명 → 그룹명 매핑 (GC케어 + 아이메드 공용)
  const deptToGroup = {};
  if (gcGroups)   gcGroups.forEach(g   => g.depts.forEach(dept => { deptToGroup[dept] = g.displayName; }));
  if (imedGroups) imedGroups.forEach(g => g.depts.forEach(dept => { deptToGroup[dept] = g.displayName; }));
  const resolveKey = (dept) => {
    const groupName = deptToGroup[dept] || dept;
    return groupName + '||' + targetType;
  };

  // 당기매입: 입고 데이터 부서별 집계
  const ipgoData  = isGC ? R.gcIpgo.filter(r => String(r['자재구분']||'').trim() === '시약')
                         : R.imedIpgo.filter(r => String(r['자재구분']||'').trim() === '의약품');
  const usageData = isGC ? R.usageSiyak : R.usageImed;

  const deptIpgo = {};
  ipgoData.forEach(r => {
    const dept = String(r['의뢰부서'] || '').trim(); if (!dept) return;
    const k = isGC ? resolveKey(dept) : resolveKey(dept);
    if (!deptIpgo[k]) deptIpgo[k] = { dept: k.split('||')[0], type: targetType, amt: 0 };
    // 아이메드: 부가세 포함(합계금액), GC케어: 부가세 미포함(공급가액)
    deptIpgo[k].amt += isGC ? toN(r['공급가액']) : toN(r['합계금액']);
  });

  // 당기사용: 사용현황 부서별 집계
  const deptUsage = {};
  usageData.forEach(r => {
    const dept = String(r['부서명'] || '').trim(); if (!dept) return;
    const k = isGC ? resolveKey(dept) : resolveKey(dept);
    if (!deptUsage[k]) deptUsage[k] = { dept: k.split('||')[0], type: targetType, amt: 0 };
    // 아이메드: 부가세 포함(사용합계), GC케어: 부가세 미포함(사용공급가)
    deptUsage[k].amt += isGC ? toN(r['사용공급가']) : toN(r['사용합계']);
  });

  // 아이메드: 시약 사용 부서는 시약5%(부가세포함) 금액을 당기매입+당기사용에 합산
  if (!isGC) {
    const siyakDepts = new Set(
      (R.closingDeptMaster || [])
        .filter(d => String(d.extra1 || '').trim() === '시약')
        .map(d => String(d.code_name || '').trim())
    );
    (R.imedSiSoPivot5 || [])
      .filter(d => String(d.자재구분 || '').trim() === '시약')  // 시약만
      .forEach(d => {
        const dept = String(d.부서명 || '').trim();
        if (!dept || !siyakDepts.has(dept)) return;
        const k   = resolveKey(dept);
        const amt = toN(d.사용합계 || 0);
        if (!deptIpgo[k])  deptIpgo[k]  = { dept: k.split('||')[0], type: '의약품', amt: 0 };
        if (!deptUsage[k]) deptUsage[k] = { dept: k.split('||')[0], type: '의약품', amt: 0 };
        deptIpgo[k].amt  += amt;
        deptUsage[k].amt += amt;
      });
  }

  // 기초재고 최종 (GC케어/아이메드 모두 그룹핑 적용)
  const prevDeptStockFinal = (isGC || imedGroups) ? prevDeptStockGrouped : prevDeptStock;

  // 부서 목록: CLOSING_DEPT 마스터 기준
  const masterDepts = isGC
    ? (gcGroups || []).map(g => g.displayName + '||' + targetType)
    : (imedGroups || []).map(g => g.displayName + '||' + targetType);

  const dataDeptKeys = [...new Set([
    ...Object.keys(deptIpgo),
    ...Object.keys(deptUsage),
    ...Object.keys(prevDeptStockFinal),
  ])];

  const isImedOnlyDept = k => /의료공통|의료 공통/i.test(k.split('||')[0]);
  const deptKeys = (masterDepts.length
    ? [...new Set([...masterDepts, ...dataDeptKeys])].sort((a, b) => {
        const ai = masterDepts.indexOf(a);
        const bi = masterDepts.indexOf(b);
        if (ai >= 0 && bi >= 0) return ai - bi;
        if (ai >= 0) return -1;
        if (bi >= 0) return 1;
        return a.localeCompare(b, 'ko');
      })
    : dataDeptKeys.sort((a, b) => a.localeCompare(b, 'ko'))
  ).filter(k => isGC || !isImedOnlyDept(k));

  // 납품처 구분 텍스트 (GC케어만)
  const vendorLabel = `납품처\n${R.branch}`;

  let r = 4;
  let totBase = 0, totBuy = 0, totUse = 0, totEnd = 0;
  const groupStart = r;

  deptKeys.forEach((k, ri) => {
    const fill  = ri % 2 === 0 ? FILL.odd : FILL.even;
    const parts = k.split('||');
    const dept  = parts[0];
    const base  = toN(prevDeptStockFinal[k]);
    const buy   = toN(deptIpgo[k]?.amt);
    const use   = toN(deptUsage[k]?.amt);
    const end   = base + buy - use;

    totBase += Math.round(base);
    totBuy  += Math.round(buy);
    totUse  += Math.round(use);
    totEnd  += Math.round(end);

    const useFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDF5EE' } };

    if (isGC) {
      // GC케어: A열 납품처 병합셀
      if (ri === 0) {
        const ac = ws.getCell(r, 1);
        ac.value = vendorLabel; ac.font = F.base; ac.fill = fill;
        ac.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        ac.border = BORDER_DATA;
      } else {
        const ac = ws.getCell(r, 1); ac.fill = fill; ac.border = BORDER_DATA;
      }
      numCell(ws, r, 2, base, fill);
      numCell(ws, r, 3, buy,  fill);
      numCell(ws, r, 4, use,  useFill);
      numCell(ws, r, 5, end,  fill);
      txtCell(ws, r, 6, `${dept} - ${targetType}`, fill);
    } else {
      // 아이메드: A열에 부서명 직접 표기
      txtCell(ws, r, 1, dept, fill, false, true);
      numCell(ws, r, 2, base, fill);
      numCell(ws, r, 3, buy,  fill);
      numCell(ws, r, 4, use,  useFill);
      numCell(ws, r, 5, end,  fill);
      txtCell(ws, r, 6, '',   fill);  // 비고 (수동 입력용 빈 셀)
    }
    ws.getRow(r).height = 18; r++;
  });

  // GC케어만 A열 병합
  if (isGC) {
    if (r - 1 > groupStart) ws.mergeCells(groupStart, 1, r - 1, 1);
    ws.getCell(groupStart, 1).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  }

  // 계 행
  subtotRow(ws, r, [1], ['계'], [2, 3, 4, 5], [totBase, totBuy, totUse, totEnd]);
  ws.getCell(r, 4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4E8D8' } };
  if (isGC) {
    ws.getCell(r, 6).value = '+VAT';
    ws.getCell(r, 6).font  = F.bold;
  }
  const bigoCell = ws.getCell(r, 6);
  bigoCell.fill = FILL.subtot; bigoCell.border = BORDER_THIN;
  ws.getRow(r).height = 18; r++;

  // 아이메드 하단 블록
  if (!isGC) {
    r++;  // 빈 행

    // 백신 원재료비 블록
    const hdrFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4E8D8' } };
    const dataFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDF5EE' } };

    ws.mergeCells(r, 3, r, 3);
    [[3,'기능의학'],[4,'금액'],[5,'비고']].forEach(([c,v]) => {
      const cell = ws.getCell(r, c); cell.value = v; cell.font = F.bold;
      cell.fill = hdrFill; cell.alignment = AL('center'); cell.border = BORDER_THIN;
    });
    ws.getRow(r).height = 18; r++;

    // 백신 원재료비 행 (의약품 중 진료팀(백신) 당기사용)
    const vaccineDepts = ['진료팀(백신)'];
    const vaccineUse = vaccineDepts.reduce((s, dept) => {
      const k = dept + '||의약품';
      return s + toN(deptUsage[k]?.amt || 0);
    }, 0);
    txtCell(ws, r, 3, '백신 원재료비', dataFill, false, true);
    numCell(ws, r, 4, vaccineUse, dataFill);
    txtCell(ws, r, 5, '', dataFill);
    ws.getRow(r).height = 18; r++;

    // 계 행
    ws.mergeCells(r, 3, r, 3);
    txtCell(ws, r, 3, '계', null, true, true);
    numCell(ws, r, 4, vaccineUse, FILL.subtot);
    txtCell(ws, r, 5, '', FILL.subtot);
    ws.getRow(r).height = 18; r += 2;

    // 기능의학 블록
    [[3,'기능의학'],[4,'금액'],[5,'비고']].forEach(([c,v]) => {
      const cell = ws.getCell(r, c); cell.value = v; cell.font = F.bold;
      cell.fill = hdrFill; cell.alignment = AL('center'); cell.border = BORDER_THIN;
    });
    ws.getRow(r).height = 18; r++;

    const funcItems = ['세포치료', '키트루다', '나글라자임', '헌터라제', '애브서틴'];
    funcItems.forEach(item => {
      txtCell(ws, r, 3, item, dataFill, false, true);
      numCell(ws, r, 4, 0, dataFill);  // 직접 입력용
      txtCell(ws, r, 5, '', dataFill);
      ws.getRow(r).height = 18; r++;
    });

    // 기능의학 계
    ws.mergeCells(r, 3, r, 3);
    txtCell(ws, r, 3, '계', null, true, true);
    numCell(ws, r, 4, 0, FILL.subtot);
    txtCell(ws, r, 5, '', FILL.subtot);
    ws.getRow(r).height = 18;
  }

  cw(ws, [[1, 20], [2, 16], [3, 16], [4, 16], [5, 16], [6, 24]]);
  ws.views = [{ state: 'frozen', ySplit: 3 }];
}

// ── 4번째 시트: 연간 원재료비 ────────────────────────────
function writeWonjaeryoYear(ws, R, yearUsage, label) {
  const isGC   = label.includes('시약');
  const months = ['01','02','03','04','05','06','07','08','09','10','11','12'];
  const curMon = String(R.m).padStart(2, '0');
  const CUR_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDF5EE' } };

  if (isGC) {
    // ── GC케어: 시약 당기사용 (extra2 그룹핑 적용) ──────────
    const targetType = '시약';
    const gcSiyakMaster = (R.closingDeptMaster || []).filter(d => String(d.extra1 || '').trim() === '시약');
    const gcGroups   = buildImedDeptGroups(gcSiyakMaster);
    const gcDeptToGroup = {};
    gcGroups.forEach(g => g.depts.forEach(dept => { gcDeptToGroup[dept] = g.displayName; }));
    const resolveGcGroup = dept => gcDeptToGroup[dept] || dept;

    const yearMap = {};
    yearUsage
      .filter(u => u.item_type === targetType)
      .forEach(u => {
        const parts = (u.ym || '').split('-');
        const yr = parts[0]; const mon = parts[1];
        if (!yr || !mon) return;
        const groupName = resolveGcGroup(u.dept || '');
        if (!yearMap[yr]) yearMap[yr] = {};
        if (!yearMap[yr][groupName]) yearMap[yr][groupName] = { dept: groupName, base: 0, end: 0 };
        yearMap[yr][groupName]['m' + mon] =
          (yearMap[yr][groupName]['m' + mon] || 0) + Math.round(u.usage_amount / 1000);
        if (mon === '01' && u.base_amount)
          yearMap[yr][groupName].base = (yearMap[yr][groupName].base || 0) + Math.round(u.base_amount / 1000);
        if (mon === '12' && u.end_amount)
          yearMap[yr][groupName].end  = (yearMap[yr][groupName].end  || 0) + Math.round(u.end_amount  / 1000);
      });

    // 당월 추가 (그룹별 원단위 합산 후 /1000)
    const gcCurRaw = {};
    buildDeptUsageForMonthly(R)
      .filter(u => u.item_type === targetType)
      .forEach(u => {
        const groupName = resolveGcGroup(u.dept || '');
        gcCurRaw[groupName] = (gcCurRaw[groupName] || 0) + (u.usage_amount || 0);
      });
    if (!yearMap[R.y]) yearMap[R.y] = {};
    Object.entries(gcCurRaw).forEach(([groupName, raw]) => {
      if (!yearMap[R.y][groupName]) yearMap[R.y][groupName] = { dept: groupName, base: 0, end: 0 };
      yearMap[R.y][groupName]['m' + curMon] = Math.round(raw / 1000);
    });

    // 당해 연도 기말: 그룹별 기초+매입-사용 집계
    const curGroupNames = new Set(Object.keys(yearMap[R.y] || {}));
    gcGroups.forEach(g => curGroupNames.add(g.displayName));
    curGroupNames.forEach(groupName => {
      if (!yearMap[R.y]) yearMap[R.y] = {};
      if (!yearMap[R.y][groupName]) yearMap[R.y][groupName] = { dept: groupName, base: 0, end: 0 };
      const d = yearMap[R.y][groupName];
      const memberDepts = gcGroups.find(g => g.displayName === groupName)?.depts || [groupName];

      const baseAmt = memberDepts.reduce((s, dept) =>
        s + (R.prevStockData || [])
          .filter(s => (s.dept||'') === dept && s.item_type === targetType)
          .reduce((acc, v) => acc + toN(v.closing_amount), 0), 0);
      if (!d.base && baseAmt) d.base = Math.round(baseAmt / 1000);

      const buy = memberDepts.reduce((s, dept) =>
        s + R.gcIpgo
          .filter(r => String(r['의뢰부서']||'').trim() === dept && String(r['자재구분']||'').trim() === targetType)
          .reduce((acc, r) => acc + toN(r['공급가액']), 0), 0);
      const use = memberDepts.reduce((s, dept) =>
        s + R.usageSiyak
          .filter(r => String(r['부서명']||'').trim() === dept)
          .reduce((acc, r) => acc + toN(r['사용공급가']), 0), 0);
      d.end = Math.round((baseAmt + buy - use) / 1000);
    });

    const years = Object.keys(yearMap).sort((a, b) => b.localeCompare(a));
    let r = 1;
    years.forEach(yr => {
      const data = yearMap[yr];
      // 마스터 순서: gcGroups 기준, 데이터에만 있는 그룹은 뒤에 추가
      const masterDepts = gcGroups.map(g => g.displayName);
      const dataDepts   = Object.keys(data);
      const deptKeys = masterDepts.length
        ? [...new Set([...masterDepts, ...dataDepts])].sort((a, b) => {
            const ai = masterDepts.indexOf(a); const bi = masterDepts.indexOf(b);
            if (ai >= 0 && bi >= 0) return ai - bi;
            if (ai >= 0) return -1; if (bi >= 0) return 1;
            return a.localeCompare(b, 'ko');
          })
        : dataDepts.sort((a, b) => a.localeCompare(b, 'ko'));
      deptKeys.forEach(dept => { if (!data[dept]) data[dept] = { dept, base: 0, end: 0 }; });

      ws.mergeCells(r, 1, r, 15);
      ws.getCell(r, 1).value = `■ ${yr}년도 원재료비`;
      ws.getCell(r, 1).font  = { name: 'Calibri', size: 12, bold: true };
      ws.getCell(r, 16).value = '(단위 : 천원)';
      ws.getCell(r, 16).font  = F.base;
      ws.getCell(r, 16).alignment = AL('right');
      ws.getRow(r).height = 22; r++;

      ['구   분','기초','1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월','기말','비고']
        .forEach((v, i) => {
          hdrCell(ws, r, i + 1, v);
          if (yr === R.y && i >= 2 && i <= 13 && String(i - 1).padStart(2,'0') === curMon)
            ws.getCell(r, i + 1).fill = CUR_FILL;
        });
      ws.getRow(r).height = 18; r++;

      const colTotals = { base: 0, end: 0 };
      months.forEach((_, i) => { colTotals[i + 3] = 0; });
      const groupStart = r;

      deptKeys.forEach((dept, ri) => {
        const fill = ri % 2 === 0 ? FILL.odd : FILL.even;
        const d    = data[dept];
        colTotals.base += d.base || 0;
        colTotals.end  += d.end  || 0;
        if (ri === 0) {
          const ac = ws.getCell(r, 1);
          ac.value = `납품처\n${R.branch}`; ac.font = F.base; ac.fill = fill;
          ac.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
          ac.border = BORDER_DATA;
        } else {
          const ac = ws.getCell(r, 1); ac.fill = fill; ac.border = BORDER_DATA;
        }
        numCell(ws, r, 2, d.base || 0, fill);
        months.forEach((mon, mi) => {
          const v = d['m' + mon] || 0;
          colTotals[mi + 3] = (colTotals[mi + 3] || 0) + v;
          numCell(ws, r, mi + 3, v, yr === R.y && mon === curMon ? CUR_FILL : fill);
        });
        numCell(ws, r, 15, d.end || 0, fill);
        txtCell(ws, r, 16, `${dept} - 시약`, fill);
        ws.getRow(r).height = 18; r++;
      });

      if (r - 1 > groupStart) ws.mergeCells(groupStart, 1, r - 1, 1);
      ws.getCell(groupStart, 1).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };

      subtotRow(ws, r, [1], ['소  계'],
        [2, ...months.map((_, i) => i + 3), 15],
        [colTotals.base, ...months.map((_, i) => colTotals[i + 3] || 0), colTotals.end]
      );
      if (yr === R.y) {
        const cc = ws.getCell(r, months.indexOf(curMon) + 3);
        cc.fill = CUR_FILL;
      }
      ws.getCell(r, 16).fill = FILL.subtot; ws.getCell(r, 16).border = BORDER_THIN;
      ws.getRow(r).height = 18; r += 2;
    });

    const colWidths = [[1, 22], [2, 10]];
    months.forEach((_, i) => colWidths.push([i + 3, 9]));
    colWidths.push([15, 10], [16, 22]);
    cw(ws, colWidths);
    ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 0 }];
    return;
  }

  // ── 아이메드: 의약품 사용합계 + 시약5% 사용합계 ─────────
  const imedGroups = buildImedDeptGroups(R.closingDeptMaster || []);
  const siyakDeptNames = new Set(
    (R.closingDeptMaster || [])
      .filter(d => String(d.extra1||'').trim() === '시약')
      .map(d => String(d.code_name||'').trim())
  );

  // 그룹명 해석 헬퍼
  const deptToGroup = {};
  imedGroups.forEach(g => g.depts.forEach(dept => { deptToGroup[dept] = g.displayName; }));
  const resolveGroup = dept => deptToGroup[dept] || dept;

  // DB 데이터 → yearMap: yr → groupName → { m01..m12, base, end }
  // 의약품 + 시약 합산
  const yearMap = {};
  const addToMap = (yr, mon, groupName, amt) => {
    if (!yearMap[yr]) yearMap[yr] = {};
    if (!yearMap[yr][groupName]) yearMap[yr][groupName] = { base: 0, end: 0 };
    yearMap[yr][groupName]['m' + mon] =
      (yearMap[yr][groupName]['m' + mon] || 0) + Math.round(amt / 1000);
  };

  yearUsage
    .filter(u => u.item_type === '의약품' || u.item_type === '시약')
    .forEach(u => {
      const parts = (u.ym || '').split('-');
      const yr = parts[0]; const mon = parts[1];
      if (!yr || !mon) return;
      const groupName = resolveGroup(u.dept || '');
      // 시약은 extra1='시약' 부서만
      if (u.item_type === '시약' && !siyakDeptNames.has(u.dept || '')) return;
      addToMap(yr, mon, groupName, u.usage_amount || 0);
      if (mon === '01' && u.base_amount) {
        if (!yearMap[yr]) yearMap[yr] = {};
        if (!yearMap[yr][groupName]) yearMap[yr][groupName] = { base: 0, end: 0 };
        yearMap[yr][groupName].base += Math.round(u.base_amount / 1000);
      }
      if (mon === '12' && u.end_amount) {
        if (!yearMap[yr]) yearMap[yr] = {};
        if (!yearMap[yr][groupName]) yearMap[yr][groupName] = { base: 0, end: 0 };
        yearMap[yr][groupName].end += Math.round(u.end_amount / 1000);
      }
    });

  // 당월 추가 (의약품 + 시약5%) — 그룹별 원단위 합산 후 /1000 (3번째 시트와 동일 방식)
  if (!yearMap[R.y]) yearMap[R.y] = {};

  // 의약품 당월: 그룹별 원단위 합산
  const imedCurRaw = {};  // groupName → 원단위 합계
  R.usageImed.forEach(r => {
    const dept = String(r['부서명']||'').trim(); if (!dept) return;
    const groupName = resolveGroup(dept);
    imedCurRaw[groupName] = (imedCurRaw[groupName] || 0) + toN(r['사용합계']);
  });

  // 시약5% 당월: 그룹별 원단위 합산 (extra1='시약' 부서만)
  const siyakCurRaw = {};  // groupName → 원단위 합계
  (R.imedSiSoPivot5 || [])
    .filter(d => String(d.자재구분||'').trim() === '시약' && siyakDeptNames.has(String(d.부서명||'').trim()))
    .forEach(d => {
      const groupName = resolveGroup(String(d.부서명||'').trim());
      siyakCurRaw[groupName] = (siyakCurRaw[groupName] || 0) + toN(d.사용합계||0);
    });

  // 그룹별 합산 후 /1000 → yearMap에 저장
  const allCurGroups = new Set([...Object.keys(imedCurRaw), ...Object.keys(siyakCurRaw)]);
  allCurGroups.forEach(groupName => {
    if (!yearMap[R.y][groupName]) yearMap[R.y][groupName] = { base: 0, end: 0 };
    const combined = (imedCurRaw[groupName] || 0) + (siyakCurRaw[groupName] || 0);
    yearMap[R.y][groupName]['m' + curMon] = Math.round(combined / 1000);
  });

  // 당해 연도 기말: 3번째 시트 기말재고 (writeWonjaeryo의 end 값과 동일 계산)
  // prevStockData 기준 그룹별 기초 합산 후 매입-사용
  imedGroups.forEach(g => {
    const gName = g.displayName;
    if (!yearMap[R.y]) yearMap[R.y] = {};
    if (!yearMap[R.y][gName]) yearMap[R.y][gName] = { base: 0, end: 0 };
    const d = yearMap[R.y][gName];

    // 기초 (prevStockData 그룹 합산, 의약품 기준)
    if (!d.base) {
      const base = g.depts.reduce((s, dept) => {
        return s + (R.prevStockData || [])
          .filter(s2 => (s2.dept||'') === dept && s2.item_type === '의약품')
          .reduce((ss, v) => ss + toN(v.closing_amount), 0);
      }, 0);
      if (base) d.base = Math.round(base / 1000);
    }

    // 기말 = 기초 + 의약품매입 - 의약품사용 (시약5%는 매입=사용으로 상쇄)
    const baseAmt = g.depts.reduce((s, dept) => {
      return s + (R.prevStockData || [])
        .filter(s2 => (s2.dept||'') === dept && s2.item_type === '의약품')
        .reduce((ss, v) => ss + toN(v.closing_amount), 0);
    }, 0);
    const buyImed = g.depts.reduce((s, dept) => {
      return s + R.imedIpgo
        .filter(r2 => String(r2['의뢰부서']||'').trim() === dept && String(r2['자재구분']||'').trim() === '의약품')
        .reduce((ss, r2) => ss + toN(r2['합계금액']), 0);
    }, 0);
    const useImed = g.depts.reduce((s, dept) => {
      return s + R.usageImed
        .filter(r2 => String(r2['부서명']||'').trim() === dept)
        .reduce((ss, r2) => ss + toN(r2['사용합계']), 0);
    }, 0);
    d.end = Math.round((baseAmt + buyImed - useImed) / 1000);
  });

  // 연도 목록: 내림차순
  const years = Object.keys(yearMap).sort((a, b) => b.localeCompare(a));

  // 그룹 순서: CLOSING_DEPT extra2 마스터 순
  const masterGroups = imedGroups.map(g => g.displayName);

  // 우측 비교 테이블용 소계 저장 (yr → mon → 소계)
  const yearMonTotals = {};  // yr → { m01..m12 }

  let r = 1;
  years.forEach(yr => {
    const data = yearMap[yr];
    const dataGroups = Object.keys(data);
    const rawGroupKeys = masterGroups.length
      ? [...new Set([...masterGroups, ...dataGroups])].sort((a, b) => {
          const ai = masterGroups.indexOf(a); const bi = masterGroups.indexOf(b);
          if (ai >= 0 && bi >= 0) return ai - bi;
          if (ai >= 0) return -1; if (bi >= 0) return 1;
          return a.localeCompare(b, 'ko');
        })
      : dataGroups.sort((a, b) => a.localeCompare(b, 'ko'));
    const groupKeys = rawGroupKeys.filter(g => !/의료공통|의료 공통/i.test(g));
    groupKeys.forEach(g => { if (!data[g]) data[g] = { base: 0, end: 0 }; });

    // ── 연도 제목
    const blockTitleRow = r;
    ws.mergeCells(r, 1, r, 13);
    ws.getCell(r, 1).value = `■ ${yr}년도 원재료비`;
    ws.getCell(r, 1).font  = { name: 'Calibri', size: 12, bold: true };
    ws.mergeCells(r, 14, r, 15);
    ws.getCell(r, 14).value = '(단위 : 천원)';
    ws.getCell(r, 14).font  = F.base;
    ws.getCell(r, 14).alignment = AL('right');
    ws.getRow(r).height = 22; r++;

    // ── 헤더
    ['구   분','기초','1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월','기말']
      .forEach((v, i) => {
        hdrCell(ws, r, i + 1, v);
        if (yr === R.y && i >= 2 && i <= 13 && String(i - 1).padStart(2,'0') === curMon)
          ws.getCell(r, i + 1).fill = CUR_FILL;
      });
    ws.getRow(r).height = 18; r++;

    // ── 매 출 행 (빈칸)
    txtCell(ws, r, 1, '매  출', FILL.odd, false, true);
    [2,3,4,5,6,7,8,9,10,11,12,13,14,15].forEach(c => {
      const cell = ws.getCell(r, c); cell.fill = FILL.odd; cell.border = BORDER_DATA;
    });
    ws.getRow(r).height = 18; r++;

    const colTotals = { base: 0, end: 0 };
    months.forEach((_, i) => { colTotals[i + 3] = 0; });

    groupKeys.forEach((gName, ri) => {
      const fill = ri % 2 === 0 ? FILL.odd : FILL.even;
      const d    = data[gName];
      colTotals.base += d.base || 0;
      colTotals.end  += d.end  || 0;
      txtCell(ws, r, 1, gName, fill, false, false);
      numCell(ws, r, 2, d.base || 0, fill);
      months.forEach((mon, mi) => {
        const v = d['m' + mon] || 0;
        colTotals[mi + 3] = (colTotals[mi + 3] || 0) + v;
        numCell(ws, r, mi + 3, v, yr === R.y && mon === curMon ? CUR_FILL : fill);
      });
      numCell(ws, r, 15, d.end || 0, fill);
      ws.getRow(r).height = 18; r++;
    });

    // 소계 저장 (우측 비교 테이블용)
    yearMonTotals[yr] = { base: colTotals.base, end: colTotals.end };
    months.forEach((mon, mi) => { yearMonTotals[yr]['m' + mon] = colTotals[mi + 3] || 0; });

    // ── 총 계
    subtotRow(ws, r, [1], ['총  계'],
      [2, ...months.map((_, i) => i + 3), 15],
      [colTotals.base, ...months.map((_, i) => colTotals[i + 3] || 0), colTotals.end]
    );
    if (yr === R.y) {
      const cc = ws.getCell(r, months.indexOf(curMon) + 3);
      cc.fill = CUR_FILL;
    }
    ws.getRow(r).height = 18; r++;

    // ── 세포치료 / 특수의약품 (빈칸, B열부터)
    ['세포치료', '특수의약품'].forEach(lbl => {
      const lFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF0F0' } };
      const ac = ws.getCell(r, 1); ac.fill = lFill; ac.border = BORDER_DATA;  // A열 빈칸
      txtCell(ws, r, 2, lbl, lFill, false, true);  // B열에 라벨
      [3,4,5,6,7,8,9,10,11,12,13,14,15].forEach(c => {
        const cell = ws.getCell(r, c); cell.fill = lFill; cell.border = BORDER_DATA;
      });
      ws.getRow(r).height = 18; r++;
    });

    r++;  // 빈 행

    // ── 우측 비교 테이블: 증가분만 표기 (구분 + 증가분 2열)
    //    blockTitleRow+0: (단위:천원) 우측 정렬
    //    blockTitleRow+1: 구분 | 증가분 헤더 (= 헤더행)
    //    blockTitleRow+2: 매 출
    //    blockTitleRow+3~: 부서별
    {
      const prevYr = String(parseInt(yr) - 1);
      const TC = 18;  // R열
      let tr = blockTitleRow;

      // 단위 (제목 행, R~S 병합)
      ws.mergeCells(tr, TC, tr, TC + 1);
      const thUnit = ws.getCell(tr, TC);
      thUnit.value = '(단위 : 천원)'; thUnit.font = F.base; thUnit.alignment = AL('right');
      tr++;  // → 헤더 행 (blockTitleRow+1 = 구 분 헤더 행)

      // 헤더: 구분 | 증가분
      const prevLabel = `${prevYr.slice(2)}년 대비 증가분`;
      hdrCell(ws, tr, TC,     '구분');
      hdrCell(ws, tr, TC + 1, prevLabel);
      ws.getRow(tr).height = 18; tr++;

      // 매 출 행 (빈)
      [TC, TC + 1].forEach(c => {
        const cell = ws.getCell(tr, c);
        if (c === TC) cell.value = '매  출';
        cell.font = F.base; cell.fill = FILL.odd; cell.border = BORDER_DATA;
        cell.alignment = AL(c === TC ? 'center' : 'right');
      });
      ws.getRow(tr).height = 18; tr++;

      // 부서별
      groupKeys.forEach((gName, ri) => {
        const fill    = ri % 2 === 0 ? FILL.odd : FILL.even;
        const curAmt  = yearMap[yr]?.[gName]?.['m' + curMon]     || 0;
        const prevAmt = yearMap[prevYr]?.[gName]?.['m' + curMon] || 0;
        txtCell(ws, tr, TC,     gName,           fill, false, false);
        numCell(ws, tr, TC + 1, curAmt - prevAmt, fill);
        ws.getRow(tr).height = 18; tr++;
      });

      // 총 계
      const curTotal  = yearMonTotals[yr]?.['m' + curMon]     || 0;
      const prevTotal = yearMonTotals[prevYr]?.['m' + curMon] || 0;
      subtotRow(ws, tr, [TC], ['총  계'], [TC + 1], [curTotal - prevTotal]);
      ws.getRow(tr).height = 18;
    }
  });

  const colWidths = [[1, 20], [2, 10]];
  months.forEach((_, i) => colWidths.push([i + 3, 9]));
  colWidths.push([15, 10], [16, 4], [17, 4], [18, 18], [19, 20], [20, 12], [21, 12]);
  cw(ws, colWidths);
  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 0 }];
}


// 마감 확정: 현재 subulMap 기말값 → DB 저장
// CLOSING_DEPT 마스터에서 의약품 부서 그룹 목록 생성
// extra2가 있으면 그룹명으로 합산, 없으면 code_name 그대로
function buildImedDeptGroups(deptMaster) {
  const groups = [];  // [{ displayName, depts: [code_name, ...] }]
  const seen = new Set();
  (deptMaster || []).forEach(d => {
    const name  = String(d.code_name || '').trim();
    const group = String(d.extra2    || '').trim();
    const key   = group || name;
    if (!key || seen.has(key)) return;
    seen.add(key);
    const members = group
      ? (deptMaster).filter(x => String(x.extra2||'').trim() === group).map(x => String(x.code_name||'').trim())
      : [name];
    groups.push({ displayName: key, depts: members });
  });
  return groups;
}

// 부서 목록에서 그룹 기준으로 금액 합산
function sumByImedGroup(dataByDept, groups) {
  return groups.map(g => ({
    displayName: g.displayName,
    depts:       g.depts,
    amt:         g.depts.reduce((s, dept) => s + toN(dataByDept[dept] || 0), 0),
  }));
}

async function confirmClosing() {
  const R   = App.R;
  const btn = document.getElementById('btnClosingConfirm');
  const statusEl = document.getElementById('closingConfirmStatus');
  const ym  = `${R.y}-${String(R.m).padStart(2, '00')}`;
  const prevDate = new Date(parseInt(R.y), R.m - 2, 1);
  const prevYm   = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;

  // 이미 확정된 데이터 있는지 체크
  try {
    showGlobalLoading('기존 확정 데이터 확인 중...');
    const user = window.auth?.getSession?.();
    const res  = await apiGet('closingGetStock', {
      request_user_email: user?.email,
      ym, branch: R.branch,
    });
    await hideGlobalLoading();
    const exists = Array.isArray(res.data) && res.data.length > 0;
    if (exists) {
      const confirmed = confirm(
        `${R.branch} ${R.y}년 ${R.m}월 마감 확정 데이터가 이미 존재합니다.\n덮어쓰시겠습니까?`
      );
      if (!confirmed) return;
    }
  } catch (e) {
    await hideGlobalLoading();
  }

  // 의약품 기말금액 입력 모달 (extra2 그룹핑 적용)
  const imedGroups = buildImedDeptGroups(R.closingDeptMaster || []);

  const imedAmounts = await new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.4);z-index:9999;display:flex;align-items:center;justify-content:center;';

    const box = document.createElement('div');
    box.style.cssText = 'background:#fff;border-radius:8px;padding:24px;min-width:380px;max-width:480px;box-shadow:0 4px 20px rgba(0,0,0,0.2);';

    box.innerHTML = `
      <h3 style="margin:0 0 6px;font-size:15px;font-weight:700;">의약품 기말재고 입력</h3>
      <p style="margin:0 0 16px;font-size:12px;color:#666;">${R.y}년 ${R.m}월 | ${R.branch} — 금액만 입력 (원 단위)</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="background:#f4e8d8;">
            <th style="padding:6px 8px;text-align:left;border:1px solid #ddd;">부서명</th>
            <th style="padding:6px 8px;text-align:right;border:1px solid #ddd;width:160px;">기말금액 (원)</th>
          </tr>
        </thead>
        <tbody>
          ${imedGroups.map(g => `
            <tr>
              <td style="padding:6px 8px;border:1px solid #ddd;">${g.displayName}</td>
              <td style="padding:4px 6px;border:1px solid #ddd;">
                <input type="number" data-group="${g.displayName}" data-depts="${g.depts.join(',')}" value="0"
                  style="width:100%;text-align:right;border:1px solid #ccc;border-radius:4px;padding:4px 6px;font-size:13px;box-sizing:border-box;" />
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end;">
        <button id="imedModalCancel" style="padding:8px 16px;border:1px solid #ccc;border-radius:4px;background:#fff;cursor:pointer;font-size:13px;">취소</button>
        <button id="imedModalConfirm" style="padding:8px 16px;border:none;border-radius:4px;background:#e8c9a8;cursor:pointer;font-size:13px;font-weight:700;">확정</button>
      </div>
    `;

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    document.getElementById('imedModalCancel').onclick = () => {
      document.body.removeChild(overlay);
      resolve(null);
    };
    document.getElementById('imedModalConfirm').onclick = () => {
      // 그룹별 입력값 → 소속 부서들에 균등 분배
      const result = {};
      box.querySelectorAll('input[data-group]').forEach(inp => {
        const amt   = Math.round(parseFloat(inp.value) || 0);
        const depts = inp.dataset.depts.split(',').filter(Boolean);
        depts.forEach(dept => { result[dept] = amt; });  // 그룹 전체에 같은 금액 (합산값)
      });
      document.body.removeChild(overlay);
      resolve(result);
    };
  });

  if (imedAmounts === null) return;  // 취소

  try {
    showGlobalLoading('마감 확정 저장 중...');
    const user  = window.auth?.getSession?.();

    // 품목코드 기준 기말 저장 (시약/소모품)
    const items = Object.values(R.subulMap).map(it => ({
      dept:           '',
      item_code:      it.code,
      item_name:      it.name,
      item_type:      it.type,
      closing_qty:    (it.기초수량 || 0),
      closing_amount: Math.round((it.기초 || 0) + it.증가 - it.감소),
    }));

    // 의약품 기말금액 추가 (부서별, 금액만)
    Object.entries(imedAmounts).forEach(([dept, amt]) => {
      if (amt !== 0) {
        items.push({
          dept,
          item_code:      '',
          item_name:      '의약품',
          item_type:      '의약품',
          closing_qty:    0,
          closing_amount: amt,
        });
      }
    });

    await apiPost('closingSaveStock', {
      request_user_email: user?.email,
      branch: R.branch,
      ym,
      items,
    });

    // 당월 부서별 사용 데이터 저장 (GC케어/아이메드 분리)
    const usageItems = buildDeptUsageForMonthly(R);
    const gcUsageItems   = usageItems.filter(it => it.report_type === 'GC케어');
    const imedUsageItems = usageItems.filter(it => it.report_type === '아이메드');
    if (gcUsageItems.length > 0) {
      await apiPost('closingSaveUsageMonthly', {
        request_user_email: user?.email,
        branch: R.branch, ym,
        report_type: 'GC케어',
        items: gcUsageItems,
      });
    }
    if (imedUsageItems.length > 0) {
      await apiPost('closingSaveUsageMonthly', {
        request_user_email: user?.email,
        branch: R.branch, ym,
        report_type: '아이메드',
        items: imedUsageItems,
      });
    }

    btn.disabled    = true;
    btn.textContent = '✓ 확정 완료';
    btn.style.background = '#0e7c3a';
    const now = new Date().toLocaleString('ko-KR');
    statusEl.textContent = `✓ ${R.branch} ${R.y}년 ${R.m}월 마감이 확정됐습니다. (${now})`;
    showMessage(`${R.branch} ${R.y}년 ${R.m}월 마감이 확정됐습니다. 품목 ${items.length}건 저장됨.`, 'success');

    // 수불부 Drive 저장 (마감 확정 시점에만)
    if (R.subulBuffer && R.subulFileId) {
      try {
        showGlobalLoading('수불부 저장 중...');
        const base64 = btoa(
          new Uint8Array(R.subulBuffer).reduce((d, b) => d + String.fromCharCode(b), '')
        );
        await apiPost('closingUpdateSubulFile', {
          request_user_email: user?.email,
          file_id: R.subulFileId,
          base64,
        });
        clog('수불부 Drive 저장 완료', 'ok');
      } catch (e) {
        clog('수불부 Drive 저장 실패: ' + e.message, 'warn');
      }
    }
    await hideGlobalLoading();
  } catch (e) {
    showMessage('마감 확정 중 오류: ' + e.message, 'error');
    await hideGlobalLoading();
  }
}

// ═══════════════════════════════════════════════════════════
// 14. 거래처 관리 (API 연동)
// ═══════════════════════════════════════════════════════════
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

        const rows = [];
        let currentYear = null;
        const months = ['01','02','03','04','05','06','07','08','09','10','11','12'];
        const SKIP = new Set(['구   분','구분','총  계','총    계','소  계','소 계','매  출','매   출','세포치료','특수의약품','납품처']);

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
            const baseVal = parseFloat(String(row[1]  || '').replace(/,/g, '')) || 0;
            const endVal  = parseFloat(String(row[14] || '').replace(/,/g, '')) || 0;
            months.forEach((mon, mi) => {
              const val = parseFloat(String(row[mi + 2] || '').replace(/,/g, '')) || 0;
              if (!val && mon !== '01' && mon !== '12') return;  // 기초/기말 저장월 제외하고 0이면 스킵
              rows.push({ ym: `${currentYear}-${mon}`, dept, item_type: itype,
                usage_amount: Math.round(val),
                base_amount: mon === '01' ? Math.round(baseVal) : 0,
                end_amount:  mon === '12' ? Math.round(endVal)  : 0 });
            });
          } else {
            // 아이메드: B열(idx1)에 부서명
            const dept = col1;
            if (!dept || SKIP.has(dept)) return;
            // C열(idx2)에 세포치료/특수의약품 텍스트가 오는 경우도 스킵
            const col2 = String(row[2] || '').trim();
            if (SKIP.has(col2)) return;
            const baseVal = parseFloat(String(row[2]  || '').replace(/,/g, '')) || 0;
            const endVal  = parseFloat(String(row[15] || '').replace(/,/g, '')) || 0;
            months.forEach((mon, mi) => {
              const val = parseFloat(String(row[mi + 3] || '').replace(/,/g, '')) || 0;
              if (!val && mon !== '01' && mon !== '12') return;
              rows.push({ ym: `${currentYear}-${mon}`, dept, item_type: '의약품',
                usage_amount: Math.round(val),
                base_amount: mon === '01' ? Math.round(baseVal) : 0,
                end_amount:  mon === '12' ? Math.round(endVal)  : 0 });
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
      ${deptKeys.map(k => `<td class="num">${((byYm[ym][k] || 0) / 1000).toLocaleString()}</td>`).join('')}
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
