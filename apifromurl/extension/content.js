// ===========================================
// Content Script — runs on remote100k.com/*
// Handles listing page, company profile pages, AND individual job pages
// ===========================================

const SUPABASE_URL = 'https://vmdbwpqopujirdcthgta.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZtZGJ3cHFvcHVqaXJkY3RoZ3RhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcxMDcwMjIsImV4cCI6MjA4MjY4MzAyMn0.QwQKfGgiJEbU-3ztMSIXT5tFOska5CiBy9ZVmvea6KM'

// ------------------------------------------------
// Supabase REST helpers (no npm needed)
// ------------------------------------------------

async function supabaseUpsert(table, data, onConflict) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`
  const res = await fetch(url, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer':        'resolution=merge-duplicates,return=representation'
    },
    body: JSON.stringify(Array.isArray(data) ? data : [data])
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Supabase ${table}: ${err}`)
  }
  return res.json()
}

// ------------------------------------------------
// Wait for a CSS selector to appear in the DOM
// Polls every 500ms up to maxMs. Returns true if found.
// Used for job pages (waiting for apply button).
// ------------------------------------------------
function waitForElement(selector, maxMs = 10000) {
  return new Promise(resolve => {
    if (document.querySelector(selector)) { resolve(true); return }

    const interval = setInterval(() => {
      if (document.querySelector(selector)) {
        clearInterval(interval)
        clearTimeout(timeout)
        resolve(true)
      }
    }, 500)

    const timeout = setTimeout(() => {
      clearInterval(interval)
      resolve(false)
    }, maxMs)
  })
}

// ------------------------------------------------
// Wait for actual job cards to render on a company page.
// Job cards are <a href*="remote-job/"> elements that contain an <h3> title.
// Using "remote-job/" (with trailing slash) intentionally excludes nav links
// that point to "/remote-job" (the job listing page) which have no trailing slash.
// Returns the array of matching elements, or [] on timeout.
// ------------------------------------------------
function waitForJobCards(maxMs = 15000) {
  return new Promise(resolve => {
    const getCards = () =>
      [...document.querySelectorAll('a[href*="remote-job/"]')]
        .filter(a => a.querySelector('h3'))

    // Already rendered?
    const initial = getCards()
    if (initial.length > 0) { resolve(initial); return }

    const interval = setInterval(() => {
      const cards = getCards()
      if (cards.length > 0) {
        clearInterval(interval)
        clearTimeout(timeout)
        resolve(cards)
      }
    }, 500)

    const timeout = setTimeout(() => {
      clearInterval(interval)
      resolve([])  // timeout — company has no jobs or page didn't render
    }, maxMs)
  })
}

// ------------------------------------------------
// PAGE: /remote-companies  (listing page)
// Collects all company profile URLs and stores in chrome.storage
// ------------------------------------------------
async function handleListingPage() {
  console.log('[remote100k] Listing page detected — collecting company URLs...')

  const links = [...document.querySelectorAll('a[href]')]
    .map(a => a.href)
    .filter(href => href.match(/remote100k\.com\/remote-companies\/[^\/]+$/) && !href.endsWith('/remote-companies'))

  const unique = [...new Set(links)]
  console.log(`[remote100k] Found ${unique.length} company links`)

  chrome.storage.local.set({ queue: unique, current: 0, running: false, stats: {} })
  chrome.runtime.sendMessage({ type: 'COMPANIES_COLLECTED', count: unique.length })
}

