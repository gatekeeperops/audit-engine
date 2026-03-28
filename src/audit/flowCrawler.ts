import { chromium, Browser, BrowserContext, Page } from 'playwright-core';
import { wrap, configure } from 'agentql';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config/environment';

configure({ apiKey: config.agentql.apiKey });

export interface FlowDefinition {
    name: string;
    type: 'onboarding' | 'core_action' | 'collaboration' | 'settings' | 'upgrade';
    criticality: 'critical' | 'high' | 'medium' | 'low';
    steps: string[];
    url: string;
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
    videoPath?: string;
}

export interface CrawlResult {
    targetUrl: string;
    productName: string;
    timestamp: string;
    flowsDiscovered: FlowDefinition[];
    flowsExecuted: FlowResult[];
    overallScore: number;
    criticalFailures: number;
}

export class FlowCrawler {
    private browser: Browser | null = null;
    private context: BrowserContext | null = null;

    //   async launch(): Promise<void> {
    //     this.browser = await chromium.launch({
    //       headless: false,
    //       slowMo: 800,
    //     });

    //     this.context = await this.browser.newContext({
    //       viewport: { width: 1280, height: 720 },
    //       recordVideo: {
    //         dir: './reports/videos/',
    //         size: { width: 1280, height: 720 },
    //       },
    //     });

    //     console.log('Browser launched in headed mode');
    //   }

    async launch(): Promise<void> {
        this.browser = await chromium.launch({
          headless: false,
          slowMo: 800,
        });
      
        const sessionPath = './reports/session';
        
        this.context = await this.browser.newContext({
          storageState: fs.existsSync(`${sessionPath}/state.json`) 
            ? `${sessionPath}/state.json` 
            : undefined,
          viewport: { width: 1280, height: 720 },
          recordVideo: {
            dir: './reports/videos/',
            size: { width: 1280, height: 720 },
          },
        });
      
        // Open a page so browser window becomes visible
        const page = await this.context.newPage();
        await page.goto('https://trello.com', { waitUntil: 'domcontentloaded' });
        
        console.log('Browser launched');
      }

    async saveSession(): Promise<void> {
        if (!this.context) return;
        const sessionPath = './reports/session';
        if (!fs.existsSync(sessionPath)) fs.mkdirSync(sessionPath, { recursive: true });
        await this.context.storageState({ path: `${sessionPath}/state.json` });
        console.log('Session saved');
    }

    async close(): Promise<void> {
        if (this.context) await this.context.close();
        if (this.browser) await this.browser.close();
    }

    async crawlAndDiscover(
        startUrl: string,
        credentials: { email: string; password?: string }
    ): Promise<FlowDefinition[]> {
        if (!this.context) throw new Error('Browser not launched');

        const page = await wrap(await this.context.newPage());
        const flows: FlowDefinition[] = [];

        try {
            console.log(`\nCrawling: ${startUrl}`);
            await page.goto(startUrl, { waitUntil: 'networkidle', timeout: 30000 });

            // Discover navigation structure
            console.log('Discovering navigation structure...');
            const navData = await page.queryData(`
        {
          navigationLinks[] {
            text
            isVisible
          }
          primaryActions[] {
            text
            type
          }
          pageTitle
        }
      `);

            console.log('Page structure:', JSON.stringify(navData, null, 2));

            // Map discovered flows based on what AgentQL finds
            const discoveredFlows = this.mapToFlows(startUrl, navData);
            flows.push(...discoveredFlows);

            // Always add Trello-specific known flows
            flows.push(...this.getTrelloFlows());

            // Deduplicate by name
            const unique = flows.filter(
                (f, i, arr) => arr.findIndex(x => x.name === f.name) === i
            );

            console.log(`\nDiscovered ${unique.length} flows to test`);
            unique.forEach(f => console.log(`  [${f.criticality.toUpperCase()}] ${f.name}`));

            return unique;
        } finally {
            await page.close();
        }
    }

    private mapToFlows(baseUrl: string, navData: any): FlowDefinition[] {
        const flows: FlowDefinition[] = [];
        const links: any[] = navData?.navigationLinks || [];

        for (const link of links) {
            const text = (link.text || '').toLowerCase();
            if (text.includes('board') || text.includes('home')) {
                flows.push({
                    name: 'View Boards Dashboard',
                    type: 'core_action',
                    criticality: 'critical',
                    steps: ['Navigate to boards', 'Verify boards list visible'],
                    url: baseUrl,
                });
            }
        }

        return flows;
    }

