# Link Ranking Website

This is a full-stack, open-source link ranking application similar to Digg, built entirely on the Cloudflare serverless platform.

## Features

*   **Ranked Link Display:** View links in a list sorted by score.
*   **Submission:** Users can submit new links (URL and title).
*   **Voting:** Upvote and downvote links.
*   **Spam Protection:** Cloudflare Turnstile (CAPTCHA) protects submissions and voting.
*   **Serverless:** Runs on Cloudflare Workers, Pages, and D1.
*   **Infrastructure as Code:** Cloudflare resources (Database, DNS, Pages, Worker) are managed with Pulumi.

## Tech Stack

*   **Frontend:** Vanilla TypeScript, HTML, CSS, powered by Vite.
*   **Backend:** REST API with Hono on Cloudflare Workers.
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
    cd cloudflare-ranking
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

### 2. Start the Backend Worker

In the first terminal, run the API worker.
```bash
pnpm --filter ranking-api dev
```

### 3. Start the Frontend Dev Server

In the second terminal, run the Vite dev server for the frontend.
```bash
pnpm --filter frontend dev
```

Now you can open your browser to `http://localhost:5173`.

---

## Deployment

Deployment is managed by Pulumi and includes infrastructure setup and DNS configuration.

### 1. Configure Pulumi

Set your Cloudflare Account ID and API Token in the Pulumi configuration.

```bash
cd pulumi

# Set your Cloudflare Account ID
pulumi config set ranking-app:cloudflareAccountId <YOUR_CLOUDFLARE_ACCOUNT_ID>

# Set your Cloudflare API Token (as a secret)
pulumi config set cloudflare:apiToken <YOUR_CLOUDFLARE_API_TOKEN> --secret
```

### 2. Build and Deploy

You can deploy everything from the root directory:

```bash
# Build the project
pnpm build

# Deploy infrastructure (including DNS and domain setup)
pnpm deploy:infra
```

### 3. Apply Database Migration

The first time you deploy, you must apply the database migration to your production D1 database.

```bash
pnpm --filter ranking-api exec wrangler d1 migrations apply ranking-db --remote
```

---

## DNS and Domains

This project automatically manages the following via Pulumi:
- **Custom Domain**: Links `aisoftwareengineering.com` to Cloudflare Pages.
- **DNS Records**: Creates the necessary CNAME records.
- **Worker Routes**: (Optional) Can be configured to route through the apex domain.

Currently, the frontend is configured to talk to the backend at `https://ranking-api.mparaz.workers.dev`.

---

## Admin Workflow

New links are created with a `pending` status and must be manually approved.

### Listing Links
```bash
pnpm --filter ranking-api exec wrangler d1 execute ranking-db --remote --command "SELECT id, title, url, status FROM links;"
```

### Approving Links
```bash
# Approve all pending
pnpm --filter ranking-api exec wrangler d1 execute ranking-db --remote --command "UPDATE links SET status = 'approved' WHERE status = 'pending';"

# Approve specific ID
pnpm --filter ranking-api exec wrangler d1 execute ranking-db --remote --command "UPDATE links SET status = 'approved' WHERE id = 123;"
```

---

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
