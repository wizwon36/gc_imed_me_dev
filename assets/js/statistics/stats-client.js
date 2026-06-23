/**
 * stats-client.js
 * Supabase 클라이언트 초기화 + 통계 조회용 쿼리 함수
 *
 * anon key로 SELECT만 수행 (RLS 정책상 쓰기 불가)
 */

'use strict';

// ★ 실제 값으로 교체 필요
const SUPABASE_URL = 'https://llfbjgsuoaaifbfftuuf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxsZmJqZ3N1b2FhaWZiZmZ0dXVmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2NTUxMTcsImV4cCI6MjA5NzIzMTExN30.5btOquOHOopWs502uMZxy0vBUzZ-xSnd22lCc-Yc-m8';

const _supabase = window.supabase
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

if (!_supabase) {
  console.error('Supabase 클라이언트 로드 실패. supabase-js CDN 스크립트가 먼저 로드되어야 합니다.');
}

// ── 공통: 페이지네이션 없이 전체 행 가져오기 (Supabase는 기본 1000행 제한) ──
async function fetchAllRows_(table, buildQuery) {
  const PAGE_SIZE = 1000;
  let from = 0;
  let all = [];

  while (true) {
    let query = buildQuery(_supabase.from(table).select('*'));
    // 페이지네이션 시 안정적인 순서가 없으면 페이지 간 행이 누락/중복될 수 있어, 항상 채워지는 컬럼(ym, uploaded_at) 기준으로 정렬 고정
    query = query.order('ym', { ascending: true }).order('uploaded_at', { ascending: true }).range(from, from + PAGE_SIZE - 1);

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    all = all.concat(data || []);
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return all;
}

// ── 필터 적용 헬퍼 ─────────────────────────────────────────
function applyFilters_(query, filters) {
  const { branch, ymFrom, ymTo, itemType, dept, vendor, vendorBizNo } = filters || {};
  if (branch)      query = query.eq('branch', branch);
  if (ymFrom)      query = query.gte('ym', ymFrom);
  if (ymTo)        query = query.lte('ym', ymTo);
  if (itemType)    query = query.eq('item_type', itemType);
  if (dept)        query = query.eq('dept', dept);
  if (vendorBizNo) query = query.eq('vendor_biz_no', vendorBizNo);
  else if (vendor) query = query.eq('vendor_name', vendor);
  return query;
}

// ── 검색구분 → 실제 컬럼명 매핑 ──────────────────────────────
function searchFieldToColumn_(type) {
  if (type === 'vendor')   return 'vendor_name';
  if (type === 'dept')     return 'dept';
  if (type === 'itemType') return 'item_type';
  if (type === 'itemName') return 'item_name';
  if (type === 'itemCode') return 'item_code';
  return null;
}

/**
 * 거래처 상호 변경 대응(2026-06) — vendor_master에 같은 사업자번호로
 * 여러 이름이 등록된 경우(예: "GC메디아이"/"주식회사 유비케어", 둘 다
 * 201-81-55688), 검색구분=업체명으로 한쪽 이름만 검색하면 다른 이름으로
 * 저장된 과거 거래 데이터가 결과에서 빠지는 문제가 있었다(실측 확인).
 * window.StatsApp.vendors(페이지 로드 시 항상 채워짐, loadVendorsFromServer)
 * 를 사업자번호 기준으로 그룹화해, 검색어가 그 그룹의 어느 이름과든
 * 일치하면 그룹 전체의 이름 집합을 반환한다 — 매칭 안 되면 빈 배열.
 */
function getVendorNameGroupForKeyword_(keyword) {
  const vendors = window.StatsApp?.vendors || [];
  if (!vendors.length || !keyword) return [];

  const kw = keyword.trim().toLowerCase();

  // 사업자번호별로 이름들을 모은다.
  const namesByBizNo = {};
  vendors.forEach(v => {
    if (!v.biz_no) return;
    if (!namesByBizNo[v.biz_no]) namesByBizNo[v.biz_no] = [];
    namesByBizNo[v.biz_no].push(v.vendor_name);
  });

  // 검색어와 부분 일치하는 이름을 가진 사업자번호 그룹을 찾는다.
  for (const bizNo in namesByBizNo) {
    const names = namesByBizNo[bizNo];
    const matched = names.some(n => String(n || '').toLowerCase().includes(kw));
    if (matched && names.length > 1) return names; // 그룹(이름 2개 이상)일 때만 의미가 있음
  }
  return [];
}

// ── 기본 검색(구분+키워드, LIKE) + 상세검색(다중 조건, AND/OR) 클라이언트 필터링 ──
// basicSearch: { type, keyword } | null
// advancedConditions: [{ field, keyword, combinator }]  combinator는 그 조건이 "앞 조건과" 어떻게 결합되는지 (첫 행은 무시)
function applyClientSideSearch_(rows, basicSearch, advancedConditions) {
  let result = rows;

  if (basicSearch && basicSearch.keyword && basicSearch.keyword.trim()) {
    const col = searchFieldToColumn_(basicSearch.type);
    const kw = basicSearch.keyword.trim().toLowerCase();
    if (col) {
      if (basicSearch.type === 'vendor') {
        const groupNames = getVendorNameGroupForKeyword_(basicSearch.keyword);
        if (groupNames.length) {
          const groupNamesLower = groupNames.map(n => String(n).toLowerCase());
          result = result.filter(r => groupNamesLower.includes(String(r[col] || '').toLowerCase()));
        } else {
          result = result.filter(r => String(r[col] || '').toLowerCase().includes(kw));
        }
      } else {
        result = result.filter(r => String(r[col] || '').toLowerCase().includes(kw));
      }
    }
  }

  if (Array.isArray(advancedConditions) && advancedConditions.length) {
    const valid = advancedConditions.filter(c => c.field && c.keyword && c.keyword.trim());
    if (valid.length) {
      result = result.filter(row => {
        // 좌결합: 첫 조건의 결과에서 시작해, 이후 조건을 combinator(AND/OR)로 누적 결합
        let acc = null;
        valid.forEach((cond, idx) => {
          const col = searchFieldToColumn_(cond.field);
          const kw = cond.keyword.trim().toLowerCase();
          let matched = false;
          if (col) {
            if (cond.field === 'vendor') {
              const groupNames = getVendorNameGroupForKeyword_(cond.keyword);
              if (groupNames.length) {
                const groupNamesLower = groupNames.map(n => String(n).toLowerCase());
                matched = groupNamesLower.includes(String(row[col] || '').toLowerCase());
              } else {
                matched = String(row[col] || '').toLowerCase().includes(kw);
              }
            } else {
              matched = String(row[col] || '').toLowerCase().includes(kw);
            }
          }
          if (idx === 0) {
            acc = matched;
          } else if (cond.combinator === 'OR') {
            acc = acc || matched;
          } else {
            acc = acc && matched;
          }
        });
        return acc;
      });
    }
  }

  return result;
}

// ── 공통: 통계 결과로부터 요약 카드용 정보 산출 ──────────────
// rows: 정렬된 집계 결과 배열, amountKey: 합계금액 필드명
function buildSummary_(rows, amountKey, countKey) {
  const total = rows.reduce((s, r) => s + (Number(r[amountKey]) || 0), 0);
  const totalRecords = rows.reduce((s, r) => s + (Number(r[countKey]) || 0), 0);
  const groupCount = rows.length;
  const avgPerGroup = groupCount ? total / groupCount : 0;

  // 정렬 기준이 항상 금액 내림차순은 아니므로(예: 월별 추이는 연월 오름차순) rows[0]을 가정하지 않고
  // 실제로 금액이 가장 큰 행을 직접 찾음
  let top = null;
  rows.forEach(r => {
    if (!top || (Number(r[amountKey]) || 0) > (Number(top[amountKey]) || 0)) top = r;
  });

  return {
    total,
    totalRecords,
    groupCount,
    avgPerGroup,
    topName: top ? (top.vendor_name || top.dept || top.item_name || top.branch || top.ym || '') : '',
    topAmount: top ? (Number(top[amountKey]) || 0) : 0,
  };
}

// ── 입고(purchase_records) / 사용(usage_records) 컬럼 매핑 ──
// 두 테이블은 같은 의미의 정보를 다른 컬럼명으로 가지므로, recordType에 따라 실제 컬럼명을 결정
const RECORD_TYPE_TABLES = { purchase: 'purchase_records', usage: 'usage_records' };
const RECORD_TYPE_COLUMNS = {
  purchase: { qty: 'quantity', supply: 'supply_amount', vat: 'vat_amount', amount: 'total_amount' },
  usage:    { qty: 'usage_qty', supply: 'usage_supply',  vat: 'usage_vat',  amount: 'usage_total' },
};

// ═══════════════════════════════════════════════════════════
// 1. 거래처별 통계 (입고/사용 공통)
// 사업자번호(vendor_biz_no) 기준으로 그룹핑 — 거래처명 변경/표기 차이에도 동일 거래처로 집계
// 사업자번호가 없는 행(거래처 마스터 미등록)은 거래처명 기준으로 별도 그룹핑하고 미등록 표시
// ═══════════════════════════════════════════════════════════
async function getVendorStats(filters, recordType = 'purchase') {
  const table = RECORD_TYPE_TABLES[recordType];
  const cols = RECORD_TYPE_COLUMNS[recordType];

  let rows = await fetchAllRows_(table, q => applyFilters_(q, filters));
  rows = applyClientSideSearch_(rows, filters.basicSearch, filters.advancedConditions);

  // 사업자번호 → 현재 대표 명칭(is_current=true) 매핑. 그룹에 대표가 없으면(이론상 발생 안 함, 서버에서 보정)
  // 사업자번호로 등록된 첫 거래처명을 fallback으로 사용
  const bizNoToCurrentName = {};
  const bizNoToFallbackName = {};
  (window.StatsApp?.vendors || []).forEach(v => {
    if (!v.biz_no) return;
    if (v.is_current) bizNoToCurrentName[v.biz_no] = v.vendor_name;
    if (!bizNoToFallbackName[v.biz_no]) bizNoToFallbackName[v.biz_no] = v.vendor_name;
  });

  const grouped = {};
  const allItemTypes = new Set();

  rows.forEach(r => {
    const bizNo = r.vendor_biz_no || null;
    // 사업자번호가 있으면 그걸 키로, 없으면 거래처명 기준 (미등록 거래처 임시 그룹)
    const key = bizNo ? `biz:${bizNo}` : `name:${r.vendor_name || '(미확인)'}`;
    const rawName = r.vendor_name || '(미확인)';
    const itemType = r.item_type || '미분류';
    allItemTypes.add(itemType);

    if (!grouped[key]) {
      const displayName = bizNo
        ? (bizNoToCurrentName[bizNo] || bizNoToFallbackName[bizNo] || rawName)
        : rawName;
      grouped[key] = {
        vendor_name: displayName,
        vendor_biz_no: bizNo,
        unmatched: !bizNo,
        qty: 0, supply: 0, vat: 0, amount: 0, record_count: 0,
        breakdown: {}, // 실제 데이터에 등장한 이름별 세부 내역 (펼쳐보기용)
        byItemType: {}, // 자재구분별 합계금액 (컬럼 표시용)
        _rawRows: [], // 원본 행 (자재구분 컬럼 클릭 시 드릴다운용)
      };
    }
    grouped[key]._rawRows.push(r);
    grouped[key].qty          += Number(r[cols.qty])    || 0;
    grouped[key].supply       += Number(r[cols.supply]) || 0;
    grouped[key].vat          += Number(r[cols.vat])    || 0;
    grouped[key].amount       += Number(r[cols.amount]) || 0;
    grouped[key].record_count += 1;

    if (!grouped[key].breakdown[rawName]) {
      grouped[key].breakdown[rawName] = { vendor_name: rawName, amount: 0, record_count: 0 };
    }
    grouped[key].breakdown[rawName].amount       += Number(r[cols.amount]) || 0;
    grouped[key].breakdown[rawName].record_count += 1;

    grouped[key].byItemType[itemType] = (grouped[key].byItemType[itemType] || 0) + (Number(r[cols.amount]) || 0);
  });

  // breakdown을 배열로 변환 + 같은 이름이 1개뿐이면(이름 변경 이력 없음) 펼쳐볼 필요 없으니 표시
  const data = Object.values(grouped).map(g => {
    const breakdownArr = Object.values(g.breakdown).sort((a, b) => b.amount - a.amount);
    return { ...g, breakdown: breakdownArr, hasMultipleNames: breakdownArr.length > 1 };
  }).sort((a, b) => b.amount - a.amount);

  // 자재구분 정렬: 소모품/시약/의약품을 우선 노출하고, 그 외 값은 가나다순으로 뒤에 붙임
  const priorityOrder = ['소모품', '시약', '의약품'];
  const itemTypes = Array.from(allItemTypes).sort((a, b) => {
    const ai = priorityOrder.indexOf(a), bi = priorityOrder.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.localeCompare(b, 'ko');
  });

  return { data, summary: buildSummary_(data, 'amount', 'record_count'), itemTypes };
}

// ═══════════════════════════════════════════════════════════
// 2. 부서별 통계 (입고/사용 공통)
// 입고는 의뢰부서(dept), 사용은 사용부서(dept) 기준 — 같은 컬럼명이라 동일 로직 재사용
// ═══════════════════════════════════════════════════════════
async function getBranchStats(filters, recordType = 'usage') {
  const table = RECORD_TYPE_TABLES[recordType];
  const cols = RECORD_TYPE_COLUMNS[recordType];

  // 의원별 비교는 항상 전체 의원(강남/강북/서울숲)을 동시에 보여줘야 하므로,
  // 검색바의 의원 선택(filters.branch)은 무시하고 나머지 조건만 적용
  const branchFilters = { ...filters, branch: '' };

  let rows = await fetchAllRows_(table, q => applyFilters_(q, branchFilters));
  rows = applyClientSideSearch_(rows, filters.basicSearch, filters.advancedConditions);

  const grouped = {};
  const allItemTypes = new Set();

  rows.forEach(r => {
    const key = r.branch || '(미확인)';
    const itemType = r.item_type || '미분류';
    allItemTypes.add(itemType);

    if (!grouped[key]) {
      grouped[key] = { branch: key, qty: 0, supply: 0, vat: 0, amount: 0, record_count: 0, byItemType: {} };
    }
    grouped[key].qty          += Number(r[cols.qty])    || 0;
    grouped[key].supply       += Number(r[cols.supply]) || 0;
    grouped[key].vat          += Number(r[cols.vat])    || 0;
    grouped[key].amount       += Number(r[cols.amount]) || 0;
    grouped[key].record_count += 1;

    grouped[key].byItemType[itemType] = (grouped[key].byItemType[itemType] || 0) + (Number(r[cols.amount]) || 0);
  });

  const data = Object.values(grouped).sort((a, b) => b.amount - a.amount);

  // 자재구분 정렬: 소모품/시약/의약품을 우선 노출하고, 그 외 값은 가나다순으로 뒤에 붙임
  const priorityOrder = ['소모품', '시약', '의약품'];
  const itemTypes = Array.from(allItemTypes).sort((a, b) => {
    const ai = priorityOrder.indexOf(a), bi = priorityOrder.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.localeCompare(b, 'ko');
  });

  return { data, summary: buildSummary_(data, 'amount', 'record_count'), itemTypes };
}

async function getDeptStats(filters, recordType = 'usage') {
  const table = RECORD_TYPE_TABLES[recordType];
  const cols = RECORD_TYPE_COLUMNS[recordType];

  let rows = await fetchAllRows_(table, q => applyFilters_(q, filters));
  rows = applyClientSideSearch_(rows, filters.basicSearch, filters.advancedConditions);

  const grouped = {};
  const allItemTypes = new Set();

  rows.forEach(r => {
    const key = r.dept || '(미확인)';
    const itemType = r.item_type || '미분류';
    allItemTypes.add(itemType);

    if (!grouped[key]) {
      grouped[key] = { dept: key, qty: 0, supply: 0, vat: 0, amount: 0, record_count: 0, byItemType: {} };
    }
    grouped[key].qty          += Number(r[cols.qty])    || 0;
    grouped[key].supply       += Number(r[cols.supply]) || 0;
    grouped[key].vat          += Number(r[cols.vat])    || 0;
    grouped[key].amount       += Number(r[cols.amount]) || 0;
    grouped[key].record_count += 1;

    grouped[key].byItemType[itemType] = (grouped[key].byItemType[itemType] || 0) + (Number(r[cols.amount]) || 0);
  });

  const data = Object.values(grouped).sort((a, b) => b.amount - a.amount);

  // 자재구분 정렬: 소모품/시약/의약품을 우선 노출하고, 그 외 값은 가나다순으로 뒤에 붙임
  const priorityOrder = ['소모품', '시약', '의약품'];
  const itemTypes = Array.from(allItemTypes).sort((a, b) => {
    const ai = priorityOrder.indexOf(a), bi = priorityOrder.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.localeCompare(b, 'ko');
  });

  return { data, summary: buildSummary_(data, 'amount', 'record_count'), itemTypes };
}

// ═══════════════════════════════════════════════════════════
// 3. 품목별 통계 (입고/사용 공통, 자재코드 기준 그룹핑)
// 자재코드가 없는 행은 자재명을 키로 대체 그룹핑
// ═══════════════════════════════════════════════════════════
async function getItemStats(filters, recordType = 'purchase') {
  const table = RECORD_TYPE_TABLES[recordType];
  const cols = RECORD_TYPE_COLUMNS[recordType];

  let rows = await fetchAllRows_(table, q => applyFilters_(q, filters));
  rows = applyClientSideSearch_(rows, filters.basicSearch, filters.advancedConditions);

  const grouped = {};
  rows.forEach(r => {
    const code = (r.item_code || '').trim();
    const name = r.item_name || '(미확인)';
    const key = code ? `code:${code}` : `name:${name}`;

    if (!grouped[key]) {
      grouped[key] = {
        item_name: name,
        item_code: code || null,
        qty: 0, supply: 0, vat: 0, amount: 0, record_count: 0,
        _rawRows: [], // 원본 행 (행 클릭 시 세부내역 모달용)
      };
    }
    // 자재명이 바뀌어 들어온 경우(코드 기준 그룹일 때) 최신 표기로 갱신은 생략 — 거래처와 달리
    // 품목명 변경 이력 관리 마스터가 없으므로 최초 등장한 이름을 그대로 유지
    grouped[key]._rawRows.push(r);
    grouped[key].qty          += Number(r[cols.qty])    || 0;
    grouped[key].supply       += Number(r[cols.supply]) || 0;
    grouped[key].vat          += Number(r[cols.vat])    || 0;
    grouped[key].amount       += Number(r[cols.amount]) || 0;
    grouped[key].record_count += 1;
  });

  const data = Object.values(grouped).sort((a, b) => b.amount - a.amount);
  return { data, summary: buildSummary_(data, 'amount', 'record_count') };
}


// ═══════════════════════════════════════════════════════════
// 4. 기간(월별/연도별) 추이 통계 (다음 단계에서 구현)
// ═══════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════
// 4-1. 월별 추이 (입고/사용 공통) — 조회 구간을 월 단위로 집계
// ═══════════════════════════════════════════════════════════
async function getMonthlyTrend(filters, recordType = 'purchase') {
  const table = RECORD_TYPE_TABLES[recordType];
  const cols = RECORD_TYPE_COLUMNS[recordType];

  let rows = await fetchAllRows_(table, q => applyFilters_(q, filters));
  rows = applyClientSideSearch_(rows, filters.basicSearch, filters.advancedConditions);

  const grouped = {};
  const allItemTypes = new Set();

  rows.forEach(r => {
    const key = r.ym || '(미확인)';
    const itemType = r.item_type || '미분류';
    allItemTypes.add(itemType);

    if (!grouped[key]) {
      grouped[key] = { ym: key, qty: 0, supply: 0, vat: 0, amount: 0, record_count: 0, byItemType: {} };
    }
    grouped[key].qty          += Number(r[cols.qty])    || 0;
    grouped[key].supply       += Number(r[cols.supply]) || 0;
    grouped[key].vat          += Number(r[cols.vat])    || 0;
    grouped[key].amount       += Number(r[cols.amount]) || 0;
    grouped[key].record_count += 1;

    grouped[key].byItemType[itemType] = (grouped[key].byItemType[itemType] || 0) + (Number(r[cols.amount]) || 0);
  });

  // 추이는 시간 순서가 의미 있으므로 금액이 아니라 연월(ym) 오름차순으로 정렬
  const data = Object.values(grouped).sort((a, b) => a.ym.localeCompare(b.ym));

  // 자재구분 정렬: 소모품/시약/의약품을 우선 노출하고, 그 외 값은 가나다순으로 뒤에 붙임
  const priorityOrder = ['소모품', '시약', '의약품'];
  const itemTypes = Array.from(allItemTypes).sort((a, b) => {
    const ai = priorityOrder.indexOf(a), bi = priorityOrder.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.localeCompare(b, 'ko');
  });

  return { data, summary: buildSummary_(data, 'amount', 'record_count'), itemTypes };
}

// ═══════════════════════════════════════════════════════════
// 4-2. 구간 비교 (입고/사용 공통) — 기준 구간 vs 비교 구간
// filters의 ymFrom/ymTo가 기준 구간, compareYmFrom/compareYmTo가 비교 구간
// ═══════════════════════════════════════════════════════════
async function getPeriodComparison(filters, recordType = 'purchase', compareYmFrom, compareYmTo) {
  const table = RECORD_TYPE_TABLES[recordType];
  const cols = RECORD_TYPE_COLUMNS[recordType];

  async function aggregate(ymFrom, ymTo) {
    const periodFilters = { ...filters, ymFrom, ymTo };
    let rows = await fetchAllRows_(table, q => applyFilters_(q, periodFilters));
    rows = applyClientSideSearch_(rows, filters.basicSearch, filters.advancedConditions);

    const agg = { qty: 0, supply: 0, vat: 0, amount: 0, record_count: 0, byItemType: {} };
    rows.forEach(r => {
      const itemType = r.item_type || '미분류';
      agg.qty          += Number(r[cols.qty])    || 0;
      agg.supply       += Number(r[cols.supply]) || 0;
      agg.vat          += Number(r[cols.vat])    || 0;
      agg.amount       += Number(r[cols.amount]) || 0;
      agg.record_count += 1;
      agg.byItemType[itemType] = (agg.byItemType[itemType] || 0) + (Number(r[cols.amount]) || 0);
    });
    return agg;
  }

  const [base, compare] = await Promise.all([
    aggregate(filters.ymFrom, filters.ymTo),
    aggregate(compareYmFrom, compareYmTo),
  ]);

  // 각 지표별 증감액/증감률 계산 (비교 구간이 0이면 증감률은 null로 표시 — 분모 0 방지)
  const metrics = ['qty', 'supply', 'vat', 'amount', 'record_count'].map(key => {
    const baseVal = base[key];
    const compareVal = compare[key];
    const diff = baseVal - compareVal;
    const pct = compareVal !== 0 ? (diff / compareVal) * 100 : null;
    return { key, baseVal, compareVal, diff, pct };
  });

  // 자재구분별 합계금액 비교 — 두 구간 어느 쪽이든 등장한 자재구분은 모두 포함(한쪽이 0이어도 표시)
  const priorityOrder = ['소모품', '시약', '의약품'];
  const allItemTypes = Array.from(new Set([...Object.keys(base.byItemType), ...Object.keys(compare.byItemType)]))
    .sort((a, b) => {
      const ai = priorityOrder.indexOf(a), bi = priorityOrder.indexOf(b);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a.localeCompare(b, 'ko');
    });
  const itemTypeComparison = allItemTypes.map(itemType => {
    const baseVal = base.byItemType[itemType] || 0;
    const compareVal = compare.byItemType[itemType] || 0;
    const diff = baseVal - compareVal;
    const pct = compareVal !== 0 ? (diff / compareVal) * 100 : null;
    return { itemType, baseVal, compareVal, diff, pct };
  });

  return {
    basePeriod: { ymFrom: filters.ymFrom, ymTo: filters.ymTo, ...base },
    comparePeriod: { ymFrom: compareYmFrom, ymTo: compareYmTo, ...compare },
    metrics,
    itemTypeComparison,
  };
}

// ═══════════════════════════════════════════════════════════
// 5. 업로드 현황 조회 (연도별 업로드된 월 목록)
// ═══════════════════════════════════════════════════════════
// ── 검색 옵션용: 실제 데이터에 존재하는 부서명/자재구분 distinct 목록 ──
// 두 테이블(purchase_records, usage_records)을 합쳐서 등장하는 모든 값을 추출
async function getDistinctValues(column) {
  const PAGE_SIZE = 1000;
  const values = new Set();

  async function collectFrom(table) {
    let from = 0;
    while (true) {
      const { data, error } = await _supabase
        .from(table)
        .select(column)
        .order('ym', { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw new Error(error.message);
      (data || []).forEach(r => { if (r[column]) values.add(r[column]); });
      if (!data || data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
  }

  await Promise.all([collectFrom('purchase_records'), collectFrom('usage_records')]);
  return Array.from(values).sort((a, b) => a.localeCompare(b, 'ko'));
}

async function getUploadStatus(branch) {
  const [purchaseRows, usageRows] = await Promise.all([
    fetchAllRows_('purchase_records', q => q.eq('branch', branch)),
    fetchAllRows_('usage_records',    q => q.eq('branch', branch)),
  ]);

  // ym(YYYY-MM) 집합을 연도별로 묶기: { '2026': Set('01','02',...), ... }
  const buildYearMonthMap = (rows) => {
    const map = {};
    rows.forEach(r => {
      const ym = r.ym || '';
      const year = ym.slice(0, 4);
      const month = ym.slice(5, 7);
      if (!year || !month) return;
      if (!map[year]) map[year] = new Set();
      map[year].add(month);
    });
    return map;
  };

  const purchaseMap = buildYearMonthMap(purchaseRows);
  const usageMap    = buildYearMonthMap(usageRows);

  const allYears = [...new Set([...Object.keys(purchaseMap), ...Object.keys(usageMap)])].sort();

  return allYears.map(year => ({
    year,
    purchaseMonths: purchaseMap[year] ? [...purchaseMap[year]].sort() : [],
    usageMonths:    usageMap[year]    ? [...usageMap[year]].sort()    : [],
  }));
}

window.statsClient = {
  getVendorStats,
  getDeptStats,
  getBranchStats,
  getItemStats,
  getMonthlyTrend,
  getPeriodComparison,
  getUploadStatus,
  getDistinctValues,
};
