import * as OS from 'node:os';

const isWindows = OS.type().toLowerCase().includes('windows');

export default function names(PKG: any) {
	const name = `${PKG?.sea?.executable ?? 'bundle'}`;
	const config = `${name}.config`;
	const blobs = `${name}.bundle`;
	const index = `${name}.index`;
	const resolutions = `${name}.resolv`;
	const runtime = `${name}.js`;
	const bundle = `${name}.sea`;
	const executable = `${name}${isWindows ? '.exe' : ''}`;
	const useSnapshot = PKG?.sea?.useSnapshot ?? false;
	const useCodeCache = PKG?.sea?.useCodeCache ?? false;
	const files = {
		config,
		blobs,
		index,
		resolutions,
		runtime,
		bundle,
		executable,
		useSnapshot,
		useCodeCache,
	};
	return files;
}
