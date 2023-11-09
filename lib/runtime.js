const { init: filesystem } = require('./filesystem.js');

const { access } = require('./blobs.js');

exports.init = function initialize(SEA_BUFFER) {
	NODE_SEA = access(SEA_BUFFER);
	NODE_RES = JSON.parse(NODE_SEA.data('resolutions').data.toString('utf-8'));
	const main = NODE_RES['<main>']['<main>'];
	process.argv[1] = main;
	filesystem(NODE_SEA);
	require(main);
};
