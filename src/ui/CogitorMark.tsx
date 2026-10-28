import type { SVGProps } from 'react';

/** Flat three-agent orbital mark. Keep geometry/colors in sync with app-icon.svg. */
export function CogitorMark({
  active = false,
  className = '',
  ...props
}: SVGProps<SVGSVGElement> & { active?: boolean }) {
  return (
    <svg
      viewBox="0 0 512 512"
      aria-hidden="true"
      focusable="false"
      className={`cogitor-mark ${active ? 'cogitor-mark--thinking' : ''} ${className}`.trim()}
      data-active={active ? 'true' : 'false'}
      {...props}
    >
      <rect width="512" height="512" rx="104" fill="#1A1612" />
      <g fill="none" stroke="#EFE6D3" strokeWidth="19" strokeLinecap="round">
        <path d="M 297 101 A 160 160 0 0 1 395 336" />
        <path d="M 341 392 A 160 160 0 0 1 101 297" />
        <path d="M 101 215 A 160 160 0 0 1 215 101" />
      </g>
      <g className="cogitor-mark__core">
        <circle cx="256" cy="256" r="83" fill="#E38B45" />
        <circle className="cogitor-mark__highlight" cx="285" cy="217" r="13" fill="#EFE6D3" />
      </g>
      <circle cx="256" cy="96" r="23" fill="#E38B45" />
      <circle cx="96" cy="256" r="21" fill="#EFE6D3" />
      <circle cx="359" cy="379" r="21" fill="#E38B45" />
    </svg>
  );
}
