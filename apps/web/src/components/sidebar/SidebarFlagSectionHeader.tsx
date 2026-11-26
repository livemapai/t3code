import {
  THREAD_FLAG_SECTION_LABELS,
  type ThreadFlag,
} from "@t3tools/client-runtime/state/thread-flags";

import { cn } from "~/lib/utils";
import type { SidebarFlagSectionMarker } from "../Sidebar.logic";
import { FLAG_ICONS, FLAG_ICON_CLASSES } from "./SidebarFlagFilter";
import { SortableSidebarMarker } from "./SidebarListMarkers";

const FLAG_RAIL_COLORS: Record<ThreadFlag, string> = {
  urgent: "before:bg-error",
  working: "before:bg-warning",
  later: "before:bg-secondary-label",
};

/** A coloured bar down the left of each row in a flag section; rows touch, so it reads as one rail. */
export const flagRailClassName = (flag: ThreadFlag): string =>
  cn(
    "relative pl-2.5 before:absolute before:inset-y-0 before:left-1 before:w-[3px] before:content-['']",
    FLAG_RAIL_COLORS[flag],
  );

export const sidebarFlagSectionMarker = (flag: ThreadFlag | null): SidebarFlagSectionMarker =>
  `flag-${flag ?? "none"}-header`;

/** A static header over one flag group inside the active section. */
export function SidebarFlagSectionHeader(props: { flag: ThreadFlag | null; count: number }) {
  const { flag, count } = props;
  const marker = sidebarFlagSectionMarker(flag);
  const Icon = flag === null ? null : FLAG_ICONS[flag];
  const tone = flag === null ? "text-sidebar-muted-foreground" : FLAG_ICON_CLASSES[flag];
  return (
    <SortableSidebarMarker
      marker={marker}
      data-testid={`sidebar-${marker}`}
      className="relative mx-0.5 h-7"
    >
      <div className="flex h-7 items-center gap-1.5 px-2 text-xs font-medium">
        {Icon ? (
          <Icon aria-hidden className={cn("size-3 shrink-0", tone)} fill="currentColor" />
        ) : null}
        <span className={cn("min-w-0 truncate", tone)}>
          {THREAD_FLAG_SECTION_LABELS[flag ?? "none"]}
        </span>
        <span aria-hidden className="h-px min-w-2 flex-1 bg-sidebar-border/50" />
        <span className="shrink-0 font-normal tabular-nums text-sidebar-muted-foreground">
          {count}
        </span>
      </div>
    </SortableSidebarMarker>
  );
}
