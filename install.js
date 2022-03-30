var net = require('net'),
  fs = require('fs'),
  Path = require('path'),
  lib = require('allexlib'),
  q = lib.q,
  qlib = lib.qlib,
  JobCollection = qlib.JobCollection,
  JobBase = qlib.JobBase,
  makePipeName = require('./pipename'),
  pipename;
  isPipeTaken = require('allex_ispipetakenserverruntimelib')(lib),
  Node = require('allex_nodehelpersserverruntimelib')(lib),
  server = null,
  connectionCounter = 0,
  child_process = require('child_process'),
  killTimer = lib.runNext(die.bind(null,0),15*1000),
  BunyanLogger = require('allex_bunyanloggerserverruntimelib'),
  ps = require('ps-node'),
  pstree = require('ps-tree'),
  modules = new lib.Map(),
  submodules = new lib.Map(),
  requests = new JobCollection();

var Logger = new BunyanLogger('.npminstaller.log', null, 1, 'npm-install');

pipename = makePipeName(process.cwd());
isPipeTaken(pipename).then(run, die.bind(null,1));

function InstallRequest(isglobal, module, path){
  JobBase.call(this);
  Logger.info('new', this.constructor.name, module, path);
  modules.add(path, this);
  this.isglobal = isglobal;
  this.running = false;
  this.pid = null;
  this.module = module;
  this.path = path;
  this.requesters = [];
}
lib.inherit(InstallRequest, JobBase);
InstallRequest.prototype.destroy = function () {
  modules.remove(this.path);
  Logger.info('done InstallRequest', this.path, this.module);
  this.running = null;
  this.requesters = null;
  this.path = null;
  this.module = null;
  this.isglobal = null;
  JobBase.prototype.destroy.call(this);
};
InstallRequest.prototype.go = function () {
  if (this.running === false) {
    this.running = true;
    this.checkInstallation(this.onInitialCheck.bind(this))
  }
};
InstallRequest.prototype.onInitialCheck = function (exitcode) {
  Logger.info(this.module, 'onInitialCheck', exitcode);
  if (exitcode===0) {
    this.finalize();
  } else {
    this.doInstall();
  }
};
InstallRequest.prototype.doInstall = function () {
  Logger.info('going to install', this.path, 'currently in', process.cwd());
  var execopts, npminstallinguserid, cp;
  execopts = {
    cwd: Path.join(process.cwd()),
    stdio: 'inherit'
  };
  if (process.env.NPMINSTALLINGUSERID) {
    npminstallinguserid = parseInt(process.env.NPMINSTALLINGUSERID);
    Logger.info('npminstallinguserid', npminstallinguserid);
    if (lib.isNumber(npminstallinguserid) && !isNaN(npminstallinguserid)) {
      execopts.uid = npminstallinguserid;
    }
    if (process.env.NPMINSTALLINGUSERHOME) {
      execopts.env = lib.extend(process.env, {
        HOME: process.env.NPMINSTALLINGUSERHOME
      });
    }
  }
  cp = child_process.exec('npm install '+(this.isglobal ? '-g ' : '')+this.path, execopts);
  this.pid = cp.pid;
  cp.on('exit', this.onInstalled.bind(this));
};
function notifier(res, req){
  req.resolve(res);
}
InstallRequest.prototype.onInstalled = function (error, stdout, stderr) {
  if (!error) {
    Logger.info('installed', this.path, error, Path.join(process.cwd(), this.path));
    this.checkInstallation(this.onCheck.bind(this));
  } else {
    Logger.error('install error is', error);
    if (error === 1) {
      error = new Error("Cannot find module '"+this.module+"'");
    }
    this.requesters.forEach(notifier.bind(null,error));
    this.destroy();
  }
};
InstallRequest.prototype.onPS = function (cb, error, resultarry) {
  if (error) {
    cb (1);
  } else {
    if (resultarry && resultarry.length) {
      cb (1);
    } else {
      this.onNoNpmProcesses(cb);
    }
  }
};
InstallRequest.prototype.onNoNpmProcesses = function (cb) {
  return this.forkTester(cb);
};
InstallRequest.prototype.forkTester = function (cb) {
  if (!Node.Fs.existsSync(Path.join('node_modules', this.module))){
    cb(1);
    return;
  }
  try {
    require.resolve(this.module, {paths: [this.path]});
    Logger.info(this.module, 'require succeeded');
  } catch (e) {
    Logger.error(this.module, 'require failed', e);
    cb(1);
    return;
  }
  pstree(this.pid, this.onPsTree.bind(this, cb));
  return;
  var cp = child_process.fork('./test.js', [this.module], {}),
    cppid = cp.pid+'',
    d = q.defer(),
    ret = d.promise;
  submodules.add(cppid, this.path);
  cp.on('exit', this.onTestDone.bind(this, d, cppid, cb));
  return ret;
};
InstallRequest.prototype.onPsTree = function (cb, err, children) {
  if (err) {
    cb(1);
    return;
  }
  if (children && children.length) {
    cb(1);
    return;
  }
  cb(0);
  return;
};
InstallRequest.prototype.onTestDone = function (defer, testpid, cb) {
  submodules.remove(testpid);
  cb.apply(null, Array.prototype.slice.call(arguments, 3));
  defer.resolve(true);
  defer = null;
  testpid = null;
  cb = null;
};
InstallRequest.prototype.checkInstallation = function (cb) {
  ps.lookup({command: 'npm'}, this.onPS.bind(this, cb));
};
InstallRequest.prototype.onCheck = function (exitcode) {
  if (exitcode == 0) {
    this.finalize();
  } else {
    setTimeout(this.checkInstallation.bind(this, this.onCheck.bind(this)), 1000);
  }
};
InstallRequest.prototype.finalize = function () {
  this.requesters.forEach(notifier.bind(null,'1'));
  this.resolve(true);
};

