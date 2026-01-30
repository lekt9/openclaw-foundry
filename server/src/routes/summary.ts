/**
 * GET /skills/:id/summary — Free skill summary with endpoint list.
 */

import { getDb } from "../db.js";

export function getSkillSummary(id: string): Response {
  const db = getDb();

  const row = db.query(`
    SELECT id, service, slug, base_url, auth_method_type,
           endpoint_count, download_count, tags_json, endpoints_json,
           creator_wallet, creator_alias, updated_at,
           review_status, review_score
    FROM skills WHERE id = ?
  `).get(id) as any;

  if (!row) {
    return Response.json({ error: "Skill not found" }, { status: 404 });
  }

  return Response.json({
    id: row.id,
    service: row.service,
    slug: row.slug,
    baseUrl: row.base_url,
    authMethodType: row.auth_method_type,
    endpointCount: row.endpoint_count,
    downloadCount: row.download_count,
    tags: JSON.parse(row.tags_json ?? "[]"),
    endpoints: JSON.parse(row.endpoints_json ?? "[]"),
    creatorWallet: row.creator_wallet,
    creatorAlias: row.creator_alias ?? undefined,
    updatedAt: row.updated_at,
    reviewStatus: row.review_status ?? "pending",
    reviewScore: row.review_score ?? null,
  });
}
