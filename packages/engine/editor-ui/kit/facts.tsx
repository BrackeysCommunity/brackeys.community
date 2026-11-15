import { Fragment, type ReactNode } from "react";

/** A read-only list of terms and values, one row each. */
export function Facts({
  label,
  rows,
}: {
  label?: string;
  rows: readonly (readonly [string, ReactNode])[];
}) {
  return (
    <dl className="je-facts" aria-label={label}>
      {rows.map(([term, value]) => (
        <Fragment key={term}>
          <dt>{term}</dt>
          <dd>{value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}
