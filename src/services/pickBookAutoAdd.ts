import * as SecureStore from 'expo-secure-store';

const KEY = 'lottopilot_auto_add_picks_to_pick_book';

export async function getAutoAddPicksToPickBook(): Promise<boolean> {
  try {
    const v = await SecureStore.getItemAsync(KEY);
    return v === 'true';
  } catch {
    return false;
  }
}

export async function setAutoAddPicksToPickBook(enabled: boolean): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY, String(enabled));
  } catch {
    // ignore
  }
}

