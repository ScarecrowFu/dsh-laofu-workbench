import { LOGO_PATH } from './branding.mjs'

export const PARKED_TAB_PATH = '/lwb/tab-parked'

/**
 * Where an older workbench tab goes when a newer one takes over.
 *
 * In a plain browser every workbench tab holds the HMR EventSource open for its
 * whole life, and Chromium allows six HTTP/1.1 connections per host across all
 * tabs. Six forgotten tabs leave nothing for `/api`, and every page then waits
 * forever. This page is static on purpose: it loads no client, so a parked tab
 * holds no connection, and its only control is a plain link back.
 */
export const PARKED_TAB_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>老傅工作台 · 已在其他标签页打开</title>
<link rel="icon" type="image/png" href="${LOGO_PATH}">
<style>
  :root { color-scheme: light dark; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f6f7f9; color: #1f2329; }
  main { max-width: 420px; padding: 32px; text-align: center; }
  img { width: 48px; height: 48px; object-fit: contain; }
  h1 { font-size: 20px; margin: 16px 0 8px; }
  p { font-size: 14px; line-height: 1.6; color: #646a73; margin: 0 0 20px; }
  a { display: inline-block; padding: 8px 18px; border-radius: 6px; background: #3370ff; color: #fff; text-decoration: none; font-size: 14px; }
  .en { margin-top: 24px; font-size: 12px; }
  @media (prefers-color-scheme: dark) {
    body { background: #18191b; color: #e8e9eb; }
    p { color: #a0a4ab; }
  }
</style>
</head>
<body>
<main>
  <img src="${LOGO_PATH}" alt="Laofu Workbench">
  <h1>工作台已在其他标签页打开</h1>
  <p>多个标签页同时连接会占满浏览器的连接数，让所有页面一直停在“加载中”，所以这个标签页已暂停。</p>
  <a href="/">在此标签页继续使用</a>
  <p class="en">Laofu Workbench is open in another tab, so this one has been paused. Use the button to continue here instead.</p>
</main>
</body>
</html>
`

/** Serve the parked-tab page through the Host. */
export function registerLwbParkedTab(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PARKED_TAB_PATH,
    handler(request, response) {
      if (!['GET', 'HEAD'].includes(request.method)) {
        response.writeHead(405, { allow: 'GET, HEAD' })
        response.end()
        return
      }
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      })
      response.end(request.method === 'HEAD' ? undefined : PARKED_TAB_HTML)
    },
  }), 'lwb-parked-tab: parked tab page')
}
