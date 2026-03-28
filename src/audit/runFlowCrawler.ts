import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { FlowCrawler } from './flowCrawler';

async function main() {
  const targetUrl = process.argv[2] || 'https://trello.com/u/pardhasaradhi14/boards';
  const productName = process.argv[3] || 'Trello';

  console.log(chalk.blue(`\n🔍 GatekeeperOps Flow Crawler`));
  console.log(chalk.white(`Target: ${targetUrl}`));
  console.log(chalk.white(`Product: ${productName}\n`));

  const crawler = new FlowCrawler();

  try {
    await crawler.launch();

    const sessionExists = fs.existsSync('./reports/session/state.json');
    if (!sessionExists) {
      console.log(chalk.yellow('\n👉 No session found. Please log in to Trello in the browser.'));
      console.log(chalk.yellow('   Complete OTP if required. Press ENTER here when fully logged in.'));
      await new Promise(resolve => process.stdin.once('data', resolve));
      await crawler.saveSession();
      console.log(chalk.green('Session saved. Future runs will skip login.'));
    }

    // Discover flows
    console.log(chalk.yellow('📡 Discovering flows...'));
    const flows = await crawler.crawlAndDiscover(targetUrl, {
      email: 'your-email@gmail.com',
    });

    // Execute top flows
    console.log(chalk.yellow('\n🤖 Executing flows...'));
    const results = [];
    for (const flow of flows.slice(0, 5)) {
      const result = await crawler.executeFlow(flow);
      results.push(result);
    }

    // Build result
    const crawlResult = crawler.buildCrawlResult(targetUrl, productName, flows, results);

    // Save report
    const outputDir = './reports';
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    const reportPath = path.join(outputDir, `flow-crawl-${Date.now()}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(crawlResult, null, 2));

    // Print summary
    console.log(chalk.green(`\n✅ Crawl Complete`));
    console.log(chalk.white(`Overall Score:     ${crawlResult.overallScore}/100`));
    console.log(chalk.white(`Flows Executed:    ${results.length}`));
    console.log(chalk.white(`Critical Failures: ${crawlResult.criticalFailures}`));
    console.log(chalk.white(`Report saved:      ${reportPath}`));

    results.forEach(r => {
      const icon = r.status === 'PASS' ? '✅' : r.status === 'PARTIAL' ? '⚠️' : '❌';
      console.log(`${icon} ${r.flow.name}: ${r.stepsCompleted}/${r.totalSteps} steps (${r.durationMs}ms)`);
    });

  } finally {
    await crawler.close();
  }
}

main().catch(console.error);