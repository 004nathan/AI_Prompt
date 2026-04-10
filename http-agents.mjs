/**
 * Shared HTTP(S) agents for axios. Internal Zoho staging hosts (e.g. *.csez.zohocorpin.com)
 * often use TLS chains Node does not trust → "unable to verify the first certificate".
 *
 * Those hosts use relaxed verification automatically. For any other host, set
 * MIGRATION_ANALYZER_TLS_INSECURE=1 to disable verification, or use NODE_EXTRA_CA_CERTS
 * with your corporate CA PEM (preferred).
 */
import http from "node:http";
import https from "node:https";

export const httpAgent = new http.Agent({ keepAlive: true });

export const httpsAgentStrict = new https.Agent({ keepAlive: true });

export const httpsAgentInsecure = new https.Agent({
  keepAlive: true,
  rejectUnauthorized: false,
});

function tlsVerificationDisabledGlobally() {
  const v = process.env.MIGRATION_ANALYZER_TLS_INSECURE;
  if (v === "1" || v === "true" || v === "yes") return true;
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") return true;
  return false;
}

/** mcms.csez.zohocorpin.com and similar — internal staging VPN / corp TLS. */
function hostUsesKnownInternalStagingCert(hostname) {
  const h = String(hostname || "").toLowerCase();
  return h.endsWith(".csez.zohocorpin.com");
}

export function pickHttpsAgentForUrl(urlString) {
  if (tlsVerificationDisabledGlobally()) return httpsAgentInsecure;
  try {
    const { hostname } = new URL(urlString);
    if (hostUsesKnownInternalStagingCert(hostname)) return httpsAgentInsecure;
  } catch {
    /* ignore */
  }
  return httpsAgentStrict;
}
