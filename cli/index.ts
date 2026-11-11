// Entry point of dist/safebox.js. The version is filled in by esbuild from package.json.

import { Cli } from './Cli'


declare const SAFEBOX_VERSION: string


process.exitCode = await new Cli(SAFEBOX_VERSION).run(process.argv.slice(2))
