import type { BrowserLinkTarget } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { resolveLinkTarget } from "./browserLinkTarget";

const settings = vi.hoisted(() => ({
  browserLinkTarget: "system" as BrowserLinkTarget,
  ariLibraryLinksInAppEnabled: true,
}));

vi.mock("~/hooks/useSettings", () => ({
  ensureClientSettingsHydrated: vi.fn(async () => undefined),
  getClientSettings: () => settings,
}));

const click = { metaKey: false, ctrlKey: false };

describe("resolveLinkTarget", () => {
  it("leaves non-web schemes to the shell", () => {
    for (const url of ["mailto:someone@example.com", "vscode://file/x", "not a url"]) {
      expect(resolveLinkTarget({ url, event: click, preference: "app", canOpenInApp: true })).toBe(
        "system",
      );
    }
  });

  it("opens Ari Library files in the app even when links default to the system browser", () => {
    const library = "https://www.myari.app/en/assets?id=70b38675-9375-4dc9-9b34-0e6ca73c9fdd";
    const resolve = (url: string, event = click, canOpenInApp = true) =>
      resolveLinkTarget({ url, event, preference: "system", canOpenInApp });

    expect(resolve(library)).toBe("app");
    settings.ariLibraryLinksInAppEnabled = false;
    expect(resolve(library)).toBe("system");
    settings.ariLibraryLinksInAppEnabled = true;
    expect(resolve(library, { ...click, metaKey: true })).toBe("system");
    expect(resolve(library, click, false)).toBe("system");
    for (const url of [
      "https://www.myari.app/en/places",
      "http://www.myari.app/en/assets?id=1",
      "https://myari.app.evil.example/en/assets?id=1",
      "https://example.com/en/assets?id=1",
    ]) {
      expect(resolve(url)).toBe("system");
    }
  });
});
