import React, { useState } from 'react';
import { View, Text, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, Alert, TextInput, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { useForm, Controller } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../src/theme/colors';
import { authService } from '../../src/services/auth.service';
import { useAuthStore } from '../../src/store/auth.store';
import { Button } from '../../src/components/ui/Button';

const schema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});
type FormData = z.infer<typeof schema>;

export default function LoginScreen() {
  const router = useRouter();
  const { setUser } = useAuthStore();
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);

  const { control, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async ({ username, password }: FormData) => {
    setLoading(true);
    try {
      const { user } = await authService.login(username, password);
      setUser(user);
      router.replace('/(tabs)');
    } catch (e: any) {
      Alert.alert('Login Failed', e?.response?.data?.message || 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.logoContainer}>
              <View style={styles.logo}>
                <Ionicons name="cube-outline" size={36} color={Colors.cyan} />
              </View>
            </View>
            <Text style={styles.appName}>HSNT WMS</Text>
            <Text style={styles.subtitle}>Warehouse Management System</Text>
            <View style={styles.envBadge}>
              <View style={styles.envDot} />
              <Text style={styles.envLabel}>PRODUCTION</Text>
            </View>
          </View>

          {/* Form */}
          <View style={styles.form}>
            <Text style={styles.formTitle}>Sign In to Continue</Text>

            {/* Username */}
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>USERNAME</Text>
              <Controller
                control={control}
                name="username"
                render={({ field: { onChange, value } }) => (
                  <View style={[styles.inputRow, errors.username && styles.inputError]}>
                    <Ionicons name="person-outline" size={20} color={Colors.text.muted} style={styles.inputIcon} />
                    <TextInput
                      style={styles.input}
                      value={value}
                      onChangeText={onChange}
                      placeholder="Enter username"
                      placeholderTextColor={Colors.text.muted}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                  </View>
                )}
              />
              {errors.username && <Text style={styles.errText}>{errors.username.message}</Text>}
            </View>

            {/* Password */}
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>PASSWORD</Text>
              <Controller
                control={control}
                name="password"
                render={({ field: { onChange, value } }) => (
                  <View style={[styles.inputRow, errors.password && styles.inputError]}>
                    <Ionicons name="lock-closed-outline" size={20} color={Colors.text.muted} style={styles.inputIcon} />
                    <TextInput
                      style={styles.input}
                      value={value}
                      onChangeText={onChange}
                      placeholder="Enter password"
                      placeholderTextColor={Colors.text.muted}
                      secureTextEntry={!showPass}
                      autoCapitalize="none"
                    />
                    <TouchableOpacity onPress={() => setShowPass(!showPass)} style={styles.inputIcon}>
                      <Ionicons name={showPass ? 'eye-off-outline' : 'eye-outline'} size={20} color={Colors.text.muted} />
                    </TouchableOpacity>
                  </View>
                )}
              />
              {errors.password && <Text style={styles.errText}>{errors.password.message}</Text>}
            </View>

            <Button label="SIGN IN" onPress={handleSubmit(onSubmit)} loading={loading} size="lg" style={styles.signInBtn} />

            <Text style={styles.contact}>Contact IT support for access issues</Text>
          </View>

          {/* Footer */}
          <View style={styles.footer}>
            <Text style={styles.footerText}>HSNT WMS v1.0.0</Text>
            <Text style={styles.footerText}>© 2026 HSNT Corporation</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  scroll: { flexGrow: 1, paddingHorizontal: 24 },
  header: { alignItems: 'center', paddingTop: 48, paddingBottom: 32 },
  logoContainer: { marginBottom: 16 },
  logo: { width: 80, height: 80, borderRadius: 20, backgroundColor: 'rgba(0,229,255,0.1)', borderWidth: 1, borderColor: 'rgba(0,229,255,0.3)', alignItems: 'center', justifyContent: 'center' },
  appName: { color: Colors.text.primary, fontSize: 28, fontWeight: '800', letterSpacing: 1 },
  subtitle: { color: Colors.text.secondary, fontSize: 13, marginTop: 4 },
  envBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, backgroundColor: 'rgba(34,197,94,0.1)', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(34,197,94,0.3)' },
  envDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.success },
  envLabel: { color: Colors.success, fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  form: { backgroundColor: Colors.surface, borderRadius: 16, padding: 24, borderWidth: 1, borderColor: Colors.border },
  formTitle: { color: Colors.text.primary, fontSize: 18, fontWeight: '700', marginBottom: 24 },
  fieldGroup: { marginBottom: 20 },
  fieldLabel: { color: Colors.text.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 8 },
  inputRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.card, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, height: 56 },
  inputError: { borderColor: Colors.error },
  inputIcon: { paddingHorizontal: 14 },
  input: { flex: 1, color: Colors.text.primary, fontSize: 16 },
  errText: { color: Colors.error, fontSize: 12, marginTop: 4 },
  signInBtn: { marginTop: 8 },
  contact: { color: Colors.text.muted, fontSize: 12, textAlign: 'center', marginTop: 16 },
  footer: { paddingVertical: 24, alignItems: 'center', gap: 4 },
  footerText: { color: Colors.text.muted, fontSize: 11 },
});
