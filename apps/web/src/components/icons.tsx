/**
 * Astronom icon set. Every glyph sits on a 24px grid with rounded 1.6px
 * strokes and one soft tinted fill (currentColor at low opacity), so icons
 * read as one family in both themes. Names match the old lucide names the
 * pages used, so imports stay short.
 */
import type { CSSProperties, ReactNode, SVGProps } from "react";

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  size?: number | string;
  strokeWidth?: number;
  className?: string;
  style?: CSSProperties;
}

function icon(name: string, body: ReactNode) {
  function Glyph({ size = 18, strokeWidth = 1.6, className, ...rest }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        aria-hidden={rest["aria-label"] ? undefined : true}
        focusable="false"
        {...rest}
      >
        {body}
      </svg>
    );
  }
  Glyph.displayName = name;
  return Glyph;
}

/** Soft fill shared by every glyph. */
const Soft = (props: SVGProps<SVGPathElement>) => (
  <path fill="currentColor" stroke="none" opacity={0.14} {...props} />
);
const SoftCircle = (props: SVGProps<SVGCircleElement>) => (
  <circle fill="currentColor" stroke="none" opacity={0.14} {...props} />
);
const SoftRect = (props: SVGProps<SVGRectElement>) => (
  <rect fill="currentColor" stroke="none" opacity={0.14} {...props} />
);
const Dot = ({ cx, cy, r = 1.1 }: { cx: number; cy: number; r?: number }) => (
  <circle cx={cx} cy={cy} r={r} fill="currentColor" stroke="none" />
);

/* ---------- Brand ---------- */

/** Astronom mark: a planet with an orbit and a small moon. */
export function Logo({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <circle cx="12" cy="12" r="5.2" fill="currentColor" />
      <ellipse
        cx="12"
        cy="12"
        rx="10"
        ry="3.6"
        transform="rotate(-24 12 12)"
        stroke="currentColor"
        strokeWidth="1.6"
        opacity={0.85}
      />
      <circle cx="20.3" cy="7.9" r="1.7" fill="currentColor" />
    </svg>
  );
}

/* ---------- Navigation ---------- */

