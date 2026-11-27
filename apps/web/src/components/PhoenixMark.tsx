import { useId, type SVGProps } from "react";

const OUTER_LEFT_PATH =
  "M57.2 97.6 C49.4 87.2 37.8 83.2 28.4 76.2 C19.6 69.6 16.0 58.6 18.6 47.6 C20.8 56.0 27.6 61.6 36.8 65.2 C47.2 69.2 54.4 78.6 58.0 95.6 C58.2 96.6 57.7 97.4 57.2 97.6 Z M54.0 91.6 C47.8 82.8 39.2 77.6 30.2 72.2 C38.8 79.4 46.6 84.6 52.8 92.8 C53.4 93.4 54.4 92.4 54.0 91.6 Z";
const OUTER_RIGHT_PATH =
  "M70.8 97.6 C78.6 87.2 90.2 83.2 99.6 76.2 C108.4 69.6 112.0 58.6 109.4 47.6 C107.2 56.0 100.4 61.6 91.2 65.2 C80.8 69.2 73.6 78.6 70.0 95.6 C69.8 96.6 70.3 97.4 70.8 97.6 Z M74.0 91.6 C80.2 82.8 88.8 77.6 97.8 72.2 C89.2 79.4 81.4 84.6 75.2 92.8 C74.6 93.4 73.6 92.4 74.0 91.6 Z";
const INNER_LEFT_PATH =
  "M59.2 90.6 C53.6 77.6 43.2 67.2 37.8 55.2 C33.6 45.8 35.0 35.6 40.8 28.4 C39.8 36.6 44.2 43.8 50.2 50.4 C56.8 57.6 60.8 68.8 60.4 89.2 C60.3 90.2 59.6 91.0 59.2 90.6 Z M57.0 82.8 C53.4 71.8 47.2 62.6 41.6 53.6 C46.4 63.8 51.8 72.6 55.6 83.8 C56.0 84.6 57.3 83.8 57.0 82.8 Z";
const INNER_RIGHT_PATH =
  "M68.8 90.6 C74.4 77.6 84.8 67.2 90.2 55.2 C94.4 45.8 93.0 35.6 87.2 28.4 C88.2 36.6 83.8 43.8 77.8 50.4 C71.2 57.6 67.2 68.8 67.6 89.2 C67.7 90.2 68.4 91.0 68.8 90.6 Z M71.0 82.8 C74.6 71.8 80.8 62.6 86.4 53.6 C81.6 63.8 76.2 72.6 72.4 83.8 C72.0 84.6 70.7 83.8 71.0 82.8 Z";
const CENTER_PLUME_PATH =
  "M64 17.5 C66.4 26.8 74.2 35.2 74.2 46.8 C74.2 57.8 66.8 67.2 64.5 85.8 C64.4 86.8 63.6 86.8 63.5 85.8 C61.2 67.2 53.8 57.8 53.8 46.8 C53.8 35.2 61.6 26.8 64 17.5 Z";
const SPARK_PATH =
  "M64 88.2 C64.7 91.0 65.5 92.1 67.8 93.0 C65.5 93.9 64.7 95.0 64 97.8 C63.3 95.0 62.5 93.9 60.2 93.0 C62.5 92.1 63.3 91.0 64 88.2 Z";
const ASH_LEFT_PATH = "M64 100.6 L58.4 106.8 L64 113.0 Z";
const ASH_RIGHT_PATH = "M64 100.6 L69.6 106.8 L64 113.0 Z";
const ASH_FULL_PATH = "M64 100.6 L58.4 106.8 L64 113.0 L69.6 106.8 Z";

