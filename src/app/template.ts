/** Replace `{key}` placeholders. Unknown keys are left as written so missing data is visible, not silent. */
export function fillTemplate(text: string, vars?: Record<string, string>): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, key: string) => (Object.hasOwn(vars, key) ? vars[key] : match));
}
