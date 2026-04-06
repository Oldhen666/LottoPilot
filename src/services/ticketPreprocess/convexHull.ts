/** 2D convex hull (Graham scan). Points as [x, y]. */

export type Pt = { x: number; y: number };

function cross(o: Pt, a: Pt, b: Pt): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

export function convexHull(points: Pt[]): Pt[] {
  if (points.length < 3) return [...points];
  let bottom = 0;
  for (let i = 1; i < points.length; i++) {
    const p = points[i]!;
    const q = points[bottom]!;
    if (p.y < q.y || (p.y === q.y && p.x < q.x)) bottom = i;
  }
  const o = points[bottom]!;
  const sorted = points
    .filter((_, i) => i !== bottom)
    .sort((a, b) => {
      const cr = cross(o, a, b);
      if (Math.abs(cr) < 1e-9) {
        const da = (a.x - o.x) ** 2 + (a.y - o.y) ** 2;
        const db = (b.x - o.x) ** 2 + (b.y - o.y) ** 2;
        return da - db;
      }
      return cr > 0 ? -1 : 1;
    });
  const hull: Pt[] = [o];
  for (const p of sorted) {
    while (hull.length >= 2 && cross(hull[hull.length - 2]!, hull[hull.length - 1]!, p) <= 0) {
      hull.pop();
    }
    hull.push(p);
  }
  return hull;
}
