#!/usr/bin/env python3
"""Generate ORIGINAL pixel-art assets for the AgentWorld engine.

Everything here is drawn procedurally by this script, so the output PNGs are
original work owned by the project (no third-party art, no licence obligations).
Run:  python3 scripts/generate_assets.py

Outputs (public/assets/):
  tiles.png            16x16 tileset (8 columns)
  tileset.json         tile name -> index + collides flag (read by the map generator)
  characters/<id>.png  16x24 frames, 3 columns (stand, stepA, stepB) x 4 rows (down, left, right, up)
  ui/indicator.png     interaction "!" bubble (8x10)
"""
from __future__ import annotations

import json
import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "assets")
T = 16  # tile size


def hexc(h: str, a: int = 255):
    h = h.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a)


class Canvas:
    def __init__(self, w: int, h: int):
        self.img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        self.w, self.h = w, h

    def px(self, x: int, y: int, c):
        if 0 <= x < self.w and 0 <= y < self.h:
            self.img.putpixel((x, y), hexc(c) if isinstance(c, str) else c)

    def rect(self, x0: int, y0: int, x1: int, y1: int, c):
        """Inclusive rectangle."""
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                self.px(x, y, c)

    def hline(self, x0, x1, y, c):
        self.rect(x0, y, x1, y, c)

    def vline(self, x, y0, y1, c):
        self.rect(x, y0, x, y1, c)


# --------------------------------------------------------------------------- palette
WOOD, WOOD_D, WOOD_L = "#b07a4a", "#8e5f36", "#c48d58"
TILE_A, TILE_B, GROUT = "#ded4bd", "#cfc3a8", "#bfb296"
CARPET, CARPET_D = "#5d6d88", "#53627b"
WALL_TOP, WALL_TOP_L = "#3b3446", "#4f4660"
WALL, WALL_SH, BASE, BASE_D = "#ece0c4", "#d6c8a8", "#7a5a3c", "#5e4430"
FRAME, FRAME_D = "#6b4f36", "#4e3a28"
GLASS, GLASS_L = "#8ec5e8", "#c9e6f7"
BOARD, BOARD_D, CHALK = "#2f5d46", "#264c39", "#e8efe9"
DARK = "#2a2230"


def tile_floor_wood(c: Canvas):
    c.rect(0, 0, 15, 15, WOOD)
    for row in (3, 7, 11, 15):
        c.hline(0, 15, row, WOOD_D)
    for (x, y0) in ((5, 0), (12, 4), (2, 8), (9, 12)):
        c.vline(x, y0, y0 + 2, WOOD_D)
    for (x, y) in ((1, 1), (8, 5), (13, 9), (4, 13)):
        c.hline(x, x + 2, y, WOOD_L)


