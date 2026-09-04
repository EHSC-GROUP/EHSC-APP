export default function Drawer({ onClose, children }) {
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="drawer">{children}</div>
    </>
  );
}
