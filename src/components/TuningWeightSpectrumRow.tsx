import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, type LayoutChangeEvent } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS } from '../constants/theme';
import {
  COMMON_PENALTY_LEVEL_MAX,
  commonPenalty01FromLevel,
  commonPenaltyLevelFrom01,
  getWeightIndication,
  type FeatureDef,
} from '../constants/strategyFeatures';

type Props = {
  feature: FeatureDef;
  weight01: number;
  accentColor: string;
  locked: boolean;
  onOpenSheet: () => void;
  onPaywall: () => void;
  /** Common penalty: tap a gear dot to commit without opening the sheet. */
  onCommitWeight01?: (w01: number) => void;
};

function formatTitle(label: string): string {
  return label.split('/').join(' / ');
}

function valueColorForPct(pct: number): string {
  if (pct > 50) return COLORS.success;
  if (pct < 50) return COLORS.warning;
  return COLORS.gold;
}

/** Structure row: >50 blue, <50 red, 50 purple (thumb, arrow, slide number, indication number). */
function structureAccentForPct(pct: number): string {
  if (pct > 50) return '#2563eb';
  if (pct < 50) return '#ef4444';
  return '#9333ea';
}

/** Trend row: >50 red, <50 yellow, 50 white */
function trendAccentForPct(pct: number): string {
  if (pct > 50) return '#ef4444';
  if (pct < 50) return '#fbbf24';
  return '#ffffff';
}

/** Horizontal spacing between samples on the right half (logic px); 1 ≈ smoothest for View-segment polyline. */
const TREND_SAMPLE_DX = 1;
const TREND_STROKE_PX = 2;

type TrendPt = { x: number; y: number };

function trendWaveY(midY: number, half: number, x: number): number {
  const u = (x - half) / half;
  const amp = 6 * (0.12 + 0.88 * u);
  return midY + Math.sin(u * Math.PI * 2 * 3.5) * amp;
}

function buildTrendPolylinePoints(w: number, h: number): TrendPt[] {
  if (w <= 0 || h <= 0) return [];
  const midY = h / 2;
  const half = w / 2;
  const pts: TrendPt[] = [
    { x: 0, y: midY },
    { x: half, y: midY },
  ];
  let x = half;
  while (x < w - 1e-6) {
    x = Math.min(x + TREND_SAMPLE_DX, w);
    pts.push({ x, y: trendWaveY(midY, half, x) });
  }
  return pts;
}

/**
 * Continuous polyline without react-native-svg (Fabric/Android crash with SVG polyline).
 * Each edge is a thin View rotated around its left centre.
 */
function TrendOscillationTrack({ lineColor }: { lineColor: string }) {
  const [layout, setLayout] = useState({ w: 0, h: 28 });

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width > 0 && height > 0) {
      setLayout({ w: width, h: height });
    }
  }, []);

  const segments = useMemo(() => {
    const { w, h } = layout;
    if (w <= 0 || h <= 0) return [];
    const pts = buildTrendPolylinePoints(w, h);
    const out: {
      key: string;
      left: number;
      top: number;
      width: number;
      rotateDeg: number;
    }[] = [];
    const halfStroke = TREND_STROKE_PX / 2;
    for (let i = 0; i < pts.length - 1; i++) {
      const x0 = pts[i].x;
      const y0 = pts[i].y;
      const x1 = pts[i + 1].x;
      const y1 = pts[i + 1].y;
      const dx = x1 - x0;
      const dy = y1 - y0;
      const len = Math.hypot(dx, dy);
      if (len < 0.2) continue;
      const rotateDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
      out.push({
        key: `e${i}`,
        left: x0,
        top: y0 - halfStroke,
        width: len,
        rotateDeg,
      });
    }
    return out;
  }, [layout]);

  return (
    <View style={trendTrackStyles.root} pointerEvents="none" onLayout={onLayout}>
      {segments.map((s) => (
        <View
          key={s.key}
          pointerEvents="none"
          style={[
            trendTrackStyles.edge,
            {
              left: s.left,
              top: s.top,
              width: s.width,
              backgroundColor: lineColor,
              transform: [{ rotate: `${s.rotateDeg}deg` }],
              transformOrigin: 'left center',
            },
          ]}
        />
      ))}
    </View>
  );
}

const trendTrackStyles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
  },
  edge: {
    position: 'absolute',
    height: TREND_STROKE_PX,
    borderRadius: 1,
  },
});

