import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import { fromLenientJson } from "@t3tools/shared/schemaJson";

import ariTheme from "../../../livemap/themes/ari.json" with { type: "json" };
import * as ServerConfig from "./config.ts";

const ARI_THEME_ID = "ari";
const toFileContents = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const ariThemeContents = toFileContents(ariTheme);
const decodeSettings = Schema.decodeUnknownEffect(fromLenientJson(Schema.Unknown));

/**
 * Livemap fork only. Publishes the Ari theme on every start so palette updates ship with the app,
 * and makes it the default once, on the first start that finds no `ari.json`. After that the
 * default is the user's: `t3 theme clear` or picking another theme sticks.
 */
export const installAriTheme = Effect.fn("livemap.installAriTheme")(function* () {
  const { environmentThemesDir, settingsPath } = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const themePath = path.join(environmentThemesDir, `${ARI_THEME_ID}.json`);
  const existed = yield* fs.exists(themePath);
  const published = existed ? yield* fs.readFileString(themePath) : "";
  if (published !== ariThemeContents) {
    yield* writeFileStringAtomically({ filePath: themePath, contents: ariThemeContents });
  }
  if (existed) return;

  const settingsRaw = (yield* fs.exists(settingsPath))
    ? yield* fs.readFileString(settingsPath)
    : "";
  // Anything but a plain JSON object is left alone: a sparse file must never replace unread settings.
  const settings: unknown =
    settingsRaw.trim().length === 0 ? {} : yield* decodeSettings(settingsRaw);
  if (typeof settings !== "object" || settings === null || Array.isArray(settings)) return;
  const current = (settings as { readonly defaultTheme?: unknown }).defaultTheme;
  if (typeof current === "string" && current.length > 0) return;

  const setAt = DateTime.formatIso(yield* DateTime.now);
  yield* writeFileStringAtomically({
    filePath: settingsPath,
    contents: toFileContents({ ...settings, defaultTheme: ARI_THEME_ID, defaultThemeSetAt: setAt }),
  });
});