function PhoenixPlumePaths({
  idPrefix,
  mono,
}: {
  readonly idPrefix: string;
  readonly mono: boolean;
}) {
  if (mono) {
    return (
      <>
        <path fillRule="evenodd" d={OUTER_LEFT_PATH} fill="currentColor" />
        <path fillRule="evenodd" d={OUTER_RIGHT_PATH} fill="currentColor" />
        <path fillRule="evenodd" d={INNER_LEFT_PATH} fill="currentColor" />
        <path fillRule="evenodd" d={INNER_RIGHT_PATH} fill="currentColor" />
        <path d={CENTER_PLUME_PATH} fill="currentColor" />
        <path d={SPARK_PATH} fill="currentColor" />
        <path d={ASH_FULL_PATH} fill="currentColor" opacity={0.58} />
      </>
    );
  }

  return (
    <>
      <path fillRule="evenodd" d={OUTER_LEFT_PATH} fill={`url(#${idPrefix}-outer)`} />
      <path fillRule="evenodd" d={OUTER_RIGHT_PATH} fill={`url(#${idPrefix}-outer)`} />
      <path fillRule="evenodd" d={INNER_LEFT_PATH} fill={`url(#${idPrefix}-inner)`} />
      <path fillRule="evenodd" d={INNER_RIGHT_PATH} fill={`url(#${idPrefix}-inner)`} />
      <path d={CENTER_PLUME_PATH} fill={`url(#${idPrefix}-center)`} />
      <path d={SPARK_PATH} fill={`url(#${idPrefix}-spark)`} />
      <path d={ASH_LEFT_PATH} fill={`url(#${idPrefix}-ash-hi)`} />
      <path d={ASH_RIGHT_PATH} fill={`url(#${idPrefix}-ash-lo)`} />
    </>
  );
}

export function PhoenixMark(
  props: SVGProps<SVGSVGElement> & {
    readonly variant?: "brand" | "plate" | "mono";
  },
) {
  const { variant = "brand", ...svgProps } = props;
  const mono = variant === "mono";
  const idPrefix = useId().replaceAll(":", "");

  return (
    <svg {...svgProps} viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
      {!mono ? (
        <defs>
          {variant === "plate" ? (
            <>
              <radialGradient id={`${idPrefix}-bg`} cx="50%" cy="40%" r="70%">
                <stop offset="0%" style={{ stopColor: "var(--phoenix-plate-bg-top)" }} />
                <stop offset="56%" style={{ stopColor: "var(--phoenix-plate-bg-mid)" }} />
                <stop offset="100%" style={{ stopColor: "var(--phoenix-plate-bg-deep)" }} />
              </radialGradient>
              <radialGradient id={`${idPrefix}-glow`} cx="50%" cy="56%" r="45%">
                <stop
                  offset="0%"
                  style={{ stopColor: "var(--phoenix-plate-glow-core)" }}
                  stopOpacity="0.22"
                />
                <stop
                  offset="52%"
                  style={{ stopColor: "var(--phoenix-plate-glow-mid)" }}
                  stopOpacity="0.08"
                />
                <stop
                  offset="100%"
                  style={{ stopColor: "var(--phoenix-plate-glow-edge)" }}
                  stopOpacity="0"
                />
              </radialGradient>
              <linearGradient
                id={`${idPrefix}-rim`}
                x1="64"
                y1="1"
                x2="64"
                y2="127"
                gradientUnits="userSpaceOnUse"
              >
                <stop
                  offset="0%"
                  style={{ stopColor: "var(--phoenix-plate-rim-top)" }}
                  stopOpacity="0.78"
                />
                <stop
                  offset="45%"
                  style={{ stopColor: "var(--phoenix-plate-rim-mid)" }}
                  stopOpacity="0.52"
                />
                <stop
                  offset="100%"
                  style={{ stopColor: "var(--phoenix-plate-rim-bottom)" }}
                  stopOpacity="0.9"
                />
              </linearGradient>
            </>
          ) : null}
          <linearGradient
            id={`${idPrefix}-center`}
            x1="64"
            y1="18"
            x2="64"
            y2="87"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" style={{ stopColor: "var(--phoenix-plume-center-0)" }} />
            <stop offset="28%" style={{ stopColor: "var(--phoenix-plume-center-1)" }} />
            <stop offset="68%" style={{ stopColor: "var(--phoenix-plume-center-2)" }} />
            <stop offset="100%" style={{ stopColor: "var(--phoenix-plume-center-3)" }} />
          </linearGradient>
          <linearGradient
            id={`${idPrefix}-inner`}
            x1="64"
            y1="29"
            x2="64"
            y2="93"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" style={{ stopColor: "var(--phoenix-plume-inner-0)" }} />
            <stop offset="24%" style={{ stopColor: "var(--phoenix-plume-inner-1)" }} />
            <stop offset="64%" style={{ stopColor: "var(--phoenix-plume-inner-2)" }} />
            <stop offset="100%" style={{ stopColor: "var(--phoenix-plume-inner-3)" }} />
          </linearGradient>
          <linearGradient
            id={`${idPrefix}-outer`}
            x1="64"
            y1="48"
            x2="64"
            y2="98"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" style={{ stopColor: "var(--phoenix-plume-outer-0)" }} />
            <stop offset="38%" style={{ stopColor: "var(--phoenix-plume-outer-1)" }} />
            <stop offset="80%" style={{ stopColor: "var(--phoenix-plume-outer-2)" }} />
            <stop offset="100%" style={{ stopColor: "var(--phoenix-plume-outer-3)" }} />
          </linearGradient>
          <linearGradient
            id={`${idPrefix}-spark`}
            x1="64"
            y1="88"
            x2="64"
            y2="98"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" style={{ stopColor: "var(--phoenix-plume-spark-0)" }} />
            <stop offset="50%" style={{ stopColor: "var(--phoenix-plume-spark-1)" }} />
            <stop offset="100%" style={{ stopColor: "var(--phoenix-plume-spark-2)" }} />
          </linearGradient>
          <linearGradient
            id={`${idPrefix}-ash-hi`}
            x1="59"
            y1="101"
            x2="64"
            y2="113"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" style={{ stopColor: "var(--phoenix-plume-ash-hi-0)" }} />
            <stop offset="100%" style={{ stopColor: "var(--phoenix-plume-ash-hi-1)" }} />
          </linearGradient>
          <linearGradient
            id={`${idPrefix}-ash-lo`}
            x1="64"
            y1="101"
            x2="69"
            y2="113"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" style={{ stopColor: "var(--phoenix-plume-ash-lo-0)" }} />
            <stop offset="100%" style={{ stopColor: "var(--phoenix-plume-ash-lo-1)" }} />
          </linearGradient>
        </defs>
      ) : null}

      {variant === "plate" ? (
        <>
          <rect width="128" height="128" rx="28" fill={`url(#${idPrefix}-bg)`} />
          <rect width="128" height="128" rx="28" fill={`url(#${idPrefix}-glow)`} />
          <rect
            x="1.5"
            y="1.5"
            width="125"
            height="125"
            rx="26.5"
            stroke={`url(#${idPrefix}-rim)`}
            strokeWidth="2.5"
          />
          <g transform="translate(64 64) scale(0.86) translate(-64 -64)">
            <PhoenixPlumePaths idPrefix={idPrefix} mono={false} />
          </g>
        </>
      ) : (
        <PhoenixPlumePaths idPrefix={idPrefix} mono={mono} />
      )}
    </svg>
  );
}

