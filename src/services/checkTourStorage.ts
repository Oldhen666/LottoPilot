import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const KEY = '@LottoPilot/check_tour_v1_done';

export async function getCheckTourCompleted(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY)) === '1';
  } catch {
    return false;
  }
}

export async function setCheckTourCompleted(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, '1');
  } catch {
    /* ignore */
  }
}

/** Web: always eligible. Native: foreground location must be granted. */
export async function canStartCheckTour(): Promise<boolean> {
  if (Platform.OS === 'web') return true;
  try {
    const Location = await import('expo-location');
    const { status } = await Location.getForegroundPermissionsAsync();
    return status === 'granted';
  } catch {
    return false;
  }
}
