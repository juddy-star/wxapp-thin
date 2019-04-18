const fs = require('fs');
const path = require('path');

/**
 * promise形式的读取文件
 *
 * @param {string} [dirname='']
 * @param {string} [type='utf-8']
 * @returns
 */
const readFileAsync = (dirname = '', type = 'utf-8') => {
  return new Promise((resolve, reject) => {
    fs.readFile(dirname, type, (err, data) => {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    })
  });
};

/**
 *创建文件
 *
 * @param {string} [dirname='']
 */
const createDirFile = (dirname = '') => {
  const dirStack = dirname.split('/');
  let dir = '';
  while (dirStack.length) {
    dir += dirStack.shift();
    if (dirname !== dir) dir += '/';

    if (!fs.existsSync(dir)) {
      if (dirname === dir) {
        fs.createWriteStream(dirname);
      } else {
        fs.mkdirSync(dir);
      }
    }
  }
};

/**
 * promise形式的写入
 *
 * @param {string} [dirname='']
 * @returns
 */
const writeFileAsync = (dirname = '', fileData) => {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(dirname)) createDirFile(dirname);
    fs.writeFile(dirname, fileData, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

/**
 *promise形式的删除
 *
 * @param {string} [dirname='']
 */
const unlinkAsync = (dirname = '') => {
  return new Promise((resolve, reject) => {
    fs.unlink(dirname, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    })
  });
}

/**
 * promise形式的读取目录
 *
 * @param {string} [dirname='']
 * @returns
 */
const readDirAsync = (dirname = '') => {
  return new Promise((resolve, reject) => {
    fs.readdir(dirname, (err, data) => {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
  });
}

/**
 * 是否是目录
 *
 * @param {string} [dirname='']
 * @returns
 */
const isDirectory = (dirname = '') => {
  return fs.existsSync(dirname) && fs.lstatSync(dirname).isDirectory();
}

/**
 * 是否是文件
 *
 * @param {string} [dirname='']
 * @returns
 */
const isFile = (dirname = '') => {
  return fs.existsSync(dirname) && fs.lstatSync(dirname).isFile();
};

/**
 * 获得特定格式的所有文件
 *
 * @param {string} [dirname='']
 * @param {string} [types=['js', 'wxml', 'wxss']]
 * @returns
 */
const getAllFile = (dirname = '', ignoreDirs = [], types = ['js', 'wxml', 'wxss']) => {
  if (isDirectory(dirname) && !ignoreDirs.some(ignore => ignore === dirname)) {
    return readDirAsync(dirname).then((files) => {
      const filesPool = files.map(file => getAllFile(path.resolve(dirname, file), ignoreDirs, types));
      return Promise.all(filesPool);
    });
  } else if (isLegalFile(dirname, types)) {
    return Promise.resolve(dirname);
  }  
  return Promise.resolve('');
}

/**
 * 是否满足特定格式
 *
 * @param {string} [dirname='']
 * @param {string} [types=['js', 'wxml', 'wxss']]
 * @returns
 */
const isLegalFile = (dirname = '', types = ['js', 'wxml', 'wxss']) => {
  if (!isFile(dirname)) return;
  if (types.length === 0) return true;
  const dirnameExt = path.extname(dirname).slice(1);
  return types.some(type => type === dirnameExt); 
};

module.exports = {
  readFileAsync,
  createDirFile,
  writeFileAsync,
  unlinkAsync,
  readDirAsync,
  isDirectory,
  isFile,
  getAllFile,
  isLegalFile
};