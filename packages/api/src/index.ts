console.log("--- RUNNING LATEST API CODE ---");

import { Hono } from 'hono';
import { sentry } from '@hono/sentry';
import { cors } from 'hono/cors';

// Define the environment interface
export interface Env {
	DB: D1Database;
	TURNSTILE_SECRET_KEY: string;
	SENTRY_DSN?: string;
}

type Bindings = {
    DB: D1Database;
    TURNSTILE_SECRET_KEY: string;
    SENTRY_DSN?: string;
}

const app = new Hono<{ Bindings: Bindings }>();

// CORS Middleware
app.use('*', cors({
    origin: '*', // We can restrict this later to the actual domain
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
}));

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
        return c.json({ error: 'CAPTCHA validation failed' }, 403);
    }
    
    c.req.body = body; // Store body for next middleware
    await next();
};


// GET /links - Get all approved links
app.get('/links', async (c) => {
	try {
		const { results } = await c.env.DB.prepare('SELECT * FROM links WHERE status = ? ORDER BY created_at DESC').bind('approved').all();
		const links = results.map(link => ({
			...link,
			score: calculateScore(link.upvotes as number, link.downvotes as number),
		})).sort((a, b) => b.score - a.score);
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
app.post('/links/:id/upvote', validateTurnstile, async (c) => {
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
app.post('/links/:id/downvote', validateTurnstile, async (c) => {
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
app.post('/links/:id/unupvote', validateTurnstile, async (c) => {
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
app.post('/links/:id/undownvote', validateTurnstile, async (c) => {
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
