/**
 * Career Page Finder - Popup Script
 */

let companies = [];
let collectionInProgress = false;

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
const startCollectionBtn = document.getElementById('start-collection');
const stopCollectionBtn = document.getElementById('stop-collection');

const totalPagesEl = document.getElementById('total-pages');
const savedPagesEl = document.getElementById('saved-pages');
const progressFillEl = document.getElementById('progress-fill');
const statusEl = document.getElementById('status');
const logEl = document.getElementById('log');

// Load configuration on startup
loadConfiguration();

// Event Listeners
saveConfigBtn.addEventListener('click', saveConfiguration);
testConnectionBtn.addEventListener('click', testSupabaseConnection);
fetchPagesBtn.addEventListener('click', fetchCompanies);
startCollectionBtn.addEventListener('click', startCollection);
stopCollectionBtn.addEventListener('click', stopCollection);

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'collectionLog') {
    addLog(message.message, message.type);
  } else if (message.action === 'collectionProgress') {
    updateProgress(message.progress);
  } else if (message.action === 'collectionComplete') {
    onCollectionComplete(message.count);
  } else if (message.action === 'collectionStopped') {
    onCollectionStopped(message.count);
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
 * Fetch companies from Supabase (where career_page_url is null)
 */
async function fetchCompanies() {
  addLog('Fetching companies from Supabase...', 'info');
  fetchPagesBtn.disabled = true;
  fetchPagesBtn.textContent = 'Fetching...';

  try {
    const config = await chrome.storage.local.get(['supabaseUrl', 'supabaseKey']);

    // Fetch companies where:
    // - website_url exists
    // - career_page_url is null (not processed yet)
    // This automatically excludes SKIPPED and TODO entries
    const response = await fetch(
      `${config.supabaseUrl}/rest/v1/career_pages?website_url=like.http*&career_page_url=is.null&select=id,company_name,website_url&order=company_name.asc`,
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

    companies = await response.json();

    totalPagesEl.textContent = companies.length;
    savedPagesEl.textContent = '0';

    addLog(`Fetched ${companies.length} companies to process`, 'success');

    // Log first few companies for debugging
    if (companies.length > 0) {
      const preview = companies.slice(0, 3).map(p => p.company_name).join(', ');
      addLog(`Starting with: ${preview}...`, 'info');
    }

    if (companies.length > 0) {
      startCollectionBtn.disabled = false;
      progressSection.classList.remove('hidden');
    } else {
      addLog('No companies need career page URLs', 'info');
    }

  } catch (error) {
    addLog(`Error: ${error.message}`, 'error');
  } finally {
    fetchPagesBtn.disabled = false;
    fetchPagesBtn.textContent = 'Fetch Companies';
  }
}

/**
 * Start batch collection
 */
async function startCollection() {
  if (companies.length === 0) {
    addLog('No companies to process', 'error');
    return;
  }

  collectionInProgress = true;

  startCollectionBtn.classList.add('hidden');
  stopCollectionBtn.classList.remove('hidden');
  fetchPagesBtn.disabled = true;

  statusEl.textContent = 'Collection in progress...';
  statusEl.className = 'status status-running';

  logSection.classList.remove('hidden');
  addLog(`Starting collection of ${companies.length} companies...`, 'info');

  // Send to background script for processing
  chrome.runtime.sendMessage({
    action: 'startBatchCollection',
    companies: companies
  });
}

/**
 * Stop collection
 */
function stopCollection() {
  chrome.runtime.sendMessage({ action: 'stopCollection' });
  addLog('Stopping collection...', 'info');
}

/**
 * Update progress bar
 */
function updateProgress(progress) {
  const percentage = Math.round((progress.current / progress.total) * 100);
  progressFillEl.style.width = `${percentage}%`;
  savedPagesEl.textContent = progress.current;
  statusEl.textContent = `Processing: ${progress.current}/${progress.total} (${percentage}%)`;
}

/**
 * Handle collection completion
 */
function onCollectionComplete(count) {
  collectionInProgress = false;

  startCollectionBtn.classList.remove('hidden');
  stopCollectionBtn.classList.add('hidden');
  fetchPagesBtn.disabled = false;

  statusEl.textContent = `Completed! Saved ${count} career pages`;
  statusEl.className = 'status status-ready';

  addLog(`✓ Collection complete: ${count} pages`, 'success');

  progressFillEl.style.width = '100%';
}

/**
 * Handle collection stopped
 */
function onCollectionStopped(count) {
  collectionInProgress = false;

  startCollectionBtn.classList.remove('hidden');
  stopCollectionBtn.classList.add('hidden');
  fetchPagesBtn.disabled = false;

  statusEl.textContent = `Stopped at ${count} pages`;
  statusEl.className = 'status status-ready';

  addLog(`Stopped: ${count} pages saved`, 'info');
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
