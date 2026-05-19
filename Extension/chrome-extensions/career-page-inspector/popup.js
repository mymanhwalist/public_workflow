/**
 * Career Page Inspector - Popup Script
 */

let careerPages = [];
let inspectionInProgress = false;

// DOM Elements
const configSection = document.getElementById('config-section');
const statsSection = document.getElementById('stats-section');
const progressSection = document.getElementById('progress-section');
const logSection = document.getElementById('log-section');

const supabaseUrlInput = document.getElementById('supabase-url');
const supabaseKeyInput = document.getElementById('supabase-key');
const saveConfigBtn = document.getElementById('save-config');
const testConnectionBtn = document.getElementById('test-connection');
const fetchPagesBtn = document.getElementById('fetch-pages');
const startInspectionBtn = document.getElementById('start-inspection');
const stopInspectionBtn = document.getElementById('stop-inspection');

const totalPagesEl = document.getElementById('total-pages');
const inspectedPagesEl = document.getElementById('inspected-pages');
const progressFillEl = document.getElementById('progress-fill');
const statusEl = document.getElementById('status');
const logEl = document.getElementById('log');

// Load configuration on startup
loadConfiguration();

// Event Listeners
saveConfigBtn.addEventListener('click', saveConfiguration);
testConnectionBtn.addEventListener('click', testSupabaseConnection);
fetchPagesBtn.addEventListener('click', fetchCareerPages);
startInspectionBtn.addEventListener('click', startInspection);
stopInspectionBtn.addEventListener('click', stopInspection);

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'inspectionLog') {
    addLog(message.message, message.type);
  } else if (message.action === 'inspectionProgress') {
    updateProgress(message.progress);
  } else if (message.action === 'inspectionComplete') {
    onInspectionComplete(message.count);
  } else if (message.action === 'inspectionStopped') {
    onInspectionStopped(message.count);
  }
});

/**
 * Load Supabase configuration from storage
 */
async function loadConfiguration() {
  const config = await chrome.storage.local.get(['supabaseUrl', 'supabaseKey']);

  if (config.supabaseUrl && config.supabaseKey) {
    supabaseUrlInput.value = config.supabaseUrl;
    supabaseKeyInput.value = config.supabaseKey;

    // Show stats section
    configSection.classList.add('hidden');
    statsSection.classList.remove('hidden');

    addLog('Configuration loaded', 'success');
  }
}

/**
 * Save Supabase configuration
 */
async function saveConfiguration() {
  const url = supabaseUrlInput.value.trim();
  const key = supabaseKeyInput.value.trim();

  if (!url || !key) {
    addLog('Please enter both URL and key', 'error');
    return;
  }

  await chrome.storage.local.set({ supabaseUrl: url, supabaseKey: key });

  addLog('Configuration saved!', 'success');

  configSection.classList.add('hidden');
  statsSection.classList.remove('hidden');
  logSection.classList.remove('hidden');
}

/**
 * Test Supabase connection
 */
async function testSupabaseConnection() {
  const url = supabaseUrlInput.value.trim();
  const key = supabaseKeyInput.value.trim();

  if (!url || !key) {
    addLog('Please enter both URL and key first', 'error');
    return;
  }

  testConnectionBtn.disabled = true;
  testConnectionBtn.textContent = 'Testing...';
  addLog('Testing Supabase connection...', 'info');

  try {
    // Test connection by querying career_pages table
    const response = await fetch(
      `${url}/rest/v1/career_pages?limit=1`,
      {
        headers: {
          'apikey': key,
          'Authorization': `Bearer ${key}`
        }
      }
    );

    if (response.ok) {
      addLog('✓ Connection successful!', 'success');
      addLog(`Connected to: ${url}`, 'info');
    } else {
      const errorText = await response.text();
      addLog(`✗ Connection failed: ${response.status}`, 'error');
      addLog(`Error: ${errorText}`, 'error');
    }
  } catch (error) {
    addLog(`✗ Connection error: ${error.message}`, 'error');
  } finally {
    testConnectionBtn.disabled = false;
    testConnectionBtn.textContent = 'Test Connection';
  }
}

/**
 * Fetch career pages from Supabase
 */
