import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  InteractionManager,
  Alert,
  Modal,
  useWindowDimensions,
  Animated,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import Slider from '@react-native-community/slider';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, SPACING } from '../constants/theme';
import { LOTTERY_DEFS } from '../constants/lotteries';
import { getEntitlements, type UserPlan } from '../services/entitlements';
import {
  requiresRewardedAdGate,
  requiresEvaluateAdGate,
  recordSuccessfulGenerate,
  recordSuccessfulEvaluate,
  setFreeGenerateCountAfterAd,
  setFreeEvaluateCountAfterAd,
} from '../services/compassGenerateGate';
import { showRewardedAdForGeneratePicks, REWARDED_AD_MESSAGES } from '../services/rewardedAdService';
import { getCurrentUserEmail, onAuthStateChange } from '../services/supabase';
import { getCompassPayload, getDrawsForCompass } from '../compass/compassCache';
import { generateRemainingNumbers } from '../utils/localAnalysis';
import { DEFAULT_GENERATE_PARAMS, type GenerateParams } from '../types/generateParams';
import type { CompassPayload } from '../compass/types';
import {
  validRangeForSlot,
  countsForPositionSlot,
  tierMapForPositionCounts,
  tierMapForCountsInRange,
  type PositionTier,
} from '../compass/positionPickTier';
import type { LotteryId } from '../types/lottery';
import { BannerAdPlaceholder } from '../components/BannerAdPlaceholder';
import { getLastHomeLottery, setLastHomeLottery } from '../services/homeLotteryStorage';
import {
  trendStarsFromScore,
  positionStarsForNumber,
  shapeStarsForMainCandidate,
  specialBallFrequencyStars,
  specialTierStars,
  shapeStarsForSpecialWithMains,
} from '../compass/pickInsightStars';
import { InsightStarRow } from '../components/InsightStarRow';

const COMPASS_LOTTERIES: LotteryId[] = ['lotto_max', 'lotto_649', 'powerball', 'mega_millions'];
const AnimatedTouchableOpacity = Animated.createAnimatedComponent(TouchableOpacity);