export const House = icon(
  "House",
  <>
    <Soft d="M5.5 10.2 12 4.8l6.5 5.4V19a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" />
    <path d="M3.5 11 12 4l8.5 7" />
    <path d="M5.5 9.6V19a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V9.6" />
    <path d="M10 20v-4.5a2 2 0 0 1 4 0V20" />
  </>,
);
export const Bot = icon(
  "Bot",
  <>
    <SoftRect x="4.5" y="8" width="15" height="11.5" rx="4" />
    <rect x="4.5" y="8" width="15" height="11.5" rx="4" />
    <path d="M12 8V5" />
    <Dot cx={12} cy={4} r={1.3} />
    <Dot cx={9.3} cy={13.6} r={1.2} />
    <Dot cx={14.7} cy={13.6} r={1.2} />
  </>,
);
export const ListTree = icon(
  "ListTree",
  <>
    <SoftRect x="3.5" y="4" width="17" height="5" rx="2.5" />
    <Dot cx={6} cy={6.5} />
    <path d="M9.5 6.5h8" />
    <Dot cx={6} cy={12} />
    <path d="M9.5 12h8" />
    <Dot cx={6} cy={17.5} />
    <path d="M9.5 17.5h5" />
  </>,
);
export const Activity = icon(
  "Activity",
  <>
    <Soft d="M3 13h4l2.5-6 5 12 2.5-6h4v7H3z" opacity={0.08} />
    <path d="M3 13h4l2.5-6 5 12 2.5-6h4" />
  </>,
);
export const CreditCard = icon(
  "CreditCard",
  <>
    <SoftRect x="3" y="5.5" width="18" height="13" rx="3" />
    <rect x="3" y="5.5" width="18" height="13" rx="3" />
    <path d="M3 10h18M7 14.5h3" />
  </>,
);
export const Wallet = icon(
  "Wallet",
  <>
    <SoftRect x="3" y="6" width="18" height="13" rx="3" />
    <path d="M17 6V5a1.5 1.5 0 0 0-1.9-1.4L5 6.5" />
    <rect x="3" y="6" width="18" height="13" rx="3" />
    <path d="M21 10.5h-4a2 2 0 0 0 0 4h4" />
    <Dot cx={17} cy={12.5} r={0.9} />
  </>,
);
const shield = "M12 3.5 19 6v5.5c0 4.3-3 7.6-7 9-4-1.4-7-4.7-7-9V6z";
export const ShieldHalf = icon(
  "ShieldHalf",
  <>
    <Soft d="M12 3.5 19 6v5.5c0 4.3-3 7.6-7 9z" opacity={0.22} />
    <path d={shield} />
  </>,
);
export const ShieldCheck = icon(
  "ShieldCheck",
  <>
    <Soft d={shield} />
    <path d={shield} />
    <path d="m9 12 2.2 2.2L15.2 10" />
  </>,
);
export const ShieldAlert = icon(
  "ShieldAlert",
  <>
    <Soft d={shield} />
    <path d={shield} />
    <path d="M12 8.5v4" />
    <Dot cx={12} cy={15.6} />
  </>,
);
export const ShieldX = icon(
  "ShieldX",
  <>
    <Soft d={shield} />
    <path d={shield} />
    <path d="m10 10 4 4m0-4-4 4" />
  </>,
);
export const ShieldQuestion = icon(
  "ShieldQuestion",
  <>
    <Soft d={shield} />
    <path d={shield} />
    <path d="M10.2 10a1.9 1.9 0 1 1 2.6 1.8c-.5.3-.8.7-.8 1.3" />
    <Dot cx={12} cy={15.6} />
  </>,
);
export const FlaskConical = icon(
  "FlaskConical",
  <>
    <Soft d="M7.4 14.5h9.2l1.8 3a2 2 0 0 1-1.7 3H7.3a2 2 0 0 1-1.7-3z" opacity={0.22} />
    <path d="M9.5 3.5h5" />
    <path d="M10.5 3.5v5.2L5.6 17.4a2 2 0 0 0 1.7 3.1h9.4a2 2 0 0 0 1.7-3.1L13.5 8.7V3.5" />
  </>,
);
export const Link2 = icon(
  "Link2",
  <>
    <SoftRect x="3" y="8" width="18" height="7" rx="3.5" opacity={0.1} />
    <path d="M9 15.5H7.5a4 4 0 0 1 0-8H9" />
    <path d="M15 7.5h1.5a4 4 0 0 1 0 8H15" />
    <path d="M8.5 11.5h7" />
  </>,
);
export const Scale = icon(
  "Scale",
  <>
    <Soft d="M2.8 13a2.7 2.7 0 0 0 5.4 0zM15.8 13a2.7 2.7 0 0 0 5.4 0z" opacity={0.22} />
    <path d="M12 4v16M8 20h8M5 7h14" />
    <path d="M5.5 7 2.8 13a2.7 2.7 0 0 0 5.4 0zM18.5 7l-2.7 6a2.7 2.7 0 0 0 5.4 0z" />
  </>,
);
export const GitBranch = icon(
  "GitBranch",
  <>
    <SoftCircle cx="6" cy="6" r="2.4" />
    <SoftCircle cx="6" cy="18" r="2.4" />
    <SoftCircle cx="18" cy="8" r="2.4" />
    <circle cx="6" cy="6" r="2.4" />
    <circle cx="6" cy="18" r="2.4" />
    <circle cx="18" cy="8" r="2.4" />
    <path d="M6 8.4v7.2M18 10.4c0 3-2.5 4.4-6 4.6-2 .1-3.6.8-4.5 1.6" />
  </>,
);
export const Layers = Logo;

/* ---------- Actions ---------- */

