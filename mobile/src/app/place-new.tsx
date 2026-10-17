import { Alert } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { PlaceForm } from '@/components/place-form';
import { Screen, T } from '@/components/ui';
import { savePlace } from '@/lib/memory';

export default function NewPlaceScreen() {
  const params = useLocalSearchParams<{ lat: string; lng: string; name?: string }>();
  const lat = Number(params.lat);
  const lng = Number(params.lng);
  const valid = Number.isFinite(lat) && Number.isFinite(lng);
  return (
    <Screen edges={['bottom']}>
      <T muted>Every past and future visit within about 80 m is grouped under this place. It stays private on your phone.</T>
      {valid ? (
        <PlaceForm
          initial={{ name: params.name ?? '', emoji: null, note: '' }}
          submitLabel="Save place"
          onSubmit={async (v) => {
            try {
              await savePlace({ name: v.name, emoji: v.emoji, note: v.note, lat, lng });
              router.back();
            } catch (err) {
              Alert.alert('Could not save', err instanceof Error ? err.message : 'Try again.');
            }
          }}
        />
      ) : (
        <T>This place could not be opened.</T>
      )}
    </Screen>
  );
}
