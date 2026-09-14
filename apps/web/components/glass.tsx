// The bend in the glass: the filter every glass surface's backdrop passes
// through, so what is truly behind it, a window, a terminal, the
// wallpaper, shows through it bent at the edges as through a lens. The
// map says how far each point bends: straight in the middle, pulling the
// inside outward along every edge. Chrome bends; Safari and Firefox let
// the frost through and skip the bend.

// A gradient across one axis: the channel is full at the near edge, half
// (no bend) across the middle, and empty at the far edge.
const map = (axis: "x" | "y") => {
  const rgb = (v: number) => (axis === "x" ? `rgb(${v},0,0)` : `rgb(0,${v},0)`);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" preserveAspectRatio="none">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="${axis === "x" ? 1 : 0}" y2="${axis === "y" ? 1 : 0}">` +
    `<stop offset="0" stop-color="${rgb(255)}"/><stop offset="0.28" stop-color="${rgb(128)}"/>` +
    `<stop offset="0.72" stop-color="${rgb(128)}"/><stop offset="1" stop-color="${rgb(0)}"/>` +
    `</linearGradient></defs><rect width="1" height="1" fill="url(#g)"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
};

export function GlassFilter() {
  return (
    <svg aria-hidden="true" width="0" height="0" className="absolute">
      <defs>
        <filter
          id="glass-bend"
          x="0"
          y="0"
          width="100%"
          height="100%"
          colorInterpolationFilters="sRGB"
        >
          <feImage href={map("x")} preserveAspectRatio="none" result="x" />
          <feImage href={map("y")} preserveAspectRatio="none" result="y" />
          <feComposite
            in="x"
            in2="y"
            operator="arithmetic"
            k2="1"
            k3="1"
            result="map"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="map"
            scale="28"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
    </svg>
  );
}
