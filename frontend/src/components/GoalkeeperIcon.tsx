import React from 'react';

interface GoalkeeperIconProps extends React.SVGProps<SVGSVGElement> {
  size?: number | string;
  color?: string;
  strokeWidth?: number;
}

/**
 * Goalkeeper Glove Saving Soccer Ball Icon
 * Custom athletic vector icon styled to match Lucide icon ergonomics.
 */
export function GoalkeeperIcon({
  size = 20,
  color = 'currentColor',
  strokeWidth = 2,
  className,
  style,
  ...props
}: GoalkeeperIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{
        display: 'inline-block',
        verticalAlign: 'middle',
        flexShrink: 0,
        ...style
      }}
      aria-hidden="true"
      {...props}
    >
      {/* Goalkeeper Glove: 4 fingers + thumb */}
      <path
        d="M 6.8 16.5
           C 5.2 13.5 4.6 11 5.2 9.2
           C 5.5 8.2 6.8 8.2 7.2 9.2
           C 7.6 10.5 7.8 7.5 8.2 5.6
           C 8.5 4.5 9.8 4.5 10.2 5.6
           C 10.6 7.2 10.8 5 11.2 3.4
           C 11.5 2.2 12.8 2.2 13.2 3.4
           C 13.6 5.2 13.8 6.5 14.2 5.4
           C 14.5 4.4 15.8 4.4 16.2 5.4
           C 16.6 6.8 16.8 8.6 17.2 9
           C 18 8.6 19.5 8.8 20.2 9.8
           C 20.8 10.8 20.5 12 19.2 13.2
           C 18.2 14.2 17.6 14.8 17.2 15.5"
      />

      {/* Wrist Cuff */}
      <path d="M 6.8 16.5 L 6.2 21 L 11 21 L 11.5 17.2" />
      <line x1="6.3" y1="18.8" x2="11.2" y2="18.8" />

      {/* Soccer Ball (Foreground with slight backdrop fill) */}
      <circle cx="16.5" cy="16.5" r="5.2" fill="var(--bg-surface, #111823)" />

      {/* Central Pentagon Panel */}
      <polygon
        points="16.5,14.6 18.4,16 17.7,18.2 15.3,18.2 14.6,16"
        fill="currentColor"
        fillOpacity="0.18"
      />

      {/* Seam Lines Radiating to Ball Perimeter */}
      <line x1="16.5" y1="14.6" x2="16.5" y2="11.3" />
      <line x1="18.4" y1="16" x2="20.9" y2="14.7" />
      <line x1="17.7" y1="18.2" x2="20" y2="20.3" />
      <line x1="15.3" y1="18.2" x2="13" y2="20.3" />
      <line x1="14.6" y1="16" x2="12.1" y2="14.7" />
    </svg>
  );
}

export const GloveSavingBallIcon = GoalkeeperIcon;
