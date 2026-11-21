/**
 * Public privacy policy: it must render in both languages, be INDEXABLE (Play
 * requires a reachable public URL, so no noindex), name every third party, and
 * carry no personal address.
 */

import { describe, it, expect } from 'vitest';
import { app } from '../index.js';
import {
  PRIVACY_CONTACT,
  PRIVACY_PUBLISHER,
  PRIVACY_UPDATED,
  privacyCopy,
  privacyLang,
  renderPrivacyPage,
} from '../privacy.js';

describe('privacy: language handling', () => {
  it('defaults to Arabic and only switches on exactly "en"', () => {
    expect(privacyLang(undefined)).toBe('ar');
    expect(privacyLang('')).toBe('ar');
    expect(privacyLang('en')).toBe('en');
    expect(privacyLang('EN')).toBe('ar');
    expect(privacyLang('fr')).toBe('ar');
  });

  it('gives each language its own direction and title', () => {
    expect(privacyCopy('ar').dir).toBe('rtl');
    expect(privacyCopy('en').dir).toBe('ltr');
    expect(privacyCopy('ar').title).toContain('رئيس التحرير');
    expect(privacyCopy('en').title).toContain('Privacy Policy');
  });
});

describe('privacy: the page', () => {
  it('renders Arabic RTL by default', async () => {
    const res = await app.request('/privacy');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('سياسة الخصوصية');
    expect(html).toContain(PRIVACY_UPDATED);
  });

  it('renders English at ?lang=en, with a toggle back', async () => {
    const res = await app.request('/privacy?lang=en');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('dir="ltr"');
    expect(html).toContain('Privacy Policy');
    expect(html).toContain('/privacy"');
  });

  it('is indexable — no noindex, unlike /admin', async () => {
    const res = await app.request('/privacy');
    const html = await res.text();
    // Play needs a public policy page; hiding it would defeat the purpose.
    expect(res.headers.get('x-robots-tag')).toBeNull();
    expect(html).not.toContain('noindex');
    expect(html).not.toContain('nofollow');
  });

  it('names every third party that receives data', async () => {
    for (const lang of ['ar', 'en'] as const) {
      const html = renderPrivacyPage(privacyCopy(lang));
      for (const name of [
        'Firebase Cloud Messaging',
        'Crashlytics',
        'Resend',
        'Google Cloud',
        'Google News',
        // The digest sends article text here, so it must be disclosed.
        'Command Code',
      ]) {
        expect(html).toContain(name);
      }
    }
  });

  it('discloses that article text goes to the AI service, with zero retention', () => {
    for (const lang of ['ar', 'en'] as const) {
      const html = renderPrivacyPage(privacyCopy(lang));
      expect(html).toContain('Command Code');
      expect(html).toContain('zero data retention');
    }
  });

  it('states the retention and the install-id rule truthfully', () => {
    const html = renderPrivacyPage(privacyCopy('en'));
    expect(html).toContain('never stored');
    expect(html).toContain('90 days');
    expect(html).toContain('30 days');
    // The claims that distinguish this app from an ad-funded one.
    expect(html).toContain('No ads');
    expect(html).toContain('advertising id');
  });

  it('names the publisher and the privacy contact, and no personal address', async () => {
    const html = await (await app.request('/privacy')).text();
    expect(html).toContain(PRIVACY_PUBLISHER);
    expect(html).toContain(PRIVACY_CONTACT);
    // No no-reply support address, and nothing that looks like a personal inbox.
    expect(html).not.toContain('no-reply@');
    expect(html).not.toContain('gmail.com');
    expect(html).not.toContain('ayman');
  });

  it('escapes rather than injecting markup from copy', () => {
    const html = renderPrivacyPage({
      ...privacyCopy('en'),
      title: '<script>alert(1)</script>',
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('privacy: links elsewhere', () => {
  it('links the policy from /delete-account', async () => {
    const html = await (await app.request('/delete-account')).text();
    expect(html).toContain('href="/privacy"');
  });
});
