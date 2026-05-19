/**
 * ATS Detector & API Builder
 * Detects ATS provider from URL and constructs API endpoints
 */

// ===========================================
// ATS PATTERNS
// ===========================================
const ATS_PATTERNS = [
  // Lever
  {
    provider: 'Lever',
    patterns: [
      /jobs\.lever\.co\/([^\/]+)/i,
      /lever\.co\/([^\/]+)/i
    ],
    hasPublicAPI: true,
    buildAPI: (match) => ({
      list: `https://api.lever.co/v0/postings/${match[1]}`,
      detail: `https://api.lever.co/v0/postings/${match[1]}/{id}`
    }),
    careerPage: (match) => `https://jobs.lever.co/${match[1]}`
  },

  // Greenhouse
  {
    provider: 'Greenhouse',
    patterns: [
      /boards\.greenhouse\.io\/([^\/]+)/i,
      /greenhouse\.io\/([^\/]+)/i,
      /([^\.]+)\.greenhouse\.io/i
    ],
    hasPublicAPI: true,
    buildAPI: (match) => ({
      list: `https://boards-api.greenhouse.io/v1/boards/${match[1]}/jobs`,
      detail: `https://boards-api.greenhouse.io/v1/boards/${match[1]}/jobs/{id}`
    }),
    careerPage: (match) => `https://boards.greenhouse.io/${match[1]}`
  },

  // Ashby
  {
    provider: 'Ashby',
    patterns: [
      /jobs\.ashbyhq\.com\/([^\/]+)/i,
      /([^\.]+)\.ashbyhq\.com/i
    ],
    hasPublicAPI: true,
    buildAPI: (match) => ({
      list: `https://api.ashbyhq.com/posting-api/job-board/${match[1]}`,
      detail: `https://api.ashbyhq.com/posting-api/job-board/${match[1]}/{id}`
    }),
    careerPage: (match) => `https://jobs.ashbyhq.com/${match[1]}`
  },

  // Workable
  {
    provider: 'Workable',
    patterns: [
      /apply\.workable\.com\/(?!j\/)([a-zA-Z0-9_-]+)/i,
      /\/\/(?!apply\.)([a-zA-Z0-9_-]+)\.workable\.com/i
    ],
    hasPublicAPI: true,
    buildAPI: (match) => ({
      list: `https://apply.workable.com/api/v3/accounts/${match[1]}/jobs`,
      detail: `https://apply.workable.com/api/v3/accounts/${match[1]}/jobs/{id}`,
      method: 'POST',
      body: JSON.stringify({ query: '', location: [], department: [], worktype: [], remote: [] })
    }),
    careerPage: (match) => `https://apply.workable.com/${match[1]}`
  },

  // SmartRecruiters
  {
    provider: 'SmartRecruiters',
    patterns: [
      /jobs\.smartrecruiters\.com\/([^\/]+)/i,
      /smartrecruiters\.com\/([^\/]+)/i
    ],
    hasPublicAPI: true,
    buildAPI: (match) => ({
      list: `https://api.smartrecruiters.com/v1/companies/${match[1]}/postings`,
      detail: `https://api.smartrecruiters.com/v1/companies/${match[1]}/postings/{id}`
    }),
    careerPage: (match) => `https://jobs.smartrecruiters.com/${match[1]}`
  },

  // Jobvite
  {
    provider: 'Jobvite',
    patterns: [
      /jobs\.jobvite\.com\/([^\/]+)/i,
      /([^\.]+)\.jobvite\.com/i
    ],
    hasPublicAPI: true,
    buildAPI: (match) => ({
      list: `https://jobs.jobvite.com/${match[1]}/jobs`,
      detail: `https://jobs.jobvite.com/${match[1]}/job/{id}`
    }),
    careerPage: (match) => `https://jobs.jobvite.com/${match[1]}`
  },

  // BambooHR
  {
    provider: 'BambooHR',
    patterns: [
      /https?:\/\/([^\.]+)\.bamboohr\.com/i
    ],
    hasPublicAPI: true,
    buildAPI: (match) => ({
      list: `https://api.bamboohr.com/api/gateway.php/${match[1]}/v1/applicant_tracking/jobs`,
      detail: `https://api.bamboohr.com/api/gateway.php/${match[1]}/v1/applicant_tracking/jobs/{id}`
    }),
    careerPage: (match) => `https://${match[1]}.bamboohr.com/careers`
  },

  // Recruitee
  {
    provider: 'Recruitee',
    patterns: [
      /https?:\/\/([^\.]+)\.recruitee\.com/i
    ],
    hasPublicAPI: true,
    buildAPI: (match) => ({
      list: `https://${match[1]}.recruitee.com/api/offers`,
      detail: `https://${match[1]}.recruitee.com/api/offers/{id}`
    }),
    careerPage: (match) => `https://${match[1]}.recruitee.com`
  },

  // Personio
  {
    provider: 'Personio',
    patterns: [
      /([^\.]+)\.jobs\.personio\.de/i,
      /([^\.]+)\.jobs\.personio\.com/i
    ],
    hasPublicAPI: true,
    buildAPI: (match) => ({
      list: `https://${match[1]}.jobs.personio.com/xml`,
      detail: `https://${match[1]}.jobs.personio.com/job/{id}`
    }),
    careerPage: (match) => `https://${match[1]}.jobs.personio.com`
  },

  // JazzHR — API requires private key, not public
  {
    provider: 'JazzHR',
    patterns: [
      /([^\.]+)\.applytojob\.com/i
    ],
    hasPublicAPI: false,
    careerPage: (match) => `https://${match[1]}.applytojob.com`
  },

  // Breezy HR
  {
    provider: 'Breezy HR',
    patterns: [
      /https?:\/\/([^\.]+)\.breezy\.hr/i
    ],
    hasPublicAPI: true,
    buildAPI: (match) => ({
      list: `https://${match[1]}.breezy.hr/json`,
      detail: `https://${match[1]}.breezy.hr/p/{id}/json`
    }),
    careerPage: (match) => `https://${match[1]}.breezy.hr`
  },

  // Rippling
  {
    provider: 'Rippling',
    patterns: [
      /ats\.rippling\.com\/([^\/]+)/i
    ],
    hasPublicAPI: false,
    careerPage: (match) => `https://ats.rippling.com/${match[1]}`
  },

  // ==== NO PUBLIC API ====

  // Workday
  {
    provider: 'Workday',
    patterns: [
      /([^\.]+)\.myworkdayjobs\.com/i,
      /myworkdayjobs\.com\/([^\/]+)/i,
      /wd\d+\.myworkdaysite\.com/i
    ],
    hasPublicAPI: false,
    careerPage: (match) => match.input
  },

  // Taleo
  {
    provider: 'Taleo',
    patterns: [
      /taleo\.net/i,
      /taleneo\.io/i
    ],
    hasPublicAPI: false,
    careerPage: null
  },

  // BrassRing
  {
    provider: 'BrassRing',
    patterns: [
      /brassring\.com/i,
      /krb-sjobs\.brassring\.com/i
    ],
    hasPublicAPI: false,
    careerPage: null
  },

  // iCIMS
  {
    provider: 'iCIMS',
    patterns: [
      /icims\.com/i,
      /careers-([^\.]+)\.icims\.com/i
    ],
    hasPublicAPI: false,
    careerPage: null
  },

  // SuccessFactors
  {
    provider: 'SuccessFactors',
    patterns: [
      /successfactors\.com/i,
      /successfactors\.eu/i
    ],
    hasPublicAPI: false,
    careerPage: null
  },

  // SAP
  {
    provider: 'SAP',
    patterns: [
      /jobs\.sap\.com/i,
      /sap\.com.*careers/i
    ],
    hasPublicAPI: false,
    careerPage: null
  },

  // Oracle
  {
    provider: 'Oracle',
    patterns: [
      /oracle\.com.*careers/i,
      /oraclecloud\.com/i
    ],
    hasPublicAPI: false,
    careerPage: null
  },

  // ADP
  {
    provider: 'ADP',
    patterns: [
      /myjobs\.adp\.com/i,
      /adp\.com/i
    ],
    hasPublicAPI: false,
    careerPage: null
  },

  // Paylocity
  {
    provider: 'Paylocity',
    patterns: [
      /paylocity\.com/i
    ],
    hasPublicAPI: false,
    careerPage: null
  },

  // UKG (UltiPro)
  {
    provider: 'UKG',
    patterns: [
      /ultipro\.com/i,
      /ukg\.com/i
    ],
    hasPublicAPI: false,
    careerPage: null
  },

  // Ceridian (Dayforce)
  {
    provider: 'Dayforce',
    patterns: [
      /ceridian\.com/i,
      /dayforce\.com/i
    ],
    hasPublicAPI: false,
    careerPage: null
  },

  // Paycom
  {
    provider: 'Paycom',
    patterns: [
      /paycomonline\.net/i,
      /paycom\.com/i
    ],
    hasPublicAPI: false,
    careerPage: null
  },

  // ApplicantPro
  {
    provider: 'ApplicantPro',
    patterns: [
      /applicantpro\.com/i
    ],
    hasPublicAPI: false,
    careerPage: null
  },

  // Indeed
  {
    provider: 'Indeed',
    patterns: [
      /indeed\.com/i,
      /indeedjobs\.com/i
    ],
    hasPublicAPI: false,
    careerPage: null
  },

  // LinkedIn
  {
    provider: 'LinkedIn',
    patterns: [
      /linkedin\.com\/jobs/i,
      /linkedin\.com\/job/i
    ],
    hasPublicAPI: false,
    careerPage: null
  },

  // ZipRecruiter
  {
    provider: 'ZipRecruiter',
    patterns: [
      /ziprecruiter\.com/i
    ],
    hasPublicAPI: false,
    careerPage: null
  }
];

