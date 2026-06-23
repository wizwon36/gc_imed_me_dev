var currentEquipmentId = '';

function formatDisplayDate(value) {
  var raw = String(value || '').trim();
  if (!raw) return '-';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  var dateOnlyMatch = raw.match(/^(\d{4}-\d{2}-\d{2})[T\s]/);
  if (dateOnlyMatch) return dateOnlyMatch[1];

  var parsed = new Date(raw);
  if (!isNaN(parsed.getTime())) {
    var yyyy = parsed.getFullYear();
    var mm = String(parsed.getMonth() + 1).padStart(2, '0');
    var dd = String(parsed.getDate()).padStart(2, '0');
    return yyyy + '-' + mm + '-' + dd;
  }

  return raw;
}

function statusLabelPublic(value) {
  var map = {
    IN_USE: '사용중',
    REPAIRING: '수리중',
    INSPECTING: '점검중',
    STORED: '보관',
    DISPOSED: '폐기'
  };
  return map[String(value || '').trim()] || (value || '-');
}

function statusClassPublic(value) {
  var map = {
    IN_USE: 'is-in-use',
    REPAIRING: 'is-repairing',
    INSPECTING: 'is-inspecting',
    STORED: 'is-stored',
    DISPOSED: 'is-disposed'
  };
  return map[String(value || '').trim()] || '';
}

function renderPublicInfo(item) {
  var grid = document.getElementById('publicInfoGrid');
  if (!grid) return;

  var fields = [
    { label: '장비번호',      value: item.equipment_id },
    { label: '장비명',        value: item.equipment_name },
    { label: '모델명',        value: item.model_name },
    { label: '제조사',        value: item.manufacturer },
    { label: '사용부서',      value: item.department },
    { label: '현재 위치',     value: item.location },
    { label: '유지보수 종료', value: formatDisplayDate(item.maintenance_end_date) },
    { label: '현재 상태',     value: item.status, isStatus: true },
    { label: '담당자',        value: item.manager_name },
    { label: '연락처',        value: item.manager_phone }
  ];

  function buildInfoCell(field) {
    var valueHtml;
    if (field.isStatus) {
      valueHtml = '<span class="status-badge ' + statusClassPublic(field.value) + '">' +
        escapeHtml(statusLabelPublic(field.value)) + '</span>';
    } else {
      var display = (!field.value || field.value === '') ? '-' : field.value;
      valueHtml = escapeHtml(display);
    }
    return (
      '<div class="info-cell">' +
        '<span class="info-cell-label">' + escapeHtml(field.label) + '</span>' +
        '<span class="info-cell-value">' + valueHtml + '</span>' +
      '</div>'
    );
  }

  var rows = [];
  var i = 0;
  while (i < fields.length) {
    var f = fields[i];
    var next = (fields[i + 1]) ? fields[i + 1] : null;
    if (next) {
      rows.push('<div class="info-row">' + buildInfoCell(f) + buildInfoCell(next) + '</div>');
      i += 2;
    } else {
      rows.push('<div class="info-row">' + buildInfoCell(f) + '</div>');
      i++;
    }
  }

  grid.innerHTML = rows.join('');
}

function renderPublicHero(item) {
  var nameEl = document.getElementById('heroEquipmentName');
  var idEl = document.getElementById('heroEquipmentId');
  var badgeEl = document.getElementById('heroStatusBadge');

  if (nameEl) nameEl.textContent = item.equipment_name || '-';
  if (idEl) idEl.textContent = item.equipment_id || '-';
  if (badgeEl) {
    badgeEl.textContent = statusLabelPublic(item.status);
    badgeEl.className = 'status-badge ' + statusClassPublic(item.status);
  }
}

function renderLoginBanner() {
  var banner = document.getElementById('loginBanner');
  if (banner) banner.style.display = '';
}

async function loadPublicEquipment() {
  var equipmentId = getQueryParam('id');
  currentEquipmentId = equipmentId;

  if (!equipmentId) {
    showMessage('장비 정보를 찾을 수 없습니다.', 'error');
    return;
  }

  showGlobalLoading('장비 정보를 불러오는 중...');

  try {
    var result = await apiGet('getEquipmentPublic', { id: equipmentId });
    var item = (result && result.data) ? result.data : {};

    renderPublicHero(item);
    renderPublicInfo(item);

    // 로그인 여부 확인 — auth.getSession() 사용으로 통일
    var sessionRaw = (window.auth && typeof window.auth.getSession === 'function')
      ? window.auth.getSession()
      : null;

    var detailBtn = document.getElementById('goToDetailBtn');
    if (detailBtn) {
      if (sessionRaw && sessionRaw.user_email) {
        detailBtn.href = 'detail.html?id=' + encodeURIComponent(equipmentId);
        detailBtn.style.display = '';
      } else {
        detailBtn.style.display = 'none';
        renderLoginBanner();
      }
      if (typeof applyTopActionsColClass === 'function') applyTopActionsColClass();
    }
  } catch (error) {
    showMessage(error.message || '장비 정보를 불러오지 못했습니다.', 'error');
  } finally {
    hideGlobalLoading();
  }
}

document.addEventListener('DOMContentLoaded', function() {
  loadPublicEquipment();
});
