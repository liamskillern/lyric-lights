import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as auth from "../src/auth";
import { isFramed } from "../src/frame";
import { LIMITS, lyricsFromRecord, parseLrc, pickBestRecord, readJsonCapped, sanitizeRecord } from "../src/lyrics";
import { LruCache } from "../src/storage";
import { jsonResponse, MemoryStorage } from "./helpers";

const CLIENT = "0123456789abcdef0123456789abcdef";

describe("login error messages (no text injection)", () => {
  it("gives fixed wording for known codes", () => {
    expect(auth.loginErrorMessage("access_denied")).toBe("Login was cancelled.");
    expect(auth.loginErrorMessage("invalid_client")).toMatch(/Client ID/);
    expect(auth.loginErrorMessage("server_error")).toMatch(/try again in a minute/);
  });

  it("never echoes unknown text from the link", () => {
    const evil = "Your account is hacked! Call 555-0100 now";
    const msg = auth.loginErrorMessage(evil);
    expect(msg).toBe("Login failed. Please try again.");
    expect(msg).not.toContain("555");
    expect(auth.loginErrorMessage(null)).toBe("Login failed. Please try again.");
  });
});

describe("refresh failures", () => {
  it("only logs out when Spotify says the login is no good", () => {
    expect(auth.refreshFailureIsFinal(400)).toBe(true);
    expect(auth.refreshFailureIsFinal(401)).toBe(true);
    for (const s of [429, 500, 502, 503]) expect(auth.refreshFailureIsFinal(s)).toBe(false);
  });
});

describe("token storage", () => {
  let local: MemoryStorage;
  let session: MemoryStorage;
  const fetchMock = vi.fn();

  beforeEach(() => {
    local = new MemoryStorage();
    session = new MemoryStorage();
    vi.stubGlobal("localStorage", local);
    vi.stubGlobal("sessionStorage", session);
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    auth._resetForTests();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("is logged out with nothing stored", async () => {
    expect(auth.isLoggedIn()).toBe(false);
    expect(await auth.getAccessToken(CLIENT)).toEqual({ kind: "logged-out" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the access token in memory and the refresh token only in sessionStorage", async () => {
    session.setItem("sv.refresh", "r1");
    fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: "a1", refresh_token: "r2", expires_in: 3600 }));
    expect(await auth.getAccessToken(CLIENT)).toEqual({ kind: "ok", token: "a1" });
    expect(session.dump()).toEqual({ "sv.refresh": "r2" }); // rotated
    expect(JSON.stringify(local.dump())).not.toContain("a1");
    expect(JSON.stringify(local.dump())).not.toContain("r2");
    expect(JSON.stringify(session.dump())).not.toContain("a1");
    // Cached in memory: no second request.
    expect(await auth.getAccessToken(CLIENT)).toEqual({ kind: "ok", token: "a1" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refreshes only once when asked twice at the same time", async () => {
    session.setItem("sv.refresh", "r1");
    fetchMock.mockResolvedValue(jsonResponse({ access_token: "a1", expires_in: 3600 }));
    const [a, b] = await Promise.all([auth.getAccessToken(CLIENT), auth.getAccessToken(CLIENT)]);
    expect(a).toEqual(b);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(session.getItem("sv.refresh")).toBe("r1"); // not rotated: old one kept
  });

  it("keeps the login when the network is down or Spotify is busy", async () => {
    session.setItem("sv.refresh", "r1");
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect(await auth.getAccessToken(CLIENT)).toEqual({ kind: "unavailable" });
    fetchMock.mockResolvedValueOnce(new Response("busy", { status: 503 }));
    expect(await auth.getAccessToken(CLIENT)).toEqual({ kind: "unavailable" });
    fetchMock.mockResolvedValueOnce(new Response("not json", { status: 200 }));
    expect(await auth.getAccessToken(CLIENT)).toEqual({ kind: "unavailable" });
    expect(session.getItem("sv.refresh")).toBe("r1");
    expect(auth.isLoggedIn()).toBe(true);
  });

  it("logs out when the refresh token is revoked", async () => {
    session.setItem("sv.refresh", "r1");
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "invalid_grant" }, 400));
    expect(await auth.getAccessToken(CLIENT)).toEqual({ kind: "logged-out" });
    expect(session.getItem("sv.refresh")).toBeNull();
    expect(auth.isLoggedIn()).toBe(false);
  });

  it("forceRefresh drops the cached access token", async () => {
    session.setItem("sv.refresh", "r1");
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: "a1", expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ access_token: "a2", expires_in: 3600 }));
    await auth.getAccessToken(CLIENT);
    expect(await auth.forceRefresh(CLIENT)).toEqual({ kind: "ok", token: "a2" });
  });

  it("logout clears everything, including tokens from older versions", () => {
    session.setItem("sv.refresh", "r1");
    session.setItem("sv.pkce.state", "s");
    local.setItem("sv.tokens", JSON.stringify({ accessToken: "old", refreshToken: "old" }));
    local.setItem("sv.clientId", CLIENT);
    auth.logout();
    expect(session.dump()).toEqual({});
    expect(local.dump()).toEqual({ "sv.clientId": CLIENT }); // the Client ID isn't secret
  });

  it("removeLegacyTokens deletes the old localStorage tokens", () => {
    local.setItem("sv.tokens", "x");
    auth.removeLegacyTokens();
    expect(local.getItem("sv.tokens")).toBeNull();
  });

  it("survives storage that throws (blocked cookies / private mode)", async () => {
    const broken = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      },
      removeItem: () => {
        throw new Error("SecurityError");
      },
    };
    vi.stubGlobal("sessionStorage", broken);
    vi.stubGlobal("localStorage", broken);
    expect(auth.isLoggedIn()).toBe(false);
    expect(() => auth.logout()).not.toThrow();
    expect(await auth.getAccessToken(CLIENT)).toEqual({ kind: "logged-out" });
  });
});

