var Path = require('path'), 
  temppipedir = require('allex_temppipedirserverruntimelib')();

function replaceall (str, find, repl) {
  var ind;
  while (true) {
    ind = str.indexOf(find);
    if (ind < 0) {
      return str;
    }
    str = str.substr(0, ind)+repl+str.substr(ind+1);
  }
}

module.exports = function (dirpath) {
  var cwd = replaceall(dirpath, Path.sep, '_')+'_allexnpminstaller';
  return Path.join(temppipedir, cwd);
};
