import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentIdentificationMode } from "@t3tools/contracts";
import { useId } from "react";

import regularArtwork from "../assets/build-artwork/regular.webp";
import devArtwork from "../assets/build-artwork/dev.webp";
import nightlyArtwork from "../assets/build-artwork/nightly.webp";
import { APP_STAGE_LABEL } from "../branding";
import { resolveServerBackedAppStageLabel } from "../branding.logic";
import { primaryServerConfigAtom } from "../state/server";

const artwork = { regular: regularArtwork, dev: devArtwork, nightly: nightlyArtwork };
type SidebarStageBackdropVariant = keyof typeof artwork;
export type EnvironmentIdentificationPillLabel = "Dev" | "Nightly";

export function resolveSidebarStageBackdropVariant(
  stageLabel: string,
  mode: EnvironmentIdentificationMode = "artwork",
): SidebarStageBackdropVariant | null {
  if (mode === "nightly-artwork") return "nightly";
  if (mode === "dev-artwork") return "dev";
  if (mode !== "artwork") return null;
  const normalized = stageLabel.trim().toLowerCase();
  if (normalized === "nightly") return "nightly";
  if (normalized === "dev") return "dev";
  return "regular";
}

export function resolveEnvironmentIdentificationPillLabel(
  stageLabel: string,
): EnvironmentIdentificationPillLabel | null {
  const normalized = stageLabel.trim().toLowerCase();
  // oxlint-disable-next-line t3code/no-untranslated-copy -- release channel names
  if (normalized === "dev") return "Dev";
  // oxlint-disable-next-line t3code/no-untranslated-copy -- release channel names
  if (normalized === "nightly") return "Nightly";
  return null;
}

export function useEnvironmentStageLabel(): string {
  const primaryServerVersion =
    useAtomValue(primaryServerConfigAtom)?.environment.serverVersion ?? null;

  return resolveServerBackedAppStageLabel({
    primaryServerVersion,
    fallbackStageLabel: APP_STAGE_LABEL,
  });
}

export function SidebarStageBackdrop({ variant }: { variant: SidebarStageBackdropVariant }) {
  const crop = {
    regular: { objectPosition: "74% 59%", scale: "1.05" },
    dev: { objectPosition: "88% 38%", scale: "1.18" },
    nightly: { objectPosition: "81% 67%", scale: "1.10" },
  }[variant];
  return (
    <div
      aria-hidden
      className="sidebar-stage-backdrop pointer-events-none absolute inset-x-0 top-0 z-0 h-20 select-none overflow-hidden"
    >
      <img
        alt=""
        draggable={false}
        src={artwork[variant]}
        className="size-full object-cover [mask-image:linear-gradient(90deg,#0003,#0008_36%,black_66%)]"
        style={{ ...crop, transformOrigin: crop.objectPosition }}
      />
    </div>
  );
}

export function useComposerBackdropVariant(mode: EnvironmentIdentificationMode) {
  const variant = resolveSidebarStageBackdropVariant(useEnvironmentStageLabel(), mode);
  return variant === "regular" ? null : variant;
}

const EMBER_SPARKS: ReadonlyArray<{
  cx: number;
  cy: number;
  r: number;
  opacity: number;
}> = [
  { cx: 18, cy: 14, r: 0.75, opacity: 0.85 },
  { cx: 44, cy: 26, r: 0.5, opacity: 0.58 },
  { cx: 72, cy: 11, r: 0.65, opacity: 0.74 },
  { cx: 102, cy: 21, r: 0.5, opacity: 0.55 },
  { cx: 128, cy: 9, r: 0.75, opacity: 0.82 },
  { cx: 154, cy: 25, r: 0.55, opacity: 0.62 },
  { cx: 182, cy: 13, r: 0.7, opacity: 0.76 },
  { cx: 208, cy: 28, r: 0.5, opacity: 0.55 },
  { cx: 234, cy: 12, r: 0.8, opacity: 0.85 },
  { cx: 262, cy: 23, r: 0.55, opacity: 0.65 },
  { cx: 286, cy: 10, r: 0.65, opacity: 0.75 },
  { cx: 306, cy: 26, r: 0.55, opacity: 0.6 },
  { cx: 56, cy: 38, r: 0.5, opacity: 0.52 },
  { cx: 144, cy: 40, r: 0.55, opacity: 0.58 },
  { cx: 248, cy: 36, r: 0.5, opacity: 0.52 },
];

const EMBER_GLINTS: ReadonlyArray<{ x: number; y: number }> = [
  { x: 86, y: 27 },
  { x: 196, y: 31 },
  { x: 276, y: 22 },
];

