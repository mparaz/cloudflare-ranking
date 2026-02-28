console.log("--- RUNNING LATEST API CODE ---");

import { Hono } from 'hono';
import { sentry } from '@hono/sentry';
import { logAnalytics } from './analytics';

// Define the environment interface
export interface Env {
	DB: D1Database;
	TURNSTILE_SECRET_KEY: string;
	AE: AnalyticsEngineDataset;
	SENTRY_DSN?: string;
	ALLOWED_ORIGINS?: string;
	CAPTCHA_SESSION_TTL_SECONDS?: string;
}

type Bindings = {
    DB: D1Database;
    TURNSTILE_SECRET_KEY: string;
    AE: AnalyticsEngineDataset;
    SENTRY_DSN?: string;
    ALLOWED_ORIGINS?: string;
    CAPTCHA_SESSION_TTL_SECONDS?: string;
}

const app = new Hono<{ Bindings: Bindings }>();

// Analytics Middleware
app.use('*', async (c, next) => {
    logAnalytics(c.req.raw, c.env);
    await next();
});

// CORS Middleware (credentials-safe, explicit origins)
app.use('*', async (c, next) => {
	const origin = c.req.header('Origin') ?? '';
	const allowedOrigins = (c.env.ALLOWED_ORIGINS ?? '')
		.split(',')
		.map(value => value.trim())
		.filter(Boolean);

	if (origin && allowedOrigins.includes(origin)) {
		c.header('Access-Control-Allow-Origin', origin);
		c.header('Vary', 'Origin');
		c.header('Access-Control-Allow-Credentials', 'true');
		c.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
		c.header('Access-Control-Allow-Headers', 'Content-Type');
	}

	if (c.req.method === 'OPTIONS') {
		return c.body(null, 204);
	}

	await next();
});

// Sentry Middleware
app.use('*', (c, next) => {
    if (c.env.SENTRY_DSN) {
        return sentry({
            dsn: c.env.SENTRY_DSN,
        })(c, next);
    }
    return next();
});


// Scoring function
function calculateScore(upvotes: number, downvotes: number): number {
	return upvotes - downvotes;
}

const CAPTCHA_SESSION_COOKIE = 'captcha_session';
const DEFAULT_CAPTCHA_SESSION_TTL_SECONDS = 10 * 60;

function getCaptchaSessionTtlSeconds(env: Bindings): number {
	const raw = env.CAPTCHA_SESSION_TTL_SECONDS;
	if (!raw) return DEFAULT_CAPTCHA_SESSION_TTL_SECONDS;
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) ? parsed : DEFAULT_CAPTCHA_SESSION_TTL_SECONDS;
}

function getCookieValue(cookieHeader: string | undefined | null, name: string): string | null {
	if (!cookieHeader) return null;
	const parts = cookieHeader.split(';');
	for (const part of parts) {
		const [key, ...rest] = part.trim().split('=');
		if (key === name) {
			return rest.join('=');
		}
	}
	return null;
}

async function sha256Hex(input: string): Promise<string> {
	const data = new TextEncoder().encode(input);
	const digest = await crypto.subtle.digest('SHA-256', data);
	return Array.from(new Uint8Array(digest))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

async function computeClientHash(c: any): Promise<{ ipHash: string; uaHash: string }> {
	const ip = c.req.header('CF-Connecting-IP') ?? '';
	const ua = c.req.header('User-Agent') ?? '';
	const salt = c.env.TURNSTILE_SECRET_KEY;
	const ipHash = await sha256Hex(`${ip}:${salt}`);
	const uaHash = await sha256Hex(`${ua}:${salt}`);
	return { ipHash, uaHash };
}

// Turnstile validation middleware
const validateTurnstile = async (c: any, next: any) => {
    const body = await c.req.json();
    const token = body.token;
    const ip = c.req.header('CF-Connecting-IP');

    if (!token) {
        return c.json({ error: 'CAPTCHA token is required' }, 400);
    }

    let formData = new FormData();
    formData.append('secret', c.env.TURNSTILE_SECRET_KEY);
    formData.append('response', token);
    if (ip) {
        formData.append('remoteip', ip);
    }

    const result = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        body: formData,
        method: 'POST',
    });

    const outcome: any = await result.json();
    if (!outcome.success) {
        console.error('Turnstile failure:', outcome);
        return c.json({ 
            error: 'CAPTCHA validation failed', 
            details: outcome['error-codes'] || [] 
        }, 403);
    }
    
    c.req.body = body; // Store body for next middleware
    await next();
};

