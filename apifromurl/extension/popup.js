// ===========================================
// Popup Script
// ===========================================

const btnStart  = document.getElementById('btn-start')
const btnStop   = document.getElementById('btn-stop')
const btnReset  = document.getElementById('btn-reset')
const statQueued = document.getElementById('stat-queued')
const statDone   = document.getElementById('stat-done')
const statFailed = document.getElementById('stat-failed')
const statJobs   = document.getElementById('stat-jobs')
const progressFill = document.getElementById('progress-fill')
const statusEl   = document.getElementById('status')

// ------------------------------------------------
// Refresh UI from chrome.storage
// ------------------------------------------------
function refreshUI() {
  chrome.storage.local.get(['queue', 'current', 'running', 'stats'], (data) => {
    const queue   = data.queue   || []
    const current = data.current || 0
    const running = data.running || false
    const stats   = data.stats  || {}

    statQueued.textContent = queue.length
    statDone.textContent   = stats.done   || 0
    statFailed.textContent = stats.failed || 0
    statJobs.textContent   = stats.jobs   || 0

    const pct = queue.length > 0 ? Math.round((current / queue.length) * 100) : 0
    progressFill.style.width = pct + '%'

    if (running) {
      btnStart.style.display = 'none'
      btnStop.style.display  = 'block'
      statusEl.className = 'status running'
      statusEl.textContent = `Processing ${current + 1} of ${queue.length}...`
    } else if (queue.length > 0 && current >= queue.length && (stats.done || 0) > 0) {
      btnStart.style.display = 'block'
      btnStop.style.display  = 'none'
      btnStart.disabled = true
      statusEl.className = 'status done'
      statusEl.textContent = `Done! ${stats.done} companies scraped.`
    } else {
      btnStart.style.display = 'block'
      btnStop.style.display  = 'none'
      btnStart.disabled = queue.length === 0
      statusEl.className = 'status'
      statusEl.textContent = queue.length === 0
        ? 'Go to remote100k.com/remote-companies first'
        : `${queue.length} companies ready to scrape`
    }
  })
}

// ------------------------------------------------
// Button handlers
// ------------------------------------------------
btnStart.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'START' }, (res) => {
    if (res?.error) {
      statusEl.className = 'status error'
      statusEl.textContent = res.error
    } else {
      refreshUI()
    }
  })
})

btnStop.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'STOP' }, () => refreshUI())
})

btnReset.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'RESET' }, () => refreshUI())
})

// ------------------------------------------------
// Listen for progress updates from background
// ------------------------------------------------
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'PROGRESS' || msg.type === 'COMPANIES_COLLECTED') {
    refreshUI()
  }
  if (msg.type === 'PROGRESS' && msg.done) {
    statusEl.className = 'status done'
    statusEl.textContent = `Done! ${msg.stats?.done || 0} companies scraped.`
  }
})

// ------------------------------------------------
// Init
// ------------------------------------------------
refreshUI()
// Poll every 2s while popup is open
setInterval(refreshUI, 2000)