function SuperInstallRequest (isglobal, module, path) {
  InstallRequest.call(this, isglobal, module, path);
  this.subrequests = [];
}
lib.inherit(SuperInstallRequest, InstallRequest);
SuperInstallRequest.prototype.destroy = function () {
  if (this.subrequests) {
    lib.arryDestroyAll(this.subrequests);
  }
  this.subrequests = null;
  InstallRequest.prototype.destroy.call(this);
};
SuperInstallRequest.prototype.onNoNpmProcesses = function (cb) {
  return q.all(this.subrequests).then(
    this.forkTester.bind(this, cb)
  );
};

//Connectivity
function connectionHandler(c) {
  new ConnectionHandler(c);
}

function run(sockettoprogram){
  Node.Fs.ensureDirSync('node_modules');
  onMkDir(sockettoprogram);
}

function die(result) {
  if (result) {
    process.exit(result);
  }else {
    Node.Fs.removeSync(pipename);
    process.exit(0);
  }
}

function onMkDir (sockettoprogram, error) {
  if(error) {
    Logger.error(error);
    die(5);
    return;
  }
  if(sockettoprogram) {
    sockettoprogram.destroy();
    die(2);
    return;
  }
  server = net.createServer(connectionHandler);
  server.on('error',die.bind(null,4));
  server.on('close',die.bind(null,0));
  server.listen(pipename, function(e){
    if (e) {
      Logger.error('server start problem',e);
      die(3);
    }
  });
}

function ConnectionHandler(socket) {
  connectionCounter++;
  if (killTimer) {
    lib.clearTimeout(killTimer);
    killTimer = null;
  }
  this.socket = socket;
  this.message = '';
  socket.on('close', this.destroy.bind(this));
  socket.on('error', this.destroy.bind(this));
  socket.on('data', this.onData.bind(this));
}
ConnectionHandler.prototype.destroy = function () {
  this.socket.removeAllListeners();
  this.socket.destroy();
  this.message = null;
  this.socket = null;
  connectionCounter--;
  if (connectionCounter<1) {
    if (!killTimer) {
      killTimer = lib.runNext(server.close.bind(server), 30*1000);
    }
  }
};
function tabPos(buffer){
  var ret = 0;
  while (ret < buffer.length){
    if(buffer[ret] === 9){
      return ret;
    }
    ret ++;
  }
  return ret;
}
ConnectionHandler.prototype.onData = function (data) {
  var tabpos = tabPos(data);
  this.message += data.toString('utf8', 0, tabpos);
  if (tabpos < data.length) {
    this.run();
  }
};
var zeroString = String.fromCharCode(0);
ConnectionHandler.prototype.run = function () {
  var p = this.message.split(zeroString); //"\t");
  if (p.length===3) {
    this.invoke(p[0], p[1], p[2], p[2]);
  } else {
    this.invoke(p[0], p[1], p[2], p[3]);
  }
};
ConnectionHandler.prototype.invoke = function (invokerpid, isglobal, modulename, path) {
  Logger.info('invoke', modulename, path, 'from', invokerpid);
  var r = modules.get(path), spath, sr;
  if (!r) {
    spath = submodules.get(invokerpid);
    r = new (spath ? InstallRequest : SuperInstallRequest)(isglobal, modulename, path);
    r.requesters.push(this);
    if (spath) {
      sr = modules.get(spath);
      if (sr) {
        sr.subrequests.push(r.defer.promise);
        r.go();
      } else {
        requests.run('install', r);
      }
    } else {
      requests.run('install', r);
    }
  } else {
    r.requesters.push(this);
  }
};
ConnectionHandler.prototype.resolve = function (result) {
  if (!this.socket) {
    return;
  }
  this.socket.end(result.toString());
};
//end of Connectivity

