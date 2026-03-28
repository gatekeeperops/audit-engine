import { chromium, Browser, BrowserContext, Page } from 'playwright-core';
import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config/environment';
import { AutoLogin } from './autoLogin';

export interface FlowDefinition {
  name: string;
  type: 'onboarding' | 'core_action' | 'collaboration' | 'settings' | 'upgrade' | 'unknown';
  criticality: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  startUrl: string;
  steps: string[];
}

export interface FlowResult {
  flow: FlowDefinition;
  status: 'PASS' | 'FAIL' | 'PARTIAL';
  stepsCompleted: number;
  totalSteps: number;
  durationMs: number;
  failedStep?: string;
  errorMessage?: string;
  screenshotPath?: string;
}

export interface CrawlResult {
  targetUrl: string;
  productName: string;
  timestamp: string;
  loginMethod: string;
  flowsDiscovered: FlowDefinition[];
  flowsExecuted: FlowResult[];
  overallScore: number;
  criticalFailures: number;
  passRate: number;
}

export interface CrawlConfig {
  loginUrl: string;
  dashboardUrl: string;
  productName: string;
  credentials: {
    email: string;
    password?: string;
  };
  maxFlows?: number;
}

export class FlowCrawlerGeneric {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private anthropic: Anthropic;
  private autoLogin: AutoLogin;
  private sessionPath = './reports/session';

