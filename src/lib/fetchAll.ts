/**
 * The database API returns at most 1,000 rows per request and does not say when it stopped short.
 * Anything that counts or groups rows in code must read them in pages with this, or it silently
 * undercounts once a table grows. `build` receives the row range and returns the query for it.
 */
export async function fetchAll<T = any>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
    if ((data || []).length < pageSize) break;
  }
  return rows;
}
