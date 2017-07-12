function createInstall (lib) {
  var Path = require('path'),
      net = require('net'),
      fs = require('fs'),
      child_process = require('child_process'),
      recognizer = lib.moduleRecognition,
      configroot = require('allex_configrootserverruntimelib'),
      isPipeTaken = require('allex_ispipetakenserverruntimelib')(lib),
      pipename = '.allexnpminstaller';

  function install(cb,moduleloaderror_or_modulename, cwd){
    if (!cwd) {
      cwd = configroot();
    }else{
      cwd = Path.resolve(configroot(), cwd); ///should be dicussed: relative paths are bit problematic: relative to what?
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

    check(cb, cwd, modulename);
  }

  var zeroString = String.fromCharCode(0);

  function check(cb, cwd, modulename, eraseprobe) {
    recognizer(modulename).then(oncheck.bind(null, cb, cwd, modulename, eraseprobe));
  }

  function oncheck(cb, cwd, modulename, eraseprobe, isallex) {
    var installstring = process.pid+zeroString+(isallex && isallex.modulename ? isallex.modulename : modulename)+zeroString+(isallex && isallex.npmstring ? isallex.npmstring : modulename),
      installerpipename = Path.join(cwd, pipename),
      installerprobename = installerpipename+'__probe';

    if (fs.existsSync(installerprobename)) {
      if (eraseprobe) {
        //console.log('removing', installerprobename);
        fs.unlinkSync(installerprobename);
        //console.log('removed', installerprobename);
      } else {
        var timestamp = parseInt(fs.readFileSync(installerprobename));
        if(!isNaN(timestamp) && Date.now()-timestamp<100*1000){
          //console.log('giving up because', installerprobename);
          setTimeout(check.bind(null, cb, cwd, modulename), 100);
          return;
        } else {
          fs.unlinkSync(installerprobename);
        }
      }
    }
    isPipeTaken(installerpipename).then(run.bind(null, installstring, cb, cwd, modulename, installerpipename));
  }

  function run(installstring, cb, cwd, modulename, installerpipename, sockettoprogram) {
    var installerprobename = installerpipename+'__probe';
    //console.log('probing', installerprobename);
    if (fs.existsSync(installerprobename)) {
      //console.log('giving up because', installerprobename);
      setTimeout(check.bind(null, cb, cwd, modulename), 100);
      return;
    }

    if (!sockettoprogram) {
      fs.writeFileSync(installerprobename, Date.now()+'');
      child_process.spawn('node',[Path.join(__dirname, 'install.js')],{
        cwd: cwd,
        detached: true,
        stdio: 'ignore'
      });
      setTimeout(check.bind(null, cb, cwd, modulename, true), 250);
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
    console.error('npm could not install the missing module', modulename, 'because', e);
    cb(false);
  }

  return install;
}

module.exports = createInstall;

