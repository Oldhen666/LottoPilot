import AsyncStorage from '@react-native-async-storage/async-storage';
import type { LotteryId } from '../types/lottery';

const KEY = '@LottoPilot/check_home_lottery_v1';

const VALID: LotteryId[] = ['lotto_max', 'lotto_649', 'powerball', 'mega_millions'];

export async function getLastHomeLottery(): Promise<LotteryId | null> {
  try {
    const v = await AsyncStorage.getItem(KEY);
    if (v && (VALID as string[]).includes(v)) return v as LotteryId;
    return null;
  } catch {
    return null;
  }
}

export async function setLastHomeLottery(id: LotteryId): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, id);
  } catch {
    /* ignore */
  }
}
