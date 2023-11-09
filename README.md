# @pipobscure/sea

This is my convenient [SEA](https://nodejs.org/dist/latest-v20.x/docs/api/single-executable-applications.html) builder. The way it is used is to simply run your scripts while hooked into it (preferably in a mode where it requires all files yet does not actually run for a long time).

In `package.json` you can use the follwing to configure your SEA:
```
{
	"sea": {
		"executable": "seatest", // the name of the resulting executable
		"useCodeCache": false,
		"assets": [ "assets/**/*" ] // an array of globs specifying files to bundle
		"hash": "*.dat" // a glob that assets need to match to be sha256 checked
	}
}
```

With that configuration done run your package in a way that ensures all code is `require`d.

```
#> node -r @pipobscure/sea lib/myscript.js
```

This hooks into the require system and records all the scripts and native addons loaded.
Just before exiting, it bundles them all up into a binary archive and build an SEA using
the tooling and scripting provided by this package.

**_Have fun and play with in the sea!_**
