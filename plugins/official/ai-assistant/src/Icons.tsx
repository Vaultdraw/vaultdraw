/** The panel's few icons: plain strokes in the current colour. */
const PATHS = {
  plus: "M8 3v10M3 8h10",
  gear: "M2 5h6M11.5 5H14M2 11h2.5M8 11h6M9.75 3.25v3.5M6.25 9.25v3.5",
  up: "M8 13V3M3.5 7.5 8 3l4.5 4.5",
  stop: "M4.5 4.5h7v7h-7Z",
  chevron: "M4 6.5 8 10.5l4-4",
  copy: "M5.5 5.5h7v8h-7ZM3.5 10.5v-8h7",
  check: "M3 8.5 6.5 12 13 4.5",
  back: "M9.5 3.5 5 8l4.5 4.5",
  close: "M4 4l8 8M12 4 4 12",
  history: "M2.5 8a5.5 5.5 0 1 0 1.8-4.07M2.5 2.5v3h3M8 5v3.2l2 1.3",
  trash: "M3 4.5h10M6.5 4.5v-2h3v2M4.5 4.5l.5 8.5h6l.5-8.5",
  slash: "M10.5 2.5 5.5 13.5",
  levels: "M4 12.5v-3M8 12.5v-6.5M12 12.5v-10",
  image: "M2.5 3.5h11v9h-11ZM2.5 11l3.5-3.5 3 3 2-2 2.5 2.5",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 14 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill={name === "stop" ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** The mark of the empty state and the tab: a small burst, not any provider's logo. */
export function Mark({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
    >
      <path d="M8 1.5v4M8 10.5v4M1.5 8h4M10.5 8h4M3.4 3.4l2.8 2.8M9.8 9.8l2.8 2.8M12.6 3.4 9.8 6.2M6.2 9.8l-2.8 2.8" />
    </svg>
  );
}
