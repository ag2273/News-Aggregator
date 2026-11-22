import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFilGoalLineups, squadArray } from '../filgoal.js';
const here = path.dirname(fileURLToPath(import.meta.url));
const squad = fs.readFileSync(path.join(here,'fixtures','filgoal-squad.json'),'utf8');

describe('lineups', () => {
  it('parse the real squad array into two sides', () => {
    const html = `"MatchTeamsSquads":${squad},"HomeTeamId":93,"AwayTeamId":95`;
    // The helper returns just the JSON array, without the key or the marker.
    expect(squadArray(html)).toBe(squad);
    const l = parseFilGoalLineups(html);
    expect(l).not.toBeNull();
    expect(l!.home.length).toBeGreaterThan(10);
    expect(l!.away.length).toBeGreaterThan(10);
    expect(l!.home.every((p) => p.teamId === '93')).toBe(true);
    const keeper = l!.home.find((p) => p.position === 'حارس مرمى');
    expect(keeper).toBeDefined();
    expect(keeper!.name.length).toBeGreaterThan(2);
  });

  it('returns null for a match with no squad at all, so the screen says so', () => {
    // Egyptian fixtures carry an empty array.
    expect(parseFilGoalLineups('"MatchTeamsSquads":[],"HomeTeamId":1')).toBeNull();
    expect(parseFilGoalLineups('<html></html>')).toBeNull();
  });
});
