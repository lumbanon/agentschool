# ADR-010 — Character creation and uniform customisation in Phase 0

**Status:** Proposed (implemented on request; awaiting the developer's acceptance)
**Amends:** ADR-009 "Risks and rules": the 30 h timebox rule listed *customisation* among the items
that wait until after G3. This ADR moves character creation into Phase 0.
**Does not amend:** the engine boundary, the honest-claims rules, or anything in the learning-engine plan.

## Context

The developer asked for a character creator before entering the school: name, gender presentation,
Malaysian secondary-school regular or prefect uniform, per-component colours, a live preview,
and the same appearance in Phaser. It must stay reusable for the Office World.

The existing character sheets (`public/assets/characters/*.png`) are not hand-painted. They are drawn
procedurally region by region by `scripts/generate_assets.py`, which bakes one fixed palette into each sheet.

## Decision

**Rendering: layered, palette-swapped region templates, composed at runtime** (`src/characters/customization/spriteComposer.ts`).

- The Python painter's geometry is ported to TypeScript. Each layer (legs or skirt, shoes, top,
  pinafore, arms, tie, head and hair, headscarf, face) paints *material + shade* indices
  (highlight / base / shadow) into one index buffer per frame, back to front.
- The outline and ground shadow are derived from the silhouette. Indices are resolved to RGBA only at the
  end, using a three-step ramp generated from each chosen colour.
- Why not a CSS filter: a filter would recolour skin, hair and outlines too. Why not pre-baked sheets:
  colour combinations explode. Why not separate PNG layers: they add an asset pipeline (Pillow is not
  installed here) and loading order, and there is still a single source of truth for shapes.
- A changed garment colour can only affect pixels of that material. Unit tests check this pixel by pixel.
- The **same pure function** feeds the React preview (canvas) and the Phaser texture. Tests compare a pixel
  signature of the preview with the texture Phaser actually holds.

**Engine changes (domain-neutral only):** `createWorldGame` accepts runtime sprite sheets by texture key.
The handle can replace a sheet live (redrawn in place, so animations survive) and set a player name label.
It can also disable keyboard input while an overlay is open. No clothing concept enters `src/engine`.

**Layering of responsibilities**

| Concern | Location |
|---|---|
| Identity (name, presentation), body, outfit types | `src/characters/types.ts` |
| Name rules (NFC, trim, 24 graphemes, Unicode letters, `a/l`, `a/p`) | `src/characters/name.ts` |
| Rendering | `src/characters/customization/spriteComposer.ts`, `palette.ts` |
| Generic catalog contract and edit operations | `src/characters/customization/wardrobe.ts` |
| Persistence (versioned, repairing) | `src/characters/persistence.ts` |
| Creator UI (generic, catalog-driven) | `src/characters/components/*` |
| School uniform presets | `src/domains/school/uniforms/presets.ts` |
| Office default outfit (reuse check, not a catalog) | `src/domains/office/outfits.ts` |

A test forbids school or office vocabulary and imports from `domains/`, `worlds/` or `app/` inside
`src/characters`, mirroring the existing engine-boundary test.

**Persistence:** `localStorage` key `agentschool.character`, schema v2 (v1 plus `body.skinShade`; the v1 to v2 migration snaps an old skin colour to the nearest tone):
`{ schemaVersion, identity, body: { skin, skinShade, hair, eyes }, wardrobe: { [wardrobeId]: { presetId, outfit, customColors } }, creationComplete, updatedAt }`.

- Unversioned or newer data is ignored, and the creator is shown.
- Bad fields are repaired from the preset field by field.
- An invalid name sends the player back to the creator with the rest pre-filled.
- A `MIGRATIONS` table is ready for v2. The same JSON can become a PostgreSQL row (identity columns + JSON wardrobe).

**Sensitive choices**

- The headscarf is optional. By the developer's decision it is ticked by default for female outfits, and the player
  unticks it to remove it. Unticking is remembered across preset changes. It is a clothing choice only.
- Presentation selects only the body and hair template. It never forces or infers clothing or beliefs.

## Consequences

- Phase 0 grows by the customisation work. This conflicts with ADR-009's timebox, and that conflict is the reason this ADR exists.
- Adding office clothing later means new `OutfitPreset`s in a catalog plus, at most, new garment painters.
  The creator, preview, persistence and engine need no changes.
- Skin tone: six fixed tones (light to dark), each with its own shadow colour, used for the neck shading and the blush.
- Walk animation: clothing never shifts sideways between frames (only the vertical bob and the feet move); a test checks this.
- Limits: no hair-colour choice in the UI yet (the schema stores it). Art is 16x24, so details such as
  prefect badges are not drawn. The supplied uniform reference image was not available in the workspace,
  so defaults follow the written brief.
