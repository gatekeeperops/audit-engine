import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { FlowCrawlerGeneric } from './flowCrawlerGeneric';
import { AIAnalyzer } from '../analysis/aiAnalyzer';

async function main() {
  const args = process.argv.slice(2);

  const crawlConfig = {
    loginUrl: args[0] || 'https://trello.com/login',
    dashboardUrl: args[1] || 'https://trello.com/u/pardhasaradhi14/boards',
    productName: args[2] || 'Trello',
    credentials: {
      email: 'pardha.t94@gmail.com',
      password: process.env.TEST_PASSWORD || '',
    },
    maxFlows: parseInt(args[3] || '15'),
  };

  console.log(chalk.blue(`\n🔍 GatekeeperOps Generic Flow Crawler`));
  console.log(chalk.white(`Product:   ${crawlConfig.productName}`));
  console.log(chalk.white(`Login URL: ${crawlConfig.loginUrl}`));
  console.log(chalk.white(`Dashboard: ${crawlConfig.dashboardUrl}`));
  console.log(chalk.white(`Max Flows: ${crawlConfig.maxFlows}\n`));

  const crawler = new FlowCrawlerGeneric();

  try {
    await crawler.launch();
    const result = await crawler.run(crawlConfig);

    // Save crawl report
    const outputDir = './reports';
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    const reportPath = path.join(outputDir, `generic-crawl-${Date.now()}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(result, null, 2));

    // Print crawl summary
    console.log(chalk.green(`\n✅ Crawl Complete`));
    console.log(chalk.white(`Overall Score:     ${result.overallScore}/100`));
    console.log(chalk.white(`Pass Rate:         ${result.passRate}%`));
    console.log(chalk.white(`Flows Executed:    ${result.flowsExecuted.length}`));
    console.log(chalk.white(`Critical Failures: ${result.criticalFailures}`));
    console.log(chalk.white(`Login Method:      ${result.loginMethod}`));
    console.log(chalk.white(`Report saved:      ${reportPath}\n`));

    result.flowsExecuted.forEach(r => {
      const icon = r.status === 'PASS' ? '✅' : r.status === 'PARTIAL' ? '⚠️' : '❌';
      const failInfo = r.failedStep ? ` → failed at: "${r.failedStep}"` : '';
      console.log(`${icon} [${r.flow.criticality.toUpperCase()}] ${r.flow.name}: ${r.stepsCompleted}/${r.totalSteps} steps${failInfo}`);
    });

    // AI Analysis
    console.log(chalk.yellow('\n🧠 Running AI analysis...'));
    const analyzer = new AIAnalyzer();
    const analysis = await analyzer.analyzeFlowResults(result);

    console.log(chalk.green('\n=== AI ANALYSIS ==='));
    console.log(chalk.white(`\nExecutive Summary:\n${analysis.analysis.executiveSummary}`));
    console.log(chalk.white(`\nOverall Risk: ${analysis.analysis.overallRisk.toUpperCase()}`));
    console.log(chalk.white(`\nRevenue Impact: ${analysis.analysis.estimatedRevenueImpact}`));
    console.log(chalk.white(`\nPriority Action: ${analysis.analysis.priorityAction}`));
    console.log(chalk.yellow(`\nEmail Subject: ${analysis.analysis.emailSubjectLine}`));
    console.log(chalk.yellow(`Email Opening: ${analysis.analysis.emailOpeningLine}`));

    const analysisPath = path.join(outputDir, `flow-analysis-${Date.now()}.json`);
    fs.writeFileSync(analysisPath, JSON.stringify(analysis, null, 2));
    console.log(chalk.white(`\nAnalysis saved: ${analysisPath}`));

  } finally {
    await crawler.close();
  }
}

main().catch(error => {
  console.error(chalk.red('Fatal error:'), error);
  process.exit(1);
});