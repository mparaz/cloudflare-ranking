import { Router, IRequest } from 'itty-router';
import { Toucan } from 'toucan-js';

// Define the environment interface
export interface Env {
	DB: D1Database;
	TURNSTILE_SECRET_KEY: string;
	SENTRY_DSN?: string;
}

// Define the structure of a Link
interface Link {
	id: number;
	title: string;
	url: string;
	upvotes: number;
	downvotes: number;
	score: number;
	created_at: string;
}

// Scoring function
function calculateScore(upvotes: number, downvotes: number): number {
	return upvotes - downvotes;
}

const router = Router();

// Helper function for Turnstile validation
async function validateTurnstile(token: string, ip: string | null, env: Env): Promise<boolean> {
	if (!token) {
		return false;
	}

	let turnstileData = new FormData();
	turnstileData.append('secret', env.TURNSTILE_SECRET_KEY);
	turnstileData.append('response', token);
	if (ip) {
		turnstileData.append('remoteip', ip);
	}

	const result = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
		body: turnstileData,
		method: 'POST',
	});

	const outcome = await result.json();
	return outcome.success;
}

// GET / - A simple hello world
router.get('/', () => new Response('Hello, World!'));

// GET /links - Get all approved links
router.get('/links', async (request: IRequest, env: Env) => {
	try {
		const { results } = await env.DB.prepare('SELECT * FROM links WHERE status = ? ORDER BY created_at DESC').bind('approved').all();
		const links = results.map(link => ({
			...link,
			score: calculateScore(link.upvotes as number, link.downvotes as number),
		})).sort((a, b) => b.score - a.score);
		return new Response(JSON.stringify(links), { headers: { 'Content-Type': 'application/json' } });
	} catch (e) {
		console.error(e);
		return new Response('Error fetching links', { status: 500 });
	}
});

// POST /links - Submit a new link
router.post('/links', async (request: IRequest, env: Env) => {
	const ip = request.headers.get('CF-Connecting-IP');
	const { title, url, token } = await request.json();

	if (!await validateTurnstile(token, ip, env)) {
		return new Response('CAPTCHA validation failed', { status: 403 });
	}

	if (!title || !url) {
		return new Response('Title and URL are required', { status: 400 });
	}

	try {
		await env.DB.prepare('INSERT INTO links (title, url) VALUES (?, ?)')
			.bind(title, url)
			.run();
		return new Response('Link submitted successfully', { status: 201 });
	} catch (e) {
		console.error(e);
		return new Response('Error submitting link', { status: 500 });
	}
});

// POST /links/:id/upvote - Upvote a link
router.post('/links/:id/upvote', async (request: IRequest, env: Env) => {
	const ip = request.headers.get('CF-Connecting-IP');
	const { token } = await request.json();

	if (!await validateTurnstile(token, ip, env)) {
		return new Response('CAPTCHA validation failed', { status: 403 });
	}

	const { id } = request.params;
	try {
		await env.DB.prepare('UPDATE links SET upvotes = upvotes + 1 WHERE id = ?').bind(id).run();
		return new Response('Upvoted successfully');
	} catch (e) {
		console.error(e);
		return new Response('Error upvoting', { status: 500 });
	}
});

// POST /links/:id/downvote - Downvote a link
router.post('/links/:id/downvote', async (request: IRequest, env: Env) => {
	const ip = request.headers.get('CF-Connecting-IP');
	const { token } = await request.json();

	if (!await validateTurnstile(token, ip, env)) {
		return new Response('CAPTCHA validation failed', { status: 403 });
	}

	const { id } = request.params;
	try {
		await env.DB.prepare('UPDATE links SET downvotes = downvotes + 1 WHERE id = ?').bind(id).run();
		return new Response('Downvoted successfully');
	} catch (e) {
		console.error(e);
		return new Response('Error downvoting', { status: 500 });
	}
});

// 404 handler
router.all('*', () => new Response('Not Found.', { status: 404 }));

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const sentry = new Toucan({
			dsn: env.SENTRY_DSN,
			context: ctx,
			request,
		});

		try {
			return await router.handle(request, env, ctx);
		} catch (err) {
			sentry.captureException(err);
			return new Response('Something went wrong', { status: 500 });
		}
	},
};