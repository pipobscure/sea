import Module from 'node:module';
import * as FS from 'node:fs';
import * as Path from 'node:path';

import fileNames from './filenames.js';
import PackageBase from './packagebase.js';
const PKG = JSON.parse(FS.readFileSync(Path.join(PackageBase, 'package.json'), 'utf-8'));
const File = fileNames(PKG);

//@ts-expect-error
const { _resolveFilename, _load } = Module;
const { exit } = process;

const resolutions: Record<string, Record<string, string>> = {};

function replacementResolveFilename(this: Module, request: string, parent: Module, isMain: boolean) {
	const resolved = _resolveFilename.call(this, request, parent, isMain);
	const parentfile = parent?.filename
		? '/' +
			Path.relative(PackageBase, parent?.filename)
				.split(Path.sep)
				.join('/')
		: '<main>';
	const cache = (resolutions[parentfile] = resolutions[parentfile] ?? {});
	const specifier = (request === process.argv[1] ? '<main>' : request).split(Path.sep).join('/');
	if (!Module.isBuiltin(request)) {
		cache[specifier] = '/' + Path.relative(PackageBase, resolved).split(Path.sep).join('/');
	} else {
		if (!request.startsWith('node:')) {
			cache[specifier] = `node:${request}`;
		} else {
			cache[specifier] = request;
		}
	}
	return resolved;
}
function replacementLoad(this: Module & { _cache: Record<string, unknown> }, request: string, parent: Module, isMain: boolean) {
	replacementResolveFilename.call(this, request, parent, isMain);
	for (const name of Object.keys(this._cache)) {
		if (name.includes('\x00')) delete this._cache[name];
	}
	return _load.call(this, request, parent, isMain);
}
function replacementExit(this: typeof process, code: number = 0) {
	this.exitCode = code;
	this.emit('beforeExit', code ?? 0);
	return exit.call(this, code);
}
function beforeExitHandler() {
	Object.assign(Module, {
		_resolveFilename,
		_load,
	});
	Object.assign(process, {
		exit,
	});
	FS.writeFileSync(Path.join(PackageBase, File.resolutions), JSON.stringify(resolutions, undefined, '\t'));
}

Object.assign(Module, {
	_resolveFilename: replacementResolveFilename,
	_load: replacementLoad,
});
Object.assign(process, {
	exit: replacementExit,
});
process.once('beforeExit', beforeExitHandler);

if (require.main === module) console.error('Usage: node -r @pipobscure/sea my script.js');
