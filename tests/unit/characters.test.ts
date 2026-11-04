import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { profileFromDraft, specFromDraft } from '../../src/characters/appearance';
import { COLORS, DEFAULT_BODY, hexToRgb, normalizeHex, ramp, SKIN_TONES } from '../../src/characters/customization/palette';
import {
  CODE_EMPTY,
  CODE_OUTLINE,
  composeMaterialSheet,
  composeSitMaterialSheet,
  decode,
  renderSitSheetRGBA,
  SIT_W,
  FRAME_H,
  FRAME_W,
  OUTLINE_RGBA,
  renderSheetRGBA,
  SHEET_H,
  SHEET_W,
  type Material,
} from '../../src/characters/customization/spriteComposer';
import {
  changeCategory,
  changePreset,
  changePresentation,
  customizableSlots,
  newDraft,
  normalizeSelection,
  outfitFromPreset,
  resetToDefault,
  restorePreset,
  setHeadwear,
  setSkinTone,
  setSleeves,
  setSlotColor,
} from '../../src/characters/customization/wardrobe';
import { validateName } from '../../src/characters/name';
import { parseProfile } from '../../src/characters/persistence';
import type { CharacterDraft, RenderSpec } from '../../src/characters/types';
import { characterSpecForWorld, WARDROBE_NORMALIZERS } from '../../src/domains/characters';
import { SCHOOL_PRESETS, SCHOOL_WARDROBE } from '../../src/domains/school/uniforms/presets';
import { SEED_PROFILE } from '../e2e/fixtures';

const W = SCHOOL_WARDROBE;
const preset = (id: string) => SCHOOL_PRESETS.find((p) => p.id === id)!;
const spec = (id: string, headwear?: boolean): RenderSpec => ({ presentation: preset(id).presentation, body: DEFAULT_BODY, outfit: outfitFromPreset(preset(id), headwear) });

const materialCount = (s: RenderSpec, m: Material) => [...composeMaterialSheet(s)].filter((c) => {
  const d = decode(c);
  return d && typeof d === 'object' && d.material === m;
}).length;

