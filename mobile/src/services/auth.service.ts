import * as SecureStore from 'expo-secure-store';
import { api } from './api';
import type { User, AuthTokens } from '../types';

export const authService = {
  async login(username: string, password: string): Promise<{ user: User; tokens: AuthTokens }> {
    const { data } = await api.post('/auth/login', { username, password });
    await SecureStore.setItemAsync('access_token', data.accessToken);
    await SecureStore.setItemAsync('refresh_token', data.refreshToken);
    return data;
  },

  async logout(token: string): Promise<void> {
    try {
      await api.post('/auth/logout', { token });
    } finally {
      await SecureStore.deleteItemAsync('access_token');
      await SecureStore.deleteItemAsync('refresh_token');
    }
  },

  async getProfile(): Promise<User> {
    const { data } = await api.get('/auth/me');
    return data;
  },

  async getStoredToken(): Promise<string | null> {
    return SecureStore.getItemAsync('access_token');
  },
};
