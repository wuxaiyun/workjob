const TOKEN_KEY = 'eq_token';
const USER_KEY = 'eq_user';

export const token = {
  get: () => localStorage.getItem(TOKEN_KEY) || '',
  set: (t) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

export const storedUser = {
  get: () => {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
    } catch {
      return null;
    }
  },
  set: (u) => localStorage.setItem(USER_KEY, JSON.stringify(u)),
  clear: () => localStorage.removeItem(USER_KEY),
};

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (!headers['Content-Type'] && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  const t = token.get();
  if (t) headers.Authorization = `Bearer ${t}`;

  let res;
  try {
    res = await fetch(path, { ...options, headers });
  } catch {
    throw { success: false, error: { code: 'NETWORK_ERROR', message: '网络错误，请确认后端服务已启动' } };
  }

  let body = null;
  try {
    body = await res.json();
  } catch {
    throw { success: false, error: { code: 'BAD_RESPONSE', message: '服务返回异常' } };
  }

  if (!res.ok || body.success === false) {
    const err = body.error || { code: 'UNKNOWN', message: '请求失败' };
    if (res.status === 401) {
      token.clear();
      storedUser.clear();
    }
    throw { success: false, status: res.status, error: err };
  }
  return body;
}

export const api = {
  get: (path) => request(path),
  post: (path, data) => request(path, { method: 'POST', body: JSON.stringify(data || {}) }),
  put: (path, data) => request(path, { method: 'PUT', body: JSON.stringify(data || {}) }),
  patch: (path, data) => request(path, { method: 'PATCH', body: JSON.stringify(data || {}) }),
  del: (path) => request(path, { method: 'DELETE' }),
  upload: (path, formData) =>
    request(path, {
      method: 'POST',
      headers: {},
      body: formData,
    }),
};