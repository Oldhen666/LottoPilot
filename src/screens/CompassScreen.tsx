import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  InteractionManager,
  Alert,
  Modal,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import Slider from '@react-native-community/slider';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, SPACING } from '../constants/theme';
import { LOTTERY_DEFS } from '../constants/lotteries';
import { checkCompassUsage, tryConsumeCompassUse } from '../services/entitlements';
import { isIAPAvailable, getIAPProducts, formatPiratePrice } from '../services/iap';
import { getCurrentUserEmail, onAuthStateChange } from '../services/supabase';
import { getCompassPayload, getDrawsForCompass } from '../compass/compassCache';
import { generateRemainingNumbers } from '../utils/localAnalysis';
import { DEFAULT_GENERATE_PARAMS, type GenerateParams } from '../types/generateParams';
import type { CompassPayload, NumberTrendScore, PositionTopK, ShapeStats } from '../compass/types';
import type { LotteryId } from '../types/lottery';

const COMPASS_LOTTERIES: LotteryId[] = ['lotto_max', 'lotto_649', 'powerball', 'mega_millions'];

const POSITION_NOTE =
  'Position-based stats assume numbers are sorted ascending; lower positions naturally skew smaller.';

type Tab = 'trends' | 'positions' | 'shape';

export default function CompassScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const [lotteryId, setLotteryId] = useState<LotteryId>('lotto_max');
  const [payload, setPayload] = useState<CompassPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [insufficientHistory, setInsufficientHistory] = useState(false);
  const [tab, setTab] = useState<Tab>('trends');
  const [searchNum, setSearchNum] = useState('');
  const [selectedPos, setSelectedPos] = useState(1);
  const [lines, setLines] = useState<number[][]>([]);
  const [currentPicks, setCurrentPicks] = useState<number[]>([]);
  const [generating, setGenerating] = useState(false);
  const [generateModalVisible, setGenerateModalVisible] = useState(false);
  const [generateParams, setGenerateParams] = useState<GenerateParams>({ ...DEFAULT_GENERATE_PARAMS });
  const [guideModalVisible, setGuideModalVisible] = useState(false);
  const [compassBlocked, setCompassBlocked] = useState(false);
  const [compassRemaining, setCompassRemaining] = useState<number | null>(null);
  const [isSignedIn, setIsSignedIn] = useState<boolean | null>(null);
  const [lockFirstNumber, setLockFirstNumber] = useState(false);
  const [piratePrice, setPiratePrice] = useState('$3.49');

  const def = LOTTERY_DEFS[lotteryId];
  const mainCount = def?.main_count ?? 7;
  const mainMin = def?.main_min ?? 1;
  const mainMax = def?.main_max ?? 49;

  const addToPicks = useCallback((n: number) => {
    if (n < mainMin || n > mainMax) return;
    setCurrentPicks((prev) => {
      if (prev.includes(n)) return prev;
      const next = [...prev, n].sort((a, b) => a - b).slice(0, mainCount);
      return next;
    });
  }, [mainCount, mainMin, mainMax]);

  const setPickAt = useCallback((idx: number, value: number | '') => {
    setCurrentPicks((prev) => {
      const arr = [...prev];
      while (arr.length <= idx) arr.push(0);
      arr[idx] = value === '' ? 0 : value;
      const filtered = arr.filter((x) => x > 0);
      return [...new Set(filtered)].sort((a, b) => a - b).slice(0, mainCount);
    });
  }, [mainCount]);

  useEffect(() => {
    setLines([]);
    setCurrentPicks([]);
  }, [lotteryId]);

  useEffect(() => {
    getCurrentUserEmail().then((email) => setIsSignedIn(email !== null));
    return onAuthStateChange((email) => setIsSignedIn(email !== null));
  }, []);

  useEffect(() => {
    if (isIAPAvailable()) {
      getIAPProducts().then(({ pirate }) => setPiratePrice(formatPiratePrice(pirate)));
    }
  }, []);

  const loadCompass = useCallback(async () => {
    setLoading(true);
    setPayload(null);
    setInsufficientHistory(false);
    const { remaining, unlocked } = await checkCompassUsage();
    setCompassRemaining(unlocked ? null : remaining);
    setCompassBlocked(false);
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
      checkCompassUsage().then(({ remaining, unlocked }) => {
        setCompassRemaining(unlocked ? null : remaining);
      });
    }, [])
  );

  const maxRange = def?.main_max ?? 49;
  const picksPerDraw = def?.main_count ?? 7;

  const handleOpenGenerateModal = useCallback(() => {
    const existing = currentPicks.filter((x) => x > 0);
    if (existing.length === 0) return;
    setGenerateParams({ ...DEFAULT_GENERATE_PARAMS });
    setGenerateModalVisible(true);
  }, [currentPicks]);

  const handleConfirmGenerate = useCallback(async () => {
    setGenerateModalVisible(false);
    const existing = currentPicks.filter((x) => x > 0);
    if (existing.length === 0) return;
    if (isSignedIn === false) {
      Alert.alert('Sign in required', 'Please sign in to use Generate number.');
      return;
    }
    const consumed = await tryConsumeCompassUse();
    if (!consumed) {
      Alert.alert('Limit reached', `You've used all 10 free Compass uses. Upgrade to Pirate Plan (${piratePrice}) in Settings for unlimited.`);
      return;
    }
    setGenerating(true);
    try {
      const draws = await getDrawsForCompass(lotteryId);
      const history = draws.map((d) => ({ winning_numbers: d.winning_numbers }));
      if (history.length < 2) {
        Alert.alert('Need more data', 'Sync draws from Supabase first (at least 2 draws).');
        return;
      }
      const remaining = generateRemainingNumbers(lotteryId, history, existing, generateParams, payload, lockFirstNumber);
      if (remaining) {
        const merged = [...existing, ...remaining].sort((a, b) => a - b).slice(0, mainCount);
        setLines((prev) => [...prev, merged]);
        setCurrentPicks([]);
        const { remaining: r } = await checkCompassUsage();
        setCompassRemaining(r >= 0 ? r : null);
      }
    } catch {
      Alert.alert('Error', 'Could not generate numbers. Try again.');
    } finally {
      setGenerating(false);
    }
  }, [lotteryId, currentPicks, mainCount, generateParams, payload, lockFirstNumber, isSignedIn, piratePrice]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + SPACING.screenPadding, paddingBottom: SPACING.screenPaddingBottom }]}
    >
      <View style={styles.headerRow}>
        <Ionicons name="compass" size={24} color={COLORS.gold} style={styles.titleIcon} />
        <Text style={styles.title}>Compass</Text>
        <View style={styles.headerSpacer} />
        <TouchableOpacity onPress={() => setGuideModalVisible(true)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} style={styles.headerBookBtn}>
          <Ionicons name="book-outline" size={22} color={COLORS.gold} />
        </TouchableOpacity>
      </View>

      <CompassUserGuideModal visible={guideModalVisible} onClose={() => setGuideModalVisible(false)} />

      <View style={styles.lotteryRow}>
        <Text style={styles.label}>Lottery</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.lotteryScroll}>
          {COMPASS_LOTTERIES.map((id) => (
            <TouchableOpacity
              key={id}
              style={[styles.lotteryChip, lotteryId === id && styles.lotteryChipActive]}
              onPress={() => setLotteryId(id)}
            >
              <Text style={styles.lotteryChipText}>{LOTTERY_DEFS[id].name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <PickSlots
        mainCount={mainCount}
        mainMin={mainMin}
        mainMax={mainMax}
        lines={lines}
        picks={currentPicks}
        setPickAt={setPickAt}
        onGenerate={handleOpenGenerateModal}
        onNavigateToSignIn={() => (navigation as { navigate: (s: string) => void }).navigate('Login')}
        onReset={() => { setLines([]); setCurrentPicks([]); }}
        generating={generating}
        compassRemaining={compassRemaining}
        isSignedIn={isSignedIn}
        lockFirstNumber={lockFirstNumber}
        onLockFirstNumberChange={setLockFirstNumber}
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
      ) : (
        <>
          <View style={styles.tabRow}>
            {(['trends', 'positions', 'shape'] as Tab[]).map((t) => (
              <TouchableOpacity
                key={t}
                style={[styles.tab, tab === t && styles.tabActive]}
                onPress={() => setTab(t)}
              >
                <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>{t === 'trends' ? 'Trends' : t === 'positions' ? 'Positions' : 'Shape'}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {tab === 'trends' && (
            <TrendsTab
              payload={payload}
              searchNum={searchNum}
              setSearchNum={setSearchNum}
              maxRange={maxRange}
              onAddNumber={addToPicks}
            />
          )}
          {tab === 'positions' && (
            <PositionsTab
              payload={payload}
              selectedPos={selectedPos}
              setSelectedPos={setSelectedPos}
              picksPerDraw={picksPerDraw}
              onAddNumber={addToPicks}
            />
          )}
          {tab === 'shape' && <ShapeTab payload={payload} />}
        </>
      )}
    </ScrollView>
  );
}

const TREND_LEGEND =
  'Score: 0–100, based on recent activity vs long-term deviation. Higher = more active recently. Level H→L: HIGH (67–100), NEUTRAL (34–66), LOW (0–33). Reference only.';

const GUIDE_STEPS = [
  { icon: 'list' as const, title: '1. Select lottery', text: 'Choose Lotto Max, Lotto 6/49, Powerball, or Mega Millions at the top.' },
  { icon: 'pencil' as const, title: '2. Enter or pick numbers', text: 'Type numbers in the slots, or tap numbers from Trends/Positions below to add them.' },
  { icon: 'stats-chart' as const, title: '3. Explore Trends', text: 'See which numbers are HOT (recently active) or COLD (less frequent). Tap a number to add it.' },
  { icon: 'locate' as const, title: '4. Explore Positions', text: 'Pick a position (1–7). See which numbers appear most often at that slot. Tap to add.' },
  { icon: 'albums' as const, title: '5. Explore Shape', text: 'View typical odd/even, low/high split, sum range, and max gap from historical draws.' },
  { icon: 'sparkles' as const, title: '6. Generate number', text: 'After entering at least one number, tap Generate number. Adjust sliders (trend, position, shape) and confirm to fill remaining slots.' },
  { icon: 'refresh' as const, title: '7. Reset', text: 'Tap Reset to clear all numbers and start over.' },
];

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

function PickSlots({
  mainCount,
  mainMin,
  mainMax,
  lines,
  picks,
  setPickAt,
  onGenerate,
  onNavigateToSignIn,
  onReset,
  generating,
  compassRemaining,
  isSignedIn,
  lockFirstNumber,
  onLockFirstNumberChange,
}: {
  mainCount: number;
  mainMin: number;
  mainMax: number;
  lines: number[][];
  picks: number[];
  setPickAt: (idx: number, value: number | '') => void;
  onGenerate?: () => void;
  onNavigateToSignIn?: () => void;
  onReset?: () => void;
  generating?: boolean;
  compassRemaining?: number | null;
  isSignedIn?: boolean | null;
  lockFirstNumber?: boolean;
  onLockFirstNumberChange?: (v: boolean) => void;
}) {
  const [editingSlot, setEditingSlot] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [showLockFirstHelp, setShowLockFirstHelp] = useState(false);
  const hint = `${mainCount} numbers (${mainMin}-${mainMax}, ascending, unique)`;
  const hasFirstPick = picks.some((x) => x > 0);
  const showCountdown = compassRemaining !== null && compassRemaining >= 0;
  const maxFirstForLock = mainMax - mainCount + 1;
  const existingPicks = picks.filter((x) => x > 0);
  const minPick = existingPicks.length > 0 ? Math.min(...existingPicks) : 0;
  const lockFirstTooHigh = lockFirstNumber && hasFirstPick && minPick > maxFirstForLock;
  const canGenerate = isSignedIn !== false && (compassRemaining === null || compassRemaining > 0) && !lockFirstTooHigh;

  const commitEdit = useCallback(
    (idx: number, txt: string) => {
      const parsed = txt.trim() === '' ? '' : parseInt(txt, 10);
      if (parsed === '' || (!isNaN(parsed) && parsed >= mainMin && parsed <= mainMax)) {
        setPickAt(idx, parsed === '' ? '' : parsed);
      }
      setEditingSlot(null);
    },
    [mainMin, mainMax, setPickAt]
  );

  return (
    <View style={styles.pickSlotsWrap}>
      <Text style={styles.pickSlotsHint}>{hint}</Text>
      {!hasFirstPick && (
        <Text style={styles.generateHint}>Enter at least one number (or more) first, then tap Generate number.</Text>
      )}
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
        {Array.from({ length: Math.ceil(mainCount / 6) }, (_, rowIdx) => (
          <View key={rowIdx} style={styles.pickSlotsRow}>
            {Array.from({ length: Math.min(6, mainCount - rowIdx * 6) }, (_, colIdx) => {
              const i = rowIdx * 6 + colIdx;
              const val = editingSlot === i ? editingValue : (picks[i] ? String(picks[i]) : '');
              return (
                <View key={i} style={styles.pickSlot}>
                  <TextInput
                    style={styles.pickSlotInput}
                    value={val}
                    onChangeText={(txt) => {
                      const digits = txt.replace(/\D/g, '');
                      if (editingSlot !== i) return;
                      if (digits === '') {
                        setEditingValue('');
                        return;
                      }
                      const num = parseInt(digits, 10);
                      if (!isNaN(num) && num >= mainMin && num <= mainMax) {
                        setEditingValue(digits);
                      }
                    }}
                    onFocus={() => {
                      setEditingSlot(i);
                      setEditingValue(picks[i] ? String(picks[i]) : '');
                    }}
                    onBlur={() => {
                      if (editingSlot === i) commitEdit(i, editingValue);
                    }}
                    keyboardType="number-pad"
                    placeholder=""
                    placeholderTextColor={COLORS.textMuted}
                    maxLength={String(mainMax).length}
                    selectTextOnFocus
                  />
                </View>
              );
            })}
            {rowIdx === Math.ceil(mainCount / 6) - 1 && onReset && (
              <TouchableOpacity style={styles.resetBtn} onPress={onReset}>
                <Ionicons name="refresh" size={18} color={COLORS.textSecondary} style={styles.generateIcon} />
                <Text style={styles.resetBtnText}>Reset</Text>
              </TouchableOpacity>
            )}
          </View>
        ))}
        {onLockFirstNumberChange && (
          <View style={styles.lockFirstRow}>
            <TouchableOpacity
              style={styles.lockFirstTouch}
              onPress={() => onLockFirstNumberChange(!lockFirstNumber)}
              activeOpacity={0.7}
            >
              <Ionicons name={lockFirstNumber ? 'lock-closed' : 'lock-open-outline'} size={18} color={lockFirstNumber ? COLORS.gold : COLORS.textMuted} />
              <Text style={[styles.lockFirstText, lockFirstNumber && styles.lockFirstTextActive]}>Lock first number</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowLockFirstHelp(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={styles.lockFirstHelpBtn}>
              <Ionicons name="help-circle-outline" size={18} color={COLORS.textMuted} />
            </TouchableOpacity>
          </View>
        )}
        {showLockFirstHelp && (
          <Modal visible transparent animationType="fade">
            <TouchableOpacity style={styles.helpOverlay} activeOpacity={1} onPress={() => setShowLockFirstHelp(false)}>
              <TouchableOpacity activeOpacity={1} onPress={(e) => e.stopPropagation()} style={styles.helpPopup}>
                <Text style={styles.helpPopupTitle}>Lock first number</Text>
                <Text style={styles.helpPopupText}>
                  When enabled, the generated numbers will all be ≥ your smallest entered number. Your first number (the minimum) is locked; the rest are filled by Compass.
                </Text>
                <Text style={styles.helpPopupText}>
                  To avoid wasting a generate, your first number must be ≤{maxFirstForLock} so there's enough room to fill the remaining slots.
                </Text>
                <TouchableOpacity style={styles.helpPopupBtn} onPress={() => setShowLockFirstHelp(false)}>
                  <Text style={styles.helpPopupBtnText}>Got it</Text>
                </TouchableOpacity>
              </TouchableOpacity>
            </TouchableOpacity>
          </Modal>
        )}
        {hasFirstPick && (onGenerate || onNavigateToSignIn) && (
          <View style={styles.generateWrap}>
            {isSignedIn !== false && showCountdown && (
              <Text style={styles.generateCountdown}>
                {compassRemaining === 0 ? 'Upgrade to Pirate or Astronaut Plan for unlimited usage.' : `${compassRemaining} of 10 free uses left`}
              </Text>
            )}
            {lockFirstTooHigh && (
              <Text style={styles.generateCountdown}>
                First number must be ≤{maxFirstForLock} when Lock first number is on, or you'll waste a generate.
              </Text>
            )}
            <TouchableOpacity
              style={[styles.generateBtn, isSignedIn !== false && (!canGenerate || generating) && styles.generateBtnDisabled]}
              onPress={isSignedIn === false && onNavigateToSignIn ? onNavigateToSignIn : onGenerate}
              disabled={isSignedIn !== false && (!canGenerate || generating)}
            >
              {isSignedIn === false ? (
                <>
                  <Ionicons name="log-in-outline" size={18} color={COLORS.gold} style={styles.generateIcon} />
                  <Text style={styles.generateBtnText}>Sign in to use Generate number</Text>
                </>
              ) : generating ? (
                <ActivityIndicator size="small" color={COLORS.gold} />
              ) : (
                <>
                  <Ionicons name="sparkles" size={18} color={COLORS.gold} style={styles.generateIcon} />
                  <Text style={styles.generateBtnText}>Generate number</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

function TrendsTab({
  payload,
  searchNum,
  setSearchNum,
  maxRange,
  onAddNumber,
}: {
  payload: CompassPayload;
  searchNum: string;
  setSearchNum: (s: string) => void;
  maxRange: number;
  onAddNumber?: (n: number) => void;
}) {
  const filtered = payload.trendScores
    .filter((t) => {
      if (!searchNum.trim()) return true;
      const n = parseInt(searchNum, 10);
      return !isNaN(n) && t.number === n;
    })
    .sort((a, b) => b.trendScore - a.trendScore);
  return (
    <View style={styles.tabContent}>
      <Text style={styles.trendLegend}>{TREND_LEGEND}</Text>
      <TextInput
        style={styles.searchInput}
        placeholder="Search number"
        placeholderTextColor={COLORS.textMuted}
        value={searchNum}
        onChangeText={setSearchNum}
        keyboardType="number-pad"
      />
      <ScrollView style={styles.trendList} nestedScrollEnabled>
        {filtered.slice(0, 50).map((t) => (
          <TrendRow key={t.number} t={t} onAddNumber={onAddNumber} />
        ))}
      </ScrollView>
      {filtered.length > 50 && <Text style={styles.moreHint}>Showing first 50. Use search for specific.</Text>}
    </View>
  );
}

function TrendRow({ t, onAddNumber }: { t: NumberTrendScore; onAddNumber?: (n: number) => void }) {
  const levelColor = t.level === 'HIGH' ? COLORS.success : t.level === 'LOW' ? COLORS.warning : COLORS.textSecondary;
  return (
    <View style={styles.trendRow}>
      <TouchableOpacity
        style={[styles.ball, { borderColor: levelColor }]}
        onPress={() => onAddNumber?.(t.number)}
        activeOpacity={0.7}
        disabled={!onAddNumber}
      >
        <Text style={styles.ballText}>{t.number}</Text>
      </TouchableOpacity>
      <View style={styles.trendInfo}>
        <Text style={styles.trendScore}>Score: {t.trendScore.toFixed(0)} ({t.level})</Text>
        <Text style={styles.trendSub}>Recent: {t.recentActivity.toFixed(2)}</Text>
        <Text style={styles.trendSub}>Long dev: {t.longTermDeviation.toFixed(2)}</Text>
      </View>
    </View>
  );
}

function PositionsTab({
  payload,
  selectedPos,
  setSelectedPos,
  picksPerDraw,
  onAddNumber,
}: {
  payload: CompassPayload;
  selectedPos: number;
  setSelectedPos: (n: number) => void;
  picksPerDraw: number;
  onAddNumber?: (n: number) => void;
}) {
  const posData = payload.positionTopK.find((p) => p.position === selectedPos);
  return (
    <View style={styles.tabContent}>
      <Text style={styles.positionNote}>{POSITION_NOTE}</Text>
      <View style={styles.posPicker}>
        {Array.from({ length: picksPerDraw }, (_, i) => i + 1).map((p) => (
          <TouchableOpacity
            key={p}
            style={[styles.posChip, selectedPos === p && styles.posChipActive]}
            onPress={() => setSelectedPos(p)}
          >
            <Text style={styles.posChipText}>{p}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {posData && (
        <View style={styles.posResult}>
          <Text style={styles.posTitle}>Position {selectedPos} most frequent</Text>
          <Text style={styles.posTop}>Top: {posData.topNumber}</Text>
          <View style={styles.topKRow}>
            {posData.topKList.map(({ number, count }) => (
              <TouchableOpacity
                key={number}
                style={styles.topKItem}
                onPress={() => onAddNumber?.(number)}
                activeOpacity={0.7}
                disabled={!onAddNumber}
              >
                <Text style={styles.topKNum}>{number}</Text>
                <Text style={styles.topKCount}>{count}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

function ShapeTab({ payload }: { payload: CompassPayload }) {
  const s = payload.shapeStats;
  return (
    <View style={styles.tabContent}>
      <Text style={styles.shapeHint}>Typical ranges from historical draws (reference only)</Text>
      <View style={styles.shapeCard}>
        <Text style={styles.shapeLabel}>Odd / Even</Text>
        <Text style={styles.shapeValue}>Odd: {s.oddEven.odd.min}-{s.oddEven.odd.max} per draw</Text>
        <Text style={styles.shapeValue}>Even: {s.oddEven.even.min}-{s.oddEven.even.max} per draw</Text>
      </View>
      <View style={styles.shapeCard}>
        <Text style={styles.shapeLabel}>Low / High split</Text>
        <Text style={styles.shapeValue}>Low: {s.lowHigh.low.min}-{s.lowHigh.low.max}</Text>
        <Text style={styles.shapeValue}>High: {s.lowHigh.high.min}-{s.lowHigh.high.max}</Text>
      </View>
      <View style={styles.shapeCard}>
        <Text style={styles.shapeLabel}>Sum range</Text>
        <Text style={styles.shapeValue}>{s.sum.min} - {s.sum.max}</Text>
      </View>
      <View style={styles.shapeCard}>
        <Text style={styles.shapeLabel}>Max gap (typical)</Text>
        <Text style={styles.shapeValue}>{s.gaps.min} - {s.gaps.max}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  content: { paddingHorizontal: SPACING.screenPadding },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  titleIcon: { marginRight: 10 },
  title: { fontSize: 24, fontWeight: '700', color: COLORS.text },
  headerSpacer: { flex: 1 },
  headerBookBtn: {},
  usageHint: { color: COLORS.textMuted, fontSize: 12, marginBottom: 8 },
  label: { color: COLORS.textSecondary, fontSize: 12, marginBottom: 8 },
  lotteryRow: { marginBottom: 16 },
  lotteryScroll: { flexDirection: 'row', marginTop: 4 },
  lotteryChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: COLORS.bgCard,
    marginRight: 8,
  },
  lotteryChipActive: { backgroundColor: COLORS.primary },
  lotteryChipText: { color: COLORS.text, fontSize: 14 },
  pickSlotsWrap: { marginBottom: 16 },
  pickSlotsHint: { color: COLORS.textSecondary, fontSize: 12, marginBottom: 8 },
  pickSlotsCol: { flexDirection: 'column', gap: 8 },
  pickSlotsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  pickSlotsRowMax6: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center', maxWidth: '100%' },
  completedLineRow: { marginBottom: 8 },
  generateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.gold,
    minHeight: 44,
  },
  generateBtnDisabled: { opacity: 0.5 },
  lockFirstRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  lockFirstTouch: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  lockFirstHelpBtn: { padding: 4 },
  lockFirstText: { color: COLORS.textMuted, fontSize: 13 },
  lockFirstTextActive: { color: COLORS.gold },
  helpOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  helpPopup: { backgroundColor: COLORS.bgCard, borderRadius: 12, padding: 20, maxWidth: 320 },
  helpPopupTitle: { color: COLORS.text, fontSize: 16, fontWeight: '600', marginBottom: 12 },
  helpPopupText: { color: COLORS.textSecondary, fontSize: 14, lineHeight: 20, marginBottom: 8 },
  helpPopupBtn: { alignSelf: 'flex-end', marginTop: 12, paddingVertical: 8, paddingHorizontal: 16 },
  helpPopupBtnText: { color: COLORS.gold, fontSize: 14, fontWeight: '600' },
  generateIcon: { marginRight: 6 },
  generateBtnText: { color: COLORS.gold, fontSize: 13, fontWeight: '600' },
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
  resetBtnText: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '600' },
  pickSlot: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.gray700,
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
  generateHint: { color: COLORS.textMuted, fontSize: 13, marginBottom: 12 },
  generateWrap: { flexDirection: 'column', alignItems: 'flex-start', gap: 4 },
  generateCountdown: { color: COLORS.warning, fontSize: 12, fontWeight: '600' },
  pickSlotInput: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    padding: 0,
    margin: 0,
    width: 44,
    height: 44,
    minWidth: 44,
    minHeight: 44,
    outlineStyle: 'none',
  },
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
  tabRow: { flexDirection: 'row', marginBottom: 16 },
  tab: { paddingVertical: 10, paddingHorizontal: 16, marginRight: 8 },
  tabActive: { borderBottomWidth: 2, borderBottomColor: COLORS.gold },
  tabText: { color: COLORS.textMuted },
  tabTextActive: { color: COLORS.gold, fontWeight: '600' },
  tabContent: { marginBottom: 24 },
  trendLegend: {
    color: COLORS.textMuted,
    fontSize: 11,
    marginBottom: 12,
    lineHeight: 16,
  },
  searchInput: {
    backgroundColor: COLORS.bgCard,
    borderRadius: 8,
    padding: 12,
    color: COLORS.text,
    marginBottom: 12,
  },
  trendList: { maxHeight: 400 },
  trendRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  ball: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  ballText: { color: COLORS.text, fontWeight: '700' },
  trendInfo: { flex: 1 },
  trendScore: { color: COLORS.text, fontWeight: '600' },
  trendSub: { color: COLORS.textMuted, fontSize: 11, marginTop: 2 },
  moreHint: { color: COLORS.textMuted, fontSize: 11, marginTop: 8 },
  positionNote: { color: COLORS.textMuted, fontSize: 11, marginBottom: 12 },
  posPicker: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  posChip: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.bgCard,
    alignItems: 'center',
    justifyContent: 'center',
  },
  posChipActive: { backgroundColor: COLORS.primary },
  posChipText: { color: COLORS.text, fontWeight: '600' },
  posResult: { backgroundColor: COLORS.bgCard, borderRadius: 12, padding: 16 },
  posTitle: { color: COLORS.textSecondary, fontSize: 12, marginBottom: 8 },
  posTop: { color: COLORS.gold, fontSize: 18, fontWeight: '700', marginBottom: 12 },
  topKRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  topKItem: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topKNum: { color: COLORS.text, fontWeight: '700' },
  topKCount: { color: COLORS.textMuted, fontSize: 10 },
  shapeHint: { color: COLORS.textMuted, fontSize: 11, marginBottom: 12 },
  shapeCard: {
    backgroundColor: COLORS.bgCard,
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
  },
  shapeLabel: { color: COLORS.gold, fontSize: 12, marginBottom: 6 },
  shapeValue: { color: COLORS.text, fontSize: 14 },
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