    private getTrelloFlows(): FlowDefinition[] {
        return [
            {
                name: 'Create New Board',
                type: 'onboarding',
                criticality: 'critical',
                steps: [
                    'Click create board button',
                    'Enter board name',
                    'Select background',
                    'Submit and verify board created',
                ],
                url: 'https://trello.com/u/pardhasaradhi14/boards',
            },
            {
                name: 'Add List to Board',
                type: 'core_action',
                criticality: 'critical',
                steps: [
                    'Open existing board',
                    'Click add list',
                    'Enter list name',
                    'Verify list appears',
                ],
                url: 'https://trello.com/u/pardhasaradhi14/boards',
            },
            {
                name: 'Create and Move Card',
                type: 'core_action',
                criticality: 'critical',
                steps: [
                    'Open board',
                    'Add card to first list',
                    'Open card',
                    'Verify card details',
                ],
                url: 'https://trello.com/u/pardhasaradhi14/boards',
            },
            {
                name: 'Search Functionality',
                type: 'core_action',
                criticality: 'high',
                steps: [
                    'Click search',
                    'Enter search term',
                    'Verify results appear',
                ],
                url: 'https://trello.com/u/pardhasaradhi14/boards',
            },
            {
                name: 'Profile Settings Access',
                type: 'settings',
                criticality: 'medium',
                steps: [
                    'Click profile menu',
                    'Navigate to settings',
                    'Verify settings page loads',
                ],
                url: 'https://trello.com/u/pardhasaradhi14/boards',
            },
        ];
    }

    async executeFlow(flow: FlowDefinition): Promise<FlowResult> {
        if (!this.context) throw new Error('Browser not launched');

        const page = await wrap(await this.context.newPage());
        const startTime = Date.now();
        let stepsCompleted = 0;

        console.log(`\nExecuting: ${flow.name}`);

        try {
            await page.goto(flow.url, { waitUntil: 'networkidle', timeout: 30000 });

            // Execute flow based on type
            if (flow.name === 'Create New Board') {
                stepsCompleted = await this.executeCreateBoard(page, flow);
            } else if (flow.name === 'Add List to Board') {
                stepsCompleted = await this.executeAddList(page, flow);
            } else if (flow.name === 'Create and Move Card') {
                stepsCompleted = await this.executeCreateCard(page, flow);
            } else if (flow.name === 'Search Functionality') {
                stepsCompleted = await this.executeSearch(page, flow);
            } else if (flow.name === 'Profile Settings Access') {
                stepsCompleted = await this.executeProfileSettings(page, flow);
            } else {
                stepsCompleted = await this.executeGenericFlow(page, flow);
            }

            const status = stepsCompleted === flow.steps.length ? 'PASS' :
                stepsCompleted > 0 ? 'PARTIAL' : 'FAIL';

            console.log(`  ${status}: ${stepsCompleted}/${flow.steps.length} steps`);

            return {
                flow,
                status,
                stepsCompleted,
                totalSteps: flow.steps.length,
                durationMs: Date.now() - startTime,
            };

        } catch (error) {
            const screenshotPath = await this.captureFailureScreenshot(page, flow.name);
            console.log(`  FAIL: ${error instanceof Error ? error.message : 'Unknown error'}`);

            return {
                flow,
                status: 'FAIL',
                stepsCompleted,
                totalSteps: flow.steps.length,
                durationMs: Date.now() - startTime,
                failedStep: flow.steps[stepsCompleted],
                errorMessage: error instanceof Error ? error.message : 'Unknown error',
                screenshotPath,
            };
        } finally {
            await page.close();
        }
    }

    private async executeCreateBoard(page: any, flow: FlowDefinition): Promise<number> {
        let steps = 0;

        // Step 1: Find and click create button
        const { createButton } = await page.queryElements(`
      { createButton(button or link to create a new board) }
    `);
        await createButton.click();
        steps++;
        await page.waitForTimeout(1500);

        // Step 2: Enter board name
        const { boardNameInput } = await page.queryElements(`
      { boardNameInput(text input for board title or name) }
    `);
        await boardNameInput.fill('GatekeeperOps Test Board');
        steps++;
        await page.waitForTimeout(500);

        // Step 3: Submit
        const { createBoardSubmit } = await page.queryElements(`
      { createBoardSubmit(button to confirm and create the board) }
    `);
        await createBoardSubmit.click();
        steps++;
        await page.waitForTimeout(2000);

        // Step 4: Verify board created
        const result = await page.queryData(`
      { boardTitle, boardCreated }
    `);
        if (result?.boardTitle) steps++;

        return steps;
    }

