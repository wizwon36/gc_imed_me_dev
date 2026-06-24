var _gridInstance = null; // AG Grid 인스턴스

var equipmentListState = {
  user: null,
  page: 1,
  pageSize: 20,
  totalCount: 0,
  totalPages: 1,
  hasNext: false,
  hasPrev: false,
  loading: false,
  canEdit: false,
  isRecentMode: false,
  isAdmin: false,
  isAppAdmin: false,
  userClinicCode: '',
  userTeamCode: '',
  _initialLoad: true   // ★ 최초 로딩 여부 — URL params 직접 사용
};

function el(selector) {
  return document.querySelector(selector);
}

function getListQueryParams() {
  var params = new URLSearchParams(location.search);

  return {
    keyword: params.get('keyword') || '',
    clinic_code: params.get('clinic_code') || '',
    team_code: params.get('team_code') || '',
    status: params.get('status') || '',
    manufacturer: params.get('manufacturer') || '',
    page: Number(params.get('page') || 1) || 1,
    page_size: Number(params.get('page_size') || 20) || 20
  };
}

function setListQueryParams(next) {
  var url = new URL(location.href);
  var key;

  for (key in next) {
    if (!Object.prototype.hasOwnProperty.call(next, key)) continue;

    if (next[key] === '' || next[key] === null || next[key] === undefined) {
      url.searchParams.delete(key);
    } else {
      url.searchParams.set(key, String(next[key]));
    }
  }

  history.replaceState({}, '', url.toString());
}

function setValue(id, value) {
  var target = document.getElementById(id);
  if (!target) return;
  target.value = value == null ? '' : value;
}

function getValue(id) {
  var target = document.getElementById(id);
  return target ? String(target.value || '').trim() : '';
}

function formatNumberLocal(value) {
  var num = Number(value || 0);
  return Number.isFinite(num) ? num.toLocaleString('ko-KR') : '0';
}

function formatDisplayDate(value) {
  var raw = String(value || '').trim();
  var dateOnlyMatch;
  var parsed;
  var yyyy;
  var mm;
  var dd;

  if (!raw) return '-';

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }

  dateOnlyMatch = raw.match(/^(\d{4}-\d{2}-\d{2})[T\s]/);
  if (dateOnlyMatch) {
    return dateOnlyMatch[1];
  }

  parsed = new Date(raw);
  if (!isNaN(parsed.getTime())) {
    yyyy = parsed.getFullYear();
    mm = String(parsed.getMonth() + 1).padStart(2, '0');
    dd = String(parsed.getDate()).padStart(2, '0');
    return yyyy + '-' + mm + '-' + dd;
  }

  return raw;
}

function getCurrentFilters() {
  return {
    keyword: getValue('keyword'),
    clinic_code: getValue('clinic_code'),
    team_code: getValue('team_code'),
    status: getValue('status'),
    manufacturer: getValue('manufacturer')
  };
}

function hasMeaningfulFilter(filters) {
  return Boolean(
    filters.keyword ||
    filters.clinic_code ||
    filters.team_code ||
    filters.status ||
    filters.manufacturer
  );
}

function fillStatusFilterOptions() {
  var target = document.getElementById('status');
  if (!target) return;

  target.innerHTML =
    '<option value="">전체 상태</option>' +
    '<option value="IN_USE">사용중</option>' +
    '<option value="REPAIRING">수리중</option>' +
    '<option value="INSPECTING">점검중</option>' +
    '<option value="STORED">보관</option>' +
    '<option value="DISPOSED">폐기</option>';
}

function fillPageSizeOptions() {
  var target = document.getElementById('page_size');
  if (!target || target.type === 'hidden') return; // hidden이면 무시
  if (!target) return;

  target.innerHTML =
    '<option value="10">10개</option>' +
    '<option value="20">20개</option>' +
    '<option value="50">50개</option>' +
    '<option value="100">100개</option>';

  target.value = String(equipmentListState.pageSize);
}

