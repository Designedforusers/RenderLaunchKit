/**
 * Compose a full MinIO endpoint URL from the bare `MINIO_ENDPOINT_HOST`
 * value injected by `render.yaml` (via `fromService.property: host`)
 * or by the local `.env` file pointing at the docker-compose service.
 *
 * Render services are always reachable over HTTPS on 443 (the platform
 * terminates TLS at its ingress), so a bare hostname like
 * `launchkit-minio-xyz.onrender.com` becomes `https://launchkit-minio-xyz.onrender.com`.
 * Local dev points at `localhost:9000` which is plain HTTP and carries
 * an explicit port, so the helper detects either signal and returns
 * `http://${host}` instead.
 *
 * Returns `null` when the host is missing so callers can branch to a
 * structured error at the use site instead of throwing here.
 *
 * Lives in `@launchkit/shared` (not in each service's env module) because
 * it is pure URL composition with no process.env reads and no service-
 * specific dependency — both `apps/web/src/env.ts` and
 * `apps/workflows/src/env.ts` import it from here. The package stays
 * browser-safe; this helper does not touch `process`, `node:*`, or any
 * other Node-only surface.
 */
export function composeMinioEndpoint(host: string | undefined): string | null {
  if (host === undefined || host.length === 0) return null;

  // If the caller already passed a full URL (e.g. "https://host.com"),
  // return it directly instead of double-wrapping with a second scheme.
  if (host.startsWith('http://') || host.startsWith('https://')) {
    return host;
  }

  const isLocal =
    host.startsWith('localhost') ||
    host.startsWith('127.0.0.1') ||
    host.includes(':');
  return isLocal ? `http://${host}` : `https://${host}`;
}
