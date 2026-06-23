window.appPermission = (function () {
  let cachedPermissions = null;

  async function loadPermissions() {
    if (cachedPermissions) {
      return cachedPermissions;
    }

    const user = window.auth?.getSession?.();
    if (!user || !user.email) {
      cachedPermissions = [];
      return cachedPermissions;
    }

    try {
      const result = await apiGet('getUserPermissions', {
        user_email: user.email,
        request_user_email: user.email
      });

      cachedPermissions = Array.isArray(result.data) ? result.data : [];
      return cachedPermissions;
    } catch (error) {
      console.error('권한 정보를 불러오지 못했습니다.', error);
      cachedPermissions = [];
      return cachedPermissions;
    }
  }

  async function getPermission(appId) {
    const permissions = await loadPermissions();
    const found = permissions.find(item => item.app_id === appId);
    return found ? found.permission : null;
  }

  async function hasPermission(appId, allowedPermissions = []) {
    const user = window.auth?.getSession?.();

    if (String(user?.role || '').trim().toLowerCase() === 'admin') {
      return true;
    }

    const permissions = await loadPermissions();
    const found = permissions.find(item => item.app_id === appId);

    if (!found) return false;
    if (String(found.active || 'Y').trim().toUpperCase() !== 'Y') return false;

    const permission = found.permission;

    if (!Array.isArray(allowedPermissions) || allowedPermissions.length === 0) {
      return true;
    }

    return allowedPermissions.includes(permission);
  }

  async function requirePermission(appId, allowedPermissions = []) {
    const ok = await hasPermission(appId, allowedPermissions);
    if (!ok) {
      alert('이 앱에 접근할 권한이 없습니다.');
      location.replace(`${CONFIG.SITE_BASE_URL}/portal.html`);
      return false;
    }
    return true;
  }

  async function toggleByPermission(appId, selector, allowedPermissions = []) {
    const ok = await hasPermission(appId, allowedPermissions);
    const elements = document.querySelectorAll(selector);

    elements.forEach(el => {
      if (ok) {
        el.style.display = '';
        el.removeAttribute('disabled');
        el.removeAttribute('aria-hidden');
      } else {
        el.style.display = 'none';
        el.setAttribute('aria-hidden', 'true');
      }
    });

    return ok;
  }

  async function disableByPermission(appId, selector, allowedPermissions = []) {
    const ok = await hasPermission(appId, allowedPermissions);
    const elements = document.querySelectorAll(selector);

    elements.forEach(el => {
      if (ok) {
        el.disabled = false;
        el.classList.remove('is-disabled-by-permission');
        el.removeAttribute('title');
      } else {
        el.disabled = true;
        el.classList.add('is-disabled-by-permission');
        el.setAttribute('title', '권한이 없습니다.');
      }
    });

    return ok;
  }

  function clearCache() {
    cachedPermissions = null;
  }

  return {
    loadPermissions,
    getPermission,
    hasPermission,
    requirePermission,
    toggleByPermission,
    disableByPermission,
    clearCache
  };
})();