function renderListSummary() {
  var summaryEl = document.getElementById('listSummary');
  var total;
  var page;
  var totalPages;
  var size;

  if (!summaryEl) return;

  if (equipmentListState.isRecentMode) {
    page = formatNumberLocal(equipmentListState.page || 1);
    size = formatNumberLocal(equipmentListState.pageSize || 20);
    summaryEl.textContent = '최근 등록 장비 보기 · ' + size + '건 단위 · ' + page + '페이지';
    return;
  }

  total = formatNumberLocal(equipmentListState.totalCount || 0);
  page = formatNumberLocal(equipmentListState.page || 1);
  totalPages = formatNumberLocal(equipmentListState.totalPages || 1);

  summaryEl.textContent = '검색 결과 ' + total + '건 · ' + page + ' / ' + totalPages + ' 페이지';
}

/* ── 카드 (모바일용) ── */
function buildEquipmentCard(item) {
  var leftActions = '';
  var rightActions = '';

  leftActions += '<a class="btn" href="detail.html?id=' + encodeURIComponent(item.equipment_id || '') + '">상세</a>';

  if (equipmentListState.canEdit && canEditItem(item)) {
    leftActions += '<a class="btn btn-primary" href="form.html?id=' + encodeURIComponent(item.equipment_id || '') + '">수정</a>';
  }

  rightActions = window.innerWidth > 768
    ? '<a class="btn" href="label-print.html?equipment_id=' + encodeURIComponent(item.equipment_id || '') + '">라벨출력</a>'
    : '';

  return (
    '<article class="equipment-card">' +
      '<div class="equipment-card-head">' +
        '<div class="equipment-card-title-wrap">' +
          '<h3 class="equipment-card-title">' + escapeHtml(item.equipment_name || '-') + '</h3>' +
          '<div class="equipment-card-sub">' + escapeHtml(item.equipment_id || '') + '</div>' +
        '</div>' +
        '<span class="status-badge ' + statusClass(item.status || '') + '">' +
          escapeHtml(statusLabel(item.status || '')) +
        '</span>' +
      '</div>' +
      '<div class="equipment-card-grid">' +
        '<div class="equipment-card-row">' +
          '<span class="equipment-card-label">모델명</span>' +
          '<span class="equipment-card-value">' + escapeHtml(item.model_name || '-') + '</span>' +
        '</div>' +
        '<div class="equipment-card-row">' +
          '<span class="equipment-card-label">부서</span>' +
          '<span class="equipment-card-value">' + escapeHtml(item.department || '-') + '</span>' +
        '</div>' +
        '<div class="equipment-card-row">' +
          '<span class="equipment-card-label">제조사</span>' +
          '<span class="equipment-card-value">' + escapeHtml(item.manufacturer || '-') + '</span>' +
        '</div>' +
        '<div class="equipment-card-row">' +
          '<span class="equipment-card-label">시리얼</span>' +
          '<span class="equipment-card-value">' + escapeHtml(item.serial_no || '-') + '</span>' +
        '</div>' +
        '<div class="equipment-card-row">' +
          '<span class="equipment-card-label">위치</span>' +
          '<span class="equipment-card-value">' + escapeHtml(item.location || '-') + '</span>' +
        '</div>' +
        '<div class="equipment-card-row">' +
          '<span class="equipment-card-label">유지보수 종료</span>' +
          '<span class="equipment-card-value">' + escapeHtml(formatDisplayDate(item.maintenance_end_date || '')) + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="equipment-card-actions">' +
        leftActions +
        rightActions +
      '</div>' +
    '</article>'
  );
}

