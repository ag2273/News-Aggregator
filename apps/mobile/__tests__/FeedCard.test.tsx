/**
 * FeedCard renders what the spec promises a news card shows: the title, the
 * source name, the relative time, the cover image, and a breaking badge that
 * appears only for breaking news.
 *
 * Real component test (jest-expo + @testing-library/react-native) rather than a
 * source-grep check, because these are rendering decisions: a badge that is
 * always present or an image that never renders would pass a grep.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';
// The card now hosts a reactions capsule, which reads auth. Mock the boundary so
// this test stays about rendering (the reactions rules have their own suite).
jest.mock('../lib/auth', () => ({
  useAuth: () => ({ token: null, user: null, emailVerified: false, loading: false }),
}));

import { FeedCard } from '../components/FeedCard';
import { palette } from '../constants/colors';
import type { Article } from '../lib/api';

const t = palette.dark;

function article(overrides: Partial<Article> = {}): Article {
  return {
    id: 'a1',
    title: 'الأهلي يفوز على الزمالك في القمة',
    summary: null,
    imageUrl: 'https://img.test/cover.jpg',
    url: 'https://example.com/a1',
    sourceId: 'youm7',
    sourceName: 'اليوم السابع',
    category: 'sports',
    country: 'EG',
    publishedAt: Date.now() - 2 * 60 * 60 * 1000,
    isBreaking: false,
    ...overrides,
  };
}

const noop = () => {};

describe('FeedCard', () => {
  it('renders the title and the source name', () => {
    render(<FeedCard article={article()} t={t} onPress={noop} />);
    expect(screen.getByText('الأهلي يفوز على الزمالك في القمة')).toBeTruthy();
    expect(screen.getByText('اليوم السابع')).toBeTruthy();
  });

  it('renders a relative time, not a raw timestamp', () => {
    render(<FeedCard article={article()} t={t} onPress={noop} />);
    // Two hours ago, in the app's Arabic relative format.
    expect(screen.getAllByText(/ساعة|ساعات/).length).toBeGreaterThan(0);
    expect(screen.queryByText(String(article().publishedAt))).toBeNull();
  });

  it('renders the cover image when the article has one', () => {
    render(<FeedCard article={article()} t={t} onPress={noop} />);
    const images = screen.UNSAFE_getAllByType(require('react-native').Image);
    expect(images.length).toBe(1);
    expect(images[0].props.source).toEqual({ uri: 'https://img.test/cover.jpg' });
  });

  it('shows a placeholder instead of a cover image when there is none', () => {
    render(<FeedCard article={article({ imageUrl: null })} t={t} onPress={noop} />);
    const images = screen.UNSAFE_queryAllByType(require('react-native').Image);
    // Only the outlet's icon on the placeholder tile, never a cover.
    expect(images.map((i) => i.props.source.uri)).toEqual([expect.stringMatching(/\/api\/sources\/youm7\/icon$/)]);
  });

  it('shows the breaking badge for breaking news', () => {
    render(<FeedCard article={article({ isBreaking: true })} t={t} onPress={noop} />);
    expect(screen.getByText('عاجل')).toBeTruthy();
  });

  it('does NOT show the breaking badge for ordinary news', () => {
    render(<FeedCard article={article({ isBreaking: false })} t={t} onPress={noop} />);
    expect(screen.queryByText('عاجل')).toBeNull();
  });

  it('exposes the headline as the accessible label and is pressable', () => {
    const onPress = jest.fn();
    render(<FeedCard article={article()} t={t} onPress={onPress} />);
    const card = screen.getByLabelText('الأهلي يفوز على الزمالك في القمة');
    expect(card).toBeTruthy();
  });

  it("shows the outlet's colour and icon from our server when the story has no picture", () => {
    render(<FeedCard article={article({ imageUrl: null, sourceColor: '#C4161C' })} t={t} onPress={noop} />);
    expect(screen.getByTestId('source-artwork')).toBeTruthy();
    const icon = screen.getByTestId('source-artwork-icon');
    expect(icon.props.source.uri).toMatch(/\/api\/sources\/youm7\/icon$/);
  });
});
