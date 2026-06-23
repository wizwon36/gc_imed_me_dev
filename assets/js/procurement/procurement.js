/**
 * procurement.js
 * GC녹십자아이메드 구매규정 앱
 *
 * view  : API로 섹션 내용 로드 후 렌더링
 * admin : 편집 버튼 노출 + 인라인 편집 모달 (CKEditor 5 v43)
 */

// CKEditor ESM 파일 경로 (procurement.js 기준 상대경로)
const CKEDITOR_PATH = `${CONFIG.SITE_BASE_URL}/assets/libs/ckeditor5/ckeditor5.js`;
document.addEventListener('DOMContentLoaded', async () => {

  // ── 전역 스피너 시작 ───────────────────────────────────────
  try { showGlobalLoading('구매규정 불러오는 중...'); } catch(e) {}

  try {
    // ── 권한 체크 ───────────────────────────────────────────
    // 진입: regulation(view 이상) 또는 global admin
    const ok = await window.appPermission?.requirePermission?.(
      'regulation', ['admin', 'view']
    );
    if (ok === false) return;

    const user = window.auth?.getSession?.();

    // 편집: global admin 또는 procurement_edit 권한 보유자
    const isGlobalAdmin   = String(user?.role || '').trim().toLowerCase() === 'admin';
    const editPermission  = await window.appPermission?.getPermission?.('procurement_edit');
    const isAdmin         = isGlobalAdmin || editPermission === 'admin';

    // ── 섹션 데이터 로드 및 렌더링 ─────────────────────────
    await loadSections();

    // ── 최신 배포 버전 배지 업데이트 ─────────────────────
    await loadLatestVersionBadge();

    // admin이면 편집 버튼 + 버전 관리 버튼 노출
    if (isAdmin) {
      document.querySelectorAll('.pr-edit-btn').forEach(btn => {
        btn.style.display = 'inline-flex';
      });
      document.getElementById('prDeployBtn').style.display = '';
      document.getElementById('prVersionHistoryBtn').style.display = '';
      initEditModal();
      initVersionManagement();
    }

  } finally {
    // 권한체크 + 섹션 로드가 모두 끝난 뒤 스피너 해제
    try { hideGlobalLoading(); } catch(e) {}
  }

  // ── 검색 ──────────────────────────────────────────────────
  const searchInput = document.getElementById('prSearchInput');
  const searchClear = document.getElementById('prSearchClear');
  const searchInfo  = document.getElementById('prSearchResultInfo');
  const allSections = document.querySelectorAll('.pr-section');

  let searchTimer = null;
  searchInput?.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(doSearch, 200);
  });
  searchClear?.addEventListener('click', () => {
    searchInput.value = '';
    doSearch();
    searchInput.focus();
  });

  function doSearch() {
    const q = (searchInput?.value || '').trim();
    searchClear.style.display = q ? 'block' : 'none';
    if (!q) { clearSearch(); return; }

    // 이전 하이라이트 제거
    document.querySelectorAll('.pr-highlight').forEach(el => {
      el.outerHTML = el.textContent;
    });

    const allSubsections = document.querySelectorAll('.pr-subsection');
    let matchedSubsections = 0;

    // ── 소섹션 단위 필터링 ──────────────────────────────────
    allSubsections.forEach(sub => {
      if ((sub.textContent || '').toLowerCase().includes(q.toLowerCase())) {
        sub.classList.remove('pr-subsection-hidden');
        highlightInElement(sub, q);
        matchedSubsections++;
      } else {
        sub.classList.add('pr-subsection-hidden');
      }
    });

    // ── 대섹션: 하나라도 매칭된 소섹션이 있으면 보임 ────────
    allSections.forEach(section => {
      const hasVisible = section.querySelector('.pr-subsection:not(.pr-subsection-hidden)');
      if (hasVisible) {
        section.classList.remove('pr-section-hidden');
      } else {
        section.classList.add('pr-section-hidden');
      }
    });

    searchInfo.style.display = 'block';
    if (matchedSubsections > 0) {
      searchInfo.textContent = `"${q}" 검색 결과: ${matchedSubsections}개 조항 발견`;
      searchInfo.style.color = '#1d4ed8';
    } else {
      searchInfo.textContent = `"${q}"에 해당하는 조항이 없습니다.`;
      searchInfo.style.color = '#dc2626';
    }

    // 첫 번째 매칭 소섹션으로 스크롤
    const firstMatch = document.querySelector('.pr-subsection:not(.pr-subsection-hidden)');
    if (firstMatch) {
      const top = firstMatch.getBoundingClientRect().top + window.scrollY - getScrollOffset();
      window.scrollTo({ top, behavior: 'smooth' });
    }
  }

  function clearSearch() {
    document.querySelectorAll('.pr-highlight').forEach(el => {
      el.outerHTML = el.textContent;
    });
    document.querySelectorAll('.pr-subsection').forEach(s => s.classList.remove('pr-subsection-hidden'));
    allSections.forEach(s => s.classList.remove('pr-section-hidden'));
    if (searchInfo) searchInfo.style.display = 'none';
    if (searchClear) searchClear.style.display = 'none';
  }

  function highlightInElement(el, q) {
    let count = 0;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    const nodes = [];
    let node;
    while ((node = walker.nextNode())) nodes.push(node);
    const regex = new RegExp(escapeRegex(q), 'gi');
    nodes.forEach(textNode => {
      if (textNode.parentElement?.classList?.contains('pr-highlight')) return;
      const match = textNode.textContent.match(regex);
      if (match) {
        count += match.length;
        const span = document.createElement('span');
        span.innerHTML = textNode.textContent.replace(
          regex, m => `<span class="pr-highlight">${escapeHtml(m)}</span>`
        );
        textNode.parentNode.replaceChild(span, textNode);
      }
    });
    return count;
  }

  function escapeRegex(str) { return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function escapeHtml(str)  { return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  // ── 목차 ──────────────────────────────────────────────────
  function getScrollOffset() {
    const searchSection = document.querySelector('.pr-search-section');
    return (searchSection ? searchSection.getBoundingClientRect().height : 80) + 16;
  }
  const tocLinks = document.querySelectorAll('.pr-toc-link[data-section]');

  function setActiveLink(id) {
    tocLinks.forEach(l => l.classList.remove('active'));
    const active = document.querySelector(`.pr-toc-link[data-section="${id}"]`);
    if (!active) return;
    active.classList.add('active');
    active.closest('.pr-toc-group')
      ?.querySelector('.pr-toc-link--h1')
      ?.classList.add('active');
  }

  let isScrollingByClick = false;
  let clickScrollTimer   = null;

  tocLinks.forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      const id     = link.dataset.section;
      const target = document.getElementById(id);
      if (!target) return;
      setActiveLink(id);
      isScrollingByClick = true;
      clearTimeout(clickScrollTimer);
      clickScrollTimer = setTimeout(() => { isScrollingByClick = false; }, 800);
      const top = target.getBoundingClientRect().top + window.scrollY - getScrollOffset();
      window.scrollTo({ top, behavior: 'smooth' });
    });
  });

  const allAnchors = Array.from(
    document.querySelectorAll('.pr-section[id], .pr-subsection[id]')
  );

  function updateTocByScroll() {
    if (isScrollingByClick) return;
    const scrollTop = window.scrollY + getScrollOffset() + 10;
    let current = allAnchors[0];
    for (const el of allAnchors) {
      if (el.offsetTop <= scrollTop) current = el;
      else break;
    }
    if (current) setActiveLink(current.id);
  }

  window.addEventListener('scroll', updateTocByScroll, { passive: true });
  updateTocByScroll();

  // ── 목차 접기/펼치기 ─────────────────────────────────────
  const tocToggle = document.getElementById('prTocToggle');
  const tocNav    = document.getElementById('prTocNav');
  const tocAside  = document.getElementById('prToc');

  tocToggle?.addEventListener('click', () => {
    const collapsed = tocAside.classList.toggle('pr-toc--collapsed');
    tocToggle.textContent = collapsed ? '▶' : '◀';
    tocNav.style.display  = collapsed ? 'none' : '';
  });

  // ── 맨 위로 버튼 ─────────────────────────────────────────
  const backToTop    = document.getElementById('prBackToTop');
  const searchSection = document.getElementById('prSearchSection') ||
                        document.querySelector('.pr-search-section');

  window.addEventListener('scroll', () => {
    backToTop?.classList.toggle('visible', window.scrollY > 300);
    // 검색창이 상단에 붙으면 위쪽 모서리 각지게
    if (searchSection) {
      searchSection.classList.toggle('is-stuck', window.scrollY > 10);
    }
  }, { passive: true });
  backToTop?.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });


  // PDF 다운로드 버튼 초기화
  initPdfDownload();
});

