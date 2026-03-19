/**
 * Strategy Lab: feature-driven, AI-assisted strategy exploration.
 * Test tube UI, More/Less coarse adjustment, multi Strategy Set.
 * This system refines strategy behavior based on feedback. It does not predict lottery outcomes.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, SPACING } from '../constants/theme';
import { getRecords } from '../db/sqlite';
import { fetchDraws, getCurrentUserEmail, onAuthStateChange } from '../services/supabase';
import { getStrategyLabTotalCount, incrementStrategyLabTotalUsage, addToPickBook, getPickBookRecords, type PickBookRecord } from '../db/sqlite';
import { getEntitlements, setProUnlocked, type UserPlan } from '../services/entitlements';
import { isIAPAvailable, purchaseAstronaut, onPurchaseSuccess, getIAPProducts, formatAstronautPrice } from '../services/iap';
import {
  getStrategySets,
  getActiveStrategySet,
  setActiveSetId,
  createStrategySet,
  updateStrategySet,
  deleteStrategySet,
  applyFeatureAdjustment,
  coarseAdjust,
  getMaxSets,
} from '../services/strategySetStorage';
import { generateFromStrategySet } from '../services/strategyEngine';
import {
  getGeneratedPicks,
  setGeneratedPicksForDate,
  getTodayDateString,
} from '../services/generatedPicksStorage';
import {
  computeShapeSummary,
  computeDeltaSummary,
  computeRefineProposal,
} from '../services/aiRefine';
import { LOTTERY_DEFS } from '../constants/lotteries';
import {
  STRATEGY_FEATURES,
  FEATURE_CATEGORY_COLORS,
  type FeatureCategory,
  type FeatureId,
} from '../constants/strategyFeatures';
import type { LotteryId } from '../types/lottery';
import type { StrategySet, LuckyBiasStrength } from '../types/strategy';
import type { CandidatePick } from '../utils/localAnalysis';

const DISCLAIMER = 'This system refines strategy behavior based on feedback. It does not predict lottery outcomes.';
const LUCKY_BIAS_DISCLAIMER = 'Lucky numbers add a personal preference layer. They do not affect draw randomness or probabilities.';
const TOTAL_LIMIT_FREE = 0;
const TOTAL_LIMIT_PIRATE = 0;

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

/** Replace with your Strategy Lab tutorial video URL */
const STRATEGY_LAB_YOUTUBE_URL = 'https://www.youtube.com/watch?v=YOUR_VIDEO_ID';

