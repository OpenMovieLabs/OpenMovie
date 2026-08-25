import { createServer } from 'node:http';

const port = Number(process.env.OPENMOVIE_FIXTURE_PORT ?? 43119);
const host = '127.0.0.1';
const fixtureMp4 = 'AAAAHGZ0eXBtcDQyAAAAAG1wNDJpc29t';
const jobs = new Map();

const server = createServer((request, response) => {
  response.setHeader('content-type', 'application/json');
  const url = new URL(request.url ?? '/', `http://${host}:${port}`);
  if (request.method === 'POST' && url.pathname === '/v1/videos') {
    const id = `fixture_job_${jobs.size + 1}`;
    jobs.set(id, 'completed');
    response.end(JSON.stringify({ id, status: 'queued' }));
    return;
  }
  const match = /^\/v1\/videos\/([^/]+)$/.exec(url.pathname);
  if (request.method === 'GET' && match?.[1] && jobs.has(match[1])) {
    response.end(
      JSON.stringify({
        id: match[1],
        status: jobs.get(match[1]),
        progress: 1,
        model: 'fixture-video-v1',
        output: { b64_json: fixtureMp4, mime_type: 'video/mp4' },
        usage: { input_tokens: 4, output_tokens: 1, cost_usd_micros: 10_000 },
      }),
    );
    return;
  }
  const cancel = /^\/v1\/videos\/([^/]+)\/cancel$/.exec(url.pathname);
  if (request.method === 'POST' && cancel?.[1] && jobs.has(cancel[1])) {
    jobs.set(cancel[1], 'cancelled');
    response.end(JSON.stringify({ id: cancel[1], status: 'cancelled' }));
    return;
  }
  response.statusCode = 404;
  response.end(JSON.stringify({ error: 'not_found' }));
});

server.listen(port, host, () => {
  process.stdout.write(`OpenMovie HTTP Video Job fixture: http://${host}:${port}/v1/\n`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => server.close(() => process.exit()));
}
