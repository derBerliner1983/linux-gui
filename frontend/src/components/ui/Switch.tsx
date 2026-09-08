interface SwitchProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  /** Vorlesbare Beschriftung für Screenreader. */
  label?: string;
}

/** Schiebeschalter (an/aus) – Aussehen kommt aus global.css (.switch). */
export function Switch({ checked, onChange, disabled, label }: SwitchProps) {
  return (
    <label className="switch" title={label}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="switch__track"><span className="switch__thumb" /></span>
    </label>
  );
}
