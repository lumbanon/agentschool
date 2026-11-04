import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMapObjects, validateWorld, type TiledMap } from '../../src/engine/core/tiled';
import { WORLDS } from '../../src/worlds/registry';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const loadMap = (url: string): TiledMap => JSON.parse(readFileSync(join(ROOT, 'public', url), 'utf8'));

describe('world definitions', () => {
  for (const def of Object.values(WORLDS)) {
    it(`${def.id}: validates against its Tiled maps`, () => {
      const maps = Object.fromEntries(def.rooms.map((r) => [r.id, loadMap(r.mapUrl)]));
      expect(validateWorld(def, maps)).toEqual([]);
    });
  }

  it('detects a broken door target', () => {
    const def = WORLDS.school;
    const maps = Object.fromEntries(def.rooms.map((r) => [r.id, loadMap(r.mapUrl)]));
    const broken = structuredClone(maps);
    const objects = broken.hallway.layers.find((l) => l.name === 'objects')!.objects!;
    objects.find((o) => o.type === 'door')!.properties![1].value = 'no_such_spawn';
    expect(validateWorld(def, broken).join('\n')).toMatch(/missing spawn 'no_such_spawn'/);
  });

  it('every dialogue is explicitly labelled with its source', () => {
    for (const def of Object.values(WORLDS)) {
      const dialogues = [...def.actors.map((a) => a.interaction?.dialogue), ...def.interactables.map((i) => i.interaction.dialogue)].filter(Boolean);
      for (const d of dialogues) expect(d!.source).toBe('prototype_script');
    }
  });

  it('collision tiles are flagged in the embedded Tiled tileset', () => {
    const map = loadMap('maps/school/classroom.json') as TiledMap & { tilesets: { tiles?: unknown[] }[] };
    expect((map.tilesets[0].tiles ?? []).length).toBeGreaterThan(5);
    const objs = parseMapObjects(map);
    expect(objs.doors).toHaveLength(1);
    expect(objs.npcPoints.teacher_aisyah).toBeDefined();
  });
});

describe('engine boundary', () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(f)) files.push(p);
    }
  };
  walk(join(ROOT, 'src', 'engine'));

  it('engine never imports worlds or domains', () => {
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      expect({ f, bad: /from\s+['"][^'"]*(\/worlds\/|\/domains\/)/.test(src) }).toEqual({ f, bad: false });
    }
  });

  it('engine code contains no school/office domain vocabulary', () => {
    const banned = /\b(lesson|teacher|student|school|exercise|office|employee|task|grade|maths)\b/i;
    for (const f of files) {
      const code = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''); // ignore comments
      expect({ f, match: code.match(banned)?.[0] ?? null }).toEqual({ f, match: null });
    }
  });
});
