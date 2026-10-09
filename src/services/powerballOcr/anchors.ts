/**
 * Layer 3: fuzzy text anchors + family-based layout (normalized coords).
 */
import type { NormRect, PbAnchorHints, PbTemplateFamily } from './types';

export function collectAnchorHintsFromText(text: string): PbAnchorHints {
  const qpTokenCount = (text.match(/\bQP\b/gi) ?? []).length;
  const barcodeLike = /\b\d{12,}\b/.test(text.replace(/\s/g, '')) || /\b\d{4}-\d{4}-\d{4}\b/.test(text);
  return {
    hasPowerballWord: /\bpower\s*ball\b/i.test(text),
    hasPowerPlay: /\bpower\s*play\b|powerplay/i.test(text),
    qpTokenCount,
    barcodeLike,
  };
}

/** Row / main / PB zones in 0–1 space relative to grid image. */
export function layoutZonesForFamily(
  family: PbTemplateFamily,
  hints: PbAnchorHints,
  /** When set with `ca_wa`, tightens vertical play band for printed CA/WA slips (less header/footer). */
  jurisdictionCode?: string,
): { rowZone: NormRect; mainZone: NormRect; pbZone: NormRect } {
  let mainX0 = 0.02;
  const mainX1 = 0.72;
  let pbX0 = 0.74;
  const pbX1 = 0.98;

  if (family === 'tx') {
    pbX0 = 0.82;
  }
  if (family === 'ny_il_nj' && hints.qpTokenCount >= 1) {
    mainX0 = 0.22;
  }
  if (family === 'fl') {
    pbX0 = 0.73;
  }

  let rowZone: NormRect = { x0: 0.02, y0: 0.14, x1: 0.99, y1: 0.88 };
  if (
    family === 'ca_wa' &&
    jurisdictionCode != null &&
    (jurisdictionCode === 'US-CA' || jurisdictionCode === 'US-WA')
  ) {
    rowZone = { x0: 0.02, y0: 0.165, x1: 0.99, y1: 0.855 };
  }
  const mainZone: NormRect = { x0: mainX0, y0: rowZone.y0, x1: mainX1, y1: rowZone.y1 };
  const pbZone: NormRect = { x0: pbX0, y0: rowZone.y0, x1: pbX1, y1: rowZone.y1 };
  return { rowZone, mainZone, pbZone };
}
