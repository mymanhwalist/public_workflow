console.log('[Background] Career Page Verifier loading...');

// ── State ──
let state = {
  companies: [],
  currentIndex: -1,
  currentCompany: null,
  totalCompanies: 0,
  remaining: 0,
  savedCount: 0,
  skippedCount: 0,
  isRunning: false,
  canStart: false,
  status: '',
  logs: [],
  mode: 'new', // 'new' | 'verify'
};

let keepAliveInterval = null;
let shouldStop = false;
let pendingResolve = null;
let activeTimeout = null;

// ── Restore state from storage on SW startup ──
chrome.storage.local.get(['cpv_companies', 'cpv_currentIndex', 'cpv_savedCount', 'cpv_skippedCount'], (data) => {
  if (data.cpv_companies && data.cpv_companies.length > 0) {
    state.companies = data.cpv_companies;
    state.totalCompanies = data.cpv_companies.length;
    state.currentIndex = data.cpv_currentIndex ?? -1;
    state.savedCount = data.cpv_savedCount ?? 0;
    state.skippedCount = data.cpv_skippedCount ?? 0;
    state.remaining = state.totalCompanies - (state.currentIndex + 1);
    state.canStart = state.remaining > 0;
    console.log(`[Background] Restored ${state.companies.length} companies from storage`);
  }
});

// ── Utilities ──
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(text, level = 'info') {
  console.log(`[Background] ${text}`);
  state.logs.push({ text, level });
  if (state.logs.length > 200) state.logs.shift();
  broadcast({ type: 'LOG', text, level });
}

function broadcast(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {});
}

function broadcastState() {
  broadcast({ type: 'STATE_UPDATE', state });
}

function startKeepAlive() {
  if (keepAliveInterval) return;
  keepAliveInterval = setInterval(() => {
    console.log('[Background] Keep-alive tick');
  }, 20000);
}

function stopKeepAlive() {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
  }
}

function saveProgress() {
  chrome.storage.local.set({
    cpv_currentIndex: state.currentIndex,
    cpv_savedCount: state.savedCount,
    cpv_skippedCount: state.skippedCount,
  });
}

async function getConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['supabaseUrl', 'supabaseKey'], resolve);
  });
}

async function supaFetch(path, options = {}) {
  const { supabaseUrl, supabaseKey } = await getConfig();
  const url = `${supabaseUrl}${path}`;
  const headers = {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
    'Content-Type': 'application/json',
    ...options.headers,
  };
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase ${res.status}: ${body}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ── Tab Utilities (from career-page-finder) ──

function waitForTabLoad(tabId) {
  return new Promise(async (resolve, reject) => {
    let resolved = false;
    let timeout;

    const cleanup = () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(updateListener);
        chrome.tabs.onRemoved.removeListener(removeListener);
      }
    };

    const updateListener = (updatedTabId, changeInfo, tab) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        cleanup();
        setTimeout(() => resolve(), 300);
      }
    };

    const removeListener = (removedTabId) => {
      if (removedTabId === tabId) {
        cleanup();
        reject(new Error('Tab closed before loading'));
      }
    };

    // Check if already loaded
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === 'complete') {
        setTimeout(resolve, 100);
        return;
      }
    } catch (e) {
      reject(new Error('Tab does not exist'));
      return;
    }

    chrome.tabs.onUpdated.addListener(updateListener);
    chrome.tabs.onRemoved.addListener(removeListener);

    timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Page load timeout (25s)'));
    }, 25000);
  });
}

async function ensureContentScriptLoaded(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { action: 'ping' });
    console.log('[Background] Content script already loaded');
    return;
  } catch (_) {}

  console.log('[Background] Injecting content script...');
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content.js'],
  });

  await sleep(200);

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await chrome.tabs.sendMessage(tabId, { action: 'ping' });
      console.log(`[Background] Content script ready (attempt ${attempt})`);
      return;
    } catch (e) {
      if (attempt < 3) {
        await sleep(300);
      } else {
        throw new Error('Content script blocked by site');
      }
    }
  }
}

