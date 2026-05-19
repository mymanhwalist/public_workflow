/**
 * Content Script - Injected into each website to detect API endpoints
 */

console.log('[API Finder] Content script loaded');

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'detectAPI') {
        console.log('[API Finder] Detecting API endpoint...');

        try {
            // Wait for page to be fully loaded
            if (document.readyState === 'loading') {
                console.log('[API Finder] Waiting for page to load...');
                document.addEventListener('DOMContentLoaded', () => {
                    performDetection(sendResponse);
                });
                return true; // Keep message channel open
            } else {
                performDetection(sendResponse);
                return true; // Keep message channel open
            }
        } catch (error) {
            console.error('[API Finder] Error:', error);
            sendResponse({
                success: false,
                error: error.message
            });
        }
    }
});

/**
 * Perform API detection and send response
 */
function performDetection(sendResponse) {
    try {
        // Create detector instance
        const detector = new APIDetector();

        // Give page a moment to render dynamic content
        setTimeout(() => {
            const result = detector.detect();

            console.log('[API Finder] Detection complete:', result);

            sendResponse({
                success: true,
                endpoint: result.endpoint,
                provider: result.provider,
                url: window.location.href
            });
        }, 2000); // Wait 2 seconds for dynamic content

    } catch (error) {
        console.error('[API Finder] Detection error:', error);
        sendResponse({
            success: false,
            error: error.message
        });
    }
}
