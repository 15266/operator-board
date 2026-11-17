/** Built-in original archival portraits for 圆桌会议 seats. Not official character art. */

export interface PersonaPortraitDef {
  id: string;
  zh: string;
  en: string;
}

export const PERSONA_PORTRAITS: readonly PersonaPortraitDef[] = [
  { id: "iris", zh: "虹膜印", en: "IRIS" },
  { id: "quill", zh: "羽管印", en: "QUILL" },
  { id: "compass", zh: "罗盘印", en: "COMPASS" },
  { id: "lantern", zh: "灯火印", en: "LANTERN" },
  { id: "folio", zh: "卷宗印", en: "FOLIO" },
  { id: "anchor", zh: "沉锚印", en: "ANCHOR" },
  { id: "orbit", zh: "轨道印", en: "ORBIT" },
  { id: "key", zh: "钥齿印", en: "KEY" },
  { id: "leaf", zh: "草木印", en: "LEAF" },
  { id: "column", zh: "石柱印", en: "COLUMN" },
  { id: "wave", zh: "水纹印", en: "WAVE" },
  { id: "aster", zh: "星芒印", en: "ASTER" },
  { id: "crest", zh: "徽冠印", en: "CREST" },
] as const;

/** Default original mark for the fixed king seat. Not official character art. */
export const KING_PORTRAIT_ID = "crest";


const PORTRAIT_IDS = new Set(PERSONA_PORTRAITS.map((item) => item.id));

export function isPersonaPortraitId(value: unknown): value is string {
  return typeof value === "string" && PORTRAIT_IDS.has(value);
}

export function portraitById(id: string | null | undefined): PersonaPortraitDef | null {
  if (!id) return null;
  return PERSONA_PORTRAITS.find((item) => item.id === id) ?? null;
}

/** First grapheme of a role name, uppercased when Latin; "?" when empty. */
export function monogramFor(name: string | null | undefined): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return "?";
  const first = [...trimmed][0] ?? "?";
  return /[a-z]/i.test(first) ? first.toUpperCase() : first;
}
