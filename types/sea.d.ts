declare module "node:sea" {
	function getAsset(name: string) : ArrayBuffer;
	function getAsset(name: string, encoding: NodeJS.BufferEncoding) : string;
	function getAssetAsBlob(name: string) : Blob;
	function getRawAsset(name: string) : ArrayBuffer;
}
