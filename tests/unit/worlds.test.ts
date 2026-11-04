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

  it('detects duplicate seat ids', () => {
    const def = WORLDS.school;
    const maps = Object.fromEntries(def.rooms.map((r) => [r.id, loadMap(r.mapUrl)]));
    const broken = structuredClone(maps);
    const objects = broken.classroom.layers.find((l) => l.name === 'objects')!.objects!;
    const seats = objects.filter((o) => o.type === 'seat');
    seats[1].name = seats[0].name;
    expect(validateWorld(def, broken).join('\n')).toMatch(/duplicate seat ids/);
  });

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

describe('per-object interactions (lockers, shelves, plants)', () => {
  const school = WORLDS.school;
  const lines = (id: string) => school.interactables.find((i) => i.id === id)!.interaction.dialogue!.lines.map((l) => l.text).join(' ');
  const zones = (roomId: string) => parseMapObjects(loadMap(school.rooms.find((r) => r.id === roomId)!.mapUrl)).interactableZones;

  it('each of the six hallway lockers has its own id, zone and different dialogue', () => {
    const lockers = school.interactables.filter((i) => i.id.startsWith('hallway_locker_'));
    expect(lockers.map((l) => l.id)).toEqual([1, 2, 3, 4, 5, 6].map((n) => `hallway_locker_${n}`));
    expect(new Set(lockers.map((l) => lines(l.id))).size).toBe(6);
    const lockerZones = zones('hallway').filter((z) => z.interactableId.startsWith('hallway_locker_'));
    expect(lockerZones).toHaveLength(6);
    expect(new Set(lockerZones.map((z) => z.interactableId)).size).toBe(6);
    // left to right on the wall: locker 1 is the westmost
    expect([...lockerZones].sort((a, b) => a.x - b.x).map((z) => z.interactableId)).toEqual(lockers.map((l) => l.id));
  });

  it('every bookshelf in the school is its own object with different content', () => {
    const shelves = ['classroom_bookshelf', 'hallway_shelf_returns', 'hallway_shelf_fiction'];
    expect(new Set(shelves.map(lines)).size).toBe(shelves.length);
    for (const id of ['hallway_shelf_returns', 'hallway_shelf_fiction']) expect(zones('hallway').filter((z) => z.interactableId === id)).toHaveLength(1);
  });

  it('no two different physical lockers or shelves share an interactable id', () => {
    for (const room of ['hallway', 'classroom']) {
      const shared = new Map<string, number>();
      for (const z of zones(room)) shared.set(z.interactableId, (shared.get(z.interactableId) ?? 0) + 1);
      for (const [id, n] of shared) if (/locker|shelf/.test(id)) expect({ id, n }).toEqual({ id, n: 1 });
    }
  });

  it('plants are decorative: no plant interactable, no zone on a plant tile, no watering anywhere', () => {
    expect(school.interactables.some((i) => /plant/.test(i.id))).toBe(false);
    const plantTiles = [
      [1, 9],
      [14, 9],
    ];
    for (const [tx, ty] of plantTiles)
      expect(zones('classroom').some((z) => z.x <= tx * 16 && tx * 16 < z.x + z.width && z.y <= ty * 16 && ty * 16 < z.y + z.height)).toBe(false);
    const allText = JSON.stringify(Object.values(WORLDS));
    expect(allText).not.toMatch(/water/i);
  });

  it('every interactable zone in every map belongs to a defined interactable (no orphan indicators)', () => {
    for (const def of Object.values(WORLDS))
      for (const room of def.rooms) {
        const ids = new Set(def.interactables.filter((i) => i.roomId === room.id).map((i) => i.id));
        for (const z of parseMapObjects(loadMap(room.mapUrl)).interactableZones) expect({ room: room.id, id: z.interactableId, defined: ids.has(z.interactableId) }).toEqual({ room: room.id, id: z.interactableId, defined: true });
      }
  });
});
