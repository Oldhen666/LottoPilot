import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Modal,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLatestDraw, invalidateDrawsCache } from '../hooks/useDraws';
import { onAppActiveRefetch } from '../utils/appActiveRefetch';
import { LOTTERY_DEFS } from '../constants/lotteries';
import { COLORS, SPACING } from '../constants/theme';
import type { LotteryId } from '../types/lottery';

const LOTTERY_IDS: LotteryId[] = ['lotto_max', 'lotto_649', 'powerball', 'mega_millions'];

interface Props {
  selectedLottery: LotteryId;
  onLotteryChange: (id: LotteryId) => void;
  onCheckTicket: () => void;
  onViewDrawHistory: () => void;
}

export default function HomeScreen({ selectedLottery, onLotteryChange, onCheckTicket, onViewDrawHistory }: Props) {
  const insets = useSafeAreaInsets();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [refetchTrigger, setRefetchTrigger] = useState(1);
  const { draw, loading, error } = useLatestDraw(selectedLottery, refetchTrigger);
  useEffect(() => {
    return onAppActiveRefetch(() => setRefetchTrigger((n) => n + 1));
  }, []);
  const onRefresh = useCallback(() => {
    invalidateDrawsCache(selectedLottery);
    setRefetchTrigger((n) => n + 1);
  }, [selectedLottery]);
  const def = LOTTERY_DEFS[selectedLottery];

  const [refreshing, setRefreshing] = useState(false);
  const onPullRefresh = useCallback(() => {
    setRefreshing(true);
    onRefresh();
  }, [onRefresh]);
  useEffect(() => {
    if (!loading && refreshing) setRefreshing(false);
  }, [loading, refreshing]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + SPACING.screenPadding, paddingBottom: SPACING.screenPaddingBottom }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} tintColor={COLORS.primary} />}
    >
      <View style={styles.headerRow}>
        <Ionicons name="ticket" size={28} color={COLORS.gold} style={styles.logoIcon} />
        <View>
          <Text style={styles.title}>LottoPilot</Text>
          <Text style={styles.subtitle}>Official lottery ticket checker</Text>
        </View>
      </View>

      <View style={styles.dropdownWrap}>
        <Text style={styles.label}>Lottery</Text>
        <TouchableOpacity
          style={styles.dropdown}
          onPress={() => setDropdownOpen(true)}
          activeOpacity={0.7}
        >
          <Text style={styles.dropdownText}>{LOTTERY_DEFS[selectedLottery].name}</Text>
          <Ionicons name="chevron-down" size={20} color={COLORS.textSecondary} />
        </TouchableOpacity>
      </View>

      <Modal visible={dropdownOpen} transparent animationType="fade">
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setDropdownOpen(false)}
        >
          <TouchableOpacity activeOpacity={1} onPress={(e) => e.stopPropagation()} style={styles.dropdownModal}>
            {LOTTERY_IDS.map((id, i) => (
              <TouchableOpacity
                key={id}
                style={[
                  styles.dropdownOption,
                  selectedLottery === id && styles.dropdownOptionActive,
                  i === LOTTERY_IDS.length - 1 && styles.dropdownOptionLast,
                ]}
                onPress={() => {
                  onLotteryChange(id);
                  setDropdownOpen(false);
                }}
              >
                <Text style={styles.dropdownOptionText}>{LOTTERY_DEFS[id].name}</Text>
                {selectedLottery === id && <Ionicons name="checkmark" size={20} color={COLORS.gold} />}
              </TouchableOpacity>
            ))}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <View style={styles.latestSection}>
        <Text style={styles.sectionTitle}>Latest Draw ({def?.name})</Text>
        {loading ? (
          <ActivityIndicator size="small" color={COLORS.primary} />
        ) : draw ? (
          <View style={styles.drawDisplay}>
            <Text style={styles.drawDate}>{draw.draw_date}</Text>
            <View style={styles.numberRow}>
              {draw.winning_numbers.map((n, i) => (
                <View key={i} style={styles.ball}>
                  <Text style={styles.ballText}>{n}</Text>
                </View>
              ))}
              {draw.special_numbers?.map((n, i) => (
                <View key={`s${i}`} style={[styles.ball, styles.ballSpecial]}>
                  <Text style={styles.ballText}>{n}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : (
          <View>
            <Text style={styles.noData}>
              {error || 'No draw data yet. Run "npm run scrape" to fetch draws, or check .env and restart.'}
            </Text>
            <TouchableOpacity style={styles.refreshBtn} onPress={onRefresh} disabled={loading}>
              <Ionicons name="refresh" size={16} color={COLORS.text} />
              <Text style={styles.refreshBtnText}>Refresh from Supabase</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      <TouchableOpacity style={styles.primaryBtn} onPress={onCheckTicket}>
        <Ionicons name="scan" size={20} color={COLORS.text} style={styles.btnIcon} />
        <Text style={styles.primaryBtnText}>Check My Ticket</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.secondaryBtn}
        onPress={onViewDrawHistory}
      >
        <Ionicons name="list" size={20} color={COLORS.textSecondary} style={styles.btnIcon} />
        <Text style={styles.secondaryBtnText}>View Draw History</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  content: { paddingHorizontal: SPACING.screenPadding },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 24 },
  logoIcon: { marginRight: 12 },
  title: { fontSize: 26, fontWeight: '700', color: COLORS.text },
  subtitle: { fontSize: 14, color: COLORS.textSecondary, marginTop: 2 },
  label: { color: COLORS.textSecondary, fontSize: 12, marginBottom: 8 },
  dropdownWrap: { marginBottom: 24 },
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
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
  drawDisplay: { marginTop: 8 },
  latestSection: {
    backgroundColor: COLORS.bgCard,
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.gold,
  },
  sectionTitle: { color: COLORS.textSecondary, fontSize: 12, marginBottom: 8 },
  drawDate: { color: COLORS.text, fontSize: 14, marginBottom: 12 },
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
  noData: { color: COLORS.textMuted, fontSize: 14 },
  refreshBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    gap: 8,
    alignSelf: 'flex-start',
  },
  refreshBtnText: { color: COLORS.text, fontWeight: '600', fontSize: 14 },
  primaryBtn: {
    backgroundColor: COLORS.primary,
    padding: 16,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  btnIcon: { marginRight: 8 },
  primaryBtnText: { color: COLORS.text, fontWeight: '700', fontSize: 16 },
  secondaryBtn: {
    padding: 16,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.bgElevated,
  },
  secondaryBtnText: { color: COLORS.textSecondary, fontSize: 16 },
});
