var childProcess = require('child_process');

var path = require('path');
var fs = require('fs');

var url = require('url');
var http = require('http');

var semver = require('semver');
var rimraf = require('rimraf');
var download = require('download');
var filesize = require('filesize');
var ProgressBar = require('progress');
var D2UConverter = require('dos2unix').dos2unix;

var pkgMeta = require('./package.json');

module.exports = {
    execMxmlc: function execMxmlc(mxmlcPath, args, callback) {
        var cp = childProcess.execFile(
            mxmlcPath,
            args
        );

        cp.stdout.pipe(process.stdout);
        cp.stderr.pipe(process.stderr);

        cp.on('exit', function(code, signal) {
            if (code || signal) {
                return callback && callback(code || signal);
            }

            callback && callback();
        });
    },

    getSdk: function getSdk(version, callback) {
        version = semver.parse(version);

        if (!version) {
            return callback('invalid version (should match SemVer syntax)');
        }

        var sdk_path = path.join(__dirname, 'sdks', version.version);

        var onSuccess = callback.bind(null, null, {
            path: sdk_path
        });

        var onError = function(msg) {
            rimraf(sdk_path, function() {
                console.log('sdk folder deleted');
            });
            callback(msg);
        };

        fs.stat(sdk_path, function(error, stat) {
            if (error || !stat.isDirectory()) {

                if (pkgMeta.sdks && pkgMeta.sdks[version.version]) {
                    var progress;

                    download(pkgMeta.sdks[version.version].url, sdk_path, { extract: true })
                        .on('response', function(response) {
                            var expectedLength = parseInt(response.headers['content-length'], 10);
                            progress = new ProgressBar('downloading ' + filesize(expectedLength) + ' [:bar] :percent :etas', {
                                complete: '=',
                                incomplete: ' ',
                                width: 40,
                                total: expectedLength
                            });
                        })
                        .on('data', function(chunk) {
                            progress.tick(chunk.length);
                        })
                        .on('error', function(error) {
                            onError('Sdk download error');
                        })
                        .on('close', function(file) {
                            console.log('sdk downloaded');

                            var d2u = new D2UConverter({
                                glob: {
                                    cwd: sdk_path
                                },
                                maxConcurrency: 100
                            })
                            .on('error', function(error) {
                                onError('Error while converting line-endings');
                            })
                            .on('end', function(stats) {
                                if (stats.error > 0) {
                                    return onError('Error while converting line-endings');
                                }

                                console.log('line-endings converted');

                                if (process.platform !== 'win32') {
                                    console.log('Enabling execution on mxmlc binary');
                                    var binaryPath = path.join(sdk_path, 'bin', 'mxmlc');
                                    fs.stat(binaryPath, function(error, stat) {
                                        if (error) {
                                            return onError('Unable to get file stat for mxmlc binary');
                                        }
                                        // 64 === 0100 (no octal literal in strict mode)
                                        if (!(stat.mode & 64)) {
                                            console.log('Fixing file permissions for: mxmlc binary');
                                            fs.chmod(binaryPath, '755', function(error) {
                                                if (error) {
                                                    return onError('Unable to change permissions for mxmlc binary');
                                                }

                                                onSuccess();
                                            });
                                            return;
                                        }

                                        onSuccess();
                                    });
                                    return;
                                }

                                onSuccess();
                            });

                            d2u.process(['**/*']);
                            console.log('Converting line-endings');
                        });
                    return console.log('downloading sdk v' + version.version);
                }

                return callback('unknown sdk version');
            }

            callback(null, {
                path: sdk_path
            });
        }.bind(this));
    },

    get: function get(version, callback) {
        this.getSdk(version, function(error, sdk) {
            if (error) {
                return callback(error);
            }

            var mxmlcPath = path.join(sdk.path, 'bin', 'mxmlc');

            fs.stat(mxmlcPath, function(error, stat) {
                if (error || !stat.isFile()) {
                    return callback('mxmlc binary unavailable in the sdk');
                }

                callback(null, {
                    path: mxmlcPath,
                    exec: this.execMxmlc.bind(this, mxmlcPath)
                });
            }.bind(this));
        }.bind(this));
    }
};