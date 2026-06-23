function buildEquipmentDetailUrl(equipmentId) {
  return CONFIG.SITE_BASE_URL + '/pages/equipment/public-detail.html?id=' + encodeURIComponent(equipmentId);
}

function getSelectedLabelSize() {
  var select = qs('#labelSizeSelect');
  return select ? select.value : 'size-90x48';
}

function applyLabelSize(sizeClass) {
  var label = qs('#deviceLabel');
  if (!label) return;

  label.classList.remove('size-90x48', 'size-70x40', 'size-50x30');
  label.classList.add(sizeClass);
}

function toggleRowsBySize(sizeClass) {
  var modelRow = qs('#labelRowModel');
  var deptRow = qs('#labelRowDepartment');
  var locationRow = qs('#labelRowLocation');

  if (!modelRow || !deptRow || !locationRow) return;

  modelRow.style.display = '';
  deptRow.style.display = '';
  locationRow.style.display = '';

  if (sizeClass === 'size-70x40') {
    locationRow.style.display = 'none';
  }

  if (sizeClass === 'size-50x30') {
    modelRow.style.display = 'none';
    deptRow.style.display = 'none';
    locationRow.style.display = 'none';
  }
}

function renderLabelQr(equipmentId) {
  var qrArea = qs('#labelQr');
  var qrValue = buildEquipmentDetailUrl(equipmentId);
  var sizeClass = getSelectedLabelSize();
  var qrSize = 84; // 90x48: box 94px - padding 10px

  if (!qrArea) return;

  if (sizeClass === 'size-70x40') qrSize = 64; // box 72px - padding 8px
  if (sizeClass === 'size-50x30') qrSize = 48;

  qrArea.innerHTML = '';

  new QRCode(qrArea, {
    text: qrValue,
    width: qrSize,
    height: qrSize
  });
}

function refreshLabelPreview(equipmentId) {
  var sizeClass = getSelectedLabelSize();
  applyLabelSize(sizeClass);
  toggleRowsBySize(sizeClass);
  renderLabelQr(equipmentId);
}

async function loadLabelData() {
  clearMessage();
  showGlobalLoading();

  var equipmentId = getQueryParam('equipment_id');

  if (!equipmentId) {
    showMessage('equipment_id가 없습니다.', 'error');
    await hideGlobalLoading();
    return;
  }

  var backBtn = qs('#backToDetailBtn');
  if (backBtn) {
    backBtn.href = 'detail.html?id=' + encodeURIComponent(equipmentId);
  }

  var mobileBackBtn = qs('#mobileBackBtn');
  if (mobileBackBtn) {
    mobileBackBtn.href = 'detail.html?id=' + encodeURIComponent(equipmentId);
  }

  var user = {};
  if (window.auth && typeof window.auth.getSession === 'function') {
    user = window.auth.getSession() || {};
  }

  try {
    var result = await apiGet('getEquipment', {
      id: equipmentId,
      request_user_email: user.email || ''
    });

    var item = result && result.data ? result.data : {};

    qs('#labelEquipmentName').textContent = item.equipment_name || '-';
    qs('#labelEquipmentId').textContent = item.equipment_id || '-';
    qs('#labelModelName').textContent = item.model_name || '-';
    qs('#labelDepartment').textContent = item.department || '-';
    qs('#labelLocation').textContent = item.location || '-';

    refreshLabelPreview(item.equipment_id || equipmentId);
  } catch (error) {
    showMessage(error.message || '라벨 정보를 불러오는 중 오류가 발생했습니다.', 'error');
  } finally {
    await hideGlobalLoading();
  }
}