export function PhoenixWordmark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 175 28" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path
        fillRule="evenodd"
        d="M0 3 H12.4 C16.3 3 19 5.5 19 9.6 C19 13.7 16.3 16.2 12.4 16.2 H4.2 V25 H0 Z M4.2 6.8 V12.4 H12 C13.9 12.4 14.8 11.4 14.8 9.6 C14.8 7.8 13.9 6.8 12 6.8 Z"
      />
      <path d="M26 3 H30.2 V12 H41.8 V3 H46 V25 H41.8 V15.8 H30.2 V25 H26 Z" />
      <path
        fillRule="evenodd"
        d="M64.5 2.6 C71.6 2.6 76 6.7 76 14 C76 21.3 71.6 25.4 64.5 25.4 C57.4 25.4 53 21.3 53 14 C53 6.7 57.4 2.6 64.5 2.6 Z M64.5 6.5 C59.8 6.5 57.3 9.3 57.3 14 C57.3 18.7 59.8 21.5 64.5 21.5 C69.2 21.5 71.7 18.7 71.7 14 C71.7 9.3 69.2 6.5 64.5 6.5 Z"
      />
      <path d="M84 3 H102 V6.8 H88.2 V12 H100.2 V15.6 H88.2 V21.2 H102 V25 H84 Z" />
      <path d="M110 3 H114.6 L126.8 18.5 V3 H131 V25 H126.4 L114.2 9.5 V25 H110 Z" />
      <path d="M139 3 H143.4 V25 H139 Z" />
      <path d="M151 3 H155.9 L162.5 11.4 L169.1 3 H174 L165.1 13.8 L174.4 25 H169.4 L162.5 16.3 L155.6 25 H150.6 L159.9 13.8 Z" />
    </svg>
  );
}
