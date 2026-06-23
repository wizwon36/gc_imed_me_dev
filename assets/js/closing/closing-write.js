// ============================================================
// closing-write.js
// ExcelJS 서식상수 + 시트 write 함수 + 수불/원재료비 계산 함수
// ============================================================

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
// 천원 단위 표시 (원 단위 저장, numFmt으로 /1000 표시)
const NUM_FMT_K = '#,##0,;[Red]-#,##0,;"-"';
function numCellK(ws, r, c, v, fill, bold = false) {
  const nv = Math.round(toN(v));
  const cell = ws.getCell(r, c);
  sc(cell, {
    value: nv,
    font: nv < 0 ? (bold ? F.redb : F.red) : (bold ? F.total : F.base),
    fill: fill || FILL.odd,
    alignment: AL('right'),
    border: BORDER_DATA,
    numFmt: NUM_FMT_K,
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
function totalRow(ws, r, numCols, numVals, textCols, textVals, fmt = NUM_FMT) {
  numCols.forEach((c, i) => {
    const cell = ws.getCell(r, c);
    sc(cell, { value: Math.round(toN(numVals[i])) || null, font: F.total, fill: FILL.total, alignment: AL('right'), border: BORDER_TOTAL, numFmt: fmt });
  });
  textCols.forEach((c, i) => {
    sc(ws.getCell(r, c), { value: textVals[i] || null, font: F.total, fill: FILL.total, alignment: AL('center'), border: BORDER_TOTAL });
  });
  ws.getRow(r).height = 18;
}
function subtotRow(ws, r, textCols, textVals, numCols, numVals, fmt = NUM_FMT) {
  textCols.forEach((c, i) => sc(ws.getCell(r, c), { value: textVals[i] || null, font: F.bold, fill: FILL.subtot, alignment: AL('center'), border: BORDER_THIN }));
  numCols.forEach((c, i) => { const cell = ws.getCell(r, c); sc(cell, { value: Math.round(toN(numVals[i])) || null, font: F.bold, fill: FILL.subtot, alignment: AL('right'), border: BORDER_THIN, numFmt: fmt }); });
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
function writeDeptAmount(ws, month, depts, skipZero = false) {
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
    // skipZero=true일 때만 합계 0인 그룹 생략 (GC케어용)
    const groupTotal = sumF(g.items, '합계금액');
    if (skipZero && !groupTotal) return;
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

  // 1행: D1~L1 노란색 채우기
  const YELLOW_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
  for (let c = 4; c <= 12; c++) {
    ws.getCell(1, c).fill = YELLOW_FILL;
  }

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
    // 수량: 소수 2자리까지 저장, 표시는 정수형태(numFmt '0')
    const 기초수량  = Math.round((it.기초수량 || 0) * 100) / 100;
    const 증가수량  = Math.round((it.증가수량 || 0) * 100) / 100;
    const 감소수량  = Math.round((it.감소수량 || 0) * 100) / 100;
    const 기말     = 기초 + it.증가 - it.감소;
    const 기말수량  = Math.round((기초수량 + 증가수량 - 감소수량) * 100) / 100;

    const accCell = (c, v, isQty = false) => {
      const cell = ws.getCell(r, c);
      cell.value = isQty ? (Math.round(toN(v) * 100) / 100) : Math.round(toN(v));
      cell.font = cell.value < 0 ? F.red : F.base;
      cell.fill = fill || FILL.odd;
      cell.alignment = AL('right');
      cell.border = BORDER_DATA;
      cell.numFmt = isQty ? '0' : NUM_FMT;  // 수량: 정수 표시, 금액: 천단위
    };

    txtCell(ws, r, 1, it.code, FILL.odd);
    txtCell(ws, r, 2, it.name, typeFill);
    txtCell(ws, r, 3, it.type, typeFill, false, true);
    accCell(4,  기초수량, true);
    accCell(5,  0);          // 기초단가
    accCell(6,  기초);
    accCell(7,  증가수량, true);
    accCell(8,  it.증가);
    accCell(9,  감소수량, true);
    accCell(10, it.감소);
    accCell(11, 기말수량, true);
    accCell(12, 0);          // 기말단가
    accCell(13, 기말);
    ws.getRow(r).height = 18; r++;
  });

  const t기초    = sorted.reduce((s, it) => s + (it.기초 || 0), 0);
  // 총합계 수량: 소수 합산 후 소수 2자리, 표시는 정수(numFmt '0')
  const t기초수량 = Math.round(sorted.reduce((s, it) => s + (it.기초수량 || 0), 0) * 100) / 100;
  const tI       = sorted.reduce((s, it) => s + it.증가, 0);
  const tI수량   = Math.round(sorted.reduce((s, it) => s + (it.증가수량 || 0), 0) * 100) / 100;
  const tD       = sorted.reduce((s, it) => s + it.감소, 0);
  const tD수량   = Math.round(sorted.reduce((s, it) => s + (it.감소수량 || 0), 0) * 100) / 100;
  const t기말    = t기초 + tI - tD;
  const t기말수량 = Math.round((t기초수량 + tI수량 - tD수량) * 100) / 100;
  ws.mergeCells(r, 1, r, 3);
  totalRow(ws, r, [4, 6, 7, 8, 9, 10, 11, 13],
    [t기초수량, t기초, tI수량, tI, tD수량, tD, t기말수량, t기말],
    [1], ['총합계']);
  // 수량 컬럼(4,7,9,11) numFmt '0' 적용 (소수 저장, 정수 표시)
  [4, 7, 9, 11].forEach(c => { ws.getCell(r, c).numFmt = '0'; });
  // 총합계 수량 열 numFmt='0' (소수 저장, 정수 표시)
  [4, 7, 9, 11].forEach(c => { ws.getCell(r, c).numFmt = '0'; });
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
    txtCell(ws, r, 3, lbl, fill, true, true); ws.getCell(r, 3).border = BORDER_THIN;
    [6, 8, 10, 13].forEach(c => { ws.getCell(r, c).border = BORDER_THIN; });
    numCell(ws, r, 6,  subSum(arr,'기초'), fill); ws.getCell(r, 6).border  = BORDER_THIN;
    numCell(ws, r, 8,  subSum(arr,'증가'), fill); ws.getCell(r, 8).border  = BORDER_THIN;
    numCell(ws, r, 10, subSum(arr,'감소'), fill); ws.getCell(r, 10).border = BORDER_THIN;
    numCell(ws, r, 13, subSum(arr,'기말'), fill); ws.getCell(r, 13).border = BORDER_THIN;
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
    numCell(ws, r, 8,  supV, dataFill); ws.getCell(r, 8).border  = BORDER_THIN;
    numCell(ws, r, 9,  vatV, dataFill); ws.getCell(r, 9).border  = BORDER_THIN;
    numCell(ws, r, 10, totV, dataFill); ws.getCell(r, 10).border = BORDER_THIN;
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
    txtCell(ws, r, 9, lbl, FILL.odd, false, false); ws.getCell(r, 9).border = BORDER_THIN;
    const dc = ws.getCell(r, 10);
    dc.value = diffVal;
    dc.font = diffVal !== 0
      ? { name:'Calibri', size:10, color:{argb:'FFFF0000'}, bold:true }
      : F.base;
    dc.fill = FILL.odd; dc.alignment = AL('right');
    dc.border = BORDER_THIN; dc.numFmt = NUM_FMT;
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
    txtCell(ws, r, 6, '사용현황자료', FILL.subtot, true, true); ws.getCell(r, 6).border = BORDER_THIN;
    const tc=ws.getCell(r,7); tc.value=tag; tc.font=F.bold; tc.fill=tagFill; tc.alignment=AL('center'); tc.border=BORDER_THIN;
    hdrCell(ws, r, 8, '공급가액');
    hdrCell(ws, r, 9, '부가세액');
    hdrCell(ws, r, 10, '계');
    ws.getRow(r).height = 18; r++;
    [['소모품', somoRow], ['시약', siykRow]].forEach(([lbl,[sup,vat,tot]]) => {
      txtCell(ws, r, 7, lbl, FILL.odd, false, true); ws.getCell(r, 7).border = BORDER_THIN;
      numCell(ws, r, 8, sup, FILL.odd); ws.getCell(r, 8).border = BORDER_THIN;
      numCell(ws, r, 9, vat, FILL.odd); ws.getCell(r, 9).border = BORDER_THIN;
      numCell(ws, r, 10, tot, FILL.odd); ws.getCell(r, 10).border = BORDER_THIN;
      ws.getRow(r).height = 18; r++;
    });
    r++;
  });
}


