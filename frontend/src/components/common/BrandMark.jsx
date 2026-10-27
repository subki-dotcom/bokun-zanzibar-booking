// The brand mark (dhow on the green square, from public/brand/icon.svg), drawn inline so it is sharp at any
// size. "light" is the white square with a green dhow, for dark backgrounds.
const BrandMark = ({ size = 40, variant = "brand", className = "", title = "" }) => {
  const light = variant === "light";
  const ground = light ? "#FFFFFF" : "#0E6B57";
  const sail = light ? "#0E6B57" : "#FFFFFF";
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role={title ? "img" : undefined}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : "true"}
      focusable="false"
    >
      <rect width="64" height="64" rx="16" fill={ground} />
      <circle cx="48" cy="16" r="5" fill="#F2B544" />
      <path d="M31 11 L31 44" stroke={sail} strokeWidth="2.5" strokeLinecap="round" />
      <path d="M33 13 C42 21 46 32 45 43 L33 43 Z" fill={sail} />
      <path d="M29 18 C23 26 20 35 20 43 L29 43 Z" fill={sail} opacity="0.8" />
      <path d="M14 46 H50 C48 51 44 54 39 54 H25 C20 54 16 51 14 46 Z" fill={sail} />
    </svg>
  );
};

export default BrandMark;
