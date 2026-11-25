/**
 * The article's source view (#51).
 *
 * The user's rule: reader view first, the source page in an ad-blocked browser only
 * when the reader view cannot be produced. These tests drive the real component
 * through both paths, because the failure mode that matters is a reader who gets an
 * empty page dressed up as the story.
 */

import React from 'react';
import { render, screen, waitFor, fireEvent, act, cleanup } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { palette } from '../constants/colors';

jest.mock('@react-native-firebase/crashlytics', () => ({ __esModule: true, default: () => null }));
jest.mock('@react-native-firebase/app', () => ({ __esModule: true, default: () => null }));

// The fallback renders a real WebView, which needs a native module. Assert on its
// props instead of mounting it.
jest.mock('react-native-webview', () => {
  const React = require('react');
  const { View, Text } = require('react-native');
  const WebView = (props: any) => {
    WebView.lastProps = props;
    return (
      <View testID="webview">
        <Text>{`src:${props.source?.uri}`}</Text>
      </View>
    );
  };
  WebView.lastProps = null;
  return { __esModule: true, WebView, default: WebView };
});

const mockReader = jest.fn();
jest.mock('../lib/api', () => {
  const actual = jest.requireActual('../lib/api');
  return {
    ...actual,
    fetchReaderArticle: (...args: unknown[]) => (globalThis as any).__mockReader(...args),
  };
});
(globalThis as any).__mockReader = mockReader;

import { ArticleReadPane } from '../components/ArticleReadPane';
import { WebView } from 'react-native-webview';

const t = palette.light;

const readerBody = {
  title: 'الأهلي يحسم القمة',
  readable: true,
  blocks: [
    { type: 'heading', text: 'ملخص المباراة' },
    { type: 'paragraph', text: 'سجل الأهلي هدف الفوز في الدقيقة 88 من عمر المباراة.' },
    { type: 'image', url: 'https://cdn.example.com/lead.jpg', caption: null },
  ],
};

const renderPane = () =>
  render(<ArticleReadPane url="https://www.youm7.com/story/1" articleId="a1" title="اليوم السابع" t={t} onClose={() => {}} />);

afterEach(() => {
  // Each test renders a fresh pane; a WebView left mounted from the previous one
  // would otherwise be the element the queries find.
  cleanup();
});