// ── Message Handler ──
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'ping') {
    sendResponse({ pong: true });
    return true;
  }

  if (msg.type === 'GET_STATE') {
    sendResponse(state);
    return;
  }

  if (msg.type === 'FETCH_COMPANIES') {
    fetchCompanies()
      .then((count) => sendResponse({ count, companies: state.companies }))
      .catch((e) => sendResponse({ error: e.message }));
    return true;
  }

  if (msg.type === 'FETCH_EXISTING') {
    fetchExisting()
      .then((count) => sendResponse({ count, companies: state.companies }))
      .catch((e) => sendResponse({ error: e.message }));
    return true;
  }

  if (msg.type === 'START_REVIEW') {
    // Accept companies from popup (like career-page-finder pattern)
    if (msg.companies && msg.companies.length > 0) {
      state.companies = msg.companies;
      state.totalCompanies = msg.companies.length;
      state.currentIndex = -1;
      state.remaining = msg.companies.length;
    }
    if (msg.mode) state.mode = msg.mode;
    startReview();
    sendResponse({ started: true });
    return;
  }

  if (msg.type === 'STOP_REVIEW') {
    stopReview();
    sendResponse({ stopped: true });
    return;
  }

  // User actions from content script or popup — resolve the pending promise
  if (msg.type === 'SAVE_URL' || msg.type === 'SKIP' || msg.type === 'NO_CAREERS' ||
      msg.type === 'CONFIRM_URL' || msg.type === 'UPDATE_URL' || msg.type === 'MARK_INVALID') {
    if (pendingResolve) {
      pendingResolve(msg);
      pendingResolve = null;
    }
    return;
  }
});

// ── Fetch Companies ──
async function fetchCompanies() {
  const careerPages = await supaFetch('/rest/v1/career_pages?select=company_id');
  const existingIds = new Set(careerPages.map((r) => r.company_id));

  const companies = await supaFetch('/rest/v1/companies?select=id,name,website&order=name.asc');

  const invalidValues = new Set(['n/a', 'na', 'none', 'null', 'undefined', '-', '', 'n/ a']);
  state.companies = companies.filter((c) => {
    if (existingIds.has(c.id)) return false;
    if (!c.website) return false;
    const w = c.website.trim().toLowerCase();
    if (invalidValues.has(w)) return false;
    const hostname = w.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (invalidValues.has(hostname)) return false;
    if (!hostname.includes('.')) return false;
    return true;
  });

  state.totalCompanies = state.companies.length;
  state.remaining = state.companies.length;
  state.currentIndex = -1;
  state.savedCount = 0;
  state.skippedCount = 0;
  state.canStart = state.companies.length > 0;
  state.status = '';
  state.currentCompany = null;

  // Persist to storage so SW restarts don't lose data
  chrome.storage.local.set({
    cpv_companies: state.companies,
    cpv_currentIndex: -1,
    cpv_savedCount: 0,
    cpv_skippedCount: 0,
  });

  broadcastState();
  return state.companies.length;
}

// ── Fetch Existing (Verify mode) ──
async function fetchExisting() {
  const careerPages = await supaFetch('/rest/v1/career_pages?career_url=not.is.null&scraped_from=not.in.(verified,manual-verified,verified-invalid)&select=company_id,career_url,scraped_from');

  if (careerPages.length === 0) {
    state.companies = [];
    state.totalCompanies = 0;
    state.remaining = 0;
    state.canStart = false;
    broadcastState();
    return 0;
  }

  // Build a map of company_id → career page data
  const careerMap = {};
  careerPages.forEach((r) => {
    careerMap[r.company_id] = { career_url: r.career_url, scraped_from: r.scraped_from };
  });

  // Fetch company names in batches
  const ids = Object.keys(careerMap);
  const nameMap = {};
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const companies = await supaFetch(`/rest/v1/companies?id=in.(${batch.join(',')})&select=id,name,website`);
    companies.forEach((c) => {
      nameMap[c.id] = { name: c.name, website: c.website };
    });
  }

  state.companies = ids.map((id) => ({
    id,
    name: nameMap[id]?.name || id,
    website: nameMap[id]?.website || '',
    career_url: careerMap[id].career_url,
  }));

  state.mode = 'verify';
  state.totalCompanies = state.companies.length;
  state.remaining = state.companies.length;
  state.currentIndex = -1;
  state.savedCount = 0;
  state.skippedCount = 0;
  state.canStart = state.companies.length > 0;
  state.status = '';
  state.currentCompany = null;

  chrome.storage.local.set({
    cpv_companies: state.companies,
    cpv_currentIndex: -1,
    cpv_savedCount: 0,
    cpv_skippedCount: 0,
  });

  broadcastState();
  return state.companies.length;
}

