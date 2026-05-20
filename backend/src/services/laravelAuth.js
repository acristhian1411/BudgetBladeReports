const userInfoCache = new Map();

function getAuthConfig() {
  const authBaseUrl = (process.env.AUTH_BASE_URL || 'http://localhost').trim();
  const authTokenUrl = (process.env.AUTH_TOKEN_URL || `${authBaseUrl}/oauth/token`).trim();
  const authUserInfoUrl = (process.env.AUTH_USERINFO_URL || `${authBaseUrl}/api/user`).trim();

  return {
    authTokenUrl,
    authUserInfoUrl,
    authClientId: (process.env.AUTH_CLIENT_ID || '').trim(),
    authClientSecret: (process.env.AUTH_CLIENT_SECRET || '').trim(),
    authScope: process.env.AUTH_SCOPE || '',
    userInfoCacheTtlMs: Number(process.env.AUTH_USERINFO_CACHE_TTL_MS || 30000),
  };
}

function trimTrailingSlash(value) {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function getCacheEntry(token) {
  const entry = userInfoCache.get(token);
  if (!entry) return null;

  if (entry.expiresAt < Date.now()) {
    userInfoCache.delete(token);
    return null;
  }

  return entry;
}

function setCacheEntry(token, user) {
  const { userInfoCacheTtlMs } = getAuthConfig();

  userInfoCache.set(token, {
    user,
    expiresAt: Date.now() + userInfoCacheTtlMs,
  });
}

function assertOAuthClientConfigured() {
  const { authClientId, authClientSecret } = getAuthConfig();

  if (!authClientId || !authClientSecret) {
    throw new Error('Auth service is not configured: AUTH_CLIENT_ID and AUTH_CLIENT_SECRET are required');
  }
}

export async function loginWithLaravel({ email, password, scope }) {
  assertOAuthClientConfigured();
  const {
    authTokenUrl,
    authClientId,
    authClientSecret,
    authScope,
  } = getAuthConfig();

  const body = new URLSearchParams({
    grant_type: 'password',
    client_id: String(authClientId),
    client_secret: authClientSecret,
    username: email,
    password,
    scope: scope ?? authScope,
  });

  const response = await fetch(authTokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.error_description || data.message || data.error || 'Login failed against auth service';
    const err = new Error(message);
    err.status = response.status;
    throw err;
  }

  return data;
}

export async function getUserFromToken(token) {
  const { authUserInfoUrl } = getAuthConfig();

  const cached = getCacheEntry(token);
  if (cached) {
    return cached.user;
  }

  const response = await fetch(trimTrailingSlash(authUserInfoUrl), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.message || data.error || 'Invalid token';
    const err = new Error(message);
    err.status = response.status;
    throw err;
  }

  setCacheEntry(token, data);
  return data;
}
