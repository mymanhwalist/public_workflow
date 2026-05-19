/**
 * Job Scraper Dashboard — Express Server
 * API routes, process management, SSE log streaming, DB stats
 */

import express from 'express';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = resolve(__dirname, '..');

const SUPABASE_URL = 'https://bojsbsoqpnuzikyzpjlh.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJvanNic29xcG51emlreXpwamxoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQxMTQ4NTIsImV4cCI6MjA2OTY5MDg1Mn0.-I2x1wJSHETB7E-r84V9tQLhdxRpa8xthx9DOTmr908';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Script Registry ─────────────────────────────────────────────────────────

const SCRIPTS = {
  // ── Discovery: Find job sources ────────────────────────────────────
  'check-all-urls': {
    name: 'Find API Endpoints',
    description: 'Scans company application URLs to discover public API endpoints (Lever, Greenhouse, Ashby, etc.)',
    group: 'discovery',
    file: 'check-all-urls.js',
    cwd: resolve(BASE, 'apifromurl'),
    flags: [
      { flag: '--test-api', type: 'boolean', description: 'Test discovered API endpoints' },
      { flag: '--update', type: 'boolean', description: 'Save findings to database' },
      { flag: '--force', type: 'boolean', description: 'Re-check all companies, ignore skip logic' },
    ],
  },
  'sitemap-finder': {
    name: 'Find Sitemaps',
    description: 'Checks company websites for job sitemaps (for companies without API endpoints)',
    group: 'discovery',
    file: 'sitemap-finder.js',
    cwd: resolve(BASE, 'apifromurl'),
    flags: [
      { flag: '--update', type: 'boolean', description: 'Save findings to database' },
      { flag: '--verbose', type: 'boolean', description: 'Show progress for each domain' },
      { flag: '--force', type: 'boolean', description: 'Re-check all companies, ignore skip logic' },
    ],
  },
  // ── Scraping: Fetch jobs from sources ──────────────────────────────
  'job-scraper': {
    name: 'Scrape Jobs (API)',
    description: 'Fetches job listings from discovered API endpoints (Lever, Greenhouse, Ashby, SmartRecruiters, etc.)',
    group: 'scraping',
    file: 'job-scraper.js',
    cwd: resolve(BASE, 'apifromurl'),
    flags: [
      { flag: '--dry-run', type: 'boolean', description: 'Preview only, no DB writes', default: true },
      { flag: '--verbose', type: 'boolean', description: 'Verbose output' },
      { flag: '--all', type: 'boolean', description: 'Include all jobs (no date filter)' },
      { flag: '--days', type: 'value', description: 'Filter jobs from last N days', placeholder: '7' },
      { flag: '--force', type: 'boolean', description: 'Re-scrape recently-scraped sources' },
    ],
  },
  'job-scraper-sitemap': {
    name: 'Scrape Jobs (Sitemap)',
    description: 'Fetches job listings from sitemaps — lightweight, uses URL + lastmod only',
    group: 'scraping',
    file: 'job-scraper.js',
    cwd: resolve(BASE, 'apifromurl'),
    flags: [
      { flag: '--sitemap', type: 'boolean', description: 'Use sitemap sources', default: true, hidden: true },
      { flag: '--dry-run', type: 'boolean', description: 'Preview only, no DB writes', default: true },
      { flag: '--verbose', type: 'boolean', description: 'Verbose output' },
      { flag: '--all', type: 'boolean', description: 'Include all jobs (no date filter)' },
      { flag: '--days', type: 'value', description: 'Filter jobs from last N days', placeholder: '7' },
      { flag: '--force', type: 'boolean', description: 'Re-scrape recently-scraped sources' },
    ],
  },
  'sitemap-scraper': {
    name: 'Scrape Jobs (Deep Sitemap)',
    description: 'Visits each job page from sitemaps and extracts full details (title, description, location)',
    group: 'scraping',
    file: 'scraper.js',
    cwd: resolve(BASE, 'sitemap-scraper'),
    flags: [
      { flag: '--dry-run', type: 'boolean', description: 'Preview only, no DB writes', default: true },
      { flag: '--verbose', type: 'boolean', description: 'Verbose output' },
      { flag: '--limit', type: 'value', description: 'Process first N companies', placeholder: '5' },
      { flag: '--concurrency', type: 'value', description: 'Parallel companies', placeholder: '1' },
      { flag: '--max-jobs', type: 'value', description: 'Max job pages per company', placeholder: '10' },
      { flag: '--force', type: 'boolean', description: 'Re-scrape recently-scraped sources' },
    ],
  },
  // ── Maintenance ────────────────────────────────────────────────────
  'verify-apis': {
    name: 'Verify API Endpoints',
    description: 'Tests all saved API endpoints to check if they still return data',
    group: 'maintenance',
    file: 'verify-apis.js',
    cwd: resolve(BASE, 'apifromurl'),
    flags: [],
  },
  scheduler: {
    name: 'Run All (Scheduler)',
    description: 'Runs discovery + scraping + verification tasks in sequence or on a schedule',
    group: 'maintenance',
    file: 'scheduler.js',
    cwd: resolve(BASE, 'apifromurl'),
    flags: [
      { flag: '--once', type: 'boolean', description: 'Run all tasks once and exit' },
      { flag: '--continuous', type: 'boolean', description: 'Run continuously on schedule' },
      {
        flag: '--task',
        type: 'select',
        description: 'Run a specific task',
        options: ['api-discovery', 'sitemap-finder', 'scrape-api', 'scrape-sitemap', 'verify', 'all'],
      },
    ],
  },
};