export const Plus = icon("Plus", <path d="M12 5v14M5 12h14" />);
export const X = icon("X", <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />);
export const Check = icon("Check", <path d="M5 12.5 9.5 17 19 7.5" />);
export const ArrowLeft = icon("ArrowLeft", <path d="M19 12H5M11 6l-6 6 6 6" />);
export const ArrowUp = icon("ArrowUp", <path d="M12 19V5M6 11l6-6 6 6" />);
export const ArrowUpRight = icon("ArrowUpRight", <path d="M7 17 17 7M8.5 7H17v8.5" />);
export const ChevronDown = icon("ChevronDown", <path d="m6 9 6 6 6-6" />);
export const ChevronRight = icon("ChevronRight", <path d="m9 6 6 6-6 6" />);
export const Search = icon(
  "Search",
  <>
    <SoftCircle cx="11" cy="11" r="6.5" />
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.2-4.2" />
  </>,
);
export const Play = icon(
  "Play",
  <>
    <Soft d="M8 5.6v12.8a1 1 0 0 0 1.5.9l10-6.4a1 1 0 0 0 0-1.8l-10-6.4A1 1 0 0 0 8 5.6z" />
    <path d="M8 5.6v12.8a1 1 0 0 0 1.5.9l10-6.4a1 1 0 0 0 0-1.8l-10-6.4A1 1 0 0 0 8 5.6z" />
  </>,
);
export const Pause = icon(
  "Pause",
  <>
    <SoftRect x="6" y="5" width="4" height="14" rx="1.5" />
    <SoftRect x="14" y="5" width="4" height="14" rx="1.5" />
    <rect x="6" y="5" width="4" height="14" rx="1.5" />
    <rect x="14" y="5" width="4" height="14" rx="1.5" />
  </>,
);
export const LoaderCircle = icon(
  "LoaderCircle",
  <>
    <circle cx="12" cy="12" r="8.5" opacity={0.2} />
    <path d="M12 3.5a8.5 8.5 0 0 1 8.5 8.5" />
  </>,
);
export const Loader2 = LoaderCircle;
export const Save = icon(
  "Save",
  <>
    <SoftRect x="4" y="4" width="16" height="16" rx="3" />
    <path d="M7 4h8.5L20 8.5V17a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z" />
    <path d="M8 4v4h7V4M8 20v-5.5h8V20" />
  </>,
);
export const Maximize = icon(
  "Maximize",
  <path d="M4 9V6a2 2 0 0 1 2-2h3M15 4h3a2 2 0 0 1 2 2v3M20 15v3a2 2 0 0 1-2 2h-3M9 20H6a2 2 0 0 1-2-2v-3" />,
);
export const Wand2 = icon(
  "Wand2",
  <>
    <path d="m4 20 11-11M13 7l4 4" />
    <Soft d="M17 3.5l.9 2 2 .9-2 .9-.9 2-.9-2-2-.9 2-.9z" opacity={0.5} />
    <path d="M17 3.5l.9 2 2 .9-2 .9-.9 2-.9-2-2-.9 2-.9z" />
  </>,
);
export const Wrench = icon(
  "Wrench",
  <>
    <Soft d="M15 4.2a4.5 4.5 0 0 0-4.6 6.1L4.6 16a2 2 0 0 0 2.8 2.8l5.7-5.8a4.5 4.5 0 0 0 6.1-4.6l-2.7 2.7-2.8-.8-.8-2.8z" />
    <path d="M15 4.2a4.5 4.5 0 0 0-4.6 6.1L4.6 16a2 2 0 0 0 2.8 2.8l5.7-5.8a4.5 4.5 0 0 0 6.1-4.6l-2.7 2.7-2.8-.8-.8-2.8z" />
  </>,
);

/* ---------- Status ---------- */

export const CheckCircle2 = icon(
  "CheckCircle2",
  <>
    <SoftCircle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="8.5" />
    <path d="m8.5 12.2 2.4 2.4 4.6-4.8" />
  </>,
);
export const XCircle = icon(
  "XCircle",
  <>
    <SoftCircle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="8.5" />
    <path d="m9.5 9.5 5 5m0-5-5 5" />
  </>,
);
export const AlertTriangle = icon(
  "AlertTriangle",
  <>
    <Soft d="M10.3 4.6a2 2 0 0 1 3.4 0l7 12A2 2 0 0 1 19 19.5H5a2 2 0 0 1-1.7-2.9z" />
    <path d="M10.3 4.6a2 2 0 0 1 3.4 0l7 12A2 2 0 0 1 19 19.5H5a2 2 0 0 1-1.7-2.9z" />
    <path d="M12 9.5v4" />
    <Dot cx={12} cy={16.4} />
  </>,
);
export const Timer = icon(
  "Timer",
  <>
    <SoftCircle cx="12" cy="13.5" r="7" />
    <circle cx="12" cy="13.5" r="7" />
    <path d="M10 3h4M12 13.5V10M18 7.5l1-1" />
  </>,
);
export const Gauge = icon(
  "Gauge",
  <>
    <Soft d="M4 16a8 8 0 1 1 16 0z" />
    <path d="M4 16a8 8 0 1 1 16 0" />
    <path d="m12 16 3.5-5" />
    <Dot cx={12} cy={16} r={1.4} />
  </>,
);
export const Radar = icon(
  "Radar",
  <>
    <SoftCircle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="4.5" opacity={0.5} />
    <path d="M12 12 18 6" />
    <Dot cx={15} cy={9.5} r={1.2} />
  </>,
);
export const Crosshair = icon(
  "Crosshair",
  <>
    <SoftCircle cx="12" cy="12" r="7.5" />
    <circle cx="12" cy="12" r="7.5" />
    <path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4" />
  </>,
);