// ── 스켈레톤 UI ──────────────────────────────────────────────
function showSkeleton() {
  const content = document.getElementById('prContent');
  if (!content) return;

  // CSS에서 이미 visibility:hidden 상태 — 스켈레톤만 삽입
  const skeletonBlock = () => `
    <div class="pr-skeleton-section">
      <div class="pr-skeleton-line pr-skeleton-line--title"></div>
      <div class="pr-skeleton-line pr-skeleton-line--h2"></div>
      <div class="pr-skeleton-line pr-skeleton-line--p1"></div>
      <div class="pr-skeleton-line pr-skeleton-line--p2"></div>
      <div class="pr-skeleton-line pr-skeleton-line--p3"></div>
      <div class="pr-skeleton-line pr-skeleton-line--p4"></div>
      <div class="pr-skeleton-divider"></div>
      <div class="pr-skeleton-line pr-skeleton-line--h2"></div>
      <div class="pr-skeleton-line pr-skeleton-line--p1"></div>
      <div class="pr-skeleton-line pr-skeleton-line--p2"></div>
      <div class="pr-skeleton-line pr-skeleton-line--p3"></div>
    </div>
  `;

  const wrap = document.createElement('div');
  wrap.id = 'prSkeletonWrap';
  wrap.className = 'pr-skeleton-wrap';
  wrap.innerHTML = skeletonBlock() + skeletonBlock() + skeletonBlock();
  content.insertBefore(wrap, content.firstChild);
}

function hideSkeleton() {
  const skeleton = document.getElementById('prSkeletonWrap');
  if (skeleton) skeleton.remove();

  const content = document.getElementById('prContent');
  if (!content) return;
  // 클래스 추가로 콘텐츠 표시
  content.querySelectorAll('.pr-section').forEach(el => {
    el.classList.add('pr-section--visible');
  });
}

