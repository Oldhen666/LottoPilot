import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  Platform,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, SPACING } from '../constants/theme';

export type CheckTourStepIndex = 0 | 1 | 2;

type Rect = { x: number; y: number; width: number; height: number };

const PAD = 8;

function DimWithHole({ rect, containerHeight }: { rect: Rect; containerHeight: number }) {
  const hx = Math.max(0, rect.x - PAD);
  const hy = Math.max(0, rect.y - PAD);
  const hw = rect.width + 2 * PAD;
  const hh = rect.height + 2 * PAD;
  const botTop = hy + hh;
  const bottomDimH = Math.max(0, containerHeight - botTop);

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
        style={[styles.dim, { position: 'absolute', left: 0, right: 0, top: botTop, height: bottomDimH }]}
        onPress={() => {}}
      />
    </>
  );
}

function FullDim() {
  return <Pressable style={[StyleSheet.absoluteFillObject, styles.dim]} onPress={() => {}} />;
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

/** Convert measureInWindow (window) coords to coords inside this overlay (Tab screen content). */
function toLocalRect(windowRect: Rect, overlayWx: number, overlayWy: number): Rect {
  return {
    x: windowRect.x - overlayWx,
    y: windowRect.y - overlayWy,
    width: windowRect.width,
    height: windowRect.height,
  };
}

function clampRect(r: Rect, maxW: number, maxH: number): Rect {
  const x = Math.max(0, Math.min(r.x, maxW - 8));
  const y = Math.max(0, Math.min(r.y, maxH - 8));
  const width = Math.max(8, Math.min(r.width, maxW - x));
  const height = Math.max(8, Math.min(r.height, maxH - y));
  return { x, y, width, height };
}

export default function CheckTourOverlay({ step, highlightRect, onSkip, onNext, onDone }: Props) {
  const insets = useSafeAreaInsets();
  const { height: windowH } = useWindowDimensions();
  const rootRef = useRef<View>(null);
  const [overlayFrame, setOverlayFrame] = useState({ w: 0, h: 0, wx: 0, wy: 0 });

  const measureOverlay = useCallback(() => {
    rootRef.current?.measureInWindow((wx, wy, w, h) => {
      setOverlayFrame({ w, h, wx, wy });
    });
  }, []);

  useLayoutEffect(() => {
    measureOverlay();
  }, [measureOverlay, step, highlightRect, windowH]);

  const localRect = useMemo(() => {
    if (!highlightRect || overlayFrame.h < 1) return null;
    return clampRect(toLocalRect(highlightRect, overlayFrame.wx, overlayFrame.wy), overlayFrame.w, overlayFrame.h);
  }, [highlightRect, overlayFrame]);

  /** Space from bottom of highlight hole to bottom of overlay (for choosing panel position). */
  const spaceBelowHole = useMemo(() => {
    if (!localRect || overlayFrame.h < 1) return overlayFrame.h;
    const holeBottom = localRect.y + localRect.height + 2 * PAD;
    return Math.max(0, overlayFrame.h - holeBottom);
  }, [localRect, overlayFrame.h]);

  /** If bottom area is too tight, pin panel to top so buttons stay visible. */
  const panelPinTop = Boolean(localRect && spaceBelowHole < 168);

  const bottomPad = Math.max(insets.bottom, 12);
  const panelMaxH = Math.min(
    Math.round(overlayFrame.h > 0 ? overlayFrame.h * 0.52 : windowH * 0.45),
    340,
  );

  const panelContent = (
    <>
      <Text style={styles.msg}>{MESSAGES[step]}</Text>
      <View style={styles.row}>
        <Pressable onPress={onSkip} style={styles.btnGhost} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.btnGhostText}>Skip</Text>
        </Pressable>
        {(step === 0 || step === 1) && onNext ? (
          <Pressable onPress={onNext} style={styles.btnPrimary} hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}>
            <Text style={styles.btnPrimaryText}>{step === 1 ? 'Continue' : 'Next'}</Text>
          </Pressable>
        ) : null}
        {step === 2 && onDone ? (
          <Pressable onPress={onDone} style={styles.btnPrimary} hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}>
            <Text style={styles.btnPrimaryText}>Done</Text>
          </Pressable>
        ) : null}
      </View>
    </>
  );

  if (!highlightRect) {
    return (
      <View ref={rootRef} style={[styles.root, { paddingBottom: bottomPad }]} onLayout={measureOverlay} pointerEvents="box-none">
        <FullDim />
        <View style={[styles.panelOuter, { marginHorizontal: SPACING.screenPadding }]} pointerEvents="auto">
          <ScrollView
            style={{ maxHeight: panelMaxH }}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            bounces={false}
            showsVerticalScrollIndicator
          >
            <View style={styles.panel}>{panelContent}</View>
          </ScrollView>
        </View>
      </View>
    );
  }

  const containerH = overlayFrame.h > 0 ? overlayFrame.h : windowH;

  return (
    <View
      ref={rootRef}
      style={styles.rootFill}
      onLayout={measureOverlay}
      pointerEvents="box-none"
    >
      {localRect && overlayFrame.h > 0 ? (
        <DimWithHole rect={localRect} containerHeight={containerH} />
      ) : (
        <FullDim />
      )}

      <View
        style={[
          styles.panelOuter,
          panelPinTop
            ? {
                position: 'absolute',
                left: 0,
                right: 0,
                top: insets.top + 8,
                paddingHorizontal: SPACING.screenPadding,
              }
            : {
                flex: 1,
                justifyContent: 'flex-end',
                paddingHorizontal: SPACING.screenPadding,
                paddingBottom: bottomPad,
              },
        ]}
        pointerEvents="box-none"
      >
        <ScrollView
          style={{ maxHeight: panelMaxH }}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          bounces={false}
          showsVerticalScrollIndicator
        >
          <View style={styles.panel}>{panelContent}</View>
        </ScrollView>
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
  rootFill: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    elevation: 9999,
  },
  dim: {
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  panelOuter: {
    width: '100%',
    zIndex: 10001,
    elevation: 10001,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 4,
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
    flexWrap: 'wrap',
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
    minWidth: 88,
    alignItems: 'center',
  },
  btnPrimaryText: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '700',
  },
});
