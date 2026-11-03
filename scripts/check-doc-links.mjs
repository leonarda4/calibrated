import fs from 'node:fs/promises';
import path from 'node:path';

const files = ['README.md', 'AGENTS.md', 'CLAUDE.md', 'ai/strategy.md', 'public/hands/README.md',
  ...(await fs.readdir('docs')).filter(file => file.endsWith('.md')).map(file => `docs/${file}`)];
const missing = [];
let checked = 0;
for (const file of files) {
  const source = await fs.readFile(file, 'utf8');
  for (const match of source.matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1].split('#')[0];
    if (!target || /^[a-z][a-z\d+.-]*:/i.test(target)) continue;
    checked++;
    try { await fs.access(path.resolve(path.dirname(file), decodeURIComponent(target))); }
    catch { missing.push(`${file}: ${target}`); }
  }
}
if (missing.length) { console.error(missing.join('\n')); process.exitCode = 1; }
else console.log(`Checked ${checked} relative Markdown links in ${files.length} files.`);
