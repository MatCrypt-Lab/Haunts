import { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  LIMITS,
  cellInZones,
  deviceDayKey,
  getCity,
  getNeighbourhood,
  latLngToCell,
  placeForCell,
  type DropDetails,
  type VisitsResult,
} from '@unfog/core';
import { Button, Card, Field, Screen, T } from '@/components/ui';
import { space } from '@/constants/theme';
import { api, errorMessage } from '@/lib/api';
import { addVisits } from '@/lib/local-db';
import { keys } from '@/lib/queries';
import { getZones } from '@/lib/zones';

export default function NewDropScreen() {
  const queryClient = useQueryClient();
  const [cell, setCell] = useState<string | null>(null);
  const [where, setWhere] = useState<string>('Finding you...');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        const c = latLngToCell(p);
        if (cellInZones(c, await getZones())) {
          setBlocked('You are inside a private zone. Drops cannot be placed here.');
          return;
        }
        const place = placeForCell(c);
        if (!place) {
          setBlocked('Drops can only be placed inside a supported city.');
          return;
        }
        const city = getCity(place.cityId);
        setWhere(`${getNeighbourhood(city!, place.neighbourhoodId)?.name ?? ''}, ${city?.name ?? ''}`);
        setCell(c);
      } catch (err) {
        setBlocked(errorMessage(err));
      }
    })();
  }, []);

  const save = async () => {
    if (!cell) return;
    setBusy(true);
    try {
      // The server only accepts drops in blocks you have visited, so record this one directly
      // instead of waiting for the upload queue.
      const visit = { cell, day: deviceDayKey() };
      await addVisits([visit]);
      await api<VisitsResult>('/visits', { method: 'POST', body: { visits: [visit] } });
      await api<DropDetails>('/drops', { method: 'POST', body: { cell, title: title.trim(), ...(note.trim() ? { note: note.trim() } : {}) } });
      await queryClient.invalidateQueries({ queryKey: keys.drops });
      router.back();
    } catch (err) {
      Alert.alert('Could not leave the drop', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={['bottom']}>
      <T muted>
        Leave a tip for whoever explores this block next: a great chai stall, a mural, a rooftop. They only see it when
        they get here. You can leave {LIMITS.communityDropsPerWeek} a week.
      </T>
      {blocked ? (
        <Card>
          <T>{blocked}</T>
        </Card>
      ) : (
        <Card style={{ gap: space.md }}>
          <T variant="label" muted>{where}</T>
          <Field label="What is here?" value={title} onChangeText={setTitle} placeholder="Best filter coffee in the area" maxLength={60} />
          <Field label="Note (optional)" value={note} onChangeText={setNote} placeholder="Ask for the off-menu one" maxLength={280} multiline style={{ minHeight: 90, paddingTop: 14 }} />
          <Button title="Leave drop" onPress={save} loading={busy} disabled={!cell || title.trim().length < 3} />
        </Card>
      )}
    </Screen>
  );
}
