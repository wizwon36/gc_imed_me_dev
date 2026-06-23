(function () {
  let appList = [];

  document.addEventListener('DOMContentLoaded', async () => {
    const user = window.auth?.requireAuth?.();
    if (!user) return;

    try {
      showGlobalLoading('목록을 불러오는 중...');
      await loadMeta();
      await loadList();
    } catch (err) {
      const listEl = document.getElementById('requestList');
      if (listEl) listEl.innerHTML = '';
      showMessage(err.message || '목록을 불러오지 못했습니다.', 'error');
    } finally {
      hideGlobalLoading();
    }

    document.getElementById('filterBtn')?.addEventListener('click', async () => {
      try {
        showGlobalLoading('조회 중...');
        await loadList();
      } catch (err) {
        showMessage(err.message || '조회 중 오류가 발생했습니다.', 'error');
      } finally {
        hideGlobalLoading();
      }
    });

    document.getElementById('modalBackdrop')?.addEventListener('click', closeModal);
    document.getElementById('modalClose')?.addEventListener('click', closeModal);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
  });

  // 단일 진실 소스화(2026-06) — DEFAULT_APPS 폴백(app_registry 도입 전
  // getSupportAppList 응답이 불완전할 가능성에 대비한 보완용)이 다른
  // 3곳(GAS, support-form.js, support-admin.js)과 서로 다른 개수로
  // 어긋난 채 흩어져 있었음. GAS가 이제 app_registry 기반으로 안정적인
  // 목록을 내려주므로 제거.
  async function loadMeta() {
    const user  = window.auth?.getSession?.() || {};
    const email = user.user_email || user.email || '';
    const result = await apiGet('getSupportAppList', { request_user_email: email });
    appList = result?.data?.apps || [];

    const appSel = document.getElementById('filterApp');
    appList.forEach(function (a) {
      const opt = document.createElement('option');
      opt.value       = a.app_id;
      opt.textContent = a.app_name;
      appSel.appendChild(opt);
    });
  }

  async function loadList() {
    const user   = window.auth?.getSession?.() || {};
    const email  = user.user_email || user.email || '';
    const appId  = document.getElementById('filterApp')?.value    || '';
    const status = document.getElementById('filterStatus')?.value || '';

    const params = { request_user_email: email };
    if (appId)  params.app_id = appId;
    if (status) params.status = status;

    const result = await apiGet('listSupportRequests', params);
    renderList(result?.data || []);
  }

  // ── 카드 렌더링 ────────────────────────────────────────────────────
  function renderList(items) {
    const listEl  = document.getElementById('requestList');
    const emptyEl = document.getElementById('emptyBox');

    if (!items.length) {
      if (listEl)  listEl.innerHTML = '';
      if (emptyEl) emptyEl.style.display = 'block';
      return;
    }
    if (emptyEl) emptyEl.style.display = 'none';

    listEl.innerHTML = items.map(function (item) {
      const hasReply = item.reply && (item.status === 'COMPLETED' || item.status === 'REJECTED');
      const replyHtml = hasReply ? `
        <div class="support-card-reply">
          <div class="support-card-reply-label">💬 처리 답변</div>
          <div style="font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(item.reply)}</div>
        </div>` : '';

      return `
        <div class="support-card support-card--${item.status}" data-id="${escapeHtml(item.request_id)}">
          <div class="support-card-bar"></div>
          <div class="support-card-body">
            <div class="support-card-badges">
              <span class="support-badge support-badge--app">${escapeHtml(item.app_name)}</span>
              <span class="support-badge support-badge--cat">${escapeHtml(item.category_label)}</span>
              <span class="support-badge support-badge--${item.status}">${escapeHtml(item.status_label)}</span>
            </div>
            <div class="support-card-title">${escapeHtml(item.title)}</div>
            <div class="support-card-preview">${escapeHtml(item.content)}</div>
            ${replyHtml}
            <div class="support-card-meta">
              <span>${escapeHtml(item.created_at)}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');

    listEl.querySelectorAll('.support-card').forEach(function (card) {
      card.addEventListener('click', function () {
        openDetail(this.dataset.id);
      });
    });
  }

  // ── 모달 열기 ──────────────────────────────────────────────────────
  async function openDetail(requestId) {
    try {
      const user  = window.auth?.getSession?.() || {};
      const email = user.user_email || user.email || '';
      showGlobalLoading('불러오는 중...');
      const result = await apiGet('getSupportRequest', {
        request_id: requestId,
        request_user_email: email
      });
      renderModal(result.data);
    } catch (err) {
      showMessage(err.message || '상세 정보를 불러오지 못했습니다.', 'error');
    } finally {
      hideGlobalLoading();
    }
  }

  // ── 모달 렌더링 ────────────────────────────────────────────────────
  function renderModal(item) {
    const modal  = document.getElementById('detailModal');
    const bodyEl = document.getElementById('modalBody');

    const box = modal.querySelector('.support-modal-box');
    if (box) {
      let topbar = box.querySelector('.support-modal-topbar');
      if (!topbar) {
        topbar = document.createElement('div');
        box.insertBefore(topbar, box.firstChild);
      }
      topbar.className = `support-modal-topbar support-modal-topbar--${item.status}`;

      const headerLeft = box.querySelector('.support-modal-header-left');
      if (headerLeft) {
        headerLeft.innerHTML = `
          <div class="support-modal-badges">
            <span class="support-badge support-badge--app">${escapeHtml(item.app_name)}</span>
            <span class="support-badge support-badge--cat">${escapeHtml(item.category_label)}</span>
            <span class="support-badge support-badge--${item.status}">${escapeHtml(item.status_label)}</span>
          </div>
          <h3 class="support-modal-title">${escapeHtml(item.title)}</h3>
        `;
      }
    }

    const fileHtml = Array.isArray(item.file_ids) && item.file_ids.length
      ? `<div class="support-meta-item">📎 <strong>파일 ${item.file_ids.length}개 첨부</strong></div>` : '';

    const replyHtml = item.reply ? `
      <div class="support-modal-section">
        <div class="support-reply-box">
          <div class="support-reply-box-title">
            💬 처리 답변
            <span style="font-weight:400;color:var(--text-muted);margin-left:4px;">${escapeHtml(item.replied_at)}</span>
          </div>
          <div class="support-reply-box-content">${escapeHtml(item.reply)}</div>
        </div>
      </div>` : '';

    bodyEl.innerHTML = `
      <div class="support-modal-section">
        <div class="support-meta-row">
          <div class="support-meta-item">🕐 <strong>${escapeHtml(item.created_at)}</strong></div>
          ${fileHtml}
        </div>
      </div>
      <div class="support-modal-section">
        <div class="support-detail-label">요청 내용</div>
        <div class="support-detail-content">${escapeHtml(item.content)}</div>
      </div>
      ${replyHtml}
    `;

    modal.style.display = 'block';
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    const modal = document.getElementById('detailModal');
    if (modal) modal.style.display = 'none';
    document.body.style.overflow = '';
  }
})();
