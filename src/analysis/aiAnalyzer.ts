import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { config } from '../config/environment';
import { AuditResult } from '../audit/types';
import { CrawlResult } from '../audit/flowCrawlerGeneric';
import { FunnelAuditResult } from '../audit/funnelAgent';

// ─── Schemas ──────────────────────────────────────────────────────────────────

const FindingSchema = z.object({
  title: z.string(),
  severity: z.enum(['critical', 'high', 'medium', 'low']),
  category: z.enum(['performance', 'accessibility', 'reliability', 'security', 'ux']),
  description: z.string(),
  businessImpact: z.string(),
  affectedUsers: z.string(),
  recommendation: z.string(),
});

const AnalysisOutputSchema = z.object({
  executiveSummary: z.string(),
  overallRisk: z.enum(['critical', 'high', 'medium', 'low']),
  findings: z.array(FindingSchema),
  quickWins: z.array(z.string()),
  estimatedRevenueImpact: z.string(),
  priorityAction: z.string(),
  emailSubjectLine: z.string(),
  emailOpeningLine: z.string(),
  emailBody: z.string(),
});

export type Finding = z.infer<typeof FindingSchema>;
export type AnalysisOutput = z.infer<typeof AnalysisOutputSchema>;

export interface AnalysisResult {
  auditId: string;
  productUrl: string;
  analysis: AnalysisOutput;
  tokensUsed: number;
  costUsd: number;
  model: string;
  timestamp: string;
}

// ─── Tool schema (reused across all analysis methods) ────────────────────────

const ANALYSIS_TOOL = {
  name: 'generate_audit_analysis',
  description: 'Generate a realistic, honest, business-focused QA audit analysis and cold email',
  input_schema: {
    type: 'object' as const,
    properties: {
      executiveSummary: {
        type: 'string',
        description: '2-3 sentences summarising what was found. Factual, no hype, no invented numbers.',
      },
      overallRisk: {
        type: 'string',
        enum: ['critical', 'high', 'medium', 'low'],
        description: 'Overall risk level based on findings',
      },
      findings: {
        type: 'array',
        description: 'Specific issues found, ordered by severity. Only report what was actually measured.',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
            category: { type: 'string', enum: ['performance', 'accessibility', 'reliability', 'security', 'ux'] },
            description: { type: 'string', description: 'What was found, with exact numbers from the audit' },
            businessImpact: {
              type: 'string',
              description: 'Industry benchmark context only. Never invent dollar amounts. Use percentages and research citations.',
            },
            affectedUsers: { type: 'string' },
            recommendation: { type: 'string' },
          },
          required: ['title', 'severity', 'category', 'description', 'businessImpact', 'affectedUsers', 'recommendation'],
        },
      },
      quickWins: {
        type: 'array',
        items: { type: 'string' },
        description: '3-4 specific fixes that can be done quickly. Reference their actual tech stack.',
      },
      estimatedRevenueImpact: {
        type: 'string',
        description: 'Use industry benchmark percentages only. Never invent dollar figures. E.g. "Google data: 53% of mobile users abandon pages >3s"',
      },
      priorityAction: {
        type: 'string',
        description: 'The single most important thing to fix first. Be specific.',
      },
      emailSubjectLine: {
        type: 'string',
        description: 'Cold email subject. Lowercase, specific, no hype words. E.g. "noticed a few things on [product] signup page"',
      },
      emailOpeningLine: {
        type: 'string',
        description: 'First line only. One specific fact from the audit. No intro, no pleasantries.',
      },
      emailBody: {
        type: 'string',
        description: `Complete cold email body. Plain text. Honest tone. Structure:
1. What I found (2-3 specific facts with actual numbers from the audit)
2. Industry context (benchmark percentages only, no invented dollars)
3. Their tech stack observation + QA pipeline suggestion with specific tools
4. What I can build for them (mention this clearly):
   - End-to-end QA system once they share staging access and auth credentials
   - Functional tests (critical user flows, regression suite)
   - Non-functional tests (performance, accessibility, load)
   - Full CI/CD pipeline integration (GitHub Actions or their existing pipeline)
   - Daily/weekly automated runs with Slack alerts
5. Soft CTA: "worth a quick call?" — never pushy

Keep it under 220 words. Sound like a real engineer who does real work.
Make the staging access ask feel natural — not demanding, just the logical next step.`,
      },
    },
    required: [
      'executiveSummary', 'overallRisk', 'findings', 'quickWins',
      'estimatedRevenueImpact', 'priorityAction', 'emailSubjectLine',
      'emailOpeningLine', 'emailBody',
    ],
  },
};

