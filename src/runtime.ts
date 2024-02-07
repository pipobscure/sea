//@ts-ignore
import * as SEA from 'node:sea';
import * as ZLib from 'node:zlib';
import * as Crypto from 'node:crypto';
import * as Url from 'node:url';
import * as Path from 'node:path';
import * as VM from 'node:vm';
import * as OS from 'node:os';
import * as FS from 'node:fs';
import { Module } from 'node:module';

const VERSION = 1;
const COMPRESSION = {
	NONE: 0x00,
	DEFLATE: 0x01,
	GZIP: 0x02,
	BROTLI: 0x03,
};
const HASH = {
	NONE: 0x00,
	SHA1: 0x10,
	SHA2: 0x20,
};

const PROTO = 'sea:';

const resolutions: Record<string, Record<string, string>> = JSON.parse(SEA.getAsset('resolv', 'utf8'));
const blobs = extractBlobs(SEA.getRawAsset('bundle'));

function extractBlobs(data: ArrayBuffer) {
	const index: Record<string, ReturnType<typeof blobData>> = {};
	let item = blobData(data, 0);
	while (item) {
		index[item.name] = item;
		item = blobData(data, item.next);
	}
	return index;

	function blobData(data: ArrayBuffer, offset: number = 0) {
		if (offset >= data.byteLength) return null;

		const header = new DataView(data, offset, 8);
		const version = header.getUint8(0);
		const flags = header.getUint8(1);
		const nlen = header.getUint16(2);
		const dlen = header.getUint32(4);
		if (version !== VERSION) throw new Error(`invalid blob-version: ${version}`);

		const hashFlag = flags & 0xf0;
		const compression = flags & 0x0f;
		offset += 8;

		const name = Buffer.from(data, offset, nlen).toString('utf-8');
		offset += nlen;

		let hash: ArrayBuffer | null = null;
		switch (hashFlag) {
			case HASH.SHA1:
				hash = data.slice(offset, offset + 20);
				offset += 20;
				break;
			case HASH.SHA2:
				hash = data.slice(offset, offset + 32);
				offset += 32;
				break;
		}

		const blob = data.slice(offset, offset + dlen);
		offset += dlen;

		return {
			name,
			blob,
			hash,
			compression,
			next: offset,
		};
	}
}
function asset(urlStr: string): Buffer;
function asset(urlStr: string, encoding: BufferEncoding): string;
function asset(urlStr: string, encoding?: BufferEncoding) {
	const url = new URL(urlStr);
	if (url.protocol !== PROTO) throw new Error(`not an asset-url ${urlStr}`);

	const name = url.pathname;
	const info = blobs[name];
	if (!info) throw new Error(`not an asset: ${name}`);

	let data = Buffer.from(info.blob);
	switch (info.compression) {
		case COMPRESSION.BROTLI:
			data = ZLib.brotliDecompressSync(data);
			break;
		case COMPRESSION.DEFLATE:
			data = ZLib.inflateSync(data);
			break;
		case COMPRESSION.GZIP:
			data = ZLib.gunzipSync(data);
			break;
	}
	switch (info.hash?.byteLength) {
		case 20: {
			const actual = Crypto.createHash('sha1').update(data).digest('hex');
			const wanted = Buffer.from(info.hash).toString('hex');
			if (actual !== wanted) throw new Error('invalid content');
			break;
		}
		case 32: {
			const actual = Crypto.createHash('sha256').update(data).digest('hex');
			const wanted = Buffer.from(info.hash).toString('hex');
			if (actual !== wanted) throw new Error('invalid content');
			break;
		}
	}
	if (encoding) return data.toString(encoding);
	return data;
}

