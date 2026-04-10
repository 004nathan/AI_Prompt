/**
 * Shared HTTP(S) agents for axios.
 *
 * - *.csez.zohocorpin.com: relaxed server-cert verification (internal chains).
 * - MIGRATION_ANALYZER_TLS_INSECURE=1: relax verification for all hosts.
 * - Mutual TLS: if the server returns "certificate required" (TLS alert 116), set
 *   MIGRATION_ANALYZER_TLS_CLIENT_CERT + MIGRATION_ANALYZER_TLS_CLIENT_KEY (PEM paths),
 *   or MIGRATION_ANALYZER_TLS_CLIENT_PFX (.p12 / .pfx), optional
 *   MIGRATION_ANALYZER_TLS_CLIENT_KEY_PASSPHRASE.
 */
import { existsSync, readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";

export const httpAgent = new http.Agent({ keepAlive: true });

function loadOptionalClientTlsIdentity() {
  const passphrase = process.env.MIGRATION_ANALYZER_TLS_CLIENT_KEY_PASSPHRASE || undefined;
  const pfxPath = process.env.MIGRATION_ANALYZER_TLS_CLIENT_PFX;
  if (pfxPath) {
    try {
      if (!existsSync(pfxPath)) {
        console.warn(`[http-agents] MIGRATION_ANALYZER_TLS_CLIENT_PFX not found: ${pfxPath}`);
        return {};
      }
      const o = { pfx: readFileSync(pfxPath) };
      if (passphrase) o.passphrase = passphrase;
      console.info("[http-agents] Using TLS client identity (PFX)");
      return o;
    } catch (e) {
      console.warn("[http-agents] Failed to read TLS client PFX:", e.message);
      return {};
    }
  }
  const certPath = process.env.MIGRATION_ANALYZER_TLS_CLIENT_CERT;
  const keyPath = process.env.MIGRATION_ANALYZER_TLS_CLIENT_KEY;
  if (certPath && keyPath) {
    try {
      if (!existsSync(certPath) || !existsSync(keyPath)) {
        console.warn("[http-agents] TLS client cert/key path missing on disk");
        return {};
      }
      const o = {
        cert: readFileSync(certPath),
        key: readFileSync(keyPath),
      };
      if (passphrase) o.passphrase = passphrase;
      console.info("[http-agents] Using TLS client identity (cert + key)");
      return o;
    } catch (e) {
      console.warn("[http-agents] Failed to read TLS client cert/key:", e.message);
      return {};
    }
  }
  return {};
}

const clientTls = loadOptionalClientTlsIdentity();

export const httpsAgentStrict = new https.Agent({
  keepAlive: true,
  ...clientTls,
});

export const httpsAgentInsecure = new https.Agent({
  keepAlive: true,
  rejectUnauthorized: false,
  ...clientTls,
});

function tlsVerificationDisabledGlobally() {
  const v = process.env.MIGRATION_ANALYZER_TLS_INSECURE;
  if (v === "1" || v === "true" || v === "yes") return true;
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") return true;
  return false;
}

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
