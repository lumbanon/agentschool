/** Light-touch conversion of a typed answer into TeX for the live preview (display only). */
export function answerToTex(text: string): string {
  return text
    .replace(/\\/g, '')
    .replace(/\b(or|atau)\b/gi, '\\text{ or }')
    .replace(/sqrt\(([^)]*)\)/g, '\\sqrt{$1}');
}
