/**
 * Persisted total "Apply refinement" count per Strategy Set (AsyncStorage).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '@LottoPilot/strategy_refine_totals_v1';

async function readMap(): Promise<Record<string, number>> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return {};
    const o = JSON.parse(raw) as Record<string, number>;
    return typeof o === 'object' && o !== null ? o : {};
  } catch {
    return {};
  }
}

async function writeMap(m: Record<string, number>): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(m));
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
