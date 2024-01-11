import { readFileSync } from 'node:fs';
import * as Path from 'node:path';
import * as FS from 'node:fs/promises';
import * as Proc from 'node:child_process';

//@ts-ignore
import { inject } from 'postject';

import { base } from './packagebase.js';
import fileNames from './filenames.js';
const PackageBase = base(process.cwd());
const PKG = JSON.parse(readFileSync(Path.join(PackageBase, 'package.json'), 'utf-8'));
const File = fileNames(PKG);

export async function inject() {
	console.error(`creating injectable`);
	await exec(process.execPath, '--experimental-sea-config', Path.join(PackageBase, File.config));

	console.error(`copying ${process.execPath} to ${File.executable}`);
	await FS.copyFile(process.execPath, Path.join(PackageBase, File.executable));

	console.error(`injecting ${File.bundle} into ${File.executable}`);
	const runtime = await FS.readFile(Path.join(PackageBase, File.bundle));
	//@ts-ignore
	await inject(Path.join(PackageBase, File.executable), 'NODE_SEA_BLOB', runtime, {
		sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
	});
}

function exec(cmd: string, ...args: string[]) {
	return new Promise<void>((resolve, reject) => {
		const child = Proc.execFile(cmd, args, (err: Proc.ExecFileException | null, stdout: string, stderr: string) => {
			process.stderr.write(stderr);
			process.stdout.write(stdout);

			if (err) return reject(err);
			resolve();
		});
		child.on('error', (err: Error | null) => reject(err));
		child.stdin?.end();
	});
}

if (require.main === module) inject();
