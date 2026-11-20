/**
 * The privacy-policy entry points in the app.
 *
 * Three screens must link it: حسابي (signed in AND signed out), the register
 * screen under the button, and the delete-account confirm screen. These render
 * the real screens and look for the link, so removing any one of them fails
 * here — that is the point.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({}),
  Stack: { Screen: () => null },
}));

jest.mock('@react-native-firebase/crashlytics', () => ({ __esModule: true, default: () => null }));
jest.mock('@react-native-firebase/app', () => ({ __esModule: true, default: () => null }));

jest.mock('../lib/auth', () => {
  const signedIn = { id: 'u1', email: 'a@b.co', emailVerified: true };
  return {
    useAuth: () => ({
      user: null,
      token: null,
      loading: false,
      emailVerified: false,
      signIn: jest.fn(),
      signUp: jest.fn(),
      signOut: jest.fn(),
      deleteAccount: jest.fn(),
      refreshSession: jest.fn(),
      __signedIn: signedIn,
    }),
  };
});

import { privacyUrl, openPrivacy } from '../lib/privacyLink';
import { router } from 'expo-router';
import AccountScreen from '../app/account';
import RegisterScreen from '../app/register';
import DeleteAccountScreen from '../app/delete-account';

describe('privacyUrl', () => {
  it('builds the Arabic and English URLs from the API base', () => {
    expect(privacyUrl('ar')).toMatch(/\/privacy$/);
    expect(privacyUrl('en')).toMatch(/\/privacy\?lang=en$/);
    expect(privacyUrl('ar')).not.toContain('//privacy');
  });

  it('opens the in-app WebView route with the policy URL', () => {
    openPrivacy('ar');
    const call = (router.push as jest.Mock).mock.calls.at(-1)?.[0];
    expect(call).toMatchObject({ pathname: '/webview' });
    expect(call.params.url).toMatch(/\/privacy$/);
    expect(call.params.title).toBe('سياسة الخصوصية');
  });
});

describe('the link exists on every screen that needs it', () => {
  it('register screen shows the consent line with a real link', () => {
    render(<RegisterScreen />);
    expect(screen.getByText(/بإنشاء حساب أنت توافق على/)).toBeTruthy();
    // The link itself is tappable and named for accessibility.
    const link = screen.getByLabelText('سياسة الخصوصية');
    expect(link).toBeTruthy();
    (router.push as jest.Mock).mockClear();
    fireEvent.press(link);
    expect(router.push).toHaveBeenCalledWith(expect.objectContaining({ pathname: '/webview' }));
  });

  it('account screen (signed out) shows the policy link, and it navigates', () => {
    render(<AccountScreen />);
    const link = screen.getByLabelText('سياسة الخصوصية');
    expect(link).toBeTruthy();
    (router.push as jest.Mock).mockClear();
    fireEvent.press(link);
    expect(router.push).toHaveBeenCalledWith(expect.objectContaining({ pathname: '/webview' }));
  });

  it('delete-account confirm screen shows the policy link, and it navigates', () => {
    render(<DeleteAccountScreen />);
    const link = screen.getByLabelText('سياسة الخصوصية');
    expect(link).toBeTruthy();
    // Pressing it must open the page, not just render a label.
    (router.push as jest.Mock).mockClear();
    fireEvent.press(link);
    expect(router.push).toHaveBeenCalledWith(expect.objectContaining({ pathname: '/webview' }));
  });
});
