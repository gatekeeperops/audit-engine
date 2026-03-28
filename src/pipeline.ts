import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { FunnelAgent } from './audit/funnelAgent';
import { AIAnalyzer } from './analysis/aiAnalyzer';
import { PDFGenerator } from './report/pdfGenerator';
import { saveAuditRun, uploadPDF, markEmailSent } from './database/supabaseClient';
import { Resend } from 'resend';
import { config } from './config/environment';

export interface PipelineInput {
  url: string;
  prospectEmail?: string;
  prospectName?: string;
  prospectCompany?: string;
  sendEmail?: boolean;
}

export interface PipelineResult {
  auditId: string;
  productUrl: string;
  funnelScore: number;
  overallRisk: string;
  pdfPath: string;
  pdfUrl?: string;
  dbId?: string;
  emailSent: boolean;
  emailSubject: string;
  emailBody: string;
  costUsd: number;
}

export async function runPipeline(input: PipelineInput): Promise<PipelineResult> {
  const startTime = Date.now();
  console.log(chalk.blue(`\n🚀 GatekeeperOps Pipeline`));
  console.log(chalk.white(`URL: ${input.url}`));
  if (input.prospectEmail) console.log(chalk.white(`Prospect: ${input.prospectEmail}`));

  // ─── Step 1: Funnel Audit ────────────────────────────────────────────────
  console.log(chalk.yellow('\n[1/5] Running funnel audit...'));
  const funnelAgent = new FunnelAgent();
  let funnelResult;
  try {
    funnelResult = await funnelAgent.runFunnelAudit(input.url);
    console.log(chalk.green(`  ✅ Score: ${funnelResult.funnelScore}/100 | Pages: ${funnelResult.pages.length} | Stack: ${funnelResult.techStack.raw.join(', ') || 'unknown'}`));
  } finally {
    await funnelAgent.disconnect();
  }

  // ─── Step 2: AI Analysis ─────────────────────────────────────────────────
  console.log(chalk.yellow('\n[2/5] Running AI analysis...'));
  const analyzer = new AIAnalyzer();
  const analysis = await analyzer.analyzeFunnelAudit(funnelResult);
  console.log(chalk.green(`  ✅ Risk: ${analysis.analysis.overallRisk} | Cost: $${analysis.costUsd.toFixed(4)}`));
  console.log(chalk.white(`  Subject: ${analysis.analysis.emailSubjectLine}`));

  // ─── Step 3: PDF Generation ──────────────────────────────────────────────
  console.log(chalk.yellow('\n[3/5] Generating PDF report...'));
  const pdfGenerator = new PDFGenerator();
  let pdfPath = '';
  try {
    pdfPath = await pdfGenerator.generateFunnelReport(funnelResult, analysis);
    console.log(chalk.green(`  ✅ PDF: ${pdfPath}`));
  } finally {
    await pdfGenerator.close();
  }

  // ─── Step 4: Save to Supabase ────────────────────────────────────────────
  console.log(chalk.yellow('\n[4/5] Saving to database...'));
  let pdfUrl: string | undefined;
  let dbId: string | undefined;

  try {
    pdfUrl = await uploadPDF(pdfPath, funnelResult.auditId) || undefined;
    console.log(chalk.green(`  ✅ PDF uploaded: ${pdfUrl || 'failed'}`));

    dbId = await saveAuditRun(
      funnelResult,
      analysis,
      pdfUrl,
      input.prospectEmail,
      input.prospectName,
      input.prospectCompany
    ) || undefined;
    console.log(chalk.green(`  ✅ DB record: ${dbId || 'failed'}`));
  } catch (error) {
    console.log(chalk.yellow(`  ⚠️  DB save failed: ${error instanceof Error ? error.message : 'unknown'}`));
  }

  // ─── Step 5: Send Email ──────────────────────────────────────────────────
  let emailSent = false;
  if (input.sendEmail && input.prospectEmail) {
    console.log(chalk.yellow('\n[5/5] Sending cold email...'));
    try {
      const resend = new Resend(config.resend.apiKey);

      const emailHtml = buildEmailHTML(
        analysis.analysis.emailBody,
        analysis.analysis.emailSubjectLine,
        funnelResult.productName,
        pdfUrl
      );

      await resend.emails.send({
        from: config.resend.fromEmail,
        to: input.prospectEmail,
        subject: analysis.analysis.emailSubjectLine,
        html: emailHtml,
        text: analysis.analysis.emailBody,
      });

      emailSent = true;
      if (dbId) await markEmailSent(dbId);
      console.log(chalk.green(`  ✅ Email sent to ${input.prospectEmail}`));
    } catch (error) {
      console.log(chalk.yellow(`  ⚠️  Email failed: ${error instanceof Error ? error.message : 'unknown'}`));
    }
  } else {
    console.log(chalk.gray('\n[5/5] Email skipped (no prospect email or sendEmail=false)'));
  }

  // ─── Save local JSON fallback ────────────────────────────────────────────
  const outputDir = config.reportOutputDir;
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const reportPath = path.join(outputDir, `pipeline-${funnelResult.auditId}.json`);
  fs.writeFileSync(reportPath, JSON.stringify({ funnelResult, analysis, pdfPath, pdfUrl, dbId, emailSent }, null, 2));

  const totalSeconds = Math.round((Date.now() - startTime) / 1000);
  console.log(chalk.green(`\n✅ Pipeline complete in ${totalSeconds}s`));
  console.log(chalk.white(`   Funnel score:  ${funnelResult.funnelScore}/100`));
  console.log(chalk.white(`   Risk level:    ${analysis.analysis.overallRisk}`));
  console.log(chalk.white(`   PDF:           ${pdfPath}`));
  console.log(chalk.white(`   DB record:     ${dbId || 'not saved'}`));
  console.log(chalk.white(`   Email sent:    ${emailSent}`));
  console.log(chalk.white(`   Total cost:    $${analysis.costUsd.toFixed(4)}`));

  return {
    auditId: funnelResult.auditId,
    productUrl: funnelResult.productUrl,
    funnelScore: funnelResult.funnelScore,
    overallRisk: analysis.analysis.overallRisk,
    pdfPath,
    pdfUrl,
    dbId,
    emailSent,
    emailSubject: analysis.analysis.emailSubjectLine,
    emailBody: analysis.analysis.emailBody,
    costUsd: analysis.costUsd,
  };
}

