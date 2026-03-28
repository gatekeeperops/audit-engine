import { chromium, Browser } from 'playwright-core';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config/environment';
import { FunnelAuditResult } from '../audit/funnelAgent';
import { AnalysisResult } from '../analysis/aiAnalyzer';

export interface PDFGeneratorOptions {
  outputDir?: string;
}

export class PDFGenerator {
  private browser: Browser | null = null;

  async launch(): Promise<void> {
    this.browser = await chromium.launch({ headless: true });
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  async generateFunnelReport(
    funnelResult: FunnelAuditResult,
    analysis: AnalysisResult,
    options: PDFGeneratorOptions = {}
  ): Promise<string> {
    if (!this.browser) await this.launch();

    const outputDir = options.outputDir || config.reportOutputDir;
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const outputPath = path.join(outputDir, `report-${funnelResult.auditId}.pdf`);
    const html = this.buildHTML(funnelResult, analysis);

    const context = await this.browser!.newContext();
    const page = await context.newPage();

    await page.setContent(html, { waitUntil: 'networkidle' });
    await page.pdf({
      path: outputPath,
      format: 'A4',
      margin: { top: '20mm', bottom: '20mm', left: '20mm', right: '20mm' },
      printBackground: true,
    });

    await context.close();
    return outputPath;
  }

  private buildHTML(funnelResult: FunnelAuditResult, analysis: AnalysisResult): string {
    const date = new Date(funnelResult.timestamp).toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
    });

    const riskColor = {
      critical: '#dc2626',
      high: '#ea580c',
      medium: '#d97706',
      low: '#16a34a',
    }[analysis.analysis.overallRisk] || '#6b7280';

    const lcpStatus = (lcp: number) => {
      if (lcp > 4000) return { color: '#dc2626', label: 'Poor' };
      if (lcp > 2500) return { color: '#d97706', label: 'Needs Improvement' };
      return { color: '#16a34a', label: 'Good' };
    };

    const severityColor = (s: string) => ({
      critical: '#dc2626',
      high: '#ea580c',
      medium: '#d97706',
      low: '#16a34a',
    }[s] || '#6b7280');

    const pagesHTML = funnelResult.pages.map(p => {
      const lcp = p.lcp ? lcpStatus(p.lcp) : null;
      return `
        <tr>
          <td style="padding:8px 12px;font-weight:600;color:#1e293b">${p.pageName}</td>
          <td style="padding:8px 12px;color:#64748b;font-size:12px">${p.url}</td>
          <td style="padding:8px 12px;text-align:center">
          ${lcp ? `<span style="color:${lcp.color};font-weight:600">${Math.round(p.lcp!)}ms</span><br><span style="font-size:10px;color:${lcp.color}">${lcp.label}</span>` : '<span style="color:#94a3b8;font-size:11px">Not measured</span>'}
          </td>
          <td style="padding:8px 12px;text-align:center">
            ${p.performanceScore !== undefined && p.performanceScore > 0 ? `<span style="font-weight:600;color:${p.performanceScore >= 70 ? '#16a34a' : p.performanceScore >= 50 ? '#d97706' : '#dc2626'}">${p.performanceScore}/100</span>` : '<span style="color:#94a3b8;font-size:11px">Not measured</span>'}
          </td>
          <td style="padding:8px 12px;text-align:center">
            ${p.accessibilityViolations > 0
          ? `<span style="color:#dc2626;font-weight:600">${p.accessibilityViolations}</span>`
          : '<span style="color:#16a34a">✓</span>'}
          </td>
          <td style="padding:8px 12px;text-align:center">
            ${p.consoleErrors.length > 0 || p.networkFailures.length > 0
          ? `<span style="color:#dc2626;font-weight:600">${p.consoleErrors.length + p.networkFailures.length}</span>`
          : '<span style="color:#16a34a">✓</span>'}
          </td>
        </tr>`;
    }).join('');

