import * as pulumi from "@pulumi/pulumi";
import * as cloudflare from "@pulumi/cloudflare";
import * as fs from "fs";
import * as path from "path";

// Get the Cloudflare account ID from config
const config = new pulumi.Config();
const accountId = config.require("cloudflareAccountId");

// 1. D1 Database
const d1Database = new cloudflare.D1Database("ranking-db", {
    accountId: accountId,
    name: "ranking-db",
});

// 2. Turnstile Site
const turnstileSite = new cloudflare.TurnstileWidget("ranking-turnstile", {
    accountId: accountId,
    name: "ranking-app-turnstile",
    domains: ["aisoftwareengineering.com"], // Replace with your domain
    mode: "managed",
});

// 3. Cloudflare Worker (API)
const apiWorker = new cloudflare.WorkerScript("api-worker", {
    accountId: accountId,
    name: "ranking-api",
    content: fs.readFileSync(path.join(__dirname, "..", "packages", "api", "dist", "index.js"), "utf-8"),
    d1DatabaseBindings: [{
        name: "DB",
        databaseId: d1Database.id,
    }],
    secrets: [{
        name: "TURNSTILE_SECRET_KEY",
        text: turnstileSite.secret,
    }],
    module: true,
});

// 4. Cloudflare Pages Project (Frontend)
const frontendPages = new cloudflare.PagesProject("frontend-pages", {
    accountId: accountId,
    name: "ranking-frontend",
    productionBranch: "main",
    source: {
        type: "local_upload",
        config: {
            deployments: [{
                assets: [{
                    path: path.join(__dirname, "..", "packages", "frontend", "dist"),
                }],
            }],
        },
    },
    buildConfig: {
        buildCommand: "pnpm --filter frontend build",
        destinationDir: "dist",
    },
});

// Export the URLs and other important info
export const apiEndpoint = apiWorker.name.apply(name => `https://\${name}.your-worker-subdomain.workers.dev`); // Replace with your worker subdomain
export const frontendUrl = frontendPages.domains[0];
export const turnstileSiteKey = turnstileSite.sitekey;
