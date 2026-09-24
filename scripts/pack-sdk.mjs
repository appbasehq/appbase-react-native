// Local npm candidate only. No registry publication or published-release metadata changes.
import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const destination = fileURLToPath(new URL('../artifacts/', import.meta.url));
await mkdir(destination, { recursive: true });
execFileSync('npm', ['pack', '--json', '--pack-destination', destination], { cwd: fileURLToPath(new URL('../sdks/react-native/', import.meta.url)), stdio: 'inherit' });