// ------------------------------------------------------------------ names
describe('character names', () => {
  it.each([
    ['Alex', 'Alex'],
    ['  Nur   Aisyah  ', 'Nur Aisyah'],
    ['Arjun a/l Kumar', 'Arjun a/l Kumar'],
    ["Siti Nur'ain", "Siti Nur'ain"],
    ['陈伟玲', '陈伟玲'],
    ['நாகராஜன்', 'நாகராஜன்'],
    ['José-María', 'José-María'],
  ])('accepts %j', (input, expected) => {
    expect(validateName(input)).toEqual({ ok: true, value: expected });
  });

  it.each([
    ['', /enter a name/],
    ['     ', /enter a name/],
    ['A'.repeat(25), /at most 24/],
    ['Alex 😀', /letters, numbers/],
    ['<script>', /letters, numbers/],
    ['1234', /at least one letter/],
  ])('rejects %j', (input, message) => {
    const r = validateName(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(message);
  });

  it('counts 24 user-perceived characters, not UTF-16 units', () => {
    expect(validateName('é'.normalize('NFD').repeat(24)).ok).toBe(true); // 48 code units, 24 graphemes
    expect(validateName('A'.repeat(24)).ok).toBe(true);
  });
});

// ------------------------------------------------------------------ palette
describe('palette', () => {
  it('normalises hex input', () => {
    expect(normalizeHex('#ABC')).toBe('#aabbcc');
    expect(normalizeHex('7a2836')).toBe('#7a2836');
    expect(normalizeHex('#12345')).toBeNull();
    expect(normalizeHex('red')).toBeNull();
  });
  it('builds highlight / base / shadow ramps', () => {
    const r = ramp(COLORS.white);
    expect(r.base).toBe(COLORS.white);
    expect(r.light).not.toBe(r.dark);
    expect(ramp(COLORS.black).light).not.toBe(COLORS.black);
  });
});

// ------------------------------------------------------------------ composer
describe('sprite composer', () => {
  const base = spec('male.regular.standard');

  it('produces a 48x96 sheet with transparent background and the engine outline colour', () => {
    const px = renderSheetRGBA(base);
    expect(px.length).toBe(SHEET_W * SHEET_H * 4);
    expect([...px.subarray(0, 4)]).toEqual([0, 0, 0, 0]);
    const codes = composeMaterialSheet(base);
    const outline = codes.indexOf(CODE_OUTLINE);
    expect([...px.subarray(outline * 4, outline * 4 + 4)]).toEqual(OUTLINE_RGBA);
  });

  it('every frame of every direction has a character', () => {
    const codes = composeMaterialSheet(base);
    for (let row = 0; row < 4; row++)
      for (let col = 0; col < 3; col++) {
        let solid = 0;
        for (let y = 0; y < FRAME_H; y++) for (let x = 0; x < FRAME_W; x++) if (codes[(row * FRAME_H + y) * SHEET_W + col * FRAME_W + x] !== CODE_EMPTY) solid++;
        expect(solid).toBeGreaterThan(120);
      }
  });

  it('"right" is the mirrored "left"', () => {
    const c = composeMaterialSheet(base);
    for (let y = 0; y < FRAME_H; y++)
      for (let x = 0; x < FRAME_W; x++) expect(c[(2 * FRAME_H + y) * SHEET_W + x]).toBe(c[(1 * FRAME_H + y) * SHEET_W + (FRAME_W - 1 - x)]);
  });

  it('walking frames differ from standing (animation exists)', () => {
    const c = composeMaterialSheet(base);
    const frame = (col: number) => [...Array(FRAME_H)].flatMap((_, y) => [...c.subarray(y * SHEET_W + col * FRAME_W, y * SHEET_W + col * FRAME_W + FRAME_W)]);
    expect(frame(1)).not.toEqual(frame(0));
    expect(frame(2)).not.toEqual(frame(1));
  });

  it('recolouring trousers changes only trouser pixels', () => {
    const a = renderSheetRGBA(base);
    const recoloured = { ...base, outfit: setSlotColor({ ...newDraft(W), selection: { presetId: 'x', outfit: base.outfit, customColors: true } }, 'bottom', '#ff00ff').selection.outfit };
    const b = renderSheetRGBA(recoloured);
    const codes = composeMaterialSheet(base);
    let changed = 0;
    for (let i = 0; i < codes.length; i++) {
      const same = a[i * 4] === b[i * 4] && a[i * 4 + 1] === b[i * 4 + 1] && a[i * 4 + 2] === b[i * 4 + 2] && a[i * 4 + 3] === b[i * 4 + 3];
      if (same) continue;
      changed++;
      const d = decode(codes[i]);
      expect(d && typeof d === 'object' ? d.material : d).toBe('bottom');
    }
    expect(changed).toBe(materialCount(base, 'bottom'));
    expect(changed).toBeGreaterThan(0);
  });

  it('keeps highlight and shadow shading inside a recoloured garment', () => {
    const codes = composeMaterialSheet(base);
    const shades = new Set([...codes].map(decode).filter((d) => d && typeof d === 'object' && d.material === 'top').map((d) => (d as { shade: number }).shade));
    expect(shades).toEqual(new Set([0, 1, 2]));
  });

  it('the optional headscarf is worn by default, replaces visible hair, and can be removed', () => {
    const plain = spec('female.regular.bajuKurung', false);
    const scarf = spec('female.regular.bajuKurung');
    expect(scarf.outfit.headwear?.style).toBe('headscarf');
    expect(plain.outfit.headwear).toBeNull();
    expect(materialCount(plain, 'headwear')).toBe(0);
    expect(materialCount(plain, 'hair')).toBeGreaterThan(0);
    expect(materialCount(scarf, 'headwear')).toBeGreaterThan(0);
    expect(materialCount(scarf, 'hair')).toBe(0);
  });

  it('a pinafore is drawn as an overlay with no trousers', () => {
    const s = spec('female.regular.pinafore');
    expect(materialCount(s, 'overlay')).toBeGreaterThan(0);
    expect(materialCount(s, 'bottom')).toBe(0);
    expect(materialCount(s, 'top')).toBeGreaterThan(0); // shirt visible at collar, shoulders, sleeves
  });

  it('long and short sleeves differ in visible skin', () => {
    const short = spec('male.regular.standard');
    const long = { ...short, outfit: setSleeves({ ...newDraft(W), selection: { presetId: 'x', outfit: short.outfit, customColors: false } }, 'long').selection.outfit };
    expect(materialCount(long, 'skin')).toBeLessThan(materialCount(short, 'skin'));
  });

  it('is deterministic', () => {
    expect([...renderSheetRGBA(base)]).toEqual([...renderSheetRGBA(spec('male.regular.standard'))]);
  });
});

// ------------------------------------------------------------------ school presets (match the brief)
describe('Malaysian secondary-school uniform presets', () => {
  const o = (id: string) => preset(id).outfit;
  it('male regular: white short-sleeve shirt, olive-green trousers, black shoes; sleeves selectable', () => {
    expect(o('male.regular.standard')).toMatchObject({ top: { style: 'shirt', sleeves: 'short', color: COLORS.white }, bottom: { style: 'trousers', color: COLORS.oliveGreen }, shoes: { color: COLORS.black } });
    expect(preset('male.regular.standard').sleeveOptions).toEqual(['short', 'long']);
  });
  it('male prefect A: white long-sleeve shirt, dark-blue trousers (white offered), black shoes', () => {
    expect(o('male.prefect.white')).toMatchObject({ top: { sleeves: 'long', color: COLORS.white }, bottom: { style: 'trousers', color: COLORS.darkBlue } });
    expect(preset('male.prefect.white').suggestions.bottom).toContain(COLORS.white);
  });
  it('male prefect B: blue long-sleeve shirt, black or dark-blue trousers', () => {
    expect(o('male.prefect.blue')).toMatchObject({ top: { sleeves: 'long', color: COLORS.blue }, shoes: { color: COLORS.black } });
    expect(preset('male.prefect.blue').suggestions.bottom).toEqual([COLORS.black, COLORS.darkBlue]);
  });
  it('female regular A: white baju kurung, turquoise long skirt, black shoes, optional white headscarf', () => {
    expect(o('female.regular.bajuKurung')).toMatchObject({ top: { style: 'tunic', sleeves: 'long', color: COLORS.white }, bottom: { style: 'longSkirt', color: COLORS.turquoise }, headwear: null, shoes: { color: COLORS.black } });
    expect(preset('female.regular.bajuKurung').optionalHeadwear?.color).toBe(COLORS.white);
  });
  it('female regular B: white short-sleeve shirt under a turquoise pinafore', () => {
    expect(o('female.regular.pinafore')).toMatchObject({ top: { style: 'shirt', sleeves: 'short', color: COLORS.white }, overlay: { style: 'pinafore', color: COLORS.turquoise } });
  });
  it('female prefect A: blue baju kurung, dark-blue skirt, optional matching headscarf', () => {
    expect(o('female.prefect.bajuKurung')).toMatchObject({ top: { style: 'tunic', color: COLORS.blue }, bottom: { style: 'longSkirt', color: COLORS.darkBlue } });
    expect(preset('female.prefect.bajuKurung').optionalHeadwear?.color).toBe(COLORS.blue);
  });
  it('female prefect B: white blouse, turquoise skirt, black shoes', () => {
    expect(o('female.prefect.blouse')).toMatchObject({ top: { style: 'blouse', color: COLORS.white }, bottom: { style: 'longSkirt', color: COLORS.turquoise }, shoes: { color: COLORS.black } });
  });
  it('every female preset wears the optional headscarf by default; male presets have none', () => {
    for (const p of SCHOOL_PRESETS) {
      const worn = outfitFromPreset(p).headwear;
      if (p.presentation === 'female') expect({ id: p.id, worn: worn?.style }).toEqual({ id: p.id, worn: 'headscarf' });
      else expect({ id: p.id, worn, offered: p.optionalHeadwear }).toEqual({ id: p.id, worn: null, offered: undefined });
    }
  });
  it('both categories exist for both presentations', () => {
    for (const p of ['male', 'female'] as const) for (const c of ['regular', 'prefect']) expect(SCHOOL_PRESETS.some((x) => x.presentation === p && x.categoryId === c)).toBe(true);
  });
});

// ------------------------------------------------------------------ editing
describe('wardrobe operations', () => {
  const named = (): CharacterDraft => ({ ...newDraft(W), identity: { name: 'Alex', presentation: 'male' } });

  it('changing preset, category or presentation never resets the name', () => {
    let d = named();
    d = changeCategory(W, d, 'prefect');
    expect(d.selection.presetId).toBe('male.prefect.white');
    d = changePreset(W, d, 'male.prefect.blue');
    d = changePresentation(W, d, 'female');
    expect(d.selection.presetId).toBe('female.prefect.bajuKurung'); // keeps the category
    expect(d.identity.name).toBe('Alex');
  });

  it('an unticked headscarf stays off across presets and categories', () => {
    let d = changePresentation(W, named(), 'female');
    expect(d.selection.outfit.headwear).not.toBeNull(); // ticked by default
    d = setHeadwear(W, d, false);
    d = changePreset(W, d, 'female.regular.pinafore');
    d = changeCategory(W, d, 'prefect');
    expect(d.selection.outfit.headwear).toBeNull();
  });

  it('keeps the headscarf choice across presets, using the new preset colour', () => {
    let d = changePresentation(W, named(), 'female');
    d = setHeadwear(W, d, true);
    d = changeCategory(W, d, 'prefect');
    expect(d.selection.outfit.headwear).toEqual({ style: 'headscarf', color: COLORS.blue });
  });

  it('restore preset undoes colours but keeps the headscarf choice', () => {
    let d = setHeadwear(W, changePresentation(W, named(), 'female'), true);
    d = setSlotColor(d, 'bottom', '#123456');
    d = restorePreset(W, d);
    expect(d.selection.outfit.bottom.color).toBe(COLORS.turquoise);
    expect(d.selection.outfit.headwear).not.toBeNull();
  });

  it('reset to default returns the default uniform and keeps name + presentation', () => {
    let d = changeCategory(W, changePresentation(W, named(), 'female'), 'prefect');
    d = setHeadwear(W, setSlotColor(d, 'top', '#000000'), true);
    d = resetToDefault(W, d);
    expect(d.selection.presetId).toBe('female.regular.bajuKurung');
    expect(d.selection.outfit).toEqual(outfitFromPreset(preset('female.regular.bajuKurung')));
    expect(d.selection.outfit.headwear).not.toBeNull(); // default option restored: headscarf ticked
    expect(d.identity).toEqual({ name: 'Alex', presentation: 'female' });
  });

  it('lists only the components the outfit has', () => {
    expect(customizableSlots(preset('female.regular.pinafore').outfit)).toEqual(['top', 'overlay', 'shoes']);
    expect(customizableSlots(outfitFromPreset(preset('female.regular.bajuKurung'), true))).toEqual(['top', 'bottom', 'headwear', 'shoes']);
  });
});

// ------------------------------------------------------------------ persistence
describe('character persistence (schema v1)', () => {
  const draft = changePresentation(W, { ...newDraft(W), identity: { name: 'Aisyah', presentation: 'male' } }, 'female');
  const stored = () => JSON.parse(JSON.stringify(profileFromDraft(setHeadwear(W, setSlotColor(draft, 'bottom', '#7a2836'), true), 'school', null)));

  it('round-trips a profile', () => {
    const { profile, issues } = parseProfile(stored(), WARDROBE_NORMALIZERS);
    expect(issues).toEqual([]);
    expect(profile?.creationComplete).toBe(true);
    expect(profile?.identity).toEqual({ name: 'Aisyah', presentation: 'female' });
    expect(profile?.wardrobe.school.outfit.bottom.color).toBe('#7a2836');
    expect(profile?.wardrobe.school.outfit.headwear?.style).toBe('headscarf');
  });

  it('rejects unversioned and future versions', () => {
    expect(parseProfile({ identity: {} }, WARDROBE_NORMALIZERS).profile).toBeNull();
    expect(parseProfile({ ...stored(), schemaVersion: 99 }, WARDROBE_NORMALIZERS).profile).toBeNull();
    expect(parseProfile('nope', WARDROBE_NORMALIZERS).profile).toBeNull();
  });

  it('repairs bad colours field by field instead of discarding the character', () => {
    const raw = stored();
    raw.wardrobe.school.outfit.bottom.color = 'not-a-colour';
    raw.body.skin = 42;
    const { profile } = parseProfile(raw, WARDROBE_NORMALIZERS);
    expect(profile?.wardrobe.school.outfit.bottom.color).toBe(COLORS.turquoise);
    expect(profile?.wardrobe.school.outfit.top.color).toBe(COLORS.white);
    expect(profile?.body.skin).toBe(DEFAULT_BODY.skin);
    expect(profile?.creationComplete).toBe(true);
  });

  it('an unknown or mismatched preset falls back to the default preset', () => {
    const raw = stored();
    raw.wardrobe.school.presetId = 'male.prefect.blue'; // wrong presentation
    expect(parseProfile(raw, WARDROBE_NORMALIZERS).profile?.wardrobe.school.presetId).toBe('female.regular.bajuKurung');
    expect(normalizeSelection(W, 'male', { presetId: 'gone' }).presetId).toBe('male.regular.standard');
  });

  it('garment shapes always come from the preset (stale saves cannot mix shapes)', () => {
    const raw = stored();
    raw.wardrobe.school.outfit.bottom.style = 'trousers';
    expect(parseProfile(raw, WARDROBE_NORMALIZERS).profile?.wardrobe.school.outfit.bottom.style).toBe('longSkirt');
  });

  it('an invalid name sends the player back to the creator but keeps the rest', () => {
    const raw = stored();
    raw.identity.name = '   ';
    const { profile } = parseProfile(raw, WARDROBE_NORMALIZERS);
    expect(profile?.creationComplete).toBe(false);
    expect(profile?.wardrobe.school.outfit.bottom.color).toBe('#7a2836');
  });

  it('the e2e seed fixture is a valid, complete profile', () => {
    expect(parseProfile(SEED_PROFILE, WARDROBE_NORMALIZERS).profile?.creationComplete).toBe(true);
  });
});

// ------------------------------------------------------------------ worlds use the same renderer
describe('appearance per world', () => {
  const profile = profileFromDraft({ ...newDraft(W), identity: { name: 'Alex', presentation: 'male' } }, 'school', null);
  it('school world uses the saved uniform; office reuses the composer with an office outfit', () => {
    expect(characterSpecForWorld('school', profile)?.outfit).toEqual(profile.wardrobe.school.outfit);
    const office = characterSpecForWorld('office', profile)!;
    expect(office.outfit.neckwear?.style).toBe('tie');
    expect(renderSheetRGBA(office).length).toBe(SHEET_W * SHEET_H * 4);
  });
  it('no character yet: worlds keep their default sprites', () => {
    expect(characterSpecForWorld('school', null)).toBeNull();
  });
  it('the draft spec mirrors the draft', () => {
    const d = newDraft(W);
    expect(specFromDraft(d).outfit).toBe(d.selection.outfit);
  });
});

// ------------------------------------------------------------------ boundaries
describe('character system boundary', () => {
  const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(f)) files.push(p);
    }
  };
  walk(join(ROOT, 'src', 'characters'));

  it('never imports worlds, domains or the app shell', () => {
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      expect({ f, bad: /from\s+['"][^'"]*(\/worlds\/|\/domains\/|\/app\/)/.test(src) }).toEqual({ f, bad: false });
    }
  });

  it('contains no school or office vocabulary (that lives in domains/)', () => {
    const banned = /\b(school|prefect|uniform|student|teacher|kurung|office|employee)\b/i;
    for (const f of files) {
      const code = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      expect({ f, match: code.match(banned)?.[0] ?? null }).toEqual({ f, match: null });
    }
  });
});

