const ICONS: Record<string, React.ReactNode> = {
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
  topology: (
    <>
      <circle cx="4.5" cy="5" r="2" />
      <circle cx="15.5" cy="5" r="2" />
      <circle cx="10" cy="15" r="2" />
      <circle cx="10" cy="8.5" r="1.6" />
      <path d="M6.2 5.8L8.7 7.8" />
      <path d="M13.8 5.8L11.3 7.8" />
      <path d="M9 10L9.7 13" />
    </>
  ),
  "net-bias": (
    <>
      <path d="M3 15A7 7 0 0 1 17 15" />
      <path d="M10 15L13.5 9" />
      <circle cx="10" cy="15" r="1.3" />
    </>
  ),
  "impact-matrix": (
    <>
      <rect x="3" y="3" width="14" height="14" rx="1.5" />
      <path d="M3 8H17" />
      <path d="M3 13H17" />
      <path d="M9 3V17" />
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
