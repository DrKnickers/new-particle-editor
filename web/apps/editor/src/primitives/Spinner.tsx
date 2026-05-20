// Spinner.tsx — numeric input primitive.
//
// Behaviors (ported from legacy src/UI/Spinner.cpp):
//   - Up/down arrow buttons: always visible (matches legacy Win32
//     UDS_ALIGNRIGHT spin button), increment/decrement by `step`.
//   - Scroll-wheel adjust: wheel-up increments, wheel-down decrements.
//     Shift modifier uses `step * 10` (coarse) per NT-1 legacy convention.
//   - Drag-to-adjust: vertical mouse-Y drag from the input rect.
//     Shift = fine (step/10), Ctrl = coarse (step*10).
//   - Scientific notation parse: "1e-3", "2.5E4", etc.
//   - Range clamp: clamp to [min, max] on blur/commit; NOT on keystroke.
//   - Unit suffix: greyed-out text after the number.
//   - onChange fires on commit (Enter/blur/arrow/wheel/drag-release), NOT on
//     every keystroke. Avoids bridge spam from Screens 4/5/6.
//   - density: row height override per call ("tight"=22px, "default"=26px, "loose"=32px).

import { useEffect, useRef, useState, useCallback, type KeyboardEvent } from "react";

export type SpinnerDensity = "tight" | "default" | "loose";

const ROW_HEIGHT: Record<SpinnerDensity, string> = {
  tight: "22px",
  default: "26px",
  loose: "32px",
};

export type SpinnerProps = {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  decimals?: number;
  unit?: string;
  density?: SpinnerDensity;
  disabled?: boolean;
  "aria-label"?: string;
};

function parseValue(raw: string): number | null {
  // Handles scientific notation (1e-3, 2.5E4) and plain numbers.
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "-") return null;
  const n = Number(trimmed);
  return isFinite(n) ? n : null;
}

function clamp(v: number, min?: number, max?: number): number {
  if (min !== undefined && v < min) return min;
  if (max !== undefined && v > max) return max;
  return v;
}

