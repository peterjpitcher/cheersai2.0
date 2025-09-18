import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { encryptToken } from "@/lib/security/encryption";
import { createRequestLogger, logger } from '@/lib/observability/logger'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const reqLogger = createRequestLogger(request as unknown as Request)
  try {
    const supabase = await createClient();
    
    // Check authentication
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get user's tenant ID
    const { data: userData } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (!userData?.tenant_id) {
      return NextResponse.json({ error: "No tenant found" }, { status: 404 });
    }

    const tenantId = userData.tenant_id;
    const body = await request.json();
    
    // Validate required fields
    if (!body.platform || !body.accessToken || !body.accountId || !body.accountName) {
      return NextResponse.json({ 
        error: "Missing required fields", 
        required: ["platform", "accessToken", "accountId", "accountName"]
      }, { status: 400 });
    }

    // Validate platform
    const validPlatforms = ['facebook', 'instagram', 'google_my_business'];
    if (!validPlatforms.includes(body.platform)) {
      return NextResponse.json({ 
        error: "Invalid platform",
        validPlatforms 
      }, { status: 400 });
    }

    // Check if connection already exists
    const { data: existingConnection } = await supabase
      .from('social_connections')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('platform', body.platform)
      .eq('account_id', body.accountId)
      .single();

    if (existingConnection) {
      // Update existing connection
      const { data: updatedConnection, error } = await supabase
        .from('social_connections')
        .update({
          access_token: null,
          refresh_token: null,
          access_token_encrypted: encryptToken(body.accessToken),
          refresh_token_encrypted: body.refreshToken ? encryptToken(body.refreshToken) : null,
          token_encrypted_at: new Date().toISOString(),
          token_expires_at: body.expiresAt,
          is_active: true,
          updated_at: new Date().toISOString()
        })
        .eq('id', existingConnection.id)
        .select()
        .single();

      if (error) {
        reqLogger.error('Social connection update error', {
          area: 'social',
          op: `${body.platform}.connect`,
          status: 'fail',
          error,
          meta: { tenantId, accountId: body.accountId },
        })
        return NextResponse.json({ 
          error: "Failed to update connection" 
        }, { status: 500 });
      }

      reqLogger.info('Social connection updated', {
        area: 'social',
        op: `${body.platform}.connect`,
        status: 'ok',
        meta: { tenantId, accountId: body.accountId },
      })

      return NextResponse.json({
        message: "Connection updated successfully",
        connection: updatedConnection
      });
    }

    // Create new connection
    const { data: newConnection, error } = await supabase
      .from('social_connections')
      .insert({
        tenant_id: tenantId,
        platform: body.platform,
        account_id: body.accountId,
        account_name: body.accountName,
        access_token: null,
        refresh_token: null,
        access_token_encrypted: encryptToken(body.accessToken),
        refresh_token_encrypted: body.refreshToken ? encryptToken(body.refreshToken) : null,
        token_encrypted_at: new Date().toISOString(),
        token_expires_at: body.expiresAt,
        is_active: true
      })
      .select()
      .single();

    if (error) {
      reqLogger.error('Social connection creation error', {
        area: 'social',
        op: `${body.platform}.connect`,
        status: 'fail',
        error,
        meta: { tenantId, accountId: body.accountId },
      })
      return NextResponse.json({ 
        error: "Failed to create connection",
        details: error.message 
      }, { status: 500 });
    }

    reqLogger.info('Social connection created', {
      area: 'social',
      op: `${body.platform}.connect`,
      status: 'ok',
      meta: { tenantId, accountId: body.accountId },
    })

    return NextResponse.json({
      message: "Connection created successfully",
      connection: newConnection
    }, { status: 201 });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    reqLogger.error('Social connect error', {
      area: 'social',
      op: 'connect',
      status: 'fail',
      error: err,
    })
    logger.error('Social connect error', {
      area: 'social',
      op: 'connect',
      status: 'fail',
      error: err,
    })
    return NextResponse.json({ 
      error: "An unexpected error occurred" 
    }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const reqLogger = createRequestLogger(request as unknown as Request)
  try {
    const supabase = await createClient();
    
    // Check authentication
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const connectionId = searchParams.get('connectionId');

    if (!connectionId) {
      return NextResponse.json({ 
        error: "Connection ID is required" 
      }, { status: 400 });
    }

    // Get user's tenant ID
    const { data: userData } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (!userData?.tenant_id) {
      return NextResponse.json({ error: "No tenant found" }, { status: 404 });
    }

    const tenantId = userData.tenant_id;

    // Verify connection belongs to tenant before deleting
    const { data: connection } = await supabase
      .from('social_connections')
      .select('id')
      .eq('id', connectionId)
      .eq('tenant_id', tenantId)
      .single();

    if (!connection) {
      return NextResponse.json({ 
        error: "Connection not found or access denied" 
      }, { status: 404 });
    }

    // Soft delete the connection
    const { error } = await supabase
      .from('social_connections')
      .update({
        is_active: false,
        deleted_at: new Date().toISOString()
      })
      .eq('id', connectionId);

    if (error) {
      reqLogger.error('Social connection deletion error', {
        area: 'social',
        op: 'disconnect',
        status: 'fail',
        error,
        meta: { connectionId },
      })
      return NextResponse.json({ 
        error: "Failed to delete connection" 
      }, { status: 500 });
    }

    reqLogger.info('Social connection deleted', {
      area: 'social',
      op: 'disconnect',
      status: 'ok',
      meta: { connectionId },
    })

    return NextResponse.json({
      message: "Connection deleted successfully"
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    reqLogger.error('Social disconnect error', {
      area: 'social',
      op: 'disconnect',
      status: 'fail',
      error: err,
    })
    logger.error('Social disconnect error', {
      area: 'social',
      op: 'disconnect',
      status: 'fail',
      error: err,
    })
    return NextResponse.json({ 
      error: "An unexpected error occurred" 
    }, { status: 500 });
  }
}
