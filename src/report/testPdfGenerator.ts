import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { PDFGenerator } from './pdfGenerator';
import { FunnelAuditResult } from '../audit/funnelAgent';
import { AnalysisResult } from '../analysis/aiAnalyzer';

async function main() {
  // Find latest funnel report + analysis
  const reportsDir = './reports';
  const files = fs.readdirSync(reportsDir);

  const funnelFile = files
    .filter(f => f.startsWith('funnel-') && !f.includes('analysis') && f.endsWith('.json'))
    .map(f => ({ name: f, time: fs.statSync(path.join(reportsDir, f)).mtime.getTime() }))
    .sort((a, b) => b.time - a.time)[0];

  const analysisFile = files
    .filter(f => f.startsWith('funnel-analysis-') && f.endsWith('.json'))
    .map(f => ({ name: f, time: fs.statSync(path.join(reportsDir, f)).mtime.getTime() }))
    .sort((a, b) => b.time - a.time)[0];

  if (!funnelFile || !analysisFile) {
    console.error('No funnel report or analysis found. Run npm run funnel first.');
    process.exit(1);
  }

  console.log(chalk.blue(`\nGenerating PDF from:`));
  console.log(chalk.white(`  Funnel: ${funnelFile.name}`));
  console.log(chalk.white(`  Analysis: ${analysisFile.name}`));

  const funnelResult: FunnelAuditResult = JSON.parse(
    fs.readFileSync(path.join(reportsDir, funnelFile.name), 'utf-8')
  );
  const analysisResult: AnalysisResult = JSON.parse(
    fs.readFileSync(path.join(reportsDir, analysisFile.name), 'utf-8')
  );

  const generator = new PDFGenerator();
  try {
    const pdfPath = await generator.generateFunnelReport(funnelResult, analysisResult);
    console.log(chalk.green(`\n✅ PDF generated: ${pdfPath}`));
  } finally {
    await generator.close();
  }
}

main().catch(console.error);