/* ---------- Objects ---------- */

const page = "M7 3.5h6.5L18 8v11a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19V5a1.5 1.5 0 0 1 1-1.5z";
export const File = icon(
  "File",
  <>
    <Soft d={page} />
    <path d={page} />
    <path d="M13.5 3.5V8H18" />
  </>,
);
export const FileText = icon(
  "FileText",
  <>
    <Soft d={page} />
    <path d={page} />
    <path d="M13.5 3.5V8H18M9 12.5h6M9 16h4" />
  </>,
);
export const FilePlus2 = icon(
  "FilePlus2",
  <>
    <Soft d={page} />
    <path d={page} />
    <path d="M13.5 3.5V8H18M12 11.5v5M9.5 14h5" />
  </>,
);
export const FileWarning = icon(
  "FileWarning",
  <>
    <Soft d={page} />
    <path d={page} />
    <path d="M13.5 3.5V8H18M12 11.5v3" />
    <Dot cx={12} cy={17} />
  </>,
);
export const ScrollText = icon(
  "ScrollText",
  <>
    <SoftRect x="6" y="4" width="13" height="16" rx="2" />
    <path d="M8 20h9.5a1.5 1.5 0 0 0 1.5-1.5V5.5A1.5 1.5 0 0 0 17.5 4H8a2 2 0 0 0-2 2v12a2 2 0 0 1-2 2h4zM10 9h6M10 13h4" />
  </>,
);
export const BookOpen = icon(
  "BookOpen",
  <>
    <Soft d="M3.5 5.5c3-1 6-1 8.5 1v13c-2.5-2-5.5-2-8.5-1z" />
    <path d="M3.5 5.5c3-1 6-1 8.5 1v13c-2.5-2-5.5-2-8.5-1zM20.5 5.5c-3-1-6-1-8.5 1v13c2.5-2 5.5-2 8.5-1z" />
  </>,
);
export const Folder = icon(
  "Folder",
  <>
    <Soft d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
    <path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
  </>,
);
export const Archive = icon(
  "Archive",
  <>
    <SoftRect x="4.5" y="9" width="15" height="10.5" rx="2" />
    <rect x="3.5" y="4.5" width="17" height="4.5" rx="1.5" />
    <path d="M4.5 9v8.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V9M10 13h4" />
  </>,
);
export const FolderOpen = icon(
  "FolderOpen",
  <>
    <Soft d="M5.5 11h15l-2 7.5H3.5z" />
    <path d="M3.5 17V7.5a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2V11" />
    <path d="M3.5 18.5 5.5 11h15l-2 7.5z" />
  </>,
);
export const Terminal = icon(
  "Terminal",
  <>
    <SoftRect x="3" y="4.5" width="18" height="15" rx="3" />
    <rect x="3" y="4.5" width="18" height="15" rx="3" />
    <path d="m7.5 9.5 2.5 2.5-2.5 2.5M12.5 14.5h4" />
  </>,
);
export const TerminalSquare = Terminal;
export const Database = icon(
  "Database",
  <>
    <Soft d="M4.5 6c0-1.4 3.4-2.5 7.5-2.5s7.5 1.1 7.5 2.5v12c0 1.4-3.4 2.5-7.5 2.5S4.5 19.4 4.5 18z" />
    <ellipse cx="12" cy="6" rx="7.5" ry="2.5" />
    <path d="M4.5 6v12c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5V6M4.5 12c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5" />
  </>,
);
export const Boxes = icon(
  "Boxes",
  <>
    <SoftRect x="3.5" y="12" width="8" height="8" rx="2" />
    <rect x="3.5" y="12" width="8" height="8" rx="2" />
    <rect x="12.5" y="12" width="8" height="8" rx="2" />
    <rect x="8" y="3.5" width="8" height="8" rx="2" />
  </>,
);
export const Cpu = icon(
  "Cpu",
  <>
    <SoftRect x="6.5" y="6.5" width="11" height="11" rx="2.5" />
    <rect x="6.5" y="6.5" width="11" height="11" rx="2.5" />
    <path d="M10 3.5v3M14 3.5v3M10 17.5v3M14 17.5v3M3.5 10h3M3.5 14h3M17.5 10h3M17.5 14h3" />
  </>,
);
export const Globe = icon(
  "Globe",
  <>
    <SoftCircle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12h17M12 3.5c2.4 2.3 3.5 5.2 3.5 8.5s-1.1 6.2-3.5 8.5c-2.4-2.3-3.5-5.2-3.5-8.5s1.1-6.2 3.5-8.5z" />
  </>,
);
export const KeyRound = icon(
  "KeyRound",
  <>
    <SoftCircle cx="8.5" cy="12" r="4.5" />
    <circle cx="8.5" cy="12" r="4.5" />
    <path d="M13 12h7.5M17.5 12v3M20.5 12v2" />
  </>,
);
export const Lock = icon(
  "Lock",
  <>
    <SoftRect x="5" y="10.5" width="14" height="10" rx="2.5" />
    <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    <Dot cx={12} cy={15.5} r={1.3} />
  </>,
);
export const Plug = icon(
  "Plug",
  <>
    <Soft d="M7 9h10v3a5 5 0 0 1-10 0z" />
    <path d="M9 4v5M15 4v5M7 9h10v3a5 5 0 0 1-10 0zM12 17v3.5" />
  </>,
);
export const MessageSquare = icon(
  "MessageSquare",
  <>
    <Soft d="M5 5h14a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 17H9l-4.5 3.5V6.5A1.5 1.5 0 0 1 5 5z" />
    <path d="M5 5h14a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 17H9l-4.5 3.5V6.5A1.5 1.5 0 0 1 5 5z" />
  </>,
);
export const Users = icon(
  "Users",
  <>
    <SoftCircle cx="9" cy="8.5" r="3.3" />
    <circle cx="9" cy="8.5" r="3.3" />
    <path d="M3.5 19.5a5.5 5.5 0 0 1 11 0" />
    <circle cx="16.8" cy="9.5" r="2.5" opacity={0.7} />
    <path d="M16 14.3a4.5 4.5 0 0 1 4.5 4.7" opacity={0.7} />
  </>,
);
export const Route = icon(
  "Route",
  <>
    <SoftCircle cx="6" cy="18" r="2.5" />
    <SoftCircle cx="18" cy="6" r="2.5" />
    <circle cx="6" cy="18" r="2.5" />
    <circle cx="18" cy="6" r="2.5" />
    <path d="M8.5 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.5" />
  </>,
);
export const CircleDollarSign = icon(
  "CircleDollarSign",
  <>
    <SoftCircle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="8.5" />
    <path d="M14.6 9.3c-.4-.9-1.4-1.5-2.6-1.5-1.5 0-2.6.8-2.6 2s1.1 1.7 2.6 2 2.6.8 2.6 2-1.1 2-2.6 2c-1.2 0-2.2-.6-2.6-1.5M12 6.3v1.5M12 16.2v1.5" />
  </>,
);
export const HandCoins = icon(
  "HandCoins",
  <>
    <SoftCircle cx="9" cy="10" r="5" />
    <circle cx="9" cy="10" r="5" />
    <circle cx="16" cy="14" r="5" />
  </>,
);
export const Crown = icon(
  "Crown",
  <>
    <Soft d="M4.5 16 3.5 8l5 3.5L12 6l3.5 5.5 5-3.5-1 8z" />
    <path d="M4.5 16 3.5 8l5 3.5L12 6l3.5 5.5 5-3.5-1 8zM5 19.5h14" />
  </>,
);
export const Gavel = icon(
  "Gavel",
  <>
    <SoftRect x="8.4" y="3.8" width="7" height="9" rx="1.5" transform="rotate(45 11.9 8.3)" />
    <rect x="8.4" y="3.8" width="7" height="9" rx="1.5" transform="rotate(45 11.9 8.3)" />
    <path d="m11 13-6.5 6.5M13 20.5h7.5" />
  </>,
);
export const Swords = icon(
  "Swords",
  <path d="M4 4h4l9 9M20 4h-4l-9 9M14 17l3 3 3-3-3-3M10 17l-3 3-3-3 3-3" />,
);
export const Sun = icon(
  "Sun",
  <>
    <SoftCircle cx="12" cy="12" r="4.2" />
    <circle cx="12" cy="12" r="4.2" />
    <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
  </>,
);
export const Moon = icon(
  "Moon",
  <>
    <Soft d="M19.5 14.5A7.8 7.8 0 1 1 9.5 4.5a6.2 6.2 0 0 0 10 10z" />
    <path d="M19.5 14.5A7.8 7.8 0 1 1 9.5 4.5a6.2 6.2 0 0 0 10 10z" />
  </>,
);
