import { useMemo, useRef, useState } from 'react';
import { Alert, View, useWindowDimensions } from 'react-native';
import * as Sharing from 'expo-sharing';
import { captureRef } from 'react-native-view-shot';
import { DEFAULT_SOLO_COLOR, cityBBox, cellToLatLng, getCity } from '@unfog/core';
import { StoryCard } from '@/components/story-card';
import { Button, Screen, T } from '@/components/ui';
import { space } from '@/constants/theme';
import { useMe } from '@/lib/auth';
import { useStats } from '@/lib/queries';
import { useLocalCells } from '@/lib/use-cells';

export default function CardScreen() {
  const me = useMe();
  const stats = useStats();
  const { cells } = useLocalCells();
  const { width } = useWindowDimensions();
  const cardRef = useRef<View>(null);
  const [busy, setBusy] = useState(false);

  const city = getCity(me.cityId);
  // Paint only the home city so a holiday does not shrink the city to a dot.
  const cityCells = useMemo(() => {
    if (!city) return cells;
    const b = cityBBox(city);
    return cells.filter((c) => {
      const p = cellToLatLng(c);
      return p.lat >= b.south && p.lat <= b.north && p.lng >= b.west && p.lng <= b.east;
    });
  }, [cells, city]);

  const pct = stats.data?.city?.pct ?? 0;
  const cityName = stats.data?.city?.name ?? city?.name ?? 'my city';
  const blocks = stats.data?.city?.explored ?? cityCells.length;
  const headline = pct >= 1 ? `${pct.toFixed(1)}%` : blocks.toLocaleString();
  const subline = pct >= 1 ? `of ${cityName} explored` : `blocks of ${cityName} explored`;
  const cardWidth = Math.min(width - space.lg * 2, 420);

  const share = async () => {
    setBusy(true);
    try {
      const uri = await captureRef(cardRef, { format: 'png', quality: 1, width: 1080, height: 1920, result: 'tmpfile' });
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert('Sharing unavailable', 'This device cannot share images.');
        return;
      }
      await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: 'Share your map', UTI: 'public.png' });
    } catch (err) {
      Alert.alert('Could not create the card', err instanceof Error ? err.message : 'Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <View style={{ gap: space.xs }}>
        <T variant="title">Your card</T>
        <T muted>Share it to your Story. Pick Instagram, then Story, from the share sheet.</T>
      </View>
      <View style={{ alignItems: 'center' }}>
        <StoryCard
          ref={cardRef}
          width={cardWidth}
          cells={cityCells}
          color={me.crew?.color ?? DEFAULT_SOLO_COLOR}
          headline={headline}
          subline={subline}
          handle={me.username ? `@${me.username}` : ''}
          crewName={me.crew?.name ?? null}
          weekBlocks={stats.data?.weekCellDays ?? 0}
        />
      </View>
      <Button title="Share card" onPress={share} loading={busy} disabled={cityCells.length === 0} />
      {cityCells.length === 0 ? <T muted>Go for a walk first. Your card fills in as you explore.</T> : null}
    </Screen>
  );
}
