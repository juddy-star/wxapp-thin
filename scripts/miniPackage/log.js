const chalk = require('chalk');
const { table } = require('table');

module.exports = class Log {
  constructor(options = {}) {
    this.options = options;
    this.init();
  }
  init() {}
  sucLog(dataMap = {}) {
    console.log(chalk.magenta('分包优化成功\n'));

    // 从包概况角度分析
    this.showLogByPackageCommon(dataMap);
    // 从包详情分析
    this.showLogByPackageDetail(dataMap);
    // 从依赖文件分析
    this.showLogByDep(dataMap);
  }
  showLogByPackageCommon({ packageCache = {} } = {}) {
    console.log('\n', chalk.magenta('包优化概况：'));

    const { total, main, sub } = packageCache;
    const packageCacheTable = table([
    ['包类型', '瘦身前', '瘦身后'],
    ['总包', this.optSizeDisplay(total.size), this.optSizeDisplay(total.optSize)],
    ['主包', this.optSizeDisplay(main.size), this.optSizeDisplay(main.optSize)],
    ['总分包', this.optSizeDisplay(sub.size), this.optSizeDisplay(sub.optSize)]
    ]);

    console.log(packageCacheTable);
  }
  showLogByPackageDetail({ packageCache = {} } = {}) {
    // 每个分包的信息
    console.log('\n', chalk.magenta('包优化详情：'));

    const { sub } = packageCache;

    const subTableData = Object.keys(sub.dependency)
      .map((key) => {
        const { size = 0, optSize = 0 } = sub.dependency[key];
        return { key, size, optSize, changeSize: optSize - size };
      }).sort((a, b) => {
        return b.changeSize - a.changeSize;
      }).map((item) => {
        const { key = '', size = 0, optSize = 0, changeSize = 0 } = item;
        return [key, this.optSizeDisplay(size), this.optSizeDisplay(optSize), this.optSizeDisplay(changeSize)];
      });

    console.log(table([['分包地址', '瘦身前', '瘦身后', '增量'], ...subTableData]));
  }
  optSizeDisplay(str = '') {
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
  }
}