/**
 * remote100k.com Company Scraper
 *
 * Per company it does:
 *  1. Search index JSON (1 request) → all 473 slugs + HQ, size, industry, founded
 *  2. Static HTML fetch → logo, website, LinkedIn, Twitter (in server-rendered HTML)
 *  3. Playwright browser → job listings (JS-rendered via Framer CMS)
 *  4. ATS detection from apply URLs → provider, API endpoint, career page URL
 *  5. Career page discovery from company website (/careers, /jobs etc.)
 *  6. Logo download → upload to Supabase Storage
 *  7. Upsert to remote100k_companies + remote100k_jobs in DB2
 *
 * Usage:
 *   node scrape.js              → scrape all 473 companies
 *   node scrape.js --dry-run    → print output, save nothing
 *   node scrape.js --limit=5    → only first 5 companies
 */

import { load } from 'cheerio'
import { createClient } from '@supabase/supabase-js'
import { chromium } from 'playwright'
import { detectATS, extractAtsDomain } from './ats-detector.js'

// ===========================================
// CONFIG
// ===========================================
const SUPABASE_URL     = 'https://vmdbwpqopujirdcthgta.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZtZGJ3cHFvcHVqaXJkY3RoZ3RhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcxMDcwMjIsImV4cCI6MjA4MjY4MzAyMn0.QwQKfGgiJEbU-3ztMSIXT5tFOska5CiBy9ZVmvea6KM'

// Service key for Supabase Storage logo uploads
// Get from: Supabase dashboard → Project Settings → API → service_role
// Leave blank to skip uploading (logo_url from framerusercontent will still be saved)
const SUPABASE_SERVICE_KEY = ''

const LOGO_BUCKET      = 'company-logos'
const BASE_URL         = 'https://remote100k.com'
const RATE_LIMIT_MS    = 1500   // ms between companies (polite scraping)
const SEARCH_INDEX_URL = 'https://framerusercontent.com/sites/2TTRWPnbHRv1n35otWC5BY/searchIndex-sSVTRoLYfWAf.json'

const NAV_TEXT = new Set([
  'Remote100K','Remote Jobs','Remote Companies','Feature a Job','Auto Apply',
  'All companies','/','Home','Jobs','Companies','Blog',
  'Stop applying to jobs manually. Meet JobCopilot and get 10x more job interviews with AI.'
])

// ===========================================
// FLAGS
// ===========================================
const DRY_RUN  = process.argv.includes('--dry-run')
const limitArg = process.argv.find(a => a.startsWith('--limit='))
const LIMIT    = limitArg ? parseInt(limitArg.split('=')[1]) : null

// ===========================================
// SUPABASE
// ===========================================
const supabase      = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
const supabaseAdmin = SUPABASE_SERVICE_KEY ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY) : null

// ===========================================
// UTILS
// ===========================================
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function fetchHtml(url, retries = 2) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
  }
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.text()
    } catch (err) {
      if (i === retries) throw err
      await sleep(2000)
    }
  }
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(15000)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

