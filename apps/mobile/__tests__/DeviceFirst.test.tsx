/**
 * The blocked publishers, as the reader drives them (#55).
 *
 * The user's approved order: read the page ON THE DEVICE and draw it in the app's
 * reader design; if that extraction is too thin, reveal the same page with its ad
 * requests blocked. No banner and no tap in between.
 *
 * These tests drive the real components, so what is pinned is the behaviour a reader
 * gets — not that a function exists.
 */

import React from 'react';
import { render, screen, waitFor, act, cleanup } from '@testing-library/react-native';
import { palette } from '../constants/colors';

jest.mock('@react-native-firebase/crashlytics', () => ({ __esModule: true, default: () => null }));
jest.mock('@react-native-firebase/app', () => ({ __esModule: true, default: () => null }));

// The WebView needs a native module. Record its props instead of mounting it.
jest.mock('react-native-webview', () => {
  const React = require('react');
  const { View, Text } = require('react-native');
  const WebView = (props: any) => {
    WebView.lastProps = props;
    WebView.instances.push(props);
    return (
      <View testID="webview">
        <Text>{`src:${props.source?.uri}`}</Text>
      </View>
    );
  };
  WebView.lastProps = null;
  WebView.instances = [] as any[];
  return { __esModule: true, WebView, default: WebView };
});

const mockReader = jest.fn();
jest.mock('../lib/api', () => {
  const actual = jest.requireActual('../lib/api');
  return { ...actual, fetchReaderArticle: (...args: unknown[]) => (globalThis as any).__mockReader(...args) };
});
(globalThis as any).__mockReader = mockReader;

import { DeviceArticlePane, EXTRACT_TIMEOUT_MS } from '../components/DeviceArticlePane';
import { ArticleReadPane } from '../components/ArticleReadPane';
import { WebView } from 'react-native-webview';
import { AD_BLOCK_HOSTS } from '../lib/adBlockHosts';

const t = palette.light;

const REAL_ARTICLE = `<!doctype html><html dir="rtl"><head>
  <meta property="og:title" content="سوسن بدر تكشف سر تغير ملامحها" />
</head><body><article>
  <p>${'فاجأت الفنانة المصرية سوسن بدر جمهورها بإطلالة بدت فيها ملامحها أكثر شباباً بعد فترة غياب عن الشاشة، وهو ما أثار تساؤلات كثيرة بين متابعيها على مواقع التواصل الاجتماعي. '.repeat(2)}</p>
  <p>${'وأوضحت الفنانة الأسباب التي دفعتها إلى اتخاذ قرار الخضوع للجراحة، مشيرة إلى حرصها على التجديد وليس تغيير الهوية، وأنها استشارت أكثر من طبيب قبل الإقدام على هذه الخطوة. '.repeat(2)}</p>
</article></body></html>`;

const THIN = '<html><body><article><p>ملخص قصير فقط.</p></article></body></html>';

const webviewProps = () => (WebView as unknown as { instances: any[] }).instances;
const lastWebview = () => {
  const all = webviewProps();
  return all[all.length - 1];
};

beforeEach(() => {
  mockReader.mockReset();
  (WebView as unknown as { instances: any[] }).instances = [];
  (WebView as unknown as { lastProps: any }).lastProps = null;
});
afterEach(() => cleanup());

/** The page finishing its load and posting its markup, as the WebView does. */
const deliver = async (html: string) => {
  const props = lastWebview();
  await act(async () => {
    props.onMessage({ nativeEvent: { data: JSON.stringify({ html }) } });
  });
};

