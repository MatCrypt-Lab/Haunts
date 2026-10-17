import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Camera, GeoJSONSource, Layer, Map } from '@maplibre/maplibre-react-native';
import type { LatLng } from '@unfog/core';
import type { FeatureCollection, LineString, Point } from 'geojson';
import { colors, radius } from '@/constants/theme';
import { MAP_STYLE_URL } from '@/lib/config';
import type { StayView } from '@/lib/memory';

/** A small, still map of one day: the route as a line and each stop as a dot. */
export function DayMap({ segments, stays, color }: { segments: LatLng[][]; stays: StayView[]; color: string }) {
  const { lines, dots, bounds } = useMemo(() => {
    const lines: FeatureCollection<LineString> = {
      type: 'FeatureCollection',
      features: segments
        .filter((s) => s.length > 1)
        .map((s) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: s.map((p) => [p.lng, p.lat]) } })),
    };
    const dots: FeatureCollection<Point, { saved: number }> = {
      type: 'FeatureCollection',
      features: stays.map((s) => ({ type: 'Feature', properties: { saved: s.saved ? 1 : 0 }, geometry: { type: 'Point', coordinates: [s.lng, s.lat] } })),
    };
    const all = [...segments.flat(), ...stays];
    if (all.length === 0) return { lines, dots, bounds: null };
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    for (const p of all) {
      w = Math.min(w, p.lng);
      e = Math.max(e, p.lng);
      s = Math.min(s, p.lat);
      n = Math.max(n, p.lat);
    }
    // At least about 600 m across, so a single stop is not zoomed to street-sign level.
    const minSpan = 0.006;
    if (e - w < minSpan) [w, e] = [(w + e) / 2 - minSpan / 2, (w + e) / 2 + minSpan / 2];
    if (n - s < minSpan) [s, n] = [(s + n) / 2 - minSpan / 2, (s + n) / 2 + minSpan / 2];
    return { lines, dots, bounds: [w, s, e, n] as [number, number, number, number] };
  }, [segments, stays]);

  if (!bounds) return null;
  return (
    <View style={styles.wrap}>
      <Map style={styles.map} mapStyle={MAP_STYLE_URL} logo={false} compass={false} dragPan={false} touchZoom={false} touchRotate={false} touchPitch={false} doubleTapZoom={false} attributionPosition={{ bottom: 4, left: 4 }}>
        <Camera initialViewState={{ bounds, padding: { top: 30, right: 30, bottom: 30, left: 30 } }} />
        <GeoJSONSource id="day-route" data={lines}>
          <Layer id="day-route-line" type="line" layout={{ 'line-cap': 'round', 'line-join': 'round' }} paint={{ 'line-color': color, 'line-width': 3, 'line-opacity': 0.9 }} />
        </GeoJSONSource>
        <GeoJSONSource id="day-stops" data={dots}>
          <Layer
            id="day-stop-dot"
            type="circle"
            paint={{
              'circle-radius': 7,
              'circle-color': ['case', ['==', ['get', 'saved'], 1], '#FFFFFF', color],
              'circle-stroke-color': '#000000',
              'circle-stroke-width': 2,
            }}
          />
        </GeoJSONSource>
      </Map>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { height: 240, borderRadius: radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
  map: { flex: 1 },
});
