import { chromium, Browser, BrowserContext } from 'playwright-core';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config/environment';

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface NetworkFailure {
    url: string;
    method: string;
    status?: number;
    errorText?: string;
    type: 'failed' | 'error_status';
}

export interface PageAuditResult {
    url: string;
    pageName: string;
    loadTimeMs: number;
    httpStatus: number;
    consoleErrors: string[];
    ignoredConsoleErrors: string[];
    networkFailures: NetworkFailure[];
    ignoredNetworkFailures: NetworkFailure[];
    screenshotPath: string;
    performanceScore?: number;
    lcp?: number;
    cls?: number;
    fcp?: number;
    tbt?: number;
    accessible: boolean;
    accessibilityViolations: number;
    accessibilityDetails: { id: string; impact: string; description: string; nodes: number }[];
}

export interface TechStack {
    frontend: string[];
    analytics: string[];
    payments: string[];
    support: string[];
    hosting: string[];
    monitoring: string[];
    testing: string[];
    raw: string[];
}

export interface CompetitorAudit {
    name: string;
    url: string;
    signupUrl: string;
    signupLcp?: number;
    signupPerformanceScore?: number;
    techStack: string[];
    hasMonitoring: boolean;
    hasSupport: boolean;
}

export interface QAPipelineItem {
    tool: string;
    purpose: string;
    priority: 'critical' | 'high' | 'medium';
    reason: string;
}

export interface FunnelAuditResult {
    auditId: string;
    productUrl: string;
    productName: string;
    timestamp: string;
    totalDurationMs: number;
    techStack: TechStack;
    competitors: CompetitorAudit[];
    pages: PageAuditResult[];
    funnelScore: number;
    criticalIssues: number;
    suggestedQAPipeline: QAPipelineItem[];
    performanceSummary: {
        avgLcp: number;
        worstPage: string;
        worstLcp: number;
        belowThresholdCount: number;
    };
    competitorBenchmark: {
        ourAvgLcp: number;
        competitorAvgLcp: number;
        performanceGap: string;
    } | null;
}

// ─── Tech stack signatures ─────────────────────────────────────────────────

