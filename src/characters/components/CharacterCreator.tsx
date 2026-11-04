import { useEffect, useMemo, useState } from 'react';
import { specFromDraft } from '../appearance';
import {
  changeCategory,
  changePreset,
  changePresentation,
  customizableSlots,
  findPreset,
  presetsFor,
  resetToDefault,
  restorePreset,
  setCustomColors,
  setHeadwear,
  setSleeves,
  setSkinTone,
  setSlotColor,
  slotLabel,
  type WardrobeCatalog,
} from '../customization/wardrobe';
import { SKIN_TONES, skinToneOf } from '../customization/palette';
import { NAME_MAX_LENGTH, nameLength, validateName } from '../name';
import type { CharacterDraft, Presentation } from '../types';
import { CharacterPreview } from './CharacterPreview';
import { ColorPicker } from './ColorPicker';

interface Props {
  catalog: WardrobeCatalog;
  initial: CharacterDraft;
  mode: 'create' | 'edit';
  title: string;
  subtitle?: string;
  /** Label of the primary button, e.g. "Enter School". */
  enterLabel: string;
  /** Persist without leaving the creator. Return false if storage failed. */
  onSave: (draft: CharacterDraft) => boolean;
  /** Persist and leave. */
  onEnter: (draft: CharacterDraft) => void;
  /** Leave without saving (edit mode). */
  onCancel?: () => void;
}

const PRESENTATIONS: { id: Presentation; label: string }[] = [
  { id: 'male', label: 'Male' },
  { id: 'female', label: 'Female' },
];

/**
 * Generic character creator. Everything domain-specific (categories, presets,
 * garment names, suggested colours) comes from the `catalog` prop.
 */
