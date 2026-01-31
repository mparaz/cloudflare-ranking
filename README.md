# Link Ranking Website

This is a full-stack, open-source link ranking application similar to Digg, built entirely on the Cloudflare serverless platform.

## Features

*   **Ranked Link Display:** View links in a list sorted by score.
*   **Submission:** Users can submit new links (URL and title).
*   **Voting:** Upvote and downvote links.
*   **Spam Protection:** Cloudflare Turnstile (CAPTCHA) protects submissions and voting.
*   **Serverless:** Runs on Cloudflare Workers, Pages, and D1.
*   **Infrastructure as Code:** Cloudflare resources are managed with Pulumi.

## Tech Stack

*   **Frontend:** Vanilla TypeScript, HTML, CSS, powered by Vite.
*   **Backend:** REST API with Cloudflare Workers (TypeScript).
*   **Database:** Cloudflare D1 (SQL).
*   **IaC:** Pulumi.
*   **Monorepo Management:** pnpm workspaces.

---

## Getting Started

### Prerequisites

*   [Node.js](https://nodejs.org/) (v18 or later)
*   [pnpm](https://pnpm.io/installation)
*   [Pulumi CLI](https://www.pulumi.com/docs/get-started/install/)
*   A [Cloudflare account](https://dash.cloudflare.com/sign-up)
*   A registered domain name configured in your Cloudflare account.

### Installation

1.  **Clone the repository:**
    ```bash
    git clone <repository-url>
    cd <repository-directory>
    ```

2.  **Install dependencies:**
    ```bash
    pnpm install
    ```

---

## Development

To run the application locally, you'll need two terminal sessions.

### 1. Configure Local Secrets

Before starting the backend, create a `.dev.vars` file in the `packages/api` directory. This file will hold your local secrets. **Do not commit this file.**

```ini
# packages/api/.dev.vars

TURNSTILE_SECRET_KEY="1x0000000000000000000000000000000AA"
```

You should use the "Testing Keys" for Turnstile from the Cloudflare documentation for local development. The secret key above is a test key.

### 2. Start the Backend Worker

In the first terminal, run the API worker. This will start a local server for your worker on port `8787` and create a local D1 database.
```bash
pnpm --filter api dev
```

### 3. Start the Frontend Dev Server

In the second terminal, run the Vite dev server for the frontend. This will be available on port `5173` by default and will proxy API requests to the worker.
```bash
pnpm --filter frontend dev
```

Now you can open your browser to `http://localhost:5173` to see the application. The frontend is pre-configured with a test site key for Turnstile, so it will work out-of-the-box locally.

### Troubleshooting

If you get a "no such table: links" error in your API terminal, it means the local database migration did not run automatically. You can run it manually. Keep the `dev` server running and, in a new terminal, run:

```bash
pnpm --filter api exec wrangler d1 migrations apply ranking-db --local
```

---

## Deployment

Deployment is handled by Pulumi.

### 1. Log in to Pulumi

If you're using the Pulumi Service backend (free tier available), log in:
```bash
pulumi login
```

### 2. Configure Cloudflare Account

You need to set your Cloudflare Account ID so Pulumi can create resources in your account.

```bash
# From the pulumi/ directory
cd pulumi

# Set your Cloudflare Account ID
pulumi config set cloudflare:accountId <YOUR_CLOUDFLARE_ACCOUNT_ID>
```
You can find your Account ID in the Cloudflare dashboard on the right-hand side of the overview page for any of your domains.

You may also need to set your Cloudflare API token as an environment variable:
```bash
export CLOUDFLARE_API_TOKEN=<YOUR_CLOUDFLARE_API_TOKEN>
```

### 3. Build the Projects

Before deploying, you need to build the frontend and backend code.
```bash
# From the root directory
pnpm build
```

### 4. Deploy with Pulumi

Run `pulumi up` to preview and deploy the infrastructure.

```bash
# From the pulumi/ directory
pulumi up
```

Pulumi will show you a preview of the resources that will be created. If everything looks correct, confirm the deployment.

After the deployment is complete, Pulumi will output the `frontendUrl`, `apiEndpoint`, and `turnstileSiteKey`.

### 5. Apply Database Migration

The first time you deploy, you must apply the database migration to your new production D1 database.

```bash
# From the root directory
pnpm --filter api exec wrangler d1 migrations apply ranking-db --remote
```

### 6. Update Turnstile Site Key

Replace the placeholder Turnstile site key in `packages/frontend/src/main.ts` with the one from the Pulumi output. You will need the `turnstileSiteKey` for this.

```typescript
// packages/frontend/src/main.ts
// ...
(window as any).turnstile.render(turnstileContainer, {
    sitekey: 'YOUR_NEW_SITE_KEY', // <-- Replace this
    callback: function(token: string) {
// ...
```

After updating the key, you'll need to rebuild and redeploy.

```bash
pnpm build
cd pulumi
pulumi up
```

---

## Post-Deployment: DNS Configuration

This project's Pulumi setup does **not** manage DNS records. You must configure this manually in your Cloudflare dashboard.

### 1. Point Your Domain to Cloudflare Pages

Navigate to your site in the Cloudflare Dashboard, then go to **DNS** > **Records**. You need to create a `CNAME` record pointing your desired domain or subdomain to the Cloudflare Pages project.

*   **Type:** `CNAME`
*   **Name:** `@` (for the root domain, e.g., `aisoftwareengineering.com`) or a subdomain (e.g., `ranking`).
*   **Target:** The URL of your deployed Pages project (from the Pulumi output, e.g., `ranking-frontend.pages.dev`).
*   **Proxy status:** Enabled (Orange Cloud).

### 2. Route API Traffic to the Worker

You need to create a route so that requests to `/api/*` on your domain are handled by your deployed worker.

1.  Navigate to your site in the Cloudflare Dashboard.
2.  Go to **Workers Routes**.
3.  Click **Add route**.
4.  **Route:** `*your-domain.com/api/*` (e.g., `aisoftwareengineering.com/api/*`)
5.  **Service:** Select your `ranking-api` worker from the dropdown.
6.  **Environment:** `production`
7.  Click **Save**.

Now, your live site should be fully functional.

---

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.