  constructor() {
    this.anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });
    this.autoLogin = new AutoLogin();
  }

  async launch(): Promise<void> {
    this.browser = await chromium.launch({
      headless: false,
      slowMo: 600,
    });

    const hasSession = fs.existsSync(`${this.sessionPath}/state.json`);

    this.context = await this.browser.newContext({
      storageState: hasSession ? `${this.sessionPath}/state.json` : undefined,
      viewport: { width: 1440, height: 900 },
      recordVideo: {
        dir: './reports/videos/',
        size: { width: 1440, height: 900 },
      },
    });

    console.log(`Browser launched ${hasSession ? '(session loaded)' : '(fresh)'}`);
  }

  async saveSession(): Promise<void> {
    if (!this.context) return;
    if (!fs.existsSync(this.sessionPath)) {
      fs.mkdirSync(this.sessionPath, { recursive: true });
    }
    await this.context.storageState({ path: `${this.sessionPath}/state.json` });
    console.log('Session saved');
  }

  async close(): Promise<void> {
    if (this.context) await this.context.close();
    if (this.browser) await this.browser.close();
  }

  async run(crawlConfig: CrawlConfig): Promise<CrawlResult> {
    if (!this.context) throw new Error('Browser not launched');

    const maxFlows = crawlConfig.maxFlows || 15;
    let loginMethod = 'session';

    const hasSession = fs.existsSync(`${this.sessionPath}/state.json`);
    if (!hasSession) {
      const rawPage = await this.context.newPage();
      const loginResult = await this.autoLogin.login(
        rawPage,
        crawlConfig.loginUrl,
        crawlConfig.credentials
      );
      await rawPage.waitForTimeout(2000);
      loginMethod = loginResult.method;

      if (!loginResult.success) {
        console.log('Auto-login failed — waiting for manual login...');
        console.log('Press ENTER when you are fully logged in.');
        await new Promise(resolve => process.stdin.once('data', resolve));
        loginMethod = 'manual';
      }

      await this.saveSession();
      await rawPage.close();
    }

    console.log('\n📡 Discovering flows...');
    const flows = await this.discoverFlows(crawlConfig.dashboardUrl, maxFlows);
    console.log(`Found ${flows.length} flows to test`);
    flows.forEach(f => console.log(`  [${f.criticality.toUpperCase()}] ${f.name}`));

    console.log('\n🤖 Executing flows...');
    const results: FlowResult[] = [];
    for (let i = 0; i < flows.length; i++) {
      const flow = flows[i];
      console.log(`\n[${i + 1}/${flows.length}] ${flow.name}`);
      const result = await this.executeFlow(flow);
      results.push(result);
      const icon = result.status === 'PASS' ? '✅' : result.status === 'PARTIAL' ? '⚠️' : '❌';
      console.log(`  ${icon} ${result.stepsCompleted}/${result.totalSteps} steps (${result.durationMs}ms)`);
    }

    const passed = results.filter(r => r.status === 'PASS').length;
    const criticalFailures = results.filter(
      r => r.status === 'FAIL' && r.flow.criticality === 'critical'
    ).length;

    return {
      targetUrl: crawlConfig.dashboardUrl,
      productName: crawlConfig.productName,
      timestamp: new Date().toISOString(),
      loginMethod,
      flowsDiscovered: flows,
      flowsExecuted: results,
      overallScore: results.length > 0 ? Math.round((passed / results.length) * 100) : 0,
      criticalFailures,
      passRate: results.length > 0 ? Math.round((passed / results.length) * 100) : 0,
    };
  }

  private async discoverFlows(dashboardUrl: string, maxFlows: number): Promise<FlowDefinition[]> {
    if (!this.context) throw new Error('Browser not launched');

    const rawPage = await this.context.newPage();

    try {
      await rawPage.goto(dashboardUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await rawPage.waitForTimeout(3000);

      const pageContent = await rawPage.evaluate(`
        (() => {
          const buttons = Array.from(document.querySelectorAll('button, [role="button"]'))
            .map(el => el.textContent && el.textContent.trim())
            .filter(Boolean)
            .slice(0, 30);
          const links = Array.from(document.querySelectorAll('nav a, header a, [role="navigation"] a'))
            .map(el => el.textContent && el.textContent.trim())
            .filter(Boolean)
            .slice(0, 20);
          const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
            .map(el => el.textContent && el.textContent.trim())
            .filter(Boolean)
            .slice(0, 10);
          return { buttons, links, headings, url: window.location.href, title: document.title };
        })()
      `) as any;

      console.log('Page content extracted');

      const response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 3000,
        messages: [
          {
            role: 'user',
            content: `You are a QA engineer analyzing a SaaS application dashboard.

Page title: ${pageContent.title}
URL: ${pageContent.url}
Navigation links: ${pageContent.links.join(', ')}
Buttons visible: ${pageContent.buttons.join(', ')}
Headings: ${pageContent.headings.join(', ')}

Generate ${maxFlows} user flows to test for this application.
Focus on: critical revenue flows, core product actions, collaboration, settings, onboarding.

Steps must be plain English descriptions of UI interactions.
Each step should describe ONE action: click something, fill something, or verify something.
Use the exact button/link text visible in the page content above when describing steps.

Respond with ONLY a valid JSON array:
[
  {
    "name": "Create New Board",
    "type": "core_action",
    "criticality": "critical",
    "description": "Tests creating a new board",
    "startUrl": "${dashboardUrl}",
    "steps": [
      "Click the create or add new board button",
      "Fill in the board name field with test data",
      "Click the confirm or create button",
      "Verify the new board appears on the page"
    ]
  }
]

Types: onboarding, core_action, collaboration, settings, upgrade
Criticality: critical, high, medium, low`,
          }
        ],
      });

      const text = response.content
        .filter(b => b.type === 'text')
        .map(b => (b as any).text)
        .join('');

      const clean = text.replace(/```json|```/g, '').trim();
      const flows: FlowDefinition[] = JSON.parse(clean);
      return flows.slice(0, maxFlows);

    } catch (error) {
      console.error('Flow discovery error:', error);
      return [];
    } finally {
      await rawPage.close();
    }
  }

  private async executeFlow(flow: FlowDefinition): Promise<FlowResult> {
    if (!this.context) throw new Error('Browser not launched');

    const rawPage = await this.context.newPage();
    const startTime = Date.now();
    let stepsCompleted = 0;

    try {
      await rawPage.goto(flow.startUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await rawPage.waitForTimeout(2000);

      for (const step of flow.steps) {
        try {
          await this.executeStep(rawPage, step);
          stepsCompleted++;
          await rawPage.waitForTimeout(1000);
        } catch (error) {
          const screenshotPath = await this.captureScreenshot(rawPage, flow.name, stepsCompleted);
          return {
            flow,
            status: stepsCompleted > 0 ? 'PARTIAL' : 'FAIL',
            stepsCompleted,
            totalSteps: flow.steps.length,
            durationMs: Date.now() - startTime,
            failedStep: step,
            errorMessage: error instanceof Error ? error.message : 'Step failed',
            screenshotPath,
          };
        }
      }

      return {
        flow,
        status: stepsCompleted === flow.steps.length ? 'PASS' : 'PARTIAL',
        stepsCompleted,
        totalSteps: flow.steps.length,
        durationMs: Date.now() - startTime,
      };

    } catch (error) {
      const screenshotPath = await this.captureScreenshot(rawPage, flow.name, stepsCompleted);
      return {
        flow,
        status: 'FAIL',
        stepsCompleted,
        totalSteps: flow.steps.length,
        durationMs: Date.now() - startTime,
        errorMessage: error instanceof Error ? error.message : 'Flow failed',
        screenshotPath,
      };
    } finally {
      await rawPage.close();
    }
  }

  private async executeStep(rawPage: Page, stepDescription: string): Promise<void> {
    const step = stepDescription.toLowerCase();

    const isVerifyAction = step.includes('verify') || step.includes('check') ||
      step.includes('confirm') || step.includes('review') || step.includes('assert');

    if (isVerifyAction) {
      await rawPage.waitForTimeout(500);
      return;
    }

    const isFillAction = step.includes('fill') || step.includes('enter') ||
      step.includes('type') || step.includes('input');

    // Take screenshot of current state
    const screenshot = await rawPage.screenshot({ type: 'jpeg', quality: 60, fullPage: false });
    const base64 = screenshot.toString('base64');

    // Claude identifies the element from screenshot
    const response = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/jpeg', data: base64 },
            },
            {
              type: 'text',
              text: `Look at this screenshot. Generate a Playwright locator for this action:
"${stepDescription}"

Use these Playwright locators in priority order:
1. page.getByRole('button', { name: 'exact text from screenshot' })
2. page.getByLabel('exact label text')
3. page.getByPlaceholder('exact placeholder text')
4. page.getByText('exact visible text')
5. page.locator('[data-testid="..."]')

Use the EXACT text visible in the screenshot. Do not guess.

Respond with ONLY the locator code starting with "page.", nothing else.
Example: page.getByRole('button', { name: 'Create' })`,
            }
          ],
        }
      ],
    });

    const locatorCode = response.content
      .filter(b => b.type === 'text')
      .map(b => (b as any).text)
      .join('')
      .trim()
      .replace(/^["'`]|["'`]$/g, '');

    const locator = this.resolveLocator(rawPage, locatorCode);
    await locator.waitFor({ timeout: 8000 });

    if (isFillAction) {
      await locator.fill(`GatekeeperOps Test ${Date.now()}`);
    } else {
      await locator.click();
    }

    await rawPage.waitForTimeout(800);
  }

  private resolveLocator(page: Page, locatorCode: string): any {
    const code = locatorCode.trim();

    const roleMatch = code.match(/getByRole\(['"]([^'"]+)['"]\s*,?\s*(\{[^}]*\})?\)/);
    if (roleMatch) {
      const role = roleMatch[1] as any;
      const options = roleMatch[2] ? this.parseOptions(roleMatch[2]) : {};
      return page.getByRole(role, options);
    }

    const labelMatch = code.match(/getByLabel\(['"]([^'"]+)['"]\)/);
    if (labelMatch) return page.getByLabel(labelMatch[1]);

    const placeholderMatch = code.match(/getByPlaceholder\(['"]([^'"]+)['"]\)/);
    if (placeholderMatch) return page.getByPlaceholder(placeholderMatch[1]);

    const textMatch = code.match(/getByText\(['"]([^'"]+)['"]\)/);
    if (textMatch) return page.getByText(textMatch[1]);

    const testIdMatch = code.match(/getByTestId\(['"]([^'"]+)['"]\)/);
    if (testIdMatch) return page.getByTestId(testIdMatch[1]);

    const locatorMatch = code.match(/locator\(['"]([^'"]+)['"]\)/);
    if (locatorMatch) return page.locator(locatorMatch[1]);

    // Last resort
    return page.locator(code.replace('page.locator(', '').replace(')', '').replace(/['"]/g, ''));
  }

  private parseOptions(optStr: string): Record<string, any> {
    try {
      const nameMatch = optStr.match(/name:\s*['"]([^'"]+)['"]/);
      if (nameMatch) return { name: nameMatch[1] };
    } catch {}
    return {};
  }

  private async captureScreenshot(page: Page, flowName: string, step: number): Promise<string> {
    try {
      const dir = './reports/screenshots';
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const filePath = path.join(
        dir,
        `fail-${flowName.replace(/\s+/g, '-')}-step${step}-${Date.now()}.png`
      );
      await page.screenshot({ path: filePath, fullPage: false });
      return filePath;
    } catch {
      return '';
    }
  }
}