export function CharacterCreator({ catalog, initial, mode, title, subtitle, enterLabel, onSave, onEnter, onCancel }: Props) {
  const [draft, setDraft] = useState(initial);
  const [nameInput, setNameInput] = useState(initial.identity.name);
  const [nameTouched, setNameTouched] = useState(mode === 'edit');
  const [status, setStatus] = useState<string | null>(null);

  const name = validateName(nameInput);
  const preset = findPreset(catalog, draft.selection.presetId);
  const categoryId = preset?.categoryId ?? catalog.categories[0].id;
  const category = catalog.categories.find((c) => c.id === categoryId);
  const styles = presetsFor(catalog, draft.identity.presentation, categoryId);
  const outfit = draft.selection.outfit;
  const custom = draft.selection.customColors;
  const spec = useMemo(() => specFromDraft(draft), [draft]);

  useEffect(() => setStatus(null), [draft, nameInput]);

  const update = (fn: (d: CharacterDraft) => CharacterDraft) => setDraft((d) => fn(d));
  const finalDraft = (): CharacterDraft | null => (name.ok ? { ...draft, identity: { ...draft.identity, name: name.value } } : null);

  const save = () => {
    setNameTouched(true);
    const d = finalDraft();
    if (!d) return;
    setStatus(onSave(d) ? 'Character saved.' : 'Saved for this session only (browser storage is unavailable).');
  };
  const enter = () => {
    setNameTouched(true);
    const d = finalDraft();
    if (d) onEnter(d);
  };

  const outfitLabel = [category?.label, preset?.label].filter(Boolean).join(' · ');

  return (
    <div className="creator" data-testid="character-creator" data-mode={mode}>
      <header className="creator-head">
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </header>

      <div className="creator-main">
        <section className="creator-controls" aria-label="Character options">
          <div className="identity-row">
          <div className="field identity-name">
            <label htmlFor="character-name">Character name</label>
            <div className="name-row">
              <input
                id="character-name"
                data-testid="name-input"
                value={nameInput}
                autoComplete="off"
                spellCheck={false}
                placeholder="e.g. Aisyah, Wei Ling, Arjun a/l Kumar"
                aria-invalid={nameTouched && !name.ok}
                aria-describedby="character-name-help"
                onChange={(e) => {
                  setNameInput(e.target.value);
                  setNameTouched(true);
                }}
              />
              <span className={nameLength(name.value) > NAME_MAX_LENGTH ? 'counter over' : 'counter'} data-testid="name-counter">
                {nameLength(name.value)}/{NAME_MAX_LENGTH}
              </span>
            </div>
            <p id="character-name-help" className={nameTouched && !name.ok ? 'field-error' : 'muted small'} data-testid="name-error">
              {nameTouched && !name.ok ? name.error : 'Shown above your character and used in dialogue.'}
            </p>
          </div>

          <fieldset className="field identity-skin">
            <legend>Skin tone</legend>
            <div className="skin-swatches" role="radiogroup" aria-label="Skin tone, light to dark" data-testid="skin-tones">
              {SKIN_TONES.map((t) => {
                const selected = skinToneOf(draft.body)?.id === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={t.label}
                    title={t.label}
                    className="skin-swatch"
                    style={{ background: `linear-gradient(135deg, ${t.base} 0 62%, ${t.shade} 62% 100%)` }}
                    onClick={() => update((d) => setSkinTone(d, t.id))}
                    data-testid={`skin-${t.id}`}
                  />
                );
              })}
            </div>
            <p className="muted small" data-testid="skin-label">
              {skinToneOf(draft.body)?.label ?? 'Custom'}
            </p>
          </fieldset>
          </div>

          <fieldset className="field">
            <legend>Gender presentation</legend>
            <div className="segmented">
              {PRESENTATIONS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={draft.identity.presentation === p.id}
                  onClick={() => update((d) => changePresentation(catalog, d, p.id))}
                  data-testid={`presentation-${p.id}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="field">
            <legend>{catalog.labels?.category ?? 'Category'}</legend>
            <div className="segmented">
              {catalog.categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={c.id === categoryId}
                  onClick={() => update((d) => changeCategory(catalog, d, c.id))}
                  data-testid={`category-${c.id}`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="field">
            <legend>Outfit style</legend>
            <div className="style-cards">
              {styles.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="style-card"
                  aria-pressed={p.id === draft.selection.presetId}
                  onClick={() => update((d) => changePreset(catalog, d, p.id))}
                  data-testid={`preset-${p.id}`}
                >
                  <strong>{p.label}</strong>
                  <span>{p.description}</span>
                </button>
              ))}
            </div>
          </fieldset>

          {(preset?.sleeveOptions || preset?.optionalHeadwear) && (
            <fieldset className="field">
              <legend>Outfit options</legend>
              {preset.sleeveOptions && (
                <div className="segmented small" role="group" aria-label="Sleeve length">
                  {preset.sleeveOptions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      aria-pressed={outfit.top.sleeves === s}
                      onClick={() => update((d) => setSleeves(d, s))}
                      data-testid={`sleeves-${s}`}
                    >
                      {s === 'short' ? 'Short sleeves' : 'Long sleeves'}
                    </button>
                  ))}
                </div>
              )}
              {preset.optionalHeadwear && (
                <label className="check">
                  <input
                    type="checkbox"
                    checked={outfit.headwear !== null}
                    onChange={(e) => update((d) => setHeadwear(catalog, d, e.target.checked))}
                    data-testid="headwear-toggle"
                  />
                  {preset.optionalHeadwear.label}
                </label>
              )}
            </fieldset>
          )}

          <fieldset className="field">
            <legend>Colours</legend>
            <label className="check">
              <input type="checkbox" checked={custom} onChange={(e) => update((d) => setCustomColors(d, e.target.checked))} data-testid="custom-colors-toggle" />
              Custom colour picker (any colour or hex code)
            </label>
            <div className="color-list">
              {customizableSlots(outfit).map((slot) => {
                const garment = outfit[slot];
                if (!garment) return null;
                const fallback = preset?.outfit[slot]?.color ?? preset?.optionalHeadwear?.color ?? garment.color;
                const suggested = preset?.suggestions[slot] ?? [fallback];
                return (
                  <ColorPicker
                    key={slot}
                    slot={slot}
                    label={slotLabel(slot, outfit, preset)}
                    value={garment.color}
                    suggested={suggested}
                    custom={custom}
                    onChange={(c) => update((d) => setSlotColor(d, slot, c))}
                  />
                );
              })}
            </div>
            <button type="button" className="link-button" onClick={() => update((d) => restorePreset(catalog, d))} data-testid="restore-preset">
              {catalog.labels?.restorePreset ?? 'Restore selected preset'}
            </button>
          </fieldset>
        </section>

        <aside className="creator-preview" aria-label="Preview">
          <CharacterPreview spec={spec} name={name.value} outfitLabel={outfitLabel} />
        </aside>
      </div>

      <footer className="creator-actions">
        <button type="button" onClick={() => update((d) => resetToDefault(catalog, d))} data-testid="reset-default">
          Reset to Default
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} data-testid="creator-cancel">
            Cancel
          </button>
        )}
        <span className="creator-status" role="status" data-testid="creator-status">
          {status}
        </span>
        <button type="button" onClick={save} disabled={!name.ok} data-testid="save-character">
          Save Character
        </button>
        <button type="button" className="primary" onClick={enter} disabled={!name.ok} data-testid="enter-world">
          {enterLabel}
        </button>
      </footer>
    </div>
  );
}
