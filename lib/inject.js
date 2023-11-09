const Proc = require('node:child_process');
const FS = require('node:fs/promises');

const { inject } = require('postject');

const SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

async function main(cfgfile) {
	const config = JSON.parse(await FS.readFile(cfgfile, 'utf-8'));
	await exec(process.execPath, '--experimental-sea-config', cfgfile);
	await FS.copyFile(process.execPath, config.executable);
	const content = await FS.readFile(config.output);
	await inject(config.executable, 'NODE_SEA_BLOB', content, {
		sentinelFuse: SEA_FUSE,
	});
}
if (require.main === module) main(...process.argv.slice(2));

function exec(cmd, ...args) {
	return new Promise((resolve, reject) => {
		Proc.execFile(cmd, args, (err, stderr, stdout) => {
			process.stderr.write(stderr);
			process.stdout.write(stdout);

			if (err) return reject(err);
			resolve();
		})
			.on('error', () => {})
			.stdin.end();
	});
}
