/**
 * ATS Provider Detector
 * Detects ATS provider from a job application URL
 * and builds the corresponding API endpoint if available
 */

const ATS_PATTERNS = [
  {
    provider: 'Lever',
    patterns: [/jobs\.lever\.co\/([^\/]+)/i, /lever\.co\/([^\/]+)/i],
    hasPublicAPI: true,
    buildAPI: (match) => ({
      list: `https://api.lever.co/v0/postings/${match[1]}`,
      detail: `https://api.lever.co/v0/postings/${match[1]}/{id}`
    }),
    careerPage: (match) => `https://jobs.lever.co/${match[1]}`
  },
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
  {
    provider: 'Ashby',
    patterns: [/jobs\.ashbyhq\.com\/([^\/]+)/i, /([^\.]+)\.ashbyhq\.com/i],
    hasPublicAPI: true,
    buildAPI: (match) => ({
      list: `https://api.ashbyhq.com/posting-api/job-board/${match[1]}`,
      detail: `https://api.ashbyhq.com/posting-api/job-board/${match[1]}/{id}`
    }),
    careerPage: (match) => `https://jobs.ashbyhq.com/${match[1]}`
  },
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
  {
    provider: 'SmartRecruiters',
    patterns: [/jobs\.smartrecruiters\.com\/([^\/]+)/i, /smartrecruiters\.com\/([^\/]+)/i],
    hasPublicAPI: true,
    buildAPI: (match) => ({
      list: `https://api.smartrecruiters.com/v1/companies/${match[1]}/postings`,
      detail: `https://api.smartrecruiters.com/v1/companies/${match[1]}/postings/{id}`
    }),
    careerPage: (match) => `https://jobs.smartrecruiters.com/${match[1]}`
  },
  {
    provider: 'BambooHR',
    patterns: [/https?:\/\/([^\.]+)\.bamboohr\.com/i],
    hasPublicAPI: true,
    buildAPI: (match) => ({
      list: `https://api.bamboohr.com/api/gateway.php/${match[1]}/v1/applicant_tracking/jobs`,
      detail: `https://api.bamboohr.com/api/gateway.php/${match[1]}/v1/applicant_tracking/jobs/{id}`
    }),
    careerPage: (match) => `https://${match[1]}.bamboohr.com/careers`
  },
  {
    provider: 'Recruitee',
    patterns: [/https?:\/\/([^\.]+)\.recruitee\.com/i],
    hasPublicAPI: true,
    buildAPI: (match) => ({
      list: `https://${match[1]}.recruitee.com/api/offers`,
      detail: `https://${match[1]}.recruitee.com/api/offers/{id}`
    }),
    careerPage: (match) => `https://${match[1]}.recruitee.com`
  },
  {
    provider: 'Breezy HR',
    patterns: [/https?:\/\/([^\.]+)\.breezy\.hr/i],
    hasPublicAPI: true,
    buildAPI: (match) => ({
      list: `https://${match[1]}.breezy.hr/json`,
      detail: `https://${match[1]}.breezy.hr/p/{id}/json`
    }),
    careerPage: (match) => `https://${match[1]}.breezy.hr`
  },
  {
    provider: 'Personio',
    patterns: [/([^\.]+)\.jobs\.personio\.de/i, /([^\.]+)\.jobs\.personio\.com/i],
    hasPublicAPI: true,
    buildAPI: (match) => ({
      list: `https://${match[1]}.jobs.personio.com/xml`,
      detail: `https://${match[1]}.jobs.personio.com/job/{id}`
    }),
    careerPage: (match) => `https://${match[1]}.jobs.personio.com`
  },
  // No public API providers
  {
    provider: 'Workday',
    patterns: [/([^\.]+)\.myworkdayjobs\.com/i, /myworkdayjobs\.com/i],
    hasPublicAPI: false,
    careerPage: (match) => match.input
  },
  {
    provider: 'iCIMS',
    patterns: [/icims\.com/i],
    hasPublicAPI: false,
    careerPage: null
  },
  {
    provider: 'Taleo',
    patterns: [/taleo\.net/i],
    hasPublicAPI: false,
    careerPage: null
  },
  {
    provider: 'BrassRing',
    patterns: [/brassring\.com/i],
    hasPublicAPI: false,
    careerPage: null
  },
  {
    provider: 'SuccessFactors',
    patterns: [/successfactors\.com/i, /successfactors\.eu/i],
    hasPublicAPI: false,
    careerPage: null
  },
  {
    provider: 'Rippling',
    patterns: [/ats\.rippling\.com\/([^\/]+)/i],
    hasPublicAPI: false,
    careerPage: (match) => `https://ats.rippling.com/${match[1]}`
  },
  {
    provider: 'Jobvite',
    patterns: [/jobs\.jobvite\.com\/([^\/]+)/i],
    hasPublicAPI: true,
    buildAPI: (match) => ({
      list: `https://jobs.jobvite.com/${match[1]}/jobs`,
      detail: `https://jobs.jobvite.com/${match[1]}/job/{id}`
    }),
    careerPage: (match) => `https://jobs.jobvite.com/${match[1]}`
  }
]

export function detectATS(url) {
  if (!url) return { provider: 'Unknown', hasPublicAPI: false, match: null }

  for (const ats of ATS_PATTERNS) {
    for (const pattern of ats.patterns) {
      const match = url.match(pattern)
      if (match) {
        return {
          provider: ats.provider,
          hasPublicAPI: ats.hasPublicAPI,
          match,
          careerPageUrl: ats.careerPage ? ats.careerPage(match) : null,
          apiEndpoint: ats.buildAPI ? ats.buildAPI(match) : null
        }
      }
    }
  }

  if (url.includes('/careers') || url.includes('/jobs') || url.includes('/job/')) {
    return { provider: 'Custom', hasPublicAPI: false, match: null }
  }

  return { provider: 'Unknown', hasPublicAPI: false, match: null }
}

export function extractAtsDomain(url) {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}