// ── Process Management ──────────────────────────────────────────────────────

/** @type {Map<string, object>} */
const processes = new Map();

function buildArgs(scriptKey, flags) {
  const spec = SCRIPTS[scriptKey];
  if (!spec) return null;

  const allowed = new Set(spec.flags.map((f) => f.flag));
  const args = [];

  // Auto-include hidden flags that have defaults
  for (const f of spec.flags) {
    if (f.hidden && f.default) {
      args.push(f.flag);
    }
  }

  for (const f of flags) {
    const parts = f.split('=');
    const name = parts[0];
    if (!allowed.has(name)) return null; // reject unknown flags
    args.push(f);
  }

  return args;
}

function isScriptRunning(scriptKey) {
  for (const p of processes.values()) {
    if (p.script === scriptKey && p.status === 'running') return true;
  }
  return false;
}

function pruneOld() {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  for (const [id, p] of processes) {
    if (p.status !== 'running' && p.endedAt < oneHourAgo) {
      processes.delete(id);
    }
  }
}

setInterval(pruneOld, 5 * 60 * 1000);

// ── Express App ─────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());
app.use(express.static(resolve(__dirname, 'public')));

// List scripts
app.get('/api/scripts', (_req, res) => {
  const list = Object.entries(SCRIPTS).map(([key, s]) => ({
    key,
    name: s.name,
    description: s.description || '',
    group: s.group || 'other',
    flags: s.flags,
    running: isScriptRunning(key),
  }));
  res.json(list);
});