const TECH_SIGNATURES: Record<string, { category: keyof TechStack; patterns: string[] }> = {
    // Frontend
    'Next.js': { category: 'frontend', patterns: ['__NEXT_DATA__', '_next/static', 'next/dist'] },
    'React': { category: 'frontend', patterns: ['react.development.js', 'react.production.min.js', 'react-dom'] },
    'Vue.js': { category: 'frontend', patterns: ['vue.min.js', '__vue__', 'vue.global'] },
    'Angular': { category: 'frontend', patterns: ['ng-version', 'angular.min.js', 'zone.js'] },
    'Nuxt.js': { category: 'frontend', patterns: ['__nuxt', '_nuxt/'] },
    'Svelte': { category: 'frontend', patterns: ['__svelte', 'svelte/'] },
    'Remix': { category: 'frontend', patterns: ['__remixContext', '@remix-run'] },
    'Gatsby': { category: 'frontend', patterns: ['gatsby-', '__gatsby'] },

    // Payments
    'Stripe': { category: 'payments', patterns: ['js.stripe.com', 'stripe.js', 'stripe.min.js'] },
    'Paddle': { category: 'payments', patterns: ['paddle.js', 'checkout.paddle.com'] },
    'Chargebee': { category: 'payments', patterns: ['chargebee.com', 'chargebee.js'] },
    'Braintree': { category: 'payments', patterns: ['braintree', 'paypal.com/sdk'] },
    'Lemon Squeezy': { category: 'payments', patterns: ['lemonsqueezy.com', 'lemon.js'] },

    // Analytics
    'Google Analytics': { category: 'analytics', patterns: ['googletagmanager.com', 'google-analytics.com', 'gtag/js'] },
    'Segment': { category: 'analytics', patterns: ['segment.com/analytics.js', 'cdn.segment.com'] },
    'Mixpanel': { category: 'analytics', patterns: ['cdn.mxpnl.com', 'mixpanel.min.js'] },
    'Amplitude': { category: 'analytics', patterns: ['cdn.amplitude.com', 'amplitude.js'] },
    'PostHog': { category: 'analytics', patterns: ['posthog.com', 'posthog.js', 'posthog.io'] },
    'Heap': { category: 'analytics', patterns: ['heapanalytics.com', 'heap.js'] },
    'Plausible': { category: 'analytics', patterns: ['plausible.io', 'plausible.js'] },

    // Support
    'Intercom': { category: 'support', patterns: ['widget.intercom.io', 'intercomSettings', 'intercom.io'] },
    'Crisp': { category: 'support', patterns: ['client.crisp.chat', 'crisp.chat'] },
    'HubSpot': { category: 'support', patterns: ['js.hs-scripts.com', 'hubspot.com/conversations'] },
    'Zendesk': { category: 'support', patterns: ['zendesk.com', 'zdassets.com'] },
    'Freshdesk': { category: 'support', patterns: ['freshdesk.com', 'freshchat.com'] },
    'Drift': { category: 'support', patterns: ['drift.com', 'js.driftt.com'] },

    // Hosting/CDN
    'Vercel': { category: 'hosting', patterns: ['vercel.app', '_vercel', 'vercel.com'] },
    'Netlify': { category: 'hosting', patterns: ['netlify.app', 'netlify.com'] },
    'Cloudflare': { category: 'hosting', patterns: ['cloudflare.com', '__cf_bm', 'cdn-cgi'] },
    'AWS': { category: 'hosting', patterns: ['amazonaws.com', 'cloudfront.net'] },
    'Fastly': { category: 'hosting', patterns: ['fastly.net', 'fastly.com'] },

    // Monitoring/Error tracking
    'Sentry': { category: 'monitoring', patterns: ['sentry.io', 'browser.sentry-cdn.com', '@sentry'] },
    'Datadog': { category: 'monitoring', patterns: ['datadoghq.com', 'dd-rum', 'datadog-rum'] },
    'LogRocket': { category: 'monitoring', patterns: ['cdn.logrocket.io', 'logrocket.com'] },
    'Bugsnag': { category: 'monitoring', patterns: ['bugsnag.com', 'bugsnag.js'] },
    'Rollbar': { category: 'monitoring', patterns: ['rollbar.com', 'rollbar.min.js'] },
    'FullStory': { category: 'monitoring', patterns: ['fullstory.com', 'fullstory.js'] },

    // Testing
    'LaunchDarkly': { category: 'testing', patterns: ['launchdarkly.com', 'launchdarkly.js'] },
    'Optimizely': { category: 'testing', patterns: ['optimizely.com', 'optimizely.js'] },
    'Split.io': { category: 'testing', patterns: ['split.io', 'split.js'] },
};

// ─── Funnel page patterns ──────────────────────────────────────────────────

const FUNNEL_PATHS = [
    { name: 'Homepage', paths: ['/'] },
    { name: 'Pricing', paths: ['/pricing', '/plans', '/price', '/upgrade', '/subscribe'] },
    { name: 'Signup', paths: ['/signup', '/register', '/sign-up', '/get-started', '/start', '/join', '/create-account'] },
    { name: 'Login', paths: ['/login', '/signin', '/sign-in', '/auth/login'] },
    { name: 'Demo', paths: ['/demo', '/trial', '/free-trial', '/book-demo', '/request-demo'] },
];

// ─── Error classification patterns ────────────────────────────────────────

const IGNORED_NETWORK_PATTERNS = [
    'chrome-extension://', 'moz-extension://',
    'googletagmanager.com', 'google-analytics.com', 'analytics.google.com',
    'doubleclick.net', 'facebook.net', 'twitter.com', 'linkedin.com',
    'hotjar.com', 'fullstory.com', 'clarity.ms', 'mouseflow.com',
    '/favicon.ico', 'px.ads.linkedin', 'px4.ads.linkedin',
    '/api/trpc/', 'api/auth/', '/api/health',
    'static.ads-twitter', 'snap.licdn.com',
    'posthog.com/e/', 'posthog.io/e/',
    'sentry.io', 'bugsnag.com', 'rollbar.com',
    'intercom.io/messenger', 'crisp.chat',
    'ccm/collect', 'rmkt/collect', 'pagead/',
];

