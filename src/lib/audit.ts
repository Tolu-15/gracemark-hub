import type { ApiActor } from "@/lib/apiAuth";

export interface AuditEntry {
  action: string;
  summary: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Appends one row to the audit trail. Never throws: an audit failure must not undo or
 * block the action that was just performed.
 */
export async function logAudit(actor: ApiActor, entry: AuditEntry): Promise<void> {
  try {
    const { error } = await actor.service.from("audit_logs").insert({
      actor_user_id: actor.dbUserId ?? null,
      actor_email: actor.email ?? null,
      actor_role: actor.role,
      action: entry.action,
      entity_type: entry.entityType ?? null,
      entity_id: entry.entityId ?? null,
      summary: entry.summary,
      metadata: entry.metadata ?? {},
    });
    if (error) console.warn("Audit log write failed:", error.message);
  } catch (err) {
    console.warn("Audit log write failed:", err);
  }
}
