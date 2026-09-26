import React from "react";

/** Shimmering placeholder. Size it with Tailwind classes, e.g. <Skeleton className="h-6 w-24" />. */
export function Skeleton({
  className = "",
  block = false,
  dark = false,
}: {
  className?: string;
  block?: boolean;
  dark?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={`gm-skel ${block ? "gm-skel--block" : ""} ${dark ? "gm-skel--dark" : ""} ${className}`}
    />
  );
}

/** Shows a skeleton while `loading`, then eases the real value in. */
export function SkeletonValue({
  loading,
  className = "h-6 w-20",
  dark = false,
  children,
}: {
  loading: boolean;
  className?: string;
  dark?: boolean;
  children: React.ReactNode;
}) {
  if (loading) return <Skeleton className={className} dark={dark} />;
  return <span className="gm-reveal inline-block">{children}</span>;
}

/** Skeleton rows for a table body. */
export function SkeletonRows({ rows = 8, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} className="border-b border-slate-100">
          {Array.from({ length: cols }).map((_, c) => (
            <td key={c} className="px-3 py-3">
              <Skeleton block className={`h-4 ${c === 0 ? "w-8" : c === 1 ? "w-40" : "w-12"}`} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
