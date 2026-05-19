// ===========================================
// Background Service Worker
// Manages navigation: company pages → job detail pages → next company
// ===========================================

const SUPABASE_URL         = 'https://vmdbwpqopujirdcthgta.supabase.co'
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZtZGJ3cHFvcHVqaXJkY3RoZ3RhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzEwNzAyMiwiZXhwIjoyMDgyNjgzMDIyfQ.c7QWY4J6cbVRnT9tOrw5ZcBdjzrWUZnNc_VVO1NOv00'

// Fetch an external image and upload it to Supabase Storage.
// Runs in the service worker so there are no CORS restrictions.
async function uploadLogoToStorage(imageUrl, slug) {
  if (!imageUrl) return null

  const imgRes = await fetch(imageUrl)
  if (!imgRes.ok) throw new Error(`Image fetch ${imgRes.status}: ${imageUrl}`)
  const blob = await imgRes.blob()

  const ext = blob.type.split('/')[1]?.split('+')[0] || 'jpeg'
  const filePath = `${slug}.${ext}`

  const uploadRes = await fetch(
    `${SUPABASE_URL}/storage/v1/object/company-logos/${filePath}`,
    {
      method: 'POST',
      headers: {
        'apikey':        SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type':  blob.type,
        'x-upsert':      'true'
      },
      body: blob
    }
  )

  if (!uploadRes.ok) {
    const err = await uploadRes.text()
    throw new Error(`Storage upload ${uploadRes.status}: ${err}`)
  }

  return `${SUPABASE_URL}/storage/v1/object/public/company-logos/${filePath}`
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  // ------------------------------------------------
  // Upload a company logo to Supabase Storage
  // Handled here (not content script) to bypass CORS on external image CDNs
  // ------------------------------------------------
  if (msg.type === 'UPLOAD_LOGO') {
    uploadLogoToStorage(msg.imageUrl, msg.slug)
      .then(storageUrl => {
        console.log(`[bg] 🖼️ ${msg.slug}: logo uploaded → ${storageUrl?.split('/').pop()}`)
        sendResponse({ storageUrl })
      })
      .catch(err => {
        console.error(`[bg] ❌ Logo upload failed for ${msg.slug}: ${err.message}`)
        sendResponse({ storageUrl: null })
      })
    return true // keep message channel open for async response
  }

  // ------------------------------------------------
  // Content script finished scraping a company page
  // Navigate to the first job detail page, or skip to next company if no jobs
  // ------------------------------------------------
  if (msg.type === 'COMPANY_SCRAPED') {
    chrome.storage.local.get(['pendingCompany', 'queue', 'current', 'stats'], (data) => {
      const jobs = data.pendingCompany?.jobs || []

      if (jobs.length > 0 && !msg.error) {
        // Navigate to first job page for this company
        console.log(`[bg] ${msg.slug}: navigating to job 1 of ${jobs.length}`)
        chrome.tabs.update(sender.tab.id, { url: jobs[0].jobPageUrl })
      } else {
        // No jobs (or error on company page) — move straight to next company
        console.log(`[bg] ${msg.slug}: no jobs, moving to next company`)
        moveToNextCompany(sender.tab.id, data, !msg.error)
      }
    })
  }

  // ------------------------------------------------
  // Content script finished scraping an individual job page
  // Navigate to next job, or to next company when all jobs done
  // ------------------------------------------------
  if (msg.type === 'JOB_DONE') {
    chrome.storage.local.get(['pendingCompany', 'currentJob', 'queue', 'current', 'stats'], (data) => {
      const jobs      = data.pendingCompany?.jobs || []
      const nextJob   = (data.currentJob || 0) + 1
      const stats     = data.stats || { done: 0, failed: 0, jobs: 0, total: 0 }

      stats.jobs += msg.success ? 1 : 0

      if (nextJob < jobs.length) {
        // More jobs to process for this company
        console.log(`[bg] Job ${nextJob + 1} of ${jobs.length}: ${jobs[nextJob].jobPageUrl.slice(0, 60)}`)
        chrome.storage.local.set({ currentJob: nextJob, stats })
        chrome.tabs.update(sender.tab.id, { url: jobs[nextJob].jobPageUrl })
      } else {
        // All jobs done for this company — move to next company
        console.log(`[bg] All ${jobs.length} jobs done for ${data.pendingCompany?.slug}`)
        chrome.storage.local.set({ currentJob: nextJob, stats })
        moveToNextCompany(sender.tab.id, { ...data, stats }, true)
      }
    })
  }

  // ------------------------------------------------
  // Popup: Start scraping
  // ------------------------------------------------
  if (msg.type === 'START') {
    chrome.storage.local.get(['queue'], (data) => {
      if (!data.queue || data.queue.length === 0) {
        sendResponse({ error: 'No companies queued. Go to remote100k.com/remote-companies first.' })
        return
      }
      // Navigate INSIDE the storage callback so running:true is guaranteed
      // to be written before the content script on the new page reads it.
      chrome.storage.local.set({
        running: true,
        current: 0,
        currentJob: 0,
        pendingCompany: null,
        stats: { done: 0, failed: 0, jobs: 0, total: data.queue.length }
      }, () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          chrome.tabs.update(tabs[0].id, { url: data.queue[0] })
        })
        sendResponse({ ok: true, total: data.queue.length })
      })
    })
    return true // async response
  }

  // ------------------------------------------------
  // Popup: Stop
  // ------------------------------------------------
  if (msg.type === 'STOP') {
    chrome.storage.local.set({ running: false })
    sendResponse({ ok: true })
  }

  // ------------------------------------------------
  // Popup: Reset
  // ------------------------------------------------
  if (msg.type === 'RESET') {
    chrome.storage.local.set({ queue: [], current: 0, currentJob: 0, running: false, pendingCompany: null, stats: {} })
    sendResponse({ ok: true })
  }
})

// ------------------------------------------------
// Advance the company queue pointer and navigate to next company
// Called after all job pages for a company have been processed
// ------------------------------------------------
function moveToNextCompany(tabId, data, success) {
  const queue   = data.queue   || []
  const current = (data.current || 0) + 1
  const stats   = data.stats   || { done: 0, failed: 0, jobs: 0, total: 0 }

  stats.done   += success ? 1 : 0
  stats.failed += success ? 0 : 1

  if (current >= queue.length) {
    // All companies processed
    chrome.storage.local.set({ running: false, current, stats, pendingCompany: null })
    chrome.runtime.sendMessage({ type: 'PROGRESS', current, total: queue.length, stats, done: true })
      .catch(() => {})
    console.log(`[bg] ✅ All done! ${stats.done} companies, ${stats.jobs} jobs`)
    return
  }

  // Move to next company
  chrome.storage.local.set({ current, stats, currentJob: 0, pendingCompany: null })
  chrome.runtime.sendMessage({ type: 'PROGRESS', current, total: queue.length, stats })
    .catch(() => {})

  console.log(`[bg] → Company ${current + 1} of ${queue.length}: ${queue[current]}`)
  chrome.tabs.update(tabId, { url: queue[current] })
}
