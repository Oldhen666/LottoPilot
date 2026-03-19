import React, { useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, BackHandler, Platform, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LOTTERY_DEFS } from '../constants/lotteries';
import { COLORS, SPACING } from '../constants/theme';
import { getPrizeTierIcon } from '../utils/prizeTierIcon';
import type { CheckRecord } from '../db/sqlite';

interface Props {
  record: CheckRecord;
  onDone: () => void;
  onEditNumbers?: () => void;
}

export default function ResultScreen({ record, onDone, onEditNumbers }: Props) {
  const def = LOTTERY_DEFS[record.lottery_id];
  const mainSet = new Set(record.winning_numbers);
  const specialSet = record.winning_special?.length
    ? new Set(record.winning_special)
    : undefined;

  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onDone();
      return true;
    });
    return () => sub.remove();
  }, [onDone]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + SPACING.screenPadding, paddingBottom: SPACING.screenPaddingBottom }]}
    >
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={onDone} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={20} color={COLORS.textSecondary} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        {onEditNumbers ? (
          <TouchableOpacity onPress={onEditNumbers} style={styles.editBtn}>
            <Ionicons name="create-outline" size={18} color={COLORS.gold} />
            <Text style={styles.editBtnText}>Edit numbers</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <Text style={styles.title}>Check Result</Text>
      <Text style={styles.subtitle}>
        {def?.name} • {record.draw_date}
      </Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Your Numbers</Text>
        {(record.result_json?.lineResults && record.result_json.lineResults.length > 0
          ? record.result_json.lineResults
          : [{ user_main: record.user_numbers, user_special: record.user_special, match_main: record.match_count_main, match_special: record.match_count_special ?? 0, result_bucket: record.result_bucket }]
        ).map((line, lineIdx) => {
          const matchMain = 'match_main' in line ? line.match_main : record.match_count_main;
          const matchSpecial = 'match_special' in line ? line.match_special : (record.match_count_special ?? 0);
          const bucket = 'result_bucket' in line ? line.result_bucket : record.result_bucket;
          return (
            <View key={lineIdx} style={styles.lineBlock}>
              {(record.result_json?.lineResults?.length ?? 0) > 1 && (
                <Text style={styles.lineLabel}>Line {lineIdx + 1}</Text>
              )}
              <View style={styles.numberRow}>
                {line.user_main.map((n, i) => {
                  const hit = mainSet.has(n);
                  return (
                    <View key={i} style={[styles.ball, hit && styles.ballHit]}>
                      <Text style={styles.ballText}>{n}</Text>
                    </View>
                  );
                })}
                {line.user_special?.map((n, i) => {
                  const hit = specialSet?.has(n);
                  const ballStyle = record.lottery_id === 'powerball' ? styles.ballPowerball : record.lottery_id === 'mega_millions' ? styles.ballMegaBall : styles.ballSpecial;
                  return (
                    <View key={`s${i}`} style={[styles.ball, ballStyle, hit && styles.ballHit]}>
                      <Text style={styles.ballText}>{n}</Text>
                    </View>
                  );
                })}
              </View>
              <View style={styles.lineResultBox}>
                <View style={styles.matchSummaryHeader}>
                  <Text style={styles.resultLabel}>Match Summary</Text>
                  {(() => {
                    const icon = getPrizeTierIcon(record.lottery_id, matchMain, matchSpecial);
                    return icon ? <Text style={styles.tierIcon}>{icon}</Text> : null;
                  })()}
                </View>
                <Text style={styles.resultValue}>
                  {matchMain} main
                  {matchSpecial > 0
                    ? record.lottery_id === 'powerball'
                      ? ` + ${matchSpecial} Powerball`
                      : record.lottery_id === 'mega_millions'
                        ? ` + ${matchSpecial} Mega Ball`
                        : ` + ${matchSpecial} special`
                    : ''}
                </Text>
                <Text style={styles.bucketText}>{bucket.replace('_', ' ')}</Text>
                {('prizeText' in line && line.prizeText)
                  ? (
                    <>
                      <Text style={styles.prizeLineText}>Prize: {line.prizeText}</Text>
                      <Text style={styles.prizeDisclaimerLine}>Reference only. Verify with official source when claiming.</Text>
                    </>
                  )
                  : record.result_json?.estimatedPrizeText && lineIdx === 0
                    ? (
                    <>
                      <Text style={styles.prizeLineText}>Prize: {record.result_json.estimatedPrizeText}</Text>
                      <Text style={styles.prizeDisclaimerLine}>Reference only. Verify with official source when claiming.</Text>
                    </>
                    )
                    : null}
              </View>
            </View>
          );
        })}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Winning Numbers</Text>
        <View style={styles.numberRow}>
          {record.winning_numbers.map((n, i) => (
            <View key={i} style={styles.ball}>
              <Text style={styles.ballText}>{n}</Text>
            </View>
          ))}
          {record.winning_special?.map((n, i) => {
            const ballStyle = record.lottery_id === 'powerball' ? styles.ballPowerball : record.lottery_id === 'mega_millions' ? styles.ballMegaBall : styles.ballSpecial;
            return (
              <View key={`s${i}`} style={[styles.ball, ballStyle]}>
                <Text style={styles.ballText}>{n}</Text>
              </View>
            );
          })}
        </View>
      </View>

      {record.result_json?.claimUrl || record.result_json?.officialRulesUrl ? (
        <View style={styles.officialLinksRow}>
          {record.result_json.claimUrl ? (
            <TouchableOpacity style={styles.claimLink} onPress={() => Linking.openURL(record.result_json!.claimUrl!)}>
              <Text style={styles.claimLinkText}>Claim info (official)</Text>
              <Ionicons name="open-outline" size={16} color={COLORS.gold} />
            </TouchableOpacity>
          ) : null}
          {record.result_json?.officialRulesUrl ? (
            <TouchableOpacity style={styles.claimLink} onPress={() => Linking.openURL(record.result_json!.officialRulesUrl!)}>
              <Text style={styles.claimLinkText}>Official rules</Text>
              <Ionicons name="open-outline" size={16} color={COLORS.gold} />
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {record.result_json?.addOnResults && Object.keys(record.result_json.addOnResults).length > 0 && (
        <View style={styles.addOnSection}>
          <Text style={styles.addOnSectionTitle}>Add-on Results</Text>
          {record.result_json.addOnResults.EXTRA && (
            <View style={styles.addOnBlock}>
              <Text style={styles.addOnBlockTitle}>EXTRA</Text>
              <Text style={styles.addOnText}>Your: {record.result_json.addOnResults.EXTRA.user} • Winning: {record.result_json.addOnResults.EXTRA.winning}</Text>
              <Text style={styles.addOnText}>{record.result_json.addOnResults.EXTRA.matchedDigits} digits matched • {record.result_json.addOnResults.EXTRA.prizeText}</Text>
            </View>
          )}
          {record.result_json.addOnResults.ENCORE && (
            <View style={styles.addOnBlock}>
              <Text style={styles.addOnBlockTitle}>ENCORE</Text>
              <Text style={styles.addOnText}>Your: {record.result_json.addOnResults.ENCORE.user} • Winning: {record.result_json.addOnResults.ENCORE.winning}</Text>
              <Text style={styles.addOnText}>{record.result_json.addOnResults.ENCORE.matchedDigits} digits matched • {record.result_json.addOnResults.ENCORE.prizeText}</Text>
            </View>
          )}
          {record.result_json.addOnResults.TAG && (
            <View style={styles.addOnBlock}>
              <Text style={styles.addOnBlockTitle}>TAG</Text>
              <Text style={styles.addOnText}>Your: {record.result_json.addOnResults.TAG.user} • Winning: {record.result_json.addOnResults.TAG.winning}</Text>
              <Text style={styles.addOnText}>{record.result_json.addOnResults.TAG.matchedDigits} digits matched • {record.result_json.addOnResults.TAG.prizeText}</Text>
            </View>
          )}
          {record.result_json.addOnResults.POWER_PLAY && (
            <View style={styles.addOnBlock}>
              <Text style={styles.addOnBlockTitle}>Power Play</Text>
              <Text style={styles.addOnText}>
                Multiplier: ×{record.result_json.addOnResults.POWER_PLAY.multiplier}
                {record.result_json.addOnResults.POWER_PLAY.applied ? ' • Applied' : ' • Not applied (you did not add Power Play)'}
              </Text>
            </View>
          )}
          {record.result_json.addOnResults.DOUBLE_PLAY && (
            <View style={styles.addOnBlock}>
              <Text style={styles.addOnBlockTitle}>Double Play</Text>
              <Text style={styles.addOnText}>{record.result_json.addOnResults.DOUBLE_PLAY.match_main} main + {record.result_json.addOnResults.DOUBLE_PLAY.match_special} PB • {record.result_json.addOnResults.DOUBLE_PLAY.prizeText}</Text>
            </View>
          )}
          {record.result_json.addOnResults.MAXMILLIONS && record.result_json.addOnResults.MAXMILLIONS.hits.length > 0 && (
            <View style={styles.addOnBlock}>
              <Text style={styles.addOnBlockTitle}>Maxmillions</Text>
              <Text style={styles.addOnText}>Hit(s): {record.result_json.addOnResults.MAXMILLIONS.hits.length} match(es)</Text>
            </View>
          )}
          {record.result_json.addOnResults.MEGA_MULTIPLIER && (
            <View style={styles.addOnBlock}>
              <Text style={styles.addOnBlockTitle}>Megaplier</Text>
              <Text style={styles.addOnText}>
                Multiplier: ×{record.result_json.addOnResults.MEGA_MULTIPLIER.multiplier}
                {record.result_json.addOnResults.MEGA_MULTIPLIER.applied ? ' • Applied' : ' • Not applied (you did not add Megaplier)'}
              </Text>
            </View>
          )}
        </View>
      )}

      <TouchableOpacity style={styles.doneBtn} onPress={onDone}>
        <Text style={styles.doneBtnText}>Done</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  content: { paddingHorizontal: SPACING.screenPadding },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  backBtn: { flexDirection: 'row', alignItems: 'center' },
  backText: { color: COLORS.textSecondary, fontSize: 16, marginLeft: 6 },
  editBtn: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 12 },
  editBtnText: { color: COLORS.gold, fontSize: 14, marginLeft: 6 },
  title: { fontSize: 24, fontWeight: '700', color: COLORS.text, marginBottom: 4 },
  subtitle: { color: COLORS.textSecondary, fontSize: 14, marginBottom: 24 },
  section: { marginBottom: 24 },
  sectionTitle: { color: COLORS.textSecondary, fontSize: 12, marginBottom: 8 },
  lineBlock: { marginBottom: 16 },
  lineLabel: { color: COLORS.textMuted, fontSize: 13, marginBottom: 6 },
  lineResultBox: {
    backgroundColor: COLORS.bgCard,
    borderRadius: 10,
    padding: 12,
    marginTop: 10,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.gold,
  },
  numberRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  ball: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.bgCard,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ballSpecial: { backgroundColor: COLORS.bgCard, borderWidth: 2, borderColor: COLORS.success },
  ballPowerball: { backgroundColor: '#dc2626', borderWidth: 2, borderColor: '#b91c1c' },
  ballMegaBall: { backgroundColor: '#d4af37', borderWidth: 2, borderColor: '#b8962e' },
  ballHit: { backgroundColor: COLORS.success },
  ballText: { color: COLORS.text, fontWeight: '700', fontSize: 16 },
  resultBox: {
    backgroundColor: COLORS.bgCard,
    borderRadius: 12,
    padding: 20,
    marginBottom: 24,
    alignItems: 'center',
    borderLeftWidth: 4,
    borderLeftColor: COLORS.gold,
  },
  matchSummaryHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  resultLabel: { color: COLORS.textSecondary, fontSize: 12 },
  tierIcon: { fontSize: 24 },
  resultValue: { color: COLORS.text, fontSize: 20, fontWeight: '700' },
  bucketText: { color: COLORS.gold, fontSize: 14, marginTop: 4, textTransform: 'capitalize' },
  prizeLineText: { color: COLORS.success, fontSize: 16, fontWeight: '600', marginTop: 8 },
  prizeDisclaimerLine: { color: COLORS.textMuted, fontSize: 12, marginTop: 4 },
  officialLinksRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginBottom: 24 },
  prizeBox: {
    backgroundColor: COLORS.bgCard,
    borderRadius: 12,
    padding: 20,
    marginBottom: 24,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.success,
  },
  prizeTier: { color: COLORS.textSecondary, fontSize: 12, marginBottom: 4 },
  prizeAmount: { color: COLORS.text, fontSize: 20, fontWeight: '700' },
  prizeDisclaimer: { color: COLORS.textMuted, fontSize: 11, marginTop: 4 },
  claimLink: { flexDirection: 'row', alignItems: 'center', marginTop: 12, gap: 6 },
  claimLinkText: { color: COLORS.gold, fontSize: 14 },
  addOnSection: { marginBottom: 24 },
  addOnSectionTitle: { color: COLORS.textSecondary, fontSize: 12, marginBottom: 12, textTransform: 'uppercase' },
  addOnBlock: { backgroundColor: COLORS.bgCard, borderRadius: 10, padding: 14, marginBottom: 10 },
  addOnBlockTitle: { color: COLORS.gold, fontSize: 14, fontWeight: '600', marginBottom: 6 },
  addOnText: { color: COLORS.textSecondary, fontSize: 13 },
  doneBtn: {
    backgroundColor: COLORS.primary,
    padding: 16,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneBtnText: { color: COLORS.text, fontWeight: '700', fontSize: 16 },
});
