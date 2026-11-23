import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as auth from "../src/auth";
import { DEFAULT_FPS, FrameCap, MAX_FPS, MIN_FPS, parseWallpaper } from "../src/wallpaper";
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
