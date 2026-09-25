import { describe, expect, it } from "bun:test";
import {
  APPLE_TEAM_ID,
  IOS_APP_ID,
  UNIVERSAL_LINK_EXCLUDES,
  UNIVERSAL_LINK_PATHS,
  buildAppleAppSiteAssociation,
} from "./apple-app-site-association";

describe("apple-app-site-association", () => {
  const doc = buildAppleAppSiteAssociation();
  const components = doc.applinks.details[0].components;

  it("names the real team and bundle for links and AutoFill", () => {
    expect(APPLE_TEAM_ID).toBe("79RN82HXPZ");
    expect(IOS_APP_ID).toBe("79RN82HXPZ.training.gradus.app");
    expect(doc.applinks.details[0].appIDs).toEqual([IOS_APP_ID]);
    expect(doc.webcredentials.apps).toEqual([IOS_APP_ID]);
  });

  it("lists every excluded path before any app path, since the first match wins", () => {
    const firstInclude = components.findIndex((c) => !c.exclude);
    const lastExclude = components.map((c) => !!c.exclude).lastIndexOf(true);
    expect(lastExclude).toBeLessThan(firstInclude);
    expect(components.filter((c) => c.exclude).map((c) => c["/"])).toEqual([
      ...UNIVERSAL_LINK_EXCLUDES,
    ]);
    expect(components.filter((c) => !c.exclude).map((c) => c["/"])).toEqual([
      ...UNIVERSAL_LINK_PATHS,
    ]);
  });

  it("keeps the PRD §6.10 paths and the Safari-only paths apart", () => {
    for (const p of [
      "/board",
      "/board/*",
      "/i/*",
      "/login",
      "/signup/*",
      "/coach/*",
      "/parent/*",
      "/athlete/*",
      "/g/*",
      "/team/*",
      "/p/*",
    ]) {
      expect(UNIVERSAL_LINK_PATHS).toContain(p);
    }
    for (const p of [
      "/reset-password",
      "/privacy",
      "/terms",
      "/unsubscribe",
      "/admin/*",
      "/org-admin/*",
      "/api/*",
      "/email/*",
      "/lovable/*",
    ]) {
      expect(UNIVERSAL_LINK_EXCLUDES).toContain(p);
    }
  });

  it("serialises to plain JSON", () => {
    expect(JSON.parse(JSON.stringify(doc))).toEqual(doc);
  });
});
