import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ENVIRONMENT_ACTIONS, ENVIRONMENT_VARS } from '../../src/environment/actions';
import { ambienceFor } from '../../src/environment/ambience';
import { CLOCK_FACE, handTurns, LIGHT_SWITCH, paintClockFace, paintLightSwitch, paintWindowView, WINDOW_VIEW, type PixelImage } from '../../src/environment/props';
import {
  formatClockTime,
  malaysiaTime,
  MALAYSIA_TIME_ZONE,
  parseClockTime,
  TIME_OF_DAY_VIEW,
  timeOfDayAt,
  type ClockTime,
  type TimeOfDay,
} from '../../src/environment/time';
import { parseMapObjects, type TiledMap } from '../../src/engine/core/tiled';
import type { DialogueScript } from '../../src/engine/core/types';
import { WORLDS } from '../../src/worlds/registry';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const t = (hours: number, minutes: number): ClockTime => ({ hours, minutes, seconds: 0 });

describe('Malaysia time (MYT, UTC+8)', () => {
  it.each([
    ['2026-11-04T11:42:00Z', 19, 42],
    ['2026-11-04T16:00:00Z', 0, 0], // midnight in KL, still the 4th in UTC
    ['2026-11-03T23:59:30Z', 7, 59],
    ['2026-06-21T04:05:00Z', 12, 5], // mid-year: Malaysia has no daylight saving
  ])('%s is %i:%i in Malaysia', (iso, hours, minutes) => {
    expect(malaysiaTime(new Date(iso))).toMatchObject({ hours, minutes });
  });

  it("matches the IANA zone Asia/Kuala_Lumpur, whatever the machine's own time zone", () => {
    const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: MALAYSIA_TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    for (let ms = Date.UTC(2026, 0, 1); ms < Date.UTC(2027, 0, 1); ms += 7 * 3_600_000 + 13 * 60_000) {
      const { hours, minutes } = malaysiaTime(new Date(ms));
      expect(`${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`).toBe(fmt.format(new Date(ms)));
    }
  });

  it.each([
    [t(19, 42), '7:42 PM'],
    [t(0, 0), '12:00 AM'],
    [t(12, 5), '12:05 PM'],
    [t(9, 7), '9:07 AM'],
    [t(23, 59), '11:59 PM'],
  ])('formats %o as %s', (time, text) => {
    expect(formatClockTime(time)).toBe(text);
  });

  it('parses the HH:MM demo override strictly', () => {
    expect(parseClockTime('19:45')).toEqual(t(19, 45));
    expect(parseClockTime('7:05')).toEqual(t(7, 5));
    for (const bad of ['24:00', '12:60', 'noon', '', null]) expect(parseClockTime(bad)).toBeNull();
  });
});

describe('time of day', () => {
  it.each<[number, number, TimeOfDay]>([
    [0, 0, 'night'],
    [5, 59, 'night'],
    [6, 59, 'night'], // still dark: sunrise in Malaysia is about 7:00–7:20
    [7, 0, 'morning'],
    [11, 59, 'morning'],
    [12, 0, 'afternoon'],
    [17, 59, 'afternoon'],
    [18, 0, 'evening'],
    [19, 29, 'evening'],
    [19, 30, 'night'],
    [23, 59, 'night'],
  ])('%i:%i is %s', (h, m, period) => {
    expect(timeOfDayAt(t(h, m))).toBe(period);
  });

  it('accepts custom ranges (e.g. a world with different hours)', () => {
    const starts = [
      { period: 'morning' as const, from: 6 * 60 },
      { period: 'night' as const, from: 18 * 60 },
    ];
    expect(timeOfDayAt(t(6, 0), starts)).toBe('morning');
    expect(timeOfDayAt(t(5, 0), starts)).toBe('night');
  });
});

// ------------------------------------------------------------------ painters
const pixel = (img: PixelImage, x: number, y: number) => [...img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];
const hexOf = (p: number[]) => `#${p.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('')}`;

describe('clock face', () => {
  it('fits the clock tile face and is transparent outside the dial', () => {
    const img = paintClockFace(t(10, 10));
    expect([img.width, img.height]).toEqual([CLOCK_FACE.width, CLOCK_FACE.height]);
    expect(pixel(img, 0, 0)[3]).toBe(0);
    expect(pixel(img, 9, 8)[3]).toBe(0);
  });

  it('points the hands at the time', () => {
    expect(handTurns(t(3, 0))).toEqual({ hour: 0.25, minute: 0 });
    expect(handTurns(t(18, 30))).toEqual({ hour: 0.5 + 0.5 / 12, minute: 0.5 });
    const three = paintClockFace(t(3, 0));
    const HAND = '#2a2230';
    expect(hexOf(pixel(three, 4, 1))).toBe(HAND); // minute hand straight up (covers the 12 mark)
    expect(hexOf(pixel(three, 6, 4))).toBe(HAND); // hour hand to the right
    expect(hexOf(pixel(three, 4, 6))).not.toBe(HAND); // nothing pointing down
  });

  it('changes when the minute changes', () => {
    expect([...paintClockFace(t(7, 42)).data]).not.toEqual([...paintClockFace(t(7, 43)).data]);
  });
});

