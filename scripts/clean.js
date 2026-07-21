/** Cross-platform cleanup used by npm's release lifecycle. */
const { rmSync } = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
for (const directory of ['dist', 'coverage']) {
  rmSync(path.join(projectRoot, directory), { recursive: true, force: true });
}
