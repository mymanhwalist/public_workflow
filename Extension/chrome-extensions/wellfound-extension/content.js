// Content script for extracting company data from Wellfound startups page

console.log('[Wellfound Scraper] Content script loaded');

// Listen for extraction requests
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extractCompanies') {
    console.log('[Wellfound Scraper] Extracting companies from current page');

    const companies = extractCompaniesFromPage();

    sendResponse({
      success: true,
      companies: companies,
      currentPage: getCurrentPage()
    });

    return true;
  }
});

function extractCompaniesFromPage() {
  const companies = [];

  // Find all company cards on the page
  // Each company is in a div with class "rounded-lg border border-gray-400"
  const companyCards = document.querySelectorAll('div.rounded-lg.border.border-gray-400');

  console.log(`[Wellfound Scraper] Found ${companyCards.length} company cards`);

  companyCards.forEach((card, index) => {
    try {
      // Extract company name
      const nameElement = card.querySelector('h2.inline.text-md.font-semibold');
      const companyName = nameElement ? nameElement.textContent.trim() : null;

      // Extract website URL
      // Look for <dt>Website</dt> followed by <dd> with <a> tag
      const websiteSection = Array.from(card.querySelectorAll('dt')).find(dt =>
        dt.textContent.trim() === 'Website'
      );

      let websiteUrl = null;
      if (websiteSection) {
        const dd = websiteSection.nextElementSibling;
        if (dd && dd.tagName === 'DD') {
          const link = dd.querySelector('a');
          if (link) {
            websiteUrl = link.href || link.textContent.trim();
          }
        }
      }

      if (companyName && websiteUrl) {
        companies.push({
          name: companyName,
          website: websiteUrl,
          careerPage: null, // Will be populated later
          scrapedFrom: window.location.href,
          scrapedAt: new Date().toISOString()
        });

        console.log(`[Wellfound Scraper] ✓ Extracted: ${companyName} - ${websiteUrl}`);
      } else {
        console.warn(`[Wellfound Scraper] ⚠️ Missing data for company ${index + 1}:`, {
          name: companyName,
          website: websiteUrl
        });
      }
    } catch (error) {
      console.error(`[Wellfound Scraper] Error extracting company ${index + 1}:`, error);
    }
  });

  return companies;
}

function getCurrentPage() {
  // Extract current page number from URL
  const urlParams = new URLSearchParams(window.location.search);
  const page = urlParams.get('page');
  return page ? parseInt(page) : 1;
}
