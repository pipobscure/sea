import * as Path from 'node:path';
import type { Writable } from 'node:stream';
import { createWriteStream, readFileSync, promises as FS } from 'node:fs';

import { globIterate } from 'glob';
import { minimatch } from 'minimatch';

import * as Blob from './appendblob.js';

import { base } from './packagebase.js';
import fileNames from './filenames.js';
const PackageBase = base(process.cwd());
const PKG = JSON.parse(readFileSync(Path.join(PackageBase, 'package.json'), 'utf-8'));
const File = fileNames(PKG);

export async function bundle() {
	const resolutions: Record<string, Record<string, string>> = JSON.parse(await FS.readFile(Path.join(PackageBase, File.resolutions), 'utf-8'));

	const bundle = createWriteStream(Path.join(PackageBase, File.blobs));
	const index = createWriteStream(Path.join(PackageBase, File.index));

	const seen: Set<string> = new Set();
	let hashFlags = Blob.HASH.NONE;
	switch (PKG.sea?.hash) {
		case 'sha1':
			hashFlags = Blob.HASH.SHA1;
			break;
		case 'sha2': // fall-through
		case 'sha256':
			hashFlags = Blob.HASH.SHA2;
			break;
	}
	let compressFlags = Blob.COMPRESSION.NONE;
	switch (PKG.sea?.compression) {
		case 'deflate':
			compressFlags = Blob.COMPRESSION.DEFLATE;
			break;
		case 'gzip':
			compressFlags = Blob.COMPRESSION.GZIP;
			break;
		case 'brotli':
			compressFlags = Blob.COMPRESSION.BROTLI;
			break;
	}
	const exclusions = PKG?.sea?.exclude ?? []; //.map((pattern: string) => Object.assign(new Minimatch(pattern, { partial: true, platform: 'linux' }), { pattern }));

	for (const dependecies of Object.values(resolutions)) {
		for (const item of Object.values(dependecies)) {
			if (item.startsWith('node:') || item.startsWith('file:')) continue;
			const filename = Path.join(PackageBase, item.split('/').slice(1).join(Path.sep));
			if (seen.has(filename)) continue;
			seen.add(filename);
			if (excluded(exclusions, item.slice(1))) continue;

			const data = await FS.readFile(filename);
			await Blob.append(bundle, item, data, compressFlags | hashFlags, index);
			process.stderr.write('.');
		}
	}

	if (Array.isArray(PKG.sea?.assets)) {
		for (const expr of PKG.sea.assets) {
			for await (const fname of globIterate(expr, { cwd: PackageBase, nodir: true, absolute: true })) {
				if (seen.has(fname)) continue;
				seen.add(fname);
				const name = `/${Path.relative(PackageBase, fname).split(Path.sep).join('/')}`;
				if (excluded(exclusions, name.slice(1))) continue;
				const data = await FS.readFile(fname);
				await Blob.append(bundle, name, data, compressFlags | hashFlags, index);
				process.stderr.write('.');
			}
		}
	}
	process.stderr.write('\n');
	await Promise.all([close(bundle), close(index)]);
}

function close(stream: Writable) {
	return new Promise<void>((resolve, reject) => {
		stream.end((err: Error | null) => {
			if (err) return reject(err);
			resolve();
		});
	});
}
function excluded(exclusions: string[], filename: string) {
	for (const pattern of exclusions) {
		const match = minimatch(filename, pattern);
		if (match) {
			return true;
		}
	}
	return false;
}

if (require.main === module) bundle();
