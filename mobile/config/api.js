import AsyncStorage from '@react-native-async-storage/async-storage';

const _SERVER = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000';
export const API_BASE    = _SERVER;                      // server root
export const TRACKER     = `${_SERVER}/api/tracker`;    // all project-tracker endpoints
export const CHATBOT_BASE = `${_SERVER}/chatbot`;       // chatbot endpoints

/**
 * Returns fetch-ready headers with the stored JWT.
 * Pass json=false for multipart/form-data requests (let fetch set the boundary).
 */
export async function authHeaders(json = true) {
  const token = (await AsyncStorage.getItem('auth_token')) ?? '';
  const h = { Authorization: `Bearer ${token}` };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}
