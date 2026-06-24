(function () {
  const STORAGE_KEY = 'imed_portal_user';
  const IDLE_TIMEOUT = 2 * 60 * 60 * 1000; // 유휴 만료: 2시간

  function setMessage(message, type = '') {
    const el = document.getElementById('authMessage');
    if (!el) return;

    el.textContent = message || '';
    el.className = 'auth-message';

    if (type) {
      el.classList.add(`is-${type}`);
    }
  }

  function getLoginUrl() {
    return `${CONFIG.SITE_BASE_URL}/index.html`;
  }

  function getPortalUrl() {
    // 개발 서버(gc_imed_me_dev)는 포털 없이 바로 app.html로 진입
    const isDev = CONFIG.SITE_BASE_URL.includes('_dev') || location.hostname === 'localhost';
    return isDev
      ? `${CONFIG.SITE_BASE_URL}/app.html`
      : `${CONFIG.SITE_BASE_URL}/portal.html`;
  }

  function getChangePasswordUrl() {
    return `${CONFIG.SITE_BASE_URL}/pages/auth/change-password.html`;
  }

  function normalizeSessionUser(user) {
    const raw = user || {};
    return {
      ...raw,
      email: raw.email || raw.user_email || '',
      user_email: raw.user_email || raw.email || '',
      name: raw.name || raw.user_name || '',
      user_name: raw.user_name || raw.name || '',
      role: raw.role || 'user',
      first_login: String(raw.first_login || 'N').toUpperCase(),
      loginAt: raw.loginAt || Date.now()
    };
  }

  function saveSession(user) {
    const normalized = normalizeSessionUser(user);
    normalized.lastActiveAt = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  }

  function getSession() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!raw) return null;

      // 유휴 만료 체크: 마지막 활동 후 30분 경과 시 세션 삭제
      const lastActive = raw.lastActiveAt || raw.loginAt || 0;
      if (Date.now() - lastActive > IDLE_TIMEOUT) {
        clearSession();
        return null;
      }

      const normalized = normalizeSessionUser(raw);

      // 예전 형식 세션이 남아 있어도 현재 형식으로 자동 보정
      if (
        raw.email !== normalized.email ||
        raw.user_email !== normalized.user_email ||
        raw.name !== normalized.name ||
        raw.user_name !== normalized.user_name ||
        raw.first_login !== normalized.first_login
      ) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
      }

      return normalized;
    } catch (error) {
      return null;
    }
  }

  // 사용자 활동 시 lastActiveAt 갱신
  function refreshActivity() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!raw) return;
      raw.lastActiveAt = Date.now();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));
    } catch (e) {}
  }

  function clearSession() {
    localStorage.removeItem(STORAGE_KEY);
  }

  // ── 전체 캐시 강제 초기화 ────────────────────────────────────
  // localStorage / sessionStorage 전체 삭제 후 페이지 새로고침
  // 버전 불일치(구버전 캐시)로 인한 접속 불가 문제 해결용
  function clearAllCache(showConfirm) {
    if (showConfirm) {
      if (!confirm('브라우저 캐시를 모두 초기화합니다.\n로그인 정보가 삭제되며 페이지가 새로고침됩니다.\n계속할까요?')) return;
    }
    try { localStorage.clear(); }   catch(e) {}
    try { sessionStorage.clear(); } catch(e) {}
    // config.js 캐시 버전을 localStorage에 저장해두어 다음 로드 시 비교에 사용
    try {
      if (typeof CONFIG !== 'undefined' && CONFIG.CACHE_VERSION) {
        localStorage.setItem('gc_imed_cache_version', CONFIG.CACHE_VERSION);
      }
    } catch(e) {}
    location.reload(true);
  }

  // 페이지 로드 시 CACHE_VERSION 체크 — 구버전 캐시면 자동 초기화
  function checkCacheVersion() {
    try {
      if (typeof CONFIG === 'undefined' || !CONFIG.CACHE_VERSION) return;
      const stored = localStorage.getItem('gc_imed_cache_version');
      if (stored === CONFIG.CACHE_VERSION) return;
      // 버전이 다르면 조용히 초기화 (confirm 없이)
      console.info('[auth] 캐시 버전 불일치(' + stored + ' → ' + CONFIG.CACHE_VERSION + '), 자동 초기화');
      clearAllCache(false);
    } catch(e) {}
  }

  function logout() {
    window.appPermission?.clearCache?.();
    window.OrgService?.clearCache?.();
    window.orgSelect?.clearCache?.();
    clearSession();
    // 페이지별 sessionStorage 캐시 전체 제거 (의원 전환 시 잔류 방지)
    try { sessionStorage.clear(); } catch (e) {}
    history.replaceState(null, '', getLoginUrl());
    location.replace(getLoginUrl());
  }

  function requireAuth() {
    const user = getSession();
    if (!user) {
      location.replace(getLoginUrl());
      return null;
    }
    return user;
  }

  function redirectIfLoggedIn() {
    const user = getSession();
    if (!user) return;

    if (String(user.first_login || 'N').toUpperCase() === 'Y') {
      location.replace(getChangePasswordUrl());
      return;
    }

    location.replace(getPortalUrl());
  }

  async function login() {
    const emailEl = document.getElementById('userEmail');
    const passwordEl = document.getElementById('userPassword');
    const loginBtn = document.getElementById('loginBtn');

    if (!emailEl || !passwordEl || !loginBtn) return;

    const user_email = emailEl.value.trim();
    const password = passwordEl.value.trim();

    if (!user_email) {
      setMessage('아이디를 입력해 주세요.', 'error');
      emailEl.focus();
      return;
    }

    if (!password) {
      setMessage('비밀번호를 입력해 주세요.', 'error');
      passwordEl.focus();
      return;
    }

    setMessage('');
    loginBtn.disabled = true;
    loginBtn.textContent = '로그인 중...';
    showGlobalLoading('로그인 중...');

    try {
      const result = await apiPost('login', { user_email, password });

      if (!result?.success) {
        throw new Error(result?.message || '로그인에 실패했습니다.');
      }

      // 이전 사용자의 캐시를 모두 제거한 뒤 새 세션 저장
      window.appPermission?.clearCache?.();
      window.OrgService?.clearCache?.();
      window.orgSelect?.clearCache?.();
      // 페이지별 sessionStorage 캐시 전체 제거 (의원 전환 시 잔류 방지)
      try { sessionStorage.clear(); } catch (e) {}
      saveSession(result.user || {});

      if (String(result.user?.first_login || 'N').toUpperCase() === 'Y') {
        location.replace(getChangePasswordUrl());
        return;
      }

      location.replace(getPortalUrl());
    } catch (error) {
      await hideGlobalLoading(true);
      setMessage(error.message || '로그인 실패', 'error');
    } finally {
      loginBtn.disabled = false;
      loginBtn.textContent = '로그인';
    }
  }

  function bindLoginPage() {
    const loginBtn = document.getElementById('loginBtn');
    const emailEl = document.getElementById('userEmail');
    const passwordEl = document.getElementById('userPassword');

    if (!loginBtn || !emailEl || !passwordEl) return;

    // 캐시 초기화 버튼 바인딩
    const clearCacheBtn = document.getElementById('clearCacheBtn');
    if (clearCacheBtn) {
      clearCacheBtn.addEventListener('click', () => clearAllCache(true));
    }

    redirectIfLoggedIn();

    loginBtn.addEventListener('click', login);

    [emailEl, passwordEl].forEach(el => {
      el.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          login();
        }
      });
    });
  }

  function bindHistoryGuard() {
    const path = location.pathname.replace(/\/+$/, '');
    const siteBasePath = new URL(CONFIG.SITE_BASE_URL, location.origin).pathname.replace(/\/+$/, '');

    const isLoginPage =
      path === '' ||
      path === '/' ||
      path === siteBasePath ||
      path === `${siteBasePath}/index.html` ||
      location.pathname.endsWith('/index.html');

    const isPublicPage =
      location.pathname.includes('/pages/equipment/public-detail.html');

    function checkSessionGuard_() {
      const user = getSession();

      if (isPublicPage) return;

      if (isLoginPage) {
        if (user) {
          if (String(user.first_login || 'N').toUpperCase() === 'Y') {
            location.replace(getChangePasswordUrl());
            return;
          }
          location.replace(getPortalUrl());
        }
        return;
      }

      if (!user) {
        location.replace(getLoginUrl());
        return;
      }

      const isChangePasswordPage = location.pathname.includes('/pages/auth/change-password.html');
      if (!isChangePasswordPage && String(user.first_login || 'N').toUpperCase() === 'Y') {
        location.replace(getChangePasswordUrl());
      }
    }

    window.addEventListener('pageshow', checkSessionGuard_);

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      checkSessionGuard_();
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    checkCacheVersion();   // 캐시 버전 체크 — 구버전이면 자동 초기화
    bindLoginPage();
    bindHistoryGuard();

    // 사용자 활동 감지 → lastActiveAt 갱신 (클릭, 키 입력, 스크롤)
    // throttle: 1분에 한 번만 저장해서 localStorage 과부하 방지
    let lastRefresh = 0;
    function onActivity() {
      const now = Date.now();
      if (now - lastRefresh < 60 * 1000) return;
      lastRefresh = now;
      refreshActivity();
    }

    ['click', 'keydown', 'scroll', 'touchstart'].forEach(evt => {
      document.addEventListener(evt, onActivity, { passive: true });
    });
  });

  window.auth = {
    saveSession,
    getSession,
    clearSession,
    clearAllCache,
    logout,
    requireAuth,
    redirectIfLoggedIn
  };
})();
