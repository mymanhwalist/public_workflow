// Popup script for Wellfound Companies Scraper

document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const companiesCountEl = document.getElementById('companiesCount');
  const careerPagesCountEl = document.getElementById('careerPagesCount');
  const startPageInput = document.getElementById('startPage');
  const endPageInput = document.getElementById('endPage');
  const startExtractionBtn = document.getElementById('startExtraction');
  const findCareerPagesBtn = document.getElementById('findCareerPages');
  const syncToSupabaseBtn = document.getElementById('syncToSupabase');
  const downloadDataBtn = document.getElementById('downloadData');
  const clearDataBtn = document.getElementById('clearData');
  const progressDiv = document.getElementById('progress');
  const progressText = document.getElementById('progressText');
  const progressFill = document.getElementById('progressFill');
  const messageDiv = document.getElementById('message');

  // Load initial status
  updateStatus();

  // Event listeners
  startExtractionBtn.addEventListener('click', startExtraction);
  findCareerPagesBtn.addEventListener('click', findCareerPages);
  syncToSupabaseBtn.addEventListener('click', syncToSupabase);
  downloadDataBtn.addEventListener('click', downloadData);
  clearDataBtn.addEventListener('click', clearData);

  // Listen for progress updates
  chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'extractionProgress') {
      showProgress(`Extracting page ${request.currentPage} of ${request.totalPages}...`);
      const progress = (request.currentPage / request.totalPages) * 100;
      progressFill.style.width = `${progress}%`;
      companiesCountEl.textContent = request.companiesCount;
      updateButtons();
    }

    if (request.action === 'extractionComplete') {
      hideProgress();
      showMessage(`✅ Extraction complete! ${request.companiesCount} companies scraped.`, 'success');
      updateStatus();
    }

    if (request.action === 'careerPagesComplete') {
      hideProgress();
      showMessage(`✅ Career page detection complete! Found ${request.found} career pages.`, 'success');
      updateStatus();
    }

    if (request.action === 'supabaseSyncProgress') {
      showProgress(request.message);
    }

    if (request.action === 'supabaseSyncComplete') {
      hideProgress();
      if (request.error) {
        showMessage(`❌ Supabase sync failed: ${request.error}`, 'error');
      } else {
        showMessage(`✅ Supabase sync complete! ${request.success} saved, ${request.failed} failed.`, 'success');
      }
      updateStatus();
    }
  });

  async function updateStatus() {
    const response = await chrome.runtime.sendMessage({ action: 'getStatus' });

    companiesCountEl.textContent = response.companiesCount;

    // Count companies with career pages
    const companiesWithCareerPages = await countCareerPages();
    careerPagesCountEl.textContent = companiesWithCareerPages;

    updateButtons();
  }

  async function countCareerPages() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['extractedCompanies'], (result) => {
        if (result.extractedCompanies) {
          const count = result.extractedCompanies.filter(c => c.careerPage).length;
          resolve(count);
        } else {
          resolve(0);
        }
      });
    });
  }

  function updateButtons() {
    const hasCompanies = parseInt(companiesCountEl.textContent) > 0;

    findCareerPagesBtn.disabled = !hasCompanies;
    syncToSupabaseBtn.disabled = !hasCompanies;
    downloadDataBtn.disabled = !hasCompanies;
    clearDataBtn.disabled = !hasCompanies;
  }

  async function startExtraction() {
    const startPage = parseInt(startPageInput.value);
    const endPage = parseInt(endPageInput.value);

    if (startPage < 1 || startPage > 960 || endPage < 1 || endPage > 960 || startPage > endPage) {
      showMessage('❌ Invalid page range. Pages must be between 1-960.', 'error');
      return;
    }

    const confirmed = confirm(
      `This will extract companies from pages ${startPage} to ${endPage}.\n\n` +
      `Estimated companies: ~${(endPage - startPage + 1) * 10}\n` +
      `Estimated time: ~${Math.ceil((endPage - startPage + 1) * 3 / 60)} minutes\n\n` +
      `Continue?`
    );

    if (!confirmed) return;

    showProgress(`Starting extraction...`);
    startExtractionBtn.disabled = true;

    await chrome.runtime.sendMessage({
      action: 'startExtraction',
      startPage,
      endPage
    });
  }

  async function findCareerPages() {
    const confirmed = confirm(
      `This will try to find career pages for all scraped companies.\n\n` +
      `This may take several minutes.\n\n` +
      `Continue?`
    );

    if (!confirmed) return;

    showProgress(`Finding career pages...`);
    findCareerPagesBtn.disabled = true;

    await chrome.runtime.sendMessage({ action: 'findCareerPages' });
  }

  async function syncToSupabase() {
    const companiesCount = parseInt(companiesCountEl.textContent);

    const confirmed = confirm(
      `This will sync ${companiesCount} companies to Supabase.\n\n` +
      `Make sure you've configured your Supabase credentials in config.js.\n\n` +
      `Continue?`
    );

    if (!confirmed) return;

    showProgress(`Syncing to Supabase...`);
    syncToSupabaseBtn.disabled = true;

    await chrome.runtime.sendMessage({ action: 'syncToSupabase' });

    // Re-enable button after sync
    setTimeout(() => {
      syncToSupabaseBtn.disabled = false;
    }, 2000);
  }

  async function downloadData() {
    await chrome.runtime.sendMessage({ action: 'downloadData' });
    showMessage('✅ Data downloaded!', 'success');
  }

  async function clearData() {
    const confirmed = confirm(
      `Are you sure you want to clear all scraped data?\n\n` +
      `This cannot be undone!`
    );

    if (!confirmed) return;

    await chrome.runtime.sendMessage({ action: 'clearData' });
    showMessage('🗑️ All data cleared.', 'success');
    await updateStatus();
  }

  function showProgress(text) {
    progressText.textContent = text;
    progressDiv.classList.add('active');
    progressFill.style.width = '0%';
    hideMessage();
  }

  function hideProgress() {
    progressDiv.classList.remove('active');
    startExtractionBtn.disabled = false;
    findCareerPagesBtn.disabled = false;
  }

  function showMessage(text, type) {
    messageDiv.textContent = text;
    messageDiv.className = `message ${type}`;
    setTimeout(() => hideMessage(), 5000);
  }

  function hideMessage() {
    messageDiv.className = 'message';
  }
});
