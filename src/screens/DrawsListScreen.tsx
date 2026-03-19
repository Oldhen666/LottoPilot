import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  TouchableOpacity,
  BackHandler,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, SPACING } from '../constants/theme';
import { useDraws, invalidateDrawsCache } from '../hooks/useDraws';
import { LOTTERY_DEFS } from '../constants/lotteries';
import type { LotteryId } from '../types/lottery';
import type { Draw } from '../types/lottery';

interface Props {
  lotteryId: LotteryId;
  onBack: () => void;
}

export default function DrawsListScreen({ lotteryId, onBack }: Props) {
  const insets = useSafeAreaInsets();
  const [refetchTrigger, setRefetchTrigger] = useState(0);
  const onRefresh = useCallback(() => {
    invalidateDrawsCache(lotteryId);
    setRefetchTrigger((n) => n + 1);
  }, [lotteryId]);

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

  return (
    <View style={[styles.container, { paddingTop: insets.top + SPACING.screenPadding, paddingBottom: SPACING.screenPaddingBottom }]}>
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
        <FlatList
          data={draws}
          ListHeaderComponent={
            <TouchableOpacity style={styles.refreshBtnSmall} onPress={onRefresh} disabled={loading}>
              <Ionicons name="refresh" size={16} color={COLORS.textSecondary} />
              <Text style={styles.refreshBtnSmallText}>Refresh</Text>
            </TouchableOpacity>
          }
          keyExtractor={(d) => d.draw_date}
          contentContainerStyle={styles.list}
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
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg, paddingHorizontal: SPACING.screenPadding },
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
