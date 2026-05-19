// Simple Supabase client for Chrome Extension
// No external dependencies - uses fetch API

class SupabaseClient {
  constructor(supabaseUrl, supabaseKey) {
    this.supabaseUrl = supabaseUrl;
    this.supabaseKey = supabaseKey;
    this.headers = {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json'
    };
  }

  async callFunction(functionName, params) {
    try {
      const response = await fetch(`${this.supabaseUrl}/rest/v1/rpc/${functionName}`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(params)
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Supabase error: ${error}`);
      }

      return await response.json();
    } catch (error) {
      console.error(`[Supabase] Error calling ${functionName}:`, error);
      throw error;
    }
  }

  async saveCareerPage(companyName, websiteUrl, careerPageUrl, jobTable = null, jobItem = null, jobPage = null, jobPageTable = null) {
    return this.callFunction('save_career_page', {
      p_company_name: companyName,
      p_website_url: websiteUrl,
      p_career_page_url: careerPageUrl,
      p_job_table: jobTable,
      p_job_item: jobItem,
      p_job_page: jobPage,
      p_job_page_table: jobPageTable
    });
  }

  async saveCareerPagesBulk(companies) {
    const results = {
      success: 0,
      failed: 0,
      errors: []
    };

    for (const company of companies) {
      try {
        // Save company with or without career page
        await this.saveCareerPage(
          company.name,
          company.website,
          company.careerPage || null  // Use null if no career page found yet
        );
        results.success++;
        console.log(`[Supabase] ✓ Saved ${company.name}`);
      } catch (error) {
        results.failed++;
        results.errors.push({
          company: company.name,
          error: error.message
        });
        console.error(`[Supabase] ✗ Failed to save ${company.name}:`, error);
      }

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return results;
  }
}
