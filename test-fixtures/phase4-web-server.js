const http = require('node:http');

const pages = {
  '/': '<!doctype html><title>Phase 4 Target</title><h1>Healthy target</h1>',
  '/checkout': `<!doctype html><title>Checkout</title>
    <form action="/confirm" method="get">
      <input name="card" aria-label="Card number">
      <button data-testid="checkout-submit" type="submit">Place Order</button>
    </form>`,
  '/confirm': '<!doctype html><title>Confirmation</title><h1>Order confirmed</h1>'
};

const server = http.createServer((request, response) => {
  const path = new URL(request.url, 'http://127.0.0.1').pathname;
  const body = pages[path];
  if (!body) {
    response.writeHead(404, { 'content-type': 'text/plain' });
    response.end('not found');
    return;
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(body);
});

server.listen(3000, '127.0.0.1', () => {
  process.stdout.write('Phase 4 web target listening on http://127.0.0.1:3000\n');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
