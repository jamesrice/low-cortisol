# Cloudflare Workers & GitHub Auto-Deploy Setup

This repository is self-contained and pre-configured for **Cloudflare Workers Static Assets** (`wrangler.jsonc`). Running `npm run build` produces the React/Vite SPA in `dist/` and pre-bundles the local WebGPU scenes (`public/scenes/`) into `dist/scenes/bundle.js` alongside the runtime `AudioWorklet` processors—no external proxy or runtime Worker script is required.

---

## Option A — Native Cloudflare Git Integration (Easiest, Zero API Tokens)

1. Push this repository to GitHub (`jamesrice/low-cortisol`, branch `main`).
2. Open **Cloudflare Dashboard** → **Workers & Pages** → **`collision`** (or **Create → Workers → Connect to Git**).
3. Select repository **`jamesrice/low-cortisol`** and branch **`main`**.
4. Configure the build settings:
   - **Build command**: `npm run build`
   - **Deploy command**: `npx wrangler deploy`
5. Click **Save and Deploy**. Every push to `main` automatically builds and deploys to Cloudflare's edge.

---

## Option B — GitHub Actions CI/CD Auto-Deploy (Included Workflow)

`.github/workflows/deploy-cloudflare.yml` automatically runs `npm ci`, `npm test`, `npm run lint`, `npm run build`, and deploys via `cloudflare/wrangler-action@v3` on every push to `main`.

1. In Cloudflare Dashboard → **My Profile → API Tokens → Create Token**, use the **Edit Cloudflare Workers** template.
2. In your GitHub repository → **Settings → Secrets and variables → Actions**, add two repository secrets:
   - `CLOUDFLARE_API_TOKEN` — your Workers API token
   - `CLOUDFLARE_ACCOUNT_ID` — your Cloudflare Account ID (found in the right sidebar of Workers & Pages)
3. Push to `main` (or trigger manually from the **Actions** tab).

---

## Local Pre-Deploy Verification

```bash
npm test
npm run lint
npm run build
npm run preview
```

---

## Connecting Custom Domains (e.g., `collision.backlands.com`)

You can attach custom domains in **either** of two ways:

1. **Cloudflare Dashboard (Recommended)**:
   - Open your Worker (`collision`) → **Settings → Domains & Routes → + Add → Custom Domain**.
   - Enter your domain (for example, `collision.backlands.com`). Cloudflare automatically provisions DNS records and TLS certificates.
2. **Infrastructure-as-Code (`wrangler.jsonc`)**:
   - Uncomment the `routes` block in `wrangler.jsonc`:
     ```jsonc
     "routes": [
       { "pattern": "collision.backlands.com", "custom_domain": true }
     ]
     ```
   - Push to `main` to bind the domain automatically on deploy.
