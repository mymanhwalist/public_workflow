/**
 * Job Scraper Scheduler
 * Automated system to run API discovery and job scraping periodically
 */

import { createClient } from '@supabase/supabase-js';
import { spawn } from 'child_process';
import fs from 'fs';

const SUPABASE_URL = 'https://bojsbsoqpnuzikyzpjlh.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJvanNic29xcG51emlreXpwamxoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQxMTQ4NTIsImV4cCI6MjA2OTY5MDg1Mn0.-I2x1wJSHETB7E-r84V9tQLhdxRpa8xthx9DOTmr908';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Configuration
const CONFIG = {
  // Run intervals (in milliseconds)
  intervals: {
    apiDiscovery: 24 * 60 * 60 * 1000,   // Every 24 hours
    sitemapFinder: 24 * 60 * 60 * 1000,  // Every 24 hours
    jobScraper: 6 * 60 * 60 * 1000,      // Every 6 hours
    verification: 12 * 60 * 60 * 1000    // Every 12 hours
  },
  // Log file
  logFile: 'scheduler.log'
};

// Parse command line arguments
const args = process.argv.slice(2);
const CONTINUOUS = args.includes('--continuous') || args.includes('-c');
const RUN_ONCE = args.includes('--once') || args.includes('-o');
const TASK = args.find(a => a.startsWith('--task='))?.split('=')[1];

