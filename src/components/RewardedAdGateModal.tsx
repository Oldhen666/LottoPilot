/**
 * Modal shown when free user has reached 3 generates and must watch rewarded ad to continue.
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants/theme';
import { showRewardedAdForGeneratePicks } from '../services/rewardedAdService';

const AD_SKIP_MESSAGE = 'Please watch the ad to continue generating picks.';

interface Props {
  visible: boolean;
  onAdCompleted: () => void;
  onCancel: () => void;
}

export function RewardedAdGateModal({ visible, onAdCompleted, onCancel }: Props) {
  const [loading, setLoading] = useState(false);

  const handleWatchAd = async () => {
    setLoading(true);
    try {
      const completed = await showRewardedAdForGeneratePicks();
      if (completed) {
        onAdCompleted();
      } else {
        Alert.alert('Ad required', AD_SKIP_MESSAGE);
      }
    } catch {
      Alert.alert('Ad required', AD_SKIP_MESSAGE);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.content}>
          <Text style={styles.title}>Continue Generating</Text>
          <Text style={styles.message}>You've reached 3 free generates. Watch a short ad to continue.</Text>
          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={onCancel}
              disabled={loading}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.watchBtn, loading && styles.watchBtnDisabled]}
              onPress={handleWatchAd}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator size="small" color={COLORS.bg} />
              ) : (
                <>
                  <Ionicons name="play-circle" size={20} color={COLORS.bg} style={styles.watchIcon} />
                  <Text style={styles.watchText}>Watch Ad</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  content: {
    backgroundColor: COLORS.bgCard,
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 340,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 12,
  },
  message: {
    fontSize: 14,
    color: COLORS.textSecondary,
    lineHeight: 22,
    marginBottom: 24,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'flex-end',
  },
  cancelBtn: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 10,
    backgroundColor: COLORS.bgElevated,
  },
  cancelText: {
    color: COLORS.textMuted,
    fontSize: 14,
    fontWeight: '600',
  },
  watchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 10,
    backgroundColor: COLORS.gold,
  },
  watchBtnDisabled: {
    opacity: 0.7,
  },
  watchIcon: {
    marginRight: 8,
  },
  watchText: {
    color: COLORS.bg,
    fontSize: 14,
    fontWeight: '700',
  },
});