// CAPTCHA session requirement middleware (cookie + server-side record)
const requireCaptchaSession = async (c: any, next: any) => {
	const cookieHeader = c.req.header('Cookie');
	const sessionId = getCookieValue(cookieHeader, CAPTCHA_SESSION_COOKIE);
	if (!sessionId) {
		return c.json({ error: 'CAPTCHA session required' }, 403);
	}

	const { results } = await c.env.DB
		.prepare('SELECT id, ip_hash, ua_hash, expires_at FROM captcha_sessions WHERE id = ?')
		.bind(sessionId)
		.all();

	if (!results.length) {
		return c.json({ error: 'CAPTCHA session invalid' }, 403);
	}

	const session = results[0] as { expires_at: number; ip_hash: string; ua_hash: string };
	const now = Math.floor(Date.now() / 1000);
	if (session.expires_at <= now) {
		await c.env.DB.prepare('DELETE FROM captcha_sessions WHERE id = ?').bind(sessionId).run();
		return c.json({ error: 'CAPTCHA session expired' }, 403);
	}

	const { ipHash, uaHash } = await computeClientHash(c);
	if (session.ip_hash !== ipHash || session.ua_hash !== uaHash) {
		return c.json({ error: 'CAPTCHA session mismatch' }, 403);
	}

	await next();
};


// GET /links - Get all approved links
app.get('/links', async (c) => {
	try {
		const { results } = await c.env.DB.prepare('SELECT * FROM links WHERE status = ? ORDER BY created_at DESC').bind('approved').all();
		
		const now = new Date();
		const oneWeekInMs = 7 * 24 * 60 * 60 * 1000;

		const links = results.map(link => {
			const score = calculateScore(link.upvotes as number, link.downvotes as number);
			const createdDate = new Date((link.created_at as string) + ' UTC');
			const isFresh = (now.getTime() - createdDate.getTime()) < oneWeekInMs;
			return {
				...link,
				score,
				isFresh
			};
		}).sort((a, b) => {
			// 1. Fresh links first
			if (a.isFresh && !b.isFresh) return -1;
			if (!a.isFresh && b.isFresh) return 1;
			
			// 2. Then by score
			if (b.score !== a.score) return b.score - a.score;
			
			// 3. Then by date
			return new Date((b.created_at as string) + ' UTC').getTime() - new Date((a.created_at as string) + ' UTC').getTime();
		});

		return c.json(links);
	} catch (e: any) {
		console.error(e);
		return c.json({ error: 'Error fetching links', message: e.message }, 500);
	}
});

// GET /links.html - Get all approved links as an HTML page
app.get('/links.html', async (c) => {
	try {
		const { results } = await c.env.DB.prepare('SELECT * FROM links WHERE status = ? ORDER BY created_at DESC').bind('approved').all();
		
		const html = `
			<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<title>All Links</title>
				<style>
					body { font-family: sans-serif; background-color: #f0f0f0; color: #333; }
					ul { list-style-type: none; padding: 0; }
					li { background-color: #fff; margin: 0.5em 0; padding: 1em; border-radius: 5px; }
					a { text-decoration: none; color: #007bff; }
				</style>
			</head>
			<body>
				<h1>All Submitted Links</h1>
				<ul>
					${results.map(link => `<li><a href="${(link.url as string)}">${(link.title as string)}</a></li>`).join('')}
				</ul>
			</body>
			</html>
		`;

		return c.html(html);
	} catch (e: any) {
		console.error(e);
		return c.text('Error fetching links', 500);
	}
});