const IGNORED_CONSOLE_PATTERNS = [
    'chrome-extension', 'ResizeObserver loop',
    'Non-Error promise rejection',
    'Failed to load resource: net::ERR_BLOCKED',
    '[HMR]', 'Download the React DevTools',
    'Warning: ', '%c <<', 'background-color:',
    'font-weight: bold', 'viewer.me', 'viewer.teams',
    'padding: 2px', '__webpack',
    'status of 401',
    'user.name not found',
    'Key \'user.name\'',
];

// ─── QA Pipeline suggestions per tech stack ──────────────────────────────

function buildQAPipeline(techStack: TechStack, pages: PageAuditResult[]): QAPipelineItem[] {
    const pipeline: QAPipelineItem[] = [];
    const hasPayments = techStack.payments.length > 0;
    const hasNoMonitoring = techStack.monitoring.length === 0;
    const hasNoSupport = techStack.support.length === 0;
    const slowPages = pages.filter(p => p.lcp && p.lcp > 2500);
    const hasA11yIssues = pages.some(p => p.accessibilityViolations > 0);

    // Always recommended
    pipeline.push({
        tool: 'Playwright',
        purpose: 'End-to-end test automation for critical user flows',
        priority: 'critical',
        reason: 'Automate signup, login, and core product flows to catch regressions on every release',
    });

    pipeline.push({
        tool: 'GitHub Actions / Azure DevOps',
        purpose: 'CI/CD integration — run tests on every pull request',
        priority: 'critical',
        reason: 'Prevent broken code from reaching production by blocking deploys when tests fail',
    });

    // Payment flow testing
    if (hasPayments) {
        pipeline.push({
            tool: `Playwright + ${techStack.payments.join('/')} test mode`,
            purpose: 'Payment flow automation using test credentials',
            priority: 'critical',
            reason: `${techStack.payments.join('/')} detected — payment flow failures = direct revenue loss`,
        });
    }

    // Performance monitoring
    if (slowPages.length > 0) {
        pipeline.push({
            tool: 'Lighthouse CI',
            purpose: 'Performance budget enforcement on every release',
            priority: 'critical',
            reason: `${slowPages.length} page(s) have LCP > 2.5s — performance regression monitoring needed`,
        });
    }

    // Accessibility
    if (hasA11yIssues) {
        pipeline.push({
            tool: 'axe-core + Playwright',
            purpose: 'Automated accessibility testing on every release',
            priority: 'high',
            reason: 'Accessibility violations detected — ADA compliance risk in US market',
        });
    }

    // Frontend framework specific
    if (techStack.frontend.includes('Next.js') || techStack.frontend.includes('Nuxt.js')) {
        pipeline.push({
            tool: 'Playwright + MSW (Mock Service Worker)',
            purpose: 'API mocking for reliable SSR/SSG page testing',
            priority: 'high',
            reason: `${techStack.frontend.join('/')} detected — server-side rendering needs API mock layer for stable tests`,
        });
    }

    // Error monitoring
    if (hasNoMonitoring) {
        pipeline.push({
            tool: 'Sentry',
            purpose: 'Production error monitoring and alerting',
            priority: 'high',
            reason: 'No error monitoring detected — production bugs go unnoticed until users complain',
        });
    }

    // Support/chat
    if (hasNoSupport) {
        pipeline.push({
            tool: 'Crisp or Intercom',
            purpose: 'In-app support and user feedback collection',
            priority: 'medium',
            reason: 'No support widget detected — no way to capture user-reported bugs in real time',
        });
    }

    // Visual regression
    pipeline.push({
        tool: 'Playwright screenshots + Percy/Chromatic',
        purpose: 'Visual regression testing',
        priority: 'medium',
        reason: 'Catch unintended UI changes (layout shifts, style regressions) on every release',
    });

    // API testing if they have analytics (likely have APIs)
    if (techStack.analytics.length > 0) {
        pipeline.push({
            tool: 'Playwright API testing',
            purpose: 'REST/GraphQL API contract testing',
            priority: 'medium',
            reason: 'Validate API responses match expected contracts before frontend breaks',
        });
    }

    // Daily monitoring
    pipeline.push({
        tool: 'GatekeeperOps Daily Monitor',
        purpose: 'Continuous production health checks on all funnel pages',
        priority: 'critical',
        reason: 'Detect silent failures in production before users report them',
    });

    return pipeline;
}

