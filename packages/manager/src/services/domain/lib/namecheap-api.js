/**
 * Namecheap API client — XML query API (there is no JSON variant), ported from
 * omega-manager. Requires the caller's IP to be whitelisted in the Namecheap
 * dashboard; the client detects its public IP via api.ipify.org.
 *
 * Docs: https://www.namecheap.com/support/api/methods/
 */

const API_BASE = 'https://api.namecheap.com/xml.response';

/**
 * The Namecheap API access page — enabling the API, resetting the key and the
 * IP whitelist all live on this ONE page, which is why every rejection in that
 * family opens the root and never a deep link (#698, Ian 2026-08-30).
 */
const API_ACCESS_URL = 'https://ap.www.namecheap.com/settings/tools/apiaccess/';

// Namecheap refuses a caller whose IP is not whitelisted with the API-access
// error family — the same numbers a disabled API or a stale key answer with,
// and all three are fixed on the page above.
const API_ACCESS_ERROR_CODES = new Set(['1011102', '1011150']);
const API_ACCESS_ERROR_TEXT = /whitelist|api access has not been enabled|invalid request ip/i;

/**
 * Whether a thrown API error is the IP-whitelist rejection — the walkthrough's
 * trigger. Reads the error Number the client parses off the <Error> element,
 * with the message as the second signal.
 *
 * @param {Error} error - An error thrown by makeRequest
 * @returns {boolean}
 */
function isWhitelistError(error) {
  return API_ACCESS_ERROR_CODES.has(error?.namecheapCode)
    || API_ACCESS_ERROR_TEXT.test(error?.message || '');
}

class NamecheapAPI {
  constructor(options = {}) {
    this.username = options.username || process.env.NAMECHEAP_USERNAME;
    this.apiKey = options.apiKey || process.env.NAMECHEAP_API_KEY;

    if (!this.username || !this.apiKey) {
      throw new Error('Namecheap API not configured. Set NAMECHEAP_USERNAME and NAMECHEAP_API_KEY in the brand .env');
    }
  }

  async getClientIp() {
    if (this._clientIp) {
      return this._clientIp;
    }
    const response = await fetch('https://api.ipify.org?format=json');
    const data = await response.json();
    this._clientIp = data.ip;
    return this._clientIp;
  }

  async makeRequest(command, params = {}) {
    const clientIp = await this.getClientIp();

    const queryParams = new URLSearchParams({
      ApiUser: this.username,
      ApiKey: this.apiKey,
      UserName: this.username,
      ClientIp: clientIp,
      Command: command,
      ...params,
    });

    const url = `${API_BASE}?${queryParams.toString()}`;
    const response = await fetch(url);
    const xml = await response.text();

    const status = xml.match(/Status="(\w+)"/)?.[1];
    if (status !== 'OK') {
      // Namecheap nests the elements (<Errors><Error Number="…">msg</Error>),
      // so the attribute group must be optional-but-space-led — otherwise the
      // wrapper matches first and the message carries the inner tag with it.
      const failure = xml.match(/<Error(\s[^>]*)?>(.*?)<\/Error>/);
      const error = new Error(`Namecheap API error: ${failure?.[2] || 'Unknown error'}`);
      // The whitelist walkthrough (#698) needs both: WHICH rejection this is,
      // and the IP to add — the XML never echoes it, so the client that sent
      // it is the only source.
      error.namecheapCode = failure?.[1]?.match(/Number="(\d+)"/)?.[1] || null;
      error.clientIp = clientIp;
      throw error;
    }

    return xml;
  }

  /**
   * List all domains in the account
   * @returns {Array<{domain: string, sld: string, tld: string, expires: string}>}
   */
  async listDomains() {
    const xml = await this.makeRequest('namecheap.domains.getList', {
      PageSize: 100,
    });

    const domains = [];
    const domainRegex = /<Domain\s+([^>]+)\/>/g;
    let match;

    while ((match = domainRegex.exec(xml)) !== null) {
      const attrs = match[1];
      const name = attrs.match(/Name="([^"]+)"/)?.[1];

      if (name) {
        const parts = name.split('.');
        const tld = parts.pop();
        const sld = parts.join('.');

        domains.push({
          domain: name.toLowerCase(),
          sld,
          tld,
          expires: attrs.match(/Expires="([^"]+)"/)?.[1] || null,
        });
      }
    }

    return domains;
  }

  /**
   * Get current DNS settings for a domain
   * @param {string} sld - Second level domain (e.g. 'mybrand')
   * @param {string} tld - Top level domain (e.g. 'com', 'co.uk')
   * @returns {Object} - { usingCustom: boolean, nameservers: string[] }
   */
  async getDns(sld, tld) {
    const xml = await this.makeRequest('namecheap.domains.dns.getList', {
      SLD: sld,
      TLD: tld,
    });

    const isCustom = xml.includes('IsUsingOurDNS="false"');
    const nameservers = [];
    const nsRegex = /<Nameserver>(.*?)<\/Nameserver>/g;
    let match;

    while ((match = nsRegex.exec(xml)) !== null) {
      nameservers.push(match[1].toLowerCase());
    }

    return {
      usingCustom: isCustom,
      nameservers,
    };
  }

  /**
   * Set custom nameservers for a domain
   * @param {string} sld - Second level domain
   * @param {string} tld - Top level domain
   * @param {string[]} nameservers - Array of nameserver hostnames
   */
  async setCustomNameservers(sld, tld, nameservers) {
    await this.makeRequest('namecheap.domains.dns.setCustom', {
      SLD: sld,
      TLD: tld,
      Nameservers: nameservers.join(','),
    });
  }
}

module.exports = { NamecheapAPI, API_ACCESS_URL, isWhitelistError };
