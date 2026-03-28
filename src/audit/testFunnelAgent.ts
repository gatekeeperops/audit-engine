import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { FunnelAgent } from './funnelAgent';
import { AIAnalyzer } from '../analysis/aiAnalyzer';


async function main() {
  const url = process.argv[2] || 'https://cal.com';
  console.log(chalk.blue(`\n🔍 GatekeeperOps Funnel Audit: ${url}\n`));

  const agent = new FunnelAgent();
  try {
    const result = await agent.runFunnelAudit(url);

    // ─── Summary ──────────────────────────────────────────────
    console.log(chalk.green(`\n✅ Funnel Score: ${result.funnelScore}/100`));
    console.log(chalk.white(`Pages audited:   ${result.pages.length}`));
    console.log(chalk.white(`Critical issues: ${result.criticalIssues}`));
    console.log(chalk.white(`Duration:        ${Math.round(result.totalDurationMs / 1000)}s`));

    // ─── Tech Stack ───────────────────────────────────────────
    console.log(chalk.yellow(`\n📦 Tech Stack Detected:`));
    if (result.techStack.frontend.length) console.log(chalk.white(`  Frontend:   ${result.techStack.frontend.join(', ')}`));
    if (result.techStack.payments.length) console.log(chalk.white(`  Payments:   ${result.techStack.payments.join(', ')}`));
    if (result.techStack.analytics.length) console.log(chalk.white(`  Analytics:  ${result.techStack.analytics.join(', ')}`));
    if (result.techStack.support.length) console.log(chalk.white(`  Support:    ${result.techStack.support.join(', ')}`));
    if (result.techStack.hosting.length) console.log(chalk.white(`  Hosting:    ${result.techStack.hosting.join(', ')}`));
    if (result.techStack.monitoring.length) console.log(chalk.white(`  Monitoring: ${result.techStack.monitoring.join(', ')}`));
    if (result.techStack.testing.length) console.log(chalk.white(`  Testing:    ${result.techStack.testing.join(', ')}`));
    if (result.techStack.raw.length === 0) console.log(chalk.gray(`  Nothing detected`));

    // ─── Pages ────────────────────────────────────────────────
    console.log(chalk.yellow(`\n📄 Pages Audited:`));
    result.pages.forEach(p => {
      const statusIcon = p.httpStatus >= 400 ? '❌' : '✅';
      const lcpIcon = p.lcp
        ? (p.lcp > 4000 ? '🔴' : p.lcp > 2500 ? '🟡' : '🟢')
        : '⚪';

      console.log(`\n  ${statusIcon} ${p.pageName}: ${p.url}`);

      if (p.lcp) {
        console.log(chalk.white(`    ${lcpIcon} LCP: ${Math.round(p.lcp)}ms | Perf: ${p.performanceScore ?? 'N/A'}/100 | CLS: ${p.cls?.toFixed(3) ?? 'N/A'} | FCP: ${p.fcp ? Math.round(p.fcp) + 'ms' : 'N/A'}`));
      }

      if (p.accessibilityViolations > 0) {
        console.log(chalk.yellow(`    ⚠️  Accessibility: ${p.accessibilityViolations} violations`));
        p.accessibilityDetails.forEach(a =>
          console.log(chalk.yellow(`      → [${a.impact.toUpperCase()}] ${a.id}: ${a.description.slice(0, 80)}`))
        );
      }

      if (p.consoleErrors.length > 0) {
        console.log(chalk.red(`    ❌ Real JS Errors (${p.consoleErrors.length}):`));
        p.consoleErrors.forEach(e => console.log(chalk.red(`      → ${e.slice(0, 120)}`)));
      }

      if (p.networkFailures.length > 0) {
        console.log(chalk.red(`    ❌ Real Network Failures (${p.networkFailures.length}):`));
        p.networkFailures.forEach(f =>
          console.log(chalk.red(`      → [${f.status || 'FAILED'}] ${f.method} ${f.url.slice(0, 100)}`))
        );
      }

      const noiseCount = p.ignoredConsoleErrors.length + p.ignoredNetworkFailures.length;
      if (noiseCount > 0) {
        console.log(chalk.gray(`    Filtered noise: ${p.ignoredConsoleErrors.length} console + ${p.ignoredNetworkFailures.length} network (3rd party/analytics)`));
      }

      console.log(chalk.gray(`    Load: ${p.loadTimeMs}ms | HTTP: ${p.httpStatus}`));
    });

    // ─── Performance Summary ──────────────────────────────────
    console.log(chalk.yellow(`\n⚡ Performance Summary:`));
    console.log(chalk.white(`  Average LCP:           ${result.performanceSummary.avgLcp}ms`));
    console.log(chalk.white(`  Worst page:            ${result.performanceSummary.worstPage} (${Math.round(result.performanceSummary.worstLcp)}ms)`));
    console.log(chalk.white(`  Pages above 2.5s:      ${result.performanceSummary.belowThresholdCount}/${result.pages.length}`));

    // ─── Competitor Benchmark ─────────────────────────────────
    if (result.competitors.length > 0) {
      console.log(chalk.yellow(`\n🏆 Competitor Audits:`));
      result.competitors.forEach(c => {
        const lcpIcon = c.signupLcp
          ? (c.signupLcp > 4000 ? '🔴' : c.signupLcp > 2500 ? '🟡' : '🟢')
          : '⚪';
        console.log(chalk.white(`\n  ${c.name} (${c.url})`));
        console.log(chalk.white(`    ${lcpIcon} Signup LCP: ${c.signupLcp ? Math.round(c.signupLcp) + 'ms' : 'N/A'} | Perf: ${c.signupPerformanceScore ?? 'N/A'}/100`));
        console.log(chalk.white(`    Tech: ${c.techStack.slice(0, 6).join(', ') || 'unknown'}`));
        console.log(chalk.white(`    Monitoring: ${c.hasMonitoring ? '✅' : '❌'} | Support Chat: ${c.hasSupport ? '✅' : '❌'}`));
      });

      if (result.competitorBenchmark) {
        console.log(chalk.yellow(`\n📊 Performance Gap:`));
        console.log(chalk.white(`  Your avg LCP:       ${result.competitorBenchmark.ourAvgLcp}ms`));
        console.log(chalk.white(`  Competitor avg LCP: ${result.competitorBenchmark.competitorAvgLcp}ms`));
        console.log(chalk.red(`  Gap:                ${result.competitorBenchmark.performanceGap}`));
      }
    }

    // ─── QA Pipeline ─────────────────────────────────────────
    console.log(chalk.yellow(`\n🛠️  Suggested QA Pipeline:`));
    result.suggestedQAPipeline.forEach(item => {
      const icon = item.priority === 'critical' ? '🔴' : item.priority === 'high' ? '🟡' : '🔵';
      console.log(chalk.white(`\n  ${icon} [${item.priority.toUpperCase()}] ${item.tool}`));
      console.log(chalk.gray(`     Purpose: ${item.purpose}`));
      console.log(chalk.gray(`     Why now: ${item.reason}`));
    });

    // ─── Save Report ──────────────────────────────────────────
    const outputDir = './reports';
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    const reportPath = path.join(outputDir, `funnel-${result.auditId}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(result, null, 2));
    console.log(chalk.white(`\n💾 Report saved: ${reportPath}`));

    // ─── AI Analysis ─────────────────────────────────────────
    console.log(chalk.yellow('\n🧠 Running AI analysis...'));
    const analyzer = new AIAnalyzer();
    const analysis = await analyzer.analyzeFunnelAudit(result);

    console.log(chalk.green('\n=== AI ANALYSIS ==='));
    console.log(chalk.white(`\nExecutive Summary:\n${analysis.analysis.executiveSummary}`));
    console.log(chalk.white(`\nOverall Risk: ${analysis.analysis.overallRisk.toUpperCase()}`));
    console.log(chalk.white(`\nRevenue Impact: ${analysis.analysis.estimatedRevenueImpact}`));
    console.log(chalk.white(`\nPriority Action: ${analysis.analysis.priorityAction}`));
    console.log(chalk.yellow(`\n📧 Email Subject: ${analysis.analysis.emailSubjectLine}`));
    console.log(chalk.yellow(`📧 Email Opening: ${analysis.analysis.emailOpeningLine}`));
    console.log(chalk.white(`\nCost: $${analysis.costUsd.toFixed(4)}`));

    const analysisPath = path.join(outputDir, `funnel-analysis-${result.auditId}.json`);
    fs.writeFileSync(analysisPath, JSON.stringify(analysis, null, 2));
    console.log(chalk.white(`💾 Analysis saved: ${analysisPath}`));

  } finally {
    await agent.disconnect();
  }
}

main().catch(console.error);