/**
 * Pick Book: locally stored Strategy Lab generated picks.
 * Filter by date, sorted by date descending.
 */
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
  Alert,
  Modal,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, SPACING } from '../constants/theme';
import { getPickBookRecords, deletePickBookRecord, type PickBookRecord } from '../db/sqlite';
import { LOTTERY_DEFS } from '../constants/lotteries';
import type { LotteryId } from '../types/lottery';

interface Props {
  onBack: () => void;
}

type SortOrder = 'desc' | 'asc';

export default function PickBookScreen({ onBack }: Props) {
  const insets = useSafeAreaInsets();
  const [records, setRecords] = useState<PickBookRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFilter, setDateFilter] = useState('');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [dateFilterOpen, setDateFilterOpen] = useState(false);

  const loadRecords = useCallback(async () => {
    setLoading(true);
    try {
      const list = await getPickBookRecords({ sortOrder });
      setRecords(list);
    } catch {
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, [sortOrder]);

  const displayedRecords = dateFilter
    ? records.filter((r) => r.draw_date === dateFilter)
    : records;

  const availableDates = [...new Set(records.map((r) => r.draw_date))].sort((a, b) => b.localeCompare(a));

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => sub.remove();
  }, [onBack]);

  const onDeleteRecord = useCallback((item: PickBookRecord) => {
    const msg = `Delete ${item.draw_date} (${LOTTERY_DEFS[item.lottery_id as LotteryId]?.name ?? item.lottery_id})?`;
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      if (window.confirm(msg)) {
        deletePickBookRecord(item.id).then(loadRecords);
      }
      return;
    }
    Alert.alert('Delete record?', msg, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deletePickBookRecord(item.id).then(loadRecords) },
    ]);
  }, [loadRecords]);

  return (
    <View style={[styles.container, { paddingTop: insets.top + SPACING.screenPadding, paddingBottom: SPACING.screenPaddingBottom }]}>
      <TouchableOpacity onPress={onBack} style={styles.backBtn}>
        <Ionicons name="arrow-back" size={20} color={COLORS.textSecondary} />
        <Text style={styles.backText}>Back</Text>
      </TouchableOpacity>
      <Text style={styles.title}>Pick Book</Text>
      <Text style={styles.subtitle}>Generated picks saved locally. Filter by date.</Text>

      <TouchableOpacity
        style={styles.filterRow}
        onPress={() => setDateFilterOpen(true)}
        activeOpacity={0.7}
      >
        <Ionicons name="calendar-outline" size={18} color={COLORS.textMuted} />
        <Text style={[styles.filterLabel, !dateFilter && styles.filterPlaceholder]}>
          {dateFilter || 'Filter by date'}
        </Text>
        <Ionicons name="chevron-down" size={18} color={COLORS.textMuted} />
      </TouchableOpacity>

      <Modal visible={dateFilterOpen} transparent animationType="fade">
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setDateFilterOpen(false)}
        >
          <TouchableOpacity activeOpacity={1} onPress={(e) => e.stopPropagation()} style={styles.dateFilterModal}>
            <Text style={styles.dateFilterModalTitle}>Select date</Text>
            <ScrollView style={styles.dateFilterList} showsVerticalScrollIndicator={false}>
              <TouchableOpacity
                style={[styles.dateFilterItem, !dateFilter && styles.dateFilterItemActive]}
                onPress={() => {
                  setDateFilter('');
                  setDateFilterOpen(false);
                }}
              >
                <Text style={[styles.dateFilterItemText, !dateFilter && styles.dateFilterItemTextActive]}>All dates</Text>
              </TouchableOpacity>
              {availableDates.map((d) => (
                <TouchableOpacity
                  key={d}
                  style={[styles.dateFilterItem, dateFilter === d && styles.dateFilterItemActive]}
                  onPress={() => {
                    setDateFilter(d);
                    setDateFilterOpen(false);
                  }}
                >
                  <Text style={[styles.dateFilterItemText, dateFilter === d && styles.dateFilterItemTextActive]}>{d}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.dateFilterCancel} onPress={() => setDateFilterOpen(false)}>
              <Text style={styles.dateFilterCancelText}>Cancel</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <View style={styles.sortRow}>
        <Text style={styles.sortLabel}>Sort by date:</Text>
        <TouchableOpacity
          style={[styles.sortBtn, sortOrder === 'desc' && styles.sortBtnActive]}
          onPress={() => setSortOrder('desc')}
        >
          <Text style={[styles.sortBtnText, sortOrder === 'desc' && styles.sortBtnTextActive]}>Newest first</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.sortBtn, sortOrder === 'asc' && styles.sortBtnActive]}
          onPress={() => setSortOrder('asc')}
        >
          <Text style={[styles.sortBtnText, sortOrder === 'asc' && styles.sortBtnTextActive]}>Oldest first</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={COLORS.gold} style={styles.loader} />
      ) : displayedRecords.length === 0 ? (
        <View style={styles.emptyBox}>
          <Ionicons name="book-outline" size={48} color={COLORS.textMuted} style={styles.emptyIcon} />
          <Text style={styles.empty}>
            {dateFilter && records.length > 0 ? `No records for ${dateFilter}` : 'No picks in book'}
          </Text>
          <Text style={styles.emptyHint}>
            {dateFilter && records.length > 0
              ? 'Try selecting a different date'
              : 'Add picks from Strategy Lab → Generated picks → Add to Pick Book'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={displayedRecords}
          keyExtractor={(r) => r.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.cardHeaderLeft}>
                  <Text style={styles.drawDate}>{item.draw_date}</Text>
                  <Text style={styles.lotteryName}>{LOTTERY_DEFS[item.lottery_id as LotteryId]?.name ?? item.lottery_id}</Text>
                </View>
                <TouchableOpacity
                  onPress={() => onDeleteRecord(item)}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  style={styles.deleteBtn}
                >
                  <Ionicons name="trash-outline" size={20} color={COLORS.error} />
                </TouchableOpacity>
              </View>
              {item.picks.map((p, i) => (
                <View key={i} style={styles.pickRow}>
                  <View style={styles.ballRow}>
                    {p.main.map((n, j) => (
                      <View key={j} style={styles.ball}>
                        <Text style={styles.ballText}>{n}</Text>
                      </View>
                    ))}
                    {p.special.map((n, j) => (
                      <View key={`s${j}`} style={[styles.ball, styles.ballSpecial]}>
                        <Text style={styles.ballText}>{n}</Text>
                      </View>
                    ))}
                  </View>
                  {p.explanation ? (
                    <Text style={styles.explanation} numberOfLines={2}>{p.explanation}</Text>
                  ) : null}
                </View>
              ))}
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
  title: { fontSize: 22, fontWeight: '700', color: COLORS.text, marginBottom: 4 },
  subtitle: { color: COLORS.textMuted, fontSize: 13, marginBottom: 16 },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.bgElevated,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 20,
    gap: 8,
  },
  filterLabel: { flex: 1, color: COLORS.text, fontSize: 14 },
  filterPlaceholder: { color: COLORS.textMuted },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  dateFilterModal: {
    backgroundColor: COLORS.bgCard,
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxWidth: 320,
    maxHeight: '70%',
  },
  dateFilterModalTitle: { color: COLORS.text, fontSize: 16, fontWeight: '600', marginBottom: 12 },
  dateFilterList: { maxHeight: 280, marginBottom: 12 },
  dateFilterItem: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 8,
    marginBottom: 4,
  },
  dateFilterItemActive: { backgroundColor: COLORS.gold },
  dateFilterItemText: { color: COLORS.text, fontSize: 15 },
  dateFilterItemTextActive: { color: COLORS.bg, fontWeight: '600' },
  dateFilterCancel: { alignItems: 'center', paddingVertical: 8 },
  dateFilterCancelText: { color: COLORS.textMuted, fontSize: 14 },
  sortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    gap: 10,
  },
  sortLabel: { color: COLORS.textSecondary, fontSize: 13 },
  sortBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: COLORS.bgElevated,
  },
  sortBtnActive: { backgroundColor: COLORS.gold },
  sortBtnText: { color: COLORS.textSecondary, fontSize: 13 },
  sortBtnTextActive: { color: COLORS.bg, fontWeight: '600' },
  loader: { marginTop: 40 },
  emptyBox: { marginTop: 40, alignItems: 'center' },
  emptyIcon: { marginBottom: 12 },
  empty: { color: COLORS.textMuted, fontSize: 16 },
  emptyHint: { color: COLORS.textMuted, fontSize: 13, marginTop: 8, textAlign: 'center', paddingHorizontal: 24 },
  list: { paddingBottom: 40 },
  card: {
    backgroundColor: COLORS.bgCard,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.gold,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  cardHeaderLeft: { flex: 1 },
  drawDate: { color: COLORS.gold, fontSize: 16, fontWeight: '700' },
  lotteryName: { color: COLORS.textSecondary, fontSize: 14 },
  deleteBtn: { padding: 4 },
  pickRow: { marginBottom: 12 },
  ballRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  ball: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ballSpecial: { backgroundColor: COLORS.success },
  ballText: { color: COLORS.text, fontWeight: '700', fontSize: 12 },
  explanation: { color: COLORS.textMuted, fontSize: 11, marginTop: 6 },
});
