export const onRequest: PagesFunction<{ API: Fetcher }> = async (context) => {
  const url = new URL(context.request.url);
  // Remove the /api prefix when forwarding to the worker
  const path = url.pathname.replace(/^\/api/, '');
  const newUrl = new URL(path + url.search, 'http://internal');

  return context.env.API.fetch(new Request(newUrl, context.request));
};
