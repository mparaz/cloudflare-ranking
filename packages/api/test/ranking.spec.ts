import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../src/index';

describe('Ranking Decay', () => {
	beforeEach(async () => {
		// Ensure table exists (since migrations might not be auto-applied in test)
		await env.DB.prepare(`
			CREATE TABLE IF NOT EXISTS links (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				title TEXT NOT NULL,
				url TEXT NOT NULL,
				upvotes INTEGER DEFAULT 0,
				downvotes INTEGER DEFAULT 0,
				status TEXT CHECK(status IN ('approved', 'pending')) DEFAULT 'pending',
				created_at TEXT DEFAULT CURRENT_TIMESTAMP
			)
		`).run();
		// Clean up the database before each test
		await env.DB.prepare('DELETE FROM links').run();
	});

	it('prioritizes fresh links but shows scores for old links', async () => {
		const now = new Date();
		const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
		const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

		// Format dates for SQLite (YYYY-MM-DD HH:MM:SS)
		const formatDate = (date: Date) => date.toISOString().replace('T', ' ').split('.')[0];

		// Insert an old link with many upvotes
		await env.DB.prepare(
			'INSERT INTO links (title, url, upvotes, status, created_at) VALUES (?, ?, ?, ?, ?)'
		).bind('Old popular link', 'https://old.com', 100, 'approved', formatDate(eightDaysAgo)).run();

		// Insert a fresh link with fewer upvotes
		await env.DB.prepare(
			'INSERT INTO links (title, url, upvotes, status, created_at) VALUES (?, ?, ?, ?, ?)'
		).bind('New link', 'https://new.com', 10, 'approved', formatDate(twoDaysAgo)).run();

		const request = new Request('http://example.com/links');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		const links = await response.json() as any[];
		
		expect(links.length).toBe(2);
		
		// The new link should be at the top even though it has fewer upvotes
		expect(links[0].title).toBe('New link');
		expect(links[0].score).toBe(10);
		
		// The old link should be second, but its score should be 100 (not 0)
		expect(links[1].title).toBe('Old popular link');
		expect(links[1].score).toBe(100);
	});
});
