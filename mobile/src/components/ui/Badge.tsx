import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '../../theme/colors';

type BadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'cyan' | 'default';

interface BadgeProps {
  label: string;
  variant?: BadgeVariant;
  size?: 'sm' | 'md';
}

const variantMap: Record<BadgeVariant, { bg: string; text: string; border: string }> = {
  success: { bg: 'rgba(34,197,94,0.15)', text: Colors.success, border: 'rgba(34,197,94,0.3)' },
  warning: { bg: 'rgba(245,158,11,0.15)', text: Colors.warning, border: 'rgba(245,158,11,0.3)' },
  error: { bg: 'rgba(239,68,68,0.15)', text: Colors.error, border: 'rgba(239,68,68,0.3)' },
  info: { bg: 'rgba(56,189,248,0.15)', text: Colors.info, border: 'rgba(56,189,248,0.3)' },
  cyan: { bg: 'rgba(0,229,255,0.15)', text: Colors.cyan, border: 'rgba(0,229,255,0.3)' },
  default: { bg: 'rgba(156,163,175,0.15)', text: Colors.text.secondary, border: 'rgba(156,163,175,0.3)' },
};

export const Badge: React.FC<BadgeProps> = ({ label, variant = 'default', size = 'sm' }) => {
  const style = variantMap[variant];
  const pad = size === 'sm' ? { paddingHorizontal: 8, paddingVertical: 3 } : { paddingHorizontal: 12, paddingVertical: 5 };
  return (
    <View style={[styles.badge, { backgroundColor: style.bg, borderColor: style.border }, pad]}>
      <Text style={[styles.text, { color: style.text }, size === 'md' && { fontSize: 13 }]}>{label}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: { borderRadius: 6, borderWidth: 1, alignSelf: 'flex-start' },
  text: { fontSize: 11, fontWeight: '600', letterSpacing: 0.5 },
});
