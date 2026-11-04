import { useCallback, useEffect, useMemo, useState } from 'react';
import { ENVIRONMENT_ACTIONS } from './actions';
import { ambienceFor, type Ambience } from './ambience';
import { paintClockFace, paintLightSwitch, paintWindowView, toCanvas } from './props';
import { formatClockTime, malaysiaTime, TIME_OF_DAY_LABEL, TIME_OF_DAY_VIEW, timeOfDayAt, type ClockTime, type TimeOfDay } from './time';

/** Malaysia time, refreshed every second but only re-rendering when the minute changes. */
export function useMalaysiaClock(fixed: ClockTime | null = null): ClockTime {
  const [t, setT] = useState<ClockTime>(() => fixed ?? malaysiaTime(new Date()));
  useEffect(() => {
    if (fixed) {
      setT(fixed);
      return;
    }
    const tick = () => {
      const now = malaysiaTime(new Date());
      setT((prev) => (prev.hours === now.hours && prev.minutes === now.minutes ? prev : now));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [fixed]);
  return t;
}

export interface EnvironmentState {
  clock: ClockTime;
  period: TimeOfDay;
  lightsOn: boolean;
  ambience: Ambience | null;
  /** Textures for the `clock`, `window` and `lightswitch` props. */
  propTextures: Record<string, HTMLCanvasElement>;
  /** Values for `{malaysiaTime}`, `{timeOfDay}`, `{windowView}` in dialogue. */
  dialogueVars: Record<string, string>;
  /** Effect handlers for ENVIRONMENT_ACTIONS. */
  effects: Record<string, (action: unknown, ctx: { worldId: string; roomId: string }) => string>;
  /** Report which room the player is in (lights are per room). */
  setRoom: (roomKey: string) => void;
}

/**
 * Everything time-of-day and lighting related, for any world: no knowledge of
 * schools or offices. Lights are remembered per room for this session.
 */
export function useEnvironment(fixed: ClockTime | null = null): EnvironmentState {
  const clock = useMalaysiaClock(fixed);
  const period = timeOfDayAt(clock);
  const [room, setRoom] = useState<string | null>(null);
  const [lightsOff, setLightsOff] = useState<ReadonlySet<string>>(() => new Set());
  const lightsOn = !room || !lightsOff.has(room);

  const toggleLights = useCallback(
    (roomKey: string) =>
      setLightsOff((prev) => {
        const next = new Set(prev);
        if (!next.delete(roomKey)) next.add(roomKey);
        return next;
      }),
    [],
  );

  const ambience = useMemo(() => ambienceFor(period, lightsOn), [period, lightsOn]);
  const propTextures = useMemo(
    () => ({
      clock: toCanvas(paintClockFace(clock)),
      window: toCanvas(paintWindowView(period)),
      lightswitch: toCanvas(paintLightSwitch(lightsOn)),
    }),
    [clock, period, lightsOn],
  );
  const dialogueVars = useMemo(
    () => ({ malaysiaTime: formatClockTime(clock), timeOfDay: TIME_OF_DAY_LABEL[period].toLowerCase(), windowView: TIME_OF_DAY_VIEW[period] }),
    [clock, period],
  );
  const effects = useMemo(
    () => ({
      [ENVIRONMENT_ACTIONS.toggleLights]: (_action: unknown, ctx: { worldId: string; roomId: string }) => {
        const key = `${ctx.worldId}/${ctx.roomId}`;
        // Decide the message from the current state; the update itself is applied by React.
        const willBeOn = lightsOff.has(key);
        toggleLights(key);
        return willBeOn ? 'Click! The lights are on.' : 'Click! The lights are off.';
      },
    }),
    [lightsOff, toggleLights],
  );

  return { clock, period, lightsOn, ambience, propTextures, dialogueVars, effects, setRoom };
}
