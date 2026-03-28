import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config/environment';
import { FunnelAuditResult } from '../audit/funnelAgent';
import { AnalysisResult } from '../analysis/aiAnalyzer';

let client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (!client) {
    client = createClient(config.supabase.url, config.supabase.serviceRoleKey);
  }
  return client;
}

// ─── Save funnel audit + analysis ────────────────────────────────────────────

export async function saveAuditRun(
  funnelResult: FunnelAuditResult,
  analysis: AnalysisResult,
  pdfUrl?: string,
  prospectEmail?: string,
  prospectName?: string,
  prospectCompany?: string
): Promise<string | null> {
  try {
    const supabase = getClient();

    const { data, error } = await supabase
      .from('audit_runs')
      .insert({
        id: funnelResult.auditId,
        product_url: funnelResult.productUrl,
        product_name: funnelResult.productName,
        prospect_email: prospectEmail || null,
        prospect_name: prospectName || null,
        prospect_company: prospectCompany || null,
        overall_score: funnelResult.funnelScore,
        status: analysis.analysis.overallRisk,
        audit_json: funnelResult as any,
        analysis_json: analysis as any,
        pdf_url: pdfUrl || null,
        email_sent: false,
      })
      .select('id')
      .single();

    if (error) {
      console.error('Supabase insert error:', error.message);
      return null;
    }

    return data?.id || null;
  } catch (error) {
    console.error('saveAuditRun failed:', error instanceof Error ? error.message : error);
    return null;
  }
}

// ─── Mark email as sent ───────────────────────────────────────────────────────

export async function markEmailSent(auditId: string): Promise<void> {
  try {
    const supabase = getClient();
    const { error } = await supabase
      .from('audit_runs')
      .update({
        email_sent: true,
        email_sent_at: new Date().toISOString(),
      })
      .eq('id', auditId);

    if (error) console.error('markEmailSent error:', error.message);
  } catch (error) {
    console.error('markEmailSent failed:', error instanceof Error ? error.message : error);
  }
}

// ─── Mark reply received ──────────────────────────────────────────────────────

export async function markReplyReceived(auditId: string): Promise<void> {
  try {
    const supabase = getClient();
    const { error } = await supabase
      .from('audit_runs')
      .update({ reply_received: true })
      .eq('id', auditId);

    if (error) console.error('markReplyReceived error:', error.message);
  } catch (error) {
    console.error('markReplyReceived failed:', error instanceof Error ? error.message : error);
  }
}

// ─── Get recent audit runs ────────────────────────────────────────────────────

export async function getRecentAuditRuns(limit = 20): Promise<any[]> {
  try {
    const supabase = getClient();
    const { data, error } = await supabase
      .from('audit_runs')
      .select('id, product_url, product_name, overall_score, status, email_sent, email_sent_at, reply_received, created_at')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('getRecentAuditRuns error:', error.message);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('getRecentAuditRuns failed:', error instanceof Error ? error.message : error);
    return [];
  }
}

// ─── Upload PDF to Supabase Storage ──────────────────────────────────────────

export async function uploadPDF(
  pdfPath: string,
  auditId: string
): Promise<string | null> {
  try {
    const fs = await import('fs');
    const supabase = getClient();

    const fileBuffer = fs.readFileSync(pdfPath);
    const fileName = `reports/${auditId}.pdf`;

    const { error } = await supabase.storage
      .from('reports')
      .upload(fileName, fileBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (error) {
      console.error('PDF upload error:', error.message);
      return null;
    }

    const { data } = supabase.storage
      .from('reports')
      .getPublicUrl(fileName);

    return data.publicUrl;
  } catch (error) {
    console.error('uploadPDF failed:', error instanceof Error ? error.message : error);
    return null;
  }
}

// ─── Save client ──────────────────────────────────────────────────────────────

export async function saveClient(
  companyName: string,
  productUrl: string,
  contactEmail: string,
  contactName?: string,
  plan?: string,
  monthlyValue?: number,
  auditRunId?: string
): Promise<string | null> {
  try {
    const supabase = getClient();

    const { data, error } = await supabase
      .from('clients')
      .insert({
        company_name: companyName,
        product_url: productUrl,
        contact_email: contactEmail,
        contact_name: contactName || null,
        plan: plan || 'audit',
        monthly_value: monthlyValue || null,
        audit_run_id: auditRunId || null,
        status: 'active',
      })
      .select('id')
      .single();

    if (error) {
      console.error('saveClient error:', error.message);
      return null;
    }

    return data?.id || null;
  } catch (error) {
    console.error('saveClient failed:', error instanceof Error ? error.message : error);
    return null;
  }
}