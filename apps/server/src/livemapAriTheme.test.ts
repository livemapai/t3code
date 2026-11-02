import { EnvironmentThemeFile, environmentThemeFileHasColors } from "@t3tools/contracts";
import { THEME_COLOR_ROLES } from "@t3tools/shared/themePalettes";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ServerConfig from "./config.ts";
import { installAriTheme } from "./livemapAriTheme.ts";

const decodeThemeFile = Schema.decodeUnknownSync(Schema.fromJsonString(EnvironmentThemeFile));

it.layer(NodeServices.layer)("livemap Ari theme", (it) => {
  it.effect("publishes a complete theme and becomes the default on first start only", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-ari-theme-" });
      yield* Effect.gen(function* () {
        const { environmentThemesDir, settingsPath } = yield* ServerConfig.ServerConfig;
        const path = yield* Path.Path;
        const themePath = path.join(environmentThemesDir, "ari.json");
        const readSettings = fs.readFileString(settingsPath).pipe(Effect.map(JSON.parse));

        yield* installAriTheme();
        const theme = decodeThemeFile(yield* fs.readFileString(themePath));
        assert.isTrue(environmentThemeFileHasColors(theme));
        for (const colors of [theme.colors, theme.variants?.dark]) {
          assert.deepEqual(
            THEME_COLOR_ROLES.filter((role) => colors?.[role] === undefined),
            [],
          );
        }
        assert.equal((yield* readSettings).defaultTheme, "ari");

        // The user clears the default, and a stale published file is refreshed on the next start.
        yield* fs.writeFileString(settingsPath, "{}\n");
        yield* fs.writeFileString(themePath, "{}");
        yield* installAriTheme();
        assert.deepEqual(yield* readSettings, {});
        assert.equal(decodeThemeFile(yield* fs.readFileString(themePath)).name, "Ari");
      }).pipe(Effect.provide(ServerConfig.layerTest(process.cwd(), baseDir)));
    }).pipe(Effect.scoped),
  );

  it.effect("keeps a default the administrator already chose", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-ari-theme-" });
      yield* Effect.gen(function* () {
        const { settingsPath } = yield* ServerConfig.ServerConfig;
        yield* fs.makeDirectory(path.dirname(settingsPath), { recursive: true });
        yield* fs.writeFileString(settingsPath, '{"defaultTheme":"nightfall"}\n');
        yield* installAriTheme();
        assert.equal(JSON.parse(yield* fs.readFileString(settingsPath)).defaultTheme, "nightfall");
      }).pipe(Effect.provide(ServerConfig.layerTest(process.cwd(), baseDir)));
    }).pipe(Effect.scoped),
  );
});
