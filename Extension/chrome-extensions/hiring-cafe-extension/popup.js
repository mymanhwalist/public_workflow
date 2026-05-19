/**
 * Popup Controller
 */

// DOM Elements
const statusDiv = document.getElementById('status');
const settingsBtn = document.getElementById('settingsBtn');
const scrollBtn = document.getElementById('scrollBtn');
const maxScrollsInput = document.getElementById('maxScrolls');
const urlCountDiv = document.getElementById('urlCount');
const urlCountNum = document.getElementById('urlCountNum');

const extractBtn = document.getElementById('extractBtn');
const jobLimitInput = document.getElementById('jobLimit');
const extractionProgressDiv = document.getElementById('extractionProgress');
const progressFill = document.getElementById('progressFill');
const progressCurrent = document.getElementById('progressCurrent');
const progressTotal = document.getElementById('progressTotal');
const progressPercent = document.getElementById('progressPercent');
const extractionLog = document.getElementById('extractionLog');

const uploadBtn = document.getElementById('uploadBtn');
const downloadBtn = document.getElementById('downloadBtn');
const clearBtn = document.getElementById('clearBtn');
const jobInfo = document.getElementById('jobInfo');
const jobCount = document.getElementById('jobCount');
const supabaseStatusDiv = document.getElementById('supabaseStatus');

// State
let collectedJobs = []; // Array of { url, company } objects
let extractedJobs = [];
let supabaseConfig = null;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  // Load Supabase config
  supabaseConfig = await chrome.storage.local.get(['supabaseUrl', 'supabaseKey']);

  if (supabaseConfig.supabaseUrl && supabaseConfig.supabaseKey) {
    // Supabase configured
    supabaseStatusDiv.style.display = 'none';
  } else {
    // Not configured
    supabaseStatusDiv.classList.remove('hidden');
    uploadBtn.disabled = true;
  }

  // Load extracted jobs from storage
  const response = await chrome.runtime.sendMessage({ action: 'getExtractedJobs' });
  if (response && response.jobs && response.jobs.length > 0) {
    extractedJobs = response.jobs;
    updateJobInfo();
  }

  // Check if on hiring.cafe
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab.url || !tab.url.includes('hiring.cafe')) {
    setStatus('Please navigate to hiring.cafe first', 'warning');
    scrollBtn.disabled = true;
  }
});

// Settings button
settingsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// Step 1: Scroll to collect URLs
scrollBtn.addEventListener('click', async () => {
  const maxScrolls = parseInt(maxScrollsInput.value) || 10;

  setStatus('Scrolling to load jobs...', 'loading');
  scrollBtn.disabled = true;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // Ensure content scripts are injected
    await ensureContentScriptsLoaded(tab.id);

    await chrome.tabs.sendMessage(tab.id, {
      action: 'startAutoScroll',
      maxScrolls
    });

  } catch (error) {
    setStatus('Error: ' + error.message, 'error');
    scrollBtn.disabled = false;
  }
});

// Step 2: Extract jobs
extractBtn.addEventListener('click', async () => {
  if (collectedJobs.length === 0) {
    setStatus('No jobs collected. Please scroll first.', 'error');
    return;
  }

  // Get filter values
  const companyLimit = parseInt(document.getElementById('companyLimit').value) || 0;
  const jobsPerCompany = parseInt(document.getElementById('jobsPerCompany').value) || 0;
  const totalJobLimit = parseInt(jobLimitInput.value) || 0;

  // Apply company-based filtering
  const filteredJobs = filterJobsByCompany(collectedJobs, companyLimit, jobsPerCompany, totalJobLimit);

  // Extract URLs from filtered jobs
  const urlsToExtract = filteredJobs.map(job => job.url);

  // Count companies in filtered results
  const filteredCompanies = new Set(filteredJobs.map(j => j.company)).size;

  setStatus(`Extracting ${urlsToExtract.length} jobs from ${filteredCompanies} companies...`, 'loading');
  extractBtn.disabled = true;
  extractionProgressDiv.classList.remove('hidden');
  extractionLog.classList.remove('hidden');
  extractionLog.innerHTML = '';

  progressTotal.textContent = urlsToExtract.length;
  progressCurrent.textContent = '0';
  progressPercent.textContent = '0';
  progressFill.style.width = '0%';

  try {
    await chrome.runtime.sendMessage({
      action: 'startBatchExtraction',
      urls: urlsToExtract
    });
  } catch (error) {
    setStatus('Error: ' + error.message, 'error');
    extractBtn.disabled = false;
  }
});