export default function CompassScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const [lotteryId, setLotteryId] = useState<LotteryId>('lotto_max');
  const [lotteryDropdownOpen, setLotteryDropdownOpen] = useState(false);
  const [payload, setPayload] = useState<CompassPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [insufficientHistory, setInsufficientHistory] = useState(false);
  const [lines, setLines] = useState<number[][]>([]);
  const [currentPicks, setCurrentPicks] = useState<number[]>([]);
  const [currentSpecial, setCurrentSpecial] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateModalVisible, setGenerateModalVisible] = useState(false);
  const [generateParams, setGenerateParams] = useState<GenerateParams>({ ...DEFAULT_GENERATE_PARAMS });
  const [guideModalVisible, setGuideModalVisible] = useState(false);
  const [plan, setPlan] = useState<UserPlan>('free');
  const [storedPickEvalFingerprint, setStoredPickEvalFingerprint] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      getLastHomeLottery().then((id) => {
        if (cancelled || !id) return;
        if (!COMPASS_LOTTERIES.includes(id)) return;
        setLotteryId((cur) => (cur !== id ? id : cur));
      });
      return () => {
        cancelled = true;
      };
    }, [])
  );
  const [adGateModalVisible, setAdGateModalVisible] = useState(false);
  const [adGatePending, setAdGatePending] = useState<'generate' | 'evaluate' | null>(null);
  const [isSignedIn, setIsSignedIn] = useState<boolean | null>(null);
  const def = LOTTERY_DEFS[lotteryId];
  const mainCount = def?.main_count ?? 7;
  const mainMin = def?.main_min ?? 1;
  const mainMax = def?.main_max ?? 49;

  useEffect(() => {
    setLines([]);
    setCurrentPicks([]);
    setCurrentSpecial(null);
    setStoredPickEvalFingerprint(null);
  }, [lotteryId]);

  const pickEvalFingerprint = useMemo(
    () => JSON.stringify({ lotteryId, picks: currentPicks, special: currentSpecial }),
    [lotteryId, currentPicks, currentSpecial]
  );

  const pickEvaluationMode: 'evaluate' | 'view' =
    storedPickEvalFingerprint != null && storedPickEvalFingerprint === pickEvalFingerprint ? 'view' : 'evaluate';

  const navigateToPickEvaluation = useCallback(() => {
    (navigation as { navigate: (n: string, p: Record<string, unknown>) => void }).navigate('PickEvaluation', {
      lotteryId,
      picks: currentPicks,
      specialPick: currentSpecial,
    });
    setStoredPickEvalFingerprint(pickEvalFingerprint);
  }, [navigation, lotteryId, currentPicks, currentSpecial, pickEvalFingerprint]);

  const goPickEvaluation = useCallback(() => {
    if (pickEvaluationMode === 'view') {
      navigateToPickEvaluation();
      return;
    }
    if (requiresEvaluateAdGate(plan, isSignedIn)) {
      setAdGatePending('evaluate');
      setAdGateModalVisible(true);
      return;
    }
    navigateToPickEvaluation();
    recordSuccessfulEvaluate(plan, isSignedIn);
  }, [
    pickEvaluationMode,
    navigateToPickEvaluation,
    plan,
    isSignedIn,
  ]);

  useEffect(() => {
    getCurrentUserEmail().then((email) => setIsSignedIn(email !== null));
    return onAuthStateChange((email) => setIsSignedIn(email !== null));
  }, []);

  useFocusEffect(
    useCallback(() => {
      getCurrentUserEmail().then((email) => setIsSignedIn(email !== null));
    }, [])
  );

  useEffect(() => {
    getEntitlements().then((e) => setPlan(e.plan));
  }, []);

  const loadCompass = useCallback(async () => {
    setLoading(true);
    setPayload(null);
    setInsufficientHistory(false);
    InteractionManager.runAfterInteractions(() => {
      getCompassPayload(lotteryId)
        .then((r) => {
          setPayload(r.payload);
          setInsufficientHistory(r.insufficientHistory);
        })
        .finally(() => setLoading(false));
    });
  }, [lotteryId]);

  useEffect(() => {
    loadCompass();
  }, [loadCompass]);

  useFocusEffect(
    useCallback(() => {
      getEntitlements().then((e) => setPlan(e.plan));
    }, [])
  );

  const handleOpenGenerateModal = useCallback(() => {
    setGenerateParams({ ...DEFAULT_GENERATE_PARAMS });
    setGenerateModalVisible(true);
  }, []);

  const runGenerate = useCallback(async () => {
    let existing = currentPicks.filter((x) => x > 0);
    // If user taps Smart generate again without resetting and the line is full,
    // regenerate a fresh line instead of returning an empty delta.
    if (existing.length >= mainCount) existing = [];
    setGenerating(true);
    try {
      const draws = await getDrawsForCompass(lotteryId);
      const history = draws.map((d) => ({ winning_numbers: d.winning_numbers }));
      if (history.length < 2) {
        Alert.alert('Need more data', 'Sync draws from Supabase first (at least 2 draws).');
        return;
      }
      const remaining = generateRemainingNumbers(lotteryId, history, existing, generateParams, payload, false);
      if (remaining != null) {
        const merged = [...existing, ...remaining].sort((a, b) => a - b).slice(0, mainCount);
        setCurrentPicks(merged);
        // Powerball / Mega Millions need a special ball for Evaluate; Smart generate only filled mains before.
        if (lotteryId === 'powerball' || lotteryId === 'mega_millions') {
          const smin = def.special_min ?? 1;
          const smax = def.special_max ?? 1;
          setCurrentSpecial(smax >= smin ? smin + Math.floor(Math.random() * (smax - smin + 1)) : null);
        } else {
          setCurrentSpecial(null);
        }
        setStoredPickEvalFingerprint(null);
        recordSuccessfulGenerate(plan, isSignedIn);
      }
    } catch {
      Alert.alert('Error', 'Could not generate numbers. Try again.');
    } finally {
      setGenerating(false);
    }
  }, [lotteryId, currentPicks, mainCount, generateParams, payload, plan, isSignedIn]);

  const handleConfirmGenerate = useCallback(async () => {
    if (requiresRewardedAdGate(plan, isSignedIn)) {
      setAdGatePending('generate');
      setAdGateModalVisible(true);
      return;
    }
    setGenerateModalVisible(false);
    await runGenerate();
  }, [plan, isSignedIn, runGenerate]);

  const handleAdGateUpgrade = useCallback(() => {
    setAdGateModalVisible(false);
    setAdGatePending(null);
    setGenerateModalVisible(false);
    (navigation as { navigate: (name: string) => void }).navigate('Settings');
  }, [navigation]);

  const handleAdGateKeepFree = useCallback(async () => {
    const pending = adGatePending;
    const completed = await showRewardedAdForGeneratePicks();
    if (!completed) {
      Alert.alert('Ad required', REWARDED_AD_MESSAGES.adLoadFailed);
      return;
    }
    setAdGateModalVisible(false);
    setAdGatePending(null);
    await new Promise<void>((resolve) => {
      InteractionManager.runAfterInteractions(() => resolve());
    });
    if (pending === 'generate') {
      setFreeGenerateCountAfterAd();
      setGenerateModalVisible(false);
      await runGenerate();
    } else if (pending === 'evaluate') {
      setFreeEvaluateCountAfterAd();
      navigateToPickEvaluation();
      recordSuccessfulEvaluate(plan, isSignedIn);
    }
  }, [adGatePending, runGenerate, navigateToPickEvaluation, plan, isSignedIn]);

  return (
    <View style={styles.screenWrap}>
      <View style={[styles.stickyHeader, { paddingTop: insets.top + SPACING.screenPadding }]}>
        <View style={styles.content}>
          <View style={styles.headerRow}>
            <Ionicons name="compass" size={24} color={COLORS.gold} style={styles.titleIcon} />
            <Text style={styles.title}>Compass</Text>
            <View style={styles.headerSpacer} />
            <TouchableOpacity
              onPress={() => setGuideModalVisible(true)}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              style={styles.headerBookBtn}
              accessibilityLabel="Compass guide"
              accessibilityRole="button"
            >
              <Ionicons name="bulb-outline" size={22} color={COLORS.gold} />
            </TouchableOpacity>
          </View>
          <View style={styles.lotteryDropdownWrap}>
            <TouchableOpacity
              style={styles.lotteryDropdownTrigger}
              onPress={() => setLotteryDropdownOpen((o) => !o)}
              activeOpacity={0.75}
            >
              <Text style={styles.lotteryDropdownTriggerText} numberOfLines={1}>
                {LOTTERY_DEFS[lotteryId].name}
              </Text>
              <Ionicons
                name={lotteryDropdownOpen ? 'chevron-up' : 'chevron-down'}
                size={20}
                color={COLORS.gold}
              />
            </TouchableOpacity>
            {lotteryDropdownOpen && (
              <View style={styles.lotteryDropdownMenu}>
                {COMPASS_LOTTERIES.map((id, idx, arr) => (
                  <TouchableOpacity
                    key={id}
                    style={[
                      styles.lotteryDropdownItem,
                      idx === arr.length - 1 && styles.lotteryDropdownItemLast,
                      lotteryId === id && styles.lotteryDropdownItemActive,
                    ]}
                    onPress={() => {
                      setLotteryId(id);
                      void setLastHomeLottery(id);
                      setLotteryDropdownOpen(false);
                    }}
                  >
                    <Text
                      style={[
                        styles.lotteryDropdownItemText,
                        lotteryId === id && styles.lotteryDropdownItemTextActive,
                      ]}
                    >
                      {LOTTERY_DEFS[id].name}
                    </Text>
                    {lotteryId === id && <Ionicons name="checkmark" size={18} color={COLORS.gold} />}
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        </View>
      </View>
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingTop: SPACING.screenPadding, paddingBottom: 16 }]}
      >

      <CompassUserGuideModal visible={guideModalVisible} onClose={() => setGuideModalVisible(false)} />

      <RewardedAdGateModal
        visible={adGateModalVisible}
        onWatchAd={handleAdGateKeepFree}
        onUpgrade={handleAdGateUpgrade}
      />

      <PickSlots
        lotteryId={lotteryId}
        payload={payload}
        mainCount={mainCount}
        mainMin={mainMin}
        mainMax={mainMax}
        lines={lines}
        picks={currentPicks}
        onPicksChange={setCurrentPicks}
        specialPick={currentSpecial}
        onSpecialPickChange={setCurrentSpecial}
        onGenerate={handleOpenGenerateModal}
        onReset={() => {
          setLines([]);
          setCurrentPicks([]);
          setCurrentSpecial(null);
          setStoredPickEvalFingerprint(null);
        }}
        generating={generating}
        userPlan={plan}
        pickEvaluationMode={pickEvaluationMode}
        onPickEvaluation={goPickEvaluation}
      />

      <GenerateParamsModal
        visible={generateModalVisible}
        params={generateParams}
        onParamsChange={setGenerateParams}
        onReset={() => setGenerateParams({ ...DEFAULT_GENERATE_PARAMS })}
        onConfirm={handleConfirmGenerate}
        onCancel={() => setGenerateModalVisible(false)}
      />

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color={COLORS.gold} />
          <Text style={styles.loadingText}>Computing trends...</Text>
        </View>
      ) : insufficientHistory ? (
        <View style={styles.warnBox}>
          <Ionicons name="warning" size={24} color={COLORS.warning} />
          <Text style={styles.warnText}>Insufficient history</Text>
          <Text style={styles.warnSub}>Need at least 100 draws. Sync draws from Supabase.</Text>
        </View>
      ) : !payload ? (
        <View style={styles.warnBox}>
          <Text style={styles.warnText}>No data available</Text>
        </View>
      ) : null}
      </ScrollView>
      <View style={styles.compassBannerDock}>
        <BannerAdPlaceholder testId="compass-bottom" userPlan={plan} containerStyle={styles.compassBannerAd} />
      </View>
    </View>
  );
}