    private async executeAddList(page: any, flow: FlowDefinition): Promise<number> {
        let steps = 0;

        // Step 1: Open first available board
        const { firstBoard } = await page.queryElements(`
      { firstBoard(first board card or link visible on the page) }
    `);
        await firstBoard.click();
        steps++;
        await page.waitForTimeout(2000);

        // Step 2: Click add list
        const { addListButton } = await page.queryElements(`
      { addListButton(button to add a new list or column) }
    `);
        await addListButton.click();
        steps++;
        await page.waitForTimeout(1000);

        // Step 3: Enter list name
        const { listNameInput } = await page.queryElements(`
      { listNameInput(input field for list or column name) }
    `);
        await listNameInput.fill('QA Test List');
        steps++;

        // Step 4: Confirm
        const { addListConfirm } = await page.queryElements(`
      { addListConfirm(button to save or confirm the new list) }
    `);
        await addListConfirm.click();
        steps++;
        await page.waitForTimeout(1500);

        return steps;
    }

    private async executeCreateCard(page: any, flow: FlowDefinition): Promise<number> {
        let steps = 0;

        // Step 1: Open first board
        const { firstBoard } = await page.queryElements(`
      { firstBoard(first board card or link on the page) }
    `);
        await firstBoard.click();
        steps++;
        await page.waitForTimeout(2000);

        // Step 2: Add card
        const { addCardButton } = await page.queryElements(`
      { addCardButton(button or link to add a new card to a list) }
    `);
        await addCardButton.click();
        steps++;
        await page.waitForTimeout(1000);

        // Step 3: Enter card title
        const { cardTitleInput } = await page.queryElements(`
      { cardTitleInput(input for card title or name) }
    `);
        await cardTitleInput.fill('GatekeeperOps Test Card');
        steps++;

        // Step 4: Save card
        const { saveCardButton } = await page.queryElements(`
      { saveCardButton(button to save or add the card) }
    `);
        await saveCardButton.click();
        steps++;
        await page.waitForTimeout(1500);

        return steps;
    }

    private async executeSearch(page: any, flow: FlowDefinition): Promise<number> {
        let steps = 0;

        const { searchButton } = await page.queryElements(`
      { searchButton(search icon or input in the navigation) }
    `);
        await searchButton.click();
        steps++;
        await page.waitForTimeout(1000);

        const { searchInput } = await page.queryElements(`
      { searchInput(search text input field) }
    `);
        await searchInput.fill('test');
        steps++;
        await page.waitForTimeout(1500);

        const results = await page.queryData(`
      { searchResults(any search results or suggestions visible) }
    `);
        if (results?.searchResults) steps++;

        return steps;
    }

    private async executeProfileSettings(page: any, flow: FlowDefinition): Promise<number> {
        let steps = 0;

        const { profileMenu } = await page.queryElements(`
      { profileMenu(user avatar, profile picture, or account menu) }
    `);
        await profileMenu.click();
        steps++;
        await page.waitForTimeout(1000);

        const { settingsLink } = await page.queryElements(`
      { settingsLink(link to profile settings or account settings) }
    `);
        await settingsLink.click();
        steps++;
        await page.waitForTimeout(2000);

        const pageData = await page.queryData(`
      { settingsPageTitle, profileSection }
    `);
        if (pageData?.settingsPageTitle) steps++;

        return steps;
    }

    private async executeGenericFlow(page: any, flow: FlowDefinition): Promise<number> {
        // Generic execution for unmapped flows
        const pageData = await page.queryData(`
      { pageTitle, mainContent }
    `);
        return pageData?.pageTitle ? 1 : 0;
    }

    private async captureFailureScreenshot(page: any, flowName: string): Promise<string> {
        try {
            const dir = './reports/screenshots';
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            const filePath = path.join(dir, `fail-${flowName.replace(/\s+/g, '-')}-${Date.now()}.png`);
            await page.screenshot({ path: filePath });
            return filePath;
        } catch {
            return '';
        }
    }

    buildCrawlResult(
        targetUrl: string,
        productName: string,
        flows: FlowDefinition[],
        results: FlowResult[]
    ): CrawlResult {
        const passed = results.filter(r => r.status === 'PASS').length;
        const total = results.length;
        const criticalFailures = results.filter(
            r => r.status === 'FAIL' && r.flow.criticality === 'critical'
        ).length;

        return {
            targetUrl,
            productName,
            timestamp: new Date().toISOString(),
            flowsDiscovered: flows,
            flowsExecuted: results,
            overallScore: total > 0 ? Math.round((passed / total) * 100) : 0,
            criticalFailures,
        };
    }
}