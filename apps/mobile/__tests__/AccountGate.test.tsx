/**
 * The three-state account gate.
 *
 * A guest must get a SIGN-IN sheet, because there is no email to verify and the
 * verification sheet's "resend the link" cannot work. Signed-in-but-unverified
 * gets the verification sheet. Verified users pass straight through.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { Text, TouchableOpacity } from 'react-native';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a) } }));

let mockAuth: { token: string | null; user: any; emailVerified: boolean; loading: boolean };
jest.mock('../lib/auth', () => ({ useAuth: () => mockAuth }));

jest.mock('../components/VerificationGate', () => ({
  VerificationGate: () => {
    const { Text: T } = require('react-native');
    return <T>VERIFY_SHEET</T>;
  },
}));

import { useAccountGate, AccountGateSheet } from '../components/AccountGate';
import { palette } from '../constants/colors';

const t = palette.dark;

/** Test harness: a button that asks the gate, then opens it. */
function Harness({ onResult }: { onResult?: (allowed: boolean) => void }) {
  const gate = useAccountGate();
  return (
    <>
      <TouchableOpacity
        onPress={() => {
          onResult?.(gate.allowed);
          if (!gate.allowed) gate.open();
        }}
        accessibilityRole="button"
        accessibilityLabel="act"
      >
        <Text>act</Text>
      </TouchableOpacity>
      <AccountGateSheet t={t} gate={gate} />
    </>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth = {
    token: 'session',
    user: { id: 'u1', email: 'r@example.com', emailVerified: true },
    emailVerified: true,
    loading: false,
  };
});

describe('guest state', () => {
  it('is not allowed and shows the sign-in sheet', () => {
    mockAuth = { token: null, user: null, emailVerified: false, loading: false };
    const onResult = jest.fn();
    render(<Harness onResult={onResult} />);

    fireEvent.press(screen.getByLabelText('act'));

    expect(onResult).toHaveBeenCalledWith(false);
    expect(screen.getByText('سجّل دخولك عشان تتفاعل')).toBeTruthy();
    // The verification sheet must NOT be what a guest sees.
    expect(screen.queryByText('VERIFY_SHEET')).toBeNull();
  });

  it('offers sign-in and create-account buttons that navigate', () => {
    mockAuth = { token: null, user: null, emailVerified: false, loading: false };
    render(<Harness />);
    fireEvent.press(screen.getByLabelText('act'));

    fireEvent.press(screen.getByLabelText('تسجيل الدخول'));
    expect(mockPush).toHaveBeenCalledWith('/login');

    fireEvent.press(screen.getByLabelText('act'));
    fireEvent.press(screen.getByLabelText('إنشاء حساب'));
    expect(mockPush).toHaveBeenCalledWith('/register');
  });
});

describe('signed-in but unverified', () => {
  it('is not allowed and shows the verification sheet', () => {
    mockAuth = {
      token: 'session',
      user: { id: 'u1', email: 'r@example.com', emailVerified: false },
      emailVerified: false,
      loading: false,
    };
    const onResult = jest.fn();
    render(<Harness onResult={onResult} />);

    fireEvent.press(screen.getByLabelText('act'));

    expect(onResult).toHaveBeenCalledWith(false);
    expect(screen.getByText('VERIFY_SHEET')).toBeTruthy();
    expect(screen.queryByText('سجّل دخولك عشان تتفاعل')).toBeNull();
  });
});

describe('verified', () => {
  it('is allowed and opens nothing', () => {
    const onResult = jest.fn();
    render(<Harness onResult={onResult} />);

    fireEvent.press(screen.getByLabelText('act'));

    expect(onResult).toHaveBeenCalledWith(true);
    expect(screen.queryByText('سجّل دخولك عشان تتفاعل')).toBeNull();
    expect(screen.queryByText('VERIFY_SHEET')).toBeNull();
  });
});