export function StageBackdropButtonArt({ variant }: { variant: "dev" | "nightly" }) {
  const idPrefix = useId().replaceAll(":", "");
  const isNightly = variant === "nightly";
  const skyId = `${idPrefix}-stage-sky`;
  const upperGlowId = `${idPrefix}-stage-upper-glow`;
  const horizonGlowId = `${idPrefix}-stage-horizon-glow`;
  const smokeCloudId = `${idPrefix}-stage-smoke-cloud`;
  const emberCloudId = `${idPrefix}-stage-ember-cloud`;
  const rimHighlightId = `${idPrefix}-stage-rim-highlight`;
  const smokeSoftId = `${idPrefix}-stage-smoke-soft`;
  const emberSoftId = `${idPrefix}-stage-ember-soft`;
  const glowsPatternId = `${idPrefix}-stage-glows`;
  const cloudsPatternId = `${idPrefix}-stage-clouds`;
  const sparksPatternId = `${idPrefix}-stage-sparks`;

  const bottomToken = isNightly ? "var(--stage-night-bottom)" : "var(--stage-art-bottom)";
  const midToken = isNightly ? "var(--stage-night-mid)" : "var(--stage-art-mid)";
  const topToken = isNightly ? "var(--stage-night-top)" : "var(--stage-art-top)";
  const highlightToken = isNightly ? "var(--stage-night-highlight)" : "var(--stage-art-highlight)";
  const secondaryToken = isNightly ? "var(--stage-night-secondary)" : "var(--stage-art-secondary)";
  const tertiaryToken = isNightly ? "var(--stage-night-tertiary)" : "var(--stage-art-tertiary)";
  const glowHighlightToken = isNightly
    ? "var(--stage-night-glow-highlight)"
    : "var(--stage-art-celeste-highlight)";
  const glowSecondaryToken = isNightly
    ? "var(--stage-night-glow-secondary)"
    : "var(--stage-art-celeste-secondary)";
  const sparkToken = isNightly ? "var(--stage-night-line)" : "var(--stage-art-line)";
  const glintToken = isNightly ? "var(--stage-night-sparkle)" : "var(--stage-art-line)";

  return (
    <svg
      data-stage-art={isNightly ? "nightly" : "ember-cloud"}
      className="h-full w-full"
      fill="none"
      preserveAspectRatio="xMinYMin slice"
      viewBox="48 8 8192 88"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient
          id={skyId}
          x1="28"
          y1="0"
          x2="260"
          y2="96"
          gradientUnits="userSpaceOnUse"
          spreadMethod="reflect"
        >
          <stop style={{ stopColor: bottomToken }} />
          <stop offset="0.52" style={{ stopColor: midToken }} />
          <stop offset="1" style={{ stopColor: topToken }} />
        </linearGradient>

        <radialGradient
          id={upperGlowId}
          cx="0"
          cy="0"
          r="1"
          gradientTransform="translate(226 24) rotate(142) scale(134 78)"
          gradientUnits="userSpaceOnUse"
        >
          <stop style={{ stopColor: glowHighlightToken }} stopOpacity="0.46" />
          <stop offset="0.52" style={{ stopColor: glowSecondaryToken }} stopOpacity="0.22" />
          <stop offset="1" style={{ stopColor: bottomToken }} stopOpacity="0" />
        </radialGradient>

        <radialGradient
          id={horizonGlowId}
          cx="0"
          cy="0"
          r="1"
          gradientTransform="translate(116 92) rotate(-90) scale(58 148)"
          gradientUnits="userSpaceOnUse"
        >
          <stop style={{ stopColor: highlightToken }} stopOpacity="0.52" />
          <stop offset="0.48" style={{ stopColor: secondaryToken }} stopOpacity="0.26" />
          <stop offset="1" style={{ stopColor: bottomToken }} stopOpacity="0" />
        </radialGradient>

        <linearGradient
          id={smokeCloudId}
          x1="0"
          y1="38"
          x2="320"
          y2="96"
          gradientUnits="userSpaceOnUse"
        >
          <stop style={{ stopColor: bottomToken }} stopOpacity="0.72" />
          <stop offset="0.45" style={{ stopColor: tertiaryToken }} stopOpacity="0.64" />
          <stop offset="1" style={{ stopColor: bottomToken }} stopOpacity="0.68" />
        </linearGradient>

        <linearGradient
          id={emberCloudId}
          x1="12"
          y1="44"
          x2="308"
          y2="94"
          gradientUnits="userSpaceOnUse"
        >
          <stop style={{ stopColor: secondaryToken }} stopOpacity="0.68" />
          <stop offset="0.48" style={{ stopColor: highlightToken }} stopOpacity="0.58" />
          <stop offset="1" style={{ stopColor: tertiaryToken }} stopOpacity="0.62" />
        </linearGradient>

        <radialGradient
          id={rimHighlightId}
          cx="0"
          cy="0"
          r="1"
          gradientTransform="translate(110 64) rotate(8) scale(110 34)"
          gradientUnits="userSpaceOnUse"
        >
          <stop style={{ stopColor: highlightToken }} stopOpacity="0.54" />
          <stop offset="0.58" style={{ stopColor: secondaryToken }} stopOpacity="0.22" />
          <stop offset="1" style={{ stopColor: tertiaryToken }} stopOpacity="0" />
        </radialGradient>

        <filter
          id={smokeSoftId}
          x="-28"
          y="-20"
          width="376"
          height="136"
          filterUnits="userSpaceOnUse"
        >
          <feGaussianBlur stdDeviation="4.8" />
        </filter>
        <filter
          id={emberSoftId}
          x="-24"
          y="-20"
          width="368"
          height="136"
          filterUnits="userSpaceOnUse"
        >
          <feGaussianBlur stdDeviation="2.6" />
        </filter>

        <pattern id={glowsPatternId} width="320" height="96" patternUnits="userSpaceOnUse">
          <rect width="320" height="96" fill={`url(#${upperGlowId})`} />
          <rect width="320" height="96" fill={`url(#${horizonGlowId})`} />
        </pattern>

        <pattern id={cloudsPatternId} width="320" height="96" patternUnits="userSpaceOnUse">
          <g filter={`url(#${smokeSoftId})`}>
            <path
              d="M-24 88C-18 68 2 55 24 56C33 38 52 28 74 30C92 31 108 42 115 58C124 51 136 47 149 48C171 50 189 65 193 85C205 84 216 88 223 96H-24V88Z"
              fill={`url(#${smokeCloudId})`}
            />
            <path
              d="M178 96C181 79 195 67 212 67C219 51 236 41 255 43C272 44 287 54 294 69C305 68 315 74 322 83C330 85 336 90 340 96H178Z"
              fill={`url(#${smokeCloudId})`}
              fillOpacity="0.9"
            />
          </g>

          <g filter={`url(#${emberSoftId})`}>
            <path
              d="M-10 92C-4 76 11 66 28 67C36 52 52 43 70 45C85 46 98 55 104 68C113 62 124 60 135 61C154 63 169 76 173 92C151 88 131 90 111 93C73 97 34 88 -10 92Z"
              fill={`url(#${emberCloudId})`}
            />
            <path
              d="M168 94C174 81 186 73 200 74C207 61 221 53 237 55C251 56 263 65 268 77C278 74 290 76 298 85C308 86 316 90 322 96H168V94Z"
              fill={`url(#${emberCloudId})`}
              fillOpacity="0.88"
            />
            <path
              d="M14 82C26 70 43 65 60 68C70 55 86 49 102 53C116 56 126 65 131 76C146 71 163 75 172 86C148 80 128 82 108 86C76 92 46 80 14 82Z"
              fill={`url(#${rimHighlightId})`}
            />
          </g>
        </pattern>

        <pattern id={sparksPatternId} width="320" height="96" patternUnits="userSpaceOnUse">
          <g style={{ fill: sparkToken }}>
            {EMBER_SPARKS.map((spark) => (
              <circle
                key={`${spark.cx}-${spark.cy}`}
                cx={spark.cx}
                cy={spark.cy}
                r={spark.r}
                fillOpacity={spark.opacity}
              />
            ))}
          </g>
          <g
            style={{ stroke: glintToken }}
            strokeLinecap="round"
            strokeOpacity="0.72"
            strokeWidth="0.65"
          >
            {EMBER_GLINTS.map((glint) => (
              <g key={`${glint.x}-${glint.y}`}>
                <path d={`M${glint.x - 1.75} ${glint.y}H${glint.x + 1.75}`} />
                <path d={`M${glint.x} ${glint.y - 1.75}V${glint.y + 1.75}`} />
              </g>
            ))}
          </g>
        </pattern>
      </defs>

      <rect width="100%" height="96" fill={`url(#${skyId})`} />
      <rect width="100%" height="96" fill={`url(#${glowsPatternId})`} />
      <rect width="100%" height="96" fill={`url(#${cloudsPatternId})`} />
      <rect width="100%" height="96" fill={`url(#${sparksPatternId})`} />
    </svg>
  );
}
