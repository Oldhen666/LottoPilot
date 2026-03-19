/**
 * Location service: coarse-grained (country + region) for prize rules only.
 * No precise coordinates stored; not used for ads.
 * Uses dynamic import so app works when expo-location native module is unavailable (e.g. Expo Go).
 */
import * as SecureStore from 'expo-secure-store';
import type { CurrentJurisdiction } from '../types/jurisdiction';
import { regionNameToCode } from '../constants/jurisdictions';

const STORAGE_KEY = 'lottopilot_current_jurisdiction';

/** Lazy-load expo-location; returns null if native module unavailable */
async function getLocationModule(): Promise<typeof import('expo-location') | null> {
  try {
    return await import('expo-location');
  } catch {
    return null;
  }
}

/** Reverse geocode to get country + region (province/state) */
async function reverseGeocode(lat: number, lon: number): Promise<{ country: string; regionCode: string; regionName: string } | null> {
  const Location = await getLocationModule();
  if (!Location) return null;
  try {
    const results = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lon });
    const r = results[0];
    if (!r) return null;
    const country = r.isoCountryCode ?? '';
    const regionRaw = r.region ?? r.subregion ?? r.district ?? '';
    if (!country || !regionRaw) return null;
    const countryTyped = country === 'CA' ? 'CA' : country === 'US' ? 'US' : null;
    if (!countryTyped) return null;
    const regionCode = regionNameToCode(countryTyped, regionRaw);
    const regionName = regionRaw;
    return { country: countryTyped, regionCode, regionName };
  } catch {
    return null;
  }
}

/** Request permission and get current jurisdiction from GPS */
export async function getJurisdictionFromLocation(): Promise<CurrentJurisdiction | null> {
  const Location = await getLocationModule();
  if (!Location) return null;
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;

    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Low,
    });
    const geo = await reverseGeocode(pos.coords.latitude, pos.coords.longitude);
    if (!geo) return null;

    const country = (geo.country === 'CA' ? 'CA' : geo.country === 'US' ? 'US' : null) as 'CA' | 'US' | null;
    if (!country) return null;

    const currency = country === 'CA' ? 'CAD' : 'USD';
    const j: CurrentJurisdiction = {
      country: country as 'CA' | 'US',
      regionCode: geo.regionCode,
      regionName: geo.regionName,
      currency,
      source: 'gps',
      updated_at: new Date().toISOString(),
    };
    await saveJurisdiction(j);
    return j;
  } catch {
    return null;
  }
}

/** Save jurisdiction to local storage */
export async function saveJurisdiction(j: CurrentJurisdiction): Promise<void> {
  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(j));
}

/** Load last saved jurisdiction */
export async function loadSavedJurisdiction(): Promise<CurrentJurisdiction | null> {
  try {
    const raw = await SecureStore.getItemAsync(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CurrentJurisdiction;
  } catch {
    return null;
  }
}

/** Set manual override jurisdiction */
export async function setManualJurisdiction(country: 'CA' | 'US', regionCode: string, regionName?: string): Promise<CurrentJurisdiction> {
  const currency = country === 'CA' ? 'CAD' : 'USD';
  const j: CurrentJurisdiction = {
    country,
    regionCode: regionCode.toUpperCase().slice(0, 2),
    regionName,
    currency,
    source: 'manual',
    updated_at: new Date().toISOString(),
  };
  await saveJurisdiction(j);
  return j;
}
