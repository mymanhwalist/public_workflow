// DOM Elements
const supabaseUrlInput = document.getElementById('supabaseUrl');
const supabaseKeyInput = document.getElementById('supabaseKey');
const tableNameInput = document.getElementById('tableName');
const urlColumnInput = document.getElementById('urlColumn');
const apiColumnInput = document.getElementById('apiColumn');
const saveConfigBtn = document.getElementById('saveConfig');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const statusDiv = document.getElementById('status');
const statusText = document.getElementById('statusText');
const progressDiv = document.getElementById('progress');

// Load saved configuration
async function loadConfig() {
    const config = await chrome.storage.local.get([
        'supabaseUrl',
        'supabaseKey',
        'tableName',
        'urlColumn',
        'apiColumn'
    ]);

    if (config.supabaseUrl) supabaseUrlInput.value = config.supabaseUrl;
    if (config.supabaseKey) supabaseKeyInput.value = config.supabaseKey;
    if (config.tableName) tableNameInput.value = config.tableName;
    if (config.urlColumn) urlColumnInput.value = config.urlColumn;
    if (config.apiColumn) apiColumnInput.value = config.apiColumn;
}

// Save configuration
async function saveConfig() {
    const config = {
        supabaseUrl: supabaseUrlInput.value.trim(),
        supabaseKey: supabaseKeyInput.value.trim(),
        tableName: tableNameInput.value.trim(),
        urlColumn: urlColumnInput.value.trim(),
        apiColumn: apiColumnInput.value.trim()
    };

    // Validate
    if (!config.supabaseUrl || !config.supabaseKey || !config.tableName ||
        !config.urlColumn || !config.apiColumn) {
        showStatus('error', 'Please fill in all fields');
        return;
    }

    // Validate URL format
    try {
        new URL(config.supabaseUrl);
    } catch (e) {
        showStatus('error', 'Invalid Supabase URL');
        return;
    }

    await chrome.storage.local.set(config);
    showStatus('success', 'Configuration saved successfully!');
}

// Show status message
function showStatus(type, message, progress = '') {
    statusDiv.className = `status ${type}`;
    statusText.textContent = message;
    progressDiv.textContent = progress;
}

// Start processing
async function startProcessing() {
    // Validate config first
    const config = await chrome.storage.local.get([
        'supabaseUrl',
        'supabaseKey',
        'tableName',
        'urlColumn',
        'apiColumn'
    ]);

    if (!config.supabaseUrl || !config.supabaseKey || !config.tableName ||
        !config.urlColumn || !config.apiColumn) {
        showStatus('error', 'Please save configuration first');
        return;
    }

    // Send message to background script
    chrome.runtime.sendMessage({ action: 'start' }, (response) => {
        if (response && response.success) {
            startBtn.disabled = true;
            stopBtn.disabled = false;
            showStatus('info', 'Starting...', '');
        } else {
            showStatus('error', response?.error || 'Failed to start');
        }
    });
}

// Stop processing
function stopProcessing() {
    chrome.runtime.sendMessage({ action: 'stop' }, (response) => {
        startBtn.disabled = false;
        stopBtn.disabled = true;
        showStatus('info', 'Stopping...', '');
    });
}

// Listen for status updates from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'status') {
        showStatus(message.status, message.message, message.progress || '');

        if (message.status === 'success' || message.status === 'error') {
            startBtn.disabled = false;
            stopBtn.disabled = true;
        } else if (message.status === 'info') {
            startBtn.disabled = true;
            stopBtn.disabled = false;
        }
    }
});

// Event listeners
saveConfigBtn.addEventListener('click', saveConfig);
startBtn.addEventListener('click', startProcessing);
stopBtn.addEventListener('click', stopProcessing);

// Initialize
loadConfig();

// Check if processing is already running
chrome.runtime.sendMessage({ action: 'getStatus' }, (response) => {
    if (response && response.isRunning) {
        startBtn.disabled = true;
        stopBtn.disabled = false;
        showStatus('info', 'Processing in progress...', response.progress || '');
    }
});
