// ── 가입 신청 페이지 JS ──

(function () {
  let orgBinder = null;

  function showLoading(text = '처리 중...') {
    const el = document.getElementById('globalLoading');
    const textEl = document.getElementById('globalLoadingText');
    if (el) el.setAttribute('aria-hidden', 'false');
    if (textEl) textEl.textContent = text;
  }

  function hideLoading() {
    const el = document.getElementById('globalLoading');
    if (el) el.setAttribute('aria-hidden', 'true');
  }

  function setMessage(msg, type = '') {
    const el = document.getElementById('authMessage');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'auth-message';
    if (type) el.classList.add(`is-${type}`);
  }

  function clearMessage() {
    setMessage('');
  }

  function normalize(val) {
    return String(val || '').trim();
  }

  function markInvalid(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('is-invalid');
    el.focus();
  }

  function clearInvalid() {
    document.querySelectorAll('.is-invalid').forEach(el => el.classList.remove('is-invalid'));
  }

  function validate(data) {
    clearInvalid();

    if (!data.user_email) {
      markInvalid('regEmail');
      throw new Error('이메일(아이디)을 입력해 주세요.');
    }

    // 아이디 형식 검증: 영문 소문자·숫자·점·하이픈·언더바만 허용
    if (!/^[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(data.user_email)) {
      markInvalid('regEmail');
      throw new Error('이메일 형식으로 입력해 주세요. (예: name@example.com)');
    }

    if (!data.user_name) {
      markInvalid('regName');
      throw new Error('이름을 입력해 주세요.');
    }

    if (!data.clinic_code) {
      markInvalid('regClinic');
      throw new Error('의원을 선택해 주세요.');
    }

    if (!data.team_code) {
      markInvalid('regTeam');
      throw new Error('팀을 선택해 주세요.');
    }
  }

  function showSuccess() {
    document.getElementById('formSection').style.display = 'none';
    const s = document.getElementById('successSection');
    if (s) s.style.display = 'block';
  }

  async function handleSubmit() {
    clearMessage();

    const payload = {
      user_email: normalize(document.getElementById('regEmail')?.value).toLowerCase(),
      user_name:  normalize(document.getElementById('regName')?.value),
      phone:      normalize(document.getElementById('regPhone')?.value),
      clinic_code: normalize(document.getElementById('regClinic')?.value),
      team_code:   normalize(document.getElementById('regTeam')?.value),
      memo:        normalize(document.getElementById('regMemo')?.value),
    };

    try {
      validate(payload);
    } catch (err) {
      setMessage(err.message, 'error');
      return;
    }

    const btn = document.getElementById('submitBtn');
    if (btn) btn.disabled = true;
    showLoading('가입 신청 중...');

    try {
      await apiPost('submitRegistration', payload);
      showSuccess();
    } catch (err) {
      setMessage(err.message || '신청 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.', 'error');
    } finally {
      if (btn) btn.disabled = false;
      hideLoading();
    }
  }

  async function init() {
    // 의원/팀 데이터 로드
    showLoading('정보를 불러오는 중...');
    try {
      await window.orgSelect.loadOrgData();

      window.orgSelect.fillSelectOptions(
        document.getElementById('regClinic'),
        window.orgSelect.getClinics(),
        { emptyText: '의원을 선택하세요' }
      );

      // bindClinicTeamSelects가 팀 select를 직접 관리하므로
      // 별도 fillSelectOptions 없이 바로 bind 후 초기 렌더링 호출
      orgBinder = window.orgSelect.bindClinicTeamSelects({
        clinicSelect: document.getElementById('regClinic'),
        teamSelect:   document.getElementById('regTeam'),
        teamEmptyText: '의원을 먼저 선택하세요'
      });

      // 초기 상태: 의원 미선택 → 팀 disabled
      orgBinder.renderTeamsByClinic('', '');
    } catch (err) {
      setMessage('의원/팀 정보를 불러오지 못했습니다. 페이지를 새로고침해 주세요.', 'error');
    } finally {
      hideLoading();
    }

    document.getElementById('submitBtn')?.addEventListener('click', handleSubmit);

    // 아이디 입력 시 허용되지 않는 문자 실시간 제거
    document.getElementById('regEmail')?.addEventListener('input', (e) => {
      const raw = e.target.value;
      const cleaned = raw.toLowerCase().replace(/[^a-z0-9.@_-]/g, '');
      if (raw !== cleaned) e.target.value = cleaned;
      e.target.classList.remove('is-invalid');
    });

    // 인풋 변경 시 invalid 스타일 제거
    ['regEmail', 'regName', 'regClinic', 'regTeam'].forEach(id => {
      document.getElementById(id)?.addEventListener('input', () => {
        document.getElementById(id)?.classList.remove('is-invalid');
      });
      document.getElementById(id)?.addEventListener('change', () => {
        document.getElementById(id)?.classList.remove('is-invalid');
      });
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