// ------------------------------------------------------------------ no sideways clothing sway
describe('walk animation keeps clothing horizontally fixed', () => {
  /** Columns (x) occupied by a material in one frame, as a sorted string. */
  const columns = (codes: Uint8Array, row: number, col: number, m: Material) => {
    const xs = new Set<number>();
    for (let y = 0; y < FRAME_H; y++)
      for (let x = 0; x < FRAME_W; x++) {
        const d = decode(codes[(row * FRAME_H + y) * SHEET_W + col * FRAME_W + x]);
        if (d && typeof d === 'object' && d.material === m) xs.add(x);
      }
    return [...xs].sort((a, b) => a - b).join(',');
  };

  for (const p of SCHOOL_PRESETS) {
    it(`${p.id}: shirt / skirt / pinafore occupy the same columns in every walk frame`, () => {
      for (const headwear of p.optionalHeadwear ? [true, false] : [false]) {
        const s = spec(p.id, headwear);
        const codes = composeMaterialSheet(s);
        // Trousers in side view are the stepping legs, which may move; skirts and dresses must not.
        // (With a headscarf, its drape can hide a sleeve when the arm swings up: vertical, so `top` is checked without it.)
        const garments: Material[] = [...(headwear ? [] : (['top'] as const)), 'overlay', ...(s.outfit.bottom.style === 'longSkirt' ? (['bottom'] as const) : [])];
        for (let row = 0; row < 4; row++)
          for (const m of garments) {
            const stand = columns(codes, row, 0, m);
            expect({ p: p.id, row, m, f1: columns(codes, row, 1, m), f2: columns(codes, row, 2, m) }).toEqual({ p: p.id, row, m, f1: stand, f2: stand });
          }
      }
    });
  }
});