describe('reading a blocked publisher on the device', () => {
  it('draws the story in the app’s design when extraction works', async () => {
    render(
      <DeviceArticlePane
        url="https://www.alarabiya.net/culture/1"
        title="العربية"
        t={t}
        onClose={() => {}}
      />,
    );
    await deliver(REAL_ARTICLE);

    // The headline and the prose are the page's own, drawn by the app.
    await waitFor(() => expect(screen.getByText('وضع القراءة')).toBeTruthy());
    expect(screen.getByText('سوسن بدر تكشف سر تغير ملامحها')).toBeTruthy();
    expect(screen.getByText(/فاجأت الفنانة المصرية سوسن بدر/)).toBeTruthy();
  });

  it('refuses the ad requests while it reads the page', async () => {
    render(
      <DeviceArticlePane url="https://elcaptain.dostor.org/231454" title="الدستور" t={t} onClose={() => {}} />,
    );
    const props = lastWebview();
    // The native gate is on, and carries the real denylist. `blockAds` is the
    // JavaScript flag; `blockAdHosts` is what the native gate actually reads.
    expect(props.blockAdHosts).toStrictEqual(AD_BLOCK_HOSTS);
    // The page is the PUBLISHER's, read from this device.
    expect(props.source.uri).toBe('https://elcaptain.dostor.org/231454');
  });

  it('reveals the same page, with no banner, when extraction is thin', async () => {
    render(
      <DeviceArticlePane url="https://gate.ahram.org.eg/News/1.aspx" title="الأهرام" t={t} onClose={() => {}} />,
    );
    await deliver(THIN);

    // No reader heading, and the page is on screen on its original url.
    await waitFor(() => expect(screen.queryByText('وضع القراءة')).toBeNull());
    expect(screen.getByTestId('webview')).toBeTruthy();
    expect(lastWebview().source.uri).toBe('https://gate.ahram.org.eg/News/1.aspx');
    // Blocking survives the switch: the ads are refused on the page shown too.
    expect(lastWebview().blockAdHosts).toStrictEqual(AD_BLOCK_HOSTS);
    // Nothing asks the reader to do anything.
    expect(screen.queryByText(/مش قادرين|تعذر|خطأ/)).toBeNull();
  });

  it('reveals the page when the site blocks the read entirely', async () => {
    render(<DeviceArticlePane url="https://www.dostor.org/1" title="الدستور" t={t} onClose={() => {}} />);
    const props = lastWebview();
    await act(async () => props.onError({ nativeEvent: {} }));
    await waitFor(() => expect(screen.queryByText('وضع القراءة')).toBeNull());
    expect(screen.getByTestId('webview')).toBeTruthy();
  });

  it('does not leave the reader on a spinner when the page never settles', async () => {
    jest.useFakeTimers();
    try {
      render(<DeviceArticlePane url="https://www.dostor.org/1" title="الدستور" t={t} onClose={() => {}} />);
      await act(async () => {
        jest.advanceTimersByTime(EXTRACT_TIMEOUT_MS + 100);
      });
      expect(screen.queryByText('وضع القراءة')).toBeNull();
      expect(screen.getByTestId('webview')).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('which sources take the device path', () => {
  const renderPane = (url: string) =>
    render(<ArticleReadPane url={url} articleId="a1" title="المصدر" t={t} onClose={() => {}} />);

  it('sends الدستور to the device reader instead of the server cleaner', async () => {
    // The server answered `blocked` for these three (#52/#54); the device reads them.
    mockReader.mockResolvedValue({
      title: null,
      blocks: [],
      readable: false,
      reason: 'blocked',
      resolvedUrl: 'https://elcaptain.dostor.org/231454',
    });
    renderPane('https://news.google.com/rss/articles/x');
    await waitFor(() => expect(screen.getByTestId('webview')).toBeTruthy());
    // The device pane reads the PUBLISHER page, not our cleaned endpoint.
    expect(lastWebview().source.uri).toBe('https://elcaptain.dostor.org/231454');
    expect(lastWebview().blockAdHosts).toStrictEqual(AD_BLOCK_HOSTS);
  });

  it('leaves every other source on the server path, unchanged', async () => {
    mockReader.mockResolvedValue({
      title: null,
      blocks: [],
      readable: false,
      reason: 'thin',
      resolvedUrl: 'https://www.masrawy.com/news/1',
    });
    renderPane('https://news.google.com/rss/articles/y');
    await waitFor(() => expect(screen.getByTestId('webview')).toBeTruthy());
    // Still the server's cleaned copy for this publisher.
    expect(lastWebview().source.uri).toContain('/api/articles/clean?url=');
  });
});