async function fetchCareerPages() {
  addLog('Fetching career pages from Supabase...', 'info');
  fetchPagesBtn.disabled = true;
  fetchPagesBtn.textContent = 'Fetching...';

  try {
    const config = await chrome.storage.local.get(['supabaseUrl', 'supabaseKey']);

    // Fetch pages where website_url exists and starts with http, but job_table is null (not yet inspected)
    // Order by company_name for consistent processing
    const response = await fetch(
      `${config.supabaseUrl}/rest/v1/career_pages?website_url=like.http*&job_table=is.null&select=id,company_name,website_url,career_page_url&order=company_name.asc`,
      {
        headers: {
          'apikey': config.supabaseKey,
          'Authorization': `Bearer ${config.supabaseKey}`
        }
      }
    );

    if (!response.ok) {
      throw new Error(`Supabase error: ${response.status}`);
    }

    careerPages = await response.json();

    totalPagesEl.textContent = careerPages.length;
    inspectedPagesEl.textContent = '0';

    addLog(`Fetched ${careerPages.length} pages to inspect`, 'success');

    // Log first few companies for debugging
    if (careerPages.length > 0) {
      const preview = careerPages.slice(0, 3).map(p => p.company_name).join(', ');
      addLog(`Starting with: ${preview}...`, 'info');
    }

    if (careerPages.length > 0) {
      startInspectionBtn.disabled = false;
      progressSection.classList.remove('hidden');
    } else {
      addLog('No pages need inspection', 'info');
    }

  } catch (error) {
    addLog(`Error: ${error.message}`, 'error');
  } finally {
    fetchPagesBtn.disabled = false;
    fetchPagesBtn.textContent = 'Fetch Career Pages';
  }
}

/**
 * Start batch inspection
 */
async function startInspection() {
  if (careerPages.length === 0) {
    addLog('No pages to inspect', 'error');
    return;
  }

  inspectionInProgress = true;

  startInspectionBtn.classList.add('hidden');
  stopInspectionBtn.classList.remove('hidden');
  fetchPagesBtn.disabled = true;

  statusEl.textContent = 'Inspection in progress...';
  statusEl.className = 'status status-running';

  logSection.classList.remove('hidden');
  addLog(`Starting inspection of ${careerPages.length} pages...`, 'info');

  // Send to background script for processing
  chrome.runtime.sendMessage({
    action: 'startBatchInspection',
    pages: careerPages
  });
}

/**
 * Stop inspection
 */
function stopInspection() {
  chrome.runtime.sendMessage({ action: 'stopInspection' });
  addLog('Stopping inspection...', 'info');
}

/**
 * Update progress bar
 */
function updateProgress(progress) {
  const percentage = Math.round((progress.current / progress.total) * 100);
  progressFillEl.style.width = `${percentage}%`;
  inspectedPagesEl.textContent = progress.current;
  statusEl.textContent = `Inspecting: ${progress.current}/${progress.total} (${percentage}%)`;
}

/**
 * Handle inspection completion
 */
function onInspectionComplete(count) {
  inspectionInProgress = false;

  startInspectionBtn.classList.remove('hidden');
  stopInspectionBtn.classList.add('hidden');
  fetchPagesBtn.disabled = false;

  statusEl.textContent = `Completed! Inspected ${count} pages`;
  statusEl.className = 'status status-ready';

  addLog(`✓ Inspection complete: ${count} pages`, 'success');

  progressFillEl.style.width = '100%';
}

/**
 * Handle inspection stopped
 */
function onInspectionStopped(count) {
  inspectionInProgress = false;

  startInspectionBtn.classList.remove('hidden');
  stopInspectionBtn.classList.add('hidden');
  fetchPagesBtn.disabled = false;

  statusEl.textContent = `Stopped at ${count} pages`;
  statusEl.className = 'status status-ready';

  addLog(`Stopped: ${count} pages inspected`, 'info');
}

/**
 * Add log entry
 */
function addLog(message, type = 'info') {
  const entry = document.createElement('div');
  entry.className = `log-entry log-${type}`;
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;

  logEl.appendChild(entry);
  logEl.scrollTop = logEl.scrollHeight;
}

