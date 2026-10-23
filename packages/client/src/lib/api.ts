import axios, { type AxiosInstance } from 'axios';

// Selectable synthetic identity, never production authentication.
export const api: AxiosInstance = axios.create({
  baseURL: '/api',
});

let persona = new URLSearchParams(window.location.search).get('persona');
try { persona ??= sessionStorage.getItem('review-persona'); } catch { /* storage is optional */ }
api.defaults.headers.common['x-mock-persona'] = ['coordinator', 'rep', 'employee'].includes(persona ?? '') ? persona! : 'coordinator';

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