// POST /captcha/verify - Exchange a Turnstile token for a short-lived session
app.post('/captcha/verify', validateTurnstile, async (c) => {
	const ttlSeconds = getCaptchaSessionTtlSeconds(c.env);
	const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
	const sessionId = crypto.randomUUID();
	const { ipHash, uaHash } = await computeClientHash(c);

	await c.env.DB.prepare(
		'INSERT INTO captcha_sessions (id, ip_hash, ua_hash, expires_at) VALUES (?, ?, ?, ?)'
	)
		.bind(sessionId, ipHash, uaHash, expiresAt)
		.run();

	const isSecure = new URL(c.req.url).protocol === 'https:';
	const cookie = [
		`${CAPTCHA_SESSION_COOKIE}=${sessionId}`,
		'Path=/',
		'HttpOnly',
		'SameSite=Lax',
		`Max-Age=${ttlSeconds}`,
		isSecure ? 'Secure' : '',
	].filter(Boolean).join('; ');

	c.header('Set-Cookie', cookie);
	return c.json({ message: 'CAPTCHA session created', expiresIn: ttlSeconds });
});

// POST /links - Submit a new link
app.post('/links', validateTurnstile, async (c) => {
    const { title, url } = c.req.body;

	if (!title || !url) {
		return c.json({ error: 'Title and URL are required' }, 400);
	}

	try {
		await c.env.DB.prepare('INSERT INTO links (title, url) VALUES (?, ?)')
			.bind(title, url)
			.run();
		return c.json({ message: 'Link submitted successfully' }, 201);
	} catch (e: any) {
		console.error(e);
		return c.json({ error: 'Error submitting link', message: e.message }, 500);
	}
});

// POST /links/:id/upvote - Upvote a link
app.post('/links/:id/upvote', requireCaptchaSession, async (c) => {
	const { id } = c.req.param();
	try {
		await c.env.DB.prepare('UPDATE links SET upvotes = upvotes + 1 WHERE id = ?').bind(id).run();
		return c.json({ message: 'Upvoted successfully' });
	} catch (e: any) {
		console.error(e);
		return c.json({ error: 'Error upvoting', message: e.message }, 500);
	}
});

// POST /links/:id/downvote - Downvote a link
app.post('/links/:id/downvote', requireCaptchaSession, async (c) => {
	const { id } = c.req.param();
	try {
		await c.env.DB.prepare('UPDATE links SET downvotes = downvotes + 1 WHERE id = ?').bind(id).run();
		return c.json({ message: 'Downvoted successfully' });
	} catch (e: any) {
		console.error(e);
		return c.json({ error: 'Error downvoting', message: e.message }, 500);
	}
});

// POST /links/:id/unupvote - Remove an upvote
app.post('/links/:id/unupvote', requireCaptchaSession, async (c) => {
	const { id } = c.req.param();
	try {
		await c.env.DB.prepare('UPDATE links SET upvotes = upvotes - 1 WHERE id = ?').bind(id).run();
		return c.json({ message: 'Un-upvoted successfully' });
	} catch (e: any) {
		console.error(e);
		return c.json({ error: 'Error un-upvoting', message: e.message }, 500);
	}
});

// POST /links/:id/undownvote - Remove a downvote
app.post('/links/:id/undownvote', requireCaptchaSession, async (c) => {
	const { id } = c.req.param();
	try {
		await c.env.DB.prepare('UPDATE links SET downvotes = downvotes - 1 WHERE id = ?').bind(id).run();
		return c.json({ message: 'Un-downvoted successfully' });
	} catch (e: any) {
		console.error(e);
		return c.json({ error: 'Error un-downvoting', message: e.message }, 500);
	}
});


export default app;
