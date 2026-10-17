import { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import * as Location from 'expo-location';
import { useFocusEffect } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { DEFAULT_PRIVACY_RADIUS_M, PRIVACY_RADIUS_OPTIONS_M, type PrivacyZone } from '@unfog/core';
import { Button, Card, Field, Row, Screen, T } from '@/components/ui';
import { colors, radius, space } from '@/constants/theme';
import { errorMessage } from '@/lib/api';
import { keys } from '@/lib/queries';
import { addZone, getZones, removeZone } from '@/lib/zones';

export default function PrivacyScreen() {
  const queryClient = useQueryClient();
  const [zones, setZones] = useState<PrivacyZone[]>([]);
  const [label, setLabel] = useState('');
  const [radiusM, setRadiusM] = useState<number>(DEFAULT_PRIVACY_RADIUS_M);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => void getZones().then(setZones), []);
  useFocusEffect(load);

  const add = async () => {
    setBusy(true);
    try {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const { removed } = await addZone({
        id: `${Date.now()}`,
        label: label.trim() || 'Private place',
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        radiusM,
      });
      setLabel('');
      load();
      void queryClient.invalidateQueries({ queryKey: keys.stats });
      Alert.alert('Zone added', removed > 0 ? `${removed} blocks inside it were erased from your map.` : 'Nothing inside it will ever be recorded.');
    } catch (err) {
      Alert.alert('Could not add zone', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={[]}>
      <T muted>
        Nothing inside a private zone is ever recorded. Zones are stored only on this phone, and the server never learns
        where they are. Adding a zone also erases blocks already recorded inside it.
      </T>
      {zones.map((z) => (
        <Card key={z.id} style={styles.zone}>
          <View style={{ flex: 1 }}>
            <T style={{ fontWeight: '700' }}>{z.label}</T>
            <T muted variant="small">{z.radiusM} m radius</T>
          </View>
          <Button
            title="Remove"
            variant="ghost"
            onPress={() =>
              Alert.alert(`Remove ${z.label}?`, 'Haunts will start recording there again.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Remove', style: 'destructive', onPress: () => void removeZone(z.id).then(load) },
              ])
            }
          />
        </Card>
      ))}
      {zones.length === 0 ? <T muted>No zones yet. Add home first.</T> : null}
      <Card style={{ gap: space.md }}>
        <T variant="heading">Add a zone where you are now</T>
        <Field value={label} onChangeText={setLabel} placeholder="Home, Work, College..." maxLength={30} />
        <Row style={{ flexWrap: 'wrap' }}>
          {PRIVACY_RADIUS_OPTIONS_M.map((r) => (
            <Pressable key={r} onPress={() => setRadiusM(r)} style={[styles.option, r === radiusM && styles.optionOn]} accessibilityRole="button">
              <T style={{ fontWeight: '700' }}>{r} m</T>
            </Pressable>
          ))}
        </Row>
        <Button title="Add zone here" onPress={add} loading={busy} />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  zone: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  option: { paddingHorizontal: space.lg, paddingVertical: space.md, borderRadius: radius.md, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border },
  optionOn: { borderColor: colors.accent },
});
