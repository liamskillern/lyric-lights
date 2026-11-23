import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as auth from "../src/auth";
import { DEFAULT_FPS, FrameCap, isNewPairCode, MAX_FPS, MIN_FPS, parsePairHash, parseWallpaper } from "../src/wallpaper";
import { local as safeLocal } from "../src/storage";
import { jsonResponse, MemoryStorage } from "./helpers";

const CLIENT = "0123456789abcdef0123456789abcdef";

describe("wallpaper mode from the address bar", () => {
  it("is off without ?wallpaper", () => {
    expect(parseWallpaper("")).toBeNull();
    expect(parseWallpaper("?demo")).toBeNull();
    expect(parseWallpaper("?fps=30")).toBeNull();
  });

  it("defaults to 30 fps", () => {
    expect(parseWallpaper("?wallpaper")).toEqual({ fps: DEFAULT_FPS });
    expect(parseWallpaper("?wallpaper=1&fps=")).toEqual({ fps: DEFAULT_FPS });
    expect(parseWallpaper("?wallpaper&fps=fast")).toEqual({ fps: DEFAULT_FPS });
  });

  it("takes a known style only", () => {
    expect(parseWallpaper("?wallpaper&style=vinyl")).toEqual({ fps: DEFAULT_FPS, style: "vinyl" });
    expect(parseWallpaper("?wallpaper&style=<b>")).toEqual({ fps: DEFAULT_FPS });
  });

  it("clamps the frame rate", () => {
    expect(parseWallpaper("?wallpaper&fps=24")).toEqual({ fps: 24 });
    expect(parseWallpaper("?wallpaper&fps=1")).toEqual({ fps: MIN_FPS });
    expect(parseWallpaper("?wallpaper&fps=240")).toEqual({ fps: MAX_FPS });
  });
});

describe("FrameCap", () => {
  it("draws about 30 of 60 frames at 30 fps", () => {
    const cap = new FrameCap(30);
    let drawn = 0;
    for (let i = 0; i < 60; i++) if (cap.ready(i * (1000 / 60))) drawn++;
    expect(drawn).toBe(30);
  });

  it("always draws the first frame", () => {
    expect(new FrameCap(10).ready(0)).toBe(true);
  });
});

describe("remembered login (wallpaper mode)", () => {
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

  it("keeps the rotated refresh token in localStorage, never in sessionStorage", async () => {
    auth.setRememberLogin(true);
    local.setItem("sv.wallpaper.refresh", "r1");
    expect(auth.isLoggedIn()).toBe(true);
    fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: "a1", refresh_token: "r2", expires_in: 3600 }));
    expect(await auth.getAccessToken(CLIENT)).toEqual({ kind: "ok", token: "a1" });
    expect(local.getItem("sv.wallpaper.refresh")).toBe("r2");
    expect(session.dump()).toEqual({});
  });

  it("the normal app ignores a remembered wallpaper login", async () => {
    local.setItem("sv.wallpaper.refresh", "r1");
    expect(auth.isLoggedIn()).toBe(false);
    expect(await auth.getAccessToken(CLIENT)).toEqual({ kind: "logged-out" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("logout and a revoked login both forget it", async () => {
    auth.setRememberLogin(true);
    local.setItem("sv.wallpaper.refresh", "r1");
    auth.logout();
    expect(local.getItem("sv.wallpaper.refresh")).toBeNull();

    local.setItem("sv.wallpaper.refresh", "r1");
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "invalid_grant" }, 400));
    expect(await auth.getAccessToken(CLIENT)).toEqual({ kind: "logged-out" });
    expect(local.getItem("sv.wallpaper.refresh")).toBeNull();
  });
});

const CODE = "AQD" + "x".repeat(120) + "-_9";

describe("pairing codes (Wallpaper Engine)", () => {
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

  it("reads the code from the #fragment only", () => {
    expect(parsePairHash("#pair=" + encodeURIComponent(CODE))).toBe(CODE);
    expect(parsePairHash("")).toBeNull();
    expect(parsePairHash("#pair=")).toBeNull();
    expect(parsePairHash("#other=1")).toBeNull();
  });

  it("only accepts token-shaped codes", () => {
    expect(auth.isValidPairCode(CODE)).toBe(true);
    expect(auth.isValidPairCode("short")).toBe(false);
    expect(auth.isValidPairCode(CODE + "<script>")).toBe(false);
    expect(auth.isValidPairCode(CODE + " " + CODE)).toBe(false);
  });

  it("imports a code only in wallpaper mode", () => {
    expect(auth.importRefreshToken(CODE)).toBe(false);
    expect(local.dump()).toEqual({});
    auth.setRememberLogin(true);
    expect(auth.importRefreshToken("nope")).toBe(false);
    expect(auth.importRefreshToken(CODE)).toBe(true);
    expect(local.getItem("sv.wallpaper.refresh")).toBe(CODE);
    expect(auth.isLoggedIn()).toBe(true);
  });

  it("takes each code once, so a rotated login isn't overwritten on every start", async () => {
    expect(await isNewPairCode(CODE, safeLocal)).toBe(true);
    expect(await isNewPairCode(CODE, safeLocal)).toBe(false);
    expect(await isNewPairCode(CODE + "2", safeLocal)).toBe(true);
    expect(JSON.stringify(local.dump())).not.toContain(CODE); // only a hash is kept
  });

  it("a pairing login hands the token over without saving anything", async () => {
    session.setItem("sv.pkce.state", "s1");
    session.setItem("sv.pkce.verifier", "v1");
    vi.stubGlobal("window", {
      location: { href: "http://127.0.0.1:5173/?code=c1&state=s1", origin: "http://127.0.0.1:5173" },
      history: { replaceState: () => {} },
    });
    fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: "a1", refresh_token: "r-pair", expires_in: 3600 }));
    expect(await auth.handleRedirect(CLIENT, { pairing: true })).toEqual({ kind: "paired", refreshToken: "r-pair" });
    expect(session.dump()).toEqual({});
    expect(local.dump()).toEqual({});
    expect(auth.isLoggedIn()).toBe(false);
  });
});