function buildEmailHTML(
  body: string,
  subject: string,
  productName: string,
  pdfUrl?: string
): string {
  const lines = body.split('\n');
  let firstLine = '';
  let restLines: string[] = [];
  let firstFound = false;

  for (const line of lines) {
    if (!firstFound && line.trim() !== '') {
      firstLine = line.trim();
      firstFound = true;
    } else {
      restLines.push(line);
    }
  }

  const restHtml = restLines.map(line => {
    if (line.startsWith('•') || line.startsWith('-')) {
      return `<li style="margin-bottom:8px;color:#111827;font-size:15px;line-height:1.6">${line.replace(/^[•-]\s*/, '')}</li>`;
    }
    if (line.trim() === '') return '<br>';
    return `<p style="margin:0 0 14px;color:#111827;line-height:1.7;font-size:15px">${line}</p>`;
  }).join('\n');

  const pdfSection = pdfUrl ? `
    <div style="margin:28px 0;text-align:left">
      <a href="${pdfUrl}" 
         style="display:inline-block;background:#111827;color:#ffffff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:700;font-size:14px;letter-spacing:0.3px">
        View Full Audit Report →
      </a>
    </div>
  ` : '';

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;max-width:580px;margin:0 auto;padding:32px 24px;background:#ffffff">
  
  <!-- Header -->
  <div style="margin-bottom:28px;padding-bottom:16px;border-bottom:2px solid #111827">
    <span style="font-size:11px;font-weight:800;color:#111827;letter-spacing:3px;text-transform:uppercase">GatekeeperOps.ai</span>
  </div>

  <!-- Hook line -->
  <p style="font-size:18px;font-weight:700;color:#111827;margin:0 0 20px;line-height:1.4">${firstLine}</p>

  <!-- Body -->
  <div style="font-size:15px;line-height:1.7;color:#111827">
    ${restHtml}
  </div>

  <!-- PDF CTA -->
  ${pdfSection}

  <!-- Calendly CTA -->
  <div style="margin:28px 0;padding:20px;background:#f8fafc;border-left:4px solid #111827;border-radius:4px">
    <p style="margin:0 0 12px;font-size:15px;font-weight:700;color:#111827">Book a free 30-minute call</p>
    <p style="margin:0 0 14px;font-size:14px;color:#374151;line-height:1.6">I'll walk you through the full audit findings and show you exactly what a QA system built for your stack would look like.</p>
    <a href="https://calendly.com/pardha-gatekeeperops/30min" 
       style="display:inline-block;background:#c9a84c;color:#111827;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:700;font-size:14px">
      Book a Call →
    </a>
  </div>

  <!-- Footer -->
  <div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:13px;color:#6b7280">
    <strong style="color:#111827;font-size:14px">Pardha</strong><br>
    GatekeeperOps.ai - AI-Native QA for SaaS teams<br>
    <span style="color:#111827">gatekeeperops.ai</span>
  </div>

</body>
</html>`;
}
// CLI entry point
if (require.main === module) {
    const args = process.argv.slice(2);
    const url = args[0];
  
    if (!url) {
      console.error('Usage: npx tsx src/pipeline.ts <url> [email] [name] [company]');
      process.exit(1);
    }
  
    runPipeline({
      url,
      prospectEmail: args[1],
      prospectName: args[2],
      prospectCompany: args[3],
      sendEmail: !!args[1],
    }).catch(error => {
      console.error('Pipeline failed:', error);
      process.exit(1);
    });
  }