// ── Review Flow ──
async function startReview() {
  if (state.isRunning) {
    log('Already running', 'error');
    return;
  }

  // Fallback: reload companies from storage if SW lost them
  if (state.companies.length === 0) {
    console.log('[Background] Companies empty, reading from storage...');
    const data = await chrome.storage.local.get(['cpv_companies', 'cpv_currentIndex', 'cpv_savedCount', 'cpv_skippedCount']);
    if (data.cpv_companies && data.cpv_companies.length > 0) {
      state.companies = data.cpv_companies;
      state.totalCompanies = data.cpv_companies.length;
      state.currentIndex = data.cpv_currentIndex ?? -1;
      state.savedCount = data.cpv_savedCount ?? 0;
      state.skippedCount = data.cpv_skippedCount ?? 0;
      state.remaining = state.totalCompanies - (state.currentIndex + 1);
      console.log(`[Background] Restored ${state.companies.length} from storage`);
    }
  }

  if (state.companies.length === 0) {
    log('No companies loaded. Click Fetch Companies first.', 'error');
    return;
  }

  log(`Starting review: ${state.companies.length} companies, index=${state.currentIndex}`, 'info');

  state.isRunning = true;
  state.canStart = false;
  shouldStop = false;
  broadcastState();
  startKeepAlive();

  batchReview().catch((err) => {
    log(`Fatal error: ${err.message}`, 'error');
    console.error('[Background] batchReview fatal:', err);
    state.isRunning = false;
    state.canStart = state.remaining > 0;
    stopKeepAlive();
    broadcastState();
  });
}

function stopReview() {
  shouldStop = true;
  state.isRunning = false;
  state.canStart = state.remaining > 0;
  state.status = 'Stopped';
  stopKeepAlive();
  if (activeTimeout) {
    clearTimeout(activeTimeout);
    activeTimeout = null;
  }
  if (pendingResolve) {
    pendingResolve({ type: '_STOPPED' });
    pendingResolve = null;
  }
  log('Review stopped', 'info');
  broadcastState();
}

