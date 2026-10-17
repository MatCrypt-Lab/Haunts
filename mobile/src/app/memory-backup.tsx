import { useCallback, useState } from 'react';
import { Alert, Switch, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useFocusEffect } from 'expo-router';
import type { MemoryBackupInfo } from '@unfog/core';
import { Button, Card, Field, Row, Screen, T } from '@/components/ui';
import { colors, space } from '@/constants/theme';
import { dateLabel, timeOfDay } from '@/lib/format';
import {
  backupErrorMessage,
  backupExists,
  backupNow,
  backupStatus,
  createRecoveryCode,
  disableBackup,
  restoreBackup,
  type BackupStatus,
} from '@/lib/memory';

export default function MemoryBackupScreen() {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [remote, setRemote] = useState<MemoryBackupInfo | null | undefined>(undefined);
  const [newCode, setNewCode] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [restoreCode, setRestoreCode] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    void backupStatus().then(setStatus);
    void backupExists()
      .then(setRemote)
      .catch(() => setRemote(null));
  }, []);
  useFocusEffect(load);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (err) {
      Alert.alert('Something went wrong', backupErrorMessage(err));
    } finally {
      setBusy(null);
      load();
    }
  };

  if (!status) return null;

  // Step 2 of setup: show the new code until the user confirms they saved it.
  if (newCode) {
    return (
      <Screen edges={['bottom']}>
        <T variant="title">Your recovery code</T>
        <T muted>
          This code encrypts your backup on your phone. Haunts never sees it and cannot recover it for you. Without it, a
          backup cannot be opened, even by us.
        </T>
        <Card style={{ gap: space.md, borderColor: colors.accent }}>
          <T variant="heading" selectable style={{ letterSpacing: 1.5, lineHeight: 30 }}>{newCode}</T>
          <Button title="Copy code" variant="secondary" onPress={() => void Clipboard.setStringAsync(newCode)} />
        </Card>
        <T muted variant="small">Save it in your password manager or write it down. Do not post it anywhere.</T>
        <Row style={{ justifyContent: 'space-between' }}>
          <T style={{ flex: 1 }}>I have saved my recovery code</T>
          <Switch value={saved} onValueChange={setSaved} trackColor={{ true: colors.accent }} />
        </Row>
        <Button
          title="Turn on backup"
          disabled={!saved}
          loading={busy === 'first'}
          onPress={() =>
            void run('first', async () => {
              await backupNow();
              setNewCode(null);
              Alert.alert('Backed up', 'Your memory is encrypted and backed up. It updates once a day.');
            })
          }
        />
      </Screen>
    );
  }

  return (
    <Screen edges={['bottom']}>
      <T muted>
        Your timeline and places live on this phone. Backup encrypts them on the phone with a recovery code only you hold,
        then stores the locked copy with Haunts. We cannot read it.
      </T>

      {status.enabled ? (
        <Card style={{ gap: space.md }}>
          <T variant="heading">Backup is on</T>
          <T muted variant="small">
            {status.lastBackupAt ? `Last backup ${dateLabel(status.lastBackupAt)} at ${timeOfDay(status.lastBackupAt)}.` : 'Not backed up yet.'}
            {remote ? ` Stored copy: ${(remote.sizeBytes / 1024).toFixed(0)} KB.` : ''}
          </T>
          <Button title="Back up now" loading={busy === 'now'} onPress={() => void run('now', async () => void (await backupNow()))} />
          <Button
            title="Show recovery code"
            variant="secondary"
            onPress={() => Alert.alert('Recovery code', status.code ?? '', [{ text: 'Copy', onPress: () => void Clipboard.setStringAsync(status.code ?? '') }, { text: 'Done' }])}
          />
          <Button
            title="Turn off and delete backup"
            variant="danger"
            onPress={() =>
              Alert.alert('Delete your backup?', 'The encrypted copy is deleted from Haunts. Your memory on this phone is not affected.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: () => void run('off', () => disableBackup(true)) },
              ])
            }
          />
        </Card>
      ) : (
        <>
          {remote ? (
            <Card style={{ gap: space.md, borderColor: colors.accent }}>
              <T variant="heading">Restore your memory</T>
              <T muted variant="small">
                A backup from {dateLabel(Date.parse(remote.updatedAt))} is waiting. Enter the recovery code you saved when you set it up.
              </T>
              <Field value={restoreCode} onChangeText={setRestoreCode} placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" autoCapitalize="characters" autoCorrect={false} />
              <Button
                title="Restore"
                loading={busy === 'restore'}
                disabled={restoreCode.replace(/[\s-]/g, '').length < 32}
                onPress={() =>
                  void run('restore', async () => {
                    const r = await restoreBackup(restoreCode);
                    setRestoreCode('');
                    Alert.alert('Restored', `${r.places} places and ${r.stays} stops are back.`);
                  })
                }
              />
            </Card>
          ) : null}
          <Card style={{ gap: space.md }}>
            <T variant="heading">{remote ? 'Or start a new backup' : 'Set up backup'}</T>
            {remote ? <T muted variant="small">Starting a new backup replaces the stored one the next time it runs.</T> : null}
            <Button
              title="Create recovery code"
              variant={remote ? 'secondary' : 'primary'}
              onPress={() =>
                void run('create', async () => {
                  setSaved(false);
                  setNewCode(await createRecoveryCode());
                })
              }
            />
          </Card>
        </>
      )}
      <View />
    </Screen>
  );
}
