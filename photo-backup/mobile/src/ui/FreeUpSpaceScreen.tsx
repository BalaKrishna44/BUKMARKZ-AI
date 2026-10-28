import React, { useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { loadKeys } from '../crypto/keyStore';
import { freeUpSpace, scanDeletable, type ScanResult } from '../cleanup/cleanupService';

const mb = (n: number) => (n / 1024 / 1024 >= 1024 ? `${(n / 1024 ** 3).toFixed(1)} GB` : `${Math.round(n / 1024 / 1024)} MB`);

export function FreeUpSpaceScreen() {
  const [busy, setBusy] = useState<string | null>(null);
  const [scan, setScan] = useState<ScanResult | null>(null);

  const doScan = async () => {
    const keys = await loadKeys();
    if (!keys) return Alert.alert('Unlock first', 'Enter your backup secret to continue.');
    setBusy('Checking your backup…');
    try { setScan(await scanDeletable(keys, (d, t) => setBusy(`Checking ${d} of ${t}…`))); }
    finally { setBusy(null); }
  };

  const doFree = async () => {
    if (!scan) return;
    setBusy('Waiting for your permission…');
    try {
      const r = await freeUpSpace(scan.candidates, (d, t) => setBusy(`Removed ${d} of ${t}…`));
      setScan(null);
      Alert.alert(
        r.cancelled ? 'Stopped' : 'Done',
        `${r.deleted} items removed from this phone.` +
          (Platform.OS === 'ios' ? '\n\nThey sit in "Recently Deleted" for 30 days. Space is only returned when you empty that album.' : ''),
      );
    } finally { setBusy(null); }
  };

  return (
    <View style={s.root}>
      <Text style={s.h1}>Free up space</Text>
      <Text style={s.p}>Only photos and videos that are safely backed up and unchanged are offered. Your phone will ask you to confirm before anything is deleted.</Text>

      {busy && <View style={s.row}><ActivityIndicator color="#fca311" /><Text style={s.p}>  {busy}</Text></View>}

      {scan && !busy && (
        <View style={s.card}>
          <Text style={s.big}>{scan.candidates.length} items · {mb(scan.reclaimableBytes)}</Text>
          {scan.skipped.length > 0 && <Text style={s.p}>{scan.skipped.length} items kept because they are not fully backed up or changed since.</Text>}
        </View>
      )}

      <Pressable accessibilityRole="button" disabled={!!busy} onPress={scan && scan.candidates.length ? doFree : doScan} style={[s.btn, busy && { opacity: 0.5 }]}>
        <Text style={s.btnT}>{scan && scan.candidates.length ? `Free up ${mb(scan.reclaimableBytes)}` : 'Check what can be removed'}</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#05070d', padding: 24, gap: 16, justifyContent: 'center' },
  h1: { color: '#e8ecf4', fontSize: 28, fontWeight: '800' },
  p: { color: '#aab3c7', fontSize: 15, lineHeight: 22 },
  row: { flexDirection: 'row', alignItems: 'center' },
  card: { backgroundColor: '#0d1322', borderColor: '#26335a', borderWidth: 1, borderRadius: 16, padding: 20, gap: 8 },
  big: { color: '#ffd27a', fontSize: 22, fontWeight: '800' },
  btn: { minHeight: 52, borderRadius: 14, backgroundColor: '#fca311', alignItems: 'center', justifyContent: 'center' },
  btnT: { color: '#14213d', fontSize: 16, fontWeight: '800' },
});
