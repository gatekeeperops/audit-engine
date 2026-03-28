import * as fs from 'fs';
import * as path from 'path';
import { AIAnalyzer } from './aiAnalyzer';
import { AuditResult } from '../audit/types';

async function main() {
  // Find the most recent audit report
  const reportsDir = './reports';
  const files = fs.readdirSync(reportsDir)
    .filter(f => f.endsWith('.json'))
    .map(f => ({
      name: f,
      time: fs.statSync(path.join(reportsDir, f)).mtime.getTime()
    }))
    .sort((a, b) => b.time - a.time);

  if (files.length === 0) {
    console.error('No audit reports found. Run npm run audit first.');
    process.exit(1);
  }

  const latestReport = files[0].name;
  console.log(`Analyzing: ${latestReport}`);

  const auditResult: AuditResult = JSON.parse(
    fs.readFileSync(path.join(reportsDir, latestReport), 'utf-8')
  );

  const analyzer = new AIAnalyzer();
  const result = await analyzer.analyze(auditResult);

  console.log('\n=== AI ANALYSIS ===\n');
  console.log('Executive Summary:', result.analysis.executiveSummary);
  console.log('Overall Risk:', result.analysis.overallRisk);
  console.log('Findings:', result.analysis.findings.length);
  result.analysis.findings.forEach(f => {
    console.log(`\n  [${f.severity.toUpperCase()}] ${f.title}`);
    console.log(`  Business Impact: ${f.businessImpact}`);
    console.log(`  Affected Users: ${f.affectedUsers}`);
  });
  console.log('\nQuick Wins:');
  result.analysis.quickWins.forEach(w => console.log(`  - ${w}`));
  console.log('\nRevenue Impact:', result.analysis.estimatedRevenueImpact);
  console.log('\nEmail Subject:', result.analysis.emailSubjectLine);
  console.log('Email Opening:', result.analysis.emailOpeningLine);
  console.log(`\nTokens used: ${result.tokensUsed}`);
  console.log(`Cost: $${result.costUsd.toFixed(4)}`);

  // Save analysis
  const outputPath = path.join(reportsDir, `analysis-${result.auditId}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
  console.log(`\nAnalysis saved: ${outputPath}`);
}

main().catch(console.error);