import { createContext, useCallback, useContext, useState } from 'react';

// Modal de confirmación propio (reemplaza window.confirm/alert, que no tienen estilo).
// Uso:  const confirm = useConfirm();  const ok = await confirm({ title, message, tone });

const Ctx = createContext(() => Promise.resolve(true));
export const useConfirm = () => useContext(Ctx);

const ICONS = {
  danger: <path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />,
  accent: <path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />,
};

export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null);

  const confirm = useCallback((opts) => new Promise((resolve) => {
    setState({ tone: 'accent', confirmText: 'Confirmar', cancelText: 'Cancelar', ...opts, resolve });
  }), []);

  const close = (val) => { if (state) state.resolve(val); setState(null); };

  return (
    <Ctx.Provider value={confirm}>
      {children}
      {state && (
        <div className="modal-backdrop" onClick={() => close(false)}>
          <div className="modal" role="alertdialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className={`modal-ic ${state.tone}`}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                {ICONS[state.tone] || ICONS.accent}
              </svg>
            </div>
            {state.title && <h3>{state.title}</h3>}
            {state.message && <p>{state.message}</p>}
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => close(false)}>{state.cancelText}</button>
              <button className={`btn ${state.tone === 'danger' ? 'btn-danger' : 'btn-primary'}`} onClick={() => close(true)} autoFocus>
                {state.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}
