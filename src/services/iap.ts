/**
 * Google Play / App Store 内购服务
 * 在 Play Console 创建商品后，将 productId 填入下方常量
 */
import { Platform } from 'react-native';
import {
  initConnection,
  endConnection,
  fetchProducts,
  requestPurchase,
  purchaseUpdatedListener,
  purchaseErrorListener,
  getAvailablePurchases,
  finishTransaction,
  deepLinkToSubscriptions,
  type Purchase,
  type Product,
} from 'react-native-iap';
import { setCompassUnlocked, setProUnlocked, setHadAstronautSubscription, getHadAstronautSubscription, getUserRevokedAstronautFlag, clearUserRevokedAstronautFlag } from './entitlements';

/** 商品 ID - 必须与 Google Play Console 中创建的一致 */
export const IAP_PRODUCT_IDS = {
  PIRATE: 'lottopilot_pirate',
  ASTRONAUT_MONTHLY: 'lottopilot_astronaut_monthly',
} as const;

let purchaseListener: { remove: () => void } | null = null;
let errorListener: { remove: () => void } | null = null;

/** 购买成功后通知 UI 刷新权益（如 Settings 的 plan 状态） */
const purchaseSuccessCallbacks = new Set<() => void>();
export function onPurchaseSuccess(callback: () => void): () => void {
  purchaseSuccessCallbacks.add(callback);
  return () => purchaseSuccessCallbacks.delete(callback);
}

/** 是否支持 IAP（仅 Android/iOS 真机，Web 不支持） */
export function isIAPAvailable(): boolean {
  return Platform.OS === 'android' || Platform.OS === 'ios';
}

/** 初始化 IAP 连接，应用启动时调用 */
export async function initIAP(): Promise<boolean> {
  if (!isIAPAvailable()) return false;
  try {
    await initConnection();
    return true;
  } catch {
    return false;
  }
}

/** 结束 IAP 连接，应用退出时调用 */
export async function endIAP(): Promise<void> {
  purchaseListener?.remove();
  errorListener?.remove();
  purchaseListener = null;
  errorListener = null;
  if (isIAPAvailable()) {
    try {
      await endConnection();
    } catch {
      /* ignore */
    }
  }
}

/** 设置购买成功/失败监听，应用启动时调用一次 */
export function setupPurchaseListeners(onSuccess: (purchase: Purchase) => void, onError: (err: unknown) => void): void {
  if (!isIAPAvailable()) return;
  purchaseListener?.remove();
  errorListener?.remove();
  purchaseListener = purchaseUpdatedListener(async (purchase) => {
    try {
      await handlePurchase(purchase);
      await finishTransaction({ purchase, isConsumable: false });
      onSuccess(purchase);
    } catch (e) {
      onError(e);
    }
  });
  errorListener = purchaseErrorListener((err) => {
    onError(err);
  });
}

/** @param fromRestore - true 时仅更新本地不 sync，由 syncLocalEntitlementsToServer 以 server 为准（避免 license tester 污染） */
async function handlePurchase(purchase: Purchase, fromRestore = false): Promise<void> {
  const noSync = fromRestore ? { sync: false } : undefined;
  const productId = purchase.productId ?? purchase.productIds?.[0];
  if (productId === IAP_PRODUCT_IDS.PIRATE) {
    await setCompassUnlocked(true, noSync);
  } else if (productId === IAP_PRODUCT_IDS.ASTRONAUT_MONTHLY) {
    await clearUserRevokedAstronautFlag(); // 重新购买时清除取消标记
    await setProUnlocked(true, noSync);
    await setHadAstronautSubscription(noSync);
  }
  purchaseSuccessCallbacks.forEach((cb) => cb());
}

/** 从 Product 提取 Pirate 价格字符串（用于 UI，按地区显示） */
export function formatPiratePrice(product: Product | null): string {
  if (!product) return '$3.49';
  const p = product as { localizedPrice?: string; price?: string };
  return p.localizedPrice ?? p.price ?? '$3.49';
}

/** 从 Product 提取 Astronaut 订阅价格字符串（用于 UI） */
export function formatAstronautPrice(product: Product | null): string {
  if (!product) return '$0.99/mo';
  const p = product as {
    localizedPrice?: string;
    price?: string;
    subscriptionOfferDetails?: Array<{ pricingPhases?: { pricingPhaseList?: Array<{ formattedPrice?: string }> } }>;
  };
  const price =
    p.localizedPrice ??
    p.subscriptionOfferDetails?.[0]?.pricingPhases?.pricingPhaseList?.[0]?.formattedPrice ??
    p.price;
  if (!price) return '$0.99/mo';
  return price.includes('/') || price.toLowerCase().includes('mo') ? price : `${price}/mo`;
}

