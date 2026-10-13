import { app, BrowserWindow, ipcMain, net } from 'electron';
import { rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { registerAppScheme, serveAppScheme } from '../../src/main/appProtocol';
import { allEmoteAssetFiles } from '../../src/shared/emotes';
import { OVERLAY_ASSETS, OVERLAY_PINGED } from '../../src/shared/ipc';

// Uses the real protocol, production renderer and preload, with isolated data and no input hooks.
registerAppScheme();
app.on('window-all-closed', () => {}); // cleanup completes before the scenario's exit code is published
const root = resolve(process.argv[2] ?? '.');
const measureOnly = process.argv.includes('--measure');
const timeout = setTimeout(() => { console.error('FAIL: asset scenario timed out'); app.exit(1); }, 30_000);
const windows: BrowserWindow[] = [];
const temporary = resolve(process.argv[3]);
app.setPath('userData', temporary);

async function waitFor(win: BrowserWindow, expression: string): Promise<void> {
  const end = performance.now() + 5000;
  while (!await win.webContents.executeJavaScript(expression)) {
    if (performance.now() > end) throw new Error(`renderer did not reach: ${expression}`);
    await new Promise((done) => setTimeout(done, 20));
  }
}

async function run(): Promise<void> {
  await app.whenReady();
  serveAppScheme({ rendererRoot: join(root, 'out/renderer'), emoteDirs: () => [temporary] });
  const images = allEmoteAssetFiles().filter((file) => !file.endsWith('.ogg'));
  let transferred = 0;
  const start = performance.now();
  for (const file of images) {
    const response = await net.fetch(`lolping://app/${file}`, { method: 'HEAD' });
    if (!response.ok) throw new Error(`${file}: ${response.status}`);
    transferred += (await response.arrayBuffer()).byteLength;
  }
  console.log(JSON.stringify({ scenario: 'emote probes', files: images.length, bodyBytes: transferred, ms: performance.now() - start }));
  if (!measureOnly && transferred !== 0) throw new Error('HEAD probes transferred asset bodies');
  // GET must still supply the file that the renderer decodes; traversal must remain outside the served root.
  const first = await net.fetch(`lolping://app/${images[0]}`);
  if ((await first.arrayBuffer()).byteLength === 0) throw new Error('GET returned an empty asset');
  for (const url of ['lolping://other/overlay/index.html', 'lolping://app/%2e%2e%2fpackage.json']) {
    const response = await net.fetch(url);
    if (response.ok) throw new Error(`unexpected file access: ${url}`);
  }
  const hash = 'a'.repeat(32);
  const still = join(temporary, `${hash}.webp`);
  await writeFile(still, new Uint8Array([1, 2, 3]));
  let custom = await net.fetch(`lolping://emotes/${hash}.anim`);
  if (custom.headers.get('cache-control') !== 'no-store' || (await custom.arrayBuffer()).byteLength !== 3) {
    throw new Error('custom animation did not fall back to the uncached still');
  }
  await rm(still);
  custom = await net.fetch(`lolping://emotes/${hash}.anim`);
  if (custom.status !== 404) throw new Error('deleted custom emote remained available');
  await writeFile(still, new Uint8Array([4, 5]));
  custom = await net.fetch(`lolping://emotes/${hash}.anim`);
  if ((await custom.arrayBuffer()).byteLength !== 2) throw new Error('reimported emote remained stale');

  const requests: string[] = [];
  const missing: string[] = [];
  const pinged: unknown[] = [];
  ipcMain.on(OVERLAY_ASSETS, (_event, files: string[]) => missing.push(...files));
  ipcMain.on(OVERLAY_PINGED, (_event, ping) => pinged.push(ping));
  // Two independent production overlay instances exercise the per-display loading path.
  for (let i = 0; i < 2; i++) {
    const win = new BrowserWindow({ show: false, webPreferences: {
      preload: join(root, 'out/preload/overlay.js'), backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required',
    } });
    windows.push(win);
    if (i === 0) win.webContents.session.webRequest.onBeforeRequest((details, done) => {
      if (details.url.startsWith('lolping://app/') && /\/emotes\/[^/]+\.(webp|png)$/.test(details.url)) requests.push(`${details.method} ${details.url}`);
      done({});
    });
    await win.loadURL('lolping://app/overlay/index.html');
    await waitFor(win, 'document.querySelectorAll("#wheel .icon").length === 8');
    win.webContents.send('wheel:open', { x: 200, y: 200, wheel: 'ping' });
    await waitFor(win, 'document.querySelector("#wheel").classList.contains("open")');
    win.webContents.send('wheel:move', { x: 200, y: 100, wheel: 'ping' });
    win.webContents.send('wheel:release', { x: 200, y: 100, wheel: 'ping' });
    await waitFor(win, '!document.querySelector("#wheel").classList.contains("open") && document.querySelector("#pings").childElementCount > 0');
    win.webContents.send('emote:spawn', { owner: 'self', art: { kind: 'bundled', slug: 'facepalm' }, x: 200, y: 200 });
    await waitFor(win, 'Boolean(document.querySelector(".emote .sheet")?.naturalWidth)');
    win.webContents.send('emote:clear', { owner: 'self' });
    await waitFor(win, 'document.querySelector("#emotes").childElementCount === 0');
  }
  const headCount = requests.filter((request) => request.startsWith('HEAD ')).length;
  if (!measureOnly && headCount !== images.length * 2) throw new Error(`expected ${images.length * 2} probes, got ${headCount}`);
  if (missing.length || pinged.length !== 2) throw new Error(`missing=${missing.join(',')} pings=${pinged.length}`);
  console.log(JSON.stringify({ scenario: 'production overlays', windows: windows.length, headCount, pings: pinged.length, missing }));
}

run().then(() => 0, (error) => { console.error('FAIL:', error); return 1; }).then((code) => {
  clearTimeout(timeout);
  for (const win of windows) win.destroy();
  app.exit(code);
});