document.addEventListener('DOMContentLoaded', async function () {
  showGlobalLoading('라벨 출력 화면을 준비하는 중...');

  try {
    var user = window.auth.requireAuth();
    if (!user) return;

    if (!isEquipmentClinicAllowed(user)) {
      showMessage('현재 의료장비 관리는 서울숲의원만 사용 가능합니다. 다른 의원은 순차적으로 오픈될 예정입니다.', 'error');
      return;
    }

    var ok = await window.appPermission.requirePermission('equipment', ['view', 'edit', 'admin']);
    if (!ok) return;

    var sizeSelect   = qs('#labelSizeSelect');
    var printBtn     = qs('#printBtn');
    var equipmentId  = getQueryParam('equipment_id');
    var equipmentIds = getQueryParam('equipment_ids');
    var sizeParam    = getQueryParam('size');
    var layoutParam  = getQueryParam('layout'); // 2x5, 2x4, 2x6, 3x6

    // ── 일괄 출력 모드 ──────────────────────────────────────────
    if (equipmentIds) {
      var ids = equipmentIds.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
      if (sizeParam && sizeSelect) sizeSelect.value = sizeParam;
      var sizeClass = sizeSelect ? sizeSelect.value : 'size-90x48';

      // 단건 미리보기 영역 숨김
      var labelSheet = qs('#labelSheet') || qs('.label-sheet');
      if (labelSheet) labelSheet.style.display = 'none';

      await loadBulkLabels(ids, sizeClass, layoutParam, user);

      if (printBtn) printBtn.addEventListener('click', function() { window.print(); });
      return;
    }

    // ── 단건 출력 모드 ──────────────────────────────────────────
    if (sizeSelect) {
      sizeSelect.addEventListener('change', function () {
        if (equipmentId) refreshLabelPreview(equipmentId);
      });
    }
    if (printBtn) printBtn.addEventListener('click', function () { window.print(); });
    await loadLabelData();

  } catch (error) {
    showMessage(error.message || '화면을 불러오는 중 오류가 발생했습니다.', 'error');
  } finally {
    await hideGlobalLoading();
  }
});

// ── 일괄 라벨 로드 ────────────────────────────────────────────────

async function loadBulkLabels(ids, sizeClass, layout, user) {
  var userEmail = String((user && (user.email || user.user_email)) || '').trim();
  var isGrid = !!layout;

  // 페이지 타이틀 변경
  var titleEl = qs('.label-hero-title');
  if (titleEl) titleEl.textContent = isGrid
    ? 'QR 포함 장비 라벨 — 격자 출력 (' + ids.length + '건)'
    : 'QR 포함 장비 라벨 — 일괄 출력 (' + ids.length + '건)';

  // 컨테이너 생성
  var container = document.getElementById('bulkLabelContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'bulkLabelContainer';
    var wrap = qs('.label-preview-wrap') || qs('.label-preview-card') || document.body;
    wrap.appendChild(container);
  }
  container.innerHTML = '<div class="empty-box">라벨을 불러오는 중...</div>';

  try {
    showGlobalLoading('라벨 정보를 불러오는 중...');

    var results = await Promise.all(
      ids.map(function(id) {
        return apiGet('getEquipment', { id: id, request_user_email: userEmail });
      })
    );
    var items = results
      .map(function(result) { return result && result.data ? result.data : null; })
      .filter(Boolean);

    if (!items.length) {
      container.innerHTML = '<div class="empty-box">불러올 장비 정보가 없습니다.</div>';
      return;
    }

    if (isGrid) {
      renderGridLabels(container, items, sizeClass, layout);
    } else {
      renderStackLabels(container, items, sizeClass);
    }

  } catch (err) {
    container.innerHTML = '<div class="empty-box">' + escapeHtml(err.message || '오류가 발생했습니다.') + '</div>';
  } finally {
    hideGlobalLoading();
  }
}

// ── 격자 출력 렌더링 ──────────────────────────────────────────────

// layout: '2x5', '2x4', '2x6', '3x6'
var GRID_SPECS = {
  '2x5': { cols: 2, rows: 5, colGap: '4mm', rowGap: '0mm', padT: '10mm', padL: '8mm', padR: '8mm' },
  '2x4': { cols: 2, rows: 4, colGap: '4mm', rowGap: '2mm', padT: '14mm', padL: '8mm', padR: '8mm' },
  '2x6': { cols: 2, rows: 6, colGap: '4mm', rowGap: '0mm', padT: '8mm',  padL: '8mm', padR: '8mm' },
  '3x6': { cols: 3, rows: 6, colGap: '3mm', rowGap: '0mm', padT: '8mm',  padL: '5mm', padR: '5mm' }
};

