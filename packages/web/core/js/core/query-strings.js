import webManager from 'web-manager';

// Query Strings Module
export default function () {
  // Process query strings when DOM is ready
  webManager.dom().ready().then(() => {
    processQueryStrings();
  });

  function processQueryStrings() {
    // Get URL parameters
    const urlParams = new URLSearchParams(window.location.search);

    // Get current attribution data
    const attribution = webManager.storage().get('attribution', {});

    // Process affiliate/referral parameters
    processAffiliateParams(urlParams, attribution);

    // Process UTM parameters
    processUTMParams(urlParams, attribution);

    // Save updated attribution if anything changed
    if (Object.keys(attribution).length > 0) {
      webManager.storage().set('attribution', attribution);
    }
  }

  function processAffiliateParams(urlParams, attribution) {
    // Check for aff or ref parameter
    const affParam = urlParams.get('aff') || urlParams.get('ref');

    // Quit if no affiliate parameter
    if (!affParam) {
      return;
    }

    // Save affiliate data to attribution object
    attribution.affiliate = {
      code: affParam,
      timestamp: new Date().toISOString(),
      url: window.location.href,
      page: window.location.pathname
    };
  }

  function processUTMParams(urlParams, attribution) {
    // Define UTM parameters to capture
    const utmParams = [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content'
    ];

    // Check if any UTM parameters exist
    const utmData = {
      tags: {}
    };
    let hasUTM = false;

    utmParams.forEach(param => {
      const value = urlParams.get(param);
      if (value) {
        utmData.tags[param] = value;
        hasUTM = true;
      }
    });

    // Quit if no UTM parameters
    if (!hasUTM) {
      return;
    }

    // Add metadata and save to attribution object
    utmData.timestamp = new Date().toISOString();
    utmData.url = window.location.href;
    utmData.page = window.location.pathname;

    attribution.utm = utmData;
  }
}