// ── 섹션 로드 및 렌더링 ──────────────────────────────────────
function parseToDate(str) {
  if (!str) return null;
  const m1 = str.match(/^(\d{4})[-.](\d{2})[-.](\d{2})/);
  if (m1) return new Date(parseInt(m1[1]), parseInt(m1[2]) - 1, parseInt(m1[3]));
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

async function loadLatestVersionBadge() {
  try {
    const user = window.auth?.getSession?.();
    if (!user?.email) return;

    const result = await apiGet('getProcurementVersionList', {
      request_user_email: user.email
    });

    const list = result?.data || [];
    if (list.length === 0) return;

    // 최신 버전 (이미 최신순 정렬)
    const latest = list[0];

    // 버전 배지 업데이트
    const greenBadge = document.querySelector('.pr-badge--green');
    if (greenBadge && latest.version_label) {
      greenBadge.textContent = latest.version_label;
    }

    // 시행일 배지 업데이트 — 다양한 날짜 형식 처리
    const blueBadge = document.querySelector('.pr-badge--blue');
    if (blueBadge && latest.effective_date) {
      const d = parseToDate(latest.effective_date);
      if (d) {
        const y = d.getFullYear();
        const mo = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        blueBadge.textContent = `${y}.${mo}.${day} 시행`;
      }
    }
  } catch (e) {
    // 실패 시 하드코딩 값 유지
  }
}

async function loadSections() {
  const user = window.auth?.getSession?.();
  if (!user?.email) return;

  showSkeleton();

  try {
    const result = await apiGet('getProcurementSections', {
      request_user_email: user.email
    });

    if (!result?.success || !Array.isArray(result.data)) { hideSkeleton(); return; }
    if (result.data.length === 0) { hideSkeleton(); return; } // 아직 저장된 내용 없음 → HTML 기본값 유지

    // 각 섹션의 content_html을 DOM에 반영
    // 섹션 메타 캐시 초기화
    window.__procurementMeta = window.__procurementMeta || {};

    result.data.forEach(section => {
      // 메타 캐시 저장 (편집 모달에서 되돌리기/수정자 표시에 사용)
      window.__procurementMeta[section.sec_id] = {
        previous_html: section.previous_html || '',
        previous_at:   section.previous_at   || '',
        previous_by:   section.previous_by   || '',
        updated_at:    section.updated_at     || '',
        updated_by:    section.updated_by     || ''
      };

      const el = document.getElementById(section.sec_id);
      if (!el || !section.content_html) return;

      // 대섹션 intro
      if (section.sec_id.endsWith('-intro')) {
        const contentDiv = el.querySelector('.pr-section-intro-content');
        if (contentDiv) contentDiv.innerHTML = restoreHtmlClasses(section.content_html);
        if (section.updated_at) {
          let info = el.querySelector('.pr-section-updated-info');
          if (!info) {
            info = document.createElement('p');
            info.className = 'pr-section-updated-info';
            el.appendChild(info);
          }
          info.textContent = `최종 수정: ${section.updated_at.substring(0, 16)} · ${section.updated_by || ''}`;
        }
        return;
      }

      // 소섹션
      const header = el.querySelector('.pr-subsection-header');
      while (el.lastChild && el.lastChild !== header) {
        el.removeChild(el.lastChild);
      }
      const wrapper = document.createElement('div');
      wrapper.className = 'pr-subsection-content';
      wrapper.innerHTML = restoreHtmlClasses(section.content_html);
      el.appendChild(wrapper);

      if (section.updated_at) {
        const info = document.createElement('p');
        info.className = 'pr-section-updated-info';
        info.textContent = `최종 수정: ${section.updated_at.substring(0, 16)} · ${section.updated_by || ''}`;
        el.appendChild(info);
      }
    });

    hideSkeleton();

  } catch (err) {
    // 로드 실패 시 기본 HTML 유지 (조용히 무시)
    hideSkeleton();
    console.warn('구매규정 섹션 로드 실패:', err.message);
  }
}

// ── HTML 클래스 복구 후처리 ──────────────────────────────────────
// CKEditor가 getData() 시 일부 클래스/속성을 변환하므로
// 저장 전 DOM 파싱으로 원래 클래스 패턴을 복구
function restoreHtmlClasses(html) {
  // <td> 안 정규화: ul이면 pr-table-list 부여, p태그면 ul.pr-table-list로 변환
  html = html.replace(/<td([^>]*)>([\s\S]*?)<\/td>/gi, function(match, attrs, inner) {
    if (/<ul/i.test(inner)) {
      inner = inner.replace(/<ul[^>]*>/gi, '<ul class="pr-table-list">');
      return '<td' + attrs + '>' + inner + '</td>';
    }
    var pTags = [];
    var re = /<p[^>]*>([\s\S]*?)<\/p>/gi;
    var m;
    while ((m = re.exec(inner)) !== null) {
      if (m[1].trim()) pTags.push(m[1]);
    }
    if (pTags.length < 2) return match;
    var lis = pTags.map(function(c) { return '<li>' + c + '</li>'; }).join('');
    return '<td' + attrs + '><ul class="pr-table-list">' + lis + '</ul></td>';
  });

  const parser = new DOMParser();
  const doc    = parser.parseFromString(html, 'text/html');

  // 0. 표 앞뒤 빈 p 태그 제거 (CKEditor 자동 삽입 방지)
  doc.querySelectorAll('p').forEach(p => {
    if (p.innerHTML.trim() === '' || p.innerHTML.trim() === '<br>') {
      // 표 바로 앞뒤의 빈 p만 제거
      const prev = p.previousElementSibling;
      const next = p.nextElementSibling;
      if ((prev && (prev.tagName === 'TABLE' || prev.tagName === 'FIGURE')) ||
          (next && (next.tagName === 'TABLE' || next.tagName === 'FIGURE'))) {
        p.remove();
      }
    }
  });

  // 1. <table> → pr-table 클래스 보장
  doc.querySelectorAll('table').forEach(table => {
    if (!table.classList.contains('pr-table')) {
      table.classList.add('pr-table');
    }
    // 작은 표 (pr-table--compact) 판단: th가 4개 이상이면 compact
    const thCount = table.querySelectorAll('th').length;
    if (thCount >= 4 && !table.classList.contains('pr-table--compact')) {
      table.classList.add('pr-table--compact');
    }
  });

  // 2. <figure class="table"> → <div class="pr-table-wrap">로 래핑 복구
  doc.querySelectorAll('figure.table').forEach(figure => {
    const table  = figure.querySelector('table');
    const figcap = figure.querySelector('figcaption');
    if (!table) { figure.remove(); return; }

    const wrap = doc.createElement('div');
    wrap.className = 'pr-table-wrap';

    // figcaption → pr-table-caption 복구
    if (figcap) {
      const cap = doc.createElement('p');
      cap.className   = 'pr-table-caption';
      cap.textContent = figcap.textContent;
      wrap.appendChild(cap);
    } else {
      // figure 바로 앞 p 태그가 캡션이면 wrap 안으로 이동
      const prevEl = figure.previousElementSibling;
      if (prevEl && prevEl.tagName === 'P' && /^\[표/.test(prevEl.textContent.trim())) {
        const cap = doc.createElement('p');
        cap.className   = 'pr-table-caption';
        cap.textContent = prevEl.textContent;
        wrap.appendChild(cap);
        prevEl.remove();
      }
    }

    wrap.appendChild(table);
    figure.parentNode.insertBefore(wrap, figure);
    figure.remove();
  });

  // 3. <td> 안의 <p> 태그 → <ul class="pr-table-list"><li>로 변환
  //    ※ DOMParser의 foster parenting 규칙 때문에 파싱 전 정규식으로 먼저 치환해야 함
  //    (브라우저 HTML5 파서는 <td> 안 <p>를 table 밖으로 꺼내버려 querySelector로 잡히지 않음)
  // → 이 처리는 파싱 전 html 문자열 단계에서 수행 (함수 상단으로 이동)

  // 4. <ul class="pr-list"> 가 없는 ul에 pr-list 부여 (pr-table-list 제외)
  doc.querySelectorAll('ul:not(.pr-list):not(.pr-table-list)').forEach(ul => {
    ul.classList.add('pr-list');
  });

  // 4. h4에 pr-h3 클래스가 없으면 추가 (소제목)
  doc.querySelectorAll('h4:not(.pr-h3)').forEach(h4 => {
    h4.classList.add('pr-h3');
  });

  return doc.body.innerHTML;
}

// ── 편집 모달 (CKEditor 5 + diff 확인 + 되돌리기) ──────────────
function initEditModal() {
  const modal       = document.getElementById('prEditModal');
  const titleEl     = document.getElementById('prEditModalTitle');
  const subtitleEl  = document.getElementById('prEditModalSubtitle');
  const msgEl       = document.getElementById('prEditModalMsg');
  const msgEl2      = document.getElementById('prEditModalMsg2');
  const lastUpdEl   = document.getElementById('prEditLastUpdated');

  // Step 1
  const step1       = document.getElementById('prEditStep1');
  const footer1     = document.getElementById('prEditFooter1');
  const previewBtn  = document.getElementById('prEditPreviewBtn');
  const cancelBtn   = document.getElementById('prEditCancelBtn');

  // Step 2
  const step2       = document.getElementById('prEditStep2');
  const footer2     = document.getElementById('prEditFooter2');
  const saveBtn     = document.getElementById('prEditSaveBtn');
  const backBtn     = document.getElementById('prEditBackBtn');
  const cancelBtn2  = document.getElementById('prEditCancelBtn2');
  const revertWrap  = document.getElementById('prRevertWrap');
  const revertBtn   = document.getElementById('prRevertBtn');
  const diffBefore  = document.getElementById('prDiffBefore');
  const diffAfter   = document.getElementById('prDiffAfter');
  const closeBtn    = document.getElementById('prEditModalClose');

  let currentSecId      = null;
  let currentSecTitle   = null;
  let currentPrevHtml   = '';  // 되돌리기용 직전 HTML
  let currentOrigHtml   = '';  // diff 비교용 편집 시작 시점 HTML
  let ckEditor          = null;

  // ── 섹션 메타데이터 맵 (로드 시 채워짐) ─────────────────────
  window.__procurementMeta = window.__procurementMeta || {};

  // ── CKEditor 초기화 ────────────────────────────────────────
  async function initCKEditor(initialContent) {
    if (ckEditor) {
      ckEditor.setData(initialContent || '');
      return;
    }

    const {
      ClassicEditor,
      Bold, Italic, Underline, Strikethrough,
      Heading,
      List, ListProperties,
      BlockQuote,
      Table, TableToolbar, TableProperties, TableCellProperties,
      HorizontalLine,
      Indent, IndentBlock,
      Undo,
      FontColor, FontBackgroundColor,
      RemoveFormat,
      SourceEditing,
      Essentials, Paragraph,
      Link,
      Style,
      GeneralHtmlSupport,
      Alignment
    } = await import(CKEDITOR_PATH);

    // procurement.css 경로
    const cssUrl = `${CONFIG.SITE_BASE_URL}/assets/css/pages/procurement.css`;

    ckEditor = await ClassicEditor.create(
      document.getElementById('prEditorArea'),
      {
        plugins: [
          Essentials, Paragraph,
          Bold, Italic, Underline, Strikethrough,
          Heading,
          List, ListProperties,
          BlockQuote,
          Table, TableToolbar, TableProperties, TableCellProperties,
          HorizontalLine,
          Indent, IndentBlock,
          Undo,
          FontColor, FontBackgroundColor,
          RemoveFormat,
          SourceEditing,
          Link,
          Style,
          GeneralHtmlSupport,
          Alignment
        ],
        toolbar: {
          items: [
            'heading', 'style', '|',
            'bold', 'italic', 'underline', 'strikethrough', '|',
            'fontColor', 'fontBackgroundColor', '|',
            'bulletedList', 'numberedList', '|',
            'alignment', '|',
            'outdent', 'indent', '|',
            'blockQuote', 'insertTable', 'horizontalLine', 'link', '|',
            'removeFormat', '|',
            'undo', 'redo', '|',
            'sourceEditing'
          ],
          shouldNotGroupWhenFull: false
        },
        heading: {
          options: [
            { model: 'paragraph', title: '본문',        class: 'ck-heading_paragraph' },
            { model: 'heading3',  view: 'h3', title: '제목 (H3)',    class: 'ck-heading_heading3' },
            { model: 'heading4',  view: 'h4', title: '소제목 (H4)',  class: 'ck-heading_heading4' }
          ]
        },
        // ── 커스텀 스타일 드롭다운 ──────────────────────────────
        style: {
          definitions: [
            // 소제목 박스 (pr-h3)
            {
              name: '소제목 박스',
              element: 'h4',
              classes: ['pr-h3']
            },
            // 콜아웃 - 안내 (파란색)
            {
              name: '콜아웃 - 안내 (파랑)',
              element: 'div',
              classes: ['pr-callout', 'pr-callout--info']
            },
            // 콜아웃 - 주의 (노란색)
            {
              name: '콜아웃 - 주의 (노랑)',
              element: 'div',
              classes: ['pr-callout', 'pr-callout--warning']
            },
            // 콜아웃 - 위험 (빨간색)
            {
              name: '콜아웃 - 위험 (빨강)',
              element: 'div',
              classes: ['pr-callout', 'pr-callout--danger']
            },
            // 정의 그리드 항목
            {
              name: '정의 항목',
              element: 'div',
              classes: ['pr-def-item']
            }
          ]
        },
        // ── GHS: pr-* 클래스를 편집기에서 보존 ─────────────────
        htmlSupport: {
          allow: [
            {
              name: /.*/,
              attributes: true,
              classes: true,
              styles: true
            }
          ]
        },
        table: {
          contentToolbar: [
            'tableColumn', 'tableRow', 'mergeTableCells',
            'tableProperties', 'tableCellProperties'
          ],
          defaultHeadings: { rows: 0, columns: 0 }
        },
        // 테이블 컬럼 리사이즈 비활성화 → 항상 100% 너비 유지
        tableColumnResize: {
          useResizingColumnsWidth: false
        },
        // 정렬: 표 셀 안에서는 tableCellProperties 사용, 일반 텍스트만 alignment 적용
        alignment: {
          options: ['left', 'center', 'right', 'justify']
        },
        // ── 편집 영역에 procurement.css 주입 ───────────────────
        // CKEditor iframe 없이 shadow DOM 방식이므로 contentsCss 대신
        // editorReady 후 직접 주입
        initialData: initialContent || ''
      }
    );

    // 편집 영역에 procurement.css 스타일 주입
    injectEditorStyles(ckEditor, cssUrl);
  }

  // CKEditor 편집 영역에 외부 CSS 주입
  function injectEditorStyles(editor, cssUrl) {
    try {
      const editable = editor.ui.view.editable.element;
      if (!editable) return;

      // 이미 주입됐으면 스킵
      if (editable.closest('.ck-editor')?.querySelector('.pr-editor-injected-css')) return;

      const link = document.createElement('link');
      link.rel  = 'stylesheet';
      link.href = cssUrl;
      link.className = 'pr-editor-injected-css';

      // CKEditor 편집 영역의 부모에 삽입
      const ckRoot = editable.closest('.ck-editor__main') || editable.parentElement;
      if (ckRoot) ckRoot.appendChild(link);

      // editable 자체에 pr-content 클래스 추가 (CSS 셀렉터 매칭용)
      editable.classList.add('pr-editor-preview');
    } catch(e) {
      console.warn('CSS 주입 실패:', e);
    }
  }

  // ── 섹션 현재 콘텐츠 추출 ─────────────────────────────────
  function getSectionContent(secId) {
    const el = document.getElementById(secId);
    if (!el) return '';

    // 대섹션 intro (-intro 접미사)
    if (secId.endsWith('-intro')) {
      const contentDiv = el.querySelector('.pr-section-intro-content');
      return contentDiv ? unwrapTableWraps(contentDiv.innerHTML) : '';
    }

    // 소섹션
    const contentDiv = el.querySelector('.pr-subsection-content');
    if (contentDiv) return unwrapTableWraps(contentDiv.innerHTML);
    let html = '';
    el.childNodes.forEach(node => {
      if (node.nodeType !== 1) return;
      if (node.classList.contains('pr-subsection-header')) return;
      if (node.classList.contains('pr-section-updated-info')) return;
      html += node.outerHTML || '';
    });
    return unwrapTableWraps(html);
  }

  // CKEditor에 넘기기 전 pr-table-wrap 래퍼 제거 (table만 남김)
  // → CKEditor가 figure.table로 변환하고, 저장 시 다시 pr-table-wrap으로 복구
  function unwrapTableWraps(html) {
    const parser = new DOMParser();
    const doc    = parser.parseFromString(html, 'text/html');

    // 최상위 pr-table-wrap만 처리 (중첩 wrap은 건드리지 않음)
    // — 안쪽에 있는 wrap은 부모 wrap이 처리될 때 함께 사라지므로 중복 처리 방지
    const allWraps = Array.from(doc.querySelectorAll('.pr-table-wrap'));
    const topWraps = allWraps.filter(wrap => !wrap.closest('.pr-table-wrap')?.isSameNode(wrap) && !wrap.parentElement?.closest('.pr-table-wrap'));

    topWraps.forEach(wrap => {
      const table   = wrap.querySelector('table');
      const caption = wrap.querySelector('.pr-table-caption');
      if (!table) return;

      // caption이 있으면 p태그로 table 앞에 삽입
      if (caption) {
        const p = doc.createElement('p');
        p.textContent = caption.textContent;
        wrap.parentNode.insertBefore(p, wrap);
      }
      // table을 wrap 위치로 올리기
      wrap.parentNode.insertBefore(table, wrap);
      wrap.remove();
    });

    return doc.body.innerHTML;
  }

  // ── 편집 버튼 클릭 ────────────────────────────────────────
  document.querySelectorAll('.pr-edit-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      currentSecId    = btn.dataset.secId;
      currentSecTitle = btn.dataset.secTitle;
      currentOrigHtml = getSectionContent(currentSecId);

      // 직전 버전 확인 (로드 시 캐싱된 메타에서)
      const meta       = window.__procurementMeta[currentSecId] || {};
      currentPrevHtml  = meta.previous_html || '';

      titleEl.textContent    = '섹션 편집';
      subtitleEl.textContent = currentSecTitle;
      lastUpdEl.textContent  = meta.updated_at
        ? `최종 수정: ${meta.updated_at.substring(0, 16)} · ${meta.updated_by || ''}`
        : '';

      showStep(1);
      openModal();

      try {
        await initCKEditor(currentOrigHtml);
      } catch (err) {
        console.error('CKEditor 초기화 실패:', err);
        showMsg(msgEl, '편집기 초기화에 실패했습니다.', 'error');
      }
    });
  });

  // ── Step1 → Step2: 변경 내용 확인 ────────────────────────
  previewBtn?.addEventListener('click', () => {
    if (!ckEditor) return;
    const newHtml = ckEditor.getData().trim();
    if (!newHtml) {
      showMsg(msgEl, '내용을 입력해 주세요.', 'error');
      return;
    }

    // diff 패널 채우기
    diffBefore.innerHTML = restoreHtmlClasses(currentOrigHtml || '') || '<em style="color:#999">내용 없음</em>';
    diffAfter.innerHTML  = restoreHtmlClasses(newHtml);

    // 되돌리기 버튼: 직전 버전이 있을 때만 노출
    revertWrap.style.display = currentPrevHtml ? 'inline-flex' : 'none';

    msgEl.style.display = 'none';
    showStep(2);
  });

  // ── Step2 → Step1: 다시 편집 ─────────────────────────────
  backBtn?.addEventListener('click', () => showStep(1));

  // ── 저장 확정 ─────────────────────────────────────────────
  saveBtn?.addEventListener('click', async () => {
    if (!currentSecId || !ckEditor) return;
    const rawHtml     = ckEditor.getData().trim();
    const contentHtml = restoreHtmlClasses(rawHtml);
    if (!contentHtml) return;

    const user = window.auth?.getSession?.();
    if (!user?.email) { showMsg(msgEl2, '로그인 세션이 만료되었습니다.', 'error'); return; }

    saveBtn.disabled    = true;
    saveBtn.textContent = '저장 중...';
    msgEl2.style.display = 'none';
    setModalLoading(true, '저장 중...');

    try {
      const result = await apiPost('updateProcurementSection', {
        request_user_email: user.email,
        sec_id:       currentSecId,
        title:        currentSecTitle,
        content_html: contentHtml
      });

      if (!result?.success) throw new Error(result?.message || '저장에 실패했습니다.');

      // DOM 반영
      applyContentToDOM(currentSecId, contentHtml, result.data?.updated_at, user.email);

      // 메타 캐시 갱신
      window.__procurementMeta[currentSecId] = {
        previous_html: currentOrigHtml,
        previous_at:   window.__procurementMeta[currentSecId]?.updated_at || '',
        previous_by:   window.__procurementMeta[currentSecId]?.updated_by || '',
        updated_at:    result.data?.updated_at || '',
        updated_by:    user.email
      };

      showMsg(msgEl2, '저장되었습니다.', 'success');
      setTimeout(closeModal, 700);

    } catch (err) {
      showMsg(msgEl2, err.message || '저장에 실패했습니다.', 'error');
    } finally {
      saveBtn.disabled    = false;
      saveBtn.textContent = '저장 확정';
      setModalLoading(false);
    }
  });

  // ── 되돌리기 ──────────────────────────────────────────────
  revertBtn?.addEventListener('click', async () => {
    if (!currentPrevHtml) return;
    if (!confirm('이전 버전으로 되돌리시겠습니까?')) return;

    const user = window.auth?.getSession?.();
    if (!user?.email) { showMsg(msgEl2, '로그인 세션이 만료되었습니다.', 'error'); return; }

    revertBtn.disabled    = true;
    revertBtn.textContent = '되돌리는 중...';
    setModalLoading(true, '이전 버전으로 되돌리는 중...');

    try {
      const result = await apiPost('revertProcurementSection', {
        request_user_email: user.email,
        sec_id: currentSecId
      });

      if (!result?.success) throw new Error(result?.message || '되돌리기에 실패했습니다.');

      applyContentToDOM(currentSecId, result.data?.content_html, result.data?.updated_at, user.email);

      // 메타 캐시 갱신
      window.__procurementMeta[currentSecId] = {
        ...window.__procurementMeta[currentSecId],
        content_html: result.data?.content_html,
        updated_at:   result.data?.updated_at || '',
        updated_by:   user.email
      };

      showMsg(msgEl2, '이전 버전으로 되돌렸습니다.', 'success');
      setTimeout(closeModal, 700);

    } catch (err) {
      showMsg(msgEl2, err.message || '되돌리기에 실패했습니다.', 'error');
    } finally {
      revertBtn.disabled    = false;
      revertBtn.textContent = '↩ 이전 버전으로 되돌리기';
      setModalLoading(false);
    }
  });

  // ── 닫기 ──────────────────────────────────────────────────
  [cancelBtn, cancelBtn2, closeBtn].forEach(el => {
    el?.addEventListener('click', closeModal);
  });
  // 백드롭 클릭으로 닫기 — mousedown 시작이 modal 자체일 때만 닫힘
  // (편집 영역에서 드래그 후 백드롭에서 마우스를 떼는 경우 방지)
  let mousedownOnBackdrop = false;
  modal?.addEventListener('mousedown', e => {
    mousedownOnBackdrop = e.target === modal;
  });
  modal?.addEventListener('click', e => {
    if (e.target === modal && mousedownOnBackdrop) closeModal();
    mousedownOnBackdrop = false;
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modal?.style.display !== 'none') closeModal();
  });

  // ── 헬퍼 ──────────────────────────────────────────────────
  function showStep(n) {
    step1.style.display  = n === 1 ? '' : 'none';
    footer1.style.display = n === 1 ? '' : 'none';
    step2.style.display  = n === 2 ? '' : 'none';
    footer2.style.display = n === 2 ? '' : 'none';
    msgEl.style.display  = 'none';
    msgEl2.style.display = 'none';
  }

  function openModal() {
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    modal.style.display = 'none';
    document.body.style.overflow = '';
    currentSecId    = null;
    currentSecTitle = null;
    currentOrigHtml = '';
    currentPrevHtml = '';
    showStep(1);
    if (ckEditor) ckEditor.setData('');
  }

  function applyContentToDOM(secId, html, updatedAt, updatedBy) {
    const el = document.getElementById(secId);
    if (!el) return;

    // 대섹션 intro
    if (secId.endsWith('-intro')) {
      const contentDiv = el.querySelector('.pr-section-intro-content');
      if (contentDiv) contentDiv.innerHTML = restoreHtmlClasses(html || '');

      let infoEl = el.querySelector('.pr-section-updated-info');
      if (!infoEl) {
        infoEl = document.createElement('p');
        infoEl.className = 'pr-section-updated-info';
        el.appendChild(infoEl);
      }
      infoEl.textContent = `최종 수정: ${(updatedAt || '').substring(0, 16)} · ${updatedBy || ''}`;
      return;
    }

    // 소섹션
    let contentDiv = el.querySelector('.pr-subsection-content');
    if (!contentDiv) {
      contentDiv = document.createElement('div');
      contentDiv.className = 'pr-subsection-content';
      el.appendChild(contentDiv);
    }
    contentDiv.innerHTML = restoreHtmlClasses(html || '');

    let infoEl = el.querySelector('.pr-section-updated-info');
    if (!infoEl) {
      infoEl = document.createElement('p');
      infoEl.className = 'pr-section-updated-info';
      el.appendChild(infoEl);
    }
    infoEl.textContent = `최종 수정: ${(updatedAt || '').substring(0, 16)} · ${updatedBy || ''}`;
  }

  function showMsg(el, text, type) {
    if (!el) return;
    el.textContent   = text;
    el.className     = 'pr-modal-msg pr-modal-msg--' + type;
    el.style.display = 'block';
  }

  // ── 모달 로딩 오버레이 ────────────────────────────────────
  function setModalLoading(on, message) {
    const modalBox = modal.querySelector('.pr-modal');
    let overlay = modalBox ? modalBox.querySelector('.pr-modal-loading') : modal.querySelector('.pr-modal-loading');

    if (on) {
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'pr-modal-loading';
        overlay.innerHTML = `
          <div class="pr-modal-loading-inner">
            <div class="pr-modal-spinner"></div>
            <span class="pr-modal-loading-text"></span>
          </div>`;
        (modalBox || modal).appendChild(overlay);
      }
      overlay.querySelector('.pr-modal-loading-text').textContent = message || '처리 중...';
      overlay.style.display = 'flex';
      // 푸터 버튼 전체 비활성화
      modal.querySelectorAll('.pr-modal-footer button').forEach(b => { b.disabled = true; });
    } else {
      if (overlay) overlay.style.display = 'none';
      // 푸터 버튼 활성화 복구 (개별 버튼 disabled는 각자 처리)
      modal.querySelectorAll('.pr-modal-footer button').forEach(b => { b.disabled = false; });
    }
  }
}


