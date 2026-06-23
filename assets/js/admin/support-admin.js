(function () {
  let allItems = [];
  let currentItem = null;

  document.addEventListener('DOMContentLoaded', async () => {
    const user = window.auth?.requireAuth?.();
    if (!user) return;

    // 관리자만 접근
    if (String(user.role || '').trim().toLowerCase() !== 'admin') {
      alert('관리자만 접근할 수 있습니다.');
      location.replace(`${CONFIG.SITE_BASE_URL}/portal.html`);
      return;
    }

    try {
      showGlobalLoading('목록을 불러오는 중...');
      await loadMeta();
      initDateDefaults();
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

    document.getElementById('filterKeyword')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('filterBtn')?.click();
    });

    document.getElementById('modalBackdrop')?.addEventListener('click', closeModal);
    document.getElementById('modalClose')?.addEventListener('click', closeModal);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
  });

  // 단일 진실 소스화(2026-06) — DEFAULT_APPS 폴백(3개, task_manager도 빠진
  // 채로 다른 3곳과 어긋나 있었음)을 제거. 이 화면은 위에서 role=admin만
  // 통과시키므로, GAS의 getSupportAppList가 admin 분기로 노출 대상
  // 전체(app_registry.support_target=true인 7개)를 그대로 내려준다.
  async function loadMeta() {
    const sessionUser = window.auth?.getSession?.() || {};
    const email = sessionUser.email || sessionUser.user_email || '';
    const result = await apiGet('getSupportAppList', { request_user_email: email });
    const apps = result?.data?.apps || [];

    const appSel = document.getElementById('filterApp');
    apps.forEach(function (a) {
      const opt = document.createElement('option');
      opt.value       = a.app_id;
      opt.textContent = a.app_name;
      appSel.appendChild(opt);
    });
  }

  // ── 날짜 기본값 초기화 (오늘 기준 한 달 전 ~ 오늘) ────────────────
  function initDateDefaults() {
    const today = new Date();
    const from  = new Date(today);
    from.setMonth(from.getMonth() - 1);

    const fmt = d => d.toISOString().slice(0, 10);

    const fromEl = document.getElementById('filterDateFrom');
    const toEl   = document.getElementById('filterDateTo');
    if (fromEl && !fromEl.value) fromEl.value = fmt(from);
    if (toEl   && !toEl.value)   toEl.value   = fmt(today);
  }

  // ── 목록 로드 ─────────────────────────────────────────────────────
  async function loadList() {
    const user    = window.auth?.getSession?.() || {};
    const email   = user.user_email || user.email || '';
    const appId   = document.getElementById('filterApp')?.value    || '';
    const status  = document.getElementById('filterStatus')?.value || '';
    const keyword = document.getElementById('filterKeyword')?.value?.trim() || '';
    const dateFrom = document.getElementById('filterDateFrom')?.value || '';
    const dateTo   = document.getElementById('filterDateTo')?.value   || '';

    const params = { request_user_email: email };
    if (appId)    params.app_id    = appId;
    if (status)   params.status    = status;
    if (keyword)  params.keyword   = keyword;
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo)   params.date_to   = dateTo;

    const result = await apiGet('listSupportRequests', params);
    allItems = result?.data || [];
    renderStat(allItems);
    renderList(allItems);
  }

  // ── 통계 바 ───────────────────────────────────────────────────────
  function renderStat(items) {
    const counts = { PENDING: 0, IN_PROGRESS: 0, COMPLETED: 0, REJECTED: 0 };
    items.forEach(function (item) { if (counts[item.status] !== undefined) counts[item.status]++; });

    const total  = items.length;
    const labels = { PENDING:'접수', IN_PROGRESS:'처리중', COMPLETED:'완료', REJECTED:'반려' };
    const bar = document.getElementById('statBar');
    if (!bar) return;

    // 전체 칩 + 개별 상태 칩
    const allChip = `<div class="support-stat-chip support-stat-chip--all" data-status="">
      전체
      <span class="support-stat-chip-count">${total}</span>
    </div>`;

    const statusChips = Object.keys(counts).map(function (s) {
      return `<div class="support-stat-chip" data-status="${s}">
        ${escapeHtml(labels[s])}
        <span class="support-stat-chip-count">${counts[s]}</span>
      </div>`;
    }).join('');

    bar.innerHTML = allChip + statusChips;

    bar.querySelectorAll('.support-stat-chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        const statusSel = document.getElementById('filterStatus');
        if (statusSel) statusSel.value = this.dataset.status;
        document.getElementById('filterBtn')?.click();
      });
    });
  }

  // ── 목록 렌더 (그리드 + 페이지네이션) ────────────────────────────
  const PAGE_SIZE = 20;
  let currentPage = 1;

  function renderList(items) {
    currentPage = 1;
    renderPage(items, currentPage);
  }

  function renderPage(items, page) {
    const tableEl  = document.getElementById('requestList');
    const bodyEl   = document.getElementById('requestBody');
    const emptyEl  = document.getElementById('emptyBox');
    const skelEl   = document.getElementById('skeletonArea');
    const pgBar    = document.getElementById('paginationBar');

    if (skelEl) skelEl.style.display = 'none';

    if (!items.length) {
      if (tableEl) tableEl.style.display = 'none';
      if (pgBar)   pgBar.style.display   = 'none';
      if (emptyEl) emptyEl.style.display = 'block';
      return;
    }
    if (emptyEl) emptyEl.style.display = 'none';
    if (tableEl) tableEl.style.display = '';

    const totalPages = Math.ceil(items.length / PAGE_SIZE);
    const start = (page - 1) * PAGE_SIZE;
    const pageItems = items.slice(start, start + PAGE_SIZE);

    bodyEl.innerHTML = pageItems.map(function (item) {
      const requester = item.requester_name || item.created_by || '';
      const dateShort  = (item.created_at || '').slice(0, 10);
      return `
        <tr class="is-${item.status.toLowerCase()}" data-id="${escapeHtml(item.request_id)}">
          <td class="col-center col-app"><span class="support-badge support-badge--app">${escapeHtml(item.app_name)}</span></td>
          <td class="col-center col-type"><span class="support-badge support-badge--cat">${escapeHtml(item.category_label)}</span></td>
          <td class="col-center col-status"><span class="support-badge support-badge--${item.status}">${escapeHtml(item.status_label)}</span></td>
          <td class="col-title">${escapeHtml(item.title)}</td>
          <td class="col-preview">${escapeHtml(item.content)}</td>
          <td class="col-meta col-center">${escapeHtml(requester)}</td>
          <td class="col-meta col-center col-date">${escapeHtml(dateShort)}</td>
          <td class="col-reply">${item.reply ? '💬' : ''}</td>
        </tr>
      `;
    }).join('');

    bodyEl.querySelectorAll('tr').forEach(function (row) {
      row.addEventListener('click', function () {
        openModal(this.dataset.id);
      });
    });

    // 페이지네이션 렌더
    if (totalPages <= 1) {
      if (pgBar) pgBar.style.display = 'none';
      return;
    }
    if (pgBar) pgBar.style.display = 'flex';

    const WINDOW = 2;
    let pgHtml = '';

    pgHtml += `<button class="pg-btn" ${page === 1 ? 'disabled' : ''} data-page="${page - 1}">‹</button>`;

    for (let i = 1; i <= totalPages; i++) {
      if (i === 1 || i === totalPages || (i >= page - WINDOW && i <= page + WINDOW)) {
        pgHtml += `<button class="pg-btn ${i === page ? 'is-active' : ''}" data-page="${i}">${i}</button>`;
      } else if (i === page - WINDOW - 1 || i === page + WINDOW + 1) {
        pgHtml += `<span style="padding:0 4px;color:var(--text-muted);">…</span>`;
      }
    }

    pgHtml += `<button class="pg-btn" ${page === totalPages ? 'disabled' : ''} data-page="${page + 1}">›</button>`;

    pgBar.innerHTML = pgHtml;
    pgBar.querySelectorAll('.pg-btn:not(:disabled)').forEach(function (btn) {
      btn.addEventListener('click', function () {
        currentPage = parseInt(this.dataset.page, 10);
        renderPage(allItems, currentPage);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });
  }

  // ── 모달 열기 ─────────────────────────────────────────────────────
  async function openModal(requestId) {
    try {
      const user  = window.auth?.getSession?.() || {};
      const email = user.user_email || user.email || '';
      showGlobalLoading('불러오는 중...');
      const result = await apiGet('getSupportRequest', { request_id: requestId, request_user_email: email });
      currentItem = result.data;
      renderModal(currentItem);
    } catch (err) {
      showMessage(err.message || '상세 정보를 불러오지 못했습니다.', 'error');
    } finally {
      hideGlobalLoading();
    }
  }

  function renderModal(item) {
    const modal   = document.getElementById('processModal');
    const titleEl = document.getElementById('modalTitle');
    const bodyEl  = document.getElementById('modalBody');
    const footerEl = document.getElementById('modalFooter');

    if (titleEl) titleEl.textContent = item.title;

    const files = Array.isArray(item.files) && item.files.length ? item.files : [];
    const fileHtml = files.length
      ? `<div class="support-detail-row">
           <div class="support-detail-label">첨부파일</div>
           <div class="support-file-list">
             ${files.map(function(f) {
               return f.download_url
                 ? `<a href="${escapeHtml(f.download_url)}" target="_blank" rel="noopener" class="support-file-chip" download>
                      <span class="support-file-chip-icon">⬇</span>
                      <span class="support-file-chip-name">${escapeHtml(f.file_name)}</span>
                    </a>`
                 : `<span class="support-file-chip support-file-chip--error">${escapeHtml(f.file_name)}</span>`;
             }).join('')}
           </div>
         </div>` : '';

    const existingReplyHtml = item.reply ? `
      <div class="support-existing-reply">
        <div class="support-existing-reply-label">💬 기존 답변 (${escapeHtml(item.replied_at)})</div>
        <div class="support-existing-reply-text">${escapeHtml(item.reply)}</div>
      </div>` : '';

    bodyEl.innerHTML = `
      <div class="support-detail-row">
        <div class="support-detail-label">카테고리 / 유형</div>
        <div class="support-detail-value">
          <span class="support-badge support-badge--app">${escapeHtml(item.app_name)}</span>
          <span class="support-badge support-badge--cat" style="margin-left:6px;">${escapeHtml(item.category_label)}</span>
        </div>
      </div>
      <div class="support-detail-row support-detail-row--requester">
        <div class="support-detail-label">요청자</div>
        <div class="support-detail-value">
          ${item.requester_name ? `<strong>${escapeHtml(item.requester_name)}</strong> · ` : ''}${escapeHtml(item.created_by)}${item.requester_dept || item.requester_clinic ? ` · ${escapeHtml(item.requester_dept || item.requester_clinic)}` : ''}
          <span style="color:var(--text-muted);font-size:12px;margin-left:6px;">${escapeHtml(item.created_at)}</span>
        </div>
      </div>
      <div class="support-detail-row">
        <div class="support-detail-label">현재 상태</div>
        <div class="support-detail-value">
          <span class="support-badge support-badge--${item.status}">${escapeHtml(item.status_label)}</span>
        </div>
      </div>
      <div class="support-detail-row">
        <div class="support-detail-label">요청 내용</div>
        <div class="support-detail-content">${escapeHtml(item.content)}</div>
      </div>
      ${fileHtml}
      ${existingReplyHtml}
    `;

    footerEl.innerHTML = `
      <div class="support-process-form">
        <div>
          <div class="support-process-label">처리 상태 변경</div>
          <select id="processStatus" class="support-process-select">
            <option value="PENDING"     ${item.status === 'PENDING'     ? 'selected' : ''}>접수</option>
            <option value="IN_PROGRESS" ${item.status === 'IN_PROGRESS' ? 'selected' : ''}>처리중</option>
            <option value="COMPLETED"   ${item.status === 'COMPLETED'   ? 'selected' : ''}>완료</option>
            <option value="REJECTED"    ${item.status === 'REJECTED'    ? 'selected' : ''}>반려</option>
          </select>
        </div>
        <div>
          <div class="support-process-label">답변 내용</div>
          <textarea id="processReply" class="support-process-textarea" placeholder="처리 결과나 안내 메시지를 입력하세요. (완료/반려 시 요청자에게 메일 발송)">${escapeHtml(item.reply || '')}</textarea>
        </div>
        <div id="modalFeedback" style="display:none;padding:8px 12px;border-radius:8px;font-size:13px;font-weight:600;margin-bottom:8px;"></div>
        <div class="support-process-actions">
          <button type="button" id="processSubmitBtn" class="btn btn-primary" style="min-width:100px;">저장</button>
          <button type="button" id="resendEmailBtn" class="btn btn-secondary" style="min-width:100px;">📧 재발송</button>
          <button type="button" id="processCancelBtn" class="btn" style="min-width:100px;">닫기</button>
        </div>
      </div>
    `;

    document.getElementById('processSubmitBtn')?.addEventListener('click', handleProcess);
    document.getElementById('resendEmailBtn')?.addEventListener('click', handleResendEmail);
    document.getElementById('processCancelBtn')?.addEventListener('click', closeModal);

    const fb = document.getElementById('modalFeedback');
    if (fb) fb.style.display = 'none';
    modal.style.display = 'block';
    document.body.style.overflow = 'hidden';
  }

  // ── 처리 저장 ─────────────────────────────────────────────────────
  async function handleProcess() {
    if (!currentItem) return;

    const user   = window.auth?.getSession?.() || {};
    const email  = user.user_email || user.email || '';
    const status = document.getElementById('processStatus')?.value || '';
    const reply  = document.getElementById('processReply')?.value?.trim() || '';

    if (!status) { alert('처리 상태를 선택해 주세요.'); return; }

    const isCompleted = status === 'COMPLETED' || status === 'REJECTED';
    if (isCompleted && !reply) {
      if (!confirm('답변 내용 없이 저장하시겠습니까?\n완료/반려 상태는 답변 작성을 권장합니다.')) return;
    }

    const submitBtn = document.getElementById('processSubmitBtn');
    setLoading(submitBtn, true, '저장 중...');
    showGlobalLoading('처리 중...');

    try {
      await apiPost('updateSupportRequest', {
        request_id:         currentItem.request_id,
        status:             status,
        reply:              reply,
        request_user_email: email
      });

      closeModal();
      await hideGlobalLoading();
      showMessage('처리 상태가 업데이트되었습니다.', 'success');

      showGlobalLoading('목록 새로고침 중...');
      try {
        await loadList();
      } finally {
        await hideGlobalLoading();
      }

    } catch (err) {
      await hideGlobalLoading();
      alert(err.message || '저장 중 오류가 발생했습니다.');
    } finally {
      setLoading(submitBtn, false);
    }
  }

  // ── 메일 재발송 ───────────────────────────────────────────────────
  async function handleResendEmail() {
    if (!currentItem) return;

    if (!confirm('담당자에게 요청 내용과 첨부파일을 메일로 재발송하시겠습니까?')) return;

    const user  = window.auth?.getSession?.() || {};
    const email = user.user_email || user.email || '';
    const btn   = document.getElementById('resendEmailBtn');

    setLoading(btn, true, '발송 중...');
    showGlobalLoading('메일 재발송 중...');

    try {
      await apiPost('resendSupportEmail', {
        request_id:         currentItem.request_id,
        request_user_email: email
      });
      await hideGlobalLoading();
      showModalFeedback('✅ 메일이 재발송되었습니다.', 'success');
    } catch (err) {
      await hideGlobalLoading();
      showModalFeedback('❌ ' + (err.message || '메일 재발송 중 오류가 발생했습니다.'), 'error');
    } finally {
      setLoading(btn, false, '📧 메일 재발송');
    }
  }

  function showModalFeedback(msg, type) {
    const el = document.getElementById('modalFeedback');
    if (!el) return;
    el.textContent = msg;
    el.style.display = 'block';
    el.classList.remove('is-success', 'is-error');
    el.classList.add(type === 'success' ? 'is-success' : 'is-error');
    // 4초 후 자동 숨김
    setTimeout(function() { el.style.display = 'none'; }, 4000);
  }

  function closeModal() {
    const modal = document.getElementById('processModal');
    if (modal) modal.style.display = 'none';
    document.body.style.overflow = '';
    currentItem = null;
  }
})();
