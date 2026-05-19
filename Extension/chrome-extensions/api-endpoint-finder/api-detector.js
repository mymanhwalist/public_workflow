/**
 * API Endpoint Detector
 * Detects career/jobs API endpoints from web pages
 */

class APIDetector {
    constructor() {
        console.log('[API Detector] Initialized');
    }

    /**
     * Main detection method
     * @returns {Object} { endpoint: string|null, provider: string|null }
     */
    detect() {
        const endpoint = this.detectAPIEndpoint();
        const provider = this.detectATS();

        console.log('[API Detector] Result:', { endpoint, provider });

        return {
            endpoint: endpoint,
            provider: provider
        };
    }

    /**
     * Detect API endpoint from page source
     * @returns {string|null} API endpoint URL or null
     */
    detectAPIEndpoint() {
        console.log('[API Detector] Scanning for API endpoints...');

        const apiPatterns = [
            // Specific ATS APIs (highest priority)
            /https?:\/\/[^"'\s]*lever\.co\/[^"'\s]*\/postings[^"'\s]*/gi,
            /https?:\/\/api\.lever\.co\/[^"'\s]*/gi,
            /https?:\/\/boards-api\.greenhouse\.io\/[^"'\s]*/gi,
            /https?:\/\/api\.greenhouse\.io\/[^"'\s]*/gi,
            /https?:\/\/[^"'\s]*\.greenhouse\.io\/embed\/[^"'\s]*/gi,
            /https?:\/\/[^"'\s]*workable\.com\/spi\/[^"'\s]*/gi,
            /https?:\/\/[^"'\s]*workable\.com\/api\/[^"'\s]*/gi,
            /https?:\/\/api\.ashbyhq\.com\/[^"'\s]*/gi,
            /https?:\/\/jobs\.ashbyhq\.com\/api\/[^"'\s]*/gi,
            /https?:\/\/[^"'\s]*smartrecruiters\.com\/api\/[^"'\s]*/gi,
            /https?:\/\/api\.smartrecruiters\.com\/[^"'\s]*/gi,
            /https?:\/\/[^"'\s]*jobvite\.com\/api\/[^"'\s]*/gi,
            /https?:\/\/api\.jobvite\.com\/[^"'\s]*/gi,
            /https?:\/\/[^"'\s]*breezy\.hr\/api\/[^"'\s]*/gi,
            /https?:\/\/api\.breezy\.hr\/[^"'\s]*/gi,
            /https?:\/\/[^"'\s]*bamboohr\.com\/careers_api\/[^"'\s]*/gi,
            /https?:\/\/api\.bamboohr\.com\/[^"'\s]*/gi,
            /https?:\/\/[^"'\s]*applytojob\.com\/api\/[^"'\s]*/gi,
            /https?:\/\/[^"'\s]*teamtailor\.com\/api\/[^"'\s]*/gi,
            /https?:\/\/api\.teamtailor\.com\/[^"'\s]*/gi,
            /https?:\/\/[^"'\s]*recruitee\.com\/api\/[^"'\s]*/gi,
            /https?:\/\/api\.recruitee\.com\/[^"'\s]*/gi,
            // Generic API patterns
            /https?:\/\/api\.[^"'\s]*\/[^"'\s]*jobs[^"'\s]*/gi,
            /https?:\/\/api\.[^"'\s]*\/[^"'\s]*careers[^"'\s]*/gi,
            /https?:\/\/api\.[^"'\s]*\/[^"'\s]*postings[^"'\s]*/gi,
            /https?:\/\/api\.[^"'\s]*\/[^"'\s]*positions[^"'\s]*/gi,
            /https?:\/\/api\.[^"'\s]*\/[^"'\s]*openings[^"'\s]*/gi,
            /https?:\/\/[^"'\s]*\/api\/[^"'\s]*jobs[^"'\s]*/gi,
            /https?:\/\/[^"'\s]*\/api\/[^"'\s]*careers[^"'\s]*/gi,
            /https?:\/\/[^"'\s]*\/api\/v[0-9]+\/[^"'\s]*jobs[^"'\s]*/gi,
            /https?:\/\/[^"'\s]*\/api\/v[0-9]+\/[^"'\s]*positions[^"'\s]*/gi,
            // Broader patterns (lower priority)
            /https?:\/\/[^"'\s]+\/api\/[^"'\s]*/gi
        ];

        const foundAPIs = new Set();

        // Check all script tags
        document.querySelectorAll('script').forEach(script => {
            const content = script.textContent || script.innerHTML;
            apiPatterns.forEach(pattern => {
                const matches = content.match(pattern);
                if (matches) {
                    matches.forEach(url => {
                        const cleanUrl = this.cleanURL(url);
                        if (cleanUrl) foundAPIs.add(cleanUrl);
                    });
                }
            });
        });

        // Check HTML body
        const bodyHTML = document.body.innerHTML;
        apiPatterns.forEach(pattern => {
            const matches = bodyHTML.match(pattern);
            if (matches) {
                matches.forEach(url => {
                    const cleanUrl = this.cleanURL(url);
                    if (cleanUrl) foundAPIs.add(cleanUrl);
                });
            }
        });

        // Filter out non-API URLs
        const excludePatterns = [
            /\.pdf$/i, /\.png$/i, /\.jpg$/i, /\.jpeg$/i, /\.gif$/i, /\.svg$/i,
            /\.css$/i, /\.js$/i, /\.woff/i, /\.ttf/i, /\.webp$/i,
            /\/docs?\//i, /\/documentation\//i, /\/help\//i, /\/support\//i,
            /\/static\//i, /\/assets\//i,
            /\/image\/api\//i, /\/images\/api\//i,
            /diffbot\.com\/image/i,
            /\/media\/api\//i, /\/cdn\/api\//i,
            /google-analytics/i, /googletagmanager/i, /analytics/i,
            /facebook\.com/i, /twitter\.com/i, /linkedin\.com/i
        ];

        const apiList = Array.from(foundAPIs).filter(url => {
            return !excludePatterns.some(pattern => pattern.test(url)) && url.startsWith('http');
        });

        // Prioritize job API URLs
        const jobAPIKeywords = ['posting', 'jobs', 'careers', 'positions', 'openings', 'opportunities'];
        const likelyJobAPIs = apiList.filter(url =>
            jobAPIKeywords.some(keyword => url.toLowerCase().includes(keyword))
        );

        const bestAPI = likelyJobAPIs.length > 0 ? likelyJobAPIs[0] : apiList[0];

        if (apiList.length > 0) {
            console.log('[API Detector] Found', apiList.length, 'API endpoints');
            console.log('[API Detector] Best match:', bestAPI);
        } else {
            console.log('[API Detector] No API endpoints found');
        }

        return bestAPI || null;
    }

    /**
     * Detect ATS (Applicant Tracking System) provider
     * @returns {string|null} ATS provider name or null
     */
    detectATS() {
        const url = window.location.href;
        const html = document.documentElement.innerHTML;

        const atsPatterns = [
            { name: 'Greenhouse', patterns: [/greenhouse\.io/i, /gh_jid=/i] },
            { name: 'Lever', patterns: [/lever\.co/i, /lever-apply/i] },
            { name: 'Workable', patterns: [/workable\.com/i, /apply\.workable/i] },
            { name: 'Ashby', patterns: [/ashbyhq\.com/i, /jobs\.ashby/i] },
            { name: 'SmartRecruiters', patterns: [/smartrecruiters\.com/i] },
            { name: 'Jobvite', patterns: [/jobvite\.com/i] },
            { name: 'BambooHR', patterns: [/bamboohr\.com/i] },
            { name: 'JazzHR', patterns: [/jazz\.co/i, /resumator\.com/i] },
            { name: 'Breezy HR', patterns: [/breezy\.hr/i] },
            { name: 'BrassRing', patterns: [/brassring\.com/i] },
            { name: 'iCIMS', patterns: [/icims\.com/i] },
            { name: 'Taleo', patterns: [/taleo\.net/i] },
            { name: 'Workday', patterns: [/workday\.com/i, /myworkdayjobs\.com/i] },
            { name: 'UltiPro', patterns: [/ultipro\.com/i] },
            { name: 'SuccessFactors', patterns: [/successfactors\.com/i, /performancemanager\d+\.successfactors\.com/i] },
            { name: 'JobAppNetwork', patterns: [/jobappnetwork\.com/i] },
            { name: 'TeamTailor', patterns: [/teamtailor\.com/i, /career\.teamtailor/i] },
            { name: 'Recruitee', patterns: [/recruitee\.com/i] },
            { name: 'ApplyBoard', patterns: [/applyboard\.com/i] },
            { name: 'Personio', patterns: [/personio\.de/i, /personio\.com/i] }
        ];

        for (const ats of atsPatterns) {
            for (const pattern of ats.patterns) {
                if (pattern.test(url) || pattern.test(html)) {
                    console.log('[API Detector] ATS Provider:', ats.name);
                    return ats.name;
                }
            }
        }

        console.log('[API Detector] No known ATS provider detected');
        return null;
    }

    /**
     * Clean and normalize URL
     * @param {string} url - Raw URL
     * @returns {string|null} Cleaned URL or null
     */
    cleanURL(url) {
        if (!url) return null;

        const cleaned = url
            .replace(/['"\\]/g, '')
            .replace(/&quot;/g, '')
            .replace(/&amp;/g, '&')
            .replace(/\\u002F/g, '/')
            .trim();

        // Validate URL
        try {
            new URL(cleaned);
            return cleaned;
        } catch (e) {
            return null;
        }
    }
}

// Export for use in content scripts
if (typeof window !== 'undefined') {
    window.APIDetector = APIDetector;
}