// ── PDF 다운로드 ──────────────────────────────────────────────
function initPdfDownload() {
  const btn = document.getElementById('prPdfDownload');
  if (!btn) return;

  btn.addEventListener('click', () => {
    // 표지 생성
    const cover = buildCoverPage();
    // 목차 생성
    const toc = buildTocPage();
    // 인쇄용 헤더
    const header = buildPrintHeader();

    // pr-print-only 클래스로 화면에서 숨긴 채 삽입
    cover.classList.add('pr-print-only');
    toc.classList.add('pr-print-only');
    header.classList.add('pr-print-only');

    const content = document.querySelector('.pr-content');
    content.insertBefore(header, content.firstChild);
    content.insertBefore(toc,    content.firstChild);

    // cover는 pr-content 밖, pr-layout 앞에 삽입 (absolute 위치 기준 격리)
    const prLayout = document.querySelector('.pr-layout');
    prLayout.parentNode.insertBefore(cover, prLayout);

    // 이미지 로드 완료 후 인쇄 (로고 출력 보장)
    const imgs = cover.querySelectorAll('img');
    const imgLoadPromises = Array.from(imgs).map(img => {
      if (img.complete) return Promise.resolve();
      return new Promise(resolve => {
        img.onload  = resolve;
        img.onerror = resolve;
      });
    });

    Promise.all(imgLoadPromises).then(() => {
      // 인쇄 전 — 비인쇄 요소 전부 DOM에서 제거 (CSS display:none만으로 불충분한 경우 대비)
      const removeTargets = [
        document.getElementById('globalLoading'),
        document.getElementById('prBackToTop'),
        document.getElementById('prEditModal'),
        document.querySelector('.pr-modal-backdrop'),
        document.getElementById('prSkeletonWrap'),
      ].filter(Boolean);

      const removed = removeTargets.map(el => ({
        el,
        parent: el.parentNode,
        next:   el.nextSibling
      }));
      removed.forEach(({ el }) => el.remove());

      // rAF 2회로 렌더링 반영 후 print
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          window.print();
          cover.remove();
          toc.remove();
          header.remove();
          removed.forEach(({ el, parent, next }) => {
            if (parent) parent.insertBefore(el, next);
          });
        });
      });
    });
  });
}

