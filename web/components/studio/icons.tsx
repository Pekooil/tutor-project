import type { SVGProps } from 'react'

// The Notebook Studio's stroke icon set. Every glyph is a 24×24 viewBox drawn at
// `stroke-width: 2` with round caps/joins and `currentColor`, per the design
// handoff — the rail, the top bar, the section headings and the card heads all
// pull from here so the metaphor and the weight stay consistent.

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Icon({ size = 18, children, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  )
}

export function HomeIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V20h14V9.5" />
      <path d="M10 20v-6h4v6" />
    </Icon>
  )
}

export function NotesIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h4" />
    </Icon>
  )
}

export function HistoryIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v4h4" />
      <path d="M12 8v4l3 2" />
    </Icon>
  )
}

export function ChecklistIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M4 6.5 5.5 8 8 5" />
      <path d="M4 13.5 5.5 15 8 12" />
      <path d="M4 20.5 5.5 22 8 19" />
      <path d="M11 6.5h9M11 13.5h9M11 20.5h9" />
    </Icon>
  )
}

export function CardsIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <rect x="3" y="7" width="14" height="12" rx="2" />
      <path d="M7 4h10a3 3 0 0 1 3 3v9" />
    </Icon>
  )
}

export function SunIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </Icon>
  )
}

export function MoonIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </Icon>
  )
}

export function ShareIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="9" cy="7" r="3" />
      <path d="M3 20a6 6 0 0 1 12 0" />
      <path d="M17 11h4M19 9v4" />
    </Icon>
  )
}

export function ChevronDown(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="m6 9 6 6 6-6" />
    </Icon>
  )
}

export function ChevronRight(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="m9 6 6 6-6 6" />
    </Icon>
  )
}

export function ChevronLeft(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="m15 6-6 6 6 6" />
    </Icon>
  )
}

export function ArrowUpIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M12 20V4M5 11l7-7 7 7" />
    </Icon>
  )
}

export function PaperclipIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M21 11.5 12.5 20a5 5 0 0 1-7-7L14 4.5a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3l8-8" />
    </Icon>
  )
}

export function MicIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v4" />
    </Icon>
  )
}

export function ExpandIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M9 3H3v6M15 21h6v-6M3 3l7 7M21 21l-7-7" />
    </Icon>
  )
}

export function TrophyIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M7 4h10v5a5 5 0 0 1-10 0z" />
      <path d="M7 6H4v1a4 4 0 0 0 3 3.9M17 6h3v1a4 4 0 0 1-3 3.9" />
      <path d="M12 14v4M8 21h8M10 21v-3h4v3" />
    </Icon>
  )
}

export function TagIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z" />
      <circle cx="7.5" cy="7.5" r="1.3" />
    </Icon>
  )
}

export function SlidersIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M4 7h16M4 12h16M4 17h16" />
      <circle cx="9" cy="7" r="2" />
      <circle cx="15" cy="12" r="2" />
      <circle cx="8" cy="17" r="2" />
    </Icon>
  )
}

export function LightbulbIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M9 18h6M10 21h4" />
      <path d="M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.9v.2h5v-.2c0-.8.4-1.5 1-1.9A6 6 0 0 0 12 3z" />
    </Icon>
  )
}

export function CalendarIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </Icon>
  )
}

export function PencilIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M4 20h4L20 8a2.8 2.8 0 0 0-4-4L4 16z" />
      <path d="M14.5 5.5 18.5 9.5" />
    </Icon>
  )
}

export function GridIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </Icon>
  )
}

export function BoltIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M13 2 4 14h7l-1 8 9-12h-7z" />
    </Icon>
  )
}

export function CompassIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="m15.5 8.5-2 5.5-5.5 2 2-5.5z" />
    </Icon>
  )
}

export function TargetIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.2" />
    </Icon>
  )
}

export function KebabIcon({ size = 18, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <circle cx="12" cy="5" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="12" cy="19" r="1.7" />
    </svg>
  )
}

/** Maps a notebook section's `icon` key (SECTION_ICONS) to its glyph. */
export const SECTION_ICON: Record<string, (p: IconProps) => React.ReactElement> = {
  pencil: PencilIcon,
  grid: GridIcon,
  bolt: BoltIcon,
  compass: CompassIcon,
  target: TargetIcon,
}
