class SupabaseClient {
    constructor(url, apiKey) {
        this.url = url.replace(/\/$/, ''); // Remove trailing slash
        this.apiKey = apiKey;
        this.headers = {
            'apikey': apiKey,
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
        };
    }

    /**
     * Fetch all rows from a table
     * @param {string} tableName - Name of the table
     * @param {string} urlColumn - Column name for website URL
     * @param {string} apiColumn - Column name for API endpoint
     * @returns {Promise<Array>} Array of rows
     */
    async fetchWebsites(tableName, urlColumn, apiColumn) {
        const url = `${this.url}/rest/v1/${tableName}?select=*`;

        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: this.headers
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${await response.text()}`);
            }

            const data = await response.json();

            // Filter rows where API endpoint is null or empty
            return data.filter(row => {
                const apiValue = row[apiColumn];
                return !apiValue || apiValue === '' || apiValue === 'null';
            }).map(row => ({
                id: row.id,
                url: row[urlColumn],
                row: row // Keep full row for updating
            }));
        } catch (error) {
            console.error('Error fetching websites:', error);
            throw error;
        }
    }

    /**
     * Update API endpoint for a row
     * @param {string} tableName - Name of the table
     * @param {number|string} id - Row ID
     * @param {string} apiColumn - Column name for API endpoint
     * @param {string|null} apiEndpoint - API endpoint value (or null)
     * @returns {Promise<void>}
     */
    async updateApiEndpoint(tableName, id, apiColumn, apiEndpoint) {
        const url = `${this.url}/rest/v1/${tableName}?id=eq.${id}`;

        try {
            const response = await fetch(url, {
                method: 'PATCH',
                headers: this.headers,
                body: JSON.stringify({
                    [apiColumn]: apiEndpoint
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${await response.text()}`);
            }

            return true;
        } catch (error) {
            console.error('Error updating API endpoint:', error);
            throw error;
        }
    }

    /**
     * Test connection to Supabase
     * @param {string} tableName - Name of the table
     * @returns {Promise<boolean>}
     */
    async testConnection(tableName) {
        const url = `${this.url}/rest/v1/${tableName}?select=*&limit=1`;

        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: this.headers
            });

            return response.ok;
        } catch (error) {
            console.error('Connection test failed:', error);
            return false;
        }
    }
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SupabaseClient;
}
