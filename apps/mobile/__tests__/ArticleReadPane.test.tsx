/**
 * The article's source view (#51).
 *
 * The user's rule: reader view first, the source page in an ad-blocked browser only
 * when the reader view cannot be produced. These tests drive the real component
 * through both paths, because the failure mode that matters is a reader who gets an
 * empty page dressed up as the story.
 */

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';
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
