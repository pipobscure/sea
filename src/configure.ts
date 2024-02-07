import fileNames from './filenames.js';
import { base } from './packagebase.js';
import * as FS from 'node:fs';
import * as Path from 'node:path';
//const { minify } = require('terser');

const PackageBase = base(process.cwd());
const PKG = JSON.parse(FS.readFileSync(Path.join(PackageBase, 'package.json'), 'utf-8'));
const File = fileNames(PKG);

export interface SEAConfig {
	main: string;
	output: string;
	disableExperimentalSEAWarning?: boolean;
	useSnapshot?: boolean;
	useCodeCache?: boolean;
	assets?: Record<string, string>;
}
export async function configure() {
	let code = await FS.promises.readFile(Path.resolve(__dirname, './runtime.js'), 'utf-8');
	// ({ code } = await minify(code, {
	// 	toplevel: true,
	// 	compress: {
	// 		passes: 2
	// 	},
	// 	mangle: {
	// 		reserved: ['process']
	// 	}
	// }));
	await FS.promises.writeFile(Path.join(PackageBase, File.runtime), code);
	const config: SEAConfig = {
		main: File.runtime,
		output: File.bundle,
		disableExperimentalSEAWarning: true,
		useSnapshot: false,
		useCodeCache: true,
		assets: {
			resolv: File.resolutions,
			bundle: File.blobs,
		},
	};
	await FS.promises.writeFile(Path.join(PackageBase, File.config), JSON.stringify(config, undefined, '\t'));
}

if (require.main === module) configure();
