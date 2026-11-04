// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CharacterCreator } from '../../src/characters/components/CharacterCreator';
import { COLORS } from '../../src/characters/customization/palette';
import { newDraft } from '../../src/characters/customization/wardrobe';
import type { CharacterDraft } from '../../src/characters/types';
import { SCHOOL_WARDROBE } from '../../src/domains/school/uniforms/presets';

beforeAll(() => {
  // jsdom has no 2D canvas; the preview simply skips drawing (pixels are covered by unit tests).
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
  if (!('ImageData' in globalThis)) (globalThis as Record<string, unknown>).ImageData = class {};
});
afterEach(cleanup);

function setup(initial: CharacterDraft = newDraft(SCHOOL_WARDROBE), mode: 'create' | 'edit' = 'create') {
  const onSave = vi.fn(() => true);
  const onEnter = vi.fn();
  render(
    <CharacterCreator catalog={SCHOOL_WARDROBE} initial={initial} mode={mode} title="Create your student" enterLabel="Enter School" onSave={onSave} onEnter={onEnter} />,
  );
  const signature = () => screen.getByTestId('character-preview').getAttribute('data-sheet-signature');
  return { onSave, onEnter, signature };
}

describe('CharacterCreator', () => {
  it('requires a valid name before entering', () => {
    const { onEnter } = setup();
    const enter = screen.getByTestId('enter-world') as HTMLButtonElement;
    expect(enter.disabled).toBe(true);
    fireEvent.change(screen.getByTestId('name-input'), { target: { value: '   ' } });
    expect(screen.getByTestId('name-error').textContent).toMatch(/enter a name/);
    fireEvent.change(screen.getByTestId('name-input'), { target: { value: 'x'.repeat(25) } });
    expect(screen.getByTestId('name-error').textContent).toMatch(/at most 24/);
    expect(screen.getByTestId('name-counter').textContent).toBe('25/24');
    fireEvent.change(screen.getByTestId('name-input'), { target: { value: '  Nur Aisyah  ' } });
    expect(enter.disabled).toBe(false);
    fireEvent.click(enter);
    expect(onEnter).toHaveBeenCalledTimes(1);
    expect(onEnter.mock.calls[0][0].identity.name).toBe('Nur Aisyah');
  });

  it('shows the male regular default, and female styles after switching', () => {
    setup();
    expect(screen.getByTestId('preset-male.regular.standard').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('sleeves-short').getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByTestId('headwear-toggle')).toBeNull();
    fireEvent.click(screen.getByTestId('presentation-female'));
    expect(screen.getByTestId('preset-female.regular.bajuKurung').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('preset-female.regular.pinafore')).toBeTruthy();
    expect((screen.getByTestId('headwear-toggle') as HTMLInputElement).checked).toBe(true); // ticked by default
    fireEvent.click(screen.getByTestId('category-prefect'));
    expect(screen.getByTestId('preset-female.prefect.bajuKurung')).toBeTruthy();
    expect(screen.getByTestId('preset-female.prefect.blouse')).toBeTruthy();
    expect(screen.getByTestId('preview-outfit').textContent).toBe('School Prefect · Style A — Prefect Baju Kurung');
  });

  it('the headscarf is ticked by default with its own colour control; unticking removes it', () => {
    setup();
    fireEvent.click(screen.getByTestId('presentation-female'));
    expect(screen.getByTestId('color-headwear').getAttribute('data-value')).toBe(COLORS.white);
    fireEvent.click(screen.getByTestId('headwear-toggle'));
    expect((screen.getByTestId('headwear-toggle') as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByTestId('color-headwear')).toBeNull();
  });

  it('skin tone swatches sit beside the name and recolour the preview', () => {
    const { signature } = setup();
    const swatches = screen.getByTestId('skin-tones').querySelectorAll('[role="radio"]');
    expect(Array.from(swatches).map((s) => s.getAttribute('aria-label'))).toEqual(['White', 'Light', 'Yellow / tan', 'Brown', 'Dark brown', 'Black']);
    expect(screen.getByTestId('skin-tan').getAttribute('aria-checked')).toBe('true');
    const before = signature();
    fireEvent.click(screen.getByTestId('skin-black'));
    expect(screen.getByTestId('skin-black').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('skin-label').textContent).toBe('Black');
    expect(signature()).not.toBe(before);
  });

  it('the full preset palette, including black, is offered for every garment without extra steps', () => {
    setup();
    fireEvent.click(screen.getByTestId('presentation-female'));
    for (const slot of ['top', 'bottom', 'headwear', 'shoes']) {
      const row = screen.getByTestId(`color-${slot}`);
      expect(row.querySelector(`[data-color="${COLORS.black}"]`)).not.toBeNull();
    }
    fireEvent.click(screen.getByTestId('color-top').querySelector(`[data-color="${COLORS.black}"]`)!);
    expect(screen.getByTestId('color-top').getAttribute('data-value')).toBe(COLORS.black);
  });

  it('hex input: typing a six-digit colour one key at a time is not cut short by shorthand (PR review regression)', () => {
    setup();
    fireEvent.click(screen.getByTestId('custom-colors-toggle'));
    const input = screen.getByTestId('hex-bottom') as HTMLInputElement;
    const row = () => screen.getByTestId('color-bottom').getAttribute('data-value');
    const before = row();
    let typed = '';
    for (const ch of '#123456') {
      typed += ch;
      fireEvent.change(input, { target: { value: typed } });
      expect(input.value).toBe(typed); // the draft is never rewritten mid-typing
      if (typed.length < 7) expect(row()).toBe(before); // nothing applied until complete (not '#112233' at '#123')
    }
    expect(row()).toBe('#123456');
  });

  it('hex input: shorthand is accepted on blur / Enter; invalid text reverts on blur', () => {
    setup();
    fireEvent.click(screen.getByTestId('custom-colors-toggle'));
    const input = screen.getByTestId('hex-bottom') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '#abc' } });
    expect(screen.getByTestId('color-bottom').getAttribute('data-value')).toBe(COLORS.oliveGreen);
    fireEvent.blur(input);
    expect(screen.getByTestId('color-bottom').getAttribute('data-value')).toBe('#aabbcc');
    fireEvent.change(input, { target: { value: '#123' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByTestId('color-bottom').getAttribute('data-value')).toBe('#112233');
    fireEvent.change(input, { target: { value: '#12' } });
    fireEvent.blur(input);
    expect(input.value).toBe('#112233');
    expect(screen.getByTestId('color-bottom').getAttribute('data-value')).toBe('#112233');
  });

  it('suggested swatches, then full palette + hex input once custom colours are on; preview updates', () => {
    const { signature } = setup();
    const before = signature();
    expect(screen.queryByTestId('hex-bottom')).toBeNull();
    fireEvent.click(screen.getByTestId('custom-colors-toggle'));
    fireEvent.change(screen.getByTestId('hex-bottom'), { target: { value: '#7A2836' } });
    expect(screen.getByTestId('color-bottom').getAttribute('data-value')).toBe('#7a2836');
    expect(signature()).not.toBe(before);
    // invalid hex is flagged and not applied
    fireEvent.change(screen.getByTestId('hex-shoes'), { target: { value: '#zz' } });
    expect(screen.getByTestId('color-shoes').getAttribute('data-value')).toBe(COLORS.black);
    // palette swatch
    fireEvent.click(screen.getByTestId('color-top').querySelector(`[data-color="${COLORS.lightBlue}"]`)!);
    expect(screen.getByTestId('color-top').getAttribute('data-value')).toBe(COLORS.lightBlue);
  });

  it('restore preset and reset to default keep the name', () => {
    setup();
    fireEvent.change(screen.getByTestId('name-input'), { target: { value: 'Alex' } });
    fireEvent.click(screen.getByTestId('custom-colors-toggle'));
    fireEvent.change(screen.getByTestId('hex-bottom'), { target: { value: '#123456' } });
    fireEvent.click(screen.getByTestId('restore-preset'));
    expect(screen.getByTestId('color-bottom').getAttribute('data-value')).toBe(COLORS.oliveGreen);
    fireEvent.click(screen.getByTestId('category-prefect'));
    fireEvent.click(screen.getByTestId('reset-default'));
    expect(screen.getByTestId('preset-male.regular.standard').getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByTestId('name-input') as HTMLInputElement).value).toBe('Alex');
  });

  it('rotates the preview through four directions', () => {
    setup();
    const facing = () => screen.getByTestId('preview-facing').textContent;
    expect(facing()).toBe('Front');
    fireEvent.click(screen.getByTestId('rotate-right'));
    expect(facing()).toBe('Left');
    fireEvent.click(screen.getByTestId('rotate-right'));
    fireEvent.click(screen.getByTestId('rotate-right'));
    expect(facing()).toBe('Right');
    fireEvent.click(screen.getByTestId('rotate-left'));
    expect(facing()).toBe('Back');
  });

  it('Save Character persists without leaving and reports the result', () => {
    const { onSave, onEnter } = setup();
    fireEvent.change(screen.getByTestId('name-input'), { target: { value: 'Alex' } });
    fireEvent.click(screen.getByTestId('save-character'));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onEnter).not.toHaveBeenCalled();
    expect(screen.getByTestId('creator-status').textContent).toBe('Character saved.');
  });
});
