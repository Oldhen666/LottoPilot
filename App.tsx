import React, { useState, useEffect, useCallback } from 'react';
import { AppState } from 'react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import * as Linking from 'expo-linking';
import { setSessionFromAuthUrl } from './src/services/supabase';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Text, StatusBar, Platform, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { initDb } from './src/db/sqlite';
import { runPreload } from './src/utils/preload';
import { initIAP, setupPurchaseListeners, endIAP, restoreIAPPurchases, isIAPAvailable } from './src/services/iap';
import { syncLocalEntitlementsToServer } from './src/services/entitlements';
import { runEarlyStorageVersionCheck } from './src/utils/storageVersionCheck';
import { triggerAppActiveRefetch } from './src/utils/appActiveRefetch';
import { initCompassGenerateGate } from './src/services/compassGenerateGate';
import { notifyEntitlementsChange } from './src/services/entitlements';
import { invalidateDrawsCache } from './src/hooks/useDraws';
import { getCurrentUserEmail, migrateAuthFromAsyncStorage, notifyAuthStateChange, onAuthStateChange, preWarmSupabaseClient, resetSupabaseClient, tryRefreshSession, validateSessionOnStartup } from './src/services/supabase';
import { COLORS, SPACING } from './src/constants/theme';
import { useJurisdiction } from './src/hooks/useJurisdiction';
import HomeScreen from './src/screens/HomeScreen';
import CheckTicketScreen from './src/screens/CheckTicketScreen';
import ResultScreen from './src/screens/ResultScreen';
import CompassScreen from './src/screens/CompassScreen';
import StrategyLabScreen from './src/screens/StrategyLabScreen';
import PickBookScreen from './src/screens/PickBookScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import DrawsListScreen from './src/screens/DrawsListScreen';
import LoginScreen from './src/screens/LoginScreen';
import SignUpScreen from './src/screens/SignUpScreen';
import { getRecordById } from './src/db/sqlite';
import type { CheckRecord } from './src/db/sqlite';

import type { LotteryId } from './src/types/lottery';
import CheckTourOverlay, { type CheckTourStepIndex } from './src/components/CheckTourOverlay';
import {
  getCheckTourCompleted,
  setCheckTourCompleted,
  canStartCheckTour,
} from './src/services/checkTourStorage';
import { getLastHomeLottery, setLastHomeLottery } from './src/services/homeLotteryStorage';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();
const navigationRef = createNavigationContainerRef();

function ResultScreenAsync({
  recordId,
  onDone,
  onEditNumbers,
}: {
  recordId: string;
  onDone: () => void;
  onEditNumbers?: () => void;
}) {
  const [record, setRecord] = useState<CheckRecord | null>(null);
  useEffect(() => {
    getRecordById(recordId).then(setRecord);
  }, [recordId]);
  if (!record) return <Text style={{ color: COLORS.textSecondary, padding: 20 }}>Loading...</Text>;
  return <ResultScreen record={record} onDone={onDone} onEditNumbers={onEditNumbers} />;
}