// ===========================================
// DETECTOR FUNCTIONS
// ===========================================

/**
 * Detect ATS provider from application URL
 */
export function detectATS(url) {
  if (!url) {
    return { provider: 'Unknown', hasPublicAPI: false, match: null };
  }

  for (const ats of ATS_PATTERNS) {
    for (const pattern of ats.patterns) {
      const match = url.match(pattern);
      if (match) {
        return {
          provider: ats.provider,
          hasPublicAPI: ats.hasPublicAPI,
          match: match,
          careerPageUrl: ats.careerPage ? ats.careerPage(match) : null,
          buildAPI: ats.buildAPI
        };
      }
    }
  }

  // Try to detect custom career pages
  if (url.includes('/careers') || url.includes('/jobs') || url.includes('/job/')) {
    return { provider: 'Custom', hasPublicAPI: false, match: null };
  }

  return { provider: 'Unknown', hasPublicAPI: false, match: null };
}

/**
 * Build API endpoint from URL and ATS info
 */
export function buildAPIEndpoint(url, atsInfo) {
  if (!atsInfo.hasPublicAPI || !atsInfo.buildAPI || !atsInfo.match) {
    return null;
  }

  try {
    return atsInfo.buildAPI(atsInfo.match);
  } catch (err) {
    console.error('Error building API endpoint:', err.message);
    return null;
  }
}

/**
 * Get all supported ATS providers
 */
export function getSupportedATS() {
  return ATS_PATTERNS.map(ats => ({
    provider: ats.provider,
    hasPublicAPI: ats.hasPublicAPI
  }));
}
