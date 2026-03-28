import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import Papa from 'papaparse';
import { HealthAgent } from './audit/healthAgent';
import { ProspectInput } from './audit/types';
import { config } from './config/environment';

const args = process.argv.slice(2);
const command = args[0];

async function runSingleAudit(url: string, productName?: string): Promise<void> {
  const agent = new HealthAgent();
  try {
    console.log(chalk.blue(`\n🔍 Starting audit for: ${url}`));
    const prospect: ProspectInput = {
      url,
      productName: productName || new URL(url).hostname,
    };

    const result = await agent.runAudit(prospect);

    const outputDir = config.reportOutputDir;
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    const reportPath = path.join(outputDir, `${result.auditId}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(result, null, 2));

    console.log(chalk.green(`\n✅ Audit complete`));
    console.log(chalk.white(`Status:        ${result.status}`));
    console.log(chalk.white(`Score:         ${result.overallScore}/100`));
    console.log(chalk.white(`Checks:        ${result.summary.passed} passed, ${result.summary.failed} failed, ${result.summary.warnings} warnings`));
    console.log(chalk.white(`Duration:      ${result.durationMs}ms`));
    console.log(chalk.white(`Report saved:  ${reportPath}`));

    if (result.summary.failed > 0) {
      console.log(chalk.red('\n❌ Failed checks:'));
      result.checks
        .filter(c => c.status === 'FAIL')
        .forEach(c => console.log(chalk.red(`  - ${c.check}: ${c.errorMessage}`)));
    }

    if (result.summary.warnings > 0) {
      console.log(chalk.yellow('\n⚠️  Warnings:'));
      result.checks
        .filter(c => c.status === 'WARNING')
        .forEach(c => console.log(chalk.yellow(`  - ${c.check}: ${c.errorMessage || c.value}`)));
    }

  } finally {
    await agent.disconnect();
  }
}

async function runBatchAudit(csvPath: string): Promise<void> {
  if (!fs.existsSync(csvPath)) {
    console.error(chalk.red(`CSV file not found: ${csvPath}`));
    process.exit(1);
  }

  const fileContent = fs.readFileSync(csvPath, 'utf-8');
  const parsed = Papa.parse<ProspectInput>(fileContent, {
    header: true,
    skipEmptyLines: true,
  });

  const prospects = parsed.data;
  console.log(chalk.blue(`\n📋 Batch audit: ${prospects.length} prospects`));

  const agent = new HealthAgent();
  try {
    for (let i = 0; i < prospects.length; i++) {
      const prospect = prospects[i];
      console.log(chalk.blue(`\n[${i + 1}/${prospects.length}] Auditing: ${prospect.url}`));
      try {
        const result = await agent.runAudit(prospect);
        const reportPath = path.join(config.reportOutputDir, `${result.auditId}.json`);
        if (!fs.existsSync(config.reportOutputDir)) {
          fs.mkdirSync(config.reportOutputDir, { recursive: true });
        }
        fs.writeFileSync(reportPath, JSON.stringify(result, null, 2));
        console.log(chalk.green(`  ✅ Score: ${result.overallScore}/100 — ${reportPath}`));
      } catch (error) {
        console.error(chalk.red(`  ❌ Failed: ${error instanceof Error ? error.message : 'Unknown error'}`));
      }

      if (i < prospects.length - 1) {
        console.log(chalk.gray(`  ⏳ Waiting 3 minutes before next audit...`));
        await new Promise(resolve => setTimeout(resolve, 3 * 60 * 1000));
      }
    }
  } finally {
    await agent.disconnect();
  }

  console.log(chalk.green(`\n✅ Batch complete`));
}

async function main(): Promise<void> {
  if (command === 'audit') {
    const url = args[1];
    if (!url) {
      console.error(chalk.red('Usage: npm run audit <url>'));
      process.exit(1);
    }
    await runSingleAudit(url, args[2]);

  } else if (command === 'batch') {
    const csvPath = args[1] || './prospects/prospects.csv';
    await runBatchAudit(csvPath);

  } else if (command === 'pipeline') {
    const url = args[1];
    if (!url) {
      console.error(chalk.red('Usage: npm run audit pipeline <url> [email] [name] [company]'));
      process.exit(1);
    }
    const { runPipeline } = await import('./pipeline');
    await runPipeline({
      url,
      prospectEmail: args[2],
      prospectName: args[3],
      prospectCompany: args[4],
      sendEmail: !!args[2],
    });

  } else {
    console.log(chalk.white(`
GatekeeperOps — Continuous production QA for SaaS teams

Usage:
  npm run audit <url>              Run single page audit
  npm run audit <url> <name>       Run audit with product name
  npm run batch                    Run batch audit from prospects/prospects.csv
  npm run batch <csv-path>         Run batch audit from custom CSV
  npm run funnel <url>             Run full funnel audit + AI analysis
  npm run pdf                      Generate PDF from latest funnel report
  npm run crawl                    Run flow crawler on Trello

Pipeline (full end-to-end):
  npx tsx src/pipeline.ts <url>
  npx tsx src/pipeline.ts <url> <email> <name> <company>

Examples:
  npm run audit https://linear.app
  npm run funnel https://cal.com
  npx tsx src/pipeline.ts https://cal.com founder@cal.com "Cal Team" "Cal.com"
    `));
  }
}

main().catch(error => {
  console.error(chalk.red('Fatal error:'), error);
  process.exit(1);
});