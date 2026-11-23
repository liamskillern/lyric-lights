import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The Android app (android/) is a thin shell that opens the live site. These checks keep its
// settings in line with the website, so a typo can't ship an app that opens the wrong page.

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const twa = JSON.parse(read("android/twa-manifest.json"));
const web = JSON.parse(read("public/manifest.webmanifest"));
const gradle = read("android/app/build.gradle");

function textFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (["build", ".gradle"].includes(name)) return [];
    if (statSync(p).isDirectory()) return textFiles(p);
    return /\.(gradle|xml|java|json|properties)$/.test(name) ? [p] : [];
  });
}

describe("Android app settings", () => {
  it("opens the live site at the app's own path", () => {
    expect(twa.packageId).toBe("io.github.liamskillern.lyriclights");
    expect(twa.host).toBe("liamskillern.github.io");
    // The deploy workflow serves the site from /<repo name>/.
    expect(twa.startUrl).toBe("/lyric-lights/");
    expect(twa.fullScopeUrl).toBe("https://liamskillern.github.io/lyric-lights/");
    expect(twa.webManifestUrl).toBe("https://liamskillern.github.io/lyric-lights/manifest.webmanifest");
    expect(gradle).toContain("hostName: 'liamskillern.github.io'");
    expect(gradle).toContain("launchUrl: '/lyric-lights/'");
  });

  it("matches the web app manifest", () => {
    expect(twa.name).toBe(web.name);
    expect(twa.display).toBe(web.display);
    expect(twa.backgroundColor.toLowerCase()).toBe(web.background_color.toLowerCase());
  });

  it("meets Google Play's target API level and the library's minimum", () => {
    expect(gradle).toMatch(/targetSdkVersion 36\b/);
    expect(gradle).toMatch(/minSdkVersion 24\b/);
    expect(gradle).toContain(`versionCode ${twa.appVersionCode}`);
  });

  it("has no leftover local addresses (it was generated from a local copy of the site)", () => {
    for (const f of textFiles(join(root, "android"))) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/127\.0\.0\.1|localhost:\d/);
    }
  });

  it("claims only the site it should", () => {
    const strings = read("android/app/src/main/res/values/strings.xml");
    expect(strings).toContain('\\"site\\": \\"https://liamskillern.github.io\\"');
    expect(twa.additionalTrustedOrigins).toEqual([]);
  });
});
