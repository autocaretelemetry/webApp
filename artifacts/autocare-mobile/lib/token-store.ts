import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "autocare:sessionToken";

export async function getStoredToken(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export async function setStoredToken(token: string | null): Promise<void> {
  try {
    if (token) await AsyncStorage.setItem(KEY, token);
    else await AsyncStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
