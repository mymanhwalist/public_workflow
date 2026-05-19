const $ = (sel) => document.querySelector(sel);

const els = {
  supabaseUrl: $('#supabaseUrl'),
  supabaseKey: $('#supabaseKey'),
  saveConfig: $('#saveConfig'),
  testConnection: $('#testConnection'),
  fetchCompanies: $('#fetchCompanies'),
  fetchExisting: $('#fetchExisting'),
  startReview: $('#startReview'),
  stopReview: $('#stopReview'),
  verifyData: $('#verifyData'),
  stats: $('#stats'),
  remaining: $('#remaining'),
  saved: $('#saved'),
  skipped: $('#skipped'),
  progressContainer: $('#progressContainer'),
  progressBar: $('#progressBar'),
  currentCompany: $('#currentCompany'),
  companyName: $('#companyName'),
  companyWebsite: $('#companyWebsite'),
  companyStatus: $('#companyStatus'),
  logPanel: $('#logPanel'),
  popupActions: $('#popupActions'),
  popupUrlInput: $('#popupUrlInput'),
  popupSave: $('#popupSave'),
  popupSkip: $('#popupSkip'),
  popupNoCareers: $('#popupNoCareers'),
};

// ── State ──
let configValid = false;
let cachedCompanies = [];
let mode = 'new'; // 'new' | 'verify'

// ── Init ──
chrome.storage.local.get(['supabaseUrl', 'supabaseKey'], (data) => {
  if (data.supabaseUrl) els.supabaseUrl.value = data.supabaseUrl;
  if (data.supabaseKey) els.supabaseKey.value = data.supabaseKey;
  if (data.supabaseUrl && data.supabaseKey) {
    configValid = true;
    els.fetchCompanies.disabled = false;
    els.fetchExisting.disabled = false;
    els.verifyData.disabled = false;
  }
});

// Restore state from background
chrome.runtime.sendMessage({ type: 'GET_STATE' }, (state) => {
  if (!state) return;
  updateUI(state);
});

// Listen for state updates from background
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'STATE_UPDATE') updateUI(msg.state);
  if (msg.type === 'LOG') addLog(msg.text, msg.level);
});

function updateUI(state) {
  if (!state) return;

  if (state.totalCompanies > 0) {
    els.stats.style.display = 'block';
    els.progressContainer.style.display = 'block';
    els.logPanel.style.display = 'block';
    els.remaining.textContent = state.remaining;
    els.saved.textContent = state.savedCount;
    els.skipped.textContent = state.skippedCount;

    const pct = ((state.totalCompanies - state.remaining) / state.totalCompanies) * 100;
    els.progressBar.style.width = pct + '%';
  }

  if (state.currentCompany) {
    els.currentCompany.style.display = 'block';
    els.companyName.textContent = state.currentCompany.name;
    els.companyWebsite.textContent = state.currentCompany.website || 'No website';
    els.companyStatus.textContent = state.status || 'Reviewing…';
    // Show popup fallback actions when reviewing
    if (state.isRunning) {
      els.popupActions.style.display = 'block';
    }
  } else {
    els.popupActions.style.display = 'none';
  }

  els.startReview.disabled = !state.canStart;
  els.stopReview.disabled = !state.isRunning;
  els.fetchCompanies.disabled = state.isRunning || !configValid;
  els.fetchExisting.disabled = state.isRunning || !configValid;

  // Restore logs
  if (state.logs && state.logs.length > 0) {
    els.logPanel.style.display = 'block';
    els.logPanel.innerHTML = '';
    state.logs.forEach((l) => addLog(l.text, l.level, false));
  }
}

function addLog(text, level = 'info', scroll = true) {
  els.logPanel.style.display = 'block';
  const entry = document.createElement('div');
  entry.className = `log-entry ${level}`;
  entry.textContent = text;
  els.logPanel.appendChild(entry);
  if (scroll) els.logPanel.scrollTop = els.logPanel.scrollHeight;
}

// ── Save Config ──
els.saveConfig.addEventListener('click', () => {
  const url = els.supabaseUrl.value.trim().replace(/\/+$/, '');
  const key = els.supabaseKey.value.trim();
  if (!url || !key) return addLog('Please fill in both fields', 'error');
  chrome.storage.local.set({ supabaseUrl: url, supabaseKey: key }, () => {
    configValid = true;
    els.fetchCompanies.disabled = false;
    els.fetchExisting.disabled = false;
    addLog('Config saved', 'success');
  });
});

