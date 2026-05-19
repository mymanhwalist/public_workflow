/**
 * Background Service Worker - Main orchestrator
 */

// Import Supabase client
importScripts('supabase-client.js');

// State management
let isProcessing = false;
let currentTabId = null;
let websiteQueue = [];
let processedCount = 0;
let totalCount = 0;
let supabaseClient = null;
let config = null;

console.log('[Background] Service worker started');

/**
 * Handle messages from popup
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[Background] Message received:', message.action);

    if (message.action === 'start') {
        startProcessing()
            .then(() => sendResponse({ success: true }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true; // Keep message channel open
    }

    if (message.action === 'stop') {
        stopProcessing();
        sendResponse({ success: true });
        return true;
    }

    if (message.action === 'getStatus') {
        sendResponse({
            isRunning: isProcessing,
            progress: `${processedCount}/${totalCount}`
        });
        return true;
    }
});

/**
 * Start processing websites
 */
async function startProcessing() {
    if (isProcessing) {
        throw new Error('Already processing');
    }

    console.log('[Background] Starting processing...');
    isProcessing = true;
    processedCount = 0;

    try {
        // Load configuration
        config = await chrome.storage.local.get([
            'supabaseUrl',
            'supabaseKey',
            'tableName',
            'urlColumn',
            'apiColumn'
        ]);

        // Validate config
        if (!config.supabaseUrl || !config.supabaseKey || !config.tableName ||
            !config.urlColumn || !config.apiColumn) {
            throw new Error('Configuration incomplete. Please save settings first.');
        }

        // Initialize Supabase client
        supabaseClient = new SupabaseClient(config.supabaseUrl, config.supabaseKey);

        // Test connection
        updateStatus('info', 'Testing Supabase connection...');
        const connected = await supabaseClient.testConnection(config.tableName);
        if (!connected) {
            throw new Error('Failed to connect to Supabase. Check your credentials.');
        }

        // Fetch websites
        updateStatus('info', 'Fetching websites from Supabase...');
        websiteQueue = await supabaseClient.fetchWebsites(
            config.tableName,
            config.urlColumn,
            config.apiColumn
        );

        totalCount = websiteQueue.length;

        if (totalCount === 0) {
            updateStatus('success', 'No websites to process. All done!');
            isProcessing = false;
            return;
        }

        updateStatus('info', `Found ${totalCount} websites to process`, `0/${totalCount}`);

        // Start processing
        processNextWebsite();

    } catch (error) {
        console.error('[Background] Start error:', error);
        updateStatus('error', `Error: ${error.message}`);
        isProcessing = false;
        throw error;
    }
}

/**
 * Stop processing
 */
function stopProcessing() {
    console.log('[Background] Stopping...');
    isProcessing = false;

    // Close current tab if open
    if (currentTabId) {
        chrome.tabs.remove(currentTabId).catch(() => {});
        currentTabId = null;
    }

    updateStatus('info', 'Stopped by user', `${processedCount}/${totalCount}`);
}

/**
 * Process next website in queue
 */
async function processNextWebsite() {
    if (!isProcessing || websiteQueue.length === 0) {
        // All done
        updateStatus('success', `Completed! Processed ${processedCount} websites.`, `${processedCount}/${totalCount}`);
        isProcessing = false;
        return;
    }

    const website = websiteQueue.shift();
    processedCount++;

    console.log(`[Background] Processing ${processedCount}/${totalCount}:`, website.url);
    updateStatus('info', `Processing: ${website.url}`, `${processedCount}/${totalCount}`);

    try {
        // Validate URL
        let url = website.url;
        if (!url) {
            throw new Error('Empty URL');
        }

        // Ensure URL has protocol
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = 'https://' + url;
        }

        // Open website in new tab
        const tab = await chrome.tabs.create({
            url: url,
            active: false
        });

        currentTabId = tab.id;

        // Wait for tab to load
        await waitForTabLoad(tab.id);

        // Inject API detector
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['api-detector.js']
        });

        // Inject content script
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js']
        });

        // Wait a moment for scripts to initialize
        await sleep(1000);

        // Send detection message
        const response = await chrome.tabs.sendMessage(tab.id, { action: 'detectAPI' });

        console.log('[Background] Detection response:', response);

        let apiEndpoint = null;
        if (response && response.success && response.endpoint) {
            apiEndpoint = response.endpoint;
            console.log('[Background] Found API:', apiEndpoint);
        } else {
            console.log('[Background] No API found');
        }

        // Save to Supabase
        await supabaseClient.updateApiEndpoint(
            config.tableName,
            website.id,
            config.apiColumn,
            apiEndpoint
        );

        console.log('[Background] Saved to Supabase');

        // Close tab
        await chrome.tabs.remove(tab.id);
        currentTabId = null;

        // Wait before next
        await sleep(1500);

        // Process next
        processNextWebsite();

    } catch (error) {
        console.error('[Background] Error processing website:', error);

        // Try to save null on error
        try {
            await supabaseClient.updateApiEndpoint(
                config.tableName,
                website.id,
                config.apiColumn,
                null
            );
        } catch (saveError) {
            console.error('[Background] Failed to save null:', saveError);
        }

        // Close tab if still open
        if (currentTabId) {
            chrome.tabs.remove(currentTabId).catch(() => {});
            currentTabId = null;
        }

        // Continue to next
        await sleep(1000);
        processNextWebsite();
    }
}

/**
 * Wait for tab to finish loading
 */
function waitForTabLoad(tabId, timeout = 30000) {
    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener);
            reject(new Error('Tab load timeout'));
        }, timeout);

        const listener = (updatedTabId, changeInfo) => {
            if (updatedTabId === tabId && changeInfo.status === 'complete') {
                clearTimeout(timeoutId);
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
            }
        };

        chrome.tabs.onUpdated.addListener(listener);
    });
}

/**
 * Sleep utility
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Send status update to popup
 */
function updateStatus(status, message, progress = '') {
    console.log(`[Background] Status: ${status} - ${message}`);

    chrome.runtime.sendMessage({
        type: 'status',
        status: status,
        message: message,
        progress: progress
    }).catch(() => {
        // Popup might not be open
    });
}

/**
 * Handle tab closed by user
 */
chrome.tabs.onRemoved.addListener((tabId) => {
    if (tabId === currentTabId) {
        console.log('[Background] Current tab was closed');
        currentTabId = null;

        if (isProcessing) {
            // Continue to next
            setTimeout(processNextWebsite, 1000);
        }
    }
});