async function batchReview() {
  const total = state.companies.length;
  console.log(`[Background] Starting batch review of ${total} companies, index=${state.currentIndex}`);

  for (let i = state.currentIndex + 1; i < total; i++) {
    if (shouldStop) break;

    state.currentIndex = i;
    const company = state.companies[i];
    state.currentCompany = company;
    state.remaining = total - i;
    state.status = 'Opening website…';
    broadcastState();

    let createdTabIds = [];
    let navigationListener = null;
    let newTabListener = null;
    let tabClosedListener = null;

    try {
      // Validate URL — in verify mode, open the career_url directly
      const rawUrl = state.mode === 'verify' ? (company.career_url || '') : (company.website || '');
      let websiteUrl = rawUrl.trim();
      if (!websiteUrl.startsWith('http')) {
        websiteUrl = 'https://' + websiteUrl;
      }
      if (websiteUrl.startsWith('http://')) {
        websiteUrl = websiteUrl.replace('http://', 'https://');
      }

      log(`Opening: ${company.name} — ${websiteUrl}`, 'info');

      // Open tab
      const tab = await chrome.tabs.create({ url: websiteUrl, active: true });
      createdTabIds.push(tab.id);
      console.log(`[Background] Tab created: ${tab.id}`);

      // Wait for page load
      try {
        await waitForTabLoad(tab.id);
      } catch (loadError) {
        log(`${company.name}: ${loadError.message}`, 'error');
        try { await chrome.tabs.remove(createdTabIds); } catch (_) {}
        await sleep(200);
        continue;
      }

      // Check for error page
      let tabInfo;
      try {
        tabInfo = await chrome.tabs.get(tab.id);
      } catch (_) {
        log(`${company.name}: Tab closed`, 'error');
        continue;
      }

      const isErrorPage =
        tabInfo.url.startsWith('chrome-error://') ||
        tabInfo.url.startsWith('chrome://') ||
        tabInfo.url === 'about:blank';

      if (isErrorPage) {
        log(`${company.name}: Website unreachable`, 'error');
        try { await chrome.tabs.remove(createdTabIds); } catch (_) {}
        await sleep(200);
        continue;
      }

      // Inject content script
      try {
        await ensureContentScriptLoaded(tab.id);
      } catch (injErr) {
        log(`${company.name}: ${injErr.message}`, 'error');
        try { await chrome.tabs.remove(createdTabIds); } catch (_) {}
        await sleep(200);
        continue;
      }

      // Init overlay
      const overlayType = state.mode === 'verify' ? 'INIT_VERIFY_OVERLAY' : 'INIT_OVERLAY';
      const overlayPayload = state.mode === 'verify'
        ? { id: company.id, name: company.name, website: company.website, career_url: company.career_url }
        : { id: company.id, name: company.name, website: company.website };
      try {
        await chrome.tabs.sendMessage(tab.id, {
          type: overlayType,
          company: overlayPayload,
        });
      } catch (msgErr) {
        log(`${company.name}: Page not responding`, 'error');
        try { await chrome.tabs.remove(createdTabIds); } catch (_) {}
        await sleep(200);
        continue;
      }

      state.status = 'Reviewing…';
      broadcastState();

      // ── Navigation listener: re-inject overlay on same-tab navigation ──
      const lastUrls = new Map();
      navigationListener = async (details) => {
        if (createdTabIds.includes(details.tabId) && details.frameId === 0) {
          const lastUrl = lastUrls.get(details.tabId);
          if (lastUrl === details.url) return;
          lastUrls.set(details.tabId, details.url);

          await sleep(500);
          try {
            await chrome.tabs.get(details.tabId);
            await ensureContentScriptLoaded(details.tabId);
            await sleep(100);
            await chrome.tabs.sendMessage(details.tabId, {
              type: overlayType,
              company: overlayPayload,
            });
          } catch (_) {}
        }
      };
      chrome.webNavigation.onCompleted.addListener(navigationListener);

      // ── New tab listener: inject overlay in tabs opened by career links ──
      const windowId = tab.windowId;
      newTabListener = async (newTab) => {
        if (newTab.windowId === windowId && !createdTabIds.includes(newTab.id)) {
          createdTabIds.push(newTab.id);
          try {
            await waitForTabLoad(newTab.id);
            await ensureContentScriptLoaded(newTab.id);
            await chrome.tabs.sendMessage(newTab.id, {
              type: overlayType,
              company: overlayPayload,
            });
          } catch (_) {}
        }
      };
      chrome.tabs.onCreated.addListener(newTabListener);

      // ── Wait for user action ──
      const response = await new Promise((resolve) => {
        pendingResolve = resolve;

        activeTimeout = setTimeout(() => {
          activeTimeout = null;
          log(`Timeout for ${company.name}, skipping`, 'skip');
          resolve({ type: 'SKIP' });
        }, 5 * 60 * 1000);

        tabClosedListener = (removedTabId) => {
          if (createdTabIds.includes(removedTabId)) {
            createdTabIds = createdTabIds.filter((id) => id !== removedTabId);
            if (createdTabIds.length === 0) {
              if (activeTimeout) { clearTimeout(activeTimeout); activeTimeout = null; }
              resolve({ type: 'SKIP', reason: 'tab_closed' });
            }
          }
        };
        chrome.tabs.onRemoved.addListener(tabClosedListener);
      });

      pendingResolve = null;
      if (activeTimeout) { clearTimeout(activeTimeout); activeTimeout = null; }

      // ── Handle response ──
      if (response.type === '_STOPPED') break;

      if (state.mode === 'verify') {
        // ── Verify mode response handling ──
        const patchFilter = `company_id=eq.${company.id}&career_url=eq.${encodeURIComponent(company.career_url)}`;
        if (response.type === 'CONFIRM_URL') {
          try {
            await supaFetch(`/rest/v1/career_pages?${patchFilter}`, {
              method: 'PATCH',
              headers: { Prefer: 'return=minimal' },
              body: JSON.stringify({
                scraped_from: 'verified',
                scraped_at: new Date().toISOString(),
              }),
            });
            state.savedCount++;
            log(`Confirmed: ${company.name} → ${company.career_url}`, 'success');
          } catch (e) {
            log(`Error confirming ${company.name}: ${e.message}`, 'error');
          }
        } else if (response.type === 'UPDATE_URL') {
          try {
            await supaFetch(`/rest/v1/career_pages?${patchFilter}`, {
              method: 'PATCH',
              headers: { Prefer: 'return=minimal' },
              body: JSON.stringify({
                career_url: response.url,
                scraped_from: 'manual-verified',
                scraped_at: new Date().toISOString(),
              }),
            });
            state.savedCount++;
            log(`Updated: ${company.name} → ${response.url}`, 'success');
          } catch (e) {
            log(`Error updating ${company.name}: ${e.message}`, 'error');
          }
        } else if (response.type === 'MARK_INVALID') {
          try {
            await supaFetch(`/rest/v1/career_pages?${patchFilter}`, {
              method: 'PATCH',
              headers: { Prefer: 'return=minimal' },
              body: JSON.stringify({
                scraped_from: 'verified-invalid',
                scraped_at: new Date().toISOString(),
              }),
            });
            state.skippedCount++;
            log(`Marked invalid: ${company.name}`, 'error');
          } catch (e) {
            log(`Error marking invalid ${company.name}: ${e.message}`, 'error');
          }
        } else {
          state.skippedCount++;
          log(response.reason === 'tab_closed' ? `Tab closed: ${company.name}` : `Skipped: ${company.name}`, 'skip');
        }
      } else {
        // ── New mode response handling (original) ──
        if (response.type === 'SAVE_URL') {
          try {
            const postBody = {
              company_id: company.id,
              career_url: response.url,
              scraped_from: 'manual-verifier',
              scraped_at: new Date().toISOString(),
              ...(response.ats_provider && { ats_provider: response.ats_provider }),
              ...(response.api_endpoint && { api_endpoint: response.api_endpoint }),
              ...(response.api_endpoint_detail && { api_endpoint_detail: response.api_endpoint_detail }),
            };
            await supaFetch('/rest/v1/career_pages', {
              method: 'POST',
              headers: { Prefer: 'return=minimal' },
              body: JSON.stringify(postBody),
            });
            state.savedCount++;
            const atsInfo = response.ats_provider ? ` [${response.ats_provider}]` : '';
            log(`Saved: ${company.name} → ${response.url}${atsInfo}`, 'success');
          } catch (e) {
            log(`Error saving ${company.name}: ${e.message}`, 'error');
          }
        } else if (response.type === 'NO_CAREERS') {
          try {
            await supaFetch('/rest/v1/career_pages', {
              method: 'POST',
              headers: { Prefer: 'return=minimal' },
              body: JSON.stringify({
                company_id: company.id,
                career_url: null,
                scraped_from: 'manual-verifier-no-careers',
                scraped_at: new Date().toISOString(),
              }),
            });
            state.skippedCount++;
            log(`No careers page: ${company.name}`, 'skip');
          } catch (e) {
            log(`Error saving no-careers for ${company.name}: ${e.message}`, 'error');
          }
        } else {
          state.skippedCount++;
          log(response.reason === 'tab_closed' ? `Tab closed: ${company.name}` : `Skipped: ${company.name}`, 'skip');
        }
      }

      // Close tracked tabs
      for (const tabId of createdTabIds) {
        try { await chrome.tabs.remove(tabId); } catch (_) {}
      }

      saveProgress();
      await sleep(300);

    } catch (error) {
      log(`Error: ${company.name} — ${error.message}`, 'error');
      for (const tabId of createdTabIds) {
        try { await chrome.tabs.remove(tabId); } catch (_) {}
      }
      await sleep(200);

    } finally {
      if (navigationListener) {
        try { chrome.webNavigation.onCompleted.removeListener(navigationListener); } catch (_) {}
      }
      if (newTabListener) {
        try { chrome.tabs.onCreated.removeListener(newTabListener); } catch (_) {}
      }
      if (tabClosedListener) {
        try { chrome.tabs.onRemoved.removeListener(tabClosedListener); } catch (_) {}
      }
      pendingResolve = null;
    }
  }

  // Done
  state.isRunning = false;
  state.status = shouldStop ? 'Stopped' : 'Complete!';
  state.canStart = state.remaining > 0;
  state.currentCompany = shouldStop ? state.currentCompany : null;
  stopKeepAlive();
  saveProgress();
  if (!shouldStop) log('All companies reviewed!', 'success');
  broadcastState();
}

console.log('[Background] Career Page Verifier loaded successfully');