/* ── 테이블 행 (PC용) ── */
function buildEquipmentRow(item) {
  var actions = '';

  actions += '<a class="tbl-btn" href="detail.html?id=' + encodeURIComponent(item.equipment_id || '') + '">상세</a>';

  if (equipmentListState.canEdit && canEditItem(item)) {
    actions += '<a class="tbl-btn tbl-btn--primary" href="form.html?id=' + encodeURIComponent(item.equipment_id || '') + '">수정</a>';
  }

  if (window.innerWidth > 768) {
    actions += '<a class="tbl-btn" href="label-print.html?equipment_id=' + encodeURIComponent(item.equipment_id || '') + '">라벨</a>';
  }

  return (
    '<tr class="equipment-tbl-row">' +
      '<td class="equipment-tbl-cell equipment-tbl-cell--name">' + escapeHtml(item.equipment_name || '-') + '</td>' +
      '<td class="equipment-tbl-cell equipment-tbl-cell--id">' + escapeHtml(item.equipment_id || '-') + '</td>' +
      '<td class="equipment-tbl-cell">' + escapeHtml(item.model_name || '-') + '</td>' +
      '<td class="equipment-tbl-cell">' + escapeHtml(item.department || '-') + '</td>' +
      '<td class="equipment-tbl-cell">' + escapeHtml(item.manufacturer || '-') + '</td>' +
      '<td class="equipment-tbl-cell equipment-tbl-cell--serial">' + escapeHtml(item.serial_no || '-') + '</td>' +
      '<td class="equipment-tbl-cell">' + escapeHtml(item.location || '-') + '</td>' +
      '<td class="equipment-tbl-cell equipment-tbl-cell--status">' +
        '<span class="status-badge ' + statusClass(item.status || '') + '">' +
          escapeHtml(statusLabel(item.status || '')) +
        '</span>' +
      '</td>' +
      '<td class="equipment-tbl-cell equipment-tbl-cell--actions">' +
        '<div class="equipment-tbl-actions">' + actions + '</div>' +
      '</td>' +
    '</tr>'
  );
}



function getStatusBadge(status) {
  var map = {
    'IN_USE':     { cls: 'is-in-use',     label: '사용중' },
    'REPAIRING':  { cls: 'is-repairing',  label: '수리중' },
    'INSPECTING': { cls: 'is-inspecting', label: '점검중' },
    'STORED':     { cls: 'is-stored',     label: '보관' },
    'DISPOSED':   { cls: 'is-disposed',   label: '폐기' },
  };
  var s = map[status] || { cls: 'is-stored', label: status || '—' };
  return '<span class="status-badge ' + s.cls + '">' + s.label + '</span>';
}

function getActionButtons(item) {
  var id = escapeHtml(item.equipment_id || '');
  var btns = '<a class="tbl-btn" href="detail.html?id=' + id + '&shell=1" onclick="saveListState()">상세</a>';
  if (equipmentListState.canEdit && canEditItem(item)) {
    btns += '<a class="tbl-btn tbl-btn--primary" href="form.html?id=' + id + '&shell=1" onclick="saveListState()">수정</a>';
  }
  if (equipmentListState.canEdit) {
    btns += '<button class="tbl-btn" onclick="printSingleLabel(\'' + id + '\')">라벨</button>';
  }
  return btns;
}

