// Handing the ad denylist to the native WebView (#55).
//
// WHY A WRAPPER
// -------------
// `react-native-webview` 14 has no built-in request interception: JavaScript only
// sees top-level navigations. The gate in this repo's patch accepts one extra prop,
// `blockAdHosts`, and answers matching sub-resource requests with an empty body
// before the network is touched.
//
// The wrapper is what keeps that prop honest: the WebView component is only swapped
// out when blocking is on, so no other screen in the app changes behaviour. On a
// platform without the patch (iOS, which is out of scope for this release), the prop
// is simply ignored and the existing CSS layer still applies.

import React from 'react';
import { WebView } from 'react-native-webview';
import type { WebViewProps } from 'react-native-webview';
import { AD_BLOCK_HOSTS } from './adBlockHosts';

export interface AdBlockingWebViewProps extends WebViewProps {
  /** Block sub-resource requests to the ad networks. */
  blockAds?: boolean;
}

/**
 * A WebView whose ad requests are refused by the native layer.
 *
 * `blockAdHosts` is the whole denylist rather than a boolean so the native side has
 * nothing to look up and cannot drift from `adBlockHosts.ts`, which is the single
 * source of truth (and is also what the JS layer reads).
 */
export function AdBlockingWebView({ blockAds = false, ...rest }: AdBlockingWebViewProps) {
  const extra = blockAds ? { blockAdHosts: AD_BLOCK_HOSTS } : {};
  return <WebView {...rest} {...(extra as Partial<WebViewProps>)} />;
}
