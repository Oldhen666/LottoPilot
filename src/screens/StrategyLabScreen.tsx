/**
 * Strategy Lab: feature-driven, AI-assisted strategy exploration.
 * Auto Pilot (Astronaut-only) / Manual modes; one saved strategy per lottery (local).
 * This system refines strategy behavior based on feedback. It does not predict lottery outcomes.
 */
import React, { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  ScrollView,
  Alert,
  ActivityIndicator,
  Modal,
  TextInput,
  Platform,
  Linking,
  Dimensions,
  Animated,
  InteractionManager,
  Easing,
  Switch,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, SPACING } from '../constants/theme';
import { getRecords } from '../db/sqlite';
import { fetchDraws, getCurrentUserEmail, onAuthStateChange } from '../services/supabase';
import { incrementStrategyLabTotalUsage, addToPickBook, getPickBookRecords, type PickBookRecord } from '../db/sqlite';
import {
  getEntitlements,
  setProUnlocked,
  setHadAstronautSubscription as setHadAstronautEntitlement,
  notifyEntitlementsChange,
  onEntitlementsChange,
  type UserPlan,
} from '../services/entitlements';
import { shouldShowStrategyLabBannerAds } from '../services/adManager';
import {
  needsRewardGateForGenerate,
  needsRewardGateForRefine,
  recordStrategyLabGenerateSuccess,
  recordStrategyLabRefineSuccess,
  setStrategyLabGenerateCountAfterAd,
  setStrategyLabRefineCountAfterAd,
} from '../services/strategyLabGate';
import { getTotalRefinesForSet, incrementRefineTotalForSet } from '../services/strategyRefineStats';
import { showRewardedAdForStrategyLab, REWARDED_AD_MESSAGES } from '../services/rewardedAdService';
import { BannerAdPlaceholder } from '../components/BannerAdPlaceholder';
import { TuningWeightSpectrumRow } from '../components/TuningWeightSpectrumRow';
import { isIAPAvailable, purchaseAstronaut, restoreIAPPurchases, onPurchaseSuccess, getIAPProducts, formatAstronautRenewalPrice } from '../services/iap';
import { SubscriptionLegalText } from '../components/SubscriptionLegalText';
import {
  ASTRONAUT_FEATURE_BULLETS,
  astronautPaidOnlyDisclosureLines,
  astronautTrialDisclosureLines,
} from '../constants/subscriptionLegal';
import { getLastHomeLottery, setLastHomeLottery } from '../services/homeLotteryStorage';
import {
  getStrategySets,
  getActiveStrategySet,
  getActiveSetId,
  setActiveSetId,
  updateStrategySet,
  applyFeatureAdjustment,
  saveStrategySets,
} from '../services/strategySetStorage';
import { generateFromStrategySet } from '../services/strategyEngine';
import { computeStrategyScoreSummary } from '../services/strategyPickScore';
import { getAutoPilotPresetWeights, inferNearestPlayStyleId } from '../services/autoPilotPresets';
import {
  getGeneratedPicks,
  setGeneratedPicksForDate,
  getTodayDateString,
} from '../services/generatedPicksStorage';
import {
  computeShapeSummary,
  computeDeltaSummary,
  computeRefineProposal,
  filterRefineDeltasForPlan,
} from '../services/aiRefine';
import { LOTTERY_DEFS } from '../constants/lotteries';
import {
  STRATEGY_FEATURES,
  FEATURE_CATEGORY_COLORS,
  getFeatureDetailCopy,
  isAstronautOnlyFeature,
  commonPenaltyLevelFrom01,
  snapCommonPenalty01,
  featureWeight01AfterRefineDelta,
  COMMON_PENALTY_LEVEL_MAX,
  type FeatureCategory,
  type FeatureId,
} from '../constants/strategyFeatures';
import { STRATEGY_PLAY_STYLE_IDS, STRATEGY_PLAY_STYLE_SHORT, type StrategyPlayStyleId } from '../constants/strategyPlayStyle';
import type { LotteryId } from '../types/lottery';
import type { StrategySet, LuckyBiasStrength } from '../types/strategy';
import type { CandidatePick } from '../utils/localAnalysis';

const TUNING_CATEGORY_PANEL: Record<FeatureCategory, { bg: string; border: string }> = {
  structure: { bg: 'rgba(79, 70, 229, 0.22)', border: 'rgba(79, 70, 229, 0.38)' },
  position: { bg: 'rgba(16, 185, 129, 0.22)', border: 'rgba(16, 185, 129, 0.38)' },
  trend: { bg: 'rgba(212, 175, 55, 0.24)', border: 'rgba(212, 175, 55, 0.45)' },
  risk: { bg: 'rgba(245, 158, 11, 0.22)', border: 'rgba(245, 158, 11, 0.38)' },
};

function tuningCategoryTitle(cat: FeatureCategory): string {
  const head: Record<FeatureCategory, string> = {
    structure: 'Structure',
    position: 'Position',
    trend: 'Trend',
    risk: 'Risk',
  };
  return head[cat];
}

/** Refine modal: past-draw date wheel row height (px); snap interval must match. */
const REFINE_DATE_WHEEL_ROW_H = 48;
const REFINE_DATE_WHEEL_HEIGHT = REFINE_DATE_WHEEL_ROW_H * 5;

const PERSONAL_BIAS_ACCENT = '#a78bfa';
const PERSONAL_BIAS_PANEL = { bg: 'rgba(167, 139, 250, 0.18)', border: 'rgba(167, 139, 250, 0.42)' };

/** Single-line copy for the current lucky-bias tier only. */
function luckyBiasIndicationLine(strength: LuckyBiasStrength | undefined): string {
  const v = strength ?? 'off';
  if (v === 'off') return 'Bias off — tap the hearts to raise strength.';
  if (v === 'low') return 'Low — mild boost for matching ones digits in balanced slots.';
  if (v === 'medium') return 'Medium — moderate boost; still mixed with structure, position, and risk.';
  return 'High — strongest allowed nudge (still capped overall).';
}

function luckyDigitIndicationLine(d: number | undefined): string {
  if (d === undefined) return 'Optional: set 0–9 to prefer numbers ending in that digit.';
  return `Boosts main numbers with ones digit ${d} (e.g. ${d}, ${10 + d}, ${20 + d}…) when bias is on.`;
}

const LUCKY_BIAS_OPTIONS: { value: LuckyBiasStrength; label: string; fill: number }[] = [
  { value: 'off', label: 'Off', fill: 0 },
  { value: 'low', label: 'Low', fill: 0.25 },
  { value: 'medium', label: 'Medium', fill: 0.5 },
  { value: 'high', label: 'High', fill: 1 },
];

function showAlert(title: string, message: string, onOk?: () => void) {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.alert(`${title}\n\n${message}`);
    onOk?.();
    return;
  }
  Alert.alert(title, message, onOk ? [{ text: 'OK', onPress: onOk }] : undefined);
}

/** Strategy Lab walkthrough on YouTube. Leave empty until the video is published; the guide shows “Coming soon”. */
const STRATEGY_LAB_YOUTUBE_URL = '';