// ------------------------------------------------
// PAGE: /remote-companies/{slug}  (company profile)
// Extracts company info + collects job page URLs from job cards
// Does NOT try to find apply buttons here — those are on /remote-job/ pages
// ------------------------------------------------
async function handleCompanyPage() {
  const { running } = await chrome.storage.local.get('running')
  if (!running) return

  const slug = window.location.pathname.replace('/remote-companies/', '').replace(/\/$/, '')
  console.log(`[remote100k] ▶ Company: ${slug}`)

  // Give Framer CMS time to bootstrap after document_idle.
  // document_idle fires when HTML is parsed but Framer renders content via JS after that.
  await new Promise(r => setTimeout(r, 2000))

  // Now poll for job cards (up to 6s more, 8s total budget).
  // Companies with no jobs will wait the full 8s before moving on.
  const jobCardEls = await waitForJobCards(6000)
  console.log(`[remote100k] 🔍 Job cards found: ${jobCardEls.length}`)

  try {
    // --- Company info ---
    const name        = document.querySelector('h1')?.textContent?.trim() || slug
    const logoImg     = document.querySelector('img[alt$=" logo"]')
    const logo_url    = logoImg ? logoImg.src.split('?')[0] : null
    const description = [...document.querySelectorAll('p')]
      .map(p => p.textContent.trim())
      .find(t => t.length > 40 && !t.includes('Remote100K') && !t.includes('Apply')) || null

    let website_url = null, linkedin_url = null, twitter_url = null
    document.querySelectorAll('a[target="_blank"]').forEach(a => {
      const href = a.href
      if (!href || href.includes('remote100k.com') || href.includes('ref=remote100k')) return
      if (href.includes('linkedin.com') && !linkedin_url) { linkedin_url = href; return }
      if ((href.includes('x.com') || href.includes('twitter.com')) && !twitter_url) { twitter_url = href; return }
      if (!website_url && !href.includes('linkedin.com') && !href.includes('twitter.com') && !href.includes('x.com')) {
        website_url = href
      }
    })

    // --- Upload logo poster to Supabase Storage (via background to bypass CORS) ---
    let final_logo_url = logo_url
    try {
      const uploadResult = await chrome.runtime.sendMessage({ type: 'UPLOAD_LOGO', imageUrl: logo_url, slug })
      if (uploadResult?.storageUrl) {
        final_logo_url = uploadResult.storageUrl
        console.log(`[remote100k] 🖼️ ${slug}: logo saved to storage`)
      }
    } catch (err) {
      console.warn(`[remote100k] ⚠️ ${slug}: logo upload message failed — ${err.message}`)
    }

    // --- Upsert company ---
    const companyRows = await supabaseUpsert('remote100k_companies', {
      name,
      slug,
      profile_url:  window.location.href,
      logo_url:     final_logo_url,
      description,
      website_url,
      linkedin_url,
      twitter_url,
      scraped_at:   new Date().toISOString()
    }, 'slug')

    const company_id = companyRows?.[0]?.id || null

    // --- Take only the first job card that belongs to this company ---
    // Each card has [data-framer-name="Company"] p with the company name.
    // When a company has 0 jobs the site shows suggested jobs from OTHER companies —
    // those cards have a different company name so we skip them.
    // We only need 1 valid card (1 apply URL identifies the ATS).
    // Normalize a string to bare alphanumeric for comparison
    // "Hims & Hers" → "himshers", "hims-hers" → "himshers"
    const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '')

    const ownCards = jobCardEls.filter(card => {
      const cardCompany = card.querySelector('[data-framer-name="Company"] p')?.textContent?.trim()
      if (!cardCompany) return true  // no label → assume it's this company's card
      // Match against both the h1 name and the URL slug (handles name mismatches)
      const match = norm(cardCompany) === norm(name) || norm(cardCompany) === norm(slug)
      if (!match) console.log(`[remote100k] 🚫 Skipped suggested card — "${cardCompany}" ≠ "${name}"`)
      return match
    })

    const jobs = ownCards.slice(0, 1).map(card => {
      const title = card.querySelector('h3')?.textContent?.trim() || null
      if (!title) return null

      // card.href is already resolved to absolute URL by the browser
      const jobPageUrl = card.href

      // posted_ago — span with text like "14d", "3h", "47d"
      const postedSpan = [...card.querySelectorAll('span')]
        .find(s => /^\d+[dhm]$/.test(s.textContent?.trim()))
      const posted_ago = postedSpan?.textContent?.trim() || null

      // Salary — text with $ £ € symbol
      const salaryP = [...card.querySelectorAll('p')]
        .find(p => /[\$£€][\d,]/.test(p.textContent))
      const salary_raw = salaryP?.textContent?.trim() || null

      // Remote location — flag emoji (regional indicator surrogate pairs)
      let remote_location = null
      card.querySelectorAll('p').forEach(p => {
        const text = p.textContent.trim()
        if (!remote_location && /[\uD83C][\uDDE6-\uDDFF]/.test(text)) {
          remote_location = text.replace(/^Remote:\s*/i, '').trim()
        }
      })

      return { title, jobPageUrl, posted_ago, salary_raw, remote_location }
    }).filter(Boolean)

    console.log(`[remote100k] 📋 ${slug}: queued ${jobs.length} job pages to visit`)

    // Update company job count from card count
    if (company_id && jobs.length > 0) {
      await fetch(`${SUPABASE_URL}/rest/v1/remote100k_companies?id=eq.${company_id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type':  'application/json',
          'apikey':        SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`
        },
        body: JSON.stringify({ total_jobs_listed: jobs.length })
      })
    }

    // Save job queue for this company to storage
    // Background will navigate to each job page
    await chrome.storage.local.set({
      pendingCompany: { company_id, slug, jobs },
      currentJob: 0
    })

    // Tell background: company data collected, ready to process job pages
    chrome.runtime.sendMessage({ type: 'COMPANY_SCRAPED', slug, jobCount: jobs.length })

  } catch (err) {
    console.error(`[remote100k] ❌ ${slug}: ${err.message}`)
    chrome.runtime.sendMessage({ type: 'COMPANY_SCRAPED', slug, jobCount: 0, error: true })
  }
}

