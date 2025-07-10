import { readFileSync, statSync, chmodSync, constants as fsConstants } from 'node:fs';
import * as Path from 'node:path';
import * as FS from 'node:fs/promises';
import * as Proc from 'node:child_process';
import * as OS from 'node:os';

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
	let newExeFilePath = Path.join(PackageBase, File.executable);
	await FS.copyFile(process.execPath, newExeFilePath);

	let newFileExeStat = statSync(newExeFilePath);
	let newFileExeStatMode = newFileExeStat.mode;
	chmodSync(Path.join(PackageBase, File.executable), newFileExeStatMode | fsConstants.S_IWUSR);

	console.error(`injecting ${File.bundle} into ${File.executable}`);
	const runtime = await FS.readFile(Path.join(PackageBase, File.bundle));
	const osPlatform = OS.platform();
	if ( osPlatform == "darwin") {
		//@ts-ignore
		await inject(Path.join(PackageBase, File.executable), 'NODE_SEA_BLOB', runtime, {
			sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
			machoSegmentName: 'NODE_SEA',
		});
	} else {
		//@ts-ignore
		await inject(Path.join(PackageBase, File.executable), 'NODE_SEA_BLOB', runtime, {
			sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
		});
	}
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