const STRATEGY_LAB_GUIDE_STEPS = [
  { icon: 'ticket' as const, title: 'Lottery & mode', text: 'In Manual, pick the lottery first—each game keeps its own saved weights locally. Auto Pilot is Astronaut-only and skips the weight panel for quicker generates.' },
  { icon: 'flask' as const, title: 'Tuning', text: 'Weights are grouped by category (Structure, Position, Trend, Risk). Tap the gear for a bottom sheet with the slider and details; tap outside the sheet to save. Astronaut unlocks extra parameters on some categories.' },
  { icon: 'heart' as const, title: 'Personal bias', text: 'Optional lucky digit (0–9) and bias strength (Off/Low/Medium/High). When on, nudges balanced picks toward main numbers whose ones digit matches. Personal preference only—does not change true odds.' },
  { icon: 'sparkles' as const, title: 'Generate Picks', text: 'Manual: choose lottery under Lottery first. Astronaut Auto Pilot: choose lottery in Generate Picks. Free Manual: every 2 successful generates, the next one requires a short ad or Astronaut plan.' },
  { icon: 'construct' as const, title: 'Generate & Refine', text: 'After each draw, compare your picks with actual results. Use Refine: pick a past draw date, enter or load your line, then compute. Suggests small weight adjustments (±5% max). Free Manual: every 2 successful Refines, the next requires a rewarded ad or Astronaut plan. Does not predict outcomes.' },
];
export default function StrategyLabScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const [mode, setMode] = useState<'auto' | 'manual'>('manual');
  const [isSignedIn, setIsSignedIn] = useState<boolean | null>(null);
  const [plan, setPlan] = useState<UserPlan>('free');
  const [proUnlocked, setProUnlockedState] = useState(false);
  const [hadAstronautSubscription, setHadAstronautSubscription] = useState(false);
  const pendingGenerateRef = useRef<{ history: { winning_numbers: number[]; special_numbers?: number[] }[]; drawDate: string } | null>(null);
  const strategyGateKindRef = useRef<'generate' | 'refine'>('generate');
  const [strategyLabGateVisible, setStrategyLabGateVisible] = useState(false);
  const [strategyLabGateKind, setStrategyLabGateKind] = useState<'generate' | 'refine'>('generate');
  const [activeSet, setActiveSet] = useState<StrategySet | null>(null);
  const [selectedLottery, setSelectedLottery] = useState<LotteryId>('lotto_max');
  const [candidates, setCandidates] = useState<CandidatePick[]>([]);
  const [picksByDate, setPicksByDate] = useState<Record<string, CandidatePick[]>>({});
  const [loading, setLoading] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);
  const [showStrategyLabGuide, setShowStrategyLabGuide] = useState(false);
  const [showRefineModal, setShowRefineModal] = useState(false);
  const [refineProposal, setRefineProposal] = useState<{
    deltas: Array<{ featureId: string; direction: string; magnitude: number }>;
    reasoning: string;
    /** Shown only when not Pro/Astronaut and raw proposal included astronaut-only weight tweaks. */
    astronautUpsellNote?: string;
  } | null>(null);
  const [refineLoading, setRefineLoading] = useState(false);
  const [winningNumbersArray, setWinningNumbersArray] = useState<string[]>([]);
  const [userPicksArray, setUserPicksArray] = useState<string[]>([]);
  const [pastDrawsForRefine, setPastDrawsForRefine] = useState<{ draw_date: string; winning_numbers: number[]; special_numbers?: number[] }[]>([]);
  const [pastDrawsLoading, setPastDrawsLoading] = useState(false);
  const [refineWizardStep, setRefineWizardStep] = useState<1 | 2>(1);
  const [refineCountdown, setRefineCountdown] = useState<number | null>(null);
  const [lotteryDropdownOpen, setLotteryDropdownOpen] = useState(false);
  const [playStyleDropdownOpen, setPlayStyleDropdownOpen] = useState(false);
  /** Auto Pilot: Personal Bias section folded by default; switch expands full controls above Generate. */
  const [autoPersonalBiasExpanded, setAutoPersonalBiasExpanded] = useState(false);
  const [showPickBookInRefine, setShowPickBookInRefine] = useState(false);
  const [refinePickBookRecords, setRefinePickBookRecords] = useState<PickBookRecord[]>([]);
  const [refinePickBookLoading, setRefinePickBookLoading] = useState(false);
  const [refineSelectedPastDrawDate, setRefineSelectedPastDrawDate] = useState<string | null>(null);
  const [showRefineManualAddModal, setShowRefineManualAddModal] = useState(false);
  const [refineManualAddDate, setRefineManualAddDate] = useState('');
  const [refineManualAddCells, setRefineManualAddCells] = useState<string[]>([]);
  const [editingFeature, setEditingFeature] = useState<FeatureId | null>(null);
  /** Draft weight (0–1) while the tuning popup is open */
  const [editingDraft01, setEditingDraft01] = useState(0.5);
  const [inBookDateKeys, setInBookDateKeys] = useState<Set<string>>(new Set());
  const [astronautRenewalPrice, setAstronautRenewalPrice] = useState('$0.99/month');
  const refineScrollRef = useRef<ScrollView>(null);
  const refineDateWheelRef = useRef<ScrollView>(null);
  const refineDateWheelIdxRef = useRef(0);
  const showRefineModalRef = useRef(false);
  const [refineScrollY, setRefineScrollY] = useState(0);
  const [refineContentH, setRefineContentH] = useState(0);
  const [refineLayoutH, setRefineLayoutH] = useState(0);
  const [refineApplyTotalForSet, setRefineApplyTotalForSet] = useState(0);
  /** Draw history used only for Strategy Score (same source as generate); cleared when lottery changes. */
  const [strategyScoreHistory, setStrategyScoreHistory] = useState<
    { winning_numbers: number[]; special_numbers?: number[] }[] | null
  >(null);
  const [strategyScoreExpanded, setStrategyScoreExpanded] = useState(false);

  const tuningSheetHideY = useMemo(
    () => Math.min(Math.round(Dimensions.get('window').height * 0.55), 620),
    []
  );
  const tuningSheetAnim = useRef(new Animated.Value(tuningSheetHideY)).current;

  const refineSheetHideY = useMemo(() => Dimensions.get('window').height, []);
  const refineSheetAnim = useRef(new Animated.Value(refineSheetHideY)).current;
  const addToPickBookPulse = useRef(new Animated.Value(0)).current;

  const luckyBiasCurIdx = useMemo(() => {
    if (!activeSet) return 0;
    const i = LUCKY_BIAS_OPTIONS.findIndex((o) => o.value === (activeSet.luckyBiasStrength ?? 'off'));
    return i >= 0 ? i : 0;
  }, [activeSet?.luckyBiasStrength]);

  useEffect(() => {
    setLotteryDropdownOpen(false);
    setPlayStyleDropdownOpen(false);
    setStrategyScoreHistory(null);
    setStrategyScoreExpanded(false);
  }, [selectedLottery]);

  const strategyFeatureKey = useMemo(
    () =>
      activeSet
        ? `${activeSet.id}:${JSON.stringify(activeSet.featureWeights)}:${String(activeSet.luckyOnesDigit)}:${activeSet.luckyBiasStrength ?? 'off'}`
        : '',
    [activeSet]
  );

  const strategyScoreSummary = useMemo(() => {
    const today = getTodayDateString();
    const tp = picksByDate[today];
    if (!tp?.length || !activeSet || !strategyScoreHistory || strategyScoreHistory.length < 2) return null;
    return computeStrategyScoreSummary(selectedLottery, strategyScoreHistory, activeSet, tp);
  }, [picksByDate, selectedLottery, strategyFeatureKey, strategyScoreHistory, activeSet]);

  useEffect(() => {
    if (!activeSet) return;
    const today = getTodayDateString();
    const tp = picksByDate[today];
    if (!tp?.length || strategyScoreHistory != null) return;
    let cancelled = false;
    void (async () => {
      const records = await getRecords({ lottery_id: selectedLottery, limit: 50 });
      const fromRecords = records.map((r) => ({
        winning_numbers: r.winning_numbers,
        special_numbers: r.winning_special,
      }));
      if (cancelled) return;
      if (fromRecords.length >= 2) {
        setStrategyScoreHistory(fromRecords);
        return;
      }
      try {
        const draws = await fetchDraws(selectedLottery, 50);
        const h = draws.map((d) => ({
          winning_numbers: d.winning_numbers,
          special_numbers: d.special_numbers,
        }));
        if (!cancelled && h.length >= 2) setStrategyScoreHistory(h);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeSet, picksByDate, selectedLottery, strategyScoreHistory]);

  const loadInBookDateKeys = useCallback(async () => {
    const records = await getPickBookRecords({
      lotteryId: selectedLottery,
    });
    setInBookDateKeys(new Set(records.map((r) => `${r.lottery_id}:${r.draw_date}`)));
  }, [selectedLottery]);

  const loadState = useCallback(async () => {
    const ent = await getEntitlements();
    setPlan(ent.plan);
    setProUnlockedState(ent.proUnlocked);
    setHadAstronautSubscription(ent.hadAstronautSubscription);
  }, []);

  const loadSets = useCallback(async () => {
    let list = await getStrategySets(selectedLottery);
    await saveStrategySets(selectedLottery, list);
    list = await getStrategySets(selectedLottery);
    const activeId = await getActiveSetId(selectedLottery);
    if (list[0] && activeId && activeId !== list[0].id) {
      await setActiveSetId(selectedLottery, list[0].id);
    }
    const active = await getActiveStrategySet(selectedLottery);
    setActiveSet(active);
  }, [selectedLottery]);

  const loadPicksByDate = useCallback(async () => {
    if (!activeSet) {
      setPicksByDate({});
      return;
    }
    const stored = await getGeneratedPicks(selectedLottery, activeSet.id);
    setPicksByDate(stored);
  }, [selectedLottery, activeSet?.id]);

  useEffect(() => {
    loadState();
  }, [loadState]);

  useEffect(() => {
    setLotteryDropdownOpen(false);
    setPlayStyleDropdownOpen(false);
  }, [mode]);

  useEffect(() => {
    if (!proUnlocked && mode === 'auto') {
      setMode('manual');
    }
  }, [proUnlocked, mode]);

  useEffect(() => {
    if (mode !== 'auto') setAutoPersonalBiasExpanded(false);
  }, [mode]);

  useEffect(() => {
    const unsub = onEntitlementsChange(() => {
      loadState();
      loadSets();
    });
    return unsub;
  }, [loadState, loadSets]);

  useEffect(() => {
    const unsub = onPurchaseSuccess(loadState);
    return unsub;
  }, [loadState]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      getLastHomeLottery().then((id) => {
        if (cancelled || !id) return;
        setSelectedLottery((cur) => (cur !== id ? id : cur));
      });
      return () => {
        cancelled = true;
      };
    }, [])
  );

  useEffect(() => {
    if (isIAPAvailable()) {
      getIAPProducts().then(({ astronaut }) => setAstronautRenewalPrice(formatAstronautRenewalPrice(astronaut)));
    }
  }, []);

  useEffect(() => {
    loadSets();
  }, [loadSets]);

  useEffect(() => {
    loadPicksByDate();
  }, [loadPicksByDate]);

  useEffect(() => {
    loadInBookDateKeys();
  }, [loadInBookDateKeys]);

  useEffect(() => {
    const today = getTodayDateString();
    const tp = picksByDate[today];
    const inBook = inBookDateKeys.has(`${selectedLottery}:${today}`);
    if (!tp?.length || inBook) {
      addToPickBookPulse.stopAnimation();
      addToPickBookPulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(addToPickBookPulse, {
          toValue: 1,
          duration: 520,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(addToPickBookPulse, {
          toValue: 0,
          duration: 520,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => {
      loop.stop();
    };
  }, [picksByDate, selectedLottery, inBookDateKeys, addToPickBookPulse]);

  useEffect(() => {
    const check = (email: string | null) => {
      setIsSignedIn(email !== null);
      loadState();
    };
    getCurrentUserEmail().then((email) => check(email));
    return onAuthStateChange(check);
  }, [loadState]);

  useFocusEffect(
    useCallback(() => {
      getCurrentUserEmail().then((email) => {
        setIsSignedIn(email !== null);
        loadState();
        loadSets();
        loadPicksByDate();
        loadInBookDateKeys();
      });
    }, [loadState, loadSets, loadPicksByDate, loadInBookDateKeys])
  );

  const userPicksSpecialCount = ['lotto_max', 'lotto_649'].includes(selectedLottery) ? 0 : (LOTTERY_DEFS[selectedLottery]?.special_count ?? 1);

  useEffect(() => {
    if (!showRefineModal) return;
    const def = LOTTERY_DEFS[selectedLottery];
    const total = (def?.main_count ?? 7) + (['lotto_max', 'lotto_649'].includes(selectedLottery) ? 0 : (def?.special_count ?? 1));
    setWinningNumbersArray((prev) => {
      if (prev.length !== total) return Array(total).fill('');
      return prev;
    });
    setUserPicksArray((prev) => {
      if (prev.length !== total) return Array(total).fill('');
      return prev;
    });
  }, [showRefineModal, selectedLottery]);

  useEffect(() => {
    if (!showRefineModal || !activeSet?.id) {
      setRefineApplyTotalForSet(0);
      return;
    }
    getTotalRefinesForSet(activeSet.id).then(setRefineApplyTotalForSet);
  }, [showRefineModal, activeSet?.id]);

  const loadRefinePickBookRecords = useCallback(async () => {
    if (!activeSet) {
      setRefinePickBookRecords([]);
      return;
    }
    setRefinePickBookLoading(true);
    try {
      const list = await getPickBookRecords({
        sortOrder: 'desc',
        lotteryId: selectedLottery,
        includeFromCheckLines: true,
      });
      setRefinePickBookRecords(list);
    } catch {
      setRefinePickBookRecords([]);
    } finally {
      setRefinePickBookLoading(false);
    }
  }, [selectedLottery, activeSet?.id]);

  useEffect(() => {
    if (showPickBookInRefine) loadRefinePickBookRecords();
  }, [showPickBookInRefine, loadRefinePickBookRecords]);

  useEffect(() => {
    if (!showRefineModal) return;
    setPastDrawsLoading(true);
    setPastDrawsForRefine([]);
    fetchDraws(selectedLottery, 10)
      .then((draws) =>
        setPastDrawsForRefine(
          draws.map((d) => ({
            draw_date: d.draw_date,
            winning_numbers: d.winning_numbers,
            special_numbers: d.special_numbers,
          }))
        )
      )
      .catch(() => setPastDrawsForRefine([]))
      .finally(() => setPastDrawsLoading(false));
  }, [showRefineModal, selectedLottery]);

  useEffect(() => {
    showRefineModalRef.current = showRefineModal;
  }, [showRefineModal]);

  useEffect(() => {
    if (showRefineModal) {
      setRefineWizardStep(1);
      setRefineCountdown(null);
    }
  }, [showRefineModal]);

  const commitPastDrawIndex = useCallback(
    (idx: number, opts?: { forceClearPicks?: boolean }) => {
      const d = pastDrawsForRefine[idx];
      if (!d) return;
      const def = LOTTERY_DEFS[selectedLottery];
      if (!def) return;
      const mainCount = def.main_count ?? 7;
      const specialCount = ['lotto_max', 'lotto_649'].includes(selectedLottery) ? 0 : (def.special_count ?? 1);
      const arr = [
        ...d.winning_numbers.slice(0, mainCount).map(String),
        ...(d.special_numbers || []).slice(0, specialCount).map(String),
      ].slice(0, mainCount + specialCount);
      const changedDate = refineSelectedPastDrawDate !== d.draw_date;
      refineDateWheelIdxRef.current = idx;
      setWinningNumbersArray(Array.from({ length: mainCount + specialCount }, (_, j) => arr[j] ?? ''));
      setRefineSelectedPastDrawDate(d.draw_date);
      if (opts?.forceClearPicks || changedDate) {
        setUserPicksArray(Array(mainCount + specialCount).fill(''));
      }
    },
    [pastDrawsForRefine, selectedLottery, refineSelectedPastDrawDate]
  );

  /** After inertia stops: sync index; only no-op scroll if native snap missed by a few px (no animation = no tug). */
  const finalizeRefineDateWheelScroll = useCallback(
    (y: number) => {
      const n = pastDrawsForRefine.length;
      if (n === 0) return;
      const row = REFINE_DATE_WHEEL_ROW_H;
      const maxY = (n - 1) * row;
      const clamped = Math.max(0, Math.min(maxY, y));
      const idx = Math.min(n - 1, Math.max(0, Math.round(clamped / row)));
      const exactY = idx * row;
      if (Math.abs(y - exactY) > 1.5) {
        refineDateWheelRef.current?.scrollTo({ y: exactY, animated: false });
      }
      if (idx !== refineDateWheelIdxRef.current) {
        commitPastDrawIndex(idx);
      }
    },
    [pastDrawsForRefine, commitPastDrawIndex]
  );

  useEffect(() => {
    if (!showRefineModal || refineWizardStep !== 1 || pastDrawsLoading || pastDrawsForRefine.length === 0) return;
    if (refineSelectedPastDrawDate != null) return;
    commitPastDrawIndex(0, { forceClearPicks: true });
    requestAnimationFrame(() => {
      refineDateWheelRef.current?.scrollTo({ y: 0, animated: false });
    });
  }, [
    showRefineModal,
    refineWizardStep,
    pastDrawsLoading,
    pastDrawsForRefine,
    refineSelectedPastDrawDate,
    commitPastDrawIndex,
  ]);

  useEffect(() => {
    if (!showRefineModal || refineWizardStep !== 1 || pastDrawsForRefine.length === 0 || pastDrawsLoading) return;
    if (refineSelectedPastDrawDate == null) return;
    const idx = pastDrawsForRefine.findIndex((x) => x.draw_date === refineSelectedPastDrawDate);
    const safeIdx = idx < 0 ? 0 : idx;
    refineDateWheelIdxRef.current = safeIdx;
    requestAnimationFrame(() => {
      refineDateWheelRef.current?.scrollTo({ y: safeIdx * REFINE_DATE_WHEEL_ROW_H, animated: false });
    });
  }, [showRefineModal, refineWizardStep, pastDrawsForRefine, pastDrawsLoading, refineSelectedPastDrawDate]);

  const devUnlockRefine = __DEV__ && Platform.OS === 'web';

  const applyAutoPlayStyleChange = useCallback(
    async (next: StrategyPlayStyleId) => {
      const cur = activeSet;
      if (!cur) return;
      const weights = getAutoPilotPresetWeights(next);
      const updated: StrategySet = { ...cur, featureWeights: weights, autoPilotPlayStyle: next };
      await updateStrategySet(updated);
      setActiveSet(updated);
    },
    [activeSet]
  );

  const requestAutoPlayStyle = useCallback(
    (next: StrategyPlayStyleId) => {
      if (!activeSet || mode !== 'auto') return;
      const curStyle = activeSet.autoPilotPlayStyle ?? 'balanced';
      if (next === curStyle) return;

      const title = 'Change play style?';
      const message =
        'Weights will reset to this style’s defaults. The same weights are used in Manual mode.';

      const run = () => {
        void applyAutoPlayStyleChange(next);
      };

      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        if (window.confirm(`${title}\n\n${message}`)) run();
        return;
      }
      Alert.alert(title, message, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Continue', onPress: run },
      ]);
    },
    [activeSet, mode, applyAutoPlayStyleChange]
  );

  const applyPickFromPickBookRecord = useCallback(
    (r: PickBookRecord) => {
      const def = LOTTERY_DEFS[selectedLottery];
      const mainCount = def?.main_count ?? 7;
      const specialCount = userPicksSpecialCount;
      const first = r.picks[0];
      const arr = [
        ...(first?.main ?? []).slice(0, mainCount).map(String),
        ...(first?.special ?? []).slice(0, specialCount).map(String),
      ].slice(0, mainCount + specialCount);
      setUserPicksArray((prev) =>
        Array.from({ length: mainCount + specialCount }, (_, j) => arr[j] ?? '')
      );
      setShowPickBookInRefine(false);
    },
    [selectedLottery, userPicksSpecialCount]
  );

  const onSelectPickBookRecord = useCallback(
    (r: PickBookRecord) => {
      const lastDraw = pastDrawsForRefine[0]?.draw_date;
      if (lastDraw && r.draw_date > lastDraw) {
        const msg =
          'This Pick Book entry is dated after the latest draw. Continue using it for refinement?';
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          if (window.confirm(msg)) applyPickFromPickBookRecord(r);
          return;
        }
        Alert.alert('Date notice', msg, [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Continue', onPress: () => applyPickFromPickBookRecord(r) },
        ]);
        return;
      }
      applyPickFromPickBookRecord(r);
    },
    [pastDrawsForRefine, applyPickFromPickBookRecord]
  );

  const openPickBookFromRefine = useCallback(() => {
    if (refineWizardStep !== 2) {
      showAlert('Step 2', 'Continue to step 2 to choose from Pick Book.');
      return;
    }
    const def = LOTTERY_DEFS[selectedLottery];
    const totalSlots =
      (def?.main_count ?? 7) +
      (['lotto_max', 'lotto_649'].includes(selectedLottery) ? 0 : (def?.special_count ?? 1));
    const winFilled = winningNumbersArray.slice(0, totalSlots).every((s) => s.trim() !== '');
    if (!winFilled) {
      showAlert('Select a past draw', 'Choose a past draw in step 1 first.');
      return;
    }
    setShowPickBookInRefine(true);
  }, [selectedLottery, winningNumbersArray, refineWizardStep]);

  const openRefineManualAddModal = useCallback(() => {
    const def = LOTTERY_DEFS[selectedLottery];
    const total = (def?.main_count ?? 7) + userPicksSpecialCount;
    setRefineManualAddDate(getTodayDateString());
    setRefineManualAddCells(Array(total).fill(''));
    setShowRefineManualAddModal(true);
  }, [selectedLottery, userPicksSpecialCount]);

  const submitRefineManualAdd = useCallback(async () => {
    if (!activeSet) return;
    const def = LOTTERY_DEFS[selectedLottery];
    const mainCount = def?.main_count ?? 7;
    const mainMax = def?.main_max ?? 49;
    const specialMin = def?.special_min ?? 1;
    const specialMax = def?.special_max ?? 49;
    const needsSpecial = !['lotto_max', 'lotto_649'].includes(selectedLottery);
    const spCount = def?.special_count ?? 1;
    const mainPicks: number[] = [];
    for (let i = 0; i < mainCount; i++) {
      const n = parseInt(refineManualAddCells[i]?.trim() ?? '', 10);
      if (isNaN(n)) {
        showAlert('Invalid input', `Enter all ${mainCount} main numbers (${def!.main_min}-${mainMax}).`);
        return;
      }
      mainPicks.push(n);
    }
    const specialPicks: number[] = [];
    if (needsSpecial) {
      for (let j = 0; j < spCount; j++) {
        const n = parseInt(refineManualAddCells[mainCount + j]?.trim() ?? '', 10);
        if (isNaN(n)) {
          showAlert('Invalid input', `Enter all ${spCount} special number(s) (${specialMin}-${def!.special_max ?? 49}).`);
          return;
        }
        specialPicks.push(n);
      }
    }
    if (mainPicks.some((n) => n < def!.main_min || n > mainMax)) {
      showAlert('Invalid input', `Enter ${mainCount} main numbers (${def!.main_min}-${mainMax}).`);
      return;
    }
    if (new Set(mainPicks).size < mainPicks.length) {
      showAlert('Invalid input', 'Main numbers must not contain duplicates.');
      return;
    }
    if (needsSpecial && specialPicks.length < spCount) {
      showAlert('Invalid input', `Enter ${spCount} special number(s) (${specialMin}-${specialMax}).`);
      return;
    }
    if (needsSpecial && specialPicks.some((n) => n < specialMin || n > specialMax)) {
      showAlert('Invalid input', `Special number(s) must be ${specialMin}-${specialMax}.`);
      return;
    }
    if (needsSpecial && new Set(specialPicks).size < specialPicks.length) {
      showAlert('Invalid input', 'Special numbers must not contain duplicates.');
      return;
    }
    const dateStr = refineManualAddDate.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      showAlert('Invalid date', 'Use format YYYY-MM-DD.');
      return;
    }
    const pickLine = {
      main: mainPicks,
      special: needsSpecial ? specialPicks : [],
      explanation: '',
    };
    try {
      const id = await addToPickBook(selectedLottery, dateStr, [pickLine], activeSet.id, activeSet.name);
      if (id) {
        setShowRefineManualAddModal(false);
        await loadRefinePickBookRecords();
        showAlert('Added', 'Pick added to Pick Book.');
      } else {
        showAlert('Already in book', 'A Pick Book entry already exists for this date and strategy.');
      }
    } catch {
      showAlert('Error', 'Could not add to Pick Book.');
    }
  }, [
    activeSet,
    selectedLottery,
    refineManualAddDate,
    refineManualAddCells,
    loadRefinePickBookRecords,
  ]);

  const doGenerate = useCallback(async (history: { winning_numbers: number[]; special_numbers?: number[] }[], drawDate: string) => {
    if (!activeSet) return;
    setLoading(true);
    setCandidates([]);
    try {
      const picks = generateFromStrategySet(selectedLottery, history, activeSet, 1);
      await setGeneratedPicksForDate(selectedLottery, activeSet.id, drawDate, picks);
      await loadPicksByDate();
      setCandidates(picks);
      setStrategyScoreHistory(history);
      setStrategyScoreExpanded(false);
      if (!proUnlocked && mode === 'manual') {
        await incrementStrategyLabTotalUsage();
        await recordStrategyLabGenerateSuccess();
      }
    } catch {
      showAlert('Error', 'Could not generate picks. Try again.');
    } finally {
      setLoading(false);
    }
  }, [selectedLottery, activeSet, proUnlocked, mode, loadPicksByDate]);

  const proceedToGenerateAfterChecks = useCallback(
    async (history: { winning_numbers: number[]; special_numbers?: number[] }[], drawDate: string) => {
      const existingToday = picksByDate[drawDate];
      if (existingToday && existingToday.length > 0) {
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          const ok = window.confirm(
            'You already have generated picks for today. Generating again will replace them. Continue?'
          );
          if (ok) await doGenerate(history, drawDate);
          return;
        }
        Alert.alert(
          'Overwrite previous record?',
          'You already have generated picks for today. Generating again will replace them.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Replace', onPress: () => doGenerate(history, drawDate) },
          ]
        );
        return;
      }
      await doGenerate(history, drawDate);
    },
    [picksByDate, doGenerate]
  );

  const handleGenerate = async () => {
    if (!activeSet) {
      showAlert('Strategy not ready', 'Please wait for your strategy to load, or switch lottery and try again.');
      return;
    }

    let history: { winning_numbers: number[]; special_numbers?: number[] }[];
    const records = await getRecords({ lottery_id: selectedLottery, limit: 50 });
    const fromRecords = records.map((r) => ({
      winning_numbers: r.winning_numbers,
      special_numbers: r.winning_special,
    }));
    if (fromRecords.length >= 2) {
      history = fromRecords;
    } else {
      try {
        const draws = await fetchDraws(selectedLottery, 50);
        history = draws.map((d) => ({
          winning_numbers: d.winning_numbers,
          special_numbers: d.special_numbers,
        }));
      } catch {
        history = [];
      }
      if (history.length < 2) {
        showAlert('Need more data', 'Check at least 2 tickets for this lottery, or ensure draws are available.');
        return;
      }
    }

    const drawDate = getTodayDateString();

    if (!proUnlocked) {
      const gate = await needsRewardGateForGenerate(proUnlocked);
      if (gate) {
        pendingGenerateRef.current = { history, drawDate };
        strategyGateKindRef.current = 'generate';
        setStrategyLabGateKind('generate');
        setStrategyLabGateVisible(true);
        return;
      }
    }

    await proceedToGenerateAfterChecks(history, drawDate);
  };

  const handleKnobCommit = useCallback(async (featureId: FeatureId, next01: number) => {
    let nv = Math.max(0, Math.min(1, Math.round(next01 * 1000) / 1000));
    if (featureId === 'common_pattern_penalty') {
      nv = snapCommonPenalty01(nv);
    }
    setActiveSet((prev) => {
      if (!prev) return prev;
      if (!proUnlocked && isAstronautOnlyFeature(featureId)) return prev;
      const featureWeights = { ...prev.featureWeights, [featureId]: nv };
      const autoPilotPlayStyle = inferNearestPlayStyleId(featureWeights);
      const updated = { ...prev, featureWeights, autoPilotPlayStyle };
      void updateStrategySet(updated);
      return updated;
    });
  }, [proUnlocked]);

  const cycleLuckyBiasStrength = useCallback(async () => {
    if (!activeSet) return;
    const opts = LUCKY_BIAS_OPTIONS;
    const idx = opts.findIndex((o) => o.value === (activeSet.luckyBiasStrength ?? 'off'));
    const nextIdx = (idx + 1) % opts.length;
    const next = opts[nextIdx].value;
    const updated = { ...activeSet, luckyBiasStrength: next };
    await updateStrategySet(updated);
    setActiveSet(updated);
  }, [activeSet]);

  const handleLuckyOnesDigitInput = async (raw: string) => {
    if (!activeSet) return;
    const one = raw.replace(/\D/g, '').slice(0, 1);
    let updated: StrategySet;
    if (one === '') {
      updated = { ...activeSet, luckyOnesDigit: undefined };
    } else {
      const n = parseInt(one, 10);
      if (Number.isNaN(n) || n < 0 || n > 9) return;
      updated = { ...activeSet, luckyOnesDigit: n };
    }
    await updateStrategySet(updated);
    setActiveSet(updated);
  };

  const handleOpenEdit = (featureId: FeatureId) => {
    if (!proUnlocked && isAstronautOnlyFeature(featureId)) {
      setShowPaywall(true);
      return;
    }
    const w = activeSet?.featureWeights[featureId] ?? 0.5;
    setEditingDraft01(featureId === 'common_pattern_penalty' ? snapCommonPenalty01(w) : w);
    setEditingFeature(featureId);
  };

  const dismissTuningSheetSave = useCallback(async () => {
    if (!editingFeature) return;
    const id = editingFeature;
    const draft = editingDraft01;
    await handleKnobCommit(id, draft);
    Animated.timing(tuningSheetAnim, {
      toValue: tuningSheetHideY,
      duration: 260,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setEditingFeature(null);
    });
  }, [editingFeature, editingDraft01, handleKnobCommit, tuningSheetAnim, tuningSheetHideY]);

  useEffect(() => {
    if (!editingFeature) return;
    tuningSheetAnim.setValue(tuningSheetHideY);
    Animated.spring(tuningSheetAnim, {
      toValue: 0,
      useNativeDriver: true,
      tension: 68,
      friction: 12,
    }).start();
  }, [editingFeature, tuningSheetAnim, tuningSheetHideY]);

  const validateRefineInputs = useCallback((): boolean => {
    if (!activeSet) return false;
    const def = LOTTERY_DEFS[selectedLottery];
    if (!def) return false;
    const mainCount = def.main_count ?? 7;
    const mainMax = def.main_max ?? 49;
    const specialMin = def.special_min ?? 1;
    const specialMax = def.special_max ?? 49;

    const winning = winningNumbersArray
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n));
    const picks = userPicksArray
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n));

    const mainWinning = winning.slice(0, mainCount);
    const specialWinning = winning.slice(mainCount);
    const needsSpecialWinning = !['lotto_max', 'lotto_649'].includes(selectedLottery);
    if (mainWinning.length < mainCount || mainWinning.some((n) => n < def.main_min || n > mainMax)) {
      showAlert('Invalid input', `Enter ${mainCount} winning numbers (${def.main_min}-${mainMax}).`);
      return false;
    }
    if (new Set(mainWinning).size < mainWinning.length) {
      showAlert('Invalid input', 'Winning numbers must not contain duplicates.');
      return false;
    }
    if (needsSpecialWinning && specialWinning.length < (def.special_count ?? 1)) {
      showAlert('Invalid input', `Enter ${def.special_count ?? 1} winning special number(s) (${specialMin}-${specialMax}).`);
      return false;
    }
    if (needsSpecialWinning && specialWinning.length > 0 && specialWinning.some((n) => n < specialMin || n > specialMax)) {
      showAlert('Invalid input', `Winning special number(s) must be ${specialMin}-${specialMax}.`);
      return false;
    }
    const mainPicks = picks.slice(0, mainCount);
    const specialPicks = picks.slice(mainCount);
    const needsSpecialPicks = !['lotto_max', 'lotto_649'].includes(selectedLottery);
    if (mainPicks.length < mainCount || mainPicks.some((n) => n < def.main_min || n > mainMax)) {
      showAlert('Invalid input', `Enter ${mainCount} main numbers (${def.main_min}-${mainMax}) in your picks.`);
      return false;
    }
    const mainSet = new Set(mainPicks);
    if (mainSet.size < mainPicks.length) {
      showAlert('Invalid input', 'Your picks must not contain duplicate main numbers.');
      return false;
    }
    if (needsSpecialPicks && specialPicks.length < (def.special_count ?? 1)) {
      showAlert('Invalid input', `Enter ${def.special_count ?? 1} special number(s) (${specialMin}-${specialMax}).`);
      return false;
    }
    if (needsSpecialPicks && specialPicks.length > 0 && specialPicks.some((n) => n < specialMin || n > specialMax)) {
      showAlert('Invalid input', `Special number(s) must be ${specialMin}-${specialMax}.`);
      return false;
    }
    if (needsSpecialPicks && new Set(specialPicks).size < specialPicks.length) {
      showAlert('Invalid input', 'Your picks must not contain duplicate special numbers.');
      return false;
    }
    return true;
  }, [activeSet, selectedLottery, winningNumbersArray, userPicksArray]);

  const doRefine = useCallback(async () => {
    if (!activeSet) return;
    if (!validateRefineInputs()) return;
    const def = LOTTERY_DEFS[selectedLottery];
    if (!def) return;
    const mainCount = def.main_count ?? 7;
    const mainMax = def.main_max ?? 49;

    const winning = winningNumbersArray
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n));
    const picks = userPicksArray
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n));
    const mainWinning = winning.slice(0, mainCount);
    const mainPicks = picks.slice(0, mainCount);
    const picksForShape = mainPicks;

    setRefineLoading(true);
    setRefineProposal(null);

    try {
      const picksShape = computeShapeSummary(picksForShape, mainMax);
      const outcomeShape = computeShapeSummary(mainWinning, mainMax);
      const deltaSummary = computeDeltaSummary(picksShape, outcomeShape);

      const proposal = computeRefineProposal({
        strategySetId: activeSet.id,
        lotteryId: selectedLottery,
        mainMax,
        picksShapeSummary: picksShape,
        luckyBiasStrength: activeSet.luckyBiasStrength,
        outcomeShapeSummary: {
          matchCountMain: 0,
          matchCountSpecial: 0,
          resultBucket: 'unknown',
        },
        deltaSummary,
      });

      const refinedDeltas = filterRefineDeltasForPlan(proposal.deltas, proUnlocked);
      const astronautUpsellNote =
        !proUnlocked && proposal.deltas.some((d) => isAstronautOnlyFeature(d.featureId as FeatureId))
          ? 'Suggestions that target Astronaut-only weights were skipped. Upgrade for full Refine on Risk, Sum deviation, gaps, and Edge/Mid.'
          : undefined;

      setRefineProposal({
        deltas: refinedDeltas.map((d) => ({
          featureId: d.featureId,
          direction: d.direction,
          magnitude: d.magnitude,
        })),
        reasoning: proposal.reasoning,
        astronautUpsellNote,
      });
      if (!proUnlocked && mode === 'manual') {
        await recordStrategyLabRefineSuccess();
      }
    } catch {
      setRefineProposal(null);
    } finally {
      setRefineLoading(false);
    }
  }, [
    activeSet,
    selectedLottery,
    winningNumbersArray,
    userPicksArray,
    proUnlocked,
    mode,
    validateRefineInputs,
  ]);

  const runCountdownAndRefine = useCallback(async () => {
    if (!validateRefineInputs()) return;
    const secs = 3 + Math.floor(Math.random() * 3);
    for (let left = secs; left > 0; left--) {
      if (!showRefineModalRef.current) {
        setRefineCountdown(null);
        return;
      }
      setRefineCountdown(left);
      await new Promise<void>((r) => setTimeout(r, 1000));
    }
    setRefineCountdown(null);
    await doRefine();
  }, [validateRefineInputs, doRefine]);

  const handleRefine = async () => {
    if (!activeSet) return;
    if (!validateRefineInputs()) return;
    if (!proUnlocked && !devUnlockRefine) {
      if (await needsRewardGateForRefine(proUnlocked)) {
        strategyGateKindRef.current = 'refine';
        setStrategyLabGateKind('refine');
        setStrategyLabGateVisible(true);
        return;
      }
    }
    await runCountdownAndRefine();
  };

  const handleStrategyLabGateWatchAd = async () => {
    if (Platform.OS === 'web') {
      showAlert(
        'Not available on web',
        'Rewarded ads are not available in the browser. Use the iOS or Android app, or upgrade to Astronaut plan.'
      );
      return;
    }
    const ok = await showRewardedAdForStrategyLab();
    if (!ok) {
      showAlert('Ad required', REWARDED_AD_MESSAGES.adLoadFailed);
      return;
    }
    setStrategyLabGateVisible(false);
    await new Promise<void>((resolve) => {
      InteractionManager.runAfterInteractions(() => resolve());
    });
    const kind = strategyGateKindRef.current;
    if (kind === 'generate') {
      await setStrategyLabGenerateCountAfterAd();
      const p = pendingGenerateRef.current;
      pendingGenerateRef.current = null;
      if (p) await proceedToGenerateAfterChecks(p.history, p.drawDate);
    } else {
      await setStrategyLabRefineCountAfterAd();
      await runCountdownAndRefine();
    }
  };

  const handleStrategyLabGateSignIn = () => {
    setStrategyLabGateVisible(false);
    (navigation as { navigate: (s: string) => void }).navigate('Login');
  };

  const handleStrategyLabGateTrialOrUpgrade = () => {
    setStrategyLabGateVisible(false);
    setShowPaywall(true);
  };

  const resetRefineModalState = useCallback(() => {
    setRefineProposal(null);
    setShowPickBookInRefine(false);
    setShowRefineManualAddModal(false);
    setRefineSelectedPastDrawDate(null);
    setRefineWizardStep(1);
    setRefineCountdown(null);
    setWinningNumbersArray([]);
    setUserPicksArray([]);
  }, []);

  const closeRefineModal = useCallback(() => {
    const hideY = Dimensions.get('window').height;
    Animated.timing(refineSheetAnim, {
      toValue: hideY,
      duration: 260,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) return;
      setShowRefineModal(false);
      resetRefineModalState();
    });
  }, [refineSheetAnim, resetRefineModalState]);

  useLayoutEffect(() => {
    if (!showRefineModal) return;
    const h = Dimensions.get('window').height;
    refineSheetAnim.setValue(h);
    requestAnimationFrame(() => {
      Animated.spring(refineSheetAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 68,
        friction: 12,
      }).start();
    });
  }, [showRefineModal, refineSheetAnim]);

  const handleConfirmRefine = async () => {
    if (!refineProposal || !activeSet) return;
    try {
      let updated = await applyFeatureAdjustment(
        activeSet,
        refineProposal.deltas.map((d) => ({
          featureId: d.featureId as FeatureId,
          direction: d.direction as 'increase' | 'decrease',
          magnitude: d.magnitude,
        }))
      );
      const style = inferNearestPlayStyleId(updated.featureWeights);
      if (style !== (updated.autoPilotPlayStyle ?? 'balanced')) {
        updated = { ...updated, autoPilotPlayStyle: style };
        await updateStrategySet(updated);
      }
      setActiveSet(updated);
      const nextTotal = await incrementRefineTotalForSet(activeSet.id);
      setRefineApplyTotalForSet(nextTotal);
      closeRefineModal();
    } catch {
      showAlert('Error', 'Failed to apply refinement.');
    }
  };


  const handlePurchasePro = async () => {
    try {
      if (isSignedIn !== true && isIAPAvailable()) {
        setShowPaywall(false);
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          if (window.confirm('Sign in first to sync your purchases across devices. Go to Sign in?')) {
            navigation.navigate('Login');
          }
          return;
        }
        Alert.alert('Sign in first', 'Sign in to sync your purchases across devices.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Sign in', onPress: () => navigation.navigate('Login') },
        ]);
        return;
      }
      setShowPaywall(false);
      if (isIAPAvailable()) {
        await purchaseAstronaut();
        return;
      }
      // Web / dev fallback: unlock locally
      await setProUnlocked(true);
      await setHadAstronautEntitlement();
      loadState();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const isAlreadySubscribed = /already subscribed|already own|already owned|E_ALREADY_OWNED|ITEM_ALREADY_OWNED|ITEM_OWNED|active subscription/i.test(msg);
      if (isAlreadySubscribed) {
        let ok = await restoreIAPPurchases();
        if (!ok) {
          await setProUnlocked(true);
          await setHadAstronautEntitlement();
        }
        loadState();
        notifyEntitlementsChange();
        return;
      }
      showAlert('Purchase failed', msg || 'Could not complete purchase.');
    }
  };

  const categories: FeatureCategory[] = ['structure', 'position', 'trend', 'risk'];
  const showStrategyLabBanners = shouldShowStrategyLabBannerAds(plan, proUnlocked);

  const renderLotteryDropdown = () => (
    <View style={styles.lotteryDropdownWrap}>
      <TouchableOpacity
        style={styles.lotteryDropdownTrigger}
        onPress={() => {
          setPlayStyleDropdownOpen(false);
          setLotteryDropdownOpen((o) => !o);
        }}
        activeOpacity={0.75}
      >
        <Text style={styles.lotteryDropdownTriggerText} numberOfLines={1}>
          {LOTTERY_DEFS[selectedLottery].name}
        </Text>
        <Ionicons
          name={lotteryDropdownOpen ? 'chevron-up' : 'chevron-down'}
          size={20}
          color={COLORS.gold}
        />
      </TouchableOpacity>
      {lotteryDropdownOpen && (
        <View style={styles.lotteryDropdownMenu}>
          {(Object.keys(LOTTERY_DEFS) as LotteryId[]).map((id, idx, arr) => (
            <TouchableOpacity
              key={id}
              style={[
                styles.lotteryDropdownItem,
                idx === arr.length - 1 && styles.lotteryDropdownItemLast,
                selectedLottery === id && styles.lotteryDropdownItemActive,
              ]}
              onPress={() => {
                setSelectedLottery(id);
                void setLastHomeLottery(id);
                setLotteryDropdownOpen(false);
              }}
            >
              <Text
                style={[styles.lotteryDropdownItemText, selectedLottery === id && styles.lotteryDropdownItemTextActive]}
              >
                {LOTTERY_DEFS[id].name}
              </Text>
              {selectedLottery === id && <Ionicons name="checkmark" size={18} color={COLORS.gold} />}
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );

  const renderPlayStyleDropdown = () => {
    if (!activeSet || mode !== 'auto') return null;
    const cur = activeSet.autoPilotPlayStyle ?? 'balanced';
    return (
      <View style={styles.autoPlayStyleBlock}>
        <Text style={styles.autoPlayStyleLabel}>Play style</Text>
        <View style={styles.autoPlayStyleDropdownWrap}>
          <TouchableOpacity
            style={styles.lotteryDropdownTrigger}
            onPress={() => {
              setLotteryDropdownOpen(false);
              setPlayStyleDropdownOpen((o) => !o);
            }}
            activeOpacity={0.75}
          >
            <Text style={styles.lotteryDropdownTriggerText} numberOfLines={1}>
              {STRATEGY_PLAY_STYLE_SHORT[cur]}
            </Text>
            <Ionicons
              name={playStyleDropdownOpen ? 'chevron-up' : 'chevron-down'}
              size={20}
              color={COLORS.gold}
            />
          </TouchableOpacity>
          {playStyleDropdownOpen && (
            <View style={styles.lotteryDropdownMenu}>
              {STRATEGY_PLAY_STYLE_IDS.map((id, idx, arr) => (
                <TouchableOpacity
                  key={id}
                  style={[
                    styles.lotteryDropdownItem,
                    idx === arr.length - 1 && styles.lotteryDropdownItemLast,
                    cur === id && styles.lotteryDropdownItemActive,
                  ]}
                  onPress={() => {
                    setPlayStyleDropdownOpen(false);
                    requestAutoPlayStyle(id);
                  }}
                >
                  <Text style={[styles.lotteryDropdownItemText, cur === id && styles.lotteryDropdownItemTextActive]}>
                    {STRATEGY_PLAY_STYLE_SHORT[id]}
                  </Text>
                  {cur === id ? <Ionicons name="checkmark" size={18} color={COLORS.gold} /> : null}
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      </View>
    );
  };

  const renderPersonalBiasPanel = (opts?: { showHeader?: boolean }) => {
    if (!activeSet) return null;
    const showHeader = opts?.showHeader !== false;
    return (
      <View
        style={[
          styles.tuningCategoryPanel,
          { backgroundColor: PERSONAL_BIAS_PANEL.bg, borderColor: PERSONAL_BIAS_PANEL.border },
        ]}
      >
        {showHeader ? (
          <View style={styles.tuningCategoryTitleRow}>
            <Ionicons name="heart-outline" size={26} color={PERSONAL_BIAS_ACCENT} />
            <Text style={[styles.tuningCategoryTitle, { color: PERSONAL_BIAS_ACCENT }]}>Personal Bias</Text>
          </View>
        ) : null}

        <View style={styles.personalBiasFeatureBlock}>
          <View style={styles.personalBiasTitleRow}>
            <Text style={[styles.personalBiasFeatureTitle, { flex: 1 }]}>Lucky bias</Text>
            <TouchableOpacity
              style={styles.luckyBiasStrengthTap}
              onPress={() => void cycleLuckyBiasStrength()}
              accessibilityRole="button"
              accessibilityLabel={`Lucky bias ${
                LUCKY_BIAS_OPTIONS.find((o) => o.value === (activeSet.luckyBiasStrength ?? 'off'))?.label ?? 'Off'
              }, tap to increase`}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <View style={styles.luckyBiasHeartRow}>
                {[0, 1, 2].map((i) => (
                  <Ionicons
                    key={i}
                    name={i < luckyBiasCurIdx ? 'heart' : 'heart-outline'}
                    size={22}
                    color={i < luckyBiasCurIdx ? COLORS.gold : PERSONAL_BIAS_ACCENT}
                  />
                ))}
              </View>
            </TouchableOpacity>
          </View>
          <Text style={styles.personalBiasIndication}>
            {luckyBiasIndicationLine(activeSet.luckyBiasStrength)}
          </Text>
        </View>

        <View style={styles.tuningFeatureRowDivider} />

        <View style={styles.personalBiasFeatureBlock}>
          <View style={styles.personalBiasTitleRow}>
            <Text style={[styles.personalBiasFeatureTitle, { flex: 1 }]}>Lucky digit (0–9)</Text>
            <TextInput
              style={styles.luckyDigitInput}
              value={activeSet.luckyOnesDigit !== undefined ? String(activeSet.luckyOnesDigit) : ''}
              onChangeText={(t) => void handleLuckyOnesDigitInput(t)}
              placeholder="—"
              placeholderTextColor={COLORS.textMuted}
              keyboardType="number-pad"
              maxLength={1}
              selectTextOnFocus
            />
          </View>
          <Text style={styles.personalBiasIndication}>{luckyDigitIndicationLine(activeSet.luckyOnesDigit)}</Text>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.screenWrap}>
      <View style={[styles.stickyHeader, { paddingTop: insets.top + SPACING.screenPadding }]}>
        <View style={styles.content}>
          <View style={styles.headerRow}>
            <Ionicons name="flask" size={24} color={COLORS.gold} style={styles.titleIcon} />
            <Text style={styles.title}>Strategy Lab</Text>
            <View style={styles.headerRightActions}>
              <TouchableOpacity
                onPress={() => navigation.navigate('PickBook' as never)}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                accessibilityLabel="Pick Book"
                accessibilityRole="button"
              >
                <Ionicons name="book-outline" size={22} color={COLORS.gold} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setShowStrategyLabGuide(true)}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                accessibilityLabel="Strategy Lab guide"
                accessibilityRole="button"
              >
                <Ionicons name="bulb-outline" size={22} color={COLORS.gold} />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>

      <View style={styles.modeDock}>
        <View style={styles.content}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Mode</Text>
            <Text style={styles.cardDesc}>
              Auto Pilot (Astronaut plan only) for quick picks. Manual for full control.
            </Text>
            <View style={styles.modeToggleRow}>
              <TouchableOpacity
                style={[
                  styles.modeToggleBtn,
                  mode === 'auto' && proUnlocked && styles.modeToggleBtnActive,
                  !proUnlocked && styles.modeToggleBtnLocked,
                ]}
                onPress={() => {
                  if (proUnlocked) {
                    setMode('auto');
                  } else {
                    setShowPaywall(true);
                  }
                }}
                activeOpacity={0.85}
                accessibilityLabel={proUnlocked ? 'Auto Pilot' : 'Auto Pilot, Astronaut only'}
                accessibilityRole="button"
              >
                <Ionicons
                  name={proUnlocked ? 'rocket-outline' : 'lock-closed-outline'}
                  size={16}
                  color={mode === 'auto' && proUnlocked ? COLORS.bg : COLORS.gold}
                />
                <Text style={[styles.modeToggleText, mode === 'auto' && proUnlocked && styles.modeToggleTextActive]}>
                  Auto Pilot
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modeToggleBtn, mode === 'manual' && styles.modeToggleBtnActive]}
                onPress={() => setMode('manual')}
                activeOpacity={0.85}
              >
                <Ionicons name="hand-left-outline" size={16} color={mode === 'manual' ? COLORS.bg : COLORS.gold} />
                <Text style={[styles.modeToggleText, mode === 'manual' && styles.modeToggleTextActive]}>Manual</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>

      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingTop: 12, paddingBottom: SPACING.screenPaddingBottom }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={true}
      >

      <Modal visible={strategyLabGateVisible} transparent animationType="fade">
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setStrategyLabGateVisible(false)}>
          <TouchableOpacity activeOpacity={1} onPress={(e) => e.stopPropagation()} style={styles.strategyGateCard}>
            <Text style={styles.strategyGateTitle}>Continue with Strategy Lab</Text>
            <Text style={styles.strategyGateMsg}>
              {strategyLabGateKind === 'generate'
                ? "You've completed 2 Generate runs. Watch a rewarded ad, or subscribe to Astronaut for unlimited Strategy Lab access."
                : "You've completed 2 Refine runs. Watch a rewarded ad, or subscribe to Astronaut for unlimited Strategy Lab access."}
            </Text>
            <TouchableOpacity style={styles.strategyGatePrimary} onPress={handleStrategyLabGateWatchAd}>
              <Text style={styles.strategyGatePrimaryText}>Watch ad</Text>
            </TouchableOpacity>
            {isSignedIn !== true && (
              <TouchableOpacity style={styles.strategyGateSecondary} onPress={handleStrategyLabGateSignIn}>
                <Text style={styles.strategyGateSecondaryText}>Sign in to subscribe</Text>
              </TouchableOpacity>
            )}
            {isSignedIn === true && (
              <TouchableOpacity style={styles.strategyGateSecondary} onPress={handleStrategyLabGateTrialOrUpgrade}>
                <Text style={styles.strategyGateSecondaryText}>
                  {hadAstronautSubscription ? 'Subscribe to Astronaut' : 'Start 1-month free trial'}
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.strategyGateCancel} onPress={() => setStrategyLabGateVisible(false)}>
              <Text style={styles.strategyGateCancelText}>Cancel</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {showStrategyLabBanners && (
        <View style={styles.modeLotteryBannerWrap}>
          <BannerAdPlaceholder testId="strategy-lab-mode-lottery" shouldShowBanner />
        </View>
      )}

      {mode === 'manual' && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Lottery</Text>
          <Text style={styles.cardDesc}>Pick the game first. Each lottery keeps its own saved strategy on this device.</Text>
          {renderLotteryDropdown()}
        </View>
      )}

      {activeSet && mode === 'manual' && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Tuning</Text>
          {categories.map((cat) => {
            const features = STRATEGY_FEATURES.filter((f) => f.category === cat);
            if (features.length === 0) return null;
            const color = FEATURE_CATEGORY_COLORS[cat];
            const panel = TUNING_CATEGORY_PANEL[cat];
            return (
              <View
                key={cat}
                style={[
                  styles.tuningCategoryPanel,
                  { backgroundColor: panel.bg, borderColor: panel.border },
                ]}
              >
                <View style={styles.tuningCategoryTitleRow}>
                  {cat === 'position' ? (
                    <Ionicons name="flask" size={26} color={COLORS.gold} />
                  ) : cat === 'trend' ? (
                    <Ionicons name="trending-up" size={26} color={COLORS.gold} />
                  ) : cat === 'risk' ? (
                    <MaterialCommunityIcons name="car-shift-pattern" size={26} color={COLORS.gold} />
                  ) : (
                    <Ionicons name="cog-outline" size={26} color={COLORS.gold} />
                  )}
                  <Text style={[styles.tuningCategoryTitle, { color: COLORS.gold }]}>{tuningCategoryTitle(cat)}</Text>
                </View>
                {features.map((f, rowIdx) => {
                  const w = activeSet.featureWeights[f.id] ?? 0.5;
                  const locked = !proUnlocked && isAstronautOnlyFeature(f.id as FeatureId);
                  return (
                    <View key={f.id} style={rowIdx > 0 ? styles.tuningFeatureRowDivider : undefined}>
                      <TuningWeightSpectrumRow
                        feature={f}
                        weight01={w}
                        accentColor={color}
                        locked={locked}
                        onOpenSheet={() => handleOpenEdit(f.id as FeatureId)}
                        onPaywall={() => setShowPaywall(true)}
                        onCommitWeight01={
                          f.id === 'common_pattern_penalty'
                            ? (nv) => {
                                void handleKnobCommit('common_pattern_penalty', nv);
                              }
                            : undefined
                        }
                      />
                    </View>
                  );
                })}
              </View>
            );
          })}
          {renderPersonalBiasPanel()}
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Generate Picks</Text>
        {mode === 'auto' && renderLotteryDropdown()}
        {renderPlayStyleDropdown()}
        {mode === 'auto' && activeSet ? (
          <View style={styles.autoPersonalBiasFold}>
            <View style={styles.autoPersonalBiasHeaderRow}>
              <Text style={styles.autoPersonalBiasFoldTitle}>Personal Bias</Text>
              <Switch
                value={autoPersonalBiasExpanded}
                onValueChange={setAutoPersonalBiasExpanded}
                accessibilityLabel="Show or hide Personal Bias controls"
                trackColor={{ false: COLORS.bgElevated, true: 'rgba(212, 175, 55, 0.35)' }}
                thumbColor={autoPersonalBiasExpanded ? COLORS.gold : COLORS.textMuted}
                ios_backgroundColor={COLORS.bgElevated}
              />
            </View>
            {autoPersonalBiasExpanded ? (
              <View style={styles.autoPersonalBiasExpandedBody}>{renderPersonalBiasPanel({ showHeader: false })}</View>
            ) : null}
          </View>
        ) : null}
        <TouchableOpacity
          style={[styles.generateBtn, (!activeSet || loading) && styles.generateBtnDisabled]}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          onPress={() => {
            if (!activeSet) {
              showAlert('Please wait', 'Your strategy is still loading. Try again in a moment.');
              return;
            }
            if (loading) return;
            handleGenerate().catch((err) => {
              showAlert('Error', err instanceof Error ? err.message : 'Could not generate picks. Try again.');
            });
          }}
          activeOpacity={0.7}
        >
          {loading ? (
            <ActivityIndicator size="small" color={COLORS.text} />
          ) : (
            <>
              <Ionicons name="sparkles" size={20} color={COLORS.text} style={styles.btnIcon} />
              <Text style={styles.generateBtnText}>Generate Picks</Text>
            </>
          )}
        </TouchableOpacity>
        {(() => {
          const today = getTodayDateString();
          const todayPicks = picksByDate[today];
          return todayPicks && todayPicks.length > 0 ? (
          <View style={styles.results}>
            <Text style={styles.resultsTitle}>Generated picks ({today})</Text>
            <View key={today} style={styles.dateGroup}>
              <View style={styles.dateGroupHeader}>
                <Text style={styles.dateGroupTitle}>{today}</Text>
                <Animated.View
                  style={{
                    transform: [
                      {
                        scale: addToPickBookPulse.interpolate({
                          inputRange: [0, 1],
                          outputRange: [1, 1.08],
                        }),
                      },
                    ],
                  }}
                >
                  <TouchableOpacity
                    style={[
                      styles.addToPickBookBtn,
                      inBookDateKeys.has(`${selectedLottery}:${today}`) && styles.addToPickBookBtnDisabled,
                    ]}
                    onPress={async () => {
                      if (!activeSet) return;
                      if (inBookDateKeys.has(`${selectedLottery}:${today}`)) return;
                      try {
                        const id = await addToPickBook(
                          selectedLottery,
                          today,
                          todayPicks,
                          activeSet.id,
                          activeSet.name
                        );
                        if (id) {
                          setInBookDateKeys((prev) => new Set(prev).add(`${selectedLottery}:${today}`));
                          showAlert('Added', `${today} picks added to Pick Book.`);
                        } else {
                          showAlert('Already in book', 'This date is already in Pick Book.');
                          loadInBookDateKeys();
                        }
                      } catch {
                        showAlert('Error', 'Could not add to Pick Book.');
                      }
                    }}
                    disabled={inBookDateKeys.has(`${selectedLottery}:${today}`)}
                  >
                    <Ionicons
                      name="book-outline"
                      size={16}
                      color={inBookDateKeys.has(`${selectedLottery}:${today}`) ? COLORS.textMuted : COLORS.gold}
                    />
                    <Text
                      style={[
                        styles.addToPickBookText,
                        inBookDateKeys.has(`${selectedLottery}:${today}`) && styles.addToPickBookTextDisabled,
                      ]}
                    >
                      {inBookDateKeys.has(`${selectedLottery}:${today}`) ? 'In Pick Book' : 'Add to Pick Book'}
                    </Text>
                  </TouchableOpacity>
                </Animated.View>
              </View>
              {todayPicks.map((p, i) => (
                <View key={`${today}-${i}`} style={styles.pickCard}>
                  <View style={styles.ballRow}>
                    {p.main.map((n, j) => (
                      <View key={j} style={styles.ball}>
                        <Text style={styles.ballText}>{n}</Text>
                      </View>
                    ))}
                    {p.special.map((n, j) => (
                      <View key={j} style={[styles.ball, styles.ballSpecial]}>
                        <Text style={styles.ballText}>{n}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              ))}
              {strategyScoreSummary ? (
                <View style={styles.strategyScoreBlock}>
                  <View style={styles.strategyScoreCollapsedRow}>
                    <Pressable
                      style={({ pressed }) => [styles.strategyScoreCollapsedLeft, pressed && styles.strategyScorePressed]}
                      onPress={() => setStrategyScoreExpanded((e) => !e)}
                      accessibilityRole="button"
                      accessibilityState={{ expanded: strategyScoreExpanded }}
                      accessibilityLabel={`${strategyScoreSummary.tier.title}, score ${strategyScoreSummary.bestScoreDisplay}. ${strategyScoreExpanded ? 'Hide details' : 'Show details'}`}
                      hitSlop={{ top: 8, bottom: 8, right: 4 }}
                    >
                      <Text style={styles.strategyScoreCollapsedTier} numberOfLines={1} ellipsizeMode="tail">
                        {strategyScoreSummary.tier.emoji} {strategyScoreSummary.tier.title}
                      </Text>
                    </Pressable>
                    <Pressable
                      style={({ pressed }) => [styles.strategyScoreCollapsedRight, pressed && styles.strategyScorePressed]}
                      onPress={() => setStrategyScoreExpanded((e) => !e)}
                      accessibilityRole="button"
                      accessibilityLabel={strategyScoreExpanded ? 'Collapse score details' : 'Expand score details'}
                      hitSlop={{ top: 12, bottom: 12, left: 8, right: 12 }}
                    >
                      <Text style={styles.strategyScoreCollapsedValue}>{strategyScoreSummary.bestScoreDisplay}</Text>
                      <Ionicons
                        name={strategyScoreExpanded ? 'chevron-up' : 'chevron-down'}
                        size={22}
                        color={COLORS.gold}
                      />
                    </Pressable>
                  </View>
                  {strategyScoreExpanded ? (
                    <View style={styles.strategyScoreResultCard}>
                      <Text style={styles.strategyPercentileLine}>
                        Better than {strategyScoreSummary.percentileRough}% of valid combinations
                      </Text>

                      <Text style={styles.strategyWhyTitle}>Why this works</Text>
                      {strategyScoreSummary.factors.map((f, idx) => (
                        <View key={idx} style={styles.strategyFactorRow}>
                          <Text
                            style={[
                              styles.strategyFactorIcon,
                              f.kind === 'risk' && styles.strategyFactorIconRisk,
                            ]}
                          >
                            {f.kind === 'positive' ? '✓' : '⚠'}
                          </Text>
                          <Text
                            style={[styles.strategyFactorText, f.kind === 'risk' && styles.strategyFactorTextRisk]}
                          >
                            {f.text}
                          </Text>
                        </View>
                      ))}

                      <Text style={styles.strategyPlayLabel}>Play style</Text>
                      <Text style={styles.strategyPlayValue}>
                        {STRATEGY_PLAY_STYLE_SHORT[activeSet?.autoPilotPlayStyle ?? 'balanced']}
                      </Text>

                      <Text style={styles.strategyScoreFootnote}>
                        Score reflects strategy alignment, not winning probability.
                      </Text>
                    </View>
                  ) : null}
                </View>
              ) : (
                <Text style={styles.strategyScorePending}>Strategy Score appears here once draw history is loaded (min. 2 draws).</Text>
              )}
            </View>
          </View>
          ) : null;
        })()}
      </View>

      <View style={styles.refineBtnRow}>
        <TouchableOpacity style={styles.refineBtn} onPress={() => setShowRefineModal(true)}>
          <Ionicons name="construct" size={22} color={COLORS.text} style={styles.refineBtnIcon} />
          <Text style={styles.refineBtnText}>Refine Strategy</Text>
        </TouchableOpacity>
        {devUnlockRefine && (
          <Text style={[styles.upgradeHint, styles.refineDevHint]}>Dev: Refine Strategy unlocked for web testing</Text>
        )}
      </View>

      <Modal
        visible={editingFeature !== null}
        transparent
        animationType="none"
        onRequestClose={dismissTuningSheetSave}
      >
        <View style={styles.tuningSheetRoot}>
          <Pressable style={styles.tuningSheetBackdrop} onPress={dismissTuningSheetSave} />
          {editingFeature ? (
            (() => {
              const fd = STRATEGY_FEATURES.find((x) => x.id === editingFeature);
              if (!fd) return null;
              const accent = FEATURE_CATEGORY_COLORS[fd.category];
              return (
                <Animated.View
                  style={[
                    styles.tuningBottomSheet,
                    {
                      transform: [{ translateY: tuningSheetAnim }],
                      paddingBottom: Math.max(insets.bottom, 16),
                    },
                  ]}
                >
                  <View style={styles.tuningSheetHandle} />
                  <Text style={styles.editModalTitle}>{fd.label}</Text>
                  <ScrollView
                    style={styles.tuningModalBodyScroll}
                    showsVerticalScrollIndicator
                    keyboardShouldPersistTaps="handled"
                    nestedScrollEnabled
                  >
                    <Text style={styles.tuningModalDetail}>{getFeatureDetailCopy(fd)}</Text>
                  </ScrollView>
                  <TextInput
                    style={styles.tuningModalValueInput}
                    value={
                      fd.id === 'common_pattern_penalty'
                        ? String(commonPenaltyLevelFrom01(editingDraft01))
                        : String(Math.round(editingDraft01 * 100))
                    }
                    onChangeText={(raw) => {
                      if (fd.id === 'common_pattern_penalty') {
                        const d = raw.replace(/\D/g, '');
                        if (d === '') {
                          setEditingDraft01(0);
                          return;
                        }
                        let n = parseInt(d, 10);
                        if (Number.isNaN(n)) return;
                        n = Math.max(0, Math.min(COMMON_PENALTY_LEVEL_MAX, n));
                        setEditingDraft01(snapCommonPenalty01(n / COMMON_PENALTY_LEVEL_MAX));
                        return;
                      }
                      const d = raw.replace(/\D/g, '');
                      if (d === '') {
                        setEditingDraft01(0);
                        return;
                      }
                      let n = parseInt(d, 10);
                      if (Number.isNaN(n)) return;
                      n = Math.max(0, Math.min(100, n));
                      setEditingDraft01(n / 100);
                    }}
                    keyboardType="number-pad"
                    maxLength={fd.id === 'common_pattern_penalty' ? 1 : 3}
                    selectTextOnFocus
                    selectionColor={accent}
                  />
                  <View style={styles.tuningSheetSliderBlock}>
                    <View style={styles.tuningSheetPoleRow}>
                      <Text style={styles.tuningSheetPoleLeft} numberOfLines={3}>
                        {fd.spectrumLeft}
                      </Text>
                      <Text style={styles.tuningSheetPoleRight} numberOfLines={3}>
                        {fd.spectrumRight}
                      </Text>
                    </View>
                    <Slider
                      style={styles.tuningModalSliderFull}
                      minimumValue={0}
                      maximumValue={fd.id === 'common_pattern_penalty' ? COMMON_PENALTY_LEVEL_MAX : 100}
                      step={1}
                      value={
                        fd.id === 'common_pattern_penalty'
                          ? commonPenaltyLevelFrom01(editingDraft01)
                          : Math.round(editingDraft01 * 100)
                      }
                      onValueChange={(v) =>
                        setEditingDraft01(
                          fd.id === 'common_pattern_penalty' ? snapCommonPenalty01(v / COMMON_PENALTY_LEVEL_MAX) : v / 100
                        )
                      }
                      minimumTrackTintColor={accent}
                      maximumTrackTintColor="rgba(255,255,255,0.22)"
                      thumbTintColor={accent}
                    />
                  </View>
                  {showStrategyLabBanners ? (
                    <View style={styles.tuningModalBanner}>
                      <BannerAdPlaceholder testId="strategy-lab-tuning-modal" shouldShowBanner />
                    </View>
                  ) : null}
                </Animated.View>
              );
            })()
          ) : null}
        </View>
      </Modal>

      <Modal visible={showRefineModal} transparent animationType="none" onRequestClose={closeRefineModal}>
        <View style={styles.refineSheetRoot}>
          <Pressable style={styles.refineSheetBackdrop} onPress={closeRefineModal} accessibilityLabel="Dismiss" />
          <Animated.View
            style={[
              styles.refineSheetSheet,
              {
                transform: [{ translateY: refineSheetAnim }],
                paddingBottom: Math.max(insets.bottom, 14),
                maxHeight: Dimensions.get('window').height * 0.92,
              },
            ]}
          >
            <View style={styles.refineSheetHandle} />
            {(() => {
              const inProposal = refineProposal != null;
              const inPickBook = showPickBookInRefine;
              const showBack =
                inPickBook || (!inProposal && refineWizardStep === 2);
              const title = inProposal
                ? 'Refine Strategy'
                : inPickBook
                  ? 'Select from Pick Book'
                  : refineWizardStep === 1
                    ? 'Select the date'
                    : 'Numbers you bought';
              const onHeaderBack = () => {
                if (inPickBook) setShowPickBookInRefine(false);
                else setRefineWizardStep(1);
              };
              return (
                <View style={styles.refineHeaderRow}>
                  <View style={styles.refineHeaderSide}>
                    {showBack ? (
                      <TouchableOpacity
                        onPress={onHeaderBack}
                        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                        accessibilityRole="button"
                        accessibilityLabel="Go back"
                      >
                        <Ionicons name="chevron-back" size={26} color={COLORS.textSecondary} />
                      </TouchableOpacity>
                    ) : null}
                  </View>
                  <View style={styles.refineHeaderCenter}>
                    <Text style={styles.refineHeaderTitle} numberOfLines={2}>
                      {title}
                    </Text>
                    {activeSet ? (
                      <Text style={styles.refineCounterLine} numberOfLines={1}>
                        Refine counter:{' '}
                        <Text style={styles.refineCounterValue}>{refineApplyTotalForSet}</Text>
                      </Text>
                    ) : null}
                  </View>
                  <View style={[styles.refineHeaderSide, styles.refineHeaderSideRight]}>
                    <TouchableOpacity
                      onPress={closeRefineModal}
                      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                    >
                      <Ionicons name="close" size={24} color={COLORS.textMuted} />
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })()}
            {showPickBookInRefine ? (
              <View style={styles.refinePickBookContainer}>
                <Text style={styles.refinePickBookSubtitle}>
                  Choose a saved pick for this strategy. Tap + to add a line manually (saved to Pick Book).
                </Text>
                {refinePickBookLoading ? (
                  <ActivityIndicator size="large" color={COLORS.gold} style={{ marginTop: 24 }} />
                ) : (
                  <ScrollView style={styles.refinePickBookList} showsVerticalScrollIndicator={false}>
                    <TouchableOpacity style={styles.refinePickBookAddRow} onPress={openRefineManualAddModal}>
                      <Ionicons name="add-circle-outline" size={26} color={COLORS.gold} />
                      <Text style={styles.refinePickBookAddRowText}>Add manually</Text>
                    </TouchableOpacity>
                    {refinePickBookRecords.length === 0 ? (
                      <View style={styles.refinePickBookEmpty}>
                        <Ionicons name="book-outline" size={40} color={COLORS.textMuted} />
                        <Text style={styles.refinePickBookEmptyText}>No saved picks yet</Text>
                        <Text style={styles.refinePickBookEmptyHint}>Use Add manually above or save picks from Generate / Check result.</Text>
                      </View>
                    ) : (
                      refinePickBookRecords.map((r) => {
                        const first = r.picks[0];
                        const mainStr = first?.main.map(String).join(' ') ?? '';
                        const specialStr = first?.special.map(String).join(' ') ?? '';
                        const preview = [mainStr, specialStr].filter(Boolean).join(' ');
                        return (
                          <TouchableOpacity
                            key={r.id}
                            style={styles.refinePickBookItem}
                            onPress={() => onSelectPickBookRecord(r)}
                          >
                            <Text style={styles.refinePickBookItemDate}>{r.draw_date}</Text>
                            <Text style={styles.refinePickBookItemNums} numberOfLines={1}>
                              {preview}
                            </Text>
                          </TouchableOpacity>
                        );
                      })
                    )}
                  </ScrollView>
                )}
                <Modal visible={showRefineManualAddModal} transparent animationType="fade">
                  <TouchableOpacity
                    style={styles.modalOverlay}
                    activeOpacity={1}
                    onPress={() => setShowRefineManualAddModal(false)}
                  >
                    <View style={[styles.modalCard, styles.refineManualAddCard]} onStartShouldSetResponder={() => true}>
                      <Text style={styles.modalTitle}>Add pick line</Text>
                      <Text style={styles.inputLabel}>Draw date (YYYY-MM-DD)</Text>
                      <TextInput
                        style={styles.refineInput}
                        value={refineManualAddDate}
                        onChangeText={setRefineManualAddDate}
                        placeholder="2026-05-03"
                        placeholderTextColor={COLORS.textMuted}
                        keyboardType="numbers-and-punctuation"
                      />
                      <Text style={styles.inputLabel}>Numbers</Text>
                      <View style={styles.pickCellsRow}>
                        {Array.from({ length: (LOTTERY_DEFS[selectedLottery]?.main_count ?? 7) + userPicksSpecialCount }, (_, i) => {
                          const val = refineManualAddCells[i] ?? '';
                          const def = LOTTERY_DEFS[selectedLottery];
                          const isSpecial = def && i >= (def.main_count ?? 7);
                          const maxVal = isSpecial ? (def?.special_max ?? 49) : (def?.main_max ?? 49);
                          return (
                            <TextInput
                              key={`ma-${i}`}
                              style={[styles.pickCell, isSpecial && styles.pickCellSpecial]}
                              value={val}
                              onChangeText={(t) => {
                                setRefineManualAddCells((prev) => {
                                  const currVal = prev[i] ?? '';
                                  const total = (def?.main_count ?? 7) + userPicksSpecialCount;
                                  const maxDigits = String(maxVal).length;
                                  let newVal = t.replace(/\D/g, '').slice(0, maxDigits);
                                  if (newVal.length === 1 && currVal.length === 1 && maxDigits === 2) {
                                    newVal = currVal + newVal;
                                  }
                                  return Array.from({ length: total }, (_, j) => (j === i ? newVal : (prev[j] ?? '')));
                                });
                              }}
                              placeholder={isSpecial ? 'S' : String(i + 1)}
                              placeholderTextColor={COLORS.textMuted}
                              keyboardType="number-pad"
                              maxLength={String(maxVal).length}
                            />
                          );
                        })}
                      </View>
                      <TouchableOpacity style={styles.refineSubmitBtn} onPress={() => void submitRefineManualAdd()}>
                        <Text style={styles.refineSubmitBtnText}>Save to Pick Book</Text>
                      </TouchableOpacity>
                    </View>
                  </TouchableOpacity>
                </Modal>
              </View>
            ) : !refineProposal ? (
              refineWizardStep === 1 ? (
                <View style={styles.refineStep1Outer}>
                  <View style={styles.refineStep1Body}>
                    {pastDrawsLoading ? (
                      <ActivityIndicator size="large" color={COLORS.gold} style={{ marginVertical: 24 }} />
                    ) : pastDrawsForRefine.length === 0 ? (
                      <Text style={styles.refineStepHint}>No past draws available for this lottery.</Text>
                    ) : (
                      <View style={styles.refineDateWheelBlock}>
                        <View style={[styles.refineDateWheelWindow, { height: REFINE_DATE_WHEEL_HEIGHT }]}>
                          <ScrollView
                            ref={refineDateWheelRef}
                            style={styles.refineDateWheelScroll}
                            showsVerticalScrollIndicator={false}
                            snapToInterval={REFINE_DATE_WHEEL_ROW_H}
                            snapToAlignment="start"
                            decelerationRate="fast"
                            bounces={false}
                            alwaysBounceVertical={false}
                            overScrollMode="never"
                            directionalLockEnabled
                            nestedScrollEnabled
                            keyboardShouldPersistTaps="handled"
                            scrollEventThrottle={16}
                            contentContainerStyle={{
                              paddingVertical: (REFINE_DATE_WHEEL_HEIGHT - REFINE_DATE_WHEEL_ROW_H) / 2,
                            }}
                            onMomentumScrollEnd={(e) => {
                              finalizeRefineDateWheelScroll(e.nativeEvent.contentOffset.y);
                            }}
                          >
                            {pastDrawsForRefine.map((d) => (
                              <View
                                key={d.draw_date}
                                style={[styles.refineDateWheelRow, { height: REFINE_DATE_WHEEL_ROW_H }]}
                              >
                                <Text style={styles.refineDateWheelItemText}>{d.draw_date}</Text>
                              </View>
                            ))}
                          </ScrollView>
                          <View pointerEvents="none" style={styles.refineDateWheelSelector} />
                        </View>
                      </View>
                    )}
                    <TouchableOpacity
                      style={[
                        styles.refineSubmitBtn,
                        (pastDrawsLoading || pastDrawsForRefine.length === 0) && styles.refineBtnDisabled,
                      ]}
                      disabled={pastDrawsLoading || pastDrawsForRefine.length === 0}
                      onPress={() => setRefineWizardStep(2)}
                    >
                      <Text style={styles.refineSubmitBtnText}>Next</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <View style={styles.refineScrollWrap}>
                  <>
                    <ScrollView
                      ref={refineScrollRef}
                      style={styles.refineInputScroll}
                      contentContainerStyle={styles.refineInputScrollContent}
                      showsVerticalScrollIndicator={true}
                      keyboardDismissMode="on-drag"
                      keyboardShouldPersistTaps="handled"
                      onScroll={(e) => setRefineScrollY(e.nativeEvent.contentOffset.y)}
                      scrollEventThrottle={16}
                      onContentSizeChange={(_, h) => setRefineContentH(h)}
                      onLayout={(e) => setRefineLayoutH(e.nativeEvent.layout.height)}
                    >
                      {refineSelectedPastDrawDate ? (
                        <Text style={styles.refineCurrentDrawLine}>
                          <Text style={styles.refineCurrentDrawLabel}>Current draw date: </Text>
                          <Text style={styles.refineCurrentDrawValue}>{refineSelectedPastDrawDate}</Text>
                        </Text>
                      ) : null}
                      <TouchableOpacity style={styles.fromPickBookRow} onPress={openPickBookFromRefine}>
                        <Ionicons name="book-outline" size={18} color={COLORS.gold} />
                        <Text style={styles.fromPickBookRowText}>Choose from Pick Book</Text>
                        <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
                      </TouchableOpacity>
                      <Text style={styles.refineSubLabel}>
                        {`Main (${LOTTERY_DEFS[selectedLottery]?.main_min ?? 1}–${LOTTERY_DEFS[selectedLottery]?.main_max ?? 49})`}
                      </Text>
                      <View style={styles.pickCellsRow}>
                        {Array.from({ length: LOTTERY_DEFS[selectedLottery]?.main_count ?? 7 }, (_, i) => {
                          const val = userPicksArray[i] ?? '';
                          const def = LOTTERY_DEFS[selectedLottery];
                          const maxVal = def?.main_max ?? 49;
                          return (
                            <TextInput
                              key={`refine-pick-main-${i}`}
                              style={styles.pickCell}
                              value={val}
                              onChangeText={(t) => {
                                setUserPicksArray((prev) => {
                                  const currVal = prev[i] ?? '';
                                  const total = (def?.main_count ?? 7) + userPicksSpecialCount;
                                  const maxDigits = String(maxVal).length;
                                  let newVal = t.replace(/\D/g, '').slice(0, maxDigits);
                                  if (newVal.length === 1 && currVal.length === 1 && maxDigits === 2) {
                                    newVal = currVal + newVal;
                                  }
                                  return Array.from({ length: total }, (_, j) => (j === i ? newVal : (prev[j] ?? '')));
                                });
                              }}
                              placeholder={String(i + 1)}
                              placeholderTextColor={COLORS.textMuted}
                              keyboardType="number-pad"
                              maxLength={String(maxVal).length}
                            />
                          );
                        })}
                      </View>
                      {userPicksSpecialCount > 0 ? (
                        <>
                          <Text style={styles.refineSubLabel}>
                            {selectedLottery === 'powerball'
                              ? `Powerball (${LOTTERY_DEFS[selectedLottery]?.special_min ?? 1}–${LOTTERY_DEFS[selectedLottery]?.special_max ?? 26})`
                              : selectedLottery === 'mega_millions'
                                ? `Mega Ball (${LOTTERY_DEFS[selectedLottery]?.special_min ?? 1}–${LOTTERY_DEFS[selectedLottery]?.special_max ?? 25})`
                                : `Special (${LOTTERY_DEFS[selectedLottery]?.special_min ?? 1}–${LOTTERY_DEFS[selectedLottery]?.special_max ?? 49})`}
                          </Text>
                          <View style={styles.pickCellsRow}>
                            {Array.from({ length: userPicksSpecialCount }, (_, j) => {
                              const def = LOTTERY_DEFS[selectedLottery];
                              const mainCount = def?.main_count ?? 7;
                              const i = mainCount + j;
                              const val = userPicksArray[i] ?? '';
                              const maxVal = def?.special_max ?? 49;
                              return (
                                <TextInput
                                  key={`refine-pick-special-${j}`}
                                  style={[styles.pickCell, styles.pickCellSpecial]}
                                  value={val}
                                  onChangeText={(t) => {
                                    setUserPicksArray((prev) => {
                                      const currVal = prev[i] ?? '';
                                      const total = mainCount + userPicksSpecialCount;
                                      const maxDigits = String(maxVal).length;
                                      let newVal = t.replace(/\D/g, '').slice(0, maxDigits);
                                      if (newVal.length === 1 && currVal.length === 1 && maxDigits === 2) {
                                        newVal = currVal + newVal;
                                      }
                                      return Array.from({ length: total }, (_, k) => (k === i ? newVal : (prev[k] ?? '')));
                                    });
                                  }}
                                  placeholder="S"
                                  placeholderTextColor={COLORS.textMuted}
                                  keyboardType="number-pad"
                                  maxLength={String(maxVal).length}
                                />
                              );
                            })}
                          </View>
                        </>
                      ) : null}
                      {refineCountdown !== null ? (
                        <View style={styles.refineCountdownBlock}>
                          <ActivityIndicator size="large" color={COLORS.gold} />
                          <Text style={styles.refineCountdownNumber}>{refineCountdown}</Text>
                          <Text style={styles.refineCountdownCaption}>Computing refinement...</Text>
                        </View>
                      ) : refineLoading ? (
                        <ActivityIndicator size="large" color={COLORS.gold} style={{ marginVertical: 24 }} />
                      ) : (
                        <>
                          <TouchableOpacity style={styles.refineSubmitBtn} onPress={() => void handleRefine()}>
                            <Text style={styles.refineSubmitBtnText}>Compute refinement</Text>
                          </TouchableOpacity>
                        </>
                      )}
                    </ScrollView>
                    {refineContentH > refineLayoutH + 2 && (
                      <Pressable
                        style={styles.scrollbarTrack}
                        onPressIn={(e) => {
                          const locY = e.nativeEvent.locationY ?? 0;
                          const scrollY = (locY / refineLayoutH) * Math.max(0, refineContentH - refineLayoutH);
                          refineScrollRef.current?.scrollTo({ y: scrollY, animated: false });
                        }}
                      >
                        <View
                          style={[
                            styles.scrollbarThumb,
                            {
                              height: Math.max(28, (refineLayoutH * refineLayoutH) / refineContentH),
                              top: Math.max(
                                0,
                                Math.min(
                                  refineLayoutH - Math.max(28, (refineLayoutH * refineLayoutH) / refineContentH),
                                  (refineScrollY / Math.max(1, refineContentH - refineLayoutH)) *
                                    (refineLayoutH - Math.max(28, (refineLayoutH * refineLayoutH) / refineContentH))
                                )
                              ),
                            },
                          ]}
                        />
                      </Pressable>
                    )}
                  </>
                </View>
              )
            ) : (
              <ScrollView
                style={[styles.proposalScroll, { maxHeight: Dimensions.get('window').height * 0.7 }]}
                contentContainerStyle={styles.proposalScrollContent}
                showsVerticalScrollIndicator={true}
              >
                <Text style={styles.proposalSection}>Refine detected:</Text>
                {(() => {
                  const rows = refineProposal.deltas
                    .map((d, i) => {
                      const fid = d.featureId as FeatureId;
                      const w0 = activeSet?.featureWeights?.[fid];
                      const before01 = typeof w0 === 'number' ? w0 : 0.5;
                      const after01 = featureWeight01AfterRefineDelta(fid, before01, {
                        direction: d.direction as 'increase' | 'decrease',
                        magnitude: d.magnitude,
                      });
                      const beforePct = Math.round(before01 * 100);
                      const afterPct = Math.round(after01 * 100);
                      if (beforePct === afterPct) return null;
                      const trendColor =
                        afterPct > beforePct
                          ? COLORS.success
                          : afterPct < beforePct
                            ? COLORS.error
                            : COLORS.textSecondary;
                      return (
                        <View key={`${d.featureId}-${i}`} style={styles.deltaRow}>
                          <Text style={styles.deltaParam}>{d.featureId}</Text>
                          <Text style={[styles.deltaTrend, { color: trendColor }]}>
                            {beforePct}→{afterPct}
                          </Text>
                        </View>
                      );
                    })
                    .filter((node): node is React.ReactElement => node != null);
                  return rows.length > 0 ? (
                    rows
                  ) : (
                    <Text style={styles.refineNoDeltaNote}>
                      No weight slider changes for this suggestion (already at limit or neutral).
                    </Text>
                  );
                })()}
                <Text style={styles.proposalSection}>Refinement Summary</Text>
                <Text
                  style={[
                    styles.reasoning,
                    refineProposal.astronautUpsellNote ? { marginBottom: 8 } : null,
                  ]}
                >
                  {refineProposal.reasoning}
                </Text>
                {refineProposal.astronautUpsellNote ? (
                  <Text style={styles.refineAstronautUpsell}>{refineProposal.astronautUpsellNote}</Text>
                ) : null}
                <TouchableOpacity style={styles.confirmBtn} onPress={handleConfirmRefine}>
                  <Text style={styles.confirmBtnText}>Apply refinement</Text>
                </TouchableOpacity>
              </ScrollView>
            )}
          </Animated.View>
        </View>
      </Modal>

      <Modal visible={showStrategyLabGuide} transparent animationType="fade">
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowStrategyLabGuide(false)}>
          <TouchableOpacity activeOpacity={1} onPress={(e) => e.stopPropagation()} style={styles.guideModalCard}>
            <View style={styles.guideModalHeader}>
              <Text style={styles.guideModalTitle}>Strategy Lab User Guide</Text>
              <TouchableOpacity onPress={() => setShowStrategyLabGuide(false)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                <Ionicons name="close" size={24} color={COLORS.textMuted} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.guideScroll} showsVerticalScrollIndicator={false}>
              <View style={styles.guideIntro}>
                <Ionicons name="flask" size={40} color={COLORS.gold} style={styles.guideIntroIcon} />
                {STRATEGY_LAB_YOUTUBE_URL.trim() ? (
                  <TouchableOpacity
                    style={styles.guideYoutubeBtn}
                    onPress={() => Linking.openURL(STRATEGY_LAB_YOUTUBE_URL.trim())}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="play-circle" size={24} color={COLORS.gold} style={{ marginRight: 8 }} />
                    <Text style={styles.guideYoutubeBtnText}>Watch tutorial video</Text>
                  </TouchableOpacity>
                ) : (
                  <Pressable
                    style={[styles.guideYoutubeBtn, styles.guideYoutubeBtnPlaceholder]}
                    onPress={() =>
                      showAlert('Coming soon', 'The tutorial video will be available on YouTube soon.')
                    }
                  >
                    <Ionicons name="play-circle-outline" size={24} color={COLORS.textMuted} style={{ marginRight: 8 }} />
                    <View style={styles.guideYoutubePlaceholderTextCol}>
                      <Text style={styles.guideYoutubeBtnTextPlaceholder}>Watch tutorial video</Text>
                      <Text style={styles.guideYoutubeComingSoon}>Coming soon</Text>
                    </View>
                  </Pressable>
                )}
                <Text style={styles.guideIntroTitle}>Build Your Own Lottery Strategy</Text>
                <Text style={styles.guideIntroText}>
                  Strategy Lab helps you create and refine your own lottery number-generation strategy. While lottery results follow random probability in the long run, short-term draws often show temporary trends and patterns. Strategy Lab lets you explore these patterns and build a strategy that fits your playing style.
                </Text>
                <Text style={styles.guideIntroText}>
                  Instead of a single fixed algorithm, you can experiment with different strategy models and adjust them over time. Strategy Lab turns number picking into an evolving experiment—combining statistics, trends, and personal intuition.
                </Text>
              </View>
              {STRATEGY_LAB_GUIDE_STEPS.map((step, i) => (
                <View key={i} style={styles.guideStep}>
                  <View style={styles.guideStepIconWrap}>
                    <Ionicons name={step.icon} size={22} color={COLORS.gold} />
                  </View>
                  <View style={styles.guideStepContent}>
                    <Text style={styles.guideStepTitle}>{step.title}</Text>
                    <Text style={styles.guideStepText}>{step.text}</Text>
                  </View>
                </View>
              ))}
              <View style={styles.guideDisclaimer}>
                <Ionicons name="information-circle" size={20} color={COLORS.textMuted} />
                <Text style={styles.guideDisclaimerText}>
                  This system refines strategy behavior based on feedback. It does not predict lottery outcomes.
                </Text>
              </View>
            </ScrollView>
            <TouchableOpacity style={styles.guideCloseBtn} onPress={() => setShowStrategyLabGuide(false)}>
              <Text style={styles.guideCloseBtnText}>Got it</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal
        visible={showPaywall}
        transparent
        animationType="fade"
        onRequestClose={() => setShowPaywall(false)}
        statusBarTranslucent
      >
        <Pressable style={styles.modalOverlay} onPress={() => setShowPaywall(false)}>
          <Pressable style={[styles.paywallCard, { alignSelf: 'center' }]} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.paywallTitle}>
              {hadAstronautSubscription ? 'Subscribe to Astronaut' : 'Start your 1-month free trial'}
            </Text>
            <Text style={styles.paywallDesc}>{ASTRONAUT_FEATURE_BULLETS.join('\n')}</Text>
            <SubscriptionLegalText
              compact
              lines={
                hadAstronautSubscription
                  ? astronautPaidOnlyDisclosureLines(astronautRenewalPrice)
                  : astronautTrialDisclosureLines(astronautRenewalPrice)
              }
            />
            <Pressable
              style={({ pressed }) => [styles.purchaseBtn, pressed && { opacity: 0.8 }]}
              onPress={handlePurchasePro}
            >
              <Text style={styles.purchaseBtnText}>
                {hadAstronautSubscription ? `Subscribe — ${astronautRenewalPrice}` : 'Start 1-month free trial'}
              </Text>
            </Pressable>
            <Pressable style={styles.cancelBtn} onPress={() => setShowPaywall(false)}>
              <Text style={styles.cancelBtnText}>Maybe later</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screenWrap: { flex: 1, backgroundColor: COLORS.bg },
  container: { flex: 1, backgroundColor: COLORS.bg },
  content: { paddingHorizontal: SPACING.screenPadding },
  stickyHeader: {
    backgroundColor: COLORS.bg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.bgElevated,
    paddingBottom: 8,
  },
  modeDock: {
    backgroundColor: COLORS.bg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.bgElevated,
    paddingTop: 4,
    paddingBottom: 12,
  },
  modeLotteryBannerWrap: {
    marginBottom: 16,
    width: '100%',
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  titleIcon: { marginRight: 10 },
  title: { fontSize: 24, fontWeight: '700', color: COLORS.text, flex: 1 },
  headerRightActions: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  card: { backgroundColor: COLORS.bgCard, borderRadius: 12, padding: 18, marginBottom: 16 },
  cardTitle: { color: COLORS.text, fontSize: 18, fontWeight: '600', marginBottom: 8 },
  cardDesc: { color: COLORS.textSecondary, fontSize: 14, marginBottom: 12 },
  modeToggleRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modeToggleBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: COLORS.bgElevated,
    borderWidth: 1,
    borderColor: COLORS.gold,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 12,
  },
  modeToggleBtnActive: {
    backgroundColor: COLORS.gold,
    borderColor: COLORS.gold,
  },
  modeToggleBtnLocked: {
    opacity: 0.72,
    borderColor: COLORS.textMuted,
  },
  modeToggleText: {
    color: COLORS.gold,
    fontSize: 14,
    fontWeight: '800',
  },
  modeToggleTextActive: {
    color: COLORS.bg,
  },
  tuningCategoryPanel: {
    marginBottom: 22,
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
  },
  tuningCategoryTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  tuningCategoryTitle: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 0.2,
    flexShrink: 1,
  },
  tuningFeatureRowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  personalBiasFeatureBlock: {
    paddingVertical: 4,
  },
  personalBiasTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 40,
  },
  personalBiasFeatureTitle: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: '700',
  },
  personalBiasIndication: {
    marginTop: 6,
    fontSize: 12,
    lineHeight: 17,
    color: COLORS.textSecondary,
  },
  luckyDigitInput: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: COLORS.bgElevated,
    borderWidth: 1,
    borderColor: PERSONAL_BIAS_ACCENT,
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
    padding: 0,
  },
  luckyBiasStrengthTap: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  luckyBiasHeartRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  generateConfirmCard: { backgroundColor: COLORS.bgCard, borderRadius: 16, padding: 20, marginHorizontal: 24 },
  generateConfirmTitle: { fontSize: 18, fontWeight: '700', color: COLORS.text, marginBottom: 8 },
  generateConfirmText: { color: COLORS.textSecondary, fontSize: 14, marginBottom: 16 },
  generateConfirmActions: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  generateConfirmBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: COLORS.bgElevated, alignItems: 'center' },
  generateConfirmBtnPrimary: { backgroundColor: COLORS.gold },
  generateConfirmBtnText: { color: COLORS.text, fontSize: 14, fontWeight: '600' },
  generateConfirmBtnTextPrimary: { color: COLORS.bg, fontSize: 14, fontWeight: '700' },
  generateConfirmUpgrade: { paddingVertical: 8, alignItems: 'center' },
  generateConfirmUpgradeText: { color: COLORS.gold, fontSize: 14, fontWeight: '600' },
  editModalCard: {
    backgroundColor: COLORS.bgCard,
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 280,
  },
  editModalTitle: { fontSize: 18, fontWeight: '700', color: COLORS.text, marginBottom: 8 },
  tuningSheetRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  tuningSheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.52)',
  },
  tuningBottomSheet: {
    backgroundColor: COLORS.bgCard,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 20,
    paddingTop: 8,
    maxHeight: Dimensions.get('window').height * 0.78,
    width: '100%',
    zIndex: 2,
    elevation: 24,
  },
  tuningSheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.22)',
    marginBottom: 12,
  },
  tuningModalBodyScroll: {
    maxHeight: Dimensions.get('window').height * 0.32,
    marginBottom: 12,
  },
  tuningModalDetail: {
    color: COLORS.textSecondary,
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 14,
  },
  tuningModalValueLabel: {
    fontSize: 28,
    fontWeight: '800',
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: 6,
  },
  /** Same typography as value label; tap to type 0–100 (kept in sync with slider). */
  tuningModalValueInput: {
    fontSize: 28,
    fontWeight: '800',
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    minWidth: 100,
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.07)',
    overflow: 'hidden',
  },
  tuningSheetSliderBlock: {
    width: '100%',
    marginBottom: 4,
  },
  tuningSheetPoleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    gap: 12,
    marginBottom: 8,
    width: '100%',
  },
  tuningSheetPoleLeft: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textSecondary,
    textAlign: 'left',
  },
  tuningSheetPoleRight: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textSecondary,
    textAlign: 'right',
  },
  tuningModalSliderFull: {
    width: '100%',
    height: 44,
  },
  tuningModalBanner: {
    marginBottom: 14,
    alignItems: 'center',
  },
  editModalConfirm: {
    backgroundColor: COLORS.gold,
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 8,
  },
  editModalConfirmText: { color: COLORS.bg, fontWeight: '700', fontSize: 14 },
  lotteryDropdownWrap: { marginBottom: 16, zIndex: 2 },
  lotteryDropdownTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: COLORS.bgElevated,
    borderWidth: 1,
    borderColor: COLORS.gold,
    gap: 10,
  },
  lotteryDropdownTriggerText: { color: COLORS.text, fontSize: 15, fontWeight: '600', flex: 1 },
  lotteryDropdownMenu: {
    marginTop: 6,
    borderRadius: 10,
    backgroundColor: COLORS.bgElevated,
    borderWidth: 1,
    borderColor: COLORS.bgCard,
    overflow: 'hidden',
  },
  lotteryDropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.bgCard,
  },
  lotteryDropdownItemLast: { borderBottomWidth: 0 },
  lotteryDropdownItemActive: { backgroundColor: 'rgba(79, 70, 229, 0.18)' },
  lotteryDropdownItemText: { color: COLORS.textSecondary, fontSize: 14, fontWeight: '500', flex: 1 },
  lotteryDropdownItemTextActive: { color: COLORS.text, fontWeight: '600' },
  autoPlayStyleBlock: { marginTop: 4, marginBottom: 14 },
  autoPlayStyleLabel: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  autoPlayStyleDropdownWrap: { marginBottom: 0, zIndex: 3 },
  autoPersonalBiasFold: { marginTop: 2, marginBottom: 14 },
  autoPersonalBiasHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  autoPersonalBiasFoldTitle: {
    flex: 1,
    color: COLORS.text,
    fontSize: 18,
    fontWeight: '600',
  },
  autoPersonalBiasExpandedBody: { marginTop: 10 },
  generateBtn: {
    backgroundColor: COLORS.primary,
    padding: 16,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  generateBtnDisabled: { opacity: 0.5 },
  btnIcon: { marginRight: 8 },
  generateBtnText: { color: COLORS.text, fontWeight: '700', fontSize: 16 },
  upgradeHint: { color: COLORS.warning, fontSize: 12, marginTop: 12 },
  refineBtnRow: {
    width: '100%',
    alignItems: 'center',
    marginBottom: 16,
    marginTop: 4,
  },
  refineDevHint: { color: COLORS.success, textAlign: 'center', marginTop: 10, alignSelf: 'stretch' },
  refineBtn: {
    backgroundColor: COLORS.gold,
    paddingVertical: 15,
    paddingHorizontal: 28,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    minWidth: 220,
  },
  refineBtnDisabled: { opacity: 0.5 },
  refineBtnIcon: { marginRight: 10 },
  refineBtnText: { color: COLORS.bg, fontWeight: '700', fontSize: 17 },
  pickBookBtn: {
    backgroundColor: COLORS.bgElevated,
    padding: 14,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
    borderWidth: 1,
    borderColor: COLORS.gold,
  },
  pickBookBtnText: { color: COLORS.text, fontWeight: '600', fontSize: 14 },
  compassBtn: {
    backgroundColor: COLORS.bgElevated,
    padding: 14,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.gold,
  },
  compassBtnText: { color: COLORS.text, fontWeight: '600', fontSize: 14 },
  results: { marginTop: 20 },
  resultsTitle: { color: COLORS.textSecondary, fontSize: 12, marginBottom: 12 },
  strategyScoreBlock: { marginTop: 18, paddingTop: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.12)' },
  strategyScoreCollapsedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    minHeight: 44,
  },
  strategyScoreCollapsedLeft: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 8,
    justifyContent: 'center',
  },
  strategyScoreCollapsedRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingLeft: 4,
  },
  strategyScorePressed: { opacity: 0.72 },
  strategyScoreCollapsedTier: { color: COLORS.text, fontSize: 17, fontWeight: '800' },
  strategyScoreCollapsedValue: { color: COLORS.gold, fontSize: 22, fontWeight: '800' },
  strategyScoreResultCard: {
    marginTop: 14,
    padding: 16,
    borderRadius: 14,
    backgroundColor: COLORS.bgElevated,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.28)',
  },
  strategyPercentileLine: {
    color: COLORS.textSecondary,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
    marginBottom: 18,
    marginTop: 0,
  },
  strategyWhyTitle: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 10,
  },
  strategyFactorRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10 },
  strategyFactorIcon: { color: COLORS.success, fontSize: 15, fontWeight: '700', width: 18, marginTop: 1 },
  strategyFactorIconRisk: { color: COLORS.warning },
  strategyFactorText: { flex: 1, color: COLORS.textSecondary, fontSize: 14, lineHeight: 20 },
  strategyFactorTextRisk: { color: COLORS.warning },
  strategyPlayLabel: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginTop: 6,
    marginBottom: 6,
  },
  strategyPlayValue: { color: COLORS.text, fontSize: 16, fontWeight: '700', marginBottom: 14 },
  strategyScoreFootnote: { color: COLORS.textMuted, fontSize: 11, lineHeight: 16, fontStyle: 'italic' },
  strategyScorePending: { color: COLORS.textMuted, fontSize: 12, marginTop: 14, fontStyle: 'italic' },
  dateGroup: { marginBottom: 20 },
  dateGroupHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  dateGroupTitle: { color: COLORS.gold, fontSize: 14, fontWeight: '700' },
  addToPickBookBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.gold,
    gap: 6,
  },
  addToPickBookText: { color: COLORS.gold, fontSize: 12, fontWeight: '600' },
  addToPickBookBtnDisabled: { opacity: 0.6, borderColor: COLORS.textMuted },
  addToPickBookTextDisabled: { color: COLORS.textMuted },
  pickCard: { backgroundColor: COLORS.bgElevated, borderRadius: 10, padding: 12, marginBottom: 10 },
  ballRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  ball: { width: 32, height: 32, borderRadius: 16, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  ballSpecial: { backgroundColor: COLORS.success },
  ballText: { color: COLORS.text, fontWeight: '700', fontSize: 12 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  modalCard: { backgroundColor: COLORS.bgCard, borderRadius: 16, padding: 20, width: '100%', maxWidth: 360, maxHeight: '85%', overflow: 'hidden' },
  refineSheetRoot: { flex: 1, justifyContent: 'flex-end' },
  refineSheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  refineSheetSheet: {
    width: '100%',
    alignSelf: 'stretch',
    backgroundColor: COLORS.bgCard,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 4,
    overflow: 'hidden',
    zIndex: 2,
    elevation: 16,
  },
  refineSheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.22)',
    marginBottom: 10,
  },
  refineStep1Outer: { width: '100%', alignSelf: 'stretch' },
  refineManualAddCard: { maxWidth: 360 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8 },
  refineHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 10,
    minHeight: 44,
  },
  refineHeaderSide: {
    width: 44,
    minHeight: 40,
    justifyContent: 'flex-start',
    alignItems: 'flex-start',
    paddingTop: 2,
  },
  refineHeaderSideRight: { alignItems: 'flex-end' },
  refineHeaderCenter: { flex: 1, alignItems: 'center', paddingHorizontal: 2, minWidth: 0 },
  refineHeaderTitle: { fontSize: 17, fontWeight: '700', color: COLORS.text, textAlign: 'center' },
  refineCounterLine: { fontSize: 12, fontWeight: '600', color: COLORS.textMuted, marginTop: 6, textAlign: 'center' },
  refineCounterValue: { fontSize: 12, fontWeight: '700', color: COLORS.success },
  modalTitle: { fontSize: 18, fontWeight: '700', color: COLORS.text },
  modalDisclaimer: { color: COLORS.textMuted, fontSize: 11, marginBottom: 16, fontStyle: 'italic' },
  inputLabel: { color: COLORS.textSecondary, fontSize: 12, marginTop: 12, marginBottom: 4 },
  refineScrollWrap: { flexDirection: 'row', alignSelf: 'stretch' },
  refineStep1Body: { paddingBottom: 8, width: '100%', alignItems: 'stretch' },
  refineDateWheelBlock: { alignItems: 'stretch', marginBottom: 16, marginHorizontal: -20, alignSelf: 'stretch' },
  refineDateWheelWindow: {
    width: '100%',
    alignSelf: 'stretch',
    borderRadius: 12,
    backgroundColor: COLORS.bgElevated,
    overflow: 'hidden',
    position: 'relative',
  },
  refineDateWheelScroll: {
    width: '100%',
    height: REFINE_DATE_WHEEL_HEIGHT,
    flexGrow: 0,
  },
  refineDateWheelRow: {
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'stretch',
    width: '100%',
  },
  refineDateWheelItemText: { color: COLORS.text, fontSize: 17, fontWeight: '600', textAlign: 'center' },
  refineDateWheelSelector: {
    position: 'absolute',
    left: 4,
    right: 4,
    top: (REFINE_DATE_WHEEL_HEIGHT - REFINE_DATE_WHEEL_ROW_H) / 2,
    height: REFINE_DATE_WHEEL_ROW_H,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.4)',
    borderRadius: 8,
  },
  refineCurrentDrawLine: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 10,
    marginTop: 2,
    textAlign: 'center',
  },
  refineCurrentDrawLabel: { color: COLORS.textMuted },
  refineCurrentDrawValue: { color: COLORS.text, fontWeight: '700' },
  refineSubLabel: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '600', marginBottom: 6, marginTop: 4 },
  refineCountdownBlock: { alignItems: 'center', marginVertical: 16, gap: 10 },
  refineCountdownNumber: { fontSize: 44, fontWeight: '800', color: COLORS.gold },
  refineCountdownCaption: { color: COLORS.textMuted, fontSize: 14, fontWeight: '600' },
  refineInputScroll: { flex: 1 },
  refineInputScrollContent: { paddingBottom: 12 },
  fromPickBookRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginTop: 4,
    marginBottom: 14,
    backgroundColor: COLORS.bgElevated,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.gold,
  },
  fromPickBookRowText: { color: COLORS.gold, fontSize: 14, fontWeight: '600', flex: 1 },
  scrollbarTrack: {
    width: 10,
    marginLeft: 4,
    backgroundColor: COLORS.bgElevated,
    borderRadius: 5,
    justifyContent: 'center',
    position: 'relative',
  },
  scrollbarThumb: {
    position: 'absolute',
    left: 1,
    right: 1,
    backgroundColor: COLORS.gold,
    borderRadius: 4,
    opacity: 0.8,
  },
  refineInput: {
    backgroundColor: COLORS.bgElevated,
    borderRadius: 10,
    padding: 12,
    color: COLORS.text,
    fontSize: 14,
    marginBottom: 8,
  },
  pickCellsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  pickCell: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: COLORS.bgElevated,
    borderWidth: 1,
    borderColor: COLORS.primary,
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    padding: 0,
  },
  pickCellSpecial: { borderColor: COLORS.success, backgroundColor: COLORS.bgElevated },
  pastDrawsDropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.bgElevated,
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  pastDrawsDropdownText: { color: COLORS.text, fontSize: 14 },
  pastDrawsDropdownModal: {
    backgroundColor: COLORS.bgCard,
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxWidth: 340,
    maxHeight: '70%',
    overflow: 'hidden',
  },
  pastDrawsDropdownModalTitle: { color: COLORS.text, fontSize: 16, fontWeight: '600', marginBottom: 12 },
  pastDrawsDropdownList: { maxHeight: 280, marginBottom: 12 },
  pastDrawItem: {
    backgroundColor: COLORS.bgElevated,
    borderRadius: 8,
    padding: 10,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: 'transparent',
    overflow: 'hidden',
  },
  pastDrawDate: { color: COLORS.gold, fontSize: 11, fontWeight: '600', marginBottom: 4 },
  pastDrawNums: { color: COLORS.text, fontSize: 13 },
  yourPicksHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    marginTop: 12,
    marginBottom: 4,
    gap: 8,
  },
  fromPickBookBtnInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.gold,
  },
  fromPickBookBtnText: { color: COLORS.gold, fontSize: 13, fontWeight: '600' },
  refinePickBookContainer: { maxHeight: 360 },
  refinePickBookBack: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  refinePickBookBackText: { color: COLORS.textSecondary, fontSize: 16, marginLeft: 6 },
  refinePickBookTitle: { fontSize: 16, fontWeight: '700', color: COLORS.text, marginBottom: 4 },
  refinePickBookSubtitle: { color: COLORS.textMuted, fontSize: 12, marginBottom: 16 },
  refinePickBookAddRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 12,
    marginBottom: 8,
    backgroundColor: COLORS.bgElevated,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: COLORS.gold,
  },
  refinePickBookAddRowText: { color: COLORS.gold, fontSize: 15, fontWeight: '600' },
  refineReadonlyPreview: { color: COLORS.text, fontSize: 14, marginTop: 6, marginBottom: 8, lineHeight: 20 },
  refineStepHint: { color: COLORS.textMuted, fontSize: 12, marginTop: 4, marginBottom: 8 },
  refinePickBookEmpty: { alignItems: 'center', paddingVertical: 32 },
  refinePickBookEmptyText: { color: COLORS.textMuted, fontSize: 14, marginTop: 12 },
  refinePickBookEmptyHint: { color: COLORS.textMuted, fontSize: 12, marginTop: 8, textAlign: 'center' },
  strategyGateCard: {
    backgroundColor: COLORS.bgCard,
    borderRadius: 16,
    padding: 20,
    marginHorizontal: 24,
    maxWidth: 400,
    width: '100%',
  },
  strategyGateTitle: { fontSize: 18, fontWeight: '700', color: COLORS.text, marginBottom: 10 },
  strategyGateMsg: { color: COLORS.textSecondary, fontSize: 14, lineHeight: 22, marginBottom: 16 },
  strategyGatePrimary: {
    backgroundColor: COLORS.gold,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 10,
  },
  strategyGatePrimaryText: { color: COLORS.bg, fontSize: 16, fontWeight: '700' },
  strategyGateSecondary: {
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 8,
    borderWidth: 1,
    borderColor: COLORS.gold,
  },
  strategyGateSecondaryText: { color: COLORS.gold, fontSize: 15, fontWeight: '600' },
  strategyGateCancel: { paddingVertical: 10, alignItems: 'center' },
  strategyGateCancelText: { color: COLORS.textMuted, fontSize: 15 },
  refinePickBookList: { maxHeight: 280 },
  refinePickBookItem: {
    backgroundColor: COLORS.bgElevated,
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.gold,
  },
  refinePickBookItemDate: { color: COLORS.gold, fontSize: 12, fontWeight: '600', marginBottom: 4 },
  refinePickBookItemNums: { color: COLORS.text, fontSize: 13 },
  refineSubmitBtn: {
    backgroundColor: COLORS.gold,
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
    alignSelf: 'stretch',
    marginTop: 16,
    marginBottom: 8,
  },
  refineSubmitBtnText: { color: COLORS.bg, fontWeight: '700', fontSize: 14 },
  proposalScroll: { flexGrow: 1 },
  proposalScrollContent: { paddingBottom: 24, flexGrow: 1 },
  proposalSection: { color: COLORS.gold, fontSize: 12, fontWeight: '600', marginTop: 12, marginBottom: 8 },
  deltaRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  deltaParam: { color: COLORS.text, fontSize: 14 },
  deltaTrend: { fontSize: 14, fontWeight: '700' },
  refineNoDeltaNote: {
    color: COLORS.textMuted,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 8,
    fontStyle: 'italic',
  },
  reasoning: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 20, marginBottom: 16 },
  refineAstronautUpsell: {
    color: COLORS.textMuted,
    fontSize: 12,
    lineHeight: 17,
    fontStyle: 'italic',
    marginBottom: 16,
  },
  confirmBtn: { backgroundColor: COLORS.gold, padding: 14, borderRadius: 12, alignItems: 'center', marginBottom: 24 },
  confirmBtnText: { color: COLORS.bg, fontWeight: '700', fontSize: 14 },
  cancelBtn: { alignItems: 'center' },
  cancelBtnText: { color: COLORS.textMuted, fontSize: 14 },
  paywallCard: { backgroundColor: COLORS.bgCard, borderRadius: 16, padding: 24, width: '100%', maxWidth: 340 },
  paywallTitle: { fontSize: 20, fontWeight: '700', color: COLORS.text, marginBottom: 8 },
  paywallDesc: { color: COLORS.textSecondary, fontSize: 14, marginBottom: 20 },
  purchaseBtn: { backgroundColor: COLORS.gold, padding: 16, borderRadius: 12, alignItems: 'center', marginBottom: 12 },
  purchaseBtnText: { color: COLORS.bg, fontWeight: '700', fontSize: 16 },
  guideModalCard: {
    backgroundColor: COLORS.bgCard,
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxWidth: 360,
    maxHeight: '85%',
  },
  guideModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  guideModalTitle: { fontSize: 18, fontWeight: '700', color: COLORS.text },
  guideScroll: { maxHeight: 400 },
  guideIntro: { alignItems: 'center', marginBottom: 20 },
  guideIntroIcon: { marginBottom: 12 },
  guideYoutubeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginBottom: 16,
    borderRadius: 10,
    backgroundColor: COLORS.bgElevated,
    borderWidth: 1,
    borderColor: COLORS.gold,
  },
  guideYoutubeBtnText: { color: COLORS.gold, fontSize: 15, fontWeight: '600' },
  guideYoutubeBtnPlaceholder: {
    borderColor: COLORS.textMuted,
    opacity: 0.92,
  },
  guideYoutubePlaceholderTextCol: { flexShrink: 1 },
  guideYoutubeBtnTextPlaceholder: { color: COLORS.textSecondary, fontSize: 15, fontWeight: '600' },
  guideYoutubeComingSoon: { color: COLORS.textMuted, fontSize: 12, fontWeight: '500', marginTop: 2 },
  guideIntroTitle: { color: COLORS.text, fontSize: 18, fontWeight: '700', marginBottom: 12, textAlign: 'center' },
  guideIntroText: { color: COLORS.textSecondary, fontSize: 14, lineHeight: 22, textAlign: 'center', marginBottom: 12 },
  guideStep: { flexDirection: 'row', marginBottom: 16 },
  guideStepIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  guideStepContent: { flex: 1 },
  guideStepTitle: { color: COLORS.text, fontSize: 14, fontWeight: '600', marginBottom: 4 },
  guideStepText: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 20 },
  guideDisclaimer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 8,
    marginBottom: 16,
    gap: 8,
  },
  guideDisclaimerText: { color: COLORS.textMuted, fontSize: 12, flex: 1, lineHeight: 18 },
  guideCloseBtn: {
    backgroundColor: COLORS.gold,
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  guideCloseBtnText: { color: COLORS.bg, fontWeight: '700', fontSize: 14 },
  compassModalCard: { backgroundColor: COLORS.bgCard, borderRadius: 16, padding: 20, width: '100%', maxWidth: 360, maxHeight: '80%' },
  compassModalHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 10 },
  compassModalTitle: { fontSize: 18, fontWeight: '700', color: COLORS.text, flex: 1 },
  compassScroll: { maxHeight: 400 },
  compassSectionTitle: { color: COLORS.text, fontSize: 14, fontWeight: '600', marginBottom: 8 },
  compassPosRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 8 },
  compassPosLabel: { color: COLORS.textSecondary, fontSize: 12, width: 48 },
  compassPosBalls: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, flex: 1 },
  compassBall: { width: 28, height: 28, borderRadius: 14, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  compassBallText: { color: COLORS.text, fontWeight: '600', fontSize: 11 },
  compassInsufficient: { color: COLORS.warning, fontSize: 14, paddingVertical: 24 },
});
