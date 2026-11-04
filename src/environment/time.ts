/**
 * Malaysia time and time-of-day, independent of any world or domain.
 *
 * Malaysia Time (MYT) is a fixed UTC+8 with no daylight saving (since 1982), so
 * the conversion is exact arithmetic on the epoch timestamp. It does not depend on
 * the browser's own time zone or on Intl time-zone data being available.
 */

export const MALAYSIA_UTC_OFFSET_MINUTES = 8 * 60;
export const MALAYSIA_TIME_ZONE = 'Asia/Kuala_Lumpur';

export interface ClockTime {
  /** 0-23 */
  hours: number;
  minutes: number;
  seconds: number;
}

export function malaysiaTime(date: Date): ClockTime {
  const shifted = new Date(date.getTime() + MALAYSIA_UTC_OFFSET_MINUTES * 60_000);
  return { hours: shifted.getUTCHours(), minutes: shifted.getUTCMinutes(), seconds: shifted.getUTCSeconds() };
}

/** "7:42 PM", "12:05 AM". */
export function formatClockTime({ hours, minutes }: ClockTime): string {
  const h12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${h12}:${String(minutes).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`;
}

/** Parse "HH:MM" (24 h) — used for a demo / test override of the clock. */
export function parseClockTime(text: string | null | undefined): ClockTime | null {
  const m = text?.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) return null;
  return { hours, minutes, seconds: 0 };
}

// ------------------------------------------------------------------ time of day

export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night';

/**
 * Start of each period, in minutes after midnight, Malaysia time.
 *
 * Malaysia is near the equator, so sunrise is about 7:00–7:20 AM and sunset
 * about 7:10–7:30 PM all year. 6:00–6:59 is therefore still dark, and the night
 * period runs until 7:00 AM instead of the 6:00 AM in the brief.
 */
export const TIME_OF_DAY_STARTS: readonly { period: TimeOfDay; from: number }[] = [
  { period: 'morning', from: 7 * 60 },
  { period: 'afternoon', from: 12 * 60 },
  { period: 'evening', from: 18 * 60 },
  { period: 'night', from: 19 * 60 + 30 },
];

export function timeOfDayAt({ hours, minutes }: ClockTime, starts = TIME_OF_DAY_STARTS): TimeOfDay {
  const t = hours * 60 + minutes;
  let current = starts[starts.length - 1].period; // before the first start = previous day's last period
  for (const s of starts) if (t >= s.from) current = s.period;
  return current;
}

export const TIME_OF_DAY_LABEL: Record<TimeOfDay, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
  night: 'Night',
};

/** Generic description of the view outside, used by window interactions in any world. */
export const TIME_OF_DAY_VIEW: Record<TimeOfDay, string> = {
  morning: 'Bright morning sunshine. The sky is clear and the air still feels cool.',
  afternoon: 'Full daylight. A few clouds drift across a hot blue sky.',
  evening: 'The sun is setting and the sky glows orange.',
  night: 'It is dark outside. The moon is up and the stars are out.',
};