// Step 3: Upload to Supabase
uploadBtn.addEventListener('click', async () => {
  console.log('[Upload] Button clicked');
  console.log('[Upload] Jobs to upload:', extractedJobs.length);
  console.log('[Upload] Supabase config:', supabaseConfig);

  if (extractedJobs.length === 0) {
    setStatus('No jobs to upload', 'error');
    return;
  }

  if (!supabaseConfig.supabaseUrl || !supabaseConfig.supabaseKey) {
    setStatus('Please configure Supabase first (click ⚙️)', 'error');
    return;
  }

  setStatus(`Uploading ${extractedJobs.length} jobs to Supabase...`, 'loading');
  uploadBtn.disabled = true;

  try {
    let successCount = 0;
    let errorCount = 0;

    for (const job of extractedJobs) {
      console.log('[Upload] Uploading job:', job.title);
      try {
        await uploadJobToSupabase(job);
        console.log('[Upload] Success:', job.title);
        successCount++;
      } catch (error) {
        console.error('[Upload] Failed for job:', job.title, error.message);
        errorCount++;
      }
    }

    if (errorCount === 0) {
      setStatus(`✓ Uploaded ${successCount} jobs successfully!`, 'success');
    } else {
      setStatus(`⚠ Uploaded ${successCount} jobs, ${errorCount} failed`, 'warning');
    }
  } catch (error) {
    setStatus(`Error: ${error.message}`, 'error');
  } finally {
    uploadBtn.disabled = false;
  }
});

