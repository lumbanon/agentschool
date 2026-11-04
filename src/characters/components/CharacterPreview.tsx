import { useEffect, useMemo, useRef, useState } from 'react';
import { pixelSignature } from '../../engine/core/pixels';
import { FRAME_H, FRAME_W, frameRGBA, renderSheetRGBA, type SheetDirection } from '../customization/spriteComposer';
import type { RenderSpec } from '../types';

/** Clockwise as seen from above: front, left, back, right. */
const ROTATION: SheetDirection[] = ['down', 'left', 'up', 'right'];
const DIRECTION_LABEL: Record<SheetDirection, string> = { down: 'Front', left: 'Left', up: 'Back', right: 'Right' };
/** Same cycle and rate as the in-game walk animation. */
const WALK = [1, 0, 2, 0];
const WALK_MS = 125;

function FrameCanvas({ sheet, dir, frame, className, label }: { sheet: Uint8ClampedArray; dir: SheetDirection; frame: number; className: string; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (ctx) ctx.putImageData(new ImageData(frameRGBA(sheet, dir, frame), FRAME_W, FRAME_H), 0, 0);
  }, [sheet, dir, frame]);
  return <canvas ref={ref} width={FRAME_W} height={FRAME_H} className={className} role="img" aria-label={label} data-direction={dir} />;
}

interface Props {
  spec: RenderSpec;
  name: string;
  outfitLabel: string;
}

/**
 * Live pixel-art preview. Uses exactly the same composer output that is
 * handed to Phaser, so what you see here is what walks around in the world.
 */
export function CharacterPreview({ spec, name, outfitLabel }: Props) {
  const sheet = useMemo(() => renderSheetRGBA(spec), [spec]);
  const signature = useMemo(() => pixelSignature(sheet), [sheet]);
  const [dirIndex, setDirIndex] = useState(0);
  const [walking, setWalking] = useState(true);
  const [tick, setTick] = useState(0);
  const dir = ROTATION[dirIndex];

  useEffect(() => {
    if (!walking) return;
    const t = window.setInterval(() => setTick((n) => n + 1), WALK_MS);
    return () => window.clearInterval(t);
  }, [walking]);
  const frame = walking ? WALK[tick % WALK.length] : 0;
  const rotate = (step: number) => setDirIndex((i) => (i + step + ROTATION.length) % ROTATION.length);

  return (
    <div className="preview" data-testid="character-preview" data-sheet-signature={signature} data-direction={dir}>
      <div className="preview-stage">
        <div className="preview-name" data-testid="preview-name">
          {name || 'Your name'}
        </div>
        <FrameCanvas sheet={sheet} dir={dir} frame={frame} className="preview-big" label={`Character preview, facing ${DIRECTION_LABEL[dir].toLowerCase()}`} />
        <div className="preview-floor" aria-hidden="true" />
      </div>
      <div className="preview-controls">
        <button type="button" onClick={() => rotate(-1)} aria-label="Rotate left" data-testid="rotate-left">
          ⟲
        </button>
        <span className="preview-facing" data-testid="preview-facing">
          {DIRECTION_LABEL[dir]}
        </span>
        <button type="button" onClick={() => rotate(1)} aria-label="Rotate right" data-testid="rotate-right">
          ⟳
        </button>
        <button type="button" className="toggle" aria-pressed={walking} onClick={() => setWalking((w) => !w)} data-testid="toggle-walk">
          {walking ? 'Walking' : 'Idle'}
        </button>
      </div>
      <div className="preview-turnaround" aria-label="All directions">
        {ROTATION.map((d, i) => (
          <button key={d} type="button" className="mini" aria-pressed={i === dirIndex} onClick={() => setDirIndex(i)} title={DIRECTION_LABEL[d]}>
            <FrameCanvas sheet={sheet} dir={d} frame={frame} className="preview-mini" label={DIRECTION_LABEL[d]} />
          </button>
        ))}
      </div>
      <p className="preview-outfit" data-testid="preview-outfit">
        {outfitLabel}
      </p>
    </div>
  );
}
