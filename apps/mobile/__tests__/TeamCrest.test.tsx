import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { TeamCrest } from '../components/TeamCrest';
import { palette } from '../constants/colors';

const t = palette.light;

describe('TeamCrest', () => {
  it('loads the crest from our own API, never from a source', () => {
    render(<TeamCrest logo="/api/football/logo/filgoal:93" name="ليفربول" t={t} />);
    const img = screen.getByLabelText('ليفربول');
    expect(String(img.props.source.uri)).toContain('/api/football/logo/');
    expect(String(img.props.source.uri)).not.toContain('semedia.filgoal.com');
  });

  it('falls back to the placeholder when the source has no crest', () => {
    render(<TeamCrest logo={null} name="فريق بلا شعار" t={t} />);
    // The honest label says the crest is unavailable, rather than showing nothing.
    expect(screen.getByLabelText(/الشعار غير متاح/)).toBeTruthy();
  });

  it('falls back to the placeholder when the image fails to load', () => {
    render(<TeamCrest logo="/api/football/logo/filgoal:404" name="نادي" t={t} />);
    fireEvent(screen.getByLabelText('نادي'), 'error');
    expect(screen.getByLabelText(/الشعار غير متاح/)).toBeTruthy();
  });
});
