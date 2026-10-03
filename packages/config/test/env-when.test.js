/**
 * Unit tests for @omega.js/config's named env rules: the small set every
 * `requiredWhen` and `askedWhen` in the env schema is written with. A rule is
 * a function of the brand's config that answers true or false; each one here
 * meets a config that makes it hold and one that does not.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');

const { holds, onUnlessOff, chosen, hasTarget, realProject, ships, signsWith, all, any } = require('../src/env-when.js');

const DESKTOP = { targets: { desktop: { type: 'desktop' } } };

module.exports = defineCases({
  type: 'group',
  description: 'env-when',
  tests: [
    {
      name: 'holds(path): a value at the path holds, an absent or empty one does not',
      run: (ctx) => {
        const rule = holds('captcha.providers.recaptcha.siteKey');

        ctx.expect(rule({ captcha: { providers: { recaptcha: { siteKey: '6Lc-abc' } } } })).toBe(true);
        ctx.expect(rule({})).toBe(false);
        ctx.expect(rule({ captcha: { providers: { recaptcha: {} } } })).toBe(false);
        ctx.expect(rule({ captcha: { providers: { recaptcha: { siteKey: '' } } } }), 'an empty string is not a value').toBe(false);
        ctx.expect(rule({ captcha: { providers: { recaptcha: { siteKey: null } } } })).toBe(false);
      },
    },

    {
      name: 'holds(path): an object at the path holds, even an empty one, and false does not',
      run: (ctx) => {
        const rule = holds('certificates.providers.apple');

        ctx.expect(rule({ certificates: { providers: { apple: { bundleIdPrefix: 'com.acme' } } } })).toBe(true);
        ctx.expect(rule({ certificates: { providers: { apple: {} } } }), 'an empty settings block is still a declared block').toBe(true);
        ctx.expect(rule({ certificates: { providers: { apple: false } } }), 'the block dropped').toBe(false);
      },
    },

    {
      name: 'ships(platform, format): a desktop target ships the format unless the platform or the format is false',
      run: (ctx) => {
        const rule = ships('linux', 'snap');

        ctx.expect(rule(DESKTOP), 'no platforms block: the default formats ship').toBe(true);
        ctx.expect(rule({ ...DESKTOP, platforms: { linux: { formats: { snap: { channels: ['stable'] } } } } }), 'declared').toBe(true);
        ctx.expect(rule({ ...DESKTOP, platforms: { linux: {} } }), 'the platform declared, the format left alone').toBe(true);
        ctx.expect(rule({ ...DESKTOP, platforms: { linux: { formats: { snap: false } } } }), 'the format turned off').toBe(false);
        ctx.expect(rule({ ...DESKTOP, platforms: { linux: false } }), 'the platform turned off').toBe(false);
        ctx.expect(rule({ ...DESKTOP, platforms: { windows: false } }), 'another platform off leaves this one on').toBe(true);
        // Only a desktop brand ships a desktop format
        ctx.expect(rule({})).toBe(false);
        ctx.expect(rule({ targets: { web: { type: 'web' }, extension: { type: 'extension' } } })).toBe(false);
        ctx.expect(rule({ platforms: { linux: { formats: { snap: {} } } } }), 'a declaration with no desktop target').toBe(false);

        ctx.expect(rule.path).toBe('platforms.linux.formats.snap');
        ctx.expect(ships('windows', 'nsis').path).toBe('platforms.windows.formats.nsis');
      },
    },

    {
      name: 'signsWith(strategy): the desktop target ships the Windows installer and signs it with that strategy, the default included',
      run: (ctx) => {
        const selfHosted = signsWith('self-hosted');
        const cloud = signsWith('cloud');
        const strategy = (name) => ({ ...DESKTOP, platforms: { windows: { signing: { strategy: name, ...(name === 'cloud' ? { cloud: { provider: 'azure' } } : {}) } } } });

        ctx.expect(selfHosted(DESKTOP), 'no strategy written: self-hosted is the default').toBe(true);
        ctx.expect(selfHosted(strategy('self-hosted'))).toBe(true);
        ctx.expect(selfHosted(strategy('cloud'))).toBe(false);
        ctx.expect(cloud(strategy('cloud'))).toBe(true);
        ctx.expect(cloud(DESKTOP), 'the default is not the cloud').toBe(false);

        ctx.expect(selfHosted({ ...DESKTOP, platforms: { windows: false } }), 'Windows turned off').toBe(false);
        ctx.expect(selfHosted({ ...DESKTOP, platforms: { windows: { formats: { nsis: false } } } }), 'the installer turned off').toBe(false);
        ctx.expect(selfHosted({ ...DESKTOP, platforms: { linux: false } }), 'another platform off leaves Windows on').toBe(true);
        ctx.expect(selfHosted({}), 'no desktop target').toBe(false);
        ctx.expect(selfHosted({ platforms: { windows: { signing: { strategy: 'self-hosted' } } } }), 'a strategy with no desktop target').toBe(false);
      },
    },

    {
      name: 'signsWith(strategy, provider): the cloud strategy also has to name that provider',
      run: (ctx) => {
        const azure = signsWith('cloud', 'azure');
        const cloud = (provider) => ({ windows: { signing: { strategy: 'cloud', cloud: { provider } } } });

        ctx.expect(azure({ ...DESKTOP, platforms: cloud('azure') })).toBe(true);
        ctx.expect(azure({ ...DESKTOP, platforms: cloud('sslcom') }), 'another provider').toBe(false);
        ctx.expect(azure({ ...DESKTOP, platforms: { windows: { signing: { cloud: { provider: 'azure' } } } } }), 'the provider written, the strategy left at its default').toBe(false);
        ctx.expect(azure({ ...DESKTOP, platforms: { windows: { ...cloud('azure').windows, formats: { nsis: false } } } }), 'the installer turned off').toBe(false);
        ctx.expect(azure({ platforms: cloud('azure') }), 'no desktop target').toBe(false);
      },
    },

    {
      name: 'onUnlessOff(path): absent means on, and only a literal false turns it off',
      run: (ctx) => {
        const rule = onUnlessOff('captcha.providers.recaptcha.enabled');

        ctx.expect(rule({}), 'a config that says nothing has the feature on').toBe(true);
        ctx.expect(rule({ captcha: { providers: { recaptcha: { enabled: true } } } })).toBe(true);
        ctx.expect(rule({ captcha: { providers: { recaptcha: { enabled: false } } } })).toBe(false);
      },
    },

    {
      name: 'chosen(path, name): holds only when the path names that provider',
      run: (ctx) => {
        const rule = chosen('platforms.windows.signing.cloud.provider', 'azure');
        const provider = (name) => ({ platforms: { windows: { signing: { strategy: 'cloud', cloud: { provider: name } } } } });

        ctx.expect(rule(provider('azure'))).toBe(true);
        ctx.expect(rule(provider('sslcom')), 'another provider owes nothing of this one').toBe(false);
        ctx.expect(rule({})).toBe(false);
      },
    },

    {
      name: 'hasTarget(...types): holds when the brand has a target of one of those types',
      run: (ctx) => {
        const backend = hasTarget('backend');

        ctx.expect(backend({ targets: { web: { type: 'web' }, backend: { type: 'backend' } } })).toBe(true);
        ctx.expect(backend({ targets: { web: { type: 'web' } } })).toBe(false);
        ctx.expect(backend({}), 'no targets, no backend').toBe(false);
        // The type decides, never the target's name
        ctx.expect(backend({ targets: { api: { type: 'backend' } } })).toBe(true);
        ctx.expect(hasTarget('web')({ targets: { site: { type: 'web' } } })).toBe(true);

        const signing = hasTarget('desktop', 'mobile');
        ctx.expect(signing({ targets: { desktop: { type: 'desktop' } } })).toBe(true);
        ctx.expect(signing({ targets: { mobile: { type: 'mobile' } } })).toBe(true);
        ctx.expect(signing({ targets: { web: { type: 'web' }, extension: { type: 'extension' } } })).toBe(false);
      },
    },

    {
      name: 'realProject(): only a demo-* id fails it, and an id not yet chosen still holds',
      run: (ctx) => {
        const rule = realProject();
        const project = (projectId) => ({ cloud: { provider: 'firebase', config: { projectId } } });

        ctx.expect(rule(project('acme-live'))).toBe(true);
        ctx.expect(rule(project('demo-acme')), 'a demo-* project is local only').toBe(false);
        // The cloud service's selection flow is how a brand gets a project, so it still runs
        ctx.expect(rule({}), 'no project id yet is not a demo project').toBe(true);
        ctx.expect(rule(project('')), 'an empty id is one not yet chosen').toBe(true);
      },
    },

    {
      name: 'all(...rules): holds only when every rule holds',
      run: (ctx) => {
        const rule = all(holds('captcha.providers.recaptcha.siteKey'), hasTarget('backend'));
        const siteKey = { captcha: { providers: { recaptcha: { siteKey: '6Lc-abc' } } } };

        ctx.expect(rule({ ...siteKey, targets: { backend: { type: 'backend' } } })).toBe(true);
        ctx.expect(rule({ ...siteKey, targets: { web: { type: 'web' } } })).toBe(false);
        ctx.expect(rule({ targets: { backend: { type: 'backend' } } })).toBe(false);
      },
    },

    {
      name: 'any(...rules): holds when one rule holds',
      run: (ctx) => {
        const rule = any(hasTarget('desktop'), realProject());

        ctx.expect(rule({ targets: { desktop: { type: 'desktop' } } })).toBe(true);
        ctx.expect(rule({ cloud: { config: { projectId: 'acme-live' } }, targets: { web: { type: 'web' } } })).toBe(true);
        ctx.expect(rule({ cloud: { config: { projectId: 'demo-acme' } }, targets: { web: { type: 'web' } } })).toBe(false);
        ctx.expect(rule({ cloud: { config: { projectId: 'demo-acme' } }, targets: { desktop: { type: 'desktop' } } })).toBe(true);
      },
    },
  ],
});
