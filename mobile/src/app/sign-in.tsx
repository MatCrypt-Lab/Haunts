import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View, type TextInput } from 'react-native';
import type { AuthResult } from '@unfog/core';
import { Button, Field, Screen, T } from '@/components/ui';
import { colors, space } from '@/constants/theme';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export default function SignIn() {
  const { completeSignIn } = useAuth();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const codeRef = useRef<TextInput>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const requestCode = async () => {
    setError(null);
    setBusy(true);
    try {
      const r = await api<{ ok: true; devCode?: string }>('/auth/otp/request', { method: 'POST', body: { email }, token: null });
      setDevCode(r.devCode ?? null);
      setStep('code');
      setCooldown(30);
      setTimeout(() => codeRef.current?.focus(), 300);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setError(null);
    setBusy(true);
    try {
      const r = await api<AuthResult>('/auth/otp/verify', { method: 'POST', body: { email, code }, token: null });
      await completeSignIn(r.token, r.user);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const emailOk = /^\S+@\S+\.\S+$/.test(email.trim());

  return (
    <Screen edges={['top', 'bottom']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.wrap}>
        <View style={{ gap: space.sm }}>
          <T variant="label" style={{ color: colors.accent }}>Haunts</T>
          <T variant="hero">Your city starts black.</T>
          <T muted>Go outside and paint it in. Every street you walk becomes yours.</T>
        </View>

        {step === 'email' ? (
          <View style={styles.form}>
            <Field
              label="Email"
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              textContentType="emailAddress"
              returnKeyType="send"
              onSubmitEditing={() => emailOk && void requestCode()}
              error={error}
            />
            <Button title="Send code" onPress={requestCode} loading={busy} disabled={!emailOk} />
          </View>
        ) : (
          <View style={styles.form}>
            <T muted>We sent a 6-digit code to {email.trim().toLowerCase()}.</T>
            {devCode ? <T variant="small" style={{ color: colors.warning }}>Development code: {devCode}</T> : null}
            <Field
              ref={codeRef}
              label="Code"
              value={code}
              onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
              placeholder="123456"
              keyboardType="number-pad"
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              maxLength={6}
              error={error}
            />
            <Button title="Continue" onPress={verify} loading={busy} disabled={code.length !== 6} />
            <Button
              title={cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
              variant="ghost"
              disabled={cooldown > 0 || busy}
              onPress={requestCode}
            />
            <Button
              title="Use a different email"
              variant="ghost"
              onPress={() => {
                setStep('email');
                setCode('');
                setError(null);
              }}
            />
          </View>
        )}
        <T variant="small" muted>
          By continuing you agree to the Terms and Privacy Policy. Haunts stores map blocks, never your live location.
        </T>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, gap: space.xxl, paddingTop: space.xxl },
  form: { gap: space.md },
});
