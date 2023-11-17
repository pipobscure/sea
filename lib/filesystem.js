const FS = require('node:fs');
const FSP = require('node:fs/promises');
const Path = require('node:path');

exports.init = function init(sea) {
	const PathResolve = Path.resolve;
	Path.resolve = function (...args) {
		if (!args[0].startsWith('sea:/')) return PathResolve.apply(Path, args);
		const url = new URL(args[1], args[0]);
		url.pathname = url.pathname.replaceAll('//','/');
		args.splice(0, 2, url.toString());
		return args.length > 1 ? Path.resolve(...args) : args[0];
	};

	const PathJoin = Path.join;
	Path.join = function (first, ...parts) {
		if (!first.startsWith('sea:/')) return PathJoin.call(Path, first, ...parts);
		const url = new URL([first, ...parts].join('/'));
		url.pathname = url.pathname.replaceAll('//','/');
		return url.toString();
	};

	const FSPreadFile = FSP.readFile;
	FSP.readFile = function (filename, opts) {
		if (filename.startsWith('sea:')) {
			try {
				return Promise.resolve(FS.readFileSync(filename, opts));
			} catch (err) {
				return Promise.reject(err);
			}
		}
		return FSPreadFile(filename, opts);
	};

	const FSreadFileSync = FS.readFileSync;
	FS.readFileSync = function (filename, opts) {
		if (filename.startsWith('sea:')) {
			filename = (new URL(filename, 'sea:/')).toString();
			const content = sea.data(filename)?.data;
			if (!content) throw Object.assign(new Error('file not found: ' + filename), { code: 'ENOENT' });
			if ('string' === typeof opts) return content.toString(`${opts}`);
			if ('object' === typeof opts && opts?.encoding) return content.toString(`${opts.encoding}`);
			return content;
		}
		return FSreadFileSync(filename, opts);
	};

	const FSreadFile = FS.readFile;
	FS.readFile = function (path, opts, cb) {
		if (path.startsWith('sea:')) {
			if (!cb) {
				cb = opts;
				opts = undefined;
			}
			FSP.readFile(path, opts).then(
				(res) => cb(null, res),
				(err) => cb(err, null),
			);
		} else {
			return FSreadFile(path, opts, cb);
		}
	};
};
