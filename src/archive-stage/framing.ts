/**
 * Camera framing, adapted from RhineLabUI `src/viewport-layout.ts`
 * (MIT, Copyright (c) 2026 LBEILC). See LICENSE-RHINE-REFERENCE.txt.
 */
export function archiveFraming(width: number, height: number, span: number, detail: number, compact: boolean) {
  const aspect = width / Math.max(1, height);
  const portrait = aspect < 1.05;
  const baseSpan = span + (5.9 - span) * detail;
  const portraitDetailSpan = Math.max(6.3 / aspect, 3.7 * height / Math.max(100, 0.54 * height - 156));
  const viewSpan = portrait
    ? Math.max(baseSpan, 8.4 / aspect + (portraitDetailSpan - 8.4 / aspect) * detail)
    : Math.max(baseSpan, baseSpan * (16 / 9) / aspect);
  return {
    span: viewSpan,
    portrait,
    previewY: portrait ? 0.36 : 0.5,
    detailX: 0.5,
    detailY: portrait ? 0.38 : compact ? 0.48 : 0.5,
  };
}