// DB stats
app.get('/api/stats', async (_req, res) => {
  try {
    const [companies, jobs, activeJobs, careerPages, apiSources, sitemapSources, atsBreakdown, recentJobs] =
      await Promise.all([
        supabase.from('companies').select('id', { count: 'exact', head: true }),
        supabase.from('jobs').select('id', { count: 'exact', head: true }),
        supabase.from('jobs').select('id', { count: 'exact', head: true }).eq('is_active', true),
        supabase.from('career_pages').select('id', { count: 'exact', head: true }),
        supabase
          .from('career_pages')
          .select('id', { count: 'exact', head: true })
          .not('api_endpoint', 'is', null),
        supabase
          .from('career_pages')
          .select('id', { count: 'exact', head: true })
          .not('sitemap_url', 'is', null),
        supabase.from('career_pages').select('ats_provider'),
        supabase
          .from('jobs')
          .select('id, title, company_id, source_url, scraped_at')
          .order('scraped_at', { ascending: false })
          .limit(10),
      ]);

    // ATS breakdown: count by provider
    const atsCounts = {};
    if (atsBreakdown.data) {
      for (const row of atsBreakdown.data) {
        const provider = row.ats_provider || 'Unknown';
        atsCounts[provider] = (atsCounts[provider] || 0) + 1;
      }
    }

    const totalCareer = careerPages.count || 0;
    const totalCompanies = companies.count || 0;
    const coverage = totalCompanies > 0 ? ((totalCareer / totalCompanies) * 100).toFixed(1) : '0';

    res.json({
      companies: companies.count || 0,
      jobs: jobs.count || 0,
      activeJobs: activeJobs.count || 0,
      careerPages: totalCareer,
      apiSources: apiSources.count || 0,
      sitemapSources: sitemapSources.count || 0,
      coverage: `${coverage}%`,
      atsBreakdown: atsCounts,
      recentJobs: recentJobs.data || [],
    });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Run a script
app.post('/api/scripts/run', (req, res) => {
  const { script, flags = [] } = req.body;
  const spec = SCRIPTS[script];
  if (!spec) return res.status(400).json({ error: 'Unknown script' });

  if (isScriptRunning(script)) {
    return res.status(409).json({ error: `${spec.name} is already running` });
  }

  const args = buildArgs(script, flags);
  if (args === null) return res.status(400).json({ error: 'Invalid flags' });

  const taskId = randomUUID();
  const child = spawn('node', [spec.file, ...args], {
    cwd: spec.cwd,
    env: { ...process.env, FORCE_COLOR: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const info = {
    taskId,
    script,
    name: spec.name,
    pid: child.pid,
    flags: args,
    status: 'running',
    startedAt: Date.now(),
    endedAt: null,
    exitCode: null,
    logs: [],
    subscribers: new Set(),
  };

  processes.set(taskId, info);

  const broadcast = (data) => {
    const line = JSON.stringify(data);
    for (const sub of info.subscribers) {
      sub.write(`data: ${line}\n\n`);
    }
  };

  const handleData = (stream) => (chunk) => {
    const lines = chunk.toString().split('\n');
    for (const text of lines) {
      if (text === '') continue;
      const entry = { stream, text, ts: Date.now() };
      info.logs.push(entry);
      broadcast(entry);
    }
  };

  child.stdout.on('data', handleData('stdout'));
  child.stderr.on('data', handleData('stderr'));

  child.on('close', (code, signal) => {
    info.status = code === 0 ? 'completed' : 'failed';
    info.exitCode = code;
    info.endedAt = Date.now();

    broadcast({ stream: 'system', text: `Process exited with code ${code}${signal ? ` (signal: ${signal})` : ''}`, ts: Date.now(), exit: true, code });

    // Close all SSE connections
    for (const sub of info.subscribers) {
      sub.end();
    }
    info.subscribers.clear();
  });

  child.on('error', (err) => {
    info.status = 'failed';
    info.endedAt = Date.now();
    const entry = { stream: 'system', text: `Spawn error: ${err.message}`, ts: Date.now(), exit: true, code: -1 };
    info.logs.push(entry);
    broadcast(entry);
    for (const sub of info.subscribers) sub.end();
    info.subscribers.clear();
  });

  // Store reference for kill
  info._child = child;

  res.json({ taskId, pid: child.pid });
});

// List processes
app.get('/api/processes', (_req, res) => {
  const list = [];
  for (const [id, p] of processes) {
    list.push({
      taskId: id,
      script: p.script,
      name: p.name,
      pid: p.pid,
      flags: p.flags,
      status: p.status,
      startedAt: p.startedAt,
      endedAt: p.endedAt,
      exitCode: p.exitCode,
      logCount: p.logs.length,
    });
  }
  // Most recent first
  list.sort((a, b) => b.startedAt - a.startedAt);
  res.json(list);
});

// Kill a process
app.post('/api/processes/:id/kill', (req, res) => {
  const info = processes.get(req.params.id);
  if (!info) return res.status(404).json({ error: 'Process not found' });
  if (info.status !== 'running') return res.status(400).json({ error: 'Process is not running' });

  const child = info._child;
  child.kill('SIGTERM');

  // Force kill after 5s
  const forceTimer = setTimeout(() => {
    try {
      child.kill('SIGKILL');
    } catch {}
  }, 5000);

  child.on('close', () => clearTimeout(forceTimer));

  res.json({ ok: true });
});

// SSE log stream
app.get('/api/processes/:id/logs', (req, res) => {
  const info = processes.get(req.params.id);
  if (!info) return res.status(404).json({ error: 'Process not found' });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  // Flush buffered logs
  for (const entry of info.logs) {
    res.write(`data: ${JSON.stringify(entry)}\n\n`);
  }

  // If already finished, send exit and close
  if (info.status !== 'running') {
    res.write(`data: ${JSON.stringify({ stream: 'system', text: `Process already ${info.status} (code ${info.exitCode})`, ts: Date.now(), exit: true, code: info.exitCode })}\n\n`);
    res.end();
    return;
  }

  // Subscribe for new logs
  info.subscribers.add(res);
  req.on('close', () => info.subscribers.delete(res));
});

// ── Start ───────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Dashboard running at http://localhost:${PORT}`);
});
