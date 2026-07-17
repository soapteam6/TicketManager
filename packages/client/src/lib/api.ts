import axios, { type AxiosInstance } from 'axios';

// Authentication has been removed — the app talks to the open API directly, no tokens.
export const api: AxiosInstance = axios.create({
  baseURL: '/api',
});

// Normalize server error messages into a readable string for the UI.
export function apiErrorMessage(err: unknown, fallback = 'Something went wrong'): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { message?: string; error?: string } | undefined;
    if (data?.message) return data.message;
    if (data?.error) return data.error;
    if (err.message) return err.message;
  }
  if (err instanceof Error) return err.message;
  return fallback;
}
