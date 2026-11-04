#!/usr/bin/env node
/**
 * Generates Tiled-compatible (JSON, format 1.10) maps from readable ASCII layouts.
 * The output can be opened and edited in the Tiled editor; after hand-editing,
 * stop regenerating that map (or move its layout here) — the JSON is the source
 * the game loads.
 *
 * Layers produced per map:
 *   ground    – floor tiles (no collision)
 *   walls     – walls, wall-mounted furniture (collision via tile property)
 *   furniture – desks, chairs, plants (collision via tile property)
 *   objects   – object layer: spawn / door / npc / interactable
 *
 * Run: node scripts/generate-maps.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const tileset = JSON.parse(readFileSync(join(ROOT, 'public/assets/tileset.json'), 'utf8'));
const T = tileset.tileWidth;
const gid = (name) => {
  const t = tileset.tiles[name];
  if (!t) throw new Error(`unknown tile ${name}`);
  return t.index + 1; // firstgid = 1
};

/** char -> { layer: tileName } ; '.' uses the map's floor */
const LEGEND = {
  '#': { walls: 'wall_top' },
  '=': { walls: 'wall_face' },
  W: { walls: 'wall_window' },
  D: { ground: 'door' },
  B: { walls: 'board_L' },
  b: { walls: 'board_M' },
  n: { walls: 'board_R' },
  T: { furniture: 'teacher_desk_L' },
  t: { furniture: 'teacher_desk_R' },
  S: { furniture: 'student_desk' },
  c: { furniture: 'chair' },
  K: { walls: 'bookshelf' },
  P: { furniture: 'plant' },
  L: { walls: 'locker' },
  N: { walls: 'bulletin' },
  C: { walls: 'clock' },
  O: { furniture: 'office_desk_L' },
  o: { furniture: 'office_desk_R' },
  h: { furniture: 'office_chair' },
  V: { furniture: 'water_cooler' },
  R: { ground: 'rug' },
  m: { ground: '@mat' },
  '.': {},
};

const MATS = { floor_tile: 'doormat', floor_wood: 'doormat_wood', floor_carpet: 'doormat_carpet' };

/**
 * objects: { name, type, x, y, w?, h?, props? } in TILE units.
 *  - spawn:        point the player appears at (name referenced by doors / world definition)
 *  - door:         rectangle; props.targetRoom, props.targetSpawn
 *  - npc:          point; props.actorId (actor definition lives in the world definition)
 *  - interactable: rectangle; props.interactableId
 *  - seat:         rectangle (interaction zone); props.facing, props.sitX/sitY (px), props.prompt
 *                  Seats are added automatically for every chair 'c' (zone = desk above + chair).
 *  - prop:         runtime-textured overlay; props.propId. `px: [dx, dy, w, h]` places it at an exact
 *                  pixel rectangle inside tile (x, y) — e.g. just the glass of a window or a clock face.
 */

