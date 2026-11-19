// FILE: src/app/auth/auth-storage.ts  (NEW file)
/** Where the login token is kept in this browser. Phone and computer each keep their own. */
const TOKEN_KEY = 'ledger-auth-token';

export const getToken = (): string | null => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null; // storage can be unavailable (private mode)
  }
};

export const setToken = (token: string): void => {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // ignore; the user will simply have to sign in again next time
  }
};

export const clearToken = (): void => {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
};
