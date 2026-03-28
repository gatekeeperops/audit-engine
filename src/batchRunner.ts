import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import chalk from 'chalk';
import { runPipeline, PipelineResult } from './pipeline';

// ─── Config ─────────────────────────────────────────────────────────────────

const CONCURRENCY = 1;          // Run 1 at a time — avoid rate limits
const DELAY_BETWEEN_MS = 15000; // 15s between each run
const MAX_PER_RUN = 20;         // Max prospects to process per batch run

// ─── Types ───────────────────────────────────────────────────────────────────

interface ProspectRow {
  url: string;
  email?: string;
  name?: string;
  company?: string;
}

interface BatchResult {
  url: string;
  email: string;
  name: string;
  company: string;
  status: 'success' | 'failed' | 'skipped';
  funnelScore?: number;
  overallRisk?: string;
  emailSent?: boolean;
  auditId?: string;
  pdfUrl?: string;
  costUsd?: number;
  error?: string;
  processedAt: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function loadProcessedUrls(resultsPath: string): Set<string> {
  if (!fs.existsSync(resultsPath)) return new Set();
  const content = fs.readFileSync(resultsPath, 'utf-8');
  const rows = parse(content, { columns: true, skip_empty_lines: true }) as BatchResult[];
  return new Set(
    rows
      .filter(r => r.status === 'success')
      .map(r => r.url.trim().toLowerCase())
  );
}

function appendResult(resultsPath: string, result: BatchResult): void {
  const headerNeeded = !fs.existsSync(resultsPath);
  const line = stringify([result], {
    header: headerNeeded,
    columns: [
      'url', 'email', 'name', 'company', 'status',
      'funnelScore', 'overallRisk', 'emailSent',
      'auditId', 'pdfUrl', 'costUsd', 'error', 'processedAt'
    ]
  });
  fs.appendFileSync(resultsPath, line);
}

// ─── Main Batch Runner ───────────────────────────────────────────────────────

export async function runBatch(
  inputCsvPath: string,
  resultsPath: string,
  options: { sendEmail?: boolean; maxCount?: number } = {}
): Promise<void> {
  const sendEmail = options.sendEmail ?? false;
  const maxCount = options.maxCount ?? MAX_PER_RUN;

  // Load input CSV
  if (!fs.existsSync(inputCsvPath)) {
    console.error(chalk.red(`Input CSV not found: ${inputCsvPath}`));
    process.exit(1);
  }

  const rawContent = fs.readFileSync(inputCsvPath, 'utf-8');
  const prospects = parse(rawContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as ProspectRow[];

  console.log(chalk.blue(`\n📋 GatekeeperOps Batch Runner`));
  console.log(chalk.white(`   Input:      ${inputCsvPath}`));
  console.log(chalk.white(`   Prospects:  ${prospects.length}`));
  console.log(chalk.white(`   Max/run:    ${maxCount}`));
  console.log(chalk.white(`   Send email: ${sendEmail}`));
  console.log(chalk.white(`   Results:    ${resultsPath}\n`));

  // Skip already-processed URLs
  const processedUrls = loadProcessedUrls(resultsPath);
  console.log(chalk.gray(`   Already processed: ${processedUrls.size} URLs (skipping)`));

  const pending = prospects.filter(p => {
    const url = (p.url || '').trim().toLowerCase();
    return url && !processedUrls.has(url);
  }).slice(0, maxCount);

  console.log(chalk.yellow(`   Pending this run: ${pending.length}\n`));

  if (pending.length === 0) {
    console.log(chalk.green('Nothing to process. All prospects already completed.'));
    return;
  }

  // Stats
  let successCount = 0;
  let failCount = 0;
  let totalCost = 0;

  // Process
  for (let i = 0; i < pending.length; i++) {
    const prospect = pending[i];
    const url = prospect.url.trim();
    const email = prospect.email?.trim() || '';
    const name = prospect.name?.trim() || '';
    const company = prospect.company?.trim() || '';

    console.log(chalk.cyan(`\n[${i + 1}/${pending.length}] ${url}`));
    if (email) console.log(chalk.gray(`  Prospect: ${name} <${email}> @ ${company}`));

    let result: BatchResult = {
      url,
      email,
      name,
      company,
      status: 'failed',
      processedAt: new Date().toISOString(),
    };

    try {
      const pipelineResult: PipelineResult = await runPipeline({
        url,
        prospectEmail: email || undefined,
        prospectName: name || undefined,
        prospectCompany: company || undefined,
        sendEmail: sendEmail && !!email,
      });

      result = {
        ...result,
        status: 'success',
        funnelScore: pipelineResult.funnelScore,
        overallRisk: pipelineResult.overallRisk,
        emailSent: pipelineResult.emailSent,
        auditId: pipelineResult.auditId,
        pdfUrl: pipelineResult.pdfUrl,
        costUsd: pipelineResult.costUsd,
      };

      successCount++;
      totalCost += pipelineResult.costUsd;
      console.log(chalk.green(`  ✅ Score: ${pipelineResult.funnelScore}/100 | Risk: ${pipelineResult.overallRisk} | Cost: $${pipelineResult.costUsd.toFixed(4)}`));

    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      result.error = errMsg;
      failCount++;
      console.log(chalk.red(`  ❌ Failed: ${errMsg}`));
    }

    appendResult(resultsPath, result);

    // Delay between prospects (skip after last)
    if (i < pending.length - 1) {
      console.log(chalk.gray(`  Waiting ${DELAY_BETWEEN_MS / 1000}s before next...`));
      await sleep(DELAY_BETWEEN_MS);
    }
  }

  // Summary
  console.log(chalk.blue(`\n═══════════════════════════════════`));
  console.log(chalk.green(`✅ Batch complete`));
  console.log(chalk.white(`   Processed:  ${pending.length}`));
  console.log(chalk.white(`   Success:     ${successCount}`));
  console.log(chalk.white(`   Failed:      ${failCount}`));
  console.log(chalk.white(`   Total cost:  $${totalCost.toFixed(4)}`));
  console.log(chalk.white(`   Results:     ${resultsPath}`));
  console.log(chalk.blue(`═══════════════════════════════════\n`));
}

// ─── CLI Entry Point ─────────────────────────────────────────────────────────

if (require.main === module) {
  const args = process.argv.slice(2);
  const inputCsv = args[0];
  const sendEmail = args.includes('--send-email');
  const maxCount = parseInt(args.find(a => a.startsWith('--max='))?.split('=')[1] || String(MAX_PER_RUN));

  if (!inputCsv) {
    console.error('Usage: npx tsx src/batchRunner.ts <input.csv> [--send-email] [--max=20]');
    console.error('');
    console.error('CSV format (columns): url, email, name, company');
    console.error('Example row: https://loom.com,cto@loom.com,Joe Smith,Loom');
    process.exit(1);
  }

  const resultsPath = path.join(
    'reports',
    `batch-results-${new Date().toISOString().split('T')[0]}.csv`
  );

  if (!fs.existsSync('reports')) fs.mkdirSync('reports', { recursive: true });

  runBatch(inputCsv, resultsPath, { sendEmail, maxCount }).catch(error => {
    console.error('Batch runner failed:', error);
    process.exit(1);
  });
}