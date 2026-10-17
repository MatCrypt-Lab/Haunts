import { forwardRef, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Rect, Stop, Text as SvgText } from 'react-native-svg';
import { CELL_SIZE_M, idToAxial } from '@unfog/core';

export type StoryCardProps = {
  width: number;
  cells: readonly string[];
  color: string;
  headline: string;
  subline: string;
  handle: string;
  crewName: string | null;
  weekBlocks: number;
};

const SQRT3 = Math.sqrt(3);
/** Smallest area shown, in Mercator metres, so a few cells do not fill the whole card. */
const MIN_SPAN_M = 2500;

/**
 * A 9:16 card for Instagram Stories: the explored cells painted on black, one big line,
 * no pace or distance. Rendered as one SVG path so thousands of cells stay fast.
 */
export const StoryCard = forwardRef<View, StoryCardProps>(function StoryCard(
  { width, cells, color, headline, subline, handle, crewName, weekBlocks },
  ref,
) {
  const height = (width * 16) / 9;
  const mapTop = height * 0.3;
  const mapHeight = height * 0.52;
  const pad = width * 0.08;

  const path = useMemo(() => {
    if (cells.length === 0) return '';
    const centres = cells.map((c) => {
      const { q, r } = idToAxial(c);
      return { x: CELL_SIZE_M * SQRT3 * (q + r / 2), y: CELL_SIZE_M * 1.5 * r };
    });
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of centres) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const spanX = Math.max(maxX - minX + CELL_SIZE_M * 4, MIN_SPAN_M);
    const spanY = Math.max(maxY - minY + CELL_SIZE_M * 4, MIN_SPAN_M);
    const availW = width - pad * 2;
    const scale = Math.min(availW / spanX, mapHeight / spanY);
    const r = CELL_SIZE_M * scale * 0.92;
    const parts: string[] = [];
    for (const p of centres) {
      const sx = width / 2 + (p.x - cx) * scale;
      const sy = mapTop + mapHeight / 2 - (p.y - cy) * scale; // screen y grows downward
      let d = '';
      for (let i = 0; i < 6; i++) {
        const a = ((60 * i - 30) * Math.PI) / 180;
        d += `${i === 0 ? 'M' : 'L'}${(sx + r * Math.cos(a)).toFixed(1)} ${(sy + r * Math.sin(a)).toFixed(1)}`;
      }
      parts.push(`${d}Z`);
    }
    return parts.join('');
  }, [cells, width, pad, mapTop, mapHeight]);

  const f = width / 360; // font scale relative to a 360pt-wide card
  return (
    <View ref={ref} collapsable={false} style={[styles.card, { width, height }]}>
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#0B0B14" />
            <Stop offset="1" stopColor="#141022" />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={width} height={height} fill="url(#bg)" />
        <SvgText x={pad} y={pad + 18 * f} fill="#FFFFFF" fontSize={16 * f} fontWeight="800" letterSpacing={3 * f}>
          HAUNTS
        </SvgText>
        <SvgText x={pad} y={height * 0.17} fill="#FFFFFF" fontSize={54 * f} fontWeight="800">
          {headline}
        </SvgText>
        <SvgText x={pad} y={height * 0.17 + 30 * f} fill="#B8B8CC" fontSize={20 * f} fontWeight="600">
          {subline}
        </SvgText>
        {path ? <Path d={path} fill={color} fillOpacity={0.9} /> : null}
        {weekBlocks > 0 ? (
          <SvgText x={pad} y={height * 0.88} fill={color} fontSize={18 * f} fontWeight="800">
            {`+${weekBlocks.toLocaleString()} blocks this week`}
          </SvgText>
        ) : null}
        <SvgText x={pad} y={height * 0.93} fill="#FFFFFF" fontSize={15 * f} fontWeight="700">
          {crewName ? `${handle} · ${crewName}` : handle}
        </SvgText>
      </Svg>
    </View>
  );
});

const styles = StyleSheet.create({
  card: { overflow: 'hidden', borderRadius: 4, backgroundColor: '#0B0B14' },
});
