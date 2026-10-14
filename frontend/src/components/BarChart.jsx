// A small grouped bar chart drawn in SVG (no chart library needed).
// `series` = [{ name, color, values: [one number per category] }].
// Every bar has a hover tooltip with its exact value; the y axis shows real values.

function niceMax(v) {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  const f = v / pow;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nice * pow;
}

export function compactINR(n) {
  const v = Number(n) || 0;
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(v % 1e7 === 0 ? 0 : 1)}Cr`;
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(v % 1e5 === 0 ? 0 : 1)}L`;
  if (v >= 1e3) return `₹${(v / 1e3).toFixed(v % 1e3 === 0 ? 0 : 1)}K`;
  return `₹${v}`;
}

export default function BarChart({ title, categories, series, format = (n) => String(n) }) {
  const W = 760, H = 270, L = 58, R = 12, T = 12, B = 34;
  const plotW = W - L - R, plotH = H - T - B;
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values)));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const groupW = plotW / categories.length;
  const barW = Math.min(22, (groupW * 0.78) / series.length);
  const y = (v) => T + plotH - (v / max) * plotH;
  const empty = series.every((s) => s.values.every((v) => !v));

  return (
    <figure style={{ margin: "0 0 18px" }}>
      <figcaption style={{ fontWeight: 600, marginBottom: 6 }}>{title}</figcaption>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12, marginBottom: 4 }}>
        {series.map((s) => (
          <span key={s.name} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 10, height: 10, background: s.color, borderRadius: 2, display: "inline-block" }} />{s.name}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} style={{ width: "100%", height: "auto", maxWidth: W }}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth="1" />
            <text x={L - 6} y={y(t) + 4} textAnchor="end" fontSize="10.5" fill="var(--text-muted)">{format(t)}</text>
          </g>
        ))}
        {categories.map((c, ci) => {
          const gx = L + ci * groupW + (groupW - barW * series.length) / 2;
          return (
            <g key={c}>
              {series.map((s, si) => {
                const v = s.values[ci] || 0;
                const h = (v / max) * plotH;
                return (
                  <rect key={s.name} x={gx + si * barW} y={y(v)} width={barW - 2} height={Math.max(h, v > 0 ? 1.5 : 0)} fill={s.color} rx="2">
                    <title>{`${c} · ${s.name}: ${format(v)}`}</title>
                  </rect>
                );
              })}
              <text x={L + ci * groupW + groupW / 2} y={H - 14} textAnchor="middle" fontSize="10.5" fill="var(--text-muted)">{c}</text>
            </g>
          );
        })}
        {empty && <text x={W / 2} y={H / 2} textAnchor="middle" fontSize="13" fill="var(--text-muted)">No data in this year yet</text>}
      </svg>
    </figure>
  );
}

// A horizontal progress bar for a percentage out of 100.
export function PercentBar({ label, detail, percent, color }) {
  const p = percent == null ? 0 : Math.max(0, Math.min(100, percent));
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 3, gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontWeight: 600 }}>{label}</span>
        <span>{percent == null ? "no data yet" : `${percent}%`} <span className="hint-text">{detail}</span></span>
      </div>
      <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, height: 14, overflow: "hidden" }} role="img" aria-label={`${label}: ${percent == null ? "no data" : `${percent}%`}`}>
        <div style={{ width: `${p}%`, height: "100%", background: color }} />
      </div>
    </div>
  );
}
