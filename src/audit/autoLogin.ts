import { Page } from 'playwright-core';
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config/environment';

interface LoginCredentials {
  email: string;
  password?: string;
}

interface LoginResult {
  success: boolean;
  method: 'password' | 'otp' | 'manual' | 'session';
  message: string;
}

export class AutoLogin {
  private anthropic: Anthropic;

  constructor() {
    this.anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });
  }

  async login(page: Page, loginUrl: string, credentials: LoginCredentials): Promise<LoginResult> {
    console.log(`\nAttempting auto-login on: ${loginUrl}`);
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    // Step 1: Detect login form
    const loginForm = await this.detectLoginForm(page);
    if (!loginForm) {
      console.log('No login form detected — may already be logged in');
      return { success: true, method: 'session', message: 'Already logged in' };
    }

    // Step 2: Fill email
    try {
      const emailInput = page.locator(
        'input[type="email"], input[name="email"], input[name="username"], input[name="identifier"]'
      ).first();
      await emailInput.waitFor({ timeout: 10000 });
      await emailInput.fill(credentials.email);
      console.log('  ✓ Email filled');
      await page.waitForTimeout(500);
    } catch {
      console.log('  ✗ Could not find email field');
      return { success: false, method: 'manual', message: 'Email field not found' };
    }

    // Step 3: Try to fill password (may not be visible yet)
    if (credentials.password) {
      try {
        const passwordInput = page.locator('input[type="password"]').first();
        await passwordInput.waitFor({ timeout: 3000 });
        await passwordInput.fill(credentials.password);
        console.log('  ✓ Password filled');
      } catch {
        console.log('  ⚠ Password field not visible yet');
      }
    }

    // Step 4: Submit
    try {
      const submitBtn = page.locator(
        'button[type="submit"], button:has-text("Log in"), button:has-text("Sign in"), button:has-text("Continue"), button:has-text("Next")'
      ).first();
      await submitBtn.waitFor({ timeout: 5000 });
      await submitBtn.click();
      console.log('  ✓ Submitted');
      await page.waitForTimeout(3000);
    } catch {
      await page.keyboard.press('Enter');
      await page.waitForTimeout(3000);
    }

    // Step 5: Handle two-step login (password appears after email submit)
    if (credentials.password) {
      try {
        const passwordInput = page.locator('input[type="password"]').first();
        await passwordInput.waitFor({ timeout: 5000 });
        await passwordInput.fill(credentials.password);
        console.log('  ✓ Password filled (two-step)');
        const submitBtn = page.locator(
          'button[type="submit"], button:has-text("Log in"), button:has-text("Sign in")'
        ).first();
        await submitBtn.click();
        await page.waitForTimeout(3000);
      } catch {
        // Already handled
      }
    }

    // Step 6: Check for OTP
    await page.waitForTimeout(2000);
    const otpDetected = await this.detectOTPScreen(page);
    if (otpDetected) {
      console.log('  OTP screen detected — fetching from Gmail...');
      const otpResult = await this.handleOTP(page);
      if (!otpResult) {
        return { success: false, method: 'otp', message: 'OTP fetch failed' };
      }
    }

    // Step 7: Verify login
    await page.waitForTimeout(2000);
    const loggedIn = await this.verifyLoggedIn(page);

    return {
      success: loggedIn,
      method: otpDetected ? 'otp' : 'password',
      message: loggedIn ? 'Login successful' : 'Login verification failed',
    };
  }

  private async detectLoginForm(page: Page): Promise<boolean> {
    try {
      const emailField = page.locator(
        'input[type="email"], input[name="email"], input[name="username"], input[name="identifier"]'
      ).first();
      return await emailField.isVisible({ timeout: 5000 });
    } catch {
      return false;
    }
  }

  private async detectOTPScreen(page: Page): Promise<boolean> {
    try {
      const pageText = await page.textContent('body') || '';
      const url = page.url();
      const lower = pageText.toLowerCase();
      return lower.includes('verification code') ||
        lower.includes('check your email') ||
        lower.includes('enter the code') ||
        lower.includes('one-time') ||
        lower.includes('otp') ||
        url.includes('verify') ||
        url.includes('otp') ||
        url.includes('challenge');
    } catch {
      return false;
    }
  }

  private async handleOTP(page: Page): Promise<boolean> {
    console.log('  Waiting 8 seconds for OTP email...');
    await page.waitForTimeout(8000);

    const otp = await this.fetchOTPFromGmail();
    if (!otp) {
      console.log('  ✗ Could not fetch OTP from Gmail');
      return false;
    }

    console.log(`  ✓ OTP fetched: ${otp}`);

    try {
      const otpInput = page.locator(
        'input[type="text"], input[type="number"], input[autocomplete="one-time-code"], input[name="code"]'
      ).first();
      await otpInput.waitFor({ timeout: 5000 });
      await otpInput.fill(otp);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(3000);
      console.log('  ✓ OTP submitted');
      return true;
    } catch {
      await page.keyboard.type(otp);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(3000);
      return true;
    }
  }

  private async fetchOTPFromGmail(): Promise<string | null> {
    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        mcp_servers: [
          {
            type: 'url' as any,
            url: 'https://gmail.mcp.claude.com/mcp',
            name: 'gmail',
          }
        ],
        messages: [
          {
            role: 'user',
            content: `Search Gmail for the most recent OTP or verification code email received in the last 5 minutes.
Search for emails with subjects containing: "verification", "OTP", "code", "confirm", "authenticate", "login", "access".
Extract ONLY the numeric code (usually 4-8 digits) from the email body.
Reply with ONLY the numeric code, nothing else. If no OTP found, reply with "NONE".`,
          }
        ],
      } as any);

      const text = response.content
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('');

      if (text.trim() === 'NONE') return null;
      const match = text.match(/\b\d{4,8}\b/);
      return match ? match[0] : null;
    } catch (error) {
      console.error('Gmail fetch error:', error);
      return null;
    }
  }

  private async verifyLoggedIn(page: Page): Promise<boolean> {
    try {
      const url = page.url();
      return !url.includes('login') &&
        !url.includes('signin') &&
        !url.includes('sign-in') &&
        !url.includes('auth') &&
        !url.includes('challenge');
    } catch {
      return false;
    }
  }
}