function TabHome() {
  const [screen, setScreen] = useState<'home' | 'check' | 'result' | 'draws'>('home');
  const [resultRecordId, setResultRecordId] = useState<string | null>(null);
  const [editRecordId, setEditRecordId] = useState<string | null>(null);
  const [selectedLottery, setSelectedLottery] = useState<LotteryId>('lotto_max');
  const { jurisdiction, jurisdictionCode, loading: jurisdictionLoading } = useJurisdiction();

  useEffect(() => {
    let cancelled = false;
    getLastHomeLottery().then((id) => {
      if (!cancelled && id) setSelectedLottery(id);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const [checkTourStep, setCheckTourStep] = useState<CheckTourStepIndex | null>(null);
  const [checkTourLoaded, setCheckTourLoaded] = useState(false);
  const [checkTourDonePersisted, setCheckTourDonePersisted] = useState(false);
  const [checkTourHighlightRect, setCheckTourHighlightRect] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  useEffect(() => {
    getCheckTourCompleted().then((done) => {
      setCheckTourDonePersisted(done);
      setCheckTourLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!checkTourLoaded || checkTourDonePersisted || screen !== 'home' || jurisdictionLoading) return;
    if (checkTourStep !== null) return;
    let cancelled = false;
    (async () => {
      const ok = await canStartCheckTour();
      if (cancelled || !ok) return;
      setCheckTourStep(0);
    })();
    return () => {
      cancelled = true;
    };
  }, [checkTourLoaded, checkTourDonePersisted, screen, jurisdictionLoading, checkTourStep]);

  const finishCheckTour = useCallback(async () => {
    await setCheckTourCompleted();
    setCheckTourDonePersisted(true);
    setCheckTourStep(null);
    setCheckTourHighlightRect(null);
  }, []);

  const handleLotteryChange = useCallback(
    (id: LotteryId) => {
      setSelectedLottery(id);
      void setLastHomeLottery(id);
      if (checkTourStep === 0) setCheckTourStep(1);
    },
    [checkTourStep],
  );

  const handleCheckScreenLotteryChange = useCallback((id: LotteryId) => {
    setSelectedLottery(id);
    void setLastHomeLottery(id);
  }, []);

  const handleCheckTicket = useCallback(() => {
    setScreen('check');
    if (checkTourStep === 1) setCheckTourStep(2);
  }, [checkTourStep]);

  const checkTourNextFromStep0 = useCallback(() => {
    setCheckTourStep(1);
  }, []);

  const showCheckTourOverlay =
    checkTourStep !== null && (screen === 'home' || screen === 'check');

  let main: React.ReactNode;
  if (screen === 'check') {
    main = (
      <CheckTicketScreen
        preselectedLottery={selectedLottery}
        onLotteryChange={handleCheckScreenLotteryChange}
        jurisdiction={jurisdiction}
        jurisdictionCode={jurisdictionCode}
        initialRecordId={editRecordId}
        checkTourStep={checkTourStep === 2 ? 2 : undefined}
        onCheckTourHighlight={setCheckTourHighlightRect}
        onBack={() => {
          setEditRecordId(null);
          setScreen('home');
        }}
        onResult={(id) => {
          if (checkTourStep === 2) void finishCheckTour();
          setResultRecordId(id);
          setEditRecordId(null);
          setScreen('result');
        }}
      />
    );
  } else if (screen === 'result' && resultRecordId) {
    main = (
      <ResultScreenAsync
        recordId={resultRecordId}
        onDone={() => {
          setResultRecordId(null);
          setEditRecordId(null);
          setScreen('home');
        }}
        onEditNumbers={() => {
          setEditRecordId(resultRecordId);
          setScreen('check');
        }}
      />
    );
  } else if (screen === 'draws') {
    main = <DrawsListScreen lotteryId={selectedLottery} onBack={() => setScreen('home')} />;
  } else {
    main = (
      <HomeScreen
        selectedLottery={selectedLottery}
        onLotteryChange={handleLotteryChange}
        onCheckTicket={handleCheckTicket}
        onViewDrawHistory={() => setScreen('draws')}
        checkTourStep={checkTourStep === 0 || checkTourStep === 1 ? checkTourStep : undefined}
        onCheckTourHighlight={setCheckTourHighlightRect}
      />
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {main}
      {showCheckTourOverlay ? (
        <CheckTourOverlay
          step={checkTourStep!}
          highlightRect={checkTourHighlightRect}
          onSkip={finishCheckTour}
          onNext={
            checkTourStep === 0
              ? checkTourNextFromStep0
              : checkTourStep === 1
                ? handleCheckTicket
                : undefined
          }
          onDone={checkTourStep === 2 ? finishCheckTour : undefined}
        />
      ) : null}
    </View>
  );
}

function MainTabs() {
  const insets = useSafeAreaInsets();
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: COLORS.bg,
          borderTopColor: COLORS.bgElevated,
          paddingTop: SPACING.safeTop,
          paddingBottom: Math.max(insets.bottom, Platform.OS === 'android' ? 32 : SPACING.safeBottom),
          height: SPACING.tabBarHeight + SPACING.safeTop + Math.max(insets.bottom, Platform.OS === 'android' ? 32 : SPACING.safeBottom),
        },
        tabBarActiveTintColor: COLORS.gold,
        tabBarInactiveTintColor: COLORS.textMuted,
        tabBarShowLabel: true,
        tabBarIconStyle: { marginBottom: -2 },
      }}
    >
      <Tab.Screen
        name="Home"
        component={TabHome}
        options={{
          tabBarLabel: 'Check',
          tabBarIcon: ({ color, size }) => <Ionicons name="checkbox" size={size} color={color} />,
        }}
      />
      <Tab.Screen
        name="Compass"
        component={CompassScreen}
        options={{
          tabBarLabel: 'Compass',
          tabBarIcon: ({ color, size }) => <Ionicons name="compass" size={size} color={color} />,
        }}
      />
      <Tab.Screen
        name="StrategyLab"
        component={StrategyLabScreen}
        options={{
          tabBarLabel: 'Strategy Lab',
          tabBarIcon: ({ color, size }) => <Ionicons name="flask" size={size} color={color} />,
        }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          tabBarLabel: 'Settings',
          tabBarIcon: ({ color, size }) => <Ionicons name="settings" size={size} color={color} />,
        }}
      />
    </Tab.Navigator>
  );
}

function AppContent() {
  useEffect(() => {
    const goToHome = () => {
      if (navigationRef.isReady()) {
        navigationRef.reset({ index: 0, routes: [{ name: 'MainTabs' }] });
      } else {
        setTimeout(goToHome, 50);
      }
    };
    const handleDeepLink = async (url: string | null) => {
      if (!url) return;
      const isAppCallback = url.startsWith('lottopilot://auth/callback');
      const isWebWithHash = url.includes('#access_token=');
      if (!isAppCallback && !isWebWithHash) return;
      const ok = await setSessionFromAuthUrl(url);
      if (ok) goToHome();
    };
    const sub = Linking.addEventListener('url', ({ url }) => handleDeepLink(url));
    Linking.getInitialURL().then(handleDeepLink);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    try {
      const mobileAds = require('react-native-google-mobile-ads').default;
      mobileAds()
        .initialize()
        .then(() => {
          if (__DEV__) console.log('[Ad] AdMob SDK initialized');
        })
        .catch((e: Error) => console.warn('[Ad] AdMob init failed:', e));
    } catch (e) {
      console.warn('[Ad] AdMob load failed:', e);
    }
  }, []);

  useEffect(() => {
    try {
      preWarmSupabaseClient();
    } catch {
      /* ignore - will retry when fetch runs */
    }
    invalidateDrawsCache();
    const t = setTimeout(() => {
      triggerAppActiveRefetch();
    }, 300);
    (async () => {
      try {
        const didClear = await runEarlyStorageVersionCheck();
        if (didClear) resetSupabaseClient();
        await migrateAuthFromAsyncStorage().catch(() => {});
        await Promise.race([
          validateSessionOnStartup(),
          new Promise((r) => setTimeout(r, 5000)),
        ]);
        await initDb();
        await initCompassGenerateGate();
        runPreload();
        tryRefreshSession();
        invalidateDrawsCache();
        triggerAppActiveRefetch();
      } catch (e) {
        console.error('Startup failed:', e);
      } finally {
        invalidateDrawsCache();
        triggerAppActiveRefetch();
      }
    })();
    initIAP()
      .then((ok) => {
        if (ok) {
          setupPurchaseListeners(
            () => {},
            (e) => console.warn('IAP purchase error:', e)
          );
        }
      })
      .catch((e) => console.warn('IAP init failed:', e));
    return () => {
      clearTimeout(t);
      endIAP();
    };
  }, []);

  useEffect(() => {
    let lastRunAt = 0;
    const DEBOUNCE_MS = 3000;
    const runRestoreAndSyncIfSignedIn = async (email: string | null) => {
      if (!email) return;
      const now = Date.now();
      if (now - lastRunAt < DEBOUNCE_MS) return; // 防止 notify 触发级联重复执行
      lastRunAt = now;
      try {
        if (isIAPAvailable()) {
          await restoreIAPPurchases().catch(() => {});
        }
        await syncLocalEntitlementsToServer().catch(() => {});
      } finally {
        notifyEntitlementsChange(); // 只刷新 UI，不触发 restore 级联
      }
    };
    getCurrentUserEmail().then(runRestoreAndSyncIfSignedIn);
    return onAuthStateChange(runRestoreAndSyncIfSignedIn);
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        tryRefreshSession();
        invalidateDrawsCache();
        triggerAppActiveRefetch();
      }
    });
    return () => sub.remove();
  }, []);

  return (
    <>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />
      <NavigationContainer ref={navigationRef}>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="MainTabs" component={MainTabs} />
          <Stack.Screen name="Login">
            {({ navigation }) => (
              <LoginScreen
                onSuccess={() => navigation.goBack()}
                onGoToSignUp={() => (navigation as { replace: (n: string) => void }).replace('SignUp')}
              />
            )}
          </Stack.Screen>
          <Stack.Screen name="SignUp">
            {({ navigation }) => (
              <SignUpScreen
                onSuccess={() => navigation.goBack()}
                onGoToLogin={() => (navigation as { replace: (n: string) => void }).replace('Login')}
              />
            )}
          </Stack.Screen>
          <Stack.Screen name="PickBook">
            {({ navigation }) => (
              <PickBookScreen onBack={() => navigation.goBack()} />
            )}
          </Stack.Screen>
        </Stack.Navigator>
      </NavigationContainer>
    </>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}
