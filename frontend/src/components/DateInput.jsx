import { useEffect, useRef, useState } from "react";
import { fmtDate, parseDMY } from "../lib/dates";

// Drop-in replacement for <input type="date">: shows and accepts DD/MM/YYYY
// (the browser's own date box follows the computer's locale, so it can't be
// forced), with a calendar button for picking. `value` and the value passed
// to onChange are always ISO (YYYY-MM-DD); onChange receives {target:{value}}
// so existing handlers written for a native input keep working.
export default function DateInput({ value, onChange, min, max, required, disabled, style, className, title, placeholder, id }) {
  const [text, setText] = useState(fmtDate(value));
  const pickerRef = useRef(null);

  useEffect(() => { setText(fmtDate(value)); }, [value]);

  function emit(iso) {
    onChange?.({ target: { value: iso } });
  }

  function handleText(e) {
    // Auto-insert the slashes while typing digits.
    let t = e.target.value.replace(/[^\d/]/g, "");
    if (t.length > text.length) {
      if (/^\d{2}$/.test(t) || /^\d{2}\/\d{2}$/.test(t)) t += "/";
    }
    t = t.slice(0, 10);
    setText(t);
    if (t === "") return emit("");
    const iso = parseDMY(t);
    if (iso) emit(iso);
  }

  function handleBlur() {
    // Anything that isn't a complete valid date snaps back to the last good value.
    if (text && !parseDMY(text)) setText(fmtDate(value));
  }

  function openPicker() {
    const el = pickerRef.current;
    if (!el || disabled) return;
    if (typeof el.showPicker === "function") el.showPicker();
    else el.click();
  }

  return (
    <div className={className} style={{ position: "relative", display: "flex", alignItems: "center", ...style }}>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        placeholder={placeholder || "DD/MM/YYYY"}
        value={text}
        onChange={handleText}
        onBlur={handleBlur}
        required={required}
        disabled={disabled}
        title={title}
        autoComplete="off"
        style={{ paddingRight: 34, width: "100%" }}
      />
      <button
        type="button"
        onClick={openPicker}
        disabled={disabled}
        aria-label="Pick a date"
        tabIndex={-1}
        style={{ position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)", border: "none", background: "transparent", padding: "2px 6px", cursor: "pointer", fontSize: 15, lineHeight: 1 }}
      >
        📅
      </button>
      <input
        ref={pickerRef}
        type="date"
        value={value || ""}
        min={min}
        max={max}
        onChange={(e) => emit(e.target.value)}
        tabIndex={-1}
        aria-hidden="true"
        style={{ position: "absolute", right: 0, bottom: 0, width: 0, height: 0, opacity: 0, pointerEvents: "none", border: "none", padding: 0 }}
      />
    </div>
  );
}
