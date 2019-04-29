/*eslint-disable global-require */
/*eslint-disable import/no-dynamic-require */
const blueBird = require('bluebird');
const fs = blueBird.promisifyAll(require('fs'));
const path = require('path');
const chalk = require('chalk');
const Error = require('./error.js');
const Log = require('./log.js');
const {
  readFileAsync,
  writeFileAsync,
  unlinkAsync,
  getAllFile,
} = require('./utils.js');

const {
  // 阈值
  threshold: THRESHOLD,
  // 根路径
  root: ROOT_PATH,
  // 运行node所在的目录
  __cwd,
  // 总包大小
  totalSize: TOTAL_SIZE,
  // 分包/主包大小
  subSize: SUB_SIZE,
  // 下发文件所在目录的白名单
  whiteList,
  // 下发文件所在目录的黑名单
  blackList,
  // 指定下发的分包
  optSubPackage
} = require('./config.js');

const log = new Log();
const error = new Error();

/**
 * resolve
 * 
 * 1. process.cwd()
 * 2. dist目录下的绝对路径
 *
 * @param {*} rest
 */
const resolve = (...rest) => path.resolve.apply(path, [__cwd, ROOT_PATH, ...rest]);

// 小程序配置文件
const config = require(resolve('app.json'));

// 主包的文件
const mainPackage = ((config) => {
  return config.pages.map((dirname) => {
    return path.dirname(resolve(dirname));
  });
})(config);

// 分包的文件
const subPackage = ((config) => {
  return config.subPackages.map(item => resolve(item.root));
})(config);

/**
 * 拿到入口的文件列表
 *
 * @returns
 */
const getEntryFileList = () => {
  const {
    pages: mainPages = [], subPackages = []
  } = config;

  /**
   * 通过入口文件（不带后缀），生成四种带后缀的文件
   *
   * @param {*} [fileDirList=[]]
   * @param {string} [fileDirNoExt='']
   * @returns
   */
  const genFileDirList = (fileDirList = [], fileDirNoExt = '') => {
    const unitFileDirList = ['.wxml', '.js', '.wxss', '.json']
      .map(ext => `${fileDirNoExt}${ext}`)
      .filter(fileDir => fs.existsSync(fileDir));

    return [...fileDirList, ...unitFileDirList];
  }

  const mainPageFileDirList = mainPages
    .map(mainPage => resolve(mainPage))
    .reduce(genFileDirList, []);

  /**
   * 生成分包的所有页面的四种后缀的文件
   *
   * @param {*} [sPFDirList=[]]
   * @param {*} [subPackage={}]
   * @returns
   */
  const genSPFDirList = (sPFDirList = [], subPackage = {}) => {
    const { root: subPackageRoot = '', pages: subPackagePages = [] } = subPackage;

    return subPackagePages
      .map((subPackagePage) => resolve(subPackageRoot, subPackagePage))
      .reduce(genFileDirList, sPFDirList);
  };

  const subPageFileDirList = subPackages.reduce(genSPFDirList, []);

  return [...mainPageFileDirList, ...subPageFileDirList, resolve('app.wxss'), resolve('app.js')];
  // return [resolve('pages/main/index.js'), resolve('pages/midShare/index.js')];
};

