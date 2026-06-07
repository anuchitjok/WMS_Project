import React, { useState } from 'react';
import { View, TextInput, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../theme/colors';

interface ScanInputProps {
  value: string;
  onChangeText: (text: string) => void;
  onScan: () => void;
  placeholder?: string;
  label?: string;
}

export const ScanInput: React.FC<ScanInputProps> = ({ value, onChangeText, onScan, placeholder = 'Scan or type barcode...', label }) => {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.container}>
      {label && <Text style={styles.label}>{label}</Text>}
      <View style={[styles.inputRow, focused && styles.focused]}>
        <Ionicons name="barcode-outline" size={22} color={focused ? Colors.cyan : Colors.text.muted} style={styles.icon} />
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={Colors.text.muted}
          autoCapitalize="characters"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          returnKeyType="done"
        />
        <TouchableOpacity onPress={onScan} style={styles.scanBtn} activeOpacity={0.75}>
          <Ionicons name="camera-outline" size={22} color={Colors.bg} />
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { marginBottom: 16 },
  label: { color: Colors.text.secondary, fontSize: 12, fontWeight: '600', marginBottom: 8, letterSpacing: 0.5, textTransform: 'uppercase' },
  inputRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, height: 56 },
  focused: { borderColor: Colors.cyan, shadowColor: Colors.cyan, shadowOpacity: 0.2, shadowRadius: 8, elevation: 4 },
  icon: { paddingHorizontal: 14 },
  input: { flex: 1, color: Colors.text.primary, fontSize: 16, fontWeight: '500' },
  scanBtn: { backgroundColor: Colors.cyan, width: 56, height: 56, alignItems: 'center', justifyContent: 'center', borderTopRightRadius: 10, borderBottomRightRadius: 10 },
});