// ===========================================
// STEP 1 — SEARCH INDEX (all slugs at once)
// ===========================================
async function getSearchIndex() {
  try {
    console.log('Fetching Framer search index...')
    return await fetchJson(SEARCH_INDEX_URL)
  } catch {
    console.log('Hardcoded URL stale — extracting new URL from page...')
    const html = await fetchHtml(`${BASE_URL}/remote-companies`)
    const match = html.match(/https:\/\/framerusercontent\.com\/sites\/[^"']+searchIndex[^"']+\.json/)
    if (!match) throw new Error('Could not find search index URL')
    console.log('New index URL:', match[0])
    return await fetchJson(match[0])
  }
}

// ===========================================
// STEP 2 — PARSE SEARCH INDEX ENTRY
// Returns: name, description, HQ, size, founded, industry
// ===========================================
function parseIndexEntry(slug, entry) {
  const name       = (entry.h1?.[0] || slug).trim()
  const paragraphs = entry.p || []
  const skipSet    = new Set([...NAV_TEXT, name])

  let description = '', hq_raw = '', company_size = '', founded_year = null, industry_raw = ''

  let i = 0
  while (i < paragraphs.length) {
    const p = paragraphs[i].trim()
    if (p === 'HQ:'       && paragraphs[i+1]) { hq_raw       = paragraphs[i+1].trim(); i += 2; continue }
    if (p === 'Size:'     && paragraphs[i+1]) { company_size = paragraphs[i+1].trim(); i += 2; continue }
    if (p === 'Founded:'  && paragraphs[i+1]) {
      const y = parseInt(paragraphs[i+1])
      if (!isNaN(y)) founded_year = y
      i += 2; continue
    }
    if (p === 'Industry:' && paragraphs[i+1]) { industry_raw = paragraphs[i+1].trim(); i += 2; continue }
    if (!description && p.length > 30 && !skipSet.has(p)) description = p
    i++
  }

  const hqParts      = hq_raw.split(',').map(s => s.trim())
  const industry_array = industry_raw ? industry_raw.split(',').map(s => s.trim()).filter(Boolean) : null

  return {
    name,
    slug,
    profile_url:    `${BASE_URL}/remote-companies/${slug}`,
    description:    description || null,
    hq_raw:         hq_raw || null,
    hq_city:        hqParts[0] || null,
    hq_country:     hqParts[hqParts.length - 1] || null,
    company_size:   company_size || null,
    founded_year,
    industry_raw:   industry_raw || null,
    industry_array,
    raw_data:       entry
  }
}

// ===========================================
// STEP 3A — STATIC HTML → logo + social links
// (company header is server-rendered)
// ===========================================
async function scrapeStaticData(slug) {
  const url = `${BASE_URL}/remote-companies/${slug}`
  let logo_url = null, website_url = null, linkedin_url = null, twitter_url = null

  try {
    const html = await fetchHtml(url)
    const $    = load(html)

    // Logo: strip size query params for full resolution
    const logoImg = $('img[alt$=" logo"]').first()
    if (logoImg.length) logo_url = (logoImg.attr('src') || '').split('?')[0] || null

    // Social + website links
    $('a[target="_blank"][rel="noopener"]').each((_, el) => {
      const href = $(el).attr('href') || ''
      if (!href.startsWith('http'))          return
      if (href.includes('remote100k.com'))   return
      if (href.includes('ref=remote100k'))   return   // skip apply buttons
      if (href.includes('linkedin.com') && !linkedin_url) { linkedin_url = href; return }
      if ((href.includes('x.com') || href.includes('twitter.com')) && !twitter_url) { twitter_url = href; return }
      if (!website_url && !href.includes('linkedin.com') && !href.includes('twitter.com') && !href.includes('x.com')) {
        website_url = href
      }
    })
  } catch (err) {
    console.warn(`  ⚠️  Static fetch failed: ${err.message}`)
  }

  return { logo_url, website_url, linkedin_url, twitter_url }
}

// ===========================================
// STEP 3B — PLAYWRIGHT → job listings
// Jobs are loaded by Framer CMS via JavaScript
// ===========================================
async function scrapeJobs(slug, page) {
  const url  = `${BASE_URL}/remote-companies/${slug}`
  const jobs = []

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })

    // Wait for job titles — Framer CMS loads them async after page load
    // data-framer-name="Job Title" is the stable anchor from the HTML structure
    await page.waitForSelector('[data-framer-name="Job Title"]', { timeout: 12000 })
      .catch(() => null)   // no jobs on this page = fine, just continue

    const html = await page.content()
    const $    = load(html)

    // Each job block is anchored by data-framer-name="Job Title"
    $('[data-framer-name="Job Title"]').each((_, titleEl) => {
      const $t   = $(titleEl)
      const title = $t.find('h3').first().text().trim()
      if (!title) return

      // Walk up DOM to find the container that has both job info AND apply button
      // Structure: framer-1dcjqcg > [job card wrapper + framer-1p41bd5-container(apply)]
      // Go up enough levels to reach the job+apply wrapper
      const $wrapper = $t.closest('[data-framer-name]').parent()
        .closest('div').parent()
        .closest('div').parent()

      // Job detail page on remote100k (e.g. /remote-job/nvidia-senior-ai-engineer-...)
      const cardHref   = $wrapper.find('a[href*="remote-job/"]').first().attr('href') || ''
      const job_page_url = cardHref ? new URL(cardHref, url).href : null

      // Apply button always contains ?ref=remote100k
      const applyHref      = $wrapper.find('a[href*="ref=remote100k"]').first().attr('href') || ''
      const application_url = applyHref || null

      // ATS detection
      const ats_domain             = application_url ? extractAtsDomain(application_url) : null
      const atsResult              = application_url ? detectATS(application_url) : null
      const ats_provider           = atsResult?.provider || null
      const api_endpoint           = atsResult?.apiEndpoint?.list || null
      const api_endpoint_detail    = atsResult?.apiEndpoint?.detail || null
      const career_page_url        = atsResult?.careerPageUrl || null

      // Posted ago ("14d", "47d", "3h") — in Inactive block
      const posted_ago = $wrapper.find('[data-framer-name="Inactive"] span').first().text().trim()
        || $wrapper.find('div.framer-tuzk4s span').first().text().trim() || null

      // Other fields from paragraph text in this job block
      let remote_location = null, category = null, salary_raw = null, commitment_type = null

      $wrapper.find('p.framer-text').each((_, el) => {
        const text = $(el).text().trim()
        if (!text || text === title) return
        if (!salary_raw     && /[\$£€][\d,]/.test(text))                              { salary_raw = text; return }
        if (!commitment_type && /full.?time|part.?time|contract|internship|freelance/i.test(text)) { commitment_type = text; return }
        if (!remote_location && /[\uD83C][\uDDE6-\uDDFF]/.test(text))                 { remote_location = text.replace(/^Remote:\s*/i, '').trim(); return }
        if (!category && text.length < 25 && !/remote|\$|£|€|full|part|contract/i.test(text)) { category = text }
      })

      jobs.push({
        company_slug: slug, title, job_page_url, application_url,
        ats_domain, ats_provider, api_endpoint, api_endpoint_detail, career_page_url,
        remote_location, category, salary_raw, commitment_type, posted_ago
      })
    })

    console.log(`  🧲 ${jobs.length} job(s) found via Playwright`)
  } catch (err) {
    console.warn(`  ⚠️  Playwright jobs failed: ${err.message}`)
  }

  return jobs
}

