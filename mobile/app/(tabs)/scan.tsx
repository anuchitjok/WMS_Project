import React, { useState, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Vibration, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Colors } from '../../src/theme/colors';
import { useScannerStore } from '../../src/store/scanner.store';
import { ScanInput } from '../../src/components/scanner/ScanInput';

export default function ScanScreen() {
  const router = useRouter();
  const { setScanResult } = useScannerStore();
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraMode, setCameraMode] = useState(false);
  const [manualInput, setManualInput] = useState('');
  const [lastScanned, setLastScanned] = useState('');
  const [torch, setTorch] = useState(false);
  const scanning = useRef(false);

  const handleBarcode = ({ data, type }: { data: string; type: string }) => {
    if (scanning.current || data === lastScanned) return;
    scanning.current = true;
    setLastScanned(data);
    Vibration.vibrate(100);
    const result = { barcode: data, type, timestamp: Date.now() };
    setScanResult(result);
    routeScan(data);
    setTimeout(() => { scanning.current = false; }, 2000);
  };

  const routeScan = (barcode: string) => {
    if (barcode.startsWith('LOC-')) {
      router.push({ pathname: '/inventory', params: { location: barcode } });
    } else if (barcode.startsWith('PICK-')) {
      router.push({ pathname: '/picking', params: { pickId: barcode } });
    } else if (barcode.startsWith('ASN-')) {
      router.push({ pathname: '/receiving', params: { asnNo: barcode } });
    } else {
      router.push({ pathname: '/inventory', params: { barcode } });
    }
  };

  const handleManualScan = () => {
    if (!manualInput.trim()) return;
    handleBarcode({ data: manualInput.trim(), type: 'manual' });
    setManualInput('');
  };

  const startCamera = async () => {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        Alert.alert('Camera Permission', 'Camera access is required for scanning.');
        return;
      }
    }
    setCameraMode(true);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>BARCODE SCANNER</Text>
        <TouchableOpacity onPress={() => setCameraMode(!cameraMode)}>
          <Ionicons name={cameraMode ? 'keypad-outline' : 'camera-outline'} size={24} color={Colors.cyan} />
        </TouchableOpacity>
      </View>

      {cameraMode ? (
        <View style={styles.cameraContainer}>
          <CameraView
            style={styles.camera}
            onBarcodeScanned={handleBarcode}
            barcodeScannerSettings={{ barcodeTypes: ['code128', 'code39', 'ean13', 'upc_a', 'qr'] }}
          >
            <View style={styles.overlay}>
              <View style={styles.scanFrame}>
                <View style={[styles.corner, styles.tl]} />
                <View style={[styles.corner, styles.tr]} />
                <View style={[styles.corner, styles.bl]} />
                <View style={[styles.corner, styles.br]} />
                <View style={styles.scanLine} />
              </View>
              <Text style={styles.scanHint}>Aim at barcode to scan</Text>
            </View>
            <View style={styles.camControls}>
              <TouchableOpacity style={styles.camBtn} onPress={() => setTorch(!torch)}>
                <Ionicons name={torch ? 'flash' : 'flash-outline'} size={24} color={torch ? Colors.warning : Colors.text.primary} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.camBtn} onPress={() => setCameraMode(false)}>
                <Ionicons name="close" size={24} color={Colors.text.primary} />
              </TouchableOpacity>
            </View>
          </CameraView>
        </View>
      ) : (
        <View style={styles.manualContainer}>
          <View style={styles.scanIconLarge}>
            <Ionicons name="barcode-outline" size={80} color={`${Colors.cyan}40`} />
          </View>
          <ScanInput
            value={manualInput}
            onChangeText={setManualInput}
            onScan={startCamera}
            label="BARCODE / QR CODE"
            placeholder="Scan or type barcode..."
          />
          <TouchableOpacity style={styles.submitBtn} onPress={handleManualScan} activeOpacity={0.8}>
            <Text style={styles.submitLabel}>SUBMIT</Text>
          </TouchableOpacity>

          {lastScanned ? (
            <View style={styles.lastScan}>
              <Text style={styles.lastScanLabel}>LAST SCAN</Text>
              <Text style={styles.lastScanValue}>{lastScanned}</Text>
            </View>
          ) : null}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12 },
  title: { color: Colors.text.primary, fontSize: 18, fontWeight: '800', letterSpacing: 1 },
  cameraContainer: { flex: 1 },
  camera: { flex: 1 },
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(8,17,32,0.5)' },
  scanFrame: { width: 260, height: 180, position: 'relative' },
  corner: { position: 'absolute', width: 24, height: 24, borderColor: Colors.cyan, borderWidth: 3 },
  tl: { top: 0, left: 0, borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 4 },
  tr: { top: 0, right: 0, borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: 4 },
  bl: { bottom: 0, left: 0, borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: 4 },
  br: { bottom: 0, right: 0, borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: 4 },
  scanLine: { position: 'absolute', top: '50%', left: 8, right: 8, height: 2, backgroundColor: Colors.cyan, opacity: 0.8 },
  scanHint: { color: Colors.text.secondary, fontSize: 13, marginTop: 20 },
  camControls: { position: 'absolute', top: 20, right: 20, gap: 12 },
  camBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  manualContainer: { flex: 1, padding: 24 },
  scanIconLarge: { alignItems: 'center', marginVertical: 32 },
  submitBtn: { backgroundColor: Colors.cyan, height: 56, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  submitLabel: { color: Colors.bg, fontSize: 15, fontWeight: '800', letterSpacing: 1 },
  lastScan: { marginTop: 24, backgroundColor: Colors.surface, borderRadius: 10, padding: 16, borderWidth: 1, borderColor: Colors.border },
  lastScanLabel: { color: Colors.text.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 6 },
  lastScanValue: { color: Colors.cyan, fontSize: 16, fontWeight: '600' },
});
