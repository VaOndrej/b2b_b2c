import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";

// Flat index of every setting, so a merchant can jump straight to the right
// page instead of hunting through the nav. Extend this list whenever a new
// setting ships — keep `keywords` generous (synonyms merchants might type).
type Entry = { label: string; page: string; to: string; keywords: string };

const INDEX: Entry[] = [
  { label: "Position", page: "Behavior", to: "/app/behavior", keywords: "position placement top bottom left right corner where" },
  { label: "Duration", page: "Behavior", to: "/app/behavior", keywords: "duration time ms how long visible auto dismiss" },
  { label: "Offsets", page: "Behavior", to: "/app/behavior", keywords: "offset margin spacing top inline" },
  { label: "Max visible / overflow", page: "Behavior", to: "/app/behavior", keywords: "max visible overflow collapse queue stack" },
  { label: "Click action", page: "Behavior", to: "/app/behavior", keywords: "click action open cart product" },
  { label: "Grouping & anti-spam", page: "Behavior", to: "/app/behavior", keywords: "group grouping dedupe burst rate limit merge spam" },
  { label: "Theme mode & colours", page: "Appearance", to: "/app/appearance", keywords: "theme mode light dark custom colour color background text" },
  { label: "Accent colours", page: "Appearance", to: "/app/appearance", keywords: "accent colour color per event added removed gift shipping" },
  { label: "Radius, width, shadow, animation", page: "Appearance", to: "/app/appearance", keywords: "radius corner width shadow density animation entry style" },
  { label: "Message templates", page: "Events", to: "/app/events", keywords: "message text template wording copy locale cs sk en language" },
  { label: "Milestones (free shipping, gift)", page: "Events", to: "/app/events", keywords: "milestone free shipping gift threshold announce" },
  { label: "Targeting (pages, device, customer)", page: "Targeting", to: "/app/targeting", keywords: "targeting pages device mobile desktop customer guest logged in where run" },
  { label: "Plan (Free / Pro)", page: "Plan", to: "/app/plan", keywords: "plan free pro upgrade billing price" },
];

export function SettingsSearch() {
  const [query, setQuery] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  // Custom-element input events don't map cleanly to React's onChange. The
  // native input event bubbles, so listen on the wrapper div (clean DOM type)
  // rather than typing a ref to the Polaris element.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const handler = (e: Event) =>
      setQuery((e.target as HTMLInputElement).value ?? "");
    el.addEventListener("input", handler);
    return () => el.removeEventListener("input", handler);
  }, []);

  const q = query.trim().toLowerCase();
  const results = q
    ? INDEX.filter(
        (e) =>
          e.label.toLowerCase().includes(q) ||
          e.keywords.includes(q) ||
          e.page.toLowerCase().includes(q),
      )
    : [];

  return (
    <div ref={wrapRef}>
      <s-search-field
        label="Search settings"
        labelAccessibilityVisibility="exclusive"
        placeholder="Search settings — position, colours, milestones…"
      />
      {q ? (
        <div style={{ marginTop: 10 }}>
          {results.length === 0 ? (
            <s-text color="subdued">No settings match “{query}”.</s-text>
          ) : (
            <s-stack direction="block" gap="base">
              {results.map((e) => (
                <div key={e.label}>
                  <Link
                    to={e.to}
                    style={{ textDecoration: "none", fontWeight: 600 }}
                  >
                    {e.label}
                  </Link>
                  <span style={{ color: "#6b7280", marginLeft: 8, fontSize: 13 }}>
                    {e.page}
                  </span>
                </div>
              ))}
            </s-stack>
          )}
        </div>
      ) : null}
    </div>
  );
}
