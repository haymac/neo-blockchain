/* @flow */
/* eslint-disable */
const plumber = require("gulp-plumber");
const through = require("through2");
const chalk = require("chalk");
const newer = require("gulp-newer");
const babel = require("gulp-babel");
const watch = require("gulp-watch");
const gutil = require("gulp-util");
const gulp = require("gulp");
const path = require("path");
const merge = require("merge-stream");

const sources = ["packages"];

function swapSrcWithLib(srcPath) {
  const parts = srcPath.split(path.sep);
  parts[1] = "lib";
  return parts.join(path.sep);
}

function getGlobFromSource(source) {
  return `./${source}/*/src/**/*.js`;
}

gulp.task("default", ["build"]);

gulp.task("build", function() {
  return merge(
    sources.map(source => {
      const base = path.join(__dirname, source);

      return gulp
        .src(getGlobFromSource(source), { base: base })
        .pipe(
          plumber({
            errorHandler: function(err) {
              gutil.log(err.stack);
            },
          })
        )
        .pipe(
          newer({
            dest: base,
            map: swapSrcWithLib,
          })
        )
        .pipe(
          through.obj(function(file, enc, callback) {
            gutil.log("Compiling", "'" + chalk.cyan(file.relative) + "'...");
            callback(null, file);
          })
        )
        .pipe(
          through.obj(function(file, enc, callback) {
            // Passing 'file.relative' because newer() above uses a relative
            // path and this keeps it consistent.
            file.path = path.resolve(
              file.base,
              swapSrcWithLib(file.relative) + '.flow',
            );
            callback(null, file);
          })
        )
        .pipe(gulp.dest(base))
        .pipe(
          through.obj(function(file, enc, callback) {
            // Passing 'file.relative' because newer() above uses a relative
            // path and this keeps it consistent.
            file.path = file.path.slice(0, -('.flow'.length));
            callback(null, file);
          })
        )
        .pipe(babel())
        .pipe(gulp.dest(base));
    })
  );
});

gulp.task("watch", ["build"], function() {
  watch(sources.map(getGlobFromSource), { debounceDelay: 200 }, function() {
    gulp.start("build");
  });
});
