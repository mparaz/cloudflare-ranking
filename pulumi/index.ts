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
    domains: ["aisoftwareengineering.com", "pages.dev"],
    mode: "managed",
});

// 3. Cloudflare Worker (API)
const apiWorker = new cloudflare.WorkersScript("api-worker", {
    accountId: accountId,
    scriptName: "ranking-api",
    content: fs.readFileSync(path.join(__dirname, "..", "packages", "api", "dist", "index.js"), "utf-8"),
    bindings: [{
        name: "DB",
        type: "d1",
        id: d1Database.id,
    }, {
        name: "TURNSTILE_SECRET_KEY",
        type: "secret_text",
        text: turnstileSite.secret,
    }],
    mainModule: "index.js",
    compatibilityDate: "2025-09-27",
});

// 4. Cloudflare Pages Project (Frontend)
const frontendPages = new cloudflare.PagesProject("frontend-pages", {
    accountId: accountId,
    name: "ranking-frontend",
    productionBranch: "main",
    buildConfig: {
        buildCommand: "pnpm --filter frontend build",
        destinationDir: "dist",
    },
    deploymentConfigs: {
        production: {
            envVars: {
                VITE_TURNSTILE_SITE_KEY: {
                    type: "plain_text",
                    value: turnstileSite.sitekey,
                },
                VITE_API_BASE_URL: {
                    type: "plain_text",
                    value: "https://api.mparaz.workers.dev",
                },
            },
        },
        preview: {
            envVars: {
                VITE_TURNSTILE_SITE_KEY: {
                    type: "plain_text",
                    value: turnstileSite.sitekey,
                },
                VITE_API_BASE_URL: {
                    type: "plain_text",
                    value: "https://api.mparaz.workers.dev",
                },
            },
        },
    },
});

// 5. Custom Domain for Pages
const zone = cloudflare.getZoneOutput({
    filter: {
        name: "aisoftwareengineering.com",
    },
});

const pagesDomain = new cloudflare.PagesDomain("frontend-custom-domain", {
    accountId: accountId,
    projectName: frontendPages.name,
    name: "aisoftwareengineering.com",
});

// 6. DNS Record for the custom domain
const pagesCname = new cloudflare.DnsRecord("pages-cname", {
    zoneId: zone.id,
    name: "@",
    type: "CNAME",
    content: frontendPages.subdomain,
    proxied: true,
    ttl: 1,
});

// Export the URLs and other important info
export const frontendUrl = pulumi.interpolate`https://aisoftwareengineering.com`;
export const turnstileSiteKey = turnstileSite.sitekey;