// ═══════════════════════════════════════════════════════════
// 13. 수불 기초 재고 (closing_stock API 연동)
// ═══════════════════════════════════════════════════════════

// 전월 기말 재고 로드 → subulMap 기초값으로 세팅
// 전월 closing_stock이 없을 때 closing_usage_monthly의 end_amount를 기초로 사용
async function loadPrevStockFromUsage(ym, branch, reportType) {
  try {
    const user = window.auth?.getSession?.();
    const res  = await apiGet('closingGetUsageMonthly', {
      request_user_email: user?.email,
      ym, branch,
    });
    const data = Array.isArray(res.data) ? res.data : [];
    return data
      .filter(u => u.end_amount && u.report_type === reportType
                && (u.ym || '').replace(/^'/, '') === ym)
      .map(u => ({
        dept:           u.dept,
        item_code:      '',
        item_name:      '',
        item_type:      u.item_type,
        closing_qty:    0,
        closing_amount: Math.round(u.end_amount),
      }));
  } catch (e) {
    return [];
  }
}

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
  // 그룹핑 맵 (extra2 기준, GC케어/아이메드 공용)
  const master = R.closingDeptMaster || [];
  const groups = buildImedDeptGroups(master);
  const deptToGroup = {};
  groups.forEach(g => g.depts.forEach(dept => { deptToGroup[dept] = g.displayName; }));
  const resolveGroup = dept => deptToGroup[dept] || dept;

  const gcMap = {}, imedMap = {};

  // GC케어: 시약만 저장 (소모품은 closing_usage_monthly 저장 대상 아님)
  R.usageSiyak.forEach(r => {
    const rawDept = String(r['부서명'] || '').trim(); if (!rawDept) return;
    const dept = resolveGroup(rawDept);
    const type = String(r['자재구분'] || '').trim();
    const k = dept + '||' + type;
    if (!gcMap[k]) gcMap[k] = { dept, item_type: type, report_type: 'GC케어', usage_amount: 0 };
    gcMap[k].usage_amount += toN(r['사용공급가']);
  });

  // 아이메드: 의약품 → 그룹명으로 합산
  R.usageImed.forEach(r => {
    const rawDept = String(r['부서명'] || '').trim(); if (!rawDept) return;
    const dept = resolveGroup(rawDept);
    const type = String(r['자재구분'] || '').trim();
    const k = dept + '||' + type;
    if (!imedMap[k]) imedMap[k] = { dept, item_type: type, report_type: '아이메드', usage_amount: 0 };
    imedMap[k].usage_amount += toN(r['사용합계']);  // 아이메드는 부가세포함(사용합계)
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

  // GC케어: extra1='시약' 부서만 필터 후 extra2 그룹핑
  const gcSiyakMaster = isGC
    ? (R.closingDeptMaster || []).filter(d => String(d.extra1 || '').trim() === '시약')
    : [];
  const gcGroups = isGC ? buildImedDeptGroups(gcSiyakMaster) : null;
  // 아이메드: extra2 그룹핑 → 그룹명으로 합산
  const imedGroups = !isGC ? buildImedDeptGroups(R.closingDeptMaster || []) : null;

  // dept → 그룹명 역방향 매핑 (extra2 기준)
  const allGroups = isGC ? (gcGroups || []) : (imedGroups || []);
  const deptToGroupName = {};
  allGroups.forEach(g => g.depts.forEach(d => { deptToGroupName[d] = g.displayName; }));
  allGroups.forEach(g => { deptToGroupName[g.displayName] = g.displayName; });

  const prevDeptStock = {};
  const prevHasNoDept = prevStockData.length > 0 && prevStockData.every(s => !s.dept);
  prevStockData
    .filter(s => !s.item_type || s.item_type === targetType)
    .forEach(s => {
      let dept = prevHasNoDept ? '_total' : (s.dept || '');
      if (!prevHasNoDept && !isGC) dept = deptToGroupName[dept] || dept;
      const k = isGC ? dept + '||' + targetType : dept;
      if (!prevDeptStock[k]) prevDeptStock[k] = 0;
      prevDeptStock[k] += toN(s.closing_amount);
    });

  const prevDeptStockGrouped = {};
  if (prevHasNoDept) {
    // dept 없는 경우(수불부 초기 업로드): 전체 합산값을 모든 그룹에 배분하지 않고
    // '_total' 키로 저장 → 행 생성 시 납품처 단일행으로 표시
    prevDeptStockGrouped['_total||' + targetType] = prevDeptStock['_total||' + targetType] || 0;
  } else if (gcGroups) {
    gcGroups.forEach(g => {
      prevDeptStockGrouped[g.displayName + '||' + targetType] =
        g.depts.reduce((s, dept) => s + (prevDeptStock[dept + '||' + targetType] || 0), 0);
    });
  }
  if (!prevHasNoDept && imedGroups) {
    imedGroups.forEach(g => {
      // g.depts로 먼저 찾고, 값이 없으면 displayName(그룹명) 자체로 찾음
      // closing_stock에 그룹명으로 저장된 경우(강북 초기업로드) 대응
      const byDepts = g.depts.reduce((s, dept) => s + (prevDeptStock[dept] || 0), 0);
      const byGroup = byDepts === 0 ? (prevDeptStock[g.displayName] || 0) : 0;
      prevDeptStockGrouped[g.displayName + '||' + targetType] = byDepts + byGroup;
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
    ...Object.keys(prevDeptStockFinal).filter(k => !k.startsWith('_total')),
  ])];

  // dept 없는 초기 업로드의 경우 _total 키 별도 처리
  const totalBase = prevHasNoDept ? toN(prevDeptStockFinal['_total||' + targetType]) : 0;

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
    // dept 없는 초기 업로드: 기초를 totalBase에서 배분 (전체를 첫 번째 행에 합산)
    const base  = prevHasNoDept && ri === 0
      ? totalBase + toN(prevDeptStockFinal[k])
      : toN(prevDeptStockFinal[k]);
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
    ws.getCell(r, 6).value = '-VAT';
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
    txtCell(ws, r, 3, '계', null, true, true); ws.getCell(r, 3).border = BORDER_THIN;
    numCell(ws, r, 4, vaccineUse, FILL.subtot); ws.getCell(r, 4).border = BORDER_THIN;
    txtCell(ws, r, 5, '', FILL.subtot); ws.getCell(r, 5).border = BORDER_THIN;
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
    txtCell(ws, r, 3, '계', null, true, true); ws.getCell(r, 3).border = BORDER_THIN;
    numCell(ws, r, 4, 0, FILL.subtot); ws.getCell(r, 4).border = BORDER_THIN;
    txtCell(ws, r, 5, '', FILL.subtot); ws.getCell(r, 5).border = BORDER_THIN;
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
          (yearMap[yr][groupName]['m' + mon] || 0) + Math.round(u.usage_amount );
        if (mon === '01' && u.base_amount)
          yearMap[yr][groupName].base = (yearMap[yr][groupName].base || 0) + Math.round(u.base_amount );
        // end_amount: 연도별 가장 마지막 달 기준으로 덮어씀 (B안)
        if (u.end_amount) {
          const prev = yearMap[yr][groupName]._endMon || '00';
          if (mon >= prev) {
            yearMap[yr][groupName].end    = Math.round(u.end_amount );
            yearMap[yr][groupName]._endMon = mon;
          }
        }
      });

    // 당월 추가 (그룹별 원단위 합산)
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
      yearMap[R.y][groupName]['m' + curMon] = Math.round(raw );
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
      if (!d.base && baseAmt) d.base = Math.round(baseAmt );

      const buy = memberDepts.reduce((s, dept) =>
        s + R.gcIpgo
          .filter(r => String(r['의뢰부서']||'').trim() === dept && String(r['자재구분']||'').trim() === targetType)
          .reduce((acc, r) => acc + toN(r['공급가액']), 0), 0);
      const use = memberDepts.reduce((s, dept) =>
        s + R.usageSiyak
          .filter(r => String(r['부서명']||'').trim() === dept)
          .reduce((acc, r) => acc + toN(r['사용공급가']), 0), 0);
      d.end = Math.round((baseAmt + buy - use) );
    });

    const years = Object.keys(yearMap).sort((a, b) => b.localeCompare(a));
    let r = 1;
    years.forEach(yr => {
      const data = yearMap[yr];
      // 마스터 순서: gcGroups 기준, 데이터에만 있는 그룹은 뒤에 추가
      const masterDepts = gcGroups.map(g => g.displayName);
      const dataDepts   = Object.keys(data);
      const deptKeys = (masterDepts.length && yr === R.y)
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
        numCellK(ws, r, 2, d.base || 0, fill);
        months.forEach((mon, mi) => {
          const v = d['m' + mon] || 0;
          colTotals[mi + 3] = (colTotals[mi + 3] || 0) + v;
          numCellK(ws, r, mi + 3, v, yr === R.y && mon === curMon ? CUR_FILL : fill);
        });
        numCellK(ws, r, 15, d.end || 0, fill);
        txtCell(ws, r, 16, `${dept} - 시약`, fill);
        ws.getRow(r).height = 18; r++;
      });

      if (r - 1 > groupStart) ws.mergeCells(groupStart, 1, r - 1, 1);
      ws.getCell(groupStart, 1).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };

      subtotRow(ws, r, [1], ['소  계'],
        [2, ...months.map((_, i) => i + 3), 15],
        [colTotals.base, ...months.map((_, i) => colTotals[i + 3] || 0), colTotals.end]
      , NUM_FMT_K);
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
      (yearMap[yr][groupName]['m' + mon] || 0) + Math.round(amt );
  };

  yearUsage
    .filter(u => u.item_type === '의약품' || u.item_type === '시약' || u.item_type === '세포치료' || u.item_type === '특수의약품')
    .forEach(u => {
      const parts = (u.ym || '').split('-');
      const yr = parts[0]; const mon = parts[1];
      if (!yr || !mon) return;
      // 세포치료/특수의약품은 그룹핑 없이 item_type을 그대로 키로 사용
      const isCellOrSpecial = u.item_type === '세포치료' || u.item_type === '특수의약품';
      const groupName = isCellOrSpecial ? u.item_type : resolveGroup(u.dept || '');
      // 시약은 extra1='시약' 부서만
      if (u.item_type === '시약' && !siyakDeptNames.has(u.dept || '')) return;
      addToMap(yr, mon, groupName, u.usage_amount || 0);
      if (mon === '01' && u.base_amount) {
        if (!yearMap[yr]) yearMap[yr] = {};
        if (!yearMap[yr][groupName]) yearMap[yr][groupName] = { base: 0, end: 0 };
        yearMap[yr][groupName].base += Math.round(u.base_amount );
      }
      // end_amount: 연도별 가장 마지막 달 기준으로 덮어씀 (B안)
      if (u.end_amount) {
        if (!yearMap[yr]) yearMap[yr] = {};
        if (!yearMap[yr][groupName]) yearMap[yr][groupName] = { base: 0, end: 0 };
        const prev = yearMap[yr][groupName]._endMon || '00';
        if (mon >= prev) {
          yearMap[yr][groupName].end    = Math.round(u.end_amount );
          yearMap[yr][groupName]._endMon = mon;
        }
      }
    });

  // 당월 추가 (의약품 + 시약5%) — 그룹별 원단위 합산
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

  // 그룹별 합산 후 원단위로 yearMap에 저장
  const allCurGroups = new Set([...Object.keys(imedCurRaw), ...Object.keys(siyakCurRaw)]);
  allCurGroups.forEach(groupName => {
    if (!yearMap[R.y][groupName]) yearMap[R.y][groupName] = { base: 0, end: 0 };
    const combined = (imedCurRaw[groupName] || 0) + (siyakCurRaw[groupName] || 0);
    yearMap[R.y][groupName]['m' + curMon] = Math.round(combined );
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
      if (base) d.base = Math.round(base );
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
    d.end = Math.round((baseAmt + buyImed - useImed) );
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
    const rawGroupKeys = (masterGroups.length && yr === R.y)
      ? [...new Set([...masterGroups, ...dataGroups])].sort((a, b) => {
          const ai = masterGroups.indexOf(a); const bi = masterGroups.indexOf(b);
          if (ai >= 0 && bi >= 0) return ai - bi;
          if (ai >= 0) return -1; if (bi >= 0) return 1;
          return a.localeCompare(b, 'ko');
        })
      : dataGroups.sort((a, b) => a.localeCompare(b, 'ko'));
    const EXTRA_ROWS = new Set(['세포치료', '특수의약품']);
    const groupKeys = rawGroupKeys.filter(g => !/의료공통|의료 공통/i.test(g) && !EXTRA_ROWS.has(g));
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
      numCellK(ws, r, 2, d.base || 0, fill);
      months.forEach((mon, mi) => {
        const v = d['m' + mon] || 0;
        colTotals[mi + 3] = (colTotals[mi + 3] || 0) + v;
        numCellK(ws, r, mi + 3, v, yr === R.y && mon === curMon ? CUR_FILL : fill);
      });
      numCellK(ws, r, 15, d.end || 0, fill);
      ws.getRow(r).height = 18; r++;
    });

    // 소계 저장 (우측 비교 테이블용)
    yearMonTotals[yr] = { base: colTotals.base, end: colTotals.end };
    months.forEach((mon, mi) => { yearMonTotals[yr]['m' + mon] = colTotals[mi + 3] || 0; });

    // ── 총 계
    subtotRow(ws, r, [1], ['총  계'],
      [2, ...months.map((_, i) => i + 3), 15],
      [colTotals.base, ...months.map((_, i) => colTotals[i + 3] || 0), colTotals.end]
    , NUM_FMT_K);
    if (yr === R.y) {
      const cc = ws.getCell(r, months.indexOf(curMon) + 3);
      cc.fill = CUR_FILL;
    }
    ws.getRow(r).height = 18; r++;

    // ── 세포치료 / 특수의약품 (DB 데이터가 있으면 값 출력, 없으면 빈칸)
    ['세포치료', '특수의약품'].forEach(lbl => {
      const lFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF0F0' } };
      const d = data[lbl] || null;
      const ac = ws.getCell(r, 1); ac.fill = lFill; ac.border = BORDER_THIN;  // A열 빈칸
      txtCell(ws, r, 2, lbl, lFill, false, true); ws.getCell(r, 2).border = BORDER_THIN;
      months.forEach((mon, mi) => {
        const c = mi + 3;
        const v = d ? (d['m' + mon] || 0) : 0;
        if (d && v) {
          numCellK(ws, r, c, v, yr === R.y && mon === curMon ? CUR_FILL : lFill);
          ws.getCell(r, c).border = BORDER_THIN;
        } else {
          const cell = ws.getCell(r, c); cell.fill = (yr === R.y && mon === curMon ? CUR_FILL : lFill); cell.border = BORDER_THIN;
        }
      });
      // 15열(기말)은 항상 빈칸
      const endCell = ws.getCell(r, 15); endCell.fill = lFill; endCell.border = BORDER_THIN;
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
        numCellK(ws, tr, TC + 1, curAmt - prevAmt, fill);
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

  try {
    showGlobalLoading('마감 확정 저장 중...');
    const user  = window.auth?.getSession?.();

    // 담당자 표시명: 소속의원/팀/이름
    const confirmedBy = [
      user?.clinic_name || '',
      user?.team_name   || '',
      user?.user_name   || user?.email || '',
    ].filter(Boolean).join(' / ');

    // 전월 기초재고 로드 (아이메드 기말 계산용)
    const prevStockData = R.prevStockData || await loadPrevStock(prevYm, R.branch);

    // ── 시약/소모품: 품목코드 기준 기말 저장 — 의약품·기말0 항목 제외
    const items = Object.values(R.subulMap)
      .filter(it => String(it.type || '').trim() !== '의약품')
      .filter(it => (it.기초 || 0) + it.증가 + it.감소 > 0)
      .map(it => ({
        dept:           '',
        item_code:      it.code,
        item_name:      it.name,
        item_type:      it.type,
        closing_qty:    (it.기초수량 || 0),
        closing_amount: Math.round((it.기초 || 0) + it.증가 - it.감소),
      }))
      .filter(it => it.closing_amount !== 0);  // 기말 0원 저장 생략

    // ── 의약품: 3시트(writeWonjaeryo)와 동일한 방식으로 부서별 기말 계산 후 저장
    //    기말 = 기초(전월 closing_stock) + 당기매입(합계금액=부가세포함) - 당기사용(사용합계=부가세포함)
    //    + 시약5%(부가세포함) 합산
    const imedGroups = buildImedDeptGroups(R.closingDeptMaster || []);
    const deptToGroup = {};
    imedGroups.forEach(g => g.depts.forEach(dept => { deptToGroup[dept] = g.displayName; }));
    const resolveGroup = dept => deptToGroup[dept] || dept;

    const siyakDeptNames = new Set(
      (R.closingDeptMaster || [])
        .filter(d => String(d.extra1 || '').trim() === '시약')
        .map(d => String(d.code_name || '').trim())
    );

    // 기초: 전월 closing_stock 의약품 → 그룹별 합산
    const imedBase = {};
    prevStockData
      .filter(s => s.item_type === '의약품')
      .forEach(s => {
        const g = resolveGroup(s.dept || '');
        imedBase[g] = (imedBase[g] || 0) + toN(s.closing_amount);
      });

    // 당기매입: imedIpgo 의약품 합계금액(부가세포함) → 그룹별 합산
    const imedBuy = {};
    (R.imedIpgo || [])
      .filter(r => String(r['자재구분'] || '').trim() === '의약품')
      .forEach(r => {
        const g = resolveGroup(String(r['의뢰부서'] || '').trim());
        imedBuy[g] = (imedBuy[g] || 0) + toN(r['합계금액']);
      });

    // 당기사용: usageImed 사용합계(부가세포함) → 그룹별 합산
    const imedUse = {};
    (R.usageImed || []).forEach(r => {
      const g = resolveGroup(String(r['부서명'] || '').trim());
      imedUse[g] = (imedUse[g] || 0) + toN(r['사용합계']);
    });

    // 시약5%(부가세포함) → 시약 부서만, 그룹별 합산해서 매입+사용에 추가
    (R.imedSiSoPivot5 || [])
      .filter(d => String(d.자재구분 || '').trim() === '시약' && siyakDeptNames.has(String(d.부서명 || '').trim()))
      .forEach(d => {
        const g   = resolveGroup(String(d.부서명 || '').trim());
        const amt = toN(d.사용합계 || 0);
        imedBuy[g] = (imedBuy[g] || 0) + amt;
        imedUse[g] = (imedUse[g] || 0) + amt;
      });

    // 그룹별 기말 = 기초 + 매입 - 사용, 0이 아닌 것만 저장
    const allGroups = new Set([...Object.keys(imedBase), ...Object.keys(imedBuy), ...Object.keys(imedUse)]);
    allGroups.forEach(g => {
      const end = Math.round((imedBase[g] || 0) + (imedBuy[g] || 0) - (imedUse[g] || 0));
      if (end !== 0) {
        items.push({
          dept:           g,
          item_code:      '',
          item_name:      '',
          item_type:      '의약품',
          closing_qty:    0,
          closing_amount: end,
        });
      }
    });

    await apiPost('closingSaveStock', {
      request_user_email: user?.email,
      confirmed_by_display: confirmedBy,
      branch: R.branch,
      ym,
      items,
    });

    // 당월 부서별 사용 데이터 저장 (GC케어/아이메드 분리)
    // end_amount: 현재 월의 기말재고 → 4시트 연간 원재료비의 기말 컬럼에 표시됨

    // ── GC케어 기말: 시약 부서별 (기초+매입-사용, 부가세 미포함, 천원 단위)
    const gcSiyakMasterForEnd = (R.closingDeptMaster || [])
      .filter(d => String(d.extra1 || '').trim() === '시약');
    const gcGroupsForEnd = buildImedDeptGroups(gcSiyakMasterForEnd);
    const gcDeptToGroupEnd = {};
    gcGroupsForEnd.forEach(g => g.depts.forEach(dept => { gcDeptToGroupEnd[dept] = g.displayName; }));

    const gcEndMap = {};  // groupName → end_amount (원 단위)
    // 기초
    prevStockData
      .filter(s => s.item_type === '시약')
      .forEach(s => {
        const g = gcDeptToGroupEnd[s.dept || ''] || s.dept || '';
        gcEndMap[g] = (gcEndMap[g] || 0) + toN(s.closing_amount);
      });
    // 매입 (공급가액, 부가세 미포함)
    (R.gcIpgo || [])
      .filter(r => String(r['자재구분'] || '').trim() === '시약')
      .forEach(r => {
        const g = gcDeptToGroupEnd[String(r['의뢰부서'] || '').trim()] || String(r['의뢰부서'] || '').trim();
        gcEndMap[g] = (gcEndMap[g] || 0) + toN(r['공급가액']);
      });
    // 사용 (사용공급가, 부가세 미포함) — 차감
    (R.usageSiyak || []).forEach(r => {
      const g = gcDeptToGroupEnd[String(r['부서명'] || '').trim()] || String(r['부서명'] || '').trim();
      gcEndMap[g] = (gcEndMap[g] || 0) - toN(r['사용공급가']);
    });

    // ── 아이메드 기말: items 배열에서 이미 계산된 그룹별 end 재사용
    const imedEndMap = {};  // groupName → end_amount (원 단위)
    items
      .filter(it => it.item_type === '의약품' && it.dept)
      .forEach(it => { imedEndMap[it.dept] = toN(it.closing_amount); });

    const usageItems = buildDeptUsageForMonthly(R);
    const gcUsageItems   = usageItems.filter(it => it.report_type === 'GC케어');
    const imedUsageItems = usageItems.filter(it => it.report_type === '아이메드');

    // end_amount: GC케어는 시약에만, 아이메드는 의약품에만 붙임
    gcUsageItems
      .filter(it => it.item_type === '시약')
      .forEach(it => {
        const g = gcDeptToGroupEnd[it.dept] || it.dept;
        if (gcEndMap[g] !== undefined) it.end_amount = Math.round(gcEndMap[g]);
      });
    imedUsageItems
      .filter(it => it.item_type === '의약품')
      .forEach(it => {
        const g = resolveGroup(it.dept);
        if (imedEndMap[g] !== undefined) it.end_amount = Math.round(imedEndMap[g]);
      });

    // ── 강남의원 전용: 세포치료 / 특수의약품 사용금액 추가
    if ((R.branch || '').includes('강남')) {
      const parseAmt = id => {
        const v = document.getElementById(id)?.value?.replace(/,/g, '') || '0';
        return Math.round(parseFloat(v) || 0);
      };
      const cellAmt    = parseAmt('inputCellTherapy');
      const specialAmt = parseAmt('inputSpecialMed');
      if (cellAmt > 0) {
        imedUsageItems.push({ dept: '세포치료', item_type: '세포치료',
          report_type: '아이메드', usage_amount: cellAmt,
          base_amount: 0, end_amount: 0 });
      }
      if (specialAmt > 0) {
        imedUsageItems.push({ dept: '특수의약품', item_type: '특수의약품',
          report_type: '아이메드', usage_amount: specialAmt,
          base_amount: 0, end_amount: 0 });
      }
    }

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

    // ── 메인 저장 완료: 스피너 먼저 종료 후 완료 표시
    await hideGlobalLoading();
    btn.disabled    = true;
    btn.textContent = '✓ 확정 완료';
    btn.style.background = '#0e7c3a';
    const now = new Date().toLocaleString('ko-KR');
    statusEl.textContent = `✓ ${R.branch} ${R.y}년 ${R.m}월 마감이 확정됐습니다. (${now})`;
    showMessage(`${R.branch} ${R.y}년 ${R.m}월 마감이 확정됐습니다. 품목 ${items.length}건 저장됨.`, 'success');

    // ── 수불부 Drive 저장: subulBuffer(다운로드와 동일한 완성 버퍼)를 그대로 업로드
    if (R.subulBuffer && R.subulFileId) {
      try {
        showGlobalLoading('수불부 저장 중...');
        const bytes = new Uint8Array(R.subulBuffer);
        const chunkSize = 8192;
        let binary = '';
        for (let i = 0; i < bytes.length; i += chunkSize) {
          binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
        }
        const base64 = btoa(binary);
        await apiPost('closingUpdateSubulFile', {
          request_user_email: user?.email,
          file_id: R.subulFileId,
          base64,
        });
        clog('수불부 Drive 저장 완료', 'ok');
      } catch (e) {
        clog('수불부 Drive 저장 실패: ' + e.message, 'warn');
      } finally {
        await hideGlobalLoading();
      }
    }
  } catch (e) {
    await hideGlobalLoading();
    showMessage('마감 확정 중 오류: ' + e.message, 'error');
  }
}