function renderGridLabels(container, items, sizeClass, layout) {
  var spec = GRID_SPECS[layout] || GRID_SPECS['2x5'];
  var perPage = spec.cols * spec.rows;

  // 페이지 단위로 나누기
  var pages = [];
  for (var i = 0; i < items.length; i += perPage) {
    pages.push(items.slice(i, i + perPage));
  }

  var pagesHtml = pages.map(function(pageItems, pageIdx) {
    // 빈 칸 채우기
    while (pageItems.length < perPage) pageItems.push(null);

    var cells = pageItems.map(function(item, idx) {
      if (!item) return '<div class="grid-label-cell grid-label-cell--empty"></div>';
      return (
        '<div class="grid-label-cell">' +
          '<div class="device-label ' + sizeClass + '">' +
            buildLabelInner(item, sizeClass, 'grid-' + pageIdx + '-' + idx) +
          '</div>' +
        '</div>'
      );
    }).join('');

    return (
      '<div class="grid-label-page" ' +
        'style="' +
          'grid-template-columns: repeat(' + spec.cols + ', 1fr);' +
          'gap: ' + spec.rowGap + ' ' + spec.colGap + ';' +
          'padding: ' + spec.padT + ' ' + spec.padR + ' 0 ' + spec.padL + ';' +
        '">' +
        cells +
      '</div>'
    );
  }).join('');

  container.innerHTML = '<div class="grid-label-wrap">' + pagesHtml + '</div>';

  // QR 생성
  items.forEach(function(item, idx) {
    var pageIdx = Math.floor(idx / perPage);
    var cellIdx = idx % perPage;
    var qrEl = document.getElementById('qr-grid-' + pageIdx + '-' + cellIdx);
    if (qrEl && item && item.qr_value) {
      var qrSize = sizeClass === 'size-70x40' ? 64 : 84;
      new QRCode(qrEl, { text: buildEquipmentDetailUrl(item.equipment_id), width: qrSize, height: qrSize });
    }
  });
}

// ── 일반 일괄 출력 (격자 아님) ────────────────────────────────────

function renderStackLabels(container, items, sizeClass) {
  var html = items.map(function(item, idx) {
    return (
      '<div class="stack-label-item">' +
        '<div class="device-label ' + sizeClass + '">' +
          buildLabelInner(item, sizeClass, 'stack-' + idx) +
        '</div>' +
      '</div>'
    );
  }).join('');

  container.innerHTML = '<div class="stack-label-wrap">' + html + '</div>';

  items.forEach(function(item, idx) {
    var qrEl = document.getElementById('qr-stack-' + idx);
    if (qrEl && item && item.qr_value) {
      var qrSize = sizeClass === 'size-70x40' ? 64 : sizeClass === 'size-50x30' ? 48 : 84;
      new QRCode(qrEl, { text: buildEquipmentDetailUrl(item.equipment_id), width: qrSize, height: qrSize });
    }
  });
}

// ── 라벨 내부 HTML ────────────────────────────────────────────────

function buildLabelInner(item, sizeClass, qrId) {
  var showLocation = sizeClass !== 'size-70x40' && sizeClass !== 'size-50x30';
  var showModel    = sizeClass !== 'size-50x30';
  var showDept     = sizeClass !== 'size-50x30';

  return (
    '<div class="label-content-panel">' +
      '<div class="label-hospital">녹십자아이메드 의료장비 관리시스템</div>' +
      '<h2 class="label-title">' + escapeHtml(item.equipment_name || '-') + '</h2>' +
      '<div class="label-info-block">' +
        '<div class="label-row label-row-emphasis">' +
          '<div class="label-key">관리번호</div>' +
          '<div class="label-value label-value-id">' + escapeHtml(item.equipment_id || '-') + '</div>' +
        '</div>' +
        (showModel ? (
          '<div class="label-row">' +
            '<div class="label-key">모델명</div>' +
            '<div class="label-value">' + escapeHtml(item.model_name || '-') + '</div>' +
          '</div>'
        ) : '') +
        (showDept ? (
          '<div class="label-row">' +
            '<div class="label-key">사용부서</div>' +
            '<div class="label-value">' + escapeHtml(item.department || '-') + '</div>' +
          '</div>'
        ) : '') +
        (showLocation ? (
          '<div class="label-row">' +
            '<div class="label-key">위치</div>' +
            '<div class="label-value">' + escapeHtml(item.location || '-') + '</div>' +
          '</div>'
        ) : '') +
      '</div>' +
    '</div>' +
    '<div class="qr-panel">' +
      '<div class="label-qr-box" id="qr-' + escapeHtml(qrId) + '"></div>' +
    '</div>'
  );
}
