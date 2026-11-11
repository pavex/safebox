// Entry point of dist/safebox.js. The version is filled in by esbuild from package.json.

import { runCli } from './Cli'


declare const SAFEBOX_VERSION: string


process.exitCode = await runCli(process.argv.slice(2), SAFEBOX_VERSION)
