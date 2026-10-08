// Project Category -> Service -> Project Type, each choice narrowing the next:
//   Consultancy: ESG Consultancy or ISO Consultancy, each with its own types
//   Audit:       Audit & Assessment
//   Training:    no service, straight to the project type
// `value` is { projectCategory, service, projectType }; onChange gets the new object.
export default function ClassificationFields({ catalog, value, onChange }) {
  if (!catalog) return <p className="hint-text">Loading project categories…</p>;

  const category = catalog.categories.find((c) => c.value === value.projectCategory);
  const services = category?.services || [];
  const service = services.find((s) => s.value === value.service);
  const types = services.length > 0 ? (service?.types || []) : (category?.types || []);
  const typesReady = !!category && (services.length === 0 || !!service);

  return (
    <div className="form-row">
      <div>
        <label>Project Category</label>
        <select
          value={value.projectCategory || ""}
          onChange={(e) => onChange({ projectCategory: e.target.value, service: "", projectType: "" })}
          required
        >
          <option value="">Select…</option>
          {catalog.categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </div>
      {services.length > 0 && (
        <div>
          <label>Service</label>
          <select
            value={value.service || ""}
            onChange={(e) => onChange({ ...value, service: e.target.value, projectType: "" })}
            required
          >
            <option value="">Select…</option>
            {services.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
      )}
      <div>
        <label>Project Type</label>
        <select
          value={value.projectType || ""}
          onChange={(e) => onChange({ ...value, projectType: e.target.value })}
          disabled={!typesReady}
          required
        >
          <option value="">{typesReady ? "Select…" : "Choose the category first"}</option>
          {types.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </div>
    </div>
  );
}
