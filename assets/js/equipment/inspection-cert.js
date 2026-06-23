(function () {
  'use strict';

  function safeVal(v) {
    return (v === null || v === undefined || String(v).trim() === '') ? '-' : String(v).trim();
  }

  function fmtDate(v) {
    if (!v) return '-';
    const s = String(v).trim();
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[1] + '년 ' + m[2] + '월 ' + m[3] + '일';
    return s;
  }

  function fmtCost(v) {
    if (v === null || v === undefined || String(v).trim() === '') return '-';
    const n = Number(String(v).replace(/,/g, ''));
    if (isNaN(n)) return String(v);
    return n.toLocaleString('ko-KR') + ' 원';
  }

  function statusLabel(v) {
    const map = {
      IN_USE: '사용중', REPAIRING: '수리중',
      INSPECTING: '점검중', STORED: '보관중', DISPOSED: '폐기'
    };
    return map[String(v).trim().toUpperCase()] || safeVal(v);
  }

  /* ── 오늘 날짜 기본값 (yyyy년 mm월 dd일) ── */
  function todayLabel() {
    const d = new Date();
    return d.getFullYear() + '년 ' +
      String(d.getMonth() + 1).padStart(2, '0') + '월 ' +
      String(d.getDate()).padStart(2, '0') + '일';
  }

  /* ── 단일 장비 기본정보 테이블 ── */
  function buildSingleInfoTable(eq) {
    const rows = [
      ['장  비  명',  safeVal(eq.equipment_name),   '모  델  명',   safeVal(eq.model_name)],
      ['제  조  사',  safeVal(eq.manufacturer),     '시리얼번호',   safeVal(eq.serial_no)],
      ['구  매  처',  safeVal(eq.vendor),           '취 득 일 자',  fmtDate(eq.purchase_date)],
    ];
    const tableRows = rows.map(([l1, v1, l2, v2]) => `
      <tr>
        <th>${l1}</th><td>${v1}</td>
        <th>${l2}</th><td>${v2}</td>
      </tr>`).join('');

    return tableRows;
  }

  /* ── 다중 장비 목록 테이블 ── */
  function buildMultiInfoTable(eqList) {
    const headerRow = `
      <tr>
        <th style="text-align:center;">No.</th>
        <th style="text-align:center;">장비명</th>
        <th style="text-align:center;">모델명</th>
        <th style="text-align:center;">제조사</th>
        <th style="text-align:center;">시리얼번호</th>
        <th style="text-align:center;">취득일자</th>
        <th style="text-align:center;">취득가액</th>
      </tr>`;
    const dataRows = eqList.map((eq, i) => `
      <tr>
        <td style="text-align:center;">${i + 1}</td>
        <td>${safeVal(eq.equipment_name)}</td>
        <td>${safeVal(eq.model_name)}</td>
        <td>${safeVal(eq.manufacturer)}</td>
        <td>${safeVal(eq.serial_no)}</td>
        <td style="text-align:center;">${fmtDate(eq.purchase_date)}</td>
        <td style="text-align:right;">${fmtCost(eq.acquisition_cost)}</td>
      </tr>`).join('');
    return headerRow + dataRows;
  }

  /* ── 공통 CSS ── */
  function buildStyles(isMulti) {
    return `
    @page { size: A4 portrait; margin: 18mm 18mm 18mm 18mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Malgun Gothic', '맑은 고딕', 'NanumGothic', Arial, sans-serif;
      font-size: 10pt; color: #1a1a2e; background: #fff;
    }
    .cert-header {
      border-bottom: 3px solid #1B4F8A;
      padding-bottom: 10px; margin-bottom: 20px; text-align: center;
    }
    .cert-title {
      font-size: 22pt; font-weight: bold; color: #1B4F8A; letter-spacing: 8px;
    }
    .section-label {
      background: #1B4F8A; color: #fff; font-size: 9.5pt;
      font-weight: bold; padding: 5px 12px; letter-spacing: 1px;
    }
    .info-table {
      width: 100%; border-collapse: collapse; margin-bottom: 16px;
    }
    .info-table th, .info-table td {
      border: 1px solid #b0c4de; padding: 6px 10px;
      font-size: 9.5pt; vertical-align: middle;
    }
    .info-table th {
      background: #EAF0F8; font-weight: bold; color: #1B4F8A;
      ${isMulti ? '' : 'width: 13%;'} text-align: center; white-space: nowrap;
    }
    .info-table td { ${isMulti ? '' : 'width: 24%;'} background: #fff; }
    .input-box {
      width: 100%; height: 90px; border: 1px solid #b0c4de; border-top: none;
      padding: 8px 10px;
      font-family: 'Malgun Gothic', '맑은 고딕', 'NanumGothic', Arial, sans-serif;
      font-size: 9.5pt; color: #1a1a2e; resize: none; outline: none;
      margin-bottom: 16px; display: block; background: #fff;
    }
    .input-box:focus { border-color: #2E75B6; background: #f8fbff; }
    .print-btn {
      display: block; margin: 16px auto 20px; padding: 9px 32px;
      background: #1B4F8A; color: #fff; border: none; border-radius: 4px;
      font-size: 10pt;
      font-family: 'Malgun Gothic', '맑은 고딕', Arial, sans-serif;
      cursor: pointer; letter-spacing: 1px;
    }
    .print-btn:hover { background: #2E75B6; }
    .sign-section { display: flex; gap: 16px; margin-bottom: 16px; }
    .sign-box { flex: 1; border: 1px solid #b0c4de; border-radius: 4px; overflow: hidden; }
    .sign-box-title {
      background: #2E75B6; color: #fff; font-size: 9pt;
      font-weight: bold; text-align: center; padding: 5px 0; letter-spacing: 2px;
    }
    .sign-box-body { height: 80px; background: #F5F7FA; }
    .confirm-statement {
      border: 1.5px solid #1B4F8A; border-radius: 4px; padding: 12px 16px;
      font-size: 10pt; color: #1B4F8A; text-align: center;
      font-weight: bold; letter-spacing: 0.5px; background: #F0F4FA;
    }
    .date-input {
      border: none; border-bottom: 1.5px solid #2E75B6; outline: none;
      font-family: 'Malgun Gothic', '맑은 고딕', 'NanumGothic', Arial, sans-serif;
      font-size: 9.5pt; color: #1a1a2e; background: transparent;
      width: 100%; padding: 2px 4px;
    }
    .date-input:focus { border-bottom-color: #1B4F8A; background: #f8fbff; }
    .written-date-wrap {
      margin-top: 14px; display: flex; align-items: center;
      gap: 12px; justify-content: center;
    }
    .written-date-label { font-size: 11pt; font-weight: bold; color: #1B4F8A; white-space: nowrap; }
    .written-date-wrap .date-input { width: 200px; font-size: 11pt; text-align: center; }
    @media print {
      .print-btn { display: none !important; }
      .input-box {
        border: 1px solid #b0c4de !important; border-top: none !important;
        background: #fff !important;
        -webkit-print-color-adjust: exact; print-color-adjust: exact;
      }
      .date-input {
        border: none !important;
        border-bottom: none !important;
        background: #fff !important;
        -webkit-print-color-adjust: exact; print-color-adjust: exact;
      }
      .info-table th, .section-label, .sign-box-title, .confirm-statement {
        -webkit-print-color-adjust: exact; print-color-adjust: exact;
      }
    }`;
  }

  function buildWrittenDateInput(eq) {
    const val = eq.purchase_date ? fmtDate(eq.purchase_date) : todayLabel();
    return '<input type="text" class="date-input" id="writtenDate" value="' + val + '" />';
  }

  /* ── 단일 장비 HTML ── */
  function buildSingleHTML(eq) {
    return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8"/>
  <title>의료장비 검수확인서</title>
  <style>${buildStyles(false)}</style>
</head>
<body>
  <div class="cert-header">
    <div class="cert-title">의료장비 검수확인서</div>
  </div>
  <div class="section-label">■ 장비 기본 정보</div>
  <table class="info-table">${buildSingleInfoTable(eq)}</table>
  <div class="section-label">■ 비고 / 특이사항</div>
  <textarea class="input-box">특이사항 없음</textarea>
  <div class="section-label">■ 검수 확인 의견</div>
  <textarea class="input-box">장비 정상 입고 확인</textarea>
  <button class="print-btn" onclick="window.print()">🖨️ 인쇄 / PDF 저장</button>
  <div class="sign-section">
    <div class="sign-box">
      <div class="sign-box-title">검 수 자</div>
      <div class="sign-box-body"></div>
    </div>
    <div class="sign-box">
      <div class="sign-box-title">확 인 자</div>
      <div class="sign-box-body"></div>
    </div>
  </div>
  <div class="confirm-statement">
    위 의료장비에 대하여 검수를 실시하고 이상 없음을 확인합니다.
  </div>
  <div class="written-date-wrap">
    <span class="written-date-label">작 성 일 자</span>
    ${buildWrittenDateInput(eq)}
  </div>
</body>
</html>`;
  }

  /* ── 다중 장비 → 단일 양식용 합성 객체 생성 ── */
  function mergeEquipmentList(eqList) {
    const first = eqList[0];
    const count = eqList.length;

    // 모델명: 고유값이 1개면 그대로, 여러 개면 "대표값 외 N건"
    const models = [...new Set(eqList.map(function(e) { return String(e.model_name || '').trim(); }).filter(Boolean))];
    const modelDisplay = models.length === 0 ? '-'
      : models.length === 1 ? models[0]
      : models[0] + ' 외 ' + (models.length - 1) + '건';

    // 시리얼번호: 첫 번째 외 N건
    const serials = eqList.map(function(e) { return String(e.serial_no || '').trim(); }).filter(Boolean);
    const serialDisplay = serials.length === 0 ? '-'
      : serials.length === 1 ? serials[0]
      : serials[0] + ' 외 ' + (serials.length - 1) + '건';

    // 장비명: 고유값이 1개면 그대로, 여러 개면 "대표값 외 N건"
    const names = [...new Set(eqList.map(function(e) { return String(e.equipment_name || '').trim(); }).filter(Boolean))];
    const nameDisplay = names.length === 0 ? '-'
      : names.length === 1 ? names[0]
      : names[0] + ' 외 ' + (names.length - 1) + '건';

    // 제조사: 고유값이 1개면 그대로, 여러 개면 나열 (최대 2개 + 외 N건)
    const manufacturers = [...new Set(eqList.map(function(e) { return String(e.manufacturer || '').trim(); }).filter(Boolean))];
    const mfrDisplay = manufacturers.length === 0 ? '-'
      : manufacturers.length === 1 ? manufacturers[0]
      : manufacturers[0] + ' 외 ' + (manufacturers.length - 1) + '건';

    // 취득가액: 전체 합산
    const totalCost = eqList.reduce(function(sum, e) {
      const n = Number(String(e.acquisition_cost || '0').replace(/,/g, ''));
      return sum + (isNaN(n) ? 0 : n);
    }, 0);

    // 취득일자: 가장 최근 날짜
    const dates = eqList.map(function(e) { return String(e.purchase_date || '').trim(); }).filter(Boolean).sort();
    const latestDate = dates.length ? dates[dates.length - 1] : '';

    // 제조일자: 가장 최근 날짜
    const mfgDates = eqList.map(function(e) { return String(e.manufacture_date || '').trim(); }).filter(Boolean).sort();
    const latestMfgDate = mfgDates.length ? mfgDates[mfgDates.length - 1] : '';

    // 부서: 고유값 나열
    const depts = [...new Set(eqList.map(function(e) { return String(e.department || '').trim(); }).filter(Boolean))];
    const deptDisplay = depts.length === 0 ? '-'
      : depts.length === 1 ? depts[0]
      : depts[0] + ' 외 ' + (depts.length - 1) + '건';

    return {
      equipment_name:   nameDisplay + ' (총 ' + count + '대)',
      model_name:       modelDisplay,
      manufacturer:     mfrDisplay,
      serial_no:        serialDisplay,
      manufacture_date: latestMfgDate,
      purchase_date:    latestDate,
      vendor:           first.vendor,
      acquisition_cost: totalCost > 0 ? totalCost : '',
      department:       deptDisplay,
      manager_name:     first.manager_name,
      manager_phone:    first.manager_phone,
    };
  }

  /* ── 다중 장비 HTML ── */
  function buildMultiHTML(eqList) {
    const merged = mergeEquipmentList(eqList);

    return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8"/>
  <title>의료장비 검수확인서</title>
  <style>${buildStyles(false)}</style>
</head>
<body>
  <div class="cert-header">
    <div class="cert-title">의료장비 검수확인서</div>
  </div>
  <div class="section-label">■ 장비 기본 정보</div>
  <table class="info-table">${buildSingleInfoTable(merged)}</table>
  <div class="section-label">■ 비고 / 특이사항</div>
  <textarea class="input-box">특이사항 없음</textarea>
  <div class="section-label">■ 검수 확인 의견</div>
  <textarea class="input-box">장비 정상 입고 확인</textarea>
  <button class="print-btn" onclick="window.print()">🖨️ 인쇄 / PDF 저장</button>
  <div class="sign-section">
    <div class="sign-box">
      <div class="sign-box-title">검 수 자</div>
      <div class="sign-box-body"></div>
    </div>
    <div class="sign-box">
      <div class="sign-box-title">확 인 자</div>
      <div class="sign-box-body"></div>
    </div>
  </div>
  <div class="confirm-statement">
    위 의료장비 ${eqList.length}대에 대하여 검수를 실시하고 이상 없음을 확인합니다.
  </div>
  <div class="written-date-wrap">
    <span class="written-date-label">작 성 일 자</span>
    ${buildWrittenDateInput(merged)}
  </div>
</body>
</html>`;
  }

  /* ── 메인 함수 ── */
  function generateInspectionCertPDF(equipmentData) {
    if (!equipmentData) {
      alert('장비 데이터를 불러올 수 없습니다.');
      return;
    }

    // 배열이면 다중, 객체면 단일
    const isMulti = Array.isArray(equipmentData);
    const html = isMulti ? buildMultiHTML(equipmentData) : buildSingleHTML(equipmentData);

    const win = window.open('', '_blank', 'width=900,height=1100,scrollbars=yes');
    if (!win) {
      alert('팝업이 차단되었습니다.\n브라우저 팝업 허용 설정을 확인해 주세요.');
      return;
    }

    win.document.open();
    win.document.write(html);
    win.document.close();
  }

  window.generateInspectionCertPDF = generateInspectionCertPDF;

})();
