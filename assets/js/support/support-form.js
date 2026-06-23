(function () {
  const MAX_SINGLE_MB    = 10;
  const MAX_TOTAL_MB     = 20;
  const MAX_SINGLE_BYTES = MAX_SINGLE_MB * 1024 * 1024;
  const MAX_TOTAL_BYTES  = MAX_TOTAL_MB  * 1024 * 1024;

  // 로컬에만 보관 (서버 업로드 전)
  const pendingFiles = []; // { file, itemId }
  let isSubmitting = false;

  // ── 초기화 ──────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', async () => {
    const user = window.auth?.requireAuth?.();
    if (!user) return;

    try {
      showGlobalLoading('화면을 준비하는 중...');
      await loadAppList(user.email);
      const sk   = document.getElementById('formSkeleton');
      const form = document.getElementById('supportForm');
      if (sk)   sk.style.display   = 'none';
      if (form) form.style.display = '';
      bindFileInput();
    } catch (err) {
      showMessage(err.message || '초기화 오류가 발생했습니다.', 'error');
    } finally {
      hideGlobalLoading();
    }

    document.getElementById('supportForm')?.addEventListener('submit', handleSubmit);
  });

  // 단일 진실 소스화(2026-06) — 11개 앱 정보가 GAS(SUPPORT_APP_LIST) +
  // 여기 DEFAULT_APPS + support-list.js + support-admin.js 4곳에 서로
  // 다른 개수로 어긋난 채 흩어져 있었음. GAS의 getSupportAppList API가
  // 이제 app_registry(단일 진실 소스) 기반으로 동적 + 사용자 권한 필터링된
  // 목록을 안정적으로 내려주므로, 이 폴백 하드코딩은 더 이상 필요 없어 제거.
  async function loadAppList(userEmail) {
    const result     = await apiGet('getSupportAppList', { request_user_email: userEmail });
    const apps       = Array.isArray(result?.data?.apps) ? result.data.apps : [];
    const categories = result?.data?.categories || [];

    const appSel = document.getElementById('appId');
    apps.forEach(function (a) {
      const opt = document.createElement('option');
      opt.value       = a.app_id;
      opt.textContent = a.app_name;
      appSel.appendChild(opt);
    });

    const catSel = document.getElementById('category');
    categories.forEach(function (c) {
      const opt = document.createElement('option');
      opt.value       = c.value;
      opt.textContent = c.label;
      catSel.appendChild(opt);
    });
  }

  // ── 파일 입력 바인딩 ────────────────────────────────────────────
  function bindFileInput() {
    const input = document.getElementById('fileInput');
    if (!input) return;
    input.addEventListener('change', function (e) {
      const files = Array.from(e.target.files);
      if (files.length > 0) addFiles(files);
      input.value = '';
    });
  }

  function getTotalBytes() {
    return pendingFiles.reduce((a, f) => a + f.file.size, 0);
  }

  function formatSize(bytes) {
    if (bytes < 1024)        return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  // 파일 선택 시 로컬 목록에만 추가 (서버 업로드 안 함)
  function addFiles(files) {
    const listEl     = document.getElementById('fileList');
    const fileNameEl = document.getElementById('fileName');

    for (const file of files) {
      if (file.size > MAX_SINGLE_BYTES) {
        showMessage(`파일 용량 초과: "${file.name}" — 파일당 최대 ${MAX_SINGLE_MB}MB`, 'error');
        continue;
      }
      if (getTotalBytes() + file.size > MAX_TOTAL_BYTES) {
        showMessage(`전체 첨부 용량 초과 — 최대 ${MAX_TOTAL_MB}MB`, 'error');
        continue;
      }

      const itemId = 'fi_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
      pendingFiles.push({ file, itemId });

      if (listEl) {
        listEl.insertAdjacentHTML('beforeend',
          `<div class="signage-file-item is-done" id="${itemId}">
            <span class="signage-file-item-name">${escapeHtml(file.name)}</span>
            <span class="signage-file-item-status">${formatSize(file.size)}</span>
            <button type="button" class="signage-file-item-remove" title="파일 제거">✕</button>
          </div>`
        );
        document.getElementById(itemId)
          ?.querySelector('.signage-file-item-remove')
          ?.addEventListener('click', () => removeFile(itemId));
      }
    }

    // 파일명 표시 업데이트
    if (fileNameEl) {
      fileNameEl.textContent = pendingFiles.length === 0
        ? '선택된 파일 없음'
        : pendingFiles.length === 1
          ? pendingFiles[0].file.name
          : pendingFiles.length + '개 파일 선택됨';
    }
  }

  function removeFile(itemId) {
    const idx = pendingFiles.findIndex(f => f.itemId === itemId);
    if (idx !== -1) pendingFiles.splice(idx, 1);
    document.getElementById(itemId)?.remove();

    const fileNameEl = document.getElementById('fileName');
    if (fileNameEl) {
      fileNameEl.textContent = pendingFiles.length === 0
        ? '선택된 파일 없음'
        : pendingFiles.length === 1
          ? pendingFiles[0].file.name
          : pendingFiles.length + '개 파일 선택됨';
    }
  }

  function toBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // ── 폼 제출 — 이 시점에 파일 업로드 ────────────────────────────
  async function handleSubmit(e) {
    e.preventDefault();
    clearMessage();
    if (isSubmitting) return;

    const user      = window.auth?.getSession?.() || {};
    const createdBy = user.user_email || user.email || '';

    const appId    = document.getElementById('appId')?.value?.trim()    || '';
    const category = document.getElementById('category')?.value?.trim() || '';
    const title    = document.getElementById('title')?.value?.trim()    || '';
    const content  = document.getElementById('content')?.value?.trim()  || '';

    if (!appId)    { showMessage('카테고리를 선택해 주세요.', 'error'); return; }
    if (!category) { showMessage('유형을 선택해 주세요.', 'error');     return; }
    if (!title)    { showMessage('제목을 입력해 주세요.', 'error');     return; }
    if (!content)  { showMessage('내용을 입력해 주세요.', 'error');     return; }

    const submitBtn = document.getElementById('submitBtn');
    isSubmitting = true;
    setLoading(submitBtn, true, '접수 중...');
    showGlobalLoading('수정요청을 접수하는 중...');

    try {
      // 1) 파일 업로드 (접수 시점)
      const uploadedFileIds = [];
      for (const { file, itemId } of pendingFiles) {
        const el = document.getElementById(itemId);
        if (el) {
          el.classList.replace('is-done', 'is-uploading');
          el.querySelector('.signage-file-item-status').textContent = '업로드 중...';
        }
        try {
          const base64 = await toBase64(file);
          const res    = await apiPost('uploadSupportFile', {
            file_base64: base64,
            file_name:   file.name,
            created_by:  createdBy
          });
          uploadedFileIds.push(res.data.file_id);
          if (el) {
            el.classList.replace('is-uploading', 'is-done');
            el.querySelector('.signage-file-item-status').textContent = `✓ ${formatSize(file.size)}`;
          }
        } catch (uploadErr) {
          if (el) {
            el.classList.replace('is-uploading', 'is-error');
            el.querySelector('.signage-file-item-status').textContent = '✗ 실패';
          }
          throw new Error(`파일 업로드 실패: ${file.name}`);
        }
      }

      // 2) 요청 접수
      await apiPost('createSupportRequest', {
        app_id:     appId,
        category:   category,
        title:      title,
        content:    content,
        file_ids:   uploadedFileIds,
        created_by: createdBy
      });

      hideGlobalLoading();
      alert('수정요청이 접수되었습니다.\n담당자 확인 후 처리해 드리겠습니다.');
      location.href = 'support-list.html';

    } catch (err) {
      hideGlobalLoading();
      showMessage(err.message || '접수 중 오류가 발생했습니다.', 'error');
      isSubmitting = false;
      setLoading(submitBtn, false);
    }
  }
})();
