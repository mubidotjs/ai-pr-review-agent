// Rebuild local PNG derivatives of the code-owned icon. No remote assets/services.
import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const svg = await readFile('public/prism-icon.svg', 'utf8');
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  await page.route('**/*', (route) => route.abort());
  for (const [size, name] of [
    [32, 'favicon-32'],
    [180, 'apple-touch-icon'],
    [192, 'icon-192'],
    [512, 'icon-512'],
  ] as const) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<style>html,body{margin:0;width:100%;height:100%}svg{display:block;width:100%;height:100%}</style>${svg}`,
    );
    await page.screenshot({ path: `public/${name}.png`, omitBackground: true });
  }
  await page.setViewportSize({ width: 1200, height: 630 });
  await page.setContent(
    `<style>html,body{margin:0;background:#101714;color:#f0efdf;font-family:Arial,sans-serif}main{padding:70px 80px}header{display:flex;align-items:center;gap:20px;font-size:28px;letter-spacing:7px;font-weight:700}svg{width:66px;height:66px}h1{font-size:64px;line-height:1.12;letter-spacing:-2px;margin:52px 0 24px}p{font-size:25px;color:#b7c5ba;margin:0}footer{margin-top:48px;font-size:18px;color:#b7d7a5;letter-spacing:1px}</style><main><header>${svg} PRISM</header><h1>Investigate the diff.<br>Verify the evidence.</h1><p>AI pull request review. Human-approved suggestions.</p><footer>prism.mubashirhussain.dev</footer></main>`,
  );
  await page.screenshot({ path: 'public/social-card.png' });
} finally {
  await browser.close();
}