// ── Test Connection ──
els.testConnection.addEventListener('click', async () => {
  const url = els.supabaseUrl.value.trim().replace(/\/+$/, '');
  const key = els.supabaseKey.value.trim();
  if (!url || !key) return addLog('Please fill in both fields', 'error');

  addLog('Testing connection…', 'info');
  try {
    const res = await fetch(`${url}/rest/v1/companies?select=id&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (res.ok) {
      addLog('Connection successful!', 'success');
    } else {
      addLog(`Connection failed: ${res.status} ${res.statusText}`, 'error');
    }
  } catch (e) {
    addLog(`Connection error: ${e.message}`, 'error');
  }
});

// ── Fetch Companies ──
els.fetchCompanies.addEventListener('click', () => {
  mode = 'new';
  addLog('Fetching companies…', 'info');
  chrome.runtime.sendMessage({ type: 'FETCH_COMPANIES' }, (resp) => {
    if (resp && resp.error) {
      addLog(`Error: ${resp.error}`, 'error');
    } else if (resp) {
      cachedCompanies = resp.companies || [];
      addLog(`Found ${resp.count} companies without career pages`, 'success');
      els.stats.style.display = 'block';
      els.progressContainer.style.display = 'block';
      els.remaining.textContent = resp.count;
      els.startReview.disabled = resp.count === 0;
    }
  });
});

// ── Fetch Existing (Verify mode) ──
els.fetchExisting.addEventListener('click', () => {
  mode = 'verify';
  addLog('Fetching existing career URLs…', 'info');
  chrome.runtime.sendMessage({ type: 'FETCH_EXISTING' }, (resp) => {
    if (resp && resp.error) {
      addLog(`Error: ${resp.error}`, 'error');
    } else if (resp) {
      cachedCompanies = resp.companies || [];
      addLog(`Found ${resp.count} companies with existing career URLs`, 'success');
      els.stats.style.display = 'block';
      els.progressContainer.style.display = 'block';
      els.remaining.textContent = resp.count;
      els.startReview.disabled = resp.count === 0;
    }
  });
});

// ── Start Review ──
els.startReview.addEventListener('click', () => {
  addLog(`Starting ${mode === 'verify' ? 'verification' : 'review'}…`, 'info');
  chrome.runtime.sendMessage({ type: 'START_REVIEW', companies: cachedCompanies, mode });
  els.startReview.disabled = true;
  els.stopReview.disabled = false;
  els.fetchCompanies.disabled = true;
  els.fetchExisting.disabled = true;
});

// ── Stop Review ──
els.stopReview.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'STOP_REVIEW' });
  addLog('Stopping…', 'info');
  els.stopReview.disabled = true;
});

// ── Popup Fallback Actions ──
els.popupSave.addEventListener('click', () => {
  const url = els.popupUrlInput.value.trim();
  if (!url) return addLog('Enter a URL to save', 'error');
  chrome.runtime.sendMessage({ type: 'SAVE_URL', url });
  els.popupUrlInput.value = '';
});

els.popupSkip.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'SKIP' });
});

els.popupNoCareers.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'NO_CAREERS' });
});

// ── Verify Data ──
els.verifyData.addEventListener('click', async () => {
  const url = els.supabaseUrl.value.trim().replace(/\/+$/, '');
  const key = els.supabaseKey.value.trim();
  if (!url || !key) return addLog('Configure Supabase first', 'error');

  addLog('Querying all career_pages…', 'info');
  try {
    const headers = { apikey: key, Authorization: `Bearer ${key}` };

    // Fetch ALL career_pages rows
    const res = await fetch(
      `${url}/rest/v1/career_pages?select=company_id,career_url,scraped_from,scraped_at&order=scraped_at.desc`,
      { headers }
    );
    if (!res.ok) return addLog(`Query failed: ${res.status}`, 'error');
    const rows = await res.json();

    if (rows.length === 0) {
      addLog('No career_pages rows found', 'info');
      return;
    }

    // Get all company names
    const ids = [...new Set(rows.map((r) => r.company_id))];
    const nameMap = {};
    // Fetch in batches of 50 to avoid URL length limits
    for (let i = 0; i < ids.length; i += 50) {
      const batch = ids.slice(i, i + 50);
      const compRes = await fetch(
        `${url}/rest/v1/companies?id=in.(${batch.join(',')})&select=id,name`,
        { headers }
      );
      if (compRes.ok) {
        const companies = await compRes.json();
        companies.forEach((c) => (nameMap[c.id] = c.name));
      }
    }

    // Group by source
    const bySource = {};
    rows.forEach((r) => {
      const src = r.scraped_from || 'unknown';
      if (!bySource[src]) bySource[src] = [];
      bySource[src].push(r);
    });

    addLog(`=== ${rows.length} total career_pages rows ===`, 'success');

    for (const [source, sourceRows] of Object.entries(bySource)) {
      addLog(`--- ${source} (${sourceRows.length}) ---`, 'info');
      sourceRows.forEach((r) => {
        const name = nameMap[r.company_id] || r.company_id;
        const urlDisplay = r.career_url || '(no careers page)';
        const time = r.scraped_at ? new Date(r.scraped_at).toLocaleString() : '';
        const level = source.includes('manual-verifier') ? (r.career_url ? 'success' : 'skip') : 'info';
        addLog(`  ${name}: ${urlDisplay}  ${time}`, level);
      });
    }
    addLog(`=== End ===`, 'info');
  } catch (e) {
    addLog(`Verify error: ${e.message}`, 'error');
  }
});