describe('reading an article at its source', () => {
  beforeEach(() => {
    mockReader.mockReset();
    (WebView as unknown as { lastProps: any }).lastProps = null;
  });

  it('renders the article in the app’s own design when extraction works', async () => {
    mockReader.mockResolvedValue(readerBody);
    renderPane();
    await waitFor(() => expect(screen.getByText('الأهلي يحسم القمة')).toBeTruthy());
    // The body is the publisher's own text, block by block.
    expect(screen.getByText(/هدف الفوز في الدقيقة 88/)).toBeTruthy();
    expect(screen.getByText('ملخص المباراة')).toBeTruthy();
    // No browser at all on this path.
    expect(screen.queryByTestId('webview')).toBeNull();
  });

  it('falls back to the CLEANED page when extraction is thin', async () => {
    // The browser must load the server-cleaned copy, not the live page: hiding ads
    // with CSS left almost all of them visible once their scripts had run (#52).
    mockReader.mockResolvedValue({ title: null, blocks: [], readable: false, reason: 'thin' });
    renderPane();
    await waitFor(() => expect(screen.getByTestId('webview')).toBeTruthy());
    expect(
      screen.getByText(
        `src:https://news.nileorbit.com/api/articles/clean?url=${encodeURIComponent('https://www.youm7.com/story/1')}`,
      ),
    ).toBeTruthy();
  });

  it('falls back when the publisher refused us', async () => {
    mockReader.mockResolvedValue({ title: null, blocks: [], readable: false, reason: 'blocked' });
    renderPane();
    await waitFor(() => expect(screen.getByTestId('webview')).toBeTruthy());
  });

  it('falls back when the request itself fails, instead of showing an empty page', async () => {
    mockReader.mockRejectedValue(new Error('network down'));
    renderPane();
    await waitFor(() => expect(screen.getByTestId('webview')).toBeTruthy());
  });

  it('never renders a reader with no content on a span of luck', async () => {
    // `readable` is the server's verdict; a payload that claims readable but carries
    // no blocks must still fall back rather than show a blank sheet.
    mockReader.mockResolvedValue({ title: 'x', blocks: [], readable: true });
    renderPane();
    await waitFor(() => expect(screen.getByTestId('webview')).toBeTruthy());
  });

  it('turns the ad blocking ON for the fallback page', async () => {
    mockReader.mockResolvedValue({ title: null, blocks: [], readable: false, reason: 'thin' });
    renderPane();
    await waitFor(() => expect(screen.getByTestId('webview')).toBeTruthy());
    const props = (WebView as unknown as { lastProps: any }).lastProps;
    // The injected script is what removes the ad slots the blocked scripts leave.
    expect(typeof props.injectedJavaScript).toBe('string');
    expect(props.injectedJavaScript).toContain('adsbygoogle');
  });

  it('loads the page from the device when the server cannot reach the publisher', async () => {
    // Measured: dostor.org, ahram.org.eg and alarabiya.net refuse our server's TLS
    // handshake. The 502 from the cleaner must switch the WebView to the LIVE url
    // (from this device) with the injection still on — not stop the reader.
    mockReader.mockResolvedValue({ title: null, blocks: [], readable: false, reason: 'unreachable' });
    renderPane();
    await waitFor(() => expect(screen.getByTestId('webview')).toBeTruthy());
    // It starts on the cleaned endpoint…
    const cleaned = screen.getByText(
      `src:https://news.nileorbit.com/api/articles/clean?url=${encodeURIComponent('https://www.youm7.com/story/1')}`,
    );
    expect(cleaned).toBeTruthy();

    // …then a 502 makes it load the live page, with the ad injection still applied.
    const props = (WebView as unknown as { lastProps: any }).lastProps;
    await act(async () => {
      props.onHttpError({ nativeEvent: { statusCode: 502 } });
    });
    await waitFor(() =>
      expect(screen.getByText('src:https://www.youm7.com/story/1')).toBeTruthy(),
    );
    const after = (WebView as unknown as { lastProps: any }).lastProps;
    expect(typeof after.injectedJavaScript).toBe('string');
    expect(after.injectedJavaScript).toContain('adfull');
    // And the reader is told the truth about what they are looking at.
    expect(screen.getByText(/ممكن تظهر إعلانات/)).toBeTruthy();
  });

  it('sends the reader to the source when they ask for it', async () => {
    const spy = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as any);
    mockReader.mockResolvedValue(readerBody);
    renderPane();
    await waitFor(() => expect(screen.getByText('الأهلي يحسم القمة')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('فتح في المتصفح'));
    expect(spy).toHaveBeenCalledWith('https://www.youm7.com/story/1');
    spy.mockRestore();
  });
});

/**
 * The user's report on apk-74 (#54): on a real phone, an العربية and a الدستور
 * article opened an "إشعار إعادة التوجيه — … عنوان ويب غير صالح" page instead of the
 * story.
 *
 * Measured cause: every article our feeds store has a `news.google.com` URL, not the
 * publisher's own. The browser fallback handed that Google link to the WebView, and
 * Google's own article shell renders there as a redirect error. The server now
 * resolves it, and the WebView must open the RESOLVED publisher page.
 *
 * These pin the exact `source.uri` on each fallback branch, for the three publishers
 * the user named, plus the case where resolution failed and there is nothing to open.
 */
