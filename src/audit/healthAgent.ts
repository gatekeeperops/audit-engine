import { chromium, Browser, BrowserContext, Page } from 'playwright-core';
import AxeBuilder from '@axe-core/playwright';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config/environment';
import {
    AuditResult,
    AuditStatus,
    CheckResult,
    CheckStatus,
    PerformanceMetrics,
    AccessibilityResult,
    Screenshots,
    AuditConfig,
    defaultAuditConfig,
    ProspectInput,
} from './types';

export class HealthAgent {
    private browser: Browser | null = null;
    private auditConfig: AuditConfig;

    constructor(auditConfig: Partial<AuditConfig> = {}) {
        this.auditConfig = { ...defaultAuditConfig, ...auditConfig };
    }

    // async connect(): Promise<void> {
    //     const wsUrl = `wss://connect.browserbase.com?apiKey=${config.browserbase.apiKey}&projectId=${config.browserbase.projectId}`;
    //     this.browser = await chromium.connectOverCDP(wsUrl);
    //     console.log('Connected to Browserbase');
    // }

    async connect(): Promise<void> {
        if (process.env.LOCAL_MODE === 'true') {
            this.browser = await chromium.launch({ headless: false, slowMo: 500 });
            console.log('Running in local headed mode');
        } else {
            const wsUrl = `wss://connect.browserbase.com?apiKey=${config.browserbase.apiKey}&projectId=${config.browserbase.projectId}`;
            this.browser = await chromium.connectOverCDP(wsUrl);
            console.log('Connected to Browserbase');
        }
    }

