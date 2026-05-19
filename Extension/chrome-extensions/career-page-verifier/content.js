// Prevent double-injection
if (window.__careerVerifierInjected) {
  // Already injected — just listen for new INIT_OVERLAY
} else {
  window.__careerVerifierInjected = true;

  let overlay = null;
  let urlInput = null;
  let companyData = null;
  let detectedATS = null;

  // ATS providers with public APIs
  const ATS_PATTERNS = [
    {
      provider: 'Lever',
      regex: /jobs\.lever\.co\/([a-zA-Z0-9_-]+)/,
      apiEndpoint: (id) => `https://api.lever.co/v0/postings/${id}`,
      careerUrl: (id) => `https://jobs.lever.co/${id}`,
    },
    {
      provider: 'Greenhouse',
      regex: /boards\.greenhouse\.io\/([a-zA-Z0-9_-]+)/,
      apiEndpoint: (id) => `https://boards-api.greenhouse.io/v1/boards/${id}/jobs`,
      careerUrl: (id) => `https://boards.greenhouse.io/${id}`,
    },
    {
      provider: 'Ashby',
      regex: /jobs\.ashbyhq\.com\/([a-zA-Z0-9_-]+)/,
      apiEndpoint: (id) => `https://api.ashbyhq.com/posting-api/job-board/${id}`,
      careerUrl: (id) => `https://jobs.ashbyhq.com/${id}`,
    },
    {
      provider: 'Workable',
      regex: /apply\.workable\.com\/([a-zA-Z0-9_-]+)/,
      apiEndpoint: (id) => `https://apply.workable.com/api/v1/widget/${id}`,
      careerUrl: (id) => `https://apply.workable.com/${id}`,
    },
    {
      provider: 'SmartRecruiters',
      regex: /jobs\.smartrecruiters\.com\/([a-zA-Z0-9_-]+)/,
      apiEndpoint: (id) => `https://api.smartrecruiters.com/v1/companies/${id}/postings`,
      careerUrl: (id) => `https://jobs.smartrecruiters.com/${id}`,
    },
    {
      provider: 'Jobvite',
      regex: /jobs\.jobvite\.com\/([a-zA-Z0-9_-]+)/,
      apiEndpoint: (id) => `https://jobs.jobvite.com/${id}/jobs`,
      careerUrl: (id) => `https://jobs.jobvite.com/${id}`,
    },
    {
      provider: 'BambooHR',
      regex: /([a-zA-Z0-9_-]+)\.bamboohr\.com/,
      apiEndpoint: (id) => `https://api.bamboohr.com/api/gateway.php/${id}/v1/applicant_tracking/jobs`,
      careerUrl: (id) => `https://${id}.bamboohr.com/careers`,
    },
    {
      provider: 'Recruitee',
      regex: /([a-zA-Z0-9_-]+)\.recruitee\.com/,
      apiEndpoint: (id) => `https://${id}.recruitee.com/api/offers`,
      careerUrl: (id) => `https://${id}.recruitee.com`,
    },
    {
      provider: 'Personio',
      regex: /([a-zA-Z0-9_-]+)\.jobs\.personio\.com/,
      apiEndpoint: (id) => `https://${id}.jobs.personio.com/xml`,
      careerUrl: (id) => `https://${id}.jobs.personio.com`,
    },
    {
      provider: 'JazzHR',
      regex: /([a-zA-Z0-9_-]+)\.applytojob\.com/,
      apiEndpoint: () => `https://api.resumatorapi.com/v1/jobs`,
      careerUrl: (id) => `https://${id}.applytojob.com`,
    },
    {
      provider: 'Breezy HR',
      regex: /([a-zA-Z0-9_-]+)\.breezy\.hr/,
      apiEndpoint: (id) => `https://${id}.breezy.hr/json`,
      careerUrl: (id) => `https://${id}.breezy.hr`,
    },
  ];

  function scanPageForATS() {
    const urls = new Set();
    // Add current page URL
    urls.add(location.href);
    // Collect all link hrefs
    document.querySelectorAll('a[href]').forEach((a) => {
      const href = a.href;
      if (href && href.startsWith('http')) urls.add(href);
    });

    for (const url of urls) {
      for (const pattern of ATS_PATTERNS) {
        const match = url.match(pattern.regex);
        if (match) {
          const id = match[1];
          return {
            provider: pattern.provider,
            careerUrl: pattern.careerUrl(id),
            apiEndpoint: pattern.apiEndpoint(id),
          };
        }
      }
    }
    return null;
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'ping') {
      sendResponse({ pong: true });
      return;
    }
    if (msg.type === 'INIT_OVERLAY') {
      companyData = msg.company;
      createOverlay();
    }
    if (msg.type === 'INIT_VERIFY_OVERLAY') {
      companyData = msg.company;
      createVerifyOverlay();
    }
  });

  function createOverlay() {
    // Remove existing overlay if any
    const existing = document.getElementById('cpv-overlay');
    if (existing) existing.remove();

    overlay = document.createElement('div');
    overlay.id = 'cpv-overlay';
    overlay.innerHTML = `
      <style>
        #cpv-overlay {
          position: fixed; bottom: 20px; right: 20px; z-index: 2147483647;
          width: 360px; background: #1a1a2e; border: 1px solid #333; border-radius: 10px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          color: #e0e0e0; box-shadow: 0 8px 32px rgba(0,0,0,0.5);
          padding: 16px; font-size: 13px;
        }
        #cpv-overlay * { box-sizing: border-box; }
        #cpv-overlay .cpv-header {
          font-size: 11px; color: #4361ee; font-weight: 600;
          text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;
        }
        #cpv-overlay .cpv-company {
          font-size: 15px; font-weight: 700; color: #fff; margin-bottom: 12px;
        }
        #cpv-overlay .cpv-label {
          font-size: 11px; color: #888; margin-bottom: 4px;
        }
        #cpv-overlay .cpv-url-input {
          width: 100%; padding: 8px 10px; background: #16213e; border: 1px solid #333;
          border-radius: 6px; color: #e0e0e0; font-size: 12px; margin-bottom: 12px;
          font-family: 'SF Mono', monospace;
        }
        #cpv-overlay .cpv-url-input:focus { border-color: #4361ee; outline: none; }
        #cpv-overlay .cpv-buttons { display: flex; gap: 8px; flex-wrap: wrap; }
        #cpv-overlay .cpv-btn {
          padding: 8px 14px; border: none; border-radius: 6px; cursor: pointer;
          font-size: 12px; font-weight: 600; transition: opacity 0.2s; flex: 1;
          min-width: 0;
        }
        #cpv-overlay .cpv-btn:hover { opacity: 0.85; }
        #cpv-overlay .cpv-btn-save { background: #2ecc71; color: #fff; }
        #cpv-overlay .cpv-btn-skip { background: #555; color: #ddd; }
        #cpv-overlay .cpv-btn-none { background: #e67e22; color: #fff; }
        #cpv-overlay .cpv-confirm {
          margin-top: 10px; padding: 8px; background: #2ecc71; color: #fff;
          border-radius: 6px; text-align: center; font-weight: 600; display: none;
        }
        #cpv-overlay .cpv-ats-badge {
          font-size: 11px; color: #2ecc71; font-weight: 600; margin: -8px 0 10px 0;
        }
      </style>
      <div class="cpv-header">Career Page Verifier</div>
      <div class="cpv-company">${escapeHtml(companyData.name)}</div>
      <div class="cpv-label">Career Page URL</div>
      <input class="cpv-url-input" id="cpv-url" type="text" value="${escapeHtml(location.href)}">
      <div class="cpv-ats-badge" id="cpv-ats-badge"></div>
      <div class="cpv-buttons">
        <button class="cpv-btn cpv-btn-save" id="cpv-save">Save This URL</button>
        <button class="cpv-btn cpv-btn-skip" id="cpv-skip">Skip</button>
        <button class="cpv-btn cpv-btn-none" id="cpv-none">No Careers Page</button>
      </div>
      <div class="cpv-confirm" id="cpv-confirm">Saved!</div>
    `;

    document.body.appendChild(overlay);

    urlInput = document.getElementById('cpv-url');

    // Scan page for ATS links
    detectedATS = scanPageForATS();
    if (detectedATS) {
      urlInput.value = detectedATS.careerUrl;
      const badge = document.getElementById('cpv-ats-badge');
      badge.textContent = `Detected: ${detectedATS.provider} API`;
    }

    // Auto-update URL on navigation (only if no ATS detected)
    const observer = new MutationObserver(() => {
      if (urlInput && document.activeElement !== urlInput && !detectedATS) {
        urlInput.value = location.href;
      }
    });
    observer.observe(document, { subtree: true, childList: true });

    // Also update on popstate / hashchange
    const updateUrl = () => {
      if (urlInput && document.activeElement !== urlInput && !detectedATS) {
        urlInput.value = location.href;
      }
    };
    window.addEventListener('popstate', updateUrl);
    window.addEventListener('hashchange', updateUrl);

    // Save
    document.getElementById('cpv-save').addEventListener('click', () => {
      const url = urlInput.value.trim();
      if (!url) return;
      const msg = { type: 'SAVE_URL', url };
      if (detectedATS) {
        msg.ats_provider = detectedATS.provider;
        msg.api_endpoint = detectedATS.apiEndpoint;
        msg.api_endpoint_detail = detectedATS.careerUrl;
      }
      chrome.runtime.sendMessage(msg);
      const confirm = document.getElementById('cpv-confirm');
      confirm.style.display = 'block';
      disableButtons();
    });

    // Skip
    document.getElementById('cpv-skip').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'SKIP' });
      disableButtons();
    });

    // No careers page
    document.getElementById('cpv-none').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'NO_CAREERS' });
      disableButtons();
    });
  }

  function createVerifyOverlay() {
    const existing = document.getElementById('cpv-overlay');
    if (existing) existing.remove();

    overlay = document.createElement('div');
    overlay.id = 'cpv-overlay';
    overlay.innerHTML = `
      <style>
        #cpv-overlay {
          position: fixed; bottom: 20px; right: 20px; z-index: 2147483647;
          width: 360px; background: #1a1a2e; border: 1px solid #333; border-radius: 10px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          color: #e0e0e0; box-shadow: 0 8px 32px rgba(0,0,0,0.5);
          padding: 16px; font-size: 13px;
        }
        #cpv-overlay * { box-sizing: border-box; }
        #cpv-overlay .cpv-header {
          font-size: 11px; color: #e67e22; font-weight: 600;
          text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;
        }
        #cpv-overlay .cpv-company {
          font-size: 15px; font-weight: 700; color: #fff; margin-bottom: 12px;
        }
        #cpv-overlay .cpv-label {
          font-size: 11px; color: #888; margin-bottom: 4px;
        }
        #cpv-overlay .cpv-existing-url {
          font-size: 12px; color: #4361ee; margin-bottom: 12px; word-break: break-all;
          font-family: 'SF Mono', monospace;
        }
        #cpv-overlay .cpv-url-input {
          width: 100%; padding: 8px 10px; background: #16213e; border: 1px solid #333;
          border-radius: 6px; color: #e0e0e0; font-size: 12px; margin-bottom: 12px;
          font-family: 'SF Mono', monospace;
        }
        #cpv-overlay .cpv-url-input:focus { border-color: #4361ee; outline: none; }
        #cpv-overlay .cpv-buttons { display: flex; gap: 8px; flex-wrap: wrap; }
        #cpv-overlay .cpv-btn {
          padding: 8px 14px; border: none; border-radius: 6px; cursor: pointer;
          font-size: 12px; font-weight: 600; transition: opacity 0.2s; flex: 1;
          min-width: 0;
        }
        #cpv-overlay .cpv-btn:hover { opacity: 0.85; }
        #cpv-overlay .cpv-btn-confirm { background: #2ecc71; color: #fff; }
        #cpv-overlay .cpv-btn-update { background: #4361ee; color: #fff; }
        #cpv-overlay .cpv-btn-invalid { background: #e74c3c; color: #fff; }
        #cpv-overlay .cpv-btn-skip { background: #555; color: #ddd; }
        #cpv-overlay .cpv-feedback {
          margin-top: 10px; padding: 8px; background: #2ecc71; color: #fff;
          border-radius: 6px; text-align: center; font-weight: 600; display: none;
        }
      </style>
      <div class="cpv-header">Verify Career URL</div>
      <div class="cpv-company">${escapeHtml(companyData.name)}</div>
      <div class="cpv-label">Existing URL</div>
      <div class="cpv-existing-url">${escapeHtml(companyData.career_url)}</div>
      <div class="cpv-label">Current Page URL</div>
      <input class="cpv-url-input" id="cpv-url" type="text" value="${escapeHtml(location.href)}">
      <div class="cpv-buttons">
        <button class="cpv-btn cpv-btn-confirm" id="cpv-confirm-btn">Confirm</button>
        <button class="cpv-btn cpv-btn-update" id="cpv-update-btn">Update URL</button>
        <button class="cpv-btn cpv-btn-invalid" id="cpv-invalid-btn">Mark Invalid</button>
        <button class="cpv-btn cpv-btn-skip" id="cpv-skip">Skip</button>
      </div>
      <div class="cpv-feedback" id="cpv-feedback"></div>
    `;

    document.body.appendChild(overlay);

    urlInput = document.getElementById('cpv-url');

    // Auto-update URL on navigation
    const observer = new MutationObserver(() => {
      if (urlInput && document.activeElement !== urlInput) {
        urlInput.value = location.href;
      }
    });
    observer.observe(document, { subtree: true, childList: true });

    const updateUrl = () => {
      if (urlInput && document.activeElement !== urlInput) {
        urlInput.value = location.href;
      }
    };
    window.addEventListener('popstate', updateUrl);
    window.addEventListener('hashchange', updateUrl);

    // Confirm — URL is correct
    document.getElementById('cpv-confirm-btn').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'CONFIRM_URL' });
      const fb = document.getElementById('cpv-feedback');
      fb.textContent = 'Confirmed!';
      fb.style.background = '#2ecc71';
      fb.style.display = 'block';
      disableButtons();
    });

    // Update — replace with current page URL
    document.getElementById('cpv-update-btn').addEventListener('click', () => {
      const url = urlInput.value.trim();
      if (!url) return;
      chrome.runtime.sendMessage({ type: 'UPDATE_URL', url });
      const fb = document.getElementById('cpv-feedback');
      fb.textContent = 'Updated!';
      fb.style.background = '#4361ee';
      fb.style.display = 'block';
      disableButtons();
    });

    // Mark Invalid — URL is broken
    document.getElementById('cpv-invalid-btn').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'MARK_INVALID' });
      const fb = document.getElementById('cpv-feedback');
      fb.textContent = 'Marked Invalid';
      fb.style.background = '#e74c3c';
      fb.style.display = 'block';
      disableButtons();
    });

    // Skip
    document.getElementById('cpv-skip').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'SKIP' });
      disableButtons();
    });
  }

  function disableButtons() {
    const btns = overlay.querySelectorAll('.cpv-btn');
    btns.forEach((b) => {
      b.disabled = true;
      b.style.opacity = '0.4';
      b.style.cursor = 'not-allowed';
    });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }
}
