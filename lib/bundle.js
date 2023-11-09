const Module = require('node:module');
const OS = require('node:os');
const FS = require('node:fs');
const Path = require('node:path');
const Proc = require('node:child_process');

const isWindows = OS.type().toLowerCase().includes('windows');
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

const resolutions = {};
const _resolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain) {
	const resolved = _resolveFilename.call(this, request, parent, isMain);
	const parentfile = parent?.filename ? 'sea:/' + Path.relative(base, parent?.filename).split(Path.sep).join('/') : '<main>';
	const cache = (resolutions[parentfile] = resolutions[parentfile] ?? {});
	const specifier = (request === process.argv[1] ? '<main>' : request).split(Path.sep).join('/');
	if (!Module.isBuiltin(request)) {
		cache[specifier] = 'sea:/' + Path.relative(base, resolved).split(Path.sep).join('/');
	} else {
		if (!request.startsWith('node:')) {
			cache[specifier] = `node:${request}`;
		} else {
			cache[specifier] = request;
		}
	}
	return resolved;
};
function bundle(PKG) {
	const blob = require('./blobs.js');
	const chunks = [];
	blob.create('resolutions', Buffer.from(JSON.stringify(resolutions)), blob.COMPRESSION.BROTLI & blob.HASH.NONE, chunks);
	for (const parent of Object.values(resolutions)) {
		for (const item of Object.values(parent)) {
			if (!item.startsWith('sea:/')) continue;
			const fname = Path.join(base, item.split('/').slice(1).join(Path.sep));
			const data = FS.readFileSync(fname);
			blob.create(item, data, blob.COMPRESSION.BROTLI & blob.HASH.NONE, chunks);
		}
	}
	if (Array.isArray(PKG.sea?.assets)) {
		const glob = require('glob');
		const seen = new Set();
		const hash = PKG.sea?.hash ? new (require('minimatch').Minimatch(PKG.sea?.hash))() : undefined;
		for (const expr of PKG.sea.assets) {
			for (const item of glob.globSync(expr, { cwd, nodir: true, absolute: true })) {
				if (seen.has(item)) continue;
				seen.add(item);
				const hashflags = hash && hash.match(item) ? blob.HASH.NONE : blob.HASH.SHA256;
				const fname = `sea:/${Path.relative(base, item).split(Path.sep).join('/')}`;
				const data = FS.readFileSync(item);
				blob.create(fname, data, blob.COMPRESSION.BROTLI & hashflags, chunks);
			}
		}
	}
	return Buffer.concat(chunks);
}
process.on('beforeExit', () => {
	Module._resolveFilename = _resolveFilename;
	const PKG = (() => {
		try {
			return require(Path.join(base, 'package.json'));
		} catch (e) {
			return {};
		}
	})();
	const executable = Path.join(base, (PKG.sea?.executable ?? 'sea') + (isWindows ? '.exe' : ''));
	const code = require('./assemble.js').assemble(bundle(PKG));
	const tmpdir = FS.mkdtempSync(Path.join(OS.tmpdir(), 'sea'));
	FS.writeFileSync(Path.join(tmpdir, 'code.js'), code);

	const cfgfile = Path.join(tmpdir, 'config.json');
	const config = JSON.stringify(
		{
			main: Path.join(tmpdir, 'code.js'),
			output: Path.join(tmpdir, 'sea.blob'),
			disableExperimentalSEAWarning: true, // Default: false
			useSnapshot: false, // Default: false
			useCodeCache: PKG.sea?.useCodeCache ?? true, // Default: false,
			executable,
		},
		undefined,
		'\t',
	);
	process.stderr.write(`Creating Single-Executable-Application (${tmpdir})\n`);
	FS.writeFileSync(cfgfile, config);
	try {
		const result = Proc.execFileSync(process.execPath, [Path.resolve(__dirname, 'inject.js'), cfgfile]);
		process.stderr.write(result.stdout?.toString('utf-8') ?? '');
		process.stderr.write(result.stderr?.toString('utf-8') ?? '');
	} catch (E) {
		console.error(E);
	}
	
});

if (require.main === module) console.error('Usage: node -r @pipobscure/sea my script.js');
