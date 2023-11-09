const FS = require('node:fs');
const Path = require('node:path');

const DEPENDS = ['./runtime.js', './blobs.js', './filesystem.js'];
function wrap(filename) {
	filename = Path.resolve(__dirname, filename);
	const code = FS.readFileSync(filename, 'utf-8');
	const name = Path.relative(__dirname, filename).split(Path.sep).join('/');
	return `modules[${JSON.stringify(`load:/${name}`)}] = { loaded: false, exports:{}, exec: function(module, exports, require, __dirname, __filename) { ${code} } };`;
}
function load(specifier) {
	if (specifier === 'sea:assets') return NODE_SEA;
	if (NODE_RES) {
		specifier = NODE_RES[this === 'load:/' ? '<main>' : this]?.[specifier] ?? specifier;
	}
	const name = new URL(specifier, new URL(this ?? 'load:/')).toString();
	if (modules[name]) {
		if (!modules[name].loaded) {
			const dirname = new URL('./', name).toString();
			modules[name].exec.call(null, modules[name], modules[name].exports, load.bind(name), dirname, name);
			modules[name].loaded = true;
		}
		return modules[name].exports;
	}
	if (NODE_SEA && name.startsWith('sea:')) {
		const module = (modules[name] = { loaded: false, exports: {} });
		switch (Path.extname(name).toLowerCase()) {
			case '.json':
				module.exports = JSON.parse(NODE_SEA.data(name).data);
				module.loaded = true;
				return module.exports;
			case '.js':
				const dirname = new URL('./', name).toString();
				module.exec = new Function('module', 'exports', 'require', '__dirname', '__filename', NODE_SEA.data(name).data);
				module.exec.call(null, module, module.exports, load.bind(name), dirname, name);
				module.loaded = true;
				return module.exports;
			case '.node':
				const { data, hash } = NODE_SEA.data(name);
				const tmpnam = Path.join(OS.tmpdir(), [(hash ?? CR.createHash('sha1').update(data).digest('hex')).slice(0, 8), process.pid, 'node'].join('.'));
				FS.writeFileSync(tmpnam, data);
				process.dlopen(module, tmpnam);
				module.loaded = true;
				return module.exports;
			default:
				throw new Error(`don't know how to load ${name}`);
		}
	}
	return requireFile(specifier);
}
exports.assemble = function assemble(buffer) {
	const parts = [];
	parts.push(`const Path = require('node:path');`);
	parts.push(`const FS = require('node:fs');`);
	parts.push(`const OS = require('node:os');`);
	parts.push(`const CR = require('node:crypto');`);
	parts.push(`const modules = {};`);
	parts.push(`let NODE_SEA;`);
	parts.push(`let NODE_RES;`);
	for (const depend of DEPENDS) parts.push(wrap(depend));
	parts.push(`const requireFile = require('node:module').createRequire(process.argv0);`);
	parts.push(load.toString());
	parts.push(`load.bind('load:/')('load:/runtime.js').init(Buffer.from('${buffer.toString('base64')}','base64'));`);
	return parts.join('\n');
};
