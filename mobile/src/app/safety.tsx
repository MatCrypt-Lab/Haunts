import { useState } from 'react';
import { Alert, Share } from 'react-native';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { Button, Screen, T } from '@/components/ui';

/** Opened from the late-night nudge. Sharing is the user's own choice, through the share sheet. */
export default function SafetyScreen() {
  const [busy, setBusy] = useState(false);
  const share = async () => {
    setBusy(true);
    try {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const { latitude: lat, longitude: lng } = pos.coords;
      await Share.share({ message: `I'm here right now: https://maps.google.com/?q=${lat.toFixed(5)},${lng.toFixed(5)}` });
    } catch {
      Alert.alert('Location unavailable', 'Turn on location services and try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen edges={['bottom']}>
      <T variant="title">All good?</T>
      <T muted>You have been somewhere new for a while, late at night. If you want someone to know where you are, send them your location. Haunts does not send it anywhere itself.</T>
      <Button title="Share my location" onPress={() => void share()} loading={busy} />
      <Button title="I'm fine" variant="secondary" onPress={() => router.back()} />
    </Screen>
  );
}