// ------------------------------------------------------------------ skin tones
describe('skin tones', () => {
  it('offers the six requested tones, light to dark, with their shadow / blush colours', () => {
    expect(SKIN_TONES.map((t) => [t.label, t.base, t.shade])).toEqual([
      ['White', '#ffe0cc', '#f2b8a0'],
      ['Light', '#f8c9a0', '#e8a07e'],
      ['Yellow / tan', '#efc27a', '#d99a5e'],
      ['Brown', '#c68a54', '#a06a3c'],
      ['Dark brown', '#8a5530', '#6a3e22'],
      ['Black', '#4a2c1c', '#341e12'],
    ]);
    const lum = (h: string) => hexToRgb(h).reduce((a, b) => a + b, 0);
    for (let i = 1; i < SKIN_TONES.length; i++) expect(lum(SKIN_TONES[i].base)).toBeLessThan(lum(SKIN_TONES[i - 1].base));
  });

  it('recolours only skin and blush pixels (face, neck, hands, forearms), never clothes or hair', () => {
    const base = spec('male.regular.standard');
    const codes = composeMaterialSheet(base);
    const a = renderSheetRGBA(base);
    for (const tone of SKIN_TONES) {
      const draft = setSkinTone({ ...newDraft(W), selection: { presetId: 'x', outfit: base.outfit, customColors: false } }, tone.id);
      const b = renderSheetRGBA({ ...base, body: draft.body });
      const used = new Set<string>();
      for (let i = 0; i < codes.length; i++) {
        const d = decode(codes[i]);
        const mat = d && typeof d === 'object' ? d.material : d;
        const hex = '#' + [...b.subarray(i * 4, i * 4 + 3)].map((v) => v.toString(16).padStart(2, '0')).join('');
        if (mat === 'skin' || mat === 'blush') used.add(hex);
        else expect([...b.subarray(i * 4, i * 4 + 4)]).toEqual([...a.subarray(i * 4, i * 4 + 4)]);
      }
      expect(used.has(tone.base)).toBe(true);
      expect(used.has(tone.shade)).toBe(true); // blush + neck shading
    }
  });

  it('is remembered with the profile and survives reset-to-default', () => {
    const d = setSkinTone({ ...newDraft(W), identity: { name: 'Kavitha', presentation: 'female' } }, 'darkBrown');
    expect(resetToDefault(W, d).body.skin).toBe('#8a5530');
    const saved = JSON.parse(JSON.stringify(profileFromDraft(d, 'school', null)));
    expect(parseProfile(saved, WARDROBE_NORMALIZERS).profile?.body).toMatchObject({ skin: '#8a5530', skinShade: '#6a3e22' });
  });

  it('migrates schema v1 saves: the old free skin colour snaps to the nearest tone', () => {
    const { profile, issues } = parseProfile(SEED_PROFILE, WARDROBE_NORMALIZERS); // v1 fixture, skin #f1c27d
    expect(issues).toContain('migrated to schema v2');
    expect(profile?.schemaVersion).toBe(2);
    expect(profile?.body).toMatchObject({ skin: '#efc27a', skinShade: '#d99a5e' });
  });

  it('an unknown skin colour is repaired to a valid tone', () => {
    const saved = JSON.parse(JSON.stringify(profileFromDraft(newDraft(W, 'male', 'Alex'), 'school', null)));
    saved.body.skin = '#000001';
    saved.body.skinShade = 'oops';
    expect(parseProfile(saved, WARDROBE_NORMALIZERS).profile?.body).toMatchObject({ skin: '#4a2c1c', skinShade: '#341e12' });
  });
});

