
const Module = require('node:module');
const FS = require('node:fs');
const Path = require('node:path');
const OS = require('node:os');

const cwd = process.cwd();
const base = (() => {
	let dir = Path.resolve(Path.dirname(process.argv[1] ?? `${process.cwd()}/`));
	while (!FS.existsSync(Path.join(dir, 'package.json'))) {
		const next = Path.dirname(dir);
		if (next === dir) break;
		dir = next;
	}
	return dir;
})();
patch();

function patch() {
	const resolutions = {};

	const _resolveFilename = Module._resolveFilename;
	Module._resolveFilename = function (request, parent, isMain) {
		const resolved = _resolveFilename.call(this, request, parent, isMain);
		const parentfile = parent?.filename ? '/' + Path.relative(base, parent?.filename).split(Path.sep).join('/') : '<main>';
		const cache = (resolutions[parentfile] = resolutions[parentfile] ?? {});
		const specifier = (request === process.argv[1] ? '<main>' : request).split(Path.sep).join('/');
		if (!Module.isBuiltin(request)) {
			cache[specifier] = '/' + Path.relative(base, resolved).split(Path.sep).join('/');
		} else {
			if (!request.startsWith('node:')) {
				cache[specifier] = `node:${request}`;
			} else {
				cache[specifier] = request;
			}
		}
		return resolved;
	};

	const _load = Module._load;
	Module._load = function (request, parent, isMain) {
		Module._resolveFilename(request, parent, isMain);
		for (const name of Object.keys(Module._cache)) {
			if (name.includes('\x00')) delete Module._cache[name];
		}
		return _load.call(this, request, parent, isMain);
	};

	const _exit = process.exit;
	process.exit = (code) => {
		process.exitCode = code;
		if (!code) process.emit('beforeExit', code);
		return _exit.call(this, code);
	}

	process.on('beforeExit', () => {
		Module._resolveFilename = _resolveFilename;
		Module._load = _load;
		process.exit = _exit;
		const PKG = (() => {
			try {
				return require(Path.join(base, 'package.json'));
			} catch (e) {
				return {};
			}
		})();
		inject(PKG, bundle(PKG, resolutions));
	});
}
function bundle(PKG, resolutions) {
	const blob = require('./blobs.js');
	const chunks = [];
	const seen = new Set();
	console.error(`creating bundle`)
	blob.create('resolutions', Buffer.from(JSON.stringify(resolutions)), blob.COMPRESSION.BROTLI & blob.HASH.NONE, chunks);
	for (const parent of Object.values(resolutions)) {
		for (const item of Object.values(parent)) {
			if (item.startsWith('node:') || item.startsWith('file:')) continue;
			const fname = Path.join(base, item.split('/').slice(1).join(Path.sep));
			seen.add(fname)
			const data = FS.readFileSync(fname);
			blob.create(item, data, blob.COMPRESSION.BROTLI & blob.HASH.NONE, chunks);
		}
	}
	if (Array.isArray(PKG.sea?.assets)) {
		const glob = require('glob');
		const hash = PKG.sea?.hash ? new (require('minimatch').Minimatch(PKG.sea?.hash))() : undefined;
		for (const expr of PKG.sea.assets) {
			for (const item of glob.globSync(expr, { cwd, nodir: true, absolute: true })) {
				if (seen.has(item)) continue;
				seen.add(item);
				const hashflags = hash && hash.match(item) ? blob.HASH.NONE : blob.HASH.SHA256;
				const fname = `/${Path.relative(base, item).split(Path.sep).join('/')}`;
				const data = FS.readFileSync(item);
				blob.create(fname, data, blob.COMPRESSION.BROTLI & hashflags, chunks);
			}
		}
	}
	return Buffer.concat(chunks);
}
function inject(PKG, bundle) {
	console.error(`patching node`);
	const isWindows = OS.type().toLowerCase().includes('windows');
	const exe = Path.resolve(base, `${PKG.sea?.executable ?? 'sea'}${isWindows ? '.exe' : ''}`);
	const bdl = Path.join(Path.dirname(exe), `${Path.basename(exe, '.exe')}.blob`);
	const rtd = Path.join(Path.dirname(exe), `${Path.basename(exe, '.exe')}.runtime`);
	const sea = Path.join(Path.dirname(exe), `${Path.basename(exe, '.exe')}.config`);

	FS.writeFileSync(sea, JSON.stringify({
		"output": rtd,
		"disableExperimentalSEAWarning": true,
		"useSnapshot": false,
		"useCodeCache": true
	}));
	FS.writeFileSync(bdl, bundle);
	const PROC = require('node:child_process');
	PROC.execFileSync(process.execPath, [Path.join(__dirname, 'inject.js'), exe]);
	console.error(`executable generated: ${exe}`);
	FS.unlinkSync(sea);
	FS.unlinkSync(rtd);
	FS.unlinkSync(bdl);
}

if (require.main === module) console.error('Usage: node -r @pipobscure/sea my script.js');
