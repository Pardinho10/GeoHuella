export default function IconHuella({ size = 18, className }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <ellipse cx="7.3" cy="8.5" rx="2.1" ry="2.8" transform="rotate(-20 7.3 8.5)" />
      <ellipse cx="11" cy="6.9" rx="2.1" ry="2.9" transform="rotate(-6 11 6.9)" />
      <ellipse cx="14.9" cy="7.1" rx="2.1" ry="2.9" transform="rotate(8 14.9 7.1)" />
      <ellipse cx="18.3" cy="9.4" rx="2" ry="2.7" transform="rotate(22 18.3 9.4)" />
      <path d="M12.1 12.6c-2.2 0-4 1.2-4.8 3.1-.6 1.4.2 2.8 1.7 3.1 1 .2 2-.1 3.1-.1s2.1.3 3.1.1c1.5-.3 2.3-1.7 1.7-3.1-.8-1.9-2.6-3.1-4.8-3.1Z" />
    </svg>
  );
}