// ─── Analyzer class ───────────────────────────────────────────────────────────

export class AIAnalyzer {
  private client: Anthropic;

  constructor() {
    const baseURL = config.anthropic.heliconeApiKey
      ? 'https://anthropic.helicone.ai'
      : undefined;

    this.client = new Anthropic({
      apiKey: config.anthropic.apiKey,
      baseURL,
      defaultHeaders: config.anthropic.heliconeApiKey
        ? { 'Helicone-Auth': `Bearer ${config.anthropic.heliconeApiKey}` }
        : undefined,
    });
  }

  // ─── Funnel audit analysis ────────────────────────────────────────────────

  async analyzeFunnelAudit(funnelResult: FunnelAuditResult): Promise<AnalysisResult> {
    const summary = this.buildFunnelSummary(funnelResult);

    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      tools: [ANALYSIS_TOOL],
      tool_choice: { type: 'tool', name: 'generate_audit_analysis' },
      messages: [
        {
          role: 'user',
          content: `You are a senior QA engineer who just audited a SaaS product's public funnel.
You are writing a cold email to the founder.

Your tone: direct, honest, helpful — like a real engineer, not a salesperson.
Your goal: show genuine value, not close a deal.

STRICT RULES:
- Never invent dollar amounts or revenue figures
- Only use industry benchmark percentages (e.g. "Google data: 53% abandon pages >3s")
- Only report what was actually measured in the audit data below
- The QA pipeline suggestion must reference their actual detected tech stack
- Email subject must be lowercase, specific, zero hype words
- Email body must be under 200 words
- End with "worth a quick call?" not "BOOK NOW" or "ACT FAST"
- Sound like a real engineer who did real work, not a marketing email

The email should make the founder think:
"This person actually looked at my product and found real things."

AUDIT DATA:
${summary}`,
        },
      ],
    });

    return this.extractResult(response, funnelResult.auditId, funnelResult.productUrl);
  }

  // ─── Single page audit analysis ──────────────────────────────────────────

  async analyze(auditResult: AuditResult): Promise<AnalysisResult> {
    const summary = this.buildAuditSummary(auditResult);

    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      tools: [ANALYSIS_TOOL],
      tool_choice: { type: 'tool', name: 'generate_audit_analysis' },
      messages: [
        {
          role: 'user',
          content: `You are a senior QA engineer who just audited a SaaS product.
You are writing a cold email to the founder.

Your tone: direct, honest, helpful — like a real engineer, not a salesperson.

STRICT RULES:
- Never invent dollar amounts or revenue figures
- Only use industry benchmark percentages
- Only report what was actually measured
- Email subject must be lowercase, specific, zero hype
- Email body under 200 words
- Sound like a real engineer who did real work

AUDIT DATA:
${summary}`,
        },
      ],
    });

    return this.extractResult(response, auditResult.auditId, auditResult.productUrl);
  }

  // ─── Flow results analysis ────────────────────────────────────────────────

  async analyzeFlowResults(crawlResult: CrawlResult): Promise<AnalysisResult> {
    const summary = this.buildFlowSummary(crawlResult);

    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      tools: [ANALYSIS_TOOL],
      tool_choice: { type: 'tool', name: 'generate_audit_analysis' },
      messages: [
        {
          role: 'user',
          content: `You are a senior QA engineer who just ran automated flow tests on a SaaS product.
You are writing a cold email to the founder.

Your tone: direct, honest, helpful — like a real engineer, not a salesperson.

STRICT RULES:
- Never invent dollar amounts or revenue figures
- Only use industry benchmark percentages
- Only report what was actually measured
- Email subject must be lowercase, specific, zero hype
- Email body under 200 words
- Sound like a real engineer who did real work

FLOW TEST DATA:
${summary}`,
        },
      ],
    });

    return this.extractResult(response, `flow-${Date.now()}`, crawlResult.targetUrl);
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private extractResult(
    response: Anthropic.Message,
    auditId: string,
    productUrl: string
  ): AnalysisResult {
    const toolUseBlock = response.content.find(block => block.type === 'tool_use');
    if (!toolUseBlock || toolUseBlock.type !== 'tool_use') {
      throw new Error('Claude did not return tool use block');
    }

    const parsed = AnalysisOutputSchema.safeParse(toolUseBlock.input);
    if (!parsed.success) {
      throw new Error(`Schema validation failed: ${parsed.error.message}`);
    }

    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;
    const costUsd = (inputTokens * 3 + outputTokens * 15) / 1_000_000;

    return {
      auditId,
      productUrl,
      analysis: parsed.data,
      tokensUsed: inputTokens + outputTokens,
      costUsd,
      model: response.model,
      timestamp: new Date().toISOString(),
    };
  }

  private buildFunnelSummary(result: FunnelAuditResult): string {
    const pageDetails = result.pages.map(p => {
      const perf = p.lcp
        ? `LCP: ${Math.round(p.lcp)}ms, Score: ${p.performanceScore ?? 'N/A'}/100, CLS: ${p.cls?.toFixed(3) ?? 'N/A'}`
        : 'Performance: not measured';
      const errors = p.consoleErrors.length > 0
        ? `\n    Real JS errors (${p.consoleErrors.length}): ${p.consoleErrors.slice(0, 2).join(' | ')}`
        : '';
      const netFails = p.networkFailures.length > 0
        ? `\n    Real network failures (${p.networkFailures.length}): ${p.networkFailures.slice(0, 2).map(f => `${f.status || 'FAIL'} ${f.url.slice(0, 60)}`).join(' | ')}`
        : '';
      const a11y = p.accessibilityViolations > 0
        ? `\n    Accessibility: ${p.accessibilityViolations} violations (${p.accessibilityDetails.slice(0, 2).map(a => `${a.impact}: ${a.id}`).join(', ')})`
        : '';
      return `  ${p.pageName} (${p.url}):
    ${perf}${errors}${netFails}${a11y}`;
    }).join('\n');

    const competitorSection = result.competitors.length > 0
      ? `\nCompetitor Benchmarks:
${result.competitors.map(c =>
        `  ${c.name}: Signup LCP ${c.signupLcp ? Math.round(c.signupLcp) + 'ms' : 'N/A'}, Perf ${c.signupPerformanceScore ?? 'N/A'}/100, Tech: ${c.techStack.slice(0, 4).join(', ')}`
      ).join('\n')}`
      : '';

    const pipelineSection = result.suggestedQAPipeline.length > 0
      ? `\nSuggested QA Pipeline (based on their stack):
${result.suggestedQAPipeline.map(s => `  [${s.priority.toUpperCase()}] ${s.tool}: ${s.purpose}`).join('\n')}`
      : '';

    return `
Product: ${result.productName}
URL: ${result.productUrl}
Funnel Score: ${result.funnelScore}/100
Pages Audited: ${result.pages.length}
Critical Issues: ${result.criticalIssues}
Duration: ${Math.round(result.totalDurationMs / 1000)}s

Tech Stack Detected: ${result.techStack.raw.join(', ') || 'not detected'}
Frontend: ${result.techStack.frontend.join(', ') || 'unknown'}
Payments: ${result.techStack.payments.join(', ') || 'none detected'}
Analytics: ${result.techStack.analytics.join(', ') || 'none detected'}
Support: ${result.techStack.support.join(', ') || 'none detected'}
Monitoring: ${result.techStack.monitoring.join(', ') || 'none detected — no error tracking found'}

Performance Summary:
  Average LCP: ${result.performanceSummary.avgLcp}ms (Google threshold: 2500ms)
  Worst page: ${result.performanceSummary.worstPage} at ${Math.round(result.performanceSummary.worstLcp)}ms
  Pages above threshold: ${result.performanceSummary.belowThresholdCount}/${result.pages.length}
${result.competitorBenchmark ? `  Performance vs competitor: ${result.competitorBenchmark.performanceGap}` : ''}

Pages Detail:
${pageDetails}
${competitorSection}
${pipelineSection}
    `.trim();
  }

  private buildFlowSummary(crawlResult: CrawlResult): string {
    const passed = crawlResult.flowsExecuted.filter(r => r.status === 'PASS');
    const failed = crawlResult.flowsExecuted.filter(r => r.status === 'FAIL');
    const partial = crawlResult.flowsExecuted.filter(r => r.status === 'PARTIAL');

    const flowDetails = crawlResult.flowsExecuted.map(r => {
      const status = r.status === 'PASS' ? '✅ PASS' : r.status === 'FAIL' ? '❌ FAIL' : '⚠️ PARTIAL';
      const failInfo = r.failedStep ? `\n    Failed at: "${r.failedStep}"` : '';
      const errorInfo = r.errorMessage ? `\n    Error: ${r.errorMessage}` : '';
      return `  ${status} [${r.flow.criticality.toUpperCase()}] ${r.flow.name} (${r.stepsCompleted}/${r.totalSteps} steps)${failInfo}${errorInfo}`;
    }).join('\n');

    return `
Product: ${crawlResult.productName}
URL: ${crawlResult.targetUrl}
Overall Score: ${crawlResult.overallScore}/100
Pass Rate: ${crawlResult.passRate}%
Critical Failures: ${crawlResult.criticalFailures}

Summary:
  Total flows tested: ${crawlResult.flowsExecuted.length}
  Passed: ${passed.length}
  Failed: ${failed.length}
  Partial: ${partial.length}

Flow Results:
${flowDetails}
    `.trim();
  }

  private buildAuditSummary(audit: AuditResult): string {
    const failedChecks = audit.checks.filter(c => c.status === 'FAIL');
    const warningChecks = audit.checks.filter(c => c.status === 'WARNING');

    const accessibilityViolations = audit.accessibility.violations
      .map(v => `  - ${v.id} (${v.impact}): ${v.description} — ${v.nodes} element(s) affected`)
      .join('\n');

    const performanceInfo = audit.performance.source !== 'unavailable'
      ? `
Performance (${audit.performance.source}):
  Score: ${audit.performance.performanceScore}/100
  LCP: ${audit.performance.lcp ? Math.round(audit.performance.lcp) + 'ms' : 'N/A'} (threshold: 2500ms)
  CLS: ${audit.performance.cls ?? 'N/A'} (threshold: 0.1)
  TTI: ${audit.performance.tti ? Math.round(audit.performance.tti) + 'ms' : 'N/A'}
  FCP: ${audit.performance.fcp ? Math.round(audit.performance.fcp) + 'ms' : 'N/A'}
  TBT: ${audit.performance.tbt ? Math.round(audit.performance.tbt) + 'ms' : 'N/A'}`
      : 'Performance: data unavailable';

    return `
Product: ${audit.productName}
URL: ${audit.productUrl}
Audit Score: ${audit.overallScore}/100
Status: ${audit.status}

Checks:
  Passed: ${audit.summary.passed}
  Failed: ${audit.summary.failed}
  Warnings: ${audit.summary.warnings}

Failed Checks:
${failedChecks.length > 0 ? failedChecks.map(c => `  - ${c.check}: ${c.errorMessage}`).join('\n') : '  None'}

Warning Checks:
${warningChecks.length > 0 ? warningChecks.map(c => `  - ${c.check}: ${c.value}`).join('\n') : '  None'}

${performanceInfo}

Accessibility:
  Score: ${audit.accessibility.score ?? 'N/A'}/100
  Violations: ${audit.accessibility.violations.length}
  Passes: ${audit.accessibility.passes}
${accessibilityViolations ? `\nViolation Details:\n${accessibilityViolations}` : ''}
    `.trim();
  }
}