// Pixel rectangles (inside a 16x16 tile) of art that is redrawn at runtime. Must match generate_assets.py.
const PX = {
  windowGlass: [3, 3, 10, 7], // tile_wall_window: glass (3,3)-(12,9)
  clockFace: [3, 2, 10, 9], // tile_clock: face + rim (3,2)-(12,10)
  lightSwitch: [6, 4, 4, 6], // plate drawn on a plain wall face
};
const MAPS = [
  {
    out: 'public/maps/school/hallway.json',
    floor: 'floor_tile',
    layout: [
      '######################',
      '#==N==L=L=LDL=L=L=C=K#',
      '#....................#',
      '#....................#',
      '#P.......RRRR.......P#',
      '#........RRRR........#',
      '#....................#',
      '#K..................P#',
      '######################',
    ],
    objects: [
      { name: 'start', type: 'spawn', x: 4, y: 5 },
      { name: 'from_classroom', type: 'spawn', x: 11, y: 3 },
      { name: 'door_classroom', type: 'door', x: 11, y: 1, props: { targetRoom: 'classroom', targetSpawn: 'from_hallway' } },
      { name: 'noticeboard', type: 'interactable', x: 3, y: 1, props: { interactableId: 'hallway_noticeboard' } },
      { name: 'clock', type: 'interactable', x: 18, y: 1, props: { interactableId: 'hallway_clock' } },
      { name: 'clock_face', type: 'prop', x: 18, y: 1, px: PX.clockFace, props: { propId: 'clock' } },
      // every locker and shelf is its own object with its own dialogue (ids match src/worlds/school/hallwayItems.ts)
      ...[6, 8, 10, 12, 14, 16].map((x, i) => ({ name: `locker_${i + 1}`, type: 'interactable', x, y: 1, props: { interactableId: `hallway_locker_${i + 1}` } })),
      { name: 'returns_shelf', type: 'interactable', x: 20, y: 1, props: { interactableId: 'hallway_shelf_returns' } },
      { name: 'fiction_shelf', type: 'interactable', x: 1, y: 7, props: { interactableId: 'hallway_shelf_fiction' } },
    ],
  },
  {
    out: 'public/maps/school/classroom.json',
    floor: 'floor_wood',
    layout: [
      '################',
      '#=K=Bbbbn=W=C=W#',
      '#..............#',
      '#.....Tt.......#',
      '#..............#',
      '#..S..S..S..S..#',
      '#..c..c..c..c..#',
      '#..S..S..S..S..#',
      '#..c..c..c..c..#',
      '#P............P#',
      '#......m.......#',
      '#######D########',
    ],
    objects: [
      { name: 'from_hallway', type: 'spawn', x: 7, y: 9 },
      { name: 'door_hallway', type: 'door', x: 7, y: 11, props: { targetRoom: 'hallway', targetSpawn: 'from_classroom' } },
      { name: 'teacher', type: 'npc', x: 9, y: 3, props: { actorId: 'teacher_aisyah' } },
      { name: 'blackboard', type: 'interactable', x: 4, y: 1, w: 5, h: 1, props: { interactableId: 'classroom_blackboard' } },
      { name: 'clock', type: 'interactable', x: 12, y: 1, props: { interactableId: 'classroom_clock' } },
      { name: 'clock_face', type: 'prop', x: 12, y: 1, px: PX.clockFace, props: { propId: 'clock' } },
      { name: 'window_east', type: 'interactable', x: 10, y: 1, props: { interactableId: 'classroom_window' } },
      { name: 'window_west', type: 'interactable', x: 14, y: 1, props: { interactableId: 'classroom_window' } },
      { name: 'window_east_view', type: 'prop', x: 10, y: 1, px: PX.windowGlass, props: { propId: 'window' } },
      { name: 'window_west_view', type: 'prop', x: 14, y: 1, px: PX.windowGlass, props: { propId: 'window' } },
      { name: 'light_switch', type: 'interactable', x: 9, y: 1, props: { interactableId: 'classroom_lightswitch' } },
      { name: 'light_switch_plate', type: 'prop', x: 9, y: 1, px: PX.lightSwitch, props: { propId: 'lightswitch' } },
      { name: 'bookshelf', type: 'interactable', x: 2, y: 1, props: { interactableId: 'classroom_bookshelf' } },
      { name: 'teacher_desk', type: 'interactable', x: 6, y: 3, w: 2, h: 1, props: { interactableId: 'classroom_teacher_desk' } },
    ],
    seats: { prompt: 'Sit at the desk', facing: 'up' },
  },
  {
    out: 'public/maps/office/office.json',
    floor: 'floor_carpet',
    layout: [
      '##############',
      '#=W==W==C==WK#',
      '#............#',
      '#.Oo....Oo...#',
      '#..h.....h...#',
      '#............#',
      '#V...RRRR...P#',
      '#....RRRR....#',
      '#P..........P#',
      '##############',
    ],
    objects: [
      { name: 'start', type: 'spawn', x: 6, y: 7 },
      { name: 'employee', type: 'npc', x: 10, y: 5, props: { actorId: 'employee_farid' } },
      { name: 'computer', type: 'interactable', x: 3, y: 3, props: { interactableId: 'office_computer' } },
      { name: 'clock', type: 'interactable', x: 8, y: 1, props: { interactableId: 'office_clock' } },
      { name: 'bookshelf', type: 'interactable', x: 12, y: 1, props: { interactableId: 'office_bookshelf' } },
      { name: 'clock_face', type: 'prop', x: 8, y: 1, px: PX.clockFace, props: { propId: 'clock' } },
      ...[2, 5, 11].map((x) => ({ name: `window_${x}_view`, type: 'prop', x, y: 1, px: PX.windowGlass, props: { propId: 'window' } })),
    ],
  },
];