// ------------------------------------------------------------------ sitting frames
describe('sitting frames', () => {
  const at = (codes: Uint8Array, w: number, x: number, y: number) => codes[y * w + x];
  const material = (c: number) => {
    const d = decode(c);
    return d && typeof d === 'object' ? d.material : d;
  };

  it('one 16x24 frame per direction, right mirrors left', () => {
    const s = spec('male.regular.standard');
    expect(renderSitSheetRGBA(s).length).toBe(SIT_W * FRAME_H * 4);
    const c = composeSitMaterialSheet(s);
    for (let y = 0; y < FRAME_H; y++) for (let x = 0; x < FRAME_W; x++) expect(at(c, SIT_W, 2 * FRAME_W + x, y)).toBe(at(c, SIT_W, FRAME_W + FRAME_W - 1 - x, y));
  });

  it('the body sits lower than when standing (head starts 3 rows down)', () => {
    const s = spec('male.regular.standard');
    const firstSolidRow = (codes: Uint8Array, w: number, x0: number) => {
      for (let y = 0; y < FRAME_H; y++) for (let x = x0; x < x0 + FRAME_W; x++) if (material(at(codes, w, x, y)) === 'hair') return y;
      return -1;
    };
    const stand = firstSolidRow(composeMaterialSheet(s), SHEET_W, 0);
    const sit = firstSolidRow(composeSitMaterialSheet(s), SIT_W, 0);
    expect(sit - stand).toBe(3);
  });

  it('every preset has a seated pose in every direction, with the same garments and no floor shadow', () => {
    for (const p of SCHOOL_PRESETS)
      for (const headwear of p.optionalHeadwear ? [true, false] : [false]) {
        const s = spec(p.id, headwear);
        const c = composeSitMaterialSheet(s);
        for (let col = 0; col < 4; col++) {
          const mats = new Set<string>();
          for (let y = 0; y < FRAME_H; y++) for (let x = 0; x < FRAME_W; x++) mats.add(String(material(at(c, SIT_W, col * FRAME_W + x, y))));
          expect(mats.has('top')).toBe(true);
          expect(mats.has('shadow')).toBe(false);
        }
      }
  });

  it('recolouring trousers changes only trouser pixels in the seated frames too', () => {
    const s = spec('male.regular.standard');
    const a = renderSitSheetRGBA(s);
    const b = renderSitSheetRGBA({ ...s, outfit: { ...s.outfit, bottom: { ...s.outfit.bottom, color: '#ff00ff' } } });
    const codes = composeSitMaterialSheet(s);
    let changed = 0;
    for (let i = 0; i < codes.length; i++) {
      if (a[i * 4] === b[i * 4] && a[i * 4 + 1] === b[i * 4 + 1] && a[i * 4 + 2] === b[i * 4 + 2]) continue;
      changed++;
      expect(material(codes[i])).toBe('bottom');
    }
    expect(changed).toBeGreaterThan(0);
  });
});
