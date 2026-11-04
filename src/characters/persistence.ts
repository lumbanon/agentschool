import { nearestSkinTone } from './customization/palette';
import { normalizeBody } from './customization/wardrobe';
import { validateName } from './name';
import { CHARACTER_SCHEMA_VERSION, type CharacterProfile, type OutfitSelection, type Presentation } from './types';

/**
 * Versioned local persistence for the character (Phase 0: localStorage only).
 *
 * The stored JSON *is* the schema-v1 CharacterProfile, so a later backend can
 * store it unchanged (identity columns + JSON wardrobe) and run the same
 * `migrate` chain server-side.
 */

export const CHARACTER_STORAGE_KEY = 'agentschool.character';

/** Validates one wardrobe entry for a domain; return null to drop it. */
export type WardrobeNormalizer = (raw: unknown, presentation: Presentation) => OutfitSelection | null;

export interface LoadResult {
  profile: CharacterProfile | null;
  /** Human-readable notes about anything that was repaired or discarded. */
  issues: string[];
}

/** Upgrades from older schema versions: MIGRATIONS[n] turns a v(n) object into v(n+1). */
const MIGRATIONS: Record<number, (old: Record<string, unknown>) => Record<string, unknown>> = {
  // v1 -> v2: skin became a choice of six tones with their own shadow colour.
  // Snap the old free skin colour to the nearest tone.
  1: (old) => {
    const body = isObj(old.body) ? old.body : {};
    const tone = nearestSkinTone(body.skin);
    return { ...old, schemaVersion: 2, body: { ...body, skin: tone.base, skinShade: tone.shade } };
  },
};

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function parseProfile(raw: unknown, normalizers: Record<string, WardrobeNormalizer>): LoadResult {
  const issues: string[] = [];
  if (!isObj(raw)) return { profile: null, issues: ['stored character is not an object'] };

  let data = raw;
  let version = data.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version)) return { profile: null, issues: ['missing schema version'] };
  if (version > CHARACTER_SCHEMA_VERSION) return { profile: null, issues: [`schema v${version} is newer than this app (v${CHARACTER_SCHEMA_VERSION})`] };
  while (version < CHARACTER_SCHEMA_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) return { profile: null, issues: [`no migration from schema v${version}`] };
    data = step(data);
    version++;
    issues.push(`migrated to schema v${version}`);
  }

  const id = isObj(data.identity) ? data.identity : {};
  const presentation: Presentation = id.presentation === 'female' || id.presentation === 'male' ? id.presentation : 'male';
  if (presentation !== id.presentation) issues.push('presentation was invalid');
  const name = validateName(typeof id.name === 'string' ? id.name : '');
  if (!name.ok) issues.push(`name was invalid: ${name.error}`);

  const wardrobe: Record<string, OutfitSelection> = {};
  const stored = isObj(data.wardrobe) ? data.wardrobe : {};
  for (const [domain, normalize] of Object.entries(normalizers)) {
    if (!(domain in stored)) continue;
    const sel = normalize(stored[domain], presentation);
    if (sel) wardrobe[domain] = sel;
  }

  const complete = data.creationComplete === true && name.ok && presentation === id.presentation;
  return {
    profile: {
      schemaVersion: CHARACTER_SCHEMA_VERSION,
      identity: { name: name.ok ? name.value : '', presentation },
      body: normalizeBody(data.body),
      wardrobe,
      creationComplete: complete,
      updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : new Date(0).toISOString(),
    },
    issues,
  };
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadProfile(normalizers: Record<string, WardrobeNormalizer>, key = CHARACTER_STORAGE_KEY): LoadResult {
  let text: string | null;
  try {
    text = storage()?.getItem(key) ?? null;
  } catch {
    return { profile: null, issues: ['storage unavailable'] };
  }
  if (text === null) return { profile: null, issues: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { profile: null, issues: ['stored character is not valid JSON'] };
  }
  return parseProfile(raw, normalizers);
}

/** Returns false when storage is unavailable (private mode etc.); the game still works for this session. */
export function saveProfile(profile: CharacterProfile, key = CHARACTER_STORAGE_KEY): boolean {
  try {
    const s = storage();
    if (!s) return false;
    s.setItem(key, JSON.stringify({ ...profile, updatedAt: new Date().toISOString() }));
    return true;
  } catch {
    return false;
  }
}

export function clearProfile(key = CHARACTER_STORAGE_KEY): void {
  try {
    storage()?.removeItem(key);
  } catch {
    /* ignore */
  }
}