describe('the browser fallback opens the publisher, never the Google-News link', () => {
  // Real shapes: our feed stores Google News article links for these outlets.
  const gnews =
    'https://news.google.com/rss/articles/CBMiS0FVX3lxTE41M3ExY3A3UFJOS05hcXl2ejBQdEsybG5vUHZHTjlfWXVWS3Z5QzVpaVlrVTVPSHlmTnlZQ01PMHZuN1VKNGR1Mk9Gcw?oc=5';
  const publishers = {
    dostor: 'https://elcaptain.dostor.org/231448',
    alarabiya:
      'https://www.alarabiya.net/aswaq/companies/2026/11/25/%D8%AA%D8%B3%D9%87%D9%8A%D9%84',
    ahram: 'https://gate.ahram.org.eg/News/5130000.aspx',
  };

  const renderFallback = (url: string, id: string) =>
    render(
      <ArticleReadPane url={url} articleId={id} title="المصدر" t={t} onClose={() => {}} />,
    );

  beforeEach(() => {
    mockReader.mockReset();
    (WebView as unknown as { lastProps: any }).lastProps = null;
  });

  it.each(Object.entries(publishers))(
    'opens the resolved publisher page for %s when the reader refuses (blocked)',
    async (_name, publisher) => {
      // The server's answer for these three: it cannot extract and cannot even reach
      // them from this host, but it CAN resolve the Google link to the publisher URL.
      mockReader.mockResolvedValue({
        title: null,
        blocks: [],
        readable: false,
        reason: 'blocked',
        resolvedUrl: publisher,
      });
      renderFallback(gnews, 'x1');
      await waitFor(() => expect(screen.getByTestId('webview')).toBeTruthy());
      const props = (WebView as unknown as { lastProps: any }).lastProps;
      // Since #55 these three are read ON THE DEVICE, so the WebView opens the
      // publisher page itself rather than our cleaned copy — the server cannot reach
      // them at all. The #54 guarantee still holds: never a Google-News link.
      expect(props.source.uri).toBe(publisher);
      expect(props.source.uri).not.toContain('news.google.com');
    },
  );

  it.each(Object.entries(publishers))(
    'switches to the live publisher page for %s after the cleaner answers 502',
    async (_name, publisher) => {
      mockReader.mockResolvedValue({
        title: null,
        blocks: [],
        readable: false,
        reason: 'unreachable',
        resolvedUrl: publisher,
      });
      renderFallback(gnews, 'x2');
      await waitFor(() => expect(screen.getByTestId('webview')).toBeTruthy());
      const after = (WebView as unknown as { lastProps: any }).lastProps;
      // The page is the publisher's own, opened from the device, with its ad requests
      // refused natively (#55). The #54 bug was handing Google's shell to the WebView.
      expect(after.source.uri).toBe(publisher);
      expect(after.source.uri).not.toContain('news.google.com');
      expect(after.blockAdHosts).toBeTruthy();
      // The injection is the second layer behind the native gate.
      expect(after.injectedJavaScript).toContain('adfull');
    },
  );

  it('falls back to the original url when the server could not resolve it', async () => {
    // A non-Google url is its own publisher page, so it is used as-is.
    mockReader.mockResolvedValue({
      title: null,
      blocks: [],
      readable: false,
      reason: 'thin',
      resolvedUrl: null,
    });
    render(
      <ArticleReadPane url="https://www.masrawy.com/news/1" articleId="x3" title="مصراوي" t={t} onClose={() => {}} />,
    );
    await waitFor(() => expect(screen.getByTestId('webview')).toBeTruthy());
    const props = (WebView as unknown as { lastProps: any }).lastProps;
    expect(props.source.uri).toBe(
      `https://news.nileorbit.com/api/articles/clean?url=${encodeURIComponent('https://www.masrawy.com/news/1')}`,
    );
  });

  it('refuses to load a Google-News link it could not resolve, instead of the error page', async () => {
    // No websafe page can be produced for a Google link: its shell is the invalid
    // redirect the user saw. Show an honest message, not that error.
    mockReader.mockResolvedValue({
      title: null,
      blocks: [],
      readable: false,
      reason: 'unreachable',
      resolvedUrl: null,
    });
    renderFallback(gnews, 'x4');
    await waitFor(() => expect(screen.queryByTestId('webview')).toBeNull());
    expect(screen.getByText(/مش قادرين نفتح الخبر ده/)).toBeTruthy();
  });
});