const GUIDE_STEPS = [
  { icon: 'list' as const, title: '1. Select lottery', text: 'Choose Lotto Max, Lotto 6/49, Powerball, or Mega Millions from the menu under the title.' },
  {
    icon: 'pencil' as const,
    title: '2. Pick numbers by position',
    text: 'Tap each slot in order. Available balls use Position frequency tiers (green / yellow / red). Later slots update colors for that position. Tap a number to see Trend / Position / Shape star ratings (reference only), then Done to confirm.',
  },
  {
    icon: 'star' as const,
    title: '3. Star ratings',
    text: 'When you tap a candidate number, a short summary shows up to five stars each for trend activity, how often that number appears in the current sorted slot, and how well your line matches typical historical shape.',
  },
  {
    icon: 'sparkles' as const,
    title: '4. Evaluate & Smart generate',
    text: 'When your line is complete, open Pick Evaluation for the score breakdown, or return with View evaluation if nothing changed. Smart generate and Evaluate current pick use separate free-use counters (2 each, then ad or upgrade); watching an ad resets that counter. View evaluation does not add to the Evaluate counter. Smart generate can fill a line from parameters without hand-picking a first number.',
  },
  { icon: 'refresh' as const, title: '5. Reset', text: 'Tap Reset to clear all numbers and start over.' },
];