function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}`;
  console.log(logMessage);

  // Append to log file
  fs.appendFileSync(CONFIG.logFile, logMessage + '\n');
}

async function runScript(scriptName, args = []) {
  return new Promise((resolve, reject) => {
    log(`Starting: ${scriptName} ${args.join(' ')}`);

    const child = spawn('node', [scriptName, ...args], {
      stdio: 'inherit',
      cwd: process.cwd()
    });

    child.on('close', (code) => {
      if (code === 0) {
        log(`Completed: ${scriptName}`);
        resolve(code);
      } else {
        log(`Failed: ${scriptName} (exit code ${code})`);
        reject(new Error(`Script ${scriptName} exited with code ${code}`));
      }
    });

    child.on('error', (err) => {
      log(`Error: ${scriptName} - ${err.message}`);
      reject(err);
    });
  });
}

async function runAPIDiscovery() {
  log('=== API DISCOVERY ===');
  try {
    await runScript('check-all-urls.js', ['--test-api', '--update']);
    return true;
  } catch (err) {
    log(`API Discovery failed: ${err.message}`);
    return false;
  }
}

async function runSitemapFinder() {
  log('=== SITEMAP FINDER ===');
  try {
    await runScript('sitemap-finder.js', ['--update', '--verbose']);
    return true;
  } catch (err) {
    log(`Sitemap Finder failed: ${err.message}`);
    return false;
  }
}

async function runJobScraper(source = 'api') {
  log(`=== JOB SCRAPER (${source.toUpperCase()}) ===`);
  try {
    const args = source === 'sitemap' ? ['--sitemap'] : [];
    await runScript('job-scraper.js', args);
    return true;
  } catch (err) {
    log(`Job Scraper failed: ${err.message}`);
    return false;
  }
}

async function runVerification() {
  log('=== API VERIFICATION ===');
  try {
    await runScript('verify-apis.js', []);
    return true;
  } catch (err) {
    log(`Verification failed: ${err.message}`);
    return false;
  }
}

async function getStats() {
  const stats = {};

  // Get job count
  const { count: jobCount } = await supabase
    .from('jobs')
    .select('*', { count: 'exact', head: true });
  stats.totalJobs = jobCount || 0;

  // Get API endpoint count
  const { count: apiCount } = await supabase
    .from('career_pages')
    .select('*', { count: 'exact', head: true })
    .not('api_endpoint', 'is', null);
  stats.apiEndpoints = apiCount || 0;

  // Get company count
  const { count: companyCount } = await supabase
    .from('companies')
    .select('*', { count: 'exact', head: true });
  stats.companies = companyCount || 0;

  return stats;
}

async function runAllTasks() {
  log('');
  log('===========================================');
  log('STARTING FULL SCRAPING CYCLE');
  log('===========================================');

  const startTime = Date.now();
  const results = {
    apiDiscovery: false,
    sitemapFinder: false,
    apiScraper: false,
    sitemapScraper: false,
    verification: false
  };

  // Get initial stats
  const statsBefore = await getStats();
  log(`Before: ${statsBefore.totalJobs} jobs, ${statsBefore.apiEndpoints} API endpoints`);

  // Step 1: Discover new API endpoints
  results.apiDiscovery = await runAPIDiscovery();
  await sleep(2000);

  // Step 2: Find sitemaps for sites without APIs
  results.sitemapFinder = await runSitemapFinder();
  await sleep(2000);

  // Step 3: Scrape jobs from APIs
  results.apiScraper = await runJobScraper('api');
  await sleep(2000);

  // Step 4: Scrape jobs from sitemaps
  results.sitemapScraper = await runJobScraper('sitemap');
  await sleep(2000);

  // Step 5: Verify all APIs still work
  results.verification = await runVerification();

  // Get final stats
  const statsAfter = await getStats();

  // Summary
  const duration = Math.round((Date.now() - startTime) / 1000 / 60);
  log('');
  log('===========================================');
  log('CYCLE COMPLETE');
  log('===========================================');
  log(`Duration: ${duration} minutes`);
  log(`Jobs: ${statsBefore.totalJobs} -> ${statsAfter.totalJobs} (+${statsAfter.totalJobs - statsBefore.totalJobs})`);
  log(`API Endpoints: ${statsBefore.apiEndpoints} -> ${statsAfter.apiEndpoints}`);
  log('');
  log('Task Results:');
  log(`  API Discovery: ${results.apiDiscovery ? 'OK' : 'FAILED'}`);
  log(`  Sitemap Finder: ${results.sitemapFinder ? 'OK' : 'FAILED'}`);
  log(`  API Scraper: ${results.apiScraper ? 'OK' : 'FAILED'}`);
  log(`  Sitemap Scraper: ${results.sitemapScraper ? 'OK' : 'FAILED'}`);
  log(`  Verification: ${results.verification ? 'OK' : 'FAILED'}`);
  log('===========================================');

  return results;
}

async function runContinuously() {
  log('');
  log('===========================================');
  log('SCHEDULER STARTED - CONTINUOUS MODE');
  log('===========================================');
  log('');
  log('Schedule:');
  log(`  - API Discovery: Every ${CONFIG.intervals.apiDiscovery / 1000 / 60 / 60} hours`);
  log(`  - Sitemap Finder: Every ${CONFIG.intervals.sitemapFinder / 1000 / 60 / 60} hours`);
  log(`  - Job Scraper: Every ${CONFIG.intervals.jobScraper / 1000 / 60 / 60} hours`);
  log(`  - Verification: Every ${CONFIG.intervals.verification / 1000 / 60 / 60} hours`);
  log('');
  log('Press Ctrl+C to stop');
  log('');

  // Run initial cycle
  await runAllTasks();

  // Schedule periodic runs
  setInterval(async () => {
    await runAPIDiscovery();
  }, CONFIG.intervals.apiDiscovery);

  setInterval(async () => {
    await runSitemapFinder();
  }, CONFIG.intervals.sitemapFinder);

  setInterval(async () => {
    await runJobScraper('api');
    await sleep(5000);
    await runJobScraper('sitemap');
  }, CONFIG.intervals.jobScraper);

  setInterval(async () => {
    await runVerification();
  }, CONFIG.intervals.verification);
}

async function runSingleTask(taskName) {
  log(`Running single task: ${taskName}`);

  switch (taskName) {
    case 'api-discovery':
      await runAPIDiscovery();
      break;
    case 'sitemap-finder':
      await runSitemapFinder();
      break;
    case 'scrape-api':
      await runJobScraper('api');
      break;
    case 'scrape-sitemap':
      await runJobScraper('sitemap');
      break;
    case 'verify':
      await runVerification();
      break;
    case 'all':
      await runAllTasks();
      break;
    default:
      console.log(`Unknown task: ${taskName}`);
      console.log('Available tasks: api-discovery, sitemap-finder, scrape-api, scrape-sitemap, verify, all');
      process.exit(1);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function printHelp() {
  console.log(`
Job Scraper Scheduler
=====================

Usage: node scheduler.js [options]

Options:
  --once, -o              Run all tasks once and exit
  --continuous, -c        Run continuously on schedule
  --task=<name>           Run a specific task

Available tasks:
  api-discovery           Find new API endpoints from application URLs
  sitemap-finder          Find sitemaps on sites without APIs
  scrape-api              Scrape jobs from API endpoints
  scrape-sitemap          Scrape jobs from sitemaps
  verify                  Verify all API endpoints still work
  all                     Run all tasks in sequence

Examples:
  node scheduler.js --once              # Run all tasks once
  node scheduler.js --continuous        # Run continuously
  node scheduler.js --task=scrape-api   # Run only API scraping
  `);
}

// Main
async function main() {
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }

  if (TASK) {
    await runSingleTask(TASK);
  } else if (CONTINUOUS) {
    await runContinuously();
  } else if (RUN_ONCE) {
    await runAllTasks();
  } else {
    printHelp();
  }
}

main().catch(err => {
  log(`Fatal error: ${err.message}`);
  process.exit(1);
});
