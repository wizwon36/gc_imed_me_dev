document.addEventListener('DOMContentLoaded', () => {
  const user = window.auth?.getSession?.();
  const userEmail = user?.email || user?.user_email || '';

  if (!user || !userEmail) {
    alert('로그인 정보가 없습니다. 다시 로그인해 주세요.');
    location.replace(`${CONFIG.SITE_BASE_URL}/index.html`);
    return;
  }

  if (String(user.first_login || 'N').toUpperCase() !== 'Y') {
    location.replace(`${CONFIG.SITE_BASE_URL}/portal.html`);
    return;
  }

  const form = document.getElementById('changePasswordForm');
  form?.addEventListener('submit', handleChangePassword);
});

async function handleChangePassword(event) {
  event.preventDefault();

  const user = window.auth?.getSession?.();
  const userEmail = user?.email || user?.user_email || '';

  if (!user || !userEmail) {
    alert('로그인 정보가 없습니다. 다시 로그인해 주세요.');
    location.replace(`${CONFIG.SITE_BASE_URL}/index.html`);
    return;
  }

  const currentPassword = document.getElementById('currentPassword')?.value.trim();
  const newPassword = document.getElementById('newPassword')?.value.trim();
  const confirmPassword = document.getElementById('confirmPassword')?.value.trim();
  const submitBtn = document.getElementById('changePasswordBtn');

  if (!currentPassword) {
    setMessage('현재 비밀번호를 입력해 주세요.', 'error');
    return;
  }

  if (!newPassword) {
    setMessage('새 비밀번호를 입력해 주세요.', 'error');
    return;
  }

  if (newPassword.length < 4) {
    setMessage('새 비밀번호는 4자 이상이어야 합니다.', 'error');
    return;
  }

  if (newPassword === '1111') {
    setMessage('초기 비밀번호 1111은 사용할 수 없습니다.', 'error');
    return;
  }

  if (newPassword !== confirmPassword) {
    setMessage('새 비밀번호와 확인 비밀번호가 일치하지 않습니다.', 'error');
    return;
  }

  showGlobalLoading('비밀번호 변경 중...');
  submitBtn && (submitBtn.disabled = true);
  await waitForPaint();

  try {
    const result = await apiPost('changePassword', {
      user_email: userEmail,
      current_password: currentPassword,
      new_password: newPassword
    });

    setMessage(result.message || '비밀번호가 변경되었습니다.', 'success');

    const updatedUser = {
      ...user,
      email: userEmail,
      user_email: userEmail,
      first_login: 'N'
    };

    window.auth?.saveSession?.(updatedUser);

    await waitForPaint();

    setTimeout(() => {
      location.replace(`${CONFIG.SITE_BASE_URL}/portal.html`);
    }, 600);
  } catch (error) {
    setMessage(error.message || '비밀번호 변경 중 오류가 발생했습니다.', 'error');
  } finally {
    submitBtn && (submitBtn.disabled = false);
    hideGlobalLoading();
  }
}

function setMessage(message, type = '') {
  const el = document.getElementById('changePasswordMessage');
  if (!el) return;

  el.textContent = message || '';
  el.className = 'message-box';
  if (type) {
    el.classList.add(type);
  }
}

function waitForPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(resolve);
    });
  });
}
