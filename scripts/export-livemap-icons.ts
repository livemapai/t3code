#!/usr/bin/env node

// Renders the Livemap app icon into assets/livemap. Icon Composer cannot export it, so the
// design lives here: a plum body in the Livemap design system, a sun-yellow T3, map contours.
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import sharp from "sharp";

import { BRAND_ASSET_PATHS } from "./lib/brand-assets.ts";
import { encodePngIco, WINDOWS_ICON_SIZES } from "./lib/icon-export.ts";

const PLUM = "#211a2a";
const SUN = "#f6f261";
const SIZE = 1024;
// macOS pre-Tahoe icons keep a 100px safe area around an 824px body, with a native-style shadow.
const MACOS_INSET = 100;

const GLYPH_SOURCE = "assets/prod/app-icon.icon/Assets/text.svg";

function contours(cx: number, cy: number, scale: number) {
  let rings = "";
  for (let ring = 0; ring < 9; ring++) {
    const radius = (90 + ring * 82) * scale;
    const points: string[] = [];
    for (let step = 0; step < 120; step++) {
      const angle = (step / 120) * Math.PI * 2;
      const wobble =
        1 +
        0.07 * Math.sin(3 * angle + ring * 1.7) +
        0.045 * Math.sin(5 * angle + ring * 0.9 + 1) +
        0.02 * Math.sin(8 * angle + ring);
      points.push(
        `${(cx + Math.cos(angle) * radius * wobble).toFixed(1)},${(cy + Math.sin(angle) * radius * wobble * 0.82).toFixed(1)}`,
      );
    }
    const opacity = (0.13 - ring * 0.008).toFixed(3);
    rings += `<polygon points="${points.join(" ")}" fill="none" stroke="${SUN}" stroke-opacity="${opacity}" stroke-width="3.5" stroke-linejoin="round"/>`;
  }
  return rings;
}

function iconSvg(input: {
  readonly glyphPath: string;
  readonly inset: number;
  readonly shadow: boolean;
}) {
  const body = SIZE - 2 * input.inset;
  const scale = body / SIZE;
  const radius = body * 0.2237;
  const glyphScale = 8.47 * scale;
  // The glyph's bounding box center in text.svg's 128-unit viewBox.
  const [glyphCx, glyphCy] = [62.7, 65.5];
  const bodyRect = `x="${input.inset}" y="${input.inset}" width="${body}" height="${body}" rx="${radius}"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
<defs>
  <clipPath id="body"><rect ${bodyRect}/></clipPath>
  <radialGradient id="bg" cx="0.28" cy="0.18" r="1.05"><stop offset="0" stop-color="#3a2e49"/><stop offset="0.55" stop-color="${PLUM}"/><stop offset="1" stop-color="#171220"/></radialGradient>
  <radialGradient id="glow" cx="0.86" cy="0.96" r="0.75"><stop offset="0" stop-color="${SUN}" stop-opacity="0.3"/><stop offset="0.5" stop-color="${SUN}" stop-opacity="0.08"/><stop offset="1" stop-color="${SUN}" stop-opacity="0"/></radialGradient>
  <linearGradient id="glyph" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fcfaa0"/><stop offset="0.45" stop-color="${SUN}"/><stop offset="1" stop-color="#e3dc3f"/></linearGradient>
  <filter id="drop" filterUnits="userSpaceOnUse" x="0" y="0" width="${SIZE}" height="${SIZE}"><feDropShadow dx="0" dy="${14 * scale}" stdDeviation="${16 * scale}" flood-color="#0c0814" flood-opacity="0.55"/></filter>
  <filter id="bodyShadow" filterUnits="userSpaceOnUse" x="0" y="0" width="${SIZE}" height="${SIZE}"><feDropShadow dx="0" dy="14" stdDeviation="16" flood-color="#000" flood-opacity="0.45"/></filter>
</defs>
${input.shadow ? `<rect ${bodyRect} fill="#000" filter="url(#bodyShadow)"/>` : ""}
<g clip-path="url(#body)">
  <rect width="${SIZE}" height="${SIZE}" fill="url(#bg)"/>
  <rect width="${SIZE}" height="${SIZE}" fill="url(#glow)"/>
  ${contours(input.inset + body * 0.84, input.inset + body * 0.94, scale)}
  <path transform="translate(${SIZE / 2} ${SIZE / 2 + 12 * scale}) scale(${glyphScale}) translate(${-glyphCx} ${-glyphCy})" d="${input.glyphPath}" fill="url(#glyph)" filter="url(#drop)"/>
  <rect ${bodyRect} fill="none" stroke="#fff" stroke-opacity="0.1" stroke-width="3"/>
</g>
</svg>`;
}

const render = (svg: string) => Effect.promise(() => sharp(Buffer.from(svg)).png().toBuffer());

const exportLivemapIcons = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const repoRoot = path.resolve(import.meta.dirname, "..");

  const glyphSvg = yield* fs.readFileString(path.join(repoRoot, GLYPH_SOURCE));
  const glyphPath = /\sd="([^"]+)"/.exec(glyphSvg)?.[1];
  if (!glyphPath) return yield* Effect.die(new Error(`${GLYPH_SOURCE} has no glyph path.`));

  const macos = yield* render(iconSvg({ glyphPath, inset: MACOS_INSET, shadow: true }));
  const universal = yield* render(iconSvg({ glyphPath, inset: 0, shadow: false }));
  const resized = (size: number) =>
    Effect.promise(() => sharp(universal).resize(size, size).png().toBuffer());
  const ico = encodePngIco(
    yield* Effect.forEach(WINDOWS_ICON_SIZES, (size) =>
      resized(size).pipe(Effect.map((contents) => ({ size, contents }))),
    ),
  );

  const outputs: ReadonlyArray<readonly [string, Uint8Array]> = [
    [BRAND_ASSET_PATHS.livemapMacIconPng, macos],
    [BRAND_ASSET_PATHS.livemapLinuxIconPng, universal],
    [BRAND_ASSET_PATHS.livemapWindowsIconIco, ico],
    [BRAND_ASSET_PATHS.livemapWebFaviconIco, ico],
    [BRAND_ASSET_PATHS.livemapWebFavicon16Png, yield* resized(16)],
    [BRAND_ASSET_PATHS.livemapWebFavicon32Png, yield* resized(32)],
    [BRAND_ASSET_PATHS.livemapWebAppleTouchIconPng, yield* resized(180)],
  ];

  yield* fs.makeDirectory(path.join(repoRoot, "assets/livemap"), { recursive: true });
  for (const [relativePath, contents] of outputs) {
    yield* fs.writeFile(path.join(repoRoot, relativePath), contents);
    yield* Console.log(relativePath);
  }
});

if (import.meta.main) {
  exportLivemapIcons.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
}
