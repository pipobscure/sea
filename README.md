# @pipobscure/sea

**This works agains [Future Node Versions ONLY](https://github.com/nodejs/node/pull/50960)**

This is my convenient [SEA](https://nodejs.org/dist/latest-v20.x/docs/api/single-executable-applications.html) builder. The way it is used is to simply run your scripts while hooked into it (preferably in a mode where it requires all files yet does not actually run for a long time).

In `package.json` you can use the follwing to configure your SEA:
```
{
	"sea": {
		"executable": "seatest", // the name of the resulting executable
		"assets": [ "assets/**/*" ], // an optional array of globs specifying files to bundle
		"exclude": [], // an optional array of globs to exclude
		"hash": true, // optional boolean if files require hash sha256 checking,
		"compression": "brotli" // optional (brotli|gzip|deflate) if assets should be compressed
	}
}
```

With that configuration done run your package in a way that ensures all code is `require`d.

```
#> node -r @pipobscure/sea lib/myscript.js
```

This hooks into the require system and records all the scripts and native addons loaded.
Just before exiting, it writes it to `{executable}.resolv`.

The last stepp is to simply run `npm exec @pipobscure/sea` which uses the config in `package.json` and `{executable}.resolv` to bundle everything up and inject it into a node executable.

**_Have fun and play with in the sea!_**