    const findingsHTML = analysis.analysis.findings.slice(0, 5).map((f, i) => `
      <div style="margin-bottom:16px;padding:16px;border-left:4px solid ${severityColor(f.severity)};background:#f8fafc;border-radius:0 8px 8px 0">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <span style="background:${severityColor(f.severity)};color:white;font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;text-transform:uppercase">${f.severity}</span>
          <span style="font-weight:600;color:#1e293b;font-size:14px">${f.title}</span>
        </div>
        <p style="margin:0 0 8px;color:#475569;font-size:13px">${f.description}</p>
        <p style="margin:0 0 6px;color:#64748b;font-size:12px"><strong>Impact:</strong> ${f.businessImpact}</p>
        <p style="margin:0;color:#64748b;font-size:12px"><strong>Fix:</strong> ${f.recommendation}</p>
      </div>
    `).join('');

    const pipelineHTML = analysis.analysis.quickWins.map(w => `
      <div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:8px">
        <span style="color:#2563eb;font-size:16px;line-height:1.4">→</span>
        <span style="color:#475569;font-size:13px">${w}</span>
      </div>
    `).join('');

    const qaSystemHTML = funnelResult.suggestedQAPipeline.slice(0, 6).map(item => {
      const priorityColor = item.priority === 'critical' ? '#dc2626' : item.priority === 'high' ? '#ea580c' : '#2563eb';
      return `
        <div style="padding:12px;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:8px">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
            <span style="background:${priorityColor};color:white;font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;text-transform:uppercase">${item.priority}</span>
            <span style="font-weight:600;color:#1e293b;font-size:13px">${item.tool}</span>
          </div>
          <p style="margin:0 0 4px;color:#64748b;font-size:12px">${item.purpose}</p>
          <p style="margin:0;color:#94a3b8;font-size:11px;font-style:italic">${item.reason}</p>
        </div>
      `;
    }).join('');

    const techStackHTML = Object.entries({
      Frontend: funnelResult.techStack.frontend,
      Analytics: funnelResult.techStack.analytics,
      Payments: funnelResult.techStack.payments,
      Support: funnelResult.techStack.support,
      Hosting: funnelResult.techStack.hosting,
      Monitoring: funnelResult.techStack.monitoring,
    }).filter(([, v]) => v.length > 0).map(([category, tools]) => `
      <div style="margin-bottom:8px">
        <span style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase">${category}</span>
        <div style="margin-top:4px;display:flex;flex-wrap:wrap;gap:4px">
          ${tools.map(t => `<span style="background:#f1f5f9;color:#475569;font-size:11px;padding:2px 8px;border-radius:4px;border:1px solid #e2e8f0">${t}</span>`).join('')}
        </div>
      </div>
    `).join('');

   const competitorHTML = funnelResult.competitors.filter(c => c.signupLcp !== undefined && c.signupLcp > 0).length > 0 ? `
      <div style="margin-top:24px">
        <h3 style="font-size:14px;font-weight:700;color:#1e293b;margin:0 0 12px">Competitor Benchmark</h3>
       ${funnelResult.competitors.filter(c => c.signupLcp !== undefined && c.signupLcp > 0).map(c => `
          <div style="padding:12px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;margin-bottom:8px">
            <div style="font-weight:600;color:#1e293b;margin-bottom:8px">${c.name}</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px;color:#64748b">
              <div>Signup LCP: <strong>${c.signupLcp ? Math.round(c.signupLcp) + 'ms' : 'N/A'}</strong></div>
              <div>Performance: <strong>${c.signupPerformanceScore ?? 'N/A'}/100</strong></div>
              <div>Monitoring: <strong>${c.hasMonitoring ? '✅ Yes' : '❌ No'}</strong></div>
              <div>Support Chat: <strong>${c.hasSupport ? '✅ Yes' : '❌ No'}</strong></div>
            </div>
            ${c.techStack.length > 0 ? `<div style="margin-top:8px;font-size:11px;color:#94a3b8">Stack: ${c.techStack.slice(0, 5).join(', ')}</div>` : ''}
          </div>
        `).join('')}
        ${funnelResult.competitorBenchmark ? `
          <div style="padding:12px;background:#fef3c7;border-radius:8px;border:1px solid #fbbf24">
            <span style="font-size:13px;font-weight:600;color:#92400e">Performance Gap: ${funnelResult.competitorBenchmark.performanceGap}</span>
          </div>
        ` : ''}
      </div>
    ` : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GatekeeperOps QA Audit — ${funnelResult.productName}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1e293b; background: white; font-size: 14px; line-height: 1.6; }
    .page-break { page-break-after: always; }
  </style>