function RewardedAdGateModal({
  visible,
  onWatchAd,
  onUpgrade,
}: {
  visible: boolean;
  onWatchAd: () => void;
  onUpgrade: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.modalOverlay}>
        <View style={styles.adGateModalContent}>
          <Text style={styles.adGateModalTitle}>{REWARDED_AD_MESSAGES.modalTitle}</Text>
          <View style={styles.adGateModalActions}>
            <TouchableOpacity style={styles.adGateUpgradePirateBtn} onPress={onUpgrade} activeOpacity={0.85}>
              <Text style={styles.adGateUpgradePirateText}>{REWARDED_AD_MESSAGES.upgradePirateUnlimited}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.adGateWatchAdBtn} onPress={onWatchAd} activeOpacity={0.85}>
              <Text style={styles.adGateWatchAdText}>{REWARDED_AD_MESSAGES.watchAdToContinue}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function CompassUserGuideModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.modalOverlay}>
        <View style={styles.guideModalContent}>
          <View style={styles.guideModalHeader}>
            <Text style={styles.guideModalTitle}>Compass User Guide</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Ionicons name="close" size={28} color={COLORS.textMuted} />
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.guideScroll} showsVerticalScrollIndicator={false}>
            <View style={styles.guideIntro}>
              <Ionicons name="compass" size={40} color={COLORS.gold} style={styles.guideIntroIcon} />
              <Text style={styles.guideIntroText}>
                Compass shows historical number distributions and trends. Use it to explore patterns and build your picks.
              </Text>
            </View>
            {GUIDE_STEPS.map((step, i) => (
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
                Lottery draws are random. Past results do not predict future results. For reference only.
              </Text>
            </View>
          </ScrollView>
          <TouchableOpacity style={styles.guideCloseBtn} onPress={onClose}>
            <Text style={styles.guideCloseBtnText}>Got it</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const SLIDER_CONFIG: { key: keyof GenerateParams; label: string; left: string; right: string }[] = [
  { key: 'trendScore', label: 'Trend score', left: 'Cold', right: 'Hot' },
  { key: 'positionFreq', label: 'Position frequency', left: 'Ignore', right: 'Strong' },
  { key: 'oddEven', label: 'Odd / Even', left: 'More even', right: 'More odd' },
  { key: 'lowHighSplit', label: 'Low / High split', left: 'More low', right: 'More high' },
  { key: 'sumRange', label: 'Sum range', left: 'Lower', right: 'Higher' },
  { key: 'maxGap', label: 'Max gap', left: 'Smaller', right: 'Larger' },
];

function GenerateParamsModal({
  visible,
  params,
  onParamsChange,
  onReset,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  params: GenerateParams;
  onParamsChange: (p: GenerateParams) => void;
  onReset: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.modalOverlay}>
        <View style={styles.generateModalContent}>
          <Text style={styles.generateModalTitle}>Generate parameters</Text>
          <Text style={styles.generateModalHint}>Adjust sliders, then confirm. Default: middle (50).</Text>
          <ScrollView style={styles.generateSliders} showsVerticalScrollIndicator={false}>
            {SLIDER_CONFIG.map(({ key, label, left, right }) => (
              <View key={key} style={styles.sliderRow}>
                <Text style={styles.sliderLabel}>{label}</Text>
                <View style={styles.sliderLabels}>
                  <Text style={styles.sliderSide}>{left}</Text>
                  <Text style={styles.sliderValue}>{Math.round(params[key])}</Text>
                  <Text style={styles.sliderSide}>{right}</Text>
                </View>
                <Slider
                  style={styles.slider}
                  minimumValue={0}
                  maximumValue={100}
                  value={params[key]}
                  onValueChange={(v) => onParamsChange({ ...params, [key]: v })}
                  minimumTrackTintColor={COLORS.gold}
                  maximumTrackTintColor={COLORS.gray700}
                  thumbTintColor={COLORS.gold}
                />
              </View>
            ))}
          </ScrollView>
          <View style={styles.generateModalActions}>
            <TouchableOpacity style={styles.generateResetBtn} onPress={onReset}>
              <Text style={styles.generateResetText}>Reset</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.generateCancelBtn} onPress={onCancel}>
              <Text style={styles.generateCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.generateConfirmBtn} onPress={onConfirm}>
              <Text style={styles.generateConfirmText}>Confirm</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

type PendingPickInsight =
  | { kind: 'main'; n: number; positionSlot: number }
  | { kind: 'special'; n: number };

function pickTierChipStyles(tier: PositionTier) {
  switch (tier) {
    case 'top':
      return { border: COLORS.success, bg: COLORS.success, text: COLORS.bg };
    case 'mid':
      return { border: COLORS.warning, bg: COLORS.warning, text: COLORS.bg };
    default:
      return { border: COLORS.error, bg: COLORS.error, text: COLORS.bg };
  }
}

function clampInt(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.floor(x)));
}

function PickSlots({
  lotteryId,
  payload,
  mainCount,
  mainMin,
  mainMax,
  lines,
  picks,
  onPicksChange,
  specialPick,
  onSpecialPickChange,
  onGenerate,
  onReset,
  generating,
  userPlan,
  pickEvaluationMode,
  onPickEvaluation,
}: {
  lotteryId: LotteryId;
  payload: CompassPayload | null;
  mainCount: number;
  mainMin: number;
  mainMax: number;
  lines: number[][];
  picks: number[];
  onPicksChange: (next: number[]) => void;
  specialPick: number | null;
  onSpecialPickChange: (n: number | null) => void;
  onGenerate?: () => void;
  onReset?: () => void;
  generating?: boolean;
  userPlan: UserPlan;
  pickEvaluationMode: 'evaluate' | 'view';
  onPickEvaluation: () => void;
}) {
  const { width: screenW } = useWindowDimensions();
  const [pendingInsight, setPendingInsight] = useState<PendingPickInsight | null>(null);
  const needsSpecialBall = lotteryId === 'powerball' || lotteryId === 'mega_millions';
  const mainsComplete = picks.length === mainCount;
  const canEvaluatePick = mainsComplete && (!needsSpecialBall || specialPick != null);
  const canGenerate = !generating;

  const slotBeingFilled = picks.length < mainCount ? picks.length : null;
  const { lo, hi } =
    slotBeingFilled != null
      ? validRangeForSlot(slotBeingFilled, picks, mainCount, mainMin, mainMax)
      : { lo: mainMin, hi: mainMax };

  const isChoosingMain = slotBeingFilled != null && lo <= hi;

  // Responsive sizing
  const contentW = Math.max(280, screenW - SPACING.screenPadding * 2);
  const slotGap = 8;
  const slotSize = clampInt((contentW - slotGap * (mainCount - 1)) / mainCount, 36, 52);
  const chipGap = 10;
  const desiredChip = 46;
  const chipCols = clampInt((contentW + chipGap) / (desiredChip + chipGap), 5, 8);
  const chipSize = clampInt((contentW - chipGap * (chipCols - 1)) / chipCols, 36, 56);
  const pickGridMaxRows = 4;
  const pickChoicesMaxHeight = pickGridMaxRows * chipSize + (pickGridMaxRows - 1) * chipGap + 8 + 8;

  const countsForTier =
    payload && slotBeingFilled != null
      ? countsForPositionSlot(payload, slotBeingFilled, mainMin, mainMax)
      : new Array(mainMax - mainMin + 1).fill(0);
  const tierMap = tierMapForPositionCounts(countsForTier, mainMin, mainMax);

  const choiceNumbers: number[] = [];
  if (slotBeingFilled != null && lo <= hi) {
    for (let n = lo; n <= hi; n++) {
      choiceNumbers.push(n);
    }
  }

  const bestCandidateNumber = useMemo(() => {
    if (!payload || slotBeingFilled == null || !isChoosingMain) return null;
    let bestN: number | null = null;
    let bestScore = -Infinity;
    for (const n of choiceNumbers) {
      const ts = payload.trendScores.find((x) => x.number === n);
      const trendStars = trendStarsFromScore(ts?.trendScore);
      const positionStars = positionStarsForNumber(payload, slotBeingFilled, n, mainMin, mainMax);
      const shapeStars = shapeStarsForMainCandidate(payload, picks, n, mainMax);
      const composite = (trendStars + positionStars + shapeStars) / 3;
      if (bestN == null) {
        bestScore = composite;
        bestN = n;
        continue;
      }
      if (composite > bestScore || (composite === bestScore && n < bestN)) {
        bestScore = composite;
        bestN = n;
      }
    }
    return bestN;
  }, [payload, slotBeingFilled, isChoosingMain, choiceNumbers, mainMin, mainMax, picks, mainMax]);

  const showSpecial = lotteryId === 'powerball' || lotteryId === 'mega_millions';
  const specialMin = LOTTERY_DEFS[lotteryId]?.special_min ?? 1;
  const specialMax = LOTTERY_DEFS[lotteryId]?.special_max ?? 0;
  const specialCounts =
    showSpecial && payload?.specialFrequency && payload.specialFrequency.min === specialMin && payload.specialFrequency.max === specialMax
      ? payload.specialFrequency.counts
      : new Array(Math.max(0, specialMax - specialMin + 1)).fill(0);
  const specialTierMap =
    showSpecial && specialMax >= specialMin && specialCounts.length === specialMax - specialMin + 1
      ? tierMapForCountsInRange(specialCounts, specialMin, specialMax)
      : new Map<number, PositionTier>();

  const isChoosingSpecial =
    !isChoosingMain && showSpecial && picks.length >= mainCount && specialMax >= specialMin && specialPick == null;

  const displayedNumbers = useMemo(() => {
    if (isChoosingMain) return choiceNumbers;
    if (isChoosingSpecial) return Array.from({ length: specialMax - specialMin + 1 }, (_, i) => specialMin + i);
    return [];
  }, [isChoosingMain, choiceNumbers, isChoosingSpecial, specialMin, specialMax]);

  const [pickerScrollY, setPickerScrollY] = useState(0);
  useEffect(() => {
    // Reset scroll position state when the picker content changes (slot change / switching main<->special)
    setPickerScrollY(0);
  }, [slotBeingFilled, isChoosingMain, isChoosingSpecial, lotteryId]);

  const visibleNumbers = useMemo(() => {
    const pool = displayedNumbers;
    if (pool.length === 0) return [];
    // We know the grid geometry: `chipCols`, `chipSize`, `chipGap`, and the ScrollView viewport height.
    // Use scroll offset to approximate visible rows so the "jump" hint only targets numbers on screen.
    const rowH = chipSize + chipGap;
    const viewH = pickChoicesMaxHeight;
    const startRow = Math.max(0, Math.floor(pickerScrollY / rowH));
    const endRow = Math.max(startRow, Math.floor((pickerScrollY + viewH - 1) / rowH));
    const startIdx = startRow * chipCols;
    const endExclusive = (endRow + 1) * chipCols;
    return pool.slice(startIdx, endExclusive);
  }, [displayedNumbers, pickerScrollY, chipCols, chipSize, chipGap, pickChoicesMaxHeight]);

  const visibleNumbersKey = useMemo(() => visibleNumbers.join(','), [visibleNumbers]);

  const [jumpNumber, setJumpNumber] = useState<number | null>(null);
  const jumpAnim = useRef(new Animated.Value(0)).current;
  const lastJumpRef = useRef<number | null>(null);

  const shouldRunJump =
    pendingInsight == null && (isChoosingMain || isChoosingSpecial) && visibleNumbers.length > 0;

  useEffect(() => {
    if (!shouldRunJump) {
      lastJumpRef.current = null;
      setJumpNumber(null);
      jumpAnim.stopAnimation();
      jumpAnim.setValue(0);
      return;
    }

    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const pickNext = () => {
      if (cancelled) return;
      const pool = visibleNumbers;
      if (pool.length === 0) {
        timeout = setTimeout(pickNext, 2000);
        return;
      }

      let next = pool[Math.floor(Math.random() * pool.length)];
      if (pool.length > 1) {
        let tries = 0;
        while (tries < 6 && next === lastJumpRef.current) {
          next = pool[Math.floor(Math.random() * pool.length)];
          tries += 1;
        }
      }

      lastJumpRef.current = next;
      setJumpNumber(next);
      jumpAnim.stopAnimation();
      jumpAnim.setValue(0);

      const oneBounce = Animated.sequence([
        Animated.timing(jumpAnim, { toValue: 1, duration: 140, useNativeDriver: true }),
        Animated.timing(jumpAnim, { toValue: 0, duration: 140, useNativeDriver: true }),
      ]);

      Animated.sequence([oneBounce, oneBounce, oneBounce]).start(({ finished }) => {
        if (!finished || cancelled) return;
        // Hard reset so the last animated button never gets "stuck" mid-transform.
        jumpAnim.stopAnimation();
        jumpAnim.setValue(0);
        setJumpNumber(null);
        timeout = setTimeout(pickNext, 2000);
      });
    };

    pickNext();
    return () => {
      cancelled = true;
      if (timeout) clearTimeout(timeout);
      jumpAnim.stopAnimation();
      jumpAnim.setValue(0);
      setJumpNumber(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldRunJump, visibleNumbersKey]);

  const jumpStyle = {
    transform: [
      {
        translateY: jumpAnim.interpolate({ inputRange: [0, 1], outputRange: [0, -8] }),
      },
      {
        scale: jumpAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.09] }),
      },
    ],
  } as const;

  let insightTitle = '';
  let trendStars = 3;
  let positionStars = 3;
  let shapeStars = 3;
  if (pendingInsight && payload) {
    if (pendingInsight.kind === 'main') {
      const ts = payload.trendScores.find((x) => x.number === pendingInsight.n);
      trendStars = trendStarsFromScore(ts?.trendScore);
      positionStars = positionStarsForNumber(payload, pendingInsight.positionSlot, pendingInsight.n, mainMin, mainMax);
      shapeStars = shapeStarsForMainCandidate(payload, picks, pendingInsight.n, mainMax);
      insightTitle = `Main (${pendingInsight.positionSlot + 1}) — ${pendingInsight.n}`;
    } else {
      trendStars = specialBallFrequencyStars(payload, pendingInsight.n, specialMin, specialMax);
      positionStars = specialTierStars(specialTierMap.get(pendingInsight.n) ?? 'mid');
      shapeStars = shapeStarsForSpecialWithMains([...picks].sort((a, b) => a - b), payload.shapeStats, mainMax);
      const spLabel = lotteryId === 'powerball' ? 'Powerball' : 'Mega Ball';
      insightTitle = `${spLabel} — ${pendingInsight.n}`;
    }
  } else if (pendingInsight) {
    insightTitle =
      pendingInsight.kind === 'main'
        ? `Main (${pendingInsight.positionSlot + 1}) — ${pendingInsight.n}`
        : `${lotteryId === 'powerball' ? 'Powerball' : 'Mega Ball'} — ${pendingInsight.n}`;
  }

  const compositeOverall =
    pendingInsight != null ? ((trendStars + positionStars + shapeStars) / 3).toFixed(1) : '0.0';

  const confirmPickInsight = () => {
    if (!pendingInsight) return;
    if (pendingInsight.kind === 'main') {
      onPicksChange([...picks, pendingInsight.n]);
    } else {
      onSpecialPickChange(pendingInsight.n);
    }
    setPendingInsight(null);
  };

  const dismissPickInsight = () => setPendingInsight(null);

  const onTapSlot = (slotIdx: number) => {
    if (slotIdx < picks.length) {
      onPicksChange(picks.slice(0, slotIdx));
    }
  };

  const canUndo = picks.length > 0 || specialPick != null;
  const handleUndo = () => {
    if (specialPick != null) {
      onSpecialPickChange(null);
      return;
    }
    if (picks.length > 0) {
      onPicksChange(picks.slice(0, -1));
    }
  };

  const handleCopy = async () => {
    const main = [...picks].sort((a, b) => a - b);
    const def = LOTTERY_DEFS[lotteryId];
    const spLabel = lotteryId === 'powerball' ? 'Powerball' : 'Mega Ball';
    const text =
      showSpecial && specialPick != null
        ? `${def?.name ?? lotteryId}: ${main.join(' ')} | ${spLabel}: ${specialPick}`
        : `${def?.name ?? lotteryId}: ${main.join(' ')}`;
    try {
      // Dynamic import to avoid hard crash when the native module
      // isn't present in the current dev client build.
      const Clipboard = await import('expo-clipboard');
      await Clipboard.setStringAsync(text);
      Alert.alert('Copied', 'Pick copied to clipboard.');
    } catch {
      // Fallback: show the pick so user can long-press copy.
      Alert.alert('Copy', text);
    }
  };

  return (
    <View style={styles.pickSlotsWrap}>
      {/* Intentionally minimal UI (no helper paragraph). */}
      {lines.map((line, lineIdx) => (
        <View key={lineIdx} style={[styles.pickSlotsRow, styles.pickSlotsRowMax6, styles.completedLineRow]}>
          {line.map((n, i) => (
            <View key={i} style={styles.pickSlot}>
              <Text style={styles.pickSlotText}>{n}</Text>
            </View>
          ))}
        </View>
      ))}
      <View style={styles.pickSlotsCol}>
        <Text style={styles.mainLabel}>Main</Text>
        <View style={[styles.pickSlotsRow, styles.pickSlotsRowTop]}>
          {Array.from({ length: mainCount }, (_, i) => {
            const filled = picks[i];
            const isFuture = i > picks.length;
            const isActiveSlot = slotBeingFilled != null && i === slotBeingFilled;
            return (
              <TouchableOpacity
                key={i}
                style={[
                  styles.pickSlot,
                  styles.pickSlotTouchable,
                  filled ? styles.pickSlotFilled : styles.pickSlotEmpty,
                  isFuture && styles.pickSlotFuture,
                  isActiveSlot && styles.pickSlotActive,
                  { width: slotSize, height: slotSize, borderRadius: Math.max(10, Math.round(slotSize * 0.22)) },
                ]}
                onPress={() => onTapSlot(i)}
                disabled={isFuture}
                activeOpacity={0.75}
              >
                <Text style={[styles.pickSlotText, isFuture && styles.pickSlotFutureText]}>
                  {filled != null ? String(filled) : '—'}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {onReset && (
          <View
            style={[
              styles.pickActionsRow,
              showSpecial ? styles.pickActionsRowWithSpecial : styles.pickActionsRowCentered,
            ]}
          >
            {showSpecial && specialMax >= specialMin && (
              <View style={styles.specialInline}>
                <Text style={styles.specialInlineLabel}>{lotteryId === 'powerball' ? 'Powerball' : 'Mega Ball'}</Text>
                <View style={styles.specialInlineValueBox}>
                  <Text style={styles.specialInlineValueText}>{specialPick != null ? String(specialPick) : '—'}</Text>
                </View>
              </View>
            )}
            <View style={styles.actionsRight}>
              <TouchableOpacity
                style={[styles.undoBtn, !canUndo && styles.actionBtnDisabled]}
                onPress={handleUndo}
                disabled={!canUndo}
              >
                <Ionicons name="arrow-undo" size={18} color={COLORS.textSecondary} style={styles.generateIcon} />
                {!showSpecial && <Text style={styles.resetBtnText}>Undo</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={styles.resetBtn} onPress={onReset}>
                <Ionicons name="refresh" size={18} color={COLORS.textSecondary} style={styles.generateIcon} />
                {!showSpecial && <Text style={styles.resetBtnText}>Reset</Text>}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.copyBtn, (!picks.length && specialPick == null) && styles.actionBtnDisabled]}
                onPress={handleCopy}
                disabled={!picks.length && specialPick == null}
              >
                <Ionicons name="copy-outline" size={18} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </View>
          </View>
        )}

        {(() => {
          const showMainPicker = isChoosingMain;
          const showSpecialPicker =
            !showMainPicker && showSpecial && picks.length >= mainCount && specialMax >= specialMin;

          if (showMainPicker) {
            return (
              <>
                <Text style={styles.pickChoicesTitle}>
                  Pick position {slotBeingFilled! + 1} ({lo}-{hi})
                </Text>
                <ScrollView
                  nestedScrollEnabled
                  showsVerticalScrollIndicator={false}
                  style={[styles.pickChoicesScroll, { maxHeight: pickChoicesMaxHeight }]}
                  contentContainerStyle={styles.pickChoicesScrollContent}
                  onScroll={(e) => setPickerScrollY(e.nativeEvent.contentOffset.y)}
                  scrollEventThrottle={16}
                >
                  <View style={[styles.pickChoicesGrid, { gap: chipGap }]}>
                    {choiceNumbers.map((n) => {
                      const tier = tierMap.get(n) ?? 'mid';
                      const cs = pickTierChipStyles(tier);
                      const isBest = bestCandidateNumber != null && n === bestCandidateNumber;
                      const isJumping = jumpNumber != null && n === jumpNumber;
                      return (
                        <AnimatedTouchableOpacity
                          key={n}
                          style={[
                            styles.pickChoiceChip,
                            isBest && styles.pickChoiceChipBest,
                            isJumping && jumpStyle,
                            {
                              width: chipSize,
                              height: chipSize,
                              borderRadius: Math.max(10, Math.round(chipSize * 0.22)),
                              borderColor: cs.border,
                              backgroundColor: isBest ? '#9dffb3' : cs.bg,
                            },
                          ]}
                          onPress={() =>
                            slotBeingFilled != null &&
                            setPendingInsight({ kind: 'main', n, positionSlot: slotBeingFilled })
                          }
                          activeOpacity={0.8}
                        >
                          <Text style={[styles.pickChoiceChipText, { color: isBest ? COLORS.bg : cs.text }]}>{n}</Text>
                        </AnimatedTouchableOpacity>
                      );
                    })}
                  </View>
                </ScrollView>
              </>
            );
          }

          if (showSpecialPicker) {
            return (
              <>
                <Text style={styles.pickChoicesTitle}>
                  Pick {lotteryId === 'powerball' ? 'Powerball' : 'Mega Ball'} ({specialMin}-{specialMax})
                </Text>
                <ScrollView
                  nestedScrollEnabled
                  showsVerticalScrollIndicator={false}
                  style={[styles.pickChoicesScroll, { maxHeight: pickChoicesMaxHeight }]}
                  contentContainerStyle={styles.pickChoicesScrollContent}
                  onScroll={(e) => setPickerScrollY(e.nativeEvent.contentOffset.y)}
                  scrollEventThrottle={16}
                >
                  <View style={[styles.pickChoicesGrid, { gap: chipGap }]}>
                    {Array.from({ length: specialMax - specialMin + 1 }, (_, i) => specialMin + i).map((n) => {
                      const tier = specialTierMap.get(n) ?? 'mid';
                      const cs = pickTierChipStyles(tier);
                      const isJumping = jumpNumber != null && n === jumpNumber;
                      return (
                        <AnimatedTouchableOpacity
                          key={`sp-${n}`}
                          style={[
                            styles.pickChoiceChip,
                            isJumping && jumpStyle,
                            {
                              width: chipSize,
                              height: chipSize,
                              borderRadius: Math.max(10, Math.round(chipSize * 0.22)),
                              borderColor: cs.border,
                              backgroundColor: cs.bg,
                              opacity: 1,
                            },
                          ]}
                          onPress={() => setPendingInsight({ kind: 'special', n })}
                          activeOpacity={0.8}
                        >
                          <Text style={[styles.pickChoiceChipText, { color: cs.text }]}>{n}</Text>
                        </AnimatedTouchableOpacity>
                      );
                    })}
                  </View>
                </ScrollView>
              </>
            );
          }

          return null;
        })()}

        {slotBeingFilled != null && lo > hi && (
          <Text style={styles.pickChoicesError}>No valid numbers for this slot — tap an earlier slot or Reset.</Text>
        )}

        {picks.length >= mainCount && (
          <Text style={styles.pickLineComplete}>Line complete. Tap a filled slot to change from there.</Text>
        )}
        {onGenerate && (
          <View style={styles.generateWrap}>
            <View style={styles.generateBtnRow}>
              <TouchableOpacity
                style={[styles.evaluateBtn, !canEvaluatePick && styles.actionBtnDisabled]}
                onPress={onPickEvaluation}
                disabled={!canEvaluatePick}
              >
                <Ionicons name="analytics-outline" size={18} color={COLORS.gold} style={styles.generateIcon} />
                <Text style={styles.evaluateBtnText} numberOfLines={2}>
                  {pickEvaluationMode === 'view' ? 'View evaluation' : 'Evaluate current pick'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.generateBtn, styles.generateBtnFlex, !canGenerate && styles.generateBtnDisabled]}
                onPress={onGenerate}
                disabled={!canGenerate}
              >
                {generating ? (
                  <ActivityIndicator size="small" color={COLORS.gold} />
                ) : (
                  <>
                    <Ionicons name="sparkles" size={18} color={COLORS.gold} style={styles.generateIcon} />
                    <Text style={styles.generateBtnText} numberOfLines={2}>
                      Smart generate
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
            <Modal visible={pendingInsight != null} transparent animationType="fade">
              <TouchableOpacity style={styles.helpOverlay} activeOpacity={1} onPress={dismissPickInsight}>
                <TouchableOpacity activeOpacity={1} onPress={(e) => e.stopPropagation()} style={styles.pickInsightModalCard}>
                  <View style={styles.pickInsightHeaderRow}>
                    <Text style={styles.pickInsightTitle} numberOfLines={3}>
                      {insightTitle}
                    </Text>
                    <View style={styles.pickInsightCompositeWrap}>
                      <Text style={styles.pickInsightCompositeText}>{compositeOverall}</Text>
                      <Ionicons name="star" size={20} color={COLORS.gold} />
                    </View>
                  </View>
                  <InsightStarRow label="Trend" stars={trendStars} />
                  <InsightStarRow label="Position" stars={positionStars} />
                  <InsightStarRow label="Shape" stars={shapeStars} />
                  <BannerAdPlaceholder
                    testId="compass-pick-insight"
                    userPlan={userPlan}
                    containerStyle={styles.pickInsightBanner}
                  />
                  <TouchableOpacity style={styles.pickInsightDoneBtn} onPress={confirmPickInsight}>
                    <Text style={styles.pickInsightDoneText}>Done</Text>
                  </TouchableOpacity>
                </TouchableOpacity>
              </TouchableOpacity>
            </Modal>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screenWrap: { flex: 1, backgroundColor: COLORS.bg },
  container: { flex: 1, backgroundColor: COLORS.bg },
  compassBannerDock: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.bgElevated,
    backgroundColor: COLORS.bg,
    paddingTop: 8,
    paddingHorizontal: SPACING.screenPadding,
    paddingBottom: 8,
    alignItems: 'center',
  },
  compassBannerAd: { marginVertical: 0, marginBottom: 0 },
  content: { paddingHorizontal: SPACING.screenPadding },
  stickyHeader: {
    backgroundColor: COLORS.bg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.bgElevated,
    paddingBottom: 8,
    zIndex: 2,
    elevation: 4,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  titleIcon: { marginRight: 10 },
  title: { fontSize: 24, fontWeight: '700', color: COLORS.text },
  headerSpacer: { flex: 1 },
  headerBookBtn: {},
  usageHint: { color: COLORS.textMuted, fontSize: 12, marginBottom: 8 },
  label: { color: COLORS.textSecondary, fontSize: 12, marginBottom: 8 },
  lotteryDropdownWrap: { marginBottom: 0, zIndex: 3 },
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
  pickSlotsWrap: { marginBottom: 16 },
  pickChoicesTitle: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
    marginTop: 4,
  },
  pickChoicesScroll: { maxHeight: 280 },
  pickChoicesScrollContent: { paddingBottom: 8 },
  pickChoicesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
  },
  pickChoiceChip: {
    minWidth: 42,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickChoiceChipBest: {
    shadowColor: '#34d399',
    shadowOpacity: 0.45,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
    transform: [{ scale: 1.03 }],
  },
  pickChoiceChipText: { fontSize: 15, fontWeight: '700' },
  pickChoicesError: { color: COLORS.warning, fontSize: 13, marginTop: 8 },
  pickLineComplete: { color: COLORS.textMuted, fontSize: 13, marginTop: 8 },
  pickSlotTouchable: {},
  pickSlotFilled: { borderColor: COLORS.gold },
  pickSlotEmpty: { borderColor: COLORS.gray700 },
  pickSlotFuture: { opacity: 0.35 },
  pickSlotActive: {
    borderWidth: 2,
    borderColor: COLORS.gold,
    backgroundColor: 'rgba(212, 175, 55, 0.12)',
  },
  pickSlotFutureText: { color: COLORS.textMuted },
  pickSlotsCol: { flexDirection: 'column', gap: 8 },
  pickSlotsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  pickSlotsRowTop: { justifyContent: 'space-between', flexWrap: 'nowrap' },
  mainLabel: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '700', marginTop: 2, marginBottom: 2 },
  pickActionsRow: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', marginTop: 2 },
  pickActionsRowWithSpecial: { justifyContent: 'space-between' },
  pickActionsRowCentered: { justifyContent: 'center' },
  actionsRight: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 10 },
  actionBtnDisabled: { opacity: 0.5 },
  specialInline: { flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 },
  specialInlineLabel: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '700' },
  specialInlineValueBox: {
    minWidth: 44,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.gray700,
    alignItems: 'center',
    justifyContent: 'center',
  },
  specialInlineValueText: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  pickSlotsRowMax6: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center', maxWidth: '100%' },
  completedLineRow: { marginBottom: 8 },
  generateBtnRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 10,
    width: '100%',
  },
  evaluateBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.gray700,
    minHeight: 44,
  },
  evaluateBtnText: {
    color: COLORS.gold,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    flexShrink: 1,
  },
  generateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.gold,
    minHeight: 44,
  },
  generateBtnFlex: { flex: 1 },
  generateBtnDisabled: { opacity: 0.5 },
  helpOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  helpPopup: { backgroundColor: COLORS.bgCard, borderRadius: 12, padding: 20, maxWidth: 320 },
  helpPopupTitle: { color: COLORS.text, fontSize: 16, fontWeight: '600', marginBottom: 12 },
  helpPopupText: { color: COLORS.textSecondary, fontSize: 14, lineHeight: 20, marginBottom: 8 },
  helpPopupBtn: { alignSelf: 'flex-end', marginTop: 12, paddingVertical: 8, paddingHorizontal: 16 },
  helpPopupBtnText: { color: COLORS.gold, fontSize: 14, fontWeight: '600' },
  pickInsightModalCard: {
    backgroundColor: COLORS.bgCard,
    borderRadius: 12,
    padding: 20,
    width: '100%',
    maxWidth: 360,
  },
  pickInsightHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 12,
  },
  pickInsightTitle: { flex: 1, color: COLORS.text, fontSize: 17, fontWeight: '700', lineHeight: 22 },
  pickInsightCompositeWrap: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingTop: 2 },
  pickInsightCompositeText: { color: COLORS.gold, fontSize: 20, fontWeight: '700' },
  pickInsightBanner: { marginTop: 4, marginBottom: 12 },
  pickInsightDoneBtn: {
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: COLORS.gold,
    alignItems: 'center',
  },
  pickInsightDoneText: { color: COLORS.bg, fontSize: 16, fontWeight: '700' },
  generateIcon: { marginRight: 6 },
  generateBtnText: { color: COLORS.gold, fontSize: 13, fontWeight: '600', textAlign: 'center', flexShrink: 1 },
  resetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.gray700,
    minHeight: 44,
  },
  copyBtn: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.gray700,
    alignItems: 'center',
    justifyContent: 'center',
  },
  undoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.gray700,
    minHeight: 44,
  },
  resetBtnText: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '600' },
  pickSlot: {
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  pickSlotText: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  generateWrap: { flexDirection: 'column', alignItems: 'stretch', gap: 8, width: '100%' },
  adGateModalContent: {
    backgroundColor: COLORS.bgCard,
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 340,
  },
  adGateModalTitle: { fontSize: 18, fontWeight: '700', color: COLORS.text, marginBottom: 20, textAlign: 'center' },
  adGateModalActions: { flexDirection: 'column', alignItems: 'stretch', gap: 12 },
  adGateWatchAdBtn: {
    minHeight: 48,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: COLORS.bgElevated,
    borderWidth: 1,
    borderColor: COLORS.gray700,
    alignItems: 'center',
    justifyContent: 'center',
  },
  adGateWatchAdText: { color: COLORS.text, fontSize: 14, fontWeight: '600', textAlign: 'center' },
  adGateUpgradePirateBtn: {
    minHeight: 48,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: COLORS.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  adGateUpgradePirateText: { color: COLORS.bg, fontSize: 15, fontWeight: '700', textAlign: 'center' },
  loadingBox: { alignItems: 'center', paddingVertical: 48 },
  loadingText: { color: COLORS.textMuted, marginTop: 12 },
  warnBox: {
    alignItems: 'center',
    padding: 24,
    backgroundColor: COLORS.bgCard,
    borderRadius: 12,
  },
  warnText: { color: COLORS.warning, fontWeight: '600', marginTop: 8 },
  warnSub: { color: COLORS.textMuted, fontSize: 12, marginTop: 4 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  guideModalContent: {
    backgroundColor: COLORS.bgCard,
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxWidth: 360,
    maxHeight: '88%',
  },
  guideModalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  guideModalTitle: { fontSize: 20, fontWeight: '700', color: COLORS.text },
  guideScroll: { maxHeight: 420 },
  guideIntro: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray700,
  },
  guideIntroIcon: { marginRight: 12 },
  guideIntroText: { flex: 1, color: COLORS.textSecondary, fontSize: 14, lineHeight: 22 },
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
    padding: 12,
    backgroundColor: COLORS.bg,
    borderRadius: 10,
  },
  guideDisclaimerText: { flex: 1, color: COLORS.textMuted, fontSize: 12, marginLeft: 8, lineHeight: 18 },
  guideCloseBtn: {
    marginTop: 16,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: COLORS.gold,
    alignItems: 'center',
  },
  guideCloseBtnText: { color: COLORS.bg, fontSize: 15, fontWeight: '700' },
  generateModalContent: {
    backgroundColor: COLORS.bgCard,
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxWidth: 360,
    maxHeight: '85%',
  },
  generateModalTitle: { fontSize: 18, fontWeight: '700', color: COLORS.text, marginBottom: 4 },
  generateModalHint: { color: COLORS.textMuted, fontSize: 12, marginBottom: 16 },
  generateSliders: { maxHeight: 340 },
  sliderRow: { marginBottom: 16 },
  sliderLabel: { color: COLORS.textSecondary, fontSize: 13, marginBottom: 4 },
  sliderLabels: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  sliderSide: { color: COLORS.textMuted, fontSize: 11 },
  sliderValue: { color: COLORS.gold, fontSize: 12, fontWeight: '600' },
  slider: { width: '100%', height: 36 },
  generateModalActions: { flexDirection: 'row', marginTop: 16, gap: 10, flexWrap: 'wrap' },
  generateResetBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: COLORS.bgElevated,
  },
  generateResetText: { color: COLORS.textSecondary, fontSize: 14 },
  generateCancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: COLORS.bgElevated,
  },
  generateCancelText: { color: COLORS.textMuted, fontSize: 14 },
  generateConfirmBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 10,
    backgroundColor: COLORS.gold,
    flex: 1,
    minWidth: 100,
    alignItems: 'center',
  },
  generateConfirmText: { color: COLORS.bg, fontSize: 14, fontWeight: '700' },
});
