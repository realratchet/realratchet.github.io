const fs = require("fs");
const path = require("path");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");

require('dotenv').config()

function createModuleConfig({ name, resolve, entry: _entry, library }) {
    return function ({ bundleAnalyzer, mode, devtool, minimize, dirOutput, stats }) {
        const pluginsSASS = (mode === "production"
            ? [{ loader: MiniCssExtractPlugin.loader }]
            : ["style-loader"])
            .concat([
                { loader: "css-loader", options: { url: false } },
                "sass-loader",
            ]);

        const plugins = [];
        if (mode === "production") plugins.push(new MiniCssExtractPlugin({
            filename: "./bin/[name].bundle.css",
            chunkFilename: "./bin/[name].chunk.css"
        }));

        const entry = {};
        entry[name] = typeof _entry === "string" ? [_entry] : _entry;

        const output = {
            filename: "./bin/[name].bundle.js",
            path: dirOutput ? dirOutput : path.resolve(__dirname, ".."),
            chunkFilename: "./bin/[name].chunk.js"
        };

        if (library) {
            output["library"] = library ? `Module_${name}` : undefined;
            output["libraryTarget"] = "var";
            output["libraryExport"] = "default";
        }

        const rules = [{
            test: /\.(sa|sc|c)ss$/,
            use: pluginsSASS,
            exclude: /(node_modules|submodules)/,
        }, {
            test: /\.(vs|fs|glsl)$/,
            loader: "raw-loader"
        }];


        rules.unshift({
            test: /\.vue$/,
            exclude: /(node_modules|submodules)/,
            loader: "vue-loader",
            options: {
                presets: [
                    ["@babel/preset-env", {
                        targets: { browsers: ["chrome >= 80"] }
                    }],
                    [
                        "@babel/preset-typescript", {
                            allowNamespaces: true,
                            targets: {
                                browsers: ["chrome >= 80"]
                            }
                        }
                    ]
                ],
                plugins: [
                    "@babel/transform-runtime",
                    "@babel/plugin-proposal-class-properties"
                ]
            }
        }, {
            test: /\.(js|jsx|ts|tsx)$/,
            exclude: /(node_modules|submodules)/,
            loader: "babel-loader",
            options: {
                presets: [
                    ["@babel/preset-env", {
                        targets: { browsers: ["chrome >= 80"] }
                    }],
                    [
                        "@babel/preset-typescript", {
                            allowNamespaces: true,
                            targets: {
                                browsers: ["chrome >= 80"]
                            }
                        }
                    ]
                ],
                plugins: [
                    "@babel/transform-runtime",
                    "@babel/plugin-proposal-class-properties"
                ]
            }
        });

        const httpsSettings = process.env.HTTPS_KEY && process.env.HTTPS_CERT && process.env.HTTPS_CA
            ? {
                https: {
                    key: process.env.HTTPS_KEY,
                    cert: process.env.HTTPS_CERT,
                    ca: process.env.HTTPS_CA,
                }
            } : {};

        return {
            entry,
            mode,
            stats,
            resolve,
            optimization: {
                minimize
            },
            module: { rules },
            plugins,
            output,
            devServer: {
                port: 8080,
                compress: true,
                allowedHosts: "all",
                hot: false,
                static: {
                    directory: path.resolve(__dirname, ".."),
                    publicPath: ""
                },
                ...httpsSettings
            },
            devtool,
            context: __dirname,
            experiments: {
                asyncWebAssembly: true
            }
        };
    }
}

module.exports.createConfigBundle = createModuleConfig({
    name: "client",
    resolve: {
        fallback: {
            "buffer": false,
            "path": require.resolve("path-browserify")
        },
        extensions: [".tsx", ".ts", ".js"],
        alias: {
            "@client": path.resolve(__dirname, "../src"),
            "@unreal": path.resolve(__dirname, "../src/assets/unreal")
        }
    },
    entry: "../src/index.ts"
});