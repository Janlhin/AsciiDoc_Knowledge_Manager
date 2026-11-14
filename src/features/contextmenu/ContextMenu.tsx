import { useEffect, useRef } from "react";
import { Icon } from "@app/icons";
import "./contextmenu.scss";

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: string;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  onAction: () => void;
}

export interface ContextMenuSeparator {
  id: string;
  separator: true;
}

export type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator;

/**
 * App-styled context menu. The reading view used to fall through to WebView2's
 * browser menu (Refresh / Save as / Print / Inspect), which is meaningless and
 * risky inside a desktop app; this replaces it with real actions.
 *
 * Position is clamped to the viewport; the menu closes on outside mousedown,
 * Escape, scroll (any scroller, capture) and resize.
 */
export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: ContextMenuEntry[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onViewport = () => onClose();
    window.addEventListener("mousedown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", onViewport, true);
    window.addEventListener("resize", onViewport);
    return () => {
      window.removeEventListener("mousedown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", onViewport, true);
      window.removeEventListener("resize", onViewport);
    };
  }, [onClose]);

  const estimatedHeight = items.length * 30 + 12;
  const left = Math.max(4, Math.min(x, window.innerWidth - 210));
  const top = Math.max(4, Math.min(y, window.innerHeight - estimatedHeight));

  return (
    <div
      ref={ref}
      className="ctx-menu"
      style={{ left, top }}
      role="menu"
      data-testid="context-menu"
    >
      {items.map((entry) =>
        "separator" in entry ? (
          <div key={entry.id} className="ctx-menu-sep" role="separator" />
        ) : (
          <button
            key={entry.id}
            role="menuitem"
            className={entry.danger ? "is-danger" : undefined}
            disabled={entry.disabled}
            data-testid={`context-menu-${entry.id}`}
            onClick={() => {
              onClose();
              entry.onAction();
            }}
          >
            {entry.icon !== undefined && <Icon name={entry.icon} size={14} />}
            <span className="ctx-menu-label">{entry.label}</span>
            {entry.shortcut !== undefined && (
              <span className="ctx-menu-shortcut">{entry.shortcut}</span>
            )}
          </button>
        ),
      )}
    </div>
  );
}
