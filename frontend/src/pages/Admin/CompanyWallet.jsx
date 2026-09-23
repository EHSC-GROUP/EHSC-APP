import { useEffect, useState } from "react";
import client, { errorMessage } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import StatusBadge from "../../components/StatusBadge";
import { Loading, ErrorText } from "../../components/Misc";

const SOURCE_LABEL = {
  TOPUP: "Top-up",
  ADVANCE: "Advance",
  REIMBURSEMENT: "Reimbursement",
  MATERIAL_INDENT: "Material Indent",
  REVERSAL: "Reversal",
};

function fmtDate(ts) {
  if (!ts) return "-";
  const d = ts._seconds ? new Date(ts._seconds * 1000) : new Date(ts);
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function CompanyWallet() {
  const { user } = useAuth();
  const isSuperadmin = user?.role === "superadmin";

  const [balance, setBalance] = useState(null);
  const [transactions, setTransactions] = useState(null);
  const [error, setError] = useState("");

  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [topupMsg, setTopupMsg] = useState("");

  async function load() {
    setError("");
    try {
      const [balRes, txnRes] = await Promise.all([
        client.get("/company-wallet/balance"),
        client.get("/company-wallet/transactions"),
      ]);
      setBalance(balRes.data.balance);
      setTransactions(txnRes.data);
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  useEffect(() => { load(); }, []);

  async function submitTopup(e) {
    e.preventDefault();
    setTopupMsg("");
    setError("");
    setBusy(true);
    try {
      await client.post("/company-wallet/topup", { amount: Number(amount), note });
      setTopupMsg(`Added ₹${Number(amount).toFixed(2)} to the company wallet.`);
      setAmount("");
      setNote("");
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const totalToppedUp = (transactions || []).filter((t) => t.type === "TOPUP").reduce((s, t) => s + Number(t.amount || 0), 0);
  const netSpent = balance !== null ? Math.max(0, totalToppedUp - balance) : 0;
  const tone = balance == null ? "" : balance < 0 ? "danger" : balance === 0 ? "warning" : "success";

  return (
    <div>
      <div className="page-header">
        <h2>Company Wallet</h2>
      </div>
      <p className="hint-text mt-0">
        A running budget the superadmin tops up monthly — any amount left over simply carries into next month, nothing
        resets. Approving a reimbursement, advance or material indent deducts its amount here automatically. This is a
        tracking statement only: it never blocks an approval, even if the balance runs low or negative.
      </p>

      <div className="wallet-hero-row">
        <div className={`wallet-hero-card wallet-hero-${tone}`}>
          <div className="wallet-hero-label">Current Balance</div>
          <div className="wallet-hero-value">{balance === null ? "…" : `₹${balance.toFixed(2)}`}</div>
        </div>
        <div className="stat-cards" style={{ margin: 0, flex: 1 }}>
          <div className="stat-card"><div className="value">₹{totalToppedUp.toFixed(2)}</div><div className="label">Total Topped Up (all time)</div></div>
          <div className="stat-card"><div className="value">₹{netSpent.toFixed(2)}</div><div className="label">Net Spent (all time)</div></div>
          <div className="stat-card"><div className="value">{(transactions || []).length}</div><div className="label">Statement Entries</div></div>
        </div>
      </div>

      {isSuperadmin && (
        <div className="card">
          <h3 className="mt-0">Top Up Wallet</h3>
          <form onSubmit={submitTopup} className="form-row" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
            <div style={{ flex: "0 0 180px" }}>
              <label>Amount</label>
              <input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </div>
            <div style={{ flex: "1 1 240px" }}>
              <label>Note (optional)</label>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. October 2026 budget" />
            </div>
            <div>
              <button className="btn-primary" disabled={busy}>{busy ? "Adding…" : "+ Add to Wallet"}</button>
            </div>
          </form>
          {topupMsg && <p className="hint-text" style={{ color: "var(--success)" }}>{topupMsg}</p>}
        </div>
      )}

      <ErrorText>{error}</ErrorText>

      <div className="card table-wrap">
        <h3 className="mt-0">Statement &amp; History</h3>
        {!transactions ? <Loading /> : (
          <table>
            <thead>
              <tr><th>Date</th><th>Type</th><th>Description</th><th>Amount</th><th>Balance After</th><th>By</th></tr>
            </thead>
            <tbody>
              {transactions.map((t) => (
                <tr key={t.id}>
                  <td>{fmtDate(t.createdAt)}</td>
                  <td><StatusBadge status={t.type} /></td>
                  <td>{t.description || SOURCE_LABEL[t.type] || t.type}</td>
                  <td className={t.direction === "CREDIT" ? "wallet-amt-credit" : "wallet-amt-debit"}>
                    {t.direction === "CREDIT" ? "+" : "−"}₹{Number(t.amount).toFixed(2)}
                  </td>
                  <td className={Number(t.balanceAfter) < 0 ? "wallet-amt-debit" : ""}>₹{Number(t.balanceAfter).toFixed(2)}</td>
                  <td>{t.createdBy || "-"}</td>
                </tr>
              ))}
              {transactions.length === 0 && <tr><td colSpan={6} className="empty-state">No wallet activity yet.</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
