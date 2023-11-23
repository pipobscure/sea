const util = require('node:util');
const CR = require('node:crypto');
const ZP = require('node:zlib');
const Module = require('node:module');
const VM = require('node:vm');
const OS = require('node:os');
const FS = require('node:fs');
const Path = require('node:path');

const PROTO = 'sea:';

function embedded() {
	const VERSION = 1;
	const COMPRESS_DEFLATE = 0x01;
	const COMPRESS_GZIP = 0x02;
	const COMPRESS_BROTLI = 0x03;
	const HASH_SHA1 = 0x10;
	const HASH_SHA2 = 0x20;

	const embedded = Buffer.from(util.getEmbeddedData() ?? Buffer.alloc(0));
	function blob(buffer, offset = 0) {
		if (buffer[offset] !== VERSION) throw new Error(`invalid data-buffer ${offset} (${buffer[offset]} !== ${VERSION})`);
		const flags = buffer[offset + 1];
		const nlen = buffer.readUInt16BE(offset + 2);
		const dlen = buffer.readUInt32BE(offset + 4);
		let hashbuffer = null;
		let dataoffset = offset + 8 + nlen;
		switch (true) {
			case !!(flags & HASH_SHA2):
				dataoffset = offset + 8 + nlen + 32;
				hashbuffer = buffer.subarray(dataoffset - 32, dataoffset);
				break;
			case !!(flags & HASH_SHA1):
				dataoffset = offset + 8 + nlen + 20;
				hashbuffer = buffer.subarray(dataoffset - 20, dataoffset);
				break;
		}

		let data = null;
		switch (true) {
			case !!(flags & COMPRESS_BROTLI):
				data = ZP.brotliDecompressSync(buffer.subarray(dataoffset, dataoffset + dlen));
				break;
			case !!(flags & COMPRESS_GZIP):
				data = ZP.gunzipSync(buffer.subarray(dataoffset, dataoffset + dlen));
				break;
			case !!(flags & COMPRESS_DEFLATE):
				data = ZP.inflateSync(buffer.subarray(dataoffset, dataoffset + dlen));
				break;
			default:
				data = buffer.subarray(dataoffset, dataoffset + dlen);
				break;
		}

		switch (true) {
			case !!(flags & HASH_SHA2):
				if (hashbuffer.toString('hex') !== CR.createHash('sha256').update(data).digest('hex')) {
					throw new Error('hash mismatch');
				}
				break;
			case !!(flags & HASH_SHA1):
				if (hashbuffer.toString('hex') !== CR.createHash('sha1').update(data).digest('hex')) {
					throw new Error('hash mismatch');
				}
				break;
		}

		return data;
	}
	function info(buffer, offset = 0) {
		if (buffer[offset] !== VERSION) throw new Error('invalid data-buffer');
		const flags = buffer[offset + 1];
		const nlen = buffer.readUInt16BE(offset + 2);
		const dlen = buffer.readUInt32BE(offset + 4);
		const name = buffer.subarray(offset + 8, offset + 8 + nlen).toString('utf-8');

		let hashbuffer = null;
		let dataoffset = offset + 8 + nlen;
		switch (true) {
			case !!(flags & HASH_SHA2):
				dataoffset = offset + 8 + nlen + 32;
				hashbuffer = buffer.subarray(dataoffset - 32, dataoffset);
				break;
			case !!(flags & HASH_SHA1):
				dataoffset = offset + 8 + nlen + 20;
				hashbuffer = buffer.subarray(dataoffset - 20, dataoffset);
				break;
		}
		const start = offset;
		const block = dataoffset + dlen - offset;
		return { name, flags, hash: hashbuffer ? hashbuffer.toString('hex') : undefined, start, block };
	}
	function* entries(buffer) {
		let offset = 0;
		while (offset < buffer.byteLength) {
			const blockinfo = info(buffer, offset);
			yield blockinfo;
			offset += blockinfo.block;
		}
	}
	function index(buffer) {
		const items = Array.from(entries(buffer));
		const result = items.reduce((agg, info) => ((agg[info.name] = info), agg), {});
		return result;
	}
	const idx = index(embedded);
	return {
		has(name) {
			return idx[name] !== undefined;
		},
		get(name) {
			const info = idx[name];
			if (!info) return undefined;
			return blob(embedded, info.start);
		},
		[Symbol.iterator]() {
			return idx[Symbol.iterator]();
		}
	};
}
function patch(id, bundle, exports) {
	switch (id) {
		case 'node:fs': return patchFS(exports);
		case 'node:fs/promises': return patchFSP(exports);
		case 'node:path': return patchPath(exports)
		default: return exports;
	}
	function resolve(one, two, ...rest) {
		const url = (two) ? new URL(two, one) : new URL(one);
		if (rest.length) return resolve(url.toString(), ...rest);
		return url.toString();
	}
	function readFileSync(path, opts, ...rest) {
		if (!path.startsWith(PROTO)) return exports.readFileSync(path, opts, ...rest);
		path = resolve(path).slice(PROTO.length);
		const data = bundle.get(path);
		if (!data) {
			throw Object.assign(new Error(`ENOENT: no such file or directory, open '${PROTO}${path}'`), { errno: -4058, code: 'ENOENT' });
		} else {
			return ('string' === typeof (opts?.encoding ?? opts)) ? data.toString(opts?.encoding ?? opts) : data;
		}
	}
	function readDir(path, opts) {
		if (opts?.withFileTypes) throw new Error('unsupported option: withFileTypes');
		path = resolve(path).slice(PROTO.length);
		path = path[path.length - 1] === '/' ? path : `${path}/`;
		let contents = Array.from(bundle).filter(f => f.startsWith(path)).map(f => f.slice(path.length));
		contents = opts?.recursive ? contents : contents.filter(f => !f.includes('/'));
		if ('string' === typeof (opts?.encoding ?? opts)) {
			if ((opts?.encoding ?? opts) !== 'utf-8') {
				contents = contents.map(f => Buffer.from(contents));
				if ((opts?.encoding ?? opts) !== 'buffer') {
					contents = contents.map(f => f.toString(opts?.encoding ?? opts));
				}
			}
		}
		return contents;
	}
	function patchFS(exports) {
		return Object.create(exports, {
			readFileSync: {
				value: readFileSync,
				enumerable: true,
				writable: true,
				configurable: true
			},
			existsSync: {
				value: function existsSync(path) {
					if (!path.startsWith(PROTO)) return exports.existsSync(path);
					path = resolve(path).slice(PROTO.length);
					return bundle.has(path);
				},
				enumerable: true,
				writable: true,
				configurable: true
			},
			readdirSync: {
				value: function readdirSync(path, opts) {
					if (!path.startsWith(PROTO)) return exports.readdirSync(path, opts);
					return readDir(path, opts);
				},
				enumerable: true,
				writable: true,
				configurable: true
			},
			readFile: {
				value: function (path, opts, cb) {
					if (!path.startsWith(PROTO)) return exports.readFile(path, opts, cb);
					if (!cb) {
						cb = opts;
						opts = undefined;
					}
					let data = null;
					try {
						data = readFileSync(path, opts);
					} catch (err) {
						cb(err, undefined);
						return;
					}
					cb(null, data);
				},
				enumerable: true,
				writable: true,
				configurable: true
			},
			exists: {
				value: function exists(path, cb) {
					if (!path.startsWith(PROTO)) return exports.exists(path, cb);
					path = resolve(path).slice(PROTO.length);
					let exists = false;
					try {
						exists = bundle.has(path);
					} catch (err) {
						cb(err, undefined);
						return;
					}
					cb(null, exists);
				},
				enumerable: true,
				writable: true,
				configurable: true
			},
			readdir: {
				value: function readdir(path, opts, cb) {
					if (!path.startsWith(PROTO)) return exports.readdir(path, opts, cb);
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
				configurable: true
			}
		});
	}
	function patchFSP(exports) {
		return Object.create(exports, {
			readFile: {
				value: function readFile(path, opts) {
					if (!path.startsWith(PROTO)) return exports.readFile(path, opts, ...rest);
					try {
						return Promise.resolve(readFileSync(path, opts));
					} catch (err) {
						return Promise.reject(err);
					}
				},
				enumerable: true,
				writable: true,
				configurable: true
			},
			exists: {
				value: function exists(path) {
					if (!path.startsWith(PROTO)) return exports.exists(path);
					path = resolve(path).slice(PROTO.length);
					return Promise.resolve(bundle.has(path));
				},
				enumerable: true,
				writable: true,
				configurable: true
			},
			readdir: {
				value: function readFile(path, opts) {
					if (!path.startsWith(PROTO)) return exports.readdir(path, opts);
					try {
						return Promise.resolve(readDir(path, opts));
					} catch (err) {
						return Promise.reject(err);
					}
				},
				enumerable: true,
				writable: true,
				configurable: true
			},
		});
	}
	function patchPath(exports) {
		return Object.create(exports, {
			resolve: {
				value: function resolve(path, ...rest) {
					if (!path.startsWith(PROTO)) return exports.resolve(path, ...rest);
					return resolve(path, ...rest);
				},
				enumerable: true,
				writable: true,
				configurable: true
			},
			join: {
				value: function join(path, ...rest) {
					if (!path.startsWith(PROTO)) return exports.join(path, ...rest);
					path = exports.join(path, ...rest);
					return resolve(path);
				}
			}
		});
	}
}
function loader(bundle) {
	if (!bundle.has('resolutions')) return ()=>{};
	const modules = Object.create(null);
	const resolutions = JSON.parse(bundle.get('resolutions').toString('utf-8'));
	const require = Module.createRequire(process.argv0);
	function resolve(parent, specifier) {
		if (specifier && Module.isBuiltin(specifier)) {
			return new URL(specifier.startsWith('node:') ? specifier : `node:${specifier}`);
		} else {
			specifier = resolutions[parent?.slice(PROTO.length) ?? '<main>'][specifier ?? '<main>'] ?? specifier;
			const url = new URL(specifier, new URL(parent ?? 'sea:/'));
			return url;
		}
	}
	function load(parent, specifier) {
		const url = resolve(parent, specifier);
		const id = url.toString();
		if (modules[id]) return modules[id].exports;
		switch (url.protocol) {
			case 'node:': {
				const exports = patch(id, bundle, require(id));
				module[id] = { id, exports };
				return exports;
			}
			case 'file:': {
				const exports = require(url.pathname);
				module[id] = { id, exports };
				return exports;
			}
			case 'sea:': {
				const module = (modules[id] = { id, exports: {} });
				switch (Path.extname(url.pathname).toLowerCase()) {
					case '.json': return (module.exports = JSON.parse(bundle.get(url.pathname).toString('utf-8')));
					case '.js': {
						const dirname = new URL('./', url).toString();
						module.exec = new VM.Script(`(function module(module,exports,require,__dirname,__filename) {\n${bundle.get(url.pathname).toString('utf-8')}\n})`, { filename: id, lineOffset: -1 }).runInThisContext();
						const main = modules[resolve().toString()];
						module.exec.call(null, module, module.exports, Object.assign((specifier) => load(id, specifier), { main }), dirname, id);
						return module.exports;
					}
					case '.node': {
						const code = bundle.get(url.pathname);
						const tmpnam = Path.join(OS.tmpdir(), [crypto.randomUUID(), 'node'].join('.'));
						FS.writeFileSync(tmpnam, code);
						process.dlopen(module, tmpnam);
						return module.exports;
					}
				}
			}
			default: {
				throw new Error(`invalid code resource: ${id}`);
			}
		}
	}
	return () => load(null, null);
}

loader(embedded())();