function renderEquipmentList(items) {
  var el = document.getElementById('equipmentGrid');
  if (!el) return;
  items = Array.isArray(items) ? items : [];

  // 컬럼 정의
  var columnDefs = [
    { headerName: '장비명', field: 'equipment_name', flex: 1, minWidth: 120,
      headerClass: 'ag-left-header',
      cellRenderer: function(p) {
        return '<span class="tab-name">' + escapeHtml(p.value || '—') + '</span>';
      }
    },
    { headerName: '장비번호', field: 'equipment_id', width: 140,
      cellRenderer: function(p) {
        return '<span class="tab-id">' + escapeHtml(p.value || '—') + '</span>';
      }
    },
    { headerName: '모델명', field: 'model_name', width: 130 },
    { headerName: '부서', field: 'clinic_name', width: 160,
      cellRenderer: function(p) {
        var d = p.data;
        var c = d.clinic_name || '', t = d.team_name || '';
        return escapeHtml(c && t ? c + ' / ' + t : c || t || '—');
      }
    },
    { headerName: '제조사', field: 'manufacturer', width: 120,
      cellRenderer: function(p) {
        var v = p.value || '';
        return v ? '<span class="tab-mfr">' + escapeHtml(v) + '</span>' : '<span style="color:#9ca3af">—</span>';
      }
    },
    { headerName: '시리얼', field: 'serial_no', width: 140,
      cellRenderer: function(p) {
        return '<span class="tab-id">' + escapeHtml(p.value || '—') + '</span>';
      }
    },
    { headerName: '납품처', field: 'vendor', width: 110,
      cellRenderer: function(p) {
        return p.value ? escapeHtml(p.value) : '<span style="color:#9ca3af">—</span>';
      }
    },
    { headerName: '구매일', field: 'purchase_date', width: 100,
      cellRenderer: function(p) {
        return p.value ? escapeHtml(p.value) : '<span style="color:#9ca3af">—</span>';
      }
    },
    { headerName: '유지보수만료', field: 'maintenance_end_date', width: 110,
      cellRenderer: function(p) {
        var v = p.value || '';
        if (!v) return '<span style="color:#9ca3af">—</span>';
        var days = Math.ceil((new Date(v) - new Date()) / 86400000);
        var color = days <= 30 ? '#b91c1c' : days <= 60 ? '#c2410c' : '#374151';
        return '<span style="color:' + color + '">' + escapeHtml(v) + '</span>';
      }
    },
    { headerName: '위치', field: 'location', width: 90 },
    { headerName: '상태', field: 'status', width: 80,
      cellRenderer: function(p) { return getStatusBadge(p.value); }
    },
    { headerName: '액션', field: 'equipment_id', width: 140, sortable: false,
      cellRenderer: function(p) {
        return '<div style="display:flex;gap:4px;align-items:center;">' + getActionButtons(p.data) + '</div>';
      }
    }
  ];

  // 기본 컬럼 설정
  var defaultColDef = {
    sortable: true,
    resizable: true,
    suppressMovable: true,
    headerClass: 'ag-center-header',
    cellStyle: { display: 'flex', alignItems: 'center', justifyContent: 'center' },
  };

  if (_gridInstance) {
    _gridInstance.setGridOption('rowData', items);
    return;
  }

  // 그리드 높이 기반 rowHeight 계산
  var gridH  = el.clientHeight || 713;
  var rowH   = Math.floor((gridH - 32) / equipmentListState.pageSize);
  rowH = Math.max(26, Math.min(rowH, 52));

  var gridOptions = {
    columnDefs: columnDefs,
    defaultColDef: defaultColDef,
    rowData: items,
    rowHeight: rowH,
    headerHeight: 32,
    suppressPaginationPanel: true,
    suppressScrollOnNewData: true,
    overlayNoRowsTemplate: '<span style="color:#9ca3af;font-size:12px;">조회된 장비가 없습니다.</span>',
    onGridReady: function(params) {
      params.api.sizeColumnsToFit();
    }
  };

  _gridInstance = agGrid.createGrid(el, gridOptions);
}

var _origRenderEquipmentList = renderEquipmentList;
renderEquipmentList = function(items) {
  equipmentListState.currentItems = Array.isArray(items) ? items : [];
  _origRenderEquipmentList(items);
  if (typeof bulkSelectedIds !== 'undefined') bulkSelectedIds.clear();
  if (typeof updateBulkUI === 'function') updateBulkUI();
};

document.addEventListener('DOMContentLoaded', function() {
  // 기존 DOMContentLoaded 이후 초기화
  setTimeout(initBulkLabelFeature, 100);
});

// ================================================================
// 라벨 인쇄 오버레이 (페이지 이동 없이 직접 출력)
// ================================================================

var GRID_SPECS_LIST = {
  '2x5': { cols: 2, rows: 5, colGap: '3mm', rowGap: '2mm', padT: '10mm', padS: '8mm' },
  '2x6': { cols: 2, rows: 6, colGap: '3mm', rowGap: '1mm', padT: '7mm',  padS: '8mm' }
};

