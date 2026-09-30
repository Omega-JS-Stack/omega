/**
 * Schema rules for `domain`: two roles, each provider-keyed. The registrar
 * sits at `domain.providers.<id>` and the mailbox provider at
 * `domain.email.providers.<id>`; each accepted id is one row here, matching
 * the manager's domain provider registry (services/domain/lib/providers.js).
 */

const DOMAIN_RULES = [
  {
    path:        'domain.providers',
    type:        'object',
    required:    false,
    description: "The brand's REGISTRAR, named as the one KEY under it ({ namecheap: {} }). Presence picks it, and no entry means nothing chosen, so the domain service skips. The accepted registrars are the rows below, one per registrar in the manager's domain provider registry (services/domain/lib/providers.js); the entry may be empty.",
  },
  {
    path:        'domain.providers.namecheap',
    type:        'object',
    required:    false,
    description: 'Namecheap as the registrar, the one provider whose nameservers the domain service points at the Cloudflare zone via API (NAMECHEAP_USERNAME + NAMECHEAP_API_KEY in .env). An empty object is the whole declaration; every other registrar gets manual instructions.',
  },
  {
    path:        'domain.providers.squarespace',
    type:        'object',
    required:    false,
    description: 'Squarespace as the registrar: no API, so the domain service prints the nameservers to set while the zone is pending, and an interactive run opens its nameserver page. An empty object is the whole declaration.',
  },
  {
    path:        'domain.email.providers',
    type:        'object',
    required:    false,
    description: "The brand's MAILBOX provider, named as the one KEY under it. The accepted providers are the rows below, one per mailbox provider in the manager's domain provider registry (services/domain/lib/providers.js), which owns each one's MX records and SPF include. Presence picks it; no entry leaves the MX/SPF records and the edge service's email-routing operations off.",
  },
  {
    path:        'domain.email.providers.cloudflare',
    type:        'object',
    required:    false,
    description: 'Cloudflare Email Routing as the mailbox: its MX records and SPF include, and the edge service forwards domain.email.forwarding through it. An empty object is the whole declaration.',
  },
  {
    path:        'domain.email.providers.squarespace',
    type:        'object',
    required:    false,
    description: 'Squarespace email forwarding (Mailgun) as the mailbox: its MX records and SPF include. An empty object is the whole declaration.',
  },
  {
    path:        'domain.email.providers.privateemail',
    type:        'object',
    required:    false,
    description: 'Namecheap Private Email as the mailbox: its MX records and SPF include. An empty object is the whole declaration.',
  },
  {
    path:        'domain.email.forwarding',
    type:        'array',
    required:    false,
    description: "Address forwarding rules ([{ from: 'support' | '*', to: 'inbox@example.com' }]) the mailbox provider reconciles. Role-level and provider-agnostic.",
  },
];

module.exports = { DOMAIN_RULES };
