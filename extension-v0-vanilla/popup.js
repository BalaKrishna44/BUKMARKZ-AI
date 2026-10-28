'use strict';

/**
 * Bukmarkz extension popup (Manifest V3, Chrome + Firefox).
 *
 * Auth model: the extension signs in once with POST /api/auth/login/, keeps the returned
 * Knox token in extension storage, and sends it as `Authorization: Token <token>`.
 * Token auth is not affected by CSRF (CSRF protects cookie sessions), so no CSRF header is
 * needed and requests are sent with `credentials: 'omit'` so cookies are never attached.
 */

// `browser` (Firefox, promise-based) when present, otherwise `chrome` (Chrome MV3 is promise-based too).
const ext = typeof browser !== 'undefined' ? browser : chrome;

const API_BASE = 'https://api.bukmarkz.com/api';
const URLS = {
  login: `${API_BASE}/auth/login/`,
  logout: `${API_BASE}/auth/logout/`,
  save: `${API_BASE}/extension/bookmarks/`,
  categories: `${API_BASE}/category/`
};
const REQUEST_TIMEOUT_MS = 10000;

const $ = (id) => document.getElementById(id);
const els = {
  login: $('login-view'),
  save: $('save-view'),
  logout: $('logout'),
  status: $('status'),
  username: $('username'),
  password: $('password'),
  loginBtn: $('login-btn'),
  title: $('page-title'),
  url: $('page-url'),
  note: $('note'),
  category: $('category'),
  saveBtn: $('save-btn')
};

let currentTab = null;
let pageContext = '';

/* ---------- status line ---------- */

function setStatus(message, kind) {
  els.status.textContent = message || '';
  els.status.className = 'status' + (kind ? ' ' + kind : '');
}

/* ---------- stored session ---------- */

async function getSession() {
  const { token, expiry } = await ext.storage.local.get(['token', 'expiry']);
  if (!token) return null;
  if (expiry && Date.parse(expiry) <= Date.now()) {
    await clearSession();
    return null;
  }
  return { token };
}

function saveSession({ token, expiry }) {
  return ext.storage.local.set({ token, expiry });
}

function clearSession() {
  return ext.storage.local.remove(['token', 'expiry']);
}

/* ---------- network ---------- */

class ApiError extends Error {
  constructor(kind, status, data) {
    super(kind);
    this.kind = kind;      // 'network' | 'auth' | 'rate' | 'invalid' | 'server'
    this.status = status;
    this.data = data;
  }
}

async function request(url, { method = 'GET', body, token } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Token ${token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'omit',
      signal: controller.signal
    });
  } catch (err) {
    throw new ApiError('network', 0, null);
  } finally {
    clearTimeout(timer);
  }

  let data = null;
  try {
    data = await response.json();
  } catch (err) {
    data = null; // empty or non-JSON body
  }

  if (response.ok) return { status: response.status, data };
  if (response.status === 401 || response.status === 403) throw new ApiError('auth', response.status, data);
  if (response.status === 429) throw new ApiError('rate', response.status, data);
  if (response.status >= 400 && response.status < 500) throw new ApiError('invalid', response.status, data);
  throw new ApiError('server', response.status, data);
}

// Turns DRF error bodies like {"url": ["Only http(s) URLs are allowed."]} into one sentence.
function firstErrorMessage(data) {
  if (!data) return null;
  if (typeof data === 'string') return data;
  if (Array.isArray(data)) return firstErrorMessage(data[0]);
  if (data.detail) return String(data.detail);
  const first = Object.values(data)[0];
  return firstErrorMessage(first);
}

function messageForError(err, fallback) {
  switch (err.kind) {
    case 'network': return 'Can’t reach Bukmarkz. Check your connection and try again.';
    case 'auth': return 'Your session expired. Please sign in again.';
    case 'rate': return 'Too many requests. Wait a moment and try again.';
    case 'invalid': return firstErrorMessage(err.data) || fallback;
    default: return 'Bukmarkz had a problem saving that. Try again in a minute.';
  }
}

/* ---------- tab + page details ---------- */

