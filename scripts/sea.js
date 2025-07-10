#!/usr/bin/env node

const { exec } = require("node:child_process");
const { platform } = require("node:os");


async function codesign() {
	let osPlatform = platform();
	if ( osPlatform == "darwin" ){
		const fs = require('fs');
		const Path = require('path');
		const { base } = require("../dist/packagebase.js");
		const PackageBase = base(process.cwd());
		const PKG = JSON.parse(fs.readFileSync(Path.join(PackageBase, 'package.json'), 'utf-8'));
		const exe_name = `${PKG?.sea?.executable ?? 'bundle'}`;
		console.log(`signing ${exe_name}`);
		exec(`codesign --sign - ${exe_name}`, (error, stdout, stderr) => {
			if (error) {
				console.log(`error: ${error.message}`);
				return;
			}
			if (stderr) {
				console.log(`codesign err: ${stderr}`);
				return;
			}
			console.log(`codesign: ${stdout}`);
		});
	}
}

async function main() {
	console.error('writing configuration');
	await (require('../dist/configure.js').configure());
	console.error('assembling bundle');
	await (require('../dist/bundlefiles.js').bundle());
	console.error('building executable');
	await (require('../dist/injection.js').inject());
	console.error('codesign');
	await codesign();
	console.error('done');
}

if (require.main === module) main();
