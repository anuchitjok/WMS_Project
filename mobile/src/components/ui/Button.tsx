import React from 'react';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator, ViewStyle } from 'react-native';
import { Colors } from '../../theme/colors';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
}

export const Button: React.FC<ButtonProps> = ({
  label, onPress, variant = 'primary', size = 'md', loading, disabled, style,
}) => {
  const variantStyles: Record<string, { bg: string; text: string; border: string }> = {
    primary: { bg: Colors.cyan, text: '#081120', border: Colors.cyan },
    secondary: { bg: 'rgba(0,229,255,0.1)', text: Colors.cyan, border: 'rgba(0,229,255,0.3)' },
    danger: { bg: Colors.error, text: '#fff', border: Colors.error },
    ghost: { bg: 'transparent', text: Colors.text.secondary, border: Colors.border },
  };
  const sizeH: Record<string, number> = { sm: 40, md: 52, lg: 60 };
  const sizeFont: Record<string, number> = { sm: 13, md: 15, lg: 17 };

  const vs = variantStyles[variant];
  const isDisabled = disabled || loading;

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.75}
      style={[
        styles.btn,
        { backgroundColor: vs.bg, borderColor: vs.border, height: sizeH[size], opacity: isDisabled ? 0.5 : 1 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={vs.text} size="small" />
      ) : (
        <Text style={[styles.label, { color: vs.text, fontSize: sizeFont[size] }]}>{label}</Text>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  btn: { borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  label: { fontWeight: '700', letterSpacing: 0.3 },
});
