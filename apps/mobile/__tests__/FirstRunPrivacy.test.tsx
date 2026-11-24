/**
 * The first-run privacy notice.
 *
 * Play requires an in-app disclosure before an app handles personal data. These pin
 * the two things that matter about it: it appears once and not again, and every claim
 * on it is one the app can keep.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { FirstRunPrivacyNotice } from '../components/FirstRunPrivacyNotice';
import { palette } from '../constants/colors';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
}));

const getItem = SecureStore.getItemAsync as jest.Mock;
const setItem = SecureStore.setItemAsync as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  setItem.mockResolvedValue(undefined);
});

describe('first-run privacy notice', () => {
  it('shows on the first launch when nothing has been acknowledged', async () => {
    getItem.mockResolvedValue(null);
    render(<FirstRunPrivacyNotice t={palette.light} />);
    await waitFor(() => expect(screen.getByText('الخصوصية في تطبيقنا')).toBeTruthy());
  });

  it('does not show again once acknowledged', async () => {
    getItem.mockResolvedValue('1');
    render(<FirstRunPrivacyNotice t={palette.light} />);
    // Give the async read a tick; nothing should appear.
    await waitFor(() => expect(getItem).toHaveBeenCalled());
    expect(screen.queryByText('الخصوصية في تطبيقنا')).toBeNull();
  });

  it('records the acknowledgement so the next launch is quiet', async () => {
    getItem.mockResolvedValue(null);
    render(<FirstRunPrivacyNotice t={palette.light} />);
    await waitFor(() => expect(screen.getByText('متابعة')).toBeTruthy());
    fireEvent.press(screen.getByText('متابعة'));
    await waitFor(() => expect(setItem).toHaveBeenCalledWith('privacyNoticeSeen.v1', '1'));
  });

  it('states only what the app actually does', async () => {
    getItem.mockResolvedValue(null);
    render(<FirstRunPrivacyNotice t={palette.light} />);
    await waitFor(() => expect(screen.getByText('الخصوصية في تطبيقنا')).toBeTruthy());
    // The four disclosures, each traceable to the policy table.
    expect(screen.getByText(/حسابك/)).toBeTruthy();
    expect(screen.getByText(/أعداد مجمّعة/)).toBeTruthy();
    expect(screen.getByText(/Firebase/)).toBeTruthy();
    // The AI line must say the article text is what is sent, not the reader's data.
    expect(screen.getByText(/نص المقالات المنشورة/)).toBeTruthy();
    expect(screen.getByText(/مش بياناتك/)).toBeTruthy();
  });
});