const STRATEGY_LAB_GUIDE_STEPS = [
  { icon: 'layers' as const, title: 'Strategy Sets', text: 'A Strategy Set is an independent experiment. Each set has its own parameters and number generation logic. Create multiple sets to test different ideas and compare performance over time. Pro users can create up to 10 sets.' },
  { icon: 'flask' as const, title: 'Feature Weights', text: 'Your strategy is controlled by feature weights that influence how numbers are generated. Structure: odd/even, high/low balance. Position: number behavior in specific positions. Trend: hot numbers, overdue numbers. Risk: how aggressive the strategy is. Adjust with up/down arrows or tap the tube (0–100).' },
  { icon: 'heart' as const, title: 'Lucky Numbers', text: 'Add 1–3 personal favorite numbers and set bias strength (Off/Low/Medium/High). Max influence ≤5%. Personal preference only—does not affect probabilities.' },
  { icon: 'sparkles' as const, title: 'Generate Picks', text: 'Select lottery, then tap Generate Picks. Results stored by date. Requires Astronaut (1-month free trial, then $0.99/mo).' },
  { icon: 'construct' as const, title: 'Generate & Refine', text: 'After each draw, compare your picks with actual results. Use AI Refine: enter winning numbers and your picks. AI suggests small weight adjustments (±5% max) based on shape feedback. Improve your strategy over time. Does not predict outcomes.' },
];
export default function StrategyLabScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const [isSignedIn, setIsSignedIn] = useState<boolean | null>(null);
  const [plan, setPlan] = useState<UserPlan>('free');
  const [proUnlocked, setProUnlockedState] = useState(false);
  const [hadAstronautSubscription, setHadAstronautSubscription] = useState(false);
  const [usageCount, setUsageCount] = useState(0);
  const [showGenerateConfirm, setShowGenerateConfirm] = useState(false);
  const pendingGenerateRef = useRef<{ history: { winning_numbers: number[]; special_numbers?: number[] }[]; drawDate: string } | null>(null);
  const [sets, setSets] = useState<StrategySet[]>([]);
  const [activeSet, setActiveSet] = useState<StrategySet | null>(null);
  const [selectedLottery, setSelectedLottery] = useState<LotteryId>('lotto_max');
  const [candidates, setCandidates] = useState<CandidatePick[]>([]);
  const [picksByDate, setPicksByDate] = useState<Record<string, CandidatePick[]>>({});
  const [loading, setLoading] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);
  const [showStrategyLabGuide, setShowStrategyLabGuide] = useState(false);
  const [showRefineModal, setShowRefineModal] = useState(false);
  const [refineProposal, setRefineProposal] = useState<{ deltas: Array<{ featureId: string; direction: string; magnitude: number }>; reasoning: string } | null>(null);
  const [refineLoading, setRefineLoading] = useState(false);
  const [winningNumbersArray, setWinningNumbersArray] = useState<string[]>([]);
  const [userPicksArray, setUserPicksArray] = useState<string[]>([]);
  const [pastDrawsForRefine, setPastDrawsForRefine] = useState<{ draw_date: string; winning_numbers: number[]; special_numbers?: number[] }[]>([]);
  const [pastDrawsLoading, setPastDrawsLoading] = useState(false);
  const [pastDrawsDropdownOpen, setPastDrawsDropdownOpen] = useState(false);
  const [showPickBookInRefine, setShowPickBookInRefine] = useState(false);
  const [refinePickBookRecords, setRefinePickBookRecords] = useState<PickBookRecord[]>([]);
  const [refinePickBookLoading, setRefinePickBookLoading] = useState(false);
  const [editingFeature, setEditingFeature] = useState<FeatureId | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [editingLuckyIndex, setEditingLuckyIndex] = useState<number | null>(null);
  const [editingLuckyValue, setEditingLuckyValue] = useState('');
  const [deleteSetTarget, setDeleteSetTarget] = useState<StrategySet | null>(null);
  const [inBookDateKeys, setInBookDateKeys] = useState<Set<string>>(new Set());
  const [astronautPrice, setAstronautPrice] = useState('$0.99/mo');
  const refineScrollRef = useRef<ScrollView>(null);
  const [refineScrollY, setRefineScrollY] = useState(0);
  const [refineContentH, setRefineContentH] = useState(0);
  const [refineLayoutH, setRefineLayoutH] = useState(0);

  const loadInBookDateKeys = useCallback(async () => {
    const records = await getPickBookRecords();
    setInBookDateKeys(new Set(records.map((r) => `${r.lottery_id}:${r.draw_date}`)));
  }, []);

  const loadState = useCallback(async () => {
    const ent = await getEntitlements();
    setPlan(ent.plan);
    setProUnlockedState(ent.proUnlocked);
    setHadAstronautSubscription(ent.hadAstronautSubscription);
    const count = await getStrategyLabTotalCount();
    setUsageCount(count);
  }, []);

  const loadSets = useCallback(async () => {
    const list = await getStrategySets(selectedLottery);
    setSets(list);
    const active = await getActiveStrategySet(selectedLottery);
    setActiveSet(active);
  }, [selectedLottery]);

  const loadPicksByDate = useCallback(async () => {
    const stored = await getGeneratedPicks(selectedLottery);
    setPicksByDate(stored);
  }, [selectedLottery]);

  useEffect(() => {
    loadState();
  }, [loadState]);

  useEffect(() => {
    const unsub = onPurchaseSuccess(loadState);
    return unsub;
  }, [loadState]);

  useEffect(() => {
    if (isIAPAvailable()) {
      getIAPProducts().then(({ astronaut }) => setAstronautPrice(formatAstronautPrice(astronaut)));
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
    getCurrentUserEmail().then((email) => setIsSignedIn(email !== null));
    return onAuthStateChange((email) => setIsSignedIn(email !== null));
  }, []);

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

  const loadRefinePickBookRecords = useCallback(async () => {
    setRefinePickBookLoading(true);
    try {
      const list = await getPickBookRecords({ sortOrder: 'desc' });
      setRefinePickBookRecords(list.filter((r) => r.lottery_id === selectedLottery));
    } catch {
      setRefinePickBookRecords([]);
    } finally {
      setRefinePickBookLoading(false);
    }
  }, [selectedLottery]);

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

  const totalLimit = plan === 'pirate' || plan === 'pirate_astronaut' ? TOTAL_LIMIT_PIRATE : TOTAL_LIMIT_FREE;
  const canGenerate = proUnlocked || usageCount < totalLimit;
  /** Web 开发时 IAP 不可用，允许测试 Refine Strategy */
  const devUnlockRefine = __DEV__ && Platform.OS === 'web';

  const handleGenerate = async () => {
    if (!activeSet) {
      showAlert('Strategy Set required', 'Please wait for Strategy Sets to load, or switch lottery and try again.');
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
    const existingToday = picksByDate[drawDate];
    if (existingToday && existingToday.length > 0) {
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        const ok = window.confirm('You already have generated picks for today. Generating again will replace them. Continue?');
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

    if (!proUnlocked && usageCount >= totalLimit) {
      setShowPaywall(true);
      return;
    }

    if (!proUnlocked) {
      pendingGenerateRef.current = { history, drawDate };
      setShowGenerateConfirm(true);
      return;
    }

    await doGenerate(history, drawDate);
  };

  const doGenerate = useCallback(async (history: { winning_numbers: number[]; special_numbers?: number[] }[], drawDate: string) => {
    if (!activeSet) return;
      setLoading(true);
      setCandidates([]);
      try {
        const picks = generateFromStrategySet(selectedLottery, history, activeSet, 1);
        await setGeneratedPicksForDate(selectedLottery, drawDate, picks);
        await loadPicksByDate();
        setCandidates(picks);
        if (!proUnlocked) {
          await incrementStrategyLabTotalUsage();
          setUsageCount((c) => c + 1);
        }
      } catch {
        showAlert('Error', 'Could not generate picks. Try again.');
      } finally {
        setLoading(false);
      }
  }, [selectedLottery, activeSet, proUnlocked, loadPicksByDate]);

  const handleConfirmGenerateModal = useCallback(async () => {
    const pending = pendingGenerateRef.current;
    setShowGenerateConfirm(false);
    pendingGenerateRef.current = null;
    if (pending) await doGenerate(pending.history, pending.drawDate);
  }, [doGenerate]);

  const handleSwitchSet = async (set: StrategySet) => {
    await setActiveSetId(selectedLottery, set.id);
    setActiveSet(set);
  };

  const handleDeleteSet = async () => {
    const target = deleteSetTarget;
    setDeleteSetTarget(null);
    if (!target || sets.length <= 1) return;
    await deleteStrategySet(selectedLottery, target.id);
    const list = await getStrategySets(selectedLottery);
    const active = await getActiveStrategySet(selectedLottery);
    setSets(list);
    setActiveSet(active);
  };

  const handleCoarseAdjust = async (featureId: FeatureId, direction: 'more' | 'less') => {
    if (!activeSet) return;
    const current = activeSet.featureWeights[featureId] ?? 0.5;
    const next = coarseAdjust(current, direction);
    const updated = { ...activeSet, featureWeights: { ...activeSet.featureWeights, [featureId]: next } };
    await updateStrategySet(updated);
    setActiveSet(updated);
  };

  const handleLuckyBiasStrengthChange = async (direction: 'up' | 'down') => {
    if (!activeSet) return;
    const opts = LUCKY_BIAS_OPTIONS;
    const idx = opts.findIndex((o) => o.value === (activeSet.luckyBiasStrength ?? 'off'));
    const nextIdx = direction === 'up' ? (idx + 1) % opts.length : (idx - 1 + opts.length) % opts.length;
    const next = opts[nextIdx].value;
    const updated = { ...activeSet, luckyBiasStrength: next };
    await updateStrategySet(updated);
    setActiveSet(updated);
  };

  const handleLuckyNumberChange = async (index: number, value: string) => {
    if (!activeSet) return;
    const def = LOTTERY_DEFS[selectedLottery];
    const min = def?.main_min ?? 1;
    const max = def?.main_max ?? 49;
    const nums = [...(activeSet.luckyNumbers ?? []), 0, 0, 0].slice(0, 3);
    const parsed = parseInt(value.replace(/\D/g, ''), 10);
    nums[index] = value === '' ? 0 : !isNaN(parsed) && parsed >= min && parsed <= max ? parsed : nums[index];
    const trimmed = nums.filter((n) => n > 0);
    const updated = { ...activeSet, luckyNumbers: trimmed };
    await updateStrategySet(updated);
    setActiveSet(updated);
  };

  const handleOpenEdit = (featureId: FeatureId) => {
    const w = activeSet?.featureWeights[featureId] ?? 0.5;
    setEditingFeature(featureId);
    setEditingValue(Math.round(w * 100).toString());
  };

  const handleConfirmEdit = async () => {
    if (!editingFeature || !activeSet) return;
    const parsed = parseFloat(editingValue);
    if (isNaN(parsed) || parsed < 0 || parsed > 100) {
      showAlert('Invalid', 'Enter a number between 0 and 100.');
      return;
    }
    const next = Math.max(0, Math.min(1, parsed / 100));
    const updated = { ...activeSet, featureWeights: { ...activeSet.featureWeights, [editingFeature]: next } };
    await updateStrategySet(updated);
    setActiveSet(updated);
    setEditingFeature(null);
    setEditingValue('');
  };

  const REFINE_CONFIRM_MSG =
    'Please confirm that the past draw and your picks are entered correctly. Incorrect data will affect refine results. For best results, use picks previously generated by Strategy Lab.';

  const doRefine = async () => {
    if (!activeSet) return;
    const def = LOTTERY_DEFS[selectedLottery];
    const mainCount = def?.main_count ?? 7;
    const mainMax = def?.main_max ?? 49;
    const specialMin = def?.special_min ?? 1;
    const specialMax = def?.special_max ?? 49;

    const winning = winningNumbersArray
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n));
    const picks = userPicksArray
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n));

    const mainWinning = winning.slice(0, mainCount);
    const specialWinning = winning.slice(mainCount);
    const needsSpecialWinning = !['lotto_max', 'lotto_649'].includes(selectedLottery);
    if (mainWinning.length < mainCount || mainWinning.some((n) => n < def!.main_min || n > mainMax)) {
      showAlert('Invalid input', `Enter ${mainCount} winning numbers (${def!.main_min}-${mainMax}).`);
      return;
    }
    if (new Set(mainWinning).size < mainWinning.length) {
      showAlert('Invalid input', 'Winning numbers must not contain duplicates.');
      return;
    }
    if (needsSpecialWinning && specialWinning.length < (def!.special_count ?? 1)) {
      showAlert('Invalid input', `Enter ${def!.special_count ?? 1} winning special number(s) (${specialMin}-${specialMax}).`);
      return;
    }
    if (needsSpecialWinning && specialWinning.length > 0 && specialWinning.some((n) => n < specialMin || n > specialMax)) {
      showAlert('Invalid input', `Winning special number(s) must be ${specialMin}-${specialMax}.`);
      return;
    }
    const mainPicks = picks.slice(0, mainCount);
    const specialPicks = picks.slice(mainCount);
    const needsSpecialPicks = !['lotto_max', 'lotto_649'].includes(selectedLottery);
    if (mainPicks.length < mainCount || mainPicks.some((n) => n < def!.main_min || n > mainMax)) {
      showAlert('Invalid input', `Enter ${mainCount} main numbers (${def!.main_min}-${mainMax}) in your picks.`);
      return;
    }
    const mainSet = new Set(mainPicks);
    if (mainSet.size < mainPicks.length) {
      showAlert('Invalid input', 'Your picks must not contain duplicate main numbers.');
      return;
    }
    if (needsSpecialPicks && specialPicks.length < (def!.special_count ?? 1)) {
      showAlert('Invalid input', `Enter ${def!.special_count ?? 1} special number(s) (${specialMin}-${specialMax}).`);
      return;
    }
    if (needsSpecialPicks && specialPicks.length > 0 && specialPicks.some((n) => n < specialMin || n > specialMax)) {
      showAlert('Invalid input', `Special number(s) must be ${specialMin}-${specialMax}.`);
      return;
    }
    if (needsSpecialPicks && new Set(specialPicks).size < specialPicks.length) {
      showAlert('Invalid input', 'Your picks must not contain duplicate special numbers.');
      return;
    }
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

      setRefineProposal({
        deltas: proposal.deltas.map((d) => ({
          featureId: d.featureId,
          direction: d.direction,
          magnitude: d.magnitude,
        })),
        reasoning: proposal.reasoning,
      });
    } catch {
      setRefineProposal(null);
    } finally {
      setRefineLoading(false);
    }
  };

  const handleRefine = () => {
    if (!activeSet) return;
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      if (window.confirm(REFINE_CONFIRM_MSG)) doRefine();
      return;
    }
    Alert.alert('Confirm inputs', REFINE_CONFIRM_MSG, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Compute', onPress: () => doRefine() },
    ]);
  };

  const handleConfirmRefine = async () => {
    if (!refineProposal || !activeSet) return;
    try {
      const updated = await applyFeatureAdjustment(
        activeSet,
        refineProposal.deltas.map((d) => ({
          featureId: d.featureId as FeatureId,
          direction: d.direction as 'increase' | 'decrease',
          magnitude: d.magnitude,
        }))
      );
      setActiveSet(updated);
      setShowRefineModal(false);
      setRefineProposal(null);
      setPastDrawsDropdownOpen(false);
      setShowPickBookInRefine(false);
      setWinningNumbersArray([]);
      setUserPicksArray([]);
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
      setProUnlockedState(true);
    } catch (e) {
      showAlert('Purchase failed', e instanceof Error ? e.message : 'Could not complete purchase.');
    }
  };

  const handleAddSet = async () => {
    const max = await getMaxSets();
    if (sets.length >= max) {
      showAlert('Limit reached', `Free: 3 sets. ${hadAstronautSubscription ? 'Upgrade to Astronaut plan' : 'Start 1-month free trial'} for up to ${max} sets.`);
      return;
    }
    const newSet = await createStrategySet(selectedLottery);
    if (newSet) {
      await loadSets();
      setActiveSet(newSet);
    }
  };

  const categories: FeatureCategory[] = ['structure', 'position', 'trend', 'risk'];

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + SPACING.screenPadding, paddingBottom: SPACING.screenPaddingBottom }]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={true}
    >
      <View style={styles.headerRow}>
        <Ionicons name="flask" size={24} color={COLORS.gold} style={styles.titleIcon} />
        <Text style={styles.title}>Strategy Lab</Text>
        <TouchableOpacity onPress={() => setShowStrategyLabGuide(true)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} style={styles.headerBookBtn}>
          <Ionicons name="book-outline" size={22} color={COLORS.gold} />
        </TouchableOpacity>
      </View>

      <View style={styles.usageBar}>
        <View style={styles.usageRow}>
          {proUnlocked ? (
            <Text style={styles.usageText}>Unlimited simulations (Astronaut)</Text>
          ) : (
            <>
              <Text style={styles.usageText}>Strategy Lab requires Astronaut plan</Text>
              <TouchableOpacity onPress={() => setShowPaywall(true)} style={styles.upgradeLink}>
                <Text style={styles.upgradeLinkText}>{hadAstronautSubscription ? 'Upgrade to Astronaut plan' : 'Start 1-month free trial'}</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>

      <Modal visible={showGenerateConfirm} transparent animationType="fade">
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowGenerateConfirm(false)}>
          <TouchableOpacity activeOpacity={1} onPress={(e) => e.stopPropagation()} style={styles.generateConfirmCard}>
            <Text style={styles.generateConfirmTitle}>Generate picks?</Text>
            <Text style={styles.generateConfirmText}>
              This will add 1 set of picks for today.
            </Text>
            <View style={styles.generateConfirmActions}>
              <TouchableOpacity style={styles.generateConfirmBtn} onPress={() => setShowGenerateConfirm(false)}>
                <Text style={styles.generateConfirmBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.generateConfirmBtn, styles.generateConfirmBtnPrimary]} onPress={handleConfirmGenerateModal}>
                <Text style={styles.generateConfirmBtnTextPrimary}>Confirm</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={styles.generateConfirmUpgrade} onPress={() => { setShowGenerateConfirm(false); setShowPaywall(true); }}>
              <Text style={styles.generateConfirmUpgradeText}>{hadAstronautSubscription ? 'Upgrade to Astronaut plan' : 'Start 1-month free trial'}</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Strategy Sets</Text>
        <Text style={styles.cardDesc}>Switch between parallel strategies. Each set has its own feature weights.</Text>
        <View style={styles.setRow}>
          {sets.map((s) => (
            <TouchableOpacity
              key={s.id}
              style={[styles.setChip, activeSet?.id === s.id && styles.setChipActive]}
              onPress={() => handleSwitchSet(s)}
              onLongPress={() => sets.length > 1 && setDeleteSetTarget(s)}
            >
              <Text style={styles.setChipText}>{s.name}</Text>
            </TouchableOpacity>
          ))}
          {sets.length < 10 && (
            <TouchableOpacity style={styles.setChipAdd} onPress={handleAddSet}>
              <Ionicons name="add" size={18} color={COLORS.gold} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {activeSet && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Feature Weights</Text>
          <Text style={styles.cardDesc}>Tap tube to enter value. Height = weight strength.</Text>
          {categories.map((cat) => {
            const features = STRATEGY_FEATURES.filter((f) => f.category === cat);
            if (features.length === 0) return null;
            const color = FEATURE_CATEGORY_COLORS[cat];
            return (
              <View key={cat} style={styles.tubeSection}>
                <Text style={[styles.tubeCategory, { color }]}>{cat.charAt(0).toUpperCase() + cat.slice(1)}</Text>
                <View style={styles.tubeRow}>
                  {features.map((f) => {
                    const w = activeSet.featureWeights[f.id] ?? 0.5;
                    const pct = Math.round(w * 100).toString();
                    return (
                      <View key={f.id} style={styles.tubeWrap}>
                        <View style={styles.tubeLeft}>
                          <View style={styles.tubeAndArrowRow}>
                            <TouchableOpacity
                              style={styles.tubeContainer}
                              onPress={() => handleOpenEdit(f.id as FeatureId)}
                              activeOpacity={0.8}
                            >
                              <View style={[styles.tubeFill, { height: `${w * 100}%`, backgroundColor: color }]} />
                            </TouchableOpacity>
                            <View style={styles.arrowCol}>
                          <TouchableOpacity
                            style={[styles.arrowBtn, w >= 1 && styles.arrowBtnDisabled]}
                            onPress={() => handleCoarseAdjust(f.id as FeatureId, 'more')}
                            disabled={w >= 1}
                          >
                            <Ionicons name="chevron-up" size={14} color={COLORS.gold} />
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.arrowBtn, w <= 0 && styles.arrowBtnDisabled]}
                            onPress={() => handleCoarseAdjust(f.id as FeatureId, 'less')}
                            disabled={w <= 0}
                          >
                            <Ionicons name="chevron-down" size={14} color={COLORS.gold} />
                          </TouchableOpacity>
                        </View>
                          </View>
                          <Text style={styles.tubeValue}>{pct}</Text>
                          <Text style={styles.tubeLabel}>{f.label}</Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              </View>
            );
          })}
          <View style={styles.tubeSection}>
            <Text style={[styles.tubeCategory, { color: '#a78bfa' }]}>Personal Bias</Text>
            <Text style={styles.luckyBiasDisclaimer}>{LUCKY_BIAS_DISCLAIMER}</Text>
            <View style={styles.tubeRow}>
              <View style={styles.tubeWrap}>
                <View style={styles.tubeLeft}>
                  <View style={styles.tubeAndArrowRow}>
                    <TouchableOpacity
                      style={styles.tubeContainer}
                      onPress={() => handleLuckyBiasStrengthChange('up')}
                      activeOpacity={0.8}
                    >
                      <View
                        style={[
                          styles.tubeFill,
                          {
                            height: `${(LUCKY_BIAS_OPTIONS.find((o) => o.value === (activeSet.luckyBiasStrength ?? 'off'))?.fill ?? 0) * 100}%`,
                            backgroundColor: (activeSet.luckyBiasStrength ?? 'off') === 'off' ? COLORS.textMuted : '#a78bfa',
                          },
                        ]}
                      />
                    </TouchableOpacity>
                    <View style={styles.arrowCol}>
                  <TouchableOpacity style={styles.arrowBtn} onPress={() => handleLuckyBiasStrengthChange('up')}>
                    <Ionicons name="chevron-up" size={14} color={COLORS.gold} />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.arrowBtn} onPress={() => handleLuckyBiasStrengthChange('down')}>
                    <Ionicons name="chevron-down" size={14} color={COLORS.gold} />
                  </TouchableOpacity>
                </View>
                  </View>
                  <Text style={styles.tubeValue}>
                    {LUCKY_BIAS_OPTIONS.find((o) => o.value === (activeSet.luckyBiasStrength ?? 'off'))?.label ?? 'Off'}
                  </Text>
                  <Text style={styles.tubeLabel}>Lucky Bias</Text>
                </View>
              </View>
              <View style={styles.luckyNumbersWrap}>
                <Text style={styles.luckyNumbersLabel}>Lucky (1–3)</Text>
                <View style={styles.luckyNumbersRow}>
                  {[0, 1, 2].map((i) => {
                    const def = LOTTERY_DEFS[selectedLottery];
                    const min = def?.main_min ?? 1;
                    const max = def?.main_max ?? 49;
                    const val = editingLuckyIndex === i ? editingLuckyValue : ((activeSet.luckyNumbers ?? [])[i] ? String((activeSet.luckyNumbers ?? [])[i]) : '');
                    return (
                      <TextInput
                        key={i}
                        style={styles.luckyNumberCell}
                        value={val}
                        onChangeText={(t) => {
                          if (editingLuckyIndex === i) setEditingLuckyValue(t.replace(/\D/g, ''));
                        }}
                        onFocus={() => {
                          setEditingLuckyIndex(i);
                          setEditingLuckyValue((activeSet.luckyNumbers ?? [])[i] ? String((activeSet.luckyNumbers ?? [])[i]) : '');
                        }}
                        onBlur={() => {
                          if (editingLuckyIndex === i) {
                            handleLuckyNumberChange(i, editingLuckyValue);
                            setEditingLuckyIndex(null);
                          }
                        }}
                        placeholder="—"
                        placeholderTextColor={COLORS.textMuted}
                        keyboardType="number-pad"
                        maxLength={String(max).length}
                      />
                    );
                  })}
                </View>
              </View>
            </View>
          </View>
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Generate Picks</Text>
        <Text style={styles.cardDesc}>Uses current Strategy Set weights. Local engine only.</Text>
        <View style={styles.lotteryRow}>
          {(Object.keys(LOTTERY_DEFS) as LotteryId[]).map((id) => (
            <TouchableOpacity
              key={id}
              style={[styles.lotteryPill, selectedLottery === id && styles.lotteryPillActive]}
              onPress={() => setSelectedLottery(id)}
            >
              <Text style={styles.lotteryPillText}>{LOTTERY_DEFS[id].name}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity
          style={[styles.generateBtn, isSignedIn !== false && (!canGenerate || !activeSet || loading) && styles.generateBtnDisabled]}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          onPress={() => {
            if (isSignedIn === false) {
              (navigation as { navigate: (s: string) => void }).navigate('Login');
              return;
            }
            if (!activeSet) {
              showAlert('Please wait', 'Strategy Sets are loading. Try again in a moment.');
              return;
            }
            if (!canGenerate) {
              setShowPaywall(true);
              return;
            }
            if (loading) return;
            setLoading(true);
            handleGenerate()
              .finally(() => setLoading(false))
              .catch((err) => {
                showAlert('Error', err instanceof Error ? err.message : 'Could not generate picks. Try again.');
              });
          }}
          activeOpacity={0.7}
        >
          {isSignedIn === false ? (
            <>
              <Ionicons name="log-in-outline" size={20} color={COLORS.text} style={styles.btnIcon} />
              <Text style={styles.generateBtnText}>Sign in to use Generate Picks</Text>
            </>
          ) : loading ? (
            <ActivityIndicator size="small" color={COLORS.text} />
          ) : (
            <>
              <Ionicons name="sparkles" size={20} color={COLORS.text} style={styles.btnIcon} />
              <Text style={styles.generateBtnText}>Generate Picks</Text>
            </>
          )}
        </TouchableOpacity>
        {isSignedIn !== false && !canGenerate && (
          <Text style={styles.upgradeHint}>{hadAstronautSubscription ? 'Upgrade to Astronaut plan for Strategy Lab.' : 'Start 1-month free trial to use Strategy Lab.'}</Text>
        )}
        {(() => {
          const today = getTodayDateString();
          const todayPicks = picksByDate[today];
          return todayPicks && todayPicks.length > 0 ? (
          <View style={styles.results}>
            <Text style={styles.resultsTitle}>Generated picks ({today})</Text>
            <View key={today} style={styles.dateGroup}>
              <View style={styles.dateGroupHeader}>
                <Text style={styles.dateGroupTitle}>{today}</Text>
                <TouchableOpacity
                  style={[styles.addToPickBookBtn, inBookDateKeys.has(`${selectedLottery}:${today}`) && styles.addToPickBookBtnDisabled]}
                  onPress={async () => {
                    if (inBookDateKeys.has(`${selectedLottery}:${today}`)) return;
                    try {
                      const id = await addToPickBook(selectedLottery, today, todayPicks);
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
                  <Ionicons name="book-outline" size={16} color={inBookDateKeys.has(`${selectedLottery}:${today}`) ? COLORS.textMuted : COLORS.gold} />
                  <Text style={[styles.addToPickBookText, inBookDateKeys.has(`${selectedLottery}:${today}`) && styles.addToPickBookTextDisabled]}>
                    {inBookDateKeys.has(`${selectedLottery}:${today}`) ? 'In Pick Book' : 'Add to Pick Book'}
                  </Text>
                </TouchableOpacity>
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
                  <Text style={styles.explanation}>{p.explanation}</Text>
                </View>
              ))}
            </View>
          </View>
          ) : null;
        })()}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Refine Strategy</Text>
        <Text style={styles.cardDesc}>
          Enter winning numbers and your picks. AI suggests small weight adjustments (±5% max). Does not predict outcomes.
        </Text>
        <TouchableOpacity
          style={[styles.refineBtn, !proUnlocked && !devUnlockRefine && styles.refineBtnDisabled]}
          onPress={() => setShowRefineModal(true)}
          disabled={!proUnlocked && !devUnlockRefine}
        >
          <Ionicons name="construct" size={20} color={COLORS.text} style={styles.btnIcon} />
          <Text style={styles.refineBtnText}>Refine Strategy</Text>
        </TouchableOpacity>
        {!proUnlocked && !devUnlockRefine && (
          <Text style={styles.upgradeHint}>{hadAstronautSubscription ? 'Upgrade to Astronaut plan for AI refinement.' : 'Start 1-month free trial to use AI-assisted refinement.'}</Text>
        )}
        {devUnlockRefine && (
          <Text style={[styles.upgradeHint, { color: COLORS.success }]}>Dev: Refine Strategy unlocked for web testing</Text>
        )}
      </View>

      <Modal visible={editingFeature !== null} transparent animationType="fade">
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setEditingFeature(null)}
        >
          <TouchableOpacity activeOpacity={1} onPress={(e) => e.stopPropagation()} style={styles.editModalCard}>
            <Text style={styles.editModalTitle}>
              {editingFeature && STRATEGY_FEATURES.find((x) => x.id === editingFeature)?.label}
            </Text>
            <Text style={styles.editModalHint}>Enter value 0–100</Text>
            <TextInput
              style={styles.editModalInput}
              value={editingValue}
              onChangeText={setEditingValue}
              keyboardType="decimal-pad"
              placeholder="50"
              placeholderTextColor={COLORS.textMuted}
              autoFocus
            />
            <TouchableOpacity style={styles.editModalConfirm} onPress={handleConfirmEdit}>
              <Text style={styles.editModalConfirmText}>Confirm</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setEditingFeature(null)}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal visible={deleteSetTarget !== null} transparent animationType="fade">
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setDeleteSetTarget(null)}
        >
          <TouchableOpacity activeOpacity={1} onPress={(e) => e.stopPropagation()} style={styles.editModalCard}>
            <Text style={styles.editModalTitle}>Delete Strategy Set</Text>
            <Text style={styles.editModalHint}>
              Delete "{deleteSetTarget?.name}"? This cannot be undone.
            </Text>
            <TouchableOpacity
              style={[styles.editModalConfirm, { backgroundColor: COLORS.error }]}
              onPress={handleDeleteSet}
            >
              <Text style={styles.editModalConfirmText}>Delete</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setDeleteSetTarget(null)}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal visible={showRefineModal} transparent animationType="fade">
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => {
            setShowRefineModal(false);
            setRefineProposal(null);
            setPastDrawsDropdownOpen(false);
            setShowPickBookInRefine(false);
          }}
        >
          <View
            style={[styles.modalCard, styles.refineModalCard, { maxHeight: Dimensions.get('window').height * 0.9 }]}
            onStartShouldSetResponder={() => true}
            onResponderTerminationRequest={() => true}
          >
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Refine Strategy</Text>
              <TouchableOpacity
                onPress={() => {
                  setShowRefineModal(false);
                  setRefineProposal(null);
                  setPastDrawsDropdownOpen(false);
                  setShowPickBookInRefine(false);
                }}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Ionicons name="close" size={24} color={COLORS.textMuted} />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalDisclaimer}>{DISCLAIMER}</Text>
            {showPickBookInRefine ? (
              <View style={styles.refinePickBookContainer}>
                <TouchableOpacity onPress={() => setShowPickBookInRefine(false)} style={styles.refinePickBookBack}>
                  <Ionicons name="arrow-back" size={20} color={COLORS.textSecondary} />
                  <Text style={styles.refinePickBookBackText}>Back</Text>
                </TouchableOpacity>
                <Text style={styles.refinePickBookTitle}>Select from Pick Book</Text>
                <Text style={styles.refinePickBookSubtitle}>
                  Choose a saved pick to fill Your picks. Only {LOTTERY_DEFS[selectedLottery]?.name ?? selectedLottery} records shown.
                </Text>
                {refinePickBookLoading ? (
                  <ActivityIndicator size="large" color={COLORS.gold} style={{ marginTop: 24 }} />
                ) : refinePickBookRecords.length === 0 ? (
                  <View style={styles.refinePickBookEmpty}>
                    <Ionicons name="book-outline" size={40} color={COLORS.textMuted} />
                    <Text style={styles.refinePickBookEmptyText}>No picks for this lottery</Text>
                    <Text style={styles.refinePickBookEmptyHint}>Add picks from Generated picks → Add to Pick Book</Text>
                  </View>
                ) : (
                  <ScrollView style={styles.refinePickBookList} showsVerticalScrollIndicator={false}>
                    {refinePickBookRecords.map((r) => {
                      const first = r.picks[0];
                      const mainStr = first?.main.map(String).join(' ') ?? '';
                      const specialStr = first?.special.map(String).join(' ') ?? '';
                      const preview = [mainStr, specialStr].filter(Boolean).join(' ');
                      return (
                        <TouchableOpacity
                          key={r.id}
                          style={styles.refinePickBookItem}
                          onPress={() => {
                            const def = LOTTERY_DEFS[selectedLottery];
                            const mainCount = def?.main_count ?? 7;
                            const specialCount = userPicksSpecialCount;
                            const arr = [
                              ...(first?.main ?? []).slice(0, mainCount).map(String),
                              ...(first?.special ?? []).slice(0, specialCount).map(String),
                            ].slice(0, mainCount + specialCount);
                            setUserPicksArray((prev) =>
                              Array.from({ length: mainCount + specialCount }, (_, j) => arr[j] ?? '')
                            );
                            setShowPickBookInRefine(false);
                          }}
                        >
                          <Text style={styles.refinePickBookItemDate}>{r.draw_date}</Text>
                          <Text style={styles.refinePickBookItemNums} numberOfLines={1}>{preview}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                )}
              </View>
            ) : !refineProposal ? (
              <View style={styles.refineScrollWrap}>
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
                <Text style={styles.inputLabel}>
                  Winning numbers ({LOTTERY_DEFS[selectedLottery]?.main_count ?? 7} main
                  {userPicksSpecialCount > 0 ? ` + ${userPicksSpecialCount} special` : ' (bonus drawn from main)'})
                </Text>
                <TouchableOpacity
                  style={styles.pastDrawsDropdown}
                  onPress={() => !pastDrawsLoading && pastDrawsForRefine.length > 0 && setPastDrawsDropdownOpen(true)}
                  disabled={pastDrawsLoading || pastDrawsForRefine.length === 0}
                >
                  {pastDrawsLoading ? (
                    <ActivityIndicator size="small" color={COLORS.gold} />
                  ) : pastDrawsForRefine.length > 0 ? (
                    <>
                      <Text style={styles.pastDrawsDropdownText}>Pick from past draws</Text>
                      <Ionicons name="chevron-down" size={20} color={COLORS.textSecondary} />
                    </>
                  ) : (
                    <Text style={styles.pastDrawsDropdownText}>No past draws available</Text>
                  )}
                </TouchableOpacity>
                <View style={styles.pickCellsRow}>
                  {Array.from({ length: (LOTTERY_DEFS[selectedLottery]?.main_count ?? 7) + userPicksSpecialCount }, (_, i) => {
                    const val = winningNumbersArray[i] ?? '';
                    const def = LOTTERY_DEFS[selectedLottery];
                    const isSpecial = def && i >= (def.main_count ?? 7);
                    const maxVal = isSpecial ? (def?.special_max ?? 49) : (def?.main_max ?? 49);
                    return (
                      <TextInput
                        key={`w-${i}`}
                        style={[styles.pickCell, isSpecial && styles.pickCellSpecial]}
                        value={val}
                        onChangeText={(t) => {
                          setWinningNumbersArray((prev) => {
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
                <Modal visible={pastDrawsDropdownOpen} transparent animationType="fade">
                  <TouchableOpacity
                    style={styles.modalOverlay}
                    activeOpacity={1}
                    onPress={() => setPastDrawsDropdownOpen(false)}
                  >
                    <TouchableOpacity activeOpacity={1} onPress={(e) => e.stopPropagation()} style={styles.pastDrawsDropdownModal}>
                      <Text style={styles.pastDrawsDropdownModalTitle}>Select past draw</Text>
                      <ScrollView style={styles.pastDrawsDropdownList} showsVerticalScrollIndicator={false}>
                        {pastDrawsForRefine.map((d) => {
                          const nums = [...d.winning_numbers, ...(d.special_numbers || [])].join(' ');
                          return (
                            <TouchableOpacity
                              key={d.draw_date}
                              style={styles.pastDrawItem}
                              onPress={() => {
                                const def = LOTTERY_DEFS[selectedLottery];
                                const mainCount = def?.main_count ?? 7;
                                const specialCount = ['lotto_max', 'lotto_649'].includes(selectedLottery) ? 0 : (def?.special_count ?? 1);
                                const arr = [
                                  ...d.winning_numbers.slice(0, mainCount).map(String),
                                  ...(d.special_numbers || []).slice(0, specialCount).map(String),
                                ].slice(0, mainCount + specialCount);
                                setWinningNumbersArray((prev) =>
                                  Array.from({ length: mainCount + specialCount }, (_, j) => arr[j] ?? '')
                                );
                                setPastDrawsDropdownOpen(false);
                              }}
                            >
                              <Text style={styles.pastDrawDate}>{d.draw_date}</Text>
                              <Text style={styles.pastDrawNums}>{nums}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </ScrollView>
                      <TouchableOpacity style={styles.cancelBtn} onPress={() => setPastDrawsDropdownOpen(false)}>
                        <Text style={styles.cancelBtnText}>Cancel</Text>
                      </TouchableOpacity>
                    </TouchableOpacity>
                  </TouchableOpacity>
                </Modal>
                <Text style={styles.inputLabel}>
                  Your picks ({LOTTERY_DEFS[selectedLottery]?.main_count ?? 7} main
                  {userPicksSpecialCount > 0 ? ` + ${userPicksSpecialCount} special` : ' (bonus drawn from main)'})
                </Text>
                <View style={styles.pickCellsRow}>
                  {Array.from({ length: (LOTTERY_DEFS[selectedLottery]?.main_count ?? 7) + userPicksSpecialCount }, (_, i) => {
                    const val = userPicksArray[i] ?? '';
                    const def = LOTTERY_DEFS[selectedLottery];
                    const isSpecial = def && i >= (def.main_count ?? 7);
                    const maxVal = isSpecial ? (def?.special_max ?? 49) : (def?.main_max ?? 49);
                    return (
                      <TextInput
                        key={`p-${i}`}
                        style={[styles.pickCell, isSpecial && styles.pickCellSpecial]}
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
                        placeholder={isSpecial ? 'S' : String(i + 1)}
                        placeholderTextColor={COLORS.textMuted}
                        keyboardType="number-pad"
                        maxLength={String(maxVal).length}
                      />
                    );
                  })}
                </View>
                <TouchableOpacity
                  style={styles.fromPickBookRow}
                  onPress={() => setShowPickBookInRefine(true)}
                >
                  <Ionicons name="book-outline" size={18} color={COLORS.gold} />
                  <Text style={styles.fromPickBookRowText}>From Pick Book</Text>
                  <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
                </TouchableOpacity>
                {refineLoading ? (
                  <ActivityIndicator size="large" color={COLORS.gold} style={{ marginVertical: 24 }} />
                ) : (
                  <>
                    <TouchableOpacity style={styles.refineSubmitBtn} onPress={handleRefine}>
                      <Text style={styles.refineSubmitBtnText}>Compute refinement</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.cancelBtn} onPress={() => { setShowRefineModal(false); setPastDrawsDropdownOpen(false); setShowPickBookInRefine(false); }}>
                      <Text style={styles.cancelBtnText}>Cancel</Text>
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
              </View>
            ) : (
              <ScrollView style={styles.proposalScroll} contentContainerStyle={styles.proposalScrollContent} showsVerticalScrollIndicator={true}>
                <Text style={styles.proposalSection}>Proposed changes (±5% max)</Text>
                {refineProposal.deltas.map((d, i) => (
                  <View key={i} style={styles.deltaRow}>
                    <Text style={styles.deltaParam}>{d.featureId}</Text>
                    <Text style={styles.deltaDir}>{d.direction === 'increase' ? '+' : '−'} {(d.magnitude * 100).toFixed(1)}%</Text>
                  </View>
                ))}
                <Text style={styles.proposalSection}>Reasoning</Text>
                <Text style={styles.reasoning}>{refineProposal.reasoning}</Text>
                <TouchableOpacity style={styles.confirmBtn} onPress={handleConfirmRefine}>
                  <Text style={styles.confirmBtnText}>Apply refinement</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.cancelBtn, { marginBottom: 24, paddingVertical: 12 }]}
                  onPress={() => {
                    setShowRefineModal(false);
                    setRefineProposal(null);
                    setPastDrawsDropdownOpen(false);
                    setShowPickBookInRefine(false);
                  }}
                >
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
              </ScrollView>
            )}
          </View>
        </TouchableOpacity>
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
                <TouchableOpacity
                  style={styles.guideYoutubeBtn}
                  onPress={() => Linking.openURL(STRATEGY_LAB_YOUTUBE_URL)}
                  activeOpacity={0.8}
                >
                  <Ionicons name="play-circle" size={24} color={COLORS.gold} style={{ marginRight: 8 }} />
                  <Text style={styles.guideYoutubeBtnText}>Watch tutorial video</Text>
                </TouchableOpacity>
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
          <View style={[styles.paywallCard, { alignSelf: 'center' }]}>
            <Text style={styles.paywallTitle}>{hadAstronautSubscription ? 'Upgrade to Astronaut plan' : 'Start 1-month free trial'}</Text>
            <Text style={styles.paywallDesc}>
              {hadAstronautSubscription ? `Full Strategy Lab + Compass. ${astronautPrice}.` : `Full Strategy Lab + Compass access. After trial, ${astronautPrice}.`}
            </Text>
            <Pressable
              style={({ pressed }) => [styles.purchaseBtn, pressed && { opacity: 0.8 }]}
              onPress={handlePurchasePro}
            >
              <Text style={styles.purchaseBtnText}>{hadAstronautSubscription ? 'Upgrade to Astronaut plan' : 'Start 1-month free trial'}</Text>
            </Pressable>
            <Pressable style={styles.cancelBtn} onPress={() => setShowPaywall(false)}>
              <Text style={styles.cancelBtnText}>Maybe later</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  content: { paddingHorizontal: SPACING.screenPadding },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  titleIcon: { marginRight: 10 },
  title: { fontSize: 24, fontWeight: '700', color: COLORS.text, flex: 1 },
  headerBookBtn: { marginLeft: 'auto' },
  usageBar: {
    backgroundColor: COLORS.bgCard,
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.gold,
  },
  usageRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  usageText: { color: COLORS.text, fontSize: 14, fontWeight: '600', flex: 1 },
  upgradeLink: { paddingVertical: 4 },
  upgradeLinkText: { color: COLORS.gold, fontSize: 14, fontWeight: '600' },
  card: { backgroundColor: COLORS.bgCard, borderRadius: 12, padding: 18, marginBottom: 16 },
  cardTitle: { color: COLORS.text, fontSize: 18, fontWeight: '600', marginBottom: 8 },
  cardDesc: { color: COLORS.textSecondary, fontSize: 14, marginBottom: 12 },
  setRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  setChip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: COLORS.bgElevated,
  },
  setChipActive: { backgroundColor: COLORS.primary },
  setChipText: { color: COLORS.text, fontSize: 14, fontWeight: '600' },
  setChipAdd: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: COLORS.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.gold,
  },
  tubeSection: { marginBottom: 20 },
  tubeCategory: { fontSize: 12, fontWeight: '700', marginBottom: 8, textTransform: 'uppercase' },
  luckyBiasDisclaimer: { color: COLORS.textMuted, fontSize: 11, fontStyle: 'italic', marginBottom: 10 },
  luckyNumbersWrap: { marginLeft: 16 },
  luckyNumbersLabel: { color: COLORS.textSecondary, fontSize: 10, marginBottom: 4 },
  luckyNumbersRow: { flexDirection: 'row', gap: 6 },
  luckyNumberCell: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: COLORS.bgElevated,
    borderWidth: 1,
    borderColor: '#a78bfa',
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    padding: 0,
  },
  tubeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tubeWrap: { flexDirection: 'row', alignItems: 'flex-start', width: 64 },
  tubeLeft: { alignItems: 'center', flex: 1 },
  tubeAndArrowRow: { flexDirection: 'row', alignItems: 'flex-end' },
  tubeContainer: {
    width: 24,
    height: 60,
    backgroundColor: COLORS.bgElevated,
    borderRadius: 4,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  tubeFill: { width: '100%', borderRadius: 2 },
  tubeValue: { color: COLORS.text, fontSize: 11, fontWeight: '700', marginTop: 2 },
  tubeLabel: { color: COLORS.textSecondary, fontSize: 9, marginTop: 2, textAlign: 'center' },
  arrowCol: { flexDirection: 'column', marginLeft: 4, gap: 2 },
  arrowBtn: {
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderRadius: 4,
    backgroundColor: COLORS.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowBtnDisabled: { opacity: 0.4 },
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
  editModalHint: { color: COLORS.textSecondary, fontSize: 12, marginBottom: 12 },
  editModalInput: {
    backgroundColor: COLORS.bgElevated,
    borderRadius: 10,
    padding: 14,
    color: COLORS.text,
    fontSize: 18,
    marginBottom: 16,
  },
  editModalConfirm: {
    backgroundColor: COLORS.gold,
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 8,
  },
  editModalConfirmText: { color: COLORS.bg, fontWeight: '700', fontSize: 14 },
  lotteryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  lotteryPill: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, backgroundColor: COLORS.bgElevated },
  lotteryPillActive: { backgroundColor: COLORS.primary },
  lotteryPillText: { color: COLORS.text, fontSize: 12 },
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
  refineBtn: {
    backgroundColor: COLORS.gold,
    padding: 14,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  refineBtnDisabled: { opacity: 0.5 },
  refineBtnText: { color: COLORS.bg, fontWeight: '700', fontSize: 14 },
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
  explanation: { color: COLORS.textSecondary, fontSize: 11, marginTop: 8 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  modalCard: { backgroundColor: COLORS.bgCard, borderRadius: 16, padding: 20, width: '100%', maxWidth: 360, maxHeight: '85%', overflow: 'hidden' },
  refineModalCard: { maxHeight: '90%', flex: 1, flexDirection: 'column' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: COLORS.text },
  modalDisclaimer: { color: COLORS.textMuted, fontSize: 11, marginBottom: 16, fontStyle: 'italic' },
  inputLabel: { color: COLORS.textSecondary, fontSize: 12, marginTop: 12, marginBottom: 4 },
  refineScrollWrap: { flex: 1, flexDirection: 'row', minHeight: 180 },
  refineInputScroll: { flex: 1 },
  refineInputScrollContent: { paddingBottom: 32 },
  fromPickBookRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 12,
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
  refinePickBookEmpty: { alignItems: 'center', paddingVertical: 32 },
  refinePickBookEmptyText: { color: COLORS.textMuted, fontSize: 14, marginTop: 12 },
  refinePickBookEmptyHint: { color: COLORS.textMuted, fontSize: 12, marginTop: 8, textAlign: 'center' },
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
    marginTop: 16,
    marginBottom: 8,
  },
  refineSubmitBtnText: { color: COLORS.bg, fontWeight: '700', fontSize: 14 },
  proposalScroll: { maxHeight: 320 },
  proposalScrollContent: { paddingBottom: 80 },
  proposalSection: { color: COLORS.gold, fontSize: 12, fontWeight: '600', marginTop: 12, marginBottom: 8 },
  deltaRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  deltaParam: { color: COLORS.text, fontSize: 14 },
  deltaDir: { color: COLORS.success, fontSize: 14 },
  reasoning: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 20, marginBottom: 16 },
  confirmBtn: { backgroundColor: COLORS.gold, padding: 14, borderRadius: 12, alignItems: 'center', marginBottom: 8 },
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