const modules: Record<string, { id: string; exports: any }> = Object.create(null);
function resolve(parent?: string, specifier?: string) {
	if (specifier && Module.isBuiltin(specifier)) {
		return new URL(specifier.startsWith('node:') ? specifier : `node:${specifier}`);
	} else if (!specifier || !specifier.startsWith(PROTO)) {
		specifier = resolutions[parent?.slice(PROTO.length) ?? '<main>'][specifier ?? '<main>'] ?? specifier;
		return new URL(specifier, parent ?? `${PROTO}/`);
	} else {
		const url = new URL(specifier);
		return url;
	}
}
function patch(id: string, exports: object) {
	switch (id) {
		case 'node:fs':
			return patchFS(exports as typeof FS);
		case 'node:fs/promises':
			return patchFSP(exports as typeof FS.promises);
		case 'node:path':
			return patchPath(exports as typeof Path);
		default:
			return exports;
	}
	function resolve(one: string, two?: string, ...rest: string[]) {
		const url = two ? new URL(two, one) : new URL(one);
		if (rest.length) return resolve(url.toString(), ...rest);
		return url.toString().split(/\/\/+/).join('/');
	}
	function readFileSync(this: any, path: string, ...args: any[]) {
		if (!path.startsWith(PROTO)) return FS.readFileSync(path, ...args);
		path = resolve(path);
		const data = asset(path);
		if (!data) {
			throw Object.assign(new Error(`ENOENT: no such file or directory, open '${path}'`), { errno: -4058, code: 'ENOENT' });
		} else {
			const opts = args[0] as { encoding: BufferEncoding } | BufferEncoding | undefined;
			const encoding = 'object' === typeof opts ? opts?.encoding : opts;
			if (encoding) return data.toString(encoding);
			const copy = Buffer.allocUnsafe(data.byteLength);
			data.copy(copy);
			return copy;
		}
	}
	function readDir(this: any, path: string, opts?: { encoding: BufferEncoding | 'buffer' | null; withFileTypes?: false | undefined; recursive?: boolean | undefined } | BufferEncoding | null | undefined) {
		if ('string' === typeof opts) opts = { encoding: opts };
		if (opts?.withFileTypes) throw new Error('unsupported option: withFileTypes');
		path = resolve(path).slice(PROTO.length);
		path = path[path.length - 1] === '/' ? path : `${path}/`;
		const matches = Object.values(blobs).filter((b) => b?.name.startsWith(path) ?? false);
		let contents = matches.map((b) => b?.name.slice(path.length)) as string[];
		contents = opts?.recursive ? contents : contents.filter((f) => !f.includes('/'));
		if ('string' === typeof (opts?.encoding ?? opts)) {
			switch (opts?.encoding) {
				case undefined:
				case null:
				case 'utf8':
				case 'utf-8':
					return contents;
				case 'buffer':
				default:
					return contents.map((f) => Buffer.from(f).toString((opts as { encoding: BufferEncoding }).encoding));
			}
		}
		return contents;
	}
	function patchFS(exports: typeof FS) {
		return Object.create(exports, {
			readFileSync: {
				value: readFileSync,
				enumerable: true,
				writable: true,
				configurable: true,
			},
			existsSync: {
				value: function existsSync(path: string) {
					if (!path.startsWith(PROTO)) return exports.existsSync.call(this, path);
					path = resolve(path).slice(PROTO.length);
					return !!blobs[path];
				},
				enumerable: true,
				writable: true,
				configurable: true,
			},
			readdirSync: {
				value: function readdirSync(path: string, opts: any) {
					if (!path.startsWith(PROTO)) {
						//@ts-ignore
						return exports.readdirSync.call(this, path, opts);
					}
					return readDir(path, opts);
				},
				enumerable: true,
				writable: true,
				configurable: true,
			},
			readFile: {
				value: function (path: string, opts: unknown, cb: unknown) {
					if (!path.startsWith(PROTO)) {
						//@ts-ignore
						return exports.readFile.call(this, path, opts, cb);
					}
					if (!cb) {
						cb = opts;
						opts = undefined;
					}
					let data = null;
					try {
						data = readFileSync(path, opts);
					} catch (err) {
						(cb as (err: Error) => void)(err as Error);
						return;
					}
					(cb as (err: null, value: any) => void)(null, data);
				},
				enumerable: true,
				writable: true,
				configurable: true,
			},
			exists: {
				value: function exists(path: string, cb: any) {
					if (!path.startsWith(PROTO)) return exports.exists.call(this, path, cb);
					path = resolve(path).slice(PROTO.length);
					let exists = false;
					try {
						exists = !!blobs[path];
					} catch (err) {
						cb(err, undefined);
						return;
					}
					cb(null, exists);
				},
				enumerable: true,
				writable: true,
				configurable: true,
			},
			readdir: {
				value: function readdir(path: string, opts: any, cb: any) {
					if (!path.startsWith(PROTO)) return exports.readdir.call(this, path, opts, cb);
					if (!cb) {
						cb = opts;
						opts = undefined;
					}
					let files = [];
					try {
						files = readDir(path, opts);
					} catch (err) {
						cb(err, undefined);
						return;
					}
					cb(null, files);
				},
				enumerable: true,
				writable: true,
				configurable: true,
			},
		});
	}
	function patchFSP(exports: typeof FS.promises) {
		return Object.create(exports, {
			readFile: {
				value: function readFile(path: string, opts: any) {
					if (!path.startsWith(PROTO)) return exports.readFile.call(this, path, opts);
					try {
						return Promise.resolve(readFileSync(path, opts));
					} catch (err) {
						return Promise.reject(err);
					}
				},
				enumerable: true,
				writable: true,
				configurable: true,
			},
			readdir: {
				value: function readFile(path: string, opts: any) {
					if (!path.startsWith(PROTO)) return exports.readdir.call(this, path, opts);
					try {
						return Promise.resolve(readDir(path, opts));
					} catch (err) {
						return Promise.reject(err);
					}
				},
				enumerable: true,
				writable: true,
				configurable: true,
			},
		});
	}
	function patchPath(exports: typeof Path) {
		return Object.create(exports, {
			resolve: {
				value: function (path: string, ...rest: string[]) {
					if (!path.startsWith(PROTO)) return exports.resolve.call(this, path, ...rest);
					return resolve(path, ...rest);
				},
				enumerable: true,
				writable: true,
				configurable: true,
			},
			join: {
				value: function join(path: string, ...rest: string[]) {
					if (!path.startsWith(PROTO)) return exports.join.call(this, path, ...rest);
					path = [path, ...rest].join('/');
					return resolve(path);
				},
				enumerable: true,
				writable: true,
				configurable: true,
			},
		});
	}
}
function load(parent?: string, specifier?: string) {
	const url = resolve(parent, specifier);
	const id = url.toString();
	if (modules[id]) return modules[id].exports;
	switch (url.protocol) {
		case 'node:': {
			const exports = patch(id, require(id));
			modules[id] = { id, exports };
			return exports;
		}
		case 'file:': {
			const exports = require(Url.fileURLToPath(url));
			modules[id] = { id, exports };
			return exports;
		}
		case PROTO:
			const module = (modules[id] = { id, exports: {} });
			const name = url.pathname;
			switch (Path.extname(name).toLowerCase()) {
				case '.json':
					return (module.exports = JSON.parse(asset(id, 'utf-8')));
				case '.js': {
					const dirname = new URL('./', url).toString();
					const exec = new VM.Script(`(function module(module,exports,require,__dirname,__filename) {\n${asset(id, 'utf-8')}\n})`, { filename: id, lineOffset: -1 }).runInThisContext();
					const main = modules[resolve().toString()];
					exec.call(
						null,
						module,
						module.exports,
						//@ts-expect-error
						Object.assign((specifier: string) => load(id, specifier), { main, addon: process.addon }),
						dirname,
						id,
					);
					return module.exports;
				}
				case '.node': {
					const code = asset(id);
					const tmpnam = Path.join(OS.tmpdir(), [crypto.randomUUID(), 'node'].join('.'));
					FS.writeFileSync(tmpnam, code);
					//@ts-ignore
					process.dlopen(module, tmpnam);
					return module.exports;
				}
				default:
					throw new Error(`invalid code-type: ${id}`);
			}
		default: {
			throw new Error(`invalid code resource: ${id}`);
		}
	}
}
//@ts-expect-error
process.addon = function addon(pkgbase: string) {
	if (!pkgbase.startsWith('sea:')) throw new Error('not inside sea');
	const basename = pkgbase.slice(PROTO.length);
	const addons = Array.from(Object.keys(blobs))
		.filter((name) => name.startsWith(basename) && name.endsWith('.node'))
		.sort((a, b) => a.length - b.length);
	const url = new URL(addons[0], pkgbase);
	return load(pkgbase, url.toString());
};

if (module === require.main) load();
