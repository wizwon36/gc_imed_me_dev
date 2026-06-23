function buildApiUrl(action, params = {}) {
  const url = new URL(CONFIG.API_BASE_URL);
  url.searchParams.set('action', action);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, value);
    }
  });

  return url.toString();
}

async function parseApiResponse(response) {
  let data;

  try {
    data = await response.json();
  } catch (error) {
    throw new Error('서버 응답을 해석하지 못했습니다.');
  }

  if (!response.ok) {
    throw new Error(data?.message || '서버 요청에 실패했습니다.');
  }

  if (!data.success) {
    throw new Error(data.message || '요청 처리 중 오류가 발생했습니다.');
  }

  return data;
}

async function apiGet(action, params = {}, _retry = 2) {
  const url = buildApiUrl(action, params);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60000);  // 60초 타임아웃
  try {
    const response = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      signal: ctrl.signal
    });
    return await parseApiResponse(response);
  } catch (e) {
    if (e.name === 'AbortError') {
      if (_retry > 0) {
        console.warn(`[apiGet] 타임아웃 재시도 (남은 횟수: ${_retry}) - action: ${action}`);
        return apiGet(action, params, _retry - 1);
      }
      throw new Error('요청 시간이 초과됐습니다. 잠시 후 다시 시도해주세요.');
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function apiPost(action, payload = {}, _retry = 2) {
  const url = buildApiUrl(action);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60000);  // 60초 타임아웃
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      signal: ctrl.signal
    });
    return await parseApiResponse(response);
  } catch (e) {
    if (e.name === 'AbortError') {
      if (_retry > 0) {
        console.warn(`[apiPost] 타임아웃 재시도 (남은 횟수: ${_retry}) - action: ${action}`);
        return apiPost(action, payload, _retry - 1);
      }
      throw new Error('요청 시간이 초과됐습니다. 잠시 후 다시 시도해주세요.');
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

window.buildApiUrl = buildApiUrl;
window.apiGet = apiGet;
window.apiPost = apiPost;
