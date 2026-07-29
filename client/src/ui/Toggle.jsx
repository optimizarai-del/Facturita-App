// Switch estilo iOS. Reemplaza a los checkbox feos.
export default function Toggle({ checked, onChange, label }) {
  const sw = (
    <button type="button" role="switch" aria-checked={checked} aria-label={label}
      className={`switch ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}>
      <span className="knob" />
    </button>
  );
  if (!label) return sw;
  return (
    <label className="tgl-row" onClick={(e) => { e.preventDefault(); onChange(!checked); }}>
      {sw}<span>{label}</span>
    </label>
  );
}
