/**
 * Options Page Controller
 */

const supabaseUrlInput = document.getElementById('supabaseUrl');
const supabaseKeyInput = document.getElementById('supabaseKey');
const saveBtn = document.getElementById('saveBtn');
const testBtn = document.getElementById('testBtn');
const statusDiv = document.getElementById('status');

// Load saved settings
document.addEventListener('DOMContentLoaded', async () => {
  const settings = await chrome.storage.local.get(['supabaseUrl', 'supabaseKey']);

  if (settings.supabaseUrl) {
    supabaseUrlInput.value = settings.supabaseUrl;
  }

  if (settings.supabaseKey) {
    supabaseKeyInput.value = settings.supabaseKey;
  }
});

// Save settings
saveBtn.addEventListener('click', async () => {
  const url = supabaseUrlInput.value.trim();
  const key = supabaseKeyInput.value.trim();

  if (!url || !key) {
    showStatus('Please fill in both fields', 'error');
    return;
  }

  // Validate URL format
  if (!url.startsWith('https://') || !url.includes('supabase.co')) {
    showStatus('Invalid Supabase URL format', 'error');
    return;
  }

  // Save to storage
  await chrome.storage.local.set({
    supabaseUrl: url,
    supabaseKey: key
  });

  showStatus('✓ Settings saved successfully!', 'success');
});

// Test connection
testBtn.addEventListener('click', async () => {
  const url = supabaseUrlInput.value.trim();
  const key = supabaseKeyInput.value.trim();

  if (!url || !key) {
    showStatus('Please fill in both fields first', 'error');
    return;
  }

  showStatus('Testing connection...', 'info');

  try {
    // Try to fetch from Supabase
    const response = await fetch(`${url}/rest/v1/`, {
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`
      }
    });

    if (response.ok || response.status === 404) {
      // 404 is fine - means API is accessible but root endpoint doesn't exist
      showStatus('✓ Connection successful!', 'success');
    } else {
      showStatus(`✗ Connection failed: ${response.status} ${response.statusText}`, 'error');
    }
  } catch (error) {
    showStatus(`✗ Connection error: ${error.message}`, 'error');
  }
});

// Helper: Show status message
function showStatus(message, type) {
  statusDiv.textContent = message;
  statusDiv.className = `status ${type} show`;

  // Auto-hide after 5 seconds
  setTimeout(() => {
    statusDiv.classList.remove('show');
  }, 5000);
}
