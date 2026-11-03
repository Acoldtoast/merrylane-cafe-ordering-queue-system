interface CoffeeArtProps {
  kind?: "coffee" | "tea" | "pastry";
  variant?: "illustration" | "icon";
  className?: string;
}

/**
 * Hand-drawn looking cafe illustrations used across menu cards.
 * They are intentionally local SVG assets so the app works offline.
 */
export function CoffeeArt({
  kind = "coffee",
  variant = "illustration",
  className = "",
}: CoffeeArtProps) {
  if (variant === "icon") {
    if (kind === "pastry") {
      return (
        <svg
          viewBox="0 0 48 48"
          className={`coffee-illustration coffee-illustration-icon ${className}`}
          aria-hidden="true"
        >
          <ellipse cx="24" cy="38" rx="15" ry="3" fill="#5a3d29" opacity=".14" />
          <path
            d="M8 31c1-3 3-5 6-7l5-8c1-2 4-2 5 0l1 2 3-4c1-2 4-1 4 1l.5 2c2-1 5 1 4 4 3 2 3 6 0 9-3 4-8 6-15 6H14c-4 0-7-2-6-5Z"
            fill="#c6905b"
            stroke="#60402b"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <path
            d="m15 25 4 3m4-8 3 8m5-9 1 7m-17 4c5 2 12 2 19-1"
            fill="none"
            stroke="#f3dcbf"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
          <path
            d="M8 31c3 2 6 2 9 2"
            fill="none"
            stroke="#7d5031"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>
      );
    }

    const isTea = kind === "tea";
    return (
      <svg
        viewBox="0 0 48 48"
        className={`coffee-illustration coffee-illustration-icon ${className}`}
        aria-hidden="true"
      >
        <ellipse cx="24" cy="39" rx="14" ry="3" fill="#5a3d29" opacity=".14" />
        <path
          d="M11 20h22l-2 13c-.3 2-1.6 3.2-3.4 3.2H16.4c-1.8 0-3.1-1.2-3.4-3.2L11 20Z"
          fill="#fbf3e7"
          stroke="#674731"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path
          d="M12 20h20l-.7 4H12.7L12 20Z"
          fill={isTea ? "#718566" : "#9b653d"}
        />
        <path
          d="M33 23h2.5a4 4 0 0 1 0 8H32"
          fill="none"
          stroke="#674731"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
        <path
          d={isTea ? "M20 30c1-5 6-7 9-7-1 5-4 8-9 7Zm2-1 5-4" : "M18 29c1-2 3-2 4 0m3-2c1-2 3-2 4 0"}
          fill="none"
          stroke={isTea ? "#52674b" : "#6a4933"}
          strokeWidth="1.35"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {!isTea && (
          <path
            d="M17 15c-2-2 2-3 0-5m7 5c-2-2 2-3 0-5m7 5c-2-2 2-3 0-5"
            fill="none"
            stroke="#8a6c54"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        )}
      </svg>
    );
  }

  if (kind === "pastry") {
    return (
      <svg
        viewBox="0 0 240 170"
        className={`coffee-illustration ${className}`}
        aria-hidden="true"
      >
        <ellipse cx="121" cy="138" rx="79" ry="10" fill="#5a3d29" opacity=".13" />
        <ellipse
          cx="120"
          cy="132"
          rx="75"
          ry="20"
          fill="#fff7ea"
          stroke="#6c4a32"
          strokeWidth="1.2"
          opacity=".92"
        />
        <path
          d="M49 103c2-28 26-47 56-47 15 0 28 5 37 15-7 2-12 8-12 15 0 7 5 12 12 14 2 4 4 9 4 14 0 9-8 15-18 15H78c-18 0-31-10-29-26Z"
          fill="#c6905b"
          stroke="#60402b"
          strokeWidth="1.4"
        />
        <path
          d="M56 110c5-19 23-32 48-33 8 0 16 1 23 4M64 122c8-12 24-19 45-20 10 0 19 1 26 4"
          fill="none"
          stroke="#7d5031"
          strokeWidth="1.15"
          opacity=".75"
          strokeLinecap="round"
        />
        <path
          d="M174 87c10 5 17 13 19 23M165 71c7-8 16-11 25-9"
          fill="none"
          stroke="#5d3e29"
          strokeWidth="1.1"
          opacity=".55"
          strokeLinecap="round"
        />
        <path
          d="M103 109c2-3 6-3 8 0M128 113c2-3 6-3 8 0M116 97c2-3 6-3 8 0"
          fill="none"
          stroke="#f3dcbf"
          strokeWidth="1.3"
          strokeLinecap="round"
          opacity=".55"
        />
        <path
          d="M40 56c5-5 10-5 14-1M36 66c4-3 8-3 11 0"
          fill="none"
          stroke="#5b3d29"
          strokeWidth="1"
          opacity=".22"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  const isTea = kind === "tea";
  return (
    <svg
      viewBox="0 0 240 170"
      className={`coffee-illustration ${className}`}
      aria-hidden="true"
    >
      <ellipse cx="121" cy="143" rx="72" ry="9" fill="#5a3d29" opacity=".14" />
      <ellipse
        cx="121"
        cy="138"
        rx="69"
        ry="16"
        fill="#fff8ec"
        stroke="#6a4933"
        strokeWidth="1"
        opacity=".9"
      />
      <path
        d="M68 71h102l-7 54c-.6 5-5 9-10 9H85c-5 0-9.4-4-10-9l-7-54Z"
        fill="#fbf3e7"
        stroke="#674731"
        strokeWidth="1.35"
      />
      <path
        d="M68 71h102l-1.5 12H69.5L68 71Z"
        fill={isTea ? "#718566" : "#9b653d"}
        opacity=".92"
      />
      <ellipse
        cx="119"
        cy="72"
        rx="49"
        ry="8.3"
        fill={isTea ? "#a9bd96" : "#c28b57"}
        stroke="#674731"
        strokeWidth="1.2"
      />
      <ellipse
        cx="114"
        cy="71"
        rx="19"
        ry="3"
        fill="#fff7e7"
        opacity=".24"
      />
      <path
        d="M170 85h7c12 0 18 8 16 19-2 9-9 14-19 14h-8"
        fill="none"
        stroke="#674731"
        strokeWidth="1.25"
      />
      <path
        d="M85 88c1 13 3 25 6 37M96 87c0 14 1 26 2 39"
        fill="none"
        stroke="#fffdf8"
        strokeWidth="2.4"
        strokeLinecap="round"
        opacity=".45"
      />
      <g
        fill="none"
        stroke="#5e412e"
        strokeWidth="1.2"
        strokeLinecap="round"
        opacity=".47"
      >
        <path d="M103 53c-6-8 5-12 0-21" />
        <path d="M121 50c-6-8 5-12 0-21" />
        <path d="M139 53c-6-8 5-12 0-21" />
      </g>
      <path
        d="M120 104c-8-7-16 0-12 8 3 6 12 11 12 11s9-5 12-11c4-8-4-15-12-8Z"
        fill="none"
        stroke="#6a4933"
        strokeWidth=".9"
        opacity=".4"
      />
      <path
        d="M55 38c5-5 11-5 15-1M45 50c4-3 8-3 11 0"
        fill="none"
        stroke="#5b3d29"
        strokeWidth="1"
        opacity=".2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function artKindForCategory(category?: string, name?: string): "coffee" | "tea" | "pastry" {
  const cat = (category || "").toLowerCase();
  const item = (name || "").toLowerCase();
  if (cat.includes("pastr") || cat.includes("bread") || cat.includes("food")) return "pastry";
  if (cat.includes("non") || item.includes("matcha") || item.includes("chocolate")) return "tea";
  return "coffee";
}
