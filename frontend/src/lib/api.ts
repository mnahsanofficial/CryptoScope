// NEXT_PUBLIC_* variables are inlined into the browser bundle at build time.
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api";
/** Socket.IO lives on the same server as the API, without the /api prefix. */
export const SOCKET_URL = new URL(API_URL).origin;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

let accessToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

/** Called by the auth provider when the user logs in or out. */
export function setAccessToken(token: string | null): void {
  accessToken = token;
}

/** The auth provider registers this, so any 401 (e.g. an expired token) logs the user out. */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

/** Nest error bodies look like { message: string | string[], error, statusCode }. */
async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string | string[] };
    if (Array.isArray(body.message)) return body.message.join(", ");
    if (body.message) return body.message;
  } catch {
    // not JSON
  }
  return `Request failed (HTTP ${res.status})`;
}

export interface ApiOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
}

export async function apiFetch<T>(path: string, { method = "GET", body, signal }: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
      cache: "no-store",
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiError(0, `Cannot reach the API at ${API_URL}`);
  }

  if (res.status === 401 && accessToken) onUnauthorized?.();
  if (!res.ok) throw new ApiError(res.status, await errorMessage(res));
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Builds "?a=1&b=x,y" from an object, skipping empty values. */
export function queryString(params: Record<string, string | number | boolean | string[] | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      if (value.length) search.set(key, value.join(","));
    } else {
      search.set(key, String(value));
    }
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}