async function getActiveTab() {
  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

function isSavable(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}

// Selected text or the page's meta description. It improves AI search and is never stored.
// Fails quietly on pages where scripts can't run (store pages, PDFs, ...).
async function getPageContext(tabId) {
  try {
    const results = await ext.scripting.executeScript({
      target: { tabId },
      func: () => {
        const selected = String(window.getSelection() || '').trim();
        const meta = document.querySelector('meta[name="description"], meta[property="og:description"]');
        return (selected || (meta && meta.content) || '').trim().slice(0, 1000);
      }
    });
    return (results && results[0] && results[0].result) || '';
  } catch (err) {
    return '';
  }
}

/* ---------- views ---------- */

function show(view) {
  els.login.hidden = view !== 'login';
  els.save.hidden = view !== 'save';
  els.logout.hidden = view !== 'save';
}

async function showSaveView(session) {
  show('save');
  setStatus('');

  currentTab = await getActiveTab();
  if (!currentTab || !isSavable(currentTab.url)) {
    els.title.textContent = 'This page can’t be saved';
    els.url.textContent = 'Bukmarkz saves regular web pages (http or https).';
    els.saveBtn.disabled = true;
    return;
  }

  els.title.textContent = currentTab.title || currentTab.url;
  els.url.textContent = currentTab.url;
  els.saveBtn.disabled = false;
  els.saveBtn.focus();

  getPageContext(currentTab.id).then((text) => { pageContext = text; });
  loadCategories(session.token);
}

async function loadCategories(token) {
  try {
    const { data } = await request(URLS.categories, { token });
    (data || [])
      .filter((c) => !c.private)
      .forEach((c) => {
        const option = document.createElement('option');
        option.value = String(c.id);
        option.textContent = c.title;
        els.category.appendChild(option);
      });
  } catch (err) {
    if (err.kind === 'auth') await handleSignedOut('Your session expired. Please sign in again.');
    // anything else: keep the default category, saving still works
  }
}

async function handleSignedOut(message) {
  await clearSession();
  show('login');
  setStatus(message || '', message ? 'bad' : '');
  els.username.focus();
}

/* ---------- actions ---------- */

els.login.addEventListener('submit', async (event) => {
  event.preventDefault();
  els.loginBtn.disabled = true;
  setStatus('Signing in…', 'info');
  try {
    const { data } = await request(URLS.login, {
      method: 'POST',
      body: { username: els.username.value.trim(), password: els.password.value }
    });
    await saveSession({ token: data.token, expiry: data.expiry });
    els.password.value = ''; // never keep the password around
    await showSaveView({ token: data.token });
  } catch (err) {
    setStatus(
      err.kind === 'invalid' ? 'Wrong username or password.' : messageForError(err, 'Could not sign in.'),
      'bad'
    );
  } finally {
    els.loginBtn.disabled = false;
  }
});

els.save.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (els.saveBtn.disabled || !currentTab) return; // blocks double clicks

  const session = await getSession();
  if (!session) {
    await handleSignedOut('Your session expired. Please sign in again.');
    return;
  }

  els.saveBtn.disabled = true;
  setStatus('Saving…', 'info');

  const payload = {
    url: currentTab.url,
    title: currentTab.title || '',
    description: els.note.value.trim(),
    context: pageContext,
    category: els.category.value ? Number(els.category.value) : null
  };

  try {
    const { status } = await request(URLS.save, { method: 'POST', body: payload, token: session.token });
    if (status === 201) {
      setStatus('Saved to Bukmarkz ✓', 'ok');
      setTimeout(() => window.close(), 1400);
    } else {
      setStatus('Already in your bookmarks ✓', 'ok'); // 200: this URL was saved before
      setTimeout(() => window.close(), 1400);
    }
  } catch (err) {
    if (err.kind === 'auth') {
      await handleSignedOut('Your session expired. Please sign in again.');
      return;
    }
    setStatus(messageForError(err, 'That page couldn’t be saved.'), 'bad');
    els.saveBtn.disabled = false; // allow another try
  }
});

els.logout.addEventListener('click', async () => {
  const session = await getSession();
  if (session) {
    try { await request(URLS.logout, { method: 'POST', token: session.token }); } catch (err) { /* sign out locally anyway */ }
  }
  await handleSignedOut('');
});

/* ---------- start ---------- */

(async function init() {
  const session = await getSession();
  if (session) await showSaveView(session);
  else await handleSignedOut('');
})();
