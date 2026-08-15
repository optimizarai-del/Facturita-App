// Isotipo de "Facturas Masivas": hojas apiladas (facturación masiva/en lote)
// con un check (comprobante validado). Trazo en currentColor para que herede
// el color del contenedor (blanco dentro del cuadro verde de la marca).
export default function Logo({ size = 20, ...props }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" {...props}>
      {/* hojas de atrás: sugieren "varias / masivas" */}
      <path d="M8.5 3.2h6.2A1.6 1.6 0 0 1 16.3 4.8" opacity="0.45" />
      <path d="M18.2 6.4v8.4A1.6 1.6 0 0 1 16.6 16.4" opacity="0.45" />
      {/* hoja principal (comprobante) con esquina plegada */}
      <path d="M12.4 4.5H6.6A1.6 1.6 0 0 0 5 6.1v12.3A1.6 1.6 0 0 0 6.6 20h7.2a1.6 1.6 0 0 0 1.6-1.6V7.6L12.4 4.5Z" />
      <path d="M12.2 4.5v3.2h3.2" />
      {/* check de validación */}
      <path d="M7.9 14.2l2 2 3.4-4.1" />
    </svg>
  );
}
