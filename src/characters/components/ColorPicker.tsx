import { useEffect, useId, useState } from 'react';
import { colorLabel, normalizeHex, PALETTE } from '../customization/palette';
import type { HexColor } from '../types';

interface Props {
  slot: string;
  label: string;
  value: HexColor;
  /** Colours shown first, for this garment (first = default). */
  suggested: HexColor[];
  /** Show the free colour picker and hex input (the preset palette is always shown). */
  custom: boolean;
  onChange: (color: HexColor) => void;
}

function Swatch({ hex, selected, onPick, name }: { hex: HexColor; selected: boolean; onPick: () => void; name: string }) {
  return (
    <button
      type="button"
      className="swatch"
      style={{ background: hex }}
      aria-label={name}
      aria-pressed={selected}
      title={name}
      onClick={onPick}
      data-color={hex}
    />
  );
}

export function ColorPicker({ slot, label, value, suggested, custom, onChange }: Props) {
  const id = useId();
  const [hexDraft, setHexDraft] = useState(value);
  useEffect(() => setHexDraft(value), [value]);
  const hexValid = normalizeHex(hexDraft) !== null;

  const commitHex = (text: string) => {
    setHexDraft(text);
    const hex = normalizeHex(text);
    if (hex && hex !== value) onChange(hex);
  };

  const palette = PALETTE.filter((c) => !suggested.includes(c.hex));

  return (
    <div className="color-row" data-testid={`color-${slot}`} data-value={value}>
      <div className="color-row-head">
        <span className="color-dot" style={{ background: value }} aria-hidden="true" />
        <strong>{label}</strong>
        <span className="muted">{colorLabel(value)}</span>
      </div>
      <div className="swatches" role="group" aria-label={`${label} colours`}>
        {suggested.map((hex, i) => (
          <Swatch key={hex} hex={hex} selected={hex === value} onPick={() => onChange(hex)} name={`${colorLabel(hex)}${i === 0 ? ' (default)' : ''}`} />
        ))}
        {/* Full preset palette is always offered (suggested colours first); "custom" adds the free picker. */}
        <span className="swatch-sep" aria-hidden="true" />
        {palette.map((c) => (
          <Swatch key={c.hex} hex={c.hex} selected={c.hex === value} onPick={() => onChange(c.hex)} name={c.label} />
        ))}
      </div>
      {custom && (
        <div className="custom-color">
          <input
            type="color"
            aria-label={`${label}: pick any colour`}
            value={value}
            onChange={(e) => commitHex(e.target.value)}
            data-testid={`picker-${slot}`}
          />
          <label htmlFor={id} className="sr-only">
            {label} hex colour
          </label>
          <input
            id={id}
            className="hex-input"
            value={hexDraft}
            spellCheck={false}
            maxLength={7}
            aria-invalid={!hexValid}
            onChange={(e) => commitHex(e.target.value)}
            onBlur={() => setHexDraft(value)}
            data-testid={`hex-${slot}`}
          />
          {!hexValid && <span className="field-error">Use #rrggbb</span>}
        </div>
      )}
    </div>
  );
}
