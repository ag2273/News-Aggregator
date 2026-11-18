/**
 * Keywords & mute screen: the caps line, adding/removing a keyword, the
 * per-keyword notification toggle, and both mute lists.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

const mockFetchPreferences = jest.fn();
const mockAdd = jest.fn();
const mockRemove = jest.fn();
const mockToggle = jest.fn();
const mockMute = jest.fn();
const mockUnmute = jest.fn();

jest.mock('../lib/api', () => {
  const actual = jest.requireActual('../lib/api');
  return {
    ...actual,
    fetchPreferences: (...a: unknown[]) => mockFetchPreferences(...a),
    addFollowedKeyword: (...a: unknown[]) => mockAdd(...a),
    removeFollowedKeyword: (...a: unknown[]) => mockRemove(...a),
    setKeywordNotify: (...a: unknown[]) => mockToggle(...a),
    mute: (...a: unknown[]) => mockMute(...a),
    unmute: (...a: unknown[]) => mockUnmute(...a),
  };
});

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() },
}));

jest.mock('../lib/auth', () => ({
  useAuth: () => ({
    token: 'session',
    user: { id: 'u1', email: 'r@example.com', emailVerified: true },
    emailVerified: true,
    loading: false,
  }),
}));

import KeywordsScreen from '../app/keywords';

const prefs = {
  keywords: [{ keyword: 'الذكاء الاصطناعي', label: 'الذكاء الاصطناعي', notify: true }],
  mutedKeywords: ['أسعار الذهب'],
  mutedSources: ['masrawy'],
  limits: { keywords: 20, mutedKeywords: 20 },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockFetchPreferences.mockResolvedValue(prefs);
  mockAdd.mockResolvedValue([]);
  mockRemove.mockResolvedValue(undefined);
  mockToggle.mockResolvedValue(undefined);
  mockMute.mockResolvedValue(undefined);
  mockUnmute.mockResolvedValue(undefined);
});

describe('keywords screen', () => {
  it('shows the keyword count against the cap', async () => {
    render(<KeywordsScreen />);
    expect(await screen.findByText('كلمات أتابعها (1 من 20)')).toBeTruthy();
  });

  it('lists followed keywords and the muted lists', async () => {
    render(<KeywordsScreen />);
    expect(await screen.findByText('الذكاء الاصطناعي')).toBeTruthy();
    expect(screen.getByText('أسعار الذهب')).toBeTruthy();
    expect(screen.getByText('masrawy')).toBeTruthy();
    expect(screen.getByText('الكلمات المكتومة (1)')).toBeTruthy();
    expect(screen.getByText('المصادر المكتومة (1)')).toBeTruthy();
  });

  it('adds a keyword from the input', async () => {
    render(<KeywordsScreen />);
    await screen.findByText('كلمات أتابعها (1 من 20)');
    fireEvent.changeText(screen.getByPlaceholderText('أدخل كلمة للمتابعة...'), 'الدوري المصري');
    fireEvent.press(screen.getByLabelText('إضافة كلمة'));
    await waitFor(() => expect(mockAdd).toHaveBeenCalledWith('session', 'الدوري المصري'));
  });

  it('removes a keyword', async () => {
    render(<KeywordsScreen />);
    await screen.findByText('الذكاء الاصطناعي');
    fireEvent.press(screen.getByLabelText('حذف الذكاء الاصطناعي'));
    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith('session', 'الذكاء الاصطناعي'));
  });

  it('toggles notifications for a keyword', async () => {
    render(<KeywordsScreen />);
    await screen.findByText('الذكاء الاصطناعي');
    fireEvent(screen.getByLabelText('إشعارات الذكاء الاصطناعي'), 'valueChange', false);
    await waitFor(() => expect(mockToggle).toHaveBeenCalledWith('session', 'الذكاء الاصطناعي', false));
  });

  it('mutes a new keyword', async () => {
    render(<KeywordsScreen />);
    await screen.findByText('الكلمات المكتومة (1)');
    fireEvent.changeText(screen.getByPlaceholderText('كلمة تتكتم من الأخبار...'), 'حوادث الطرق');
    fireEvent.press(screen.getByLabelText('كتم كلمة'));
    await waitFor(() => expect(mockMute).toHaveBeenCalledWith('session', { keyword: 'حوادث الطرق' }));
  });

  it('unmutes a source', async () => {
    render(<KeywordsScreen />);
    await screen.findByText('masrawy');
    fireEvent.press(screen.getByLabelText('إلغاء كتم المصدر masrawy'));
    await waitFor(() => expect(mockUnmute).toHaveBeenCalledWith('session', { sourceId: 'masrawy' }));
  });

  it('shows a calm error instead of a connection message on a gate', async () => {
    const { ApiError } = jest.requireActual('../lib/api');
    mockAdd.mockRejectedValue(new ApiError(403, 'gate', 'EMAIL_NOT_VERIFIED'));
    render(<KeywordsScreen />);
    await screen.findByText('الذكاء الاصطناعي');
    fireEvent.changeText(screen.getByPlaceholderText('أدخل كلمة للمتابعة...'), 'كلمة');
    fireEvent.press(screen.getByLabelText('إضافة كلمة'));
    expect(await screen.findByText('التفضيلات متاحة بعد توثيق بريدك.')).toBeTruthy();
  });
});
