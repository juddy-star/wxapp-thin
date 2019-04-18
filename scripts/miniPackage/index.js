const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const { table } = require('table');
const {
  readFileAsync,
  writeFileAsync,
  unlinkAsync,
  getAllFile
} = require('./utils.js');

// 阈值
const THRESHOLD = Infinity;

// 总包大小
const TOTAL_SIZE = 8 * 1024 * 1024;

// 分包/主包大小
const SUB_SIZE = 2 * 1024 * 1024;

// 依赖文件的配置信息
const IMPORT_CONF = ['components'];

// 根路径
const ROOT_PATH = 'dist';

// 指定下发的分包
const optSubPackage = [
];

// 运行node所在的目录
const __cwd = process.cwd();

// 不可删除的依赖文件
const NO_UNLINK = [
];

// 小程序配置文件
const config = require('../../src/app.json');

// 主包的文件
const mainPackage = ((config) => {
  return config.pages.map((dirname) => {
    return path.dirname(dirname);
  });
})(config);

// 分包的文件
const subPackage = ((config) => {
  return config.subPackages.map(item => item.root);
})(config);

// 三种文件格式的import验证规则
const regulars = {
  wxml: /<import src=["']([\w./-]+)["']/gm,
  wxss: /@import ["']([\w./-]+)["']/gm,
  // 兼容es6和es5的语法，不支持AMD的格式
  js: /(import \w+ from ["']([\w./-]+)["'])|(require\(["']([\w./-]+)["']\))/gm
};

/**
 *
 * 平铺数组
 *
 * @param {*} [data=[]]
 * @returns
 */
const flatPathname = (data = []) => {
  if (Array.isArray(data)) {
    const arrTemp = [];
    data.forEach(item => {
      flatPathname(item).forEach(flagItem => {
        arrTemp.push(flagItem);
      });
    });
    return arrTemp;
  } else if (data) {
    return [{ dirname: data }];
  }
  return [];
};

/**
 *统计多个路径下文件的总大小（单位是字节）
 *
 * @param {string} [dirname='']
 * @returns
 */
const directorysSize = (dirnames = []) => {
  const directorySize = dirnames.map((dirname) => {
    return getAllFile(dirname, [], [])
    .then(flatPathname)
    .then((flatArr) => {
      return flatArr.reduce((total, { dirname = '' } = {}) => {
        const stat = fs.statSync(dirname);
        return total + parseInt(stat.size, 10);
      }, 0);
    });
  });
  return Promise.all(directorySize)
    .then((totalArr = []) => totalArr.reduce((total, item) => total + item, 0));
}

/**
 * 文件路径后缀
 *
 *
 * @param {*} flatArray
 * @returns
 */
const extPathname = (flatArray = []) => {
  return flatArray.map(fileInfo => {
    const { dirname = '' } = fileInfo;
    const ext = path.extname(dirname).slice(1);
    fileInfo.ext = ext;
    return fileInfo;
  });
}

/**
 * 文件路径属于主包还是属于分包
 *
 * @param {*} [flatArray=[]]
 * @returns
 */
const packagePathname = (flatArray = []) => {
  return flatArray.map(fileInfo => {
    const { dirname = '' } = fileInfo;
    if (!fileInfo.packages) fileInfo.packages = {};
    const findPackage = [...mainPackage, ...subPackage].find(item => dirname.indexOf(item) > -1);
    if (findPackage) {
      fileInfo.packages.directory = path.join(__cwd, ROOT_PATH, findPackage);
      fileInfo.packages.type = subPackage.some(item => item === findPackage) ? 'sub' : 'main';
    } else {
      fileInfo.packages.directory = path.join(__cwd, ROOT_PATH);
      fileInfo.packages.type = 'main';
    }
    // 判断该分包是否被允许接纳下发的依赖文件
    const { directory = '', type = '' } = fileInfo.packages;
    if (type === 'sub') {
      fileInfo.packages.legalInto = optSubPackage.length === 0 || optSubPackage.some(path => directory.indexOf(path) > -1);
    }
    return fileInfo;
  });
}


/**
 *处理文件数组所引用的所有文件
 *
 * @param {string} [key=['src/component']]
 * @param {*} [flatArray=[]]
 * @returns
 */
const polyAllImportPathname = (flatArray = []) => {
  const flatArrayWithImport = flatArray.map(fileInfo => polyImportPathname(fileInfo));
  return Promise.all(flatArrayWithImport);
};

/**
 *匹配正则后筛选的$1数据
 *
 * @param {string} [ext='']
 * @param {*} fileData
 * @returns
 */
const regularMatch = (ext = '', fileData) => {
  const regularMatch = [];
  let tempData = [];
  /*eslint-disable no-cond-assign*/
  while (tempData = regulars[ext].exec(fileData)) {
  /*eslint-enable no-cond-assign*/
    let pushData = tempData[1];
    if (ext === 'js') pushData = tempData[2] || tempData[4];
    regularMatch.push(pushData);
  }
  return regularMatch;
}


/**
 *处理文件所引用的文件
 *
 * @param {*} [key=[]]
 * @param {*} [fileInfo={}]
 * @returns
 */
const polyImportPathname = (fileInfo = {}) => {
  const { dirname = '', distDirname = '', ext = '', packages = {} } = fileInfo;
  if (!distDirname) fileInfo.distDirname = dirname;
  const directory = path.dirname(dirname);
  if (!fileInfo.imports) fileInfo.imports = [];

  // 可能会多次读取依赖文件，暂时不做优化（后期用缓存做依赖）
  return readFileAsync(dirname).then((fileData) => {
    const matchedImports = [];
    regularMatch(ext, fileData).forEach((srcImport) => {
      // 匹配到的文件路径（记得补充后缀）
      let srcDirname = path.resolve(directory, srcImport);
      if (ext === 'js') srcDirname = `${srcDirname}.js`;

      // 判断是否是满足需求的import
      const key = IMPORT_CONF.find(key => srcDirname.indexOf(`${ROOT_PATH}/${key}/`) > -1);
      if (key) {
        const imports = {
          src: {
            imports: srcImport,
            dirname: srcDirname
          }
        };
        // ROOT_PATH/IMPORT_CONF/
        const realKey = `${ROOT_PATH}/${key}/`;
        // key之后的路径
        const relativeDirname = srcDirname.slice(srcDirname.indexOf(realKey) + realKey.length);
        // 转移到该包下的路径
        const distDirname = path.join(packages.directory, 'build', key, relativeDirname);
        // 转移到该包下之后需要匹配的文本 （记得去掉后缀）
        let distImport = path.relative(path.dirname(dirname), distDirname);
        if (ext === 'js') distImport = distImport.slice(0, distImport.lastIndexOf('.'));
        imports.dist = {
          imports: distImport,
          dirname: distDirname
        };
        fileInfo.imports.push(imports);

        // 深度递归依赖树
        matchedImports.push(polyImportPathname({
          dirname: srcDirname,
          distDirname,
          ext: path.extname(srcDirname).slice(1),
          packages
        }));
      }
    });
    fileInfo.fileData = fileData;
    return Promise.all(matchedImports).then((importsArr = []) => {
      let { imports = [] } = fileInfo;
      imports.forEach((item, index) => {
        item.dependency = importsArr[index];
      })
      return fileInfo;
    });
  });
};

/**
 *统计依赖文件的信息
 *1. 被引入了多少次
 *2. 大小
 *3. 是否被主包引入过
 * @param {*} [flatArray=[]]
 */
const dependencyStatistics = (flatArray = [], dependencyCache = {}) => {
  const depDependency = [];
  // 统计被引入了多少次以及大小
  flatArray.forEach((fileInfo) => {
    const { imports = [], packages = {} } = fileInfo;
    if (imports.length > 0) {
      imports.forEach((item) => {
        const { src = {}, dependency = {} } = item;
        const { dirname = '' } = src;
        // 被引入了多少次，以及大小
        if (!dependencyCache[dirname]) {
          const stat = fs.statSync(dirname);
          dependencyCache[dirname] = {
            usedCount: 1,
            size: parseInt(stat.size, 10),
            importByMain: false,
            packages: []
          };
        } else {
          dependencyCache[dirname].usedCount += 1;
        }
        // 依赖该文件的包的信息
        if (!dependencyCache[dirname].packages.some(item => item.directory === packages.directory)) {
          dependencyCache[dirname].packages.push(packages);
        }
        // 是否被主包引入过
        const { [dirname]: { importByMain = false } = {} } = dependencyCache;
        if (!importByMain && packages.type === 'main') dependencyCache[dirname].importByMain = true;

        depDependency.push(dependency);
      });
    }
  });
  if (depDependency.length === 0) return { flatArray, dependencyCache };

  return Promise.resolve(dependencyStatistics(depDependency, dependencyCache))
    .then(() => { return { flatArray, dependencyCache } });
}

/**
 *对依赖的文件进行二次处理
 *
 * @param {*} [{ flatArray = [], dependencyCache = {} }={}]
 * @returns
 */
const depDependencyStatistics = ({ flatArray = [], dependencyCache = {} } = {}) => {
  NO_UNLINK.forEach((key) => {
    if (dependencyCache[key]) dependencyCache[key].importByMain = true;
  });
  return { flatArray, dependencyCache };
}


/**
 *统计包的信息
 *
 * @param {*} [{ flatArray = [], dependencyCache = {} }={}]
 */
const packageStatistics = ({ flatArray = [], dependencyCache = {} } = {}) => {
  let packageCache = {};
  const totalDir = path.resolve(__cwd, `./${ROOT_PATH}`);
  const totalSize = directorysSize([totalDir]).then(size => { return { total: { size, optSize: size } } });
  let subSize = subPackage.map((item) => {
    const subItemDir = path.join(__cwd, ROOT_PATH, item);
    return directorysSize([subItemDir]).then(size => { return { directory: subItemDir, size, optSize: size }; });
  });

  subSize = Promise.all(subSize).then((itemsSize = []) => {
    const size = itemsSize.reduce((total, item) => total + item.size, 0);
    const dependency = {};
    itemsSize.forEach((item = {}) => {
      const { directory = '', size = 0, optSize = 0 } = item;
      dependency[directory] = {
        size,
        optSize
      };
    });
    return { sub: {
      size,
      optSize: size,
      dependency
    } };
  });

  return Promise.all([totalSize, subSize]).then(([totalSize, subSize] = []) => {
    packageCache = { ...packageCache, ...totalSize, ...subSize };
    const { total, sub } = packageCache;
    packageCache.main = {
      size: total.size - sub.size,
      optSize: total.size - sub.size
    };
    return { flatArray, dependencyCache, packageCache };
  });
};

/**
 *
 *优化统计
 *
 * @param {number} [threshold=0]
 * @param {*} [{ flatArray = [], dependencyCache = {}, packageCache = {} }={}]
 */
const optimizeStatistics = ({ flatArray = [], dependencyCache = {}, packageCache = {} } = {}) => {
  const { total = {}, main = {}, sub = {} } = packageCache;
  const catchErr = [];

  // 统计主包优化后的大小
  const lessSize = Object.keys(dependencyCache).reduce((total = 0, key = {}) => {
    const item = dependencyCache[key];
    const { size = 0, importByMain = false, usedCount = 1, packages = [] } = item;
    // 依赖文件从主包移除的条件
    if (!importByMain && usedCount <= THRESHOLD && packages.every(packageItem => packageItem.legalInto)) {
      return total + size;
    }
    return total;
  }, 0);
  const { size: mainSize = 0 } = main;
  main.optSize = mainSize - lessSize;

  if (main.optSize > SUB_SIZE) {
    // catchErr.push({ type: 'MAXSize', msg: `主包大小超过${SUB_SIZE}` });
  }

  // 统计分包优化后的每个分包大小
  Object.keys(dependencyCache).forEach((key = '') => {
    const data = dependencyCache[key];
    const { importByMain = false, usedCount = 1, size: dependencySize = 0, packages = [] } = data;
    if (!importByMain && usedCount <= THRESHOLD) {
      packages.forEach(({ directory = '', type = '', legalInto = true } = {}) => {
        if (type === 'sub' && legalInto) {
          sub.dependency[directory].optSize += dependencySize;
        }
      });
    }
  });

  // 统计分包优化后的总分包的大小
  sub.optSize = Object.keys(sub.dependency).reduce((total, key) => {
    const data = sub.dependency[key];
    if (data.optSize > SUB_SIZE) {
      // catchErr.push({ type: 'MAXSize', msg: `${key}大小超过${SUB_SIZE}` });
    }
    return total + data.optSize;
  }, 0);

  // 统计总优化后的大小
  total.optSize = main.optSize + sub.optSize;

  if (total.optSize > TOTAL_SIZE) {
    // catchErr.push({ type: 'MAXSIZE', msg: `总包大小超过${TOTAL_SIZE}` });
  }
  if (catchErr.length > 0) {
    return Promise.reject(catchErr);
  }
  return { flatArray, dependencyCache, packageCache };
}

/**
 *计算新的相对地址
 *
 * @param {*} srcDirname
 * @param {*} srcRelative
 * @param {*} distDirname
 * @returns
 */
const relativePath = (srcDirname, srcRelative, distDirname) => {
  const srcDir = path.dirname(srcDirname);
  const srcAbs = path.resolve(srcDir, srcRelative);
  const distDir = path.dirname(distDirname);
  return path.relative(distDir, srcAbs);
}

/**
 *开始下发依赖的文件到分包里面
 *
 * @param {*} [{ flatArray = [], dependencyCache = {}, packageCache = {} }={}]
 */
const executePathname = ({ flatArray = [], dependencyCache = {}, packageCache = {} } = {}) => {
  const addPathname = [];
  const executeDependency = [];
  flatArray
    // 是分包并且是指定的可以接受依赖文件的分包
    .filter((item) => {
      const { type, legalInto } = item.packages;
      return type === 'sub' && legalInto;
    })
    .forEach((item) => {
      const { dirname = '', distDirname = '', ext = '', fileData, imports = [] } = item;

      // 判断当前的是页面文件还是依赖文件
      const isPage = !IMPORT_CONF.some(conf => dirname.indexOf(path.join(__cwd, ROOT_PATH, conf)) > -1);

      // 如果是页面文件，或者依赖文件还未打入分包中
      if (isPage || !fs.existsSync(distDirname)) {
        let distFileData = fileData;
        // 满足下发条件的依赖文件
        const srcImports = imports
          .filter((item) => {
            const { src: { dirname = '' } = {} } = item;
            const { importByMain = false, usedCount = 1 } = dependencyCache[dirname];
            return !importByMain && usedCount <= THRESHOLD;
          })
          .map((importData) => {
            const { src = {}, dist = {}, dependency = {} } = importData;
            // 如果是页面文件
            if (isPage) distFileData = distFileData.replace(src.imports, dist.imports);

            executeDependency.push(dependency);

            return src.imports;
          });
        if (!isPage) {
          regularMatch(ext, fileData).forEach((item) => {
            // 如果不是分包依赖的文件，都需要重新定位路径
            if (!srcImports.some(srcImport => srcImport === item)) {
              const distItem = relativePath(dirname, item, distDirname);
              distFileData = distFileData.replace(item, distItem);
            }
          });
        }
        addPathname.push(writeFileAsync(distDirname, distFileData));
      }
    });

  const promiseAllData = [...addPathname];
  if (executeDependency.length !== 0) {
    promiseAllData.push(executePathname({ flatArray: executeDependency, dependencyCache, packageCache }));
  }

  return Promise.all(promiseAllData).then(() => { return { flatArray, dependencyCache, packageCache } });
}


/**
 *删除下发到分包中的依赖文件
 *
 * @param {*} [{ flatArray = [], dependencyCache = {} }={}]
 * @returns
 */
const unlinkPathname = ({ flatArray = [], dependencyCache = {}, packageCache = {} } = {}) => {
  const unlinkPromise = Object.keys(dependencyCache)
    .filter((key) => {
      const { importByMain = false, usedCount = 1, packages = [] } = dependencyCache[key];
      // 依赖文件从主包移除的条件
      return (!importByMain && usedCount <= THRESHOLD && packages.every(packageItem => packageItem.legalInto));
    })
    .map(key => unlinkAsync(key));

  return Promise.all(unlinkPromise).then(() => { return { flatArray, dependencyCache, packageCache }; });
}

const optSizeDisplay = (str = '') => {
  let output = '';
  const formatStr = String(str);
  if (formatStr.length > 6) {
    output = `${(Number(formatStr) / 1000000).toFixed(2)}MB`;
  } else if (formatStr.length > 3) {
    output = `${(Number(formatStr) / 1000).toFixed(2)}KB`;
  } else {
    output = `${formatStr}B`;
  }
  return chalk.blue(output);
};

/**
 *成功log
 *
 * @param {*} [{ flatArray, dependencyCache, packageCache }={}]
 * @returns
 */
const sucLog = ({ flatArray = [], dependencyCache = {}, packageCache = {} } = {}) => {
  /*eslint-enable no-unused-vars */
  console.log(chalk.magenta('分包优化成功\n'));
  console.log(chalk.magenta('优化概况：'));
  const { total, main, sub } = packageCache;
  const packageCacheTable = table([
    ['包类型', '瘦身前', '瘦身后'],
    ['总包', optSizeDisplay(total.size), optSizeDisplay(total.optSize)],
    ['主包', optSizeDisplay(main.size), optSizeDisplay(main.optSize)],
    ['总分包', optSizeDisplay(sub.size), optSizeDisplay(sub.optSize)]
  ]);
  console.log(packageCacheTable, '\n');

  // 每个分包的信息
  console.log(chalk.magenta('优化详情：'));
  const subTableData = Object.keys(sub.dependency).map((key) => {
    const relativePath = path.relative(__cwd, key);
    const { size = 0, optSize = 0 } = sub.dependency[key];
    return { relativePath, size, optSize, changeSize: optSize - size };
  }).sort((a, b) => {
    return b.changeSize - a.changeSize;
  }).map((item) => {
    const { relativePath = '', size = 0, optSize = 0, changeSize = 0 } = item;
    return [relativePath, optSizeDisplay(size), optSizeDisplay(optSize), optSizeDisplay(changeSize)];
  });
  console.log(table([['分包地址', '瘦身前', '瘦身后', '增量'], ...subTableData]));
  return { flatArray, dependencyCache, packageCache };
};

/**
 *错误log
 *
 * @param {*} [err={}]
 */
const errLog = (err = {}) => {
  /*eslint-enable no-unused-vars */
  console.log(err);
};


// 读取文件的起始地址
const filePath = path.join(__cwd, ROOT_PATH);
// 排除的读取目录
const importsPath = IMPORT_CONF.map(item => path.join(__cwd, ROOT_PATH, item));

// ROOT_PATH下的所有文件
getAllFile(filePath, importsPath)
  .then(flatPathname)
  .then(extPathname)
  .then(packagePathname)
  .then(polyAllImportPathname)
  .then(dependencyStatistics)
  .then(depDependencyStatistics)
  .then(packageStatistics)
  .then(optimizeStatistics)
  .then(executePathname)
  .then(unlinkPathname)
  .then(sucLog)
  .catch(errLog)
