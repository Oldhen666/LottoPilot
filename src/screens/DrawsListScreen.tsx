import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  TouchableOpacity,
  BackHandler,
  Platform,
  Modal,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Calendar } from 'react-native-calendars';
import { COLORS, SPACING } from '../constants/theme';
import { useDraws, invalidateDrawsCache } from '../hooks/useDraws';
import { BannerAdPlaceholder } from '../components/BannerAdPlaceholder';
import { getEntitlements, onEntitlementsChange, type UserPlan } from '../services/entitlements';
import { LOTTERY_DEFS } from '../constants/lotteries';
import type { LotteryId } from '../types/lottery';

interface Props {
  lotteryId: LotteryId;
  onBack: () => void;
}

export default function DrawsListScreen({ lotteryId, onBack }: Props) {
  const insets = useSafeAreaInsets();
  const [userPlan, setUserPlan] = useState<UserPlan>('free');
  const [refetchTrigger, setRefetchTrigger] = useState(0);
  const listRef = useRef<FlatList<any> | null>(null);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [datePickerIso, setDatePickerIso] = useState<string | null>(null);
  const onRefresh = useCallback(() => {
    invalidateDrawsCache(lotteryId);
    setRefetchTrigger((n) => n + 1);
  }, [lotteryId]);

  useEffect(() => {
    getEntitlements().then((e) => setUserPlan(e.plan));
    return onEntitlementsChange(() => {
      getEntitlements().then((ent) => setUserPlan(ent.plan));
    });
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => sub.remove();
  }, [onBack]);
  const { draws, loading, error } = useDraws(lotteryId, refetchTrigger);
  const def = LOTTERY_DEFS[lotteryId];

  const drawDateToIndex = useMemo(() => {
    const m = new Map<string, number>();
    draws.forEach((d, idx) => m.set(d.draw_date, idx));
    return m;
  }, [draws]);

  const jumpToDate = useCallback(
    (iso: string) => {
      const idx = drawDateToIndex.get(iso);
      if (idx == null) {
        Alert.alert('Draw not found', `${iso} is not in the list. Pull down or tap Refresh to sync more draws.`);
        return;
      }
      try {
        listRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.15 });
      } catch {
        // ignore
      }
    },
    [drawDateToIndex]
  );

  const markedDates = useMemo(() => {
    const obj: Record<string, { marked?: boolean; dotColor?: string; selected?: boolean; selectedColor?: string }> = {};
    for (const d of draws) {
      obj[d.draw_date] = { marked: true, dotColor: COLORS.gold };
    }
    if (datePickerIso) {
      obj[datePickerIso] = { ...(obj[datePickerIso] ?? {}), selected: true, selectedColor: COLORS.primary };
    }
    return obj;
  }, [draws, datePickerIso]);

  return (
    <View style={[styles.outer, { paddingTop: insets.top + SPACING.screenPadding }]}>
      <View style={[styles.container, { paddingHorizontal: SPACING.screenPadding, flex: 1 }]}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={20} color={COLORS.textSecondary} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{def?.name} - Past Draws</Text>

        {loading ? (
          <ActivityIndicator size="large" color={COLORS.primary} style={styles.loader} />
        ) : error ? (
          <View style={styles.errorBox}>
            <Text style={styles.error}>{error}</Text>
            <Text style={styles.errorHint}>Ensure EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY are in .env, then restart dev server.</Text>
            <TouchableOpacity style={styles.refreshBtn} onPress={onRefresh} disabled={loading}>
              <Ionicons name="refresh" size={18} color={COLORS.text} />
              <Text style={styles.refreshBtnText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : draws.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.empty}>No draws yet</Text>
            <Text style={styles.emptyHint}>Tap Refresh to sync from Supabase. If empty, run: npm run scrape</Text>
            <TouchableOpacity style={styles.refreshBtn} onPress={onRefresh} disabled={loading}>
              <Ionicons name="refresh" size={18} color={COLORS.text} />
              <Text style={styles.refreshBtnText}>Refresh from Supabase</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={styles.stickyToolbar}>
              <TouchableOpacity style={styles.refreshBtnSmall} onPress={onRefresh} disabled={loading}>
                <Ionicons name="refresh" size={16} color={COLORS.textSecondary} />
                <Text style={styles.refreshBtnSmallText}>Refresh</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.datePickBtn}
                onPress={() => {
                  // Default picker date to latest draw in list.
                  const first = draws[0]?.draw_date;
                  if (first) setDatePickerIso(first);
                  setDatePickerOpen(true);
                }}
                disabled={loading || draws.length === 0}
              >
                <Ionicons name="calendar-outline" size={16} color={COLORS.textSecondary} />
                <Text style={styles.refreshBtnSmallText}>Select by date</Text>
              </TouchableOpacity>
            </View>
            <FlatList
              ref={(r) => {
                listRef.current = r;
              }}
              data={draws}
              keyExtractor={(d) => d.draw_date}
              contentContainerStyle={styles.list}
              style={styles.listFlex}
              renderItem={({ item }) => (
                <View style={styles.card}>
                  <Text style={styles.drawDate}>{item.draw_date}</Text>
                  <View style={styles.numberRow}>
                    {item.winning_numbers.map((n, i) => (
                      <View key={i} style={styles.ball}>
                        <Text style={styles.ballText}>{n}</Text>
                      </View>
                    ))}
                    {item.special_numbers?.map((n, i) => (
                      <View key={`s${i}`} style={[styles.ball, styles.ballSpecial]}>
                        <Text style={styles.ballText}>{n}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}
            />
          </>
        )}
      </View>
      {datePickerOpen ? (
        <Modal visible transparent animationType="fade" onRequestClose={() => setDatePickerOpen(false)}>
          <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setDatePickerOpen(false)}>
            <TouchableOpacity activeOpacity={1} onPress={(e) => e.stopPropagation()} style={styles.datePickerCard}>
              <View style={styles.datePickerHeader}>
                <Text style={styles.datePickerTitle}>Select draw date</Text>
                <TouchableOpacity onPress={() => setDatePickerOpen(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Ionicons name="close" size={22} color={COLORS.textMuted} />
                </TouchableOpacity>
              </View>
              <Calendar
                current={datePickerIso ?? draws[0]?.draw_date}
                markedDates={markedDates}
                onDayPress={(day) => {
                  setDatePickerIso(day.dateString);
                  setDatePickerOpen(false);
                  jumpToDate(day.dateString);
                }}
                enableSwipeMonths
                theme={{
                  backgroundColor: COLORS.bgCard,
                  calendarBackground: COLORS.bgCard,
                  textSectionTitleColor: COLORS.textMuted,
                  dayTextColor: COLORS.text,
                  monthTextColor: COLORS.text,
                  arrowColor: COLORS.gold,
                  todayTextColor: COLORS.gold,
                  selectedDayTextColor: COLORS.text,
                  dotColor: COLORS.gold,
                  selectedDotColor: COLORS.text,
                }}
              />
              <View style={styles.datePickerAdWrap}>
                <BannerAdPlaceholder testId="draws-date-picker" userPlan={userPlan} containerStyle={styles.datePickerAdSlot} />
              </View>
              <TouchableOpacity style={styles.datePickerDone} onPress={() => setDatePickerOpen(false)}>
                <Text style={styles.datePickerDoneText}>Done</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>
      ) : null}
      <View style={[styles.bannerWrap, { paddingBottom: Math.max(insets.bottom, 8) }]}>
        <BannerAdPlaceholder
          testId="draws-history-bottom"
          userPlan={userPlan}
          containerStyle={styles.bannerAdSlot}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { flex: 1, backgroundColor: COLORS.bg },
  container: { backgroundColor: COLORS.bg },
  listFlex: { flex: 1 },
  bannerWrap: {
    width: '100%',
    paddingHorizontal: SPACING.screenPadding,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.bgElevated,
    backgroundColor: COLORS.bg,
  },
  /** Tight to tab bar: no extra vertical margin from BannerAdPlaceholder */
  bannerAdSlot: { marginVertical: 0 },
  backBtn: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  backText: { color: COLORS.textSecondary, fontSize: 16, marginLeft: 6 },
  title: { fontSize: 22, fontWeight: '700', color: COLORS.text, marginBottom: 20 },
  loader: { marginTop: 40 },
  errorBox: { marginTop: 20 },
  error: { color: COLORS.error },
  errorHint: { color: COLORS.textMuted, fontSize: 12, marginTop: 8 },
  emptyBox: { marginTop: 20, alignItems: 'center' },
  empty: { color: COLORS.textMuted },
  emptyHint: { color: COLORS.textMuted, fontSize: 12, marginTop: 8 },
  refreshBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: COLORS.primary,
    borderRadius: 10,
    gap: 8,
  },
  refreshBtnText: { color: COLORS.text, fontWeight: '600' },
  refreshBtnSmall: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    paddingVertical: 6,
    gap: 6,
  },
  refreshBtnSmallText: { color: COLORS.textSecondary, fontSize: 14 },
  stickyToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    paddingVertical: 6,
  },
  datePickBtn: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, gap: 6 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 18 },
  datePickerCard: { backgroundColor: COLORS.bgCard, borderRadius: 14, padding: 14 },
  datePickerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  datePickerTitle: { color: COLORS.text, fontSize: 16, fontWeight: '700', marginBottom: 10 },
  datePickerAdWrap: { marginTop: 10 },
  datePickerAdSlot: { marginVertical: 0 },
  datePickerDone: { marginTop: 10, backgroundColor: COLORS.primary, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  datePickerDoneText: { color: COLORS.text, fontWeight: '700' },
  list: { paddingBottom: 40 },
  card: {
    backgroundColor: COLORS.bgCard,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.gold,
  },
  drawDate: { color: COLORS.text, fontSize: 16, fontWeight: '600', marginBottom: 12 },
  numberRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  ball: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ballSpecial: { backgroundColor: COLORS.success },
  ballText: { color: COLORS.text, fontWeight: '700', fontSize: 14 },
});