export function TuningWeightSpectrumRow({
  feature,
  weight01,
  accentColor,
  locked,
  onOpenSheet,
  onPaywall,
  onCommitWeight01,
}: Props) {
  const w = Math.max(0, Math.min(1, weight01));
  const pct = useMemo(() => Math.round(w * 100), [w]);
  const indication = useMemo(() => getWeightIndication(feature, w), [feature, w]);
  const isPosition = feature.category === 'position';
  const isStructure = feature.category === 'structure';
  const isTrend = feature.category === 'trend';
  const isCommonPenalty = feature.id === 'common_pattern_penalty';
  const commonLevel = useMemo(() => commonPenaltyLevelFrom01(w), [w]);
  const trackAccent = isStructure
    ? structureAccentForPct(pct)
    : isTrend
      ? trendAccentForPct(pct)
      : accentColor;

  return (
    <View style={styles.wrap}>
      <View style={styles.titleGearRow}>
        <Text style={styles.title} numberOfLines={2}>
          {formatTitle(feature.label)}
        </Text>
        <TouchableOpacity
          style={styles.gearBtnTitle}
          onPress={() => (locked ? onPaywall() : onOpenSheet())}
          accessibilityRole="button"
          accessibilityLabel={locked ? `${feature.label} locked` : `Adjust ${feature.label}`}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          {locked ? (
            <Ionicons name="lock-closed" size={22} color={COLORS.textMuted} />
          ) : isPosition ? (
            <Ionicons name="flask" size={24} color={COLORS.gold} />
          ) : isTrend ? (
            <Ionicons name="trending-up" size={24} color={COLORS.gold} />
          ) : isCommonPenalty ? (
            <MaterialCommunityIcons name="car-shift-pattern" size={24} color={COLORS.gold} />
          ) : (
            <Ionicons name="cog-outline" size={24} color={COLORS.gold} />
          )}
        </TouchableOpacity>
      </View>
      <Text style={[styles.valueIndication, locked && styles.muted]}>
        {locked ? (
          '-'
        ) : isPosition ? (
          <>
            <Text style={[styles.valuePctColored, { color: valueColorForPct(pct) }]}>{pct}</Text>
            <Text style={styles.valueIndicationRest}> ({indication})</Text>
          </>
        ) : isStructure ? (
          <>
            <Text style={[styles.valuePctColored, { color: structureAccentForPct(pct) }]}>{pct}</Text>
            <Text style={styles.valueIndicationRest}> ({indication})</Text>
          </>
        ) : isTrend ? (
          <>
            <Text style={[styles.valuePctColored, { color: trendAccentForPct(pct) }]}>{pct}</Text>
            <Text style={styles.valueIndicationRest}> ({indication})</Text>
          </>
        ) : isCommonPenalty ? (
          <>
            <Text style={[styles.valuePctColored, { color: accentColor }]}>{commonLevel}</Text>
            <Text style={styles.valueIndicationRest}> ({indication})</Text>
          </>
        ) : (
          `${pct} (${indication})`
        )}
      </Text>
      {!isPosition ? (
        isCommonPenalty ? (
          <View style={styles.spectrumBlock}>
            <View style={styles.spectrumPoleRow}>
              <Text style={[styles.pole, styles.poleLeft, locked && styles.muted]} numberOfLines={2}>
                {feature.spectrumLeft}
              </Text>
              <Text style={[styles.pole, styles.poleRight, locked && styles.muted]} numberOfLines={2}>
                {feature.spectrumRight}
              </Text>
            </View>
            <View style={styles.trackColumn}>
              <View style={styles.gearDotTrackWrap}>
                <View style={styles.gearDotLine} />
                <View style={styles.gearDotsRow}>
                  {Array.from({ length: COMMON_PENALTY_LEVEL_MAX + 1 }, (_, lvl) => lvl).map((lvl) => {
                    const active = lvl === commonLevel;
                    return (
                      <TouchableOpacity
                        key={lvl}
                        style={styles.gearDotHit}
                        disabled={locked || !onCommitWeight01}
                        onPress={() => onCommitWeight01?.(commonPenalty01FromLevel(lvl))}
                        accessibilityRole="button"
                        accessibilityLabel={`Common penalty level ${lvl}`}
                        hitSlop={{ top: 10, bottom: 10, left: 4, right: 4 }}
                      >
                        <View
                          style={[
                            styles.gearDot,
                            active && styles.gearDotActive,
                            active && { borderColor: accentColor, backgroundColor: accentColor },
                          ]}
                        />
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
              <View style={styles.pointerRow}>
                {!locked ? (
                  <View
                    style={[
                      styles.pointerCluster,
                      {
                        left: `${(commonLevel / COMMON_PENALTY_LEVEL_MAX) * 100}%`,
                        marginLeft: -20,
                      },
                    ]}
                  >
                    <Ionicons name="chevron-up" size={14} color={accentColor} style={styles.pointerArrow} />
                    <Text style={[styles.pointerValue, { color: accentColor }]}>{commonLevel}</Text>
                  </View>
                ) : null}
              </View>
            </View>
          </View>
        ) : (
          <View style={styles.spectrumBlock}>
            <View style={styles.spectrumPoleRow}>
              <Text style={[styles.pole, styles.poleLeft, locked && styles.muted]} numberOfLines={2}>
                {feature.spectrumLeft}
              </Text>
              <Text style={[styles.pole, styles.poleRight, locked && styles.muted]} numberOfLines={2}>
                {feature.spectrumRight}
              </Text>
            </View>
            <View style={styles.trackColumn}>
              <View style={[styles.trackArea, isTrend && styles.trackAreaTrend]}>
                {isTrend ? (
                  <TrendOscillationTrack lineColor={trackAccent} />
                ) : (
                  <View style={styles.trackLine} />
                )}
                <View style={[styles.tick, styles.tickLeft]} />
                <View style={[styles.tick, styles.tickMid]} />
                <View style={[styles.tick, styles.tickRight]} />
                {!locked ? (
                  <View
                    style={[
                      styles.thumb,
                      {
                        left: `${w * 100}%`,
                        borderColor: trackAccent,
                        backgroundColor: trackAccent,
                      },
                    ]}
                  />
                ) : null}
              </View>
              <View style={styles.pointerRow}>
                {!locked ? (
                  <View
                    style={[
                      styles.pointerCluster,
                      {
                        left: `${w * 100}%`,
                        marginLeft: -20,
                      },
                    ]}
                  >
                    <Ionicons name="chevron-up" size={14} color={trackAccent} style={styles.pointerArrow} />
                    <Text style={[styles.pointerValue, { color: trackAccent }]}>{pct}</Text>
                  </View>
                ) : null}
              </View>
            </View>
          </View>
        )
      ) : null}
    </View>
  );
}

const TICK = 5;

const styles = StyleSheet.create({
  wrap: {
    paddingVertical: 10,
    paddingHorizontal: 2,
  },
  titleGearRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  title: {
    flex: 1,
    minWidth: 0,
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
    letterSpacing: 0.2,
  },
  gearBtnTitle: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  valueIndication: {
    marginTop: 4,
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  valuePctColored: {
    fontSize: 15,
    fontWeight: '800',
  },
  valueIndicationRest: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  muted: {
    color: COLORS.textMuted,
    fontWeight: '600',
  },
  spectrumBlock: {
    marginTop: 10,
    width: '100%',
  },
  spectrumPoleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    gap: 10,
    marginBottom: 6,
    width: '100%',
  },
  pole: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  poleLeft: {
    flex: 1,
    minWidth: 0,
    textAlign: 'left',
  },
  poleRight: {
    flex: 1,
    minWidth: 0,
    textAlign: 'right',
  },
  trackColumn: {
    width: '100%',
  },
  trackArea: {
    height: 22,
    justifyContent: 'center',
    position: 'relative',
  },
  trackAreaTrend: {
    height: 28,
  },
  trackLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    marginTop: -1,
    height: 2,
    borderRadius: 1,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  tick: {
    position: 'absolute',
    top: '50%',
    marginTop: -(TICK / 2),
    width: TICK,
    height: TICK,
    borderRadius: TICK / 2,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.35)',
    backgroundColor: 'transparent',
  },
  tickLeft: { left: 0, marginLeft: -TICK / 2 },
  tickMid: {
    left: '50%',
    marginLeft: -(TICK / 2),
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderColor: 'rgba(255,255,255,0.45)',
  },
  tickRight: { right: 0, marginRight: -TICK / 2 },
  thumb: {
    position: 'absolute',
    top: '50%',
    marginTop: -6,
    marginLeft: -6,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
  },
  pointerRow: {
    height: 34,
    position: 'relative',
    marginTop: 2,
  },
  pointerCluster: {
    position: 'absolute',
    bottom: 0,
    width: 40,
    alignItems: 'center',
  },
  pointerArrow: {
    marginBottom: -2,
  },
  pointerValue: {
    fontSize: 13,
    fontWeight: '800',
  },
  gearDotTrackWrap: {
    height: 28,
    justifyContent: 'center',
    position: 'relative',
    marginTop: 2,
  },
  gearDotLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    marginTop: -1,
    height: 2,
    borderRadius: 1,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  gearDotsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 0,
    height: '100%',
  },
  gearDotHit: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 0,
    zIndex: 1,
  },
  gearDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.45)',
    backgroundColor: 'transparent',
  },
  gearDotActive: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
  },
});