// Step 3: Download JSON
downloadBtn.addEventListener('click', () => {
  if (extractedJobs.length === 0) {
    setStatus('No jobs to download', 'error');
    return;
  }

  const jsonString = JSON.stringify(extractedJobs, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const filename = `hiring-cafe-jobs-${timestamp}.json`;

  chrome.downloads.download({
    url,
    filename,
    saveAs: true
  });

  setStatus('Downloaded successfully!', 'success');
});

// Step 3: Clear data
clearBtn.addEventListener('click', async () => {
  if (!confirm('Clear all extracted jobs?')) return;

  extractedJobs = [];
  collectedJobs = [];

  await chrome.runtime.sendMessage({ action: 'clearExtractedJobs' });

  jobInfo.classList.add('hidden');
  urlCountDiv.classList.add('hidden');
  downloadBtn.disabled = true;
  clearBtn.disabled = true;
  extractBtn.disabled = true;

  setStatus('Data cleared', 'success');
});

// Listen for messages from background
chrome.runtime.onMessage.addListener((request) => {
  if (request.action === 'scrollComplete') {
    collectedJobs = request.jobs || [];

    // Count unique companies
    const companies = new Set(collectedJobs.map(j => j.company));
    const companyCount = companies.size;

    urlCountNum.textContent = collectedJobs.length;
    urlCountDiv.classList.remove('hidden');
    scrollBtn.disabled = false;
    extractBtn.disabled = false;
    setStatus(`Found ${collectedJobs.length} jobs from ${companyCount} companies`, 'success');
  }

  if (request.action === 'extractionProgress') {
    const { current, total, percentage } = request.progress;
    progressCurrent.textContent = current;
    progressTotal.textContent = total;
    progressPercent.textContent = percentage;
    progressFill.style.width = percentage + '%';
  }

  if (request.action === 'extractionLog') {
    addLogEntry(request.message, request.type);
  }

  if (request.action === 'extractionComplete') {
    loadExtractedJobs();
    extractBtn.disabled = false;
    setStatus(`Extracted ${request.count} jobs`, 'success');
  }

  if (request.action === 'extractionStopped') {
    loadExtractedJobs();
    extractBtn.disabled = false;
    setStatus(`Stopped. Extracted ${request.count} jobs`, 'warning');
  }

  if (request.action === 'extractionError') {
    extractBtn.disabled = false;
    setStatus(`Error: ${request.error}`, 'error');
  }
});

// Helper: Load extracted jobs
async function loadExtractedJobs() {
  const response = await chrome.runtime.sendMessage({ action: 'getExtractedJobs' });
  if (response && response.jobs) {
    extractedJobs = response.jobs;
    updateJobInfo();
  }
}

// Helper: Update job info
function updateJobInfo() {
  if (extractedJobs.length > 0) {
    jobCount.textContent = extractedJobs.length;
    jobInfo.classList.remove('hidden');
    downloadBtn.disabled = false;
    clearBtn.disabled = false;

    // Enable upload if Supabase is configured
    if (supabaseConfig && supabaseConfig.supabaseUrl && supabaseConfig.supabaseKey) {
      uploadBtn.disabled = false;
    }
  }
}

/**
 * Filter jobs by company
 * @param {Array} jobs - Array of { url, company } objects
 * @param {number} companyLimit - Max companies to include (0 = all)
 * @param {number} jobsPerCompany - Max jobs per company (0 = all)
 * @param {number} totalJobLimit - Overall max jobs (0 = no limit)
 * @returns {Array} Filtered jobs array
 */
function filterJobsByCompany(jobs, companyLimit, jobsPerCompany, totalJobLimit) {
  console.log(`[Filter] Input: { totalJobs: ${jobs.length}, companyLimit: ${companyLimit}, jobsPerCompany: ${jobsPerCompany}, totalJobLimit: ${totalJobLimit} }`);

  // Group jobs by company
  const jobsByCompany = new Map();
  jobs.forEach(job => {
    const companyName = job.company || 'Unknown';
    if (!jobsByCompany.has(companyName)) {
      jobsByCompany.set(companyName, []);
    }
    jobsByCompany.get(companyName).push(job);
  });

  console.log(`[Filter] Grouped into ${jobsByCompany.size} companies`);

  // Get company names in order
  const companyNames = Array.from(jobsByCompany.keys());

  // Limit companies
  const selectedCompanies = companyLimit > 0
    ? companyNames.slice(0, companyLimit)
    : companyNames;

  console.log(`[Filter] Selected ${selectedCompanies.length} companies:`, selectedCompanies.slice(0, 5));

  // Build filtered job list
  let filteredJobs = [];
  const jobsPerCompanyStats = {};

  selectedCompanies.forEach(companyName => {
    const companyJobs = jobsByCompany.get(companyName);

    // Limit jobs per company
    const jobsToAdd = jobsPerCompany > 0
      ? companyJobs.slice(0, jobsPerCompany)
      : companyJobs;

    filteredJobs = filteredJobs.concat(jobsToAdd);
    jobsPerCompanyStats[companyName] = jobsToAdd.length;
  });

  // Apply total job limit
  if (totalJobLimit > 0 && filteredJobs.length > totalJobLimit) {
    filteredJobs = filteredJobs.slice(0, totalJobLimit);
    console.log(`[Filter] Applied total limit: ${totalJobLimit}`);
  }

  console.log(`[Filter] Output: ${filteredJobs.length} jobs`);
  console.log(`[Filter] Jobs per company:`, jobsPerCompanyStats);

  return filteredJobs;
}

// Helper: Set status
function setStatus(text, type = 'info') {
  statusDiv.textContent = text;

  const colors = {
    success: '#dbeafe',
    error: '#fee2e2',
    warning: '#fef3c7',
    loading: '#e0e7ff',
    info: '#f3f4f6'
  };

  statusDiv.style.background = colors[type] || colors.info;
}

// Helper: Add log entry
function addLogEntry(message, type = 'info') {
  const entry = document.createElement('div');
  entry.className = `log-entry log-${type}`;
  entry.textContent = message;
  extractionLog.appendChild(entry);
  extractionLog.scrollTop = extractionLog.scrollHeight;
}

// Helper: Ensure content scripts are loaded
async function ensureContentScriptsLoaded(tabId) {
  try {
    // Try to ping the content script
    await chrome.tabs.sendMessage(tabId, { action: 'ping' });
  } catch (error) {
    // Content script not loaded, inject it
    console.log('Content script not loaded, injecting...');

    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['contentExtractor.js', 'content.js']
    });

    // Wait a bit for scripts to initialize
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}

