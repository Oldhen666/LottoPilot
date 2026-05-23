import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  BackHandler,
  ToastAndroid,
  Modal,
  Dimensions,
  Share,
  RefreshControl,
  InteractionManager,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, SPACING } from '../constants/theme';
import * as ImagePicker from 'expo-image-picker';
import { useDraws, invalidateDrawsCache } from '../hooks/useDraws';
import { fetchDrawByDate, resolveDrawExtraNumber } from '../services/supabase';
import { LOTTERY_DEFS } from '../constants/lotteries';
import { PRIZE_EXPLANATIONS } from '../constants/prizeExplanations';
import { checkTicket } from '../utils/check';
import { insertRecord, getRecordById } from '../db/sqlite';
import { computePrize } from '../engine/prizeEngine';
import { computeAddOnResults } from '../engine/addOnEngine';
import { fetchAddOnCatalog, isUserSelectableAddOn } from '../services/addOnCatalog';
import { parseTicketFromImage } from '../services/ocr';
import { deleteDebugVariantUris } from '../services/ticketPreprocess/debugCopy';
import { parseTicketDateFromImage } from '../services/parseTicketDateFromImage';
import { normalizeDateCandidates } from '../date/normalizeDate';
import { MainNumbersBoxes } from '../components/MainNumbersBoxes';
import { BannerAdPlaceholder } from '../components/BannerAdPlaceholder';
import { useEntitlements } from '../hooks/useEntitlements';
import { isValidDrawDate } from '../utils/drawDateValidation';
import type { LotteryId } from '../types/lottery';
import type { CurrentJurisdiction } from '../types/jurisdiction';
import type { AddOnCatalogItem, AddOnsSelected, AddOnsInputs } from '../types/addOn';

/** Shown as one optional "Extra" row in Check UI; state keys stay EXTRA / ENCORE / TAG for OCR & DB. */
const INDEPENDENT_ADD_ON_CODES = ['EXTRA', 'ENCORE', 'TAG'] as const;
type IndependentAddOnCode = (typeof INDEPENDENT_ADD_ON_CODES)[number];

function isIndependentAddOnCode(code: string): code is IndependentAddOnCode {
  return (INDEPENDENT_ADD_ON_CODES as readonly string[]).includes(code);
}

const EXTRA_ADDON_UI_LABEL = 'EXTRA';
/**
 * Debug UI gate (thumbnails + rawText).
 * Default OFF even in dev; enable manually by setting `globalThis.test_dev = true` and reloading.
 */
const SHOW_OCR_DEBUG_UI =
  __DEV__ && !!(globalThis as unknown as { test_dev?: boolean; __LP_test_dev?: boolean }).test_dev;

function inferIndependentAddOnCode(lotteryId: LotteryId, jurisdictionCode: string): IndependentAddOnCode | null {
  if (lotteryId !== 'lotto_max' && lotteryId !== 'lotto_649') return null;
  const jc = String(jurisdictionCode ?? '');
  // Ontario: Encore (7 digits)
  if (jc.startsWith('CA-ON')) return 'ENCORE';
  // Atlantic: TAG (6 digits) nightly companion
  if (jc.startsWith('CA-NB') || jc.startsWith('CA-NS') || jc.startsWith('CA-PE') || jc.startsWith('CA-NL')) return 'TAG';
  // Default: EXTRA (WCLC/QC/BC etc.)
  return 'EXTRA';
}

function schemaForOrphanIndependentAddOn(
  code: IndependentAddOnCode,
  jurisdictionCode: string
): { digits: number; displayGroups?: number[]; groupSeparator?: string } {
  if (code === 'TAG') return { digits: 6 };
  if (code === 'ENCORE') return { digits: 7 };
  if (code === 'EXTRA' && jurisdictionCode.startsWith('CA-BC'))
    return { digits: 8, displayGroups: [2, 2, 2, 2], groupSeparator: '-' };
  return { digits: 7 };
}

const LOTTERY_IDS: LotteryId[] = ['lotto_max', 'lotto_649', 'powerball', 'mega_millions'];
const MIN_FLEX_LINES = 3;
const MAX_UI_LINES = 10;
const MAX_OCR_PLAYS_PB_MM = MAX_UI_LINES;

/** Check UI: hide multipliers (prize-only); does not affect match logic */
const HIDDEN_ADD_ON_CODES = new Set<string>(['POWER_PLAY', 'DOUBLE_PLAY', 'MEGA_MULTIPLIER']);
interface Props {
  preselectedLottery?: LotteryId;
  /** When user picks a lottery in the Check screen dropdown — persist for next visit / home default. */
  onLotteryChange?: (id: LotteryId) => void;
  jurisdiction?: CurrentJurisdiction | null;
  jurisdictionCode?: string | null;
  initialRecordId?: string | null;
  /** Increment to force-reset scan/OCR UI state (used after exiting Result screen). */
  resetNonce?: number;
  onBack: () => void;
  onResult: (recordId: string) => void;
}

function parseNumbers(str: string, max: number, minVal?: number, maxVal?: number): number[] {
  const parts = str.split(/[\s,]+/).filter(Boolean);
  const seen = new Set<number>();
  const nums: number[] = [];
  const lo = minVal ?? 0;
  const hi = maxVal ?? 999;
  for (const p of parts) {
    const n = parseInt(p, 10);
    if (!isNaN(n) && n >= lo && n <= hi && !seen.has(n)) {
      seen.add(n);
      nums.push(n);
    }
  }
  return nums.slice(0, max).sort((a, b) => a - b);
}

