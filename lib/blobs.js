const crypto = require('node:crypto');
const zlib = require('node:zlib');

const VERSION = 1;
exports.VERSION = VERSION;

const COMPRESS_NONE = 0x00;
const COMPRESS_DEFLATE = 0x01;
const COMPRESS_GZIP = 0x02;
const COMPRESS_BROTLI = 0x03;
exports.COMPRESSION = {
	NONE: COMPRESS_NONE,
	DEFLATE: COMPRESS_DEFLATE,
	GZIP: COMPRESS_GZIP,
	BROTLI: COMPRESS_BROTLI,
};

const HASH_NONE = 0x00;
const HASH_SHA1 = 0x10;
const HASH_SHA2 = 0x20;
exports.HASH = {
	NONE: HASH_NONE,
	SHA1: HASH_SHA1,
	SHA2: HASH_SHA2,
	SHA256: HASH_SHA2,
};

exports.create = function create(name, data, flags, buffers) {
	const nbuf = Buffer.from(name, 'utf-8');
	if (nbuf.byteLength > 0xffff) throw new Error('name too long');

	buffers = buffers ?? [];

	const header = Buffer.alloc(8);
	header[0] = VERSION;
	header[1] = flags;
	header.writeUInt16BE(nbuf.byteLength, 2);
	buffers.push(header);
	buffers.push(nbuf);
	switch (true) {
		case !!(flags & HASH_SHA2):
			buffers.push(crypto.createHash('sha256').update(data).digest());
			break;
		case !!(flags & HASH_SHA1):
			buffers.push(crypto.createHash('sha1').update(data).digest());
			break;
	}

	switch (true) {
		case !!(flags & COMPRESS_BROTLI):
			const brotli = zlib.brotliCompressSync(data);
			header.writeUint32BE(brotli.byteLength, 4);
			buffers.push(brotli);
			break;
		case !!(flags & COMPRESS_GZIP):
			const gzip = zlib.gzipSync(data);
			header.writeUint32BE(gzip.byteLength, 4);
			buffers.push(gzip);
			break;
		case !!(flags & COMPRESS_DEFLATE):
			const deflated = zlib.gzipSync(data);
			header.writeUint32BE(deflated.byteLength, 4);
			buffers.push(deflated);
			break;
		default:
			header.writeUint32BE(data.byteLength, 4);
			buffers.push(data);
	}

	return buffers;
};
function blob(buffer, offset = 0) {
	if (buffer[offset] !== VERSION) throw new Error(`invalid data-buffer ${offset} (${buffer[offset]} !== ${VERSION})`);
	const flags = buffer[offset + 1];
	const nlen = buffer.readUInt16BE(offset + 2);
	const dlen = buffer.readUInt32BE(offset + 4);
	const nbuf = buffer.subarray(offset + 8, offset + 8 + nlen);
	let hashbuffer = null;
	let dataoffset = offset + 8 + nlen;
	switch (true) {
		case !!(flags & HASH_SHA2):
			dataoffset = offset + 8 + nlen + 32;
			hashbuffer = buffer.subarray(dataoffset - 32, dataoffset);
			break;
		case !!(flags & HASH_SHA1):
			dataoffset = offset + 8 + nlen + 20;
			hashbuffer = buffer.subarray(dataoffset - 20, dataoffset);
			break;
	}

	let data = null;
	switch (true) {
		case !!(flags & COMPRESS_BROTLI):
			data = zlib.brotliDecompressSync(buffer.subarray(dataoffset, dataoffset + dlen));
			break;
		case !!(flags & COMPRESS_GZIP):
			data = zlib.gunzipSync(buffer.subarray(dataoffset, dataoffset + dlen));
			break;
		case !!(flags & COMPRESS_GZIP):
			data = zlib.inflateSync(buffer.subarray(dataoffset, dataoffset + dlen));
			break;
		default:
			data = buffer.subarray(dataoffset, dataoffset + dlen);
			break;
	}

	switch (true) {
		case !!(flags & HASH_SHA2):
			if (hashbuffer.toString('hex') !== crypto.createHash('sha256').update(data).digest('hex')) {
				throw new Error('hash mismatch');
			}
			break;
		case !!(flags & HASH_SHA1):
			if (hashbuffer.toString('hex') !== crypto.createHash('sha1').update(data).digest('hex')) {
				throw new Error('hash mismatch');
			}
			break;
	}

	const start = offset;
	const block = dataoffset + dlen - offset;
	return { data, flags, name: nbuf.toString('utf-8'), hash: hashbuffer && hashbuffer.toString('hex'), start, block };
}
function info(buffer, offset = 0) {
	if (buffer[offset] !== VERSION) throw new Error('invalid data-buffer');
	const flags = buffer[offset + 1];
	const nlen = buffer.readUInt16BE(offset + 2);
	const dlen = buffer.readUInt32BE(offset + 4);
	const name = buffer.subarray(offset + 8, offset + 8 + nlen).toString('utf-8');

	let hashbuffer = null;
	let dataoffset = offset + 8 + nlen;
	switch (true) {
		case !!(flags & HASH_SHA2):
			dataoffset = offset + 8 + nlen + 32;
			hashbuffer = buffer.subarray(dataoffset - 32, dataoffset);
			break;
		case !!(flags & HASH_SHA1):
			dataoffset = offset + 8 + nlen + 20;
			hashbuffer = buffer.subarray(dataoffset - 20, dataoffset);
			break;
	}
	const start = offset;
	const block = dataoffset + dlen - offset;
	return { name, flags, hash: hashbuffer ? hashbuffer.toString('hex') : undefined, start, block };
}

function* entries(buffer) {
	let offset = 0;
	while (offset < buffer.byteLength) {
		const blockinfo = info(buffer, offset);
		yield blockinfo;
		offset += blockinfo.block;
	}
}
function index(buffer) {
	const items = Array.from(entries(buffer));
	const result = items.reduce((agg, info) => ((agg[info.name] = info), agg), {});
	return result;
}
exports.access = function access(buffer) {
	const sea = Object.create(null, {
		index: {
			value: index(buffer),
			enumerable: true,
			configurable: true,
		},
		data: {
			value: function (name) {
				const info = sea.index[name];
				if (!info) return undefined;
				return blob(buffer, info.start);
			},
			enumerable: true,
			configurable: true,
		},
		hash: {
			value: function (name) {
				return sea.index[name]?.hash;
			},
			enumerable: true,
			configurable: true,
		},
		flags: {
			value: function (name) {
				return sea.index[name]?.flags;
			},
			enumerable: true,
			configurable: true,
		},
		compression: {
			value: function (name) {
				return (sea.flags(name) ?? 0) & 0x0f;
			},
			enumerable: true,
			configurable: true,
		},
		hashalgo: {
			value: function (name) {
				return (sea.flags(name) ?? 0) & 0xf0;
			},
			enumerable: true,
			configurable: true,
		},
		names: {
			value: function () {
				return Object.keys(sea.index);
			},
			enumerable: true,
			configurable: true,
		},
		values: {
			value: function () {
				return Object.values(sea.index);
			},
			enumerable: true,
			configurable: true,
		},
		entries: {
			value: function () {
				return Object.entries(sea.index);
			},
			enumerable: true,
			configurable: true,
		},
	});
	return sea;
};
