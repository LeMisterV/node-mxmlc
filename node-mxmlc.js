var path = require('path');
var fs = require('fs');
var childProcess = require('child_process');

var rimraf = require('rimraf');

var rsvp = require('rsvp');

var semver = require('semver');

var download = require('download');
var ProgressBar = require('progress');
var filesize = require('filesize');


var pkg = require('./package.json');

module.exports = {
    getSdk: function getSdk(version, callback) {
        var sdkDetails = {};

        version = semver.parse(version);

        if (!version) {
            throw new Error('Invalid version (should match SemVer syntax)');
        }

        sdkDetails.version = version.version;

        if (!pkg.sdks || !pkg.sdks[sdkDetails.version]) {
            throw new Error('Unknown SDK version. You should add it to package.json or ask for another one');
        }

        sdkDetails.url = pkg.sdks[sdkDetails.version].url;

        sdkDetails.path = path.join(__dirname, 'sdks', sdkDetails.version);
        sdkDetails.mxmlcPath = path.join(
            sdkDetails.path,
            pkg.sdks[sdkDetails.version].binpath || 'bin',
            'mxmlc'
        );

        sdkDetails.exec = childProcess.execFile.bind(childProcess, sdkDetails.mxmlcPath);

        var willGet = rsvp.Promise.resolve()
            .then(function() {
                var willCheckInstalled = rsvp.defer();

                fs.stat(sdkDetails.path, function(error, stat) {
                    sdkDetails.installed = !error && stat.isDirectory();
                    willCheckInstalled.resolve();
                });

                return willCheckInstalled.promise;
            })
            .then(function() {
                if (sdkDetails.installed) {
                    return;
                }

                var willDownload = rsvp.defer();

                download(sdkDetails.url, sdkDetails.path, { extract: true })
                    .on('response', function(response) {
                        var expectedLength = parseInt(response.headers['content-length'], 10);
                        progress = new ProgressBar(
                            'downloading ' + filesize(expectedLength) + ' [:bar] :percent :etas',
                            {
                                complete: '=',
                                incomplete: ' ',
                                width: 40,
                                total: expectedLength
                            }
                        );
                    })
                    .on('data', function(chunk) {
                        progress.tick(chunk.length);
                    })
                    .on('error', function(error) {
                        willDownload.reject(error);
                    })
                    .on('close', function(file) {
                        console.log('SDK downloaded successfully.');
                        willDownload.resolve();
                    });

                return willDownload.promise;
            })
            .then(function() {
                var willCheckMxmlcBinary = rsvp.defer();

                fs.stat(sdkDetails.mxmlcPath, function(error, stat) {
                    if (error || !stat.isFile()) {
                        var simpleError = new Error('mxmlc binary not available');
                        simpleError.parent = error;
                        return willCheckMxmlcBinary.reject(simpleError);
                    }

                    sdkDetails.mxmlcBinaryStat = stat;

                    willCheckMxmlcBinary.resolve();
                });

                return willCheckMxmlcBinary.promise;
            })
            .then(function() {
                if (process.platform === 'win32' || sdkDetails.mxmlcBinaryStat.mode & 64) {
                    return;
                }

                console.log('Fix mxmlc binary mode: add execution permission');

                var willFixMxmlcBinary = rsvp.defer();

                fs.chmod(sdkDetails.mxmlcPath, '755', function(error) {
                    if (error) {
                        return willFixMxmlcBinary.reject(new Error('Unable to change permissions for mxmlc binary'));
                    }

                    willFixMxmlcBinary.resolve();
                });

                return willFixMxmlcBinary.promise;
            })
            .catch(function(reason) {
                rimraf(sdkDetails.path, function() {
                    console.log('SDK folder removed');
                });
                throw reason;
            });

        if (callback) {
            willGet
                .then(function() {
                    callback(null, sdkDetails);
                })
                .catch(function(reason) {
                    callback(reason);
                });
        }

        return willGet
            .then(function() {
                return sdkDetails;
            });
    },

    getDefaultVersion: function getDefaultVersion() {
        if (!pkg.sdks) {
            throw new Error('package.json should contain a sdks property defining flex sdks available');
        }

        return Object.keys(pkg.sdks).slice(-1)[0];
    }
};