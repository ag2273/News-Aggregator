/**
 * Reactions UI rules from the design spec:
 *  - counts hidden below 3, shown at 3+,
 *  - one reaction per user, switching replaces, re-tapping removes,
 *  - a guest or unverified account sends NO request and gets the gate,
 *  - optimistic with rollback on failure.
 *
 * Only the network/auth boundary is mocked; the components are real.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

const mockPut = jest.fn();
const mockDelete = jest.fn();

jest.mock('../lib/api', () => {
  const actual = jest.requireActual('../lib/api');
  return {
    ...actual,
    putReaction: (...a: unknown[]) => mockPut(...a),
    deleteReaction: (...a: unknown[]) => mockDelete(...a),
  };
});

let mockAuth: { token: string | null; user: any; emailVerified: boolean };
jest.mock('../lib/auth', () => ({
  useAuth: () => ({ ...mockAuth, loading: false }),
}));

import { ReactionsBar, ReactionsCapsule } from '../components/Reactions';
import { ApiError } from '../lib/api';
import { palette } from '../constants/colors';

const t = palette.dark;

function article(overrides: Record<string, unknown> = {}) {
  return {
    id: 'a1',
    title: 'خبر',
    summary: null,
    imageUrl: null,
    url: 'https://example.com/a1',
    sourceId: 'youm7',
    sourceName: 'اليوم السابع',
    category: 'egypt',
    country: 'EG',
    publishedAt: Date.now(),
    isBreaking: false,
    reactions: { like: 0, love: 0, wow: 0, sad: 0, angry: 0, total: 0 },
    myReaction: null,
    ...overrides,
  } as any;
}

const counts = (o: Partial<Record<'like' | 'love' | 'wow' | 'sad' | 'angry' | 'total', number>>) => ({
  like: 0,
  love: 0,
  wow: 0,
  sad: 0,
  angry: 0,
  total: 0,
  ...o,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth = {
    token: 'session',
    user: { id: 'u1', email: 'r@example.com', emailVerified: true },
    emailVerified: true,
  };
  mockPut.mockResolvedValue({ counts: counts({ like: 1, total: 1 }), myReaction: 'like' });
  mockDelete.mockResolvedValue({ counts: counts({}), myReaction: null });
});

describe('reaction counts visibility', () => {
  it('hides the number below 3', () => {
    render(<ReactionsBar t={t} article={article({ reactions: counts({ love: 2, total: 2 }) })} onNeedVerification={jest.fn()} />);
    // No numeric label for love (2 < 3).
    expect(screen.queryByText('2')).toBeNull();
  });

  it('shows the number at 3 or more', () => {
    render(<ReactionsBar t={t} article={article({ reactions: counts({ love: 3, total: 3 }) })} onNeedVerification={jest.fn()} />);
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('shows the total in the header', () => {
    render(<ReactionsBar t={t} article={article({ reactions: counts({ love: 24, like: 18, total: 42 }) })} onNeedVerification={jest.fn()} />);
    expect(screen.getByText('42 تفاعل')).toBeTruthy();
  });
});

describe('reaction interaction', () => {
  it('sends a PUT when the user reacts', async () => {
    render(<ReactionsBar t={t} article={article()} onNeedVerification={jest.fn()} />);
    fireEvent.press(screen.getByLabelText(/إعجاب/));
    await waitFor(() => expect(mockPut).toHaveBeenCalledWith('a1', 'like', 'session'));
  });

  it('sends a DELETE when the active reaction is tapped again', async () => {
    render(
      <ReactionsBar
        t={t}
        article={article({ myReaction: 'like', reactions: counts({ like: 5, total: 5 }) })}
        onNeedVerification={jest.fn()}
      />,
    );
    fireEvent.press(screen.getByLabelText(/إعجاب/));
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('a1', 'session'));
    expect(mockPut).not.toHaveBeenCalled();
  });

  it('marks the active reaction as selected for accessibility', () => {
    render(
      <ReactionsBar
        t={t}
        article={article({ myReaction: 'love', reactions: counts({ love: 4, total: 4 }) })}
        onNeedVerification={jest.fn()}
      />,
    );
    expect(screen.getByLabelText(/حب/).props.accessibilityState.selected).toBe(true);
  });
});

describe('gate: no request for guests or unverified accounts', () => {
  it('opens the gate and sends nothing when signed out', () => {
    mockAuth = { token: null, user: null, emailVerified: false };
    const onNeed = jest.fn();
    render(<ReactionsBar t={t} article={article()} onNeedVerification={onNeed} />);
    fireEvent.press(screen.getByLabelText(/إعجاب/));
    expect(onNeed).toHaveBeenCalled();
    expect(mockPut).not.toHaveBeenCalled();
  });

  it('opens the gate and sends nothing when unverified', () => {
    mockAuth = {
      token: 'session',
      user: { id: 'u1', email: 'r@example.com', emailVerified: false },
      emailVerified: false,
    };
    const onNeed = jest.fn();
    render(<ReactionsBar t={t} article={article()} onNeedVerification={onNeed} />);
    fireEvent.press(screen.getByLabelText(/إعجاب/));
    expect(onNeed).toHaveBeenCalled();
    expect(mockPut).not.toHaveBeenCalled();
  });
});

describe('capsule on feed cards', () => {
  it('shows only the top two reactions', () => {
    render(
      <ReactionsCapsule
        t={t}
        article={article({ reactions: counts({ love: 20, like: 15, sad: 9, total: 44 }) })}
        onPress={jest.fn()}
        onNeedVerification={jest.fn()}
      />,
    );
    expect(screen.getByText('❤️ 👍')).toBeTruthy();
    expect(screen.getByText('44')).toBeTruthy();
  });

  it('opens the picker when it has counts', () => {
    const onPress = jest.fn();
    render(
      <ReactionsCapsule
        t={t}
        article={article({ reactions: counts({ love: 4, total: 4 }) })}
        onPress={onPress}
        onNeedVerification={jest.fn()}
      />,
    );
    fireEvent.press(screen.getByLabelText(/تفاعلات القراء/));
    expect(onPress).toHaveBeenCalled();
  });
});

describe('failure handling', () => {
  it('rolls back and shows the network message when the call fails', async () => {
    mockPut.mockRejectedValue(new Error('Failed to fetch'));
    render(<ReactionsBar t={t} article={article()} onNeedVerification={jest.fn()} />);
    fireEvent.press(screen.getByLabelText(/إعجاب/));
    expect(await screen.findByText('تعذّر تسجيل التفاعل. تحقّق من الإنترنت.')).toBeTruthy();
  });

  it('never shows the network message for a 403 gate', async () => {
    // The real helper classifies on ApiError, so send the genuine type.
    mockPut.mockRejectedValue(new ApiError(403, 'Email verification required', 'EMAIL_NOT_VERIFIED'));
    render(<ReactionsBar t={t} article={article()} onNeedVerification={jest.fn()} />);
    fireEvent.press(screen.getByLabelText(/إعجاب/));
    expect(await screen.findByText('التفاعل مع الأخبار متاح بعد توثيق بريدك.')).toBeTruthy();
    expect(screen.queryByText(/الإنترنت/)).toBeNull();
  });
});
