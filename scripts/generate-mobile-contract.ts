// SDK mirror: structural mobile artifacts only. Cross-SDK behavior changes originate upstream.
import { readFile, writeFile } from 'node:fs/promises';
import { format } from 'prettier';
import { mobileContractArtifacts } from '../packages/contracts/src/mobile-schema.js';
const check = process.argv.includes('--check');
for (const [name, artifact] of Object.entries(mobileContractArtifacts())) {
  const file = new URL('../packages/contracts/mobile/' + name, import.meta.url);
  // Preserve the committed canonical JSON layout independently of a user's parent-directory config.
  const text = await format(JSON.stringify(artifact), { parser: 'json', printWidth: 80 });
  if (check) {
    if (await readFile(file, 'utf8') !== text) throw new Error('Stale generated contract: ' + name);
  } else await writeFile(file, text);
}
console.log(check ? 'Mobile contract artifacts are synchronized' : 'Regenerated mobile contract artifacts');
