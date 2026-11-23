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

  it('keeps the side that is published when only one club has announced', () => {
    // Measured on الجونة × الزمالك at T-54: 19 Zamalek players, none for الجونة.
    // An XI is announced club by club, so one-sided is a real state — returning
    // null there was the bug that made the screen say «غير متاح».
    const html = `{"HomeTeamId":617,"AwayTeamId":2,"MatchTeamsSquads":[
      {"PersonName":"مهدي سليمان","TeamId":"2","ShirtNumber":37,"PlayerPositionName":"حارس مرمى","IsSpare":false},
      {"PersonName":"عبد الله السعيد","TeamId":"2","ShirtNumber":19,"PlayerPositionName":"وسط","IsSpare":false}
    ]}`;
    const lu = parseFilGoalLineups(html);
    expect(lu).not.toBeNull();
    expect(lu!.away).toHaveLength(2);
    expect(lu!.home).toHaveLength(0);
    expect(lu!.away[0]!.name).toBe('مهدي سليمان');
  });

  it('reads the formation the page publishes, and rejects its «null» string', () => {
    // Measured on الزمالك × المقاولون: the page carries
    // `"HomeTeamFormationName":"4-2-3-1"`, and an unplayed match carries the
    // literal string «null» rather than a JSON null — which used to be served as a
    // formation called «null» (#28 needs the shape to draw the pitch).
    const played = `{"HomeTeamId":2,"AwayTeamId":617,
      "HomeTeamFormationName":"4-2-3-1","AwayTeamFormationName":"4-3-3",
      "MatchTeamsSquads":[
        {"PersonName":"أ","TeamId":"2","ShirtNumber":1,"PlayerPositionName":"حارس مرمى","IsSpare":false},
        {"PersonName":"ب","TeamId":"617","ShirtNumber":1,"PlayerPositionName":"حارس مرمى","IsSpare":false}
      ]}`;
    const lu = parseFilGoalLineups(played)!;
    expect(lu.homeFormation).toBe('4-2-3-1');
    expect(lu.awayFormation).toBe('4-3-3');

    const unplayed = played.replace('"4-2-3-1"', '"null"');
    expect(parseFilGoalLineups(unplayed)!.homeFormation).toBeNull();
  });
});
