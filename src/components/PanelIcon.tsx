const ICONS: Record<string, React.ReactNode> = {
  board: (
    <>
      <rect x="2.5" y="2.5" width="15" height="15" rx="1.5" />
      <path d="M2.5 8H17.5" />
      <path d="M7 8V17.5" />
      <path d="M12.5 8V17.5" />
    </>
  ),
  "us-macro": (
    <>
      <rect x="3" y="4" width="14" height="3" rx="1" />
      <rect x="3" y="8.5" width="11" height="3" rx="1" />
      <rect x="3" y="13" width="8" height="3" rx="1" />
    </>
  ),
  "yield-rates": (
    <>
      <path d="M3 14L7.5 9L11 12L17 5" />
      <path d="M12.5 5H17V9.5" />
    </>
  ),
  "cot-positioning": (
    <>
      <path d="M10 3V17" />
      <path d="M3 6H17" />
      <path d="M3 6L1.5 10.5A2.5 2.5 0 0 0 6.5 10.5L5 6" />
      <path d="M15 6L13.5 10.5A2.5 2.5 0 0 0 18.5 10.5L17 6" />
    </>
  ),
  transmission: (
    <>
      <rect x="2.5" y="7" width="7" height="6" rx="3" />
      <rect x="10.5" y="7" width="7" height="6" rx="3" />
    </>
  ),
  geopolitics: (
    <>
      <circle cx="10" cy="10" r="7" />
      <path d="M3 10H17" />
      <path d="M10 3C12.5 5.5 12.5 14.5 10 17C7.5 14.5 7.5 5.5 10 3Z" />
    </>
  ),
  volatility: (
    <>
      <path d="M3 12C5 12 5 6 7 6S9 15 11 15S13 5 15 5S17 12 17 12" />
    </>
  ),
  news: (
    <>
      <rect x="3" y="4" width="14" height="12" rx="1.5" />
      <path d="M6 8H14" />
      <path d="M6 11H14" />
      <path d="M6 13.5H10.5" />
    </>
  ),
  "macro-bias": (
    <>
      <path d="M3 15A7 7 0 0 1 17 15" />
      <path d="M10 15L13.5 9" />
      <circle cx="10" cy="15" r="1.3" />
    </>
  ),
  replay: (
    <>
      <path d="M6 4L6 16" />
      <path d="M6 10L14.5 4.5V15.5Z" />
    </>
  ),
  fingerprint: (
    <>
      <path d="M10 3L17 6.5V13.5L10 17L3 13.5V6.5Z" />
      <path d="M10 3V17" />
      <path d="M3 6.5L10 10L17 6.5" />
      <path d="M3 13.5L10 10L17 13.5" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="4" width="14" height="13" rx="1.5" />
      <path d="M3 8H17" />
      <path d="M6.5 2.5V5.5" />
      <path d="M13.5 2.5V5.5" />
    </>
  ),
  "options-flow": (
    <>
      <path d="M6 3V6" />
      <rect x="4.5" y="6" width="3" height="6" rx="0.8" />
      <path d="M6 12V16" />
      <path d="M14 4.5V8" />
      <rect x="12.5" y="8" width="3" height="5.5" rx="0.8" />
      <path d="M14 13.5V17" />
    </>
  ),
  terminal: (
    <>
      <rect x="2.5" y="3.5" width="15" height="13" rx="1.5" />
      <path d="M5.5 7.5L8.5 10L5.5 12.5" />
      <path d="M10.5 12.5H14.5" />
    </>
  ),
  docs: (
    <>
      <path d="M5 3H12.5L16 6.5V17H5Z" />
      <path d="M12.5 3V6.5H16" />
      <circle cx="10.3" cy="12.3" r="2.3" />
      <path d="M12 14L13.5 15.5" />
    </>
  ),
};

export default function PanelIcon({
  id,
  className,
  style,
}: {
  id: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const icon = ICONS[id];
  if (!icon) return null;
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
    >
      {icon}
    </svg>
  );
}
