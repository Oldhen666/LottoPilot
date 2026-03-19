/**
 * Hook for current jurisdiction (location-based or manual)
 */
import { useState, useEffect, useCallback } from 'react';
import type { CurrentJurisdiction } from '../types/jurisdiction';
import {
  loadSavedJurisdiction,
  getJurisdictionFromLocation,
  setManualJurisdiction,
  saveJurisdiction,
} from '../services/location';
import * as SecureStore from 'expo-secure-store';

const USE_LOCATION_KEY = 'lottopilot_use_location';

export async function getUseLocation(): Promise<boolean> {
  try {
    const v = await SecureStore.getItemAsync(USE_LOCATION_KEY);
    return v !== 'false';
  } catch {
    return true;
  }
}

export async function setUseLocationPreference(enabled: boolean): Promise<void> {
  await SecureStore.setItemAsync(USE_LOCATION_KEY, String(enabled));
}

export function useJurisdiction() {
  const [jurisdiction, setJurisdiction] = useState<CurrentJurisdiction | null>(null);
  const [useLocation, setUseLocationState] = useState(true);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const useLoc = await getUseLocation();
    setUseLocationState(useLoc);

    if (useLoc) {
      const fromGps = await getJurisdictionFromLocation();
      if (fromGps) {
        setJurisdiction(fromGps);
        setLoading(false);
        return;
      }
    }

    const saved = await loadSavedJurisdiction();
    setJurisdiction(saved);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const setManual = useCallback(async (country: 'CA' | 'US', regionCode: string, regionName?: string) => {
    const j = await setManualJurisdiction(country, regionCode, regionName);
    setJurisdiction(j);
  }, []);

  const toggleUseLocation = useCallback(async (enabled: boolean) => {
    await setUseLocationPreference(enabled);
    setUseLocationState(enabled);
    if (enabled) {
      const fromGps = await getJurisdictionFromLocation();
      if (fromGps) setJurisdiction(fromGps);
    }
  }, []);

  const jurisdictionCode = jurisdiction
    ? `${jurisdiction.country}-${jurisdiction.regionCode}`
    : null;

  return {
    jurisdiction,
    jurisdictionCode,
    useLocation,
    loading,
    refresh,
    setManual,
    toggleUseLocation,
  };
}
