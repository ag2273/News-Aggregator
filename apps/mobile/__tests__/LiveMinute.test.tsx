// The live minute on screen (issue #36).
//
// What is asserted here is what a reader sees, driven through the real components.
// The rules come from measurements on ESPN's live feed, not from taste:
//   * a published minute is shown;
//   * published stoppage time is shown as sent (`90'+4'`), never as 94;
//   * between halves the line reads «استراحة» with no minute;
//   * no published minute means the state alone, which is still the Egyptian case.

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react-native';
import { liveLabel, liveText } from '../lib/liveLabel';
import { MatchCard } from '../components/FootballCard';
import { palette } from '../constants/colors';
import type { FootballMatch } from '../lib/api';

const t = palette.light;

const match = (over: Partial<FootballMatch> = {}): FootballMatch => ({
  id: 'm1',
  competitionId: 'uefa-champions',
  competitionName: 'دوري أبطال أوروبا',
  home: 'أرسنال',
  away: 'بوروسيا دورتموند',
  homeScore: 1,
  awayScore: 0,
  status: 'live',
  statusText: 'الشوط الثاني',
  kickoff: '22:00',
  round: null,
  minute: null,
  dataSource: 'filgoal',
  ...over,
});

describe('the live line, as the reader sees it', () => {
  it('shows the minute and the half when the source published both', () => {
    expect(liveText(match({ minute: 74, half: 'الشوط الثاني' }))).toBe('الدقيقة 74\' • الشوط الثاني');
  });

  it('shows published stoppage time exactly as the source sent it', () => {
    // 90+4 must never become 94: that number would be our arithmetic.
    const text = liveText(match({ minute: 90, minuteLabel: "90'+4'", half: 'الشوط الثاني' }));
    expect(text).toBe("الدقيقة 90'+4' • الشوط الثاني");
    expect(text).not.toContain('94');
  });

  it('reads «استراحة» with no minute between halves', () => {
    const label = liveLabel(match({ halftime: true, minute: 45, half: 'الشوط الأول' }));
    expect(label.minute).toBeNull();
    expect(label.state).toBe('استراحة');
  });

  it('shows the state alone for an Egyptian match with no published minute', () => {
    const label = liveLabel(
      match({ competitionId: 'egyptian-premier', statusText: 'مباشر', minute: null }),
    );
    expect(label.minute).toBeNull();
    expect(label.state).toBe('مباشر');
  });

  it('never prints a minute on a match that is not live', () => {
    const label = liveLabel(match({ status: 'finished', statusText: 'انتهت', minute: 90 }));
    expect(label.minute).toBeNull();
    expect(label.state).toBe('انتهت');
  });
});

describe('the match card prints the live line', () => {
  const card = (m: FootballMatch) => (
    <MatchCard t={t} m={m} favourite={false} onPress={() => {}} onPressTeam={() => {}} />
  );

  it('shows the minute on a card that has one', async () => {
    render(card(match({ minute: 74, half: 'الشوط الثاني' })));
    await waitFor(() =>
      expect(screen.getByText('الدقيقة 74\' • الشوط الثاني')).toBeTruthy(),
    );
  });

  it('shows stoppage time as published on a card', async () => {
    render(card(match({ minute: 90, minuteLabel: "90'+2'", half: 'الشوط الثاني' })));
    await waitFor(() =>
      expect(screen.getByText("الدقيقة 90'+2' • الشوط الثاني")).toBeTruthy(),
    );
  });

  it('says «استراحة» on a card between halves, with no minute', async () => {
    render(card(match({ halftime: true, minute: 45, half: 'الشوط الأول' })));
    await waitFor(() => expect(screen.getByText('استراحة')).toBeTruthy());
    expect(screen.queryByText(/الدقيقة/)).toBeNull();
  });

  it('keeps the state alone when no source published a minute', async () => {
    render(card(match({ home: 'المصري', away: 'بترول أسيوط', statusText: 'مباشر' })));
    await waitFor(() => expect(screen.getByText('مباشر')).toBeTruthy());
    expect(screen.queryByText(/الدقيقة/)).toBeNull();
  });
});