</head>
<body>

  <!-- HEADER -->
  <div style="background:#0f172a;padding:32px 40px;margin-bottom:0">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <div>
        <div style="color:#94a3b8;font-size:11px;font-weight:600;letter-spacing:2px;text-transform:uppercase;margin-bottom:4px">GatekeeperOps.ai</div>
        <div style="color:white;font-size:22px;font-weight:700">QA Funnel Audit Report</div>
        <div style="color:#64748b;font-size:13px;margin-top:4px">${funnelResult.productName} · ${date}</div>
      </div>
      <div style="text-align:right">
        <div style="background:${riskColor};color:white;font-size:11px;font-weight:700;padding:4px 12px;border-radius:20px;text-transform:uppercase;letter-spacing:1px">${analysis.analysis.overallRisk} risk</div>
        <div style="color:#94a3b8;font-size:12px;margin-top:8px">Score: <span style="color:white;font-weight:700">${funnelResult.funnelScore}/100</span></div>
      </div>
    </div>
  </div>

  <!-- EXECUTIVE SUMMARY -->
  <div style="padding:28px 40px;background:#f8fafc;border-bottom:1px solid #e2e8f0">
    <h2 style="font-size:13px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">Executive Summary</h2>
    <p style="color:#334155;font-size:14px;line-height:1.7">${analysis.analysis.executiveSummary}</p>
    <div style="margin-top:16px;padding:12px 16px;background:white;border-radius:8px;border-left:4px solid ${riskColor}">
      <span style="font-size:12px;font-weight:600;color:#64748b">Priority Action: </span>
      <span style="font-size:13px;color:#1e293b">${analysis.analysis.priorityAction}</span>
    </div>
  </div>

  <!-- METRICS ROW -->
  <div style="padding:24px 40px;display:grid;grid-template-columns:repeat(4,1fr);gap:16px;border-bottom:1px solid #e2e8f0">
    <div style="text-align:center;padding:16px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0">
      <div style="font-size:28px;font-weight:800;color:${funnelResult.funnelScore >= 70 ? '#16a34a' : funnelResult.funnelScore >= 50 ? '#d97706' : '#dc2626'}">${funnelResult.funnelScore}</div>
      <div style="font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:1px">Funnel Score</div>
    </div>
    <div style="text-align:center;padding:16px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0">
      <div style="font-size:28px;font-weight:800;color:#dc2626">${funnelResult.criticalIssues}</div>
      <div style="font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:1px">Issues Found</div>
    </div>
    <div style="text-align:center;padding:16px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0">
      <div style="font-size:28px;font-weight:800;color:${funnelResult.performanceSummary.avgLcp > 2500 ? '#dc2626' : '#16a34a'}">${Math.round(funnelResult.performanceSummary.avgLcp / 1000)}s</div>
      <div style="font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:1px">Avg LCP</div>
    </div>
    <div style="text-align:center;padding:16px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0">
      <div style="font-size:28px;font-weight:800;color:#2563eb">${funnelResult.pages.length}</div>
      <div style="font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:1px">Pages Audited</div>
    </div>
  </div>

  <!-- PAGE PERFORMANCE TABLE -->
  <div style="padding:28px 40px;border-bottom:1px solid #e2e8f0">
    <h2 style="font-size:13px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-bottom:16px">Funnel Page Analysis</h2>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead>
        <tr style="background:#f1f5f9">
          <th style="padding:10px 12px;text-align:left;font-weight:600;color:#64748b;font-size:11px;text-transform:uppercase">Page</th>
          <th style="padding:10px 12px;text-align:left;font-weight:600;color:#64748b;font-size:11px;text-transform:uppercase">URL</th>
          <th style="padding:10px 12px;text-align:center;font-weight:600;color:#64748b;font-size:11px;text-transform:uppercase">LCP</th>
          <th style="padding:10px 12px;text-align:center;font-weight:600;color:#64748b;font-size:11px;text-transform:uppercase">Perf Score</th>
          <th style="padding:10px 12px;text-align:center;font-weight:600;color:#64748b;font-size:11px;text-transform:uppercase">A11y</th>
          <th style="padding:10px 12px;text-align:center;font-weight:600;color:#64748b;font-size:11px;text-transform:uppercase">Errors</th>
        </tr>
      </thead>
      <tbody>
        ${pagesHTML}
      </tbody>
    </table>
    <div style="margin-top:10px;font-size:11px;color:#94a3b8">LCP threshold: Good &lt;2.5s · Needs Improvement 2.5-4s · Poor &gt;4s (Google Core Web Vitals)</div>
  </div>

  <!-- FINDINGS -->
  <div style="padding:28px 40px;border-bottom:1px solid #e2e8f0" class="page-break">
    <h2 style="font-size:13px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-bottom:16px">Findings (${analysis.analysis.findings.length})</h2>
    ${findingsHTML}
  </div>

  <!-- TECH STACK + COMPETITOR -->
  <div style="padding:28px 40px;border-bottom:1px solid #e2e8f0">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:32px">
      <div>
        <h2 style="font-size:13px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-bottom:16px">Tech Stack Detected</h2>
        ${techStackHTML || '<p style="color:#94a3b8;font-size:13px">Nothing detected</p>'}
      </div>
      <div>
        ${competitorHTML}
      </div>
    </div>
  </div>

  <!-- QA PIPELINE -->
  <div style="padding:28px 40px;border-bottom:1px solid #e2e8f0">
    <h2 style="font-size:13px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">Suggested QA System</h2>
    <p style="color:#64748b;font-size:13px;margin-bottom:16px">Based on your tech stack, here's what we recommend building once you share staging access:</p>
    ${qaSystemHTML}
    <div style="margin-top:16px;padding:16px;background:#eff6ff;border-radius:8px;border:1px solid #bfdbfe">
      <p style="font-size:13px;color:#1d4ed8;font-weight:600;margin-bottom:4px">What we can build for you</p>
      <p style="font-size:12px;color:#3730a3">End-to-end QA system with functional + non-functional tests, full CI/CD integration, daily automated runs, and Slack alerts. Requires staging environment access and auth credentials.</p>
    </div>
  </div>

  <!-- QUICK WINS -->
  <div style="padding:28px 40px;border-bottom:1px solid #e2e8f0">
    <h2 style="font-size:13px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-bottom:16px">Quick Wins</h2>
    ${pipelineHTML}
  </div>

  <!-- COLD EMAIL PREVIEW -->
  <div style="padding:28px 40px;border-bottom:1px solid #e2e8f0">
   <h2 style="font-size:13px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-bottom:16px">Cold Email Draft</h2>
    <div style="background:#f8fafc;border-radius:8px;padding:20px;border:1px solid #e2e8f0;white-space:pre-line;font-size:13px;color:#334155;line-height:1.8">${analysis.analysis.emailBody}</div>
  </div>

  <!-- FOOTER -->
  <div style="padding:24px 40px;background:#0f172a">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <div>
        <div style="color:white;font-weight:700;font-size:14px">GatekeeperOps.ai</div>
        <div style="color:#64748b;font-size:12px;margin-top:2px">Continuous QA for SaaS teams</div>
      </div>
      <div style="text-align:right;color:#64748b;font-size:11px">
        <div>Audit ID: ${funnelResult.auditId}</div>
        <div style="margin-top:2px">${date}</div>
      </div>
    </div>
  </div>

</body>
</html>`;
  }
}