/**
 * Opening the public privacy policy.
 *
 * Articles already open in the in-app WebView (`/webview?url=…`), so this reuses
 * that route rather than sending the reader to a browser they did not ask for.
 * The URL is built the same way everywhere so the three entry points cannot
 * drift apart.
 */

import { router } from 'expo-router';
import { API_BASE } from './api';

/** The absolute policy URL, honouring a non-production API base. */
export function privacyUrl(lang: 'ar' | 'en' = 'ar'): string {
  const base = API_BASE.replace(/\/$/, '');
  return lang === 'en' ? `${base}/privacy?lang=en` : `${base}/privacy`;
}

/** Open the policy in the in-app WebView. */
export function openPrivacy(lang: 'ar' | 'en' = 'ar'): void {
  router.push({
    pathname: '/webview',
    params: { url: privacyUrl(lang), title: 'سياسة الخصوصية' },
  });
}
