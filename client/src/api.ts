import { useQuery, QueryClient } from "@tanstack/react-query";
export type { User } from "./types";
let csrfToken = "";
export function setCsrf(token: string) {
  csrfToken = token;
}
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 0,
    public details: { path: string; message: string }[] = [],
  ) {
    super(message);
  }
}
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 20000,
      retry: (count, error) =>
        count < 1 && (!(error instanceof ApiError) || error.status >= 500),
      refetchOnWindowFocus: true,
    },
    mutations: { retry: false },
  },
});
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      method,
      credentials: "same-origin",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(20000)])
        : AbortSignal.timeout(20000),
      headers: {
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(method !== "GET" ? { "X-CSRF-Token": csrfToken } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError(
      "NETWORK_ERROR",
      "We couldn’t reach the mess. Check your connection and try again.",
    );
  }
  const result = await response.json().catch(() => {
    throw new ApiError(
      "INVALID_RESPONSE",
      "The server returned an unexpected response.",
      response.status,
    );
  });
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith("/auth/"))
      window.dispatchEvent(new Event("mess:session-expired"));
    throw new ApiError(
      result.error?.code ?? "REQUEST_FAILED",
      result.error?.message ?? "Something went wrong. Please try again.",
      response.status,
      result.error?.details ?? [],
    );
  }
  return result.data as T;
}
export function useApi<T>(path: string | null) {
  return useQuery<T, ApiError>({
    queryKey: ["api", path],
    queryFn: ({ signal }) => api<T>(path!, "GET", undefined, signal),
    enabled: !!path,
  });
}
export const refresh = () =>
  queryClient.invalidateQueries({ queryKey: ["api"] });
