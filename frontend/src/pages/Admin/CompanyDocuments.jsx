import { useEffect, useState } from "react";
import client, { errorMessage } from "../../api/client";
import { Loading, ErrorText } from "../../components/Misc";
import { openAuthedFile } from "../../lib/openFile";

export default function CompanyDocuments() {
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("General");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const { data } = await client.get("/documents/company");
      setList(data);
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  useEffect(() => { load(); }, []);

  async function upload(e) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError("");
    const form = new FormData();
    form.append("file", file);
    form.append("title", title);
    form.append("category", category);
    try {
      await client.post("/documents/ALL", form);
      setTitle(""); setFile(null);
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id) {
    if (!window.confirm("Delete this company-wide document?")) return;
    try {
      await client.delete(`/documents/${id}`);
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div>
      <div className="page-header"><h2>Company Documents</h2></div>
      <p className="hint-text">Visible to every employee's self-service documents view.</p>

      <form onSubmit={upload} className="card">
        <div className="form-row">
          <div><label>Title</label><input value={title} onChange={(e) => setTitle(e.target.value)} required /></div>
          <div><label>Category</label><input value={category} onChange={(e) => setCategory(e.target.value)} /></div>
        </div>
        <label>File</label>
        <input type="file" accept=".jpg,.jpeg,.png,.webp,.pdf" onChange={(e) => setFile(e.target.files[0])} required />
        <ErrorText>{error}</ErrorText>
        <button className="btn-primary" style={{ marginTop: 12 }} disabled={busy}>{busy ? "Uploading…" : "Upload"}</button>
      </form>

      {!list ? <Loading /> : (
        <div className="card table-wrap">
          <table>
            <thead><tr><th>Title</th><th>Category</th><th></th></tr></thead>
            <tbody>
              {list.map((f) => (
                <tr key={f.id}>
                  <td><button className="btn-sm" onClick={() => openAuthedFile(f.fileUrl).catch((err) => setError(errorMessage(err)))}>{f.title}</button></td>
                  <td>{f.category}</td>
                  <td><button className="btn-sm btn-danger" onClick={() => remove(f.id)}>Delete</button></td>
                </tr>
              ))}
              {list.length === 0 && <tr><td colSpan={3} className="empty-state">No company documents.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