function buildCoverPage() {
  const today = new Date();
  const ver   = document.querySelector('.pr-badge--green')?.textContent || 'Ver 6.0';
  const date  = document.querySelector('.pr-badge--blue')?.textContent  || '2023.07.01 시행';

  const div = document.createElement('div');
  div.className = 'pr-cover';
  div.innerHTML = `
    <div class="pr-cover-top">
      <span class="pr-cover-top-text">GC PROCUREMENT REGULATION</span>
    </div>
    <div class="pr-cover-body">
      <div class="pr-cover-label">Green Book</div>
      <div class="pr-cover-title">구매규정</div>
      <div class="pr-cover-subtitle">GC녹십자아이메드</div>
      <div class="pr-cover-divider"></div>
      <div class="pr-cover-meta">
        <div class="pr-cover-meta-row">
          <span class="pr-cover-meta-label">버전</span>
          <span>${ver}</span>
        </div>
        <div class="pr-cover-meta-row">
          <span class="pr-cover-meta-label">시행일</span>
          <span>${date.replace(' 시행','')}</span>
        </div>
        <div class="pr-cover-meta-row">
          <span class="pr-cover-meta-label">출력일</span>
          <span>${today.getFullYear()}.${String(today.getMonth()+1).padStart(2,'0')}.${String(today.getDate()).padStart(2,'0')}</span>
        </div>
      </div>
    </div>
    <div class="pr-cover-spacer"></div>
    <div class="pr-cover-bottom">
      <span class="pr-cover-company">GC녹십자아이메드 MSO관리팀</span>
      <span class="pr-cover-gc-logo"><img src="data:image/png;base64,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" alt="GC녹십자아이메드 로고" /></span>
    </div>
  `;
  return div;
}