function buildMap(def) {
  const height = def.layout.length;
  const width = def.layout[0].length;
  for (const row of def.layout) if (row.length !== width) throw new Error(`${def.out}: ragged row "${row}"`);
  const layers = { ground: [], walls: [], furniture: [] };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ch = def.layout[y][x];
      const entry = LEGEND[ch];
      if (!entry) throw new Error(`${def.out}: unknown char '${ch}' at ${x},${y}`);
      let ground = entry.ground ?? def.floor;
      if (ground === '@mat') ground = MATS[def.floor];
      layers.ground.push(entry.walls === 'wall_top' ? 0 : gid(ground));
      layers.walls.push(entry.walls ? gid(entry.walls) : 0);
      layers.furniture.push(entry.furniture ? gid(entry.furniture) : 0);
    }
  }
  let nextObjectId = 1;
  const seatObjects = [];
  if (def.seats) {
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        if (def.layout[y][x] !== 'c') continue;
        seatObjects.push({
          name: `seat_${x}_${y}`,
          type: 'seat',
          x,
          y: y - 1, // zone covers the desk above and the chair
          w: 1,
          h: 2,
          props: { facing: def.seats.facing, prompt: def.seats.prompt, sitX: String(x * T + T / 2), sitY: String(y * T + T / 2) },
        });
      }
  }
  const objects = [...def.objects, ...seatObjects].map((o) => {
    const isPoint = o.type === 'spawn' || o.type === 'npc';
    const obj = {
      id: nextObjectId++,
      name: o.name,
      type: o.type,
      x: isPoint ? o.x * T + T / 2 : o.x * T + (o.px?.[0] ?? 0),
      y: isPoint ? o.y * T + T / 2 : o.y * T + (o.px?.[1] ?? 0),
      width: isPoint ? 0 : o.px ? o.px[2] : (o.w ?? 1) * T,
      height: isPoint ? 0 : o.px ? o.px[3] : (o.h ?? 1) * T,
      rotation: 0,
      visible: true,
    };
    if (isPoint) obj.point = true;
    if (o.props) obj.properties = Object.entries(o.props).map(([name, value]) => ({ name, type: 'string', value }));
    return obj;
  });
  const tileLayer = (id, name) => ({
    id, name, type: 'tilelayer', x: 0, y: 0, width, height, opacity: 1, visible: true, data: layers[name],
  });
  return {
    compressionlevel: -1,
    type: 'map',
    version: '1.10',
    tiledversion: '1.10.2',
    orientation: 'orthogonal',
    renderorder: 'right-down',
    infinite: false,
    width,
    height,
    tilewidth: T,
    tileheight: T,
    nextlayerid: 5,
    nextobjectid: nextObjectId,
    layers: [
      tileLayer(1, 'ground'),
      tileLayer(2, 'walls'),
      tileLayer(3, 'furniture'),
      { id: 4, name: 'objects', type: 'objectgroup', draworder: 'topdown', x: 0, y: 0, opacity: 1, visible: true, objects },
    ],
    tilesets: [
      {
        firstgid: 1,
        name: 'agentworld',
        image: '../../assets/tiles.png',
        imagewidth: tileset.imageWidth,
        imageheight: tileset.imageHeight,
        columns: tileset.columns,
        tilecount: tileset.tileCount,
        tilewidth: T,
        tileheight: T,
        margin: 0,
        spacing: 0,
        tiles: Object.values(tileset.tiles)
          .filter((t) => t.collides)
          .map((t) => ({ id: t.index, properties: [{ name: 'collides', type: 'bool', value: true }] })),
      },
    ],
  };
}

for (const def of MAPS) {
  const out = join(ROOT, def.out);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(buildMap(def), null, 1));
  console.log('wrote', def.out);
}
