"use client";

import { useId, useState } from "react";

export interface KeyOption { purpose: string; name: string }

/** Editable combobox. Opening it shows every available purpose before filtering. */
export function KeyPurposeInput({ options, value, disabled, onPick }: {
  options: KeyOption[]; value: string; disabled: boolean; onPick: (purpose: string) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const matches = options.filter((option) => option.name.toLowerCase().includes(query.toLowerCase()));
  function pick(option: KeyOption) { onPick(option.purpose); setOpen(false); setQuery(""); }
  return <div className="key-purpose-input">
    <input role="combobox" aria-label="Key purpose" aria-autocomplete="list" aria-expanded={open} aria-controls={id}
      aria-activedescendant={open && matches[active] ? `${id}-${active}` : undefined}
      autoComplete="off" spellCheck={false} disabled={disabled || !options.length}
      placeholder={options.length ? "Choose or type a key purpose" : "All key types saved"}
      value={open ? query : value}
      onFocus={() => { setQuery(""); setActive(0); setOpen(true); }}
      onClick={() => { if (!open) { setQuery(""); setActive(0); setOpen(true); } }}
      onBlur={() => setOpen(false)}
      onChange={(event) => { setQuery(event.target.value); setActive(0); setOpen(true); onPick(""); }}
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); setOpen(false); }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault(); setOpen(true);
          setActive((index) => matches.length ? (index + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length : 0);
        }
        if (event.key === "Enter" && open) { event.preventDefault(); if (matches[active]) pick(matches[active]); }
      }} />
    {open && <ul id={id} role="listbox" aria-label="Available key purposes" className="key-purpose-options">
      {matches.map((option, index) => <li id={`${id}-${index}`} key={option.purpose} role="option" aria-selected={index === active}
        onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => pick(option)}>{option.name}</li>)}
      {!matches.length && <li className="key-purpose-empty">No matching key purpose</li>}
    </ul>}
  </div>;
}
