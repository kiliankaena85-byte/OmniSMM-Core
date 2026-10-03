const http = require('http');

http.get('http://127.0.0.1:3000/', (res) => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    const idx = body.indexOf('[Репосты]');
    if (idx !== -1) {
      console.log('Snippet around [Репосты]:');
      console.log(body.substring(Math.max(0, idx - 150), Math.min(body.length, idx + 150)));
    } else {
      console.log('No [Репосты] found');
    }
  });
});
