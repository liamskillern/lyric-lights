import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioInput, BeatDetector, SupersededError } from "../src/audio";

describe("BeatDetector", () => {
  it("finds a steady kick drum and ignores the quiet between hits", () => {
    const d = new BeatDetector();
    const beats: number[] = [];
    // 120 BPM = a kick every 500 ms; frames every ~16 ms.
    for (let t = 0; t < 4000; t += 16) {
      const energy = t % 500 < 48 ? 0.9 : 0.1;
      if (d.push(energy, t).beat) beats.push(t);
    }
    expect(beats.length).toBeGreaterThanOrEqual(7);
    expect(beats.length).toBeLessThanOrEqual(8);
    for (let i = 1; i < beats.length; i++) expect(beats[i] - beats[i - 1]).toBeGreaterThanOrEqual(450);
  });

  it("doesn't trigger on steady noise", () => {
    const d = new BeatDetector();
    let count = 0;
    for (let t = 0; t < 3000; t += 16) if (d.push(0.5, t).beat) count++;
    expect(count).toBe(0);
  });

  it("reports level between 0 and 1", () => {
    const d = new BeatDetector();
    const { level } = d.push(3, 0);
    expect(level).toBeLessThanOrEqual(1);
    expect(level).toBeGreaterThan(0);
  });
});

import { AutoGain, bandEnergy, FlashLimiter } from "../src/audio";

describe("FlashLimiter", () => {
  it("lets at most 3 flashes through per second", () => {
    const f = new FlashLimiter(3);
    let n = 0;
    for (let t = 0; t < 1000; t += 50) if (f.allow(t)) n++; // 20 beats in a second
    expect(n).toBe(3);
  });
});

describe("bandEnergy", () => {
  // 48 kHz / 2048 ≈ 23.4 Hz per bin
  const hz = 48000 / 2048;
  it("reads only the bins in the range", () => {
    const bins = new Uint8Array(1024);
    for (let i = 2; i <= 7; i++) bins[i] = 255; // ≈47–164 Hz
    expect(bandEnergy(bins, hz, 40, 160)).toBeGreaterThan(0.8);
    expect(bandEnergy(bins, hz, 4000, 12000)).toBe(0);
  });
  it("is 0 for silence and stays in range", () => {
    expect(bandEnergy(new Uint8Array(1024), hz, 400, 2000)).toBe(0);
    expect(bandEnergy(new Uint8Array(1024).fill(255), hz, 400, 2000)).toBe(1);
  });
});

describe("AutoGain", () => {
  it("scales quiet music up toward 1 and never passes 1", () => {
    const g = new AutoGain();
    let v = 0;
    for (let i = 0; i < 2000; i++) v = g.push(0.2);
    expect(v).toBeCloseTo(1, 1);
    expect(g.push(0.9)).toBe(1);
  });
});

// ---- AudioInput: the mic must really be off when beat sync says it is ----

class FakeTrack {
  readyState: "live" | "ended" = "live";
  constructor(public kind: "audio" | "video") {}
  stop() {
    this.readyState = "ended";
  }
  addEventListener() {}
}
class FakeStream {
  tracks = [new FakeTrack("audio")];
  getTracks() {
    return this.tracks;
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === "audio");
  }
  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === "video");
  }
}
class FakeAudioContext {
  static open = 0;
  sampleRate = 48_000;
  constructor() {
    FakeAudioContext.open++;
  }
  createMediaStreamSource() {
    return { connect() {} };
  }
  createAnalyser() {
    return { fftSize: 0, smoothingTimeConstant: 0, frequencyBinCount: 1024, getByteFrequencyData() {} };
  }
  async close() {
    FakeAudioContext.open--;
  }
}

/** A fake mic whose permission answers arrive only when the test says so. */
function fakeMic() {
  const pending: ((s: FakeStream) => void)[] = [];
  const streams: FakeStream[] = [];
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("navigator", {
    userAgent: "test",
    mediaDevices: {
      getUserMedia: () =>
        new Promise<FakeStream>((resolve) => {
          const s = new FakeStream();
          streams.push(s);
          pending.push(() => resolve(s));
        }),
    },
  });
  const live = () => streams.flatMap((s) => s.tracks).filter((t) => t.readyState === "live").length;
  const answerAll = async () => {
    pending.splice(0).forEach((r) => r(undefined as never));
    await new Promise((r) => setTimeout(r, 0));
  };
  return { streams, live, answerAll };
}

describe("AudioInput start/stop", () => {
  beforeEach(() => {
    FakeAudioContext.open = 0;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("a normal start and stop leaves nothing running", async () => {
    const mic = fakeMic();
    const a = new AudioInput();
    const started = a.start("mic");
    await mic.answerAll();
    await started;
    expect(a.active).toBe(true);
    expect(mic.live()).toBe(1);
    a.stop();
    expect(mic.live()).toBe(0);
    await new Promise((r) => setTimeout(r, 0));
    expect(FakeAudioContext.open).toBe(0);
  });

  it("two quick starts (a double click) keep one mic, and Off stops it", async () => {
    const mic = fakeMic();
    const a = new AudioInput();
    const first = a.start("mic").catch((e: Error) => e);
    const second = a.start("mic");
    await mic.answerAll();
    expect(await first).toBeInstanceOf(SupersededError);
    await second;
    expect(mic.streams.length).toBe(2);
    expect(mic.live()).toBe(1); // the first one was let go as soon as it arrived
    expect(FakeAudioContext.open).toBe(1);
    a.stop();
    expect(mic.live()).toBe(0);
  });

  it("Off while the browser is still asking cancels the request", async () => {
    const mic = fakeMic();
    const a = new AudioInput();
    const started = a.start("mic").catch((e: Error) => e);
    a.stop();
    await mic.answerAll();
    expect(await started).toBeInstanceOf(SupersededError);
    expect(a.active).toBe(false);
    expect(mic.live()).toBe(0);
    expect(FakeAudioContext.open).toBe(0);
  });
});
