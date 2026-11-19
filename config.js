// 後端（Cloudflare Worker）的網址。部署 Worker 後，把下面這一行換成你的 Worker 網址。
// 在自己電腦上測試時（網址是 localhost）會自動連到本機的 8787 埠。
window.API_BASE = /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
  ? "http://localhost:8787"
  : "https://mock-review-api.mock-review-api.workers.dev";
