import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, SPACING } from '../constants/theme';
import * as SecureStore from 'expo-secure-store';
import { DISCLAIMER_SUBSCRIPTION } from '../constants/disclaimers';
import { generateCandidates, type CandidatePick } from '../utils/localAnalysis';
import { getRecords } from '../db/sqlite';
import { LOTTERY_DEFS } from '../constants/lotteries';
import { isIAPAvailable, getIAPProducts, formatPiratePrice, formatAstronautPrice } from '../services/iap';
import type { LotteryId } from '../types/lottery';

const LOCAL_UNLOCK_KEY = 'lottopilot_local_unlock';
const AI_SUB_KEY = 'lottopilot_ai_sub';

export default function InsightsScreen() {
  const insets = useSafeAreaInsets();
  const [localUnlocked, setLocalUnlocked] = useState(false);
  const [aiSub, setAiSub] = useState(false);
  const [candidates, setCandidates] = useState<CandidatePick[]>([]);
  const [selectedLottery, setSelectedLottery] = useState<LotteryId>('lotto_max');
  const [needMoreData, setNeedMoreData] = useState(false);
  const [piratePrice, setPiratePrice] = useState('$3.49');
  const [astronautPrice, setAstronautPrice] = useState('$0.99/mo');

  useEffect(() => {
    SecureStore.getItemAsync(LOCAL_UNLOCK_KEY).then((v) => setLocalUnlocked(v === 'true'));
    SecureStore.getItemAsync(AI_SUB_KEY).then((v) => setAiSub(v === 'true'));
  }, []);

  useEffect(() => {
    if (isIAPAvailable()) {
      getIAPProducts().then(({ pirate, astronaut }) => {
        setPiratePrice(formatPiratePrice(pirate));
        setAstronautPrice(formatAstronautPrice(astronaut));
      });
    }
  }, []);

  const runLocalAnalysis = async () => {
    const records = await getRecords({ lottery_id: selectedLottery, limit: 50 });
    const history = records.map((r) => ({
      winning_numbers: r.winning_numbers,
      special_numbers: r.winning_special,
    }));
    if (history.length < 2) {
      setCandidates([]);
      setNeedMoreData(true);
      return;
    }
    setNeedMoreData(false);
    const picks = generateCandidates(selectedLottery, history, {}, 5);
    setCandidates(picks);
  };

  const handleLocalUnlock = async () => {
    await SecureStore.setItemAsync(LOCAL_UNLOCK_KEY, 'true');
    setLocalUnlocked(true);
  };

  const handleAiSub = async () => {
    await SecureStore.setItemAsync(AI_SUB_KEY, 'true');
    setAiSub(true);
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + SPACING.screenPadding, paddingBottom: SPACING.screenPaddingBottom }]}
    >
      <View style={styles.headerRow}>
        <Ionicons name="bulb" size={24} color={COLORS.gold} style={styles.titleIcon} />
        <Text style={styles.title}>Insights & Analysis</Text>
      </View>
      <Text style={styles.subtitle}>
        Decision support tools. For entertainment only. Does not increase or guarantee any outcome.
      </Text>

      <View style={styles.disclaimer}>
        <Text style={styles.disclaimerText}>{DISCLAIMER_SUBSCRIPTION}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Local Analysis</Text>
        <Text style={styles.cardDesc}>
          Number analysis with adjustable weights: hot/cold, odd/even, range distribution. Generate candidate picks with explanations. Runs fully offline.
        </Text>
        {localUnlocked ? (
          <>
            <View style={styles.unlocked}>
              <Text style={styles.unlockedText}>✓ Unlocked</Text>
            </View>
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
            <TouchableOpacity style={styles.analyzeBtn} onPress={runLocalAnalysis}>
              <Text style={styles.analyzeBtnText}>Generate Candidates</Text>
            </TouchableOpacity>
            {needMoreData && (
              <Text style={styles.hint}>Check at least 2 tickets for this lottery to generate picks.</Text>
            )}
            {candidates.length > 0 && (
              <View style={styles.results}>
                {candidates.map((p, i) => (
                  <View key={i} style={styles.pickCard}>
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
            )}
          </>
        ) : (
          <TouchableOpacity style={styles.purchaseBtn} onPress={handleLocalUnlock}>
            <Text style={styles.purchaseBtnText}>Unlock {piratePrice} (MVP: tap to unlock)</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>AI Analysis (Subscription)</Text>
        <Text style={styles.cardDesc}>
          Strategy comparison, simulation summary, probability visualization. Suggested picks with full disclaimer.
        </Text>
        {aiSub ? (
          <View style={styles.unlocked}>
            <Text style={styles.unlockedText}>✓ Subscribed</Text>
          </View>
        ) : (
          <TouchableOpacity style={styles.purchaseBtn} onPress={handleAiSub}>
            <Text style={styles.purchaseBtnText}>Subscribe {astronautPrice} (MVP: tap to unlock)</Text>
          </TouchableOpacity>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  content: { paddingHorizontal: SPACING.screenPadding },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  titleIcon: { marginRight: 10 },
  title: { fontSize: 24, fontWeight: '700', color: COLORS.text },
  subtitle: { color: COLORS.textSecondary, fontSize: 14, marginBottom: 16 },
  disclaimer: {
    backgroundColor: COLORS.bgCard,
    borderRadius: 10,
    padding: 14,
    marginBottom: 24,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.gold,
  },
  disclaimerText: { color: COLORS.textSecondary, fontSize: 12 },
  card: {
    backgroundColor: COLORS.bgCard,
    borderRadius: 12,
    padding: 18,
    marginBottom: 16,
  },
  cardTitle: { color: COLORS.text, fontSize: 18, fontWeight: '600', marginBottom: 8 },
  cardDesc: { color: COLORS.textSecondary, fontSize: 14, marginBottom: 12 },
  purchaseBtn: {
    backgroundColor: COLORS.primary,
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  purchaseBtnText: { color: COLORS.text, fontWeight: '600' },
  unlocked: { padding: 10, alignItems: 'center' },
  unlockedText: { color: COLORS.success, fontWeight: '600' },
  lotteryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  lotteryPill: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: COLORS.bgElevated,
  },
  lotteryPillActive: { backgroundColor: COLORS.primary },
  lotteryPillText: { color: COLORS.text, fontSize: 12 },
  analyzeBtn: {
    backgroundColor: COLORS.bgElevated,
    padding: 12,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 12,
  },
  analyzeBtnText: { color: COLORS.text, fontWeight: '600' },
  results: { marginTop: 16 },
  pickCard: {
    backgroundColor: COLORS.bgElevated,
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
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
  explanation: { color: COLORS.textSecondary, fontSize: 11, marginTop: 8 },
  hint: { color: COLORS.textMuted, fontSize: 12, marginTop: 8 },
});
