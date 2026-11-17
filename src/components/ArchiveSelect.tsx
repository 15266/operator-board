import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { prefersReducedMotion } from "../lib/motion";

export interface ArchiveSelectOption {
  value: string;
  label: string;
  note?: string;
}

export function ArchiveSelect({
  id,
  value,
  onChange,
  options,
  disabled,
  title,
  className,
  "aria-label": ariaLabel,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: ArchiveSelectOption[];
  disabled?: boolean;
  title?: string;
  className?: string;
  "aria-label"?: string;
}) {
  const autoId = useId();
  const listId = `${id ?? autoId}-list`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [menu, setMenu] = useState<{ top: number; left: number; maxHeight: number } | null>(null);

  const selected = options.find((item) => item.value === value) ?? options[0];

  function placeMenu() {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const gap = 4;
    const below = window.innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const openUp = below < 164 && above > below;
    const maxHeight = Math.max(120, Math.min(280, openUp ? above - gap : below - gap));
    setMenu({
      top: openUp ? Math.max(8, rect.top - gap - maxHeight) : rect.bottom + gap,
      left: rect.left,
      maxHeight,
    });
  }

  useLayoutEffect(() => {
    if (!open) return;
    placeMenu();
    const index = Math.max(0, options.findIndex((item) => item.value === value));
    setActive(index);
  }, [open, options, value]);

  useEffect(() => {
    if (!open) return;
    const onWin = () => placeMenu();
    const onDoc = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (triggerRef.current?.contains(target) || listRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener("resize", onWin);
    window.addEventListener("scroll", onWin, true);
    document.addEventListener("mousedown", onDoc);
    return () => {
      window.removeEventListener("resize", onWin);
      window.removeEventListener("scroll", onWin, true);
      document.removeEventListener("mousedown", onDoc);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    listRef.current?.focus();
    const item = listRef.current?.querySelector<HTMLElement>('[data-active="true"], [aria-selected="true"]');
    item?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  useLayoutEffect(() => {
    if (!open || !menu) return;
    const list = listRef.current;
    if (!list) return;
    const width = list.getBoundingClientRect().width;
    const maxRight = window.innerWidth - 8;
    const nextLeft = menu.left + width > maxRight ? Math.max(8, maxRight - width) : menu.left;
    if (Math.abs(nextLeft - menu.left) > 0.5) setMenu({ ...menu, left: nextLeft });
  }, [open, menu]);

  function commit(next: string) {
    onChange(next);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function onTriggerKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setOpen(true);
    }
  }

  function onListKey(event: KeyboardEvent<HTMLUListElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const item = options[active] ?? options[0];
      if (item) commit(item.value);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!options.length) return;
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setActive((current) => {
        const start = current < 0 ? (delta > 0 ? -1 : 0) : current;
        return (start + delta + options.length) % options.length;
      });
    }
  }

  const menuNode =
    open && menu ? (
      <ul
        ref={listRef}
        id={listId}
        className={`archive-select-menu${prefersReducedMotion() ? " is-static" : ""}`}
        role="listbox"
        tabIndex={-1}
        style={{
          top: menu.top,
          left: menu.left,
          maxHeight: menu.maxHeight,
        }}
        aria-activedescendant={options[active] ? `${listId}-${active}` : undefined}
        onKeyDown={onListKey}
      >
        {options.map((item, index) => (
          <li
            key={`${item.value}-${index}`}
            id={`${listId}-${index}`}
            role="option"
            aria-selected={item.value === value}
            data-active={index === active ? "true" : undefined}
            className={[
              "archive-select-option",
              item.value === value ? "is-selected" : "",
              index === active ? "is-active" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onMouseEnter={() => setActive(index)}
            onClick={() => commit(item.value)}
          >
            <span className="archive-select-label">{item.label}</span>
            {item.note ? <span className="archive-select-note">{item.note}</span> : null}
          </li>
        ))}
      </ul>
    ) : null;

  return (
    <div className={`archive-select ${open ? "is-open" : ""} ${className ?? ""}`.trim()}>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        className="archive-select-trigger"
        disabled={disabled}
        title={title}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => {
          if (disabled) return;
          setOpen((wasOpen) => !wasOpen);
        }}
        onKeyDown={onTriggerKey}
      >
        <span className="archive-select-value">
          <span className="archive-select-label">{selected?.label ?? ""}</span>
          {selected?.note ? <span className="archive-select-note">{selected.note}</span> : null}
        </span>
        <span className="archive-select-chevron" aria-hidden="true" />
      </button>
      {menuNode && typeof document !== "undefined" ? createPortal(menuNode, document.body) : null}
    </div>
  );
}