export default function CheckTicketScreen({
  preselectedLottery = 'lotto_max',
  onLotteryChange,
  jurisdiction,
  jurisdictionCode,
  initialRecordId,
  resetNonce,
  onBack,
  onResult,
}: Props) {
  const { plan } = useEntitlements();
  const [lotteryId, setLotteryId] = useState<LotteryId>(preselectedLottery);
  const [lotteryDropdownOpen, setLotteryDropdownOpen] = useState(false);
  const [specialInput, setSpecialInput] = useState('');
  /** Powerball / Mega Millions: one Powerball or Mega Ball per play line (matches physical tickets). */
  const [specialByLine, setSpecialByLine] = useState<string[]>([]);
  const [allSets, setAllSets] = useState<number[][]>([]);
  /** UI: how many lines to show (default 3, user can add up to 10). */
  const [uiLines, setUiLines] = useState<number>(MIN_FLEX_LINES);
  /** OCR may detect >10 lines; we cap at 10 and show a hint. */
  const [ocrExtraLinesCount, setOcrExtraLinesCount] = useState<number>(0);
  const [selectedDraw, setSelectedDraw] = useState<{ draw_date: string; winning_numbers: number[]; special_numbers?: number[] } | null>(null);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [ocrDateDetected, setOcrDateDetected] = useState(false);
  const [dateStatusMsg, setDateStatusMsg] = useState<string | null>(null);
  const [dateConfirmModal, setDateConfirmModal] = useState<{ candidates: string[]; rawText: string } | null>(null);
  const [ocrBestVariant, setOcrBestVariant] = useState<{ label: string; uri: string; score: number } | null>(null);
  const [extraDraws, setExtraDraws] = useState<{ draw_date: string; winning_numbers: number[]; special_numbers?: number[] }[]>([]);
  const [addOnCatalog, setAddOnCatalog] = useState<AddOnCatalogItem[]>([]);
  const [addOnsSelected, setAddOnsSelected] = useState<AddOnsSelected>({});
  const [addOnsInputs, setAddOnsInputs] = useState<AddOnsInputs>({});
  const [showPrizeModal, setShowPrizeModal] = useState(false);
  const [ocrRawText, setOcrRawText] = useState<string | null>(null);
  const [ocrAddOnsDebug, setOcrAddOnsDebug] = useState<string | null>(null);
  const [showOcrLog, setShowOcrLog] = useState(false);
  const [refetchTrigger, setRefetchTrigger] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  /** Full-screen overlay while OCR / preprocessing runs on a ticket image. */
  const [ocrReading, setOcrReading] = useState(false);
  /** __DEV__ only: copied preprocess variant URIs for debugging (remove UI when done). */
  const [devPreprocessDebug, setDevPreprocessDebug] = useState<{ uris: string[]; labels: string[] } | null>(null);
  const [devPreViewer, setDevPreViewer] = useState<{ uri: string; label: string } | null>(null);
  const handleCheckRef = useRef<() => Promise<void>>(async () => {});
  const { draws, loading } = useDraws(lotteryId, refetchTrigger);

  // We do not require user to select a purchase region. Prefer GPS/known jurisdictionCode, else fall back.
  const defaultJurisdictionCode =
    lotteryId === 'powerball' || lotteryId === 'mega_millions' ? 'US-NATIONAL' : 'CA-NATIONAL';
  const normalizedJurisdictionCode =
    typeof jurisdictionCode === 'string' && jurisdictionCode.trim().length > 0 ? jurisdictionCode.trim() : null;
  const effectiveJurisdictionCode = normalizedJurisdictionCode ?? defaultJurisdictionCode;
  const prizeJurisdictionCode = normalizedJurisdictionCode ?? defaultJurisdictionCode;

  const def = LOTTERY_DEFS[lotteryId];
  const rawDrawsList = [...draws, ...extraDraws.filter((e) => !draws.some((d) => d.draw_date === e.draw_date))];
  const drawsList = lotteryId === 'powerball'
    ? rawDrawsList.filter((d) => isValidDrawDate(d.draw_date, 'powerball'))
    : lotteryId === 'mega_millions'
      ? rawDrawsList.filter((d) => isValidDrawDate(d.draw_date, 'mega_millions'))
      : rawDrawsList;
  const drawScrollRef = useRef<ScrollView>(null);
  const checkScrollRef = useRef<ScrollView>(null);
  /** Y offset of the numbers section within ScrollView content (for post-OCR scroll). */
  const numbersSectionYRef = useRef(0);
  const CHIP_WIDTH = 105;

  const formatGroupedNumber = useCallback((raw: string, groups: number[], sep = '-') => {
    const digits = String(raw ?? '').replace(/\D/g, '');
    let idx = 0;
    const parts: string[] = [];
    for (const g of groups) {
      if (idx >= digits.length) break;
      const chunk = digits.slice(idx, idx + Math.max(1, g));
      if (!chunk) break;
      parts.push(chunk);
      idx += Math.max(1, g);
    }
    if (idx < digits.length) parts.push(digits.slice(idx));
    return parts.join(sep);
  }, []);

  const scrollToNumbersSection = useCallback(() => {
    InteractionManager.runAfterInteractions(() => {
      setTimeout(() => {
        const y = numbersSectionYRef.current;
        if (y > 0) {
          checkScrollRef.current?.scrollTo({ y: Math.max(0, y - 12), animated: true });
        }
      }, 550);
    });
  }, []);

  useEffect(() => {
    setLotteryId(preselectedLottery);
  }, [preselectedLottery]);

  const resetScanState = useCallback(() => {
    // Clear current image + OCR readings.
    setImageUri(null);
    setOcrBestVariant(null);
    setDevPreViewer(null);
    setOcrReading(false);
    setDevPreprocessDebug((prev) => {
      if (prev?.uris?.length) {
        deleteDebugVariantUris(prev.uris).catch(() => {});
      }
      return null;
    });
    setSelectedDraw(null);
    setExtraDraws([]);
    setOcrDateDetected(false);
    setDateStatusMsg(null);
    setOcrRawText(null);
    setOcrAddOnsDebug(null);
    setDateConfirmModal(null);
    setAddOnsSelected({});
    setAddOnsInputs({});
    setSpecialInput('');
    setOcrExtraLinesCount(0);
    const def = LOTTERY_DEFS[lotteryId];
    const cnt = def?.main_count ?? 7;
    const plays = MIN_FLEX_LINES;
    const emptySets = Array.from({ length: plays }, () => Array(cnt).fill(0) as number[]);
    setAllSets(emptySets);
    setUiLines(plays);
    if (lotteryId === 'powerball' || lotteryId === 'mega_millions') {
      setSpecialByLine(Array.from({ length: plays }, () => ''));
    } else {
      setSpecialByLine([]);
    }
  }, [lotteryId]);

  useEffect(() => {
    if (initialRecordId) return;
    resetScanState();
  }, [lotteryId, initialRecordId]);

  useEffect(() => {
    if (!resetNonce) return;
    if (initialRecordId) return;
    resetScanState();
  }, [resetNonce, initialRecordId, resetScanState]);

  // Keep PB/MM specialByLine aligned with current UI line count.
  useEffect(() => {
    if (lotteryId !== 'powerball' && lotteryId !== 'mega_millions') return;
    setSpecialByLine((prev) => {
      const next = [...prev];
      while (next.length < uiLines) next.push('');
      return next;
    });
  }, [lotteryId, uiLines]);

  /** Clear OCR-filled numbers and add-ons when user removes the preview image. */
  const clearScannedReadings = useCallback(() => {
    setDevPreprocessDebug((prev) => {
      if (prev?.uris?.length) {
        deleteDebugVariantUris(prev.uris).catch(() => {});
      }
      return null;
    });
    const d = LOTTERY_DEFS[lotteryId];
    const cnt = d?.main_count ?? 7;
    const plays = MIN_FLEX_LINES;
    const emptySets = Array.from({ length: plays }, () => Array(cnt).fill(0) as number[]);
    setAllSets(emptySets);
    setUiLines(plays);
    setOcrExtraLinesCount(0);
    setSpecialInput('');
    if (lotteryId === 'powerball' || lotteryId === 'mega_millions') {
      setSpecialByLine(Array.from({ length: plays }, () => ''));
    } else {
      setSpecialByLine([]);
    }
    setAddOnsSelected({});
    setAddOnsInputs({});
    setOcrRawText(null);
    setShowOcrLog(false);
  }, [lotteryId]);

  useEffect(() => {
    fetchAddOnCatalog(lotteryId, effectiveJurisdictionCode).then(setAddOnCatalog);
  }, [lotteryId, effectiveJurisdictionCode]);

  useEffect(() => {
    if (!initialRecordId) return;
    getRecordById(initialRecordId).then((record) => {
      if (!record) return;
      setLotteryId(record.lottery_id as LotteryId);
      const def = LOTTERY_DEFS[record.lottery_id];
      const plays = def?.plays_per_ticket ?? 1;
      const mainCount = def?.main_count ?? 7;
      const lineResults = record.result_json?.lineResults;
      const sets: number[][] = lineResults?.length
        ? lineResults.map((lr) => {
            const padded = [...lr.user_main, ...Array(Math.max(0, mainCount - lr.user_main.length)).fill(0)];
            return padded.slice(0, mainCount) as number[];
          })
        : [[...record.user_numbers, ...Array(Math.max(0, mainCount - record.user_numbers.length)).fill(0)].slice(0, mainCount) as number[]];
      while (sets.length < plays) {
        sets.push(Array(mainCount).fill(0));
      }
      setAllSets(sets.slice(0, plays));
      if (record.lottery_id === 'powerball' || record.lottery_id === 'mega_millions') {
        const lr = record.result_json?.lineResults;
        if (lr?.length) {
          setSpecialByLine(
            Array.from({ length: plays }, (_, i) => {
              const sp = lr[i]?.user_special?.[0];
              return sp != null && sp > 0 ? String(sp) : '';
            })
          );
        } else {
          const one = record.user_special?.[0];
          setSpecialByLine(Array.from({ length: plays }, () => (one != null && one > 0 ? String(one) : '')));
        }
        setSpecialInput('');
      } else {
        setSpecialInput(record.user_special?.length ? record.user_special.join(' ') : '');
        setSpecialByLine([]);
      }
      const draw = {
        draw_date: record.draw_date,
        winning_numbers: record.winning_numbers,
        special_numbers: record.winning_special,
      };
      setExtraDraws((prev) => {
        const has = prev.some((d) => d.draw_date === record.draw_date);
        if (has) return prev;
        return [draw, ...prev];
      });
      setSelectedDraw(draw);
      if (record.add_ons_selected_json) setAddOnsSelected(record.add_ons_selected_json);
      if (record.add_ons_inputs_json) setAddOnsInputs(record.add_ons_inputs_json);
    });
  }, [initialRecordId]);

  useEffect(() => {
    if (initialRecordId && selectedDraw) return;
    const list = [...draws, ...extraDraws.filter((e) => !draws.some((d) => d.draw_date === e.draw_date))];
    if (list.length > 0 && !selectedDraw) {
      setSelectedDraw(list[0]);
    }
  }, [draws, extraDraws, initialRecordId, selectedDraw]);

  const scanInFlightRef = useRef(false);
  const swallowBackUntilRef = useRef(0);
  const lastBackPressAtRef = useRef(0);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      // Some native screens (e.g. document scanner) may trigger a back event when closing.
      // If we are in the middle of an external scan/processing, swallow it to avoid
      // unexpectedly popping back to Home.
      const now = Date.now();
      if (scanInFlightRef.current) return true;
      if (swallowBackUntilRef.current && now < swallowBackUntilRef.current) return true;
      // Prevent accidental back fired by native scanner close. Require double-press to exit this screen.
      const DOUBLE_PRESS_MS = 1200;
      if (now - lastBackPressAtRef.current < DOUBLE_PRESS_MS) {
        lastBackPressAtRef.current = 0;
        onBack();
        return true;
      }
      lastBackPressAtRef.current = now;
      ToastAndroid.show('Press back again to return home', ToastAndroid.SHORT);
      return true;
    });
    return () => sub.remove();
  }, [onBack]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    invalidateDrawsCache(lotteryId);
    setRefetchTrigger((t) => t + 1);
  }, [lotteryId]);

  useEffect(() => {
    if (refreshing && !loading) setRefreshing(false);
  }, [refreshing, loading]);

  useEffect(() => {
    if (!selectedDraw || drawsList.length === 0 || !drawScrollRef.current) return;
    const idx = drawsList.findIndex((d) => d.draw_date === selectedDraw.draw_date);
    if (idx >= 0) {
      const screenWidth = Dimensions.get('window').width;
      const x = Math.max(0, idx * CHIP_WIDTH - screenWidth / 2 + CHIP_WIDTH / 2);
      setTimeout(() => drawScrollRef.current?.scrollTo({ x, animated: true }), 100);
    }
  }, [selectedDraw, drawsList]);

  const handleCheck = async () => {
    if (!selectedDraw || !def) {
      if (drawsList.length === 0 && !loading) {
        Alert.alert('No draw data', 'Draw data is not loaded yet. Please wait or check your connection, then try again.');
      } else if (!selectedDraw) {
        Alert.alert('Select draw date', 'Please select a draw date from the list above first.');
      }
      return;
    }
    if (lotteryId === 'powerball' && !isValidDrawDate(selectedDraw.draw_date, 'powerball')) {
      Alert.alert('Invalid draw date', 'Powerball only draws on Monday, Wednesday, and Saturday. Please select a valid draw date.');
      return;
    }
    if (lotteryId === 'mega_millions' && !isValidDrawDate(selectedDraw.draw_date, 'mega_millions')) {
      Alert.alert('Invalid draw date', 'Mega Millions only draws on Tuesday and Friday. Please select a valid draw date.');
      return;
    }
    const mainPlaysWithLineIdx: { lineIdx: number; play: number[] }[] = [];
    allSets.forEach((s, lineIdx) => {
      const filtered = s.filter((n) => n > 0).sort((a, b) => a - b);
      if (filtered.length >= def.main_count) {
        mainPlaysWithLineIdx.push({ lineIdx, play: filtered });
      }
    });
    const mainPlaysForCheck = mainPlaysWithLineIdx.map((x) => x.play);
    const userMain = mainPlaysForCheck[0];
    const needsSpecialInput = def.special_count > 0 && !['lotto_max', 'lotto_649'].includes(lotteryId);
    const isPbMm = lotteryId === 'powerball' || lotteryId === 'mega_millions';

    const userSpecialPerLine: (number[] | undefined)[] = [];
    if (needsSpecialInput) {
      if (isPbMm) {
        for (let i = 0; i < mainPlaysWithLineIdx.length; i++) {
          const uiLine = mainPlaysWithLineIdx[i].lineIdx + 1;
          const sp = parseNumbers(
            specialByLine[mainPlaysWithLineIdx[i].lineIdx] ?? '',
            def.special_count,
            def.special_min ?? 1,
            def.special_max ?? 49
          );
          if (!sp || sp.length < def.special_count) {
            const label = lotteryId === 'powerball' ? 'Powerball' : 'Mega Ball';
            Alert.alert(
              'Invalid input',
              `Enter ${def.special_count} ${label} for line ${uiLine} (${def.special_min}-${def.special_max})`
            );
            return;
          }
          userSpecialPerLine.push(sp);
        }
      } else {
        const userSpecial = parseNumbers(specialInput, def.special_count, def.special_min ?? 1, def.special_max ?? 49);
        if (!userSpecial || userSpecial.length < def.special_count) {
          const label = 'special';
          Alert.alert('Invalid input', `Please enter ${def.special_count} ${label} number${def.special_count > 1 ? 's' : ''}`);
          return;
        }
        for (let i = 0; i < mainPlaysForCheck.length; i++) {
          userSpecialPerLine.push(userSpecial);
        }
      }
    } else {
      for (let i = 0; i < mainPlaysForCheck.length; i++) {
        userSpecialPerLine.push(undefined);
      }
    }

    const userSpecialFirst = userSpecialPerLine[0];

    if (!userMain || userMain.length < def.main_count) {
      Alert.alert('Invalid input', `Please enter at least Line 1 with ${def.main_count} numbers (${def.main_min}-${def.main_max}, ascending, unique)`);
      return;
    }
    const hasDuplicates = mainPlaysForCheck.some((play) => new Set(play).size !== play.length);
    if (hasDuplicates) {
      Alert.alert('Duplicate numbers', 'Each line must have unique numbers. Please remove duplicates and try again.');
      return;
    }

    try {
      const mainPlays = mainPlaysForCheck.length > 0 ? mainPlaysForCheck : [userMain];
      const lineResults: Array<{ user_main: number[]; user_special?: number[]; match_main: number; match_special: number; result_bucket: string }> = [];
      let bestResult = checkTicket(
        mainPlays[0],
        userSpecialFirst?.length ? userSpecialFirst : undefined,
        selectedDraw.winning_numbers,
        selectedDraw.special_numbers,
        def
      );
      for (let i = 0; i < mainPlays.length; i++) {
        const us = userSpecialPerLine[i];
        const r = checkTicket(
          mainPlays[i],
          us?.length ? us : undefined,
          selectedDraw.winning_numbers,
          selectedDraw.special_numbers,
          def
        );
        lineResults.push({
          user_main: mainPlays[i],
          user_special: us?.length ? us : undefined,
          match_main: r.match_count_main,
          match_special: r.match_count_special,
          result_bucket: r.result_bucket,
        });
        if (r.match_count_main > bestResult.match_count_main || (r.match_count_main === bestResult.match_count_main && r.match_count_special > bestResult.match_count_special)) {
          bestResult = r;
        }
      }
      const result = bestResult;

      const sel = selectedDraw as { jackpot_amount?: number; multiplier_value?: number; power_play_multiplier?: number; mega_multiplier?: number };
      const drawWithPrize = {
        ...selectedDraw,
        jackpot_amount: sel.jackpot_amount,
        multiplier_value: lotteryId === 'powerball' ? sel.power_play_multiplier : lotteryId === 'mega_millions' ? sel.mega_multiplier : sel.multiplier_value,
      };
      const prizeResults = await Promise.all(
        mainPlays.map((play, i) =>
          computePrize(
            lotteryId,
            prizeJurisdictionCode,
            drawWithPrize,
            play,
            userSpecialPerLine[i]?.length ? userSpecialPerLine[i] : undefined,
            addOnsSelected
          )
        )
      );
      const bestIdx = mainPlays.length > 1
        ? (lineResults.findIndex(
            (lr) => lr.match_main === result.match_count_main && lr.match_special === result.match_count_special
          ) ?? 0)
        : 0;
      const prizeResult = prizeResults[bestIdx];
      lineResults.forEach((lr, i) => {
        if (prizeResults[i]?.estimatedPrizeText) (lr as { prizeText?: string }).prizeText = prizeResults[i].estimatedPrizeText;
      });

      let drawForAddOns = {
        ...selectedDraw,
        extra_number: (selectedDraw as { extra_number?: string }).extra_number,
        encore_number: (selectedDraw as { encore_number?: string }).encore_number,
        tag_number: (selectedDraw as { tag_number?: string }).tag_number,
        power_play_multiplier: (selectedDraw as { power_play_multiplier?: number }).power_play_multiplier,
        double_play_numbers_json: (selectedDraw as { double_play_numbers_json?: number[] }).double_play_numbers_json,
        maxmillions_numbers_json: (selectedDraw as { maxmillions_numbers_json?: string[] }).maxmillions_numbers_json,
        mega_multiplier: (selectedDraw as { mega_multiplier?: number }).mega_multiplier,
      };
      // List + SQLite draws cache omit extra_number / encore_number — fetch full row for EXTRA / ENCORE / Maxmillions.
      if (lotteryId === 'lotto_max' || lotteryId === 'lotto_649') {
        const full = await fetchDrawByDate(lotteryId, selectedDraw.draw_date);
        if (full) {
          const f = full as Record<string, unknown>;
          drawForAddOns = {
            ...drawForAddOns,
            extra_number:
              resolveDrawExtraNumber(f, effectiveJurisdictionCode) ??
              (f.extra_number as string | undefined) ??
              drawForAddOns.extra_number,
            encore_number: (f.encore_number as string | undefined) ?? drawForAddOns.encore_number,
            maxmillions_numbers_json:
              (f.maxmillions_numbers_json as string[] | undefined) ?? drawForAddOns.maxmillions_numbers_json,
            tag_number: (f.tag_number as string | undefined) ?? drawForAddOns.tag_number,
          };
        }
      }
      let tagNumber: string | null | undefined = drawForAddOns.tag_number;
      if (addOnsSelected?.TAG && addOnsInputs?.TAG) {
        const tagDrawDate = addOnsInputs.TAG_DRAW_DATE ?? selectedDraw.draw_date;
        const tagDraw = await fetchDrawByDate('alc_tag', tagDrawDate);
        tagNumber = (tagDraw as { tag_number?: string } | null)?.tag_number ?? tagNumber;
      }
      const addOnResults = computeAddOnResults(
        addOnsSelected,
        addOnsInputs,
        drawForAddOns,
        userMain,
        userSpecialFirst?.length ? userSpecialFirst : undefined,
        tagNumber,
        mainPlays
      );

      const hasAddOns = Object.keys(addOnsSelected).some((k) => addOnsSelected[k as keyof typeof addOnsSelected]);
      const addOnsToSave = hasAddOns && addOnsSelected?.TAG
        ? { ...addOnsInputs, TAG_DRAW_DATE: addOnsInputs.TAG_DRAW_DATE ?? selectedDraw.draw_date }
        : addOnsInputs;
      const hasAddOnInputs = Object.keys(addOnsToSave).length > 0;

      const now = new Date().toISOString();
      const id = await insertRecord({
        created_at: now,
        lottery_id: lotteryId,
        draw_date: selectedDraw.draw_date,
        user_numbers: userMain,
        user_special: userSpecialFirst?.length ? userSpecialFirst : undefined,
        winning_numbers: selectedDraw.winning_numbers,
        winning_special: selectedDraw.special_numbers,
        match_count_main: result.match_count_main,
        match_count_special: result.match_count_special,
        result_bucket: result.result_bucket,
        source: imageUri ? 'photo' : 'manual',
        jurisdiction_code: prizeJurisdictionCode,
        add_ons_selected_json: hasAddOns ? addOnsSelected : undefined,
        add_ons_inputs_json: hasAddOnInputs ? addOnsToSave : undefined,
        result_json: {
          estimatedPrizeText: prizeResult.estimatedPrizeText,
          tierName: prizeResult.matchedTiers[0]?.tier.tier_name,
          claimUrl: prizeResult.claimUrl ?? undefined,
          officialRulesUrl: prizeResult.officialRulesUrl ?? undefined,
          disclaimers: prizeResult.disclaimers,
          lineResults: lineResults.length > 0 ? lineResults : undefined,
          mainResult: {
            match_main: result.match_count_main,
            match_special: result.match_count_special,
            prizeText: prizeResult.estimatedPrizeText,
          },
          addOnResults: Object.keys(addOnResults).length > 0 ? addOnResults : undefined,
          options:
            lotteryId === 'powerball'
              ? { power_play: !!addOnsSelected?.POWER_PLAY }
              : lotteryId === 'mega_millions'
                ? { megaplier: !!addOnsSelected?.MEGA_MULTIPLIER }
                : undefined,
        },
      });

      onResult(id);
    } catch (e) {
      Alert.alert('Error', (e as Error)?.message || 'Failed to save result');
    }
  };

  handleCheckRef.current = handleCheck;

  const runDocumentScan = async () => {
    if (Platform.OS === 'web') return;
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission required', 'Camera access is needed to scan tickets.');
      return;
    }
    try {
      scanInFlightRef.current = true;
      swallowBackUntilRef.current = 0;
      const DocumentScanner = require('react-native-document-scanner-plugin').default;
      const { scannedImages, status: scanStatus } = await DocumentScanner.scanDocument({
        maxNumDocuments: 1,
        croppedImageQuality: 95,
      });
      if (scanStatus === 'cancel' || !scannedImages?.length) return;
      const uri = scannedImages[0].startsWith('file://') ? scannedImages[0] : `file://${scannedImages[0]}`;
      await processImageUri(uri, { fromDocumentScan: true });
    } catch (e) {
      Alert.alert('Scan failed', (e as Error)?.message || 'Document scanner is not available.');
    } finally {
      scanInFlightRef.current = false;
      // Some devices dispatch the back event *after* the scanner closes (or after returning to app).
      // Swallow for a short window so "Next" doesn't accidentally pop to Home.
      swallowBackUntilRef.current = Date.now() + 2000;
    }
  };

  const runPickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission required', 'Photo library access is needed to select ticket images.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 0.92,
    });
    if (result.canceled || !result.assets?.[0]) return;
    await processImageUri(result.assets[0].uri);
  };

  const processImageUri = async (uri: string, sourceOpts?: { fromDocumentScan?: boolean }) => {
    setOcrReading(true);
    try {
      setImageUri(uri);

      const def = LOTTERY_DEFS[lotteryId];
    const playsPerTicketForOcr =
      lotteryId === 'powerball' || lotteryId === 'mega_millions'
        ? Math.max(def?.plays_per_ticket ?? 1, MAX_OCR_PLAYS_PB_MM)
        : (def?.plays_per_ticket ?? 1);
    const parsePromise = parseTicketFromImage(uri, def ? {
      mainCount: def.main_count,
      mainMax: def.main_max,
      specialMin: def.special_min ?? 1,
      specialMax: def.special_max ?? 49,
      specialCount: def.special_count ?? 1,
      lotteryId,
      jurisdictionCode: effectiveJurisdictionCode,
      playsPerTicket: playsPerTicketForOcr,
      imageSource: sourceOpts?.fromDocumentScan ? 'document_scan' : 'default',
      ...(__DEV__
        ? {
            debugPreprocessPreview: (info: { uris: string[]; labels: string[] }) => {
              setDevPreprocessDebug((prev) => {
                if (prev?.uris?.length) {
                  deleteDebugVariantUris(prev.uris).catch(() => {});
                }
                return info;
              });
            },
          }
        : {}),
    } : undefined);
    const parsed = await Promise.race([
      parsePromise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 55_000)),
    ]);

    setOcrRawText(parsed?.rawText ?? null);
    if (__DEV__ && !parsed?.rawText?.trim()) {
      console.warn('[CheckTicket] ML Kit returned no text', { lotteryId, uri: uri.slice(0, 80) });
      try {
        const { diagnoseOcrUri } = await import('../services/powerballOcr/mlkitRecognize');
        const diag = await diagnoseOcrUri(uri);
        console.warn('[CheckTicket] OCR diagnostic', JSON.stringify(diag));
      } catch (e) {
        console.warn('[CheckTicket] OCR diagnostic failed', e);
      }
    }
    if (__DEV__) setOcrAddOnsDebug(parsed?.addOnsDetected ? JSON.stringify(parsed.addOnsDetected) : 'null');
    setOcrBestVariant(__DEV__ ? (parsed as any)?.debugOcrVariant ?? null : null);
    if (__DEV__ && parsed?.rawText) {
      console.log('--- CheckTicket OCR rawText ---\n', parsed.rawText, '\n--- end rawText ---');
    }
    if (__DEV__) {
      console.log(
        '[CheckTicket] addOnsDetected=',
        parsed?.addOnsDetected ?? null,
        'jurisdiction=',
        effectiveJurisdictionCode,
        'lotteryId=',
        lotteryId
      );
    }
    if (__DEV__ && parsed?.allSets?.length) {
      console.log('[CheckTicket] parsed allSets=%d specialsPerLine=%d', parsed.allSets.length, parsed.specialsPerLine?.length ?? 0);
    }

    if (parsed?.mainNumbers?.length || parsed?.allSets?.length) {
      setOcrExtraLinesCount(0);
      if (parsed.allSets?.length) {
        const cnt = def?.main_count ?? 7;
        const detected = parsed.allSets.length;
        const targetLines = Math.min(MAX_UI_LINES, Math.max(MIN_FLEX_LINES, detected));
        if (detected > targetLines) setOcrExtraLinesCount(detected - targetLines);
        setUiLines(targetLines);
        const padded = parsed.allSets
          .slice(0, targetLines)
          .map((s) => [...s, ...Array(Math.max(0, cnt - s.length)).fill(0)].slice(0, cnt));
        while (padded.length < targetLines) padded.push(Array(cnt).fill(0));
        setAllSets(padded);
      } else {
        const cnt = def?.main_count ?? 7;
        const one = [...parsed!.mainNumbers, ...Array(Math.max(0, cnt - parsed!.mainNumbers.length)).fill(0)].slice(0, cnt);
        const padded = [one];
        while (padded.length < MIN_FLEX_LINES) padded.push(Array(cnt).fill(0));
        setUiLines(MIN_FLEX_LINES);
        setAllSets(padded);
      }
      const plays = Math.min(MAX_UI_LINES, Math.max(MIN_FLEX_LINES, uiLines, parsed.allSets?.length ?? 0));
      if (
        parsed.specialsPerLine?.length &&
        (lotteryId === 'powerball' || lotteryId === 'mega_millions')
      ) {
        const row = parsed.specialsPerLine.map((n) => (n > 0 ? String(n) : ''));
        while (row.length < plays) row.push('');
        setSpecialByLine(row.slice(0, plays));
        setSpecialInput('');
      } else if (parsed.specialNumbers?.length) {
        const spJoined = parsed.specialNumbers.join(' ');
        setSpecialInput(spJoined);
        if (lotteryId === 'powerball' || lotteryId === 'mega_millions') {
          const first = parsed.specialNumbers[0] != null ? String(parsed.specialNumbers[0]) : '';
          setSpecialByLine(Array.from({ length: plays }, (_, li) => (li === 0 ? first : '')));
        }
      } else if (lotteryId === 'lotto_max' || lotteryId === 'lotto_649') {
        setSpecialInput('');
      } else if (lotteryId === 'powerball' || lotteryId === 'mega_millions') {
        setSpecialByLine(Array.from({ length: plays }, () => ''));
      }
      if (parsed.addOnsDetected) {
        const catalog = addOnCatalog.length > 0 ? addOnCatalog : await fetchAddOnCatalog(lotteryId, effectiveJurisdictionCode);
        const selectable = catalog.filter(isUserSelectableAddOn).map((i) => i.add_on_code);
        const newSelected: AddOnsSelected = {};
        const newInputs: AddOnsInputs = {};
        for (const code of selectable) {
          if (HIDDEN_ADD_ON_CODES.has(code)) continue;
          const val = parsed.addOnsDetected!.inputs[code];
          const isSel = !!parsed.addOnsDetected!.selected[code] || (val != null && String(val).length > 0);
          if (isSel) {
            newSelected[code as keyof AddOnsSelected] = true;
            if (val != null) newInputs[code as keyof AddOnsInputs] = val;
          }
        }
        // Lotto Max / 649: WCLC EXTRA & OLG ENCORE are always merged when OCR finds them — catalog may be empty or omit rows offline.
        if (lotteryId === 'lotto_max' || lotteryId === 'lotto_649') {
          const det = parsed.addOnsDetected;
          if (det.selected.EXTRA && det.inputs.EXTRA) {
            newSelected.EXTRA = true;
            newInputs.EXTRA = det.inputs.EXTRA;
          }
          if (det.selected.ENCORE && det.inputs.ENCORE) {
            newSelected.ENCORE = true;
            newInputs.ENCORE = det.inputs.ENCORE;
          }
          if (det.selected.TAG && det.inputs.TAG) {
            newSelected.TAG = true;
            newInputs.TAG = det.inputs.TAG;
          }
        }
        if (Object.keys(newSelected).length > 0) {
          setAddOnsSelected((s) => ({ ...s, ...newSelected }));
          setAddOnsInputs((s) => ({ ...s, ...newInputs }));
        }
      }
    }
    const applyDateToDraw = async (dateISO: string): Promise<boolean> => {
      if (lotteryId === 'powerball' && !isValidDrawDate(dateISO, 'powerball')) {
        setDateStatusMsg(`Powerball only draws Mon/Wed/Sat. ${dateISO} is not a valid draw date.`);
        return false;
      }
      if (lotteryId === 'mega_millions' && !isValidDrawDate(dateISO, 'mega_millions')) {
        setDateStatusMsg(`Mega Millions only draws Tue/Fri. ${dateISO} is not a valid draw date.`);
        return false;
      }
      const list = [...draws, ...extraDraws.filter((e) => !draws.some((d) => d.draw_date === e.draw_date))];
      const match = list.find((d) => d.draw_date === dateISO);
      if (match) {
        setSelectedDraw(match);
        setDateStatusMsg(`Date auto-selected: ${dateISO}`);
        return true;
      }
      try {
        const byDate = await fetchDrawByDate(lotteryId, dateISO);
        if (byDate) {
          setSelectedDraw(byDate);
          setExtraDraws((prev) => (prev.some((e) => e.draw_date === byDate.draw_date) ? prev : [...prev, byDate]));
          setDateStatusMsg(`Date auto-selected: ${dateISO}`);
          return true;
        }
      } catch {
        // ignore
      }
      setDateStatusMsg(`Date ${dateISO} not in database. Run "npm run scrape:history" to fetch it, or select another date above.`);
      return false;
    };

    if (parsed?.rawText) {
      const dateResult = normalizeDateCandidates(parsed.rawText, lotteryId);
      if (dateResult.candidates.length > 0) {
        setOcrDateDetected(true);
        if (dateResult.needsUserConfirm || !dateResult.dateISO) {
          setDateConfirmModal({ candidates: dateResult.candidates, rawText: dateResult.rawText });
          setDateStatusMsg('Multiple dates detected. Please pick one.');
        } else if (dateResult.dateISO) {
          const applied = await applyDateToDraw(dateResult.dateISO);
          if (!applied) setOcrDateDetected(false);
        }
      } else {
        setOcrDateDetected(false);
        setDateStatusMsg('No date detected from ticket. Please select draw date manually.');
      }
      if (!parsed.mainNumbers?.length && !parsed.allSets?.length) {
        setDateStatusMsg(
          lotteryId === 'lotto_max' || lotteryId === 'lotto_649'
            ? 'OCR read text but could not find play lines. Please enter numbers manually.'
            : 'OCR read text but could not find play numbers. Please enter numbers manually.',
        );
      }
    } else {
      if (!parsed && uri) {
        const fallbackDate = await parseTicketDateFromImage(uri, lotteryId);
        if (fallbackDate.candidates.length > 0) {
          setOcrDateDetected(true);
          if (fallbackDate.needsUserConfirm || !fallbackDate.dateISO) {
            setDateConfirmModal({ candidates: fallbackDate.candidates, rawText: fallbackDate.rawText });
            setDateStatusMsg('Multiple dates detected. Please pick one.');
          } else if (fallbackDate.dateISO) {
            await applyDateToDraw(fallbackDate.dateISO);
          }
          return;
        }
      }
      setOcrDateDetected(false);
      const failMsg = parsed
        ? parsed.mainNumbers?.length || parsed.allSets?.length
          ? 'No date detected from ticket. Please select draw date manually.'
          : lotteryId === 'lotto_max' || lotteryId === 'lotto_649'
            ? 'OCR read text but could not find play lines. Please enter numbers manually.'
            : 'OCR read text but could not find play numbers. Please enter numbers manually.'
        : 'OCR could not read text. Use Scan ticket with good lighting, or enter numbers manually.';
      setDateStatusMsg(failMsg);
    }

      if (parsed?.mainNumbers?.length || parsed?.allSets?.length) {
        scrollToNumbersSection();
      }
    } catch {
      setDateStatusMsg('Scan processing failed or timed out. Please try again or enter numbers manually.');
    } finally {
      setOcrReading(false);
    }
  };

  const scanDocument = async () => {
    if (Platform.OS === 'web') return;
    await runDocumentScan();
  };

  const pickImage = async () => {
    await runPickImage();
  };

  const handleDateConfirm = async (dateISO: string) => {
    setDateConfirmModal(null);
    if (lotteryId === 'powerball' && !isValidDrawDate(dateISO, 'powerball')) {
      setDateStatusMsg(`Powerball only draws Mon/Wed/Sat. ${dateISO} is not a valid draw date.`);
      return;
    }
    if (lotteryId === 'mega_millions' && !isValidDrawDate(dateISO, 'mega_millions')) {
      setDateStatusMsg(`Mega Millions only draws Tue/Fri. ${dateISO} is not a valid draw date.`);
      return;
    }
    const list = [...draws, ...extraDraws.filter((e) => !draws.some((d) => d.draw_date === e.draw_date))];
    const match = list.find((d) => d.draw_date === dateISO);
    if (match) {
      setSelectedDraw(match);
      setDateStatusMsg(`Date selected: ${dateISO}`);
    } else {
      try {
        const byDate = await fetchDrawByDate(lotteryId, dateISO);
        if (byDate) {
          setSelectedDraw(byDate);
          setExtraDraws((prev) => (prev.some((e) => e.draw_date === byDate.draw_date) ? prev : [...prev, byDate]));
          setDateStatusMsg(`Date selected: ${dateISO}`);
        } else {
          setDateStatusMsg(`Date ${dateISO} not in database. Run "npm run scrape:history" to fetch it, or select another date above.`);
        }
      } catch {
        setDateStatusMsg(`Date ${dateISO} not in database. Run "npm run scrape:history" to fetch it, or select another date above.`);
      }
    }
  };

  const insets = useSafeAreaInsets();

  const visibleAddOnItems = useMemo(
    () => addOnCatalog.filter((i) => isUserSelectableAddOn(i) && !HIDDEN_ADD_ON_CODES.has(i.add_on_code)),
    [addOnCatalog]
  );

  const catalogOtherItems = useMemo(
    () => visibleAddOnItems.filter((i) => !isIndependentAddOnCode(i.add_on_code)),
    [visibleAddOnItems]
  );

  const independentCode = useMemo(() => {
    if (lotteryId !== 'lotto_max' && lotteryId !== 'lotto_649') return null;
    // If OCR/user already provided a specific add-on number, prefer showing that one
    // (so NATIONAL still auto-fills ENCORE/TAG/EXTRA correctly).
    if (addOnsSelected.ENCORE || addOnsInputs.ENCORE) return 'ENCORE' as const;
    if (addOnsSelected.TAG || addOnsInputs.TAG) return 'TAG' as const;
    if (addOnsSelected.EXTRA || addOnsInputs.EXTRA) return 'EXTRA' as const;
    return inferIndependentAddOnCode(lotteryId, effectiveJurisdictionCode);
  }, [lotteryId, effectiveJurisdictionCode, addOnsSelected, addOnsInputs]);

  const independentCatalogItem = useMemo(() => {
    if (!independentCode) return null;
    return visibleAddOnItems.find((i) => i.add_on_code === independentCode) ?? null;
  }, [visibleAddOnItems, independentCode]);

  const showIndependentExtraBlock = lotteryId === 'lotto_max' || lotteryId === 'lotto_649';
  const showOtherAddOnBlocks = catalogOtherItems.length > 0;

  return (
    <View style={styles.screenWrap}>
      <View style={[styles.stickyHeader, { paddingTop: insets.top + SPACING.screenPadding }]}>
        <View style={styles.content}>
          <TouchableOpacity onPress={onBack} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={20} color={COLORS.textSecondary} />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Check Ticket</Text>
        </View>
      </View>
      <ScrollView
        ref={checkScrollRef}
        style={styles.container}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: SPACING.screenPadding,
            paddingBottom: SPACING.screenPaddingBottom + insets.bottom,
          },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={COLORS.primary}
          />
        }
      >

      <View style={styles.lotteryRow}>
        <Text style={styles.label}>Lottery</Text>
        <TouchableOpacity
          style={styles.prizeRulesBtn}
          onPress={() => setShowPrizeModal(true)}
        >
          <Ionicons name="information-circle-outline" size={18} color={COLORS.gold} style={styles.prizeRulesIcon} />
          <Text style={styles.prizeRulesText}>Prize Rules</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.dropdownWrap}>
        <TouchableOpacity
          style={styles.dropdown}
          onPress={() => setLotteryDropdownOpen(true)}
          activeOpacity={0.7}
        >
          <Text style={styles.dropdownText}>{LOTTERY_DEFS[lotteryId].name}</Text>
          <Ionicons name="chevron-down" size={20} color={COLORS.textSecondary} />
        </TouchableOpacity>
      </View>

      <Modal visible={showPrizeModal} transparent animationType="fade">
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowPrizeModal(false)}
        >
          <TouchableOpacity activeOpacity={1} onPress={(e) => e.stopPropagation()} style={styles.prizeModalContent}>
            <View style={styles.prizeModalHeader}>
              <Text style={styles.prizeModalTitle}>{PRIZE_EXPLANATIONS[lotteryId].title}</Text>
              <TouchableOpacity onPress={() => setShowPrizeModal(false)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                <Ionicons name="close" size={28} color={COLORS.textMuted} />
              </TouchableOpacity>
            </View>
            <Text style={styles.prizeModalIntro}>{PRIZE_EXPLANATIONS[lotteryId].intro}</Text>
            <ScrollView style={styles.prizeTiersScroll} showsVerticalScrollIndicator={false}>
              {PRIZE_EXPLANATIONS[lotteryId].tiers.map((t, i) => (
                <View key={i} style={styles.prizeTierRow}>
                  <Text style={styles.prizeTierMatch}>{t.match}</Text>
                  <Text style={styles.prizeTierPrize}>{t.prize}</Text>
                </View>
              ))}
            </ScrollView>
            <Text style={styles.prizeModalNote}>{PRIZE_EXPLANATIONS[lotteryId].note}</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
      <Modal visible={lotteryDropdownOpen} transparent animationType="fade">
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setLotteryDropdownOpen(false)}
        >
          <TouchableOpacity activeOpacity={1} onPress={(e) => e.stopPropagation()} style={styles.dropdownModal}>
            {LOTTERY_IDS.map((id, i) => (
              <TouchableOpacity
                key={id}
                style={[
                  styles.dropdownOption,
                  lotteryId === id && styles.dropdownOptionActive,
                  i === LOTTERY_IDS.length - 1 && styles.dropdownOptionLast,
                ]}
                onPress={() => {
                  setLotteryId(id);
                  onLotteryChange?.(id);
                  setLotteryDropdownOpen(false);
                }}
              >
                <Text style={styles.dropdownOptionText}>{LOTTERY_DEFS[id].name}</Text>
                {lotteryId === id && <Ionicons name="checkmark" size={20} color={COLORS.gold} />}
              </TouchableOpacity>
            ))}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal visible={ocrReading} transparent animationType="fade" statusBarTranslucent>
        <View style={styles.readingOverlay} pointerEvents="auto">
          <View style={styles.readingCard}>
            <ActivityIndicator size="large" color={COLORS.gold} />
            <Text style={styles.readingTitle}>Reading ticket…</Text>
          </View>
        </View>
      </Modal>

      {jurisdiction && (
        <Text style={styles.jurisdictionHint}>
          Your location (GPS/settings): {jurisdiction.regionName || jurisdiction.regionCode},{' '}
          {jurisdiction.country === 'CA' ? 'Canada' : 'USA'}
        </Text>
      )}

      <Text style={styles.label}>Draw date{lotteryId === 'powerball' ? ' (Mon/Wed/Sat)' : lotteryId === 'mega_millions' ? ' (Tue/Fri)' : ''} · Pull down to refresh</Text>
      {loading ? (
        <ActivityIndicator size="small" color="#6366f1" />
      ) : (
        <ScrollView ref={drawScrollRef} horizontal showsHorizontalScrollIndicator={false} style={styles.drawScroll}>
          {drawsList.map((d) => (
            <TouchableOpacity
              key={d.draw_date}
              style={[
                styles.drawChip,
                selectedDraw?.draw_date === d.draw_date && styles.drawChipActive,
              ]}
              onPress={() => setSelectedDraw(d)}
            >
              <Text style={styles.drawChipText}>{d.draw_date}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Removed: "How to enter numbers" helper title */}
      <View style={styles.entryRow}>
        {Platform.OS !== 'web' ? (
          <TouchableOpacity style={styles.entryBtn} onPress={() => scanDocument()}>
            <Ionicons name="scan" size={22} color={COLORS.gold} style={styles.entryBtnIcon} />
            <Text style={styles.entryBtnText}>Scan ticket</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={[styles.entryBtn, { flex: 1 }]} onPress={() => pickImage()}>
            <Ionicons name="image" size={22} color={COLORS.gold} style={styles.entryBtnIcon} />
            <Text style={styles.entryBtnText}>Upload photo</Text>
          </TouchableOpacity>
        )}
      </View>
      {/* Removed: angled-photo hint (keep feature, hide text) */}
      {(lotteryId === 'powerball' || lotteryId === 'mega_millions') && (
        <Text style={styles.scanHint}>
          Powerball / Mega Millions: OCR can auto-detect up to {MAX_UI_LINES} lines. If your ticket has more than {MAX_UI_LINES} lines, tap “+”
          below to add lines and fill in the rest manually.
          {'\n'}OCR is assistive only. If anything looks wrong, please correct it manually.
        </Text>
      )}
      {(lotteryId === 'lotto_max' || lotteryId === 'lotto_649') && (
        <Text style={styles.scanHint}>
          Scan is assistive only. Please review your numbers and adjust manually if needed.
        </Text>
      )}

      <BannerAdPlaceholder testId="scan" userPlan={plan} />

      {imageUri && (
        <View style={styles.imagePreview}>
          <View style={styles.thumbnailWrap}>
            <Image source={{ uri: imageUri }} style={styles.thumbnail} resizeMode="contain" />
            <TouchableOpacity
              style={styles.removeImageBtn}
              onPress={() => {
                setImageUri(null);
                clearScannedReadings();
                setOcrDateDetected(false);
                setDateStatusMsg(null);
                setOcrRawText(null);
                setShowOcrLog(false);
                setDateConfirmModal(null);
              }}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Ionicons name="close-circle" size={32} color={COLORS.text} />
            </TouchableOpacity>
          </View>
          {dateStatusMsg ? (
            <Text style={[styles.imageHint, dateStatusMsg.includes('not') || dateStatusMsg.includes('No date') ? styles.dateHintWarn : undefined]}>
              {dateStatusMsg}
            </Text>
          ) : (
            <Text style={styles.imageHint}>
              {ocrDateDetected
                ? 'Draw date was auto-selected from ticket. Verify it matches your ticket.'
                : 'If numbers weren\'t detected, enter manually below. If draw date is wrong, select the correct date above.'}
            </Text>
          )}
          {SHOW_OCR_DEBUG_UI && Platform.OS !== 'web' && devPreprocessDebug && devPreprocessDebug.uris.length > 0 ? (
            <View style={styles.devPreBlock}>
              <Text style={styles.devPreLabel}>DEV: OCR preprocess variants (debug only)</Text>
              <Modal
                visible={!!devPreViewer}
                transparent
                animationType="fade"
                onRequestClose={() => setDevPreViewer(null)}
              >
                <View style={styles.devViewerOverlay}>
                  <View style={styles.devViewerCard}>
                    <View style={styles.devViewerHeader}>
                      <Text style={styles.devViewerTitle} numberOfLines={1}>
                        {devPreViewer?.label ?? 'preview'}
                      </Text>
                      <TouchableOpacity onPress={() => setDevPreViewer(null)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                        <Ionicons name="close" size={22} color={COLORS.textSecondary} />
                      </TouchableOpacity>
                    </View>
                    <View style={styles.devViewerImgWrap}>
                      <Image source={{ uri: devPreViewer?.uri }} style={styles.devViewerImg} resizeMode="contain" />
                    </View>
                    <Text selectable style={styles.devViewerUri} numberOfLines={2}>
                      {devPreViewer?.uri ?? ''}
                    </Text>
                    <View style={styles.devViewerActions}>
                      <TouchableOpacity
                        style={styles.devViewerBtn}
                        onPress={async () => {
                          if (!devPreViewer?.uri) return;
                          try {
                            await Share.share({ message: devPreViewer.uri, url: devPreViewer.uri });
                          } catch {
                            // ignore
                          }
                        }}
                      >
                        <Ionicons name="share-outline" size={18} color={COLORS.text} />
                        <Text style={styles.devViewerBtnText}>Share / Save</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.devViewerBtn, styles.devViewerBtnSecondary]} onPress={() => setDevPreViewer(null)}>
                        <Text style={styles.devViewerBtnText}>Close</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              </Modal>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator
                style={styles.devPreScroll}
                contentContainerStyle={styles.devPreScrollContent}
              >
                {devPreprocessDebug.uris.map((u, i) => (
                  <View key={`${u}-${i}`} style={styles.devPreItem}>
                    <TouchableOpacity
                      onPress={() =>
                        setDevPreViewer({
                          uri: u,
                          label: devPreprocessDebug.labels[i] ?? `v${i}`,
                        })
                      }
                      activeOpacity={0.85}
                    >
                      <Image source={{ uri: u }} style={styles.devPreThumb} resizeMode="contain" />
                    </TouchableOpacity>
                    <Text style={styles.devPreCap} numberOfLines={1}>
                      {devPreprocessDebug.labels[i] ?? `v${i}`}
                    </Text>
                  </View>
                ))}
              </ScrollView>
            </View>
          ) : null}
          {SHOW_OCR_DEBUG_UI && Platform.OS !== 'web' && ocrRawText ? (
            <View style={styles.devOcrRawBlock}>
              <TouchableOpacity
                onPress={() => setShowOcrLog((v) => !v)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.devPreLabel}>
                  DEV: OCR rawText (tap to expand/collapse; long-press to select & copy)
                  {ocrBestVariant?.label ? `\nvariant: ${ocrBestVariant.label}` : ''}
                  {ocrBestVariant?.uri ? `\nuri: ${ocrBestVariant.uri}` : ''}
                  {ocrAddOnsDebug != null ? `\naddOnsDetected: ${ocrAddOnsDebug}` : ''}
                </Text>
              </TouchableOpacity>
              {showOcrLog ? (
                <ScrollView style={styles.devOcrRawScroll} nestedScrollEnabled>
                  <Text selectable style={styles.devOcrRawText}>
                    {ocrRawText}
                  </Text>
                </ScrollView>
              ) : null}
            </View>
          ) : null}
        </View>
      )}

      <View
        onLayout={(e) => {
          numbersSectionYRef.current = e.nativeEvent.layout.y;
        }}
      >
        <Text style={styles.label}>
          {(lotteryId === 'powerball' || lotteryId === 'mega_millions') ? 'White balls ' : ''}{def.main_count} numbers ({def.main_min}-{def.main_max}, ascending, unique)
          {(uiLines ?? 1) > 1 ? ` · ${uiLines} lines` : ''}
          {(lotteryId === 'powerball' || lotteryId === 'mega_millions') &&
            ` · last box: ${lotteryId === 'powerball' ? 'Powerball' : 'Mega Ball'} (${def.special_min}–${def.special_max})`}
        </Text>
      </View>
      {ocrExtraLinesCount > 0 && (
        <Text style={styles.hint}>
          OCR detected {ocrExtraLinesCount} extra line(s) beyond the limit (truncated to {MAX_UI_LINES}). Tap “+” below to add lines and enter them
          manually.
        </Text>
      )}
      {Array.from({ length: uiLines }, (_, i) => i).map((lineIdx) => {
        const row = (allSets[lineIdx] ?? Array(def.main_count).fill(0)).slice(0, def.main_count);
        const values = row.map((n) => (n > 0 ? String(n) : ''));
        const paddedValues = values.length >= def.main_count ? values : [...values, ...Array(def.main_count - values.length).fill('')];
        const isPbMm = lotteryId === 'powerball' || lotteryId === 'mega_millions';
        const flexFillMainRow =
          isPbMm || lotteryId === 'lotto_max' || lotteryId === 'lotto_649';

        const mainBoxes = (
          <MainNumbersBoxes
            flexFill={flexFillMainRow}
            count={def.main_count}
            minVal={def.main_min}
            maxVal={def.main_max}
            values={paddedValues}
            onChange={(v) => {
              const padded = v.slice(0, def.main_count).map((s) => {
                const digits = s.replace(/\D/g, '');
                if (digits === '') return 0;
                const n = parseInt(digits, 10);
                return !isNaN(n) && n >= def.main_min && n <= def.main_max ? n : 0;
              });
              const result = [...padded, ...Array(Math.max(0, def.main_count - padded.length)).fill(0)].slice(0, def.main_count) as number[];
              setAllSets((prev) => {
                const plays = uiLines;
                const next =
                  prev.length >= plays
                    ? [...prev]
                    : [...prev, ...Array(plays - prev.length).fill(null).map(() => Array(def.main_count).fill(0))];
                const copy = next.map((s) => [...s]);
                copy[lineIdx] = result;
                return copy;
              });
            }}
            placeholder=""
          />
        );

        return (
          <View key={lineIdx} style={styles.lineBlock}>
            {(def?.plays_per_ticket ?? 1) > 1 && (
              <Text style={styles.lineLabel}>Line {lineIdx + 1}</Text>
            )}
            {isPbMm ? (
              <View style={styles.pbMmMainSpecialRow}>
                <View style={styles.pbMmMainFlex}>{mainBoxes}</View>
                <View style={styles.pbMmSpecialFlex}>
                  <TextInput
                    style={[
                      styles.specialBallBox,
                      lotteryId === 'powerball' ? styles.specialBallPowerball : styles.specialBallMegaBall,
                    ]}
                    value={specialByLine[lineIdx] ?? ''}
                    onChangeText={(t) => {
                      const digits = t.replace(/\D/g, '').slice(0, String(def.special_max).length);
                      setSpecialByLine((prev) => {
                        const plays = uiLines;
                        const next = [...prev];
                        while (next.length < plays) next.push('');
                        next[lineIdx] = digits;
                        return next;
                      });
                    }}
                    placeholder=""
                    placeholderTextColor={COLORS.textSecondary}
                    keyboardType="number-pad"
                    maxLength={String(def.special_max).length}
                  />
                </View>
              </View>
            ) : (
              mainBoxes
            )}
          </View>
        );
      })}
      {(lotteryId === 'powerball' || lotteryId === 'mega_millions') && uiLines < MAX_UI_LINES && (
        <TouchableOpacity
          style={styles.addLineBtn}
          onPress={() => {
            setUiLines((prev) => {
              const nextLines = Math.min(MAX_UI_LINES, prev + 1);
              if (nextLines === prev) return prev;
              const cnt = def.main_count;
              setAllSets((cur) => {
                const next = [...cur];
                while (next.length < nextLines) next.push(Array(cnt).fill(0));
                return next;
              });
              setSpecialByLine((cur) => {
                const next = [...cur];
                while (next.length < nextLines) next.push('');
                return next;
              });
              return nextLines;
            });
          }}
        >
          <Ionicons name="add" size={18} color={COLORS.gold} />
          <Text style={styles.addLineText}>Add a line</Text>
        </TouchableOpacity>
      )}

      {def.special_count > 0 && !['lotto_max', 'lotto_649'].includes(lotteryId) && (
        <>
          {lotteryId !== 'powerball' && lotteryId !== 'mega_millions' ? (
            <>
              <Text style={styles.label}>{`Special number (1 number, ${def.special_min}-${def.special_max})`}</Text>
              <TextInput
                style={styles.input}
                value={specialInput}
                onChangeText={setSpecialInput}
                placeholder={`1 number, ${def.special_min}-${def.special_max}`}
                placeholderTextColor={COLORS.textSecondary}
                keyboardType="number-pad"
              />
            </>
          ) : null}
        </>
      )}

      {(showIndependentExtraBlock || showOtherAddOnBlocks) && (
        <View style={styles.addOnSection}>
          {showIndependentExtraBlock ? (
            <>
              <Text style={styles.label}>Extra (optional)</Text>
              {(() => {
                const code: IndependentAddOnCode = independentCode ?? 'EXTRA';
                const schFromCatalog = independentCatalogItem?.input_schema_json ?? null;
                const sch = {
                  ...schemaForOrphanIndependentAddOn(code, effectiveJurisdictionCode),
                  ...(schFromCatalog ?? {}),
                };
                const rawValDigits = String(addOnsInputs[code] ?? '').replace(/\D/g, '');
                const sep = typeof sch.groupSeparator === 'string' ? sch.groupSeparator : '-';
                const baseDigits = typeof sch.digits === 'number' ? sch.digits : 7;
                // If OCR already detected an 8-digit EXTRA (BC-style four pairs), honor it even when jurisdiction is NATIONAL.
                const digits =
                  code === 'EXTRA' && rawValDigits.length >= 8 ? 8 : baseDigits;
                const inferredGroups =
                  code === 'EXTRA' && digits === 8 ? ([2, 2, 2, 2] as number[]) : undefined;
                const groups = Array.isArray(sch.displayGroups) ? sch.displayGroups : inferredGroups;
                const rawMaxDigits = groups?.length
                  ? groups.reduce((a, b) => a + Math.max(1, Number(b) || 0), 0)
                  : digits;
                const displayMaxLen = groups?.length ? rawMaxDigits + groups.length - 1 : rawMaxDigits;
                const rawVal = String(addOnsInputs[code] ?? '');
                const checked = !!addOnsSelected[code] || rawVal.replace(/\D/g, '').length > 0;
                const showGroupedExtra = code === 'EXTRA' && !!groups?.length;
                const displayVal = showGroupedExtra ? formatGroupedNumber(rawVal, groups!, sep) : rawVal;
                return (
                  <View key={`independent-${code}`} style={styles.addOnBlock}>
                    <TouchableOpacity
                      style={[styles.addOnRow, checked && styles.addOnRowActive]}
                      onPress={() => setAddOnsSelected((s) => ({ ...s, [code]: !s[code] }))}
                    >
                      <Ionicons name={checked ? 'checkbox' : 'square-outline'} size={22} color={COLORS.gold} />
                      <Text style={styles.addOnLabel}>{EXTRA_ADDON_UI_LABEL}</Text>
                    </TouchableOpacity>
                    {checked && (
                      <TextInput
                        style={styles.addOnInput}
                        value={displayVal}
                        onChangeText={(t) =>
                          setAddOnsInputs((s) => ({
                            ...s,
                            [code]: t.replace(/\D/g, '').slice(0, rawMaxDigits),
                          }))
                        }
                        placeholder={
                          showGroupedExtra
                            ? groups!.map((g) => 'x'.repeat(Math.max(1, Number(g) || 1))).join(sep)
                            : `${rawMaxDigits} digits`
                        }
                        placeholderTextColor={COLORS.textMuted}
                        keyboardType="number-pad"
                        maxLength={displayMaxLen}
                      />
                    )}
                  </View>
                );
              })()}
            </>
          ) : null}
          {showOtherAddOnBlocks ? (
            <>
              <Text style={styles.label}>
                {showIndependentExtraBlock ? 'Other add-ons' : 'Add-ons (optional)'}
              </Text>
              {catalogOtherItems.map((item) => {
                if (item.add_on_code === 'MAXMILLIONS') {
                  return (
                    <View key={item.add_on_code} style={styles.addOnBlock}>
                      <Text style={styles.addOnLabel}>Maxmillions (7 digits each, comma separated)</Text>
                      <TextInput
                        style={styles.addOnInput}
                        value={(addOnsInputs.MAXMILLIONS ?? []).join(', ')}
                        onChangeText={(t) =>
                          setAddOnsInputs((s) => ({
                            ...s,
                            MAXMILLIONS: t.split(/[\s,]+/).map((x) => x.replace(/\D/g, '').slice(0, 7)).filter(Boolean),
                          }))
                        }
                        placeholder="e.g. 1234567, 7654321"
                        placeholderTextColor={COLORS.textMuted}
                        keyboardType="number-pad"
                      />
                    </View>
                  );
                }
                return null;
              })}
            </>
          ) : null}
        </View>
      )}

      {drawsList.length === 0 && !loading && (
        <Text style={styles.hint}>No draws available. Ensure Supabase is configured and run the scraper.</Text>
      )}
      <TouchableOpacity
        style={[styles.checkBtn, (!selectedDraw || loading) && styles.checkBtnDisabled]}
        onPress={handleCheck}
        disabled={loading}
      >
        <Text style={styles.checkBtnText}>Check Results</Text>
      </TouchableOpacity>

      <BannerAdPlaceholder testId="check-bottom" userPlan={plan} />

      <Modal visible={!!dateConfirmModal} transparent animationType="fade">
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setDateConfirmModal(null)}
        >
          <TouchableOpacity activeOpacity={1} onPress={(e) => e.stopPropagation()} style={styles.modalContent}>
            <Text style={styles.modalTitle}>Select draw date</Text>
            <Text style={styles.modalHint}>OCR found multiple possible dates. Pick the one on your ticket{lotteryId === 'powerball' ? ' (Powerball draws Mon/Wed/Sat)' : lotteryId === 'mega_millions' ? ' (Mega Millions draws Tue/Fri)' : ''}:</Text>
            {(() => {
              const candidates = lotteryId === 'powerball'
                ? (dateConfirmModal?.candidates ?? []).filter((d) => isValidDrawDate(d, 'powerball'))
                : lotteryId === 'mega_millions'
                  ? (dateConfirmModal?.candidates ?? []).filter((d) => isValidDrawDate(d, 'mega_millions'))
                  : (dateConfirmModal?.candidates ?? []);
              return candidates.length > 0 ? (
                candidates.map((d) => (
                  <TouchableOpacity key={d} style={styles.modalOption} onPress={() => handleDateConfirm(d)}>
                    <Text style={styles.modalOptionText}>{d}</Text>
                  </TouchableOpacity>
                ))
              ) : (
                <Text style={styles.modalHint}>
                  {lotteryId === 'powerball'
                    ? 'No valid Powerball draw dates (Mon/Wed/Sat) in detected dates. Cancel and select manually.'
                    : lotteryId === 'mega_millions'
                      ? 'No valid Mega Millions draw dates (Tue/Fri) in detected dates. Cancel and select manually.'
                      : 'No valid dates in detected dates. Cancel and select manually.'}
                </Text>
              );
            })()}
            <TouchableOpacity style={styles.modalCancel} onPress={() => setDateConfirmModal(null)}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
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
    paddingBottom: 6,
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  backText: { color: COLORS.textSecondary, fontSize: 16, marginLeft: 6 },
  title: { fontSize: 24, fontWeight: '700', color: COLORS.text, marginBottom: 24 },
  label: { color: COLORS.textSecondary, fontSize: 12, marginBottom: 8 },
  lotteryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  prizeRulesBtn: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, paddingHorizontal: 8 },
  prizeRulesIcon: { marginRight: 4 },
  prizeRulesText: { color: COLORS.gold, fontSize: 14, fontWeight: '600' },
  prizeModalContent: {
    backgroundColor: COLORS.bgCard,
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxWidth: 360,
    maxHeight: '85%',
  },
  prizeModalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  prizeModalTitle: { fontSize: 18, fontWeight: '700', color: COLORS.text },
  prizeModalIntro: { color: COLORS.textSecondary, fontSize: 14, lineHeight: 22, marginBottom: 16 },
  prizeTiersScroll: { maxHeight: 320, marginBottom: 12 },
  prizeTierRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: COLORS.bgElevated,
    borderRadius: 8,
    marginBottom: 6,
  },
  prizeTierMatch: { color: COLORS.text, fontSize: 14 },
  prizeTierPrize: { color: COLORS.gold, fontSize: 14, fontWeight: '600' },
  prizeModalNote: { color: COLORS.textMuted, fontSize: 12, lineHeight: 18 },
  dropdownWrap: { marginBottom: 20 },
  dropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.bgCard,
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: COLORS.bgElevated,
  },
  dropdownText: { color: COLORS.text, fontSize: 16, fontWeight: '600' },
  dropdownModal: {
    backgroundColor: COLORS.bgCard,
    borderRadius: 12,
    width: '100%',
    maxWidth: 320,
    overflow: 'hidden',
  },
  dropdownOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.bgElevated,
  },
  dropdownOptionActive: { backgroundColor: COLORS.bgElevated },
  dropdownOptionLast: { borderBottomWidth: 0 },
  dropdownOptionText: { color: COLORS.text, fontSize: 16 },
  jurisdictionHint: { color: COLORS.textMuted, fontSize: 12, marginBottom: 12 },
  pbMmMainSpecialRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    flexWrap: 'nowrap',
    width: '100%',
    gap: 4,
  },
  /** 5/6 width → five main cells each 1/6 of row (matches special cell) */
  pbMmMainFlex: { flex: 5, minWidth: 0 },
  pbMmSpecialFlex: { flex: 1, minWidth: 0, justifyContent: 'center' },
  specialBallBox: {
    width: '100%',
    height: 44,
    borderRadius: 10,
    backgroundColor: '#152238',
    borderWidth: 1,
    borderColor: '#1e3254',
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    padding: 0,
  },
  specialBallPowerball: { borderColor: '#dc2626' },
  specialBallMegaBall: { borderColor: COLORS.gold },
  addOnSection: { marginBottom: 20 },
  addOnRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 10 },
  addOnRowActive: {},
  addOnLabel: { color: COLORS.text, fontSize: 14 },
  addOnBlock: { marginBottom: 12 },
  addOnInput: { backgroundColor: COLORS.bgCard, borderRadius: 8, padding: 12, color: COLORS.text, fontSize: 16, marginTop: 4 },
  lineBlock: { marginBottom: 16 },
  lineLabel: { color: COLORS.textMuted, fontSize: 13, marginBottom: 6 },
  pickerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  pill: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: COLORS.bgCard,
  },
  pillActive: { backgroundColor: COLORS.primary },
  pillText: { color: COLORS.text, fontSize: 14 },
  drawScroll: { marginBottom: 20, maxHeight: 44 },
  drawChip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: COLORS.bgCard,
    marginRight: 8,
    minWidth: 105,
  },
  drawChipActive: { backgroundColor: COLORS.primary },
  drawChipText: { color: COLORS.text, fontSize: 14 },
  input: {
    backgroundColor: COLORS.bgCard,
    borderRadius: 10,
    padding: 14,
    color: COLORS.text,
    fontSize: 16,
    marginBottom: 20,
  },
  checkBtn: {
    backgroundColor: COLORS.primary,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  checkBtnDisabled: { opacity: 0.5 },
  checkBtnText: { color: COLORS.text, fontWeight: '700', fontSize: 16 },
  entryRow: { flexDirection: 'row', gap: 12, marginBottom: 20 },
  entryBtn: {
    flex: 1,
    padding: 14,
    borderRadius: 10,
    backgroundColor: COLORS.bgCard,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  entryBtnIcon: { marginRight: 8 },
  entryBtnText: { color: COLORS.text, fontSize: 15 },
  imagePreview: { marginBottom: 20 },
  thumbnailWrap: { position: 'relative' },
  thumbnail: { width: '100%', height: 180, borderRadius: 10, backgroundColor: COLORS.bgCard },
  removeImageBtn: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 16,
  },
  imageHint: { color: COLORS.textMuted, fontSize: 12, marginTop: 8 },
  dateHintWarn: { color: COLORS.warning },
  /** __DEV__ — remove when OCR preprocess debugging is done */
  devPreBlock: { marginTop: 12, padding: 10, borderRadius: 8, backgroundColor: '#1a1520', borderWidth: 1, borderColor: '#7c3aed' },
  devPreLabel: { color: '#c4b5fd', fontSize: 11, marginBottom: 8 },
  devPreScroll: { maxHeight: 120 },
  devPreScrollContent: { flexDirection: 'row', alignItems: 'flex-start', paddingBottom: 4, paddingRight: 8 },
  devPreItem: { width: 88, alignItems: 'center', marginRight: 10 },
  devPreThumb: { width: 88, height: 72, borderRadius: 6, backgroundColor: COLORS.bgElevated },
  devPreCap: { color: COLORS.textMuted, fontSize: 9, marginTop: 4, width: '100%', textAlign: 'center' },
  devViewerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 14,
  },
  devViewerCard: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 14,
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.bgElevated,
    padding: 12,
  },
  devViewerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  devViewerTitle: { color: COLORS.text, fontSize: 14, fontWeight: '700', flex: 1, marginRight: 10 },
  devViewerImgWrap: { width: '100%', height: 420, borderRadius: 10, overflow: 'hidden', backgroundColor: COLORS.bgElevated },
  devViewerImg: { width: '100%', height: '100%' },
  devViewerUri: { marginTop: 10, color: COLORS.textMuted, fontSize: 10 },
  devViewerActions: { flexDirection: 'row', gap: 10, marginTop: 12, justifyContent: 'flex-end', alignItems: 'center' },
  devViewerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: COLORS.primary,
  },
  devViewerBtnSecondary: { backgroundColor: COLORS.bgElevated },
  devViewerBtnText: { color: COLORS.text, fontSize: 13, fontWeight: '700' },
  devOcrRawBlock: {
    marginTop: 12,
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#0f1729',
    borderWidth: 1,
    borderColor: '#38bdf8',
  },
  devOcrRawScroll: { maxHeight: 220, marginTop: 6 },
  devOcrRawText: { color: COLORS.textSecondary, fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  scanHint: { color: COLORS.textMuted, fontSize: 11, marginTop: 4, marginBottom: 8 },
  hint: { color: COLORS.textSecondary, fontSize: 12, marginBottom: 12 },
  addLineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.bgElevated,
    marginBottom: 18,
  },
  addLineText: { color: COLORS.text, fontSize: 14, fontWeight: '600' },
  readingOverlay: {
    flex: 1,
    backgroundColor: 'rgba(5,8,15,0.72)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  readingCard: {
    backgroundColor: COLORS.bgCard,
    borderRadius: 16,
    paddingVertical: 28,
    paddingHorizontal: 32,
    alignItems: 'center',
    minWidth: 260,
    borderWidth: 1,
    borderColor: '#1e3254',
  },
  readingTitle: { marginTop: 18, color: COLORS.text, fontSize: 17, fontWeight: '700' },
  readingSubtitle: { marginTop: 6, color: COLORS.textMuted, fontSize: 13, textAlign: 'center' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContent: {
    backgroundColor: COLORS.bgCard,
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 340,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: COLORS.text, marginBottom: 8 },
  modalHint: { color: COLORS.textSecondary, fontSize: 14, marginBottom: 16 },
  modalOption: {
    backgroundColor: COLORS.bgElevated,
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
  },
  modalOptionText: { color: COLORS.text, fontSize: 16 },
  modalCancel: { marginTop: 8, marginBottom: 4 },
  modalCancelText: { color: COLORS.textMuted, fontSize: 14 },
});
