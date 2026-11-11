// Entry point of dist/safebox.js. Version and copyright are filled in by esbuild from package.json.

import { Cli } from './Cli'


declare const SAFEBOX_VERSION: string
declare const SAFEBOX_COPYRIGHT: string


process.exitCode = await new Cli(SAFEBOX_VERSION, SAFEBOX_COPYRIGHT).run(process.argv.slice(2))
