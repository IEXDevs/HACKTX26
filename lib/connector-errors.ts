// Only these fixed messages may cross the trusted connector boundary.
export const connectorErrors = {
  CONNECTOR_UNAVAILABLE:
    'Connector unavailable or permission denied. No fixture substitution occurred.',
  SEARCH_NOT_CONFIGURED: 'SerpAPI is unavailable. Configure SERPAPI_API_KEY on the connector.',
  SEARCH_NETWORK_DENIED:
    'SerpAPI network access was denied. Restart the connector with outbound HTTPS access.',
  SEARCH_NETWORK_FAILED:
    'The connector could not reach SerpAPI. Check its network connection and try a new run.',
  SEARCH_TIMEOUT: 'SerpAPI search timed out. Try a new run.',
  SEARCH_AUTH_FAILED: 'SerpAPI rejected the connector credentials. Check the configured API key.',
  SEARCH_RATE_LIMITED:
    'SerpAPI rejected the search limit. Check quota, credits, or rate limits before retrying.',
  SEARCH_PROVIDER_FAILED: 'SerpAPI could not complete the search. Try again later.',
  SEARCH_NO_RESULTS:
    'SerpAPI returned no organic search results. Refine the query and start a new run.',
  SEARCH_INVALID_RESPONSE: 'SerpAPI returned an invalid search response. No evidence was accepted.',
} as const;
export type ConnectorErrorCode = keyof typeof connectorErrors;
export class ConnectorError extends Error {
  constructor(readonly code: ConnectorErrorCode) {
    super(connectorErrors[code]);
    this.name = 'ConnectorError';
  }
}
export function connectorFailure(error: unknown) {
  const code = error instanceof ConnectorError ? error.code : 'CONNECTOR_UNAVAILABLE';
  return { error: { code, message: connectorErrors[code] } };
}
export function connectorFailureMessage(content: { type: string; text?: string }[]) {
  try {
    const code = JSON.parse(content.find((c) => c.type === 'text')?.text || '{}').error?.code;
    if (typeof code === 'string' && Object.hasOwn(connectorErrors, code))
      return `[${code}] ${connectorErrors[code as ConnectorErrorCode]}`;
  } catch {}
  return connectorErrors.CONNECTOR_UNAVAILABLE;
}
