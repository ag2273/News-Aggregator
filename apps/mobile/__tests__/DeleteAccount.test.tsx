/**
 * Account deletion screen: the destructive action must require the password,
 * state what gets deleted, and close the session on success.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

const mockDeleteAccount = jest.fn();
const mockReplace = jest.fn();

jest.mock('expo-router', () => ({
  router: { replace: (...a: unknown[]) => mockReplace(...a), back: jest.fn(), push: jest.fn() },
}));

jest.mock('../lib/auth', () => ({
  useAuth: () => ({
    user: { id: 'u1', email: 'reader@example.com', emailVerified: true },
    token: 'session',
    loading: false,
    emailVerified: true,
    signIn: jest.fn(),
    signUp: jest.fn(),
    signOut: jest.fn(),
    deleteAccount: (...args: unknown[]) => mockDeleteAccount(...args),
    refreshSession: jest.fn(),
  }),
}));

import DeleteAccountScreen from '../app/delete-account';

beforeEach(() => {
  jest.clearAllMocks();
  mockDeleteAccount.mockResolvedValue(undefined);
});

describe('delete account screen', () => {
  it('warns that it is permanent and lists what is deleted', () => {
    render(<DeleteAccountScreen />);
    expect(screen.getByText('الحذف نهائي ولا رجعة فيه')).toBeTruthy();
    expect(screen.getByText('المصادر اللي بتتابعها')).toBeTruthy();
    expect(screen.getByText('المقالات المحفوظة')).toBeTruthy();
    expect(screen.getByText('تفضيلات الإشعارات وتوكن الجهاز')).toBeTruthy();
  });

  it('cannot submit without a password', () => {
    render(<DeleteAccountScreen />);
    const button = screen.getByLabelText('تأكيد حذف الحساب نهائيًا');
    fireEvent.press(button);
    expect(mockDeleteAccount).not.toHaveBeenCalled();
  });

  it('submits with the typed password and leaves the stack', async () => {
    render(<DeleteAccountScreen />);
    fireEvent.changeText(screen.getByLabelText('كلمة المرور للتأكيد'), 'password123');
    fireEvent.press(screen.getByLabelText('تأكيد حذف الحساب نهائيًا'));

    await waitFor(() => expect(mockDeleteAccount).toHaveBeenCalledWith('password123'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
  });

  it('shows the server error and does not navigate on a wrong password', async () => {
    mockDeleteAccount.mockRejectedValue(new Error('كلمة المرور غير صحيحة'));
    render(<DeleteAccountScreen />);
    fireEvent.changeText(screen.getByLabelText('كلمة المرور للتأكيد'), 'wrong');
    fireEvent.press(screen.getByLabelText('تأكيد حذف الحساب نهائيًا'));

    expect(await screen.findByText('كلمة المرور غير صحيحة')).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
