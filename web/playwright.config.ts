import { chromium, defineConfig, devices } from '@playwright/test';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Chromium a usar. Ordem: PW_CHROMIUM_PATH; o da versão do Playwright, se baixado; senão qualquer Chromium já
 * instalado (ms-playwright no Windows/Linux ou /opt/pw-browsers na nuvem). Nunca baixa nada.
 */
function findChromium(): string | undefined {
  if (process.env.PW_CHROMIUM_PATH) return process.env.PW_CHROMIUM_PATH;
  if (existsSync(chromium.executablePath())) return undefined;
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    '/opt/pw-browsers',
    join(homedir(), 'AppData', 'Local', 'ms-playwright'),
    join(homedir(), '.cache', 'ms-playwright'),
  ].filter((r): r is string => !!r && existsSync(r));
  const candidates = [
    ['chromium_headless_shell-', 'chrome-headless-shell-win64/chrome-headless-shell.exe'],
    ['chromium_headless_shell-', 'chrome-headless-shell-linux64/chrome-headless-shell'],
    ['chromium-', 'chrome-win64/chrome.exe'],
    ['chromium-', 'chrome-win/chrome.exe'],
    ['chromium-', 'chrome-linux/chrome'],
    ['chromium-', 'chrome-linux64/chrome'],
  ];
  for (const root of roots) {
    const dirs = readdirSync(root).sort().reverse();
    for (const [prefix, exe] of candidates) {
      for (const dir of dirs.filter((d) => d.startsWith(prefix))) {
        const path = join(root, dir, exe);
        if (existsSync(path)) return path;
      }
    }
  }
  return undefined;
}

// Teste visual automático: sobe o Vite, abre o jogo headless, joga sozinho (input simulado), tira prints e grava vídeo.
// Na nuvem, os navegadores ficam em /opt/pw-browsers: se a versão não bater, apontar PW_CHROMIUM_PATH para o chrome.
export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    viewport: { width: 1280, height: 720 },
    // Vídeo gravado pelo e2e/recorder.ts (não depende do ffmpeg da versão exata do Playwright).
    video: 'off',
    launchOptions: {
      executablePath: findChromium(),
      // Windows: GPU de verdade pelo D3D11 (60 FPS). Nuvem/Linux sem GPU: SwiftShader (~20 FPS, ainda testável).
      args:
        process.platform === 'win32'
          ? ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11']
          : ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } } }],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
