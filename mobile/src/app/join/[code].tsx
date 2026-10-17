import { useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Loading, Screen, T } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { keys } from '@/lib/queries';

/** Handles unfog://join/CODE invite links. */
export default function JoinCrew() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const { refreshMe } = useAuth();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        await api('/crews/join', { method: 'POST', body: { code: String(code ?? '').toUpperCase() } });
        await refreshMe();
        await queryClient.invalidateQueries({ queryKey: keys.crew });
        router.replace('/(tabs)/crew');
      } catch (err) {
        setError(errorMessage(err));
      }
    })();
  }, [code, refreshMe, queryClient]);

  if (!error) return <Loading />;
  return (
    <Screen edges={[]}>
      <T variant="heading">Could not join</T>
      <T muted>{error}</T>
      <Button title="Go to Crew" onPress={() => router.replace('/(tabs)/crew')} />
    </Screen>
  );
}