// ─── Main class ───────────────────────────────────────────────────────────

export class FunnelAgent {
    private browser: Browser | null = null;

    async connect(): Promise<void> {
        if (process.env.LOCAL_MODE === 'true') {
            this.browser = await chromium.launch({ headless: false, slowMo: 300 });
        } else {
            const wsUrl = `wss://connect.browserbase.com?apiKey=${config.browserbase.apiKey}&projectId=${config.browserbase.projectId}`;
            this.browser = await chromium.connectOverCDP(wsUrl);
        }
    }

    async disconnect(): Promise<void> {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
        }
    }

    async runFunnelAudit(productUrl: string, productName?: string): Promise<FunnelAuditResult> {
        if (!this.browser) await this.connect();

        const auditId = uuidv4();
        const startTime = Date.now();
        const baseUrl = new URL(productUrl).origin;
        const name = productName || new URL(productUrl).hostname;

        console.log(`\n📡 Detecting tech stack...`);
        const { techStack, detectedCompetitors } = await this.detectStackAndCompetitors(baseUrl);

        console.log(`\n🔍 Discovering funnel pages...`);
        const discoveredPages = await this.discoverFunnelPages(baseUrl);
        console.log(`Found ${discoveredPages.length} pages: ${discoveredPages.map(p => p.name).join(', ')}`);

        console.log(`\n📊 Auditing each page...`);
        const pages: PageAuditResult[] = [];
        for (const p of discoveredPages) {
            console.log(`  Auditing ${p.name}...`);
            const result = await this.auditPage(p.url, p.name, auditId, baseUrl);
            pages.push(result);
        }

        console.log(`\n🏆 Auditing competitors...`);
        const competitors: CompetitorAudit[] = [];
        for (const comp of detectedCompetitors.slice(0, 2)) {
            console.log(`  Auditing ${comp.name}...`);
            const compAudit = await this.auditCompetitor(comp.name, comp.url);
            competitors.push(compAudit);
        }

        const funnelScore = this.calculateFunnelScore(pages);
        const criticalIssues = pages.reduce((acc, p) =>
            acc + p.networkFailures.length + (p.consoleErrors.length > 0 ? 1 : 0), 0
        );

        const suggestedQAPipeline = buildQAPipeline(techStack, pages);

        // Performance summary
        const pagesWithLcp = pages.filter(p => p.lcp !== undefined);
        const avgLcp = pagesWithLcp.length > 0
            ? Math.round(pagesWithLcp.reduce((a, p) => a + (p.lcp || 0), 0) / pagesWithLcp.length)
            : 0;
        const worstPage = pagesWithLcp.sort((a, b) => (b.lcp || 0) - (a.lcp || 0))[0];

        // Competitor benchmark
        const compWithLcp = competitors.filter(c => c.signupLcp !== undefined);
        const competitorBenchmark = compWithLcp.length > 0 && avgLcp > 0 ? {
            ourAvgLcp: avgLcp,
            competitorAvgLcp: Math.round(compWithLcp.reduce((a, c) => a + (c.signupLcp || 0), 0) / compWithLcp.length),
            performanceGap: avgLcp > (compWithLcp[0].signupLcp || 0)
                ? `${Math.round(avgLcp / (compWithLcp[0].signupLcp || 1))}x slower than ${compWithLcp[0].name}`
                : `${Math.round((compWithLcp[0].signupLcp || 0) / avgLcp)}x faster than ${compWithLcp[0].name}`,
        } : null;

        return {
            auditId,
            productUrl: baseUrl,
            productName: name,
            timestamp: new Date().toISOString(),
            totalDurationMs: Date.now() - startTime,
            techStack,
            competitors,
            pages,
            funnelScore,
            criticalIssues,
            suggestedQAPipeline,
            performanceSummary: {
                avgLcp,
                worstPage: worstPage?.pageName || 'N/A',
                worstLcp: worstPage?.lcp || 0,
                belowThresholdCount: pagesWithLcp.filter(p => (p.lcp || 0) > 2500).length,
            },
            competitorBenchmark,
        };
    }

    private async detectStackAndCompetitors(baseUrl: string): Promise<{
        techStack: TechStack;
        detectedCompetitors: { name: string; url: string }[];
    }> {
        const context = await this.browser!.newContext({ viewport: { width: 1440, height: 900 } });
        const page = await context.newPage();

        const techStack: TechStack = {
            frontend: [], analytics: [], payments: [],
            support: [], hosting: [], monitoring: [], testing: [], raw: [],
        };
        const loadedScripts: string[] = [];
        const detectedCompetitors: { name: string; url: string }[] = [];

        page.on('request', req => {
            if (req.resourceType() === 'script') loadedScripts.push(req.url());
        });

        try {
            await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 30000 });
            await page.waitForTimeout(2000);

            const pageContent = await page.content();
            const allSources = [...loadedScripts, pageContent];

            for (const [tech, { category, patterns }] of Object.entries(TECH_SIGNATURES)) {
                const detected = patterns.some(pattern =>
                    allSources.some(source => source.includes(pattern))
                );
                if (detected && !techStack[category].includes(tech)) {
                    techStack[category].push(tech);
                    techStack.raw.push(tech);
                }
            }

            // Detect competitors from page text
            const pageText = await page.evaluate(`document.body.innerText`) as string;
            const competitorPatterns = [
                /(?:vs\.?|versus|compared to|alternative to|instead of)\s+([A-Z][a-zA-Z0-9]+(?:\s[A-Z][a-zA-Z]+)?)/g,
                /(?:unlike|better than|switch from)\s+([A-Z][a-zA-Z0-9]+)/g,
            ];

            for (const pattern of competitorPatterns) {
                const matches = [...pageText.matchAll(pattern)];
                for (const match of matches.slice(0, 3)) {
                    const name = match[1].trim();
                    if (name.length > 2 && name.length < 30 && !detectedCompetitors.find(c => c.name === name)) {
                        detectedCompetitors.push({
                            name,
                            url: `https://www.${name.toLowerCase().replace(/\s/g, '')}.com`,
                        });
                    }
                }
            }

        } catch (error) {
            console.error('Stack detection error:', error instanceof Error ? error.message : error);
        } finally {
            await context.close();
        }

        return { techStack, detectedCompetitors };
    }

    private async discoverFunnelPages(baseUrl: string): Promise<{ url: string; name: string }[]> {
        const discovered: { url: string; name: string }[] = [];

        for (const { name, paths } of FUNNEL_PATHS) {
            for (const p of paths) {
                const url = `${baseUrl}${p}`;
                try {
                    const response = await fetch(url, {
                        method: 'HEAD',
                        signal: AbortSignal.timeout(5000),
                        redirect: 'follow',
                    });
                    if (response.ok || response.status === 405) {
                        discovered.push({ url, name });
                        break;
                    }
                } catch {
                    continue;
                }
            }
        }

        return discovered;
    }

    private async auditPage(
        url: string,
        pageName: string,
        auditId: string,
        productBaseUrl: string
    ): Promise<PageAuditResult> {
        const context = await this.browser!.newContext({
            viewport: { width: 1440, height: 900 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        });
        const page = await context.newPage();

        const consoleErrors: string[] = [];
        const networkFailures: NetworkFailure[] = [];
        const startTime = Date.now();

        page.on('console', msg => {
            if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 200));
        });

        page.on('requestfailed', req => {
            networkFailures.push({
                url: req.url(),
                method: req.method(),
                errorText: req.failure()?.errorText,
                type: 'failed',
            });
        });

        page.on('response', response => {
            if (response.status() >= 400 && !response.url().includes('favicon')) {
                networkFailures.push({
                    url: response.url(),
                    method: response.request().method(),
                    status: response.status(),
                    type: 'error_status',
                });
            }
        });

        let httpStatus = 0;
        let screenshotPath = '';
        let accessible = true;
        let accessibilityViolations = 0;
        let accessibilityDetails: { id: string; impact: string; description: string; nodes: number }[] = [];

        try {
            const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
            httpStatus = response?.status() ?? 0;
            const loadTimeMs = Date.now() - startTime;

            await page.waitForTimeout(1500);

            // Screenshot
            const dir = path.join(config.reportOutputDir, 'funnel');
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            screenshotPath = path.join(dir, `${auditId}-${pageName.toLowerCase().replace(/\s/g, '-')}.png`);
            await page.screenshot({ path: screenshotPath, fullPage: false });

            // Accessibility
            try {
                const AxeBuilder = require('@axe-core/playwright').default;
                const axeResults = await new AxeBuilder({ page })
                    .withTags(['wcag2a', 'wcag2aa'])
                    .analyze();
                accessibilityViolations = axeResults.violations.length;
                accessible = accessibilityViolations === 0;
                accessibilityDetails = axeResults.violations.slice(0, 5).map((v: any) => ({
                    id: v.id,
                    impact: v.impact ?? 'unknown',
                    description: v.description,
                    nodes: v.nodes.length,
                }));
            } catch {
                accessible = true;
            }

            // Performance
            let performanceScore: number | undefined;
            let lcp: number | undefined;
            let cls: number | undefined;
            let fcp: number | undefined;
            let tbt: number | undefined;

            if (config.pagespeed.apiKey) {
                try {
                    const apiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=mobile&key=${config.pagespeed.apiKey}`;
                    const psResponse = await fetch(apiUrl, { signal: AbortSignal.timeout(30000) });
                    const psData = await psResponse.json() as any;
                    const audits = psData.lighthouseResult?.audits;
                    performanceScore = Math.round((psData.lighthouseResult?.categories?.performance?.score ?? 0) * 100);
                    lcp = audits?.['largest-contentful-paint']?.numericValue;
                    cls = audits?.['cumulative-layout-shift']?.numericValue;
                    fcp = audits?.['first-contentful-paint']?.numericValue;
                    tbt = audits?.['total-blocking-time']?.numericValue;
                } catch { /* PageSpeed unavailable */ }
            }

            // Classify errors
            const { realErrors, expectedErrors, realConsoleErrors, ignoredConsoleErrors } =
                this.classifyErrors(consoleErrors, networkFailures, productBaseUrl);

            return {
                url, pageName, loadTimeMs, httpStatus,
                consoleErrors: realConsoleErrors,
                ignoredConsoleErrors,
                networkFailures: realErrors,
                ignoredNetworkFailures: expectedErrors,
                screenshotPath,
                performanceScore, lcp, cls, fcp, tbt,
                accessible, accessibilityViolations, accessibilityDetails,
            };

        } catch (error) {
            const { realErrors, expectedErrors, realConsoleErrors, ignoredConsoleErrors } =
                this.classifyErrors(consoleErrors, networkFailures, productBaseUrl);

            return {
                url, pageName,
                loadTimeMs: Date.now() - startTime,
                httpStatus, consoleErrors: realConsoleErrors,
                ignoredConsoleErrors, networkFailures: realErrors,
                ignoredNetworkFailures: expectedErrors,
                screenshotPath, accessible: false,
                accessibilityViolations: 0, accessibilityDetails: [],
            };
        } finally {
            await context.close();
        }
    }

    private async auditCompetitor(name: string, baseUrl: string): Promise<CompetitorAudit> {
        const signupPaths = ['/signup', '/register', '/sign-up', '/get-started', '/start'];
        let signupUrl = `${baseUrl}/signup`;
        let signupLcp: number | undefined;
        let signupPerformanceScore: number | undefined;
        const techStack: string[] = [];
        let hasMonitoring = false;
        let hasSupport = false;

        try {
            // Find signup URL
            for (const p of signupPaths) {
                const url = `${baseUrl}${p}`;
                try {
                    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(5000), redirect: 'follow' });
                    if (res.ok) { signupUrl = url; break; }
                } catch { continue; }
            }

            // Get performance for signup page
            if (config.pagespeed.apiKey) {
                const apiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(signupUrl)}&strategy=mobile&key=${config.pagespeed.apiKey}`;
                const res = await fetch(apiUrl, { signal: AbortSignal.timeout(30000) });
                const data = await res.json() as any;
                signupPerformanceScore = Math.round((data.lighthouseResult?.categories?.performance?.score ?? 0) * 100);
                signupLcp = data.lighthouseResult?.audits?.['largest-contentful-paint']?.numericValue;
            }

            // Quick tech stack detection
            const context = await this.browser!.newContext({ viewport: { width: 1440, height: 900 } });
            const page = await context.newPage();
            const scripts: string[] = [];
            page.on('request', req => { if (req.resourceType() === 'script') scripts.push(req.url()); });

            try {
                await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
                await page.waitForTimeout(1500);
                const content = await page.content();
                const sources = [...scripts, content];

                for (const [tech, { category, patterns }] of Object.entries(TECH_SIGNATURES)) {
                    if (patterns.some(p => sources.some(s => s.includes(p)))) {
                        techStack.push(tech);
                        if (category === 'monitoring') hasMonitoring = true;
                        if (category === 'support') hasSupport = true;
                    }
                }
            } finally {
                await context.close();
            }

        } catch (error) {
            console.error(`Competitor audit failed for ${name}:`, error instanceof Error ? error.message : error);
        }

        return { name, url: baseUrl, signupUrl, signupLcp, signupPerformanceScore, techStack, hasMonitoring, hasSupport };
    }

    private classifyErrors(
        consoleErrors: string[],
        networkFailures: NetworkFailure[],
        productUrl: string
    ) {
        const domain = new URL(productUrl).hostname.replace('www.', '');

        const realErrors = networkFailures.filter(f => {
            const url = f.url.toLowerCase();
            const isIgnored = IGNORED_NETWORK_PATTERNS.some(p => url.includes(p.toLowerCase()));
            const isOwnDomain = url.includes(domain);
            const isCriticalStatus = f.status && [500, 502, 503, 504].includes(f.status);
            const isRealFailure = f.type === 'failed' && !isIgnored && isOwnDomain;
            return !isIgnored && (isRealFailure || (isCriticalStatus && isOwnDomain));
        });

        const expectedErrors = networkFailures.filter(f => !realErrors.includes(f));

        const realConsoleErrors = consoleErrors.filter(e => {
            const lower = e.toLowerCase();
            return !IGNORED_CONSOLE_PATTERNS.some(p => lower.includes(p.toLowerCase()));
        });

        const ignoredConsoleErrors = consoleErrors.filter(e => !realConsoleErrors.includes(e));

        return { realErrors, expectedErrors, realConsoleErrors, ignoredConsoleErrors };
    }

    private calculateFunnelScore(pages: PageAuditResult[]): number {
        if (pages.length === 0) return 0;
        const scores = pages.map(page => {
            let score = 100;
            if (page.httpStatus >= 400) score -= 50;
            if (page.consoleErrors.length > 0) score -= page.consoleErrors.length * 5;
            if (page.networkFailures.length > 0) score -= page.networkFailures.length * 5;
            if (page.accessibilityViolations > 0) score -= Math.min(page.accessibilityViolations * 3, 20);
            if (page.performanceScore !== undefined && page.performanceScore < 50) score -= 20;
            else if (page.performanceScore !== undefined && page.performanceScore < 70) score -= 10;
            if (page.lcp !== undefined && page.lcp > 4000) score -= 15;
            else if (page.lcp !== undefined && page.lcp > 2500) score -= 8;
            return Math.max(0, score);
        });
        return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    }
}