import * as FS from 'node:fs';
import * as Path from 'node:path';

export function base(dir: string) {
	while (!FS.existsSync(Path.join(dir, 'package.json'))) {
		const next = Path.dirname(dir);
		if (next === dir) break;
		dir = next;
	}
	return dir;
}

export default base(process.argv[1] ? Path.dirname(process.argv[1]) : process.cwd());
