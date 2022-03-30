var Path = require('path'),
    net = require('net'),
    fs = require('fs'),
    child_process = require('child_process'),
    recognizer,
    configroot = require('allex_configrootserverruntimelib'),
    makePipeName = require('./pipename'),
    isPipeTaken,
    probename = '.allexnpminstaller__probe',
    _isWindows = require('./iswindows');

function createInstall (lib) {
  recognizer = lib.moduleRecognition;
  isPipeTaken = require('allex_ispipetakenserverruntimelib')(lib);

  function install(cb,moduleloaderror_or_modulename, cwd){
    var isglobal = false;
    if (!cwd) {
      isglobal = true;
      cwd = configroot();
    }else{
      cwd = Path.resolve(configroot(), cwd); ///should be dicussed: relative paths are bit problematic: relative to what?
    }
    if (!Path.isAbsolute(cwd)) {
      cwd = Path.resolve(process.cwd(), cwd);
    }
    var modulename;
    if (moduleloaderror_or_modulename instanceof Error || moduleloaderror_or_modulename.hasOwnProperty('code')) {
      if(moduleloaderror_or_modulename.code!=='MODULE_NOT_FOUND'){
        console.error(moduleloaderror_or_modulename);
        return;
      }
      var errstr = moduleloaderror_or_modulename.toString(),
          mm = errstr.match(/'(.*)'/),
          mmn = (mm && mm[1]) ? mm[1] : null,
          modulename = mmn;
    }else{
      modulename = moduleloaderror_or_modulename;
    }

    if ('string' !== typeof(modulename)) throw new Error('Invalid modulename error: '+modulename);

    check(cb, cwd, modulename, isglobal);
  }

  var zeroString = String.fromCharCode(0);

  function check(cb, cwd, modulename, isglobal, eraseprobe) {
    recognizer(modulename).then(oncheck.bind(null, cb, cwd, modulename, isglobal, eraseprobe));
  }

  function unlinkAnyhow (path) {
    try {
      fs.unlinkSync(path);
    } catch(ignore) {}
  }

  function oncheck(cb, cwd, modulename, isglobal, eraseprobe, isallex) {
    var installstring = process.pid+zeroString+(!!isglobal)+zeroString+(isallex && isallex.modulename ? isallex.modulename : modulename)+zeroString+(isallex && isallex.npmstring ? isallex.npmstring : modulename),
      installerpipename = makePipeName(cwd),
      installerprobename = Path.join(cwd, probename);

    if (fs.existsSync(installerprobename)) {
      if (eraseprobe) {
        //console.log('removing', installerprobename);
        unlinkAnyhow(installerprobename);
        //console.log('removed', installerprobename);
      } else {
        var timestamp = parseInt(fs.readFileSync(installerprobename));
        if(!isNaN(timestamp) && Date.now()-timestamp<100*1000){
          //console.log('giving up because', installerprobename);
          setTimeout(check.bind(null, cb, cwd, modulename, isglobal), 100);
          return;
        } else {
          unlinkAnyhow(installerprobename);
        }
      }
    }
    isPipeTaken(installerpipename).then(run.bind(null, installstring, cb, cwd, modulename, isglobal, installerpipename));
  }

  function run(installstring, cb, cwd, modulename, isglobal, installerpipename, sockettoprogram) {
    var installerprobename = Path.join(cwd, probename), options;
    //console.log('probing', installerprobename);
    if (fs.existsSync(installerprobename)) {
      //console.log('giving up because', installerprobename);
      setTimeout(check.bind(null, cb, cwd, modulename, isglobal), 100);
      return;
    }

    if (!sockettoprogram) {
      fs.writeFileSync(installerprobename, Date.now()+'');
      options = {
        cwd: cwd,
        detached: true,
        stdio: 'ignore'
      };
      if (_isWindows) {
        child_process.spawn('CMD',['/S', '/C', 'node', Path.join(__dirname, 'install.js')],options);
      } else {
        child_process.spawn('node',[Path.join(__dirname, 'install.js')],options);
      }
      setTimeout(check.bind(null, cb, cwd, modulename, isglobal, true), 250);
      return;
    }
    sockettoprogram.on('error', onSocketError.bind(null, modulename, cb));
    sockettoprogram.on('data', onInstallerResponse.bind(null, sockettoprogram, modulename, cb));
    sockettoprogram.write(installstring+"\t");
  }

  function onInstallerResponse(c, modulename, cb, data) {
    var s = data.toString();
    if (s === '1'){
      console.log(process.pid+' npm installed the missing module', modulename);
      cb(true);
    } else {
      console.error(process.pid+' npm could not install the missing module', modulename, 'because', s);
      cb(false);
    }
    c.removeAllListeners();
    c.end();
    c.destroy();
  }

  function onSocketError (modulename, cb, error) {
    console.error('npm could not install the missing module', modulename, 'because', error);
    cb(false);
  }

  return install;
}

module.exports = createInstall;

