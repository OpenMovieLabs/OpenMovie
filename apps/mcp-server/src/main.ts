import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { ProjectStore } from '@openmovie/project-store';

import { createOpenMovieMcpServer } from './server.js';

function projectRootFromArguments(): string {
  const index = process.argv.indexOf('--project');
  const argument = index >= 0 ? process.argv[index + 1] : undefined;
  const root = argument ?? process.env.OPENMOVIE_PROJECT_ROOT;
  if (!root) throw new Error('Use --project <path> or OPENMOVIE_PROJECT_ROOT');
  return root;
}

const project = await ProjectStore.open(projectRootFromArguments());
const close = async (): Promise<void> => project.close();
process.once('SIGINT', () => void close().finally(() => process.exit(0)));
process.once('SIGTERM', () => void close().finally(() => process.exit(0)));
process.once('beforeExit', () => void close());

void serveStdio(() => createOpenMovieMcpServer(project));
console.error(`OpenMovie MCP server ready for ${project.root}`);
