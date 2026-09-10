/**
 * Run independent Writer Browser sub-gates without hiding later failures behind
 * the first rejected scenario. The caller still receives a failing exit code
 * when any gate fails.
 */
export async function runWriterGateSuite(gates, targetUrl) {
  const results = {};
  let failed = false;
  for (const [name, gate] of gates) {
    try {
      results[name] = await gate(targetUrl);
    } catch (error) {
      failed = true;
      results[name] = { status: "FAIL", targetUrl, error: error instanceof Error ? error.message : String(error) };
    }
  }
  return { results, failed };
}
