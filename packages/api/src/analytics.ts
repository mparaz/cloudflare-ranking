export interface AnalyticsEnv {
	AE: AnalyticsEngineDataset;
}

export function logAnalytics(request: Request, env: AnalyticsEnv) {
	const url = new URL(request.url);
	const hostname = url.hostname;

	// Identify the visitor
	const ip = request.headers.get("cf-connecting-ip") || "0.0.0.0";
	const country = request.headers.get("cf-ipcountry") || "XX";
	const referer = request.headers.get("referer") || "direct";
	const userAgent = request.headers.get("user-agent") || "unknown";
	const queryString = url.search; // Includes the '?' and everything after

	// Write to Analytics Engine
	// Blobs are for strings (Groupable), Doubles are for numbers (Summable)
	if (env.AE) {
		env.AE.writeDataPoint({
			blobs: [
				hostname, // blob1
				country, // blob2
				referer, // blob3
				queryString, // blob4
				userAgent, // blob5
				url.pathname, // blob6
			],
			indexes: [ip], // This helps with unique visitor counts
		});
	}
}