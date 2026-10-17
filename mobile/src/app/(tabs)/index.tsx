import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { router, useFocusEffect } from 'expo-router';
import { Camera, GeoJSONSource, Layer, Map, UserLocation, type CameraRef } from '@maplibre/maplibre-react-native';
import { useQueryClient } from '@tanstack/react-query';
import { DEFAULT_CITY_ID, DEFAULT_SOLO_COLOR, cityCenter, getCity, type DropDetails } from '@unfog/core';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { T } from '@/components/ui';
import { colors, radius, space } from '@/constants/theme';
import { api, errorMessage } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { MAP_STYLE_URL } from '@/lib/config';
import {
  DETAIL_ZOOM,
  EMPTY_FC,
  WORLD_FOG,
  cellsToGeoJSON,
  cellsToPoints,
  crewCellsToGeoJSON,
  inBounds,
  padBounds,
  pointsToGeoJSON,
  type Bounds,
} from '@/lib/geo';
import { keys, useCrewMap, useDrops, useStats, useTerritory } from '@/lib/queries';
import { getPermissionState, isTrackingEnabled, isTrackingRunning, watchForeground } from '@/lib/tracking';
import { useLocalCells } from '@/lib/use-cells';

type LayerMode = 'me' | 'crew' | 'territory';
type TrackingBadge = 'on' | 'paused' | 'foreground' | 'off';

