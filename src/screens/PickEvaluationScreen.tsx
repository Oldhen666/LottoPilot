import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  Platform,
} from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, SPACING } from '../constants/theme';
import { LOTTERY_DEFS } from '../constants/lotteries';
import { getCompassPayload } from '../compass/compassCache';
import type { CompassPayload } from '../compass/types';
import type { LotteryId } from '../types/lottery';
import { computeEvaluatePickBreakdown } from '../compass/pickInsightStars';
import { buildTrendReferenceDisplayByNumber } from '../compass/trendScoreDisplay';
import { InsightStarRow } from '../components/InsightStarRow';
import { BannerAdPlaceholder } from '../components/BannerAdPlaceholder';
import { getEntitlements, type UserPlan } from '../services/entitlements';

export type PickEvaluationRouteParams = {
  lotteryId: LotteryId;
  picks: number[];
  specialPick: number | null;
};

type RootStackPickEval = {
  PickEvaluation: PickEvaluationRouteParams;
};

export default function PickEvaluationScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootStackPickEval, 'PickEvaluation'>>();
  const { lotteryId, picks, specialPick } = route.params;

  const [payload, setPayload] = useState<CompassPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<UserPlan>('free');
  const [trendPositionModalVisible, setTrendPositionModalVisible] = useState(false);
  const [refPosTab, setRefPosTab] = useState(1);

  const def = LOTTERY_DEFS[lotteryId];
  const mainPickCount = def?.main_count ?? 7;
  const mainMin = def?.main_min ?? 1;
  const mainMax = def?.main_max ?? 49;
  const specialMin = def?.special_min ?? 1;
  const specialMax = def?.special_max ?? 0;
  const showSpecial = lotteryId === 'powerball' || lotteryId === 'mega_millions';

  useEffect(() => {
    getEntitlements().then((e) => setPlan(e.plan));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getCompassPayload(lotteryId)
      .then((r) => {
        if (!cancelled) setPayload(r.payload);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [lotteryId]);

  const breakdown = useMemo(() => {
    if (!payload) return null;
    return computeEvaluatePickBreakdown(
      picks,
      specialPick,
      payload,
      mainMin,
      mainMax,
      specialMin,
      specialMax,
      showSpecial,
      lotteryId === 'powerball' ? 'Powerball' : 'Mega Ball'
    );
  }, [payload, picks, specialPick, mainMin, mainMax, specialMin, specialMax, showSpecial, lotteryId]);

  const overallStyle = useMemo(() => {
    const s = breakdown?.total100 ?? 0;
    if (s <= 40) return { color: COLORS.error, fontSize: 22 as const };
    if (s < 60) return { color: COLORS.warning, fontSize: 22 as const };
    if (s < 80) return { color: COLORS.success, fontSize: 22 as const };
    return { color: COLORS.success, fontSize: 23 as const };
  }, [breakdown?.total100]);

  const trendReferenceDisplayByNumber = useMemo(
    () => (payload ? buildTrendReferenceDisplayByNumber(payload.trendScores) : new Map<number, number>()),
    [payload]
  );

  const sortedTrendReference = useMemo(() => {
    if (!payload) return [];
    return [...payload.trendScores].sort((a, b) => b.trendScore - a.trendScore).slice(0, 45);
  }, [payload]);

  const refPositionRow = useMemo(() => {
    if (!payload) return null;
    return payload.positionTopK.find((p) => p.position === refPosTab) ?? null;
  }, [payload, refPosTab]);

  /** Next applicable main slot for this lottery (1-based), aligned with Compass pick flow. */
  const applicablePositionDefault = useMemo(() => {
    if (mainPickCount <= 0) return 1;
    if (picks.length === 0) return 1;
    if (picks.length >= mainPickCount) return mainPickCount;
    return picks.length + 1;
  }, [picks.length, mainPickCount]);

  useEffect(() => {
    if (!trendPositionModalVisible) return;
    setRefPosTab(Math.min(Math.max(applicablePositionDefault, 1), mainPickCount));
  }, [trendPositionModalVisible, applicablePositionDefault, mainPickCount]);

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={28} color={COLORS.gold} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          Pick Evaluation
        </Text>
        <View style={styles.headerRight} />
      </View>

      {loading ? (
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color={COLORS.gold} />
          <Text style={styles.loadingText}>Loading Compass data…</Text>
        </View>
      ) : !payload || !breakdown ? (
        <View style={styles.centerBox}>
          <Text style={styles.warnText}>No Compass data available for this lottery.</Text>
        </View>
      ) : (
        <>
          <View style={styles.overallDock}>
            <View style={styles.overallRow}>
              <Text style={[styles.scoreHeaderLabel, { fontSize: 23, color: overallStyle.color }]}>Overall</Text>
              <Text style={[styles.scoreHeaderValue, { color: overallStyle.color, fontSize: overallStyle.fontSize }]}>
                {breakdown.total100}/100
              </Text>
            </View>
            <TouchableOpacity
              style={styles.viewTpBtn}
              onPress={() => setTrendPositionModalVisible(true)}
              activeOpacity={0.8}
            >
              <Ionicons name="stats-chart-outline" size={18} color={COLORS.gold} />
              <Text style={styles.viewTpBtnText}>View trend & position score</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.aiImproveBtn}
              onPress={() =>
                (navigation as { navigate: (name: string, params?: Record<string, unknown>) => void }).navigate('MainTabs', {
                  screen: 'StrategyLab',
                })
              }
              activeOpacity={0.85}
            >
              <Ionicons name="sparkles" size={18} color={COLORS.bg} />
              <Text style={styles.aiImproveBtnText}>Improve pick with AI Strategy Lab</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {breakdown.mainRows.map((row, idx) => (
              <View
                key={`${row.positionSlot}-${row.n}`}
                style={[
                  styles.section,
                  idx === breakdown.mainRows.length - 1 && !breakdown.special && styles.sectionLast,
                ]}
              >
                <Text style={styles.ballTitle}>
                  Main ({row.positionSlot + 1}) — {row.n}
                </Text>
                <Text style={styles.tpScores}>
                  Trend {row.trend100}/100 · Position {row.position100}/100
                </Text>
                <InsightStarRow label="Trend" stars={row.trendStars} />
                <InsightStarRow label="Position" stars={row.positionStars} />
              </View>
            ))}

            {breakdown.special && (
              <View style={[styles.section, styles.sectionLast]}>
                <Text style={styles.ballTitle}>
                  {breakdown.special.label} — {breakdown.special.n}
                </Text>
                <Text style={styles.tpScores}>
                  Trend {breakdown.special.trend100}/100 · Position {breakdown.special.position100}/100
                </Text>
                <InsightStarRow label="Trend" stars={breakdown.special.trendStars} />
                <InsightStarRow label="Position" stars={breakdown.special.positionStars} />
              </View>
            )}
          </ScrollView>

          <Modal visible={trendPositionModalVisible} transparent animationType="fade">
            <TouchableOpacity
              style={styles.modalOverlay}
              activeOpacity={1}
              onPress={() => setTrendPositionModalVisible(false)}
            >
              <TouchableOpacity activeOpacity={1} onPress={(e) => e.stopPropagation()} style={styles.tpModalCard}>
                <Text style={styles.tpModalTitle}>Compass trend & position</Text>
                <ScrollView
                  style={styles.tpModalScroll}
                  contentContainerStyle={styles.tpModalScrollContent}
                  showsVerticalScrollIndicator
                  nestedScrollEnabled
                >
                  <Text style={styles.refSectionTitle}>Trend (all main numbers)</Text>
                  <View style={styles.trendScrollOuter}>
                    <ScrollView
                      nestedScrollEnabled
                      style={styles.trendScrollInner}
                      contentContainerStyle={styles.trendScrollContent}
                      showsVerticalScrollIndicator
                      persistentScrollbar={Platform.OS === 'android'}
                      indicatorStyle="default"
                    >
                      {sortedTrendReference.map((t) => (
                        <View key={t.number} style={styles.refTrendRow}>
                          <Text style={styles.refTrendNum}>{t.number}</Text>
                          <Text style={styles.refTrendMeta}>
                            {trendReferenceDisplayByNumber.get(t.number) ?? 52} · {t.level}
                          </Text>
                        </View>
                      ))}
                    </ScrollView>
                  </View>

                  <Text style={[styles.refSectionTitle, styles.refSectionTitleSpaced]}>By sorted position</Text>
                  <View style={styles.refPosChipsRow}>
                    {Array.from({ length: mainPickCount }, (_, i) => i + 1).map((p) => (
                      <TouchableOpacity
                        key={p}
                        style={[styles.refPosChipFlex, refPosTab === p && styles.refPosChipActive]}
                        onPress={() => setRefPosTab(p)}
                      >
                        <Text
                          style={[styles.refPosChipText, refPosTab === p && styles.refPosChipTextActive]}
                          numberOfLines={1}
                          adjustsFontSizeToFit
                          minimumFontScale={0.75}
                        >
                          {p}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  {refPositionRow ? (
                    <View style={styles.refPosDetailBlock}>
                      <View style={styles.refPosDetailRow}>
                        <Text style={styles.refPosDetailLabel}>Slot</Text>
                        <Text style={styles.refPosDetailValue}>{refPosTab}</Text>
                      </View>
                      <View style={styles.refPosDetailRow}>
                        <Text style={styles.refPosDetailLabel}>Most frequent</Text>
                        <Text style={styles.refPosDetailValue}>{refPositionRow.topNumber}</Text>
                      </View>
                      <Text style={styles.refTopKHeading}>Top counts</Text>
                      <View style={styles.refTopKRow}>
                        {refPositionRow.topKList.map(({ number, count }) => (
                          <View key={number} style={styles.refTopKItemFlex}>
                            <Text style={styles.refTopKNum} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
                              {number}
                            </Text>
                            <Text style={styles.refTopKCount} numberOfLines={1}>
                              {count}
                            </Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  ) : (
                    <Text style={styles.refEmpty}>No position data for this slot.</Text>
                  )}
                </ScrollView>
                <View style={styles.tpModalFooter}>
                  <BannerAdPlaceholder
                    testId="pick-evaluation-tp-modal"
                    userPlan={plan}
                    containerStyle={styles.tpModalBanner}
                  />
                  <TouchableOpacity
                    style={styles.tpModalClose}
                    onPress={() => setTrendPositionModalVisible(false)}
                  >
                    <Text style={styles.tpModalCloseText}>Close</Text>
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
            </TouchableOpacity>
          </Modal>

          <View style={[styles.bannerDock, { paddingBottom: Math.max(insets.bottom, 8) }]}>
            <BannerAdPlaceholder testId="pick-evaluation-bottom" userPlan={plan} containerStyle={styles.bannerAd} />
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.screenPadding,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.bgElevated,
  },
  backBtn: { width: 44, marginLeft: -8 },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
  },
  headerRight: { width: 44 },
  overallDock: {
    paddingHorizontal: SPACING.screenPadding,
    paddingVertical: 16,
    backgroundColor: COLORS.bgElevated,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.gray700,
  },
  overallRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 34,
  },
  viewTpBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.gold,
  },
  viewTpBtnText: { color: COLORS.gold, fontSize: 14, fontWeight: '600' },
  aiImproveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: COLORS.gold,
    borderWidth: 1,
    borderColor: COLORS.gold,
  },
  aiImproveBtnText: { color: COLORS.bg, fontSize: 14, fontWeight: '700' },
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: SPACING.screenPadding,
    paddingTop: 12,
    paddingBottom: 16,
  },
  scoreHeaderLabel: { color: COLORS.textSecondary, fontSize: 23, fontWeight: '700' },
  scoreHeaderValue: { color: COLORS.gold, fontSize: 22, fontWeight: '800' },
  bannerDock: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.bgElevated,
    backgroundColor: COLORS.bg,
    paddingTop: 8,
    paddingHorizontal: SPACING.screenPadding,
    alignItems: 'center',
  },
  bannerAd: { marginVertical: 0, marginBottom: 0 },
  section: {
    marginBottom: 14,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.gray700,
  },
  sectionLast: {
    marginBottom: 0,
    paddingBottom: 0,
    borderBottomWidth: 0,
  },
  ballTitle: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 8,
  },
  tpScores: {
    color: COLORS.textSecondary,
    fontSize: 13,
    marginBottom: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  tpModalCard: {
    backgroundColor: COLORS.bgCard,
    borderRadius: 12,
    padding: 18,
    width: '100%',
    maxWidth: 400,
    maxHeight: '80%',
  },
  tpModalTitle: {
    color: COLORS.text,
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 12,
    textAlign: 'center',
  },
  tpModalScroll: { maxHeight: 380 },
  tpModalScrollContent: { paddingBottom: 4 },
  tpModalFooter: {
    marginTop: 4,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.gray700,
  },
  tpModalBanner: { marginBottom: 10, marginTop: 0 },
  tpModalClose: {
    alignSelf: 'center',
    paddingVertical: 10,
    paddingHorizontal: 24,
  },
  refSectionTitle: {
    color: COLORS.gold,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
  },
  refSectionTitleSpaced: { marginTop: 18 },
  trendScrollOuter: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderWidth: 1,
    borderColor: COLORS.gray700,
    borderRadius: 10,
    overflow: 'hidden',
    marginBottom: 4,
  },
  /** ~6.5 rows × ~40px */
  trendScrollInner: {
    flex: 1,
    maxHeight: 260,
  },
  trendScrollContent: { paddingBottom: 4 },
  refTrendRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 10,
    minHeight: 40,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.gray700,
  },
  refTrendNum: { color: COLORS.text, fontSize: 15, fontWeight: '700' },
  refTrendMeta: { color: COLORS.textSecondary, fontSize: 13 },
  refPosChipsRow: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    alignItems: 'stretch',
    marginBottom: 12,
    gap: 6,
  },
  refPosChipFlex: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: 10,
    backgroundColor: COLORS.bgElevated,
    borderWidth: 1,
    borderColor: COLORS.gray700,
    alignItems: 'center',
    justifyContent: 'center',
  },
  refPosChipActive: {
    backgroundColor: 'rgba(212, 175, 55, 0.2)',
    borderColor: COLORS.gold,
  },
  refPosChipText: { color: COLORS.textSecondary, fontSize: 14, fontWeight: '600', textAlign: 'center' },
  refPosChipTextActive: { color: COLORS.gold },
  refPosDetailBlock: {
    backgroundColor: COLORS.bgElevated,
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.gray700,
  },
  refPosDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.gray700,
  },
  refPosDetailLabel: { color: COLORS.textMuted, fontSize: 13, fontWeight: '600' },
  refPosDetailValue: { color: COLORS.text, fontSize: 16, fontWeight: '700' },
  refTopKHeading: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 10,
    marginBottom: 8,
  },
  refTopKRow: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    alignItems: 'stretch',
    gap: 6,
  },
  refTopKItemFlex: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: 10,
    backgroundColor: COLORS.bg,
    borderWidth: 1,
    borderColor: COLORS.gray700,
    alignItems: 'center',
    justifyContent: 'center',
  },
  refTopKNum: { color: COLORS.text, fontWeight: '700', fontSize: 15 },
  refTopKCount: { color: COLORS.textMuted, fontSize: 11, marginTop: 2 },
  refEmpty: { color: COLORS.textMuted, fontSize: 13, fontStyle: 'italic', marginTop: 8 },
  tpModalCloseText: { color: COLORS.gold, fontSize: 16, fontWeight: '600' },
  centerBox: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  loadingText: { color: COLORS.textMuted, marginTop: 12, fontSize: 14 },
  warnText: { color: COLORS.warning, textAlign: 'center', fontSize: 15 },
});
