/**
 * Web stub - react-native-iap 不支持 Web，提供空实现
 */
import { Platform } from 'react-native';

export const IAP_PRODUCT_IDS = {
  PIRATE: 'lottopilot_pirate',
  ASTRONAUT_MONTHLY: 'lottopilot_astronaut_monthly',
} as const;

export function isIAPAvailable(): boolean {
  return false;
}

export async function initIAP(): Promise<boolean> {
  return false;
}

export async function endIAP(): Promise<void> {}

export function setupPurchaseListeners(_onSuccess: () => void, _onError: () => void): void {}

export function formatPiratePrice(_product: unknown): string {
  return '$3.49';
}

export function formatAstronautPrice(_product: unknown): string {
  return '$0.99/mo';
}

export async function getIAPProducts(): Promise<{ pirate: null; astronaut: null }> {
  return { pirate: null, astronaut: null };
}

export async function purchasePirate(): Promise<void> {
  throw new Error('IAP not available on web');
}

export async function purchaseAstronaut(): Promise<void> {
  throw new Error('IAP not available on web');
}

export async function restoreIAPPurchases(): Promise<boolean> {
  return false;
}

export async function openSubscriptionManagement(): Promise<void> {}

export function onPurchaseSuccess(_callback: () => void): () => void {
  return () => {};
}
