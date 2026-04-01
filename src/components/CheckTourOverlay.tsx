import React from 'react';
import { View, Text, Pressable, StyleSheet, useWindowDimensions, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, SPACING } from '../constants/theme';

export type CheckTourStepIndex = 0 | 1 | 2;

type Rect = { x: number; y: number; width: number; height: number };

const PAD = 8;

function DimWithHole({ rect }: { rect: Rect }) {
  const { height: H } = useWindowDimensions();
  const hx = Math.max(0, rect.x - PAD);
  const hy = Math.max(0, rect.y - PAD);
  const hw = rect.width + 2 * PAD;
  const hh = rect.height + 2 * PAD;
  const botTop = hy + hh;

  return (
    <>
      <Pressable
        style={[styles.dim, { position: 'absolute', left: 0, right: 0, top: 0, height: hy }]}
        onPress={() => {}}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
      <View style={{ position: 'absolute', left: 0, right: 0, top: hy, height: hh, flexDirection: 'row' }} pointerEvents="box-none">
        <Pressable style={[styles.dim, { width: hx, height: hh }]} onPress={() => {}} />
        <View
          style={{
            width: hw,
            height: hh,
            borderRadius: 10,
            borderWidth: 2,
            borderColor: COLORS.gold,
            backgroundColor: 'transparent',
          }}
          pointerEvents="none"
        />
        <Pressable style={[styles.dim, { flex: 1, height: hh }]} onPress={() => {}} />
      </View>
      <Pressable
        style={[styles.dim, { position: 'absolute', left: 0, right: 0, top: botTop, height: Math.max(0, H - botTop) }]}
        onPress={() => {}}
      />
    </>
  );
}

const MESSAGES: Record<CheckTourStepIndex, string> = {
  0: 'Choose your lottery type here. This sets which game rules and draws apply when you check a ticket.',
  1: 'When you are ready, tap Check My Ticket to enter numbers or scan your ticket.',
  2:
    Platform.OS !== 'web'
      ? 'Use Scan ticket to capture your ticket with the camera, or enter numbers manually below.'
      : 'Upload a photo of your ticket, or enter numbers manually below.',
};

type Props = {
  step: CheckTourStepIndex;
  highlightRect: Rect | null;
  onSkip: () => void;
  onNext?: () => void;
  onDone?: () => void;
};

export default function CheckTourOverlay({ step, highlightRect, onSkip, onNext, onDone }: Props) {
  const insets = useSafeAreaInsets();
  const { height: H } = useWindowDimensions();

  if (!highlightRect) {
    return (
      <View style={[styles.root, { paddingBottom: insets.bottom + 16 }]} pointerEvents="auto">
        <Pressable style={[StyleSheet.absoluteFillObject, styles.dim]} onPress={() => {}} />
        <View style={[styles.panel, { marginHorizontal: SPACING.screenPadding }]}>
          <Text style={styles.msg}>{MESSAGES[step]}</Text>
          <View style={styles.row}>
            <Pressable onPress={onSkip} style={styles.btnGhost}>
              <Text style={styles.btnGhostText}>Skip</Text>
            </Pressable>
            {step === 0 && onNext ? (
              <Pressable onPress={onNext} style={styles.btnPrimary}>
                <Text style={styles.btnPrimaryText}>Next</Text>
              </Pressable>
            ) : null}
            {step === 2 && onDone ? (
              <Pressable onPress={onDone} style={styles.btnPrimary}>
                <Text style={styles.btnPrimaryText}>Done</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.root, { height: H }]} pointerEvents="box-none">
      <DimWithHole rect={highlightRect} />
      <View
        style={[
          styles.panelWrap,
          {
            paddingBottom: insets.bottom + 16,
            paddingHorizontal: SPACING.screenPadding,
          },
        ]}
        pointerEvents="box-none"
      >
        <View style={styles.panel}>
          <Text style={styles.msg}>{MESSAGES[step]}</Text>
          <View style={styles.row}>
            <Pressable onPress={onSkip} style={styles.btnGhost}>
              <Text style={styles.btnGhostText}>Skip</Text>
            </Pressable>
            {step === 0 && onNext ? (
              <Pressable onPress={onNext} style={styles.btnPrimary}>
                <Text style={styles.btnPrimaryText}>Next</Text>
              </Pressable>
            ) : null}
            {step === 2 && onDone ? (
              <Pressable onPress={onDone} style={styles.btnPrimary}>
                <Text style={styles.btnPrimaryText}>Done</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    elevation: 9999,
    justifyContent: 'flex-end',
  },
  dim: {
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  panelWrap: {
    width: '100%',
  },
  panel: {
    backgroundColor: COLORS.bgCard,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.bgElevated,
  },
  msg: {
    color: COLORS.text,
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 16,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 12,
  },
  btnGhost: {
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  btnGhostText: {
    color: COLORS.textSecondary,
    fontSize: 16,
    fontWeight: '600',
  },
  btnPrimary: {
    backgroundColor: COLORS.primary,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 10,
  },
  btnPrimaryText: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '700',
  },
});
