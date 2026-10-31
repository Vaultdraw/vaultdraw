/** A small picture of the proposed change: new shapes dashed, moved and restyled ones marked, removed ones struck. */
import type { Ghost } from "./edits";

const COLOR: Record<Ghost["state"], string> = {
  new: "var(--vault-primary, #6965db)",
  moved: "var(--vault-warning, #f08c00)",
  changed: "var(--vault-warning, #f08c00)",
  removed: "var(--vault-danger, #e03131)",
  same: "var(--vault-text-faint, #888)",
};

export default function Ghosts({ ghosts }: { ghosts: readonly Ghost[] }) {
  if (ghosts.length === 0) {
    return null;
  }
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const g of ghosts) {
    x0 = Math.min(x0, g.x);
    y0 = Math.min(y0, g.y);
    x1 = Math.max(x1, g.x + g.width, g.x2 ?? -Infinity);
    y1 = Math.max(y1, g.y + g.height, g.y2 ?? -Infinity);
    x0 = Math.min(x0, g.x2 ?? Infinity);
    y0 = Math.min(y0, g.y2 ?? Infinity);
  }
  const pad = 20;
  const w = Math.max(1, x1 - x0) + pad * 2;
  const h = Math.max(1, y1 - y0) + pad * 2;
  return (
    <svg
      className="vd-ai-ghosts"
      role="img"
      aria-label="Preview of the change"
      viewBox={`${x0 - pad} ${y0 - pad} ${w} ${h}`}
      preserveAspectRatio="xMidYMid meet"
    >
      {ghosts.map((g, i) => {
        const c = COLOR[g.state];
        const common = {
          stroke: c,
          strokeWidth: g.state === "same" ? 1 : 2,
          fill: g.state === "new" ? c : "none",
          fillOpacity: 0.12,
          strokeDasharray: g.state === "new" ? "6 4" : undefined,
          opacity: g.state === "removed" ? 0.7 : 1,
          vectorEffect: "non-scaling-stroke" as const,
        };
        const mid = { x: g.x + g.width / 2, y: g.y + g.height / 2 };
        return (
          <g key={i} data-state={g.state}>
            {g.type === "ellipse" ? (
              <ellipse
                cx={mid.x}
                cy={mid.y}
                rx={g.width / 2}
                ry={g.height / 2}
                {...common}
              />
            ) : g.type === "arrow" || g.type === "line" ? (
              <line
                x1={g.x}
                y1={g.y}
                x2={g.x2 ?? g.x + g.width}
                y2={g.y2 ?? g.y + g.height}
                {...common}
                fill="none"
              />
            ) : g.type === "diamond" ? (
              <polygon
                points={`${mid.x},${g.y} ${g.x + g.width},${mid.y} ${mid.x},${
                  g.y + g.height
                } ${g.x},${mid.y}`}
                {...common}
              />
            ) : (
              <rect
                x={g.x}
                y={g.y}
                width={g.width}
                height={g.height}
                rx={g.type === "text" ? 0 : 6}
                {...common}
              />
            )}
            {g.state === "removed" ? (
              <line
                x1={g.x}
                y1={g.y}
                x2={g.x + g.width}
                y2={g.y + g.height}
                stroke={c}
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
            {g.text ? (
              <text
                x={mid.x}
                y={mid.y}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={Math.min(14, Math.max(8, g.height / 3))}
                fill={c}
                stroke="none"
              >
                {g.text.length > 24 ? `${g.text.slice(0, 23)}…` : g.text}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