/** 获取商品信息（价格等） */
export async function getIAPProducts(): Promise<{ pirate: Product | null; astronaut: Product | null }> {
  if (!isIAPAvailable()) return { pirate: null, astronaut: null };
  try {
    const [products, subs] = await Promise.all([
      fetchProducts({ skus: [IAP_PRODUCT_IDS.PIRATE], type: 'in-app' }),
      fetchProducts({ skus: [IAP_PRODUCT_IDS.ASTRONAUT_MONTHLY], type: 'subs' }),
    ]);
    const pirate = products.find((p) => p.productId === IAP_PRODUCT_IDS.PIRATE) ?? null;
    const astronaut = subs.find((p) => p.productId === IAP_PRODUCT_IDS.ASTRONAUT_MONTHLY) ?? null;
    return { pirate, astronaut };
  } catch {
    return { pirate: null, astronaut: null };
  }
}

/** 发起 Pirate 一次性购买 */
export async function purchasePirate(): Promise<void> {
  if (!isIAPAvailable()) throw new Error('IAP not available');
  await requestPurchase({
    request: {
      ios: { sku: IAP_PRODUCT_IDS.PIRATE, andDangerouslyFinishTransactionAutomatically: false },
      android: { skus: [IAP_PRODUCT_IDS.PIRATE] },
    },
    type: 'in-app',
  });
}

/** 从订阅 Product 提取第一个 offerToken（用于 Android 免费试用 offer） */
function getSubscriptionOfferToken(product: Product | null): string | null {
  if (!product) return null;
  const p = product as {
    subscriptionOfferDetailsAndroid?: string;
    subscriptionOfferDetails?: Array<{ offerToken?: string }> | string;
  };
  if (Array.isArray(p.subscriptionOfferDetails) && p.subscriptionOfferDetails[0]?.offerToken) {
    return p.subscriptionOfferDetails[0].offerToken;
  }
  for (const key of ['subscriptionOfferDetailsAndroid', 'subscriptionOfferDetails'] as const) {
    const raw = p[key];
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        const arr = Array.isArray(parsed) ? parsed : parsed?.subscriptionOfferDetails;
        const first = Array.isArray(arr) ? arr[0] : null;
        const token = first?.offerToken ?? first?.offer_token;
        if (token) return token;
      } catch {
        /* continue */
      }
    }
  }
  return null;
}

/** 发起 Astronaut 订阅购买（首次：1 个月试用；回归用户：直接付费） */
export async function purchaseAstronaut(): Promise<void> {
  if (!isIAPAvailable()) throw new Error('IAP not available');
  const sku = IAP_PRODUCT_IDS.ASTRONAUT_MONTHLY;
  let androidRequest: { skus?: string[]; subscriptionOffers?: Array<{ sku: string; offerToken: string }> } = { skus: [sku] };
  const hadAstronautSubscription = await getHadAstronautSubscription();
  if (Platform.OS === 'android' && !hadAstronautSubscription) {
    try {
      const { astronaut } = await getIAPProducts();
      const offerToken = getSubscriptionOfferToken(astronaut);
      if (offerToken) {
        androidRequest = { subscriptionOffers: [{ sku, offerToken }] };
        console.log('[IAP] Using free-trial offer token (first-time)');
      } else {
        console.warn('[IAP] No offer token, using default sku (may not show free trial)');
      }
    } catch (e) {
      console.warn('[IAP] getIAPProducts failed, fallback to skus:', e);
    }
  } else if (hadAstronautSubscription) {
    console.log('[IAP] Returning user: using base plan (no free trial)');
  }
  try {
    await requestPurchase({
      request: {
        ios: { sku, andDangerouslyFinishTransactionAutomatically: false },
        android: androidRequest,
      },
      type: 'subs',
    });
  } catch (e) {
    console.error('[IAP] requestPurchase failed:', e);
    throw e;
  }
}

/** 恢复购买（检查已有购买并恢复权益）。若用户曾在应用内取消 Astronaut，则跳过 Astronaut 恢复（除非传入 forceRestore=true）。 */
export async function restoreIAPPurchases(forceRestore = false): Promise<boolean> {
  if (!isIAPAvailable()) return false;
  try {
    const purchases = await getAvailablePurchases();
    const skipAstronaut = !forceRestore && (await getUserRevokedAstronautFlag());
    const fromRestore = !forceRestore; // 仅登录时自动 restore 不 sync，用户主动 Restore 则正常 sync
    for (const p of purchases) {
      const productId = p.productId ?? p.productIds?.[0];
      if (productId === IAP_PRODUCT_IDS.ASTRONAUT_MONTHLY && skipAstronaut) continue;
      await handlePurchase(p, fromRestore);
    }
    return true;
  } catch {
    return false;
  }
}

/** 跳转到订阅管理（用户取消续订等） */
export async function openSubscriptionManagement(): Promise<void> {
  if (isIAPAvailable()) {
    try {
      await deepLinkToSubscriptions();
    } catch {
      /* ignore */
    }
  }
}
