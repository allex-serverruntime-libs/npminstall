var lib = require('allexlib'),
  install = require('..')(lib);

install (installdatafilters, 'allex', __dirname);

function installdatafilters () {
  install (installbufferlib, 'allex_datafilterslib', __dirname);
}

function installbufferlib () {
  install(installldblib, 'allex_bufferlib', __dirname);
}

function installldblib() {
  install(load, 'allex:leveldb:lib', __dirname);
}

function load () {
  require('allex_leveldblib')(require('allex')).then(use, process.exit.bind(process, 1));
}

function use (ldblib) {
  var d = lib.q.defer();
  new ldblib.LevelDBHandler({
    dbname: [__dirname, 'blah.db'],
    initiallyemptydb: true,
    starteddefer: d
  });
  d.promise.then(function () {
    console.log('all done!');
    process.exit(0);
  });
}

