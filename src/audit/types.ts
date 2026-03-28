export type CheckStatus = 'PASS' | 'FAIL' | 'WARNING' | 'SKIP';
export type AuditStatus = 'HEALTHY' | 'DEGRADED' | 'CRITICAL';

export interface CheckResult {
  check: string;
  status: CheckStatus;
  value?: unknown;
  threshold?: unknown;
  errorMessage?: string;
  durationMs?: number;
  screenshot?: string;
}

export interface Screenshots {
  desktop: string;
  mobile: string;
  failures: string[];
}

export interface AuditSummary {
  totalChecks: number;
  passed: number;
  failed: number;
  warnings: number;
  skipped: number;
}

export interface PerformanceMetrics {
  lcp?: number;
  cls?: number;
  tti?: number;
  fcp?: number;
  tbt?: number;
  performanceScore?: number;
  source: 'lighthouse' | 'pagespeed' | 'unavailable';
}

export interface AccessibilityResult {
  score?: number;
  violations: AccessibilityViolation[];
  passes: number;
  incomplete: number;
}

export interface AccessibilityViolation {
  id: string;
  impact: string;
  description: string;
  nodes: number;
}

export interface AuditResult {
  auditId: string;
  productUrl: string;
  productName: string;
  timestamp: string;
  durationMs: number;
  status: AuditStatus;
  overallScore: number;
  summary: AuditSummary;
  checks: CheckResult[];
  performance: PerformanceMetrics;
  accessibility: AccessibilityResult;
  screenshots: Screenshots;
  metadata: {
    userAgent: string;
    viewport: { width: number; height: number };
    browserbaseSessionId?: string;
  };
}

export interface ProspectInput {
  url: string;
  productName: string;
  email?: string;
  name?: string;
  company?: string;
}

export interface AuditConfig {
  timeout: number;
  screenshotOnFailure: boolean;
  checkPerformance: boolean;
  checkAccessibility: boolean;
  checkConsoleErrors: boolean;
  checkBrokenLinks: boolean;
  checkMobileFriendly: boolean;
}

export const defaultAuditConfig: AuditConfig = {
  timeout: 30000,
  screenshotOnFailure: true,
  checkPerformance: true,
  checkAccessibility: true,
  checkConsoleErrors: true,
  checkBrokenLinks: false,
  checkMobileFriendly: true,
};