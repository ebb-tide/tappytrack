/**
 * Parse a Lambda response body that may not be JSON — the Lambdas return
 * plain text for some errors (e.g. "Forbidden" on 403).
 */
export async function upstreamJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: text || `Upstream error (${res.status})` };
  }
}