def tile_floor_tile(c: Canvas):
    for y in range(16):
        for x in range(16):
            c.px(x, y, TILE_A if ((x // 8) + (y // 8)) % 2 == 0 else TILE_B)
    c.hline(0, 15, 15, GROUT)
    c.vline(15, 0, 15, GROUT)
    c.hline(0, 15, 7, GROUT)
    c.vline(7, 0, 15, GROUT)


def tile_carpet(c: Canvas):
    c.rect(0, 0, 15, 15, CARPET)
    for (x, y) in ((2, 3), (9, 1), (13, 7), (5, 10), (11, 13), (1, 14), (7, 6)):
        c.px(x, y, CARPET_D)
        c.px(x + 1, y, CARPET_D)


def tile_wall_top(c: Canvas):
    c.rect(0, 0, 15, 15, WALL_TOP)
    c.hline(0, 15, 0, WALL_TOP_L)
    for (x, y) in ((3, 5), (11, 10), (7, 13)):
        c.px(x, y, WALL_TOP_L)


def wall_face_base(c: Canvas):
    c.rect(0, 0, 15, 15, WALL)
    c.hline(0, 15, 0, WALL_SH)
    c.hline(0, 15, 1, WALL_SH)
    c.rect(0, 12, 15, 15, BASE)
    c.hline(0, 15, 12, BASE_D)


def tile_wall_face(c: Canvas):
    wall_face_base(c)


def tile_wall_window(c: Canvas):
    wall_face_base(c)
    c.rect(2, 2, 13, 10, FRAME)
    c.rect(3, 3, 12, 9, GLASS)
    c.vline(7, 3, 9, FRAME)
    c.vline(8, 3, 9, FRAME)
    c.hline(3, 12, 6, FRAME)
    c.px(4, 4, GLASS_L)
    c.px(5, 4, GLASS_L)
    c.px(4, 5, GLASS_L)
    c.px(10, 7, GLASS_L)
    c.hline(1, 14, 11, FRAME_D)


def tile_door(c: Canvas):
    c.rect(0, 0, 15, 15, FRAME)
    c.rect(2, 0, 13, 15, DARK)
    c.rect(2, 0, 13, 1, FRAME_D)
    for y in range(2, 16):
        shade = min(255, 40 + y * 6)
        c.hline(3, 12, y, (42, 34, 48 + y, 255) if y < 12 else (shade // 3, shade // 4, shade // 3, 255))
    c.vline(1, 0, 15, FRAME_D)
    c.vline(14, 0, 15, FRAME_D)


def board_part(c: Canvas, part: str):
    wall_face_base(c)
    x0 = 1 if part == "L" else 0
    x1 = 14 if part == "R" else 15
    c.rect(x0, 2, x1, 10, FRAME)
    c.rect(x0 + (1 if part == "L" else 0), 3, x1 - (1 if part == "R" else 0), 9, BOARD)
    c.hline(x0, x1, 11, FRAME_D)  # chalk tray
    if part == "L":
        c.hline(4, 9, 5, CHALK)
        c.hline(4, 7, 7, CHALK)
        c.px(12, 11, CHALK)
    elif part == "M":
        c.hline(1, 5, 5, CHALK)
        c.px(7, 5, CHALK); c.px(8, 4, CHALK); c.px(8, 6, CHALK); c.px(9, 5, CHALK)  # '+'
        c.hline(11, 14, 5, CHALK)
        c.hline(2, 10, 7, CHALK)
    else:
        c.hline(1, 4, 5, CHALK)
        c.px(6, 4, CHALK); c.px(6, 6, CHALK)
        c.rect(9, 10, 11, 10, "#f2d36b")  # duster
    for (x, y) in ((3, 8), (10, 4)):
        c.px(x, y, BOARD_D)


def desk_top(c: Canvas, x0, x1, y0, y1, top, edge, front):
    c.rect(x0, y0, x1, y1, top)
    c.hline(x0, x1, y0, edge)
    c.rect(x0, y1 + 1, x1, y1 + 3, front)
    c.vline(x0, y1 + 4, y1 + 5, FRAME_D)
    c.vline(x1, y1 + 4, y1 + 5, FRAME_D)


def tile_teacher_desk(c: Canvas, part: str):
    x0, x1 = (1, 15) if part == "L" else (0, 14)
    desk_top(c, x0, x1, 3, 9, "#a8703f", WOOD_L, "#7f5230")
    if part == "L":
        c.rect(4, 4, 9, 8, "#f4f1e6")  # papers
        c.hline(5, 8, 5, "#9aa6b8"); c.hline(5, 7, 7, "#9aa6b8")
    else:
        c.rect(5, 5, 8, 8, "#c9443c")  # apple
        c.px(7, 4, "#4f9a4a")
        c.rect(10, 4, 12, 8, "#3f6fb0")  # book


def tile_student_desk(c: Canvas):
    desk_top(c, 2, 13, 3, 9, "#c08a50", "#d6a46a", "#94663a")
    c.rect(5, 5, 10, 8, "#f6f3ea")
    c.vline(7, 5, 8, "#c9c2b0")


def tile_chair(c: Canvas):
    c.rect(4, 2, 11, 4, "#6e4529")  # back rest (top-down)
    c.rect(4, 5, 11, 11, "#8a5a34")
    c.hline(4, 11, 5, "#a06a3e")
    c.px(4, 12, FRAME_D); c.px(11, 12, FRAME_D)


def tile_bookshelf(c: Canvas):
    wall_face_base(c)
    c.rect(1, 1, 14, 13, FRAME)
    colors = ["#c9443c", "#3f6fb0", "#4f9a4a", "#d9a441", "#7d4f9a", "#e07a3f"]
    for shelf, y in enumerate((2, 7)):
        x = 2
        i = shelf * 2
        while x < 14:
            w = 1 + (i % 2)
            c.rect(x, y, min(13, x + w - 1), y + 3, colors[i % len(colors)])
            x += w + 0
            i += 1
        c.hline(1, 14, y + 4, FRAME_D)


def tile_plant(c: Canvas):
    leaves, leaves_d = "#4f9a4a", "#3c7d3a"
    for (x, y, r) in ((8, 6, 4), (5, 8, 3), (11, 8, 3), (8, 3, 2)):
        for yy in range(y - r, y + r + 1):
            for xx in range(x - r, x + r + 1):
                if (xx - x) ** 2 + (yy - y) ** 2 <= r * r:
                    c.px(xx, yy, leaves if (xx + yy) % 3 else leaves_d)
    c.rect(5, 11, 10, 15, "#b5653a")
    c.hline(4, 11, 11, "#c97a4a")
    c.hline(5, 10, 15, "#8f4c2a")


def tile_locker(c: Canvas):
    wall_face_base(c)
    c.rect(2, 1, 13, 14, "#6f8fa8")
    c.vline(7, 1, 14, "#56738a")
    c.vline(8, 1, 14, "#56738a")
    for y in (3, 5):
        c.hline(3, 6, y, "#56738a"); c.hline(9, 12, y, "#56738a")
    c.px(6, 9, "#e6e6e6"); c.px(9, 9, "#e6e6e6")
    c.hline(2, 13, 14, "#4b6275")


def tile_bulletin(c: Canvas):
    wall_face_base(c)
    c.rect(1, 2, 14, 10, FRAME)
    c.rect(2, 3, 13, 9, "#c49a6c")
    c.rect(3, 4, 6, 7, "#f4f1e6"); c.px(4, 4, "#c9443c")
    c.rect(8, 4, 12, 6, "#f2d36b"); c.px(10, 4, "#3f6fb0")
    c.rect(8, 7, 10, 8, "#9fd3f5")


def tile_office_desk(c: Canvas, part: str):
    x0, x1 = (1, 15) if part == "L" else (0, 14)
    desk_top(c, x0, x1, 3, 9, "#b8c0c8", "#d2d8de", "#8a939d")
    if part == "L":
        c.rect(4, 5, 8, 8, "#f4f1e6")
        c.rect(10, 5, 12, 7, "#d9a441")  # mug
    else:
        c.rect(3, 1, 12, 6, "#2b2f36")  # monitor
        c.rect(4, 2, 11, 5, "#5fb3e6")
        c.hline(5, 9, 3, "#c9e6f7")
        c.rect(7, 7, 8, 7, "#2b2f36")
        c.rect(4, 8, 11, 9, "#4a4f57")  # keyboard


def tile_office_chair(c: Canvas):
    c.rect(4, 2, 11, 4, "#2b2f36")
    c.rect(4, 5, 11, 11, "#34383f")
    c.hline(4, 11, 5, "#4a4f57")
    c.px(3, 12, "#2b2f36"); c.px(12, 12, "#2b2f36"); c.px(7, 13, "#2b2f36")


def tile_water_cooler(c: Canvas):
    c.rect(5, 0, 10, 5, "#9fd3f5")
    c.hline(5, 10, 0, "#c9e6f7")
    c.rect(4, 6, 11, 15, "#eef1f4")
    c.rect(6, 8, 7, 9, "#3f6fb0"); c.rect(8, 8, 9, 9, "#c9443c")
    c.hline(4, 11, 15, "#b8c0c8")


def tile_rug(c: Canvas):
    c.rect(0, 0, 15, 15, "#a8453f")
    for i in range(0, 16, 4):
        c.px(i + 1, 1, "#d9a441"); c.px(i + 1, 14, "#d9a441")
    c.rect(5, 5, 10, 10, "#b9564f")
    c.rect(7, 7, 8, 8, "#d9a441")


def tile_doormat(c: Canvas):
    tile_floor_tile(c)
    c.rect(1, 3, 14, 12, "#6b5a45")
    for y in range(4, 12, 2):
        c.hline(2, 13, y, "#7e6b53")


def tile_clock(c: Canvas):
    wall_face_base(c)
    for y in range(2, 11):
        for x in range(3, 13):
            d = (x - 7.5) ** 2 + (y - 6) ** 2
            if d <= 16:
                c.px(x, y, "#f7f5ef")
            elif d <= 22:
                c.px(x, y, FRAME_D)
    c.vline(7, 3, 6, DARK)
    c.hline(8, 10, 6, DARK)


def tile_floor_wood_mat(c: Canvas):
    tile_floor_wood(c)
    c.rect(1, 3, 14, 12, "#6b5a45")
    for y in range(4, 12, 2):
        c.hline(2, 13, y, "#7e6b53")


def tile_floor_carpet_mat(c: Canvas):
    tile_carpet(c)
    c.rect(1, 3, 14, 12, "#3d4657")
    for y in range(4, 12, 2):
        c.hline(2, 13, y, "#4a5468")


TILES = [
    # (name, drawer, collides)
    ("floor_wood", tile_floor_wood, False),
    ("floor_tile", tile_floor_tile, False),
    ("floor_carpet", tile_carpet, False),
    ("wall_top", tile_wall_top, True),
    ("wall_face", tile_wall_face, True),
    ("wall_window", tile_wall_window, True),
    ("door", tile_door, False),
    ("board_L", lambda c: board_part(c, "L"), True),
    ("board_M", lambda c: board_part(c, "M"), True),
    ("board_R", lambda c: board_part(c, "R"), True),
    ("teacher_desk_L", lambda c: tile_teacher_desk(c, "L"), True),
    ("teacher_desk_R", lambda c: tile_teacher_desk(c, "R"), True),
    ("student_desk", tile_student_desk, True),
    ("chair", tile_chair, False),
    ("bookshelf", tile_bookshelf, True),
    ("plant", tile_plant, True),
    ("locker", tile_locker, True),
    ("bulletin", tile_bulletin, True),
    ("office_desk_L", lambda c: tile_office_desk(c, "L"), True),
    ("office_desk_R", lambda c: tile_office_desk(c, "R"), True),
    ("office_chair", tile_office_chair, False),
    ("water_cooler", tile_water_cooler, True),
    ("rug", tile_rug, False),
    ("doormat", tile_doormat, False),
    ("clock", tile_clock, True),
    ("doormat_wood", tile_floor_wood_mat, False),
    ("doormat_carpet", tile_floor_carpet_mat, False),
]


def build_tileset():
    cols = 8
    rows = (len(TILES) + cols - 1) // cols
    sheet = Image.new("RGBA", (cols * T, rows * T), (0, 0, 0, 0))
    meta = {"tileWidth": T, "tileHeight": T, "columns": cols, "tileCount": len(TILES),
            "imageWidth": cols * T, "imageHeight": rows * T, "tiles": {}}
    for i, (name, draw, collides) in enumerate(TILES):
        c = Canvas(T, T)
        draw(c)
        sheet.paste(c.img, ((i % cols) * T, (i // cols) * T))
        meta["tiles"][name] = {"index": i, "collides": collides}
    os.makedirs(OUT, exist_ok=True)
    sheet.save(os.path.join(OUT, "tiles.png"))
    with open(os.path.join(OUT, "tileset.json"), "w") as f:
        json.dump(meta, f, indent=2)


# --------------------------------------------------------------------------- characters
CW, CH = 16, 24
OUTLINE = (34, 26, 40, 255)


def outline_pass(c: Canvas):
    src = c.img.copy()
    for y in range(c.h):
        for x in range(c.w):
            if src.getpixel((x, y))[3] != 0:
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < c.w and 0 <= ny < c.h and src.getpixel((nx, ny))[3] == 255:
                    c.img.putpixel((x, y), OUTLINE)
                    break


def draw_character(p: dict, direction: str, frame: int) -> Image.Image:
    """p: palette dict. direction in down/left/up (right = mirrored left). frame 0 stand, 1/2 steps."""
    c = Canvas(CW, CH)
    skin, hair, shirt, shirt_d, pants, shoes = p["skin"], p["hair"], p["shirt"], p["shirt_d"], p["pants"], p["shoes"]
    scarf = p.get("scarf")
    bob = 1 if frame in (1, 2) else 0  # slight bob while walking
    oy = -bob + 1

    # legs / feet (drawn first)
    if direction in ("down", "up"):
        lshift = {0: (0, 0), 1: (-1, 0), 2: (0, -1)}[frame]
        c.rect(5, 18 + oy + lshift[0], 7, 21 + oy, pants)
        c.rect(8, 18 + oy + lshift[1], 10, 21 + oy, pants)
        c.rect(5, 22 + oy + lshift[0], 7, 22 + oy + lshift[0], shoes)
        c.rect(8, 22 + oy + lshift[1], 10, 22 + oy + lshift[1], shoes)
    else:
        if frame == 0:
            c.rect(6, 18 + oy, 9, 21 + oy, pants)
            c.rect(5, 22 + oy, 9, 22 + oy, shoes)
        else:
            front, back = ((3, 6), (9, 11)) if frame == 1 else ((5, 8), (7, 10))
            c.rect(back[0], 18 + oy, back[1], 21 + oy, p["pants_d"])
            c.rect(back[0], 22 + oy, back[1], 22 + oy, shoes)
            c.rect(front[0], 18 + oy, front[1], 21 + oy, pants)
            c.rect(front[0] - 1, 22 + oy, front[1], 22 + oy, shoes)

    # torso
    if direction in ("down", "up"):
        c.rect(4, 11 + oy, 11, 17 + oy, shirt)
        c.hline(4, 11, 17 + oy, shirt_d)
        arm_dy = {0: (0, 0), 1: (1, -1), 2: (-1, 1)}[frame]
        c.rect(3, 12 + oy + arm_dy[0], 3, 15 + oy + arm_dy[0], shirt_d)
        c.rect(12, 12 + oy + arm_dy[1], 12, 15 + oy + arm_dy[1], shirt_d)
        c.px(3, 16 + oy + arm_dy[0], skin)
        c.px(12, 16 + oy + arm_dy[1], skin)
        if direction == "down" and p.get("tie"):
            c.vline(7, 11 + oy, 15 + oy, p["tie"])
            c.vline(8, 11 + oy, 15 + oy, p["tie"])
        if direction == "down" and p.get("collar"):
            c.px(6, 11 + oy, p["collar"]); c.px(9, 11 + oy, p["collar"])
    else:
        c.rect(5, 11 + oy, 10, 17 + oy, shirt)
        c.hline(5, 10, 17 + oy, shirt_d)
        swing = {0: 0, 1: -1, 2: 1}[frame]
        c.rect(7 + swing, 12 + oy, 8 + swing, 15 + oy, shirt_d)
        c.rect(7 + swing, 16 + oy, 8 + swing, 16 + oy, skin)

    # head
    if scarf:
        sc, sc_d = scarf
        if direction == "down":
            c.rect(3, 1 + oy, 12, 12 + oy, sc)
            c.rect(5, 4 + oy, 10, 9 + oy, skin)
            c.hline(6, 9, 10 + oy, skin)
            c.hline(3, 12, 12 + oy, sc_d)
        elif direction == "up":
            c.rect(3, 1 + oy, 12, 13 + oy, sc)
            c.vline(7, 3 + oy, 12 + oy, sc_d)
        else:
            c.rect(4, 1 + oy, 11, 12 + oy, sc)
            c.rect(4, 4 + oy, 7, 9 + oy, skin)
            c.rect(10, 9 + oy, 12, 13 + oy, sc)
            c.hline(4, 11, 12 + oy, sc_d)
    else:
        if direction == "down":
            c.rect(4, 3 + oy, 11, 10 + oy, skin)
            c.rect(3, 1 + oy, 12, 4 + oy, hair)
            c.rect(3, 5 + oy, 3, 7 + oy, hair)
            c.rect(12, 5 + oy, 12, 7 + oy, hair)
            c.px(5, 5 + oy, hair)
            c.px(10, 5 + oy, hair)
        elif direction == "up":
            c.rect(4, 3 + oy, 11, 10 + oy, skin)
            c.rect(3, 1 + oy, 12, 9 + oy, hair)
            c.hline(6, 9, 10 + oy, skin)
        else:
            c.rect(4, 3 + oy, 11, 10 + oy, skin)
            c.rect(4, 1 + oy, 11, 4 + oy, hair)
            c.rect(8, 5 + oy, 11, 8 + oy, hair)
            c.px(4, 5 + oy, hair)

    # face details
    eye = p["eye"]
    if direction == "down":
        c.px(6, 7 + oy, eye); c.px(9, 7 + oy, eye)
        c.px(6, 6 + oy, eye); c.px(9, 6 + oy, eye)
        if p.get("blush"):
            c.px(5, 8 + oy, p["blush"]); c.px(10, 8 + oy, p["blush"])
    elif direction == "left":
        c.px(5, 6 + oy, eye); c.px(5, 7 + oy, eye)
        c.px(3 if not scarf else 3, 7 + oy, skin)  # nose

    outline_pass(c)
    # soft shadow (after outline so it is not outlined)
    for x in range(4, 12):
        if c.img.getpixel((x, 23))[3] == 0:
            c.img.putpixel((x, 23), (0, 0, 0, 70))
    return c.img


CHARACTERS = {
    "student": dict(skin="#f1c27d", hair="#1f1a22", shirt="#f4f4f4", shirt_d="#cfd3d8", pants="#2f4a6b",
                    pants_d="#24394f", shoes="#2a2230", eye="#1f1a22", tie="#2f4a6b", blush="#e9a07a"),
    "teacher": dict(skin="#e0ac7e", hair="#1f1a22", shirt="#4f8a8b", shirt_d="#3d6d6e", pants="#3d6d6e",
                    pants_d="#2f5556", shoes="#5e4430", eye="#1f1a22", scarf=("#8a4f7d", "#6e3d63"), blush="#d98b72"),
    "manager": dict(skin="#d9a066", hair="#5a3a22", shirt="#9fc3e6", shirt_d="#7ea4c8", pants="#3a3f47",
                    pants_d="#2b2f36", shoes="#1f1a22", eye="#1f1a22", tie="#c9443c"),
    "employee": dict(skin="#c68a5a", hair="#2e2018", shirt="#e07a3f", shirt_d="#b96231", pants="#b8a27a",
                     pants_d="#9a8662", shoes="#3a2a20", eye="#1f1a22", collar="#f4f4f4"),
}


def build_characters():
    d = os.path.join(OUT, "characters")
    os.makedirs(d, exist_ok=True)
    for cid, pal in CHARACTERS.items():
        sheet = Image.new("RGBA", (CW * 3, CH * 4), (0, 0, 0, 0))
        for row, direction in enumerate(("down", "left", "right", "up")):
            for frame in range(3):
                src = "left" if direction == "right" else direction
                img = draw_character(pal, src, frame)
                if direction == "right":
                    img = img.transpose(Image.FLIP_LEFT_RIGHT)
                sheet.paste(img, (frame * CW, row * CH))
        sheet.save(os.path.join(d, f"{cid}.png"))


def build_ui():
    d = os.path.join(OUT, "ui")
    os.makedirs(d, exist_ok=True)
    c = Canvas(9, 11)
    c.rect(1, 0, 7, 7, "#fff6d5")
    c.rect(0, 1, 8, 6, "#fff6d5")
    c.rect(3, 8, 5, 8, "#fff6d5")
    c.px(4, 9, "#fff6d5")
    c.rect(4, 1, 4, 4, "#c9443c")
    c.px(4, 6, "#c9443c")
    outline_pass(c)
    c.img.save(os.path.join(d, "indicator.png"))


def build_preview():
    """Contact sheet for humans (docs/ASSETS.md) — not loaded by the game."""
    tiles = Image.open(os.path.join(OUT, "tiles.png"))
    chars = [Image.open(os.path.join(OUT, "characters", f"{k}.png")) for k in CHARACTERS]
    w = max(tiles.width, sum(ch.width for ch in chars) + 8 * len(chars))
    h = tiles.height + 8 + max(ch.height for ch in chars)
    prev = Image.new("RGBA", (w, h), (40, 36, 52, 255))
    prev.paste(tiles, (0, 0), tiles)
    x = 0
    for ch in chars:
        prev.paste(ch, (x, tiles.height + 8), ch)
        x += ch.width + 8
    prev = prev.resize((w * 4, h * 4), Image.NEAREST)
    os.makedirs(os.path.join(ROOT, "docs"), exist_ok=True)
    prev.save(os.path.join(ROOT, "docs", "asset-preview.png"))


if __name__ == "__main__":
    build_tileset()
    build_characters()
    build_ui()
    build_preview()
    print("assets written to", OUT)
