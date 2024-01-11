declare module "postject" {
	type InjectOptions = {
		sentinelFuse?:string;
	};
	function inject(exe: string, name: string, data: Buffer, options?: InjectOptions) : Promise<void>;
}