// ------------------------------------------------
// PAGE: /remote-job/{slug}  (individual job detail)
// Extracts the actual apply URL (ATS link with ref=remote100k)
// ------------------------------------------------
async function handleJobPage() {
  const { running, pendingCompany, currentJob } = await chrome.storage.local.get(['running', 'pendingCompany', 'currentJob'])
  if (!running || !pendingCompany) return

  const jobData = pendingCompany.jobs[currentJob]
  if (!jobData) {
    console.warn(`[remote100k] ⚠️ No job data at index ${currentJob}`)
    chrome.runtime.sendMessage({ type: 'JOB_DONE', success: false })
    return
  }

  console.log(`[remote100k] 🔗 Job page: "${jobData.title}"`)

  // Give Framer CMS time to render before checking elements
  await new Promise(r => setTimeout(r, 2500))

  // Wait for apply button — it has the actual ATS URL with ?ref=remote100k
  const applyLoaded = await waitForElement('a[href*="ref=remote100k"]', 10000)

  const applyLink = document.querySelector('a[href*="ref=remote100k"]')
  const application_url = applyLink?.href || null

  if (!application_url) {
    console.warn(`[remote100k] ⚠️ No apply URL on: ${window.location.pathname}`)
    chrome.runtime.sendMessage({ type: 'JOB_DONE', success: false })
    return
  }

  try {
    let ats_domain = null
    try { ats_domain = new URL(application_url).hostname } catch {}

    await supabaseUpsert('remote100k_jobs', {
      company_id:      pendingCompany.company_id,
      company_slug:    pendingCompany.slug,
      title:           jobData.title,
      application_url,
      ats_domain,
      ats_provider:    detectATSProvider(application_url),
      salary_raw:      jobData.salary_raw,
      remote_location: jobData.remote_location,
      posted_ago:      jobData.posted_ago,
      scraped_at:      new Date().toISOString()
    }, 'company_slug,title')

    console.log(`[remote100k] ✅ Saved: "${jobData.title}" → ${application_url.slice(0, 60)}`)
    chrome.runtime.sendMessage({ type: 'JOB_DONE', success: true })

  } catch (err) {
    console.error(`[remote100k] ❌ Job save failed: ${err.message}`)
    chrome.runtime.sendMessage({ type: 'JOB_DONE', success: false })
  }
}

// ------------------------------------------------
// Detect ATS provider from URL (lightweight version)
// ------------------------------------------------
function detectATSProvider(url) {
  if (!url) return 'Unknown'
  if (url.includes('greenhouse.io'))      return 'Greenhouse'
  if (url.includes('lever.co'))           return 'Lever'
  if (url.includes('myworkdayjobs.com'))  return 'Workday'
  if (url.includes('ashbyhq.com'))        return 'Ashby'
  if (url.includes('workable.com'))       return 'Workable'
  if (url.includes('smartrecruiters.com'))return 'SmartRecruiters'
  if (url.includes('bamboohr.com'))       return 'BambooHR'
  if (url.includes('recruitee.com'))      return 'Recruitee'
  if (url.includes('breezy.hr'))          return 'Breezy HR'
  if (url.includes('personio.'))          return 'Personio'
  if (url.includes('jobvite.com'))        return 'Jobvite'
  if (url.includes('icims.com'))          return 'iCIMS'
  if (url.includes('taleo.net'))          return 'Taleo'
  if (url.includes('successfactors.'))    return 'SuccessFactors'
  if (url.includes('rippling.com'))       return 'Rippling'
  if (url.includes('/careers') || url.includes('/jobs')) return 'Custom'
  return 'Unknown'
}

// ------------------------------------------------
// Router — decide which handler to run based on URL
// ------------------------------------------------
const path = window.location.pathname

if (path === '/remote-companies' || path === '/remote-companies/') {
  handleListingPage()
} else if (path.startsWith('/remote-companies/')) {
  handleCompanyPage()
} else if (path.startsWith('/remote-job/')) {
  handleJobPage()
}