describe('window view', () => {
  const periods: TimeOfDay[] = ['morning', 'afternoon', 'evening', 'night'];
  it('fits the window glass and keeps the cross bars', () => {
    for (const p of periods) {
      const img = paintWindowView(p);
      expect([img.width, img.height]).toEqual([WINDOW_VIEW.width, WINDOW_VIEW.height]);
      expect(hexOf(pixel(img, 4, 0))).toBe('#6b4f36');
      expect(hexOf(pixel(img, 0, 3))).toBe('#6b4f36');
    }
  });
  it('looks different at each time of day, and night is the darkest', () => {
    const sig = periods.map((p) => [...paintWindowView(p).data].join(','));
    expect(new Set(sig).size).toBe(4);
    const brightness = (p: TimeOfDay) => pixel(paintWindowView(p), 0, 1).slice(0, 3).reduce((a, b) => a + b, 0);
    for (const p of ['morning', 'afternoon', 'evening'] as const) expect(brightness('night')).toBeLessThan(brightness(p));
  });
  it('every period has a description for window dialogues', () => {
    for (const p of periods) expect(TIME_OF_DAY_VIEW[p].length).toBeGreaterThan(10);
  });
});

describe('light switch and room ambience', () => {
  it('the switch plate shows its state', () => {
    expect([paintLightSwitch(true).width, paintLightSwitch(true).height]).toEqual([LIGHT_SWITCH.width, LIGHT_SWITCH.height]);
    expect([...paintLightSwitch(true).data]).not.toEqual([...paintLightSwitch(false).data]);
  });
  it('afternoon with lights on is untinted; night is darker, and darker still with the lights off', () => {
    expect(ambienceFor('afternoon', true)).toBeNull();
    const on = ambienceFor('night', true)!;
    const off = ambienceFor('night', false)!;
    expect(off.alpha).toBeGreaterThan(on.alpha);
    expect(ambienceFor('evening', true)!.color).toBe('#ff8a3d'); // warm sunset
  });
});

// ------------------------------------------------------------------ world wiring
describe('environment items in the worlds', () => {
  const load = (url: string): TiledMap => JSON.parse(readFileSync(join(ROOT, 'public', url), 'utf8'));
  const objs = (worldId: string, roomId: string) => parseMapObjects(load(WORLDS[worldId].rooms.find((r) => r.id === roomId)!.mapUrl));

  it('the classroom has a clock face, two window views and a light switch prop', () => {
    expect(objs('school', 'classroom').props.map((p) => p.propId).sort()).toEqual(['clock', 'lightswitch', 'window', 'window']);
    expect(objs('school', 'hallway').props.map((p) => p.propId)).toEqual(['clock']);
  });

  it('the office reuses the same clock and window props', () => {
    expect(objs('office', 'office').props.map((p) => p.propId).sort()).toEqual(['clock', 'window', 'window', 'window']);
  });

  it('every classroom desk has a seat facing the blackboard', () => {
    const seats = objs('school', 'classroom').seats;
    expect(seats).toHaveLength(8);
    for (const s of seats) {
      expect(s.facing).toBe('up');
      expect(s.prompt).toBe('Sit at the desk');
      expect(s.sit.y).toBeGreaterThan(s.y + s.height / 2); // the chair is the lower tile of the zone
    }
  });

  it('the new school items are registered with zones and labelled prototype dialogue', () => {
    const ids = WORLDS.school.interactables.map((i) => i.id);
    for (const id of [
      'classroom_clock',
      'classroom_window',
      'classroom_lightswitch',
      'classroom_bookshelf',
      'classroom_teacher_desk',
      'hallway_clock',
      'hallway_locker_1',
      'hallway_shelf_returns',
      'hallway_shelf_fiction',
    ])
      expect(ids).toContain(id);
    expect(WORLDS.school.interactables.find((i) => i.id === 'classroom_lightswitch')?.interaction.action?.kind).toBe(ENVIRONMENT_ACTIONS.toggleLights);
  });

  it('dialogue placeholders are all ones the app fills in', () => {
    const known = new Set<string>([...ENVIRONMENT_VARS, 'playerName']);
    for (const def of Object.values(WORLDS)) {
      const scripts = [...def.actors.map((a) => a.interaction?.dialogue), ...def.interactables.map((i) => i.interaction.dialogue)].filter(Boolean) as DialogueScript[];
      for (const d of scripts)
        for (const line of d.lines)
          for (const text of [line.text, ...(line.choices ?? []).map((c) => c.label)])
            for (const m of text.matchAll(/\{(\w+)\}/g)) expect({ text, var: m[1], known: known.has(m[1]) }).toEqual({ text, var: m[1], known: true });
    }
  });

  it('clock dialogue says it is Malaysia time', () => {
    for (const id of ['classroom_clock', 'hallway_clock']) {
      const text = WORLDS.school.interactables.find((i) => i.id === id)!.interaction.dialogue!.lines[0].text;
      expect(text).toMatch(/Malaysia time: \{malaysiaTime\} \(MYT, UTC\+8\)/);
    }
  });
});

describe('environment boundary', () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(f)) files.push(p);
    }
  };
  walk(join(ROOT, 'src', 'environment'));

  it('does not import worlds, domains, the app shell or Phaser', () => {
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      expect({ f, bad: /from\s+['"]([^'"]*(\/worlds\/|\/domains\/|\/app\/|\/engine\/phaser)|phaser)['"]/.test(src) }).toEqual({ f, bad: false });
    }
  });
  it('contains no school or office vocabulary', () => {
    const banned = /\b(school|classroom|teacher|student|lesson|office|employee|prefect)\b/i;
    for (const f of files) {
      const code = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      expect({ f, match: code.match(banned)?.[0] ?? null }).toEqual({ f, match: null });
    }
  });
});
