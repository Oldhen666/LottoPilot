import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { AppState } from 'react-native';
import { NavigationContainer, createNavigationContainerRef, useNavigationState } from '@react-navigation/native';
import * as Linking from 'expo-linking';
import { setSessionFromAuthUrl } from './src/services/supabase';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Text, StatusBar, Platform, View, Animated, Easing, StyleSheet } from 'react-native';
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
import PickEvaluationScreen from './src/screens/PickEvaluationScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import DrawsListScreen from './src/screens/DrawsListScreen';
import LoginScreen from './src/screens/LoginScreen';
import SignUpScreen from './src/screens/SignUpScreen';
import { getRecordById } from './src/db/sqlite';
import type { CheckRecord } from './src/db/sqlite';

import type { LotteryId } from './src/types/lottery';
import { getLastHomeLottery, setLastHomeLottery } from './src/services/homeLotteryStorage';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();
const navigationRef = createNavigationContainerRef();

function BouncyTabIcon({
  name,
  color,
  size,
  bounceNonce,
  focused,
}: {
  name: React.ComponentProps<typeof Ionicons>['name'];
  color: string;
  size: number;
  bounceNonce: number;
  focused: boolean;
}) {
  const y = useMemo(() => new Animated.Value(0), []);
  useEffect(() => {
    if (!bounceNonce || focused) return;
    const up = Animated.timing(y, { toValue: -6, duration: 110, easing: Easing.out(Easing.quad), useNativeDriver: true });
    const down = Animated.timing(y, { toValue: 0, duration: 140, easing: Easing.out(Easing.quad), useNativeDriver: true });
    const one = Animated.sequence([up, down]);
    Animated.sequence([one, one, one]).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bounceNonce, focused]);
  return (
    <Animated.View style={{ transform: [{ translateY: y }] }}>
      <Ionicons name={name} size={size} color={color} />
    </Animated.View>
  );
}

function ResultScreenAsync({
  recordId,
  onDone,
  onBack,
}: {
  recordId: string;
  onDone: () => void;
  onBack: () => void;
}) {
  const [record, setRecord] = useState<CheckRecord | null>(null);
  useEffect(() => {
    getRecordById(recordId).then(setRecord);
  }, [recordId]);
  if (!record) return <Text style={{ color: COLORS.textSecondary, padding: 20 }}>Loading...</Text>;
  return <ResultScreen record={record} onDone={onDone} onBack={onBack} />;
}

function TabHome() {
  type TabHomeScreen = 'home' | 'check' | 'result' | 'draws';
  const readLastScreen = (): TabHomeScreen => {
    const g = globalThis as unknown as { __LP_lastTabHomeScreen?: TabHomeScreen };
    return g.__LP_lastTabHomeScreen ?? 'home';
  };
  const writeLastScreen = (s: TabHomeScreen) => {
    const g = globalThis as unknown as { __LP_lastTabHomeScreen?: TabHomeScreen };
    g.__LP_lastTabHomeScreen = s;
  };

  const [screen, _setScreen] = useState<TabHomeScreen>(readLastScreen());
  const setScreen = useCallback((s: TabHomeScreen) => {
    writeLastScreen(s);
    _setScreen(s);
  }, []);
  const [resultRecordId, setResultRecordId] = useState<string | null>(null);
  const [checkResetNonce, setCheckResetNonce] = useState(0);
  const [selectedLottery, setSelectedLottery] = useState<LotteryId>('lotto_max');
  const { jurisdiction, jurisdictionCode } = useJurisdiction();

  useEffect(() => {
    let cancelled = false;
    getLastHomeLottery().then((id) => {
      if (!cancelled && id) setSelectedLottery(id);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleLotteryChange = useCallback((id: LotteryId) => {
    setSelectedLottery(id);
    void setLastHomeLottery(id);
  }, []);

  const handleCheckScreenLotteryChange = useCallback((id: LotteryId) => {
    setSelectedLottery(id);
    void setLastHomeLottery(id);
  }, []);

  const handleCheckTicket = useCallback(() => {
    setScreen('check');
  }, []);

  let main: React.ReactNode;
  if (screen === 'check' || screen === 'result') {
    main = (
      <View style={{ flex: 1 }}>
        <View style={{ flex: 1 }} pointerEvents={screen === 'result' ? 'none' : 'auto'}>
          <CheckTicketScreen
            preselectedLottery={selectedLottery}
            onLotteryChange={handleCheckScreenLotteryChange}
            jurisdiction={jurisdiction}
            jurisdictionCode={jurisdictionCode}
            resetNonce={checkResetNonce}
            onBack={() => {
              setScreen('home');
            }}
            onResult={(id) => {
              setResultRecordId(id);
              setScreen('result');
            }}
          />
        </View>
        {screen === 'result' && resultRecordId ? (
          <View style={[StyleSheet.absoluteFillObject, { backgroundColor: COLORS.bg }]} pointerEvents="auto">
            <ResultScreenAsync
              recordId={resultRecordId}
              onDone={() => {
                setResultRecordId(null);
                setCheckResetNonce((n) => n + 1);
                setScreen('check');
              }}
              onBack={() => {
                setResultRecordId(null);
                setScreen('check');
              }}
            />
          </View>
        ) : null}
      </View>
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
      />
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {main}
    </View>
  );
}

function MainTabs() {
  const insets = useSafeAreaInsets();
  const [compassBounceNonce, setCompassBounceNonce] = useState(0);
  const [strategyBounceNonce, setStrategyBounceNonce] = useState(0);
  const activeTab = useNavigationState((s) => s.routes?.[s.index ?? 0]?.name);

  useEffect(() => {
    let cancelled = false;
    let toggle = true;
    const tick = () => {
      if (cancelled) return;
      if (activeTab === 'Compass') {
        setStrategyBounceNonce((n) => n + 1);
        return;
      }
      if (activeTab === 'StrategyLab') {
        setCompassBounceNonce((n) => n + 1);
        return;
      }
      // Home/Settings/etc: alternate between Compass and Strategy Lab
      if (toggle) setCompassBounceNonce((n) => n + 1);
      else setStrategyBounceNonce((n) => n + 1);
      toggle = !toggle;
    };
    tick();
    const t = setInterval(tick, 4000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [activeTab]);

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
          tabBarIcon: ({ color, size, focused }) => (
            <BouncyTabIcon name="compass" size={size} color={color} bounceNonce={compassBounceNonce} focused={focused} />
          ),
        }}
      />
      <Tab.Screen
        name="StrategyLab"
        component={StrategyLabScreen}
        options={{
          tabBarLabel: 'Strategy Lab',
          tabBarIcon: ({ color, size, focused }) => (
            <BouncyTabIcon name="flask" size={size} color={color} bounceNonce={strategyBounceNonce} focused={focused} />
          ),
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
          <Stack.Screen name="PickEvaluation" component={PickEvaluationScreen} />
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
