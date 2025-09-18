/**
 * Approval gates for destructive operations
 * Prevents accidental or malicious data loss through administrative approval
 */

import { logger } from "@/lib/observability/logger";

export enum OperationType {
  DELETE_TENANT = 'delete_tenant',
  DELETE_CAMPAIGNS = 'delete_campaigns',
  DELETE_POSTS = 'delete_posts',
  DELETE_SOCIAL_ACCOUNTS = 'delete_social_accounts',
  MODIFY_SUBSCRIPTION = 'modify_subscription',
  BULK_DELETE = 'bulk_delete',
  EXPORT_PII = 'export_pii',
  MODIFY_PERMISSIONS = 'modify_permissions',
  DELETE_BRAND_PROFILE = 'delete_brand_profile',
  REVOKE_OAUTH_TOKENS = 'revoke_oauth_tokens',
}

export interface ApprovalRequest {
  id: string;
  operationType: OperationType;
  tenantId: string;
  requestedBy: string;
  reason: string;
  metadata: ApprovalMetadata;
  requestedAt: Date;
  approvedAt?: Date;
  approvedBy?: string;
  deniedAt?: Date;
  deniedBy?: string;
  expiresAt: Date;
}

export interface ApprovalGateOptions {
  requireApproval: boolean;
  autoApproveAfter?: number; // Auto-approve after N milliseconds
  requiredRole?: string; // Minimum role required to approve
  bypassForOwner?: boolean; // Allow tenant owner to bypass
}

export type ApprovalMetadata = Record<string, unknown> & {
  count?: number;
  denialReason?: string;
};

// In-memory store for approval requests (in production, use Redis or database)
const approvalRequests = new Map<string, ApprovalRequest>();

/**
 * Check if operation requires approval
 */
function requiresApproval(operation: OperationType, metadata: ApprovalMetadata): boolean {
  const gates: Record<OperationType, ApprovalGateOptions> = {
    [OperationType.DELETE_TENANT]: { requireApproval: true, requiredRole: 'admin' },
    [OperationType.DELETE_CAMPAIGNS]: { 
      requireApproval: true, 
      bypassForOwner: true,
      autoApproveAfter: 300000 // 5 minutes
    },
    [OperationType.DELETE_POSTS]: {
      requireApproval: typeof metadata.count === "number" && metadata.count > 10, // Require approval for bulk deletes
      bypassForOwner: true,
      autoApproveAfter: 180000 // 3 minutes
    },
    [OperationType.DELETE_SOCIAL_ACCOUNTS]: { 
      requireApproval: true, 
      bypassForOwner: true,
      autoApproveAfter: 600000 // 10 minutes
    },
    [OperationType.MODIFY_SUBSCRIPTION]: { requireApproval: true, requiredRole: 'admin' },
    [OperationType.BULK_DELETE]: { requireApproval: true },
    [OperationType.EXPORT_PII]: { requireApproval: true, requiredRole: 'admin' },
    [OperationType.MODIFY_PERMISSIONS]: { requireApproval: true, requiredRole: 'admin' },
    [OperationType.DELETE_BRAND_PROFILE]: { 
      requireApproval: true, 
      bypassForOwner: true,
      autoApproveAfter: 300000 // 5 minutes
    },
    [OperationType.REVOKE_OAUTH_TOKENS]: { 
      requireApproval: true, 
      bypassForOwner: true,
      autoApproveAfter: 120000 // 2 minutes
    },
  };

  const gate = gates[operation];
  return gate?.requireApproval || false;
}

/**
 * Create an approval request for a destructive operation
 */