// 三种文件格式的import验证规则
const regulars = {
  wxml: /<import src=["']([\w./-/$]+)["']/gm,
  wxss: /@import ["']([\w./-/$]+)["']/gm,
  // 兼容es6和es5的语法，不支持AMD的格式
  js: /(import(?: .+ from)? ["']([\w./-/$]+)["'])|(require\(["']([\w./-/$]+)["']\))/gm
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
    const findPackage = [...mainPackage, ...subPackage].find(item => dirname.indexOf(item + '/') > -1);
    if (findPackage) {
      fileInfo.packages.directory = findPackage;
      fileInfo.packages.type = subPackage.some(item => item === findPackage) ? 'sub' : 'main';
    } else {
      fileInfo.packages.directory = resolve();
      fileInfo.packages.type = 'main';
    }
    // 判断该分包是否被允许接纳下发的依赖文件
    const { directory = '', type = '' } = fileInfo.packages;
    if (type === 'sub') {
      fileInfo.packages.legalInto = optSubPackage.length === 0 || optSubPackage.some(packageDir => directory === resolve(packageDir));
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
  const flatArrayWithImport = flatArray.map(fileInfo => polyImportPathname(fileInfo, []));
  return Promise.all(flatArrayWithImport);
};


/**
 * .json的匹配
 *
 * @param {string} [dirname='']
 * @returns
 */
const regularMatchByJson = (dirname = '') => {
  const { usingComponents = {} } = require(dirname);

  const componentKeys = Object.keys(usingComponents);
  if (componentKeys.length === 0) return [];
  
  const genMathcedStrList = (matchedStrList = [], componentKey = '') => {
    const matchedStr = usingComponents[componentKey];

    return ['.wxml', '.js', '.wxss', '.json'].reduce((matchedStrList = [], ext = '') => [...matchedStrList, `${matchedStr}${ext}`], matchedStrList);
  };

  return componentKeys.reduce(genMathcedStrList, []);
};

/**
 * .js .wxml .wxss的匹配
 *
 * @param {string} [ext='']
 * @param {*} fileData
 * @returns
 */
const regularMatchCommon = (ext = '', fileData) => {
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
};

/**
 * 匹配正则后筛选的$1数据
 *
 * 1. .json的匹配
 * 2. .js .wxml .wxss的匹配
 * 
 * @param {string} [ext='']
 * @param {*} fileData
 * @returns
 */
const regularMatch = (ext = '', dirname = '', fileData) => {
  // 处理json格式，自定义组件格式
  if (ext === 'json') return regularMatchByJson(dirname);

  return regularMatchCommon(ext, fileData);
}


/**
 * 是第三方包
 *
 * @param {string} [srcImport='']
 * @param {string} [ext='']
 * @returns
 */
const isNodeModules = (srcImport = '', ext = '') => {
  // 不是以./ ../ / 开头  并且  是js
  return !/(\.){0,2}\//.test(srcImport) && ext === 'js';
}

/*
 * 1. 结构 key value的hash结构
 * 1.1. key 是  fileDir
 * 1.2. value 是 Map
 * 1.2.1 keys为  dirname distDirname, ext, packages, imports
 * 1.2.2 imports为List结构 每一项为 src dist 不保存dependency 
 * 
 * */
const polyFileMapCache = {};

/**
 *处理文件所引用的文件
 *
 * @param {*} [key=[]]
 * @param {*} [fileInfo={}]
 * @param {*} [deepKeys={}]
 * @returns
 */
const polyImportPathname = (fileInfo = {}, deepKeys = []) => {
  const { dirname = '', distDirname = '', ext = '', packages = {} } = fileInfo;

  if (!distDirname) fileInfo.distDirname = dirname;

  /**
   * 保存fileData
   *
   * @param {*} fileData
   * @returns
   */
  const saveFileData = (fileData) => {
    fileInfo.fileData = fileData;
    return fileData;
  };

  /**
   * 生成引入文件产生的imports数据结构
   * 1. src:  imports dirname
   * 2. dist: imports dirname
   * 3. dependency: polyImportPathname(fileInfo)
   *
   */
  const genMatchedImportsCommonList = (matchedStrList = []) => {
    /**
     * 生成匹配的文件的polyImport对象
     *
     * @param {string} [matchedStr='']
     * @returns
     */
    const genMatchedImportsCommonMap = (matchedStr = '') => {
      // 默认按照相对路径解析，拿到绝对路径（不确定是否有后缀）
      let matchedFileDir = resolve(path.dirname(dirname), matchedStr);
      // 如果是绝对路径, 按照绝对路径解析
      if (path.isAbsolute(matchedStr)) matchedFileDir = resolve(matchedStr.slice(1));

      // 如果是第三方包, 返回空Map
      if (isNodeModules(matchedStr, ext)) return {};

      // 解析路径
      const parsedDirMap = path.parse(matchedFileDir);
      // 如果没有后缀，把父层的后缀赋给当前路径
      if (!parsedDirMap.ext) parsedDirMap.base += `.${ext}`;
      // 生成完整的绝对路径
      matchedFileDir = path.format(parsedDirMap);
      // 不存在该文件，返回空Map
      if (!fs.existsSync(matchedFileDir)) {
        error.addFailDep({
          fileDir: dirname,
          matchedDir: matchedFileDir,
          matchedStr 
        });
        return {};
      }

      // 文件下发后的路径
      const distFileDir = resolve(packages.directory, 'build', matchedFileDir.replace(resolve(), '').slice(1));

      let srcImports = matchedStr;
      let distImports = path.relative(path.dirname(dirname), distFileDir);

      // 如果当前是json文件，则依赖字符串去掉后缀
      srcImports = ext === 'json' ? srcImports.replace(/\.\w+$/, '') : srcImports;
      distImports = ext === 'json' ? distImports.replace(/\.\w+$/, '') : distImports;

      // 准备工作完成，开始组装数据
      return {
        src: {
          imports: srcImports,
          dirname: matchedFileDir
        },
        dist: {
          imports: distImports,
          dirname: distFileDir,
        },
      };
    };

    /**
     * 忽略异常文件
     * 1. 不存在的文件
     * 2. 第三方包
     *
     * @param {*} [matchedImportsMap={}]
     */
    const ignoreBlankMap = (matchedImportsMap = {}) => Object.keys(matchedImportsMap).length > 0;

    return matchedStrList
      .map(genMatchedImportsCommonMap)
      .filter(ignoreBlankMap);
  };

  /**
   * 添加到缓存
   *
   * @param {*} [imports=[]]
   * @returns
   */
  const addToCache = (matchedStrList = []) => {
    polyFileMapCache[dirname] = {
      fileData: fileInfo.fileData,
      matchedStrList

    };
    return matchedStrList;
  }

  /**
   * 生成引入文件产生的imports数据结构
   * 1. dependency: polyImportPathname(fileInfo)
   *
   * @param {*} [matchedImportsCommonList=[]]
   * @returns
   */
  const genMatchedImportsDepListAsync = (matchedImportsCommonList = []) => {
     /**
     * 把polyImport对象递归化
     *
     * @param {*} [matchedImportsMap={}]
     */
    const genMatchedImportsDep = (matchedImportsMap = {}) => {
      const { src: { dirname = '' } = {}, dist: { dirname: distDirname = '' } = {} } = matchedImportsMap;

      return polyImportPathname({
        dirname,
        distDirname,
        ext: path.extname(dirname).slice(1),
        packages
      }, [...deepKeys]);
    }

    const matchedImportsDepListAsync = matchedImportsCommonList.map(genMatchedImportsDep);

    /**
     * 组装数据结构
     *
     * @param {*} [depList=[]]
     * @returns
     */
    const setupMatchedImportsList = (depList = []) => {
      return depList.map((dep, index) => ({
        ...matchedImportsCommonList[index],
        dependency: dep
      }));
    }

    return Promise.all(matchedImportsDepListAsync)
      .then(setupMatchedImportsList);
  };

  /**
   * 保存由引入文件生成的imports数据结构
   * 
   * 1. 依然返回当前的fileInfo
   *
   * @param {*} [matchedImportsList=[]]
   * @returns
   */
  const saveMatchedImportsList = (matchedImportsList = []) => {
    fileInfo.imports = matchedImportsList;

    return fileInfo;
  };

  // deepKeys当中是否有当前的fileInfo，如果有的话，直接返回当前的fileInfo
  if (deepKeys.some(deepKey => deepKey === dirname)) {
    error.addCircleDep([...deepKeys, dirname]);
    return fileInfo;
  }

  // deepKeys中保存当前的dirname
  deepKeys.push(dirname);

  const { [dirname]: polyFileCache = {} } = polyFileMapCache;

  let regularAsync = Promise.resolve();

  // 含有缓存，拿到缓存中的imports和fileData
  if (Object.keys(polyFileCache).length > 0) {
    const { matchedStrList = [], fileData } = polyFileCache;

    fileInfo.fileData = fileData;

    regularAsync = Promise.resolve(matchedStrList);
  } else {
    regularAsync = readFileAsync(dirname)
    .then(saveFileData)
    .then(regularMatch.bind(regularMatch, ext, dirname))
    .then(addToCache)
  }

  return regularAsync
    .then(genMatchedImportsCommonList)
    .then(genMatchedImportsDepListAsync)
    .then(saveMatchedImportsList)
};

/**
 *统计依赖文件的信息
 *1. 被引入了多少次
 *2. 大小
 *3. 是否被主包引入过
 * @param {*} [flatArray=[]]
 */
const dependencyStatistics = (flatArray = [], dependencyCache = {}) => {
  /**
   * 处理当前的imports
   *
   * @param {*} [fileInfo={}]
   */
  const genImportsList = (fileInfo = {}) => {
    const { imports = [], packages = {} } = fileInfo;

    /**
     * 处理当前importsItem
     *
     * @param {*} [importsItem={}]
     */
    const genImports = (importsItem = {}) => {
      const { src: { dirname = '' } = {} } = importsItem;

      if (!dependencyCache[dirname]) {
        const stat = fs.statSync(dirname);
        dependencyCache[dirname] = {
          usedCount: 1,
          size: parseInt(stat.size, 10),
          importByMain: false,
          packages: [],
          analiedList: [],
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
    };

    imports.forEach(genImports);
  }

  /**
   * 获得当前层的所有dependency(fileInfo)
   *
   * @param {*} [dependencyList=[]]
   * @param {*} [fileInfo={}]
   * @returns
   */
  const genDependencyList = (dependencyList = [], fileInfo = {}) => {
    const { imports = [] } = fileInfo;

    /**
     * 拿到当前ImportsItem的dependency
     *
     * @param {*} [dependencyList=[]]
     * @param {*} [importsItem={}]
     * @returns
     */
    const genDepListFromImports = (dependencyList = [], importsItem = {}) => {
      const { dependency = {} } = importsItem;

      dependencyList.push(dependency);

      return dependencyList;
    };

    return imports.reduce(genDepListFromImports, dependencyList);
  };

  // 如果没有数据，直接返回
  if (flatArray.length === 0) return Promise.resolve({ flatArray, dependencyCache });

  // 先处理当前层的依赖
  flatArray.forEach(genImportsList);

  // 再处理递归依赖
  const dependencyList = flatArray.reduce(genDependencyList, []);
  dependencyStatistics(dependencyList, dependencyCache);

  // 最后返回处理后的数据
  return Promise.resolve({ flatArray, dependencyCache });
}

/**
 * 是否是在主包或者分包目录下的文件
 *
 * @param {*} dirname
 */
const isFileDirFromPackage = dirname => [...mainPackage, ...subPackage].some(catalogDir => dirname.indexOf(`${catalogDir}/`) > -1);

/**
 *统计包的信息
 *
 * @param {*} [{ flatArray = [], dependencyCache = {} }={}]
 */
const packageStatistics = ({ flatArray = [], dependencyCache = {} } = {}) => {
  const totalDir = resolve();

  const totalSize = directorysSize([totalDir]).then(size => ({ total: { size, optSize: size } }));

  const subSizeList = subPackage.map((item) => directorysSize([item]).then(size => ({ directory: item, size, optSize: size })));

  /**
   * 生成分包大小
   *
   * @param {*} [itemsSize=[]]
   * @returns
   */
  const genSubSize = (itemsSize = []) => {
    const subTotalSize = itemsSize.reduce((total, item) => total + item.size, 0);

    /**
     * 生成总分包的依赖
     *
     * @param {*} [dependency={}]
     * @param {*} [item={}]
     * @returns
     */
    const genDependencyMap = (dependencyMap = {}, item = {}) => {
      const { directory = '', size = 0, optSize = 0 } = item;
      dependencyMap[directory] = { size, optSize };

      return dependencyMap;
    };

    const dependencyMap = itemsSize.reduce(genDependencyMap, {});

    return { 
      sub: {
        size: subTotalSize,
        optSize: subTotalSize,
        dependency: dependencyMap
      } 
    };
  };

  const subSize = Promise.all(subSizeList).then(genSubSize);

  /**
   * 生成包信息
   *
   * @param {*} [[totalSize = {}, subSize = {}]=[]]
   * @returns
   */
  const genPackageSize = ([totalSize = {}, subSize = {}] = []) => {
    const packageCache = { ...totalSize, ...subSize };
    const { total, sub } = packageCache;

    packageCache.main = {
      size: total.size - sub.size,
      optSize: total.size - sub.size
    };

    return { flatArray, dependencyCache, packageCache };
  };

  return Promise.all([totalSize, subSize])
    .then(genPackageSize);
};

/**
 * 满足黑白名单
 *
 * @param {string} [dirname='']
 * @returns
 */
const legalWhiteBlackFilter = (dirname = '') => {
  const isLegalWhite = whiteList.length === 0 || whiteList.some(whiteStr => dirname.indexOf(`${resolve(whiteStr)}/`) > -1);
  const isLegalBlack = blackList.length === 0 || blackList.every(blackStr => dirname.indexOf(`${resolve(blackStr)}/`) === -1);
  return isLegalWhite && isLegalBlack;
};

/**
 * 需要被下发的文件
 * 1. 不是包文件
 * 2. 该依赖文件没有被主包引入过
 * 3. 不大于最大引入次数
 * 4. 满足黑白名单
 * 5. 所属的包都是指定分包
 *
 * @param {*} [dirname={}]
 */
const isFileDirAndNE = (dirname = '', dependencyCache = {}) => {
    // 如果是包文件，不需要下发
  if (isFileDirFromPackage(dirname)) return false;

  const { importByMain = false, usedCount = 1, packages = [] } = dependencyCache[dirname];

  // 依赖文件没有被主包引入过并且不大于最大引入次数 黑白名单的过滤
  return !importByMain && usedCount <= THRESHOLD && legalWhiteBlackFilter(dirname) && packages.every(packageItem => packageItem.legalInto);
}

/**
 *
 *优化统计
 *
 * @param {number} [threshold=0]
 * @param {*} [{ flatArray = [], dependencyCache = {}, packageCache = {} }={}]
 */
const optimizeStatistics = ({ flatArray = [], dependencyCache = {}, packageCache = {} } = {}) => {
  const { total = {}, main = {}, sub = {} } = packageCache;

  /**
   * 生成主包减小的大小
   *
   * @param {number} [total=0]
   * @param {*} [key={}]
   * @returns
   */
  const genLessSize = (total = 0, key = {}) => {
    const { size = 0 } = dependencyCache[key];
    // 该文件可被下发
    if (isFileDirAndNE(key, dependencyCache)) return total + size;
    return total;
  };

  // 统计主包优化后的大小
  const lessSize = Object.keys(dependencyCache).reduce(genLessSize, 0);

  const { size: mainSize = 0 } = main;
  main.optSize = mainSize - lessSize;

  if (main.optSize > SUB_SIZE) {
    error.addOptimizeError({
      packageDir: '主包',
      size: main.optSize,
      maxSize: SUB_SIZE
    });
  }

  /**
   * 生成每个分包优化后大小
   *
   * @param {string} [key='']
   */
  const genSubDepOptSize = (key = '') => {
    const data = dependencyCache[key];
    const { size = 0, packages = [] } = data;

    // 该文件可被下发
    if (isFileDirAndNE(key, dependencyCache)) {
      /**
       * 每个分包优化后的大小(跟该依赖文件有关的分包)
       *
       * @param {*} [{ directory = '', type = '', legalInto = true }={}]
       */
      const genDepOptSize = ({ directory = '' } = {}) => {
        sub.dependency[directory].optSize += size;
      };

      packages.forEach(genDepOptSize);
    }
  };

  // 统计每个分包优化后的每个分包大小
  Object.keys(dependencyCache).forEach(genSubDepOptSize);

  /**
   * 生成总分包优化后的大小
   *
   * @param {*} total
   * @param {*} key
   * @returns
   */
  const genAllSubOptSize = (total, key) => {
    const data = sub.dependency[key];
    if (data.optSize > SUB_SIZE) {
      error.addOptimizeError({
        packageDir: key,
        size: data.optSize,
        maxSize: SUB_SIZE
      });
    }
    return total + data.optSize;
  };

  // 统计分包优化后的总分包的大小
  sub.optSize = Object.keys(sub.dependency).reduce(genAllSubOptSize, 0);

  // 统计总优化后的大小
  total.optSize = main.optSize + sub.optSize;

  if (total.optSize > TOTAL_SIZE) {
    error.addOptimizeError({
      packageDir: '总包',
      size: total.optSize,
      maxSize: TOTAL_SIZE
    });
  }
  return { flatArray, dependencyCache, packageCache };
}


/**
 * 开始下发依赖的文件到分包里面
 *
 * @param {*} [{ flatArray = [], dependencyCache = {}, packageCache = {} }={}]
 */
const executePathname = ({ flatArray = [], dependencyCache = {}, packageCache = {} } = {}) => {
  /**
   * 依赖文件没有被该包处理过
   *
   * @param {*} [fileInfo={}]
   */
  const isFileDirNotEexcuted = (fileInfo = {}) => {
    const { dirname = '', packages: { directory = '' } = {} } = fileInfo;
    const { analiedList = [] } = dependencyCache[dirname];

    if (analiedList.every(analiedFileDir => analiedFileDir !== directory)) {
      analiedList.push(directory);
      return true;
    }

    return false;
  };

  const legalFlatList = flatArray
    // 该文件所在的是合法分包（是分包并且是指定的可以接受依赖文件的分包）
    .filter(({ packages: { type = '', legalInto = true } = {} } = {}) => type === 'sub' && legalInto)
    // 是包文件(具体是入口文件，入口文件只会被处理一次)或 或者 文件没有被该包处理过
    .filter((fileInfo = {}) => isFileDirFromPackage(fileInfo.dirname) || isFileDirNotEexcuted(fileInfo))
    // 必须包含fileData
    .filter((fileInfo = {}) => fileInfo.fileData);

  /**
   * 拿到该文件的目的路径以及计算后的相对依赖
   * 
   * 1. 重新计算相对路径
   * 2. 把相对路径有改变的文件写入相应的目的路径
   * 
   */
  const genExecuteFileList = (executeFileList = [], fileInfo = {}) => {
    const { imports = [], fileData, dirname = '', distDirname: fileDistDirname = '', ext = '' } = fileInfo; 
    // 是否需要下发
    const needExecuteFromFile = isFileDirAndNE(dirname, dependencyCache);

    let distFileData = fileData;

    /**
     * 把新的相对地址写入文件
     * 1. 是否改变过相对地址
     * 2. 把新的相对地址写入文件
     * 
     * 当前文件与依赖文件都被下发，则相对路径不变
     * 当前文件路径不变，依赖文件路径不变，则相对路径不变
     * 当前文件路径不变，依赖文件路径改变 或者  当前路径改变，依赖文件路径不变，则相对路径改变
     *
     * @param {*} [importsItem={}]
     */
    const genRelativeDir = (importsItem = {}) => {
      const { 
        src: { imports: srcImports = '', dirname: srcDirname = '' } = {}, 
        dist: { dirname: distDirname = '' } = {} } = importsItem;
      const needExecuteFromImports = isFileDirAndNE(srcDirname, dependencyCache);

      let relativeImports = srcImports;

      // 当前文件路径改变，依赖文件路径不变
      if (needExecuteFromFile && !needExecuteFromImports) {
        relativeImports = path.relative(path.dirname(fileDistDirname), srcDirname);
      }
      // 当前路径不变，依赖文件路径改变
      else if (!needExecuteFromFile && needExecuteFromImports) {
        relativeImports = path.relative(path.dirname(dirname), distDirname);
      }

      if ((needExecuteFromFile && !needExecuteFromImports) || (!needExecuteFromFile && needExecuteFromImports)) {
        // 如果是json文件 则需要把依赖字符串的后缀去掉
        if (ext === 'json') relativeImports = relativeImports.replace(/\.\w+$/, '');
        distFileData = distFileData.replace(srcImports, relativeImports);
      }
    };

    // 计算相对路径
    imports.forEach(genRelativeDir);

    executeFileList.push({ distDirname: needExecuteFromFile ? fileDistDirname : dirname, distFileData });

    return executeFileList;
  };

  /**
   * 把新的文件内容写入目的地址
   *
   * @param {*} [executeFile={}]
   * @returns
   */
  const genWriteFile = (executeFile = {}) => {
    const { distDirname = '', distFileData } = executeFile;

    return writeFileAsync(distDirname, distFileData);
  }

  // 如果合法的文件列表为空，直接返回
  if (legalFlatList.length === 0) return Promise.resolve({ flatArray, dependencyCache, packageCache });

  const writeFileListAsync = legalFlatList
    .reduce(genExecuteFileList, [])
    .map(genWriteFile);

  /**
   * 生成所有文件的依赖List
   *
   * @param {*} [depFileList=[]]
   * @param {*} [fileInfo={}]
   * @returns
   */
  const genDepFileList = (depFileList = [], fileInfo = {}) => {
    /**
     * 从imports中找到所有的dependency
     *
     * @param {*} [depFileList=[]]
     * @param {*} [importsItem={}]
     * @returns
     */
    const genDepFileListFromImports = (depFileList = [], importsItem = {}) => {
      const { dependency = {} } = importsItem;

      depFileList.push(dependency);

      return depFileList;
    };   

    return fileInfo.imports.reduce(genDepFileListFromImports, depFileList);
  };

  // 拿到下一层文件信息
  const depFileList = legalFlatList.reduce(genDepFileList, [])


  // 递归进行优化
  const depExecutePathnameAsync = executePathname({ flatArray: depFileList, dependencyCache, packageCache });
  // 返回入参
  return Promise.all([writeFileListAsync, depExecutePathnameAsync]).then(() => ({ flatArray, dependencyCache, packageCache }));
}

/**
 *删除下发到分包中的依赖文件
 *
 * @param {*} [{ flatArray = [], dependencyCache = {} }={}]
 * @returns
 */
const unlinkPathname = ({ flatArray = [], dependencyCache = {}, packageCache = {} } = {}) => {
  const unlinkPromise = Object.keys(dependencyCache)
    // 该文件可被下发
    .filter((key) => isFileDirAndNE(key, dependencyCache))
    .map(key => unlinkAsync(key));

  return Promise.all(unlinkPromise).then(() => ({ flatArray, dependencyCache, packageCache }));
}

/**
 *成功log
 *
 * @param {*} [{ flatArray, dependencyCache, packageCache }={}]
 * @returns
 */
const sucLog = (dataMap = {}) => {
  log.sucLog(dataMap);

  return dataMap;
};

/**
 *错误log
 *
 * @param {*} [err={}]
 */
const errLog = () => {
  console.log(chalk.red('请先处理以上异常，并重新执行npm start'));
};

/**
 * 分析文件依赖的错误信息
 *
 * @param {*} [dataMap={}]
 * @returns
 */
const analysisError = (dataMap = {}) => {
  if (!error.hasErrMsg()) return dataMap;

  // 展示循环依赖数据
  error.showCircleDepList();
  // 展示依赖失败数据
  error.showNExistsList();

  return Promise.reject();
};

const optimizeError = (dataMap = {}) => {
  if (!error.hasOptimizeError()) return dataMap;

  // 展示优化过程中的错误信息
  error.showOptimizeError();

  return Promise.reject();
};

// ROOT_PATH下的所有文件
Promise.resolve(getEntryFileList())
  .then(flatPathname)
  .then(extPathname)
  .then(packagePathname)
  .then(polyAllImportPathname)
  .then(dependencyStatistics)
  .then(analysisError)
  .then(packageStatistics)
  .then(optimizeStatistics)
  .then(optimizeError)
  .then(executePathname)
  .then(unlinkPathname)
  .then(sucLog)
  .catch(errLog)
