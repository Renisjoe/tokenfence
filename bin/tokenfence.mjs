#!/usr/bin/env node
// Node 22.18+ runs the TypeScript sources directly, so this shim is all the
// "build step" TokenFence has.
import { main } from "../src/cli.ts";

process.exitCode = await main(process.argv.slice(2));