function buildLabelHtmlForList(item, sizeClass, qrId) {
  var showLocation = sizeClass !== 'size-70x40' && sizeClass !== 'size-50x30';
  var showModel    = sizeClass !== 'size-50x30';
  var showDept     = sizeClass !== 'size-50x30';
  var sc           = sizeClass.replace('size-', ''); // '90x48', '70x40', '50x30'

  return (
    '<div class="prlabel prlabel--' + sc + '">' +
      '<div class="prlabel-body">' +
        '<div class="prlabel-hospital">녹십자아이메드 의료장비 관리시스템</div>' +
        '<div class="prlabel-title">' + escapeHtml(item.equipment_name || '-') + '</div>' +
        '<div class="prlabel-rows">' +
          '<div class="prlabel-row">' +
            '<span class="prlabel-key">관리번호</span>' +
            '<span class="prlabel-id">' + escapeHtml(item.equipment_id || '-') + '</span>' +
          '</div>' +
          (showModel ? '<div class="prlabel-row"><span class="prlabel-key">모델명</span><span class="prlabel-val">' + escapeHtml(item.model_name || '-') + '</span></div>' : '') +
          (showDept  ? '<div class="prlabel-row"><span class="prlabel-key">사용부서</span><span class="prlabel-val">' + escapeHtml(item.department || '-') + '</span></div>' : '') +
          (showLocation ? '<div class="prlabel-row"><span class="prlabel-key">위치</span><span class="prlabel-val">' + escapeHtml(item.location || '-') + '</span></div>' : '') +
        '</div>' +
      '</div>' +
      '<div class="prlabel-qr" id="' + escapeHtml(qrId) + '"></div>' +
    '</div>'
  );
}


function printLabelsOverlay(ids, sizeClass, layout) {
  var allItems = equipmentListState.currentItems || [];
  var items = ids.map(function(id) {
    return allItems.find(function(i) { return i.equipment_id === id; }) ||
      { equipment_id: id, equipment_name: id, model_name: '', department: '', location: '', qr_value: id };
  });

  var prev = document.getElementById('printLabelOverlay');
  if (prev) prev.remove();

  var overlay = document.createElement('div');
  overlay.id = 'printLabelOverlay';

  var isGrid  = !!(layout && GRID_SPECS_LIST[layout]);
  var spec    = isGrid ? GRID_SPECS_LIST[layout] : null;
  var perPage = spec ? spec.cols * spec.rows : 1;
  var pagesHtml = '';

  if (isGrid) {
    for (var p = 0; p < items.length; p += perPage) {
      var pageItems = items.slice(p, p + perPage);
      while (pageItems.length < perPage) pageItems.push(null);

      var cells = pageItems.map(function(item, cellIdx) {
        if (!item) return '<div class="plabel-empty"></div>';
        var qrId = 'pqr-g-' + p + '-' + cellIdx;
        return buildLabelHtmlForList(item, sizeClass, qrId);
      }).join('');

      pagesHtml += (
        '<div class="plabel-page plabel-page--grid" style="' +
          'grid-template-columns:repeat(' + spec.cols + ',auto);' +
          'gap:' + spec.rowGap + ' ' + spec.colGap + ';' +
          'padding:' + spec.padT + ' ' + spec.padS + ';' +
        '">' + cells + '</div>'
      );
    }
  } else {
    pagesHtml = items.map(function(item, idx) {
      var qrId = 'pqr-s-' + idx;
      return '<div class="plabel-page plabel-page--single">' +
        buildLabelHtmlForList(item, sizeClass, qrId) +
      '</div>';
    }).join('');
  }

  overlay.innerHTML = pagesHtml;
  document.body.appendChild(overlay);

  var baseUrl = (typeof CONFIG !== 'undefined' ? CONFIG.SITE_BASE_URL : '') +
                '/pages/equipment/public-detail.html?id=';
  var qrSize = sizeClass === 'size-70x40' ? 64 : sizeClass === 'size-50x30' ? 48 : 84;

  items.forEach(function(item, idx) {
    if (!item) return;
    var qrId = isGrid
      ? ('pqr-g-' + (Math.floor(idx / perPage) * perPage) + '-' + (idx % perPage))
      : ('pqr-s-' + idx);
    var qrEl = document.getElementById(qrId);
    if (!qrEl) return;
    var qrValue = item.equipment_id || '';
    if (qrValue && typeof QRCode !== 'undefined') {
      new QRCode(qrEl, { text: baseUrl + encodeURIComponent(qrValue), width: qrSize, height: qrSize });
    }
  });

  setTimeout(function() {
    window.print();
    setTimeout(function() {
      var el = document.getElementById('printLabelOverlay');
      if (el) el.remove();
    }, 500);
  }, 400);
}
