const Proc = require('node:child_process');
const FS = require('node:fs/promises');
const OS = require('node:os');
const Path = require('node:path');

const { inject } = require('postject');
const { minify } = require('terser');

const SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
const EMB_FUSE = 'NODE_EMBED_fce680ab2cc467b6e072b8b5df1996b2';

async function main(exe) {
	const isWindows = OS.type().toLowerCase().includes('windows');

	const bdl = Path.join(Path.dirname(exe), `${Path.basename(exe, '.exe')}.blob`);
	const rtd = Path.join(Path.dirname(exe), `${Path.basename(exe, '.exe')}.runtime`);
	const sea = Path.join(Path.dirname(exe), `${Path.basename(exe, '.exe')}.config`);

	await FS.copyFile(process.execPath, exe);
	if (isWindows) {
		try {
			await exec('signtool', 'remove', '/s', exe);
		} catch (_e) {
			//ignore
		}
	} else {
		try {
			await exec('codesign', '--remove-signature', exe);
		} catch (_e) {
			//ignore
		}
	}

	const cfg = JSON.parse(await FS.readFile(sea, 'utf-8'));
	cfg.main = Path.join(Path.dirname(exe), `${Path.basename(exe, '.exe')}.js`);
	await FS.writeFile(sea, JSON.stringify(cfg));
	let code = await FS.readFile(Path.resolve(__dirname, './rt.js'), 'utf-8');
	({ code } = await minify(await FS.readFile(Path.resolve(__dirname, './rt.js'), 'utf-8'), {
		toplevel: true,
		compress: {
			passes: 2
		},
		mangle: {
			reserved: ['process']
		}
	}));
	await FS.writeFile(cfg.main, code);

	await exec(process.execPath, '--experimental-sea-config', sea);
	const runtime = await FS.readFile(rtd);
	await inject(exe, 'NODE_SEA_BLOB', runtime, {
		sentinelFuse: SEA_FUSE,
	});

	await FS.unlink(cfg.main);

	const bundle = await FS.readFile(bdl);
	await inject(exe, 'NODE_EMBEDDED_DATA', bundle, {
		sentinelFuse: EMB_FUSE,
	});
}
if (require.main === module) main(...process.argv.slice(2));

function exec(cmd, ...args) {
	return new Promise((resolve, reject) => {
		Proc.execFile(cmd, args, (err, stdout, stderr) => {
			process.stderr.write(stderr);
			process.stdout.write(stdout);

			if (err) return reject(err);
			resolve();
		})
			.on('error', () => { })
			.stdin.end();
	});
}
