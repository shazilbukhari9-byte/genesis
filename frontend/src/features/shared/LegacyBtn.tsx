import type { CSSProperties, ReactNode } from "react";

// Plain <button> elements inside these legacy-styled pages silently swallow
// real clicks (some page-wide instrumentation intercepts them) while a div
// acting as a button works fine — so every clickable control here renders as
// a styled, keyboard-accessible div instead of a native <button>.
export function LegacyBtn({
  children,
  onClick,
  secondary,
  disabled,
  style,
}: {
  children: ReactNode;
  onClick: () => void;
  secondary?: boolean;
  disabled?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div
      className={"btn" + (secondary ? " sec" : "")}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      onClick={disabled ? undefined : onClick}
      onKeyDown={(e) => !disabled && (e.key === "Enter" || e.key === " ") && onClick()}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        opacity: disabled ? 0.55 : 1,
        cursor: disabled ? "default" : "pointer",
        ...style,
      }}
    >
      {children}
    </div>
  );
}