describe("randomString", () => {
  it("uses every character of the alphabet roughly evenly", () => {
    const counts = new Map<string, number>();
    const s = auth.randomString(66_000);
    expect(s).toHaveLength(66_000);
    for (const c of s) counts.set(c, (counts.get(c) ?? 0) + 1);
    expect(counts.size).toBe(66);
    for (const n of counts.values()) {
      expect(n).toBeGreaterThan(800); // expected 1000 each
      expect(n).toBeLessThan(1200);
    }
  });
});

describe("isFramed (clickjacking guard)", () => {
  it("is false for a normal page", () => {
    const w = {} as { self: unknown; top: unknown };
    w.self = w;
    w.top = w;
    expect(isFramed(w)).toBe(false);
  });
  it("is true inside a frame", () => {
    expect(isFramed({ self: {}, top: {} })).toBe(true);
  });
  it("is true when the browser won't even let us look", () => {
    const w = {
      self: {},
      get top(): unknown {
        throw new Error("cross-origin");
      },
    };
    expect(isFramed(w)).toBe(true);
  });
});

describe("LruCache", () => {
  it("forgets the least recently used entry past its size", () => {
    const c = new LruCache<string, number>(2);
    c.set("a", 1);
    c.set("b", 2);
    c.get("a"); // a is now newest
    c.set("c", 3);
    expect(c.get("b")).toBeUndefined();
    expect(c.get("a")).toBe(1);
    expect(c.get("c")).toBe(3);
    expect(c.size).toBe(2);
  });
});

describe("untrusted lyrics from LRCLIB", () => {
  it("caps the number of lines", () => {
    const lrc = Array.from({ length: 5000 }, (_, i) => `[00:${String(i % 60).padStart(2, "0")}.00]line ${i}`).join("\n");
    expect(parseLrc(lrc).length).toBe(LIMITS.lines);
  });

  it("cuts very long lines", () => {
    const [line] = parseLrc(`[00:01.00]${"la ".repeat(1000)}`);
    expect(line.text.length).toBe(LIMITS.lineChars);
    expect(line.text.endsWith("…")).toBe(true);
  });

  it("ignores fields with the wrong type or a giant size", () => {
    expect(sanitizeRecord("nope")).toBeNull();
    expect(sanitizeRecord([1, 2])).toBeNull();
    expect(lyricsFromRecord({ syncedLyrics: 42, plainLyrics: { evil: true } }).kind).toBe("none");
    expect(lyricsFromRecord({ syncedLyrics: "x".repeat(LIMITS.lyricsChars + 1) }).kind).toBe("none");
    expect(lyricsFromRecord({ instrumental: "yes" }).kind).toBe("none"); // only real true counts
    expect(sanitizeRecord({ duration: Number.NaN })?.duration).toBeUndefined();
  });

  it("ignores search results that aren't a list", () => {
    expect(pickBestRecord({ syncedLyrics: "[00:01.00]x" }, 100)).toBeNull();
    expect(pickBestRecord(null, 100)).toBeNull();
  });

  it("reads small JSON and refuses huge or broken bodies", async () => {
    expect(await readJsonCapped(jsonResponse({ ok: 1 }))).toEqual({ ok: 1 });
    expect(await readJsonCapped(new Response("x".repeat(2000)), 1000)).toBeNull();
    expect(await readJsonCapped(new Response("{oops"))).toBeNull();
    const declared = new Response("{}", { headers: { "content-length": "99999999" } });
    expect(await readJsonCapped(declared)).toBeNull();
  });
});
