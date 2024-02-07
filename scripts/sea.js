#!/usr/bin/env node

async function main() {
	console.error('writing configuration');
	await (require('../dist/configure.js').configure());
	console.error('assembling bundle');
	await (require('../dist/bundlefiles.js').bundle());
	console.error('building executable');
	await (require('../dist/injection.js').inject());
	console.error('done');
}

if (require.main === module) main();
