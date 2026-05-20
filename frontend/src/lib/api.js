import { authStore } from './stores.js';

const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:3000') + '/api';

let currentToken = null;

authStore.subscribe((auth) => {
  currentToken = auth.token;
});

/**
 * Fetch wrapper with Bearer token authentication
 */
async function fetchWithAuth(url, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (currentToken) {
    headers.Authorization = `Bearer ${currentToken}`;
  }

  const response = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers,
  });

  if (response.status === 401) {
    // Token expired or invalid
    authStore.logout();
    if (typeof window !== 'undefined') {
      window.location.href = '/login';
    }
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * GET request
 */
export async function apiGet(path) {
  return fetchWithAuth(path);
}

/**
 * POST request
 */
export async function apiPost(path, body) {
  return fetchWithAuth(path, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * POST multipart request (for file uploads)
 */
export async function apiPostMultipart(path, formData) {
  const headers = {};

  if (currentToken) {
    headers.Authorization = `Bearer ${currentToken}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers,
    body: formData,
  });

  if (response.status === 401) {
    authStore.logout();
    if (typeof window !== 'undefined') {
      window.location.href = '/login';
    }
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Auth API: Login with email and password
 */
export async function login(email, password) {
  const response = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Login failed' }));
    throw new Error(error.error || 'Login failed');
  }

  return response.json();
}

/**
 * Auth API: Fetch current user profile
 */
export async function getCurrentUser() {
  return apiGet('/auth/me');
}