function buildTocPage() {
  const div = document.createElement('div');
  div.className = 'pr-print-toc';

  let html = '<div class="pr-print-toc-title">CONTENTS</div>';

  // 대섹션과 소섹션 순회 (편집 버튼 텍스트 제외)
  document.querySelectorAll('.pr-section').forEach(section => {
    const h1 = section.querySelector('.pr-h1');
    if (!h1) return;

    // 편집 버튼 제외한 순수 제목 텍스트만 추출
    const h1Clone = h1.cloneNode(true);
    h1Clone.querySelectorAll('.pr-edit-btn, .pr-edit-btn--section, button').forEach(el => el.remove());
    const h1Text = h1Clone.textContent.trim();

    html += `
      <div class="pr-toc-entry pr-toc-entry--h1">
        <span>${h1Text}</span>
        <span class="pr-toc-entry-dots"></span>
      </div>`;

    section.querySelectorAll('.pr-subsection').forEach(sub => {
      const header = sub.querySelector('.pr-subsection-header');
      const h2 = sub.querySelector('.pr-h2');
      if (!h2) return;
      const h2Clone = h2.cloneNode(true);
      h2Clone.querySelectorAll('button').forEach(el => el.remove());
      const h2Text = h2Clone.textContent.trim();
      html += `
        <div class="pr-toc-entry" style="padding-left:4mm;">
          <span>${h2Text}</span>
          <span class="pr-toc-entry-dots"></span>
        </div>`;
    });
  });

  div.innerHTML = html;
  return div;
}

function buildPrintHeader() {
  const div = document.createElement('div');
  div.className = 'pr-print-page-header';
  div.innerHTML = `
    <span>GC녹십자아이메드 구매규정</span>
    <span>Green Book</span>
  `;
  return div;
}

window.addEventListener('pageshow', e => {
  if (e.persisted) { try { hideGlobalLoading(); } catch(e) {} }
});

