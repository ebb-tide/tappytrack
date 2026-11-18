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

/** Parse a request's JSON body, returning null instead of throwing on bad input. */
export async function readJsonBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}
