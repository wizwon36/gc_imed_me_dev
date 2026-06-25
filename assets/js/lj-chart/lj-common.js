/**
 * lj-common.js
 * 정도관리 시스템 — 공통 상태/유틸리티
 */

const APP_ID = 'lj_chart';

// ── 소수점 헬퍼 ──────────────────────────────────────────────
function getDecimals(item) {
  const d = parseInt(item?.decimal_places ?? 3);
  return isNaN(d) ? 4 : Math.min(Math.max(d, 0), 4);
}
function fmt(value, item) {
  return Number(value).toFixed(getDecimals(item));
}

// ── 정성적 프리셋 ────────────────────────────────────────────
const QUALITATIVE_PRESETS = {
  pos_neg:       { label: 'Positive / Negative',                                   values: ['Negative', 'Positive'] },
  reactive:      { label: 'Reactive / Non-Reactive',                               values: ['Non-Reactive', 'Reactive'] },
  detected:      { label: 'Detected / Not Detected',                               values: ['Not Detected', 'Detected'] },
  neg_plus:      { label: 'Negative / Trace / 1+ / 2+ / 3+ / 4+',                 values: ['Negative', 'Trace', '1+', '2+', '3+', '4+'] },
  weak_reactive: { label: 'Non-Reactive / Weakly Reactive / Reactive',             values: ['Non-Reactive', 'Weakly Reactive', 'Reactive'] },
  weak_pos:      { label: 'Negative / Weak Positive / Positive / Strong Positive', values: ['Negative', 'Weak Positive', 'Positive', 'Strong Positive'] }
};

// ── 전역 상태 ────────────────────────────────────────────────
let state = {
  groups:        [],
  activeGroupId: null,
  items:         [],
  activeItemId:  null,
  entries:       {},
  chart:         null,
  orgData:       null,
  dateFrom:      '',
  dateTo:        '',
  canEdit:       false
};

// ── DOM 헬퍼 ─────────────────────────────────────────────────
const $ = id => document.getElementById(id);

// ── 공통 유틸 ────────────────────────────────────────────────
function showMessage(text, type = 'error') {
  const box = $('messageBox');
  if (!box) return;
  box.className = 'message-box ' + (type === 'success' ? 'message-box--success' : 'message-box--error');
  box.textContent = text;
  box.style.display = '';
  clearTimeout(showMessage._t);
  showMessage._t = setTimeout(() => { box.style.display = 'none'; }, 5000);
}

function escHtml(value) {
  return String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function normalizeDate(val) {
  if (!val) return '';
  const s = String(val).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : s;
}

// ── 공통 초기화 (권한/org/그룹/항목 로드) ─────────────────────
async function ljInitCommon(user) {
  const isAdmin = String(user.role || '').trim().toLowerCase() === 'admin';

  const permissionPromise = isAdmin
    ? Promise.resolve(true)
    : window.appPermission.hasPermission(APP_ID);

  const groupsPromise = apiGet('ljGetGroups', { request_user_email: user.email })
    .then(r => Array.isArray(r.data) ? r.data : [])
    .catch(() => []);

  const itemsPromise = apiGet('ljGetItems', { request_user_email: user.email })
    .then(r => Array.isArray(r.data) ? r.data : [])
    .catch(() => null);

  const orgPromise = apiGet('getScopedOrgOptions', { request_user_email: user.email, app_id: APP_ID })
    .catch(() => null);

  const [hasAccess, groupsResult, itemsResult, orgResult] = await Promise.all([
    permissionPromise, groupsPromise, itemsPromise, orgPromise
  ]);

  if (isAdmin) {
    state.canEdit = true;
  } else {
    const perm = await window.appPermission?.getPermission?.(APP_ID).catch(() => null);
    state.canEdit = (perm === 'edit' || perm === 'admin');
  }

  state.groups = groupsResult;
  state.items  = itemsResult || [];

  if (orgResult?.data) {
    state.orgData = orgResult.data;
  }

  return { hasAccess, orgResult };
}

// ── 공통 org 필터 UI 세팅 ────────────────────────────────────
function ljSetupOrgFilter(orgResult, onChangeCallback) {
  if (!orgResult?.data) return;
  const { clinics, teams, scope } = orgResult.data;
  const clinicSel = $('clinicFilterSelect');
  const teamSel   = $('teamFilterSelect');
  const filterRow = $('deptFilterRow');

  if (scope === 'team') {
    if (filterRow) filterRow.style.display = 'none';
    return;
  }

  if (clinicSel && clinics?.length > 0) {
    if (filterRow) filterRow.style.display = 'flex';

    const updateTeams = (clinicCode) => {
      const filtered = clinicCode ? (teams || []).filter(t => t.parent_code === clinicCode) : (teams || []);
      teamSel.innerHTML = '<option value="">전체 팀</option>' +
        filtered.map(t => `<option value="${escHtml(t.code_value)}">${escHtml(t.code_name)}</option>`).join('');
      teamSel.disabled = !clinicCode;
    };

    if (scope === 'clinic') {
      clinicSel.innerHTML = clinics.map(c => `<option value="${escHtml(c.code_value)}">${escHtml(c.code_name)}</option>`).join('');
      clinicSel.value    = clinics[0]?.code_value || '';
      clinicSel.disabled = true;
      updateTeams(clinicSel.value);
    } else {
      clinicSel.disabled = false;
      clinicSel.innerHTML = '<option value="">전체 의원</option>' +
        clinics.map(c => `<option value="${escHtml(c.code_value)}">${escHtml(c.code_name)}</option>`).join('');
      updateTeams('');
    }

    clinicSel.addEventListener('change', () => {
      updateTeams(clinicSel.value);
      if (onChangeCallback) onChangeCallback();
    });
    teamSel.addEventListener('change', () => {
      if (onChangeCallback) onChangeCallback();
    });
  }
}
