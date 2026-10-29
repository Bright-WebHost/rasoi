import { NextResponse } from 'next/server';
import { timingSafeSecretEquals } from '@/lib/server/internal-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { generateToken, hashToken, TOKEN_TTL_SECONDS } from '@/lib/session/token';

/**
 * GET /api/ai/tools/customer/lookup
 * 
 * Secure server-side endpoint for n8n to resolve a WhatsApp phone number
 * into a Rasoi customer_id. Creates a stub customer if one doesn't exist.
 * Also generates a secure one-time session token for the CTA.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const phone = searchParams.get('phone');
    const name = searchParams.get('name');
    const channelUserId = searchParams.get('channel_user_id');

    if (!phone || !channelUserId) {
      return NextResponse.json({ error: 'Missing phone number or channel_user_id' }, { status: 400 });
    }

    // Authenticate the request from n8n
    const secretHeader = request.headers.get('x-rasoi-ai-secret')?.trim();
    const expectedSecret = process.env.RASOI_AI_WEBHOOK_SECRET?.trim();

    if (!timingSafeSecretEquals(secretHeader, expectedSecret)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createAdminClient();

    // 1 & 2. Find or create the customer robustly to prevent race conditions.
    // The schema has a UNIQUE(channel, channel_user_id) constraint.
    const { data: customer, error: upsertError } = await supabase
      .from('app_customers')
      .upsert({
        channel: 'whatsapp',
        channel_user_id: channelUserId,
        phone: phone,
        name: name || 'WhatsApp Customer'
      }, { 
        onConflict: 'channel,channel_user_id',
        ignoreDuplicates: false // updating phone/name ensures profile is fresh
      })
      .select('id')
      .single();

    if (upsertError || !customer) {
      console.error('[AI Tool: customer_lookup] Database error on upsert:', upsertError ? {
        message: upsertError.message,
        code: upsertError.code,
        details: upsertError.details,
        hint: upsertError.hint
      } : 'No customer returned');
      return NextResponse.json({ error: 'Failed to find or create customer' }, { status: 500 });
    }

    // 3. Generate a secure one-time session token for the CTA
    const rawToken = generateToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + TOKEN_TTL_SECONDS * 1000).toISOString();

    const { error: sessionError } = await supabase
      .from('ordering_sessions')
      .insert({
        customer_id: customer.id,
        channel: 'whatsapp',
        channel_user_id: channelUserId,
        token_hash: tokenHash,
        status: 'pending',
        expires_at: expiresAt,
      });

    if (sessionError) {
      console.error('[AI Tool: customer_lookup] Failed to create ordering session:', sessionError.message);
      return NextResponse.json({ error: 'Failed to generate session' }, { status: 500 });
    }

    // 4. Return the customer_id and the fully qualified CTA URL
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim() || new URL(request.url).origin;
    const ctaUrl = new URL('/auth/whatsapp', siteUrl);
    ctaUrl.searchParams.set('token', rawToken);
    
    return NextResponse.json({ 
      customer_id: customer.id,
      cta_url: ctaUrl.toString()
    });

  } catch (error) {
    console.error('[AI Tool: customer_lookup] Unhandled exception:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