// Helper: Upload job to Supabase with relational transform
async function uploadJobToSupabase(job) {
  const { supabaseUrl, supabaseKey } = supabaseConfig;

  // 1. Upsert company
  const companyId = await upsertCompany(job.company);

  // 2. Upsert location
  const locationId = await upsertLocation(job.location);

  // 3. Upsert skills and get IDs
  const skillIds = await upsertSkills(job.skills);

  // 4. Create job
  const jobData = {
    title: job.title,
    description: job.description,
    responsibilities: job.responsibilities,
    requirement_summary: job.requirement_summary,
    company_id: companyId,
    location_id: locationId,
    job_type: job.job_type,
    commitment_type: job.commitment_type,
    category: job.category,
    experience_level: job.experience_level,
    education_requirement: job.education_requirement || null,
    education_preferred: job.education_preferred || null,
    salary_min: job.salary_min,
    salary_max: job.salary_max,
    salary_currency: job.salary_currency,
    salary_period: job.salary_period,
    posted_date: job.posted_date,
    source_url: job.source_url,
    external_id: job.external_id,
    application_url: job.application_url,
    is_active: true,
    raw_data: job.raw_data
  };

  const response = await fetch(`${supabaseUrl}/rest/v1/jobs`, {
    method: 'POST',
    headers: {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify(jobData)
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create job: ${error}`);
  }

  const createdJob = await response.json();
  const jobId = createdJob[0].id;

  // 5. Link skills to job
  if (skillIds.length > 0) {
    await linkSkillsToJob(jobId, skillIds);
  }

  return jobId;
}

// Helper: Upsert headquarters location
async function upsertHeadquartersLocation(headquartersCountry) {
  if (!headquartersCountry) return null;

  const { supabaseUrl, supabaseKey } = supabaseConfig;

  // Try to find existing location by country
  const searchResponse = await fetch(
    `${supabaseUrl}/rest/v1/locations?country=eq.${encodeURIComponent(headquartersCountry)}&city=is.null&select=id`,
    {
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`
      }
    }
  );

  if (searchResponse.ok) {
    const existing = await searchResponse.json();
    if (existing.length > 0) {
      console.log('[Upload] Found existing HQ location:', existing[0].id);
      return existing[0].id;
    }
  }

  // Create new headquarters location
  const locationData = {
    country: headquartersCountry,
    city: null,
    state: null,
    full_location: headquartersCountry,
    is_remote: false
  };

  console.log('[Upload] Creating HQ location:', locationData);

  const createResponse = await fetch(`${supabaseUrl}/rest/v1/locations`, {
    method: 'POST',
    headers: {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify(locationData)
  });

  if (!createResponse.ok) {
    const errorText = await createResponse.text();
    console.error('[Upload] HQ location create failed:', errorText);
    return null; // Don't fail the whole upload if HQ location fails
  }

  const created = await createResponse.json();
  console.log('[Upload] Created HQ location:', created[0].id);
  return created[0].id;
}

// Helper: Upsert company
async function upsertCompany(company) {
  if (!company || !company.name) return null;

  const { supabaseUrl, supabaseKey } = supabaseConfig;

  // Try to find existing company
  const searchResponse = await fetch(
    `${supabaseUrl}/rest/v1/companies?name=eq.${encodeURIComponent(company.name)}&select=id`,
    {
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`
      }
    }
  );

  if (searchResponse.ok) {
    const existing = await searchResponse.json();
    if (existing.length > 0) {
      return existing[0].id;
    }
  }

  // Create/find headquarters location if available
  let headquartersId = null;
  if (company.headquarters) {
    headquartersId = await upsertHeadquartersLocation(company.headquarters);
  }

  // Create new company with all fields
  const companyData = {
    name: company.name,
    description: company.description,
    website: company.website,
    logo_url: company.logo_url,
    linkedin_url: company.linkedin_url || null,
    headquarters: headquartersId,
    year_founded: company.year_founded || null,
    number_employees: company.number_employees || null,
    industries: company.industries || null,
    activities: company.activities || null,
    funding_stage: company.funding_stage || null,
    latest_investment: company.latest_investment || null,
    latest_investment_year: company.latest_investment_year || null
  };

  console.log('[Upload] Creating company:', companyData);

  const createResponse = await fetch(`${supabaseUrl}/rest/v1/companies`, {
    method: 'POST',
    headers: {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify(companyData)
  });

  if (!createResponse.ok) {
    const errorText = await createResponse.text();
    console.error('[Upload] Company create failed:', errorText);
    throw new Error('Failed to create company: ' + errorText);
  }

  const created = await createResponse.json();
  return created[0].id;
}

// Helper: Upsert location
async function upsertLocation(location) {
  if (!location || !location.full_location) return null;

  const { supabaseUrl, supabaseKey } = supabaseConfig;

  // Try to find existing location
  const searchResponse = await fetch(
    `${supabaseUrl}/rest/v1/locations?full_location=eq.${encodeURIComponent(location.full_location)}&select=id`,
    {
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`
      }
    }
  );

  if (searchResponse.ok) {
    const existing = await searchResponse.json();
    if (existing.length > 0) {
      return existing[0].id;
    }
  }

  // Create new location
  const createResponse = await fetch(`${supabaseUrl}/rest/v1/locations`, {
    method: 'POST',
    headers: {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify({
      full_location: location.full_location,
      city: location.city,
      state: location.state,
      country: location.country,
      is_remote: location.is_remote
    })
  });

  if (!createResponse.ok) {
    throw new Error('Failed to create location');
  }

  const created = await createResponse.json();
  return created[0].id;
}

// Helper: Upsert skills
async function upsertSkills(skills) {
  if (!skills || skills.length === 0) return [];

  const { supabaseUrl, supabaseKey } = supabaseConfig;
  const skillIds = [];

  for (const skillName of skills) {
    if (!skillName) continue;

    // Try to find existing skill
    const searchResponse = await fetch(
      `${supabaseUrl}/rest/v1/skills?name=eq.${encodeURIComponent(skillName)}&select=id`,
      {
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`
        }
      }
    );

    if (searchResponse.ok) {
      const existing = await searchResponse.json();
      if (existing.length > 0) {
        skillIds.push(existing[0].id);
        continue;
      }
    }

    // Create new skill
    const createResponse = await fetch(`${supabaseUrl}/rest/v1/skills`, {
      method: 'POST',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({ name: skillName })
    });

    if (createResponse.ok) {
      const created = await createResponse.json();
      skillIds.push(created[0].id);
    }
  }

  return skillIds;
}

// Helper: Link skills to job
async function linkSkillsToJob(jobId, skillIds) {
  const { supabaseUrl, supabaseKey } = supabaseConfig;

  const links = skillIds.map(skillId => ({
    job_id: jobId,
    skill_id: skillId
  }));

  const response = await fetch(`${supabaseUrl}/rest/v1/job_skills`, {
    method: 'POST',
    headers: {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(links)
  });

  if (!response.ok) {
    console.error('Failed to link skills');
  }
}