export default function MapScreen() {
  const me = useMe();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const cameraRef = useRef<CameraRef>(null);
  const [mode, setMode] = useState<LayerMode>('me');
  const [badge, setBadge] = useState<TrackingBadge>('on');
  const [start, setStart] = useState<[number, number] | null>(null);
  // Viewport, padded so small pans do not rebuild the layers.
  const [view, setView] = useState<{ zoom: number; bounds: Bounds | null }>({ zoom: 14, bounds: null });

  const { cells } = useLocalCells();
  const stats = useStats();
  const drops = useDrops();
  const territory = useTerritory();
  const crewMap = useCrewMap(mode === 'crew' && !!me.crew);
  const color = me.crew?.color ?? DEFAULT_SOLO_COLOR;

  // Start where the user is, else the centre of their city.
  useEffect(() => {
    (async () => {
      const last = await Location.getLastKnownPositionAsync().catch(() => null);
      if (last) setStart([last.coords.longitude, last.coords.latitude]);
      else {
        const c = cityCenter(getCity(me.cityId) ?? getCity(DEFAULT_CITY_ID)!);
        setStart([c.lng, c.lat]);
      }
    })();
  }, [me.cityId]);

  // Live, precise reveal while the map is on screen.
  useFocusEffect(
    useCallback(() => {
      let sub: Location.LocationSubscription | null = null;
      let cancelled = false;
      void watchForeground().then((s) => {
        if (cancelled) s?.remove();
        else sub = s;
      });
      void (async () => {
        const [perm, enabled, running] = await Promise.all([getPermissionState(), isTrackingEnabled(), isTrackingRunning()]);
        if (!enabled) setBadge('paused');
        else if (perm.foreground !== 'granted') setBadge('off');
        else if (!running) setBadge('foreground');
        else setBadge('on');
      })();
      return () => {
        cancelled = true;
        sub?.remove();
      };
    }, []),
  );

  const detailed = view.zoom >= DETAIL_ZOOM;
  // Hexagons only near the viewport; light points for the whole map when zoomed out.
  const mine = useMemo(() => {
    if (!detailed) return EMPTY_FC;
    if (!view.bounds) return cellsToGeoJSON(cells.length <= 5000 ? cells : []);
    return cellsToGeoJSON(inBounds(cells, (c) => c, view.bounds));
  }, [cells, detailed, view.bounds]);
  const minePoints = useMemo(() => (detailed ? EMPTY_FC : cellsToPoints(cells.map((cell) => ({ cell })))), [cells, detailed]);
  const crew = useMemo(() => {
    const all = crewMap.data ?? [];
    if (mode !== 'crew' || !detailed || !view.bounds) return EMPTY_FC;
    return crewCellsToGeoJSON(inBounds(all, (c) => c.cell, view.bounds));
  }, [crewMap.data, mode, detailed, view.bounds]);
  const crewPoints = useMemo(
    () => (mode === 'crew' && !detailed ? cellsToPoints((crewMap.data ?? []).map((c) => ({ cell: c.cell, props: { m: c.members } }))) : EMPTY_FC),
    [crewMap.data, mode, detailed],
  );
  const labels = useMemo(
    () =>
      pointsToGeoJSON(
        (territory.data?.neighbourhoods ?? []).map((n) => ({
          lat: n.lat,
          lng: n.lng,
          name: n.owner ? `${n.name}\n${n.owner.name}` : n.name,
          color: n.owner?.color ?? '#8A8AA0',
        })),
      ),
    [territory.data],
  );
  const foundDrops = useMemo(
    () => pointsToGeoJSON((drops.data?.found ?? []).map((d) => ({ lat: d.lat, lng: d.lng, id: d.id }))),
    [drops.data],
  );
  const hiddenHints = useMemo(() => {
    const byNb = new globalThis.Map<string, { lat: number; lng: number; n: number }>();
    for (const h of drops.data?.hidden ?? []) {
      if (h.hintLat === null || h.hintLng === null || !h.neighbourhoodId) continue;
      const e = byNb.get(h.neighbourhoodId) ?? { lat: h.hintLat, lng: h.hintLng, n: 0 };
      e.n++;
      byNb.set(h.neighbourhoodId, e);
    }
    return pointsToGeoJSON([...byNb.values()].map((v) => ({ lat: v.lat, lng: v.lng, label: `${v.n} hidden drop${v.n > 1 ? 's' : ''}` })));
  }, [drops.data]);

  const recenter = async () => {
    try {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      cameraRef.current?.flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 15, duration: 800 });
    } catch {
      Alert.alert('Location unavailable', 'Turn on location services to find yourself on the map.');
    }
  };

  const openDrop = (d: DropDetails) => {
    const buttons: { text: string; style?: 'destructive' | 'cancel'; onPress?: () => void }[] = [{ text: 'Close', style: 'cancel' }];
    if (d.kind === 'community' && !d.isMine) {
      buttons.unshift({
        text: 'Report',
        style: 'destructive',
        onPress: () =>
          void api(`/drops/${d.id}/report`, { method: 'POST' })
            .then(() => queryClient.invalidateQueries({ queryKey: keys.drops }))
            .then(() => Alert.alert('Reported', 'Thanks. Drops with several reports are hidden.'))
            .catch((e) => Alert.alert('Could not report', errorMessage(e))),
      });
    }
    if (d.isMine) {
      buttons.unshift({
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          void api(`/drops/${d.id}`, { method: 'DELETE' })
            .then(() => queryClient.invalidateQueries({ queryKey: keys.drops }))
            .catch((e) => Alert.alert('Could not delete', errorMessage(e))),
      });
    }
    const where = d.neighbourhoodName ? ` in ${d.neighbourhoodName}` : '';
    Alert.alert(d.title, [d.sponsor ? `From ${d.sponsor}${where}` : `Community drop${where}`, d.note].filter(Boolean).join('\n\n'), buttons);
  };

  const pct = stats.data?.city?.pct ?? 0;
  const cityName = stats.data?.city?.name ?? 'your city';

  return (
    <View style={styles.fill}>
      {start ? (
        <Map
          style={styles.fill}
          mapStyle={MAP_STYLE_URL}
          logo={false}
          compass={false}
          attributionPosition={{ bottom: 8, left: 8 }}
          onRegionDidChange={(e) => {
            const { zoom, bounds } = e.nativeEvent;
            setView((prev) => {
              const inside =
                prev.bounds &&
                bounds[0] >= prev.bounds[0] &&
                bounds[1] >= prev.bounds[1] &&
                bounds[2] <= prev.bounds[2] &&
                bounds[3] <= prev.bounds[3];
              const sameDetail = prev.zoom >= DETAIL_ZOOM === zoom >= DETAIL_ZOOM;
              return inside && sameDetail ? prev : { zoom, bounds: padBounds(bounds) };
            });
          }}>
          <Camera ref={cameraRef} initialViewState={{ center: start, zoom: 14 }} />
          <GeoJSONSource id="fog" data={WORLD_FOG}>
            <Layer id="fog-fill" type="fill" paint={{ 'fill-color': '#020205', 'fill-opacity': 0.62 }} />
          </GeoJSONSource>
          {/* Every source stays mounted so layer order never changes; modes toggle visibility. */}
          <GeoJSONSource id="crew-cells" data={crew}>
            <Layer
              id="crew-fill"
              type="fill"
              layout={{ visibility: mode === 'crew' ? 'visible' : 'none' }}
              paint={{ 'fill-color': color, 'fill-opacity': ['case', ['>=', ['get', 'm'], 2], 0.7, 0.28] }}
            />
            <Layer
              id="crew-overlap"
              type="line"
              filter={['>=', ['get', 'm'], 2]}
              layout={{ visibility: mode === 'crew' ? 'visible' : 'none' }}
              paint={{ 'line-color': '#FFFFFF', 'line-width': 1, 'line-opacity': 0.8 }}
            />
          </GeoJSONSource>
          <GeoJSONSource id="crew-points" data={crewPoints}>
            <Layer
              id="crew-dots"
              type="circle"
              layout={{ visibility: mode === 'crew' ? 'visible' : 'none' }}
              paint={{
                'circle-color': color,
                'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 1, 12.5, 3],
                'circle-opacity': ['case', ['>=', ['get', 'm'], 2], 0.8, 0.35],
              }}
            />
          </GeoJSONSource>
          <GeoJSONSource id="my-cells" data={mine}>
            <Layer id="mine-fill" type="fill" paint={{ 'fill-color': color, 'fill-opacity': mode === 'crew' ? 0.25 : 0.42 }} />
            <Layer id="mine-line" type="line" paint={{ 'line-color': color, 'line-width': 0.6, 'line-opacity': 0.7 }} />
          </GeoJSONSource>
          <GeoJSONSource id="my-points" data={minePoints}>
            <Layer
              id="mine-dots"
              type="circle"
              paint={{ 'circle-color': color, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 1, 12.5, 3], 'circle-opacity': 0.8 }}
            />
          </GeoJSONSource>
          <GeoJSONSource id="territory" data={labels}>
            <Layer
              id="territory-dot"
              type="circle"
              layout={{ visibility: mode === 'territory' ? 'visible' : 'none' }}
              paint={{ 'circle-radius': 6, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#000000', 'circle-stroke-width': 1 }}
            />
            <Layer
              id="territory-label"
              type="symbol"
              layout={{
                visibility: mode === 'territory' ? 'visible' : 'none',
                'text-field': ['get', 'name'],
                'text-font': ['Noto Sans Bold'],
                'text-size': 12,
                'text-offset': [0, 1.2],
                'text-anchor': 'top',
              }}
              paint={{ 'text-color': ['get', 'color'], 'text-halo-color': '#000000', 'text-halo-width': 1.2 }}
            />
          </GeoJSONSource>
          <GeoJSONSource id="drop-hints" data={hiddenHints}>
            <Layer id="hint-ring" type="circle" paint={{ 'circle-radius': 22, 'circle-color': colors.warning, 'circle-opacity': 0.12, 'circle-stroke-color': colors.warning, 'circle-stroke-width': 1 }} />
            <Layer
              id="hint-label"
              type="symbol"
              layout={{ 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-offset': [0, 2.4] }}
              paint={{ 'text-color': colors.warning, 'text-halo-color': '#000000', 'text-halo-width': 1 }}
            />
          </GeoJSONSource>
          <GeoJSONSource
            id="found-drops"
            data={foundDrops}
            onPress={(e) => {
              const id = e.nativeEvent.features[0]?.properties?.id as string | undefined;
              const d = drops.data?.found.find((x) => x.id === id);
              if (d) openDrop(d);
            }}>
            <Layer id="drop-dot" type="circle" paint={{ 'circle-radius': 8, 'circle-color': colors.warning, 'circle-stroke-color': '#000000', 'circle-stroke-width': 2 }} />
          </GeoJSONSource>
          <UserLocation />
        </Map>
      ) : (
        <View style={[styles.fill, { backgroundColor: colors.bg }]} />
      )}

      <View pointerEvents="box-none" style={[styles.hud, { top: insets.top + space.sm }]}>
        <View style={styles.hudCard}>
          <T variant="title">{pct >= 0.01 ? `${pct.toFixed(pct < 10 ? 2 : 1)}%` : `${cells.length}`}</T>
          <T variant="small" muted>{pct >= 0.01 ? `of ${cityName} explored` : `blocks explored`}</T>
          {stats.data ? (
            <T variant="small" style={{ color }}>
              +{stats.data.weekCellDays} this week{stats.data.streakDays > 1 ? ` · ${stats.data.streakDays}-day streak` : ''}
            </T>
          ) : null}
        </View>
        <Pressable onPress={() => badge !== 'on' && (badge === 'paused' ? router.push('/(tabs)/me') : void Linking.openSettings())} style={[styles.badge, { borderColor: badge === 'on' ? colors.success : colors.warning }]}>
          <View style={[styles.badgeDot, { backgroundColor: badge === 'on' ? colors.success : colors.warning }]} />
          <T variant="small">{{ on: 'Tracking', paused: 'Paused', foreground: 'Only while open', off: 'Location off' }[badge]}</T>
        </Pressable>
      </View>

      <View pointerEvents="box-none" style={styles.bottom}>
        <View style={styles.segment}>
          {(['me', 'crew', 'territory'] as const).map((m) => (
            <Pressable
              key={m}
              onPress={() => setMode(m)}
              accessibilityRole="button"
              accessibilityState={{ selected: mode === m }}
              style={[styles.segmentItem, mode === m && styles.segmentOn]}>
              <T variant="small" style={{ fontWeight: '700', color: mode === m ? colors.accentText : colors.text }}>
                {{ me: 'Me', crew: 'Crew', territory: 'Territory' }[m]}
              </T>
            </Pressable>
          ))}
        </View>
        <View style={{ gap: space.sm }}>
          <Pressable accessibilityLabel="Leave a drop here" onPress={() => router.push('/drop-new')} style={styles.fab}>
            <Ionicons name="flag" size={20} color={colors.text} />
          </Pressable>
          <Pressable accessibilityLabel="Centre on me" onPress={recenter} style={styles.fab}>
            <Ionicons name="locate" size={22} color={colors.text} />
          </Pressable>
        </View>
      </View>
      {mode === 'crew' && !me.crew ? (
        <View style={styles.note}>
          <T variant="small">Join or start a crew to see your combined map.</T>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  hud: { position: 'absolute', left: space.lg, right: space.lg, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  hudCard: { backgroundColor: 'rgba(7,7,12,0.85)', borderRadius: radius.lg, paddingHorizontal: space.lg, paddingVertical: space.md, borderWidth: 1, borderColor: colors.border },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(7,7,12,0.85)', borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 6, borderWidth: 1 },
  badgeDot: { width: 8, height: 8, borderRadius: 4 },
  bottom: { position: 'absolute', left: space.lg, right: space.lg, bottom: space.xl, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  segment: { flexDirection: 'row', backgroundColor: 'rgba(7,7,12,0.9)', borderRadius: radius.pill, padding: 4, borderWidth: 1, borderColor: colors.border },
  segmentItem: { paddingHorizontal: space.lg, paddingVertical: space.sm, borderRadius: radius.pill },
  segmentOn: { backgroundColor: colors.accent },
  fab: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(7,7,12,0.9)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  note: { position: 'absolute', left: space.lg, right: space.lg, bottom: 90, backgroundColor: colors.surfaceRaised, borderRadius: radius.md, padding: space.md },
});
