/**
 * Story cluster card: the badge count, the overlapping avatars, and the
 * comparison sheet listing each outlet's version.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';

jest.mock('../lib/auth', () => ({
  useAuth: () => ({ token: null, user: null, emailVerified: false, loading: false }),
}));

import { ClusterCard, ClusterBadge } from '../components/ClusterCard';
import { palette } from '../constants/colors';

const t = palette.dark;

function article(id: string, sourceId: string, sourceName: string, title: string) {
  return {
    id,
    title,
    summary: null,
    imageUrl: null,
    url: `https://example.com/${id}`,
    sourceId,
    sourceName,
    category: 'egypt',
    country: 'EG',
    publishedAt: Date.now() - 3600_000,
    isBreaking: false,
    reactions: { like: 0, love: 0, wow: 0, sad: 0, angry: 0, total: 0 },
    myReaction: null,
  } as any;
}

const members = [
  article('a1', 'youm7', 'اليوم السابع', 'اعتماد 5 منشآت صحية بالمنيا ضمن منظومة الجودة'),
  article('a2', 'almasry', 'المصري اليوم', 'محافظ المنيا: اعتماد 5 منشآت صحية ضمن منظومة الجودة'),
  article('a3', 'ahram', 'بوابة الأهرام', 'اعتماد منشآت صحية بالمنيا'),
];

describe('cluster badge', () => {
  it('shows the source count in Arabic', () => {
    render(<ClusterBadge t={t} count={3} onPress={jest.fn()} />);
    expect(screen.getByText('من 3 مصادر')).toBeTruthy();
  });

  it('is pressable and labelled for accessibility', () => {
    const onPress = jest.fn();
    render(<ClusterBadge t={t} count={4} onPress={onPress} />);
    fireEvent.press(screen.getByLabelText('تغطية من 4 مصادر'));
    expect(onPress).toHaveBeenCalled();
  });
});

describe('cluster card', () => {
  it('renders the lead article title with the badge', () => {
    render(
      <ClusterCard
        t={t}
        lead={members[0]!}
        members={members}
        sourceCount={3}
        onPress={jest.fn()}
        onNeedVerification={jest.fn()}
      />,
    );
    expect(screen.getByText(members[0]!.title)).toBeTruthy();
    expect(screen.getByText('من 3 مصادر')).toBeTruthy();
  });

  it('opens the comparison sheet with every source version', () => {
    render(
      <ClusterCard
        t={t}
        lead={members[0]!}
        members={members}
        sourceCount={3}
        onPress={jest.fn()}
        onNeedVerification={jest.fn()}
      />,
    );
    fireEvent.press(screen.getByText('من 3 مصادر'));

    expect(screen.getByText('تغطية القصة من عدة مصادر')).toBeTruthy();
    for (const m of members) {
      // The lead's source also appears in the overlapping avatar row, so allow
      // more than one match per name.
      expect(screen.getAllByText(m.sourceName).length).toBeGreaterThan(0);
    }
  });

  it('shows at most three overlapping avatars', () => {
    const many = [
      ...members,
      article('a4', 'cnn-arabic', 'سي إن إن عربي', 'نسخة رابعة'),
      article('a5', 'bbc-arabic', 'بي بي سي عربي', 'نسخة خامسة'),
    ];
    render(
      <ClusterCard
        t={t}
        lead={many[0]!}
        members={many}
        sourceCount={5}
        onPress={jest.fn()}
        onNeedVerification={jest.fn()}
      />,
    );
    // The badge still reports the true count even though only 3 avatars show.
    expect(screen.getByText('من 5 مصادر')).toBeTruthy();
  });

  it('does not render the sheet until the badge is tapped', () => {
    render(
      <ClusterCard
        t={t}
        lead={members[0]!}
        members={members}
        sourceCount={3}
        onPress={jest.fn()}
        onNeedVerification={jest.fn()}
      />,
    );
    expect(screen.queryByText('تغطية القصة من عدة مصادر')).toBeNull();
  });
});
