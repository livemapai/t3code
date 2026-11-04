import {
  THREAD_FLAGS,
  THREAD_FLAG_LABELS,
  type ThreadFlag,
  type ThreadFlagFilter,
} from "@t3tools/client-runtime/state/thread-flags";
import { BookmarkIcon, FlagIcon, HammerIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../ui/menu";
import { SidebarHeaderIconButton } from "./SidebarThreadHeader";

const ALL = "all";

export const FLAG_ICONS = {
  urgent: FlagIcon,
  later: BookmarkIcon,
  working: HammerIcon,
} satisfies Record<ThreadFlag, typeof FlagIcon>;

export const FLAG_ICON_CLASSES: Record<ThreadFlag, string> = {
  urgent: "text-error",
  later: "text-secondary-label",
  working: "text-warning",
};

function isFlagFilter(value: unknown): value is ThreadFlagFilter {
  return value === "any" || THREAD_FLAGS.some((flag) => flag === value);
}

export function SidebarFlagFilter({
  value,
  onChange,
}: {
  value: ThreadFlagFilter | null;
  onChange: (value: ThreadFlagFilter | null) => void;
}) {
  const ActiveIcon = value === null || value === "any" ? FlagIcon : FLAG_ICONS[value];
  const activeLabel =
    value === "any" ? "Flagged" : value === null ? null : THREAD_FLAG_LABELS[value];
  return (
    <Menu>
      <MenuTrigger
        render={
          <SidebarHeaderIconButton
            label={
              activeLabel === null
                ? "Filter threads by flag"
                : `Filter threads by flag: ${activeLabel}`
            }
          />
        }
      >
        <ActiveIcon
          className={cn("size-4", value !== null && value !== "any" && FLAG_ICON_CLASSES[value])}
          fill={value === null ? "none" : "currentColor"}
        />
      </MenuTrigger>
      <MenuPopup align="start">
        <MenuRadioGroup
          value={value ?? ALL}
          onValueChange={(next) => onChange(isFlagFilter(next) ? next : null)}
        >
          <MenuRadioItem value={ALL}>All threads</MenuRadioItem>
          <MenuRadioItem value="any">Any flag</MenuRadioItem>
          {THREAD_FLAGS.map((flag) => {
            const Icon = FLAG_ICONS[flag];
            return (
              <MenuRadioItem key={flag} value={flag}>
                <span className="flex items-center gap-2">
                  <Icon className={FLAG_ICON_CLASSES[flag]} />
                  {THREAD_FLAG_LABELS[flag]}
                </span>
              </MenuRadioItem>
            );
          })}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}
