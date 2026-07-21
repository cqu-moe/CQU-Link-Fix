interface BrandMarkProps {
  size?: number;
  label?: string;
}

export function BrandMark({ size = 24, label }: BrandMarkProps) {
  const accessibleProps = label
    ? { role: 'img', 'aria-label': label }
    : { 'aria-hidden': true };

  return (
    <svg
      className="brand-mark"
      viewBox="0 0 64 64"
      width={size}
      height={size}
      {...accessibleProps}
    >
      <rect className="brand-mark__base" x="4" y="4" width="56" height="56" rx="14" />
      <path
        className="brand-mark__cut"
        d="M25.5 22H34c7 0 11 4 11 10s-4 10-11 10H26"
        strokeWidth="5.5"
      />
      <path
        className="brand-mark__cut"
        d="M29.5 34.5 22 42l7.5 7.5"
        strokeWidth="5.8"
      />
    </svg>
  );
}
