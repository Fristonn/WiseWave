import { useId, useLayoutEffect, useRef } from "react";
import { Check, ChevronDown } from "lucide-react";

type DropdownOption = { value: string; label: string; description?: string };

export function SettingsDropdown({ label, value, displayValue, options, open, disabled, busy, onOpenChange, onSelect }: {
  label: string;
  value: string;
  displayValue: string;
  options: DropdownOption[];
  open: boolean;
  disabled?: boolean;
  busy?: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (value: string) => void;
}) {
  const menuId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const button = trigger.current;
    const menu = list.current;
    const viewport = button?.closest(".settings-main");
    if (!button || !menu || !viewport) return;

    const place = () => {
      const bounds = viewport.getBoundingClientRect();
      const anchor = button.getBoundingClientRect();
      const zoom = Number.parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
      const below = (bounds.bottom - anchor.bottom) / zoom - 8;
      const above = (anchor.top - bounds.top) / zoom - 8;
      const desired = Math.min(240, menu.scrollHeight);
      const openAbove = below < desired && above > below;
      menu.dataset.above = String(openAbove);
      menu.style.maxHeight = `${Math.max(0, Math.min(240, openAbove ? above : below))}px`;
    };
    place();
    const option = menu.querySelector<HTMLElement>('[aria-selected="true"]') ?? menu.querySelector<HTMLElement>('[role="option"]');
    option?.focus({ preventScroll: true });
    if (option && option.offsetTop + option.offsetHeight > menu.clientHeight) {
      menu.scrollTop = option.offsetTop + option.offsetHeight - menu.clientHeight;
    }
    const observer = new ResizeObserver(place);
    observer.observe(viewport);
    viewport.addEventListener("scroll", place, { passive: true });
    return () => {
      observer.disconnect();
      viewport.removeEventListener("scroll", place);
    };
  }, [open]);

  const close = () => {
    trigger.current?.focus();
    onOpenChange(false);
  };

  return <div className="settings-dd" onBlur={(event) => {
    if (open && event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) onOpenChange(false);
  }}>
    <button ref={trigger} type="button" className="settings-ddb" aria-label={`${label}, ${displayValue}`} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? menuId : undefined} aria-busy={busy} disabled={disabled} onClick={() => onOpenChange(!open)} onKeyDown={(event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        onOpenChange(true);
      }
    }}>
      <span>{displayValue}</span><ChevronDown size={15} aria-hidden="true" />
    </button>
    {open && <ul ref={list} id={menuId} className="settings-dd-menu player-scroll" role="listbox" aria-label={label} onKeyDown={(event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      }
      const buttons = Array.from(event.currentTarget.querySelectorAll("button"));
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      let next: HTMLButtonElement | undefined;
      if (event.key === "Home") next = buttons[0];
      else if (event.key === "End") next = buttons.at(-1);
      else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        next = buttons[(index + (event.key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length];
      } else if (event.key.length === 1 && event.key !== " " && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const character = event.key.toLocaleLowerCase();
        next = [...buttons.slice(index + 1), ...buttons.slice(0, index + 1)].find((button) => button.dataset.label?.toLocaleLowerCase().startsWith(character));
      }
      if (next) {
        event.preventDefault();
        next.focus();
      }
    }}>
      {options.map((option) => <li key={option.value} role="presentation">
        <button type="button" role="option" tabIndex={-1} aria-selected={option.value === value} data-label={option.label} onClick={() => {
          onSelect(option.value);
          close();
        }}>
          <span className="settings-dd-option-copy">
            <span>{option.label}</span>
            {option.description && <small>{option.description}</small>}
          </span>
          {option.value === value && <Check size={16} strokeWidth={2.4} aria-hidden="true" />}
        </button>
      </li>)}
    </ul>}
  </div>;
}
