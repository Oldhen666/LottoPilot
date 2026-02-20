import React from 'react';
import { View, Text, StyleSheet, ScrollView, Linking, TouchableOpacity } from 'react-native';
import {
  DISCLAIMER_SHORT,
  DISCLAIMER_SUBSCRIPTION,
  DATA_SOURCE_NOTICE,
} from '../constants/disclaimers';
import { LOTTERY_DEFS } from '../constants/lotteries';

export default function SettingsScreen() {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Settings</Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Disclaimer (Short)</Text>
        <Text style={styles.body}>{DISCLAIMER_SHORT}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Disclaimer (Subscription)</Text>
        <Text style={styles.body}>{DISCLAIMER_SUBSCRIPTION}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Data Sources</Text>
        <Text style={styles.body}>{DATA_SOURCE_NOTICE}</Text>
        <Text style={styles.linkLabel}>Official links:</Text>
        {Object.values(LOTTERY_DEFS).map((l) => (
          <TouchableOpacity
            key={l.id}
            onPress={() => Linking.openURL(l.source_url)}
            style={styles.linkRow}
          >
            <Text style={styles.link}>{l.name}</Text>
            <Text style={styles.linkArrow}>→</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Privacy</Text>
        <Text style={styles.body}>
          Check history is stored locally. If you sign in, records may sync to our servers for backup. We do not sell your data.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  content: { padding: 20, paddingBottom: 40 },
  title: { fontSize: 24, fontWeight: '700', color: '#f8fafc', marginBottom: 24 },
  section: { marginBottom: 24 },
  sectionTitle: { color: '#94a3b8', fontSize: 12, marginBottom: 8, textTransform: 'uppercase' },
  body: { color: '#e2e8f0', fontSize: 14, lineHeight: 22 },
  linkLabel: { color: '#94a3b8', marginTop: 12, marginBottom: 8 },
  linkRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 },
  link: { color: '#6366f1', fontSize: 14 },
  linkArrow: { color: '#6366f1' },
});