// ── 버전관리 (배포 / 히스토리 / 복원) ────────────────────────
function initVersionManagement() {
  const deployBtn        = document.getElementById('prDeployBtn');
  const historyBtn       = document.getElementById('prVersionHistoryBtn');

  // ── 배포 모달 요소 ──────────────────────────────────────────
  const deployModal      = document.getElementById('prDeployModal');
  const deployClose      = document.getElementById('prDeployModalClose');
  const deployCancel     = document.getElementById('prDeployCancelBtn');
  const deployConfirm    = document.getElementById('prDeployConfirmBtn');
  const deployMsg        = document.getElementById('prDeployModalMsg');
  const deployLabel      = document.getElementById('prDeployVersionLabel');
  const deployEffDate    = document.getElementById('prDeployEffectiveDate');
  const deployMemo       = document.getElementById('prDeployMemo');

  // ── 버전 히스토리 모달 요소 ────────────────────────────────
  const versionModal     = document.getElementById('prVersionModal');
  const versionClose     = document.getElementById('prVersionModalClose');
  const versionCloseBtn  = document.getElementById('prVersionModalCloseBtn');
  const versionListView  = document.getElementById('prVersionListView');
  const versionDetailView= document.getElementById('prVersionDetailView');
  const versionListWrap  = document.getElementById('prVersionListWrap');
  const versionListMsg   = document.getElementById('prVersionListMsg');
  const versionPager     = document.getElementById('prVersionPager');
  const versionDetailMeta= document.getElementById('prVersionDetailMeta');
  const versionDetailContent = document.getElementById('prVersionDetailContent');
  const versionDetailMsg = document.getElementById('prVersionDetailMsg');
  const versionRestoreBtn= document.getElementById('prVersionRestoreBtn');
  const versionBackBtn   = document.getElementById('prVersionBackBtn');
  const versionDetailClose = document.getElementById('prVersionDetailCloseBtn');

  let currentHistoryId   = null;
  let currentVersionLabel= null;
  let versionList        = [];   // 전체 목록 캐시
  let versionPage        = 1;    // 현재 페이지
  const VERSION_PAGE_SIZE = 10;

  // ── 배포 모달 열기 ─────────────────────────────────────────
  deployBtn?.addEventListener('click', async () => {
    const curVer = document.querySelector('.pr-badge--green')?.textContent?.trim() || '';

    // 스피너 먼저 표시
    showGlobalLoading('배포 준비 중...');

    // 배포 이력이 있으면 다음 버전 제안, 없으면 현재 버전 그대로
    let suggestedLabel = curVer;
    try {
      const user = window.auth?.getSession?.();
      const listResult = await apiGet('getProcurementVersionList', {
        request_user_email: user?.email || ''
      });
      const hasHistory = listResult?.success && (listResult.data || []).length > 0;
      if (hasHistory) suggestedLabel = suggestNextVersion(curVer) || curVer;
    } catch (e) { /* 실패 시 현재 버전 유지 */ } finally {
      hideGlobalLoading();
    }

    deployLabel.value = suggestedLabel;
    // 시행일 기본값 — 현재 배지 날짜 파싱, 없으면 오늘
    const curDateText = document.querySelector('.pr-badge--blue')?.textContent?.trim() || '';
    deployEffDate.value = parseBadgeDateToInput(curDateText) || new Date().toISOString().slice(0, 10);
    deployMemo.value  = '';
    showMsg(deployMsg, '', '');
    deployModal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    setTimeout(() => deployLabel.focus(), 50);
  });

  // ── 배포 모달 닫기 ─────────────────────────────────────────
  function closeDeployModal() {
    deployModal.style.display = 'none';
    document.body.style.overflow = '';
  }
  deployClose?.addEventListener('click', closeDeployModal);
  deployCancel?.addEventListener('click', closeDeployModal);
  deployModal?.addEventListener('click', e => { if (e.target === deployModal) closeDeployModal(); });

  // ── 배포 확정 ──────────────────────────────────────────────
  deployConfirm?.addEventListener('click', async () => {
    const label   = deployLabel.value.trim();
    const effDate = deployEffDate.value.trim();
    const memo    = deployMemo.value.trim();

    if (!label) {
      showMsg(deployMsg, '버전명을 입력해 주세요.', 'error');
      deployLabel.focus();
      return;
    }
    if (!effDate) {
      showMsg(deployMsg, '시행일을 입력해 주세요.', 'error');
      deployEffDate.focus();
      return;
    }

    // 이미 배포된 버전명과 중복 체크 (이력이 있을 때만)
    try {
      const listResult = await apiGet('getProcurementVersionList', {
        request_user_email: user.email
      });
      const deployed = (listResult?.data || []).map(v => v.version_label);
      if (deployed.includes(label)) {
        showMsg(deployMsg, `이미 배포된 버전명입니다. 다른 버전명을 입력해 주세요. (${label})`, 'error');
        deployLabel.focus();
        deployLabel.select();
        return;
      }
    } catch (e) { /* 중복 체크 실패 시 통과 */ }

    const user = window.auth?.getSession?.();
    if (!user?.email) { showMsg(deployMsg, '로그인 세션이 만료되었습니다.', 'error'); return; }

    deployConfirm.disabled    = true;
    deployConfirm.textContent = '배포 중...';
    showMsg(deployMsg, '', '');

    try {
      showGlobalLoading('배포 중...');
      const result = await apiPost('deployProcurementVersion', {
        request_user_email: user.email,
        version_label:      label,
        effective_date:     effDate,
        memo:               memo
      });

      if (!result?.success) throw new Error(result?.message || '배포에 실패했습니다.');

      // 버전 배지 업데이트
      const greenBadge = document.querySelector('.pr-badge--green');
      if (greenBadge) greenBadge.textContent = label;
      // 시행일 배지 업데이트
      const blueBadge = document.querySelector('.pr-badge--blue');
      if (blueBadge) blueBadge.textContent = formatEffectiveDateBadge(effDate);

      showMsg(deployMsg, `"${label}" 버전으로 배포되었습니다.`, 'success');
      setTimeout(closeDeployModal, 1000);

    } catch (err) {
      showMsg(deployMsg, err.message || '배포에 실패했습니다.', 'error');
    } finally {
      deployConfirm.disabled    = false;
      deployConfirm.textContent = '🚀 배포 확정';
      hideGlobalLoading();
    }
  });

  // ── 버전 히스토리 모달 열기 ────────────────────────────────
  historyBtn?.addEventListener('click', async () => {
    showListView();
    versionModal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    await loadVersionList();
  });

  // ── 버전 히스토리 모달 닫기 ────────────────────────────────
  function closeVersionModal() {
    versionModal.style.display = 'none';
    document.body.style.overflow = '';
    currentHistoryId    = null;
    currentVersionLabel = null;
  }
  versionClose?.addEventListener('click', closeVersionModal);
  versionCloseBtn?.addEventListener('click', closeVersionModal);
  versionDetailClose?.addEventListener('click', closeVersionModal);
  versionModal?.addEventListener('click', e => { if (e.target === versionModal) closeVersionModal(); });

  // ── 목록 뷰 / 상세 뷰 전환 ────────────────────────────────
  function showListView() {
    versionListView.style.display   = '';
    versionDetailView.style.display = 'none';
  }
  function showDetailView() {
    versionListView.style.display   = 'none';
    versionDetailView.style.display = '';
  }

  versionBackBtn?.addEventListener('click', showListView);

  // ── 버전 목록 로드 ─────────────────────────────────────────
  async function loadVersionList() {
    versionListWrap.style.display = 'block';
    versionListWrap.innerHTML = `
      <div class="pr-version-loading">
        <div class="pr-version-spinner"></div>
        <span>목록 불러오는 중...</span>
      </div>`;
    versionPager.style.display = 'none';
    showMsg(versionListMsg, '', '');

    const user = window.auth?.getSession?.();
    if (!user?.email) {
      showMsg(versionListMsg, '로그인 세션이 만료되었습니다.', 'error');
      return;
    }

    try {
      const result = await apiGet('getProcurementVersionList', {
        request_user_email: user.email
      });

      if (!result?.success) throw new Error(result?.message || '목록을 불러오지 못했습니다.');

      versionList = result.data || [];
      versionPage = 1;

      if (versionList.length === 0) {
        versionListWrap.style.display = 'block';
        versionListWrap.innerHTML = '<div class="pr-version-empty">배포된 버전이 없습니다.</div>';
        return;
      }

      renderVersionPage();

    } catch (err) {
      showMsg(versionListMsg, err.message || '목록을 불러오지 못했습니다.', 'error');
      versionListWrap.innerHTML = '';
    }
  }

  function renderVersionPage() {
    versionListWrap.style.display = 'table';
    const totalPages = Math.ceil(versionList.length / VERSION_PAGE_SIZE);
    const start      = (versionPage - 1) * VERSION_PAGE_SIZE;
    const pageItems  = versionList.slice(start, start + VERSION_PAGE_SIZE);

    // 진짜 <table>로 렌더링
    const tableRows = pageItems.map((v) => {
      const isLatest = versionList.indexOf(v) === 0;
      return `
        <tr class="pr-version-item" data-history-id="${escHtml(v.history_id)}">
          <td class="pr-vtd pr-vtd--center">
            <span class="pr-version-badge ${isLatest ? 'pr-version-badge--latest' : ''}">${escHtml(v.version_label)}</span>
          </td>
          <td class="pr-vtd">
            ${v.memo ? escHtml(v.memo) : '<span class="pr-version-no-memo">-</span>'}
          </td>
          <td class="pr-vtd pr-vtd--center pr-vtd--sm">
            ${v.effective_date ? escHtml(formatDateKo(v.effective_date)) : '<span class="pr-version-no-memo">-</span>'}
          </td>
          <td class="pr-vtd pr-vtd--center pr-vtd--sm">
            ${escHtml(formatDateTimeKo(v.snapshot_at || ''))}
          </td>
          <td class="pr-vtd pr-vtd--center pr-vtd--sm">
            ${escHtml(v.created_by_name || v.created_by || '-')}
          </td>
          <td class="pr-vtd pr-vtd--center">
            <button class="pr-version-view-btn" data-history-id="${escHtml(v.history_id)}" data-version-label="${escHtml(v.version_label)}">상세 보기</button>
          </td>
        </tr>`;
    }).join('');

    versionListWrap.innerHTML = `
      <table class="pr-version-table">
        <colgroup>
          <col style="width:70px">
          <col style="width:auto">
          <col style="width:90px">
          <col style="width:140px">
          <col style="width:60px">
          <col style="width:70px">
        </colgroup>
        <thead>
          <tr>
            <th class="pr-vth pr-vth--center">버전</th>
            <th class="pr-vth pr-vth--left">변경 사유</th>
            <th class="pr-vth pr-vth--center">시행일</th>
            <th class="pr-vth pr-vth--center">배포일시</th>
            <th class="pr-vth pr-vth--center">배포자</th>
            <th class="pr-vth"></th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>`;

    // 상세 보기 버튼 이벤트
    versionListWrap.querySelectorAll('.pr-version-view-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        currentHistoryId    = btn.dataset.historyId;
        currentVersionLabel = btn.dataset.versionLabel;
        await loadVersionDetail(currentHistoryId, currentVersionLabel);
      });
    });

    // 페이저 렌더링
    if (totalPages <= 1) {
      versionPager.style.display = 'none';
      return;
    }

    versionPager.style.display = 'flex';
    versionPager.innerHTML = `
      <button class="pr-pager-btn" data-page="${versionPage - 1}" ${versionPage === 1 ? 'disabled' : ''}>‹</button>
      ${Array.from({ length: totalPages }, (_, i) => i + 1).map(p => `
        <button class="pr-pager-btn ${p === versionPage ? 'is-active' : ''}" data-page="${p}">${p}</button>
      `).join('')}
      <button class="pr-pager-btn" data-page="${versionPage + 1}" ${versionPage === totalPages ? 'disabled' : ''}>›</button>
    `;

    versionPager.querySelectorAll('.pr-pager-btn:not([disabled])').forEach(btn => {
      btn.addEventListener('click', () => {
        versionPage = Number(btn.dataset.page);
        renderVersionPage();
        versionListWrap.scrollTop = 0;
      });
    });
  }

  // ── 버전 상세 로드 ─────────────────────────────────────────
  async function loadVersionDetail(historyId, versionLabel) {
    showDetailView();
    versionDetailMeta.innerHTML    = '';
    versionDetailContent.innerHTML = `
      <div class="pr-version-loading">
        <div class="pr-version-spinner"></div>
        <span>내용 불러오는 중...</span>
      </div>`;
    showMsg(versionDetailMsg, '', '');
    // DOM이 실제로 보이는 상태에서 렌더링되도록 한 프레임 대기
    await new Promise(r => requestAnimationFrame(r));

    const user = window.auth?.getSession?.();
    if (!user?.email) {
      showMsg(versionDetailMsg, '로그인 세션이 만료되었습니다.', 'error');
      return;
    }

    try {
      const result = await apiGet('getProcurementVersion', {
        request_user_email: user.email,
        history_id:         historyId
      });

      if (!result?.success) throw new Error(result?.message || '버전 내용을 불러오지 못했습니다.');

      const v = result.data;

      // 메타 정보
      versionDetailMeta.innerHTML = `
        <div class="pr-version-detail-info">
          <span class="pr-version-badge pr-version-badge--detail">${escHtml(v.version_label)}</span>
          ${v.effective_date ? `<span class="pr-version-detail-effdate">시행일: ${escHtml(formatDateKo(v.effective_date))}</span>` : ''}
          <span class="pr-version-detail-date">배포일: ${escHtml(formatDateTimeKo(v.snapshot_at || ''))}</span>
          <span class="pr-version-detail-by">배포자: ${escHtml(v.created_by_name || v.created_by || '-')}</span>
          ${v.memo ? `<span class="pr-version-detail-memo">${escHtml(v.memo)}</span>` : ''}
        </div>
      `;

      // 섹션 내용 렌더링
      const sections = v.sections || [];
      if (sections.length === 0) {
        versionDetailContent.innerHTML = '<div class="pr-version-empty">섹션 내용이 없습니다.</div>';
        return;
      }

      // 자동백업 버전이면 복원 버튼 숨기기
      const isAutoBackup = v.version_label.startsWith('[복원 전 자동백업]');
      versionRestoreBtn.style.display = isAutoBackup ? 'none' : '';

      versionDetailContent.innerHTML = sections.map((s) => `
        <div class="pr-version-acc-item">
          <div class="pr-version-acc-header" role="button" tabindex="0">
            <span class="pr-version-acc-title">${escHtml(s.title || s.sec_id)}</span>
            <span class="pr-version-acc-icon">▾</span>
          </div>
          <div class="pr-version-acc-body" style="display:none;">
            <div class="pr-version-acc-content pr-content">${s.content_html || '<em style="color:#94a3b8;">내용 없음</em>'}</div>
          </div>
        </div>
      `).join('');

      // 아코디언 토글 — nextElementSibling으로 body 참조 (id 불필요)
      versionDetailContent.querySelectorAll('.pr-version-acc-header').forEach(header => {
        header.addEventListener('click', () => {
          const body   = header.nextElementSibling;
          const icon   = header.querySelector('.pr-version-acc-icon');
          const isOpen = body.style.display !== 'none';
          body.style.display = isOpen ? 'none' : '';
          icon.textContent   = isOpen ? '▾' : '▴';
          header.classList.toggle('is-open', !isOpen);
        });
      });

      // 첫 섹션 기본 열기
      const firstHeader = versionDetailContent.querySelector('.pr-version-acc-header');
      if (firstHeader) {
        const firstBody = firstHeader.nextElementSibling;
        const firstIcon = firstHeader.querySelector('.pr-version-acc-icon');
        if (firstBody) firstBody.style.display = '';
        if (firstIcon) firstIcon.textContent = '▴';
        firstHeader.classList.add('is-open');
      }

    } catch (err) {
      showMsg(versionDetailMsg, err.message || '내용을 불러오지 못했습니다.', 'error');
      versionDetailContent.innerHTML = '';
    }
  }

  // ── 버전 복원 ──────────────────────────────────────────────
  versionRestoreBtn?.addEventListener('click', async () => {
    if (!currentHistoryId) return;
    if (!confirm(`"${currentVersionLabel}" 버전으로 전체 규정을 복원하시겠습니까?\n현재 상태는 자동으로 백업됩니다.`)) return;

    const user = window.auth?.getSession?.();
    if (!user?.email) { showMsg(versionDetailMsg, '로그인 세션이 만료되었습니다.', 'error'); return; }

    versionRestoreBtn.disabled    = true;
    versionRestoreBtn.textContent = '복원 중...';
    showMsg(versionDetailMsg, '', '');

    try {
      showGlobalLoading('복원 중...');
      const result = await apiPost('restoreProcurementVersion', {
        request_user_email: user.email,
        history_id:         currentHistoryId
      });

      if (!result?.success) throw new Error(result?.message || '복원에 실패했습니다.');

      // 버전 배지 업데이트
      const badge = document.querySelector('.pr-badge--green');
      if (badge) badge.textContent = currentVersionLabel;

      // 섹션 DOM 재로드
      showGlobalLoading('규정 다시 불러오는 중...');
      await loadSections();

      showMsg(versionDetailMsg, `"${currentVersionLabel}" 버전으로 복원되었습니다.`, 'success');
      setTimeout(closeVersionModal, 1200);

    } catch (err) {
      showMsg(versionDetailMsg, err.message || '복원에 실패했습니다.', 'error');
    } finally {
      versionRestoreBtn.disabled    = false;
      versionRestoreBtn.textContent = '↩ 이 버전으로 복원';
      hideGlobalLoading();
    }
  });

  // ── ESC 닫기 ───────────────────────────────────────────────
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (deployModal?.style.display  !== 'none') closeDeployModal();
    if (versionModal?.style.display !== 'none') closeVersionModal();
  });

  // ── 헬퍼 ──────────────────────────────────────────────────
  function showMsg(el, text, type) {
    if (!el) return;
    if (!text) { el.style.display = 'none'; return; }
    el.textContent   = text;
    el.className     = 'pr-modal-msg pr-modal-msg--' + type;
    el.style.display = 'block';
  }

  function escHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }


  // 다양한 형식 → Date 객체 변환
  // parseToDate — 전역으로 이동

  // 날짜 → "2026년 7월 1일"
  function formatDateKo(dateStr) {
    if (!dateStr) return '-';
    const d = parseToDate(dateStr);
    if (!d) return dateStr;
    return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
  }

  // 날짜시간 → "2026년 6월 5일 10:50"
  function formatDateTimeKo(dtStr) {
    if (!dtStr) return '-';
    // "2026-06-05 10:50:24" 형식 우선 처리
    const m = dtStr.match(/(\d{4})[-.](\d{2})[-.](\d{2})[ T](\d{2}):(\d{2})/);
    if (m) return `${m[1]}년 ${parseInt(m[2])}월 ${parseInt(m[3])}일 ${m[4]}:${m[5]}`;
    // 그 외 형식
    const d = new Date(dtStr);
    if (isNaN(d.getTime())) return dtStr;
    return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  }

  // 버전명에서 다음 버전 자동 제안 (Ver 6.0 → Ver 6.1)
  function suggestNextVersion(current) {
    const m = current.match(/Ver\s+(\d+)\.(\d+)/i);
    if (!m) return '';
    return `Ver ${m[1]}.${parseInt(m[2]) + 1}`;
  }

  // "2026.07.01 시행 (예정)" → "2026-07-01" (input[type=date] 형식)
  function parseBadgeDateToInput(badgeText) {
    const m = badgeText.match(/(\d{4})\.(\d{2})\.(\d{2})/);
    if (!m) return '';
    return `${m[1]}-${m[2]}-${m[3]}`;
  }

  // "2026-07-01" → "2026.07.01 시행"
  function formatEffectiveDateBadge(dateStr) {
    const m = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return dateStr;
    return `${m[1]}.${m[2]}.${m[3]} 시행`;
  }
}
