import { useEffect, useState } from "react";
import client, { errorMessage } from "../../api/client";
import { Loading, ErrorText } from "../../components/Misc";
import { openAuthedFile } from "../../lib/openFile";

export default function MyPayslips() {
  const [list, setList] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    client.get("/me/payslips").then((r) => setList(r.data)).catch((err) => setError(errorMessage(err)));
  }, []);

  async function viewPdf(p) {
    try {
      await openAuthedFile(`/api/payslips/${p.userId}/${p.period}/pdf`);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div>
      <div className="page-header"><h2>My Payslips</h2></div>
      <ErrorText>{error}</ErrorText>
      {!list ? <Loading /> : (
        <div className="card table-wrap">
          <table>
            <thead><tr><th>Period</th><th>Gross</th><th>Net Pay</th><th></th></tr></thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.period}>
                  <td>{p.period}</td><td>{p.gross}</td><td>{p.netPay}</td>
                  <td><button className="btn-sm" onClick={() => viewPdf(p)}>View PDF</button></td>
                </tr>
              ))}
              {list.length === 0 && <tr><td colSpan={4} className="empty-state">No published payslips yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