// ===========================================
// STEP 4 — FIND CAREER PAGE FROM WEBSITE
// Tries common paths: /careers, /jobs etc.
// ===========================================
async function findCareerPage(websiteUrl) {
  if (!websiteUrl) return null
  const paths = ['/careers', '/jobs', '/career', '/work-with-us', '/join-us', '/join', '/opportunities']
  let origin
  try { origin = new URL(websiteUrl).origin } catch { return null }

  for (const path of paths) {
    const url = `${origin}${path}`
    try {
      const res = await fetch(url, {
        method: 'HEAD',
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(6000),
        redirect: 'follow'
      })
      if (res.ok) { console.log(`  🔗 Career page: ${url}`); return url }
    } catch { /* try next */ }
  }
  return null
}

// ===========================================
// STEP 5 — LOGO DOWNLOAD + UPLOAD TO STORAGE
// ===========================================
async function uploadLogo(slug, logoUrl) {
  if (!supabaseAdmin || !logoUrl) return null
  try {
    const res = await fetch(logoUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(10000)
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const buffer      = Buffer.from(await res.arrayBuffer())
    const contentType = res.headers.get('content-type') || 'image/jpeg'
    const ext         = contentType.includes('png') ? 'png' : 'jpg'
    const fileName    = `${slug}.${ext}`

    const { error } = await supabaseAdmin.storage
      .from(LOGO_BUCKET).upload(fileName, buffer, { contentType, upsert: true })
    if (error) { console.warn(`  ⚠️  Logo upload failed: ${error.message}`); return null }

    return supabaseAdmin.storage.from(LOGO_BUCKET).getPublicUrl(fileName).data.publicUrl
  } catch (err) {
    console.warn(`  ⚠️  Logo failed: ${err.message}`)
    return null
  }
}

// ===========================================
// MAIN
// ===========================================
async function main() {
  console.log('===========================================')
  console.log('remote100k.com Scraper')
  console.log('===========================================')
  console.log(`Mode:  ${DRY_RUN ? 'DRY RUN (nothing saved)' : 'LIVE'}`)
  if (LIMIT) console.log(`Limit: ${LIMIT} companies`)
  if (!supabaseAdmin) console.log('⚠️  No service key — logo uploads skipped')
  console.log('')

  // Step 1: All slugs from search index
  const index = await getSearchIndex()
  let slugs = Object.keys(index)
    .filter(k => k.startsWith('/remote-companies/') && k !== '/remote-companies' && k !== '/remote-companies/new')
    .map(k => k.replace('/remote-companies/', ''))
  if (LIMIT) slugs = slugs.slice(0, LIMIT)
  console.log(`Found ${slugs.length} companies\n`)

  // Launch Playwright browser (reuse across all companies)
  const browser = await chromium.launch({ headless: true })
  const page    = await browser.newPage()
  await page.setExtraHTTPHeaders({
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  })

  const stats = { total: slugs.length, done: 0, failed: 0, jobs: 0 }

  for (const slug of slugs) {
    console.log(`[${stats.done + stats.failed + 1}/${stats.total}] ${slug}`)

    try {
      // Parse basic data from index
      const basicData = parseIndexEntry(slug, index[`/remote-companies/${slug}`])

      // Static HTML → logo, website, social links
      const staticData = await scrapeStaticData(slug)

      // Playwright → jobs + apply URLs
      const jobs = await scrapeJobs(slug, page)

      // Career page discovery from company website
      const career_page_url = await findCareerPage(staticData.website_url)

      // Logo upload
      let logo_stored_url = null
      if (staticData.logo_url && !DRY_RUN) {
        logo_stored_url = await uploadLogo(slug, staticData.logo_url)
      }

      const company = {
        ...basicData,
        ...staticData,
        logo_stored_url,
        career_page_url,
        total_jobs_listed: jobs.length
      }

      if (DRY_RUN) {
        console.log(`  [DRY] ${company.name} | site: ${company.website_url} | jobs: ${jobs.length}`)
        if (jobs[0]) console.log(`  [DRY] job[0]: "${jobs[0].title}" → ${jobs[0].ats_provider} | ${jobs[0].application_url?.slice(0,70)}`)
      } else {
        // Upsert company
        const { data: saved, error: cErr } = await supabase
          .from('remote100k_companies')
          .upsert(company, { onConflict: 'slug' })
          .select('id').single()
        if (cErr) throw new Error(`Company DB: ${cErr.message}`)

        console.log(`  ✅ Saved — id: ${saved.id} | jobs: ${jobs.length}`)

        // Upsert jobs
        if (jobs.length > 0) {
          const rows = jobs.map(j => ({ ...j, company_id: saved.id }))
          const { error: jErr } = await supabase
            .from('remote100k_jobs')
            .upsert(rows, { onConflict: 'company_slug,title' })
          if (jErr) console.warn(`  ⚠️  Jobs DB: ${jErr.message}`)
        }
      }

      stats.done++
      stats.jobs += jobs.length

    } catch (err) {
      console.error(`  ❌ ${err.message}`)
      stats.failed++
    }

    await sleep(RATE_LIMIT_MS)
  }

  await browser.close()

  console.log('\n===========================================')
  console.log('DONE')
  console.log('===========================================')
  console.log(`Scraped:    ${stats.done} / ${stats.total}`)
  console.log(`Failed:     ${stats.failed}`)
  console.log(`Jobs found: ${stats.jobs}`)
  console.log(`Avg jobs:   ${(stats.jobs / Math.max(stats.done, 1)).toFixed(1)} per company`)
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1) })
