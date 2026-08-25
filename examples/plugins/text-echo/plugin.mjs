let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', () => {
  const request = JSON.parse(input);
  const last = request.params.messages.at(-1)?.content;
  const text = typeof last === 'string' ? last : 'Structured multimodal input received';
  process.stdout.write(
    `${JSON.stringify({
      jsonrpc: '2.0',
      id: request.id,
      result: {
        text: `Echo development Plugin: ${text}`,
        model: request.params.model,
        finishReason: 'stop',
      },
    })}\n`,
  );
});
