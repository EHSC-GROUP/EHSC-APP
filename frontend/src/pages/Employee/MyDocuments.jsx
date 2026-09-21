import { useEffect, useState } from "react";
import client, { errorMessage } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { Loading, ErrorText } from "../../components/Misc";
import { openAuthedFile } from "../../lib/openFile";
import { ValidityCell } from "../Admin/CompanyDocuments";

export default function MyDocuments() {
  const { user } = useAuth();
  const [mine, setMine] = useState(null);
  const [company, setCompany] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([client.get(`/documents/${user.userId}`), client.get("/documents/company")])
      .then(([a, b]) => { setMine(a.data); setCompany(b.data); })
      .catch((err) => setError(errorMessage(err)));
  }, []);

  function open(fileUrl) {
    openAuthedFile(fileUrl).catch((err) => setError(errorMessage(err)));
  }

  return (
    <div>
      <div className="page-header"><h2>Documents</h2></div>
      <ErrorText>{error}</ErrorText>

      <div className="card">
        <h3 className="mt-0">My Documents</h3>
        {!mine ? <Loading /> : (
          <table>
            <thead><tr><th>Title</th><th>Category</th><th>Validity</th></tr></thead>
            <tbody>
              {mine.map((f) => (
                <tr key={f.id}><td><button className="btn-sm" onClick={() => open(f.fileUrl)}>{f.title}</button></td><td>{f.category}</td><td><ValidityCell validity={f.validity} /></td></tr>
              ))}
              {mine.length === 0 && <tr><td colSpan={3} className="empty-state">No personal documents.</td></tr>}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3 className="mt-0">Company Documents</h3>
        {!company ? <Loading /> : (
          <table>
            <thead><tr><th>Title</th><th>Category</th><th>Validity</th></tr></thead>
            <tbody>
              {company.map((f) => (
                <tr key={f.id}><td><button className="btn-sm" onClick={() => open(f.fileUrl)}>{f.title}</button></td><td>{f.category}</td><td><ValidityCell validity={f.validity} /></td></tr>
              ))}
              {company.length === 0 && <tr><td colSpan={3} className="empty-state">No company documents.</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
