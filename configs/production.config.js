const { createConfigBundle } = require("./create-config");
const path = require("path");
const process = require("process");

const argOutdir = process.argv.findIndex(x => x === "--outdir");
const dirOutput = argOutdir === -1 ? null : path.resolve(__dirname, process.argv[argOutdir + 1]);

const bundleConfigs = {
    mode: "production",
    devtool: "source-map",
    minimize: true,
    dirOutput
};

console.log(JSON.stringify(createConfigBundle(bundleConfigs)));

module.exports = [createConfigBundle(bundleConfigs)];