    async disconnect(): Promise<void> {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
        }
    }

    async runAudit(prospect: ProspectInput): Promise<AuditResult> {
        if (!this.browser) {
            await this.connect();
        }

        const auditId = uuidv4();
        const startTime = Date.now();
        const checks: CheckResult[] = [];
        const screenshotPaths: string[] = [];

        let context: BrowserContext | null = null;
        let page: Page | null = null;

        try {
            // Check robots.txt first
            const robotsCheck = await this.checkRobotsTxt(prospect.url);
            checks.push(robotsCheck);
            if (robotsCheck.status === 'FAIL') {
                return this.buildResult(auditId, prospect, startTime, checks, [], {
                    lcp: undefined, cls: undefined, tti: undefined,
                    fcp: undefined, tbt: undefined, source: 'unavailable'
                }, { score: 0, violations: [], passes: 0, incomplete: 0 },
                    { desktop: '', mobile: '', failures: [] });
            }

            // context = await this.browser!.newContext({
            //     viewport: { width: 1280, height: 720 },
            //     userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            // });
            const isLocal = process.env.LOCAL_MODE === 'true';
            context = await this.browser!.newContext({
                viewport: { width: 1280, height: 720 },
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                ...(isLocal && {
                    recordVideo: {
                        dir: './reports/videos/',
                        size: { width: 1280, height: 720 }
                    }
                }),
            });

            page = await context.newPage();

            // Core checks
            checks.push(await this.checkPageLoad(page, prospect.url));
            checks.push(await this.checkSSL(prospect.url));
            checks.push(await this.checkConsoleErrors(page));
            checks.push(await this.checkCoreElements(page));
            checks.push(await this.checkResponseTime(prospect.url));

            // Desktop screenshot
            const desktopScreenshot = await this.takeScreenshot(page, auditId, 'desktop');

            // Mobile check
            await context.close();
            context = await this.browser!.newContext({
                viewport: { width: 375, height: 812 },
                userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)',
            });
            page = await context.newPage();
            await page.goto(prospect.url, { waitUntil: 'networkidle', timeout: this.auditConfig.timeout });
            checks.push(await this.checkMobileLayout(page));
            const mobileScreenshot = await this.takeScreenshot(page, auditId, 'mobile');

            // Accessibility
            const accessibility = await this.runAccessibilityCheck(page);

            // Performance
            const performance = await this.getPerformanceMetrics(prospect.url);

            const screenshots: Screenshots = {
                desktop: desktopScreenshot,
                mobile: mobileScreenshot,
                failures: screenshotPaths,
            };

            return this.buildResult(auditId, prospect, startTime, checks, [], performance, accessibility, screenshots);

        } catch (error) {
            checks.push({
                check: 'audit_execution',
                status: 'FAIL',
                errorMessage: error instanceof Error ? error.message : 'Unknown error',
            });
            return this.buildResult(auditId, prospect, startTime, checks, [], {
                source: 'unavailable'
            }, { score: 0, violations: [], passes: 0, incomplete: 0 },
                { desktop: '', mobile: '', failures: [] });
        } finally {
            if (context) await context.close();
        }
    }

    private async checkRobotsTxt(url: string): Promise<CheckResult> {
        const start = Date.now();
        try {
            const robotsUrl = new URL('/robots.txt', url).toString();
            const response = await fetch(robotsUrl, { signal: AbortSignal.timeout(5000) });
            const text = await response.text();
            const lines = text.split('\n').map(l => l.trim().toLowerCase());
            let currentAgent = '';
            let isBlocked = false;
            for (const line of lines) {
                if (line.startsWith('user-agent:')) {
                    currentAgent = line.split(':')[1].trim();
                }
                if ((currentAgent === '*') && line === 'disallow: /') {
                    isBlocked = true;
                    break;
                }
            }
            return {
                check: 'robots_txt',
                status: isBlocked ? 'FAIL' : 'PASS',
                value: isBlocked ? 'blocked' : 'allowed',
                durationMs: Date.now() - start,
                errorMessage: isBlocked ? 'robots.txt disallows crawling' : undefined,
            };
        } catch {
            return { check: 'robots_txt', status: 'PASS', value: 'no_robots_file', durationMs: Date.now() - start };
        }
    }

    private async checkPageLoad(page: Page, url: string): Promise<CheckResult> {
        const start = Date.now();
        try {
            const response = await page.goto(url, { waitUntil: 'networkidle', timeout: this.auditConfig.timeout });
            const status = response?.status() ?? 0;
            const duration = Date.now() - start;
            return {
                check: 'page_load',
                status: status >= 200 && status < 400 ? 'PASS' : 'FAIL',
                value: status,
                durationMs: duration,
                errorMessage: status >= 400 ? `HTTP ${status}` : undefined,
            };
        } catch (error) {
            return {
                check: 'page_load',
                status: 'FAIL',
                durationMs: Date.now() - start,
                errorMessage: error instanceof Error ? error.message : 'Page load failed',
            };
        }
    }

    private async checkSSL(url: string): Promise<CheckResult> {
        const isHttps = url.startsWith('https://');
        return {
            check: 'ssl_certificate',
            status: isHttps ? 'PASS' : 'FAIL',
            value: isHttps ? 'https' : 'http',
            errorMessage: isHttps ? undefined : 'Site does not use HTTPS',
        };
    }

    private async checkConsoleErrors(page: Page): Promise<CheckResult> {
        const errors: string[] = [];
        page.on('console', msg => {
            if (msg.type() === 'error') errors.push(msg.text());
        });
        await page.waitForTimeout(2000);
        return {
            check: 'console_errors',
            status: errors.length === 0 ? 'PASS' : errors.length <= 3 ? 'WARNING' : 'FAIL',
            value: errors.length,
            errorMessage: errors.length > 0 ? errors.slice(0, 3).join('; ') : undefined,
        };
    }

    private async checkCoreElements(page: Page): Promise<CheckResult> {
        try {
            const hasNav = await page.locator('nav, header, [role="navigation"]').count() > 0;
            const hasMain = await page.locator('main, [role="main"], #main, .main').count() > 0;
            const hasTitle = (await page.title()).length > 0;
            const allPresent = hasNav && hasMain && hasTitle;
            return {
                check: 'core_elements',
                status: allPresent ? 'PASS' : 'WARNING',
                value: { hasNav, hasMain, hasTitle },
                errorMessage: !allPresent ? 'Missing core page elements' : undefined,
            };
        } catch (error) {
            return { check: 'core_elements', status: 'WARNING', errorMessage: 'Could not verify core elements' };
        }
    }

    private async checkResponseTime(url: string): Promise<CheckResult> {
        const start = Date.now();
        try {
            await fetch(url, { signal: AbortSignal.timeout(10000) });
            const duration = Date.now() - start;
            const status: CheckStatus = duration < 1000 ? 'PASS' : duration < 3000 ? 'WARNING' : 'FAIL';
            return {
                check: 'response_time',
                status,
                value: duration,
                threshold: 3000,
                durationMs: duration,
                errorMessage: duration >= 3000 ? `Slow response: ${duration}ms` : undefined,
            };
        } catch (error) {
            return { check: 'response_time', status: 'FAIL', errorMessage: 'Response time check failed' };
        }
    }

    private async checkMobileLayout(page: Page): Promise<CheckResult> {
        try {
            const hasViewportMeta = await page.locator('meta[name="viewport"]').count() > 0;
            const hasHorizontalScroll = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
            const status: CheckStatus = hasViewportMeta && !hasHorizontalScroll ? 'PASS' :
                !hasViewportMeta ? 'FAIL' : 'WARNING';
            return {
                check: 'mobile_layout',
                status,
                value: { hasViewportMeta, hasHorizontalScroll },
                errorMessage: !hasViewportMeta ? 'Missing viewport meta tag' :
                    hasHorizontalScroll ? 'Horizontal scroll detected on mobile' : undefined,
            };
        } catch (error) {
            return { check: 'mobile_layout', status: 'WARNING', errorMessage: 'Mobile check failed' };
        }
    }

    private async runAccessibilityCheck(page: Page): Promise<AccessibilityResult> {
        try {
            const results = await new AxeBuilder({ page }).analyze();
            return {
                score: Math.max(0, 100 - results.violations.length * 10),
                violations: results.violations.slice(0, 10).map(v => ({
                    id: v.id,
                    impact: v.impact ?? 'unknown',
                    description: v.description,
                    nodes: v.nodes.length,
                })),
                passes: results.passes.length,
                incomplete: results.incomplete.length,
            };
        } catch {
            return { score: undefined, violations: [], passes: 0, incomplete: 0 };
        }
    }

    private async getPerformanceMetrics(url: string): Promise<PerformanceMetrics> {
        try {
            const apiKey = config.pagespeed.apiKey;
            if (!apiKey) return { source: 'unavailable' };

            const apiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=mobile&key=${apiKey}`;
            const response = await fetch(apiUrl, { signal: AbortSignal.timeout(30000) });
            const data = await response.json() as any;

            const categories = data.lighthouseResult?.categories;
            const audits = data.lighthouseResult?.audits;

            return {
                performanceScore: Math.round((categories?.performance?.score ?? 0) * 100),
                lcp: audits?.['largest-contentful-paint']?.numericValue,
                cls: audits?.['cumulative-layout-shift']?.numericValue,
                tti: audits?.['interactive']?.numericValue,
                fcp: audits?.['first-contentful-paint']?.numericValue,
                tbt: audits?.['total-blocking-time']?.numericValue,
                source: 'pagespeed',
            };
        } catch {
            return { source: 'unavailable' };
        }
    }

    private async takeScreenshot(page: Page, auditId: string, type: string): Promise<string> {
        try {
            const dir = config.reportOutputDir;
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            const filePath = path.join(dir, `${auditId}-${type}.png`);
            await page.screenshot({ path: filePath, fullPage: false });
            return filePath;
        } catch {
            return '';
        }
    }

    private buildResult(
        auditId: string,
        prospect: ProspectInput,
        startTime: number,
        checks: CheckResult[],
        _unused: unknown[],
        performance: PerformanceMetrics,
        accessibility: AccessibilityResult,
        screenshots: Screenshots
    ): AuditResult {
        const passed = checks.filter(c => c.status === 'PASS').length;
        const failed = checks.filter(c => c.status === 'FAIL').length;
        const warnings = checks.filter(c => c.status === 'WARNING').length;
        const skipped = checks.filter(c => c.status === 'SKIP').length;

        const overallScore = checks.length > 0
            ? Math.round((passed / checks.length) * 100)
            : 0;

        const status: AuditStatus = overallScore >= 80 ? 'HEALTHY' :
            overallScore >= 50 ? 'DEGRADED' : 'CRITICAL';

        return {
            auditId,
            productUrl: prospect.url,
            productName: prospect.productName,
            timestamp: new Date().toISOString(),
            durationMs: Date.now() - startTime,
            status,
            overallScore,
            summary: { totalChecks: checks.length, passed, failed, warnings, skipped },
            checks,
            performance,
            accessibility,
            screenshots,
            metadata: {
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                viewport: { width: 1280, height: 720 },
            },
        };
    }
}