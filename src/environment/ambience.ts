import type { TimeOfDay } from './time';

export interface Ambience {
  color: string;
  alpha: number;
}

/**
 * Room tint for a time of day, with the room lights on or off. Subtle on purpose:
 * the world must stay readable at every hour.
 */
export function ambienceFor(period: TimeOfDay, lightsOn: boolean): Ambience | null {
  switch (period) {
    case 'morning':
      return lightsOn ? { color: '#fff1c9', alpha: 0.06 } : { color: '#1a1830', alpha: 0.14 };
    case 'afternoon':
      return lightsOn ? null : { color: '#1a1830', alpha: 0.12 };
    case 'evening':
      return lightsOn ? { color: '#ff8a3d', alpha: 0.12 } : { color: '#2e1626', alpha: 0.32 };
    case 'night':
      return lightsOn ? { color: '#0d1236', alpha: 0.18 } : { color: '#04051a', alpha: 0.55 };
  }
}
