import type { SVGProps } from "react";

function PhoenixEmblemPaths({ mono }: { readonly mono: boolean }) {
  return (
    <>
      <path
        d="M64 16 L74 43 L70 46.5 L70 96.5 L64 111 L58 96.5 L58 46.5 L54 43 Z"
        fill={mono ? "currentColor" : "var(--primary)"}
      />
      <path
        d="M51 52 L19 20 L21 35 L40 54 L23 43 L27 56 L42 70 L30 63 L37 77 L51 92 Z"
        fill="currentColor"
      />
      <path
        d="M77 52 L109 20 L107 35 L88 54 L105 43 L101 56 L86 70 L98 63 L91 77 L77 92 Z"
        fill="currentColor"
      />
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

  return (
    <svg {...svgProps} viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
      {variant === "plate" ? (
        <>
          <path
            d="M22 4 H106 L124 22 V106 L106 124 H22 L4 106 V22 Z"
            fill="none"
            stroke="var(--border)"
            strokeWidth="2.5"
          />
          <path d="M25 10 H103 L118 25 V103 L103 118 H25 L10 103 V25 Z" fill="var(--card)" />
          <g transform="translate(64 64) scale(0.76) translate(-64 -64)">
            <PhoenixEmblemPaths mono={false} />
          </g>
        </>
      ) : (
        <PhoenixEmblemPaths mono={mono} />
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
