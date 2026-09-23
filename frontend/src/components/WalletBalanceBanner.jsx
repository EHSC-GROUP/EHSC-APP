import { useEffect, useState } from "react";
import client from "../api/client";

// Small reusable "here's the current company budget" strip, dropped onto
// every approval screen that can spend against it (Reimbursements,
// Advances, Material Indents) so the approver always has it in view.
export default function WalletBalanceBanner({ label = "Company Wallet Balance" }) {
  const [balance, setBalance] = useState(null);

  useEffect(() => {
    client.get("/company-wallet/balance").then(({ data }) => setBalance(data.balance)).catch(() => {});
  }, []);

  if (balance === null) return null;
  const tone = balance < 0 ? "danger" : balance === 0 ? "warning" : "success";

  return (
    <div className={`wallet-banner wallet-banner-${tone}`}>
      <span className="wallet-banner-label">{label}</span>
      <span className="wallet-banner-value">₹{balance.toFixed(2)}</span>
    </div>
  );
}
