import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TokenResult } from "../src/auth";
import { RETRY_MESSAGE, SpotifyPoller } from "../src/spotify";
import { jsonResponse } from "./helpers";

const playing = {
  is_playing: true,
  progress_ms: 1000,
  currently_playing_type: "track",
  item: { id: "t", name: "Song", duration_ms: 200_000, artists: [{ name: "A" }], album: { name: "B", images: [] } },
};

function setup(tokens: TokenResult[]) {
  const onPlayback = vi.fn();
  const onError = vi.fn();
  const onLoggedOut = vi.fn();
  const getToken = vi.fn(async () => tokens.shift() ?? { kind: "ok" as const, token: "tok" });
  const poller = new SpotifyPoller({ getToken, onRefreshNeeded: getToken, onPlayback, onError, onLoggedOut });
  return { poller, onPlayback, onError, onLoggedOut, getToken };
}

describe("SpotifyPoller resilience", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps polling after a broken response", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{not json", { status: 200 })).mockResolvedValue(jsonResponse(playing));
    const { poller, onPlayback, onError } = setup([]);
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(onError).toHaveBeenCalledWith(RETRY_MESSAGE);
    expect(onPlayback).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(onPlayback).toHaveBeenCalledTimes(1);
    poller.stop();
  });

  it("retries when the token can't be refreshed right now, without logging out", async () => {
    fetchMock.mockResolvedValue(jsonResponse(playing));
    const { poller, onPlayback, onError, onLoggedOut } = setup([{ kind: "unavailable" }]);
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(onError).toHaveBeenCalledWith(RETRY_MESSAGE);
    expect(onLoggedOut).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(onPlayback).toHaveBeenCalledTimes(1);
    poller.stop();
  });

  it("keeps polling when the network is down", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValue(jsonResponse(playing));
    const { poller, onPlayback, onError } = setup([]);
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(onError).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(onPlayback).toHaveBeenCalledTimes(1);
    poller.stop();
  });

  it("stops and reports when logged out", async () => {
    const { poller, onLoggedOut } = setup([{ kind: "logged-out" }]);
    poller.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onLoggedOut).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes once after a 401, then logs out if it still fails", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 401 }));
    const { poller, onLoggedOut, getToken } = setup([]);
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(getToken).toHaveBeenCalledTimes(2);
    expect(onLoggedOut).toHaveBeenCalledTimes(1);
    poller.stop();
  });
});
