/**
 * Persisted total "Apply refinement" count per Strategy Set (AsyncStorage).
 * Auto / Manual share one counter per set.
 *
 * v3: flat `strategySetId` → count
 * v2: `strategySetId::auto|manual` → merged by summing per set
 * v1: flat `strategySetId` → copied as v3
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_V1 = '@LottoPilot/strategy_refine_totals_v1';
const KEY_V2 = '@LottoPilot/strategy_refine_totals_v2';
const KEY_V3 = '@LottoPilot/strategy_refine_totals_v3';

async function readMap(): Promise<Record<string, number>> {
  try {
    const rawV3 = await AsyncStorage.getItem(KEY_V3);
    if (rawV3) {
      const o = JSON.parse(rawV3) as Record<string, number>;
      return typeof o === 'object' && o !== null ? o : {};
    }
    const rawV2 = await AsyncStorage.getItem(KEY_V2);
    if (rawV2) {
      const v2 = JSON.parse(rawV2) as Record<string, number>;
      const merged: Record<string, number> = {};
      if (typeof v2 === 'object' && v2 !== null) {
        for (const [k, v] of Object.entries(v2)) {
          if (typeof v !== 'number' || v < 0) continue;
          const sep = k.indexOf('::');
          const setId = sep >= 0 ? k.slice(0, sep) : k;
          merged[setId] = (merged[setId] ?? 0) + v;
        }
      }
      if (Object.keys(merged).length > 0) {
        await AsyncStorage.setItem(KEY_V3, JSON.stringify(merged));
      }
      return merged;
    }
    const rawV1 = await AsyncStorage.getItem(KEY_V1);
    if (!rawV1) return {};
    const v1 = JSON.parse(rawV1) as Record<string, number>;
    const flat: Record<string, number> = {};
    if (typeof v1 === 'object' && v1 !== null) {
      for (const [k, v] of Object.entries(v1)) {
        if (typeof v === 'number' && v >= 0 && !k.includes('::')) {
          flat[k] = v;
        }
      }
    }
    if (Object.keys(flat).length > 0) {
      await AsyncStorage.setItem(KEY_V3, JSON.stringify(flat));
    }
    return flat;
  } catch {
    return {};
  }
}

async function writeMap(m: Record<string, number>): Promise<void> {
  await AsyncStorage.setItem(KEY_V3, JSON.stringify(m));
}

export async function getTotalRefinesForSet(strategySetId: string): Promise<number> {
  const m = await readMap();
  const n = m[strategySetId];
  return typeof n === 'number' && n >= 0 ? n : 0;
}

export async function incrementRefineTotalForSet(strategySetId: string): Promise<number> {
  const m = await readMap();
  const next = (m[strategySetId] ?? 0) + 1;
  m[strategySetId] = next;
  await writeMap(m);
  return next;
}
