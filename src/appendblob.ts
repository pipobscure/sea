import * as Crypto from 'node:crypto';
import * as ZLib from 'node:zlib';
import * as OS from 'node:os';

import type { Writable } from 'node:stream';

export const VERSION = 1;
export const COMPRESSION = {
	NONE: 0x00,
	DEFLATE: 0x01,
	GZIP: 0x02,
	BROTLI: 0x03,
};
export const HASH = {
	NONE: 0x00,
	SHA1: 0x10,
	SHA2: 0x20,
};

export async function append(stream: Writable, name: string, data: Uint8Array, flags: number = COMPRESSION.NONE | HASH.NONE, logfile: Writable = process.stderr) {
	const nbuf = Buffer.from(name, 'utf-8');
	if (nbuf.byteLength > 0xffff) throw new Error('name too long');

	const header = Buffer.alloc(8);
	header.writeUint8(VERSION, 0);
	header.writeUint8(flags, 1);
	header.writeUInt16BE(nbuf.byteLength, 2);

	switch (true) {
		case !!(flags & COMPRESSION.BROTLI):
			data = ZLib.brotliCompressSync(data);
			break;
		case !!(flags & COMPRESSION.GZIP):
			data = ZLib.gzipSync(data);
			break;
		case !!(flags & COMPRESSION.DEFLATE):
			data = ZLib.gzipSync(data);
			break;
	}
	header.writeUInt32BE(data.byteLength, 4);

	const hex = header.toString('hex').padStart(16, '0');
	logfile.write([hex.slice(0, 2), hex.slice(2, 4), hex.slice(4, 8), hex.slice(8, 16)].join(':') + ' ' + name + OS.EOL);

	await write(stream, header);
	await write(stream, nbuf);

	switch (true) {
		case !!(flags & HASH.SHA2):
			await write(stream, Crypto.createHash('sha256').update(data).digest());
			break;
		case !!(flags & HASH.SHA1):
			await write(stream, Crypto.createHash('sha1').update(data).digest());
			break;
	}

	await write(stream, data);
}

function write(stream: Writable, data: Uint8Array) {
	return new Promise<void>((resolve, reject) => {
		stream.write(data, (error?: Error | null) => {
			if (error) {
				reject(error);
			} else {
				resolve();
			}
		});
	});
}
