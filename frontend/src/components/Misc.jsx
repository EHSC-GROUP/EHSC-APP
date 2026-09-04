export function Loading() {
  return <div className="empty-state">Loading…</div>;
}

export function EmptyState({ children }) {
  return <div className="empty-state">{children || "Nothing here yet."}</div>;
}

export function ErrorText({ children }) {
  if (!children) return null;
  return <div className="error-text">{children}</div>;
}

export function ConfirmButton({ onConfirm, children, className, confirmText, disabled }) {
  return (
    <button
      className={className}
      disabled={disabled}
      onClick={() => {
        if (window.confirm(confirmText || "Are you sure?")) onConfirm();
      }}
    >
      {children}
    </button>
  );
}