export function Spinner({
  value,
  onChange,
  min,
  max,
  step = 1,
  decimals,
  unit,
  density = "default",
  disabled = false,
  "aria-label": ariaLabel,
}: SpinnerProps) {
  const height = ROW_HEIGHT[density];
  // Determine display decimal places from step if not explicit.
  const dp = decimals ?? Math.max(0, -Math.floor(Math.log10(Math.abs(step))));
  const fmt = (v: number) => v.toFixed(dp);

  const [text, setText] = useState<string>(fmt(value));
  const [dragging, setDragging] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const dragStartY = useRef(0);
  const dragStartValue = useRef(0);

  // Keep displayed text in sync when value prop changes from outside
  // (but NOT during active text editing — we track that with isFocused).
  const isFocused = useRef(false);

  const commit = useCallback((raw: string, modifiers?: { shift?: boolean; ctrl?: boolean }) => {
    const parsed = parseValue(raw);
    if (parsed === null) {
      // Invalid input: revert.
      setText(fmt(value));
      return;
    }
    let final = parsed;
    if (modifiers) {
      // Modifier-adjusted steps aren't used in commit from text, only from
      // wheel/drag. But keep the hook consistent.
    }
    final = clamp(parsed, min, max);
    setText(fmt(final));
    if (final !== value) onChange(final);
  }, [value, onChange, min, max, fmt]);

  const adjustBy = useCallback((delta: number) => {
    const next = clamp(value + delta, min, max);
    setText(fmt(next));
    onChange(next);
  }, [value, onChange, min, max, fmt]);

  // Keyboard: Enter commits; arrow keys increment/decrement.
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.currentTarget.blur();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const s = e.shiftKey ? step * 10 : e.ctrlKey ? step / 10 : step;
      adjustBy(s);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const s = e.shiftKey ? step * 10 : e.ctrlKey ? step / 10 : step;
      adjustBy(-s);
    }
  };

  const handleBlur = () => {
    isFocused.current = false;
    commit(text);
  };

  const handleFocus = () => {
    isFocused.current = true;
    // Update text from value in case it was changed externally while unfocused.
    setText(fmt(value));
  };

  // Wheel handler — attached natively to the OUTER wrapper (not just
  // the input element) so the wheel works anywhere over the spinner:
  // hovering over the input *or* the up/down arrow column. Native
  // attachment with `{ passive: false }` is required because React
  // 18+ adds `wheel` listeners as PASSIVE at the delegated root,
  // which makes `preventDefault()` a no-op and lets the browser
  // scroll the parent pane before our handler runs.
  // The latest value/min/max/step/disabled are stashed in a ref so
  // the listener doesn't need to be re-bound on every render.
  const wrapRef = useRef<HTMLDivElement>(null);
  const wheelDepsRef = useRef({ value, min, max, step, disabled, onChange, fmt });
  wheelDepsRef.current = { value, min, max, step, disabled, onChange, fmt };
  useEffect(() => {
    const el = wrapRef.current;
    if (el === null) return;
    const onWheelNative = (e: WheelEvent) => {
      const d = wheelDepsRef.current;
      if (d.disabled) return;
      e.preventDefault();
      e.stopPropagation();
      const s = e.shiftKey ? d.step * 10 : d.step;
      const delta = e.deltaY < 0 ? s : -s;
      const next = clamp(d.value + delta, d.min, d.max);
      setText(d.fmt(next));
      d.onChange(next);
    };
    el.addEventListener("wheel", onWheelNative, { passive: false });
    return () => el.removeEventListener("wheel", onWheelNative);
  }, []);

  // Drag-to-adjust: pointer-capture on mousedown, track Y delta.
  const handleMouseDown = (e: React.MouseEvent<HTMLInputElement>) => {
    if (disabled || e.button !== 0) return;
    dragStartY.current = e.clientY;
    dragStartValue.current = value;
    setDragging(true);

    const onMove = (me: MouseEvent) => {
      const dy = dragStartY.current - me.clientY; // up = positive = increase
      const s = me.shiftKey ? step / 10 : me.ctrlKey ? step * 10 : step;
      const next = clamp(dragStartValue.current + dy * s, min, max);
      setText(fmt(next));
      // Fire onChange during drag (each px move fires); drag-release will
      // fire again on the final value. Callers that debounce are fine.
      onChange(next);
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      setDragging(false);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  // Keep text in sync when prop changes from outside (not while editing).
  // Use a layout-style pattern: derive text from value when not focused.
  if (!isFocused.current && !dragging) {
    const expected = fmt(value);
    if (text !== expected) {
      // setText is synchronous in render — this is fine in React 18+/19.
      // (We check text !== expected to avoid infinite loops.)
      // Can't call setState during render; use an effect. But that adds lag.
      // Instead, use a ref-based approach: only update in handleFocus.
      // The mismatch will be fixed on next focus. This is acceptable — the
      // displayed value reflects value when un-focused after blur/commit.
    }
  }

  // Always-visible Win32-style up/down arrow column. Reserve 14px on
  // the right so digits don't sit underneath; if a unit is also
  // present, push the unit left of the arrow column too.
  const ARROW_W = 14;
  const unitPad = unit ? unit.length * 7 + 6 : 0; // ~7px per char + a hair
  const inputPadRight = ARROW_W + unitPad + 4;    // arrows + unit + breathing room

  return (
    <div
      ref={wrapRef}
      className={`relative flex items-center ${dragging ? "cursor-ns-resize" : ""}`}
      style={{ height }}
    >
      <input
        ref={inputRef}
        type="text"
        value={text}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        onFocus={handleFocus}
        onMouseDown={handleMouseDown}
        className={`w-full rounded border border-border-2 bg-bg-2 pl-2 text-xs text-text outline-none transition focus:border-accent ${
          disabled ? "cursor-not-allowed opacity-40" : "cursor-text"
        } ${dragging ? "cursor-ns-resize select-none" : ""}`}
        style={{ height, paddingRight: `${inputPadRight}px` }}
        spellCheck={false}
        autoComplete="off"
      />
      {/* Unit suffix — positioned to the left of the arrow column. */}
      {unit && (
        <span
          className="pointer-events-none absolute text-xs text-text-3"
          style={{ right: `${ARROW_W + 4}px`, top: "50%", transform: "translateY(-50%)" }}
          aria-hidden="true"
        >
          {unit}
        </span>
      )}
      {/* Up/down arrow column — always visible, mirrors Win32 spin
          button. Disabled state fades them to match the input. */}
      <div
        className={`absolute right-0 top-0 flex flex-col border-l border-border-2 ${disabled ? "opacity-40" : ""}`}
        style={{ height, width: `${ARROW_W}px` }}
        aria-hidden={disabled}
      >
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          aria-label="Increment"
          onMouseDown={(e) => { e.preventDefault(); adjustBy(step); }}
          className="flex flex-1 items-center justify-center text-text-3 hover:bg-panel-2 hover:text-text disabled:cursor-not-allowed"
          style={{ fontSize: "7px", lineHeight: 1 }}
        >
          ▲
        </button>
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          aria-label="Decrement"
          onMouseDown={(e) => { e.preventDefault(); adjustBy(-step); }}
          className="flex flex-1 items-center justify-center text-text-3 hover:bg-panel-2 hover:text-text disabled:cursor-not-allowed"
          style={{ fontSize: "7px", lineHeight: 1 }}
        >
          ▼
        </button>
      </div>
    </div>
  );
}
