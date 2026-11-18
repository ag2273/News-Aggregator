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

describe('reader shows every count from 1 (user decision 2026-11-19)', () => {
  it('shows a count of 1', () => {
    render(<ReactionsBar t={t} article={article({ reactions: counts({ love: 1, total: 1 }) })} onNeedVerification={jest.fn()} />);
    expect(screen.getByText('1')).toBeTruthy();
  });

  it('shows a count of 2 (the old rule hid this)', () => {
    render(<ReactionsBar t={t} article={article({ reactions: counts({ love: 2, total: 2 }) })} onNeedVerification={jest.fn()} />);
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('shows larger counts as before', () => {
    render(<ReactionsBar t={t} article={article({ reactions: counts({ love: 24, total: 24 }) })} onNeedVerification={jest.fn()} />);
    expect(screen.getByText('24')).toBeTruthy();
  });

  it('still hides a zero count', () => {
    render(<ReactionsBar t={t} article={article({ reactions: counts({ love: 0, total: 0 }) })} onNeedVerification={jest.fn()} />);
    expect(screen.queryByText('0')).toBeNull();
  });

  it('shows no total line when there are no reactions', () => {
    render(<ReactionsBar t={t} article={article()} onNeedVerification={jest.fn()} />);
    // The section heading «تفاعلات القراء» is always there; the total line is not.
    expect(screen.getByText('تفاعلات القراء')).toBeTruthy();
    expect(screen.queryByText(/تفاعل واحد|تفاعلان|تفاعلات$/)).toBeNull();
    expect(screen.queryByText(/تفاعلاً/)).toBeNull();
  });
});

describe('total line uses correct Arabic plural', () => {
  const cases: Array<[number, string]> = [
    [1, 'تفاعل واحد'],
    [2, 'تفاعلان'],
    [3, '٣ تفاعلات'],
    [10, '١٠ تفاعلات'],
    [11, '١١ تفاعلاً'],
    [42, '٤٢ تفاعلاً'],
    [103, '١٠٣ تفاعلات'],
  ];

  for (const [n, expected] of cases) {
    it(`renders ${n} as ${expected}`, () => {
      render(
        <ReactionsBar
          t={t}
          article={article({ reactions: counts({ like: n, total: n }) })}
          onNeedVerification={jest.fn()}
        />,
      );
      expect(screen.getByText(expected)).toBeTruthy();
    });
  }
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
  it('sends nothing and asks for sign-in when the user is a guest', () => {
    mockAuth = { token: null, user: null, emailVerified: false };
    const onNeedVerify = jest.fn();
    const onNeedSignIn = jest.fn();
    render(
      <ReactionsBar
        t={t}
        article={article()}
        onNeedVerification={onNeedVerify}
        onNeedSignIn={onNeedSignIn}
      />,
    );
    fireEvent.press(screen.getByLabelText(/إعجاب/));
    // A guest has no email to verify, so the sign-in path is the correct one.
    expect(onNeedSignIn).toHaveBeenCalled();
    expect(onNeedVerify).not.toHaveBeenCalled();
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

describe('capsule keeps the >= 3 threshold', () => {
  it('shows no number below 3', () => {
    render(
      <ReactionsCapsule
        t={t}
        article={article({ reactions: counts({ love: 2, total: 2 }) })}
        onPress={jest.fn()}
        onNeedVerification={jest.fn()}
      />,
    );
    expect(screen.queryByText('2')).toBeNull();
  });

  it('shows the number at 3', () => {
    render(
      <ReactionsCapsule
        t={t}
        article={article({ reactions: counts({ love: 3, total: 3 }) })}
        onPress={jest.fn()}
        onNeedVerification={jest.fn()}
      />,
    );
    expect(screen.getByText('3')).toBeTruthy();
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

describe('props updating after mount (the reader bug)', () => {
  it('shows counts that arrive after the first render', () => {
    // Reproduction of the reported bug: the bar mounts with an all-zero article
    // (the feed snapshot), then the reader's fresh fetch supplies real counts.
    // useState alone ignored the second value, so the bar stayed blank.
    const { rerender } = render(
      <ReactionsBar t={t} article={article()} onNeedVerification={jest.fn()} />,
    );
    expect(screen.queryByText('3')).toBeNull();

    rerender(
      <ReactionsBar
        t={t}
        article={article({ reactions: counts({ like: 3, total: 3 }) })}
        onNeedVerification={jest.fn()}
      />,
    );

    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('٣ تفاعلات')).toBeTruthy();
  });

  it('shows the NEW article counts when a different article reuses the same bar', () => {
    // The reported repro: open an article with no reactions (e.g. from trending),
    // go back, open the Lavrov article which has 3. The sheet keeps ONE reader
    // instance (no key), so the bar must follow the article, not its first props.
    const { rerender } = render(
      <ReactionsBar t={t} article={article({ id: 'first' })} onNeedVerification={jest.fn()} />,
    );
    expect(screen.queryByText('3')).toBeNull();

    rerender(
      <ReactionsBar
        t={t}
        article={article({
          id: 'b155d2c4ffae3c65',
          reactions: counts({ like: 3, total: 3 }),
        })}
        onNeedVerification={jest.fn()}
      />,
    );
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('highlights myReaction that arrives after the first render', () => {
    const { rerender } = render(
      <ReactionsBar t={t} article={article()} onNeedVerification={jest.fn()} />,
    );
    rerender(
      <ReactionsBar
        t={t}
        article={article({ reactions: counts({ like: 3, total: 3 }), myReaction: 'like' })}
        onNeedVerification={jest.fn()}
      />,
    );
    expect(screen.getByLabelText(/إعجاب/).props.accessibilityState.selected).toBe(true);
  });
});

describe('counts come from the server', () => {
  it('replaces the optimistic count with the server response', async () => {
    // The server says someone else also reacted, so the truth is 5 not 1.
    mockPut.mockResolvedValue({ counts: counts({ like: 5, total: 5 }), myReaction: 'like' });
    render(<ReactionsBar t={t} article={article()} onNeedVerification={jest.fn()} />);
    fireEvent.press(screen.getByLabelText(/إعجاب/));
    await waitFor(() => expect(screen.getByText('5')).toBeTruthy());
    expect(screen.queryByText('1')).toBeNull();
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
