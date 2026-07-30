import fs from 'node:fs/promises';
import { parsePublishNotification } from './publish-message-parser.mjs';

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

const filePath = process.argv[2];
const input = filePath ? await fs.readFile(filePath, 'utf8') : await readStdin();
const result = parsePublishNotification(input);

console.log(JSON.stringify(result, null, 2));
if (!result.valid) process.exitCode = 1;

