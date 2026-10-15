import { apiFetch, ApiError, queryString, setAccessToken, setUnauthorizedHandler } from "@/lib/api";
import { expiryLabel, timeAgo } from "@/lib/format";
import { getSessionSnapshot, loadSession, setSession, subscribeSession, tokenExpiry } from "@/lib/session";

/** A JWT-shaped string with the given payload (unsigned: the client never verifies signatures). */
const fakeJwt = (payload: object) =>
  `header.${btoa(JSON.stringify(payload)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}.signature`;

function mockFetch(status: number, body: unknown) {
  const fn = jest.fn().mockResolvedValue({ status, ok: status >= 200 && status < 300, json: async () => body });
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

afterEach(() => {
  setAccessToken(null);
  setUnauthorizedHandler(null);
  sessionStorage.clear();
});

describe("apiFetch", () => {
  it("sends the bearer token and JSON body", async () => {
    const fetchMock = mockFetch(200, { ok: true });
    setAccessToken("abc");

    await apiFetch("/assets", { method: "POST", body: { host: "x.com" } });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:3001/api/assets");
    expect(init.headers).toMatchObject({ Authorization: "Bearer abc", "Content-Type": "application/json" });
    expect(init.body).toBe(JSON.stringify({ host: "x.com" }));
  });

  it("turns Nest validation errors into a readable message", async () => {
    mockFetch(400, { message: ["host must be a string", "port must not be greater than 65535"] });

    await expect(apiFetch("/assets")).rejects.toEqual(new ApiError(400, "host must be a string, port must not be greater than 65535"));
  });

  it("calls the unauthorized handler on 401 while logged in (e.g. expired token)", async () => {
    mockFetch(401, { message: "Invalid or expired token" });
    const onUnauthorized = jest.fn();
    setUnauthorizedHandler(onUnauthorized);
    setAccessToken("expired");

    await expect(apiFetch("/assets")).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("reports an unreachable API clearly", async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError("Failed to fetch")) as unknown as typeof fetch;
    await expect(apiFetch("/assets")).rejects.toMatchObject({ status: 0, message: expect.stringContaining("Cannot reach the API") });
  });
});

describe("queryString", () => {
  it("skips empty values and joins arrays with commas", () => {
    expect(queryString({ severity: ["critical", "high"], category: "", page: 2, latestOnly: true, x: undefined })).toBe(
      "?severity=critical%2Chigh&page=2&latestOnly=true",
    );
    expect(queryString({ a: "", b: [] })).toBe("");
  });
});

describe("session", () => {
  const user = { id: "u1", email: "a@b.c", role: "viewer" as const };

  it("reads the expiry from the JWT exp claim", () => {
    expect(tokenExpiry(fakeJwt({ exp: 1_800_000_000 }))).toBe(1_800_000_000_000);
    expect(tokenExpiry("not-a-jwt")).toBeNull();
  });

  it("drops an expired saved session", () => {
    sessionStorage.setItem("cryptoscope.session", JSON.stringify({ token: "t", user, expiresAt: Date.now() - 1 }));
    expect(loadSession()).toBeNull();
    expect(sessionStorage.getItem("cryptoscope.session")).toBeNull();
  });

  it("setSession saves, notifies subscribers and sets the API token", async () => {
    const listener = jest.fn();
    const unsubscribe = subscribeSession(listener);
    const fetchMock = mockFetch(200, {});

    setSession({ token: "tok", user, expiresAt: Date.now() + 60_000 });
    await apiFetch("/auth/me");

    expect(listener).toHaveBeenCalled();
    expect(getSessionSnapshot()?.user.email).toBe("a@b.c");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer tok");

    setSession(null);
    expect(getSessionSnapshot()).toBeNull();
    expect(sessionStorage.getItem("cryptoscope.session")).toBeNull();
    unsubscribe();
  });
});

describe("format", () => {
  it("labels certificate expiry", () => {
    expect(expiryLabel(-3)).toBe("Expired 3 days ago");
    expect(expiryLabel(0)).toBe("Expires today");
    expect(expiryLabel(1)).toBe("in 1 day");
  });

  it("formats relative time", () => {
    const now = Date.parse("2026-06-01T12:00:00Z");
    expect(timeAgo("2026-06-01T11:58:00Z", now)).toBe("2 min ago");
    expect(timeAgo("2026-05-29T12:00:00Z", now)).toBe("3 d ago");
    expect(timeAgo(null, now)).toBe("never");
  });
});