export async function createApprovalRequest(
  operation: OperationType,
  tenantId: string,
  requestedBy: string,
  reason: string,
  metadata: ApprovalMetadata = {}
): Promise<{ requiresApproval: boolean; approvalId?: string }> {
  
  if (!requiresApproval(operation, metadata)) {
    return { requiresApproval: false };
  }

  const approvalId = `approval_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

  const approvalRequest: ApprovalRequest = {
    id: approvalId,
    operationType: operation,
    tenantId,
    requestedBy,
    reason,
    metadata,
    requestedAt: new Date(),
    expiresAt,
  };

  approvalRequests.set(approvalId, approvalRequest);

  // In production, send notification to admins
  await notifyAdmins(approvalRequest);

  return { requiresApproval: true, approvalId };
}

/**
 * Check if an operation is approved
 */
export function isOperationApproved(approvalId: string): boolean {
  const request = approvalRequests.get(approvalId);
  
  if (!request) {
    return false;
  }

  // Check if expired
  if (new Date() > request.expiresAt) {
    approvalRequests.delete(approvalId);
    return false;
  }

  // Check if denied
  if (request.deniedAt) {
    return false;
  }

  // Check if explicitly approved
  if (request.approvedAt) {
    return true;
  }

  // Check for auto-approval
  const gates = getOperationGates();
  const gate = gates[request.operationType];
  
  if (gate?.autoApproveAfter) {
    const timeElapsed = Date.now() - request.requestedAt.getTime();
    if (timeElapsed >= gate.autoApproveAfter) {
      // Auto-approve
      request.approvedAt = new Date();
      request.approvedBy = 'system_auto_approve';
      return true;
    }
  }

  return false;
}

/**
 * Approve an operation
 */
export async function approveOperation(
  approvalId: string,
  approvedBy: string,
  approverRole: string
): Promise<boolean> {
  const request = approvalRequests.get(approvalId);
  
  if (!request || request.approvedAt || request.deniedAt) {
    return false;
  }

  // Check if expired
  if (new Date() > request.expiresAt) {
    approvalRequests.delete(approvalId);
    return false;
  }

  // Check if approver has required role
  const gates = getOperationGates();
  const gate = gates[request.operationType];
  
  if (gate?.requiredRole && approverRole !== 'admin' && approverRole !== gate.requiredRole) {
    return false;
  }

  request.approvedAt = new Date();
  request.approvedBy = approvedBy;

  logger.info("Approval granted", {
    area: "admin",
    op: request.operationType,
    status: "ok",
    tenantId: request.tenantId,
    userId: approvedBy,
  });
  
  return true;
}

/**
 * Deny an operation
 */
export async function denyOperation(
  approvalId: string,
  deniedBy: string,
  reason?: string
): Promise<boolean> {
  const request = approvalRequests.get(approvalId);
  
  if (!request || request.approvedAt || request.deniedAt) {
    return false;
  }

  request.deniedAt = new Date();
  request.deniedBy = deniedBy;
  
  if (reason) {
    request.metadata.denialReason = reason;
  }

  logger.warn("Approval denied", {
    area: "admin",
    op: request.operationType,
    status: "fail",
    tenantId: request.tenantId,
    userId: deniedBy,
    msg: reason,
  });
  
  return true;
}

/**
 * Get pending approval requests for a tenant
 */
export function getPendingApprovals(tenantId?: string): ApprovalRequest[] {
  const pending = Array.from(approvalRequests.values()).filter(
    request => !request.approvedAt && !request.deniedAt && new Date() <= request.expiresAt
  );

  if (tenantId) {
    return pending.filter(request => request.tenantId === tenantId);
  }

  return pending;
}

/**
 * Middleware to check approval gates
 */
export async function withApprovalGate<T>(
  operation: OperationType,
  handler: (approvalId?: string) => Promise<T>,
  context: {
    tenantId: string;
    userId: string;
    userRole: string;
    reason: string;
    metadata?: ApprovalMetadata;
  }
): Promise<T> {
  const { tenantId, userId, userRole, reason, metadata = {} } = context;

  // Check if owner can bypass approval
  const gates = getOperationGates();
  const gate = gates[operation];
  
  if (gate?.bypassForOwner && userRole === "owner") {
    logger.info("Approval bypassed by owner", {
      area: "admin",
      op: operation,
      status: "ok",
      tenantId,
      userId,
    });
    return handler();
  }

  // Create approval request
  const { requiresApproval, approvalId } = await createApprovalRequest(
    operation,
    tenantId,
    userId,
    reason,
    metadata
  );

  if (!requiresApproval) {
    return handler();
  }

  // Check if already approved
  if (approvalId && isOperationApproved(approvalId)) {
    return handler(approvalId);
  }

  // Return pending approval response
  throw new Error(`Operation requires approval. Approval ID: ${approvalId}`);
}

function getOperationGates(): Record<OperationType, ApprovalGateOptions> {
  return {
    [OperationType.DELETE_TENANT]: { requireApproval: true, requiredRole: 'admin' },
    [OperationType.DELETE_CAMPAIGNS]: { 
      requireApproval: true, 
      bypassForOwner: true,
      autoApproveAfter: 300000 // 5 minutes
    },
    [OperationType.DELETE_POSTS]: { 
      requireApproval: true,
      bypassForOwner: true,
      autoApproveAfter: 180000 // 3 minutes
    },
    [OperationType.DELETE_SOCIAL_ACCOUNTS]: { 
      requireApproval: true, 
      bypassForOwner: true,
      autoApproveAfter: 600000 // 10 minutes
    },
    [OperationType.MODIFY_SUBSCRIPTION]: { requireApproval: true, requiredRole: 'admin' },
    [OperationType.BULK_DELETE]: { requireApproval: true },
    [OperationType.EXPORT_PII]: { requireApproval: true, requiredRole: 'admin' },
    [OperationType.MODIFY_PERMISSIONS]: { requireApproval: true, requiredRole: 'admin' },
    [OperationType.DELETE_BRAND_PROFILE]: { 
      requireApproval: true, 
      bypassForOwner: true,
      autoApproveAfter: 300000 // 5 minutes
    },
    [OperationType.REVOKE_OAUTH_TOKENS]: { 
      requireApproval: true, 
      bypassForOwner: true,
      autoApproveAfter: 120000 // 2 minutes
    },
  };
}

// Mock notification function (replace with real implementation)
async function notifyAdmins(request: ApprovalRequest): Promise<void> {
  logger.info("Approval required", {
    area: "admin",
    op: request.operationType,
    status: "fail",
    tenantId: request.tenantId,
    userId: request.requestedBy,
    requestId: request.id,
  });
}
