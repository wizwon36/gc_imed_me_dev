/**
 * stats-upload.js
 * 통계용 입고/사용현황 원본 데이터 파싱 및 업로드
 *
 * 의존: SheetJS(xlsx), apiPost (api.js)
 */

// ── 공통 유틸 ──────────────────────────────────────────────

// '2026.05.07' → '2026-05-07' / '2026-05-07' 형식 보존
function parseDateDot_(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  const m = s.match(/^(\d{4})[.\-](\d{1,2})[.\-](\d{1,2})/);
  if (!m) return null;
  const [, y, mo, d] = m;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

// 날짜에서 'YYYY-MM' 추출
function ymFromDate_(dateStr) {
  if (!dateStr) return null;
  return dateStr.slice(0, 7);
}

// '126,000' 같은 쉼표 텍스트 → 숫자
function parseNum_(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return v;
  const cleaned = String(v).replace(/,/g, '').trim();
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

function parseStr_(v) {
  return v === null || v === undefined ? '' : String(v).trim();
}

// ── 입고(구매) 파일 파싱 ───────────────────────────────────
// 컬럼: No. | 공급업체코드 | 공급업체 | 구매번호 | 자재구분 | 자재코드 | 자재명 | 상태 |
//       입고일자 | 수량 | 단가 | 공급가액 | 부가세 | 합계금액 | 규격 | 산출단위 | 입고단위 | 의뢰부서
// ── 헤더 검증 ──────────────────────────────────────────────
// 필수 컬럼명이 헤더 행(인덱스 0)에 있는지 확인. 없으면 파일 종류 불일치로 판단.
const PURCHASE_REQUIRED_HEADERS = ['공급업체', '구매번호', '자재명', '입고일자', '공급가액'];
const USAGE_REQUIRED_HEADERS    = ['부서명', '자재명', '사용일자', '사용공급가', 'LOT No.'];

function validateFileHeaders_(workbook, expectedKind) {
  const requiredHeaders = expectedKind === 'purchase' ? PURCHASE_REQUIRED_HEADERS : USAGE_REQUIRED_HEADERS;
  const otherHeaders    = expectedKind === 'purchase' ? USAGE_REQUIRED_HEADERS : PURCHASE_REQUIRED_HEADERS;
  const expectedLabel = expectedKind === 'purchase' ? '입고(구매)' : '사용현황';
  const otherLabel     = expectedKind === 'purchase' ? '사용현황' : '입고(구매)';

  // 첫 번째 시트의 헤더 행만 확인 (모든 시트가 같은 구조라고 가정)
  const firstSheetName = workbook.SheetNames[0];
  const ws = workbook.Sheets[firstSheetName];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  if (!data.length) {
    throw new Error('파일에 데이터가 없습니다.');
  }

  const headerRow = data[0].map(v => String(v || '').trim());

  const missingRequired = requiredHeaders.filter(h => !headerRow.includes(h));
  const matchedOther    = otherHeaders.filter(h => headerRow.includes(h));

  // 기대한 컬럼이 대부분 없고, 반대쪽 파일의 특징적 컬럼이 많이 발견되면 → 파일 종류 불일치
  if (missingRequired.length >= 3 && matchedOther.length >= 3) {
    throw new Error(
      `이 파일은 "${expectedLabel}" 파일 형식이 아니라 "${otherLabel}" 파일로 보입니다.\n` +
      `올바른 업로드 영역에 다시 올려주세요.`
    );
  }

  // 기대한 컬럼이 일부라도 빠진 경우 → 형식이 다르거나 손상된 파일일 가능성
  if (missingRequired.length > 0) {
    throw new Error(
      `"${expectedLabel}" 파일에 필요한 컬럼이 없습니다: ${missingRequired.join(', ')}\n` +
      `엑셀 파일의 헤더 행(1행)을 확인해주세요.`
    );
  }
}

function parsePurchaseFile(workbook) {
  const allRows = [];

  workbook.SheetNames.forEach(sheetName => {
    const ws = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    data.forEach((row, idx) => {
      if (idx === 0) return; // 헤더 행
      const no = parseStr_(row[0]);
      const vendorName = parseStr_(row[2]);

      // 그룹 헤더 행 스킵: No.가 비어있고 '공급업체 :' 텍스트만 있는 행
      if (!no) return;

      const receivedDate = parseDateDot_(row[8]);
      allRows.push({
        vendor_code:   parseStr_(row[1]),
        vendor_name:   vendorName,
        purchase_no:   parseStr_(row[3]),
        item_type:     parseStr_(row[4]),
        item_code:     parseStr_(row[5]),
        item_name:     parseStr_(row[6]),
        status:        parseStr_(row[7]),
        received_date: receivedDate,
        quantity:      parseNum_(row[9]),
        unit_price:    parseNum_(row[10]),
        supply_amount: parseNum_(row[11]),
        vat_amount:    parseNum_(row[12]),
        total_amount:  parseNum_(row[13]),
        spec:          parseStr_(row[14]),
        calc_unit:     parseStr_(row[15]),
        receive_unit:  parseStr_(row[16]),
        dept:          parseStr_(row[17]),
        _ym:           ymFromDate_(receivedDate),
      });
    });
  });

  return allRows;
}

// ── 사용현황 파일 파싱 ─────────────────────────────────────
// 컬럼: No. | 부서명 | 자재구분 | 자재코드 | 자재명 | 구매번호 | 구매의뢰자 | LOT No. |
//       창고입고일 | 창고입고(입) | 창고재고(입) | 불출신청자 | 부서입고일 | 부서입고(입) | 부서입고(산) |
//       사용일자 | 사용수량(입) | 사용수량(산) | 사용공급가 | 사용부가세 | 사용합계 |
//       부서재고(입) | 부서재고(산) | 사용일 | 재고보유일 | 사용자 | 공급업체 | 규격
function parseUsageFile(workbook) {
  const allRows = [];

  workbook.SheetNames.forEach(sheetName => {
    const ws = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    data.forEach((row, idx) => {
      if (idx === 0) return; // 헤더 행
      const no = parseStr_(row[0]);
      if (!no) return; // 빈 행 스킵

      const usageDate = parseDateDot_(row[15]);
      allRows.push({
        dept:                parseStr_(row[1]),
        item_type:           parseStr_(row[2]),
        item_code:           parseStr_(row[3]),
        item_name:           parseStr_(row[4]),
        purchase_no:         parseStr_(row[5]),
        requester:           parseStr_(row[6]),
        lot_no:              parseStr_(row[7]),
        warehouse_in_date:   parseDateDot_(row[8]),
        warehouse_in_qty:    parseNum_(row[9]),
        warehouse_stock_qty: parseNum_(row[10]),
        release_requester:   parseStr_(row[11]),
        dept_in_date:        parseDateDot_(row[12]),
        dept_in_qty:         parseNum_(row[13]),
        dept_in_calc_qty:    parseNum_(row[14]),
        usage_date:          usageDate,
        usage_qty:           parseNum_(row[16]),
        usage_calc_qty:      parseNum_(row[17]),
        usage_supply:        parseNum_(row[18]),
        usage_vat:           parseNum_(row[19]),
        usage_total:         parseNum_(row[20]),
        dept_stock_qty:      parseNum_(row[21]),
        dept_stock_calc_qty: parseNum_(row[22]),
        usage_days:          parseNum_(row[23]),
        stock_hold_days:     parseNum_(row[24]),
        used_by:             parseStr_(row[25]),
        vendor_name:         parseStr_(row[26]),
        spec:                parseStr_(row[27]),
        _ym:                 ymFromDate_(usageDate),
      });
    });
  });

  return allRows;
}

// ── 연월별 그룹핑 (한 파일에 여러 달이 섞여 있을 수 있음) ─────
// targetYear가 주어지면 해당 연도(YYYY)에 해당하는 행만 포함
function groupByYm_(rows, targetYear) {
  const groups = {};
  rows.forEach(r => {
    const ym = r._ym;
    if (!ym) return; // 날짜 파싱 실패한 행은 제외
    if (targetYear && ym.slice(0, 4) !== String(targetYear)) return; // 선택 연도 외 데이터 제외
    if (!groups[ym]) groups[ym] = [];
    const { _ym, ...rest } = r;
    groups[ym].push(rest);
  });
  return groups;
}

// ── 업로드 전 사전 점검: 파일에 어느 연월이 포함되어 있는지만 확인 ──
// (실제 업로드 없이, 재업로드 시 덮어쓸 월을 미리 알려주기 위함)
async function peekStatsFileMonths(file, kind, targetYear) {
  const buf = await file.arrayBuffer();
  const workbook = XLSX.read(buf, { type: 'array' });

  validateFileHeaders_(workbook, kind);

  const rows = kind === 'purchase' ? parsePurchaseFile(workbook) : parseUsageFile(workbook);

  const months = new Set();
  rows.forEach(r => {
    if (r._ym && r._ym.slice(0, 4) === String(targetYear)) {
      months.add(r._ym.slice(5, 7));
    }
  });

  return [...months].sort();
}

// ── 업로드 메인 함수 ───────────────────────────────────────
// file: <input type="file"> 에서 받은 File 객체
// branch: '서울숲' | '강북' | '강남'
// kind: 'purchase' | 'usage'
// targetYear: '2026' 같은 문자열 — 선택한 연도 외 데이터는 무시
// onProgress: ({ phase, current, total, ym }) => void — 진행 상황 콜백 (옵션)
//   phase: 'parsing' | 'uploading'
async function uploadStatsFile(file, branch, kind, targetYear, onProgress) {
  const notify = (info) => { if (typeof onProgress === 'function') onProgress(info); };

  notify({ phase: 'parsing' });

  const buf = await file.arrayBuffer();
  const workbook = XLSX.read(buf, { type: 'array' });

  validateFileHeaders_(workbook, kind);

  const rows = kind === 'purchase' ? parsePurchaseFile(workbook) : parseUsageFile(workbook);
  if (!rows.length) {
    throw new Error('파싱된 데이터가 없습니다. 파일 형식을 확인해주세요.');
  }

  const grouped = groupByYm_(rows, targetYear);
  const ymList = Object.keys(grouped).sort();

  if (!ymList.length) {
    throw new Error(targetYear
      ? `선택한 연도(${targetYear})에 해당하는 데이터가 파일에 없습니다.`
      : '날짜를 인식할 수 없습니다.');
  }

  const user = window.auth?.getSession?.();
  const action = kind === 'purchase' ? 'uploadPurchaseRecords' : 'uploadUsageRecords';

  const results = [];
  for (let i = 0; i < ymList.length; i++) {
    const ym = ymList[i];
    notify({ phase: 'uploading', current: i, total: ymList.length, ym });

    const res = await apiPost(action, {
      branch,
      ym,
      source_file: file.name,
      rows: grouped[ym],
      uploaded_by: user?.email || 'unknown',
    });
    results.push({ ym, count: grouped[ym].length, message: res.message });

    notify({ phase: 'uploading', current: i + 1, total: ymList.length, ym });
  }

  return results;
}

window.uploadStatsFile = uploadStatsFile;
window.peekStatsFileMonths = peekStatsFileMonths;
window.validateStatsFileHeaders = async function(file, kind) {
  const buf = await file.arrayBuffer();
  const workbook = XLSX.read(buf, { type: 'array' });
  validateFileHeaders_(workbook, kind);
};
