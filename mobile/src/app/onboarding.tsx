import { useEffect, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import * as Location from 'expo-location';
import { DEFAULT_PRIVACY_RADIUS_M, PRIVACY_RADIUS_OPTIONS_M, type Me } from '@unfog/core';
import { Button, Card, Field, Row, Screen, T } from '@/components/ui';
import { colors, radius, space } from '@/constants/theme';
import { api, errorMessage } from '@/lib/api';
import { useAuth, useMe } from '@/lib/auth';
import { addZone, pullCells } from '@/lib/sync';
import { getPermissionState, requestBackground, requestForeground, startTracking } from '@/lib/tracking';
import { getZones } from '@/lib/zones';

type Step = 'profile' | 'location' | 'privacy';

export default function Onboarding() {
  const me = useMe();
  const [step, setStep] = useState<Step>(me.username ? 'location' : 'profile');
  return (
    <Screen edges={['top', 'bottom']}>
      <Steps current={step} />
      {step === 'profile' && <ProfileStep onDone={() => setStep('location')} />}
      {step === 'location' && <LocationStep onDone={() => setStep('privacy')} />}
      {step === 'privacy' && <PrivacyStep />}
    </Screen>
  );
}

function Steps({ current }: { current: Step }) {
  const order: Step[] = ['profile', 'location', 'privacy'];
  const idx = order.indexOf(current);
  return (
    <Row>
      {order.map((s, i) => (
        <View key={s} style={[styles.dot, { backgroundColor: i <= idx ? colors.accent : colors.surfaceRaised }]} />
      ))}
    </Row>
  );
}

function ProfileStep({ onDone }: { onDone: () => void }) {
  const me = useMe();
  const { setMe } = useAuth();
  const [username, setUsername] = useState(me.username ?? '');
  const [displayName, setDisplayName] = useState(me.displayName ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = /^[a-zA-Z0-9_.]{3,20}$/.test(username);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const updated = await api<Me>('/me', {
        method: 'PATCH',
        body: { username, ...(displayName.trim() ? { displayName: displayName.trim() } : {}) },
      });
      setMe(updated);
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.step}>
      <T variant="title">Pick your handle</T>
      <T muted>This is what your crew and your story cards show.</T>
      <Field
        label="Username"
        value={username}
        onChangeText={(v) => setUsername(v.replace(/\s/g, ''))}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="priya.walks"
        maxLength={20}
        error={error}
      />
      <Field label="Name (optional)" value={displayName} onChangeText={setDisplayName} placeholder="Priya" maxLength={40} />
      <Button title="Continue" onPress={save} loading={busy} disabled={!valid} />
    </View>
  );
}

function LocationStep({ onDone }: { onDone: () => void }) {
  const [fg, setFg] = useState<Location.PermissionStatus | null>(null);
  const [bg, setBg] = useState<Location.PermissionStatus | null>(null);

  const refresh = async () => {
    const s = await getPermissionState();
    setFg(s.foreground);
    setBg(s.background);
  };
  useEffect(() => {
    let alive = true;
    void getPermissionState().then((s) => {
      if (!alive) return;
      setFg(s.foreground);
      setBg(s.background);
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <View style={styles.step}>
      <T variant="title">Let Haunts see where you go</T>
      <Card style={{ gap: space.sm, borderColor: colors.accent }}>
        <T style={{ fontWeight: '700' }}>
          Haunts collects location data to reveal the map of places you visit, even when the app is closed or not in use.
        </T>
        <T muted variant="small">
          Your phone turns locations into map blocks before anything leaves it. Nobody sees where you are right now. Your
          crew only sees blocks from yesterday and earlier, never with times. Private zones are never recorded. You can
          pause or delete everything anytime.
        </T>
      </Card>

      <Card style={{ gap: space.md }}>
        <T variant="heading">1. While using the app</T>
        {fg === 'granted' ? (
          <T style={{ color: colors.success }}>Allowed</T>
        ) : (
          <Button
            title="Allow location"
            onPress={async () => {
              const ok = await requestForeground();
              if (!ok && fg === 'denied') void Linking.openSettings();
              await refresh();
            }}
          />
        )}
      </Card>

      <Card style={{ gap: space.md, opacity: fg === 'granted' ? 1 : 0.5 }}>
        <T variant="heading">2. Always</T>
        <T muted variant="small">
          {Platform.OS === 'android'
            ? 'Android opens settings. Choose "Allow all the time" so your map keeps filling in with the app closed.'
            : 'Choose "Change to Always Allow" so your map keeps filling in with the app closed.'}
        </T>
        {bg === 'granted' ? (
          <T style={{ color: colors.success }}>Allowed</T>
        ) : (
          <Button
            title="Allow all the time"
            disabled={fg !== 'granted'}
            onPress={async () => {
              const ok = await requestBackground();
              if (!ok) void Linking.openSettings();
              await refresh();
            }}
          />
        )}
      </Card>

      <Button title={bg === 'granted' ? 'Continue' : 'Continue without background'} variant={bg === 'granted' ? 'primary' : 'secondary'} onPress={onDone} disabled={fg !== 'granted'} />
      {fg !== 'granted' ? <T variant="small" muted>Haunts needs location to work. You can change this later in Settings.</T> : null}
    </View>
  );
}

function PrivacyStep() {
  const { markOnboarded } = useAuth();
  const [radiusM, setRadiusM] = useState<number>(DEFAULT_PRIVACY_RADIUS_M);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getZones().then((z) => setSaved(z.some((x) => x.id === 'home')));
  }, []);

  const blurHome = async () => {
    setBusy(true);
    setError(null);
    try {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      await addZone({ id: 'home', label: 'Home', lat: pos.coords.latitude, lng: pos.coords.longitude, radiusM });
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    setBusy(true);
    await startTracking().catch(() => {});
    void pullCells().catch(() => {});
    await markOnboarded();
  };

  return (
    <View style={styles.step}>
      <T variant="title">Blur your home</T>
      <T muted>
        Stand at home and tap below. Haunts will never record anything inside this circle. It is stored only on this phone.
      </T>
      <Row style={{ flexWrap: 'wrap' }}>
        {PRIVACY_RADIUS_OPTIONS_M.map((r) => (
          <Pressable
            key={r}
            onPress={() => setRadiusM(r)}
            accessibilityRole="button"
            accessibilityState={{ selected: r === radiusM }}
            style={[styles.option, r === radiusM && styles.optionOn]}>
            <T style={{ fontWeight: '700' }}>{r} m</T>
          </Pressable>
        ))}
      </Row>
      {saved ? (
        <T style={{ color: colors.success }}>Home is blurred. You can add work or others later in Me, Private zones.</T>
      ) : (
        <Button title="I'm at home, blur it" variant="secondary" onPress={blurHome} loading={busy} />
      )}
      {error ? <T style={{ color: colors.danger }}>{error}</T> : null}
      <Button title={saved ? 'Start exploring' : 'Skip for now'} variant={saved ? 'primary' : 'ghost'} onPress={finish} loading={busy && saved} />
    </View>
  );
}

const styles = StyleSheet.create({
  step: { gap: space.lg },
  dot: { flex: 1, height: 4, borderRadius: 2 },
  option: { paddingHorizontal: space.lg, paddingVertical: space.md, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  optionOn: { borderColor: colors.accent },
});
