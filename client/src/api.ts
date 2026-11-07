export interface User {
  id: string;
  name: string;
  email: string;
  role: 'STUDENT' | 'STAFF' | 'MANAGER' | 'ADMIN';
  must_change_password: boolean;
}
let csrfToken = '';
export function setCsrf(token: string) { csrfToken = token; }
export class ApiError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    method, credentials: 'same-origin',
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' ? { 'X-CSRF-Token': csrfToken } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  const result = await response.json();
  if (!response.ok) throw new ApiError(result.error?.code ?? 'REQUEST_FAILED', result.error?.message ?? 'The request failed');
  return result.data as T;
}
