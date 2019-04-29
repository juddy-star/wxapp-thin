const chalk = require('chalk');
const { table } = require('table');

module.exports = class Error {
  constructor(options = {}) {
    this.options = options;

    this.init();
  }
  init() {
    this.circleDepList = [];
    this.failDepList = [];
    this.optimizeErrList = [];
  }
  addFailDep(failDepMap = {}) {
    const { fileDir = '', matchedStr = '' } = failDepMap;
    if (this.failDepList.some(failDep => failDep.fileDir === fileDir && failDep.matchedStr === matchedStr)) return;

    this.failDepList.push(failDepMap); 
  }
  formatFailDepList() {
    const genFormatFailDep = (failDep = {}) => {
      const { fileDir = '', matchedStr = '', matchedDir = '' } = failDep;

      return [chalk.blue(fileDir), chalk.red(matchedStr), matchedDir];
    };

    return this.failDepList.map(genFormatFailDep);
  }
  showNExistsList() {
    if (this.failDepList.length === 0) return;

    console.log(chalk.magenta('失败依赖列表：'));

    console.log(table([['文件路径', '依赖字符串', '依赖文件路径'], ...this.formatFailDepList()]));
  }
  addCircleDep(circleDep = []) {
    if (this.circleDepList.some(circleDep => circleDep.toString() === circleDep.toString())) return;

    this.circleDepList.push(circleDep);
  }
  colorSameStr(list = [], color = 'red') {
    const genHash = (hash = {}, item = '') => {
      if (hash[item] !== undefined) {
        hash[item] = true;
      } else {
        hash[item] = false;
      }
      return hash;
    };

    const hash = list.reduce(genHash, {});
    const key = Object.keys(hash).find(key => hash[key]);

    const genColor = (item) => {
      if (item === key) return [chalk[color](item)];
      return [item];
    };

    return list.map(genColor);
  }
  formatCircleDepList() {
    const genFormatCircleDepList = (formatCircleDepList = [], circleDep = []) => {
      // 把相同的2个标记上红色
      circleDep = this.colorSameStr(circleDep);

      return [...formatCircleDepList, ...circleDep];
    };

    return this.circleDepList.reduce(genFormatCircleDepList, []);
  }
  showCircleDepList() {
    if (this.circleDepList.length === 0) return;

    console.log(chalk.magenta('循环依赖列表：'));

    console.log(table([['依赖文件路径'], ...this.formatCircleDepList()], {
      drawHorizontalLine: (index) => {
        return this.drawHorizontalLine(index, this.circleDepList);
      }
    }));
  }
  drawHorizontalLine(index, list = []) {
    const genHLineIndexList = (hLineIndexList = [], item) => {
      const length = item.length;
      const lastLength = hLineIndexList[hLineIndexList.length - 1];

      hLineIndexList.push(lastLength + length);
      
      return hLineIndexList;
    };

    const horizontalLineIndexList = list.reduce(genHLineIndexList, [0, 1]);

    return horizontalLineIndexList.some(hLineIndex => hLineIndex === index);
  }
  hasErrMsg() {
    return this.circleDepList.length > 0 || this.failDepList.length > 0;
  }
  addOptimizeError(optimizeError = {}) {
    this.optimizeErrList.push(optimizeError);
  }
  formatOptimizeErrorList() {
    const genFormatOptErr = (optErr = {}) => {
      const { packageDir = '', size = 0, maxSize = 0 } = optErr;

      return [packageDir, chalk.red((Number(size) / 1024).toFixed(2)), chalk.green((Number(maxSize) / 1024).toFixed(2))];
    };
    return this.optimizeErrList
      .sort((a, b) => b.size - a.size)
      .map(genFormatOptErr);
  }
  showOptimizeError() {
    if (this.optimizeErrList.length === 0) return;

    console.log(chalk.magenta('包大小超限：'));

    console.log(table([['包路径', '包大小（KB）', '最大限值 (KB)'], ...this.formatOptimizeErrorList()]));
  }
  hasOptimizeError() {
    return this.optimizeErrList.length > 0;
  }
}