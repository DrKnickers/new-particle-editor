// Section — collapsible header for inspector tabs.
//
// Entire header row is clickable (per user spec — bigger hit target
// than chevron-only). Keyboard accessibility via role="button" +
// tabIndex={0} + onKeyDown handling Enter / Space. Space gets
// preventDefault to suppress page scroll.
//
// State is local + session-only — defaults to defaultOpen=true on
// every mount. The inspector remounts when the user selects a
// different emitter, which intentionally resets every section to
// its default state. If state persistence becomes desirable later,
// the upgrade path is a single lifted useState or a per-tab
// persistence map.

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

type Props = {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
};

export function Section({ title, defaultOpen = true, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const toggle = () => setOpen((o) => !o);
  return (
    <div className="section">
      <div
        className={`section-header ${open ? "" : "collapsed"}`}
        role="button"
        tabIndex={0}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggle();
          }
        }}
        aria-expanded={open}
        data-testid={`section-${title.toLowerCase().replace(/\s+/g, "-")}`}
      >
        <ChevronDown className="chev size-3" />
        <span>{title}</span>
      </div>
      <div className="section-divider" aria-hidden />
      {open && <div className="section-body">{children}</div>}
    </div>
  );
}
